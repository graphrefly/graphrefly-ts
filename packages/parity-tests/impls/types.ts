/**
 * **Canonical public-API contract for the three sibling impls.**
 *
 * Every method here is part of GraphReFly's public surface and must be
 * implemented by `@graphrefly/pure-ts`, `@graphrefly/native`, and
 * `@graphrefly/wasm`. Widening this interface IS a public-API decision
 * — treat additions deliberately, not as test scaffolding.
 *
 * Authority: PART 13 of `archive/docs/SESSION-rust-port-architecture.md`
 * (D080–D084, locked 2026-05-08).
 *
 * **Phase E (D077) — async-everywhere.** All methods that touch the
 * dispatcher are `Promise`-returning so the napi-rs Rust impl (which
 * runs Core on a tokio blocking-pool thread per D070) can satisfy the
 * same interface as the synchronous TS pure-ts impl. The pure-ts impl
 * wraps each sync method in `async` (negligible Promise.resolve
 * overhead); the rust impl exposes its napi async methods directly.
 * D080 extends this lock to all three sibling impls, including
 * `@graphrefly/wasm` whose `__wbg_init()` is hidden behind every public
 * method via the same async-everywhere shape.
 *
 * Sink-completion semantics: any method that triggers Core dispatch
 * (`subscribe`, `down`, lifecycle ops, signal broadcast) resolves AFTER
 * the wave drains AND all sinks have fired. So `await x.subscribe(cb)`
 * followed by `expect(seen).toContain(...)` is correct — the subscribe
 * handshake's sink callback has completed by the time the Promise
 * resolves.
 */

import type * as legacy from "@graphrefly/pure-ts";

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

	/**
	 * Describe snapshot. Static `describe()` returns the current
	 * `GraphDescribeOutput` JSON; reactive `describe({ reactive: true })`
	 * returns a [`ReactiveDescribeHandle`] whose sink fires on
	 * push-on-subscribe + every namespace mutation per canonical R3.6.1.
	 *
	 * `await dispose()` unsubscribes — for the rust impl the unsubscribe
	 * runs on a tokio blocking thread so `Subscription::Drop`'s mutex
	 * acquisition can't stall libuv (mirrors `BenchCore::dispose`).
	 */
	describe(): unknown;
	describe(opts: { reactive: true }): Promise<ReactiveDescribeHandle>;

	/**
	 * Observe message flow. Canonical R3.6.2:
	 * - `observe()` — sink-style fan-out across all named nodes
	 *   (snapshot at call time, NOT auto-subscribe).
	 * - `observe(path)` — sink-style single-node tap.
	 * - `observe(undefined, { reactive: true })` — reactive all-nodes
	 *   variant that auto-subscribes late-added nodes.
	 */
	observe(): Promise<ObserveSubscription>;
	observe(path: string): Promise<ObserveSubscription>;
	observe(path: string | undefined, opts: { reactive: true }): Promise<ObserveSubscription>;
}

/**
 * Reactive describe subscription. `subscribe(sink)` registers a snapshot
 * callback; the sink fires immediately with the initial snapshot
 * (push-on-subscribe per R3.6.1) and again on every namespace mutation.
 * Returns a sync unsubscribe fn for the registered sink.
 */
export interface ReactiveDescribeHandle {
	subscribe(sink: (snapshot: unknown) => void): () => void;
	dispose(): Promise<void>;
}

/** Returned by `observe()` / `observe(path)` / `observe(_, { reactive: true })`. */
export interface ObserveSubscription {
	/**
	 * Register a sink. For all-nodes variants the sink receives
	 * `(path, msgs)`; for single-node sink-style the sink receives
	 * `(msgs)` only (path is implicit). Returns a sync unsubscribe fn.
	 */
	subscribe(
		sink: (pathOrMsgs: string | ReadonlyArray<Message>, msgs?: ReadonlyArray<Message>) => void,
	): () => void;
	dispose(): Promise<void>;
}

