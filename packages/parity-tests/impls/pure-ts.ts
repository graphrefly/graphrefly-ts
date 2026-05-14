/**
 * Legacy pure-TS impl arm — async-shaped wrapper (D077).
 *
 * Wraps `@graphrefly/pure-ts`'s sync API in Promise.resolve()
 * so the same parity scenarios run against both the legacy impl and
 * the napi-rs Rust impl (which is fundamentally async per D070).
 * Promise.resolve overhead is microseconds — negligible for parity
 * tests.
 */

import * as legacy from "@graphrefly/pure-ts";
import * as storage from "@graphrefly/pure-ts/extra";
import type {
	Impl,
	ImplAppendLogTier,
	ImplCheckpointSnapshotTier,
	ImplGraph,
	ImplKvTier,
	ImplMemoryBackend,
	ImplNode,
	ImplReactiveIndex,
	ImplReactiveList,
	ImplReactiveLog,
	ImplReactiveMap,
	ImplSnapshotTier,
	ImplStorageHandle,
	ImplWalKvTier,
	Message,
	RestoreResultOutput,
	SinkFn,
	StorageImpl,
	StructuresImpl,
	TierOpts,
	UnsubFn,
} from "./types.js";

// ---------------------------------------------------------------------------
// ImplNode wrapper for legacy.Node
// ---------------------------------------------------------------------------

class LegacyNode<T> implements ImplNode<T> {
	constructor(public readonly inner: legacy.Node<T>) {}

	async subscribe(cb: SinkFn<T>): Promise<UnsubFn> {
		const unsub = this.inner.subscribe((msgs) => {
			cb(msgs as ReadonlyArray<Message<T>>);
		});
		return async () => {
			unsub();
		};
	}

	async down(msgs: ReadonlyArray<Message<T>>): Promise<void> {
		this.inner.down(msgs as legacy.Messages);
	}

	get cache(): T | undefined {
		const c = this.inner.cache;
		return c === null ? undefined : c;
	}

	async complete(): Promise<void> {
		this.inner.down([[legacy.COMPLETE]]);
	}

	async error(value: T): Promise<void> {
		this.inner.down([[legacy.ERROR, value]]);
	}

	async invalidate(): Promise<void> {
		this.inner.down([[legacy.INVALIDATE]]);
	}

	async teardown(): Promise<void> {
		this.inner.down([[legacy.TEARDOWN]]);
	}

	async pause(lockId: number): Promise<void> {
		this.inner.down([[legacy.PAUSE, lockId]]);
	}

	async resume(_lockId: number): Promise<{ replayed: number; dropped: number } | null> {
		this.inner.down([[legacy.RESUME, _lockId]]);
		// Legacy `down([[RESUME]])` doesn't surface the resume report
		// (replayed/dropped). For parity, return null — Rust impl returns
		// the report; tests that rely on report values gate on impl name.
		return null;
	}

	async allocLockId(): Promise<number> {
		// Legacy doesn't expose alloc_lock_id on Node. Use a process-
		// counter mirror so tests get unique-enough ids.
		return ++LEGACY_LOCK_COUNTER;
	}

	async setResubscribable(_value: boolean): Promise<void> {
		// Legacy nodes have a `resubscribable` flag at construction;
		// post-construction setter is not part of the public Node API.
		// No-op here — tests that exercise this gate on impl name.
	}

	async hasFiredOnce(): Promise<boolean> {
		// Not surfaced on legacy.Node public API. Approximate via cache
		// presence — true if cache is not undefined/null.
		return this.inner.cache !== undefined && this.inner.cache !== null;
	}
}

let LEGACY_LOCK_COUNTER = 0;

// ---------------------------------------------------------------------------
// ImplGraph wrapper for legacy.Graph
// ---------------------------------------------------------------------------

class LegacyGraph implements ImplGraph {
	constructor(public readonly inner: legacy.Graph) {}

	tryResolve(path: string): ImplNode<unknown> | undefined {
		const found = this.inner.tryResolve(path);
		return found ? new LegacyNode<unknown>(found) : undefined;
	}

