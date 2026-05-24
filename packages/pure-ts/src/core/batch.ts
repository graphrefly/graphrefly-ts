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
 * Per-batch hook pairs. Each entry is registered by a node the first time
 * it touches state inside an explicit `batch()` scope. The pair carries
 * both the success-path `flush` (deliver accumulated messages) and the
 * throw-path `rollback` (restore pre-batch state, do NOT deliver).
 *
 * **D282 — R4.3.2 throw rollback (locked 2026-05-23).** On success drain,
 * `flush` is invoked at the head of `drainPending`, before the standard
 * tier-3/4/5 drain queues — it calls `downWithBatch` with the node's
 * accumulated multi-message batch, which enqueues the tier-3+ portion
 * into `drainPhase2/3/4` for the standard loop. On `batch()` throw,
 * `rollback` is invoked INSTEAD of `flush` (the pre-D282 implementation
 * fired `flush` on both paths and relied on a same-finally drainPhase
 * clear — that was unsound because at the catch-path `batchDepth === 0`
 * and `flushInProgress === false`, so the flush's `downWithBatch` call
 * dispatched synchronously, leaking the wave to subscribers; see the
 * 2026-05-22 Slice A revert + the C1 reopen entry in
 * `docs/optimizations.md`).
 *
 * The paired registry converges TS to the Rust substrate's pre-existing
 * `discard_wave_cleanup` + `restore_wave_cache_snapshots` semantic at
 * `graphrefly-rs/crates/graphrefly-core/src/batch.rs:3693`. Subscriber
 * wire shape on throw is now parity-observable (cross-track-ledger §2
 * C1 row).
 *
 * Inner batches inside `flushInProgress` SKIP rollback per
 * cross-language decision A4 — the existing `!flushInProgress` gate in
 * `batch()`'s catch path preserves that.
 */
const batchHooks: Array<{ flush: () => void; rollback: () => void }> = [];

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
 * Register a paired flush/rollback hook for the current batch. Used by
 * `NodeImpl._emit` on first state-touch inside an explicit `batch()` scope.
 *
 * - **Success drain**: `flush` fires at the head of `drainPending` — the
 *   node delivers its accumulated multi-message batch via `downWithBatch`.
 * - **Outermost throw (`batchDepth === 0 && !flushInProgress`)**:
 *   `rollback` fires instead — the node restores cache/status/versioning
 *   from `_preBatchSnapshot` and clears `_batchPendingMessages` WITHOUT
 *   dispatching downstream. R4.3.2.
 * - **Inner throw under `flushInProgress` (A4 carve-out)**: neither
 *   `flush` nor `rollback` fires at the inner-throw boundary — the inner
 *   batch's accumulators stay live; the outer drain's continued loop
 *   will pick up `flush` per the standard success path.
 *
 * Called outside any batch context (defensive — shouldn't happen in
 * practice because `_emit`'s registration is gated on
 * `isExplicitlyBatching()`), `flush` fires immediately since there's no
 * drain coming.
 */
export function registerBatchHook(hook: { flush: () => void; rollback: () => void }): void {
	if (batchDepth > 0) {
		batchHooks.push(hook);
	} else {
		hook.flush();
	}
}

/**
 * Legacy single-hook API for **flush-only** coalescers (external
 * bystanders that aggregate downstream changes — e.g.
 * `graph.observe({ reactive: true })`'s changeset flusher,
 * `describe({ reactive: true })`'s recompute trigger, the topology-emit
 * coalescer). These callers DON'T own per-node pre-batch state, so a
 * throw-rollback path is a no-op for them.
 *
 * Thin shim over {@link registerBatchHook} that pairs the provided
 * `hook` (used as `flush`) with a no-op `rollback`. Net effect on the
 * throw path: nothing fires; the external coalescer's accumulated state
 * stays as-is. Since the coalescer's accumulation is normally driven by
 * a SINK callback on per-node DATA, and per-node DATA was rolled back
 * before this hook would fire, the coalescer's per-call accumulator is
 * typically empty in the rollback scenario anyway — the no-op rollback
 * is the right semantic (no false flush of an empty changeset).
 *
 * @deprecated Use {@link registerBatchHook} for new code so the
 * rollback hook is explicit. Kept for the in-tree graph-level coalescers
 * (`graph.ts` changesets / reactive-describe / reactive-observe /
 * topology-emitter) which are flush-only by design.
 */
