/**
 * Neutral JSON/encoding utilities (D96).
 *
 * Shared by graph checkpoints and storage bindings; neither layer owns the strict JSON
 * scanner/canonicalization contract.
 */

/** Typed byte codec for D82 storage binding helpers and D96 shared JSON surfaces. */
export interface Codec<T> {
	encode(value: T): Uint8Array;
	decode(bytes: Uint8Array): T;
}

export type StrictJsonScalar = null | boolean | number | string;
export type StrictJsonValue =
	| StrictJsonScalar
	| readonly StrictJsonValue[]
	| { readonly [key: string]: StrictJsonValue };
export type StrictJsonObject = Readonly<Record<string, StrictJsonValue>>;

type JsonValue = StrictJsonValue;

const JS_MIN_NORMAL_NUMBER = 2 ** -1022;

function deepFreezeStrictJson<T extends StrictJsonValue>(value: T): T {
	if (value !== null && typeof value === "object") {
		if (Array.isArray(value)) {
			for (const item of value) deepFreezeStrictJson(item);
		} else {
			for (const item of Object.values(value)) deepFreezeStrictJson(item);
		}
		Object.freeze(value);
	}
	return value;
}

function assertStableJsonNumber(value: number, path: string): void {
	if (!Number.isFinite(value)) {
		throw new TypeError(`stableJsonString: non-finite number at ${path}`);
	}
}

function assertStrictJsonNumber(value: number, path: string): void {
	assertStableJsonNumber(value, path);
	if (Object.is(value, -0)) {
		throw new TypeError(`stableJsonString: non-canonical number at ${path}`);
	}
	const abs = Math.abs(value);
	if (abs > 0 && abs < JS_MIN_NORMAL_NUMBER) {
		throw new TypeError(`stableJsonString: subnormal number at ${path}`);
	}
	if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
		throw new TypeError(`stableJsonString: integer outside safe range at ${path}`);
	}
}

function sortedJsonValue(
	value: unknown,
	seen = new Set<object>(),
	path = "$",
	strictNumbers = false,
): JsonValue {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (strictNumbers) assertStrictJsonNumber(value, path);
		else assertStableJsonNumber(value, path);
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
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (descriptor !== undefined && ("get" in descriptor || "set" in descriptor)) {
					throw new TypeError(`stableJsonString: accessor property at ${path}.${key}`);
				}
				if (key !== "length" && !isIndex) {
					throw new TypeError(`stableJsonString: non-index array property at ${path}.${key}`);
				}
				if (key !== "length" && descriptor !== undefined && !descriptor.enumerable) {
					throw new TypeError(`stableJsonString: non-enumerable array property at ${path}.${key}`);
				}
			}
			const out: JsonValue[] = [];
			for (let i = 0; i < value.length; i += 1) {
				if (!(i in value)) {
					throw new TypeError(`stableJsonString: sparse array hole at ${path}[${i}]`);
				}
				out.push(sortedJsonValue(value[i], seen, `${path}[${i}]`, strictNumbers));
			}
			return out;
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
		}
		for (const key of Object.getOwnPropertyNames(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor !== undefined && ("get" in descriptor || "set" in descriptor)) {
				throw new TypeError(`stableJsonString: accessor property at ${path}.${key}`);
			}
			if (descriptor !== undefined && !descriptor.enumerable) {
				throw new TypeError(`stableJsonString: non-enumerable property at ${path}.${key}`);
			}
		}
		const out: Record<string, JsonValue> = Object.create(null);
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = sortedJsonValue(
				(value as Record<string, unknown>)[key],
				seen,
				`${path}.${key}`,
				strictNumbers,
			);
		}
		return out;
	} finally {
		seen.delete(value);
	}
}

/** Stable JSON string: object keys sort by code-unit order for deterministic storage/checkpoint bytes.
 * @param value - Unknown value to check or decode.
 * @returns A `string` value.
 * @category json
 * @example
 * ```ts
 * import { stableJsonString } from "@graphrefly/ts/storage";
 * ```
 */
export function stableJsonString(value: unknown): string {
	return JSON.stringify(sortedJsonValue(value));
}

function strictStableJsonString(value: unknown): string {
	return JSON.stringify(cloneStrictJsonValue(value));
}

