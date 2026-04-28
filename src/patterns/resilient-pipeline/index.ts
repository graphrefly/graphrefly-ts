/**
 * Resilience composition with correct nesting order (roadmap §9.0b — Tier 5.2 Wave-B rebuild).
 *
 * {@link resilientPipeline} composes the resilience primitives from
 * `extra/resilience/` in the canonical nesting order:
 *
 * ```text
 *   rateLimit → budget → breaker → timeout → retry → fallback → status
 * ```
 *
 * Returns a {@link ResilientPipelineGraph} (Graph subclass) with mounted
 * intermediate nodes and per-layer status companions, replacing the prior
 * bundle return. Each intermediate is mounted under a stable name so
 * `pipeline.describe()` shows the resilience chain in topology snapshots,
 * mermaid renders, and `lens.health` aggregations.
 *
 * **Per-attempt timeout vs. retry ordering.** `timeout` is applied BEFORE
 * `retry` so each retry attempt resubscribes to a fresh deadline (per-attempt
 * semantics). If `timeout` wrapped `retry`, a single deadline would apply to
 * the entire retry chain — not what callers expect.
 *
 * **`breakerOnOpen` + `retry` interaction.** With `breakerOnOpen: "error"` AND
 * `retry`, retry sees `CircuitOpenError` and resubscribes; the next attempt
 * very likely also breaker-open → another error → retry burns its budget
 * against an open circuit. Either set retry's `backoff` long enough for the
 * breaker reset window OR keep the default `breakerOnOpen: "skip"` (emits
 * RESOLVED when open; downstream drops the beat without retry firing).
 *
 * **Reactive options (switchMap rebuild).** Every primitive option accepts a
 * `T | Node<T>` (precedent-aligned with `FallbackInput<T>`). When the caller
 * supplies a static value, the layer is built once at construction. When the
 * caller supplies a `Node<T>`, the pipeline subscribes via `switchMap` and
 * **rebuilds the layer on every option emission** — the chain stalls until
 * the option Node emits its first DATA. Each rebuild creates a fresh
 * primitive instance, so internal state is lost (rate-limiter pending buffer,
 * breaker failure count, retry attempt count, in-flight timeout). Per-layer
 * **companion Nodes** (`droppedCount`, `rateLimitState`, `breakerState`) are
 * therefore exposed ONLY for the static-options path. Primitive-side widening
 * (filed in `docs/optimizations.md` under "Tier 5.2 follow-up — primitive-side
 * reactive-options widening") will preserve internal state once it lands and
 * the pipeline will trivially forward Node-form options to the primitive.
 *
 * @module
 */
import { factoryTag, placeholderArgs } from "../../core/meta.js";
import type { Node } from "../../core/node.js";
import { NS_PER_MS, NS_PER_SEC } from "../../extra/backoff.js";
import { domainMeta } from "../../extra/meta.js";
import { switchMap } from "../../extra/operators.js";
import {
	type BudgetConstraint,
	budgetGate,
	type CircuitBreakerOptions,
	type CircuitState,
	circuitBreaker,
	type FallbackInput,
	fallback,
	type RateLimiterOptions,
	type RateLimiterState,
	type RetryOptions,
	rateLimiter,
	retry,
	type StatusValue,
	timeout,
	withBreaker,
	withStatus,
} from "../../extra/resilience.js";
import { Graph, type GraphOptions } from "../../graph/index.js";

// ---------------------------------------------------------------------------
// Reactive-option helpers
// ---------------------------------------------------------------------------

