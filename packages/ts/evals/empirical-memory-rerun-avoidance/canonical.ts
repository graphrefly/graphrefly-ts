import { createHash } from "node:crypto";
import { strictJsonCodec } from "../../src/json/codec.js";

export function empiricalSha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function empiricalStrictJsonDigest(value: unknown): string {
	return empiricalSha256(strictJsonCodec.encode(value));
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

export function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

export function strictSnapshot<T>(value: T): T {
	return deepFreeze(strictJsonCodec.decode(strictJsonCodec.encode(value)) as T);
}

export function fail(path: string, message: string): never {
	throw new TypeError(`B112 empirical campaign ${path}: ${message}`);
}

export function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail(path, "expected object");
	}
	return value as Record<string, unknown>;
}

export function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) return fail(path, "expected array");
	return value;
}

export function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	path: string,
): void {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
		fail(path, `unexpected keys ${JSON.stringify(actual)}`);
	}
}

export function string(value: unknown, path: string, maxLength = 1_024): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		return fail(path, `expected non-empty string no longer than ${maxLength} code units`);
	}
	return value;
}

export function coordinate(value: unknown, path: string): string {
	const actual = string(value, path, 256);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/.test(actual)) {
		return fail(path, "expected bounded opaque coordinate");
	}
	return actual;
}

export function literal<T extends string | number | boolean | null>(
	value: unknown,
	expected: T,
	path: string,
): T {
	if (value !== expected) return fail(path, `expected ${JSON.stringify(expected)}`);
	return expected;
}

export function oneOf<T extends string>(value: unknown, expected: readonly T[], path: string): T {
	const actual = string(value, path);
	if (!expected.includes(actual as T)) {
		return fail(path, `expected one of ${JSON.stringify(expected)}`);
	}
	return actual as T;
}

export function boolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") return fail(path, "expected boolean");
	return value;
}

export function safeInteger(
	value: unknown,
	path: string,
	opts: { readonly min?: number; readonly max?: number } = {},
): number {
	const min = opts.min ?? 0;
	const max = opts.max ?? Number.MAX_SAFE_INTEGER;
	if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
		return fail(path, `expected safe integer in [${min}, ${max}]`);
	}
	return value as number;
}

export function finiteNumber(
	value: unknown,
	path: string,
	opts: { readonly min?: number; readonly max?: number } = {},
): number {
	const min = opts.min ?? Number.NEGATIVE_INFINITY;
	const max = opts.max ?? Number.POSITIVE_INFINITY;
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
		return fail(path, `expected finite number in [${min}, ${max}]`);
	}
	return value;
}

export function digest(value: unknown, path: string): string {
	const actual = string(value, path);
	if (!/^sha256:[0-9a-f]{64}$/.test(actual)) {
		return fail(path, "expected lowercase sha256 digest");
	}
	return actual;
}

export function commitSha(value: unknown, path: string): string {
	const actual = string(value, path);
	if (!/^[0-9a-f]{40}$/.test(actual)) {
		return fail(path, "expected full lowercase 40-character commit SHA");
	}
	return actual;
}

export function denseUniqueStrings(
	value: unknown,
	path: string,
	opts: { readonly min?: number; readonly max: number },
): readonly string[] {
	const values = array(value, path);
	const min = opts.min ?? 0;
	if (values.length < min || values.length > opts.max) {
		return fail(path, `expected between ${min} and ${opts.max} entries`);
	}
	const result = values.map((entry, index) => string(entry, `${path}[${index}]`));
	if (new Set(result).size !== result.length) fail(path, "expected unique entries");
	return result;
}

export function optionalFiniteNumber(
	value: unknown,
	path: string,
	opts: { readonly min?: number; readonly max?: number } = {},
): number | null {
	if (value === null) return null;
	return finiteNumber(value, path, opts);
}

export function optionalSafeInteger(
	value: unknown,
	path: string,
	opts: { readonly min?: number; readonly max?: number } = {},
): number | null {
	if (value === null) return null;
	return safeInteger(value, path, opts);
}

export function httpsEndpoint(value: unknown, path: string): string {
	const actual = string(value, path);
	let url: URL;
	try {
		url = new URL(actual);
	} catch {
		return fail(path, "expected absolute URL");
	}
	if (
		url.protocol !== "https:" ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		return fail(path, "expected credential-free HTTPS endpoint without query or fragment");
	}
	return actual;
}

export function assertCanonicalBytes(value: unknown, bytes: Uint8Array, path: string): void {
	if (!sameBytes(strictJsonCodec.encode(value), bytes)) {
		fail(path, "bytes are not strict canonical JSON");
	}
}
