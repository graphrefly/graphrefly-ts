/**
 * The wave-owner boundary + deferred self-rewire drain (R-rewire-deferred / D47).
 *
 * `ctx.rewireNext` defers a node's OWN dep-set mutation to the COMMITTED wave boundary.
 * The substrate has no such boundary on the raw call stack, so this module establishes one:
 * a module-global re-entrant DEPTH counter — the TS analogue of the Rust `WaveScope` /
 * `with_wave_owner` (graphrefly-rs B25, flagged forward-load-bearing for exactly this). JS is
 * single-threaded and waves are synchronous, so one cascade is on the stack at a time (same
 * rationale as `batch.ts`'s module-global `active`).
 *
 * Every EXTERNAL wave origin brackets its synchronous cascade with {@link enterWave} /
 * {@link exitWave}: `Node.subscribe`/`Node.down`/`Node.up` (activation, state.set, control),
 * the async-pool `ctx.down`/`ctx.up` re-entry (which enters via the stashed ctx, NOT the public
 * method), and `batch()` (so the drain fires AFTER commit). Re-entrant (nested) calls just
 * inc/dec the counter; only the OUTERMOST exit (depth → 0) DRAINS the deferred-rewire queue.
 *
 * A single global FIFO yields the R-rewire-deferred drain order for free: issue order during a
 * synchronous cascade IS causal order (a dep settles before its dependent's fn runs), so
 * global-FIFO == per-node FIFO + causal-node order. Each queued mutation runs as a fresh wave
 * whose own `ctx.rewireNext` calls re-enqueue and drain in the same loop (DrainExactlyOnce).
 *
 * Why a PROCESS-GLOBAL depth+queue is correct (not per-graph/per-dispatcher): per D22 a graph is
 * a single causal/concurrency domain and cross-domain coordination is the ASYNC wire bridge
 * (D32) — which never shares this synchronous call stack. So every thunk enqueued during one
 * synchronous cascade belongs to one causal domain, and the outermost exit that drains it is that
 * domain's committed boundary. This is the same single-threaded-sync basis as the existing
 * module-global `batch.active`. (An UNSANCTIONED in-process cross-graph edge would break this — it
 * is a D22 violation, not a supported topology.)
 *
 * Scope: the drain fires at the EndRun boundary the formal `wave_rewire_deferred.tla` models.
 * The batch/pause drain-timing nuance (drain strictly after commit / final-lock RESUME, and not
 * on a paused view) rides on the boundary being established by `batch()` + the public entries;
 * the finer cross-axis (rewireNext issued inside an open batch / under a held pause lock) is
 * backlog B24 — not modeled here. Zero behavior change when no `ctx.rewireNext` is ever called:
 * the drain is one empty-queue check per outermost wave (F-PERF).
 */

let depth = 0;
const queue: Array<() => void> = [];

/** Enter a wave cascade (re-entrant). Pair with {@link exitWave} in a try/finally. */
export function enterWave(): void {
	depth++;
}

/** Exit a wave cascade; the OUTERMOST exit (depth → 0) drains the deferred-rewire queue. */
export function exitWave(): void {
	depth--;
	if (depth === 0 && queue.length > 0) drain();
}

/**
 * Queue a deferred self-rewire application, drained at the committed boundary
 * (R-rewire-deferred). The thunk applies one queued mutation to its owning node.
 */
export function deferRewire(apply: () => void): void {
	queue.push(apply);
}

function drain(): void {
	// Each applied rewire runs a fresh wave (its own depth-bracketed cascade) which may itself
	// enqueue more rewireNext requests — appended and drained by this same FIFO loop
	// (DrainExactlyOnce). The depth++ around apply() prevents the fresh wave's own outermost
	// exit from re-entering drain (this loop owns the draining). A net-changing op re-issued
	// every boundary (oscillation) is a user-level runaway, like an infinite producer — NOT a
	// substrate-detected error (D47).
	//
	// Per-thunk isolation: a thunk whose application throws (e.g. its _applyRewireNext error-route
	// reaches a throwing external sink) must NOT abandon the rest of the queue — otherwise the
	// stranded thunks would linger in this module-global queue and drain at an unrelated LATER
	// wave boundary (a stale, misattributed rewire). Drain every thunk; re-surface the FIRST
	// escape once the queue is empty so the error stays visible without corrupting the queue.
	let escaped: { e: unknown } | null = null;
	while (queue.length > 0) {
		const apply = queue.shift() as () => void;
		depth++;
		try {
			apply();
		} catch (e) {
			if (escaped === null) escaped = { e };
		} finally {
			depth--;
		}
	}
	if (escaped !== null) throw escaped.e;
}
