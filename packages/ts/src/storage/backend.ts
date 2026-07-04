/**
 * Byte storage backends (D82): passive adapter-owned storage, no graph methods.
 */

import { decodeStoragePhysicalKey, storagePhysicalKey } from "./physical-key.js";

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function cloneBytes(bytes: Uint8Array): Uint8Array {
	return Uint8Array.from(bytes);
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

function validateLogicalKey(label: string, key: string): string {
	if (typeof key !== "string") {
		throw new TypeError(`${label}: key must be a string`);
	}
	return key;
}

function validateListPrefix(label: string, prefix: string): string {
	if (typeof prefix !== "string") {
		throw new TypeError(`${label}: list prefix must be a string`);
	}
	return prefix;
}

function validateNamespace(label: string, namespace: string): string {
	if (typeof namespace !== "string") {
		throw new TypeError(`${label}: namespace must be a string`);
	}
	return namespace;
}

/** Passive byte-addressed backend used by D82 storage binding tiers. */
export interface StorageBackend {
	get(key: string): undefined | Uint8Array | PromiseLike<undefined | Uint8Array>;
	put(key: string, value: Uint8Array): void | PromiseLike<void>;
	putIfAbsent?(key: string, value: Uint8Array): boolean | PromiseLike<boolean>;
	getVersioned?(key: string): StorageVersionedRead | PromiseLike<StorageVersionedRead>;
	setIfMatch?(
		key: string,
		value: Uint8Array,
		generation: StorageGeneration,
	): boolean | PromiseLike<boolean>;
	delete?(key: string): void | PromiseLike<void>;
	list?(prefix?: string): readonly string[] | PromiseLike<readonly string[]>;
}

/** Passive D85 conditional-create capability for multi-writer storage helpers. */
export interface PutIfAbsentStorageBackend extends StorageBackend {
	putIfAbsent(key: string, value: Uint8Array): boolean | PromiseLike<boolean>;
}

/** Opaque D108 per-key generation token for passive storage versioned reads. */
export type StorageGeneration = unknown;

/** D108 versioned byte read result with explicit present/absent observations. */
export type StorageVersionedRead =
	| {
			readonly kind: "hit";
			readonly value: Uint8Array;
			readonly generation: StorageGeneration;
	  }
	| {
			readonly kind: "miss";
			readonly generation: StorageGeneration;
	  };

/** Passive D108 versioned read + generation-conditional set capability. */
export interface VersionedStorageBackend extends StorageBackend {
	getVersioned(key: string): StorageVersionedRead | PromiseLike<StorageVersionedRead>;
	setIfMatch(
		key: string,
		value: Uint8Array,
		generation: StorageGeneration,
	): boolean | PromiseLike<boolean>;
}

/** Runtime guard for D85 conditional-create capable byte backends.
 * @param backend - backend value used by the helper.
 * @returns A `backend is PutIfAbsentStorageBackend` value.
 * @category storage
 * @example
 * ```ts
 * import { hasStoragePutIfAbsent } from "@graphrefly/ts/storage";
 * ```
 */
export function hasStoragePutIfAbsent(
	backend: StorageBackend,
): backend is PutIfAbsentStorageBackend {
	return typeof backend.putIfAbsent === "function";
}

/** Require D85 conditional-create support and produce a clear adapter error when absent.
 * @param backend - backend value used by the helper.
 * @param label - label value used by the helper.
 * @returns A `PutIfAbsentStorageBackend` value.
 * @category storage
 * @example
 * ```ts
 * import { requireStoragePutIfAbsent } from "@graphrefly/ts/storage";
 * ```
 */
export function requireStoragePutIfAbsent(
	backend: StorageBackend,
	label = "storage backend",
): PutIfAbsentStorageBackend {
	if (!hasStoragePutIfAbsent(backend)) {
		throw new Error(`${label}: backend does not support putIfAbsent`);
	}
	return backend;
}

/** Runtime guard for D108 versioned byte backends.
 * @param backend - backend value used by the helper.
 * @returns A `backend is VersionedStorageBackend` value.
 * @category storage
 * @example
 * ```ts
 * import { hasStorageVersioned } from "@graphrefly/ts/storage";
 * ```
 */
export function hasStorageVersioned(backend: StorageBackend): backend is VersionedStorageBackend {
	return typeof backend.getVersioned === "function" && typeof backend.setIfMatch === "function";
}

/** Require D108 versioned support and produce a clear adapter error when absent.
 * @param backend - backend value used by the helper.
 * @param label - label value used by the helper.
 * @returns A `VersionedStorageBackend` value.
 * @category storage
 * @example
 * ```ts
 * import { requireStorageVersioned } from "@graphrefly/ts/storage";
 * ```
 */
export function requireStorageVersioned(
	backend: StorageBackend,
	label = "storage backend",
): VersionedStorageBackend {
	if (!hasStorageVersioned(backend)) {
		throw new Error(`${label}: backend does not support versioned get/set-if-match`);
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
	return storagePhysicalKey(namespace, key);
}

function enumerateStorageKeys(storage: WebStorageLike): readonly unknown[] {
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

function decodeStorageListKey(namespace: string, rawKey: unknown): string | undefined {
	if (typeof rawKey !== "string") {
		throw new TypeError("webStorageBackend: stored key must be a string");
	}
	return decodeStoragePhysicalKey(namespace, rawKey, "webStorageBackend: malformed stored key");
}

function listByPrefix(namespace: string, prefix: string, raw: readonly unknown[]): string[] {
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

/** Build a deterministic byte backend backed by a browser-like key/value store (D103/D82).
 * @param storage - storage value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `StorageBackend` value.
 * @category storage
 * @example
 * ```ts
 * import { webStorageBackend } from "@graphrefly/ts/storage";
 * ```
 */
export function webStorageBackend(
	storage: WebStorageLike,
	opts: StorageNamespaceOptions = {},
): StorageBackend {
	const namespace =
		opts.namespace === undefined ? "" : validateNamespace("webStorageBackend", opts.namespace);
	return {
		get(key) {
			const raw = storage.getItem(
				toStorageKey(namespace, validateLogicalKey("webStorageBackend", key)),
			);
			if (raw === null || raw === undefined) return undefined;
			return decodeHexToBytes(raw);
		},
		put(key, value) {
			storage.setItem(
				toStorageKey(namespace, validateLogicalKey("webStorageBackend", key)),
				encodeBytesToHex(cloneBytes(value)),
			);
		},
		delete(key) {
			storage.removeItem(toStorageKey(namespace, validateLogicalKey("webStorageBackend", key)));
		},
		list(prefix = "") {
			return listByPrefix(
				namespace,
				validateListPrefix("webStorageBackend", prefix),
				enumerateStorageKeys(storage),
			);
		},
	};
}

/** In-memory backend for tests, adapters, and lightweight local storage. */
export interface MemoryBackend extends StorageBackend {
	readonly entries: ReadonlyMap<string, Uint8Array>;
	clear(): void;
}

const MEMORY_GENERATION = Symbol("graphrefly.memoryBackend.generation");

interface MemoryGeneration {
	readonly [MEMORY_GENERATION]: readonly [epoch: number, key: string, version: number];
}

function memoryGeneration(epoch: number, key: string, version: number): MemoryGeneration {
	return Object.freeze({ [MEMORY_GENERATION]: Object.freeze([epoch, key, version] as const) });
}

function readMemoryGeneration(
	generation: StorageGeneration,
): readonly [epoch: number, key: string, version: number] | undefined {
	if (typeof generation !== "object" || generation === null) return undefined;
	const maybe = generation as Partial<MemoryGeneration>;
	const token = maybe[MEMORY_GENERATION];
	if (
		Array.isArray(token) &&
		token.length === 3 &&
		typeof token[0] === "number" &&
		typeof token[1] === "string" &&
		typeof token[2] === "number"
	) {
		return token as readonly [number, string, number];
	}
	return undefined;
}

/** Create a byte-cloning in-memory backend.
 * @param initial - initial value used by the helper.
 * @returns A `MemoryBackend` value.
 * @category storage
 * @example
 * ```ts
 * import { memoryBackend } from "@graphrefly/ts/storage";
 * ```
 */
export function memoryBackend(
	initial: Iterable<readonly [string, Uint8Array]> = [],
): MemoryBackend {
	const entries = new Map<string, Uint8Array>();
	const versions = new Map<string, number>();
	let epoch = 0;
	for (const [key, value] of initial) {
		entries.set(validateLogicalKey("memoryBackend", key), cloneBytes(value));
	}
	const versionOf = (key: string): number => versions.get(key) ?? 0;
	const bump = (key: string): void => {
		versions.set(key, versionOf(key) + 1);
	};
	return {
		entries,
		get(key) {
			const value = entries.get(validateLogicalKey("memoryBackend", key));
			return value === undefined ? undefined : cloneBytes(value);
		},
		put(key, value) {
			validateLogicalKey("memoryBackend", key);
			entries.set(key, cloneBytes(value));
			bump(key);
		},
		putIfAbsent(key, value) {
			validateLogicalKey("memoryBackend", key);
			if (entries.has(key)) return false;
			entries.set(key, cloneBytes(value));
			bump(key);
			return true;
		},
		getVersioned(key) {
			validateLogicalKey("memoryBackend", key);
			const value = entries.get(key);
			const generation = memoryGeneration(epoch, key, versionOf(key));
			if (value === undefined) return { kind: "miss", generation };
			return { kind: "hit", value: cloneBytes(value), generation };
		},
		setIfMatch(key, value, generation) {
			validateLogicalKey("memoryBackend", key);
			const observed = readMemoryGeneration(generation);
			if (
				observed === undefined ||
				observed[0] !== epoch ||
				observed[1] !== key ||
				observed[2] !== versionOf(key)
			) {
				return false;
			}
			entries.set(key, cloneBytes(value));
			bump(key);
			return true;
		},
		delete(key) {
			validateLogicalKey("memoryBackend", key);
			if (entries.delete(key)) bump(key);
		},
		list(prefix = "") {
			const validatedPrefix = validateListPrefix("memoryBackend", prefix);
			return [...entries.keys()].filter((key) => key.startsWith(validatedPrefix)).sort();
		},
		clear() {
			entries.clear();
			versions.clear();
			epoch += 1;
		},
	};
}
