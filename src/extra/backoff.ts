/**
 * Backoff strategies for {@link retry} (roadmap §3.1). Delays are in **seconds**.
 */

export type JitterMode = "none" | "full" | "equal";

export type BackoffPreset = "constant" | "linear" | "exponential" | "fibonacci";

/** `(attempt, error?, previousDelaySeconds?) => delaySeconds | null` — `null` means zero delay. */
export type BackoffStrategy = (
	attempt: number,
	error?: unknown,
	prevDelaySeconds?: number | null,
) => number | null;

function clampNonNegative(value: number): number {
	return value < 0 ? 0 : value;
}

function applyJitter(delay: number, jitter: JitterMode): number {
	if (jitter === "none") return delay;
	if (jitter === "full") return Math.random() * delay;
	return delay / 2 + Math.random() * (delay / 2);
}

/**
 * Builds a strategy that always returns the same delay in seconds.
 *
 * @param delaySeconds - Non-negative delay; values below zero are clamped to zero.
 * @returns `BackoffStrategy` for use with {@link retry} or custom timers.
 *
 * @example
 * ```ts
 * import { constant, retry } from "@graphrefly/graphrefly-ts";
 *
 * const op = retry({ count: 3, backoff: constant(0.25) });
 * ```
 *
 * @category extra
 */
export function constant(delaySeconds: number): BackoffStrategy {
	const safe = clampNonNegative(delaySeconds);
	return () => safe;
}

/**
 * Builds linear backoff: `baseSeconds + stepSeconds * attempt` (`stepSeconds` defaults to `baseSeconds`).
 *
 * @param baseSeconds - Base delay in seconds (clamped non-negative).
 * @param stepSeconds - Added per retry attempt (clamped non-negative).
 * @returns `BackoffStrategy` for {@link retry}.
 *
 * @category extra
 */
export function linear(baseSeconds: number, stepSeconds?: number): BackoffStrategy {
	const safeBase = clampNonNegative(baseSeconds);
	const safeStep = stepSeconds === undefined ? safeBase : clampNonNegative(stepSeconds);
	return (attempt: number) => safeBase + safeStep * Math.max(0, attempt);
}

export type ExponentialBackoffOptions = {
	baseSeconds?: number;
	factor?: number;
	maxDelaySeconds?: number;
	jitter?: JitterMode;
};

/**
 * Builds exponential backoff in seconds, capped by `maxDelaySeconds`, with optional jitter.
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
	const baseSeconds = clampNonNegative(options?.baseSeconds ?? 0.1);
	const factor = options?.factor !== undefined && options.factor < 1 ? 1 : (options?.factor ?? 2);
	const maxDelaySeconds = clampNonNegative(options?.maxDelaySeconds ?? 30);
	const jitter = options?.jitter ?? "none";

	return (attempt: number) => {
		let delay: number;
		if (baseSeconds === 0) {
			delay = 0;
		} else if (factor === 1) {
			delay = baseSeconds;
		} else {
			const capRatio = maxDelaySeconds / baseSeconds;
			let growth = 1;
			for (let i = 0; i < Math.max(0, attempt); i++) {
				if (growth >= capRatio) {
					growth = capRatio;
					break;
				}
				growth *= factor;
			}
			delay = baseSeconds * growth;
			if (delay > maxDelaySeconds) delay = maxDelaySeconds;
		}
		return applyJitter(delay, jitter);
	};
}

/**
 * Builds Fibonacci-scaled delays: `1, 2, 3, 5, … × baseSeconds`, capped at `maxDelaySeconds`.
 *
 * @param baseSeconds - Multiplier applied to the Fibonacci unit (default `0.1`).
 * @param maxDelaySeconds - Upper bound in seconds (default `30`).
 * @returns `BackoffStrategy` for {@link retry}.
 *
 * @category extra
 */
export function fibonacci(baseSeconds = 0.1, maxDelaySeconds = 30): BackoffStrategy {
	const safeBase = clampNonNegative(baseSeconds);
	const safeMax = clampNonNegative(maxDelaySeconds);

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
 * Maps a preset name to a concrete {@link BackoffStrategy} with library-default parameters.
 *
 * @param name - One of `constant`, `linear`, `exponential`, or `fibonacci`.
 * @returns Configured strategy (1s constant/linear, default exponential/fibonacci).
 * @throws Error when `name` is not a known preset.
 *
 * @category extra
 */
export function resolveBackoffPreset(name: BackoffPreset): BackoffStrategy {
	if (name === "constant") return constant(1);
	if (name === "linear") return linear(1);
	if (name === "exponential") return exponential();
	if (name === "fibonacci") return fibonacci();
	throw new Error(`Unknown backoff preset: ${String(name)}`);
}
