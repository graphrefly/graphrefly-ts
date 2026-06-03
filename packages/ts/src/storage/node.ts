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
import { basename, dirname, join } from "node:path";
import type { StorageBackend, StorageNamespaceOptions } from "./backend.js";

export interface FileBackendOptions extends StorageNamespaceOptions {
	/** File suffix used for stored byte blobs. Defaults to `.bin`. */
	extension?: string;
}

const FILE_STEM_PREFIX = "k-";
const NAMESPACE_SEPARATOR = "\u0000";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

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
