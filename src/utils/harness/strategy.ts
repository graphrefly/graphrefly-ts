/**
 * Strategy model and priority scoring (roadmap §9.0).
 *
 * `strategyModel` returns a typed alias of {@link AuditedSuccessTrackerGraph}
 * keyed by `StrategyKey` (the composite `rootCause→intervention` string).
 * The shared substrate (Class B audit Alt E collapse, 2026-04-30) replaces
 * the prior bespoke bundle shape; composite-key callers use {@link strategyKey}
 * to compute the key and pass `{ rootCause, intervention }` as record decoration.
 *
 * @module
 */

import { monotonicNs } from "@graphrefly/pure-ts/core/clock.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import {
	type AuditedSuccessTrackerGraph,
	auditedSuccessTracker,
} from "../../extra/composition/audited-success-tracker.js";
import { decay } from "../../extra/utils/decay.js";

import {
	DEFAULT_DECAY_RATE,
	DEFAULT_PRESET_ID,
	DEFAULT_SEVERITY_WEIGHTS,
	type PrioritySignals,
	type StrategyEntry,
	type StrategyKey,
	strategyKey,
	type TriagedItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Strategy model
// ---------------------------------------------------------------------------

/** Snapshot shape for the strategy-model `entries` node. */
export type StrategySnapshot = ReadonlyMap<StrategyKey, StrategyEntry>;

/** Strategy-model graph: a typed alias of {@link AuditedSuccessTrackerGraph}. */
export type StrategyModelGraph = AuditedSuccessTrackerGraph<StrategyKey, StrategyEntry>;

/**
 * Create a strategy model that tracks
 * `presetId × rootCause × intervention → successRate` over completed
 * issues (presetId axis added in Phase 13.I, 2026-05-01). Returns an
 * {@link AuditedSuccessTrackerGraph} keyed by {@link StrategyKey}.
 *
 * The reactive `entries` field is a `Node<StrategySnapshot>` suitable for
 * `describe()` / `withLatestFrom` composition.
 *
 * Composite-key conversion happens at the call site:
 * ```ts
 * const strategy = strategyModel();
 * strategy.record(strategyKey(presetId, rootCause, intervention), success, {
 *   presetId,
 *   rootCause,
 *   intervention,
 * });
 * strategy.lookup(strategyKey(presetId, rootCause, intervention));
 * ```
 *
 * Pass {@link DEFAULT_PRESET_ID} (`"default"`) for the presetId axis when
 * no preset registry is wired (single-agent harness).
 *
 * The model feeds back into TRIAGE for routing hints.
 */
export function strategyModel(): StrategyModelGraph {
	return auditedSuccessTracker<StrategyKey, StrategyEntry>({ name: "strategy" });
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

/**
 * Create a priority scoring derived node for a single triaged item.
 *
 * Combines severity weight, attention decay, strategy model effectiveness,
 * and an optional external urgency signal.
 *
 * **Age sampling caveat.** The `ageSeconds` term is computed as
 * `monotonicNs() - lastInteractionNs.cache` at *each reactive update*. If
 * nothing upstream settles, the score node does not recompute — so a
 * long-idle queue may show a stale score. Pass a `fromTimer(...)`-driven
 * node as a dep (or re-emit on `lastInteractionNs`) when live age decay
 * matters.
 *
 * **Not the same as `TriagedItem.priority`.** The LLM-emitted
 * `priority: 0..100` field on each triaged item is decorative today — the
 * queue consumption order ignores it (tracked in `docs/optimizations.md`
 * as a priority-ordered queue enhancement). This function computes an
 * orthogonal reactive score; it does NOT override the LLM's per-item
 * priority, nor does it drive queue ordering. Wire it to
 * `HarnessGraph.priorityScores` to surface per-route pressure.
 *
 * @param item - Node holding the triaged item.
 * @param strategy - Strategy model node.
 * @param lastInteractionNs - Node holding the monotonic timestamp (ns) of last human interaction.
 * @param urgency - Optional external urgency signal node (0–1 scale).
 * @param signals - Configurable scoring parameters.
 */
export function priorityScore(
	item: Node<TriagedItem>,
	strategy: Node<StrategySnapshot>,
	lastInteractionNs: Node<number>,
	urgency?: Node<number>,
	signals?: PrioritySignals,
): Node<number> {
	const severityWeights = { ...DEFAULT_SEVERITY_WEIGHTS, ...signals?.severityWeights };
	const decayRate = signals?.decayRate ?? DEFAULT_DECAY_RATE;
	const effectivenessThreshold = signals?.effectivenessThreshold ?? 0.7;
	const effectivenessBoost = signals?.effectivenessBoost ?? 15;

	const deps: Node<unknown>[] = [item, strategy, lastInteractionNs];
	if (urgency) deps.push(urgency);

	return node<number>(
		deps,
		(batchData, actions, ctx) => {
			const values = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const itm = values[0] as TriagedItem;
			const strat = values[1] as StrategySnapshot;
			const lastNs = values[2] as number;
			const urg = urgency ? (values[3] as number) : 0;

			// Base score from severity
			const baseWeight = severityWeights[itm.severity ?? "medium"];
			const ageSeconds = (monotonicNs() - lastNs) / 1e9;
			let score = decay(baseWeight, ageSeconds, decayRate, 0);

			// Strategy model boost
			const key = strategyKey(DEFAULT_PRESET_ID, itm.rootCause, itm.intervention);
			const entry = strat.get(key);
			if (entry && entry.successRate >= effectivenessThreshold) {
				score += effectivenessBoost;
			}

			// External urgency boost (0–1 scale → 0–20 points)
			score += urg * 20;

			actions.emit(score);
		},
		{ name: "priority-score", describeKind: "derived" },
	);
}
