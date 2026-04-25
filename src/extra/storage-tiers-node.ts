/**
 * Node-only Audit 4 storage backends + convenience factories.
 *
 * Imports `node:fs`, `node:path`, `node:crypto`, `node:sqlite`. Browser-safe
 * consumers should not import this module.
 *
 * @module
 */

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

// ── File backend ─────────────────────────────────────────────────────────

/**
 * Filesystem backend. Each key becomes a file under `dir`; values are written
 * via temp + rename for atomic replace.
 *
 * @category extra
 */
export function fileBackend(dir: string): StorageBackend {
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
		return join(dir, `${out}.bin`);
	};
	const keyFromFilename = (filename: string): string | null => {
		if (!filename.endsWith(".bin")) return null;
		const stem = filename.slice(0, -".bin".length);
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
			return null;
		}
	};
	return {
		name: `file:${dir}`,
		read(key) {
			try {
				const buf = readFileSync(pathFor(key));
				return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
			} catch {
				return undefined;
			}
		},
		write(key, bytes) {
			mkdirSync(dir, { recursive: true });
			const filePath = pathFor(key);
			const base = basename(filePath);
			const d = dirname(filePath);
			const tmp = join(d, `.${base}.${randomBytes(8).toString("hex")}.tmp`);
			try {
				writeFileSync(tmp, bytes);
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
		delete(key) {
			try {
				unlinkSync(pathFor(key));
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			}
		},
		list(prefix) {
			try {
				const entries = readdirSync(dir);
				const keys: string[] = [];
				for (const entry of entries) {
					if (entry.startsWith(".")) continue;
					const k = keyFromFilename(entry);
					if (k === null) continue;
					if (prefix !== undefined && !k.startsWith(prefix)) continue;
					keys.push(k);
				}
				return keys.sort();
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw e;
			}
		},
	};
}

// ── SQLite backend ───────────────────────────────────────────────────────

/**
 * SQLite backend (Node 22.5+ `node:sqlite`). Stores byte values under string
 * keys in a single table; caller owns the connection lifetime via `close()`.
 *
 * @category extra
 */
export function sqliteBackend(path: string): StorageBackend & { close(): void } {
	const db = new DatabaseSync(path);
	db.exec(`CREATE TABLE IF NOT EXISTS graphrefly_storage (k TEXT PRIMARY KEY, v BLOB NOT NULL)`);
	return {
		name: `sqlite:${path}`,
		read(key) {
			const row = db.prepare(`SELECT v FROM graphrefly_storage WHERE k = ?`).get(key) as
				| { v: Uint8Array }
				| undefined;
			return row?.v;
		},
		write(key, bytes) {
			db.prepare(`INSERT OR REPLACE INTO graphrefly_storage (k, v) VALUES (?, ?)`).run(key, bytes);
		},
		delete(key) {
			db.prepare(`DELETE FROM graphrefly_storage WHERE k = ?`).run(key);
		},
		list(prefix) {
			if (prefix === undefined) {
				const rows = db.prepare(`SELECT k FROM graphrefly_storage ORDER BY k`).all() as {
					k: string;
				}[];
				return rows.map((r) => r.k);
			}
			// M7: escape SQLite LIKE wildcards (`%` and `_`) and the escape
			// char itself so a user-supplied prefix can't match more rows
			// than intended (e.g. prefix `"snap%"` should NOT match `"snapXshot"`).
			const escaped = prefix.replace(/[\\%_]/g, "\\$&");
			const rows = db
				.prepare(`SELECT k FROM graphrefly_storage WHERE k LIKE ? ESCAPE '\\' ORDER BY k`)
				.all(`${escaped}%`) as { k: string }[];
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

// ── Convenience factories ───────────────────────────────────────────────

/**
 * Filesystem snapshot tier — `snapshotStorage(fileBackend(dir), opts)`.
 *
 * @category extra
 */
export function fileSnapshot<T>(
	dir: string,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T> {
	return snapshotStorage<T>(fileBackend(dir), opts);
}

/**
 * Filesystem append-log tier — `appendLogStorage(fileBackend(dir), opts)`.
 *
 * @category extra
 */
export function fileAppendLog<T>(
	dir: string,
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T> {
	return appendLogStorage<T>(fileBackend(dir), opts);
}

/**
 * SQLite snapshot tier — caller owns the connection. Use the underlying
 * backend's `close()` for explicit teardown.
 *
 * @category extra
 */
export function sqliteSnapshot<T>(
	path: string,
	opts?: Omit<SnapshotStorageOptions<T>, "name"> & { name?: string },
): SnapshotStorageTier<T> & { close(): void } {
	const backend = sqliteBackend(path);
	const tier = snapshotStorage<T>(backend, opts);
	return Object.assign(tier, { close: () => backend.close() });
}

/**
 * SQLite append-log tier — caller owns the connection. Use the underlying
 * backend's `close()` for explicit teardown.
 *
 * @category extra
 */
export function sqliteAppendLog<T>(
	path: string,
	opts?: Omit<AppendLogStorageOptions<T>, "name"> & { name?: string },
): AppendLogStorageTier<T> & { close(): void } {
	const backend = sqliteBackend(path);
	const tier = appendLogStorage<T>(backend, opts);
	return Object.assign(tier, { close: () => backend.close() });
}

/**
 * Filesystem kv tier — `kvStorage(fileBackend(dir), opts)`.
 *
 * @category extra
 */
export function fileKv<T>(
	dir: string,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> {
	return kvStorage<T>(fileBackend(dir), opts);
}

/**
 * SQLite kv tier — caller owns the connection. Use the underlying
 * backend's `close()` for explicit teardown.
 *
 * @category extra
 */
export function sqliteKv<T>(
	path: string,
	opts?: Omit<KvStorageOptions<T>, "name"> & { name?: string },
): KvStorageTier<T> & { close(): void } {
	const backend = sqliteBackend(path);
	const tier = kvStorage<T>(backend, opts);
	return Object.assign(tier, { close: () => backend.close() });
}
