/**
 * Harness-specific graph profiling (roadmap §9.0).
 *
 * Extends {@link graphProfile} with harness domain counters:
 * queue depths, strategy entries, retry/reingestion tracker sizes.
 *
 * @module
 */

import {
	type GraphProfileOptions,
	type GraphProfileResult,
	graphProfile,
} from "../../graph/profile.js";
import { QUEUE_NAMES } from "./defaults.js";
import type { HarnessGraph } from "./presets/harness-loop.js";
import type { QueueRoute, TriagedItem } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Harness-specific profile extending the base graph profile. */
export interface HarnessProfileResult extends GraphProfileResult {
	/** Per-queue retained item counts. */
	queueDepths: Record<QueueRoute, number>;
	/** Number of rootCause→intervention entries in the strategy model. */
	strategyEntries: number;
	/** Global retry count across all items. */
	totalRetries: number;
	/** Global reingestion count across all items. */
	totalReingestions: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Profile a harness graph with domain-specific counters.
 *
 * **Snapshot caveat (Unit 22 B).** Reads `.cache` values from the
 * strategy / retry / reingestion nodes + each queue topic's `.retained()`
 * view. These are point-in-time reads and are not transactional — if you
 * invoke this during an in-flight reactive wave the values may reflect
 * a partially-settled frame. For end-of-wave accuracy, call from outside
 * any batch boundary.
 *
 * @param harness - The HarnessGraph to profile.
 * @param opts - Optional base profile options.
 * @returns Harness profile with queue depths, strategy stats, and tracker sizes.
 */
export function harnessProfile(
	harness: HarnessGraph,
	opts?: GraphProfileOptions,
): HarnessProfileResult {
	const base = graphProfile(harness, opts);

	// Unit 22 B: iterate the hub's topic registry instead of a raw Map so
	// queue topics added post-construction (dead-letter `__unrouted`, etc.)
	// don't get silently ignored.
	const queueDepths: Record<string, number> = {};
	for (const route of QUEUE_NAMES) {
		const t = harness.queues.has(route) ? harness.queues.topic<TriagedItem>(route) : null;
		queueDepths[route] = t?.retained().length ?? 0;
	}

	return {
		...base,
		queueDepths: queueDepths as Record<QueueRoute, number>,
		strategyEntries: harness.strategy.entries.cache?.size ?? 0,
		totalRetries: harness.totalRetries.cache ?? 0,
		totalReingestions: harness.totalReingestions.cache ?? 0,
	};
}
