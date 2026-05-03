/**
 * Binding layer — owns the value registry; talks to Core in handles only.
 *
 * In the eventual Rust split, this file's contents become the per-language
 * SDK harness. The Core (above) compiles to Rust; this layer stays in TS
 * (and a parallel Python version stays in Python). The boundary is the
 * `BindingBoundary` interface in core.ts.
 *
 * Key discipline: the value registry uses `WeakMap<object, HandleId>` for
 * objects, ensuring that the same JS object always gets the same HandleId.
 * This is what makes `equals: 'identity'` work correctly at the Core level
 * without ever crossing the boundary on the hot path.
 *
 * Primitives are deduped via a `Map<primitive, HandleId>` so `intern(42)`
 * twice returns the same handle. Optional but recommended for the same
 * identity-equals correctness reason.
 */

import {
	type BindingBoundary,
	Core,
	DATA,
	type FnId,
	type FnResult,
	type HandleId,
	type Message,
	NO_HANDLE,
	type NodeId,
} from "./core.js";

// ---------------------------------------------------------------------------
// Value registry — what lives on the binding side, NOT the Core side
// ---------------------------------------------------------------------------

class ValueRegistry {
	private nextHandle = 1;
	private readonly handleToValue = new Map<HandleId, unknown>();
	/** Object-identity dedup: same JS object → same HandleId. */
	private readonly valueToHandle = new WeakMap<object, HandleId>();
	/** Primitive dedup. */
	private readonly primitiveToHandle = new Map<unknown, HandleId>();
	/** Refcount per handle — released when count hits 0. */
	private readonly refcounts = new Map<HandleId, number>();

	intern(value: unknown): HandleId {
		// Dedup: same value should yield same handle so `equals: identity`
		// works. WeakMap for objects (so we don't pin them); Map for
		// primitives (cheap, primitives don't leak).
		if (value === undefined) {
			throw new Error("undefined is not a valid DATA value (it is SENTINEL)");
		}
		if (typeof value === "object" && value !== null) {
			const existing = this.valueToHandle.get(value);
			if (existing !== undefined) {
				this.refcounts.set(existing, (this.refcounts.get(existing) ?? 0) + 1);
				return existing;
			}
		} else {
			const existing = this.primitiveToHandle.get(value);
			if (existing !== undefined) {
				this.refcounts.set(existing, (this.refcounts.get(existing) ?? 0) + 1);
				return existing;
			}
		}
		const id = this.nextHandle++ as HandleId;
		this.handleToValue.set(id, value);
		if (typeof value === "object" && value !== null) {
			this.valueToHandle.set(value, id);
		} else {
			this.primitiveToHandle.set(value, id);
		}
		this.refcounts.set(id, 1);
		return id;
	}

	deref(handle: HandleId): unknown {
		if (handle === NO_HANDLE) {
			throw new Error("cannot deref NO_HANDLE");
		}
		if (!this.handleToValue.has(handle)) {
			throw new Error(`unknown handle ${handle}`);
		}
		return this.handleToValue.get(handle);
	}

	release(handle: HandleId): void {
		const cur = this.refcounts.get(handle) ?? 0;
		if (cur <= 1) {
			const value = this.handleToValue.get(handle);
			this.handleToValue.delete(handle);
			this.refcounts.delete(handle);
			// WeakMap cleans itself; primitive map needs explicit delete.
			if (value !== undefined && (typeof value !== "object" || value === null)) {
				this.primitiveToHandle.delete(value);
			}
		} else {
			this.refcounts.set(handle, cur - 1);
		}
	}

	/** Test helper: how many handles are live? Detects leaks. */
	liveCount(): number {
		return this.handleToValue.size;
	}

	/** Test helper: full snapshot for diagnostic asserts. */
	snapshot(): { handles: number; refcounts: ReadonlyMap<HandleId, number> } {
		return {
			handles: this.handleToValue.size,
			refcounts: new Map(this.refcounts),
		};
	}
}

// ---------------------------------------------------------------------------
// Fn registry — fnId -> JS callable
// ---------------------------------------------------------------------------

type UserFn = (...args: unknown[]) => unknown;
type CustomEqualsFn = (a: unknown, b: unknown) => boolean;