/** Build a JSON codec using stable object-key ordering.
 * @returns A `Codec<T>` value.
 * @category json
 * @example
 * ```ts
 * import { jsonCodecFor } from "@graphrefly/ts/storage";
 * ```
 */
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i += 1;
				continue;
			}
			return true;
		}
		if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

function assertNoUnpairedSurrogates(value: unknown, seen = new Set<object>(), path = "$"): void {
	if (typeof value === "string") {
		if (hasUnpairedSurrogate(value)) {
			throw new TypeError(`strictJsonCodec: unpaired surrogate at ${path}`);
		}
		return;
	}
	if (value === null || typeof value !== "object") return;
	if (seen.has(value)) return;
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
				if (descriptor === undefined || "get" in descriptor || "set" in descriptor) continue;
				assertNoUnpairedSurrogates(descriptor.value, seen, `${path}[${i}]`);
			}
			return;
		}
		for (const key of Object.keys(value as Record<string, unknown>)) {
			if (hasUnpairedSurrogate(key)) {
				throw new TypeError(`strictJsonCodec: unpaired surrogate at ${path}.${key}`);
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined || "get" in descriptor || "set" in descriptor) continue;
			assertNoUnpairedSurrogates(descriptor.value, seen, `${path}.${key}`);
		}
	} finally {
		seen.delete(value);
	}
}

function strictJsonDataErrorsInner(
	value: unknown,
	label: string,
	seen: Set<object>,
): { readonly errors: readonly string[]; readonly value?: StrictJsonValue } {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		if (typeof value === "string" && hasUnpairedSurrogate(value)) {
			return { errors: [`${label} must not contain unpaired surrogate strings`] };
		}
		return { errors: [], value };
	}
	if (typeof value === "number") {
		try {
			assertStrictJsonNumber(value, label);
		} catch (error) {
			return { errors: [error instanceof Error ? error.message : String(error)] };
		}
		return { errors: [], value };
	}
	if (typeof value !== "object") {
		return { errors: [`${label} is not JSON-encodable`] };
	}
	if (seen.has(value)) return { errors: [`${label} must not contain circular references`] };
	const proto = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
		return { errors: [`stableJsonString: non-plain object at ${label}`] };
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const errors: string[] = [];
			if (Object.getOwnPropertySymbols(value).length > 0) {
				errors.push(`${label} must not carry symbol keys`);
			}
			for (const key of Object.getOwnPropertyNames(value)) {
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (descriptor === undefined) continue;
				const isIndex =
					/^(0|[1-9]\d*)$/.test(key) &&
					Number.isSafeInteger(Number(key)) &&
					Number(key) < value.length;
				if ("get" in descriptor || "set" in descriptor) {
					errors.push(`${label}.${key} must be a data property`);
				}
				if (key !== "length" && !isIndex) {
					errors.push(`${label}.${key} must be an indexed data property`);
				}
				if (key !== "length" && isIndex && !descriptor.enumerable) {
					errors.push(`${label}.${key} must be enumerable`);
				}
			}
			const out: StrictJsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
				if (descriptor === undefined) {
					errors.push(`stableJsonString: sparse array hole at ${label}[${index}]`);
					continue;
				}
				if ("get" in descriptor || "set" in descriptor) {
					errors.push(`${label}[${index}] must be a data property`);
					continue;
				}
				if (!descriptor.enumerable) {
					errors.push(`${label}[${index}] must be enumerable`);
					continue;
				}
				const nested = strictJsonDataErrorsInner(descriptor.value, `${label}[${index}]`, seen);
				errors.push(...nested.errors);
				if (nested.errors.length === 0 && nested.value !== undefined) out.push(nested.value);
			}
			if (errors.length > 0) return { errors };
			return { errors: [], value: Object.freeze(out) };
		}
		const errors: string[] = [];
		if (Object.getOwnPropertySymbols(value).length > 0) {
			errors.push(`${label} must not carry symbol keys`);
		}
		for (const key of Object.getOwnPropertyNames(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined) continue;
			if ("get" in descriptor || "set" in descriptor) {
				errors.push(`${label}.${key} must be a data property`);
			}
			if (!descriptor.enumerable) {
				errors.push(`${label}.${key} must be enumerable`);
			}
			if (hasUnpairedSurrogate(key)) {
				errors.push(`${label}.${key} must not contain unpaired surrogate keys`);
			}
		}
		const out: Record<string, StrictJsonValue> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor === undefined || "get" in descriptor || "set" in descriptor) continue;
			const nested = strictJsonDataErrorsInner(descriptor.value, `${label}.${key}`, seen);
			errors.push(...nested.errors);
			if (nested.errors.length === 0 && nested.value !== undefined) {
				Object.defineProperty(out, key, {
					value: nested.value,
					enumerable: true,
					configurable: true,
					writable: true,
				});
			}
		}
		if (errors.length > 0) return { errors };
		return { errors: [], value: Object.freeze(out) };
	} finally {
		seen.delete(value);
	}
}

