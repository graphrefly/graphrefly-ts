/**
 * evalVerifier — re-run the affected eval tasks against the execute-stage
 * artifact instead of asking an LLM to opine on the fix.
 *
 * Pairs naturally with {@link refineExecutor}: refineExecutor emits an
 * `ExecuteOutput<T>.artifact` holding the converged candidate; evalVerifier
 * pulls it out via `extractArtifact` and feeds a single-candidate batch
 * into the same `Evaluator<T>` shape that `refineLoop` used. Consistent
 * scoring between EXECUTE and VERIFY — no "LLM said it looks fine" gap.
 *
 * **C2 lifecycle (Tier 6.5).** The work fn is invoked once per claimed
 * verify-stage job. A fresh single-candidate eval subgraph is mounted
 * inside the work fn and tears down when the JobFlow pump ack/unsubs.
 *
 * @module
 */

import { batch } from "../../core/batch.js";
import { type Node, node } from "../../core/node.js";
import { filter } from "../../extra/operators.js";
import type { JobEnvelope } from "../job-queue/index.js";
import type {
	DatasetItem,
	EvalResult,
	Evaluator,
	RefineLoopOptions,
	RefineStrategy,
} from "./presets/refine-loop.js";
import { refineExecutor } from "./refine-executor.js";

import type {
	ExecuteOutput,
	HarnessExecutor,
	HarnessJobPayload,
	HarnessVerifier,
	TriagedItem,
	VerifyOutput,
} from "./types.js";

/** Summary of the re-eval wave passed to a custom `toOutput` mapper. */
export interface EvalVerifierSummary {
	readonly scores: readonly EvalResult[];
	readonly meanScore: number;
	readonly passCount: number;
	readonly total: number;
	readonly threshold: number;
	/**
	 * True when the EXECUTE stage did not produce an artifact (i.e.
	 * `extractArtifact` returned `null` / `undefined`). Downstream mappers
	 * can distinguish this from "evaluator ran but everything scored zero".
	 */
	readonly missingArtifact?: boolean;
}

/** Configuration for {@link evalVerifier}. */
export interface EvalVerifierConfig<T> {
	/**
	 * Pull the artifact that should be re-evaluated out of the execute-stage
	 * output. Default: `(exec) => exec.artifact as T` — works out-of-the-box
	 * with `refineExecutor` (which populates `artifact` by default).
	 */
	extractArtifact?: (exec: ExecuteOutput<T>, item: TriagedItem) => T | null | undefined;

	/**
	 * Reactive evaluator — same contract as `refineLoop`'s `Evaluator<T>`.
	 */
	evaluator: Evaluator<T>;

	/**
	 * Resolve which dataset rows to score this verification against.
	 */
	datasetFor: (item: TriagedItem) => readonly DatasetItem[];

	/** Mean score required to pass verification. Default `0.5`. */
	threshold?: number;

	/** Optional output mapper — override the default findings / errorClass shape. */
	toOutput?: (summary: EvalVerifierSummary) => VerifyOutput;

	/** Node name prefix for introspection. */
	name?: string;
}

function meanScore(scores: readonly EvalResult[]): number {
	if (scores.length === 0) return Number.NEGATIVE_INFINITY;
	let sum = 0;
	for (const s of scores) sum += s.score;
	return sum / scores.length;
}

function defaultToOutput(summary: EvalVerifierSummary): VerifyOutput {
	const { passCount, total, meanScore: mean, threshold, missingArtifact } = summary;
	const meanStr = Number.isFinite(mean) ? mean.toFixed(3) : String(mean);
	const verified = !missingArtifact && total > 0 && mean >= threshold;
	const findings = missingArtifact
		? ["EXECUTE stage did not emit an artifact; cannot verify reactively"]
		: verified
			? [`${passCount}/${total} eval tasks passed; mean score ${meanStr} ≥ ${threshold}`]
			: total === 0
				? ["No eval tasks were selected for this item — cannot verify"]
				: [
						`${passCount}/${total} eval tasks passed; mean score ${meanStr} < threshold ${threshold}`,
					];
	return verified
		? { verified: true, findings }
		: { verified: false, findings, errorClass: "structural" };
}

