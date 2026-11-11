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
 * the async-pool `ctx.down` re-entry (which enters via the stashed ctx, NOT the public
 * method), and `batch()` (so the drain fires AFTER commit). Re-entrant (nested) calls just
 * inc/dec the counter; only the OUTERMOST exit (depth → 0) DRAINS the deferred-rewire queue.
 *
 * B49 migration: the deferred thunks now live on the graph-local NodeCore, not in this module.
 * This module keeps only the JS call-stack wave-owner depth plus a small FIFO of cores that
 * have work to drain. Per D22, a graph is the supported single-thread domain; cross-domain
 * coordination is the async wire bridge (D32), so the queued work for one legal synchronous cascade
 * belongs to one graph-local core. Standalone nodes keep their private core. Within a core, FIFO
 * issue order still gives the R-rewire-deferred drain order, and the scheduler records one core
 * token per queued task so mixed-core legal batches keep their enqueue order. Each queued mutation
 * runs as a fresh wave whose own `ctx.rewireNext` calls re-enqueue and drain in the same loop.
 *
 * C-25 / D110: queued boundary work is tagged with the batch frame that caused it (when any).
 * The drain applies only committed tasks; rollback drops the batch's tasks. Besides
 * `ctx.rewireNext`, a quiet node's in-run output is queued here (R-wave). Zero behavior change
 * when nothing is queued: the drain is one empty-queue check per outermost wave (F-PERF).
 */

import type { NodeCore } from "../node/core.js";

let depth = 0;
/** A queued task that belongs to no one core (a batch commit touches several). */
interface DirectTask {
	readonly apply: () => void;
}
const pendingCores: Array<NodeCore | DirectTask> = [];
let pendingHead = 0;
/** Requests that run before everything queued (a committing batch's body requests). */
let priority: Array<() => void> = [];

/** @internal D161: construction is allowed only outside a synchronous cascade. */
export function isWaveActive(): boolean {
	return depth !== 0;
}

/** Enter a wave cascade (re-entrant). Pair with {@link exitWave} in a try/finally. */
export function enterWave(): void {
	depth++;
}

/** Exit a wave cascade; the OUTERMOST exit (depth → 0) drains the deferred-rewire queue. */
export function exitWave(): void {
	depth--;
	if (depth === 0 && (priority.length > 0 || pendingHead < pendingCores.length)) drain();
}

/** R-request-order: queue a request that belongs to no one core. */
export function deferDirect(apply: () => void): void {
	pendingCores.push({ apply });
}

/** R-request-order: a committing batch's requests run before anything its commit wave asks for. */
export function deferFirst(ops: ReadonlyArray<() => void>): void {
	priority = [...ops, ...priority];
}

export interface DeferredBoundaryOptions {
	readonly batchToken?: object;
}

/**
 * Queue a deferred self-rewire application, drained at the committed boundary
 * (R-rewire-deferred). The thunk applies one queued mutation to its owning node.
 */
export function deferRewire(
	core: NodeCore,
	apply: () => void,
	options: DeferredBoundaryOptions = {},
): void {
	core.enqueueBoundaryTask({ apply, batchToken: options.batchToken });
	pendingCores.push(core);
}

/** D110: an uncommitted batch cannot leak queued boundary effects. */
export function dropBoundaryTasksForBatch(batchToken: object): void {
	const seen = new Set<NodeCore>();
	for (let i = pendingHead; i < pendingCores.length; i++) {
		const core = pendingCores[i] as NodeCore | DirectTask;
		if ("apply" in core || seen.has(core)) continue;
		seen.add(core);
		core.dropBoundaryTasksForBatch(batchToken);
	}
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
	const run = (apply: () => void, core?: NodeCore): void => {
		depth++;
		try {
			apply();
		} catch (e) {
			// R-request-order: a queued request's caller has returned, so its failure goes to the
			// graph's host reporter; with none, it is re-thrown once the queue is empty.
			const report = core?.report;
			if (report !== undefined) {
				try {
					report({ source: "queued request", error: e });
				} catch {
					// a reporter that throws is ignored
				}
			} else if (escaped === null) escaped = { e };
		} finally {
			depth--;
		}
	};
	while (priority.length > 0 || pendingHead < pendingCores.length) {
		const first = priority.shift();
		if (first !== undefined) {
			run(first);
			continue;
		}
		const entry = pendingCores[pendingHead++] as NodeCore | DirectTask;
		if ("apply" in entry) {
			run(entry.apply);
			continue;
		}
		const task = entry.shiftBoundaryTask();
		if (task === undefined) continue;
		if (task.batchToken !== undefined) {
			// A stale token means the batch never reached the committed boundary (D110). Rollback
			// normally removes these before drain; this guard covers commit failures before the
			// batch frame marks itself committed.
			const committed = (task.batchToken as { committed?: boolean }).committed === true;
			if (!committed) continue;
		}
		run(task.apply, entry);
	}
	pendingCores.length = 0;
	pendingHead = 0;
	if (escaped !== null) throw (escaped as { e: unknown }).e;
}
