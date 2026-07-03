/**
 * Browser-only passive storage backend (D103).
 *
 * Uses DOM IndexedDB to provide async byte storage, no graph methods.
 */

/// <reference lib="dom" />

import { type AppendLogStorageTier, appendLogStorage } from "./append-log.js";
import type { StorageBackend } from "./backend.js";
import type { Codec } from "./codec.js";
import { type KvStorageOptions, type KvStorageTier, kvStorage } from "./kv.js";

export type IndexedDbBackendSpec = {
	dbName: string;
	storeName: string;
	version?: number;
};

export interface NamedIndexedDbBackend extends StorageBackend {
	readonly name: string;
}

type IndexedDbError = DOMException | Error;

function isConstraintError(error: unknown): error is DOMException {
	return error instanceof DOMException && error.name === "ConstraintError";
}

function validateKey(key: string): string {
	if (typeof key !== "string") {
		throw new TypeError("indexedDbBackend: key must be a string");
	}
	return key;
}

function validateListPrefix(prefix: string): string {
	if (typeof prefix !== "string") {
		throw new TypeError("indexedDbBackend: list prefix must be a string");
	}
	return prefix;
}

function decodeStoredBytes(raw: unknown): Uint8Array | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (raw instanceof Uint8Array) return Uint8Array.from(raw);
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw.slice(0));
	throw new TypeError("indexedDbBackend: malformed stored bytes");
}

function normalizeKeys(prefix: string, raw: unknown[]): string[] {
	const out: string[] = [];
	for (const key of raw) {
		if (typeof key !== "string") {
			throw new TypeError("indexedDbBackend: stored key must be a string");
		}
		if (key.startsWith(prefix)) out.push(key);
	}
	out.sort();
	return out;
}

function openDb(spec: IndexedDbBackendSpec, version = spec.version): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new TypeError("indexedDbBackend: indexedDB is not available in this environment"));
			return;
		}
		const req =
			version === undefined ? indexedDB.open(spec.dbName) : indexedDB.open(spec.dbName, version);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(spec.storeName)) {
				db.createObjectStore(spec.storeName);
			}
		};
		req.onblocked = () =>
			reject(
				new Error("indexedDbBackend: open blocked; close existing database connections and retry"),
			);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new TypeError("indexedDbBackend: open failed"));
	});
}

function openDbWithStore(spec: IndexedDbBackendSpec): Promise<IDBDatabase> {
	return openDb(spec).then((db) => {
		if (db.objectStoreNames.contains(spec.storeName)) return db;
		if (spec.version !== undefined) {
			db.close();
			throw new Error(
				`indexedDbBackend: object store "${spec.storeName}" is missing; bump the IndexedDB version to create it`,
			);
		}
		const nextVersion = db.version + 1;
		db.close();
		return openDb(spec, nextVersion).then((upgraded) => {
			if (upgraded.objectStoreNames.contains(spec.storeName)) return upgraded;
			upgraded.close();
			throw new Error(`indexedDbBackend: object store "${spec.storeName}" was not created`);
		});
	});
}

export type IndexedDbKvOptions<T> = Omit<KvStorageOptions<T>, "backend">;

export interface IndexedDbAppendLogOptions<T> {
	/** Optional append-log key prefix. */
	prefix?: string;
	/** Optional payload codec before persistence. */
	codec?: Codec<T>;
}

/**
 * Creates an IndexedDB backend for browser environments.
 *
 * All methods are async (`Promise`) and do not cross graph layer boundaries.
 */