/**
 * Fixed-capacity ring buffer (drop-oldest / FIFO eviction). Substrate
 * infra surfaced on the `@graphrefly/pure-ts` **core** barrel; the
 * presentation package (`@graphrefly/graphrefly`) and substrate internals
 * (`reactiveLog`, the reasoning-trace ring, drop-oldest backpressure)
 * depend on it. N1 (locked 2026-05-15, option (a)) pins it so
 * `@graphrefly/native` MUST expose an equivalent.
 */
export interface ImplRingBuffer<T> {
	readonly size: number;
	readonly maxSize: number;
	push(item: T): void;
	shift(): T | undefined;
	at(i: number): T | undefined;
	toArray(): T[];
	clear(): void;
}

/**
 * Resettable deadline timer — spec §5.10 escape hatch used by the
 * resilience operators (`timeout`/`retry`/`rateLimiter`) and their
 * presentation-layer middleware, which import it from the substrate
 * **core** barrel. Pinned by N1.
 */
export interface ImplResettableTimer {
	start(delayMs: number, callback: () => void): void;
	cancel(): void;
	readonly pending: boolean;
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
		opts?: { initial?: T; name?: string; resubscribable?: boolean },
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

	// Control operators (Slice U napi parity).
	tap<T>(src: ImplNode<T>, fn: (x: T) => void): Promise<ImplNode<T>>;
	tapObserver<T>(
		src: ImplNode<T>,
		opts: { data?: (x: T) => void; error?: (e: unknown) => void; complete?: () => void },
	): Promise<ImplNode<T>>;
	onFirstData<T>(src: ImplNode<T>, fn: (x: T) => void): Promise<ImplNode<T>>;
	rescue<T>(src: ImplNode<T>, fn: (err: unknown) => T | undefined): Promise<ImplNode<T>>;
	valve<T>(
		src: ImplNode<T>,
		control: ImplNode<unknown>,
		gate: (x: unknown) => boolean,
	): Promise<ImplNode<T>>;
	settle<T>(src: ImplNode<T>, quietWaves: number, maxWaves?: number): Promise<ImplNode<T>>;
	repeat<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>>;

	// Buffer operators (Slice U napi parity).
	buffer<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T[]>>;
	bufferCount<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T[]>>;

	// Cold sources (Slice 3e/3f napi parity).
	fromIter<T>(values: T[]): Promise<ImplNode<T>>;
	of<T>(values: T[]): Promise<ImplNode<T>>;
	empty<T>(): Promise<ImplNode<T>>;
	throwError<T>(error: unknown): Promise<ImplNode<T>>;

	// Stratify substrate (D199 — Unit 5 Q9.2 of SESSION-rust-port-
	// layer-boundary). Single classifier-routing branch — the TS-side
	// `stratify(...) → Graph` factory composes N instances of this one
	// per rule, passing a closure that captures the branch name and
	// reads the rule from the latest rules-array handle.
	stratifyBranch<T, R>(
		src: ImplNode<T>,
		rules: ImplNode<R>,
		classifier: (rules: R, value: T) => boolean,
	): Promise<ImplNode<T>>;

	// Storage (M4.F — D176). `undefined` when the impl doesn't support storage.
	readonly storage?: StorageImpl;

	// Reactive structures (M5). `undefined` when the impl doesn't support structures.
	readonly structures?: StructuresImpl;