/** Descriptor-safe strict JSON validation errors.
 *
 * The scanner checks property descriptors before reading values, so accessor-backed
 * host objects are rejected without executing getters. It is shared by D585
 * passive store frames and metadata validators that must accept only ordinary DATA.
 * @param value - Unknown value to validate.
 * @param label - Human-readable label for returned issue paths.
 * @returns Validation errors; empty means the value can be cloned as strict JSON.
 * @category json
 */
export function strictJsonDataErrors(value: unknown, label = "strictJsonValue"): readonly string[] {
	try {
		return strictJsonDataErrorsInner(value, label, new Set<object>()).errors;
	} catch (error) {
		return [error instanceof Error ? error.message : String(error)];
	}
}

/** Clone a host value into deep-frozen strict canonical JSON DATA.
 *
 * The clone is descriptor-safe: accessors, sparse arrays, symbols, non-enumerable
 * fields, circular references, and non-portable JSON numbers are rejected before
 * values are read through normal property access.
 * @param value - Unknown value to clone.
 * @param label - Human-readable label for errors.
 * @returns A deep-frozen strict JSON value with deterministically sorted object keys.
 * @category json
 */
export function cloneStrictJsonValue(value: unknown, label = "strictJsonValue"): StrictJsonValue {
	const result = strictJsonDataErrorsInner(value, label, new Set<object>());
	if (result.errors.length > 0 || result.value === undefined) {
		throw new TypeError(`${label}: ${result.errors.join("; ")}`);
	}
	return deepFreezeStrictJson(result.value);
}

/** Clone a host object into a deep-frozen strict canonical JSON object.
 * @param value - Unknown value to clone.
 * @param label - Human-readable label for errors.
 * @returns A deep-frozen strict JSON object.
 * @category json
 */
export function cloneStrictJsonObject(
	value: unknown,
	label = "strictJsonObject",
): StrictJsonObject {
	const cloned = cloneStrictJsonValue(value, label);
	if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
		throw new TypeError(`${label}: value must be a strict JSON object`);
	}
	return cloned as StrictJsonObject;
}

function assertNoDuplicateJsonObjectKeys(text: string): void {
	let index = 0;

	function fail(message: string): never {
		throw new TypeError(`strictJsonCodec: ${message}`);
	}

	function skipWhitespace(): void {
		while (/\s/.test(text[index] ?? "")) index += 1;
	}

	function readJsonString(): string {
		const start = index;
		index += 1;
		while (index < text.length) {
			const ch = text[index];
			if (ch === '"') {
				index += 1;
				try {
					return JSON.parse(text.slice(start, index)) as string;
				} catch {
					fail("malformed JSON string");
				}
			}
			if (ch === "\\") {
				index += 2;
				continue;
			}
			index += 1;
		}
		fail("unterminated JSON string");
	}

	function consumeLiteral(literal: string): void {
		if (text.slice(index, index + literal.length) !== literal) {
			fail(`malformed JSON near byte ${index}`);
		}
		index += literal.length;
	}

	function consumeNumber(): void {
		const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
		if (!match) fail(`malformed JSON number near byte ${index}`);
		index += match[0].length;
	}

	function parseValue(path: string): void {
		skipWhitespace();
		const ch = text[index];
		if (ch === "{") {
			parseObject(path);
			return;
		}
		if (ch === "[") {
			parseArray(path);
			return;
		}
		if (ch === '"') {
			readJsonString();
			return;
		}
		if (ch === "t") {
			consumeLiteral("true");
			return;
		}
		if (ch === "f") {
			consumeLiteral("false");
			return;
		}
		if (ch === "n") {
			consumeLiteral("null");
			return;
		}
		if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
			consumeNumber();
			return;
		}
		fail(`malformed JSON near byte ${index}`);
	}

	function parseObject(path: string): void {
		const keys = new Set<string>();
		index += 1;
		skipWhitespace();
		if (text[index] === "}") {
			index += 1;
			return;
		}
		while (index < text.length) {
			skipWhitespace();
			if (text[index] !== '"') fail(`expected object key near byte ${index}`);
			const key = readJsonString();
			if (keys.has(key)) {
				throw new TypeError(
					`strictJsonCodec: duplicate object key ${JSON.stringify(key)} at ${path}`,
				);
			}
			keys.add(key);
			skipWhitespace();
			if (text[index] !== ":") fail(`expected ':' after object key near byte ${index}`);
			index += 1;
			parseValue(`${path}.${key}`);
			skipWhitespace();
			if (text[index] === ",") {
				index += 1;
				continue;
			}
			if (text[index] === "}") {
				index += 1;
				return;
			}
			fail(`expected ',' or '}' near byte ${index}`);
		}
		fail("unterminated JSON object");
	}

	function parseArray(path: string): void {
		index += 1;
		skipWhitespace();
		if (text[index] === "]") {
			index += 1;
			return;
		}
		let item = 0;
		while (index < text.length) {
			parseValue(`${path}[${item}]`);
			item += 1;
			skipWhitespace();
			if (text[index] === ",") {
				index += 1;
				continue;
			}
			if (text[index] === "]") {
				index += 1;
				return;
			}
			fail(`expected ',' or ']' near byte ${index}`);
		}
		fail("unterminated JSON array");
	}

	parseValue("$");
	skipWhitespace();
	if (index !== text.length) fail(`trailing JSON token near byte ${index}`);
}

