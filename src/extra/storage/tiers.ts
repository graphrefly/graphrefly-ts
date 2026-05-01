/**
 * Storage tier architecture (Audit 4 — locked 2026-04-24).
 *
 * Three-layer design:
 *
 * - **Layer 1 — {@link StorageBackend}:** generic bytes-level kv I/O. One
 *   `read(key) → Uint8Array | undefined`, `write(key, bytes)`, optional
 *   `delete(key)` / `list(prefix)`. No tier-level concerns (debounce, codec).
 * - **Layer 2 — Tier specializations** layered over a backend, parametric over
 *   `T`: {@link SnapshotStorageTier} (one snapshot under one key) and
 *   {@link AppendLogStorageTier} (sequential entries, optional partition via
 *   `keyOf`). Both extend {@link BaseStorageTier} which carries
 *   `flush?` / `rollback?` for the wave-as-transaction model.
 * - **Layer 3 — High-level wiring:** `Graph.attachSnapshotStorage(tiers)`,
 *   `reactiveLog.attachStorage(tiers)`, `cqrsGraph.attachEventStorage(tiers)`,
 *   `jobQueueGraph.attachEventStorage(tiers)`. These layers consume tier
 *   specializations directly — they don't see the backend.
 *
 * Browser-safe by default. {@link memoryBackend} + the in-memory factories
 * live here; Node-only (`fileBackend` / `sqliteBackend`) lives in
 * `extra/storage-node.ts`; browser-only (`indexedDbBackend`) lives in
 * `extra/storage-browser.ts`.
 *
 * @module
 */

import { stableJsonString } from "../storage-core.js";

// ── Layer 1 — StorageBackend (bytes I/O) ──────────────────────────────────

/**
 * Bytes-level kv backend. One responsibility: read/write byte ranges under
 * string keys. Tier specializations layer on top.
 *
 * @category extra
 */
export interface StorageBackend {
	/** Diagnostic name (e.g., `"memory"`, `"file:./checkpoints"`). */
	readonly name: string;
	/** Read raw bytes; returns `undefined` on miss. */
	read(key: string): Uint8Array | undefined | Promise<Uint8Array | undefined>;
	/** Write raw bytes. Sync backends return `void`; async return `Promise<void>`. */
	write(key: string, bytes: Uint8Array): void | Promise<void>;
	/** Optional delete-by-key. */
	delete?(key: string): void | Promise<void>;
	/** Optional enumeration; `prefix` filters keys. */
	list?(prefix?: string): readonly string[] | Promise<readonly string[]>;
	/** Optional drain hook — adapter authors implement when buffering writes. */
	flush?(): Promise<void>;
}

// ── Codec system ──────────────────────────────────────────────────────────

/**
 * Codec for tier serialization. Tiers call `encode(value) → bytes` before
 * `backend.write` and `decode(bytes) → value` after `backend.read`.
 *
 * @category extra
 */
