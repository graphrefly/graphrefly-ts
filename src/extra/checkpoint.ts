/**
 * Checkpoint adapters and {@link Graph} save/restore helpers (roadmap §3.1).
 */
/// <reference lib="dom" />

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { COMPLETE, DATA, ERROR } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { producer } from "../core/sugar.js";
import type { Graph, GraphPersistSnapshot } from "../graph/graph.js";

function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		out[k] = sortJsonValue(obj[k]);
	}
	return out;
}

function stableJsonString(data: unknown): string {
	return `${JSON.stringify(sortJsonValue(data), undefined, 0)}\n`;
}

/**
 * Key-value persistence contract (roadmap §3.1 + §3.1c).
 *
 * Each adapter stores opaque JSON-serializable blobs under caller-provided string keys.
 * Used by {@link saveGraphCheckpoint}/{@link restoreGraphCheckpoint} (key = graph name),
 * {@link Graph.autoCheckpoint} (key = graph name), and {@link cascadingCache}/{@link tieredStorage}
 * (key = cache entry key).
 */
export interface CheckpointAdapter {
	save(key: string, data: unknown): void;
	load(key: string): unknown | null;
	clear(key: string): void;
}

/**
 * In-memory adapter (process-local; useful for tests).
 *
 * @category extra
 */
export class MemoryCheckpointAdapter implements CheckpointAdapter {
	readonly #data = new Map<string, unknown>();

	save(key: string, data: unknown): void {
		this.#data.set(key, JSON.parse(JSON.stringify(data)));
	}

	load(key: string): unknown | null {
		const v = this.#data.get(key);
		return v === undefined ? null : JSON.parse(JSON.stringify(v));
	}

	clear(key: string): void {
		this.#data.delete(key);
	}
}

/**
 * Stores JSON-cloned values under caller keys inside a caller-owned record (tests / embedding).
 *
 * @category extra
 */
export class DictCheckpointAdapter implements CheckpointAdapter {
	readonly #storage: Record<string, unknown>;

	constructor(storage: Record<string, unknown>) {
		this.#storage = storage;
	}

	save(key: string, data: unknown): void {
		this.#storage[key] = JSON.parse(JSON.stringify(data));
	}

	load(key: string): unknown | null {
		const raw = this.#storage[key];
		return raw === undefined ? null : JSON.parse(JSON.stringify(raw));
	}

	clear(key: string): void {
		delete this.#storage[key];
	}
}

/**
 * Atomic JSON file persistence (one file per key in a directory, temp + rename).
 *
 * @remarks
 * **Key mapping:** keys are sanitized to filesystem-safe names (`[^a-zA-Z0-9_-]` → `_`).
 * **Errors:** `load()` returns `null` for missing files, empty files, or invalid JSON (no throw).
 *
 * @category extra
 */
export class FileCheckpointAdapter implements CheckpointAdapter {
	readonly #dir: string;

	constructor(dir: string) {
		this.#dir = dir;
	}

