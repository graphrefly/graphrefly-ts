/**
 * Browser-only Audit 4 storage backend + convenience factories.
 *
 * Uses DOM `IndexedDB`. Browser-safe consumers should import from this module;
 * Node consumers should not import here without the DOM lib in their tsconfig.
 *
 * @module
 */
/// <reference lib="dom" />

import {
	type AppendLogStorageOptions,
	type AppendLogStorageTier,
	appendLogStorage,
	type KvStorageOptions,
	type KvStorageTier,
	kvStorage,
	type SnapshotStorageOptions,
	type SnapshotStorageTier,
	type StorageBackend,
	snapshotStorage,
} from "./storage-tiers.js";

export type IndexedDbBackendSpec = {
	dbName: string;
	storeName: string;
	version?: number;
};

function openDb(spec: IndexedDbBackendSpec): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new TypeError("indexedDB is not available in this environment"));
			return;
		}
		const req = indexedDB.open(spec.dbName, spec.version ?? 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(spec.storeName)) {
				db.createObjectStore(spec.storeName);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () =>
			reject(req.error ?? new Error(`indexedDbBackend: open(${spec.dbName}) failed`));
	});
}

/**
 * Creates an IndexedDB backend for browser-based persistent storage.
 *
 * All operations (`read`, `write`, `delete`, `list`) are async and return
 * `Promise`. The backing object store is created automatically on first open
 * if it does not already exist.
 *
 * @param spec - Database name, object store name, and optional schema version.
 * @returns `StorageBackend` backed by an IndexedDB object store.
 *
 * @example
 * ```ts
 * import { indexedDbBackend, snapshotStorage } from "@graphrefly/graphrefly/extra/browser";
 *
 * const backend = indexedDbBackend({ dbName: "my-app", storeName: "snapshots" });
 * const tier = snapshotStorage(backend, { name: "graph1" });
 * await tier.save({ name: "graph1", state: {} });
 * ```
 *
 * @category extra
 */
export function indexedDbBackend(spec: IndexedDbBackendSpec): StorageBackend {
	const cache = openDb(spec);
	return {
		name: `idb:${spec.dbName}/${spec.storeName}`,
		async read(key) {
			const db = await cache;
			return new Promise<Uint8Array | undefined>((resolve, reject) => {
				const tx = db.transaction(spec.storeName, "readonly");
				const store = tx.objectStore(spec.storeName);
				const req = store.get(key);
				req.onsuccess = () => {
					const raw = req.result;
					if (raw === undefined || raw === null) resolve(undefined);
					else if (raw instanceof Uint8Array) resolve(raw);
					else if (raw instanceof ArrayBuffer) resolve(new Uint8Array(raw));
					else resolve(undefined);
				};
				req.onerror = () => reject(req.error);
			});
		},
		async write(key, bytes) {
			const db = await cache;
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(spec.storeName, "readwrite");
				const store = tx.objectStore(spec.storeName);
				store.put(bytes, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error ?? new Error("indexedDbBackend: write aborted"));
			});
		},
		async delete(key) {
			const db = await cache;
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(spec.storeName, "readwrite");
				const store = tx.objectStore(spec.storeName);
				store.delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		},
		async list(prefix) {
			const db = await cache;
			return new Promise<readonly string[]>((resolve, reject) => {
				const tx = db.transaction(spec.storeName, "readonly");
				const store = tx.objectStore(spec.storeName);
				const req = store.getAllKeys();
				req.onsuccess = () => {
					const keys = (req.result as IDBValidKey[]).map((k) => String(k));
					resolve(
						prefix === undefined ? keys.sort() : keys.filter((k) => k.startsWith(prefix)).sort(),
					);
				};
				req.onerror = () => reject(req.error);
			});
		},
	};
}

/**
 * Creates an IndexedDB snapshot tier backed by an `indexedDbBackend`.
 *
 * Convenience wrapper for `snapshotStorage(indexedDbBackend(spec), opts)`.
 * All reads and writes are async via IndexedDB. Requires a browser or
 * browser-compatible environment.
 *
 * @param spec - Database name, object store name, and optional schema version.
 * @param opts - Optional snapshot storage options (name, codec, filter, keyOf, debounce, compactEvery).
 * @returns `SnapshotStorageTier<T>` backed by IndexedDB.
 *
 * @example
 * ```ts
 * import { indexedDbSnapshot } from "@graphrefly/graphrefly/extra/browser";
 *
 * const tier = indexedDbSnapshot<{ count: number }>(
 *   { dbName: "my-app", storeName: "snapshots" },
 *   { name: "counter" },
 * );
 * await tier.save({ count: 1 });
 * ```
 *
 * @category extra
 */
export function indexedDbSnapshot<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T> {
	return snapshotStorage<T>(indexedDbBackend(spec), opts);
}

/**
 * Creates an IndexedDB append-log tier backed by an `indexedDbBackend`.
 *
 * Convenience wrapper for `appendLogStorage(indexedDbBackend(spec), opts)`.
 * All reads and writes are async via IndexedDB. Requires a browser or
 * browser-compatible environment.
 *
 * @param spec - Database name, object store name, and optional schema version.
 * @param opts - Optional append-log storage options (name, codec, keyOf, debounce, compactEvery).
 * @returns `AppendLogStorageTier<T>` backed by IndexedDB.
 *
 * @example
 * ```ts
 * import { indexedDbAppendLog } from "@graphrefly/graphrefly/extra/browser";
 *
 * const tier = indexedDbAppendLog<{ type: string }>(
 *   { dbName: "my-app", storeName: "events" },
 * );
 * await tier.appendEntries([{ type: "init" }]);
 * ```
 *
 * @category extra
 */
export function indexedDbAppendLog<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T> {
	return appendLogStorage<T>(indexedDbBackend(spec), opts);
}

/**
 * Creates an IndexedDB key-value tier backed by an `indexedDbBackend`.
 *
 * Convenience wrapper for `kvStorage(indexedDbBackend(spec), opts)`.
 * All reads and writes are async via IndexedDB. Requires a browser or
 * browser-compatible environment.
 *
 * @param spec - Database name, object store name, and optional schema version.
 * @param opts - Optional kv storage options (name, codec, filter, debounce, compactEvery).
 * @returns `KvStorageTier<T>` backed by IndexedDB.
 *
 * @example
 * ```ts
 * import { indexedDbKv } from "@graphrefly/graphrefly/extra/browser";
 *
 * const kv = indexedDbKv<{ score: number }>(
 *   { dbName: "my-app", storeName: "scores" },
 * );
 * await kv.save("player1", { score: 100 });
 * const val = await kv.load("player1");
 * ```
 *
 * @category extra
 */
export function indexedDbKv<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> {
	return kvStorage<T>(indexedDbBackend(spec), opts);
}
