/**
 * Storage scalar helpers (D88): host BigInt in memory, canonical decimal strings on JSON/storage.
 */

/** Canonical decimal integer string; no leading zeroes, and no negative zero. */
export type DecimalIntegerString = string;

/** Canonical non-negative decimal integer string. */
export type NonNegativeDecimalIntegerString = DecimalIntegerString;

const DECIMAL_INTEGER_RE = /^(0|-?[1-9]\d*)$/;
const NON_NEGATIVE_DECIMAL_INTEGER_RE = /^(0|[1-9]\d*)$/;

/** Test whether a value is a canonical decimal integer string. */
export function isDecimalIntegerString(value: unknown): value is DecimalIntegerString {
	return typeof value === "string" && DECIMAL_INTEGER_RE.test(value);
}

/** Test whether a value is a canonical non-negative decimal integer string. */
export function isNonNegativeDecimalIntegerString(
	value: unknown,
): value is NonNegativeDecimalIntegerString {
	return typeof value === "string" && NON_NEGATIVE_DECIMAL_INTEGER_RE.test(value);
}

/** Assert a canonical decimal integer string and return it typed. */
export function assertDecimalIntegerString(
	value: unknown,
	label = "decimal integer",
): DecimalIntegerString {
	if (!isDecimalIntegerString(value)) {
		throw new TypeError(`${label} must be a canonical decimal integer string`);
	}
	return value;
}

/** Assert a canonical non-negative decimal integer string and return it typed. */
export function assertNonNegativeDecimalIntegerString(
	value: unknown,
	label = "decimal integer",
): NonNegativeDecimalIntegerString {
	if (!isNonNegativeDecimalIntegerString(value)) {
		throw new TypeError(`${label} must be a canonical non-negative decimal integer string`);
	}
	return value;
}

/** Convert a host BigInt to the canonical decimal storage scalar. */
export function bigIntToDecimalString(value: bigint): DecimalIntegerString {
	return value.toString();
}

/** Convert a non-negative host BigInt to the canonical non-negative decimal storage scalar. */
export function bigIntToNonNegativeDecimalString(value: bigint): NonNegativeDecimalIntegerString {
	if (value < 0n) {
		throw new TypeError("decimal integer must be non-negative");
	}
	return value.toString();
}

/** Parse a canonical decimal storage scalar into host BigInt. */
export function decimalStringToBigInt(value: DecimalIntegerString): bigint {
	return BigInt(assertDecimalIntegerString(value));
}

/** Parse a canonical non-negative decimal storage scalar into host BigInt. */
export function nonNegativeDecimalStringToBigInt(value: NonNegativeDecimalIntegerString): bigint {
	return BigInt(assertNonNegativeDecimalIntegerString(value));
}
