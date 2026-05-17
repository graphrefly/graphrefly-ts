/**
 * Recipe — **REM-style replay consolidation**.
 *
 * Hassabis's sleep-consolidation frame: periodically replay the
 * highest-confidence × most-recent facts and synthesize a compressed successor
 * fragment (version-chained via `parent_fragment_id`). Builds the two config
 * fields the `consolidate` extension face needs — a reactive `consolidateTrigger`
 * (a `fromTimer` source, spec §5.8-compliant) and the `consolidate(store)`
 * summarizer — so the caller just spreads them in:
 *
 * ```ts
 * const mem = reactiveFactStore<Doc>({
 *   ingest, extractDependencies,
 *   ...consolidationRem<Doc>({
 *     periodMs: 60_000,
 *     topK: 8,
 *     recentWindowNs: 3_600_000_000_000n,           // 1h
 *     summarize: (frags) => mergeDocs(frags),       // domain-specific
 *   }),
 * });
 * ```
 *
 * The pattern default-wires consolidator output back into ingest (Q9-open-6),
 * so the successor fragment becomes a first-class fact; the originals are left
 * intact (callers obsolete them via their own `validTo` policy if desired —
 * keeping that out of the recipe preserves "the recipe never decides what to
 * forget").
 *
 * **Selection order & assumptions.** `recentWindowNs` filters the *pool* first
 * (facts within `recentWindowNs` of the newest live fact's `t_ns`); the pool
 * is then sorted by `confidence desc, t_ns desc` and `topK`-sliced — so an
 * old-but-in-window high-confidence fact can beat a brand-new low-confidence
 * one (recency gates the pool, confidence picks the winners). If every fact
 * falls outside the window the pool is empty and `summarize` is not called
 * (the consolidator emits `[]` — indistinguishable from an empty store).
 * `recentWindowNs` math assumes all fragments' `t_ns` come from the **same
 * clock** (`monotonicNs` xor `wallClockNs`, not mixed) — the window is
 * meaningless across mixed clocks.
 *
 * @module
 */

import type { Node } from "@graphrefly/pure-ts/core";
import { fromTimer } from "@graphrefly/pure-ts/extra";
import type { MemoryFragment, StoreReadHandle } from "../fact-store.js";

export interface ConsolidationRemOptions<T> {
	/** Replay period in milliseconds. */
	readonly periodMs: number;
	/** How many top facts to replay per pass. */
	readonly topK: number;
	/**
	 * Synthesize successor fragment(s) from the replayed set. Domain-specific —
	 * required (the pattern's default `consolidate` is a no-op). Set
	 * `parent_fragment_id` on the result to chain versions.
	 */
	readonly summarize: (replayed: readonly MemoryFragment<T>[]) => readonly MemoryFragment<T>[];
	/**
	 * Only replay facts whose `t_ns` is within this many ns of the most-recent
	 * fact's `t_ns` (recency gate). Omit to consider all live facts.
	 */
	readonly recentWindowNs?: bigint;
}

export interface ConsolidationRemConfig<T> {
	readonly consolidateTrigger: Node<number>;
	readonly consolidate: (store: StoreReadHandle<T>) => readonly MemoryFragment<T>[];
}

/**
 * Build the `{ consolidateTrigger, consolidate }` pair for a REM-replay
 * consolidation policy. Spread into {@link reactiveFactStore}'s config.
 *
 * @category memory
 */
export function consolidationRem<T>(opts: ConsolidationRemOptions<T>): ConsolidationRemConfig<T> {
	// Raw `fromTimer` is the trigger — the factory's `consolidated` node deps on
	// it and is keepalive'd, so it stays hot. (An intermediate equals-defaulted
	// wrapper would collapse the timer's first tick `0` against an `initial: 0`
	// via Object.is dedupe — timer ticks are events, not values.)
	const consolidateTrigger = fromTimer(opts.periodMs, { period: opts.periodMs });

	const consolidate = (store: StoreReadHandle<T>): readonly MemoryFragment<T>[] => {
		// Live facts only (obsolete ones aren't worth replaying).
		const live = [...store.values()].filter((f) => f.validTo === undefined);
		if (live.length === 0) return [];
		let pool = live;
		if (opts.recentWindowNs !== undefined) {
			const newest = live.reduce((m, f) => (f.t_ns > m ? f.t_ns : m), live[0]!.t_ns);
			const cutoff = newest - opts.recentWindowNs;
			pool = live.filter((f) => f.t_ns >= cutoff);
		}
		pool.sort((a, b) => b.confidence - a.confidence || Number(b.t_ns - a.t_ns));
		const replayed = pool.slice(0, Math.max(0, opts.topK));
		return replayed.length > 0 ? opts.summarize(replayed) : [];
	};

	return { consolidateTrigger, consolidate };
}