	nameOf(node: ImplNode<unknown>): string | undefined {
		const inner = node.inner as legacy.Node;
		return this.inner.nameOf(inner);
	}

	async state<T>(name: string, initial?: T): Promise<ImplNode<T>> {
		const n = this.inner.state<T>(name, initial as T);
		return new LegacyNode<T>(n);
	}

	async derived<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>> {
		const innerDeps = deps.map((d) => d.inner as legacy.Node);
		const fnAdapter: legacy.GraphDerivedFn<T> = (data) =>
			fn(data.map((d) => d ?? [])) as readonly (T | null)[];
		const n = this.inner.derived<T>(name, innerDeps, fnAdapter);
		return new LegacyNode<T>(n);
	}

	async dynamic<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>> {
		// Legacy doesn't have a separate `dynamic` method — `derived`
		// covers both static and dynamic via fn behavior. Both impls
		// route through derived for parity-test purposes.
		return this.derived(name, deps, fn);
	}

	async add<T>(name: string, node: ImplNode<T>): Promise<ImplNode<T>> {
		const inner = node.inner as legacy.Node<T>;
		this.inner.add(inner, { name });
		return node;
	}

	async set(name: string, value: unknown): Promise<void> {
		this.inner.set(name, value);
	}

	async get(name: string): Promise<unknown> {
		const n = this.inner.tryResolve(name);
		return n?.cache;
	}

	async invalidate(name: string): Promise<void> {
		this.inner.invalidate(name);
	}

	async complete(name: string): Promise<void> {
		this.inner.complete(name);
	}

	async error(name: string, value: unknown): Promise<void> {
		this.inner.error(name, value);
	}

	async remove(name: string): Promise<{ nodeCount: number; mountCount: number }> {
		const audit = this.inner.remove(name);
		return {
			nodeCount: audit.nodes.length,
			mountCount: audit.mounts.length,
		};
	}

	async signal(messages: ReadonlyArray<Message>): Promise<void> {
		this.inner.signal(messages as legacy.Messages);
	}

	async mount(name: string, child?: ImplGraph): Promise<ImplGraph> {
		if (child) {
			const m = this.inner.mount(name, (child as LegacyGraph).inner);
			return new LegacyGraph(m);
		}
		const m = this.inner.mount(name);
		return new LegacyGraph(m);
	}

	async unmount(name: string): Promise<{ nodeCount: number; mountCount: number }> {
		// Legacy uses `remove()` for both nodes and mounts.
		const audit = this.inner.remove(name);
		return {
			nodeCount: audit.nodes.length,
			mountCount: audit.mounts.length,
		};
	}

	async destroy(): Promise<void> {
		this.inner.destroy();
	}

	edges(opts?: { recursive?: boolean }): Array<[string, string]> {
		const result = this.inner.edges(opts);
		return result.map(([a, b]) => [a, b] as [string, string]);
	}

	describe(opts?: { reactive: true }): unknown {
		if (opts?.reactive) {
			// Legacy `describe({ reactive: true })` returns
			// `ReactiveDescribeHandle<T>` = `{ node: Node<GraphDescribeOutput>,
			// dispose }`. Subscribe to handle.node for snapshots; the handle's
			// own dispose tears down the underlying topology subscription.
			const handle = this.inner.describe({ reactive: true } as any);
			return Promise.resolve({
				subscribe: (sink: (snapshot: unknown) => void) => {
					const unsub = handle.node.subscribe((msgs: ReadonlyArray<unknown>) => {
						for (const m of msgs) {
							const message = m as { 0: symbol; 1?: unknown };
							if (message[0] === legacy.DATA) sink(message[1]);
						}
					});
					return () => {
						unsub();
					};
				},
				dispose: async () => {
					handle.dispose();
				},
			});
		}
		return this.inner.describe();
	}

