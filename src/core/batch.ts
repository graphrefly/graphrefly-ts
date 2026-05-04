/**
 * Batch deferral for tier-3+ messages, plus per-node emit coalescing inside
 * explicit `batch()` scopes.
 *
 * **Canonical invariant:** GRAPHREFLY-SPEC.md §1.3.7 — inside a batch,
 * tier 0–2 signals propagate immediately; tier 3 (DATA/RESOLVED) and tier 4
 * (INVALIDATE) form one settle slice; tier 5 (COMPLETE/ERROR) and tier 6
 * (TEARDOWN) follow in ascending phase order after the outermost `batch()`
 * callback returns.
 *
 * **Per-node emit coalescing (Bug 2 fix, 2026-04-17).** Inside an explicit
 * `batch()` scope, consecutive emissions from the same node accumulate in
 * `NodeImpl._batchPendingMessages` (see JSDoc there) instead of each producing
 * a separate downstream wave. K `.emit()` calls to the same source collapse to
 * one coalesced `downWithBatch` call per child edge at batch end. Outside batch
 * (or during drain), coalescing does NOT apply — each emit produces its own wave.
 *
 * **Phase vocabulary (post-DS-13.5.A renumbering):**
 * - Phase 1 = tiers 0–2 — immediate, never queued.
 * - Phase 2 = tier 3 (DATA/RESOLVED) + tier 4 (INVALIDATE) — {@link drainPhase2}.
 *   The "settle slice." INVALIDATE is settle-class (decrements
 *   `_dirtyDepCount` like RESOLVED) so it shares the same drain queue —
 *   one batch-frame == one wave settlement, regardless of whether the
 *   wave carries DATA, RESOLVED, INVALIDATE, or any mix across nodes.
 * - Phase 3 = tier 5 (COMPLETE/ERROR) — {@link drainPhase3}. Terminal signals.
 * - Phase 4 = tier 6 (TEARDOWN) — {@link drainPhase4}. Unified teardown deferral.
 *
 * **Q16 atomicity carve-out (DS-13.5.A).** When a single emit's framed wave
 * carries BOTH tier-5 (COMPLETE/ERROR) AND tier-6 (TEARDOWN) — the shape
 * Q16 produces by auto-prefixing a synthetic `[COMPLETE]` before
 * user-emitted `[TEARDOWN]` on a non-terminal node — the entire
 * terminal+teardown slice drains together at phase 4, not split across
 * phases 3 and 4. Splitting would let the dep callback's settlement
 * check fire between COMPLETE delivery and TEARDOWN delivery,
 * re-establishing cleanup hooks that then double-fire on TEARDOWN
 * (regression originally surfaced by `Graph.destroy` cleanup-fires-once
 * tests). Standalone COMPLETE/ERROR emissions (no TEARDOWN in the same
 * wave) still drain at phase 3 normally.
 *
 * Drain rule: fire any pending flush hooks first, then the lowest non-empty
 * phase. Re-enqueues during drain (and hooks registered by reentrant batches
 * inside subscriber callbacks) bump the loop back to the top so newly-added
 * hooks and closures get processed.
 */

import type { Messages } from "./messages.js";

/**
 * Lock 2.F′ (Phase 13.6.A): the drain-iteration cap is read from
 * `cfg.maxBatchDrainIterations` via a getter callback that `node.ts`
 * registers at module-init time. The callback indirection avoids the
 * `batch.ts` → `node.ts` import cycle (`node.ts` imports `batch.ts`'s
 * `downWithBatch` / `isBatching`).
 *
 * Default `() => 1000` is in force until `node.ts` registers its getter
 * (which reads `defaultConfig.maxBatchDrainIterations`). Test isolation
 * with `new GraphReFlyConfig(...)` does NOT route through the global
 * drain cap — batch deferral is process-global, so the cap is necessarily
 * a process-global setting tied to `defaultConfig`.
 */
let _maxBatchDrainIterationsGetter: () => number = () => 1000;
export function _setMaxBatchDrainIterationsGetter(getter: () => number): void {
	_maxBatchDrainIterationsGetter = getter;
}

let batchDepth = 0;
let flushInProgress = false;

/** Tier 3 (DATA/RESOLVED) + tier 4 (INVALIDATE) deferral queue — settle slice, drained first. */
const drainPhase2: Array<() => void> = [];
/** Tier 5 (COMPLETE/ERROR) deferral queue — drained after the settle slice. */
const drainPhase3: Array<() => void> = [];
/** Tier 6 (TEARDOWN) deferral queue — drained last. */
const drainPhase4: Array<() => void> = [];

/**
 * Per-batch flush hooks. Each hook is registered by a node the first time
 * it accumulates an emission inside an explicit `batch()` scope (Bug 2 —
 * per-node emit coalescing). Hooks fire at the head of `drainPending`,
 * before the standard tier-3/4/5 drain queues — they call `downWithBatch`
 * with the node's accumulated multi-message batch, which enqueues the
 * tier-3+ portion into `drainPhase2/3/4` for the standard loop.
 *
 * On a `batch()` throw, hooks still fire so each node clears its pending
 * state (they're idempotent — the side-effects are wiped because the
 * drainPhase queues that they enqueue into are cleared in the same finally
 * block).
 */
const flushHooks: Array<() => void> = [];

/**
 * Returns whether the current call stack is inside a batch scope **or** while
 * a deferred drain is in progress. Nested `downWithBatch` calls during drain
 * still defer (they bump the drain loop).
 */
export function isBatching(): boolean {
	return batchDepth > 0 || flushInProgress;
}

