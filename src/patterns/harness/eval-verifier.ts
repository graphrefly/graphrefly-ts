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
 * Per-item lifecycle mirrors `refineExecutor`: each new execute-context
 * pair mounts a fresh eval subgraph inside `switchMap`, so a superseding
 * item cancels the prior run.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { filter, switchMap } from "../../extra/operators.js";
import type { NodeInput } from "../../extra/sources.js";
import type {
	DatasetItem,
	EvalResult,
	Evaluator,
	RefineLoopOptions,
	RefineStrategy,
} from "../refine-loop/index.js";
import { refineExecutor } from "./refine-executor.js";

import type {
	ExecuteOutput,
	HarnessExecutor,
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
	 * When `true`, `scores` / `total` / `passCount` are all zero and
	 * `meanScore` is `-Infinity`.
	 */
	readonly missingArtifact?: boolean;
}

/** Configuration for {@link evalVerifier}. */
export interface EvalVerifierConfig<T> {
	/**
	 * Pull the artifact that should be re-evaluated out of the execute-stage
	 * output. Default: `(exec) => exec.artifact as T` — works out-of-the-box
	 * with `refineExecutor` (which populates `artifact` by default).
	 *
	 * **Type trust:** the default cast assumes the caller's executor wrote
	 * a `T`-shaped value to `ExecuteOutput.artifact`. A wrong-typed artifact
	 * surfaces as a runtime error inside `evaluator`, not here — supply a
	 * narrowing `extractArtifact` if you need stricter validation.
	 */
	extractArtifact?: (exec: ExecuteOutput<T>, item: TriagedItem) => T | null | undefined;

	/**
	 * Reactive evaluator — same contract as `refineLoop`'s `Evaluator<T>`.
	 * Typically this is the SAME evaluator configured inside `refineExecutor`
	 * so EXECUTE and VERIFY scoring stay consistent.
	 */
	evaluator: Evaluator<T>;

	/**
	 * Resolve which dataset rows to score this verification against. Use
	 * `affectedTaskFilter` or hand-roll per-item subset logic. Default:
	 * empty array (verifier emits a findings entry explaining this).
	 */
	datasetFor: (item: TriagedItem) => readonly DatasetItem[];

	/** Mean score required to pass verification. Default `0.5`. */
	threshold?: number;

	/** Optional output mapper — override the default findings / errorClass shape. */
	toOutput?: (summary: EvalVerifierSummary) => VerifyOutput;

	/** Node name prefix for introspection. Default `"eval-verifier"`. */
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
 * Consumes the shared `[executeOutput, item]` context node that the
 * harness pre-pairs via `withLatestFrom` — no internal re-wrap here (QA
 * round: "defaultLlmVerifier double-wraps withLatestFrom"). The harness's
 * single `executeContextNode` is reused by both the verifier and the
 * fast-retry dispatcher, so exec + item are subscribed once per wave.
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

	return (
		context: Node<readonly [ExecuteOutput<T> | null, TriagedItem | null] | null>,
	): Node<VerifyOutput | null> => {
		// Gate non-null [exec, item] pairs upstream of switchMap so
		// activation / RESOLVED waves never allocate fresh inner subgraphs.
		// Unit 21 B: named filters surface as `${name}/gate-in` in describe().
		const validPair = filter(
			context as Node<unknown>,
			(p) =>
				p != null &&
				(p as readonly [unknown, unknown])[0] != null &&
				(p as readonly [unknown, unknown])[1] != null,
			{ name: `${name}/gate-in` },
		) as Node<readonly [ExecuteOutput<T>, TriagedItem]>;
		const raw = switchMap<readonly [ExecuteOutput<T>, TriagedItem], VerifyOutput | null>(
			validPair,
			(pair) => {
				const [execOut, item] = pair;
				const artifact = extract(execOut, item);
				if (artifact == null) {
					return state<VerifyOutput | null>(
						toOutput({
							scores: [],
							meanScore: Number.NEGATIVE_INFINITY,
							passCount: 0,
							total: 0,
							threshold,
							missingArtifact: true,
						}),
					) as NodeInput<VerifyOutput | null>;
				}
				const candidates = state<readonly T[]>([artifact as T], {
					name: `${name}/candidates`,
				});
				const dataset = state<readonly DatasetItem[]>(config.datasetFor(item), {
					name: `${name}/dataset`,
				});
				const scoresNode = config.evaluator(candidates, dataset);
				return derived<VerifyOutput | null>(
					[scoresNode as Node<unknown>],
					([scores]) => {
						const arr = scores as readonly EvalResult[] | null | undefined;
						if (arr == null) return null;
						const mean = meanScore(arr);
						const passCount = arr.filter((s) => s.score >= threshold).length;
						return toOutput({
							scores: arr,
							meanScore: mean,
							passCount,
							total: arr.length,
							threshold,
						});
					},
					{ name: `${name}/output` },
				);
			},
			{ name },
		);
		return filter(raw, (v) => v != null, { name: `${name}/gate-out` }) as Node<VerifyOutput | null>;
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
 *
 * @example
 * ```ts
 * const { executor, verifier } = harnessEvalPair<CatalogEntry>({
 *   seedFrom: (item) => initialCatalogEntry(item),
 *   evaluator: (cands, ds) => runEvalBatch(cands, ds),
 *   strategy: errorCritique({ teacher, width: 3 }),
 *   datasetFor: affectedTasksFor,
 *   threshold: 0.8,
 * });
 * const harness = harnessLoop<CatalogEntry>("repair", { adapter, executor, verifier });
 * ```
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
