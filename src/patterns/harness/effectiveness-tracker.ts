/**
 * `effectivenessTracker` — action×context → success rate tracker.
 *
 * Demoted from `patterns/reduction` to `patterns/harness/` per Tier 2.3
 * (consolidation plan §1 Rule 6). The only in-tree consumer is the harness
 * strategy model, so the primitive moves alongside it. Building-block status
 * is dropped: this is a harness-shaped preset (a small composition over
 * `reactiveMap` with attempt-counting semantics) rather than an orthogonal
 * primitive.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import { derived } from "../../core/sugar.js";
import { reactiveMap } from "../../extra/reactive-map.js";
import { keepalive } from "../../extra/sources.js";

/** A single effectiveness record for an action×context pair. */
export type EffectivenessEntry = {
	readonly key: string;
	readonly attempts: number;
	readonly successes: number;
	readonly successRate: number;
};

/** Snapshot shape for the effectiveness tracker node. */
export type EffectivenessSnapshot = ReadonlyMap<string, EffectivenessEntry>;

/** Bundle returned by {@link effectivenessTracker}. */
export interface EffectivenessTrackerBundle {
	/** Reactive node — current effectiveness map snapshot. */
	readonly node: Node<EffectivenessSnapshot>;

	/** Record a completed action (success or failure). */
	record(key: string, success: boolean): void;

	/** Look up effectiveness for a specific key. */
	lookup(key: string): EffectivenessEntry | undefined;

	/** Tear down internal keepalive subscriptions. */
	dispose(): void;
}

/** Options for {@link effectivenessTracker}. */
export type EffectivenessTrackerOptions = {
	/** Name for the reactive map (default "effectiveness-entries"). */
	name?: string;
};

/**
 * Generic action×context → success rate tracker.
 *
 * Generalized from the harness `strategyModel` pattern. Tracks attempts and
 * successes per string key, exposes a reactive snapshot node, and provides
 * `record()` / `lookup()` methods.
 *
 * Use cases: A/B testing, routing optimization, cache policy tuning, retry
 * strategy selection — any domain that tracks effectiveness per action.
 *
 * @param opts - Optional configuration.
 * @returns Bundle with reactive node, record(), lookup(), dispose().
 */
export function effectivenessTracker(
	opts?: EffectivenessTrackerOptions,
): EffectivenessTrackerBundle {
	const _map = reactiveMap<string, EffectivenessEntry>({
		name: opts?.name ?? "effectiveness-entries",
	});

	const snapshot = derived<EffectivenessSnapshot>(
		[_map.entries],
		([mapSnap]) => {
			return new Map(mapSnap as ReadonlyMap<string, EffectivenessEntry>);
		},
		{
			name: `${opts?.name ?? "effectiveness"}-snapshot`,
			equals: (a, b) => {
				const am = a as EffectivenessSnapshot;
				const bm = b as EffectivenessSnapshot;
				if (am.size !== bm.size) return false;
				for (const [k, v] of am) {
					const bv = bm.get(k);
					if (!bv || v.attempts !== bv.attempts || v.successes !== bv.successes) return false;
				}
				return true;
			},
		},
	);

	function record(key: string, success: boolean): void {
		const existing = _map.get(key);
		const attempts = (existing?.attempts ?? 0) + 1;
		const successes = (existing?.successes ?? 0) + (success ? 1 : 0);
		_map.set(key, {
			key,
			attempts,
			successes,
			successRate: successes / attempts,
		});
	}

	function lookup(key: string): EffectivenessEntry | undefined {
		return _map.get(key);
	}

	const _unsub = keepalive(snapshot);

	return {
		node: snapshot,
		record,
		lookup,
		// qa A7: dispose tears down BOTH the snapshot keepalive AND the
		// underlying reactiveMap. Without `_map.dispose()`, repeated
		// create/dispose cycles leaked the reactive map across the lifetime
		// of the host process. Idempotent (reactiveMap.dispose is itself
		// idempotent per its JSDoc D6(a) note).
		dispose: () => {
			_unsub();
			_map.dispose();
		},
	};
}