function defaultExtractArtifact<T>(exec: ExecuteOutput<T>): T | null | undefined {
	return exec.artifact ?? null;
}

/**
 * Build a {@link HarnessVerifier} that re-runs the eval suite against the
 * artifact produced by EXECUTE.
 *
 * Reads `job.payload.execution` (filled by the upstream execute work fn)
 * and runs the evaluator against `extractArtifact(execution, item)`.
 * Returns the same payload with `verify` filled in.
 *
 * @example Pair with refineExecutor for end-to-end eval consistency.
 * ```ts
 * const evaluator: Evaluator<CatalogEntry> = (cands, ds) => runEval(cands, ds);
 * const harness = harnessLoop("repair", {
 *   adapter,
 *   executor: refineExecutor({ ..., evaluator, ...strategyConfig }),
 *   verifier: evalVerifier({ evaluator, datasetFor, threshold: 0.8 }),
 * });
 * ```
 */
export function evalVerifier<T>(config: EvalVerifierConfig<T>): HarnessVerifier<T> {
	const name = config.name ?? "eval-verifier";
	const threshold = config.threshold ?? 0.5;
	const toOutput = config.toOutput ?? defaultToOutput;
	const extract = config.extractArtifact ?? defaultExtractArtifact<T>;

	return (job: JobEnvelope<HarnessJobPayload<T>>) => {
		const { item, execution } = job.payload;
		// Defensive: verify stage should always run AFTER execute stage with
		// `execution` populated. If it isn't, surface that as a structural
		// failure so the dispatch effect can route the item.
		if (execution == null) {
			return {
				...job.payload,
				verify: {
					verified: false,
					findings: ["evalVerifier: prior execute stage produced no execution"],
					errorClass: "structural" as const,
				},
			} satisfies HarnessJobPayload<T>;
		}
		const artifact = extract(execution, item);
		if (artifact == null) {
			return {
				...job.payload,
				verify: toOutput({
					scores: [],
					meanScore: Number.NEGATIVE_INFINITY,
					passCount: 0,
					total: 0,
					threshold,
					missingArtifact: true,
				}),
			} satisfies HarnessJobPayload<T>;
		}

		// Per-claim eval subgraph. State seeds with the single candidate +
		// resolved dataset; the evaluator returns a Node<readonly EvalResult[]>.
		// The terminal payload emits when the evaluator settles; intermediate
		// nulls are filtered.
		//
		// **Batch-coalescing for synchronous-emit-during-subscribe evaluators
		// (COMPOSITION-GUIDE §9a).** This `batch()` wrap is load-bearing for a
		// SPECIFIC evaluator pattern: evaluators that, during the
		// `evaluator(candidates, dataset)` constructor call, synchronously
		// `subscribe()` to BOTH inputs and emit on each subscribe-callback
		// firing. Each subscribe pushes the cached value to its callback, the
		// callback runs `out.emit(...)`, and that emit becomes its own wave
		// when not inside a batch — leaving multiple DATA messages visible to
		// the downstream `derived` once it activates. The JobFlow pump's
		// "first DATA wins" capture would then fire on the FIRST intermediate
		// emit (e.g. empty scores from a pre-dataset recompute) instead of
		// the final settled value.
		//
		// Wrapping the constructor call in `batch()` coalesces those internal
		// emits into one multi-message delivery (§9a); sugar `derived`
		// auto-unwraps to the LAST value per its snapshot/combine semantics
		// (sugar.ts), so the downstream sees only the final settled scores.
		//
		// **Async evaluators are NOT covered by this fix.** Evaluators that
		// subscribe via microtask / Promise.then() / setTimeout don't see the
		// §9a hazard at all — their emits land in separate waves regardless
		// of whether the constructor call is batched. The fix is strictly
		// for the synchronous-emit-during-subscribe pattern (today's tests:
		// `presenceEvaluator` in actuator-executor.test.ts; `keywordEvaluator`
		// in refine-executor.test.ts uses `derived` and is naturally
		// single-emit). See `harness-default-bridges.test.ts` regression test
		// "evalVerifier coalesces synchronous-emit-during-subscribe
		// evaluators" for the locked contract.
		const candidates = node<readonly T[]>([], {
			initial: [artifact as T],
			name: `${name}/candidates`,
		});
		const dataset = node<readonly DatasetItem[]>([], {
			initial: config.datasetFor(item),
			name: `${name}/dataset`,
		});
		let scoresNode!: ReturnType<Evaluator<T>>;
		batch(() => {
			scoresNode = config.evaluator(candidates, dataset);
		});
		const raw = node<HarnessJobPayload<T> | null>(
			[scoresNode as Node<unknown>],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const arr = data[0] as readonly EvalResult[] | null | undefined;
				if (arr == null) {
					actions.emit(null);
					return;
				}
				const mean = meanScore(arr);
				const passCount = arr.filter((s) => s.score >= threshold).length;
				actions.emit({
					...job.payload,
					verify: toOutput({
						scores: arr,
						meanScore: mean,
						passCount,
						total: arr.length,
						threshold,
					}),
				});
			},
			{ name: `${name}/output`, describeKind: "derived" },
		);
		return filter(raw, (v) => v != null, { name: `${name}/gate-out` }) as ReturnType<
			HarnessVerifier<T>
		>;
	};
}

