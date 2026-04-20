/**
 * Storage tier primitive — unified persistence surface (roadmap §3.1).
 *
 * A {@link StorageTier} is the single abstraction used by:
 * - {@link Graph.attachStorage} — snapshot cascade with per-tier cadence
 * - {@link Graph.fromStorage} — hot-boot from the first tier that hits
 * - {@link cascadingCache} — keyed lookup cache with auto-promotion
 *
 * Factory functions cover the common backends: {@link memoryStorage},
 * {@link dictStorage}, {@link fileStorage}, {@link sqliteStorage} (sync), and
 * {@link indexedDbStorage} (async). {@link fromIDBRequest} /
 * {@link fromIDBTransaction} wrap raw IndexedDB primitives as reactive sources
 * — they belong here as the browser-runtime neighbors of `indexedDbStorage`.
 */
/// <reference lib="dom" />

import { randomBytes } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { COMPLETE, DATA, ERROR } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { producer } from "../core/sugar.js";

/**
 * Single persistence primitive — supports sync and async backends alike via
 * `void | Promise<void>` returns. `debounceMs` / `compactEvery` / `filter`
 * are per-tier cadence controls honored by {@link Graph.attachStorage};
 * {@link cascadingCache} ignores them (it has its own eviction policy).
 */
export interface StorageTier {
	/** Read a value. Returns `null` (or resolves to `null`) on miss. */
	load(key: string): unknown | Promise<unknown>;
	/** Write a record. Sync tiers return `void`; async tiers return `Promise<void>`. */
	save(key: string, data: unknown): void | Promise<void>;
	/** Delete a value. Optional — tiers without `clear` are append/overwrite-only. */
	clear?(key: string): void | Promise<void>;
	/**
	 * Enumerate known keys. Optional — tiers that only address a single record
	 * (e.g. `indexedDbStorage`) or that can't cheaply enumerate (e.g. a remote
	 * write-only sink) may omit it. Callers that require enumeration (the
	 * surface `snapshot.list()` helper, MCP `graphrefly_snapshot_list`, CLI
	 * `graphrefly snapshot list`) should check before calling.
	 */
	list?(): readonly string[] | Promise<readonly string[]>;
	/**
	 * Debounce saves on this tier (ms). Hot tier: `0` (sync-through).
	 * Warm: `1000`. Cold: `60000`. Each tier holds its own last-save baseline,
	 * so cold flushes aren't penalized by hot flushes.
	 */
	debounceMs?: number;
	/**
	 * Every Nth record is a full snapshot; others are diffs against this
	 * tier's own baseline. Default `10`. Set `1` for always-full;
	 * `Number.POSITIVE_INFINITY` is unsafe — WAL replay needs periodic anchors.
	 */
	compactEvery?: number;
	/** Pre-save filter — return `false` to skip this record on this tier. */
	filter?: (key: string, record: unknown) => boolean;
}

/** Handle returned by {@link Graph.attachStorage} — dispose to stop observing. */
export interface StorageHandle {
	dispose(): void;
}

function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(sortJsonValue);
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) out[k] = sortJsonValue(obj[k]);
	return out;
}

function stableJsonString(data: unknown): string {
	// No trailing newline — tiers that want POSIX newline convention (e.g.
	// fileStorage) append their own; in-database tiers (sqliteStorage) keep
	// the payload byte-identical for cross-tier hash/CID comparison.
	return JSON.stringify(sortJsonValue(data), undefined, 0);
}

/**
 * In-memory storage tier (process-local; useful for tests and hot tier).
 *
 * @returns Sync {@link StorageTier} with JSON-cloned isolation.
 *
 * @example
 * ```ts
 * import { memoryStorage } from "@graphrefly/graphrefly-ts";
 *
 * const hot = memoryStorage();
 * graph.attachStorage([hot]);
 * ```
 *
 * @category extra
 */
export function memoryStorage(): StorageTier {
	const data = new Map<string, unknown>();
	return {
		save(key, record) {
			data.set(key, JSON.parse(JSON.stringify(record)));
		},
		load(key) {
			const v = data.get(key);
			return v === undefined ? null : JSON.parse(JSON.stringify(v));
		},
		clear(key) {
			data.delete(key);
		},
		list() {
			return [...data.keys()].sort();
		},
	};
}

/**
 * Dict-backed storage tier — stores JSON-cloned values under caller keys in
 * a caller-owned plain object. Useful for embedding in a parent state shape.
 *
 * @param storage - Caller-owned object used as the backing store.
 * @returns Sync {@link StorageTier}.
 *
 * @example
 * ```ts
 * import { dictStorage } from "@graphrefly/graphrefly-ts";
 *
 * const state: Record<string, unknown> = {};
 * graph.attachStorage([dictStorage(state)]);
 * ```
 *
 * @category extra
 */
export function dictStorage(storage: Record<string, unknown>): StorageTier {
	return {
		save(key, record) {
			storage[key] = JSON.parse(JSON.stringify(record));
		},
		load(key) {
			const raw = storage[key];
			return raw === undefined ? null : JSON.parse(JSON.stringify(raw));
		},
		clear(key) {
			delete storage[key];
		},
		list() {
			return Object.keys(storage).sort();
		},
	};
}

