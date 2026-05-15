/**
 * refineExecutor — bridge a `refineLoop` into the harness EXECUTE work fn.
 *
 * Each claimed job mounts a fresh `refineLoop`; when the loop reaches a
 * terminal status (`converged` / `budget` / `errored`), the work fn emits a
 * single {@link HarnessJobPayload} with `execution` filled in. The JobFlow
 * pump subscribes once, takes the first DATA, then unsubscribes — so the
 * inner loop tears down cleanly when the harness acks the job.
 *
 * **C2 lifecycle (Tier 6.5).** The work fn is invoked once per claim, so
 * no internal `switchMap` is needed (the prior pre-C2 shape used switchMap
 * to handle a stream of items). The pump owns the per-claim lifecycle:
 * activation when the work fn returns, teardown when the result Node is
 * unsubscribed.
 *
 * **Cross-item learning:** a fresh refineLoop per item means
 * `errorCritique`-style failure sampling does NOT accumulate across items
 * sharing a `rootCause`. A persistent-loop + re-seed surface is filed in
 * `docs/optimizations.md` as a long-term follow-up.
 *
 * @module
 */

import { node } from "@graphrefly/pure-ts/core";
import { filter } from "@graphrefly/pure-ts/extra";
import {
	type DatasetItem,
	type Evaluator,
	type RefineLoopOptions,
	type RefineStatus,
	type RefineStrategy,
	refineLoop,
} from "../../presets/harness/refine-loop.js";
import type { JobEnvelope } from "../job-queue/index.js";

import type { ExecuteOutput, HarnessExecutor, HarnessJobPayload, TriagedItem } from "./types.js";

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
 * Build a {@link HarnessExecutor} backed by a `refineLoop` per claimed
 * job.
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

	return (job: JobEnvelope<HarnessJobPayload<T>>) => {
		const item = job.payload.item;
		const loop = refineLoop<T>(config.seedFrom(item), config.evaluator, config.strategy, {
			...config.refine,
			dataset: config.datasetFor(item),
			name: `${name}/inner`,
		});
		// Terminal-allowlist guard — emit non-null only on `converged` / `budget` /
		// `errored`; intermediate `running` waves emit `null` (deduped via the
		// node's default Object.is). The trailing `filter(v != null)` strips
		// the null DATA so the JobFlow pump's first-DATA capture sees the
		// terminal payload, not the intermediate null.
		const raw = node<HarnessJobPayload<T> | null>(
			[loop.status, loop.best, loop._score],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const s = data[0] as RefineStatus;
				if (s !== "converged" && s !== "budget" && s !== "errored") {
					actions.emit(null);
					return;
				}
				const exec = toOutput({
					best: data[1] as T | null,
					score: data[2] as number,
					status: s,
				});
				actions.emit({
					...job.payload,
					execution: { item, ...exec },
				});
			},
			{ name: `${name}/output`, describeKind: "derived" },
		);
		return filter(raw, (v) => v != null, { name: `${name}/gate-out` }) as ReturnType<
			HarnessExecutor<T>
		>;
	};
}