	async observe(path?: string, opts?: { reactive: true }): Promise<unknown> {
		if (opts?.reactive) {
			// Reactive: legacy returns a `Node<ObserveChangeset>` whose
			// DATA payload is `{ events: ObserveEvent[], flushedAt_ns }`.
			// Each `ObserveEvent` has `{ path, type, data?, lockId? }`.
			// We group by path + convert ObserveEvent → Message tuple
			// shape for the parity-tests `(path, msgs)` sink contract.
			const node =
				path !== undefined
					? this.inner.observe(path as any, { reactive: true } as any)
					: this.inner.observe({ reactive: true } as any);
			// Slice X3 /qa G (2026-05-08): track installed unsub fns so
			// `dispose()` can tear them all down (the contract says
			// "unsubscribes everything"). Pre-fix `dispose: async () => {}`
			// was a no-op — leaked the underlying Node subscriptions when
			// callers relied on dispose alone to clean up.
			const installedUnsubs = new Set<() => void>();
			return {
				subscribe: (
					sink: (
						pathOrMsgs: string | ReadonlyArray<unknown>,
						msgs?: ReadonlyArray<unknown>,
					) => void,
				) => {
					const unsub = node.subscribe((messages: ReadonlyArray<unknown>) => {
						for (const m of messages) {
							const message = m as { 0: symbol; 1?: unknown };
							if (message[0] === legacy.DATA && message[1]) {
								const changeset = message[1] as {
									events?: ReadonlyArray<unknown>;
								};
								if (!Array.isArray(changeset.events)) continue;
								const byPath = new Map<string, unknown[]>();
								for (const ev of changeset.events) {
									const event = ev as {
										path?: string;
										type: string;
										data?: unknown;
										lockId?: unknown;
									};
									const tuple = observeEventToMessage(event);
									if (!tuple) continue;
									const p = event.path ?? "";
									if (!byPath.has(p)) byPath.set(p, []);
									byPath.get(p)?.push(tuple);
								}
								for (const [p, msgs] of byPath) {
									sink(p, msgs);
								}
							}
						}
					});
					installedUnsubs.add(unsub);
					return () => {
						unsub();
						installedUnsubs.delete(unsub);
					};
				},
				dispose: async () => {
					for (const unsub of installedUnsubs) unsub();
					installedUnsubs.clear();
				},
			};
		}
		// Sink-style.
		const handle = path !== undefined ? this.inner.observe(path as any) : this.inner.observe();
		// Slice X3 /qa G: track installed unsubs so `dispose()` honors
		// its "unsubscribes everything" contract.
		const installedUnsubs = new Set<() => void>();
		return {
			subscribe: (sink: any) => {
				const sub = handle.subscribe(sink);
				installedUnsubs.add(sub);
				return () => {
					sub();
					installedUnsubs.delete(sub);
				};
			},
			dispose: async () => {
				for (const unsub of installedUnsubs) unsub();
				installedUnsubs.clear();
			},
		};
	}
}

// ---------------------------------------------------------------------------
// Operator wrappers — each takes ImplNode args, calls legacy operator,
// wraps result in LegacyNode.
// ---------------------------------------------------------------------------

function unwrap<T>(n: ImplNode<T>): legacy.Node<T> {
	return n.inner as legacy.Node<T>;
}

function wrap<T>(n: legacy.Node<T>): ImplNode<T> {
	return new LegacyNode<T>(n);
}

/**
 * Translate a legacy `ObserveEvent` (one entry in `ObserveChangeset.events`)
 * into the `[symbol, payload?]` Message tuple shape used by the parity-tests
 * `(path, msgs)` sink contract. Returns `null` for unknown event types.
 */
