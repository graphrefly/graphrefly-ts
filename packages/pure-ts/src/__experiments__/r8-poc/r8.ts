/**
 * R8 variant — fn lives in an external dispatcher pool, indexed by handle.
 * Node holds only `_poolRef = (poolId, handleId)`. Wave invocation is
 * `dispatcher.invoke(poolRef, ...)` which is an array-indexed lookup + call.
 *
 * This is the structural shape the user's R8 model proposes: fn fully
 * decoupled from the graph; pool decides sync/async at the call site.
 */

import { type Actions, type Ctx, type Fn, TinyNode } from "./protocol.js";

// Pool kinds. Only LocalSync is exercised in this PoC — that's the
// hot-path R6 target. LocalAsync etc. measured separately in
// r8-dispatch-overhead.bench.ts.
export type PoolId = number;

type AnyFn = Fn<unknown>;

class LocalSyncPool {
	private fns: AnyFn[] = [];

	register(fn: AnyFn): number {
		const id = this.fns.length;
		this.fns.push(fn);
		return id;
	}

	// Hot path — must compile to array-index + call. No null check on the
	// handle because dispatcher routes only to registered handles.
	invoke(
		handle: number,
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<unknown>,
		ctx: Ctx,
	): void {
		this.fns[handle](batchData, actions, ctx);
	}
}

/**
 * LocalAsyncPool — fn registered here is "deferred-emit" by convention.
 * dispatcher.invoke is still SYNC void; the fn kicks off async work and
 * emits the result later via `actions.emit(v)`. The protocol's
 * `_insideRunWave` flag ensures the late emit pairs DIRTY+DATA correctly.
 *
 * Implementation note: this pool is structurally identical to LocalSyncPool
 * — same fn[] table, same array-index dispatch. The "async" nature lives
 * in the fn's own body, not in the pool's invoke. This validates the R9
 * claim: dispatcher.invoke is uniformly sync; pool kind is a label that
 * documents fn behavior, not a different call mechanism.
 */
class LocalAsyncPool {
	private fns: AnyFn[] = [];

	register(fn: AnyFn): number {
		const id = this.fns.length;
		this.fns.push(fn);
		return id;
	}

	invoke(
		handle: number,
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<unknown>,
		ctx: Ctx,
	): void {
		this.fns[handle](batchData, actions, ctx);
	}
}

/**
 * SimulatedRemotePool — same as LocalAsync structurally, but the registered
 * fn is a "remote stub" that simulates network RTT via setTimeout. Proves
 * the protocol works across an asynchronous boundary that LOOKS like RPC.
 *
 * The user-facing fn passed to `registerRemote` is the sandbox-side logic
 * (what would actually run on the other end). This pool wraps it with a
 * setTimeout to simulate the RTT.
 */
class SimulatedRemotePool {
	private fns: AnyFn[] = [];
	rttMs: number;

	constructor(rttMs = 5) {
		this.rttMs = rttMs;
	}

	registerRemote<T>(
		sandboxFn: (
			batchData: ReadonlyArray<unknown[] | null>,
			ctx: Ctx,
		) => T,
	): number {
		const id = this.fns.length;
		const wrapper: AnyFn = (batchData, actions, ctx) => {
			// Simulate sending request → wait RTT → result comes back.
			// Two setTimeouts mimic the two legs of a real RPC.
			setTimeout(() => {
				const result = sandboxFn(batchData, ctx);
				actions.emit(result);
			}, this.rttMs);
		};
		this.fns.push(wrapper);
		return id;
	}

	invoke(
		handle: number,
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<unknown>,
		ctx: Ctx,
	): void {
		this.fns[handle](batchData, actions, ctx);
	}
}

export type PoolKind = "sync" | "async" | "remote";

export class Dispatcher {
	private localSyncPools: LocalSyncPool[] = [new LocalSyncPool()];
	private localAsyncPools: LocalAsyncPool[] = [new LocalAsyncPool()];
	private remotePools: SimulatedRemotePool[] = [new SimulatedRemotePool(5)];

	pool(id: PoolId = 0): LocalSyncPool {
		return this.localSyncPools[id];
	}

	asyncPool(id: PoolId = 0): LocalAsyncPool {
		return this.localAsyncPools[id];
	}

