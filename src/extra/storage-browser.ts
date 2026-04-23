/**
 * Browser-only storage backend + IndexedDB reactive sources.
 *
 * `indexedDbStorage` provides async {@link StorageTier} semantics backed by
 * IndexedDB; `fromIDBRequest` / `fromIDBTransaction` wrap raw IDB primitives
 * as reactive sources. Imports require the DOM lib — not safe to pull into
 * Node-only bundles without `lib: ["dom"]` in the consumer's tsconfig.
 *
 * The legacy `extra/storage.ts` barrel re-exports this module for back-compat;
 * browser-first consumers should import from here directly.
 *
 * @module
 */
/// <reference lib="dom" />

import { COMPLETE, DATA, ERROR } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { producer } from "../core/sugar.js";
import type { StorageTier } from "./storage-core.js";

export type IndexedDbStorageSpec = {
	dbName: string;
	storeName: string;
	/** Object-store key under which snapshots are written. @default `"graphrefly_checkpoint"`. */
	key?: string;
	version?: number;
};

/**
 * Wraps an `IDBRequest` as a one-shot reactive source.
 *
 * @param req - Request whose callbacks are converted to protocol messages.
 * @returns `Node<T>` that emits `DATA` once on success then `COMPLETE`;
 *   emits `ERROR` on failure.
 *
 * @category extra
 */
export function fromIDBRequest<T>(req: IDBRequest<T>): Node<T> {
	return producer<T>((a) => {
		let done = false;
		const clear = () => {
			req.onsuccess = null;
			req.onerror = null;
		};
		req.onsuccess = () => {
			if (done) return;
			done = true;
			clear();
			a.down([[DATA, req.result], [COMPLETE]]);
		};
		req.onerror = () => {
			if (done) return;
			done = true;
			clear();
			a.down([[ERROR, req.error ?? new Error("IndexedDB request failed")]]);
		};
		return () => {
			done = true;
			clear();
		};
	});
}

/**
 * Wraps an `IDBTransaction` terminal lifecycle as a one-shot reactive source.
 *
 * @param tx - Transaction to observe.
 * @returns `Node<void>` that emits `DATA` (`undefined`) then `COMPLETE` on
 *   success; emits `ERROR` on `error`/`abort`.
 *
 * @category extra
 */
export function fromIDBTransaction(tx: IDBTransaction): Node<void> {
	return producer<void>((a) => {
		let done = false;
		const clear = () => {
			tx.oncomplete = null;
			tx.onerror = null;
			tx.onabort = null;
		};
		tx.oncomplete = () => {
			if (done) return;
			done = true;
			clear();
			a.down([[DATA, undefined], [COMPLETE]]);
		};
		tx.onerror = () => {
			if (done) return;
			done = true;
			clear();
			a.down([[ERROR, tx.error ?? new Error("IndexedDB transaction failed")]]);
		};
		tx.onabort = () => {
			if (done) return;
			done = true;
			clear();
			a.down([[ERROR, tx.error ?? new Error("IndexedDB transaction aborted")]]);
		};
		return () => {
			done = true;
			clear();
		};
	});
}

function openIdb(dbName: string, storeName: string, version: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new TypeError("indexedDB is not available in this environment"));
			return;
		}
		const req = indexedDB.open(dbName, version);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
	});
}

function idbOp<T>(
	dbName: string,
	storeName: string,
	version: number,
	mode: IDBTransactionMode,
	op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return openIdb(dbName, storeName, version).then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(storeName, mode);
				const store = tx.objectStore(storeName);
				const req = op(store);
				let reqResult: T | undefined;
				let reqDone = false;
				let txDone = false;
				const finish = () => {
					if (!reqDone || !txDone) return;
					db.close();
					resolve(reqResult as T);
				};
				req.onsuccess = () => {
					reqResult = req.result;
					reqDone = true;
					finish();
				};
				req.onerror = () => {
					db.close();
					reject(req.error ?? new Error("IndexedDB request failed"));
				};
				tx.oncomplete = () => {
					txDone = true;
					if (!reqDone) {
						// Transaction completed without a request success callback —
						// spec guarantees this shouldn't happen for successful tx,
						// but defensively reject so the caller's promise doesn't
						// hang silently.
						db.close();
						reject(new Error("IndexedDB transaction completed without request result"));
						return;
					}
					finish();
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error ?? new Error("IndexedDB transaction failed"));
				};
				tx.onabort = () => {
					db.close();
					reject(tx.error ?? new Error("IndexedDB transaction aborted"));
				};
			}),
	);
}

/**
 * IndexedDB-backed async storage tier (browser runtime).
 *
 * All three methods return `Promise`s — pairs naturally with a warm/cold
 * cadence where async writes are debounced per tier via
 * `Graph.attachStorage`. Writes use `readwrite` transactions; reads use
 * `readonly`. Missing records resolve to `null`.
 *
 * @param spec - Database name, store name, optional `key` (default
 *   `"graphrefly_checkpoint"`) and schema `version` (default `1`).
 * @returns Async {@link StorageTier}.
 *
 * @example
 * ```ts
 * import { indexedDbStorage, memoryStorage } from "@graphrefly/graphrefly-ts";
 *
 * graph.attachStorage([
 *   memoryStorage(),
 *   indexedDbStorage({ dbName: "myApp", storeName: "checkpoints" }),
 * ]);
 * ```
 *
 * @category extra
 */
export function indexedDbStorage(spec: IndexedDbStorageSpec): StorageTier {
	const { dbName, storeName } = spec;
	const version = spec.version ?? 1;
	const recordKey = spec.key ?? "graphrefly_checkpoint";
	return {
		async save(_key, record) {
			await idbOp(dbName, storeName, version, "readwrite", (store) =>
				store.put(record as unknown as IDBValidKey, recordKey),
			);
		},
		async load(_key) {
			const raw = await idbOp(dbName, storeName, version, "readonly", (store) =>
				store.get(recordKey),
			);
			if (raw === undefined || raw === null) return null;
			if (typeof raw !== "object" || Array.isArray(raw)) return null;
			return raw;
		},
		async clear(_key) {
			await idbOp(dbName, storeName, version, "readwrite", (store) => store.delete(recordKey));
		},
	};
}
