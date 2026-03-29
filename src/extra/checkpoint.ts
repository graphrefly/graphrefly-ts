/**
 * Checkpoint adapters and {@link Graph} save/restore helpers (roadmap §3.1).
 */
/// <reference lib="dom" />

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Node } from "../core/node.js";
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

function stableSnapshotJson(data: GraphPersistSnapshot): string {
	return `${JSON.stringify(sortJsonValue(data), undefined, 0)}\n`;
}

/**
 * Persists {@link GraphPersistSnapshot} blobs (single save/load contract, roadmap §3.1).
 */
export interface CheckpointAdapter {
	save(data: GraphPersistSnapshot): void;
	load(): GraphPersistSnapshot | null;
}

/**
 * In-memory adapter (process-local; useful for tests).
 *
 * @category extra
 */
export class MemoryCheckpointAdapter implements CheckpointAdapter {
	#data: GraphPersistSnapshot | null = null;

	save(data: GraphPersistSnapshot): void {
		this.#data = JSON.parse(JSON.stringify(data)) as GraphPersistSnapshot;
	}

	load(): GraphPersistSnapshot | null {
		return this.#data === null
			? null
			: (JSON.parse(JSON.stringify(this.#data)) as GraphPersistSnapshot);
	}
}

/**
 * Stores JSON-cloned snapshots under a key inside a caller-owned record (tests / embedding).
 *
 * @category extra
 */
export class DictCheckpointAdapter implements CheckpointAdapter {
	readonly #storage: Record<string, unknown>;
	readonly #key: string;

	constructor(storage: Record<string, unknown>, key = "graphrefly_checkpoint") {
		this.#storage = storage;
		this.#key = key;
	}

	save(data: GraphPersistSnapshot): void {
		this.#storage[this.#key] = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
	}

	load(): GraphPersistSnapshot | null {
		const raw = this.#storage[this.#key];
		return raw !== null && typeof raw === "object" && !Array.isArray(raw)
			? (JSON.parse(JSON.stringify(raw)) as GraphPersistSnapshot)
			: null;
	}
}

/**
 * Atomic JSON file persistence (temp file in the target directory, then `rename`).
 *
 * @remarks
 * **Errors:** `load()` returns `null` for missing files, empty files, or invalid JSON (no throw).
 *
 * @category extra
 */
export class FileCheckpointAdapter implements CheckpointAdapter {
	readonly #path: string;

	constructor(path: string) {
		this.#path = path;
	}

	save(data: GraphPersistSnapshot): void {
		const dir = dirname(this.#path);
		mkdirSync(dir, { recursive: true });
		const payload = stableSnapshotJson(data);
		const base = basename(this.#path);
		const tmp = join(dir, `.${base}.${randomBytes(8).toString("hex")}.tmp`);
		try {
			writeFileSync(tmp, payload, "utf8");
			renameSync(tmp, this.#path);
		} catch (e) {
			try {
				unlinkSync(tmp);
			} catch {
				/* ignore */
			}
			throw e;
		}
	}

	load(): GraphPersistSnapshot | null {
		try {
			const text = readFileSync(this.#path, "utf8").trim();
			if (!text) return null;
			const data = JSON.parse(text) as unknown;
			return data !== null && typeof data === "object" && !Array.isArray(data)
				? (data as GraphPersistSnapshot)
				: null;
		} catch {
			return null;
		}
	}
}

/**
 * Persists one JSON blob under a fixed key using Node.js `node:sqlite` ({@link DatabaseSync}).
 *
 * @remarks
 * **Runtime:** Requires Node 22.5+ with `node:sqlite` enabled (experimental in some releases). Call `close()` when discarding the adapter.
 *
 * @category extra
 */
export class SqliteCheckpointAdapter implements CheckpointAdapter {
	readonly #db: DatabaseSync;
	readonly #key: string;

	constructor(path: string, key = "graphrefly_checkpoint") {
		this.#db = new DatabaseSync(path);
		this.#key = key;
		this.#db.exec(
			`CREATE TABLE IF NOT EXISTS graphrefly_checkpoint (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
		);
	}

	save(data: GraphPersistSnapshot): void {
		const payload = stableSnapshotJson(data).trimEnd();
		this.#db
			.prepare(`INSERT OR REPLACE INTO graphrefly_checkpoint (k, v) VALUES (?, ?)`)
			.run(this.#key, payload);
	}

	load(): GraphPersistSnapshot | null {
		const row = this.#db
			.prepare(`SELECT v FROM graphrefly_checkpoint WHERE k = ?`)
			.get(this.#key) as { v: string } | undefined;
		if (row === undefined || typeof row.v !== "string" || row.v.trim() === "") return null;
		const parsed = JSON.parse(row.v) as unknown;
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as GraphPersistSnapshot)
			: null;
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
 * Writes {@link Graph.snapshot} through `adapter.save`.
 *
 * @param graph - Target graph instance.
 * @param adapter - Sync persistence backend.
 *
 * @category extra
 */
export function saveGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): void {
	adapter.save(graph.snapshot());
}

/**
 * Loads a snapshot via `adapter.load` and applies {@link Graph.restore} when data exists.
 *
 * @param graph - Graph whose topology matches the snapshot.
 * @param adapter - Sync persistence backend.
 * @returns `true` if data was present and `restore` ran; `false` if `load()` returned `null`.
 *
 * @category extra
 */
export function restoreGraphCheckpoint(graph: Graph, adapter: CheckpointAdapter): boolean {
	const data = adapter.load();
	if (data === null) return false;
	graph.restore(data);
	return true;
}

/**
 * Minimal JSON-shaped payload for a single node's cached value (custom adapters).
 *
 * @param n - Any {@link Node}.
 * @returns `{ version: 1, value }` from {@link Node.get}.
 *
 * @category extra
 */
export function checkpointNodeValue<T>(n: Node<T>): { version: number; value: T | undefined } {
	return { version: 1, value: n.get() };
}

export type IndexedDbCheckpointSpec = {
	dbName: string;
	storeName: string;
	/** @default "graphrefly_checkpoint" */
	key?: string;
	version?: number;
};

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
	});
}

function idbTxComplete(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
		tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
	});
}

function openIdb(dbName: string, storeName: string, version: number): Promise<IDBDatabase> {
	if (typeof indexedDB === "undefined") {
		return Promise.reject(new TypeError("indexedDB is not available in this environment"));
	}
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(dbName, version);
		req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
			}
		};
	});
}

/**
 * Persists {@link Graph.snapshot} under `spec.key` (browser IndexedDB).
 *
 * @param graph - Graph to snapshot.
 * @param spec - Database name, object store name, optional `key` and schema `version`.
 *
 * @remarks
 * **Environment:** Throws if `indexedDB` is undefined (Node tests).
 *
 * @category extra
 */
export async function saveGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Promise<void> {
	const key = spec.key ?? "graphrefly_checkpoint";
	const db = await openIdb(spec.dbName, spec.storeName, spec.version ?? 1);
	try {
		const tx = db.transaction(spec.storeName, "readwrite");
		const store = tx.objectStore(spec.storeName);
		const done = idbTxComplete(tx);
		await idbRequest(store.put(graph.snapshot(), key));
		await done;
	} finally {
		db.close();
	}
}

/**
 * Loads a snapshot from IndexedDB and applies {@link Graph.restore} when present.
 *
 * @param graph - Graph whose topology matches the stored snapshot.
 * @param spec - Same `dbName` / `storeName` / `key` / `version` as save.
 * @returns `true` if a value existed and was restored.
 *
 * @category extra
 */
export async function restoreGraphCheckpointIndexedDb(
	graph: Graph,
	spec: IndexedDbCheckpointSpec,
): Promise<boolean> {
	const key = spec.key ?? "graphrefly_checkpoint";
	const db = await openIdb(spec.dbName, spec.storeName, spec.version ?? 1);
	try {
		const tx = db.transaction(spec.storeName, "readonly");
		const store = tx.objectStore(spec.storeName);
		const done = idbTxComplete(tx);
		const raw = await idbRequest(store.get(key));
		await done;
		if (raw === undefined || raw === null) return false;
		if (typeof raw !== "object" || Array.isArray(raw)) return false;
		graph.restore(raw as GraphPersistSnapshot);
		return true;
	} finally {
		db.close();
	}
}
