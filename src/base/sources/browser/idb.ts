/**
 * Browser-only IndexedDB reactive sources.
 *
 * `fromIDBRequest` / `fromIDBTransaction` wrap raw IDB primitives as reactive
 * sources. The old `indexedDbStorage` kv adapter has been replaced by
 * `indexedDbKv` in `./storage-tiers-browser.js` (Audit 4, 2026-04-24).
 *
 * Imports require the DOM lib — not safe to pull into Node-only bundles
 * without `lib: ["dom"]` in the consumer's tsconfig.
 *
 * @module
 */
/// <reference lib="dom" />

import { COMPLETE, DATA, ERROR } from "@graphrefly/pure-ts/core";
import { type Node, node } from "@graphrefly/pure-ts/core";

// IndexedDbStorageSpec is no longer needed here — it's defined in storage-tiers-browser.ts.

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
	return node<T>((_data, a) => {
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
	return node<void>((_data, a) => {
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

// The old `indexedDbStorage` kv adapter has been removed.
// Use `indexedDbKv` from `./storage-tiers-browser.js` instead (Audit 4, 2026-04-24).