class FnRegistry {
	private nextId = 1;
	private readonly userFns = new Map<FnId, UserFn>();
	private readonly equalsFns = new Map<FnId, CustomEqualsFn>();

	registerFn(fn: UserFn): FnId {
		const id = this.nextId++ as FnId;
		this.userFns.set(id, fn);
		return id;
	}

	registerEquals(fn: CustomEqualsFn): FnId {
		const id = this.nextId++ as FnId;
		this.equalsFns.set(id, fn);
		return id;
	}

	getUserFn(id: FnId): UserFn {
		const fn = this.userFns.get(id);
		if (!fn) throw new Error(`unknown user fn ${id}`);
		return fn;
	}

	getEqualsFn(id: FnId): CustomEqualsFn {
		const fn = this.equalsFns.get(id);
		if (!fn) throw new Error(`unknown equals fn ${id}`);
		return fn;
	}
}

// ---------------------------------------------------------------------------
// Public API — `state`, `derived`, `subscribe` in handle-protocol terms
// ---------------------------------------------------------------------------

export interface NodeAPI<T> {
	readonly _id: NodeId;
	readonly _phantom: T; // brand for type inference
}

/**
 * Marker interface: fn returns this when it wants to declare which
 * deps it actually tracked this run. Used by `dynamic` nodes only.
 */
interface WithTrackedTag {
	__handleCoreTracked: true;
}

export interface WithTracked<T> extends WithTrackedTag {
	value: T | undefined;
	tracked: ReadonlySet<number>;
}

/**
 * Helper for dynamic-fn return: `tracked(value, [depIdxA, depIdxC])`
 * tells Core "I read deps A and C this run; do not re-fire me when
 * other deps update." Pass `undefined` as value for noop.
 */
export function tracked<T>(value: T | undefined, indices: readonly number[]): WithTracked<T> {
	return {
		__handleCoreTracked: true,
		value,
		tracked: new Set(indices),
	};
}

/**
 * FFI cost counters. Every method on `BindingBoundary` is wrapped to
 * increment its corresponding counter, giving you a per-graph trace of
 * exactly how many boundary crossings occurred. In a Rust-core port,
 * each tick of `invokeFn` and `customEquals` is one FFI call (~0.5–1µs
 * for napi-rs, 2–5µs for PyO3). `releaseHandle` is also a crossing but
 * is amortizable (refcount decrement only).
 *
 * Use this to verify the architectural promise: identity-equals graphs
 * should show ZERO `customEquals` crossings; pure-state graphs without
 * derived chains should show ZERO `invokeFn`.
 */
export interface FfiCounters {
	invokeFn: number;
	customEquals: number;
	releaseHandle: number;
}

export class HandleRuntime {
	private readonly registry = new ValueRegistry();
	private readonly fns = new FnRegistry();
	private readonly core: Core;
	private readonly counters: FfiCounters = {
		invokeFn: 0,
		customEquals: 0,
		releaseHandle: 0,
	};

	constructor() {
		const boundary: BindingBoundary = {
			invokeFn: (_nodeId, fnId, depHandles): FnResult => {
				this.counters.invokeFn++;
				const fn = this.fns.getUserFn(fnId);
				const args = depHandles.map((h) => this.registry.deref(h));
				const out = fn(...args);
				if (out === undefined) {
					return { kind: "noop" };
				}
				// `fn` may return a `WithTracked<T>` sentinel (for dynamic nodes)
				// or a plain value. Detect via prototype tag.
				if (
					typeof out === "object" &&
					out !== null &&
					(out as WithTrackedTag).__handleCoreTracked === true
				) {
					const tagged = out as { value: unknown; tracked: ReadonlySet<number> };
					if (tagged.value === undefined) {
						return { kind: "noop", tracked: tagged.tracked };
					}
					const handle = this.registry.intern(tagged.value);
					return { kind: "data", handle, tracked: tagged.tracked };
				}
				const handle = this.registry.intern(out);
				return { kind: "data", handle };
			},
			customEquals: (equalsHandle, a, b) => {
				this.counters.customEquals++;
				const fn = this.fns.getEqualsFn(equalsHandle);
				return fn(this.registry.deref(a), this.registry.deref(b));
			},
			releaseHandle: (handle) => {
				this.counters.releaseHandle++;
				this.registry.release(handle);
			},
		};
		this.core = new Core(boundary);
	}

