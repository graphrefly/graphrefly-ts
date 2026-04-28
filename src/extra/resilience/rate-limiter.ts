/**
 * Rate limiters — `rateLimiter`, `tokenBucket`, and (from a separate file)
 * `adaptiveRateLimiter`.
 *
 * Re-exports from `./index.js` (the consolidated resilience source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

// `adaptiveRateLimiter` lives in extra/adaptive-rate-limiter.ts (kept independent
// because it has its own internal control-loop machinery).
export * from "../adaptive-rate-limiter.js";
export {
	type RateLimiterOptions,
	RateLimiterOverflowError,
	type RateLimiterOverflowPolicy,
	rateLimiter,
	type TokenBucket,
	tokenBucket,
} from "./index.js";
