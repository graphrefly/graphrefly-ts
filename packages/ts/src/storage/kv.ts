import { hasStoragePutIfAbsent, memoryBackend, type StorageBackend } from "./backend.js";
import type { Codec } from "./codec.js";
import { jsonCodecFor } from "./codec.js";

/** Codec-backed key/value tier over a passive byte backend (D82). */
export interface KvStorageTier<T = unknown> {
	get(key: string): Promise<T | undefined>;
	set(key: string, value: T): Promise<void>;
	putIfAbsent?(key: string, value: T): Promise<boolean>;
	delete(key: string): Promise<void>;
	list(prefix?: string): Promise<readonly string[]>;
}

/** Typed D85 conditional-create capability over a KV tier. */
export interface PutIfAbsentKvStorageTier<T = unknown> extends KvStorageTier<T> {
	putIfAbsent(key: string, value: T): Promise<boolean>;
}

/** Runtime guard for typed KV tiers that expose D85 conditional create. */
export function hasKvPutIfAbsent<T>(tier: KvStorageTier<T>): tier is PutIfAbsentKvStorageTier<T> {
	return typeof tier.putIfAbsent === "function";
}

/** Require D85 conditional-create support and produce a clear adapter error when absent. */
export function requireKvPutIfAbsent<T>(
	tier: KvStorageTier<T>,
	label = "kvStorage",
): PutIfAbsentKvStorageTier<T> {
	if (!hasKvPutIfAbsent(tier)) {
		throw new Error(`${label}: KV tier does not support putIfAbsent`);
	}
	return tier;
}

/** Options for wrapping a byte backend as a typed KV tier. */
export interface KvStorageOptions<T> {
	backend: StorageBackend;
	codec?: Codec<T>;
}

function defer<T>(fn: () => T | PromiseLike<T>): Promise<T> {
	return Promise.resolve().then(fn);
}

/** Build a typed KV tier from a byte backend and codec. */
export function kvStorage<T = unknown>(opts: KvStorageOptions<T>): KvStorageTier<T> {
	const codec = opts.codec ?? jsonCodecFor<T>();
	const { backend } = opts;
	const tier: KvStorageTier<T> = {
		get(key) {
			return defer(() => backend.get(key)).then((bytes) =>
				bytes === undefined ? undefined : codec.decode(bytes),
			);
		},
		set(key, value) {
			return defer(() => backend.put(key, codec.encode(value))).then(() => undefined);
		},
		delete(key) {
			return defer(() => backend.delete?.(key)).then(() => undefined);
		},
		list(prefix = "") {
			return defer(() => {
				if (!backend.list) throw new Error("kvStorage.list: backend does not support listing");
				return backend.list(prefix);
			}).then((keys) => [...keys].sort());
		},
	};
	if (!hasStoragePutIfAbsent(backend)) return tier;
	const capableBackend = backend;
	return {
		...tier,
		putIfAbsent(key, value) {
			return defer(() => capableBackend.putIfAbsent(key, codec.encode(value)));
		},
	};
}

/** Create an in-memory typed KV tier. */
export function memoryKv<T = unknown>(codec: Codec<T> = jsonCodecFor<T>()): KvStorageTier<T> {
	return kvStorage({ backend: memoryBackend(), codec });
}

/** Create an in-memory typed KV tier preloaded from a record. */
export function dictKv<T = unknown>(
	entries: Record<string, T> = {},
	codec: Codec<T> = jsonCodecFor<T>(),
): KvStorageTier<T> {
	const backend = memoryBackend();
	const kv = kvStorage({ backend, codec });
	for (const [key, value] of Object.entries(entries)) {
		backend.put(key, codec.encode(value as T));
	}
	return kv;
}

/** Convenience wrapper for deterministic prefix listing. */
export function listByPrefix<T>(tier: KvStorageTier<T>, prefix = ""): Promise<readonly string[]> {
	return tier.list(prefix);
}