/**
 * Config for {@link harnessEvalPair} — the typed bundle that produces a
 * matched `refineExecutor<T>` + `evalVerifier<T>` pair sharing one
 * {@link Evaluator} and one `datasetFor` resolver.
 */
export interface HarnessEvalPairConfig<T> {
	/** Map a triaged item to the seed candidate. */
	seedFrom: (item: TriagedItem) => T;
	/** The reactive evaluator used by BOTH executor and verifier. */
	evaluator: Evaluator<T>;
	/** The refinement strategy (e.g. `errorCritique(teacher)`). */
	strategy: RefineStrategy<T>;
	/** Resolve dataset rows per triaged item. */
	datasetFor: (item: TriagedItem) => readonly DatasetItem[];
	/** Pass-threshold for the verifier. Default `0.5`. */
	threshold?: number;
	/** Convergence / budget options forwarded to each inner `refineLoop`. */
	refine?: Omit<RefineLoopOptions, "dataset" | "name">;
	/**
	 * Shared node-name prefix — the executor becomes `${name}-exec` and the
	 * verifier `${name}-verify` for distinct but related describe() paths.
	 * Default `"harness-pair"`.
	 */
	name?: string;
}

/**
 * Typed factory that returns a matched `{ executor, verifier }` pair.
 *
 * Prevents the "executor wrote `A`, verifier expected `B`" class of runtime
 * cast errors — `T` is threaded through both sides, so mixing up the
 * configuration is a compile error instead of a silent `as T` in
 * `extractArtifact`. Shares the evaluator so EXECUTE and VERIFY score with
 * identical semantics (the whole point of `evalVerifier`).
 */
export function harnessEvalPair<T>(config: HarnessEvalPairConfig<T>): {
	executor: HarnessExecutor<T>;
	verifier: HarnessVerifier<T>;
} {
	const baseName = config.name ?? "harness-pair";
	const executor = refineExecutor<T>({
		name: `${baseName}-exec`,
		seedFrom: config.seedFrom,
		evaluator: config.evaluator,
		strategy: config.strategy,
		datasetFor: config.datasetFor,
		refine: config.refine,
	});
	const verifier = evalVerifier<T>({
		name: `${baseName}-verify`,
		evaluator: config.evaluator,
		datasetFor: config.datasetFor,
		threshold: config.threshold,
	});
	return { executor, verifier };
}
