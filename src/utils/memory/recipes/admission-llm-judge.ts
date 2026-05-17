/**
 * Recipe — **LLM gatekeeper** admission filter.
 *
 * `ReactiveFactStoreConfig.admissionFilter` is a **synchronous** face — it runs
 * inside `extract_op` at ingest time, so it cannot itself `await` an LLM (spec
 * §5.10 forbids raw async in the reactive layer; the LLM call belongs in a
 * source / `promptNode` upstream). This recipe adapts a **precomputed verdict
 * stream** to the sync face: the caller runs the judge upstream (a `promptNode`
 * over the candidate fragment stream) and feeds its `Map<FactId, boolean>`
 * verdicts in; the recipe returns a `Node<AdmissionFilter<T>>` that consults
 * the latest verdicts synchronously.
 *
 * ```ts
 * // upstream: async LLM judge produces verdicts (id → admit?)
 * const verdicts = promptNode(adapter, [candidates], judgeFragmentsFn); // Node<Map<FactId,boolean>>
 * const mem = reactiveFactStore<Doc>({
 *   ingest, extractDependencies,
 *   admissionFilter: admissionLlmJudge<Doc>(verdicts), // ② sync-face adapter
 * });
 * ```
 *
 * **Deny-by-default.** A fragment with no verdict yet is rejected
 * (`defaultVerdict` default `false`) — the store never admits an unjudged fact.
 * Set `defaultVerdict: true` for an allow-then-prune posture instead.
 *
 * **⚠️ The filter only gates admission AT ingest, synchronously.**
 * - A fragment ingested **before** its verdict lands is rejected (with the
 *   default `false`) and is **permanently lost** — there is no buffering or
 *   retry; a later verdict admitting that id does NOT retroactively ingest it.
 *   If you cannot guarantee verdict-before-fragment ordering, buffer/replay
 *   the candidate stream upstream (e.g. gate ingest behind the verdict Node).
 * - "Prune" in `defaultVerdict: true` is a misnomer for *post-hoc removal*: a
 *   verdict flipping `true → false` after a fact is committed does nothing
 *   (the fact stays). It only means "admit unjudged, reject explicitly-denied
 *   at ingest". True pruning requires a separate obsoletion path.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import type { AdmissionFilter, FactId } from "../fact-store.js";

export interface AdmissionLlmJudgeOptions {
	/** Verdict for a fragment the judge hasn't ruled on yet. Default `false` (strict gate). */
	readonly defaultVerdict?: boolean;
	/** Node name. Default `admission_llm_judge`. */
	readonly name?: string;
}

/**
 * Adapt an upstream LLM-verdict stream to the synchronous `admissionFilter`
 * face. `verdicts` is a Node carrying the current `factId → admit?` map (e.g.
 * a `promptNode` accumulating judgements).
 *
 * @category memory
 */
export function admissionLlmJudge<T>(
	verdicts: Node<ReadonlyMap<FactId, boolean>>,
	opts: AdmissionLlmJudgeOptions = {},
): Node<AdmissionFilter<T>> {
	const dflt = opts.defaultVerdict ?? false;
	const buildFilter =
		(m: ReadonlyMap<FactId, boolean>): AdmissionFilter<T> =>
		(f) =>
			m.get(f.id) ?? dflt;

	return node<AdmissionFilter<T>>(
		[verdicts],
		(batchData, actions, ctx) => {
			const m =
				(batchData[0] as readonly ReadonlyMap<FactId, boolean>[] | undefined)?.at(-1) ??
				(ctx.prevData[0] as ReadonlyMap<FactId, boolean> | undefined) ??
				new Map<FactId, boolean>();
			actions.emit(buildFilter(m));
		},
		{
			name: opts.name ?? "admission_llm_judge",
			describeKind: "derived",
			// Before any verdict arrives, apply the default policy.
			initial: buildFilter(new Map<FactId, boolean>()),
		},
	);
}