function observeEventToMessage(event: {
	type: string;
	data?: unknown;
	lockId?: unknown;
}): unknown | null {
	switch (event.type) {
		case "start":
			// Slice X3 /qa Group 2 #7: explicit start case — user sinks
			// don't observe the per-subscription handshake (R1.3.5.a).
			// Mirrors `decodeMessages`'s `if (code === MSG_CODE_START) continue`.
			return null;
		case "data":
			return [legacy.DATA, event.data];
		case "error":
			return [legacy.ERROR, event.data];
		case "dirty":
			return [legacy.DIRTY];
		case "resolved":
			return [legacy.RESOLVED];
		case "invalidate":
			return [legacy.INVALIDATE];
		case "pause":
			return [legacy.PAUSE, event.lockId];
		case "resume":
			return [legacy.RESUME, event.lockId];
		case "complete":
			return [legacy.COMPLETE];
		case "teardown":
			return [legacy.TEARDOWN];
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// The Impl arm
// ---------------------------------------------------------------------------

export const pureTsImpl: Impl = {
	name: "pure-ts",

	DATA: legacy.DATA,
	RESOLVED: legacy.RESOLVED,
	DIRTY: legacy.DIRTY,
	INVALIDATE: legacy.INVALIDATE,
	PAUSE: legacy.PAUSE,
	RESUME: legacy.RESUME,
	COMPLETE: legacy.COMPLETE,
	ERROR: legacy.ERROR,
	TEARDOWN: legacy.TEARDOWN,

	async node<T>(
		deps: ReadonlyArray<ImplNode<unknown>>,
		opts?: { initial?: T; name?: string },
	): Promise<ImplNode<T>> {
		const innerDeps = deps.map((d) => d.inner as legacy.Node);
		const n = legacy.node<T>(innerDeps, {
			initial: opts?.initial,
			name: opts?.name,
			resubscribable: opts?.resubscribable,
		} as legacy.NodeOptions<T>);
		return wrap(n);
	},

	Graph: class implements ImplGraph {
		private readonly impl: LegacyGraph;
		constructor(name: string) {
			this.impl = new LegacyGraph(new legacy.Graph(name));
		}
		tryResolve(path: string) {
			return this.impl.tryResolve(path);
		}
		nameOf(node: ImplNode<unknown>) {
			return this.impl.nameOf(node);
		}
		state<T>(name: string, initial?: T) {
			return this.impl.state<T>(name, initial);
		}
		derived<T>(
			name: string,
			deps: ReadonlyArray<ImplNode<unknown>>,
			fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
		) {
			return this.impl.derived<T>(name, deps, fn);
		}
		dynamic<T>(
			name: string,
			deps: ReadonlyArray<ImplNode<unknown>>,
			fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
		) {
			return this.impl.dynamic<T>(name, deps, fn);
		}
		add<T>(name: string, node: ImplNode<T>) {
			return this.impl.add<T>(name, node);
		}
		set(name: string, value: unknown) {
			return this.impl.set(name, value);
		}
		get(name: string) {
			return this.impl.get(name);
		}
		invalidate(name: string) {
			return this.impl.invalidate(name);
		}
		complete(name: string) {
			return this.impl.complete(name);
		}
		error(name: string, value: unknown) {
			return this.impl.error(name, value);
		}
		remove(name: string) {
			return this.impl.remove(name);
		}
		signal(messages: ReadonlyArray<Message>) {
			return this.impl.signal(messages);
		}
		mount(name: string, child?: ImplGraph) {
			return this.impl.mount(name, child);
		}
		unmount(name: string) {
			return this.impl.unmount(name);
		}
		destroy() {
			return this.impl.destroy();
		}
		edges(opts?: { recursive?: boolean }) {
			return this.impl.edges(opts);
		}
		describe(opts?: any) {
			return this.impl.describe(opts);
		}
		observe(path?: string, opts?: any) {
			return this.impl.observe(path, opts);
		}
	},

	// Transform.
	async map<T, U>(src: ImplNode<T>, fn: (x: T) => U): Promise<ImplNode<U>> {
		return wrap(legacy.map(unwrap(src), fn));
	},
	async filter<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
		return wrap(legacy.filter(unwrap(src), predicate));
	},
	async scan<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>> {
		return wrap(legacy.scan(unwrap(src), fn, seed));
	},
	async reduce<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>> {
		return wrap(legacy.reduce(unwrap(src), fn, seed));
	},
	async distinctUntilChanged<T>(
		src: ImplNode<T>,
		equals?: (a: T, b: T) => boolean,
	): Promise<ImplNode<T>> {
		return wrap(legacy.distinctUntilChanged(unwrap(src), equals));
	},
	async pairwise<T>(src: ImplNode<T>): Promise<ImplNode<[T, T]>> {
		return wrap(legacy.pairwise(unwrap(src)) as legacy.Node<[T, T]>);
	},

	// Combine.
	async combine<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>> {
		const inner = legacy.combine(...srcs.map((s) => unwrap(s)));
		return wrap(inner as unknown as legacy.Node<T[]>);
	},
	async withLatestFrom<T, U>(
		primary: ImplNode<T>,
		secondary: ImplNode<U>,
	): Promise<ImplNode<[T, U]>> {
		const inner = legacy.withLatestFrom(unwrap(primary), unwrap(secondary));
		return wrap(inner as unknown as legacy.Node<[T, U]>);
	},
	async merge<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>> {
		const inner = legacy.merge(...srcs.map((s) => unwrap(s)));
		return wrap(inner as legacy.Node<T>);
	},

	// Flow.
	async take<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
		return wrap(legacy.take(unwrap(src), count));
	},
	async skip<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
		return wrap(legacy.skip(unwrap(src), count));
	},
	async takeWhile<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
		return wrap(legacy.takeWhile(unwrap(src), predicate));
	},
	async last<T>(src: ImplNode<T>, opts?: { defaultValue: T }): Promise<ImplNode<T>> {
		return wrap(legacy.last(unwrap(src), opts));
	},
	async first<T>(src: ImplNode<T>): Promise<ImplNode<T>> {
		return wrap(legacy.first(unwrap(src)));
	},
	async find<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
		return wrap(legacy.find(unwrap(src), predicate));
	},
	async elementAt<T>(src: ImplNode<T>, index: number): Promise<ImplNode<T>> {
		return wrap(legacy.elementAt(unwrap(src), index));
	},

	// Subscription-managed combinators.
	async zip<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>> {
		const inner = legacy.zip(...srcs.map((s) => unwrap(s)));
		return wrap(inner as unknown as legacy.Node<T[]>);
	},
	async concat<T>(first: ImplNode<T>, second: ImplNode<T>): Promise<ImplNode<T>> {
		const inner = legacy.concat(unwrap(first), unwrap(second));
		return wrap(inner as legacy.Node<T>);
	},
	async race<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>> {
		const inner = legacy.race(...srcs.map((s) => unwrap(s)));
		return wrap(inner as legacy.Node<T>);
	},
	async takeUntil<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T>> {
		return wrap(legacy.takeUntil(unwrap(src), unwrap(notifier)));
	},

	// Higher-order.
	async switchMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>> {
		return wrap(legacy.switchMap(unwrap(outer), (x: T) => unwrap(project(x))));
	},
	async exhaustMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>> {
		return wrap(legacy.exhaustMap(unwrap(outer), (x: T) => unwrap(project(x))));
	},
	async concatMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>> {
		return wrap(legacy.concatMap(unwrap(outer), (x: T) => unwrap(project(x))));
	},
	async mergeMap<T, U>(
		outer: ImplNode<T>,
		project: (x: T) => ImplNode<U>,
		concurrency?: number,
	): Promise<ImplNode<U>> {
		const inner = legacy.mergeMap(
			unwrap(outer),
			(x: T) => unwrap(project(x)),
			concurrency !== undefined ? { concurrent: concurrency } : undefined,
		);
		return wrap(inner as legacy.Node<U>);
	},

	// Control operators (Slice U napi parity).
	async tap<T>(src: ImplNode<T>, fn: (x: T) => void): Promise<ImplNode<T>> {
		return wrap(legacy.tap(unwrap(src), fn));
	},
	async tapObserver<T>(
		src: ImplNode<T>,
		opts: { data?: (x: T) => void; error?: (e: unknown) => void; complete?: () => void },
	): Promise<ImplNode<T>> {
		return wrap(legacy.tap(unwrap(src), opts));
	},
	async onFirstData<T>(src: ImplNode<T>, fn: (x: T) => void): Promise<ImplNode<T>> {
		return wrap(legacy.onFirstData(unwrap(src), fn));
	},
	async rescue<T>(src: ImplNode<T>, fn: (err: unknown) => T | undefined): Promise<ImplNode<T>> {
		return wrap(
			legacy.rescue(unwrap(src), (err) => {
				const result = fn(err);
				if (result === undefined) throw err;
				return result;
			}),
		);
	},
	async valve<T>(
		src: ImplNode<T>,
		control: ImplNode<unknown>,
		gate: (x: unknown) => boolean,
	): Promise<ImplNode<T>> {
		// Legacy valve takes Node<boolean>; map control through gate predicate.
		const boolControl = legacy.map(unwrap(control), gate);
		return wrap(legacy.valve(unwrap(src), boolControl));
	},
	async settle<T>(src: ImplNode<T>, quietWaves: number, maxWaves?: number): Promise<ImplNode<T>> {
		return wrap(legacy.settle(unwrap(src), { quietWaves, maxWaves }));
	},
	async repeat<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
		return wrap(legacy.repeat(unwrap(src), count));
	},

	// Buffer operators (Slice U napi parity).
	async buffer<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T[]>> {
		return wrap(legacy.buffer(unwrap(src), unwrap(notifier)));
	},
	async bufferCount<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T[]>> {
		return wrap(legacy.bufferCount(unwrap(src), count));
	},

	// Cold sources (Slice 3e/3f napi parity).
	async fromIter<T>(values: T[]): Promise<ImplNode<T>> {
		return wrap(legacy.fromIter(values));
	},
	async of<T>(values: T[]): Promise<ImplNode<T>> {
		return wrap(legacy.of(...values));
	},
	async empty<T>(): Promise<ImplNode<T>> {
		return wrap(legacy.empty<T>());
	},
	async throwError<T>(error: unknown): Promise<ImplNode<T>> {
		return wrap(legacy.throwError(error) as legacy.Node<T>);
	},

	// Storage (M4.F).
	storage: buildPureTsStorage(),

	// Structures (M5).
	structures: buildPureTsStructures(),
};