	// ── Substrate infra surfaced on the public barrels (N1) ────────────
	//
	// These 5 symbols are re-exported on `@graphrefly/pure-ts`'s public
	// **core** / **extra** barrels and the presentation package
	// (`@graphrefly/graphrefly`) imports them directly from the substrate
	// peer (e.g. `src/utils/resilience/*`, `src/base/sources/async.ts`,
	// `src/base/io/*`, `src/utils/ai/adapters/*`). They were NOT in this
	// contract (grep-count 0 pre-cleave), so `@graphrefly/graphrefly`
	// would break the moment `@graphrefly/native` is the substrate
	// provider — native only promises `Impl`. N1 (locked 2026-05-15,
	// user-approved option (a)) pins them as a native obligation; folded
	// into the D203 native-publish batch as scope item 8.
	//
	// `wrapSubscribeHook` was originally pinned here too (6th symbol) but
	// was DELETED from the substrate when `replay`/`cached`/`shareReplay`
	// migrated to the built-in `replayBuffer` NodeOption (Group-3 Edge #2
	// fix, 2026-05-15) — the substrate explicitly supersedes the old
	// `wrapSubscribeHook` monkey-patch (spec §2.5 / Lock 6.G). It is no
	// longer a public symbol, so it is no longer a native obligation.
	//
	// `RingBuffer` / `ResettableTimer` are constructors (sync — infra,
	// not dispatcher ops, so they keep their natural shape rather than
	// the async-everywhere wrapping). `sha256Hex` is genuinely async in
	// every impl.
	RingBuffer: new <T>(
		capacity: number,
	) => ImplRingBuffer<T>;
	ResettableTimer: new () => ImplResettableTimer;
	describeNode(node: ImplNode<unknown>): unknown;
	sha256Hex(input: string | Uint8Array): Promise<string>;
	sourceOpts(opts?: Record<string, unknown>): Record<string, unknown>;
}

// ── Reactive structures sub-interface (M5) ──────────────────────────────

/** Wrapper for a reactive log instance. Values are JS values (both impls
 * resolve handles to values at the boundary). */
export interface ImplReactiveLog<T> {
	/** The underlying node (subscribable for snapshot emissions). */
	readonly node: ImplNode<readonly T[]>;
	readonly size: number;
	append(value: T): Promise<void>;
	appendMany(values: T[]): Promise<void>;
	clear(): Promise<void>;
	trimHead(n: number): Promise<void>;
	at(index: number): T | undefined;

	// F18 (D203 native-ship). `view` mirrors pure-ts's discriminated
	// `ViewSpec`; the returned node emits `readonly T[]` snapshots.
	view(
		spec:
			| { kind: "tail"; n: number }
			| { kind: "slice"; start: number; stop?: number }
			| { kind: "fromCursor"; cursor: ImplNode<number> },
	): Promise<ImplNode<readonly T[]>>;
	/** Running aggregate; node emits the current accumulator. */
	scan<TAcc>(initial: TAcc, step: (acc: TAcc, value: T) => TAcc): Promise<ImplNode<TAcc>>;
	/** Append every upstream DATA value into this log. Returns an unsub. */
	attach(upstream: ImplNode<T>): Promise<UnsubFn>;
}

export interface ImplReactiveList<T> {
	readonly node: ImplNode<readonly T[]>;
	readonly size: number;
	append(value: T): Promise<void>;
	appendMany(values: T[]): Promise<void>;
	insert(index: number, value: T): Promise<void>;
	pop(index?: number): Promise<T>;
	clear(): Promise<void>;
	at(index: number): T | undefined;
}

export interface ImplReactiveMap<K, V> {
	readonly node: ImplNode<unknown>;
	readonly size: number;
	set(key: K, value: V): Promise<void>;
	get(key: K): V | undefined;
	has(key: K): boolean;
	delete(key: K): Promise<void>;
	clear(): Promise<void>;
}

