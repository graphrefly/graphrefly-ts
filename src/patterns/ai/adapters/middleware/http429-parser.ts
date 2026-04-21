/**
 * HTTP 429 / rate-limit parser.
 *
 * Produces a {@link RateLimitSignal} from provider HTTP errors so adaptive
 * rate limiters can tighten effective limits. Normalizes:
 * - `Retry-After` (seconds or HTTP-date)
 * - `x-ratelimit-reset` / `x-ratelimit-reset-tokens` (epoch secs or duration)
 * - `x-ratelimit-remaining-{requests,tokens}` + `x-ratelimit-limit-*`
 * - Anthropic `anthropic-ratelimit-*` headers
 * - OpenAI / OpenRouter / Groq headers (same family)
 * - Error message regex fallbacks for providers without structured headers
 */

import type { RateLimitSignal } from "../../../../extra/adaptive-rate-limiter.js";

export interface HttpErrorLike {
	status?: number;
	headers?: Headers | Record<string, string | string[] | undefined>;
	message?: string;
}

/**
 * Extract a {@link RateLimitSignal} from a fetch-style error object, a Response,
 * or any object exposing `.status` + `.headers` + `.message`.
 *
 * Returns `undefined` if no rate-limit information can be extracted.
 */
export function parseRateLimitFromError(err: unknown): RateLimitSignal | undefined {
	if (err == null || typeof err !== "object") return undefined;
	const like = err as HttpErrorLike;
	const status = like.status;
	const headerLookup = toHeaderGetter(like.headers);

	// Only respond on 429 or 503 (some providers use 503 for rate-limits).
	if (status !== 429 && status !== 503 && !looksLikeRateLimitMessage(like.message)) {
		return undefined;
	}

	const sig: RateLimitSignal = {};

	const retryAfter = headerLookup("retry-after");
	const retryAfterMs = parseRetryAfter(retryAfter);
	if (retryAfterMs != null) sig.retryAfterMs = retryAfterMs;

	// Anthropic: anthropic-ratelimit-requests-reset (ISO-8601 timestamp)
	const anthReqReset = headerLookup("anthropic-ratelimit-requests-reset");
	if (anthReqReset) {
		const ms = parseIsoResetHeaderToDelayMs(anthReqReset);
		if (ms != null) sig.retryAfterMs = Math.max(sig.retryAfterMs ?? 0, ms);
	}
	const anthTokReset = headerLookup("anthropic-ratelimit-tokens-reset");
	if (anthTokReset) {
		const ms = parseIsoResetHeaderToDelayMs(anthTokReset);
		if (ms != null) sig.retryAfterMs = Math.max(sig.retryAfterMs ?? 0, ms);
	}

	// OpenAI / OpenRouter / Groq: x-ratelimit-limit-requests, -reset-requests, etc.
	const limitRequests = numHeader(headerLookup, "x-ratelimit-limit-requests");
	if (limitRequests != null) sig.rpmCap = limitRequests;
	const limitTokens = numHeader(headerLookup, "x-ratelimit-limit-tokens");
	if (limitTokens != null) sig.tpmCap = limitTokens;

	// Usage hint: remaining / limit
	const remainingReq = numHeader(headerLookup, "x-ratelimit-remaining-requests");
	const remainingTok = numHeader(headerLookup, "x-ratelimit-remaining-tokens");
	if (remainingReq != null && limitRequests != null && limitRequests > 0) {
		sig.usageHint ??= {};
		sig.usageHint.rpm = 1 - remainingReq / limitRequests;
	}
	if (remainingTok != null && limitTokens != null && limitTokens > 0) {
		sig.usageHint ??= {};
		sig.usageHint.tpm = 1 - remainingTok / limitTokens;
	}

	// Fallback: parse retry-after from error message if no header was found.
	if (sig.retryAfterMs == null && like.message) {
		const msgMs = parseRetryAfterFromMessage(like.message);
		if (msgMs != null) sig.retryAfterMs = msgMs;
	}

	// Preserve raw headers for user-specific downstream logic.
	if (like.headers) sig.metadata = { headers: serializeHeaders(like.headers) };

	if (
		sig.retryAfterMs == null &&
		sig.rpmCap == null &&
		sig.tpmCap == null &&
		sig.usageHint == null
	) {
		// Nothing actionable extracted — still emit empty signal so consumers can
		// count occurrences (metadata carries the headers).
		return sig.metadata ? sig : undefined;
	}

	return sig;
}