/**
 * Build a strict canonical JSON codec (D84/D87/D96).
 * The strict surface rejects malformed UTF-8, duplicate object keys, non-canonical bytes,
 * unpaired surrogates, and values that cannot round-trip through stable JSON.
 * @returns A `Codec<T>` value.
 * @category json
 * @example
 * ```ts
 * import { strictJsonCodecFor } from "@graphrefly/ts/storage";
 * ```
 */
export function strictJsonCodecFor<T>(): Codec<T> {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	return {
		encode(value: T): Uint8Array {
			assertNoUnpairedSurrogates(value);
			return encoder.encode(strictStableJsonString(value));
		},
		decode(bytes: Uint8Array): T {
			const text = decoder.decode(bytes);
			assertNoDuplicateJsonObjectKeys(text);
			const decoded = JSON.parse(text) as unknown;
			assertNoUnpairedSurrogates(decoded);
			const canonical = encoder.encode(strictStableJsonString(decoded));
			if (!bytesEqual(bytes, canonical)) {
				throw new TypeError("strictJsonCodec: bytes are not canonical stable JSON");
			}
			return decoded as T;
		},
	};
}

/** Default strict canonical JSON codec for unknown values. */
export const strictJsonCodec: Codec<unknown> = strictJsonCodecFor<unknown>();

/** D113 neutral helper for strict canonical JSON UTF-8 bytes.
 * @param value - Unknown value to check or decode.
 * @returns A `Uint8Array` value.
 * @category json
 * @example
 * ```ts
 * import { strictCanonicalJsonBytes } from "@graphrefly/ts";
 * ```
 */
export function strictCanonicalJsonBytes(value: unknown): Uint8Array {
	return strictJsonCodec.encode(value);
}

/** Validate and normalize a host value into strict canonical JSON data.
 * @param value - Unknown value to check or decode.
 * @param label - label value used by the helper.
 * @returns The narrowed, validated value.
 * @category json
 * @example
 * ```ts
 * import { assertStrictJsonValue } from "@graphrefly/ts/storage";
 * ```
 */
export function assertStrictJsonValue(value: unknown, label = "strictJsonValue"): StrictJsonValue {
	try {
		return cloneStrictJsonValue(value, label);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new TypeError(`${label}: value is not strict JSON compatible: ${message}`, { cause });
	}
}

/** Validate and normalize a host value into a strict canonical JSON object.
 * @param value - Unknown value to check or decode.
 * @param label - label value used by the helper.
 * @returns The narrowed, validated value.
 * @category json
 * @example
 * ```ts
 * import { assertStrictJsonObject } from "@graphrefly/ts/storage";
 * ```
 */
export function assertStrictJsonObject(
	value: unknown,
	label = "strictJsonObject",
): StrictJsonObject {
	return cloneStrictJsonObject(value, label);
}