// ---------------------------------------------------------------------------
// Pure-TS storage impl (M4.F)
// ---------------------------------------------------------------------------

function buildPureTsStorage(): StorageImpl {
	return {
		memoryBackend(): ImplMemoryBackend {
			const b = storage.memoryBackend();
			const impl: ImplMemoryBackend & { _raw: ReturnType<typeof storage.memoryBackend> } = {
				_raw: b,
				readRaw(key: string) {
					// memoryBackend().read is always sync
					const bytes = b.read(key) as Uint8Array | undefined;
					if (!bytes || bytes.length === 0) return undefined;
					return new TextDecoder().decode(bytes);
				},
				list(prefix: string) {
					// memoryBackend().list is always sync
					return [...(b.list!(prefix) as readonly string[])];
				},
			};
			return impl;
		},

		snapshotTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplSnapshotTier {
			const b = (backend as any)._raw as ReturnType<typeof storage.memoryBackend>;
			const tier = storage.snapshotStorage(b, {
				name: opts?.name,
				compactEvery: opts?.compactEvery,
				debounceMs: opts?.debounceMs,
			});
			return {
				get name() {
					return tier.name;
				},
				get debounceMs() {
					return tier.debounceMs;
				},
				get compactEvery() {
					return tier.compactEvery;
				},
				save(value: unknown) {
					tier.save(value);
				},
				load() {
					return tier.load();
				},
				flush() {
					return tier.flush?.();
				},
				rollback() {
					return tier.rollback?.();
				},
			};
		},

		kvTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplKvTier {
			const b = (backend as any)._raw as ReturnType<typeof storage.memoryBackend>;
			const tier = storage.kvStorage(b, {
				name: opts?.name,
				compactEvery: opts?.compactEvery,
				debounceMs: opts?.debounceMs,
			});
			return {
				get name() {
					return tier.name;
				},
				save(key: string, value: unknown) {
					tier.save(key, value);
				},
				load(key: string) {
					return tier.load(key) as unknown | undefined;
				},
				delete(key: string) {
					tier.delete?.(key);
				},
				list(prefix: string) {
					return [...((tier.list?.(prefix) ?? []) as readonly string[])];
				},
				flush() {
					return tier.flush?.();
				},
				rollback() {
					return tier.rollback?.();
				},
			};
		},

		appendLogTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplAppendLogTier {
			const b = (backend as any)._raw as ReturnType<typeof storage.memoryBackend>;
			const tier = storage.appendLogStorage(b, {
				name: opts?.name,
				compactEvery: opts?.compactEvery,
				debounceMs: opts?.debounceMs,
			});
			return {
				get name() {
					return tier.name;
				},
				appendEntries(entries: unknown[]) {
					tier.appendEntries(entries);
				},
				async loadEntries(keyFilter?: string): Promise<unknown[]> {
					const result = await tier.loadEntries?.({ keyFilter });
					return result ? [...result.entries] : [];
				},
				flush() {
					return tier.flush?.();
				},
				rollback() {
					return tier.rollback?.();
				},
			};
		},

		checkpointSnapshotTier(
			backend: ImplMemoryBackend,
			opts?: TierOpts,
		): ImplCheckpointSnapshotTier {
			const b = (backend as any)._raw as ReturnType<typeof storage.memoryBackend>;
			const tier = storage.snapshotStorage(b, {
				name: opts?.name,
				compactEvery: opts?.compactEvery,
			});
			const wrapper: ImplCheckpointSnapshotTier & { _rawTier: typeof tier } = {
				_rawTier: tier,
				get name() {
					return tier.name;
				},
				save(record: unknown) {
					tier.save(record);
				},
				load() {
					return tier.load();
				},
				flush() {
					return tier.flush?.();
				},
				rollback() {
					return tier.rollback?.();
				},
			};
			return wrapper;
		},

		walKvTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplWalKvTier {
			const b = (backend as any)._raw as ReturnType<typeof storage.memoryBackend>;
			const tier = storage.kvStorage(b, {
				name: opts?.name,
				compactEvery: opts?.compactEvery,
			});
			const wrapper: ImplWalKvTier & { _rawTier: typeof tier } = {
				_rawTier: tier,
				get name() {
					return tier.name;
				},
				save(key: string, frame: unknown) {
					tier.save(key, frame);
				},
				load(key: string) {
					return tier.load(key) as unknown | undefined;
				},
				delete(key: string) {
					tier.delete?.(key);
				},
				list(prefix: string) {
					return [...((tier.list?.(prefix) ?? []) as readonly string[])];
				},
				flush() {
					return tier.flush?.();
				},
				rollback() {
					return tier.rollback?.();
				},
			};
			return wrapper;
		},

		async attachSnapshotStorage(
			graph: ImplGraph,
			snapshot: ImplCheckpointSnapshotTier,
			wal?: ImplWalKvTier,
		): Promise<ImplStorageHandle> {
			const g = (graph as any).impl?.inner as legacy.Graph | undefined;
			if (!g) throw new Error("storage: could not access raw graph from ImplGraph");
			const pair = {
				snapshot: (snapshot as any)._rawTier,
				wal: wal ? (wal as any)._rawTier : undefined,
			};
			const handle = g.attachSnapshotStorage([pair]);
			return {
				async dispose() {
					handle.dispose();
				},
			};
		},

		async restoreSnapshot(
			graph: ImplGraph,
			snapshot: ImplCheckpointSnapshotTier,
			wal: ImplWalKvTier,
			opts?: { targetSeq?: number },
		): Promise<RestoreResultOutput> {
			const g = (graph as any).impl?.inner as legacy.Graph | undefined;
			if (!g) throw new Error("storage: could not access raw graph from ImplGraph");
			const result = await g.restoreSnapshot({
				mode: "diff",
				source: {
					tier: (snapshot as any)._rawTier,
					walTier: (wal as any)._rawTier,
				},
				targetSeq: opts?.targetSeq,
			});
			return {
				replayedFrames: result.replayedFrames,
				skippedFrames: result.skippedFrames,
				finalSeq: result.finalSeq,
				phases: result.phases.map((p: any) => ({
					lifecycle: p.lifecycle,
					frames: p.frames,
				})),
			};
		},

		async graphSnapshot(graph: ImplGraph): Promise<unknown> {
			const g = (graph as any).impl?.inner as legacy.Graph | undefined;
			if (!g) throw new Error("storage: could not access raw graph from ImplGraph");
			return g.snapshot();
		},

		walFrameKey(prefix: string, frameSeq: number): string {
			return storage.walFrameKey(prefix, frameSeq);
		},

		async walFrameChecksum(frame: unknown): Promise<string> {
			return storage.walFrameChecksum(frame as any);
		},

		async verifyWalFrameChecksum(frame: unknown): Promise<boolean> {
			return storage.verifyWalFrameChecksum(frame as any);
		},

		walReplayOrder(): string[] {
			return [...storage.REPLAY_ORDER];
		},
	};
}