export interface ImplReactiveIndex<K, V> {
	readonly node: ImplNode<unknown>;
	readonly size: number;
	upsert(primary: K, secondary: string, value: V): Promise<boolean>;
	delete(primary: K): Promise<void>;
	clear(): Promise<void>;
	has(primary: K): boolean;
	get(primary: K): V | undefined;
	/**
	 * F20 (D205). Values whose **numeric** primary key sorts within
	 * `[start, end)` (inclusive start, exclusive end), ascending by
	 * primary. Scenarios use numeric primaries so range comparison is
	 * user-meaningful (never opaque-handle order). `start >= end` →
	 * `[]`.
	 *
	 * **Numeric-primary-only on the rust arm:** the `@graphrefly/native`
	 * mirror is keyed by `i64`, so a non-numeric primary cannot enter the
	 * range mirror. The rust adapter THROWS if `rangeByPrimary` is called
	 * after a non-numeric `upsert` (rather than silently returning a
	 * partial result). pure-ts ranges the real primary map and supports
	 * any orderable key. New range scenarios must use numeric primaries.
	 */
	rangeByPrimary(start: number, end: number): V[];
}

export interface StructuresImpl {
	reactiveLog<T>(opts?: { maxSize?: number }): ImplReactiveLog<T>;
	reactiveList<T>(): ImplReactiveList<T>;
	reactiveMap<K, V>(opts?: { maxSize?: number }): ImplReactiveMap<K, V>;
	reactiveIndex<K, V>(): ImplReactiveIndex<K, V>;
}

// ── Storage sub-interface (M4.F) ─────────────────────────────────────────

export interface ImplMemoryBackend {
	readRaw(key: string): string | undefined;
	list(prefix: string): string[];
}

export interface ImplBaseTier {
	readonly name: string;
	flush(): void | Promise<void>;
	rollback(): void | Promise<void>;
}

export interface ImplSnapshotTier extends ImplBaseTier {
	save(value: unknown): void;
	load(): unknown | undefined;
	readonly debounceMs?: number;
	readonly compactEvery?: number;
}

export interface ImplKvTier extends ImplBaseTier {
	save(key: string, value: unknown): void;
	load(key: string): unknown | undefined;
	delete(key: string): void;
	list(prefix: string): string[];
}

export interface ImplAppendLogTier extends ImplBaseTier {
	appendEntries(entries: unknown[]): void | Promise<void>;
	loadEntries(keyFilter?: string): Promise<unknown[]>;
}

export interface ImplCheckpointSnapshotTier extends ImplBaseTier {
	save(record: unknown): void;
	load(): unknown | undefined;
}

export interface ImplWalKvTier extends ImplBaseTier {
	save(key: string, frame: unknown): void;
	load(key: string): unknown | undefined;
	delete(key: string): void;
	list(prefix: string): string[];
}

export interface ImplStorageHandle {
	dispose(): Promise<void>;
}

export interface RestoreResultOutput {
	replayedFrames: number;
	skippedFrames: number;
	finalSeq: number;
	phases: Array<{ lifecycle: string; frames: number }>;
}

export interface TierOpts {
	name?: string;
	compactEvery?: number;
	debounceMs?: number;
}

export interface StorageImpl {
	memoryBackend(): ImplMemoryBackend;

	// Generic value tiers (Tier 1 tests).
	snapshotTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplSnapshotTier;
	kvTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplKvTier;
	appendLogTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplAppendLogTier;

	// Graph-specific tiers (Tier 2+3 tests).
	checkpointSnapshotTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplCheckpointSnapshotTier;
	walKvTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplWalKvTier;

	// Graph integration.
	attachSnapshotStorage(
		graph: ImplGraph,
		snapshot: ImplCheckpointSnapshotTier,
		wal?: ImplWalKvTier,
	): Promise<ImplStorageHandle>;
	restoreSnapshot(
		graph: ImplGraph,
		snapshot: ImplCheckpointSnapshotTier,
		wal: ImplWalKvTier,
		opts?: { targetSeq?: number },
	): Promise<RestoreResultOutput>;
	graphSnapshot(graph: ImplGraph): Promise<unknown>;

	// WAL utilities.
	walFrameKey(prefix: string, frameSeq: number): string;
	walFrameChecksum(frame: unknown): Promise<string>;
	verifyWalFrameChecksum(frame: unknown): Promise<boolean>;
	walReplayOrder(): string[];
}
