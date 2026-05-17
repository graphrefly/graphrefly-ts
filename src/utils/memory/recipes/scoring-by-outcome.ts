/**
 * Recipe — **self-evolving scoring policy** (continual learning).
 *
 * Closes Hassabis's continual-learning frame against the `scoring` extension
 * face (②): an outcome / RL signal stream feeds back into the policy that
 * `reactiveFactStore` applies on `outcome` write-back, so the agent's memory
 * *learns* which facts proved useful.
 *
 * ```ts
 * const outcomes = node<OutcomeSignal>([], { initial: undefined });
 * const mem = reactiveFactStore<Doc>({
 *   ingest, extractDependencies,
 *   outcome:  outcomes,                       // ③ topic input (RL signal)
 *   scoring:  scoringByOutcome(outcomes),     // ② policy that evolves with it
 * });
 * ```
 *
 * The returned `Node<ScoringPolicy<T>>` re-emits a fresh policy closure every
 * time an `OutcomeSignal` arrives; the closure scores a fragment as
 * `clamp01(base(f) + learningRate · Σ reward(f.id))`. The reward accumulator is
 * a recipe-owned closure Map (sole-owner mutation inside the derived fn — the
 * COMPOSITION-GUIDE-sanctioned pattern for a fold the node alone advances),
 * keyed by `factId`, so learning is cumulative across episodes and survives
 * policy re-emission.
 *
 * **Contract (load-bearing — do not "normalize"):**
 * - The fn folds **every signal in the wave** (`for (const sig of batchData[0])`),
 *   NOT `lastOf` last-only like the other recipes — a batched wave carrying N
 *   `OutcomeSignal`s must accumulate all N. Replacing this with `lastOf` would
 *   silently drop all-but-last reward in a batch.
 * - `outcomes` MUST be a non-replaying event source (each physical signal
 *   delivered once). The fold has no per-signal idempotency key (two identical
 *   `{factId, reward}` are legitimately distinct events); a source that
 *   push-on-subscribe **re-delivers** a cached signal to a re-subscribe would
 *   double-count it. The normal wiring (single keepalive'd consumer via the
 *   factory's `outcomeProcessor`, subscribed at construction before any emit)
 *   is safe.
 * - The policy node carries **no `equals`** by design: every emit is a fresh
 *   closure identity so the factory's `outcomeProcessor` always re-fires and
 *   re-reads the freshly-folded `acc` (the closure reads `acc` lazily at call
 *   time). Adding an `equals` would make outcome write-back lag one signal.
 * - `acc` retains one entry per rewarded `factId` for the store's lifetime
 *   (same bounded-growth class as `ingestLog`; acceptable — it is metadata).
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import type { FactId, MemoryFragment, OutcomeSignal, ScoringPolicy } from "../fact-store.js";

export interface ScoringByOutcomeOptions<T> {
	/**
	 * Base score before accumulated reward. Default: the fragment's own
	 * `confidence` (so an un-rewarded fact keeps its ingested confidence).
	 */
	readonly base?: (f: MemoryFragment<T>) => number;
	/** Multiplier on accumulated reward. Default `1`. */
	readonly learningRate?: number;
	/** Node name (collision-safe if you build more than one). Default `scoring_by_outcome`. */
	readonly name?: string;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Build a continual-learning {@link ScoringPolicy} Node from an
 * {@link OutcomeSignal} stream. Pass the SAME `outcomes` Node as both
 * `config.outcome` and (via this recipe) `config.scoring`.
 *
 * @category memory
 */
export function scoringByOutcome<T>(
	outcomes: Node<OutcomeSignal>,
	opts: ScoringByOutcomeOptions<T> = {},
): Node<ScoringPolicy<T>> {
	const base = opts.base ?? ((f: MemoryFragment<T>) => f.confidence);
	const learningRate = opts.learningRate ?? 1;
	// Sole-owner reward accumulator (recipe-level fold; only this node writes it).
	const acc = new Map<FactId, number>();

	const buildPolicy = (): ScoringPolicy<T> => (fragment) =>
		clamp01(base(fragment) + learningRate * (acc.get(fragment.id) ?? 0));

	return node<ScoringPolicy<T>>(
		[outcomes],
		(batchData, actions) => {
			// Apply every signal in the wave (batched outcomes accumulate in order).
			// Empty wave (push-on-subscribe / SENTINEL) → re-emit the current policy
			// so a late subscriber still gets a usable scorer.
			const wave = (batchData[0] as readonly OutcomeSignal[] | undefined) ?? [];
			for (const sig of wave) acc.set(sig.factId, (acc.get(sig.factId) ?? 0) + sig.reward);
			actions.emit(buildPolicy());
		},
		{
			name: opts.name ?? "scoring_by_outcome",
			describeKind: "derived",
			// Usable scorer before any outcome arrives (base-only).
			initial: buildPolicy(),
		},
	);
}
