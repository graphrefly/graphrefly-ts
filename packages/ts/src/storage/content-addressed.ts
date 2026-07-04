import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { KvStorageTier } from "./kv.js";
import { contentAddressedStorageKey } from "./physical-key.js";

/** Content-addressed KV access mode for D82 passive storage helpers. */
export type ContentAddressedMode = "read" | "write" | "read-write" | "read-strict";

/** Error thrown when a read-strict content-addressed lookup misses.
 * @category storage
 * @example
 * ```ts
 * import { ContentAddressedMissError } from "@graphrefly/ts/storage";
 * ```
 */
export class ContentAddressedMissError extends Error {
	readonly key: string;
	readonly context: unknown;

	constructor(key: string, context: unknown) {
		super(`content-addressed lookup miss in read-strict mode: ${key}`);
		this.name = "ContentAddressedMissError";
		this.key = key;
		this.context = context;
	}
}

/** Options for {@link contentAddressedKv}. */
export interface ContentAddressedKvOptions<Ctx, V> {
	/** Underlying D82 KV tier. */
	kv: KvStorageTier<V>;
	/** Select the JSON-encodable data that participates in the content key. */
	keyContext?: (ctx: Ctx) => unknown;
	/** Optional namespace prefix for sharing one KV tier across consumers. */
	keyPrefix?: string;
	/** Access mode. Defaults to read-write. */
	mode?: ContentAddressedMode;
}

/** Content-addressed helper handle over a D82 KV tier. */
export interface ContentAddressedKv<Ctx, V> {
	keyFor(ctx: Ctx): Promise<string>;
	lookup(ctx: Ctx): Promise<V | undefined>;
	store(ctx: Ctx, value: V): Promise<void>;
	forget(ctx: Ctx): Promise<void>;
}

export type ContentAddressedStorageOptions<Ctx, V> = ContentAddressedKvOptions<Ctx, V>;
export type ContentAddressedStorage<Ctx, V> = ContentAddressedKv<Ctx, V>;

const SHA_256 = "SHA-256";
const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) out += HEX_TABLE[byte];
	return out;
}

function sha256Hex(data: Uint8Array): Promise<string> {
	const digestInput = Uint8Array.from(data);
	return globalThis.crypto.subtle
		.digest(SHA_256, digestInput)
		.then((buf) => bytesToHex(new Uint8Array(buf)));
}

/** Build a content-addressed helper over a D82 KV tier.
 * @param opts - Options that configure the helper.
 * @returns A `ContentAddressedKv<Ctx, V>` value.
 * @category storage
 * @example
 * ```ts
 * import { contentAddressedKv } from "@graphrefly/ts/storage";
 * ```
 */
export function contentAddressedKv<Ctx, V>(
	opts: ContentAddressedKvOptions<Ctx, V>,
): ContentAddressedKv<Ctx, V> {
	const { kv, keyContext, keyPrefix, mode = "read-write" } = opts;
	const contextForKey = keyContext ?? ((ctx: Ctx) => ctx as unknown);

	function keyFor(ctx: Ctx): Promise<string> {
		let bytes: Uint8Array;
		try {
			bytes = strictCanonicalJsonBytes(contextForKey(ctx));
		} catch (err) {
			return Promise.resolve().then(() => {
				throw err;
			});
		}
		return Promise.resolve()
			.then(() => sha256Hex(bytes))
			.then((hex) => (keyPrefix ? contentAddressedStorageKey(keyPrefix, hex) : hex));
	}

	return {
		keyFor,
		lookup(ctx) {
			if (mode === "write") return Promise.resolve(undefined);
			return keyFor(ctx).then((key) =>
				kv.get(key).then((value) => {
					if (value === undefined && mode === "read-strict") {
						throw new ContentAddressedMissError(key, ctx);
					}
					return value;
				}),
			);
		},
		store(ctx, value) {
			if (mode === "read") return Promise.resolve();
			return keyFor(ctx).then((key) => kv.set(key, value));
		},
		forget(ctx) {
			if (mode === "read" || mode === "write") return Promise.resolve();
			return keyFor(ctx).then((key) => kv.delete(key));
		},
	};
}

/** Alias for consumers that name the same D82 helper by storage role rather than KV tier.
 * @param opts - Options that configure the helper.
 * @returns A `ContentAddressedStorage<Ctx, V>` value.
 * @category storage
 * @example
 * ```ts
 * import { contentAddressedStorage } from "@graphrefly/ts/storage";
 * ```
 */
export function contentAddressedStorage<Ctx, V>(
	opts: ContentAddressedStorageOptions<Ctx, V>,
): ContentAddressedStorage<Ctx, V> {
	return contentAddressedKv(opts);
}
