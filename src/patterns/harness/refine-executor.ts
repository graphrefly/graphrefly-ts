/**
 * refineExecutor — bridge a `refineLoop` into the harness EXECUTE slot.
 *
 * Per-item lifecycle (Option A from the design note): on each new triaged
 * item, a fresh `refineLoop` is mounted via `switchMap`; when the loop
 * reaches a terminal status (`converged` / `budget` / `errored`), the
 * executor emits a single `ExecuteOutput`. The switchMap cancels any
 * in-flight loop when a newer item supersedes it.
 *
 * This shape makes all four {@link HarnessExecutor} contract rules
 * structurally unreachable:
 *  1. Terminal-status filter guarantees exactly one `ExecuteOutput` per
 *     completed refinement run.
 *  2. `switchMap` cancels the prior inner loop when the next item arrives.
 *  3. The item is captured in the switchMap closure, not mirrored to a
 *     side-state.
 *  4. The wrapped `derived([status, best, score], ...)` only returns
 *     non-null on terminal transitions — it never emits on input arrival.
 *
 * **Cross-item learning:** Option A creates a fresh refineLoop per item,
 * so `errorCritique`-style failure sampling does NOT accumulate across
 * items sharing a `rootCause`. A persistent-loop + re-seed surface is
 * tracked in `docs/optimizations.md` as the long-term follow-up.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import { derived } from "../../core/sugar.js";
import { filter, switchMap } from "../../extra/operators.js";
import {
	type DatasetItem,
	type Evaluator,
	type RefineLoopOptions,
	type RefineStatus,
	type RefineStrategy,
	refineLoop,
} from "../refine-loop/index.js";

import type { ExecuteOutput, HarnessExecutor, TriagedItem } from "./types.js";

/** Terminal-run snapshot passed to a custom `toOutput` mapper. */
export interface RefineExecutorResult<T> {
	/** Best candidate the inner loop converged on. `null` if no candidates were scored. */
	readonly best: T | null;
	/** Aggregate score at termination. `-Infinity` if the batch was empty. */
	readonly score: number;
	/** Reason the loop terminated. */
	readonly status: RefineStatus;
}

/** Configuration for {@link refineExecutor}. */
export interface RefineExecutorConfig<T> {
	/** Map a triaged item to the seed candidate (e.g. a catalog entry, prompt, patch). */
	seedFrom: (item: TriagedItem) => T;

	/** Reactive evaluator — same shape as passed to `refineLoop`. */
	evaluator: Evaluator<T>;

	/** Strategy (e.g. `errorCritique(teacher)`). Applied to every item's inner loop. */
	strategy: RefineStrategy<T>;

	/** Map a triaged item to the dataset rows the evaluator should score against. */
	datasetFor: (item: TriagedItem) => readonly DatasetItem[];

	/**
	 * Optional mapper from the inner loop's terminal snapshot to an
	 * `ExecuteOutput<T>`. Default: converged→success, budget→partial,
	 * errored→failure.
	 */
	toOutput?: (result: RefineExecutorResult<T>) => ExecuteOutput<T>;

	/** Convergence / budget options forwarded to each inner `refineLoop`. */
	refine?: Omit<RefineLoopOptions, "dataset" | "name">;

	/** Node name prefix for introspection. Default `"refine-executor"`. */
	name?: string;
}

function defaultToOutput<T>(result: RefineExecutorResult<T>): ExecuteOutput<T> {
	const { best, score, status } = result;
	const scoreStr = Number.isFinite(score) ? score.toFixed(3) : String(score);
	// Always attach `best` as `artifact` so downstream verifiers (e.g.
	// `evalVerifier`) can re-run evaluation against the refined candidate
	// without round-tripping through `detail`.
	const artifact = (best ?? undefined) as T | undefined;
	if (status === "converged") {
		return {
			outcome: "success",
			detail: `refineLoop converged at score ${scoreStr}`,
			artifact,
		};
	}
	if (status === "budget") {
		return {
			outcome: "partial",
			detail: `refineLoop hit budget at score ${scoreStr}`,
			artifact,
		};
	}
	return {
		outcome: "failure",
		detail: `refineLoop errored (status=${status})`,
		artifact,
	};
}

/**
 * Build a {@link HarnessExecutor} backed by a `refineLoop` per triaged item.
 *
 * @example Eval-driven repair loop in the harness EXECUTE slot.
 * ```ts
 * const harness = harnessLoop("repair", {
 *   adapter,
 *   executor: refineExecutor({
 *     seedFrom: (item) => initialCatalogEntry(item),
 *     datasetFor: (item) => pickAffectedTasks(item, allTasks),
 *     evaluator: (cands, tasks) => runEvalBatch(cands, tasks),
 *     strategy: errorCritique({ teacher, width: 3 }),
 *     refine: { maxIterations: 5, minScore: 0.9 },
 *   }),
 * });
 * ```
 */
export function refineExecutor<T>(config: RefineExecutorConfig<T>): HarnessExecutor<T> {
	const name = config.name ?? "refine-executor";
	const toOutput = config.toOutput ?? defaultToOutput<T>;

	return (input: Node<TriagedItem | null>): Node<ExecuteOutput<T> | null> => {
		// Filter null items upstream of switchMap. The harness's `executeInput`
		// is a merge of queue-latest nodes that start nullish before any item
		// is published — without this gate, every activation wave would
		// allocate a fresh null-emitting state inside the switchMap callback.
		// Unit 21 B: named so `describe()` shows the filter as `${name}/gate-in`
		// instead of an anonymous derived.
		const nonNullInput = filter(input, (v) => v != null, {
			name: `${name}/gate-in`,
		}) as Node<TriagedItem>;
		const raw = switchMap<TriagedItem, ExecuteOutput<T> | null>(
			nonNullInput,
			(item) => {
				const loop = refineLoop<T>(config.seedFrom(item), config.evaluator, config.strategy, {
					...config.refine,
					dataset: config.datasetFor(item),
					name: `${name}/inner`,
				});
				return derived<ExecuteOutput<T> | null>(
					[loop.status as Node<unknown>, loop.best as Node<unknown>, loop.score as Node<unknown>],
					([status, best, score]) => {
						const s = status as RefineStatus;
						// Explicit terminal allowlist — if RefineStatus ever gains a new
						// non-terminal variant, this default-rejects rather than silently
						// emitting a phantom ExecuteOutput. Intermediate iterations
						// (status="running") repeatedly return null here; the derived's
						// default Object.is equals absorbs null === null into RESOLVED
						// so only the first non-terminal wave emits DATA, and downstream
						// `filter(raw, v != null)` drops that one null before it can
						// reach `verifyNode`. Terminal status is batched with best/score
						// in `decideEffect`, so all three are fresh when this fn runs.
						if (s !== "converged" && s !== "budget" && s !== "errored") return null;
						return toOutput({
							best: best as T | null,
							score: score as number,
							status: s,
						});
					},
					{ name: `${name}/output` },
				);
			},
			{ name },
		);
		return filter(raw, (v) => v != null, {
			name: `${name}/gate-out`,
		}) as Node<ExecuteOutput<T> | null>;
	};
}
