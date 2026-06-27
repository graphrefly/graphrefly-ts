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
import type { StorageBackend, StorageGeneration, StorageNamespaceOptions } from "./backend.js";
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
const SQLITE_GENERATION = Symbol("graphrefly.sqliteBackend.generation");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const require = createRequire("/graphrefly-storage-node.js");

interface SqliteGeneration {
	readonly [SQLITE_GENERATION]: readonly [
		storageId: object,
		key: string,
		rowGeneration: number | null,
		epoch: number,
	];
}

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

function validateNamespace(label: string, namespace: string): string {
	if (typeof namespace !== "string") {
		throw new TypeError(`${label}: namespace must be a string`);
	}
	if (namespace.includes(NAMESPACE_SEPARATOR)) {
		throw new TypeError(`${label}: namespace must not contain U+0000`);
	}
	return namespace;
}

function validateLogicalKey(label: string, key: string): string {
	if (typeof key !== "string") {
		throw new TypeError(`${label}: key must be a string`);
	}
	if (key.includes(NAMESPACE_SEPARATOR)) {
		throw new TypeError(`${label}: key must not contain U+0000`);
	}
	return key;
}

function validateListPrefix(label: string, prefix: string): string {
	if (typeof prefix !== "string") {
		throw new TypeError(`${label}: list prefix must be a string`);
	}
	if (prefix.includes(NAMESPACE_SEPARATOR)) {
		throw new TypeError(`${label}: list prefix must not contain U+0000`);
	}
	return prefix;
}

function validateSqliteTableName(tableName: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
		throw new TypeError("sqliteBackend: tableName must be a simple SQLite identifier");
	}
	return tableName;
}

function sqliteGeneration(
	storageId: object,
	key: string,
	rowGeneration: number | null,
	epoch: number,
): SqliteGeneration {
	return Object.freeze({
		[SQLITE_GENERATION]: Object.freeze([storageId, key, rowGeneration, epoch] as const),
	});
}

function readSqliteGeneration(
	generation: StorageGeneration,
):
	| readonly [storageId: object, key: string, rowGeneration: number | null, epoch: number]
	| undefined {
	if (typeof generation !== "object" || generation === null) return undefined;
	const maybe = generation as Partial<SqliteGeneration>;
	const token = maybe[SQLITE_GENERATION];
	if (
		Array.isArray(token) &&
		token.length === 4 &&
		typeof token[0] === "object" &&
		token[0] !== null &&
		typeof token[1] === "string" &&
		(token[2] === null || typeof token[2] === "number") &&
		typeof token[3] === "number"
	) {
		return token as readonly [object, string, number | null, number];
	}
	return undefined;
}

function sqliteChanges(result: unknown): number {
	return typeof result === "object" &&
		result !== null &&
		"changes" in result &&
		typeof (result as { changes?: unknown }).changes === "number"
		? (result as { changes: number }).changes
		: 0;
}

function sqliteBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
	return Uint8Array.from(value instanceof Uint8Array ? value : new Uint8Array(value));
}

function loadSqliteDatabaseSync(): SqliteDatabaseConstructor {
	try {
		const DatabaseSync = (require("node:sqlite") as { DatabaseSync?: unknown }).DatabaseSync;
		if (typeof DatabaseSync !== "function") {
			throw new TypeError("DatabaseSync export is missing");
		}
		return DatabaseSync as SqliteDatabaseConstructor;
	} catch (error) {
		throw new Error("sqliteBackend: node:sqlite is not available in this Node runtime", {
			cause: error,
		});
	}
}