/**
 * Returns whether the current call stack is inside an **explicit** `batch()`
 * scope. Excludes `flushInProgress` — i.e. emissions that happen during a
 * drain (e.g. inside a fn callback) are NOT explicitly batched and should
 * not trigger per-node coalescing (Bug 2).
 */
export function isExplicitlyBatching(): boolean {
	return batchDepth > 0;
}

/**
 * Register a hook to fire at the head of the next `drainPending`. Used by
 * `NodeImpl._emit` to flush its per-batch accumulator (Bug 2). If called
 * outside an explicit batch the hook fires immediately, since there's no
 * drain coming.
 */
export function registerBatchFlushHook(hook: () => void): void {
	if (batchDepth > 0) {
		flushHooks.push(hook);
	} else {
		hook();
	}
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
					// Fire any per-node flush hooks so nodes clear their
					// pending state. The downWithBatch calls those hooks
					// make enqueue into drainPhase queues — those queues
					// are cleared right after, so the side-effects are
					// wiped. Net result: clean node state, no delivery.
					const hooks = flushHooks.splice(0);
					for (const h of hooks) {
						try {
							h();
						} catch {
							/* best-effort */
						}
					}
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
		// Loop while EITHER tier-3+ deferred work OR pending flush hooks exist.
		// Hooks can be re-registered mid-drain by reentrant `batch()` calls
		// inside subscriber callbacks; checking `flushHooks` each iteration
		// (not just before the loop) ensures those late hooks fire too.
		while (
			drainPhase2.length > 0 ||
			drainPhase3.length > 0 ||
			drainPhase4.length > 0 ||
			(ownsFlush && flushHooks.length > 0)
		) {
			// Fire any pending flush hooks FIRST so their downWithBatch calls
			// enqueue tier-3+ work into drainPhase before we process it.
			if (ownsFlush && flushHooks.length > 0) {
				const hooks = flushHooks.splice(0);
				for (const h of hooks) {
					try {
						h();
					} catch (e) {
						errors.push(e);
					}
				}
				continue; // restart loop — hooks may have enqueued tier-3+ work or more hooks
			}
			iterations += 1;
			const maxIterations = _maxBatchDrainIterationsGetter();
			if (iterations > maxIterations) {
				// Lock 2.F′ broadens the diagnostic: capture which phase queue
				// is non-empty + total queued size at throw + the configured
				// limit so callers tracking down a reactive cycle see what
				// queue is unbounded.
				const phase = drainPhase2.length > 0 ? 2 : drainPhase3.length > 0 ? 3 : 4;
				const queueSizeAtThrow = drainPhase2.length + drainPhase3.length + drainPhase4.length;
				drainPhase2.length = 0;
				drainPhase3.length = 0;
				drainPhase4.length = 0;
				const err = new Error(
					`batch drain exceeded cfg.maxBatchDrainIterations (${maxIterations}) at phase ${phase} — likely a reactive cycle`,
				);
				(err as Error & { detail?: unknown }).detail = {
					phase,
					queueSizeAtThrow,
					configuredLimit: maxIterations,
				};
				throw err;
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
 * Behavior (post-DS-13.5.A tier renumbering):
 * - Tier 0–2 — delivered synchronously.
 * - Tier 3 (DATA/RESOLVED) — deferred to {@link drainPhase2} when batching.
 * - Tier 4 (INVALIDATE) — deferred to {@link drainPhase2} alongside the value
 *   settlements (the "settle slice" — INVALIDATE settles a wave so it must
 *   land in the same drain phase as DATA/RESOLVED).
 * - Tier 5 (COMPLETE/ERROR) — deferred to {@link drainPhase3} when batching.
 * - Tier 6 (TEARDOWN) — deferred to {@link drainPhase4} when batching.
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
		// tier 3 (DATA/RESOLVED) and tier 4 (INVALIDATE) share drainPhase2 —
		// one settle slice. tier 5 → drainPhase3 (terminal). tier ≥ 6 → drainPhase4 (TEARDOWN).
		const queue = tier >= 6 ? drainPhase4 : tier === 5 ? drainPhase3 : drainPhase2;
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
	// Phase 2 (settle slice): tier 3 DATA/RESOLVED + tier 4 INVALIDATE.
	while (i < n && tierOf(messages[i][0]) <= 4) i++;
	phase3Start = i;
	// Phase 3 (terminal): tier 5 COMPLETE/ERROR.
	while (i < n && tierOf(messages[i][0]) === 5) i++;
	phase4Start = i;
	// Anything from phase4Start..n has tier >= 6 (TEARDOWN).

	const batching = isBatching();

	// DS-13.5.A Q16 atomicity: Q16 auto-precedes TEARDOWN with [COMPLETE].
	// Splitting that pair across two sink calls lets fn re-run between them
	// (the dep callback's settlement check sees `_hasNewTerminal=true` after
	// COMPLETE delivery and falls through to `_execFn`, which re-establishes
	// cleanup that then fires again on TEARDOWN). Keep COMPLETE/ERROR +
	// TEARDOWN atomic so the terminal lifecycle pair is observed as one
	// logical wave — applies to both sync delivery and in-batch deferred
	// delivery (push as a single op into the latest phase queue).
	if (phase4Start > phase3Start && n > phase4Start) {
		if (phase2Start > 0) sink(messages.slice(0, phase2Start));
		if (phase3Start > phase2Start) {
			const phase2 = messages.slice(phase2Start, phase3Start);
			if (batching) drainPhase2.push(() => sink(phase2));
			else sink(phase2);
		}
		const terminalAndTeardown = messages.slice(phase3Start, n);
		if (batching) drainPhase4.push(() => sink(terminalAndTeardown));
		else sink(terminalAndTeardown);
		return;
	}

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