export function indexedDbBackend(spec: IndexedDbBackendSpec): NamedIndexedDbBackend {
	let dbCache: Promise<IDBDatabase> | undefined;
	const db = (): Promise<IDBDatabase> => {
		if (dbCache !== undefined) return dbCache;
		const attempt = openDbWithStore(spec);
		const cached = attempt.catch((error) => {
			if (dbCache === cached) dbCache = undefined;
			throw error;
		});
		dbCache = cached;
		return dbCache;
	};
	return {
		name: `idb:${spec.dbName}/${spec.storeName}`,
		get(key) {
			validateKey(key);
			return db().then(
				(database) =>
					new Promise<Uint8Array | undefined>((resolve, reject) => {
						try {
							const tx = database.transaction(spec.storeName, "readonly");
							const store = tx.objectStore(spec.storeName);
							const req = store.get(key);
							req.onsuccess = () => {
								try {
									resolve(decodeStoredBytes(req.result));
								} catch (error) {
									reject(error as IndexedDbError);
								}
							};
							req.onerror = () => reject(req.error ?? new Error("indexedDbBackend: read failed"));
							tx.onabort = () =>
								reject(tx.error ?? new Error("indexedDbBackend: read transaction aborted"));
							tx.oncomplete = () => {
								/* read resolved already; no-op */
							};
						} catch (error) {
							reject(error as IndexedDbError);
						}
					}),
			);
		},
		put(key, value) {
			validateKey(key);
			return db().then(
				(database) =>
					new Promise<void>((resolve, reject) => {
						try {
							const tx = database.transaction(spec.storeName, "readwrite");
							const store = tx.objectStore(spec.storeName);
							const req = store.put(value, key);
							req.onerror = () => reject(req.error ?? new Error("indexedDbBackend: write failed"));
							tx.oncomplete = () => resolve();
							tx.onabort = () =>
								reject(tx.error ?? new Error("indexedDbBackend: write transaction aborted"));
							tx.onerror = () =>
								reject(tx.error ?? new Error("indexedDbBackend: write transaction failed"));
						} catch (error) {
							reject(error as IndexedDbError);
						}
					}),
			);
		},
		putIfAbsent(key, value) {
			validateKey(key);
			return db().then(
				(database) =>
					new Promise<boolean>((resolve, reject) => {
						let requestOk = false;
						let requestConflict = false;
						let requestError: unknown;
						let settled = false;
						const settle = (fn: () => void): void => {
							if (settled) return;
							settled = true;
							fn();
						};
						try {
							const tx = database.transaction(spec.storeName, "readwrite");
							const store = tx.objectStore(spec.storeName);
							const req = store.add(value, key);
							req.onsuccess = () => {
								requestOk = true;
							};
							req.onerror = (event) => {
								const error = req.error;
								if (isConstraintError(error)) {
									requestConflict = true;
									event.preventDefault();
									return;
								}
								requestError = error ?? new Error("indexedDbBackend: write-if-absent failed");
							};
							tx.oncomplete = () =>
								settle(() => {
									if (requestConflict) {
										resolve(false);
									} else if (requestOk) {
										resolve(true);
									} else {
										reject(
											requestError ??
												new Error("indexedDbBackend: write-if-absent did not complete"),
										);
									}
								});
							tx.onabort = () => {
								const error = tx.error;
								if (isConstraintError(error)) {
									settle(() => resolve(false));
									return;
								}
								settle(() =>
									reject(
										requestError ??
											tx.error ??
											new Error("indexedDbBackend: write-if-absent transaction aborted"),
									),
								);
							};
							tx.onerror = () => {
								const error = tx.error;
								if (isConstraintError(error)) {
									settle(() => resolve(false));
									return;
								}
								settle(() =>
									reject(
										requestError ??
											error ??
											new Error("indexedDbBackend: write-if-absent transaction failed"),
									),
								);
							};
						} catch (error) {
							settle(() => reject(error as IndexedDbError));
						}
					}),
			);
		},
		delete(key) {
			validateKey(key);
			return db().then(
				(database) =>
					new Promise<void>((resolve, reject) => {
						try {
							const tx = database.transaction(spec.storeName, "readwrite");
							const store = tx.objectStore(spec.storeName);
							const req = store.delete(key);
							req.onerror = () => reject(req.error ?? new Error("indexedDbBackend: delete failed"));
							tx.oncomplete = () => resolve();
							tx.onabort = () =>
								reject(tx.error ?? new Error("indexedDbBackend: delete transaction aborted"));
							tx.onerror = () =>
								reject(tx.error ?? new Error("indexedDbBackend: delete transaction failed"));
						} catch (error) {
							reject(error as IndexedDbError);
						}
					}),
			);
		},
		list(prefix = "") {
			const validatedPrefix = validateListPrefix(prefix);
			return db().then(
				(database) =>
					new Promise<readonly string[]>((resolve, reject) => {
						try {
							const tx = database.transaction(spec.storeName, "readonly");
							const store = tx.objectStore(spec.storeName);
							const req = store.getAllKeys();
							req.onsuccess = () => {
								try {
									resolve(normalizeKeys(validatedPrefix, req.result));
								} catch (error) {
									reject(error as IndexedDbError);
								}
							};
							req.onerror = () => reject(req.error ?? new Error("indexedDbBackend: list failed"));
							tx.onabort = () =>
								reject(tx.error ?? new Error("indexedDbBackend: list transaction aborted"));
						} catch (error) {
							reject(error as IndexedDbError);
						}
					}),
			);
		},
	};
}

/**
 * Creates an IndexedDB-backed KV storage tier.
 */
export function indexedDbKv<T>(
	spec: IndexedDbBackendSpec,
	opts: IndexedDbKvOptions<T> = {},
): KvStorageTier<T> {
	return kvStorage<T>({ backend: indexedDbBackend(spec), ...opts });
}

/**
 * Creates an IndexedDB-backed append-log storage tier.
 */
export function indexedDbAppendLog<T>(
	spec: IndexedDbBackendSpec,
	opts: IndexedDbAppendLogOptions<T> = {},
): AppendLogStorageTier<T> {
	const kv = kvStorage<T>({
		backend: indexedDbBackend(spec),
		codec: opts.codec,
	});
	return appendLogStorage<T>({ kv, prefix: opts.prefix ?? "append-log" });
}
