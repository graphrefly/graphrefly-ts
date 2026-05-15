/**
 * `resilientAdapter` — compose `withRateLimiter` + `withBudgetGate` +
 * `withBreaker` + `withTimeout` + `withRetry` + fallback over an {@link LLMAdapter}.
 *
 * Call-path peer of {@link resilientPipeline} (which operates on a reactive
 * `Node<T>` chain). Use `resilientPipeline` when composing graph sources; use
 * `resilientAdapter` when wrapping an adapter so downstream users see a
 * single hardened `invoke`/`stream` surface.
 *
 * Composition order (innermost to outermost, mirrors `resilientPipeline`):
 *
 * ```text
 *   rateLimit → budget → breaker → timeout → retry → fallback
 * ```
 *
 * Rationale:
 * - **rateLimit innermost** — each attempt acquires a fresh slot; a retry
 *   after a 429 waits for admission rather than bursting past the cap.
 * - **budget next** — per-attempt gate close short-circuits retries once a
 *   cap trips.
 * - **breaker next** — each attempt observes circuit health; open breaker
 *   fast-fails retries into fallback.
 * - **timeout before retry** — each retry re-arms a fresh per-attempt
 *   deadline. If `timeout` wrapped `retry`, a single deadline would cover
 *   the entire retry chain — surprising for callers.
 * - **retry before fallback** — fallback is entered only after the primary
 *   exhausts its retry budget (or immediately fails in a way the predicate
 *   doesn't retry).
 *
 * Every option is optional — omit the field and that layer is skipped. The
 * returned bundle exposes the primary adapter plus the internal bundles
 * (`rateLimiter`, `budget`, `breaker`) so callers can wire them into
 * dashboards, alerts, or `graphLens`.
 *
 * Fallback is implemented via {@link cascadingLlmAdapter}: when `fallback`
 * is provided, the wrapped primary adapter is placed at tier 0 and the
 * fallback adapter at tier 1. For N-tier cascades, use `cascadingLlmAdapter`
 * directly and wrap each tier with `resilientAdapter`.
 *
 * @module
 */

import type { LLMAdapter } from "@graphrefly/pure-ts/core/types.js";
import type { CircuitBreaker } from "@graphrefly/pure-ts/extra";
import type { AdaptiveRateLimiterBundle } from "../../../../extra/adaptive-rate-limiter.js";
import type { CascadeExhaustionReport } from "../routing/cascading.js";
import { cascadingLlmAdapter } from "../routing/cascading.js";
import { type WithBreakerOptions, withBreaker } from "./breaker.js";
import {
	type BudgetGateBundle,
	type WithBudgetGateOptions,
	withBudgetGate,
} from "./budget-gate.js";
import { type WithRateLimiterOptions, withRateLimiter } from "./rate-limiter.js";
import { type WithReplayCacheOptions, withReplayCache } from "./replay-cache.js";
import { type WithRetryOptions, withRetry } from "./retry.js";
import { withTimeout } from "./timeout.js";

/** Options for {@link resilientAdapter}. Every field is optional — omit to skip that layer. */
export interface ResilientAdapterOptions {
	/** Admission control. See {@link withRateLimiter}. */
	rateLimit?: WithRateLimiterOptions;
	/** Cost/cap gate. See {@link withBudgetGate}. */
	budget?: WithBudgetGateOptions;
	/** Circuit breaker. See {@link withBreaker}. */
	breaker?: WithBreakerOptions;
	/** Per-attempt deadline in milliseconds. Omit to skip the timeout wrap. */
	timeoutMs?: number;
	/** Retry policy on transient errors. See {@link withRetry}. */
	retry?: WithRetryOptions;
	/**
	 * Fallback adapter engaged when the primary (post-retry) fails. Implemented
	 * via {@link cascadingLlmAdapter} — the primary becomes tier 0, the
	 * fallback becomes tier 1. For N-tier cascades, use `cascadingLlmAdapter`
	 * directly and wrap each tier with `resilientAdapter` as needed.
	 */
	fallback?: LLMAdapter;
	/** Name used as the primary tier name in the fallback cascade. Default `"primary"`. */
	name?: string;
	/**
	 * Called when the cascade switches from one tier to the next after a
	 * failure. Only fires when `fallback` is set. Threaded directly to the
	 * inner {@link cascadingLlmAdapter}.
	 */
	onFallback?: (from: string, to: string, error: unknown) => void;
	/**
	 * Called when every tier in the cascade has been exhausted (all failed,
	 * skipped by filter, or skipped by breaker). Only fires when `fallback`
	 * is set. Threaded directly to the inner {@link cascadingLlmAdapter}.
	 */
	onExhausted?: (report: CascadeExhaustionReport) => void;
	/**
	 * Content-addressed replay cache wrapped OUTERMOST — a cache HIT short-
	 * circuits the entire stack (rate-limit / budget / breaker / retry /
	 * fallback), saving money and latency. Cache MISSes flow through the
	 * normal stack; the successful result is stored on success. See
	 * {@link withReplayCache}.
	 */
	cache?: WithReplayCacheOptions;
}

