/**
 * Batch deferral for tier-3+ messages.
 *
 * §1.3.7 — Inside a batch, tier 0–2 signals propagate immediately. Tier 3
 * (DATA/RESOLVED), tier 4 (COMPLETE/ERROR), and tier 5 (TEARDOWN) are queued
 * and drained in ascending phase order after the outermost `batch()` callback
 * returns.
 *
 * **Phase vocabulary:**
 * - Phase 1 = tiers 0–2 — immediate, never queued.
 * - Phase 2 = tier 3 — {@link drainPhase2}. Value settlements.
 * - Phase 3 = tier 4 — {@link drainPhase3}. Terminal signals.
 * - Phase 4 = tier 5 — {@link drainPhase4}. TEARDOWN (unified deferral).
 *
 * Drain rule: lowest non-empty phase first. Re-enqueues during drain bump the
 * loop back to the lowest non-empty phase, preserving "earlier values settle
 * before later terminals/teardown" across callback re-entry.
 *
 * **Pre-sorted input invariant.** `downWithBatch` assumes `messages` is
 * already sorted in ascending tier order (produced by `_frameBatch` in
 * `node.ts`). The walker exploits monotonicity for a single O(n) pass and
 * slices at phase boundaries without re-sorting.
 */

import type { Messages } from "./messages.js";

const MAX_DRAIN_ITERATIONS = 1000;

let batchDepth = 0;
let flushInProgress = false;

/** Tier 3 (DATA/RESOLVED) deferral queue — drained first. */
const drainPhase2: Array<() => void> = [];
/** Tier 4 (COMPLETE/ERROR) deferral queue — drained after phase 2. */
const drainPhase3: Array<() => void> = [];
/** Tier 5 (TEARDOWN) deferral queue — drained last. */
const drainPhase4: Array<() => void> = [];

/**
 * Returns whether the current call stack is inside a batch scope **or** while
 * a deferred drain is in progress. Nested `downWithBatch` calls during drain
 * still defer (they bump the drain loop).
 */
export function isBatching(): boolean {
	return batchDepth > 0 || flushInProgress;
}

/**
 * Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral
 * queue. If `fn` throws, deferred work for the outer frame is discarded
 * (unless a drain is already in progress — cross-language decision A4).
 */
export function batch(fn: () => void): void {
	batchDepth += 1;
	let threw = false;
	try {
		fn();
	} catch (e) {
		threw = true;
		throw e;
	} finally {
		batchDepth -= 1;
		if (batchDepth === 0) {
			if (threw) {
				if (!flushInProgress) {
					drainPhase2.length = 0;
					drainPhase3.length = 0;
					drainPhase4.length = 0;
				}
			} else {
				drainPending();
			}
		}
	}
}

function drainPending(): void {
	const ownsFlush = !flushInProgress;
	if (ownsFlush) flushInProgress = true;

	const errors: unknown[] = [];
	let iterations = 0;
	try {
		while (drainPhase2.length > 0 || drainPhase3.length > 0 || drainPhase4.length > 0) {
			iterations += 1;
			if (iterations > MAX_DRAIN_ITERATIONS) {
				drainPhase2.length = 0;
				drainPhase3.length = 0;
				drainPhase4.length = 0;
				throw new Error(
					`batch drain exceeded ${MAX_DRAIN_ITERATIONS} iterations — likely a reactive cycle`,
				);
			}
			// Always drain the lowest non-empty phase. Re-enqueues at any level
			// cause the next iteration to restart from phase 2 if needed.
			const queue =
				drainPhase2.length > 0 ? drainPhase2 : drainPhase3.length > 0 ? drainPhase3 : drainPhase4;
			const ops = queue.splice(0);
			for (const run of ops) {
				try {
					run();
				} catch (e) {
					errors.push(e);
				}
			}
		}
	} finally {
		if (ownsFlush) flushInProgress = false;
	}

	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(errors, "batch drain: multiple callbacks threw");
	}
}

/**
 * Deliver pre-sorted messages through `sink` with tier-based deferral applied.
 *
 * `messages` MUST be in ascending tier order (produced by `_frameBatch` in
 * `node.ts`); the walker exploits that invariant to find phase cuts in one
 * pass without re-sorting.
 *
 * Behavior:
 * - Tier 0–2 — delivered synchronously.
 * - Tier 3 — deferred to {@link drainPhase2} when batching, else synchronous.
 * - Tier 4 — deferred to {@link drainPhase3} when batching, else synchronous.
 * - Tier 5 — deferred to {@link drainPhase4} when batching, else synchronous.
 *
 * Tier-classification uses the caller-supplied `tierOf` so that batch stays
 * decoupled from `GraphReFlyConfig`. NodeImpl passes `config.tierOf` (a
 * pre-bound closure built once in the config constructor) at the emit site;
 * alternate configs can pass their own lookup.
 */
export function downWithBatch(
	sink: (messages: Messages) => void,
	messages: Messages,
	tierOf: (t: symbol) => number,
): void {
	if (messages.length === 0) return;

	// Fast path: single message (hot in propagation).
	if (messages.length === 1) {
		const tier = tierOf(messages[0][0]);
		if (tier < 3 || !isBatching()) {
			sink(messages);
			return;
		}
		const queue = tier >= 5 ? drainPhase4 : tier === 4 ? drainPhase3 : drainPhase2;
		queue.push(() => sink(messages));
		return;
	}

	// Multi-message: walk once over pre-sorted input, find phase cuts.
	// Monotone tier order means `phase2Start <= phase3Start <= phase4Start`.
	const n = messages.length;
	let phase2Start = n;
	let phase3Start = n;
	let phase4Start = n;

	let i = 0;
	while (i < n && tierOf(messages[i][0]) < 3) i++;
	phase2Start = i;
	while (i < n && tierOf(messages[i][0]) === 3) i++;
	phase3Start = i;
	while (i < n && tierOf(messages[i][0]) === 4) i++;
	phase4Start = i;
	// Anything from phase4Start..n has tier >= 5.

	const batching = isBatching();

	if (phase2Start > 0) {
		// Immediate tier 0–2 region.
		const immediate = messages.slice(0, phase2Start);
		sink(immediate);
	}

	if (phase3Start > phase2Start) {
		const phase2 = messages.slice(phase2Start, phase3Start);
		if (batching) drainPhase2.push(() => sink(phase2));
		else sink(phase2);
	}

	if (phase4Start > phase3Start) {
		const phase3 = messages.slice(phase3Start, phase4Start);
		if (batching) drainPhase3.push(() => sink(phase3));
		else sink(phase3);
	}

	if (n > phase4Start) {
		const phase4 = messages.slice(phase4Start, n);
		if (batching) drainPhase4.push(() => sink(phase4));
		else sink(phase4);
	}
}
