/**
 * Passive resilience policy helpers for graph-visible adapters (D130/D132).
 *
 * These helpers never schedule work and never own graph state. Drivers/adapters
 * consume them, while graph-visible bundles expose attempts/status/errors.
 */

export type BackoffPolicy =
	| { readonly kind: "none" }
	| { readonly kind: "constant"; readonly delayMs: number }
	| {
			readonly kind: "linear";
			readonly initialMs: number;
			readonly stepMs: number;
			readonly maxMs?: number;
	  }
	| {
			readonly kind: "exponential";
			readonly initialMs: number;
			readonly factor: number;
			readonly maxMs?: number;
	  }
	| { readonly kind: "fibonacci"; readonly unitMs: number; readonly maxMs?: number };

export interface RetryPolicy {
	/** Total attempts including the first try. */
	readonly maxAttempts: number;
	readonly backoff: BackoffPolicy;
}

export type RetryState = "idle" | "running" | "waiting" | "succeeded" | "failed" | "exhausted";

export interface RetryStatus {
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly delayMs?: number;
	readonly state: RetryState;
}

export const noBackoff: BackoffPolicy = Object.freeze({ kind: "none" });

/**
 * Build an immutable retry policy.
 *
 * @param maxAttempts - Total attempts including the first try.
 * @param backoff - Backoff strategy used between attempts.
 * @returns A frozen retry policy record.
 * @example
 * ```ts
 * retryPolicy(3, { kind: "constant", delayMs: 250 });
 * ```
 * @category graph
 */
export function retryPolicy(maxAttempts = 1, backoff: BackoffPolicy = noBackoff): RetryPolicy {
	if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
		throw new RangeError("retryPolicy: maxAttempts must be a positive integer");
	}
	return Object.freeze({ maxAttempts, backoff });
}

/**
 * Check whether another retry attempt remains.
 *
 * @param policy - Retry policy to inspect.
 * @param failedAttempt - The attempt number that just failed.
 * @returns `true` while the failed attempt is still below the maximum.
 * @example
 * ```ts
 * shouldRetry(retryPolicy(3), 2); // true
 * ```
 * @category graph
 */
export function shouldRetry(policy: RetryPolicy, failedAttempt: number): boolean {
	return failedAttempt < policy.maxAttempts;
}

/**
 * Compute the delay before the next retry.
 *
 * @param policy - Retry policy to use.
 * @param nextAttempt - The attempt number about to run.
 * @returns The delay in milliseconds, or `undefined` when the attempt is out of range.
 * @example
 * ```ts
 * nextRetryDelayMs(retryPolicy(3, { kind: "constant", delayMs: 250 }), 2);
 * ```
 * @category graph
 */
export function nextRetryDelayMs(policy: RetryPolicy, nextAttempt: number): number | undefined {
	if (!Number.isInteger(nextAttempt) || nextAttempt <= 0 || nextAttempt > policy.maxAttempts) {
		return undefined;
	}
	return backoffDelayMs(policy.backoff, nextAttempt);
}

/**
 * Compute the delay for a backoff policy at a specific attempt.
 *
 * @param policy - Backoff policy to evaluate.
 * @param attempt - One-based attempt counter.
 * @returns The computed delay in milliseconds.
 * @example
 * ```ts
 * backoffDelayMs({ kind: "linear", initialMs: 100, stepMs: 50 }, 3);
 * ```
 * @category graph
 */
export function backoffDelayMs(policy: BackoffPolicy, attempt: number): number {
	const safeAttempt = Math.max(1, Math.trunc(attempt));
	switch (policy.kind) {
		case "none":
			return 0;
		case "constant":
			return nonNegative(policy.delayMs);
		case "linear":
			return cap(
				nonNegative(policy.initialMs) + nonNegative(policy.stepMs) * (safeAttempt - 1),
				policy.maxMs,
			);
		case "exponential": {
			const factor = Math.max(1, Math.trunc(policy.factor));
			return cap(nonNegative(policy.initialMs) * factor ** (safeAttempt - 1), policy.maxMs);
		}
		case "fibonacci":
			return cap(nonNegative(policy.unitMs) * fibonacci(safeAttempt), policy.maxMs);
	}
}

function cap(value: number, max: number | undefined): number {
	if (max === undefined) return value;
	return Math.min(value, nonNegative(max));
}

function nonNegative(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, value);
}

function fibonacci(n: number): number {
	if (n <= 1) return 1;
	let prev = 1;
	let curr = 1;
	for (let i = 2; i <= n; i += 1) {
		const next = prev + curr;
		prev = curr;
		curr = next;
	}
	return curr;
}
