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
import type { HarnessGraph } from "./loop.js";
import type { QueueRoute } from "./types.js";

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
 * @param harness - The HarnessGraph to profile.
 * @param opts - Optional base profile options.
 * @returns Harness profile with queue depths, strategy stats, and tracker sizes.
 */
export function harnessProfile(
	harness: HarnessGraph,
	opts?: GraphProfileOptions,
): HarnessProfileResult {
	const base = graphProfile(harness, opts);

	const queueDepths: Record<string, number> = {};
	for (const [route, topic] of harness.queues) {
		queueDepths[route] = topic.retained().length;
	}

	return {
		...base,
		queueDepths: queueDepths as Record<QueueRoute, number>,
		strategyEntries: harness.strategy.node.get()?.size ?? 0,
		totalRetries: harness.totalRetries.get() ?? 0,
		totalReingestions: harness.totalReingestions.get() ?? 0,
	};
}
