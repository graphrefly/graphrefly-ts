/**
 * Dispatcher, pools, and the pure-data Handle.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-handle (D7), R-dispatch-all (D21), R-sync-core (D20/D21).
 *
 * Lifted from the validated retired handle-dispatch PoC (R8/R9):
 * fn lives in an external pool, indexed by handle; `dispatcher.invoke` is uniformly
 * SYNC void — async/remote behavior lives in the fn body (it kicks off async work
 * and emits later via `ctx.down`), not in a different call mechanism.
 */

import type { Ctx, NodeFn } from "../ctx/types.js";

/** A pool kind label. LocalSync + LocalAsync ship in 1.0 (D20). */
export type PoolKind = "sync" | "async";

/**
 * Handle = pure data `(poolId, handleId)`, NO methods (R-handle / D7). A serializable
 * index into a pool's dispatch table. node != handle.
 */
export interface Handle {
	readonly poolId: number;
	readonly handleId: number;
}

/** A dispatch pool: a flat fn table + an array-indexed sync invoke. */
export interface Pool {
	readonly kind: PoolKind;
	register(fn: NodeFn): number;
	/** Free a handle's slot so its fn closure is GC'd and the id is reused (B15). */
	unregister(handleId: number): void;
	invoke(handleId: number, ctx: Ctx): void;
}

/**
 * Array-indexed fn table with a free-list (B15). `register` reuses a freed slot before
 * growing the array, so a rewire-heavy graph (fn-swap on every replaceDeps/subscribeDep/unsubscribeDep,
 * e.g. CSP-2.7 higher-order *Map operators) keeps the table bounded to its peak live size
 * instead of leaking a slot + closure per swap. `unregister` tombstones the slot (drops the
 * closure reference for GC) and offers the id for reuse. handleId reuse is safe: the graph is
 * a single causal domain (D22) and D37 forbids a fn rewiring its own handle mid-run, so a
 * freed id is never re-registered while an invoke of it is in flight. The hot path stays a
 * raw array index (F-PERF).
 */
class PoolTable implements Pool {
	constructor(readonly kind: PoolKind) {}
	private fns: (NodeFn | undefined)[] = [];
	private free: number[] = [];
	register(fn: NodeFn): number {
		const reused = this.free.pop();
		if (reused !== undefined) {
			this.fns[reused] = fn;
			return reused;
		}
		const id = this.fns.length;
		this.fns.push(fn);
		return id;
	}
	unregister(handleId: number): void {
		if (this.fns[handleId] === undefined) return; // already free → idempotent
		this.fns[handleId] = undefined; // drop the closure (GC)
		this.free.push(handleId); // offer the slot for reuse (bounded growth)
	}
	invoke(handleId: number, ctx: Ctx): void {
		// A live handle always resolves to a fn; a dead/unregistered id throws (TypeError —
		// invoking an unregistered handle is a bug, surfaced loudly). Cast keeps the hot path
		// a raw index with no extra branch (F-PERF).
		(this.fns[handleId] as NodeFn)(ctx);
	}
}

/**
 * First-class dispatcher (D21). Owns pools; graph binds to one (default = process-global,
 * D26 — the only global singleton). Pool trait is pluggable for WorkerPool/RemotePool (D20).
 */
/** Per-handle profiling counters (D39 / R-profile). Lives on the dispatcher — the invoke
 * funnel (F-DISPATCH-ALL) — NEVER on the thin node (R-node-thin). */
export interface HandleStat {
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
}

const statKey = (h: Handle): string => `${h.poolId}:${h.handleId}`;

export class Dispatcher {
	private pools: Pool[] = [];
	readonly syncPoolId: number;
	readonly asyncPoolId: number;

	// opt-in profile recorder (default OFF → zero overhead, F-PERF).
	private _recording = false;
	private _stats = new Map<string, HandleStat>();
	private _totalInvokes = 0;

	constructor() {
		this.syncPoolId = this.addPool(new PoolTable("sync"));
		this.asyncPoolId = this.addPool(new PoolTable("async"));
	}

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
		return this._stats.get(statKey(handle));
	}
	/** Total fn invocations recorded across the dispatcher. */
	get totalInvokes(): number {
		return this._totalInvokes;
	}

	addPool(pool: Pool): number {
		const id = this.pools.length;
		this.pools.push(pool);
		return id;
	}

	/** Register a fn in a pool, returning its Handle. Default pool = sync (R-sync-core). */
	register(fn: NodeFn, pool: PoolKind | number = "sync"): Handle {
		const poolId = pool === "sync" ? this.syncPoolId : pool === "async" ? this.asyncPoolId : pool;
		const handleId = this.pools[poolId].register(fn);
		return { poolId, handleId };
	}

	/**
	 * Release a handle (B15): frees the pool slot (closure GC'd, id reusable) and drops any
	 * accumulated profile stat so a reused id never inherits the previous tenant's counters.
	 * Called on rewire fn-swap (node._rewire) — the old handle is dropped before the node
	 * adopts the new one. Idempotent. NOT called on deactivate (a node's handle survives
	 * activate↔deactivate and is reused on reactivation; only a rewire swaps it).
	 */
	unregister(handle: Handle): void {
		this.pools[handle.poolId].unregister(handle.handleId);
		// Drop the stat UNCONDITIONALLY (QA F2.1), not only while recording: if recording was
		// OFF at unregister time the key would linger, and a later register reusing this id (the
		// free-list) would inherit the prior tenant's counters once recording resumes. delete of
		// an absent key is a cheap no-op; unregister is off the hot invoke path (F-PERF intact).
		this._stats.delete(statKey(handle));
	}

	/** Uniform sync-void invoke (R-sync-core / R-dispatch-all). */
	invoke(handle: Handle, ctx: Ctx): void {
		if (!this._recording) {
			this.pools[handle.poolId].invoke(handle.handleId, ctx);
			return;
		}
		this._totalInvokes++;
		const t0 = performance.now();
		try {
			this.pools[handle.poolId].invoke(handle.handleId, ctx);
		} finally {
			const dur = (performance.now() - t0) * 1e6; // ms → ns
			const key = statKey(handle);
			const s = this._stats.get(key) ?? {
				invokes: 0,
				totalDurationNs: 0,
				lastDurationNs: 0,
			};
			s.invokes++;
			s.lastDurationNs = dur;
			s.totalDurationNs += dur;
			this._stats.set(key, s);
		}
	}

	poolKind(poolId: number): PoolKind {
		return this.pools[poolId].kind;
	}
}

/** The only global singleton (D26). Overridable by passing an explicit dispatcher. */
export const defaultDispatcher = new Dispatcher();
