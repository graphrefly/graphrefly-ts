/**
 * Byte storage backends (D82): passive adapter-owned storage, no graph methods.
 */

/** Passive byte-addressed backend used by D82 storage binding tiers. */
export interface StorageBackend {
	get(key: string): undefined | Uint8Array | PromiseLike<undefined | Uint8Array>;
	put(key: string, value: Uint8Array): void | PromiseLike<void>;
	delete?(key: string): void | PromiseLike<void>;
	list?(prefix?: string): readonly string[] | PromiseLike<readonly string[]>;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
	return bytes.slice();
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
