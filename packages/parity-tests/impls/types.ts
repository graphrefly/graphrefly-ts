/**
 * The narrow public surface a parity scenario uses, parameterized over impls.
 *
 * **Phase E (D077) — async-everywhere.** All methods that touch the
 * dispatcher are `Promise`-returning so the napi-rs Rust impl (which
 * runs Core on a tokio blocking-pool thread per D070) can satisfy the
 * same interface as the synchronous TS legacy impl. The legacy impl
 * wraps each sync method in `async` (negligible Promise.resolve
 * overhead); the rust impl exposes its napi async methods directly.
 *
 * Sink-completion semantics: any method that triggers Core dispatch
 * (`subscribe`, `down`, lifecycle ops, signal broadcast) resolves AFTER
 * the wave drains AND all sinks have fired. So `await x.subscribe(cb)`
 * followed by `expect(seen).toContain(...)` is correct — the subscribe
 * handshake's sink callback has completed by the time the Promise
 * resolves.
 */

import type * as legacy from "@graphrefly/legacy-pure-ts";

/** Tier symbol; one of DATA / RESOLVED / DIRTY / INVALIDATE / PAUSE / RESUME / COMPLETE / ERROR / TEARDOWN. */
export type Tier = symbol;

/** A single protocol message: tier symbol + optional payload(s). */
export type Message<T = unknown> =
	| readonly [Tier]
	| readonly [Tier, T]
	| readonly [Tier, ...unknown[]];

/** Unsubscribe handle returned from `subscribe`. Awaiting it ensures
 * any in-flight Core lifecycle work (e.g., `_deactivate` on last-sink-
 * drop) completes before the test moves on. */
export type UnsubFn = () => Promise<void>;

/** Sink callback. Receives a batch of messages per Core flush. */
export type SinkFn<T> = (msgs: ReadonlyArray<Message<T>>) => void;

/** Per-impl Node wrapper. The legacy impl wraps `legacy.Node`; the rust
 * impl wraps `(BenchCore, NodeId, JSValueRegistry)`. */
export interface ImplNode<T> {
	/** Subscribe a sink. Promise resolves after the handshake's sink
	 * callback has completed (so `seen.toContain(initial)` works
	 * synchronously after `await`). */
	subscribe(cb: SinkFn<T>): Promise<UnsubFn>;
	/** Emit a batch of messages. Promise resolves after the wave drains
	 * AND all subscribed sinks have fired. */
	down(msgs: ReadonlyArray<Message<T>>): Promise<void>;
	/** Read the current cached value. Sync — both impls maintain a JS-
	 * side cache mirror updated by an internal shadow sink (so
	 * unsubscribed nodes still cache). Returns `undefined` for sentinel
	 * cache. */
	readonly cache: T | undefined;

	complete(): Promise<void>;
	error(value: T): Promise<void>;
	invalidate(): Promise<void>;
	teardown(): Promise<void>;
	pause(lockId: number): Promise<void>;
	resume(lockId: number): Promise<{ replayed: number; dropped: number } | null>;
	allocLockId(): Promise<number>;
	setResubscribable(value: boolean): Promise<void>;
	hasFiredOnce(): Promise<boolean>;

	/** The underlying primitive Node (legacy) or NodeId (rust). Used by
	 * Graph.add and operator factories that consume nodes by reference.
	 * Tests should treat this as opaque. */
	readonly inner: unknown;
}

/** Per-impl Graph wrapper. Methods are async to match the napi shape.
 *
 * Surface scoped to what parity scenarios under
 * `scenarios/graph/` actually use; introspection helpers like
 * `nodeNames` / `childNames` are out of scope for this slice (legacy
 * doesn't expose them as public accessors and no scenarios reference
 * them). */
export interface ImplGraph {
	tryResolve(path: string): ImplNode<unknown> | undefined;
	nameOf(node: ImplNode<unknown>): string | undefined;

