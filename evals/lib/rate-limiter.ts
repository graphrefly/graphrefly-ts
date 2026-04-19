/**
 * Adaptive rate limiter for eval LLM calls.
 *
 * Proactively paces requests to stay within RPM/TPM/RPD limits.
 * When a 429 (or similar) arrives, parses headers/error body to learn
 * the real limits and adjusts on the fly.
 *
 * Strategy:
 *   1. Sliding-window RPM/TPM tracking (proactive pacing).
 *   2. On 429: parse `retry-after`, `x-ratelimit-*` headers if available.
 *   3. Exponential backoff with jitter for unknown/unparseable 429s.
 *   4. Tighten learned limits when 429s arrive; relax slowly when calls succeed.
 */

import type { ResolvedLimits } from "./limits.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimiterStats {
	/** Total calls made through this limiter. */
	totalCalls: number;
	/** Total 429s encountered. */
	totalRetries: number;
	/** Current effective RPM (may differ from configured after adaptation). */
	effectiveRpm: number;
	/** Current effective TPM. */
	effectiveTpm: number;
	/** Total time spent waiting for rate limit pacing (ms). */
	totalWaitMs: number;
	/** Remaining RPD budget (Infinity if unlimited). */
	remainingRpd: number;
}

/** Parsed rate-limit info from a 429 error or response headers. */
interface RateLimitSignal {
	retryAfterMs?: number;
	remainingRequests?: number;
	remainingTokens?: number;
	limitRequests?: number;
	limitTokens?: number;
	resetRequestsMs?: number;
	resetTokensMs?: number;
}

// ---------------------------------------------------------------------------
// Sliding window tracker
// ---------------------------------------------------------------------------

/** Tracks events in a 60-second sliding window. */
class SlidingWindow {
	private timestamps: number[] = [];
	private values: number[] = [];

	/** Record an event with an associated value (e.g., token count). */
	record(value: number): void {
		const now = Date.now();
		this.timestamps.push(now);
		this.values.push(value);
		this.prune(now);
	}

	/** Count of events in the last 60 seconds. */
	count(): number {
		this.prune(Date.now());
		return this.timestamps.length;
	}

	/** Sum of values in the last 60 seconds. */
	sum(): number {
		this.prune(Date.now());
		let total = 0;
		for (const v of this.values) total += v;
		return total;
	}

	private prune(now: number): void {
		const cutoff = now - 60_000;
		let i = 0;
		while (i < this.timestamps.length && this.timestamps[i] < cutoff) i++;
		if (i > 0) {
			this.timestamps.splice(0, i);
			this.values.splice(0, i);
		}
	}
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

export class AdaptiveRateLimiter {
	private limits: ResolvedLimits;
	private effectiveRpm: number;
	private effectiveTpm: number;
	private requestWindow = new SlidingWindow();
	private tokenWindow = new SlidingWindow();
	private dailyRequests = 0;
	private dayStart = Date.now();
	private consecutiveBackoffs = 0;
	private totalWaitMs = 0;
	private totalRetries = 0;
	private totalCalls = 0;

	constructor(limits: ResolvedLimits) {
		this.limits = limits;
		// Start at 85% of stated limits to avoid edge-case 429s
		this.effectiveRpm = Math.floor(limits.rpm * 0.85);
		this.effectiveTpm = Math.floor(limits.tpm * 0.85);
	}

	/**
	 * Wait until it's safe to make a call, then execute `fn`.
	 * Handles 429 retries internally.
	 */
	async call<T>(fn: () => Promise<T>, estimatedTokens: number): Promise<T> {
		const maxAttempts = 5;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			// Proactive pacing: wait if we're at the limit
			await this.paceBeforeCall(estimatedTokens);

			try {
				const result = await fn();
				this.recordSuccess(estimatedTokens);
				return result;
			} catch (err: unknown) {
				const signal = parseRateLimitError(err);
				if (!signal) throw err; // Not a rate limit error — rethrow

				this.totalRetries++;
				this.adaptFromSignal(signal);

				const waitMs = this.computeRetryWait(signal, attempt);
				console.log(
					`  [rate-limit] 429 on attempt ${attempt + 1}/${maxAttempts}, ` +
						`waiting ${(waitMs / 1000).toFixed(1)}s ` +
						`(effective RPM: ${this.effectiveRpm}, TPM: ${this.effectiveTpm})`,
				);
				this.totalWaitMs += waitMs;
				await sleep(waitMs);
			}
		}
		throw new Error(
			`Rate limit: exhausted ${maxAttempts} retries. ` +
				`Effective RPM=${this.effectiveRpm}, TPM=${this.effectiveTpm}. ` +
				`Consider raising EVAL_RPM/EVAL_TPM or using a higher-tier API key.`,
		);
	}