	#pathFor(key: string): string {
		const safeName = key.replace(
			/[^a-zA-Z0-9_-]/g,
			(c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
		);
		return join(this.#dir, `${safeName}.json`);
	}

	save(key: string, data: unknown): void {
		mkdirSync(this.#dir, { recursive: true });
		const filePath = this.#pathFor(key);
		const payload = stableJsonString(data);
		const base = basename(filePath);
		const dir = dirname(filePath);
		const tmp = join(dir, `.${base}.${randomBytes(8).toString("hex")}.tmp`);
		try {
			writeFileSync(tmp, payload, "utf8");
			renameSync(tmp, filePath);
		} catch (e) {
			try {
				unlinkSync(tmp);
			} catch {
				/* ignore */
			}
			throw e;
		}
	}

	load(key: string): unknown | null {
		try {
			const text = readFileSync(this.#pathFor(key), "utf8").trim();
			if (!text) return null;
			return JSON.parse(text) as unknown;
		} catch {
			return null;
		}
	}

	clear(key: string): void {
		try {
			unlinkSync(this.#pathFor(key));
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		}
	}
}

/**
 * Key-value persistence using Node.js `node:sqlite` ({@link DatabaseSync}).
 *
 * @remarks
 * **Runtime:** Requires Node 22.5+ with `node:sqlite` enabled (experimental in some releases). Call `close()` when discarding the adapter.
 *
 * @category extra
 */
export class SqliteCheckpointAdapter implements CheckpointAdapter {
	readonly #db: DatabaseSync;

	constructor(path: string) {
		this.#db = new DatabaseSync(path);
		this.#db.exec(
			`CREATE TABLE IF NOT EXISTS graphrefly_checkpoint (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
		);
	}

	save(key: string, data: unknown): void {
		const payload = stableJsonString(data).trimEnd();
		this.#db
			.prepare(`INSERT OR REPLACE INTO graphrefly_checkpoint (k, v) VALUES (?, ?)`)
			.run(key, payload);
	}

	load(key: string): unknown | null {
		const row = this.#db.prepare(`SELECT v FROM graphrefly_checkpoint WHERE k = ?`).get(key) as
			| { v: string }
			| undefined;
		if (row === undefined || typeof row.v !== "string" || row.v.trim() === "") return null;
		return JSON.parse(row.v) as unknown;
	}

	clear(key: string): void {
		this.#db.prepare(`DELETE FROM graphrefly_checkpoint WHERE k = ?`).run(key);
	}

	/** Close the underlying SQLite connection (safe to call more than once). */
	close(): void {
		try {
			this.#db.close();
		} catch {
			/* ignore if already closed */
		}
	}
}

/**
 * Writes {@link Graph.snapshot} through `adapter.save` using `graph.name` as key.
 *
 * @param graph - Target graph instance.
 * @param adapter - Sync key-value persistence backend.
 * @returns `void` — side-effect only; the snapshot is written to `adapter`.
 *
 * @example
 * ```ts
 * import { saveGraphCheckpoint, MemoryCheckpointAdapter, Graph } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * const adapter = new MemoryCheckpointAdapter();
 * saveGraphCheckpoint(g, adapter);
 * ```
 *
 * @category extra
 */
export function saveGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): void {
	adapter.save(graph.name, graph.snapshot());
}

/**
 * Loads a snapshot via `adapter.load(graph.name)` and applies {@link Graph.restore} when data exists.
 *
 * @param graph - Graph whose topology matches the snapshot.
 * @param adapter - Sync key-value persistence backend.
 * @returns `true` if data was present and `restore` ran; `false` if `load()` returned `null`.
 *
 * @example
 * ```ts
 * import {
 *   saveGraphCheckpoint,
 *   restoreGraphCheckpoint,
 *   MemoryCheckpointAdapter,
 *   Graph,
 * } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * const adapter = new MemoryCheckpointAdapter();
 * saveGraphCheckpoint(g, adapter);
 *
 * const g2 = new Graph("app");
 * restoreGraphCheckpoint(g2, adapter); // true
 * ```
 *
 * @category extra
 */
export function restoreGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): boolean {
	const data = adapter.load(graph.name);
	if (data === null) return false;
	graph.restore(data as GraphPersistSnapshot);
	return true;
}

/**
 * Minimal JSON-shaped payload for a single node's cached value (custom adapters).
 *
 * @param n - Any {@link Node}.
 * @returns `{ version: 1, value }` from {@link Node.get}.
 *
 * @example
 * ```ts
 * import { checkpointNodeValue, state } from "@graphrefly/graphrefly-ts";
 *
 * const s = state(42);
 * checkpointNodeValue(s); // { version: 1, value: 42 }
 * ```
 *
 * @category extra
 */
export function checkpointNodeValue<T>(n: Node<T>): {
	version: number;
	value: T | undefined | null;
} {
	return { version: 1, value: n.cache };
}

export type IndexedDbCheckpointSpec = {
	dbName: string;
	storeName: string;
	/** @default "graphrefly_checkpoint" */
	key?: string;
	version?: number;
};

/**
 * Wraps an `IDBRequest` as a one-shot reactive source.
 *
 * @param req - Request whose callbacks are converted to protocol messages.
 * @returns `Node<T>` that emits `DATA` once on success, then `COMPLETE`; emits `ERROR` on failure.
 *
 * @example
 * ```ts
 * import { fromIDBRequest } from "@graphrefly/graphrefly-ts";
 *
 * const req = indexedDB.open("myDb", 1);
 * fromIDBRequest(req).subscribe((msgs) => console.log(msgs));
 * // Emits [[DATA, IDBDatabase], [COMPLETE]] on success
 * ```
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
 * @returns `Node<void>` that emits `DATA` (`undefined`) then `COMPLETE` on success; emits `ERROR` on `error`/`abort`.
 *
 * @example
 * ```ts
 * import { fromIDBTransaction } from "@graphrefly/graphrefly-ts";
 *
 * const db: IDBDatabase = ...; // obtained from indexedDB.open
 * const tx = db.transaction("store", "readwrite");
 * fromIDBTransaction(tx).subscribe((msgs) => console.log(msgs));
 * // Emits [[DATA, undefined], [COMPLETE]] when the transaction commits
 * ```
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

function openIdbNode(dbName: string, storeName: string, version: number): Node<IDBDatabase> {
	return producer<IDBDatabase>((a) => {
		if (typeof indexedDB === "undefined") {
			a.down([[ERROR, new TypeError("indexedDB is not available in this environment")]]);
			return undefined;
		}
		const req = indexedDB.open(dbName, version);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
			}
		};
		const unsub = fromIDBRequest(req).subscribe((msgs) => a.down(msgs));
		return () => {
			unsub();
		};
	});
}

/**
 * Persists {@link Graph.snapshot} under `spec.key` (browser IndexedDB).
 *
 * @param graph - Graph to snapshot.
 * @param spec - Database name, object store name, optional `key` and schema `version`.
 * @returns A reactive `Node<void>` that emits `DATA` (`undefined`) then `COMPLETE` on success, or `ERROR` on failure.
 *
 * @remarks
 * **Environment:** Emits `ERROR` if `indexedDB` is undefined (e.g. Node without a polyfill).
 *
 * @example
 * ```ts
 * import { saveGraphCheckpointIndexedDb, Graph } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * const save$ = saveGraphCheckpointIndexedDb(g, {
 *   dbName: "myApp",
 *   storeName: "checkpoints",
 * });
 * save$.subscribe((msgs) => console.log("saved:", msgs));
 * ```
 *
 * @category extra
 */
export function saveGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Node<void> {
	const key = spec.key ?? "graphrefly_checkpoint";
	return producer<void>((a) => {
		let db: IDBDatabase | undefined;
		let opUnsub: (() => void) | undefined;
		let done = false;
		const close = () => {
			if (db === undefined) return;
			db.close();
			db = undefined;
		};
		const finishWith = (msgs: [symbol, unknown?][]) => {
			if (done) return;
			done = true;
			a.down(msgs);
			opUnsub?.();
			opUnsub = undefined;
			openUnsub();
			close();
		};
		const startWrite = () => {
			if (db === undefined || opUnsub !== undefined) return;
			const tx = db.transaction(spec.storeName, "readwrite");
			const store = tx.objectStore(spec.storeName);
			let reqDone = false;
			let txDone = false;
			let reqError: unknown;
			let unsubReq: (() => void) | undefined;
			let unsubTx: (() => void) | undefined;
			const maybeFinish = () => {
				if (reqError !== undefined) {
					finishWith([[ERROR, reqError]]);
					return;
				}
				if (!reqDone || !txDone) return;
				finishWith([[DATA, undefined], [COMPLETE]]);
			};
			unsubReq = fromIDBRequest(store.put(graph.snapshot(), key)).subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === ERROR) reqError = m[1];
					if (m[0] === COMPLETE || m[0] === ERROR) reqDone = true;
				}
				maybeFinish();
			});
			unsubTx = fromIDBTransaction(tx).subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === ERROR) {
						finishWith([[ERROR, m[1]]]);
						return;
					}
					if (m[0] === COMPLETE) txDone = true;
				}
				maybeFinish();
			});
			opUnsub = () => {
				unsubReq?.();
				unsubReq = undefined;
				unsubTx?.();
				unsubTx = undefined;
			};
		};
		const openUnsub = openIdbNode(spec.dbName, spec.storeName, spec.version ?? 1).subscribe(
			(msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						db = m[1] as IDBDatabase;
						startWrite();
						continue;
					}
					if (m[0] === ERROR) {
						finishWith([[ERROR, m[1]]]);
						return;
					}
				}
			},
		);
		return () => {
			opUnsub?.();
			opUnsub = undefined;
			openUnsub();
			close();
		};
	});
}

/**
 * Loads a snapshot from IndexedDB and applies {@link Graph.restore} when present.
 *
 * @param graph - Graph whose topology matches the stored snapshot.
 * @param spec - Same `dbName` / `storeName` / `key` / `version` as save.
 * @returns A reactive `Node<boolean>`: emits `true` if a snapshot was restored, `false` if missing or not a plain object, then `COMPLETE`; or `ERROR` on I/O failure.
 *
 * @example
 * ```ts
 * import { restoreGraphCheckpointIndexedDb, Graph } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * const restore$ = restoreGraphCheckpointIndexedDb(g, {
 *   dbName: "myApp",
 *   storeName: "checkpoints",
 * });
 * restore$.subscribe((msgs) => console.log("restored:", msgs));
 * // Emits [[DATA, true], [COMPLETE]] if a snapshot was found and applied
 * ```
 *
 * @category extra
 */
export function restoreGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Node<boolean> {
	const key = spec.key ?? "graphrefly_checkpoint";
	return producer<boolean>((a) => {
		let db: IDBDatabase | undefined;
		let reqUnsub: (() => void) | undefined;
		let txUnsub: (() => void) | undefined;
		let done = false;
		let txDone = false;
		let requestDone = false;
		let requestValue: unknown;
		let requestError: unknown;
		const close = () => {
			if (db === undefined) return;
			db.close();
			db = undefined;
		};
		const finishWith = (msgs: [symbol, unknown?][]) => {
			if (done) return;
			done = true;
			a.down(msgs);
			reqUnsub?.();
			reqUnsub = undefined;
			txUnsub?.();
			txUnsub = undefined;
			openUnsub();
			close();
		};
		const maybeEmitResult = () => {
			if (!requestDone || !txDone) return;
			if (requestError !== undefined) {
				finishWith([[ERROR, requestError]]);
				return;
			}
			if (requestValue === undefined || requestValue === null) {
				finishWith([[DATA, false], [COMPLETE]]);
				return;
			}
			if (typeof requestValue !== "object" || Array.isArray(requestValue)) {
				finishWith([[DATA, false], [COMPLETE]]);
				return;
			}
			graph.restore(requestValue as GraphPersistSnapshot);
			finishWith([[DATA, true], [COMPLETE]]);
		};
		const startRead = () => {
			if (db === undefined || reqUnsub !== undefined || txUnsub !== undefined) return;
			const tx = db.transaction(spec.storeName, "readonly");
			const store = tx.objectStore(spec.storeName);
			reqUnsub = fromIDBRequest(store.get(key)).subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) requestValue = m[1];
					if (m[0] === ERROR) requestError = m[1];
					if (m[0] === COMPLETE || m[0] === ERROR) requestDone = true;
				}
				maybeEmitResult();
			});
			txUnsub = fromIDBTransaction(tx).subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === ERROR) {
						finishWith([[ERROR, m[1]]]);
						return;
					}
					if (m[0] === COMPLETE) txDone = true;
				}
				maybeEmitResult();
			});
		};
		const openUnsub = openIdbNode(spec.dbName, spec.storeName, spec.version ?? 1).subscribe(
			(msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						db = m[1] as IDBDatabase;
						startRead();
						continue;
					}
					if (m[0] === ERROR) {
						finishWith([[ERROR, m[1]]]);
						return;
					}
				}
			},
		);
		return () => {
			reqUnsub?.();
			reqUnsub = undefined;
			txUnsub?.();
			txUnsub = undefined;
			openUnsub();
			close();
		};
	});
}