	/** `state(name, initial?)` — register a state node under `name`. */
	state<T>(name: string, initial?: T): Promise<ImplNode<T>>;
	/** `derived(name, deps, fn)` — fn shape mirrors legacy `Node`'s
	 * derived-fn: `(data: T[][]) => T[]` returning a Vec of emissions
	 * for this fire (most fns return a single `[value]`). */
	derived<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>>;
	dynamic<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>>;
	add<T>(name: string, node: ImplNode<T>): Promise<ImplNode<T>>;

	set(name: string, value: unknown): Promise<void>;
	get(name: string): Promise<unknown>;
	invalidate(name: string): Promise<void>;
	complete(name: string): Promise<void>;
	error(name: string, value: unknown): Promise<void>;
	remove(name: string): Promise<{ nodeCount: number; mountCount: number }>;

	/** `signal(messages)` — broadcast a message batch to every named
	 * node in this graph + recursively into mounted children. JS adapter
	 * decomposes the batch into per-message Core ops. */
	signal(messages: ReadonlyArray<Message>): Promise<void>;

	mount(name: string, child?: ImplGraph): Promise<ImplGraph>;
	unmount(name: string): Promise<{ nodeCount: number; mountCount: number }>;
	destroy(): Promise<void>;

	/** Static edges snapshot — `[from_path, to_path][]`. */
	edges(opts?: { recursive?: boolean }): Array<[string, string]>;
	/** JSON-serialized describe snapshot. */
	describe(): unknown;
}

/** The cross-impl surface. */
export interface Impl {
	readonly name: string;

	// Tier symbols — protocol identifiers (per D066, both impls share
	// legacy's symbols; rust re-exports them).
	readonly DATA: typeof legacy.DATA;
	readonly RESOLVED: typeof legacy.RESOLVED;
	readonly DIRTY: typeof legacy.DIRTY;
	readonly INVALIDATE: typeof legacy.INVALIDATE;
	readonly PAUSE: typeof legacy.PAUSE;
	readonly RESUME: typeof legacy.RESUME;
	readonly COMPLETE: typeof legacy.COMPLETE;
	readonly ERROR: typeof legacy.ERROR;
	readonly TEARDOWN: typeof legacy.TEARDOWN;

	// Standalone state factory.
	node<T>(
		deps: ReadonlyArray<ImplNode<unknown>>,
		opts?: { initial?: T; name?: string },
	): Promise<ImplNode<T>>;

	// Graph constructor.
	Graph: new (
		name: string,
	) => ImplGraph;

	// Transform operators.
	map<T, U>(src: ImplNode<T>, fn: (x: T) => U): Promise<ImplNode<U>>;
	filter<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>>;
	scan<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>>;
	reduce<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>>;
	distinctUntilChanged<T>(src: ImplNode<T>, equals?: (a: T, b: T) => boolean): Promise<ImplNode<T>>;
	pairwise<T>(src: ImplNode<T>): Promise<ImplNode<[T, T]>>;

	// Combinators.
	combine<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>>;
	withLatestFrom<T, U>(primary: ImplNode<T>, secondary: ImplNode<U>): Promise<ImplNode<[T, U]>>;
	merge<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>>;

	// Flow.
	take<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>>;
	skip<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>>;
	takeWhile<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>>;
	last<T>(src: ImplNode<T>, opts?: { defaultValue: T }): Promise<ImplNode<T>>;
	first<T>(src: ImplNode<T>): Promise<ImplNode<T>>;
	find<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>>;
	elementAt<T>(src: ImplNode<T>, index: number): Promise<ImplNode<T>>;

	// Subscription-managed combinators.
	zip<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>>;
	concat<T>(first: ImplNode<T>, second: ImplNode<T>): Promise<ImplNode<T>>;
	race<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>>;
	takeUntil<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T>>;

	// Higher-order.
	switchMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>>;
	exhaustMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>>;
	concatMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>>;
	mergeMap<T, U>(
		outer: ImplNode<T>,
		project: (x: T) => ImplNode<U>,
		concurrency?: number,
	): Promise<ImplNode<U>>;
}
