/** Plain arm arithmetic: exact centered deviations; no candidate or verifier math imports. */
function decode(x: number): bigint {
	if (x === 0) return 0n;
	const b = Buffer.alloc(8);
	b.writeDoubleBE(x);
	const value = b.readBigUInt64BE(),
		field = value >> 52n;
	return field === 0n ? value : ((value & 0xfffffffffffffn) + 0x10000000000000n) << (field - 1n);
}
function raw(x: number): bigint {
	const b = Buffer.alloc(8);
	b.writeDoubleBE(x);
	return b.readBigUInt64BE();
}
function value(bits: bigint): number {
	const b = Buffer.alloc(8);
	b.writeBigUInt64BE(bits);
	return b.readDoubleBE();
}
const denominatorUnit = 1n << 1074n;
function roundRoot(n: bigint, d: bigint, candidate: number): number {
	if (n === 0n) return 0;
	// Try a Number candidate, then its immediate neighbors. Exact midpoint tests certify each cell.
	const center = raw(candidate);
	const compare = (sumUnits: bigint) => d * sumUnits ** 2n - n * (2n * denominatorUnit) ** 2n;
	for (const bits of [center, center - 1n, center + 1n]) {
		if (bits < 0n || bits > 0x7fefffffffffffffn) continue;
		const here = decode(value(bits));
		const low = bits === 0n ? -1n : compare(here + decode(value(bits - 1n)));
		const high = compare(here + decode(value(bits + 1n)));
		if (
			(low < 0n || (low === 0n && bits % 2n === 0n)) &&
			(high > 0n || (high === 0n && bits % 2n === 0n))
		)
			return value(bits);
	}
	// Certify a bracket in the known finite score range (|z| < 8 for n <= 64).
	let lo = 0n,
		hi = raw(8);
	while (lo + 1n < hi) {
		const mid = (lo + hi) >> 1n,
			u = decode(value(mid));
		if (d * u * u <= n * denominatorUnit * denominatorUnit) lo = mid;
		else hi = mid;
	}
	const cmp = compare(decode(value(lo)) + decode(value(hi)));
	return value(cmp < 0n || (cmp === 0n && lo % 2n !== 0n) ? hi : lo);
}
export function plainNumbers(amounts: readonly number[], dailyAverage: number) {
	const anchor = decode(amounts[0]),
		n = BigInt(amounts.length);
	let sum = 0n,
		sumSquares = 0n;
	for (const x of amounts) {
		const delta = decode(x) - anchor;
		sum += delta;
		sumSquares += delta * delta;
	}
	const dispersion = n * sumSquares - sum * sum;
	const delta = n * (decode(amounts[amounts.length - 1]) - anchor) - sum;
	// Scale leading bits only for an approximate root; the exact cell check decides acceptance.
	const numerator = delta * delta * (n - 1n),
		denominator = n * dispersion;
	let magnitude = 0;
	if (numerator !== 0n && denominator !== 0n) {
		const shiftN = Math.max(0, numerator.toString(2).length - 53);
		const shiftD = Math.max(0, denominator.toString(2).length - 53);
		const power = shiftN - shiftD;
		const estimate =
			Math.sqrt(
				(Number(numerator >> BigInt(shiftN)) / Number(denominator >> BigInt(shiftD))) *
					2 ** (power % 2),
			) *
			2 ** Math.floor(power / 2);
		magnitude = roundRoot(numerator, denominator, estimate);
	}
	return {
		zScore: magnitude === 0 ? 0 : delta < 0n ? -magnitude : magnitude,
		dailyRatio:
			amounts[amounts.length - 1] === 0
				? 0
				: amounts[amounts.length - 1] / Math.max(dailyAverage, 1),
	};
}