/**
 * Atomic JSON file storage tier (one file per key in a directory, temp + rename).
 *
 * Keys are sanitized to filesystem-safe names (`[^a-zA-Z0-9_-]` → `%<hex>`).
 * `load` returns `null` for missing files, empty files, or invalid JSON.
 *
 * @param dir - Directory where per-key JSON files are written.
 * @returns Sync {@link StorageTier}.
 *
 * @example
 * ```ts
 * import { fileStorage, memoryStorage } from "@graphrefly/graphrefly-ts";
 *
 * graph.attachStorage([memoryStorage(), fileStorage("./checkpoints")]);
 * ```
 *
 * @category extra
 */
export function fileStorage(dir: string): StorageTier {
	// Encoder: keep `[a-zA-Z0-9_-]` literal (cross-platform-safe filename
	// chars); everything else — including dot, slash, and all non-ASCII —
	// gets UTF-8-encoded and percent-escaped per byte. This guarantees
	// round-trip for arbitrary Unicode snapshot ids (e.g. paths with
	// `/`, dots, or non-ASCII text): encode → filename → list() → decode
	// yields the original key.
	const encoder = new TextEncoder();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const pathFor = (key: string): string => {
		let out = "";
		for (const ch of key) {
			if (ch.length === 1 && /[a-zA-Z0-9_-]/.test(ch)) {
				out += ch;
				continue;
			}
			for (const byte of encoder.encode(ch)) {
				out += `%${byte.toString(16).padStart(2, "0")}`;
			}
		}
		return join(dir, `${out}.json`);
	};
	const keyFromFilename = (filename: string): string | null => {
		if (!filename.endsWith(".json")) return null;
		const stem = filename.slice(0, -".json".length);
		// Walk the stem, collecting raw bytes from `%HH` sequences so the
		// decoder can reassemble multi-byte UTF-8 characters correctly.
		const bytes: number[] = [];
		const encodeAscii = (s: string): void => {
			for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
		};
		let i = 0;
		while (i < stem.length) {
			const ch = stem[i]!;
			if (ch === "%" && i + 2 < stem.length) {
				const hex = stem.slice(i + 1, i + 3);
				if (/^[0-9a-f]{2}$/i.test(hex)) {
					bytes.push(Number.parseInt(hex, 16));
					i += 3;
					continue;
				}
			}
			encodeAscii(ch);
			i += 1;
		}
		try {
			return decoder.decode(new Uint8Array(bytes));
		} catch {
			// Invalid UTF-8 byte sequence — filename wasn't produced by
			// our encoder. Skip rather than round-trip a lossy string.
			return null;
		}
	};
	return {
		save(key, record) {
			mkdirSync(dir, { recursive: true });
			const filePath = pathFor(key);
			// POSIX newline for file-on-disk convention; does not affect payload hash.
			const payload = `${stableJsonString(record)}\n`;
			const base = basename(filePath);
			const d = dirname(filePath);
			const tmp = join(d, `.${base}.${randomBytes(8).toString("hex")}.tmp`);
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
		},
		load(key) {
			try {
				const text = readFileSync(pathFor(key), "utf8").trim();
				if (!text) return null;
				return JSON.parse(text) as unknown;
			} catch {
				return null;
			}
		},
		clear(key) {
			try {
				unlinkSync(pathFor(key));
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			}
		},
		list() {
			try {
				const entries = readdirSync(dir);
				const keys: string[] = [];
				for (const entry of entries) {
					if (entry.startsWith(".")) continue;
					const k = keyFromFilename(entry);
					if (k !== null) keys.push(k);
				}
				return keys.sort();
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw e;
			}
		},
	};
}

/**
 * SQLite storage tier using Node.js `node:sqlite` ({@link DatabaseSync}).
 *
 * Returns a {@link StorageTier} extended with `close()` — the caller owns the
 * connection and should close it when discarding the tier.
 *
 * **Runtime:** Requires Node 22.5+ with `node:sqlite` enabled.
 *
 * @param path - SQLite database file path.
 * @returns Sync {@link StorageTier} with an idempotent `close()` method.
 *
 * @example
 * ```ts
 * import { sqliteStorage, memoryStorage } from "@graphrefly/graphrefly-ts";
 *
 * const cold = sqliteStorage("./graphs.sqlite");
 * graph.attachStorage([memoryStorage(), cold]);
 * // ... later, on shutdown:
 * cold.close();
 * ```
 *
 * @category extra
 */
export function sqliteStorage(path: string): StorageTier & { close(): void } {
	const db = new DatabaseSync(path);
	db.exec(`CREATE TABLE IF NOT EXISTS graphrefly_checkpoint (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
	return {
		save(key, record) {
			const payload = stableJsonString(record);
			db.prepare(`INSERT OR REPLACE INTO graphrefly_checkpoint (k, v) VALUES (?, ?)`).run(
				key,
				payload,
			);
		},
		load(key) {
			const row = db.prepare(`SELECT v FROM graphrefly_checkpoint WHERE k = ?`).get(key) as
				| { v: string }
				| undefined;
			if (row === undefined || typeof row.v !== "string" || row.v.trim() === "") return null;
			return JSON.parse(row.v) as unknown;
		},
		clear(key) {
			db.prepare(`DELETE FROM graphrefly_checkpoint WHERE k = ?`).run(key);
		},
		list() {
			const rows = db.prepare(`SELECT k FROM graphrefly_checkpoint ORDER BY k`).all() as {
				k: string;
			}[];
			return rows.map((r) => r.k);
		},
		close() {
			try {
				db.close();
			} catch {
				/* already closed */
			}
		},
	};
}

// ——————————————————————————————————————————————————————————————
//  IndexedDB — async storage tier + raw reactive sources
// ——————————————————————————————————————————————————————————————

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
 * {@link Graph.attachStorage}. Writes use `readwrite` transactions; reads use
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