/**
 * `T | Node<T>` for primitive options — precedent-aligned with
 * {@link FallbackInput} and `policyGate.policies`. When the caller supplies a
 * static value, the layer is built once at construction. When the caller
 * supplies a `Node<T>`, the pipeline subscribes via {@link switchMap}: the
 * layer is rebuilt on every option emission. **State-loss caveat:** each
 * rebuild creates a fresh primitive instance — `rateLimiter` loses its pending
 * buffer, `circuitBreaker` resets failure count, `retry` resets attempt
 * count, `timeout` cancels in-flight deadline. This is the documented
 * switchMap-pattern semantics; primitive-side widening (filed in
 * `docs/optimizations.md`) will preserve internal state once it lands and the
 * pipeline can forward Node-form options directly.
 *
 * Per-layer **companion Nodes** (`droppedCount`, `rateLimitState`,
 * `breakerState`) are exposed only for the static-options path — Node-form
 * leaves them as `undefined` because each rebuild creates new companion
 * instances and a switchMap-mirrored companion would track only the latest
 * bundle. Callers needing both reactive options AND companions wait for
 * primitive-side widening.
 */
export type NodeOrValue<T> = T | Node<T>;

function isNode<T>(x: unknown): x is Node<T> {
	return (
		typeof x === "object" && x !== null && "subscribe" in (x as object) && "down" in (x as object)
	);
}

/**
 * Validation shared by the static and reactive timeout paths. The reactive
 * path runs this inside the `switchMap` projection so an emitted bad value
 * surfaces as a thrown error at projection time (the consuming subscribe
 * routes it through the reactive ERROR channel rather than crashing
 * construction).
 */
