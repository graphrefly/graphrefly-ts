/**
 * Backoff strategies for {@link retry} (roadmap §3.1). Delays are in **nanoseconds**.
 *
 * Convention: all graphrefly-ts timestamps and durations use nanoseconds (`_ns` suffix).
 * 1 second = 1_000_000_000 ns, 1 ms = 1_000_000 ns.
 */

export const NS_PER_MS = 1_000_000;
export const NS_PER_SEC = 1_000_000_000;

export type JitterMode = "none" | "full" | "equal";

export type BackoffPreset =
	| "constant"
	| "linear"
	| "exponential"
	| "fibonacci"
	| "decorrelatedJitter";

/** `(attempt, error?, previousDelayNs?) => delayNs | null` — `null` means zero delay. */
export type BackoffStrategy = (
	attempt: number,
	error?: unknown,
	prevDelayNs?: number | null,
) => number | null;

function clampNonNegative(value: number): number {
	return value < 0 ? 0 : value;
}

function applyJitter(delay: number, jitter: JitterMode): number {
	if (jitter === "none") return delay;
	if (jitter === "full") return Math.random() * delay;
	return delay / 2 + Math.random() * (delay / 2);
}

function randomBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

/**
 * Builds a strategy that always returns the same delay in nanoseconds.
 *
 * @param delayNs - Non-negative delay in nanoseconds; values below zero are clamped to zero.
 * @returns `BackoffStrategy` for use with {@link retry} or custom timers.
 *
 * @example
 * ```ts
 * import { constant, retry, NS_PER_SEC } from "@graphrefly/graphrefly-ts";
 *
 * const out = retry(source, { count: 3, backoff: constant(0.25 * NS_PER_SEC) });
 * ```
 *
 * @category extra
 */
export function constant(delayNs: number): BackoffStrategy {
	const safe = clampNonNegative(delayNs);
	return () => safe;
}

/**
 * Builds linear backoff: `baseNs + stepNs * attempt` (`stepNs` defaults to `baseNs`).
 *
 * @param baseNs - Base delay in nanoseconds (clamped non-negative).
 * @param stepNs - Added per retry attempt in nanoseconds (clamped non-negative).
 * @returns `BackoffStrategy` for {@link retry}.
 *
 * @category extra
 */
export function linear(baseNs: number, stepNs?: number): BackoffStrategy {
	const safeBase = clampNonNegative(baseNs);
	const safeStep = stepNs === undefined ? safeBase : clampNonNegative(stepNs);
	return (attempt: number) => safeBase + safeStep * Math.max(0, attempt);
}

export type ExponentialBackoffOptions = {
	baseNs?: number;
	factor?: number;
	maxDelayNs?: number;
	jitter?: JitterMode;
};

/**
 * Builds exponential backoff in nanoseconds, capped by `maxDelayNs`, with optional jitter.
 *
 * @param options - Base, factor, cap, and jitter mode.
 * @returns `BackoffStrategy` for {@link retry}.
 *
 * @remarks
 * **Jitter:** `"full"` spreads delay across `[0, delay]`; `"equal"` uses `[delay/2, delay]`.
 *
 * @category extra
 */
export function exponential(options?: ExponentialBackoffOptions): BackoffStrategy {
	const baseNs = clampNonNegative(options?.baseNs ?? 100 * NS_PER_MS);
	const factor = options?.factor !== undefined && options.factor < 1 ? 1 : (options?.factor ?? 2);
	const maxDelayNs = clampNonNegative(options?.maxDelayNs ?? 30 * NS_PER_SEC);
	const jitter = options?.jitter ?? "none";

	return (attempt: number) => {
		let delay: number;
		if (baseNs === 0) {
			delay = 0;
		} else if (factor === 1) {
			delay = baseNs;
		} else {
			const capRatio = maxDelayNs / baseNs;
			let growth = 1;
			for (let i = 0; i < Math.max(0, attempt); i++) {
				if (growth >= capRatio) {
					growth = capRatio;
					break;
				}
				growth *= factor;
			}
			delay = baseNs * growth;
			if (delay > maxDelayNs) delay = maxDelayNs;
		}
		return applyJitter(delay, jitter);
	};
}

/**
 * Builds Fibonacci-scaled delays: `1, 2, 3, 5, … × baseNs`, capped at `maxDelayNs`.
 *
 * @param baseNs - Multiplier applied to the Fibonacci unit (default `100ms` in nanoseconds).
 * @param maxDelayNs - Upper bound in nanoseconds (default `30s`).
 * @returns `BackoffStrategy` for {@link retry}.
 *
 * @category extra
 */
export function fibonacci(baseNs = 100 * NS_PER_MS, maxDelayNs = 30 * NS_PER_SEC): BackoffStrategy {
	const safeBase = clampNonNegative(baseNs);
	const safeMax = clampNonNegative(maxDelayNs);

	function fibUnit(attempt: number): number {
		if (attempt <= 0) return 1;
		let prev = 1;
		let cur = 2;
		for (let i = 1; i < attempt; i++) {
			const next = prev + cur;
			prev = cur;
			cur = next;
		}
		return cur;
	}

	return (attempt: number) => {
		const raw = fibUnit(attempt) * safeBase;
		return raw <= safeMax ? raw : safeMax;
	};
}

/**
 * Decorrelated jitter (AWS-recommended): `random(baseNs, min(maxNs, lastDelay * 3))`.
 *
 * Stateless — uses `prevDelayNs` (passed by the consumer) instead of closure state.
 * Safe to share across concurrent retry sequences.
 *
 * @param baseNs - Floor of the random range (default `100ms` in nanoseconds).
 * @param maxNs - Ceiling cap (default `30s` in nanoseconds).
 * @returns `BackoffStrategy` for {@link retry}.
 *
 * @category extra
 */
export function decorrelatedJitter(
	baseNs = 100 * NS_PER_MS,
	maxNs = 30 * NS_PER_SEC,
): BackoffStrategy {
	return (_attempt, _error, prevDelayNs) => {
		const last = prevDelayNs ?? baseNs;
		const ceiling = Math.min(maxNs, last * 3);
		return randomBetween(baseNs, ceiling);
	};
}

/**
 * Decorator that caps any strategy at `maxAttempts`. Returns `null` (stop retrying) after the cap.
 *
 * @param strategy - Inner strategy to wrap.
 * @param maxAttempts - Maximum number of attempts (inclusive).
 * @returns Wrapped `BackoffStrategy`.
 *
 * @category extra
 */
export function withMaxAttempts(strategy: BackoffStrategy, maxAttempts: number): BackoffStrategy {
	return (attempt, error, prevDelayNs) => {
		if (attempt >= maxAttempts) return null;
		return strategy(attempt, error, prevDelayNs);
	};
}

/**
 * Maps a preset name to a concrete {@link BackoffStrategy} with library-default parameters.
 *
 * @param name - One of `constant`, `linear`, `exponential`, `fibonacci`, or `decorrelatedJitter`.
 * @returns Configured strategy with default parameters.
 * @throws Error when `name` is not a known preset.
 *
 * @category extra
 */
export function resolveBackoffPreset(name: BackoffPreset): BackoffStrategy {
	if (name === "constant") return constant(1 * NS_PER_SEC);
	if (name === "linear") return linear(1 * NS_PER_SEC);
	if (name === "exponential") return exponential();
	if (name === "fibonacci") return fibonacci();
	if (name === "decorrelatedJitter") return decorrelatedJitter();
	throw new Error(
		`Unknown backoff preset: "${String(name)}". Use one of: constant, linear, exponential, fibonacci, decorrelatedJitter`,
	);
}