export function registerBatchFlushHook(hook: () => void): void {
	registerBatchHook({
		flush: hook,
		rollback: () => {
			/* flush-only coalescer: rollback is a no-op */
		},
	});
}

/**
 * Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral
 * queue. If `fn` throws, deferred work for the outer frame is discarded
 * (unless a drain is already in progress — cross-language decision A4).
 */
export function batch(fn: () => void): void {
	batchDepth += 1;
	let threw = false;
	let userError: unknown;
	try {
		fn();
	} catch (e) {
		threw = true;
		userError = e;
		throw e;
	} finally {
		batchDepth -= 1;
		if (batchDepth === 0) {
			if (threw) {
				if (!flushInProgress) {
					// D282 R4.3.2: fire the per-node ROLLBACK hooks (NOT
					// flush). Each rollback restores the node's pre-batch
					// cache/status/versioning/wave-flags/replayBuffer state
					// from `_preBatchSnapshot` and clears
					// `_batchPendingMessages` without dispatching. The
					// drainPhase queues at this point hold any deferred
					// closures from re-entrant downWithBatch calls during
					// `fn`; clear them too (Rust's `discard_wave_cleanup`
					// drops the analogous `pending_notify`).
					//
					// /qa F6: collect rollback errors and aggregate-throw
					// AFTER the originating user throw re-propagates. A
					// buggy rollback (e.g. a malformed snapshot triggering
					// an exception in `_rollbackBatchPending`) MUST surface
					// — silent best-effort masking was the Slice-A reviewer
					// finding #5 anti-pattern that recurred here pre-/qa.
					// Same shape as `drainPending`'s error-collection (line
					// 264 below).
					const hooks = batchHooks.splice(0);
					const rollbackErrors: unknown[] = [];
					for (const h of hooks) {
						try {
							h.rollback();
						} catch (e) {
							rollbackErrors.push(e);
						}
					}
					drainPhase2.length = 0;
					drainPhase3.length = 0;
					drainPhase4.length = 0;
					if (rollbackErrors.length > 0) {
						// Wrap as a `cause` on the originating user error so
						// the user-throw remains the primary signal (callers
						// `expect.rejects.toThrow(/userError/)` still match).
						// Aggregated rollback errors are inspectable via
						// `(err as Error).cause` per the D4 wrap pattern.
						const cause =
							rollbackErrors.length === 1
								? rollbackErrors[0]
								: new AggregateError(rollbackErrors, "batch rollback: multiple hooks threw");
						if (userError instanceof Error) {
							(userError as Error & { cause?: unknown }).cause = cause;
						} else {
							// Non-Error user throw: log the rollback errors
							// to surface them (best-effort but loud, not
							// silent). The user's throw still propagates as
							// the primary signal.
							console.error("batch rollback hooks threw during throw path:", cause);
						}
					}
				}
				// flushInProgress branch (A4 carve-out): inner-batch throw
				// re-propagates WITHOUT rollback. The inner batch's hook
				// entries stay in `batchHooks` and will fire `flush` on the
				// outer drain's next iteration. This is the "commit-on-
				// outer-success" semantic exercised by Case 11 of the
				// `scenarios/core/batch-throw-rollback.test.ts` parity suite.
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
		// Loop while EITHER tier-3+ deferred work OR pending batch hooks exist.
		// Hooks can be re-registered mid-drain by reentrant `batch()` calls
		// inside subscriber callbacks; checking `batchHooks` each iteration
		// (not just before the loop) ensures those late hooks fire too.
		while (
			drainPhase2.length > 0 ||
			drainPhase3.length > 0 ||
			drainPhase4.length > 0 ||
			(ownsFlush && batchHooks.length > 0)
		) {
			// Fire any pending batch hooks' FLUSH side FIRST so their
			// downWithBatch calls enqueue tier-3+ work into drainPhase
			// before we process it. (Rollback is only fired on the
			// throw path in `batch()`'s catch.)
			if (ownsFlush && batchHooks.length > 0) {
				const hooks = batchHooks.splice(0);
				for (const h of hooks) {
					try {
						h.flush();
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
