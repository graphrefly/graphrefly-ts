/**
 * `withRetry` — retry `invoke()` / `stream()` on transient errors.
 *
 * Streaming retry is tricky: we retry only if the stream fails before
 * yielding any tokens. Once tokens have started flowing, we surface the
 * error to avoid replaying from scratch (which would double-bill and
 * confuse consumers). Opt out of streaming retry via `opts.retryStreaming = false`.
 *
 * Uses `ResettableTimer` for backoff sleeps (spec §5.10 escape hatch, same
 * pattern as `extra/resilience.ts`). Abort-aware — early-aborts before the
 * first attempt and cleans up the abort listener on both the timer-fires
 * and abort paths.
 */

import { ResettableTimer } from "@graphrefly/pure-ts/core";
import { fromAny } from "@graphrefly/pure-ts/extra";
import { firstValueFrom } from "../../../../base/sources/settled.js";
import { adapterWrapper, withLayer } from "../_internal/wrappers.js";
import type { LLMAdapter, LLMResponse, StreamDelta } from "../core/types.js";

export interface WithRetryOptions {
	/** Max total attempts (including the first). Default 3. */
	attempts?: number;
	/** Base delay in ms. Default 500. */
	baseDelayMs?: number;
	/** Max delay in ms. Default 10_000. */
	maxDelayMs?: number;
	/**
	 * Delay strategy. Default `"decorrelated"` — AWS-style `random(baseDelay,
	 * min(maxDelay, prev * 3))` which smooths retry storms and matches common
	 * SDK expectations. `"exp"` and `"linear"` produce deterministic schedules
	 * when `jitter: false`.
	 */
	strategy?: "exp" | "linear" | "decorrelated";
	/**
	 * Add randomized jitter. Ignored for `strategy: "decorrelated"` (which is
	 * inherently jittered). For `exp`/`linear`, symmetric jitter in `[0.5x,
	 * 1.5x]` of the nominal delay.
	 */
	jitter?: boolean;
	/**
	 * Predicate: should this error trigger a retry? Default retries network /
	 * 5xx / 429 / transient errors, but not 4xx (other than 429), aborts, or
	 * `BudgetExhaustedError` from upstream middleware.
	 */
	shouldRetry?: (err: unknown, attempt: number) => boolean;
	/** Retry streaming calls if they fail pre-first-token. Default true. */
	retryStreaming?: boolean;
}

function makeAbortError(reason = "aborted"): Error {
	const err = new Error(reason) as Error & { name: string };
	err.name = "AbortError";
	return err;
}

/**
 * Promise-based abort-aware sleep using `ResettableTimer`.
 * Spec §5.10 escape hatch — same pattern as `extra/resilience.ts`.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted) return Promise.reject(makeAbortError());
	return new Promise((resolve, reject) => {
		const timer = new ResettableTimer();
		let onAbort: (() => void) | undefined;
		const cleanup = (): void => {
			timer.cancel();
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		};
		timer.start(ms, () => {
			cleanup();
			resolve();
		});
		if (signal) {
			onAbort = (): void => {
				cleanup();
				reject(makeAbortError());
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

export function withRetry(inner: LLMAdapter, opts: WithRetryOptions = {}): LLMAdapter {
	const attempts = opts.attempts ?? 3;
	const baseDelayMs = opts.baseDelayMs ?? 500;
	const maxDelayMs = opts.maxDelayMs ?? 10_000;
	const strategy = opts.strategy ?? "decorrelated";
	const jitter = opts.jitter ?? true;
	const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
	const retryStreaming = opts.retryStreaming ?? true;

	// Decorrelated state — carried across the same acquire's retries.
	const delay = (attempt: number, prevDelay: number): number => {
		if (strategy === "decorrelated") {
			// AWS-style: random(baseDelay, min(maxDelay, prevDelay * 3))
			const upper = Math.min(maxDelayMs, Math.max(baseDelayMs, prevDelay * 3));
			return baseDelayMs + Math.random() * (upper - baseDelayMs);
		}
		const nominal = strategy === "exp" ? baseDelayMs * 2 ** (attempt - 1) : baseDelayMs * attempt;
		const bounded = Math.min(maxDelayMs, nominal);
		if (!jitter) return bounded;
		// Symmetric jitter: bounded * [0.5, 1.5), clamped.
		const jittered = bounded * (0.5 + Math.random());
		return Math.min(maxDelayMs, jittered);
	};

	const wrap = adapterWrapper(inner, {
		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			if (invokeOpts?.signal?.aborted) throw makeAbortError();
			let lastErr: unknown;
			let prevDelay = baseDelayMs;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await firstValueFrom(fromAny(inner.invoke(messages, invokeOpts)));
				} catch (err) {
					lastErr = err;
					if (attempt >= attempts || !shouldRetry(err, attempt)) throw err;
					const waitMs = delay(attempt, prevDelay);
					prevDelay = waitMs;
					await sleep(waitMs, invokeOpts?.signal);
				}
			}
			throw lastErr;
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			if (invokeOpts?.signal?.aborted) throw makeAbortError();
			if (!retryStreaming) {
				for await (const d of inner.stream(messages, invokeOpts)) yield d;
				return;
			}
			let lastErr: unknown;
			let prevDelay = baseDelayMs;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				let yieldedAny = false;
				try {
					for await (const d of inner.stream(messages, invokeOpts)) {
						yieldedAny = true;
						yield d;
					}
					return;
				} catch (err) {
					lastErr = err;
					if (yieldedAny) throw err;
					if (attempt >= attempts || !shouldRetry(err, attempt)) throw err;
					const waitMs = delay(attempt, prevDelay);
					prevDelay = waitMs;
					await sleep(waitMs, invokeOpts?.signal);
				}
			}
			throw lastErr;
		},
	});
	withLayer(wrap, "withRetry", inner);
	return wrap;
}

function defaultShouldRetry(err: unknown, _attempt: number): boolean {
	if (err == null) return false;
	const e = err as { name?: string; status?: number; code?: string; message?: string };
	// Timeout-family errors — retry by default so each attempt re-arms the
	// per-attempt deadline set by `withTimeout`. Checked BEFORE the abort
	// guards below because `withTimeout` re-throws its timer-fire path as
	// `LLMTimeoutError` even when the underlying fetch rejected with
	// AbortError.
	if (e.name === "LLMTimeoutError") return true;
	// Abort-family errors — never retry (caller initiated).
	if (e.name === "AbortError") return false;
	if (e.message === "aborted") return false;
	if (e.name === "DOMException" && e.code != null && Number(e.code) === 20 /* ABORT_ERR */) {
		return false;
	}
	if (e.name === "BudgetExhaustedError") return false;
	if (e.name === "CircuitOpenError") return false;
	if (e.status != null) {
		if (e.status === 429) return true;
		if (e.status >= 500 && e.status < 600) return true;
		return false;
	}
	// Network-level errors often have codes like ECONNRESET, ENOTFOUND, etc.
	if (e.code && typeof e.code === "string") {
		if (/^E[A-Z]+$/.test(e.code)) return true;
	}
	if (e.message) {
		return /network|timeout|socket|fetch|econn|eai_/i.test(e.message);
	}
	return false;
}