function assertTimeoutMsValid(ms: number): void {
	if (ms <= 0) throw new RangeError("timeoutMs must be > 0");
	// Guard against `timeoutMs * NS_PER_MS` overflowing
	// `Number.MAX_SAFE_INTEGER` (~9.007e15). 9_000_000 ms ≈ 2.5 hours is a
	// sane upper bound; callers needing longer deadlines should express them
	// at the primitive level.
	if (ms > 9_000_000) {
		throw new RangeError(
			"timeoutMs must be <= 9_000_000 (≈2.5h) to stay within safe ns arithmetic",
		);
	}
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for {@link resilientPipeline}. Every layer is optional — omit a
 * field and that layer is skipped.
 *
 * Reactive (`Node<T>`) forms are accepted everywhere a primitive value would
 * fit; the pipeline subscribes via `switchMap` and rebuilds the layer on each
 * emission. See module JSDoc for the rebuild semantics + state-loss caveat.
 */
export interface ResilientPipelineOptions<T> {
	/**
	 * Admission control — at most `maxEvents` `DATA` per `windowNs`. See
	 * {@link rateLimiter}.
	 *
	 * `maxBuffer` is optional at the pipeline layer (defaults to `Infinity`,
	 * preserving the historical unbounded behavior). Pass an explicit positive
	 * integer to opt in to a bounded queue.
	 */
	rateLimit?: NodeOrValue<Omit<RateLimiterOptions, "maxBuffer"> & { maxBuffer?: number }>;
	/** Cost/constraint gate. See {@link budgetGate}. */
	budget?: NodeOrValue<ReadonlyArray<BudgetConstraint>>;
	/** Circuit breaker — fail-fast when the downstream resource is unhealthy. See {@link circuitBreaker}. */
	breaker?: NodeOrValue<CircuitBreakerOptions>;
	/**
	 * Behavior when the breaker is open:
	 * - `"skip"` (default) — emit `RESOLVED` (lets downstream drop the beat).
	 * - `"error"` — emit a `CircuitOpenError` so `retry` / `fallback` can react.
	 *   See module JSDoc for the retry-budget burn caveat.
	 *
	 * Static (configuration-only — no reactive form).
	 */
	breakerOnOpen?: "skip" | "error";
	/** Retry policy on terminal `ERROR`. See {@link retry}. */
	retry?: NodeOrValue<RetryOptions>;
	/**
	 * Per-attempt deadline in milliseconds. Converted to ns internally. Omit
	 * to skip the timeout wrap.
	 *
	 * Specified in ms (not ns) because callers consistently think in
	 * millisecond deadlines; the underlying {@link timeout} primitive takes ns
	 * internally.
	 */
	timeoutMs?: NodeOrValue<number>;
	/** Final fallback value emitted on terminal `ERROR` after retry exhausts. See {@link fallback}. */
	fallback?: FallbackInput<T>;
	/**
	 * Initial status reported by the status node. Default `"pending"`. Static.
	 */
	initialStatus?: StatusValue;
	/** Wrapper graph name. Default `"resilient_pipeline"`. */
	name?: string;
	/** Wrapper graph options. */
	graph?: GraphOptions;
}

// ---------------------------------------------------------------------------
// ResilientPipelineGraph
// ---------------------------------------------------------------------------

/**
 * Graph subclass returned by {@link resilientPipeline}. Mounts each
 * configured intermediate under a stable name and exposes per-layer status
 * companions.
 *
 * @category patterns
 */
export class ResilientPipelineGraph<T> extends Graph {
	/**
	 * Final resilient node — subscribe to this for `DATA` emissions.
	 *
	 * Named `output` (not `node`) because `Graph.node(name)` already names the
	 * path-resolution method on the base class; a `readonly node` field would
	 * shadow it.
	 */
	readonly output: Node<T>;
	/** Live status: `"pending" | "running" | "completed" | "errored"`. */
	readonly status: Node<StatusValue>;
	/**
	 * Last error payload, or `null` when not errored.
	 *
	 * Named `lastError` (not `error`) because `Graph.error(name, err)` already
	 * names a method on the base class.
	 */
	readonly lastError: Node<unknown | null>;
	/** Breaker state when `opts.breaker` is provided; `undefined` otherwise. */
	readonly breakerState: Node<CircuitState> | undefined;
	/**
	 * Drop-counter when `opts.rateLimit` is provided; `undefined` otherwise.
	 *
	 * **Lifetime note:** `droppedCount` retains its final value through
	 * terminal (`COMPLETE` / `ERROR` / `TEARDOWN`); the underlying counter
	 * resets to `0` only at the next subscription cycle.
	 */
	readonly droppedCount: Node<number> | undefined;
	/**
	 * Combined rate-limit state when `opts.rateLimit` is provided; `undefined`
	 * otherwise. Same lifecycle as {@link droppedCount} but exposes
	 * `pendingCount` and `paused` alongside the drop counter for richer
	 * backpressure observability (Tier 5.2 D7).
	 */
	readonly rateLimitState: Node<RateLimiterState> | undefined;

	constructor(source: Node<T>, opts: ResilientPipelineOptions<T> = {}) {
		super(opts.name ?? "resilient_pipeline", opts.graph);

		let current: Node<T> = source;
		let droppedCount: Node<number> | undefined;
		let rateLimitState: Node<RateLimiterState> | undefined;
		let breakerState: Node<CircuitState> | undefined;

		// 1. Admission control — cheapest to drop / queue before any other work.
		if (opts.rateLimit != null) {
			if (isNode<Omit<RateLimiterOptions, "maxBuffer"> & { maxBuffer?: number }>(opts.rateLimit)) {
				// Reactive: switchMap on the option Node. Each emission rebuilds
				// the rate-limit layer (state-loss caveat — pending buffer
				// resets per rebuild). Companions (droppedCount /
				// rateLimitState) NOT exposed in this mode; they'd track only
				// the latest bundle. Caller awaits primitive-side widening for
				// reactive companions.
				const inputForLayer = current;
				const reactiveOpts = opts.rateLimit;
				current = switchMap(reactiveOpts, (rl) => {
					const merged: RateLimiterOptions = {
						...rl,
						maxBuffer: rl.maxBuffer ?? Infinity,
						meta: domainMeta("resilient", "rate-limit"),
					};
					return rateLimiter(inputForLayer, merged).node;
				});
				this.add(current, { name: "rateLimited" });
			} else {
				const rateOpts: RateLimiterOptions = {
					...opts.rateLimit,
					maxBuffer: opts.rateLimit.maxBuffer ?? Infinity,
					meta: domainMeta("resilient", "rate-limit"),
				};
				const bundle = rateLimiter(current, rateOpts);
				current = bundle.node;
				droppedCount = bundle.droppedCount;
				rateLimitState = bundle.rateLimitState;
				this.add(current, { name: "rateLimited" });
				this.add(droppedCount, { name: "droppedCount" });
				this.add(rateLimitState, { name: "rateLimitState" });
			}
		}

		// 2. Budget — block when constraints are exhausted. Also cheap (no I/O).
		if (opts.budget != null) {
			if (isNode<ReadonlyArray<BudgetConstraint>>(opts.budget)) {
				const inputForLayer = current;
				const reactiveBudget = opts.budget;
				current = switchMap(reactiveBudget, (constraints) =>
					constraints.length > 0
						? budgetGate(inputForLayer, constraints, {
								meta: domainMeta("resilient", "budget"),
							})
						: inputForLayer,
				);
				this.add(current, { name: "budgetGated" });
			} else if (opts.budget.length > 0) {
				current = budgetGate(current, opts.budget, {
					meta: domainMeta("resilient", "budget"),
				});
				this.add(current, { name: "budgetGated" });
			}
		}

		// 3. Breaker — skip the resource when unhealthy (fail-fast before retry wastes time).
		if (opts.breaker != null) {
			if (isNode<CircuitBreakerOptions>(opts.breaker)) {
				const inputForLayer = current;
				const reactiveBreaker = opts.breaker;
				const onOpen = opts.breakerOnOpen ?? "skip";
				current = switchMap(reactiveBreaker, (br) => {
					const breaker = circuitBreaker(br);
					return withBreaker<T>(breaker, {
						onOpen,
						meta: domainMeta("resilient", "breaker"),
					})(inputForLayer).node;
				});
				this.add(current, { name: "breakerWrapped" });
				// breakerState companion NOT exposed in reactive mode (per-rebuild instances).
			} else {
				const breaker = circuitBreaker(opts.breaker);
				const onOpen = opts.breakerOnOpen ?? "skip";
				const wrapped = withBreaker<T>(breaker, {
					onOpen,
					meta: domainMeta("resilient", "breaker"),
				})(current);
				current = wrapped.node;
				breakerState = wrapped.breakerState;
				this.add(current, { name: "breakerWrapped" });
				this.add(breakerState, { name: "breakerState" });
			}
		}

		// 4. Timeout — per-attempt deadline. Applied BEFORE retry so each retry
		//    resubscribes to a fresh timeout. Swapping the order (timeout
		//    OUTSIDE retry) would apply one global deadline to the entire
		//    retry chain — not what callers expect for "per-attempt timeout."
		if (opts.timeoutMs != null) {
			if (isNode<number>(opts.timeoutMs)) {
				const inputForLayer = current;
				const reactiveTimeoutMs = opts.timeoutMs;
				current = switchMap(reactiveTimeoutMs, (ms) => {
					assertTimeoutMsValid(ms);
					return timeout(inputForLayer, ms * NS_PER_MS, {
						meta: domainMeta("resilient", "timeout"),
					});
				});
				this.add(current, { name: "timeoutWrapped" });
			} else {
				assertTimeoutMsValid(opts.timeoutMs);
				current = timeout(current, opts.timeoutMs * NS_PER_MS, {
					meta: domainMeta("resilient", "timeout"),
				});
				this.add(current, { name: "timeoutWrapped" });
			}
		}

		// 5. Retry — resubscribe on `ERROR` up to `count` times. Wraps timeout
		//    so each retry gets its own fresh deadline.
		if (opts.retry != null) {
			if (isNode<RetryOptions>(opts.retry)) {
				const inputForLayer = current;
				const reactiveRetry = opts.retry;
				current = switchMap(reactiveRetry, (r) =>
					retry(inputForLayer, { ...r, meta: domainMeta("resilient", "retry") }),
				);
				this.add(current, { name: "retryWrapped" });
			} else {
				current = retry(current, { ...opts.retry, meta: domainMeta("resilient", "retry") });
				this.add(current, { name: "retryWrapped" });
			}
		}

		// 6. Fallback — last resort after retry+timeout exhaust. Guard
		//    `opts.fallback !== undefined` so `null` is a valid fallback.
		if (opts.fallback !== undefined) {
			current = fallback(current, opts.fallback, {
				meta: domainMeta("resilient", "fallback"),
			});
			this.add(current, { name: "fallbackWrapped" });
		}

		// 7. Status wrapping — observability. Always last so it sees the final shape.
		const statusBundle = withStatus(current, {
			initialStatus: opts.initialStatus ?? "pending",
			meta: domainMeta("resilient", "status"),
		});

		this.output = statusBundle.node;
		this.status = statusBundle.status;
		this.lastError = statusBundle.error;
		this.breakerState = breakerState;
		this.droppedCount = droppedCount;
		this.rateLimitState = rateLimitState;

		// Mount the externally-visible top-level entries by name. Each carries
		// its own factoryTag meta from the underlying primitive (`withStatus`
		// for `output`/`status`/`lastError`); domain-level provenance lives on
		// the Graph itself via the `tagFactory("resilientPipeline", ...)` call
		// in the public factory below. The mount names use `output` /
		// `lastError` to match the property names — the previous `node` /
		// `error` clashed with `Graph.node(name)` / `Graph.error(name, err)`.
		this.add(this.output, { name: "output" });
		this.add(this.status, { name: "status" });
		this.add(this.lastError, { name: "lastError" });
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Compose a resilient pipeline around `source` in the canonical nesting
 * order — `rateLimit → budget → breaker → timeout → retry → fallback → status`.
 * Omit any option to skip that layer.
 *
 * Returns a {@link ResilientPipelineGraph} (Graph subclass) —
 * `pipeline.output` is the externally visible final node; `pipeline.status`
 * / `pipeline.lastError` / `pipeline.breakerState` / `pipeline.droppedCount`
 * are the per-layer companions. Call `pipeline.describe()` to see the
 * mounted intermediates; compose with {@link graphLens}'s `health` for
 * aggregate status.
 *
 * **Naming note:** `output` and `lastError` (not `node` / `error`) avoid
 * clashes with `Graph.node(name)` and `Graph.error(name, err)` on the base
 * class.
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
 * safeFetch.output.subscribe(msgs => console.log(msgs));
 * safeFetch.status.subscribe(msgs => console.log(msgs));
 * safeFetch.describe({ format: "ascii" }); // visualize the chain
 * ```
 *
 * @category patterns
 */
export function resilientPipeline<T>(
	source: Node<T>,
	opts: ResilientPipelineOptions<T> = {},
): ResilientPipelineGraph<T> {
	const g = new ResilientPipelineGraph<T>(source, opts);
	// Self-tag for `graph.describe()` factory provenance (Phase 2.5 DG1=B).
	// `placeholderArgs` substitutes Node-typed and function-typed fields with
	// `"<Node>"` / `"<function>"` so `factoryArgs` stays JSON-serializable.
	g.tagFactory("resilientPipeline", placeholderArgs(opts as unknown as Record<string, unknown>));
	return g;
}

// Tag the underlying status / error / breaker / dropped companions with a
// best-effort factoryTag too via the wrapper class's meta — already covered
// by `domainMeta("resilient", kind)` on the mounted nodes.

// Re-export the underlying primitives' option types and the factoryTag/placeholder
// helpers so downstream callers compose options at the call site.
export { factoryTag, placeholderArgs };
export { NS_PER_MS, NS_PER_SEC };
export type {
	BudgetConstraint,
	CircuitBreakerOptions,
	CircuitState,
	FallbackInput,
	RateLimiterOptions,
	RateLimiterState,
	RetryOptions,
	StatusValue,
};