	/** Record token usage after a successful call (for accurate TPM tracking). */
	recordUsage(actualTokens: number): void {
		// Update the token window with the delta between actual and estimated
		this.tokenWindow.record(actualTokens);
	}

	stats(): RateLimiterStats {
		return {
			totalCalls: this.totalCalls,
			totalRetries: this.totalRetries,
			effectiveRpm: this.effectiveRpm,
			effectiveTpm: this.effectiveTpm,
			totalWaitMs: this.totalWaitMs,
			remainingRpd: this.limits.rpd - this.dailyRequests,
		};
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	private async paceBeforeCall(estimatedTokens: number): Promise<void> {
		// Reset daily counter if new day
		if (Date.now() - this.dayStart > 86_400_000) {
			this.dailyRequests = 0;
			this.dayStart = Date.now();
		}

		// RPD check
		if (this.dailyRequests >= this.limits.rpd) {
			throw new Error(
				`Rate limit: daily request limit reached (${this.limits.rpd} RPD). ` +
					`Wait until tomorrow or use a paid tier.`,
			);
		}

		// RPM pacing
		while (this.requestWindow.count() >= this.effectiveRpm) {
			const waitMs = 2_000; // Check every 2s
			this.totalWaitMs += waitMs;
			await sleep(waitMs);
		}

		// TPM pacing
		while (
			this.effectiveTpm < Infinity &&
			this.tokenWindow.sum() + estimatedTokens > this.effectiveTpm
		) {
			const waitMs = 3_000; // Check every 3s
			this.totalWaitMs += waitMs;
			await sleep(waitMs);
		}
	}

	private recordSuccess(estimatedTokens: number): void {
		this.totalCalls++;
		this.dailyRequests++;
		this.requestWindow.record(1);
		this.tokenWindow.record(estimatedTokens);

		// Slowly relax back toward configured limits after successful calls
		if (this.consecutiveBackoffs > 0) {
			this.consecutiveBackoffs = Math.max(0, this.consecutiveBackoffs - 1);
		}
		const configuredRpm = Math.floor(this.limits.rpm * 0.85);
		const configuredTpm = Math.floor(this.limits.tpm * 0.85);
		if (this.effectiveRpm < configuredRpm) {
			this.effectiveRpm = Math.min(configuredRpm, this.effectiveRpm + 1);
		}
		if (this.effectiveTpm < configuredTpm) {
			this.effectiveTpm = Math.min(
				configuredTpm,
				this.effectiveTpm + Math.floor(configuredTpm * 0.05),
			);
		}
	}

	private adaptFromSignal(signal: RateLimitSignal): void {
		this.consecutiveBackoffs++;

		// If the server told us its actual limits, use them (with margin)
		if (signal.limitRequests != null) {
			const serverRpm = Math.floor(signal.limitRequests * 0.8);
			if (serverRpm < this.effectiveRpm) {
				this.effectiveRpm = serverRpm;
				console.log(
					`  [rate-limit] Learned RPM limit from server: ${signal.limitRequests} → using ${serverRpm}`,
				);
			}
		}
		if (signal.limitTokens != null) {
			const serverTpm = Math.floor(signal.limitTokens * 0.8);
			if (serverTpm < this.effectiveTpm) {
				this.effectiveTpm = serverTpm;
				console.log(
					`  [rate-limit] Learned TPM limit from server: ${signal.limitTokens} → using ${serverTpm}`,
				);
			}
		}

		// Otherwise, tighten by 30% per consecutive backoff (floor at 1 RPM)
		if (signal.limitRequests == null) {
			this.effectiveRpm = Math.max(1, Math.floor(this.effectiveRpm * 0.7));
		}
		if (signal.limitTokens == null) {
			this.effectiveTpm = Math.max(1_000, Math.floor(this.effectiveTpm * 0.7));
		}
	}

	private computeRetryWait(signal: RateLimitSignal, attempt: number): number {
		// Prefer server-provided retry-after
		if (signal.retryAfterMs != null && signal.retryAfterMs > 0) {
			// Add small jitter (10-20%) to avoid thundering herd
			return signal.retryAfterMs + Math.random() * signal.retryAfterMs * 0.2;
		}

		// Prefer server-provided reset time
		if (signal.resetRequestsMs != null && signal.resetRequestsMs > 0) {
			return signal.resetRequestsMs + Math.random() * 1_000;
		}

		// Exponential backoff with jitter: 2s, 4s, 8s, 16s, 32s
		const baseMs = 2_000;
		const expMs = baseMs * 2 ** attempt;
		const jitter = Math.random() * expMs * 0.5;
		return Math.min(expMs + jitter, 60_000);
	}
}

// ---------------------------------------------------------------------------
// 429 error parsing
// ---------------------------------------------------------------------------

/**
 * Attempt to extract rate-limit info from an error thrown by any provider SDK.
 * Returns undefined if this is NOT a rate-limit error.
 */
function parseRateLimitError(err: unknown): RateLimitSignal | undefined {
	if (err == null || typeof err !== "object") return undefined;

	const errObj = err as Record<string, unknown>;

	// Check status code — all providers use 429 for rate limits
	const status =
		errObj.status ??
		errObj.statusCode ??
		(errObj as { response?: { status?: number } }).response?.status;
	if (status !== 429 && status !== "429") {
		// Some providers use 503 for overload (treat as rate limit)
		if (status !== 503 && status !== "503") return undefined;
	}

	const signal: RateLimitSignal = {};

	// Parse retry-after from error properties or headers
	const headers = extractHeaders(errObj);
	if (headers) {
		signal.retryAfterMs = parseRetryAfter(headers["retry-after"]);
		signal.remainingRequests = parseNum(
			headers["x-ratelimit-remaining-requests"] ?? headers["x-ratelimit-remaining"],
		);
		signal.remainingTokens = parseNum(headers["x-ratelimit-remaining-tokens"]);
		signal.limitRequests = parseNum(
			headers["x-ratelimit-limit-requests"] ?? headers["x-ratelimit-limit"],
		);
		signal.limitTokens = parseNum(headers["x-ratelimit-limit-tokens"]);
		signal.resetRequestsMs = parseResetMs(headers["x-ratelimit-reset-requests"]);
		signal.resetTokensMs = parseResetMs(headers["x-ratelimit-reset-tokens"]);
	}

	// Google Gemini: error.details may contain retryDelay
	if (Array.isArray(errObj.details)) {
		for (const d of errObj.details as Record<string, unknown>[]) {
			if (d.retryDelay && typeof d.retryDelay === "string") {
				signal.retryAfterMs = parseDurationString(d.retryDelay);
			}
		}
	}

	// Anthropic SDK: error.headers is a plain object
	if (errObj.headers && typeof errObj.headers === "object") {
		const h = errObj.headers as Record<string, string>;
		signal.retryAfterMs ??= parseRetryAfter(h["retry-after"]);
		signal.limitRequests ??= parseNum(h["anthropic-ratelimit-requests-limit"]);
		signal.remainingRequests ??= parseNum(h["anthropic-ratelimit-requests-remaining"]);
		signal.limitTokens ??= parseNum(h["anthropic-ratelimit-tokens-limit"]);
		signal.remainingTokens ??= parseNum(h["anthropic-ratelimit-tokens-remaining"]);
		signal.resetRequestsMs ??= parseResetMs(h["anthropic-ratelimit-requests-reset"]);
		signal.resetTokensMs ??= parseResetMs(h["anthropic-ratelimit-tokens-reset"]);
	}

	// Parse error message for retry-after hints (e.g., "Please retry after 30 seconds")
	const msg = errObj.message ?? errObj.error;
	if (typeof msg === "string" && !signal.retryAfterMs) {
		const match = msg.match(
			/retry\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*(s|seconds?|ms|milliseconds?|m|minutes?)/i,
		);
		if (match) {
			const val = Number.parseFloat(match[1]);
			const unit = match[2].toLowerCase();
			if (unit.startsWith("ms") || unit.startsWith("milli")) {
				signal.retryAfterMs = val;
			} else if (unit.startsWith("m") && !unit.startsWith("ms")) {
				signal.retryAfterMs = val * 60_000;
			} else {
				signal.retryAfterMs = val * 1_000;
			}
		}
	}

	return signal;
}

// ---------------------------------------------------------------------------
// Header parsing helpers
// ---------------------------------------------------------------------------

function extractHeaders(err: Record<string, unknown>): Record<string, string> | undefined {
	// OpenAI SDK: err.headers
	if (err.headers && typeof err.headers === "object") {
		return normalizeHeaders(err.headers as Record<string, unknown>);
	}
	// Nested: err.response.headers
	const response = err.response as Record<string, unknown> | undefined;
	if (response?.headers && typeof response.headers === "object") {
		return normalizeHeaders(response.headers as Record<string, unknown>);
	}
	return undefined;
}

function normalizeHeaders(raw: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "string") out[k.toLowerCase()] = v;
	}
	return out;
}