	remotePool(id: PoolId = 0): SimulatedRemotePool {
		return this.remotePools[id];
	}

	// Single uniform sync invoke entry point — routes by pool kind.
	invokeRouted(
		kind: PoolKind,
		poolId: PoolId,
		handle: number,
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<unknown>,
		ctx: Ctx,
	): void {
		switch (kind) {
			case "sync":
				this.localSyncPools[poolId].invoke(handle, batchData, actions, ctx);
				return;
			case "async":
				this.localAsyncPools[poolId].invoke(handle, batchData, actions, ctx);
				return;
			case "remote":
				this.remotePools[poolId].invoke(handle, batchData, actions, ctx);
				return;
		}
	}
}

// Shared dispatcher for the bench (matches the "global dispatcher per Impl"
// shape the eventual design would take).
export const dispatcher = new Dispatcher();

type PoolRef = { kind: PoolKind; poolId: PoolId; handle: number };

export class R8Node<T> extends TinyNode<T> {
	private _poolRef: PoolRef | null;

	constructor(deps: TinyNode<unknown>[], fn?: Fn<T>, initial?: T) {
		super(deps);
		if (fn !== undefined) {
			const handle = dispatcher.pool(0).register(fn as AnyFn);
			this._poolRef = { kind: "sync", poolId: 0, handle };
		} else {
			this._poolRef = null;
		}
		if (initial !== undefined) {
			this._hasData = true;
			this._cache = initial;
		}
	}

	protected _invokeFn(
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<T>,
		ctx: Ctx,
	): void {
		const ref = this._poolRef;
		if (ref !== null) {
			dispatcher.invokeRouted(
				ref.kind,
				ref.poolId,
				ref.handle,
				batchData,
				actions as Actions<unknown>,
				ctx,
			);
		}
	}
}

export function r8Node<T>(deps: TinyNode<unknown>[], fn?: Fn<T>, initial?: T): R8Node<T> {
	return new R8Node(deps, fn, initial);
}

/**
 * Async-pool variant — fn is registered in LocalAsyncPool. The fn body is
 * expected to start async work and call actions.emit(v) when done.
 */
export class R8AsyncNode<T> extends TinyNode<T> {
	private _poolRef: PoolRef;

	constructor(deps: TinyNode<unknown>[], fn: Fn<T>) {
		super(deps);
		const handle = dispatcher.asyncPool(0).register(fn as AnyFn);
		this._poolRef = { kind: "async", poolId: 0, handle };
	}

	protected _invokeFn(
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<T>,
		ctx: Ctx,
	): void {
		dispatcher.invokeRouted(
			this._poolRef.kind,
			this._poolRef.poolId,
			this._poolRef.handle,
			batchData,
			actions as Actions<unknown>,
			ctx,
		);
	}
}

export function r8AsyncNode<T>(deps: TinyNode<unknown>[], fn: Fn<T>): R8AsyncNode<T> {
	return new R8AsyncNode(deps, fn);
}

/**
 * Remote-pool variant — fn is registered as a "sandbox-side" pure transform
 * (batchData + ctx → result). The remote pool wraps it with a simulated RTT.
 * User-facing API never deals with the wire — just registers what would run
 * on the other side.
 */
export class R8RemoteNode<T> extends TinyNode<T> {
	private _poolRef: PoolRef;

	constructor(
		deps: TinyNode<unknown>[],
		sandboxFn: (
			batchData: ReadonlyArray<unknown[] | null>,
			ctx: Ctx,
		) => T,
	) {
		super(deps);
		const handle = dispatcher.remotePool(0).registerRemote(sandboxFn);
		this._poolRef = { kind: "remote", poolId: 0, handle };
	}

	protected _invokeFn(
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<T>,
		ctx: Ctx,
	): void {
		dispatcher.invokeRouted(
			this._poolRef.kind,
			this._poolRef.poolId,
			this._poolRef.handle,
			batchData,
			actions as Actions<unknown>,
			ctx,
		);
	}
}

export function r8RemoteNode<T>(
	deps: TinyNode<unknown>[],
	sandboxFn: (
		batchData: ReadonlyArray<unknown[] | null>,
		ctx: Ctx,
	) => T,
): R8RemoteNode<T> {
	return new R8RemoteNode(deps, sandboxFn);
}
