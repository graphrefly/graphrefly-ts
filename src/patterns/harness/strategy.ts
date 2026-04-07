/**
 * Strategy model and priority scoring (roadmap §9.0).
 *
 * Pure-computation derived nodes — no LLM, no async.
 *
 * @module
 */

import { monotonicNs } from "../../core/clock.js";
import { type Node, node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { type ReactiveMapBundle, reactiveMap } from "../../extra/reactive-map.js";
import { decay } from "../memory.js";

import {
	DEFAULT_DECAY_RATE,
	DEFAULT_SEVERITY_WEIGHTS,
	type Intervention,
	type PrioritySignals,
	type RootCause,
	type Severity,
	type StrategyEntry,
	type StrategyKey,
	strategyKey,
	type TriagedItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Strategy model
// ---------------------------------------------------------------------------

/** Snapshot shape for the strategy model node. */
export type StrategySnapshot = ReadonlyMap<StrategyKey, StrategyEntry>;

/** Bundle returned by {@link strategyModel}. */
export interface StrategyModelBundle {
	/** Reactive node — current strategy map. */
	readonly node: Node<StrategySnapshot>;

	/** Record a completed issue (success or failure). */
	record(rootCause: RootCause, intervention: Intervention, success: boolean): void;

	/** Look up effectiveness for a specific pair. */
	lookup(rootCause: RootCause, intervention: Intervention): StrategyEntry | undefined;
}

/**
 * Create a strategy model that tracks `rootCause × intervention → successRate`
 * over completed issues. Pure derived computation — no LLM.
 *
 * The model feeds back into TRIAGE for routing hints.
 */
export function strategyModel(): StrategyModelBundle {
	const _map = reactiveMap<StrategyKey, StrategyEntry>({ name: "strategy-entries" });

	// Derived node that projects the reactive map into a plain Map snapshot.
	const snapshot = derived<StrategySnapshot>(
		[_map.node],
		([mapSnap]) => {
			const raw = (mapSnap as { value: { map: ReadonlyMap<StrategyKey, StrategyEntry> } }).value
				.map;
			// Return a fresh frozen copy so consumers see a stable reference.
			return new Map(raw);
		},
		{
			name: "strategy-model",
			equals: (a, b) => {
				const am = a as StrategySnapshot;
				const bm = b as StrategySnapshot;
				if (am.size !== bm.size) return false;
				for (const [k, v] of am) {
					const bv = bm.get(k);
					if (!bv || v.attempts !== bv.attempts || v.successes !== bv.successes) return false;
				}
				return true;
			},
		},
	);

	function record(rootCause: RootCause, intervention: Intervention, success: boolean): void {
		const key = strategyKey(rootCause, intervention);
		const existing = _map.get(key);
		const attempts = (existing?.attempts ?? 0) + 1;
		const successes = (existing?.successes ?? 0) + (success ? 1 : 0);
		_map.set(key, {
			rootCause,
			intervention,
			attempts,
			successes,
			successRate: successes / attempts,
		});
	}

	function lookup(rootCause: RootCause, intervention: Intervention): StrategyEntry | undefined {
		return _map.get(strategyKey(rootCause, intervention));
	}

	// Keep the derived alive so get() works without an external subscriber.
	const _unsub = snapshot.subscribe(() => {});

	return { node: snapshot, record, lookup };
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

	return derived<number>(
		deps,
		(values) => {
			const itm = values[0] as TriagedItem;
			const strat = values[1] as StrategySnapshot;
			const lastNs = values[2] as number;
			const urg = urgency ? (values[3] as number) : 0;

			// Base score from severity
			const baseWeight = severityWeights[itm.severity ?? "medium"];
			const ageSeconds = (monotonicNs() - lastNs) / 1e9;
			let score = decay(baseWeight, ageSeconds, decayRate, 0);

			// Strategy model boost
			const key = strategyKey(itm.rootCause, itm.intervention);
			const entry = strat.get(key);
			if (entry && entry.successRate >= effectivenessThreshold) {
				score += effectivenessBoost;
			}

			// External urgency boost (0–1 scale → 0–20 points)
			score += urg * 20;

			return score;
		},
		{ name: "priority-score" },
	);
}
