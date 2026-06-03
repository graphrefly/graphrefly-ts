/**
 * Storage codecs (D82): binding-layer byte encoding, outside the sync wave core.
 */

/** Typed byte codec for D82 storage binding helpers. */
export interface Codec<T> {
	encode(value: T): Uint8Array;
	decode(bytes: Uint8Array): T;
}

type JsonScalar = null | boolean | number | string;
type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function sortedJsonValue(value: unknown, seen = new Set<object>(), path = "$"): JsonValue {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`stableJsonString: non-finite number at ${path}`);
		}
		return value;
	}
	if (typeof value !== "object") {
		throw new TypeError(`stableJsonString: value at ${path} is not JSON-encodable`);
	}
	if (seen.has(value)) throw new TypeError(`stableJsonString: circular reference at ${path}`);
	const proto = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
		throw new TypeError(`stableJsonString: non-plain object at ${path}`);
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			if (Object.getOwnPropertySymbols(value).length > 0) {
				throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
			}
			for (const key of Object.getOwnPropertyNames(value)) {
				const isIndex =
					/^(0|[1-9]\d*)$/.test(key) &&
					Number.isSafeInteger(Number(key)) &&
					Number(key) < value.length;
				if (key !== "length" && !isIndex) {
					throw new TypeError(`stableJsonString: non-index array property at ${path}.${key}`);
				}
			}
			const out: JsonValue[] = [];
			for (let i = 0; i < value.length; i += 1) {
				if (!(i in value)) {
					throw new TypeError(`stableJsonString: sparse array hole at ${path}[${i}]`);
				}
				out.push(sortedJsonValue(value[i], seen, `${path}[${i}]`));
			}
			return out;
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
		}
		const out: Record<string, JsonValue> = Object.create(null);
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = sortedJsonValue((value as Record<string, unknown>)[key], seen, `${path}.${key}`);
		}
		return out;
	} finally {
		seen.delete(value);
	}
}

/** Stable JSON string: object keys sort by code-unit order for deterministic storage bytes. */
export function stableJsonString(value: unknown): string {
	return JSON.stringify(sortedJsonValue(value));
}

/** JSON codec over stable object-key ordering. */
/** Build a JSON codec using stable object-key ordering. */
export function jsonCodecFor<T>(): Codec<T> {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	return {
		encode(value: T): Uint8Array {
			return encoder.encode(stableJsonString(value));
		},
		decode(bytes: Uint8Array): T {
			return JSON.parse(decoder.decode(bytes)) as T;
		},
	};
}

/** Default stable JSON codec for unknown values. */
export const jsonCodec: Codec<unknown> = jsonCodecFor<unknown>();