export interface Codec<T = unknown> {
	readonly name: string;
	readonly version: number;
	encode(value: T): Uint8Array;
	decode(bytes: Uint8Array): T;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Default JSON codec — UTF-8 text, stable key order (via `stableJsonString`).
 * Any value JSON-serializable is supported.
 *
 * @category extra
 */
export const jsonCodec: Codec<unknown> = {
	name: "json",
	version: 1,
	encode(value): Uint8Array {
		return textEncoder.encode(stableJsonString(value));
	},
	decode(bytes): unknown {
		return JSON.parse(textDecoder.decode(bytes)) as unknown;
	},
};

/**
 * Returns the default `jsonCodec` cast to `Codec<T>`.
 *
 * Pure typing helper — no runtime overhead. Use when a generic API requires a
 * `Codec<T>` and the value is known to be JSON-serializable.
 *
 * @returns `Codec<T>` backed by the shared `jsonCodec` (UTF-8 JSON, stable key order).
 *
 * @example
 * ```ts
 * import { memoryBackend, snapshotStorage, jsonCodecFor } from "@graphrefly/graphrefly/extra";
 *
 * type MyState = { count: number; label: string };
 * const tier = snapshotStorage<MyState>(memoryBackend(), {
 *   codec: jsonCodecFor<MyState>(),
 * });
 * ```
 *
 * @category extra
 */
export function jsonCodecFor<T>(): Codec<T> {
	return jsonCodec as unknown as Codec<T>;
}

// ── Layer 2 — Tier specializations ────────────────────────────────────────

/**
 * Common tier surface: name + cadence knobs + transaction lifecycle.
 *
 * Lifecycle hooks (`flush` / `rollback`) implement Audit 4's "one wave = one
 * transaction" model. Framework integration:
 *  - After every wave (and on `batch()` close), framework iterates attached
 *    tiers and calls `tier.flush()` if exposed.
 *  - On wave-throw (per C.2 F rollback policy), framework calls
 *    `tier.rollback()` if exposed — pending writes discarded.
 *  - Cross-tier atomicity is best-effort. Each tier is its own transaction.
 *
 * @category extra
 */
export interface BaseStorageTier {
	readonly name: string;
	/** Debounce window (ms). `0` = sync-through; >0 batches across waves. */
	readonly debounceMs?: number;
	/** Force flush every Nth write regardless of debounce. */
	readonly compactEvery?: number;
	/** Commit pending; framework calls at wave-close / debounce-fire. */
	flush?(): Promise<void>;
	/** Discard pending; framework calls on wave-throw. */
	rollback?(): Promise<void>;
}

/**
 * Snapshot tier — writes a single record per `save(snapshot)` call.
 *
 * The tier maps the snapshot to a backend key via `keyOf(snapshot)` (default
 * `() => name ?? "snapshot"`). For `Graph.attachSnapshotStorage`, the framework
 * supplies a closure that pulls the graph name out of the record envelope.
 *
 * @category extra
 */
export interface SnapshotStorageTier<T = unknown> extends BaseStorageTier {
	save(snapshot: T): void | Promise<void>;
	load?(): T | Promise<T | undefined> | undefined;
	/** Skip-save policy — return `false` to skip persisting this snapshot. */
	filter?: (snapshot: T) => boolean;
	/** Extract the backend key per-snapshot; default `() => name ?? "snapshot"`. */
	keyOf?: (snapshot: T) => string;
}

/**
 * Append-log tier — bulk-friendly entry persistence with optional partitioning.
 *
 * Entries are appended to a logical stream; `keyOf?` partitions across backend
 * keys (e.g., `(e) => `${e.type}::${e.aggregateId}`` for CQRS).
 *
 * @category extra
 */
export interface AppendLogStorageTier<T = unknown> extends BaseStorageTier {
	appendEntries(entries: readonly T[]): void | Promise<void>;
	loadEntries?(opts?: {
		cursor?: AppendCursor;
		pageSize?: number;
		keyFilter?: string;
	}): AppendLoadResult<T> | Promise<AppendLoadResult<T>>;
	/** Partition key per-entry (default `() => name ?? "append-log"`). */
	keyOf?: (entry: T) => string;
}

/** Opaque cursor for windowed `loadEntries` pagination. */
export type AppendCursor = Readonly<{ position: number; tag?: string }> & {
	readonly __brand: "AppendCursor";
};

export type AppendLoadResult<T> = {
	entries: readonly T[];
	cursor: AppendCursor | undefined;
};

// ── Layer 1 reference: in-memory backend ─────────────────────────────────

/**
 * Creates an in-process bytes backend backed by `Map<string, Uint8Array>`.
 *
 * Useful for tests, hot tiers, and as the default backend for the convenience
 * factories in this module. All operations are synchronous.
 *
 * @returns `StorageBackend` instance backed by an in-memory `Map`.
 *
 * @example
 * ```ts
 * import { memoryBackend, snapshotStorage } from "@graphrefly/graphrefly/extra";
 *
 * const backend = memoryBackend();
 * const tier = snapshotStorage(backend, { name: "my-graph" });
 * await tier.save({ name: "my-graph", data: { count: 1 } });
 * ```
 *
 * @category extra
 */
export function memoryBackend(): StorageBackend {
	const data = new Map<string, Uint8Array>();
	return {
		name: "memory",
		read(key) {
			const v = data.get(key);
			return v === undefined ? undefined : new Uint8Array(v);
		},
		write(key, bytes) {
			data.set(key, new Uint8Array(bytes));
		},
		delete(key) {
			data.delete(key);
		},
		list(prefix) {
			const keys = [...data.keys()];
			return prefix ? keys.filter((k) => k.startsWith(prefix)).sort() : keys.sort();
		},
	};
}

// ── Layer 2 reference: snapshot + append-log factories ───────────────────

export type SnapshotStorageOptions<T> = {
	name?: string;
	codec?: Codec<T>;
	debounceMs?: number;
	compactEvery?: number;
	filter?: (snapshot: T) => boolean;
	keyOf?: (snapshot: T) => string;
};

/**
 * Wraps a `StorageBackend` as a typed snapshot tier.
 *
 * Buffer model: `save(snapshot)` accumulates one pending snapshot in memory.
 * `flush()` encodes via codec and writes to the backend under
 * `keyOf(snapshot)` (default `name ?? "snapshot"`). `rollback()` discards
 * the pending write.
 *
 * @param backend - Bytes-level backend to persist snapshots into.
 * @param opts - Optional name, codec, debounce window, compaction interval, pre-save filter, and key extractor.
 * @returns `SnapshotStorageTier<T>` that buffers one pending snapshot and flushes on wave-close.
 *
 * @example
 * ```ts
 * import { memoryBackend, snapshotStorage } from "@graphrefly/graphrefly/extra";
 *
 * const backend = memoryBackend();
 * const tier = snapshotStorage<{ count: number }>(backend, { name: "counter" });
 * await tier.save({ count: 42 });
 * // Load back:
 * const loaded = await tier.load?.();
 * ```
 *
 * @category extra
 */
export function snapshotStorage<T>(
	backend: StorageBackend,
	opts: SnapshotStorageOptions<T> = {},
): SnapshotStorageTier<T> {
	const codec = (opts.codec ?? jsonCodec) as Codec<T>;
	const name = opts.name ?? backend.name ?? "snapshot";
	// Default keyOf: prefer snapshot.name (GraphCheckpointRecord carries name),
	// then opts.name, then backend.name, then "snapshot". This lets Graph
	// per-graph keying work automatically when tiers are created with
	// snapshotStorage(backend, { keyOf: r => r.name }) or when the record has a
	// `name` field (as GraphCheckpointRecord does).
	const keyOf =
		opts.keyOf ??
		((v: T) => (v as { name?: string }).name ?? opts.name ?? backend.name ?? "snapshot");
	let pending: { snapshot: T } | undefined;
	let writeCount = 0;
	const compactEvery = opts.compactEvery;
	let _lastSavedKey: string | undefined;

	const tier: SnapshotStorageTier<T> = {
		name,
		debounceMs: opts.debounceMs,
		compactEvery,
		filter: opts.filter,
		keyOf,
		save(snapshot) {
			if (opts.filter && !opts.filter(snapshot)) return;
			pending = { snapshot };
			writeCount += 1;
			if (compactEvery !== undefined && writeCount % compactEvery === 0) {
				return flushNow();
			}
			if (!opts.debounceMs) {
				return flushNow();
			}
			return undefined;
		},
		load() {
			const key = _lastSavedKey ?? name;
			const result = backend.read(key);
			if (result === undefined) return undefined;
			if (result instanceof Uint8Array) {
				return result.length === 0 ? undefined : codec.decode(result);
			}
			return Promise.resolve(result).then((bytes) =>
				bytes === undefined || bytes.length === 0 ? undefined : codec.decode(bytes),
			);
		},
		async flush() {
			await flushNow();
		},
		async rollback() {
			pending = undefined;
		},
	};

	function flushNow(): void | Promise<void> {
		const slot = pending;
		if (!slot) return;
		pending = undefined;
		const key = keyOf(slot.snapshot);
		const bytes = codec.encode(slot.snapshot);
		const result = backend.write(key, bytes);
		if (result instanceof Promise) {
			return result.then(() => {
				_lastSavedKey = key;
			});
		}
		_lastSavedKey = key;
		return undefined;
	}

	return tier;
}

export type AppendLogStorageOptions<T> = {
	name?: string;
	codec?: Codec<readonly T[]>;
	keyOf?: (entry: T) => string;
	debounceMs?: number;
	compactEvery?: number;
};

/**
 * Wraps a `StorageBackend` as a typed append-log tier.
 *
 * Buffer model: `appendEntries(entries)` accumulates per-key buckets in
 * memory. `flush()` encodes each bucket as a JSON array via codec and writes
 * under that bucket key. `rollback()` discards pending appends.
 *
 * Storage shape: each backend key holds a JSON array of all entries for that
 * partition, growing on every flush. Adapters that need true append semantics
 * (versus rewrite) should layer their own tier impl over the same backend.
 *
 * @param backend - Bytes-level backend to persist log entries into.
 * @param opts - Optional name, codec, per-entry key extractor, debounce window, and compaction interval.
 * @returns `AppendLogStorageTier<T>` that buffers pending entries and flushes per-key buckets on wave-close.
 *
 * @example
 * ```ts
 * import { memoryBackend, appendLogStorage } from "@graphrefly/graphrefly/extra";
 *
 * const backend = memoryBackend();
 * const tier = appendLogStorage<{ type: string; payload: unknown }>(backend, { name: "events" });
 * await tier.appendEntries([{ type: "created", payload: { id: 1 } }]);
 * const result = await tier.loadEntries?.();
 * ```
 *
 * @category extra
 */
export function appendLogStorage<T>(
	backend: StorageBackend,
	opts: AppendLogStorageOptions<T> = {},
): AppendLogStorageTier<T> {
	const codec = (opts.codec ?? jsonCodec) as Codec<readonly T[]>;
	const name = opts.name ?? backend.name ?? "append-log";
	const keyOf = opts.keyOf ?? ((_e: T) => name);
	const compactEvery = opts.compactEvery;
	let pending: Map<string, T[]> = new Map();
	let appendCount = 0;
	// C3: serialize concurrent flushes against a per-tier promise chain.
	// Without this, two flushes in flight against an async backend can both
	// read the same key before either write completes — second write loses
	// the first's contribution. Sync backends never wait, so the chain is
	// essentially a no-op for them.
	let flushChain: Promise<void> | undefined;

	const tier: AppendLogStorageTier<T> = {
		name,
		debounceMs: opts.debounceMs,
		compactEvery,
		keyOf,
		appendEntries(entries) {
			if (entries.length === 0) return;
			for (const entry of entries) {
				const k = keyOf(entry);
				let bucket = pending.get(k);
				if (!bucket) {
					bucket = [];
					pending.set(k, bucket);
				}
				bucket.push(entry);
			}
			appendCount += entries.length;
			if (compactEvery !== undefined && appendCount % compactEvery === 0) {
				return flushNow();
			}
			if (!opts.debounceMs) {
				return flushNow();
			}
			return undefined;
		},
		async loadEntries(loadOpts) {
			const filter = loadOpts?.keyFilter;
			const keys =
				backend.list === undefined
					? filter !== undefined
						? [filter]
						: [name]
					: await Promise.resolve(backend.list(filter));
			const all: T[] = [];
			for (const k of keys) {
				const result = await Promise.resolve(backend.read(k));
				if (result === undefined || result.length === 0) continue;
				const entries = codec.decode(result) as readonly T[];
				if (Array.isArray(entries)) all.push(...entries);
			}
			return { entries: all, cursor: undefined };
		},
		async flush() {
			await flushNow();
		},
		async rollback() {
			pending = new Map();
		},
	};

	function flushNow(): void | Promise<void> {
		if (pending.size === 0) return;
		const buckets = pending;
		pending = new Map();
		// Chain this flush after any prior in-flight flush so reads/writes
		// don't interleave. Sync backends short-circuit (the chained `.then`
		// resolves immediately if `doFlush` returned undefined).
		const next: Promise<void> = (flushChain ?? Promise.resolve()).then(
			() => {
				const w = doFlush(buckets);
				return w instanceof Promise ? w : Promise.resolve();
			},
			// Previous flush rejected — already surfaced; don't block this one.
			() => {
				const w = doFlush(buckets);
				return w instanceof Promise ? w : Promise.resolve();
			},
		);
		flushChain = next.finally(() => {
			if (flushChain === next) flushChain = undefined;
		});
		// Sync fast-path: if no async work was queued by `doFlush`, return
		// undefined so callers don't `await` an unnecessary microtask.
		// We can't probe doFlush's sync-ness without running it; the awaitable
		// chain is correct either way.
		return flushChain;
	}

	function doFlush(buckets: Map<string, T[]>): void | Promise<void> {
		const promises: Promise<void>[] = [];
		for (const [key, bucket] of buckets) {
			// Read existing, append new, write back. Sync-or-async per backend.
			const prev = backend.read(key);
			const merge = (existing: Uint8Array | undefined): void | Promise<void> => {
				const prior =
					existing === undefined || existing.length === 0
						? []
						: ((codec.decode(existing) as readonly T[]) ?? []);
				const merged = [...prior, ...bucket];
				const next = codec.encode(merged);
				return backend.write(key, next);
			};
			if (prev instanceof Promise) {
				promises.push(
					prev.then(async (existing) => {
						const w = merge(existing);
						if (w instanceof Promise) await w;
					}),
				);
			} else {
				const w = merge(prev);
				if (w instanceof Promise) promises.push(w);
			}
		}
		if (promises.length > 0) return Promise.all(promises).then(() => undefined);
		return undefined;
	}

	return tier;
}

// ── Layer 2 — KvStorageTier ───────────────────────────────────────────────

/**
 * Key-value tier — typed records under arbitrary string keys with codec
 * serialization at the storage-tier boundary. Use for content-addressed
 * caches (replay), multi-record archives (snapshot index, AI memory), and
 * fixture stores. Snapshot tier is "one record"; append-log is "sequential
 * entries"; kv is "many records, addressable by key".
 *
 * @category extra
 */
export interface KvStorageTier<T = unknown> extends BaseStorageTier {
	load(key: string): T | undefined | Promise<T | undefined>;
	save(key: string, value: T): void | Promise<void>;
	delete?(key: string): void | Promise<void>;
	list?(prefix?: string): readonly string[] | Promise<readonly string[]>;
	/** Pre-save filter — return `false` to skip persisting this record. */
	filter?: (key: string, value: T) => boolean;
}

export type KvStorageOptions<T> = {
	name?: string;
	codec?: Codec<T>;
	debounceMs?: number;
	compactEvery?: number;
	filter?: (key: string, value: T) => boolean;
};

/**
 * Wraps a `StorageBackend` as a typed key-value tier.
 *
 * Buffer model: `save(k, v)` encodes via codec and writes to the backend
 * unless debounced. Pending writes are committed on `flush()` and discarded
 * on `rollback()` — the wave-as-transaction model.
 *
 * @param backend - Bytes-level backend to persist records into.
 * @param opts - Optional name, codec, debounce window, compaction interval, and pre-save filter.
 * @returns `KvStorageTier<T>` that supports `save`, `load`, `delete`, and `list` operations.
 *
 * @example
 * ```ts
 * import { memoryBackend, kvStorage } from "@graphrefly/graphrefly/extra";
 *
 * const backend = memoryBackend();
 * const kv = kvStorage<{ score: number }>(backend, { name: "scores" });
 * await kv.save("player1", { score: 100 });
 * const val = await kv.load("player1");
 * ```
 *
 * @category extra
 */
export function kvStorage<T>(
	backend: StorageBackend,
	opts: KvStorageOptions<T> = {},
): KvStorageTier<T> {
	const codec = (opts.codec ?? jsonCodec) as Codec<T>;
	const name = opts.name ?? backend.name ?? "kv";
	const compactEvery = opts.compactEvery;
	let pending: Map<string, T> = new Map();
	let writeCount = 0;

	const tier: KvStorageTier<T> = {
		name,
		debounceMs: opts.debounceMs,
		compactEvery,
		filter: opts.filter,

		save(key: string, value: T): void | Promise<void> {
			if (opts.filter && !opts.filter(key, value)) return;
			pending.set(key, value);
			writeCount += 1;
			if (compactEvery !== undefined && writeCount % compactEvery === 0) {
				return flushNow();
			}
			if (!opts.debounceMs) {
				return flushNow();
			}
			return undefined;
		},

		load(key: string): T | undefined | Promise<T | undefined> {
			const result = backend.read(key);
			if (result === undefined) return undefined;
			if (result instanceof Uint8Array) {
				return result.length === 0 ? undefined : codec.decode(result);
			}
			return Promise.resolve(result).then((bytes) =>
				bytes === undefined || bytes.length === 0 ? undefined : codec.decode(bytes),
			);
		},

		delete(key: string): void | Promise<void> {
			pending.delete(key);
			if (!backend.delete) return;
			return backend.delete(key);
		},

		list(prefix?: string): readonly string[] | Promise<readonly string[]> {
			if (!backend.list) return [];
			return backend.list(prefix);
		},

		async flush() {
			await flushNow();
		},

		async rollback() {
			pending = new Map();
		},
	};

	function flushNow(): void | Promise<void> {
		if (pending.size === 0) return;
		const entries = pending;
		pending = new Map();
		const promises: Promise<void>[] = [];
		for (const [key, value] of entries) {
			const bytes = codec.encode(value);
			const result = backend.write(key, bytes);
			if (result instanceof Promise) promises.push(result);
		}
		if (promises.length > 0) return Promise.all(promises).then(() => undefined);
		return undefined;
	}

	return tier;
}

// ── Convenience factories — memory ────────────────────────────────────────

/**
 * Creates an in-memory snapshot tier backed by a fresh `memoryBackend`.
 *
 * Convenience wrapper for `snapshotStorage(memoryBackend(), opts)`. All writes
 * are synchronous and in-process — useful for tests and hot-path caching.
 *
 * @param opts - Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery).
 * @returns `SnapshotStorageTier<T>` backed by an in-memory store.
 *
 * @example
 * ```ts
 * import { memorySnapshot } from "@graphrefly/graphrefly/extra";
 *
 * const tier = memorySnapshot<{ count: number }>({ name: "counter" });
 * await tier.save({ count: 1 });
 * ```
 *
 * @category extra
 */
export function memorySnapshot<T>(
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T> {
	return snapshotStorage<T>(memoryBackend(), opts);
}

/**
 * Creates an in-memory append-log tier backed by a fresh `memoryBackend`.
 *
 * Convenience wrapper for `appendLogStorage(memoryBackend(), opts)`. All writes
 * are synchronous and in-process — useful for tests and hot-path event buffering.
 *
 * @param opts - Optional append-log storage options (name, codec, keyOf, debounce, compactEvery).
 * @returns `AppendLogStorageTier<T>` backed by an in-memory store.
 *
 * @example
 * ```ts
 * import { memoryAppendLog } from "@graphrefly/graphrefly/extra";
 *
 * const tier = memoryAppendLog<{ type: string }>({ name: "events" });
 * await tier.appendEntries([{ type: "init" }]);
 * ```
 *
 * @category extra
 */
export function memoryAppendLog<T>(
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T> {
	return appendLogStorage<T>(memoryBackend(), opts);
}

/**
 * Creates an in-memory key-value tier backed by a fresh `memoryBackend`.
 *
 * Convenience wrapper for `kvStorage(memoryBackend(), opts)`. All writes are
 * synchronous and in-process — useful for tests and ephemeral record caches.
 *
 * @param opts - Optional kv storage options (name, codec, filter, debounce, compactEvery).
 * @returns `KvStorageTier<T>` backed by an in-memory store.
 *
 * @example
 * ```ts
 * import { memoryKv } from "@graphrefly/graphrefly/extra";
 *
 * const kv = memoryKv<{ value: number }>();
 * await kv.save("key1", { value: 42 });
 * const loaded = await kv.load("key1");
 * ```
 *
 * @category extra
 */
export function memoryKv<T>(
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> {
	return kvStorage<T>(memoryBackend(), opts);
}

/**
 * Creates a kv tier backed by a caller-owned plain object (`Record<string, Uint8Array>`).
 *
 * Useful for embedding storage inside a parent state shape or for tests that
 * need direct access to the raw bytes. The dict stores raw encoded bytes as
 * `Uint8Array`. Use `opts.name` to control the tier's diagnostic name
 * (defaults to `"dict-kv"`).
 *
 * @param storage - Caller-owned `Record<string, Uint8Array>` to use as the backing store.
 * @param opts - Optional kv storage options (name, codec, filter, debounce, compactEvery).
 * @returns `KvStorageTier<T>` backed by the provided dict object.
 *
 * @example
 * ```ts
 * import { dictKv } from "@graphrefly/graphrefly/extra";
 *
 * const store: Record<string, Uint8Array> = {};
 * const tier = dictKv<{ score: number }>(store);
 * await tier.save("player1", { score: 100 });
 * ```
 *
 * @category extra
 */
export function dictKv<T>(
	storage: Record<string, Uint8Array>,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> {
	const backend: StorageBackend = {
		name: opts?.name ?? "dict-kv",
		read(key) {
			return storage[key];
		},
		write(key, bytes) {
			storage[key] = new Uint8Array(bytes);
		},
		delete(key) {
			delete storage[key];
		},
		list(prefix) {
			const keys = Object.keys(storage).sort();
			return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
		},
	};
	return kvStorage<T>(backend, opts);
}

/**
 * Creates a snapshot tier backed by a caller-owned plain object (`Record<string, Uint8Array>`).
 *
 * Useful for embedding checkpoints inside a parent state shape or for tests
 * that need direct access to the raw bytes. The dict stores raw JSON bytes as
 * `Uint8Array`. Use `opts.name` to control the storage key (defaults to
 * `"snapshot"`).
 *
 * @param storage - Caller-owned `Record<string, Uint8Array>` to use as the backing store.
 * @param opts - Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery).
 * @returns `SnapshotStorageTier<T>` backed by the provided dict object.
 *
 * @example
 * ```ts
 * import { dictSnapshot } from "@graphrefly/graphrefly/extra";
 *
 * const store: Record<string, Uint8Array> = {};
 * graph.attachSnapshotStorage([dictSnapshot(store, { name: graph.name })]);
 * ```
 *
 * @category extra
 */
export function dictSnapshot<T>(
	storage: Record<string, Uint8Array>,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T> {
	const backend: StorageBackend = {
		name: "dict",
		read(key) {
			return storage[key];
		},
		write(key, bytes) {
			storage[key] = new Uint8Array(bytes);
		},
		delete(key) {
			delete storage[key];
		},
		list(prefix) {
			const keys = Object.keys(storage).sort();
			return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
		},
	};
	return snapshotStorage<T>(backend, opts);
}
