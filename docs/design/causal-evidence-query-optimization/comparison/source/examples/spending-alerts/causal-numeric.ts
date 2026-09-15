/** D166 consumer-private exact moments. No graph, policy, cache or public API dependency. */
export interface ExactVendorStats {
	readonly count: number;
	readonly mean: number;
	readonly std: number;
	/** All integer strings are in units 2^exponent; dispersion = n*sum(x²)-sum(x)². */
	readonly moments: Readonly<{ sum: string; dispersion: string; exponent: number }>;
}
function dyadic(x: number): { integer: bigint; exponent: number } {
	if (x === 0) return { integer: 0n, exponent: 0 };
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, x);
	const bits = view.getBigUint64(0),
		field = Number((bits >> 52n) & 2047n);
	let integer = (bits & ((1n << 52n) - 1n)) | (field ? 1n << 52n : 0n);
	let exponent = field ? field - 1075 : -1074;
	while ((integer & 1n) === 0n) {
		integer >>= 1n;
		exponent++;
	}
	return { integer, exponent };
}
const width = (x: bigint) => x.toString(2).length;
function exponentOfRatio(a: bigint, b: bigint): number {
	let e = width(a) - width(b);
	if (e >= 0 ? a < b << BigInt(e) : a << BigInt(-e) < b) e--;
	return e;
}
function scaled(a: bigint, b: bigint, shift: number): [bigint, bigint] {
	return shift >= 0 ? [a << BigInt(shift), b] : [a, b << BigInt(-shift)];
}
/** Integer Newton iteration decreases from an upper bound; finite integer width bounds iterations. */
function integerSqrt(a: bigint): bigint {
	if (a < 2n) return a;
	let x = 1n << BigInt(Math.ceil(width(a) / 2));
	for (;;) {
		const next = (x + a / x) >> 1n;
		if (next >= x) return x;
		x = next;
	}
}
/** Round a nonnegative rational or its square root directly, including subnormal ties. */
function rounded(a: bigint, b: bigint, power = 0, sqrt = false): number {
	if (a === 0n) return 0;
	const e = (sqrt ? Math.floor(exponentOfRatio(a, b) / 2) : exponentOfRatio(a, b)) + power;
	const unit = Math.max(-1074, e - 52);
	const [num, den] = scaled(a, b, (power - unit) * (sqrt ? 2 : 1));
	let q = sqrt ? integerSqrt(num / den) : num / den;
	const comparison = sqrt ? 4n * num - den * (2n * q + 1n) ** 2n : 2n * (num % den) - den;
	if (comparison > 0n || (comparison === 0n && (q & 1n) === 1n)) q++;
	return Number(q) * 2 ** unit;
}
export function exactVendorStats(amounts: readonly number[]): ExactVendorStats {
	const count = amounts.length;
	if (!count || count > 64 || amounts.some((x) => !Number.isFinite(x) || x < 0 || x > 1e9))
		throw new TypeError("spending numeric domain");
	// Exact safe-integer moments avoid large-integer accumulation on ordinary bounded amounts.
	let sumNumber = 0,
		squaresNumber = 0;
	let safe = true;
	for (const x of amounts) {
		sumNumber += x;
		squaresNumber += x * x;
		if (
			!Number.isSafeInteger(x) ||
			!Number.isSafeInteger(sumNumber) ||
			!Number.isSafeInteger(squaresNumber)
		)
			safe = false;
	}
	let sum: bigint,
		squares: bigint,
		exponent = 0;
	if (safe) {
		sum = BigInt(sumNumber);
		squares = BigInt(squaresNumber);
	} else {
		const parts = amounts.map(dyadic);
		exponent = Math.min(...parts.filter((p) => p.integer !== 0n).map((p) => p.exponent));
		if (!Number.isFinite(exponent)) exponent = 0;
		sum = 0n;
		squares = 0n;
		for (const part of parts) {
			const x = part.integer === 0n ? 0n : part.integer << BigInt(part.exponent - exponent);
			sum += x;
			squares += x * x;
		}
	}
	const n = BigInt(count),
		dispersion = n * squares - sum * sum;
	return Object.freeze({
		count,
		mean: rounded(sum, n, exponent),
		std: count > 1 ? rounded(dispersion, n * (n - 1n), exponent, true) : 0,
		moments: Object.freeze({ sum: sum.toString(), dispersion: dispersion.toString(), exponent }),
	});
}
export function exactZScore(amount: number, stats: ExactVendorStats): number {
	const dispersion = BigInt(stats.moments.dispersion);
	if (dispersion === 0n) return 0;
	const part = dyadic(amount),
		exponent = Math.min(part.exponent, stats.moments.exponent);
	const x = part.integer << BigInt(part.exponent - exponent);
	const sum = BigInt(stats.moments.sum) << BigInt(stats.moments.exponent - exponent);
	const n = BigInt(stats.count),
		delta = n * x - sum;
	const d = dispersion << BigInt(2 * (stats.moments.exponent - exponent));
	const magnitude = rounded(delta * delta * (n - 1n), n * d, 0, true);
	return magnitude === 0 ? 0 : delta < 0n ? -magnitude : magnitude;
}
