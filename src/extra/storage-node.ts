/**
 * Node-only storage backends — `fileStorage` (atomic per-key JSON files) and
 * `sqliteStorage` (Node 22.5+ `node:sqlite`). Imports `node:fs`, `node:path`,
 * `node:crypto`, `node:sqlite`.
 *
 * Browser-safe consumers should import {@link ./storage-core} instead; the
 * legacy `extra/storage.ts` barrel re-exports this module for back-compat.
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
import { type StorageTier, stableJsonString } from "./storage-core.js";

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
