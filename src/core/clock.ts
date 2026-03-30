/**
 * Centralised timestamp utilities.
 *
 * Convention: all graphrefly-ts timestamps use nanoseconds (`_ns` suffix).
 *
 * - {@link monotonicNs} — monotonic clock (ordering, durations, timeline events).
 * - {@link wallClockNs} — wall-clock (mutation attribution, cron emission).
 *
 * **Precision limits (JS platform):**
 *
 * - `monotonicNs`: effective ~microsecond precision. `performance.now()` returns
 *   milliseconds with ~5µs resolution; the last 3 digits of the nanosecond value
 *   are always zero. Python's `time.monotonic_ns()` gives true nanoseconds.
 *
 * - `wallClockNs`: ~256ns precision loss at current epoch. `Date.now() * 1e6`
 *   produces values around 1.8×10¹⁸ which exceed IEEE 754's 2⁵³ safe integer
 *   limit. Python's `time.time_ns()` (arbitrary-precision `int`) has no loss.
 *   In practice this is irrelevant — JS is single-threaded, so sub-microsecond
 *   timestamp collisions cannot occur.
 */

/** Monotonic nanosecond timestamp via `performance.now()`. */
export function monotonicNs(): number {
	return Math.trunc(performance.now() * 1_000_000);
}

/** Wall-clock nanosecond timestamp via `Date.now()`. */
export function wallClockNs(): number {
	return Date.now() * 1_000_000;
}
