/**
 * Storage scalar helpers (D88): host BigInt in memory, canonical decimal strings on JSON/storage.
 */

/** Canonical decimal integer string; no leading zeroes, and no negative zero. */
export type DecimalIntegerString = string;

/** Canonical non-negative decimal integer string. */
export type NonNegativeDecimalIntegerString = DecimalIntegerString;

const DECIMAL_INTEGER_RE = /^(0|-?[1-9]\d*)$/;
const NON_NEGATIVE_DECIMAL_INTEGER_RE = /^(0|[1-9]\d*)$/;

/** Test whether a value is a canonical decimal integer string.
 * @param value - Unknown value to check or decode.
 * @returns `true` when the value matches the expected shape.
 * @category storage
 * @example
 * ```ts
 * import { isDecimalIntegerString } from "@graphrefly/ts/storage";
 * ```
 */
export function isDecimalIntegerString(value: unknown): value is DecimalIntegerString {
	return typeof value === "string" && DECIMAL_INTEGER_RE.test(value);
}

/** Test whether a value is a canonical non-negative decimal integer string.
 * @param value - Unknown value to check or decode.
 * @returns `true` when the value matches the expected shape.
 * @category storage
 * @example
 * ```ts
 * import { isNonNegativeDecimalIntegerString } from "@graphrefly/ts/storage";
 * ```
 */
export function isNonNegativeDecimalIntegerString(
	value: unknown,
): value is NonNegativeDecimalIntegerString {
	return typeof value === "string" && NON_NEGATIVE_DECIMAL_INTEGER_RE.test(value);
}

/** Assert a canonical decimal integer string and return it typed.
 * @param value - Unknown value to check or decode.
 * @param label - label value used by the helper.
 * @returns The narrowed, validated value.
 * @category storage
 * @example
 * ```ts
 * import { assertDecimalIntegerString } from "@graphrefly/ts/storage";
 * ```
 */
export function assertDecimalIntegerString(
	value: unknown,
	label = "decimal integer",
): DecimalIntegerString {
	if (!isDecimalIntegerString(value)) {
		throw new TypeError(`${label} must be a canonical decimal integer string`);
	}
	return value;
}

/** Assert a canonical non-negative decimal integer string and return it typed.
 * @param value - Unknown value to check or decode.
 * @param label - label value used by the helper.
 * @returns The narrowed, validated value.
 * @category storage
 * @example
 * ```ts
 * import { assertNonNegativeDecimalIntegerString } from "@graphrefly/ts/storage";
 * ```
 */
export function assertNonNegativeDecimalIntegerString(
	value: unknown,
	label = "decimal integer",
): NonNegativeDecimalIntegerString {
	if (!isNonNegativeDecimalIntegerString(value)) {
		throw new TypeError(`${label} must be a canonical non-negative decimal integer string`);
	}
	return value;
}

/** Convert a host BigInt to the canonical decimal storage scalar.
 * @param value - Unknown value to check or decode.
 * @returns A `DecimalIntegerString` value.
 * @category storage
 * @example
 * ```ts
 * import { bigIntToDecimalString } from "@graphrefly/ts/storage";
 * ```
 */
export function bigIntToDecimalString(value: bigint): DecimalIntegerString {
	return value.toString();
}

/** Convert a non-negative host BigInt to the canonical non-negative decimal storage scalar.
 * @param value - Unknown value to check or decode.
 * @returns A `NonNegativeDecimalIntegerString` value.
 * @category storage
 * @example
 * ```ts
 * import { bigIntToNonNegativeDecimalString } from "@graphrefly/ts/storage";
 * ```
 */
export function bigIntToNonNegativeDecimalString(value: bigint): NonNegativeDecimalIntegerString {
	if (value < 0n) {
		throw new TypeError("decimal integer must be non-negative");
	}
	return value.toString();
}

/** Parse a canonical decimal storage scalar into host BigInt.
 * @param value - Unknown value to check or decode.
 * @returns A `bigint` value.
 * @category storage
 * @example
 * ```ts
 * import { decimalStringToBigInt } from "@graphrefly/ts/storage";
 * ```
 */
export function decimalStringToBigInt(value: DecimalIntegerString): bigint {
	return BigInt(assertDecimalIntegerString(value));
}

/** Parse a canonical non-negative decimal storage scalar into host BigInt.
 * @param value - Unknown value to check or decode.
 * @returns A `bigint` value.
 * @category storage
 * @example
 * ```ts
 * import { nonNegativeDecimalStringToBigInt } from "@graphrefly/ts/storage";
 * ```
 */
export function nonNegativeDecimalStringToBigInt(value: NonNegativeDecimalIntegerString): bigint {
	return BigInt(assertNonNegativeDecimalIntegerString(value));
}