// ---------------------------------------------------------------------------
// Pure-TS structures impl (M5)
// ---------------------------------------------------------------------------

function buildPureTsStructures(): StructuresImpl {
	return {
		reactiveLog<T>(opts?: { maxSize?: number }): ImplReactiveLog<T> {
			const bundle = storage.reactiveLog<T>([], {
				maxSize: opts?.maxSize,
			});
			const node = wrap(bundle.entries);
			return {
				node,
				get size() {
					return bundle.size;
				},
				async append(value: T) {
					bundle.append(value);
				},
				async appendMany(values: T[]) {
					bundle.appendMany(values);
				},
				async clear() {
					bundle.clear();
				},
				async trimHead(n: number) {
					bundle.trimHead(n);
				},
				at(index: number) {
					return bundle.at(index);
				},
			};
		},

		reactiveList<T>(): ImplReactiveList<T> {
			const bundle = storage.reactiveList<T>();
			const node = wrap(bundle.items);
			return {
				node,
				get size() {
					return bundle.size;
				},
				async append(value: T) {
					bundle.append(value);
				},
				async appendMany(values: T[]) {
					bundle.appendMany(values);
				},
				async insert(index: number, value: T) {
					bundle.insert(index, value);
				},
				async pop(index?: number) {
					return bundle.pop(index);
				},
				async clear() {
					bundle.clear();
				},
				at(index: number) {
					return bundle.at(index);
				},
			};
		},

		reactiveMap<K, V>(opts?: { maxSize?: number }): ImplReactiveMap<K, V> {
			const bundle = storage.reactiveMap<K, V>({
				maxSize: opts?.maxSize,
			});
			const node = wrap(bundle.entries);
			return {
				node,
				get size() {
					return bundle.size;
				},
				async set(key: K, value: V) {
					bundle.set(key, value);
				},
				get(key: K) {
					return bundle.get(key);
				},
				has(key: K) {
					return bundle.has(key);
				},
				async delete(key: K) {
					bundle.delete(key);
				},
				async clear() {
					bundle.clear();
				},
			};
		},

		reactiveIndex<K, V>(): ImplReactiveIndex<K, V> {
			const bundle = storage.reactiveIndex<K, V>();
			const node = wrap(bundle.ordered);
			return {
				node,
				get size() {
					return bundle.size;
				},
				async upsert(primary: K, secondary: string, value: V) {
					return bundle.upsert(primary, secondary, value);
				},
				async delete(primary: K) {
					bundle.delete(primary);
				},
				async clear() {
					bundle.clear();
				},
				has(primary: K) {
					return bundle.has(primary);
				},
				get(primary: K) {
					return bundle.get(primary);
				},
			};
		},
	};
}
