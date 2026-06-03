/**
 * Node-only passive storage backends (D103).
 *
 * Import from `@graphrefly/ts/storage/node`; the universal storage barrel stays browser-safe.
 */

import { randomBytes } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { type AppendLogStorageTier, appendLogStorage } from "./append-log.js";
import type { StorageBackend, StorageNamespaceOptions } from "./backend.js";
import type { Codec } from "./codec.js";
import { type KvStorageTier, kvStorage } from "./kv.js";

export interface FileBackendOptions extends StorageNamespaceOptions {
	/** File suffix used for stored byte blobs. Defaults to `.bin`. */
	extension?: string;
}

export interface FileKvOptions<T> extends FileBackendOptions {
	codec?: Codec<T>;
}

export interface FileAppendLogOptions<T> extends FileKvOptions<T> {
	/** Append-log key prefix. Defaults to `event-log`. */
	prefix?: string;
}

export interface SqliteBackendOptions extends StorageNamespaceOptions {
	/** Table name used for passive byte storage. Defaults to `graphrefly_storage`. */
	tableName?: string;
}

export interface SqliteKvOptions<T> extends SqliteBackendOptions {
	codec?: Codec<T>;
}

export interface SqliteAppendLogOptions<T> extends SqliteKvOptions<T> {
	/** Append-log key prefix. Defaults to `event-log`. */
	prefix?: string;
}

export interface ClosableStorageBackend extends StorageBackend {
	readonly name: string;
	close(): void;
}

type SqliteDatabaseConstructor = new (path: string) => SqliteDatabase;

interface SqliteDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

interface SqliteStatement {
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): unknown;
	all(...params: unknown[]): unknown[];
}

const FILE_STEM_PREFIX = "k-";
const NAMESPACE_SEPARATOR = "\u0000";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const require = createRequire("/graphrefly-storage-node.js");

function isErrno(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

function keyToStem(key: string): string {
	let out = "";
	for (const ch of key) {
		if (/^[a-zA-Z0-9_-]$/.test(ch)) {
			out += ch;
			continue;
		}
		for (const byte of encoder.encode(ch)) out += `%${byte.toString(16).padStart(2, "0")}`;
	}
	return out;
}

function stemToKey(stem: string): string | null {
	const bytes: number[] = [];
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
		const code = ch.charCodeAt(0);
		if (code > 0x7f) return null;
		bytes.push(code);
		i += 1;
	}
	try {
		return decoder.decode(new Uint8Array(bytes));
	} catch {
		return null;
	}
}

function validateExtension(extension: string): string {
	if (
		extension.length < 2 ||
		!extension.startsWith(".") ||
		extension.includes("..") ||
		/[/\\\0]/.test(extension) ||
		!/^[.A-Za-z0-9_-]+$/.test(extension)
	) {
		throw new TypeError("fileBackend: extension must be a simple suffix such as .bin");
	}
	return extension;
}

function validateSqliteTableName(tableName: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
		throw new TypeError("sqliteBackend: tableName must be a simple SQLite identifier");
	}
	return tableName;
}

function loadSqliteDatabaseSync(): SqliteDatabaseConstructor {
	try {
		return (require("node:sqlite") as { DatabaseSync: SqliteDatabaseConstructor }).DatabaseSync;
	} catch (error) {
		throw new Error("sqliteBackend: node:sqlite is not available in this Node runtime", {
			cause: error,
		});
	}
}

/** Node filesystem byte backend with atomic replace writes and D85 conditional create. */
export function fileBackend(dir: string, opts: FileBackendOptions = {}): StorageBackend {
	const extension = validateExtension(opts.extension ?? ".bin");
	const namespace = opts.namespace ?? "";
	const namespacePrefix = namespace.length > 0 ? `${namespace}${NAMESPACE_SEPARATOR}` : "";
	const storageKey = (key: string) => `${namespacePrefix}${key}`;
	const pathFor = (key: string) =>
		join(dir, `${FILE_STEM_PREFIX}${keyToStem(storageKey(key))}${extension}`);
	const keyFromFilename = (filename: string): string | null => {
		if (!filename.endsWith(extension)) return null;
		const stem = filename.slice(0, -extension.length);
		if (!stem.startsWith(FILE_STEM_PREFIX)) return null;
		const key = stemToKey(stem.slice(FILE_STEM_PREFIX.length));
		if (key === null || !key.startsWith(namespacePrefix)) return null;
		return key.slice(namespacePrefix.length);
	};

	return {
		get(key) {
			try {
				return Uint8Array.from(readFileSync(pathFor(key)));
			} catch (error) {
				if (isErrno(error, "ENOENT")) return undefined;
				throw error;
			}
		},
		put(key, value) {
			mkdirSync(dir, { recursive: true });
			const filePath = pathFor(key);
			const base = basename(filePath);
			const parent = dirname(filePath);
			const tmp = join(parent, `.${base}.${randomBytes(8).toString("hex")}.tmp`);
			try {
				writeFileSync(tmp, value);
				renameSync(tmp, filePath);
			} catch (error) {
				try {
					unlinkSync(tmp);
				} catch {
					// Ignore cleanup failures; the original write error is the useful one.
				}
				throw error;
			}
		},
		putIfAbsent(key, value) {
			mkdirSync(dir, { recursive: true });
			const filePath = pathFor(key);
			let fd: number | undefined;
			try {
				fd = openSync(filePath, "wx");
				writeFileSync(fd, value);
				return true;
			} catch (error) {
				if (isErrno(error, "EEXIST")) return false;
				if (fd !== undefined) {
					try {
						unlinkSync(filePath);
					} catch {
						// Best effort cleanup of a partially-created file.
					}
				}
				throw error;
			} finally {
				if (fd !== undefined) closeSync(fd);
			}
		},
		delete(key) {
			try {
				unlinkSync(pathFor(key));
			} catch (error) {
				if (!isErrno(error, "ENOENT")) throw error;
			}
		},
		list(prefix = "") {
			let entries: string[];
			try {
				entries = readdirSync(dir);
			} catch (error) {
				if (isErrno(error, "ENOENT")) return [];
				throw error;
			}
			const keys: string[] = [];
			for (const entry of entries) {
				if (entry.startsWith(".")) continue;
				const key = keyFromFilename(entry);
				if (key?.startsWith(prefix)) keys.push(key);
			}
			return keys.sort();
		},
	};
}

