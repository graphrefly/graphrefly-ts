/**
 * Content-addressed storage substrate — a generic lookup / store helper over
 * any {@link StorageTier}. Hashes an arbitrary context object via
 * {@link canonicalJson} + sha256 to produce a stable key, then reads or writes
 * the record from the underlying tier.
 *
 * Substrate shared by LLM adapters (`withReplayCache`, `fallbackAdapter`) —
 * the LLM-specific shape (key prefix, `ChatMessage` + `LLMInvokeOptions`
 * context) lives in a thin wrapper inside `patterns/ai/adapters/_internal/`.
 * Any consumer that wants "memoize by content hash over a pluggable tier"
 * (tool result caches, embedding caches, deterministic function memoization,
 * fixtures for replay tests) can use this primitive directly.
 *
 * Universal tier — browser + Node safe. `sha256Hex` is pulled from
 * `core/hash.ts` (Web Crypto), `canonicalJson` is a pure function in this
 * module.
 *
 * @module
 */

import { sha256Hex } from "../../core/hash.js";
import type { KvStorageTier } from "../storage-tiers.js";

/**
 * Read / write / read-write / read-strict.
 *
 * - `"read"` — lookups hit storage; misses fall through to the caller.
 * - `"write"` — store only; lookups always return `undefined`.
 * - `"read-write"` — lookups hit storage, misses are writable by the caller.
 * - `"read-strict"` — lookups hit storage, misses throw (no fallthrough).
 *   Used by fixture-based replay flows where a missing fixture is a test bug.
 *
 * @category extra
 */
export type ContentAddressedMode = "read" | "write" | "read-write" | "read-strict";

/** Error thrown when `read-strict` mode misses. */
export class ContentAddressedMissError extends Error {
	constructor(
		public readonly key: string,
		public readonly context: unknown,
	) {
		super(`content-addressed lookup miss in read-strict mode: ${key}`);
		this.name = "ContentAddressedMissError";
	}
}

/**
 * Options for {@link contentAddressedStorage}.
 *
 * @category extra
 */
export type ContentAddressedStorageOptions<Ctx> = {
	/** Underlying storage tier (any `KvStorageTier` — memoryKv, fileKv, indexedDbKv). */
	storage: KvStorageTier;
	/**
	 * Derive the hashable context from `ctx`. Defaults to `ctx` itself.
	 * Use when the caller's `ctx` carries fields that should NOT participate in
	 * the key (e.g. an `AbortSignal`, a retry count).
	 */
	keyContext?: (ctx: Ctx) => unknown;
	/**
	 * Optional key prefix — applied as `${prefix}:${hex}` so multiple consumers
	 * can share one storage tier without collisions.
	 */
	keyPrefix?: string;
	/** Mode — see {@link ContentAddressedMode}. Default `"read-write"`. */
	mode?: ContentAddressedMode;
};

/**
 * Handle returned by {@link contentAddressedStorage}.
 *
 * @category extra
 */
export type ContentAddressedStorage<Ctx, V> = {
	/**
	 * Compute the content-addressed key for `ctx` — useful when a caller needs
	 * to thread the same key through a singleflight / dedup stage without
	 * re-hashing.
	 */
	keyFor(ctx: Ctx): Promise<string>;
	/**
	 * Look up a value by hashing `ctx`. In `read-strict` mode, throws
	 * {@link ContentAddressedMissError} on miss.
	 */
	lookup(ctx: Ctx): Promise<V | undefined>;
	/** Store `value` under the hash of `ctx`. No-op in `"read"` mode. */
	store(ctx: Ctx, value: V): Promise<void>;
	/** Clear the entry for `ctx`. No-op in `"read"` or `"write"` mode, or when the tier lacks `clear()`. */
	forget(ctx: Ctx): Promise<void>;
};

/**
 * Canonical JSON — sorts object keys for stable sha256 while detecting true
 * cycles (not sibling shared refs).
 *
 * We recurse manually with a **path stack** (`seen` contains only the current
 * ancestor chain, not every previously-visited object). On enter we push; on
 * exit we pop. Back-edges to ancestors serialize as `{"__cycle": true}`;
 * siblings that share the same reference serialize normally, producing
 * identical hashes to a freshly-reconstructed equivalent.
 *
 * @category extra
 */
export function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();

	const canon = (v: unknown): unknown => {
		if (v === null || typeof v !== "object") return v;
		const obj = v as object;
		if (ancestors.has(obj)) return { __cycle: true };
		ancestors.add(obj);
		try {
			if (Array.isArray(v)) {
				return (v as readonly unknown[]).map(canon);
			}
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(v as Record<string, unknown>).sort()) {
				out[k] = canon((v as Record<string, unknown>)[k]);
			}
			return out;
		} finally {
			ancestors.delete(obj);
		}
	};

	return JSON.stringify(canon(value));
}

/**
 * Creates a content-addressed lookup / store handle over `storage`. The key
 * is `sha256Hex(canonicalJson(keyContext(ctx)))`, optionally prefixed by
 * `keyPrefix`.
 *
 * @example
 * ```ts
 * import { contentAddressedStorage, memoryKv } from "@graphrefly/graphrefly-ts";
 *
 * const cache = contentAddressedStorage<{ query: string }, { answer: string }>({
 *   storage: memoryKv(),
 *   keyPrefix: "qa",
 *   mode: "read-write",
 * });
 *
 * const hit = await cache.lookup({ query: "what is graphrefly?" });
 * if (!hit) {
 *   const ans = await computeAnswer({ query: "what is graphrefly?" });
 *   await cache.store({ query: "what is graphrefly?" }, { answer: ans.text });
 * }
 * ```
 *
 * @category extra
 */
export function contentAddressedStorage<Ctx, V>(
	opts: ContentAddressedStorageOptions<Ctx>,
): ContentAddressedStorage<Ctx, V> {
	const { storage, keyContext, keyPrefix, mode = "read-write" } = opts;
	const extract = keyContext ?? ((c: Ctx) => c as unknown);

	async function keyFor(ctx: Ctx): Promise<string> {
		const canonical = canonicalJson(extract(ctx));
		const hex = await sha256Hex(canonical);
		return keyPrefix ? `${keyPrefix}:${hex}` : hex;
	}

	return {
		keyFor,

		async lookup(ctx: Ctx): Promise<V | undefined> {
			if (mode === "write") return undefined;
			const key = await keyFor(ctx);
			const raw = await storage.load(key);
			if (raw === undefined) {
				if (mode === "read-strict") {
					throw new ContentAddressedMissError(key, ctx);
				}
				return undefined;
			}
			return raw as V;
		},

		async store(ctx: Ctx, value: V): Promise<void> {
			if (mode === "read") return;
			const key = await keyFor(ctx);
			await storage.save(key, value as unknown);
		},

		async forget(ctx: Ctx): Promise<void> {
			if (mode === "read" || mode === "write") return;
			if (!storage.delete) return;
			const key = await keyFor(ctx);
			await storage.delete(key);
		},
	};
}
