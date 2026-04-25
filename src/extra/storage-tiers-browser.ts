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
 * IndexedDB backend. Async by nature — `read` / `write` / `delete` / `list`
 * all return `Promise`.
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
 * IndexedDB snapshot tier — `snapshotStorage(indexedDbBackend(spec), opts)`.
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
 * IndexedDB append-log tier — `appendLogStorage(indexedDbBackend(spec), opts)`.
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
 * IndexedDB kv tier — `kvStorage(indexedDbBackend(spec), opts)`.
 *
 * @category extra
 */
export function indexedDbKv<T>(
	spec: IndexedDbBackendSpec,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> {
	return kvStorage<T>(indexedDbBackend(spec), opts);
}