	/** Reset FFI counters (e.g. between test phases). */
	resetCounters(): void {
		this.counters.invokeFn = 0;
		this.counters.customEquals = 0;
		this.counters.releaseHandle = 0;
	}

	ffiCounters(): Readonly<FfiCounters> {
		return { ...this.counters };
	}

	state<T>(initial?: T): NodeAPI<T> & {
		set(value: T): void;
		current(): T | undefined;
	} {
		const initialHandle = initial === undefined ? NO_HANDLE : this.registry.intern(initial);
		const id = this.core.registerState(initialHandle);
		return {
			_id: id,
			_phantom: undefined as unknown as T,
			set: (value: T) => {
				const handle = this.registry.intern(value);
				this.core.emit(id, handle);
			},
			current: () => {
				const h = this.core.cacheOf(id);
				if (h === NO_HANDLE) return undefined;
				return this.registry.deref(h) as T;
			},
		};
	}

	derived<T, D extends readonly NodeAPI<unknown>[]>(
		deps: D,
		fn: (...args: { [K in keyof D]: D[K] extends NodeAPI<infer U> ? U : never }) => T,
		opts?: { equals?: "identity" | ((a: T, b: T) => boolean) },
	): NodeAPI<T> & { current(): T | undefined } {
		const fnId = this.fns.registerFn(fn as UserFn);
		const eq =
			opts?.equals && opts.equals !== "identity"
				? {
						kind: "custom" as const,
						handle: this.fns.registerEquals(opts.equals as CustomEqualsFn),
					}
				: { kind: "identity" as const };
		const id = this.core.registerDerived(
			deps.map((d) => d._id),
			fnId,
			eq,
		);
		return {
			_id: id,
			_phantom: undefined as unknown as T,
			current: () => {
				const h = this.core.cacheOf(id);
				if (h === NO_HANDLE) return undefined;
				return this.registry.deref(h) as T;
			},
		};
	}

	/**
	 * Dynamic node — declares a SUPERSET of possible deps; fn returns
	 * `tracked(value, [depIdx, ...])` to declare which subset it actually
	 * read this run. Untracked dep updates do not fire this node's fn.
	 *
	 * Use case: `track`-style operators (rxjs's `switchMap` analogue),
	 * `autoTrackNode` for compat layers, conditional dep selection.
	 *
	 * Boundary cost: same per-fire as static `derived`. The win is
	 * fewer fires per wave under selective-deps patterns.
	 */
	dynamic<T, D extends readonly NodeAPI<unknown>[]>(
		deps: D,
		fn: (
			...args: { [K in keyof D]: D[K] extends NodeAPI<infer U> ? U : never }
		) => WithTracked<T> | T,
	): NodeAPI<T> & { current(): T | undefined } {
		const fnId = this.fns.registerFn(fn as UserFn);
		const id = this.core.registerDynamic(
			deps.map((d) => d._id),
			fnId,
			{ kind: "identity" },
		);
		return {
			_id: id,
			_phantom: undefined as unknown as T,
			current: () => {
				const h = this.core.cacheOf(id);
				if (h === NO_HANDLE) return undefined;
				return this.registry.deref(h) as T;
			},
		};
	}

	subscribe<T>(
		node: NodeAPI<T>,
		sink: (
			event: { tag: "data"; value: T } | { tag: "resolved" } | { tag: "dirty" } | { tag: "start" },
		) => void,
	): () => void {
		const wrapped = (msgs: readonly Message[]) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					sink({ tag: "data", value: this.registry.deref(msg[1]) as T });
				} else if (msg[0] === "DIRTY") {
					sink({ tag: "dirty" });
				} else if (msg[0] === "RESOLVED") {
					sink({ tag: "resolved" });
				} else if (msg[0] === "START") {
					sink({ tag: "start" });
				}
			}
		};
		return this.core.subscribe(node._id, wrapped);
	}

	// Inspection / leak detection — handy for tests
	debug() {
		return {
			liveHandles: this.registry.liveCount(),
			ffi: this.ffiCounters(),
			snapshot: this.registry.snapshot(),
		};
	}
}
