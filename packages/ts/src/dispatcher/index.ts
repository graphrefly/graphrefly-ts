/**
 * Dispatcher, pools, and the pure-data Handle.
 *
 * Canonical authority: ~/src/graphrefly/spec/rules.jsonl
 *   R-handle (D7), R-dispatch-all (D21), R-sync-core (D20/D21).
 *
 * Lifted from the validated handle-dispatch PoC (packages/pure-ts r8-poc, R8/R9):
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
	invoke(handleId: number, ctx: Ctx): void;
}

class LocalSyncPool implements Pool {
	readonly kind = "sync" as const;
	private fns: NodeFn[] = [];
	register(fn: NodeFn): number {
		const id = this.fns.length;
		this.fns.push(fn);
		return id;
	}
	invoke(handleId: number, ctx: Ctx): void {
		this.fns[handleId](ctx);
	}
}

/**
 * Structurally identical to LocalSync (R9): the "async" nature lives in the fn body,
 * not the pool's invoke. The label informs ctx lifecycle (per-invocation ctx, L3-Q5)
 * at the node, not a different dispatch path.
 */
class LocalAsyncPool implements Pool {
	readonly kind = "async" as const;
	private fns: NodeFn[] = [];
	register(fn: NodeFn): number {
		const id = this.fns.length;
		this.fns.push(fn);
		return id;
	}
	invoke(handleId: number, ctx: Ctx): void {
		this.fns[handleId](ctx);
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
		this.syncPoolId = this.addPool(new LocalSyncPool());
		this.asyncPoolId = this.addPool(new LocalAsyncPool());
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