// ---------------------------------------------------------------------------
// Header access
// ---------------------------------------------------------------------------

type HeaderGetter = (name: string) => string | undefined;

function toHeaderGetter(h: HttpErrorLike["headers"]): HeaderGetter {
	if (!h) return () => undefined;
	if (typeof (h as Headers).get === "function") {
		const hh = h as Headers;
		return (name) => hh.get(name) ?? hh.get(name.toLowerCase()) ?? undefined;
	}
	const record = h as Record<string, string | string[] | undefined>;
	const lc: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(record)) {
		const sv = Array.isArray(v) ? v.join(", ") : v;
		if (sv != null) lc[k.toLowerCase()] = sv;
	}
	return (name) => lc[name.toLowerCase()];
}

function serializeHeaders(h: NonNullable<HttpErrorLike["headers"]>): Record<string, string> {
	const out: Record<string, string> = {};
	if (typeof (h as Headers).forEach === "function") {
		(h as Headers).forEach((v, k) => {
			out[k] = v;
		});
		return out;
	}
	for (const [k, v] of Object.entries(h as Record<string, string | string[] | undefined>)) {
		if (v != null) out[k] = Array.isArray(v) ? v.join(", ") : v;
	}
	return out;
}

function numHeader(getter: HeaderGetter, name: string): number | undefined {
	const raw = getter(name);
	if (raw == null) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Retry-after parsing
// ---------------------------------------------------------------------------

function parseRetryAfter(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	const asNum = Number(trimmed);
	if (Number.isFinite(asNum) && asNum >= 0) return asNum * 1000;
	// HTTP-date fallback.
	const ts = Date.parse(trimmed);
	if (Number.isFinite(ts)) {
		const delta = ts - Date.now();
		if (delta > 0) return delta;
	}
	return undefined;
}

/**
 * Parse an Anthropic `anthropic-ratelimit-{requests,tokens}-reset` header
 * into a delay (milliseconds until reset). These headers are documented
 * as ISO-8601 absolute timestamps; we use `Date.parse` and clamp to zero
 * for headers that have already elapsed. Returns `undefined` for unparseable
 * values — no numeric-epoch heuristic (providers don't send numeric resets
 * here, and the old heuristic was ambiguous across seconds-vs-millis).
 */
function parseIsoResetHeaderToDelayMs(raw: string): number | undefined {
	if (!raw) return undefined;
	const ts = Date.parse(raw);
	if (Number.isFinite(ts)) return Math.max(0, ts - Date.now());
	return undefined;
}

const RETRY_MSG_RE = /retry\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?)/i;

function parseRetryAfterFromMessage(msg: string): number | undefined {
	const m = RETRY_MSG_RE.exec(msg);
	if (!m) return undefined;
	const n = Number(m[1]);
	if (!Number.isFinite(n)) return undefined;
	const unit = (m[2] ?? "s").toLowerCase();
	if (unit === "ms") return n;
	if (unit.startsWith("s")) return n * 1000;
	if (unit.startsWith("m")) return n * 60_000;
	return undefined;
}

const RATE_LIMIT_MSG_RE = /rate\s*limit|too\s*many\s*requests|quota|429/i;

function looksLikeRateLimitMessage(msg: string | undefined): boolean {
	return !!msg && RATE_LIMIT_MSG_RE.test(msg);
}