/** Output bundle of {@link resilientAdapter}. */
export interface ResilientAdapterBundle {
	/** The final hardened adapter. */
	adapter: LLMAdapter;
	/** Rate-limiter internals (for dashboards). Present only when `opts.rateLimit` was set. */
	rateLimiter?: AdaptiveRateLimiterBundle;
	/** Budget gate internals (for dashboards). Present only when `opts.budget` was set. */
	budget?: BudgetGateBundle;
	/** Circuit breaker (for dashboards). Present only when `opts.breaker` was set. */
	breaker?: CircuitBreaker;
}

/**
 * Wrap `inner` with the standard resilience stack. See module docs for the
 * composition order and rationale.
 *
 * @example
 * ```ts
 * const { adapter, budget, breaker } = resilientAdapter(openai, {
 *   rateLimit: { rpm: 60, tpm: 90_000 },
 *   budget: { caps: { usd: 5 } },
 *   breaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
 *   timeoutMs: 30_000,
 *   retry: { attempts: 3 },
 *   fallback: webllm,  // cascades to local on exhaustion
 * });
 *
 * // `adapter` is drop-in for anything expecting LLMAdapter.
 * // Subscribe to `budget.totals`, `breaker.state`, etc. for dashboards.
 * ```
 */
export function resilientAdapter(
	inner: LLMAdapter,
	opts: ResilientAdapterOptions = {},
): ResilientAdapterBundle {
	const bundle: ResilientAdapterBundle = { adapter: inner };
	let current: LLMAdapter = inner;

	if (opts.rateLimit) {
		const wrapped = withRateLimiter(current, opts.rateLimit);
		current = wrapped.adapter;
		bundle.rateLimiter = wrapped.limiter;
	}
	if (opts.budget) {
		const wrapped = withBudgetGate(current, opts.budget);
		current = wrapped.adapter;
		bundle.budget = wrapped.budget;
	}
	if (opts.breaker) {
		const wrapped = withBreaker(current, opts.breaker);
		current = wrapped.adapter;
		bundle.breaker = wrapped.breaker;
	}
	if (opts.timeoutMs != null) {
		current = withTimeout(current, opts.timeoutMs);
	}
	if (opts.retry) {
		current = withRetry(current, opts.retry);
	}
	if (opts.fallback) {
		// Secondary tier is named `"fallback"` internally; reject the same
		// label as the primary name so CascadeExhaustionReport.failed (a
		// Map keyed by tier name) and `resp.metadata.tier` stamping stay
		// unambiguous.
		if (opts.name === "fallback") {
			throw new RangeError(
				'resilientAdapter: `name` cannot be "fallback" — collides with the secondary tier label.',
			);
		}
		const cascadeOpts: {
			onFallback?: (from: string, to: string, error: unknown) => void;
			onExhausted?: (report: CascadeExhaustionReport) => void;
		} = {};
		if (opts.onFallback) cascadeOpts.onFallback = opts.onFallback;
		if (opts.onExhausted) cascadeOpts.onExhausted = opts.onExhausted;
		current = cascadingLlmAdapter(
			[
				{ name: opts.name ?? "primary", adapter: current },
				{ name: "fallback", adapter: opts.fallback },
			],
			cascadeOpts,
		);
	}
	if (opts.cache) {
		// Outermost — a cache HIT skips the entire stack below.
		current = withReplayCache(current, opts.cache);
	}

	bundle.adapter = current;
	return bundle;
}
