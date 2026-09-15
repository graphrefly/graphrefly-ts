/** Independent D166 oracle: pairwise differences, ordered-float bisection, exact midpoint tests.
 * No production arithmetic imports. All bit values below represent nonnegative finite Numbers.
 */
function bits(x: number): bigint {
	const buffer = Buffer.alloc(8);
	buffer.writeDoubleBE(x);
	return buffer.readBigUInt64BE();
}
function number(x: bigint): number {
	const buffer = Buffer.alloc(8);
	buffer.writeBigUInt64BE(x);
	return buffer.readDoubleBE();
}
/** Integer multiples of the smallest subnormal; deliberately different from candidate local scaling. */
function unitsFromBits(b: bigint): bigint {
	const exponent = (b >> 52n) & 2047n,
		mantissa = b & 0xfffffffffffffn;
	return exponent === 0n ? mantissa : (mantissa | 0x10000000000000n) << (exponent - 1n);
}
const units = (x: number) => unitsFromBits(bits(x));
const unitDenominator = 1n << 1074n;
/** Exhausts at most 63 binary subdivisions of the nonnegative finite binary64 ordering. */
function referenceRound(numerator: bigint, denominator: bigint, squareRoot: boolean): number {
	if (numerator === 0n) return 0;
	const compare = (u: bigint, divisor = 1n) =>
		squareRoot
			? u * u * denominator - numerator * (unitDenominator * divisor) ** 2n
			: u * denominator - numerator * unitDenominator * divisor;
	let lo = 0n,
		hi = 0x7fefffffffffffffn;
	while (lo < hi) {
		const mid = (lo + hi + 1n) / 2n;
		if (compare(unitsFromBits(mid)) <= 0n) lo = mid;
		else hi = mid - 1n;
	}
	const lower = unitsFromBits(lo);
	if (compare(lower) === 0n) return number(lo);
	const midpointComparison = compare(lower + unitsFromBits(lo + 1n), 2n);
	return number(
		midpointComparison < 0n || (midpointComparison === 0n && lo % 2n === 1n) ? lo + 1n : lo,
	);
}
export function referenceNumbers(amounts: readonly number[], dailyAverage: number) {
	const xs = amounts.map(units),
		count = xs.length,
		n = BigInt(count);
	let total = 0n,
		pairs = 0n;
	for (let i = 0; i < count; i++) {
		total += xs[i];
		for (let j = 0; j < i; j++) pairs += (xs[i] - xs[j]) ** 2n;
	}
	const delta = n * xs[count - 1] - total;
	const z = pairs === 0n ? 0 : referenceRound(delta ** 2n * (n - 1n), n * pairs, true);
	return {
		mean: referenceRound(total, n * unitDenominator, false),
		std: count < 2 ? 0 : referenceRound(pairs, n * (n - 1n) * unitDenominator ** 2n, true),
		zScore: z === 0 ? 0 : delta < 0n ? -z : z,
		dailyRatio: referenceRound(xs[count - 1], units(Math.max(dailyAverage, 1)), false),
		varianceNonzero: pairs !== 0n,
	};
}
/** Independent fixed formatting of accepted finite Numbers: ties round toward larger magnitude. */
export function referenceFixed(x: number, digits: number): string {
	const negative = x < 0,
		magnitude = units(Math.abs(x)) * 10n ** BigInt(digits);
	let q = magnitude / unitDenominator;
	if (2n * (magnitude % unitDenominator) >= unitDenominator) q++;
	const text = q.toString().padStart(digits + 1, "0");
	return `${negative ? "-" : ""}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