function parseRetryAfter(val: string | undefined): number | undefined {
	if (!val) return undefined;
	// Could be seconds (numeric) or HTTP-date
	const num = Number.parseFloat(val);
	if (!Number.isNaN(num)) return num * 1_000;
	// Try as date
	const date = Date.parse(val);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return undefined;
}

function parseNum(val: string | undefined): number | undefined {
	if (!val) return undefined;
	const n = Number.parseInt(val, 10);
	return Number.isNaN(n) ? undefined : n;
}

/** Parse reset headers like "30s", "1m30s", "2024-01-01T00:00:00Z", or bare seconds. */
function parseResetMs(val: string | undefined): number | undefined {
	if (!val) return undefined;
	// Duration string: "30s", "1m30s"
	const durMs = parseDurationString(val);
	if (durMs != null) return durMs;
	// ISO timestamp
	const date = Date.parse(val);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	// Bare number (seconds)
	const num = Number.parseFloat(val);
	if (!Number.isNaN(num)) return num * 1_000;
	return undefined;
}

/** Parse Go-style duration strings like "30s", "1m30s", "500ms". */
function parseDurationString(val: string): number | undefined {
	const re = /(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?/;
	const m = val.match(re);
	if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return undefined;
	return (
		Number.parseInt(m[1] ?? "0", 10) * 3_600_000 +
		Number.parseInt(m[2] ?? "0", 10) * 60_000 +
		Number.parseFloat(m[3] ?? "0") * 1_000 +
		Number.parseInt(m[4] ?? "0", 10)
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Provider wrapper — placed INSIDE the replay cache so cache hits short-circuit
// before pacing. See `createSafeProvider` for the full stack order.
// ---------------------------------------------------------------------------

export interface RateLimiterWrapperOptions {
	/** When false, calls pass through unpaced; usage is still recorded for stats. */
	readonly enabled: boolean;
}

/**
 * Wrap a provider so each call passes through the {@link AdaptiveRateLimiter}.
 *
 * Wrap with `withRateLimiter(inner, limiter, { enabled })`. The intended stack
 * order in {@link createSafeProvider} is:
 *
 *   `withReplayCache(withBudgetGate(withRateLimiter(base, limiter)))`
 *
 * Cache hits short-circuit at the outermost wrapper and never reach the
 * limiter — so cached reruns are not paced. This is the load-bearing fix for
 * the symptom where re-running a fully cached corpus took ~2 min/4 tasks
 * because the limiter was outside the cache.
 */
export function withRateLimiter(
	inner: LLMProvider,
	limiter: AdaptiveRateLimiter,
	opts: RateLimiterWrapperOptions,
): LLMProvider {
	return {
		// Honest debug label. The cache no longer keys on wrapper chain names —
		// it uses `ReplayCacheOptions.providerKey` — so suffixing here is safe.
		name: `${inner.name}+ratelimit`,
		limits: inner.limits,
		async generate(req: LLMRequest): Promise<LLMResponse> {
			if (!opts.enabled) {
				const response = await inner.generate(req);
				limiter.recordUsage(response.inputTokens + response.outputTokens);
				return response;
			}
			// Estimate input tokens (~chars/4) and output tokens (~maxTokens/2)
			// for pacing. Replaced with actual usage post-call.
			const estimatedInput = Math.ceil((req.system.length + req.user.length) / 4);
			const estimatedOutput = Math.ceil((req.maxTokens ?? inner.limits.maxOutputTokens) / 2);
			const estimatedTotal = estimatedInput + estimatedOutput;
			const response = await limiter.call(() => inner.generate(req), estimatedTotal);
			limiter.recordUsage(response.inputTokens + response.outputTokens);
			return response;
		},
	};
}
