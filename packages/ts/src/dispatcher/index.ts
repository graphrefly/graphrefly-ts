/**
 * Dispatcher: one function table, indexed by the pure-data Handle.
 *
 * graphrefly:D807: the runtime keeps one function table with no pool kinds. A node's function
 * has the shape (ctx) => void and is never reentered (R-invocation@2); a ctx.down after it
 * returned starts a later wave (R-wave@2); graphs may share a dispatcher's function table
 * (R-graph-domain@3). `invoke` is uniformly sync void: async or remote work lives in the
 * function body, which starts it and sends its result later through `ctx.down`.
 */

import type { Ctx, NodeFn } from "../ctx/types.js";

/**
 * Handle = the index of a function in the dispatcher's table: pure data, no methods (D7).
 * node != handle. A freed index is reused by a later `register` (B15).
 */
export type Handle = number;

/**
 * Per-handle profiling counters (D39; profiling is the package's own, R-graph-surface). Lives on
 * the dispatcher, where every function is invoked, NEVER on the thin node (R-node-thin).
 */
export interface HandleStat {
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
}

/**
 * First-class dispatcher (D21). Owns the function table; a graph binds to one (default =
 * process-global, D26 — the only global singleton).
 *
 * The table is array-indexed with a free-list (B15). `register` reuses a freed slot before
 * growing the array, so a rewire-heavy graph (a function swap on every rewire, e.g. the
 * higher-order *Map operators) keeps the table bounded to its peak live size instead of leaking a
 * slot and closure per swap. `unregister` tombstones the slot (drops the closure for GC) and
 * offers the index for reuse. Reuse is safe: a graph is one concurrency domain
 * (R-graph-domain@3) and a running function is never reentered (R-invocation@2), so a freed index
 * is never registered again while an invoke of it is in flight. The hot path stays a raw array
 * index (F-PERF).
 *
 * @example
 * ```ts
 * import { Dispatcher } from "@graphrefly/ts/core";
 *
 * const dispatcher = new Dispatcher();
 * ```
 * @category core
 */
export class Dispatcher {
	private fns: (NodeFn | undefined)[] = [];
	private free: number[] = [];

	// opt-in profile recorder (default OFF → zero overhead, F-PERF).
	private _recording = false;
	private _stats = new Map<Handle, HandleStat>();
	private _totalInvokes = 0;

	/** Turn the profile recorder on/off (D39). Off = zero overhead on invoke. */
	setRecording(on: boolean): void {
		this._recording = on;
	}
	/** Reset accumulated profiling counters. */
	clearStats(): void {
		this._stats.clear();
		this._totalInvokes = 0;
	}
	/** Read a handle's accumulated counters (undefined if it never ran while recording). */
	statFor(handle: Handle): HandleStat | undefined {
		return this._stats.get(handle);
	}
	/** Total fn invocations recorded across the dispatcher. */
	get totalInvokes(): number {
		return this._totalInvokes;
	}

	/** Register a fn in the table, returning its Handle (a freed index is reused first). */
	register(fn: NodeFn): Handle {
		const reused = this.free.pop();
		if (reused !== undefined) {
			this.fns[reused] = fn;
			return reused;
		}
		const handle = this.fns.length;
		this.fns.push(fn);
		return handle;
	}

	/**
	 * Release a handle (B15): frees the table slot (closure GC'd, index reusable) and drops any
	 * accumulated profile stat so a reused index never inherits the previous tenant's counters.
	 * Called when replace gives a node a new function (the old handle is dropped after the new one
	 * is registered) and when a node is released. Idempotent. NOT called on deactivate (a node's
	 * handle survives activate↔deactivate and is reused on reactivation).
	 */
	unregister(handle: Handle): void {
		// Drop the stat UNCONDITIONALLY (QA F2.1), not only while recording: if recording was
		// OFF at unregister time the key would linger, and a later register reusing this index
		// (the free-list) would inherit the prior tenant's counters once recording resumes. delete
		// of an absent key is a cheap no-op; unregister is off the hot invoke path (F-PERF intact).
		this._stats.delete(handle);
		if (this.fns[handle] === undefined) return; // already free → idempotent
		this.fns[handle] = undefined; // drop the closure (GC)
		this.free.push(handle); // offer the slot for reuse (bounded growth)
	}

	/**
	 * Uniform sync-void invoke. A live handle always resolves to a fn; a dead or unregistered
	 * handle throws (TypeError — invoking one is a bug, surfaced loudly). The cast keeps the hot
	 * path a raw index with no extra branch (F-PERF).
	 */
	invoke(handle: Handle, ctx: Ctx): void {
		if (!this._recording) {
			(this.fns[handle] as NodeFn)(ctx);
			return;
		}
		this._totalInvokes++;
		const t0 = performance.now();
		try {
			(this.fns[handle] as NodeFn)(ctx);
		} finally {
			const dur = (performance.now() - t0) * 1e6; // ms → ns
			const s = this._stats.get(handle) ?? {
				invokes: 0,
				totalDurationNs: 0,
				lastDurationNs: 0,
			};
			s.invokes++;
			s.lastDurationNs = dur;
			s.totalDurationNs += dur;
			this._stats.set(handle, s);
		}
	}
}

/** The only global singleton (D26). Overridable by passing an explicit dispatcher. */
export const defaultDispatcher = new Dispatcher();
