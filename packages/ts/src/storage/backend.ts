/**
 * Byte storage backends (D82): passive adapter-owned storage, no graph methods.
 */

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const NAMESPACE_SEPARATOR = "\u0000";

function cloneBytes(bytes: Uint8Array): Uint8Array {
	return Uint8Array.from(bytes);
}

function encodeNamespacePrefix(namespace: string): string {
	return namespace.length > 0 ? `${namespace}${NAMESPACE_SEPARATOR}` : "";
}

function encodeBytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) out += HEX_TABLE[byte];
	return out;
}

function decodeHexToBytes(raw: string): Uint8Array {
	if (raw.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(raw)) {
		throw new TypeError("webStorageBackend: malformed stored bytes");
	}
	const out = new Uint8Array(raw.length / 2);
	for (let i = 0; i < raw.length; i += 2) {
		const value = Number.parseInt(raw.slice(i, i + 2), 16);
		if (Number.isNaN(value)) throw new TypeError("webStorageBackend: malformed stored bytes");
		out[i / 2] = value;
	}
	return out;
}

/** Passive byte-addressed backend used by D82 storage binding tiers. */
export interface StorageBackend {
	get(key: string): undefined | Uint8Array | PromiseLike<undefined | Uint8Array>;
	put(key: string, value: Uint8Array): void | PromiseLike<void>;
	putIfAbsent?(key: string, value: Uint8Array): boolean | PromiseLike<boolean>;
	delete?(key: string): void | PromiseLike<void>;
	list?(prefix?: string): readonly string[] | PromiseLike<readonly string[]>;
}

/** Passive D85 conditional-create capability for multi-writer storage helpers. */
export interface PutIfAbsentStorageBackend extends StorageBackend {
	putIfAbsent(key: string, value: Uint8Array): boolean | PromiseLike<boolean>;
}

/** Runtime guard for D85 conditional-create capable byte backends. */
export function hasStoragePutIfAbsent(
	backend: StorageBackend,
): backend is PutIfAbsentStorageBackend {
	return typeof backend.putIfAbsent === "function";
}

/** Require D85 conditional-create support and produce a clear adapter error when absent. */
export function requireStoragePutIfAbsent(
	backend: StorageBackend,
	label = "storage backend",
): PutIfAbsentStorageBackend {
	if (!hasStoragePutIfAbsent(backend)) {
		throw new Error(`${label}: backend does not support putIfAbsent`);
	}
	return backend;
}

/** Browser/storage-adapter shape for deterministic byte helpers (DOM-free for portability). */
export interface WebStorageLike {
	readonly length?: number;
	getItem(key: string): string | null | undefined;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key?(index: number): string | null | undefined;
	keys?(): readonly string[];
}

/** Storage helper options for namespace isolation and logical-key prefixing. */
export interface StorageNamespaceOptions {
	/**
	 * Optional namespace for logical keys.
	 *
	 * Namespace is part of key mapping only and is not returned from `list()`.
	 */
	namespace?: string;
}

function toStorageKey(namespace: string, key: string): string {
	return `${encodeNamespacePrefix(namespace)}${key}`;
}

function enumerateStorageKeys(storage: WebStorageLike): readonly string[] {
	if (storage.keys) return [...storage.keys()];
	if (typeof storage.key === "function" && typeof storage.length === "number") {
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i += 1) {
			const key = storage.key(i);
			if (key !== null && key !== undefined) keys.push(key);
		}
		return keys;
	}
	const fallback = storage as unknown as Readonly<Record<string, unknown>>;
	return Object.keys(fallback).filter((key) => typeof fallback[key] === "string");
}

function decodeStorageListKey(namespace: string, rawKey: string): string | undefined {
	const prefix = encodeNamespacePrefix(namespace);
	if (!rawKey.startsWith(prefix)) return undefined;
	return rawKey.slice(prefix.length);
}

function listByPrefix(namespace: string, prefix: string, raw: readonly string[]): string[] {
	const out: string[] = [];
	for (const key of raw) {
		const logical = decodeStorageListKey(namespace, key);
		if (logical === undefined) continue;
		if (!logical.startsWith(prefix)) continue;
		out.push(logical);
	}
	out.sort();
	return out;
}

/** Build a deterministic byte backend backed by a browser-like key/value store (D103/D82). */
export function webStorageBackend(
	storage: WebStorageLike,
	opts: StorageNamespaceOptions = {},
): StorageBackend {
	const namespace = opts.namespace ?? "";
	return {
		get(key) {
			const raw = storage.getItem(toStorageKey(namespace, key));
			if (raw === null || raw === undefined) return undefined;
			return decodeHexToBytes(raw);
		},
		put(key, value) {
			storage.setItem(toStorageKey(namespace, key), encodeBytesToHex(cloneBytes(value)));
		},
		delete(key) {
			storage.removeItem(toStorageKey(namespace, key));
		},
		list(prefix = "") {
			return listByPrefix(namespace, prefix, enumerateStorageKeys(storage));
		},
	};
}

/** In-memory backend for tests, adapters, and lightweight local storage. */
export interface MemoryBackend extends StorageBackend {
	readonly entries: ReadonlyMap<string, Uint8Array>;
	clear(): void;
}

/** Create a byte-cloning in-memory backend. */
export function memoryBackend(
	initial: Iterable<readonly [string, Uint8Array]> = [],
): MemoryBackend {
	const entries = new Map<string, Uint8Array>();
	for (const [key, value] of initial) entries.set(key, cloneBytes(value));
	return {
		entries,
		get(key) {
			const value = entries.get(key);
			return value === undefined ? undefined : cloneBytes(value);
		},
		put(key, value) {
			entries.set(key, cloneBytes(value));
		},
		putIfAbsent(key, value) {
			if (entries.has(key)) return false;
			entries.set(key, cloneBytes(value));
			return true;
		},
		delete(key) {
			entries.delete(key);
		},
		list(prefix = "") {
			return [...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
		},
		clear() {
			entries.clear();
		},
	};
}
