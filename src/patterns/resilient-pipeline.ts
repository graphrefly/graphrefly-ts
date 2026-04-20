/**
 * Resilience composition with correct nesting order (roadmap §9.0b).
 *
 * {@link resilientPipeline} composes the resilience primitives from
 * `extra/resilience.ts` in the order discovered during the §9.1 eval runs:
 *
 * ```text
 *   rateLimit → budget → breaker → timeout → retry → fallback → status
 * ```
 *
 * Note on retry/timeout ordering: `timeout` is applied BEFORE `retry` so each
 * retry attempt resubscribes to a fresh deadline (per-attempt semantics). If
 * `timeout` wrapped `retry`, a single deadline would apply to the entire
 * retry chain — not what callers expect.
 *
 * Every step is optional — omit the option and that layer is skipped. The
 * returned bundle exposes the final `Node<T>` plus the status/error/breaker
 * companions so callers can wire them into dashboards, alerts, or
 * {@link graphLens}.
 *
 * Subsumes the pre-1.0 `resilientFetch` template — that template becomes a
 * preconfigured instance of this factory for the HTTP fetch case.
 *
 * @module
 */
import type { Node } from "../core/node.js";
import { NS_PER_MS, NS_PER_SEC } from "../extra/backoff.js";
import {
	type CircuitBreakerOptions,
	type CircuitState,
	circuitBreaker,
	type FallbackInput,
	fallback,
	type RateLimiterOptions,
	type RetryOptions,
	rateLimiter,
	retry,
	type StatusValue,
	timeout,
	withBreaker,
	withStatus,
} from "../extra/resilience.js";
import { type BudgetConstraint, budgetGate } from "./reduction.js";

/** Options for {@link resilientPipeline}. Every field is optional — omit to skip that layer. */
export interface ResilientPipelineOptions<T> {
	/** Admission control — at most `maxEvents` DATA per `windowNs`. See {@link rateLimiter}. */
	rateLimit?: RateLimiterOptions;
	/** Cost/constraint gate. See {@link budgetGate}. */
	budget?: ReadonlyArray<BudgetConstraint>;
	/** Circuit breaker — fail-fast when the downstream resource is unhealthy. See {@link circuitBreaker}. */
	breaker?: CircuitBreakerOptions;
	/**
	 * Behavior when the breaker is open:
	 * - `"skip"` — emit RESOLVED (default, lets downstream drop the beat)
	 * - `"error"` — emit a `CircuitOpenError` so `retry`/`fallback` can react
	 *
	 * Only used when `breaker` is provided.
	 */
	breakerOnOpen?: "skip" | "error";
	/** Retry policy on terminal ERROR. See {@link retry}. */
	retry?: RetryOptions;
	/**
	 * Per-attempt deadline in milliseconds. Converted to ns internally. Omit to skip the timeout wrap.
	 *
	 * Specified in ms (not ns) because callers consistently think in millisecond deadlines;
	 * retry/breaker/ratelimit options take ns to match their primitives exactly.
	 */
	timeoutMs?: number;
	/** Final fallback value emitted on terminal ERROR after retry exhausts. See {@link fallback}. */
	fallback?: FallbackInput<T>;
	/** Initial status reported by the status node. Default `"pending"`. */
	initialStatus?: StatusValue;
}

/** Output bundle of {@link resilientPipeline}. */
export interface ResilientPipelineBundle<T> {
	/** The final resilient node. Subscribe to this for DATA emissions. */
	node: Node<T>;
	/** Live status: `"pending" | "active" | "completed" | "errored"`. */
	status: Node<StatusValue>;
	/** Last error payload, or `null` when not errored. */
	error: Node<unknown | null>;
	/** Breaker state when `opts.breaker` was provided; `undefined` otherwise. */
	breakerState: Node<CircuitState> | undefined;
}

/**
 * Compose a resilient pipeline around `source` in the canonical nesting
 * order — `rateLimit → budget → breaker → timeout → retry → fallback → status`.
 * Omit any option to skip that layer.
 *
 * @param source - Upstream node to wrap.
 * @param opts - See {@link ResilientPipelineOptions}. All fields optional.
 *
 * @example
 * ```ts
 * const safeFetch = resilientPipeline(fetchNode, {
 *   rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC },
 *   breaker: { failureThreshold: 5 },
 *   retry: { count: 3, backoff: "exponential" },
 *   timeoutMs: 10_000,
 *   fallback: null,
 * });
 * safeFetch.status.subscribe(msgs => console.log(msgs));
 * ```
 *
 * @category patterns
 */
export function resilientPipeline<T>(
	source: Node<T>,
	opts: ResilientPipelineOptions<T> = {},
): ResilientPipelineBundle<T> {
	let current: Node<T> = source;

	// 1. Admission control — cheapest to drop / queue before any other work.
	if (opts.rateLimit != null) {
		current = rateLimiter(current, opts.rateLimit);
	}

	// 2. Budget — block when constraints are exhausted. Also cheap (no I/O).
	if (opts.budget != null && opts.budget.length > 0) {
		current = budgetGate(current, opts.budget);
	}

	// 3. Breaker — skip the resource when unhealthy (fail-fast before retry wastes time).
	let breakerState: Node<CircuitState> | undefined;
	if (opts.breaker != null) {
		const breaker = circuitBreaker(opts.breaker);
		const onOpen = opts.breakerOnOpen ?? "skip";
		const wrapped = withBreaker<T>(breaker, { onOpen })(current);
		current = wrapped.node;
		breakerState = wrapped.breakerState;
	}

	// 4. Timeout — per-attempt deadline. Applied BEFORE retry so each retry
	//    resubscribes to a fresh timeout. Swapping the order (timeout OUTSIDE
	//    retry) would apply one global deadline to the entire retry chain —
	//    not what callers expect for "per-attempt timeout."
	if (opts.timeoutMs != null) {
		if (opts.timeoutMs <= 0) throw new RangeError("timeoutMs must be > 0");
		// Guard against `timeoutMs * NS_PER_MS` overflowing Number.MAX_SAFE_INTEGER
		// (~9.007e15). 9_000_000 ms ≈ 2.5 hours is a sane upper bound; callers
		// needing longer deadlines should express them at the primitive level.
		if (opts.timeoutMs > 9_000_000) {
			throw new RangeError(
				"timeoutMs must be <= 9_000_000 (≈2.5h) to stay within safe ns arithmetic",
			);
		}
		current = timeout(current, opts.timeoutMs * NS_PER_MS);
	}

	// 5. Retry — resubscribe on ERROR up to `count` times. Wraps timeout so
	//    each retry gets its own fresh deadline.
	if (opts.retry != null) {
		current = retry(current, opts.retry);
	}

	// 6. Fallback — last resort after retry+timeout exhaust.
	if (opts.fallback !== undefined) {
		current = fallback(current, opts.fallback);
	}

	// 7. Status wrapping — observability. Always last so it sees the final shape.
	const withStatusBundle = withStatus(current, { initialStatus: opts.initialStatus ?? "pending" });

	return {
		node: withStatusBundle.node,
		status: withStatusBundle.status,
		error: withStatusBundle.error,
		breakerState,
	};
}

// Re-export NS constants for consumers authoring pipeline options at call sites.
export { NS_PER_MS, NS_PER_SEC };
