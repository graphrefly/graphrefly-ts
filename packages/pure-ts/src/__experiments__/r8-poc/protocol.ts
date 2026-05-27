/**
 * R8 PoC — minimal reactive protocol with abstract fn invocation.
 *
 * The protocol matches pure-ts's hot path (DIRTY/DATA two-phase wave; fan-in
 * counter for diamond resolution; push-on-subscribe for cached state). Only
 * the fn-invocation step is left abstract — subclasses decide whether the
 * fn is a member field (Baseline) or looked up in an external dispatcher
 * pool by handle (R8).
 *
 * Apples-to-apples bench: same protocol code path, only fn dispatch differs.
 *
 * Out of scope (irrelevant to R8 dispatch cost):
 *   - RESOLVED / INVALIDATE messages
 *   - PAUSE / RESUME locks
 *   - equals-substitution short-circuits
 *   - Producers, effects, ERROR/COMPLETE
 *   - batch() (handled by callers if needed)
 *   - dynamic deps / autoTrack
 */

export type DataMsg<T = unknown> = readonly ["DATA", T];
export type DirtyMsg = readonly ["DIRTY"];
export type Message<T = unknown> = DirtyMsg | DataMsg<T>;

export type Sink<T = unknown> = (msg: Message<T>) => void;

export type Actions<T> = {
	emit(v: T): void;
};

export type Ctx = {
	prevData: readonly unknown[];
};

export type Fn<T> = (
	batchData: ReadonlyArray<unknown[] | null>,
	actions: Actions<T>,
	ctx: Ctx,
) => void;

/** Sentinel for "this dep hasn't emitted DATA yet". */
const NO_DATA = Symbol("NO_DATA");

export abstract class TinyNode<T> {
	protected _deps: TinyNode<unknown>[];
	protected _subscribers: Sink<T>[] = [];
	protected _depData: unknown[];
	protected _depPrevData: unknown[];
	protected _depDirtyFlags: boolean[];
	protected _depPendingCount = 0;
	protected _emittedDirtyThisWave = false;
	protected _insideRunWave = false;
	_hasData = false;
	_cache: T | undefined;

	constructor(deps: TinyNode<unknown>[]) {
		this._deps = deps;
		this._depData = deps.map(() => NO_DATA as unknown);
		this._depPrevData = deps.map(() => NO_DATA as unknown);
		this._depDirtyFlags = deps.map(() => false);

		// Wire ourselves as subscribers to each dep, capturing dep index.
		for (let i = 0; i < deps.length; i++) {
			const idx = i;
			deps[i]._subscribers.push((msg) => this._receiveFromDep(idx, msg));
			// Seed initial value if dep already has cached data.
			if (deps[i]._hasData) {
				this._depData[idx] = deps[i]._cache;
				this._depPrevData[idx] = deps[i]._cache;
			}
		}
	}

	/** Subclass-defined fn invocation — the one variation that R8 tests. */
	protected abstract _invokeFn(
		batchData: ReadonlyArray<unknown[] | null>,
		actions: Actions<T>,
		ctx: Ctx,
	): void;

	/** Wave receive from upstream dep. */
	private _receiveFromDep(idx: number, msg: Message): void {
		if (msg[0] === "DIRTY") {
			if (!this._depDirtyFlags[idx]) {
				this._depDirtyFlags[idx] = true;
				this._depPendingCount++;
				// Propagate DIRTY downstream exactly once per wave.
				if (!this._emittedDirtyThisWave) {
					this._emittedDirtyThisWave = true;
					this._emitDirty();
				}
			}
		} else {
			// DATA
			this._depData[idx] = msg[1];
			if (this._depDirtyFlags[idx]) {
				this._depDirtyFlags[idx] = false;
				this._depPendingCount--;
				if (this._depPendingCount === 0) {
					this._runWave();
				}
			}
		}
	}

	private _runWave(): void {
		const actions: Actions<T> = {
			emit: (v: T) => {
				// If actions.emit is called AFTER _runWave returned (i.e. from
				// an async fn's deferred callback), our subscribers have already
				// cleared the DIRTY from this wave (we emitted DIRTY at wave start,
				// but never DATA in time). So we need to re-DIRTY them before the
				// DATA so the (DIRTY, DATA) pair is well-formed. When called
				// synchronously inside fn, _insideRunWave is true → DIRTY already
				// in flight, skip.
				if (!this._insideRunWave) {
					this._emitDirty();
				}
				this._hasData = true;
				this._cache = v;
				this._emitData(v);
			},
		};
		const ctx: Ctx = { prevData: this._depPrevData };
		// batchData shape mirrors pure-ts's Array<batch | null>: a non-null
		// single-element array signals "fresh DATA this wave for that dep."
		const batchData: ReadonlyArray<unknown[] | null> = this._depData.map((v) =>
			v === NO_DATA ? null : [v],
		);
		this._insideRunWave = true;
		this._invokeFn(batchData, actions, ctx);
		this._insideRunWave = false;

		// Roll prevData forward. Reset wave-local flags.
		for (let i = 0; i < this._depData.length; i++) {
			this._depPrevData[i] = this._depData[i];
		}
		this._emittedDirtyThisWave = false;
	}

	private _emitDirty(): void {
		const subs = this._subscribers;
		const msg: DirtyMsg = ["DIRTY"];
		for (let i = 0; i < subs.length; i++) subs[i](msg);
	}

	private _emitData(v: T): void {
		const subs = this._subscribers;
		const msg: DataMsg<T> = ["DATA", v];
		for (let i = 0; i < subs.length; i++) subs[i](msg);
	}

	/** State-like external push: emit DIRTY then DATA in one tick. */
	pushExternal(v: T): void {
		this._hasData = true;
		this._cache = v;
		this._emitDirty();
		this._emitData(v);
		this._emittedDirtyThisWave = false;
	}

	subscribe(cb: Sink<T>): () => void {
		this._subscribers.push(cb);
		// Push-on-subscribe for cached data.
		if (this._hasData) {
			cb(["DATA", this._cache as T]);
		}
		return () => {
			const i = this._subscribers.indexOf(cb);
			if (i >= 0) this._subscribers.splice(i, 1);
		};
	}

	get cache(): T | undefined {
		return this._cache;
	}
}