/**
 * Create a typed KV tier over a Node filesystem backend (D106 passive storage).
 */
export function fileKv<T>(dir: string, opts: FileKvOptions<T> = {}): KvStorageTier<T> {
	return kvStorage<T>({
		backend: fileBackend(dir, opts),
		codec: opts.codec,
	});
}

/**
 * Create an append-log tier over a Node filesystem backend (D106 passive storage).
 */
export function fileAppendLog<T>(
	dir: string,
	opts: FileAppendLogOptions<T> = {},
): AppendLogStorageTier<T> {
	return appendLogStorage<T>({
		kv: fileKv<T>(dir, opts),
		prefix: opts.prefix ?? "event-log",
	});
}

/**
 * Optional Node SQLite byte backend (D106 passive storage).
 *
 * Uses `node:sqlite` when the current Node runtime provides it; otherwise throws a clear
 * runtime error at construction time. The caller owns `close()`.
 */
export function sqliteBackend(
	path: string,
	opts: SqliteBackendOptions = {},
): ClosableStorageBackend {
	const table = validateSqliteTableName(opts.tableName ?? "graphrefly_storage");
	const DatabaseSync = loadSqliteDatabaseSync();
	const namespace = opts.namespace ?? "";
	const namespacePrefix = namespace.length > 0 ? `${namespace}${NAMESPACE_SEPARATOR}` : "";
	const storageKey = (key: string) => `${namespacePrefix}${key}`;
	const logicalKey = (key: string): string | undefined => {
		if (!key.startsWith(namespacePrefix)) return undefined;
		return key.slice(namespacePrefix.length);
	};
	const db = new DatabaseSync(path);
	db.exec(`CREATE TABLE IF NOT EXISTS ${table} (k TEXT PRIMARY KEY, v BLOB NOT NULL)`);

	return {
		name: `sqlite:${path}/${table}`,
		get(key) {
			const row = db.prepare(`SELECT v FROM ${table} WHERE k = ?`).get(storageKey(key)) as
				| { v?: Uint8Array | ArrayBuffer }
				| undefined;
			const value = row?.v;
			if (value === undefined) return undefined;
			return value instanceof Uint8Array ? value : new Uint8Array(value);
		},
		put(key, value) {
			db.prepare(`INSERT OR REPLACE INTO ${table} (k, v) VALUES (?, ?)`).run(
				storageKey(key),
				value,
			);
		},
		putIfAbsent(key, value) {
			const result = db
				.prepare(`INSERT OR IGNORE INTO ${table} (k, v) VALUES (?, ?)`)
				.run(storageKey(key), value) as { changes?: number };
			return result.changes === 1;
		},
		delete(key) {
			db.prepare(`DELETE FROM ${table} WHERE k = ?`).run(storageKey(key));
		},
		list(prefix = "") {
			const rows = db.prepare(`SELECT k FROM ${table} ORDER BY k`).all() as { k: string }[];
			const out: string[] = [];
			for (const row of rows) {
				const key = logicalKey(row.k);
				if (key?.startsWith(prefix)) out.push(key);
			}
			return out.sort();
		},
		close() {
			db.close();
		},
	};
}

/**
 * Create a typed KV tier over an optional Node SQLite backend.
 */
export function sqliteKv<T>(
	path: string,
	opts: SqliteKvOptions<T> = {},
): KvStorageTier<T> & { close(): void } {
	const backend = sqliteBackend(path, opts);
	const tier = kvStorage<T>({
		backend,
		codec: opts.codec,
	});
	return Object.assign(tier, { close: () => backend.close() });
}

/**
 * Create an append-log tier over an optional Node SQLite backend.
 */
export function sqliteAppendLog<T>(
	path: string,
	opts: SqliteAppendLogOptions<T> = {},
): AppendLogStorageTier<T> & { close(): void } {
	const kv = sqliteKv<T>(path, opts);
	const log = appendLogStorage<T>({ kv, prefix: opts.prefix ?? "event-log" });
	return Object.assign(log, { close: () => kv.close() });
}