/** Node filesystem byte backend with atomic replace writes and D85 conditional create. */
export function fileBackend(dir: string, opts: FileBackendOptions = {}): StorageBackend {
	const extension = validateExtension(opts.extension ?? ".bin");
	const namespace =
		opts.namespace === undefined ? "" : validateNamespace("fileBackend", opts.namespace);
	const namespacePrefix = namespace.length > 0 ? `${namespace}${NAMESPACE_SEPARATOR}` : "";
	const storageKey = (key: string) => `${namespacePrefix}${validateLogicalKey("fileBackend", key)}`;
	const pathFor = (key: string) =>
		join(dir, `${FILE_STEM_PREFIX}${keyToStem(storageKey(key))}${extension}`);
	const keyFromFilename = (filename: string): string | null => {
		if (!filename.endsWith(extension)) return null;
		const stem = filename.slice(0, -extension.length);
		if (!stem.startsWith(FILE_STEM_PREFIX)) return null;
		const key = stemToKey(stem.slice(FILE_STEM_PREFIX.length));
		if (key === null || !key.startsWith(namespacePrefix)) return null;
		const logical = key.slice(namespacePrefix.length);
		if (logical.includes(NAMESPACE_SEPARATOR)) {
			throw new TypeError("fileBackend: malformed stored key");
		}
		return logical;
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
			const validatedPrefix = validateListPrefix("fileBackend", prefix);
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
				if (key?.startsWith(validatedPrefix)) keys.push(key);
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
	const metaTable = validateSqliteTableName(`${table}_meta`);
	const namespace =
		opts.namespace === undefined ? "" : validateNamespace("sqliteBackend", opts.namespace);
	const DatabaseSync = loadSqliteDatabaseSync();
	const namespacePrefix = namespace.length > 0 ? `${namespace}${NAMESPACE_SEPARATOR}` : "";
	const storageKey = (key: string) =>
		`${namespacePrefix}${validateLogicalKey("sqliteBackend", key)}`;
	const storageId = Object.freeze({});
	const logicalKey = (key: string): string | undefined => {
		if (typeof key !== "string") {
			throw new TypeError("sqliteBackend: stored key is corrupt");
		}
		if (!key.startsWith(namespacePrefix)) return undefined;
		const logical = key.slice(namespacePrefix.length);
		if (logical.includes(NAMESPACE_SEPARATOR)) {
			throw new TypeError("sqliteBackend: malformed stored key");
		}
		return logical;
	};
	const db = new DatabaseSync(path);
	db.exec(
		`CREATE TABLE IF NOT EXISTS ${table} (k TEXT PRIMARY KEY, v BLOB NOT NULL, g INTEGER NOT NULL DEFAULT 0)`,
	);
	const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
	if (!columns.some((column) => column.name === "g")) {
		db.exec(`ALTER TABLE ${table} ADD COLUMN g INTEGER NOT NULL DEFAULT 0`);
	}
	db.exec(`CREATE TABLE IF NOT EXISTS ${metaTable} (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`);
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS ${table}_generation_insert
		AFTER INSERT ON ${table}
		BEGIN
			INSERT INTO ${metaTable} (k, v) VALUES (NEW.k, 1)
			ON CONFLICT(k) DO UPDATE SET v = ${metaTable}.v + 1;
		END
	`);
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS ${table}_generation_update
		AFTER UPDATE ON ${table}
		BEGIN
			INSERT INTO ${metaTable} (k, v) VALUES (NEW.k, 1)
			ON CONFLICT(k) DO UPDATE SET v = ${metaTable}.v + 1;
		END
	`);
	db.exec(`
		CREATE TRIGGER IF NOT EXISTS ${table}_generation_delete
		AFTER DELETE ON ${table}
		BEGIN
			INSERT INTO ${metaTable} (k, v) VALUES (OLD.k, 1)
			ON CONFLICT(k) DO UPDATE SET v = ${metaTable}.v + 1;
		END
	`);

	const keyEpoch = (key: string): number => {
		const row = db.prepare(`SELECT v FROM ${metaTable} WHERE k = ?`).get(key) as
			| { v?: number }
			| undefined;
		const value = row?.v ?? 0;
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
			throw new Error("sqliteBackend: per-key generation epoch is corrupt");
		}
		return value;
	};
	const readRow = (
		key: string,
	):
		| {
				readonly value: Uint8Array;
				readonly generation: number;
		  }
		| undefined => {
		const row = db.prepare(`SELECT v, g FROM ${table} WHERE k = ?`).get(storageKey(key)) as
			| { v?: Uint8Array | ArrayBuffer; g?: number }
			| undefined;
		if (row?.v === undefined) return undefined;
		const generation = row.g;
		if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0) {
			throw new Error("sqliteBackend: row generation is corrupt");
		}
		return { value: sqliteBytes(row.v), generation };
	};

	return {
		name: `sqlite:${path}/${table}`,
		get(key) {
			return readRow(key)?.value;
		},
		put(key, value) {
			db.prepare(
				`INSERT INTO ${table} (k, v, g) VALUES (?, ?, 0) ON CONFLICT(k) DO UPDATE SET v = excluded.v, g = ${table}.g + 1`,
			).run(storageKey(key), value);
		},
		putIfAbsent(key, value) {
			const result = db
				.prepare(`INSERT OR IGNORE INTO ${table} (k, v, g) VALUES (?, ?, 0)`)
				.run(storageKey(key), value) as { changes?: number };
			return sqliteChanges(result) === 1;
		},
		getVersioned(key) {
			const row = readRow(key);
			if (row === undefined) {
				return {
					kind: "miss",
					generation: sqliteGeneration(storageId, storageKey(key), null, keyEpoch(storageKey(key))),
				};
			}
			return {
				kind: "hit",
				value: row.value,
				generation: sqliteGeneration(
					storageId,
					storageKey(key),
					row.generation,
					keyEpoch(storageKey(key)),
				),
			};
		},
		setIfMatch(key, value, generation) {
			const keyForStorage = storageKey(key);
			const observed = readSqliteGeneration(generation);
			if (observed === undefined || observed[0] !== storageId || observed[1] !== keyForStorage) {
				return false;
			}
			if (observed[2] === null) {
				return (
					sqliteChanges(
						db
							.prepare(
								`INSERT INTO ${table} (k, v, g) SELECT ?, ?, 0 WHERE COALESCE((SELECT v FROM ${metaTable} WHERE k = ?), 0) = ? AND NOT EXISTS (SELECT 1 FROM ${table} WHERE k = ?)`,
							)
							.run(keyForStorage, value, keyForStorage, observed[3], keyForStorage),
					) === 1
				);
			}
			return (
				sqliteChanges(
					db
						.prepare(
							`UPDATE ${table} SET v = ?, g = g + 1 WHERE k = ? AND g = ? AND COALESCE((SELECT v FROM ${metaTable} WHERE k = ?), 0) = ?`,
						)
						.run(value, keyForStorage, observed[2], keyForStorage, observed[3]),
				) === 1
			);
		},
		delete(key) {
			db.prepare(`DELETE FROM ${table} WHERE k = ?`).run(storageKey(key));
		},
		list(prefix = "") {
			const validatedPrefix = validateListPrefix("sqliteBackend", prefix);
			const rows = db.prepare(`SELECT k FROM ${table} ORDER BY k`).all() as { k: string }[];
			const out: string[] = [];
			for (const row of rows) {
				const key = logicalKey(row.k);
				if (key?.startsWith(validatedPrefix)) out.push(key);
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
