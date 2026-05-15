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
import { ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { placeholderArgs } from "@graphrefly/pure-ts/core/meta.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { Graph, type GraphOptions } from "@graphrefly/pure-ts/graph";
import { domainMeta } from "../meta.js";
import { switchMap } from "../operators/index.js";
import { NS_PER_MS } from "./backoff.js";
import {
	type BreakerState,
	type BudgetConstraint,
	budgetGate,
	type CircuitBreakerOptions,
	circuitBreaker,
	type FallbackInput,
	fallback,
	type RateLimiterOptions,
	type RateLimiterState,
	type RetryOptions,
	type RetryState,
	rateLimiter,
	retry,
	type StatusValue,
	type TimeoutOptions,
	type TimeoutState,
	timeout,
	withBreaker,
	withStatus,
} from "./index.js";

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
	readonly breakerState: Node<BreakerState> | undefined;
	/**
	 * Timeout state companion when `opts.timeoutMs` is supplied as a
	 * `Node<Partial<TimeoutOptions>>`-like form; `undefined` otherwise
	 * (DS-13.5.B forwarding contract — Node-form opts skip the switchMap
	 * rebuild and lift the primitive's lifecycle companion onto the
	 * pipeline bundle).
	 */
	readonly timeoutState: Node<TimeoutState> | undefined;
	/**
	 * Retry state companion when `opts.retry` is supplied as a
	 * `Node<RetryOptions>`-like form; `undefined` otherwise
	 * (DS-13.5.B forwarding contract).
	 */
	readonly retryState: Node<RetryState> | undefined;
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
		let breakerState: Node<BreakerState> | undefined;
		let timeoutState: Node<TimeoutState> | undefined;
		let retryState: Node<RetryState> | undefined;

		// 1. Admission control — cheapest to drop / queue before any other work.
		if (opts.rateLimit != null) {
			if (isNode<Omit<RateLimiterOptions, "maxBuffer"> & { maxBuffer?: number }>(opts.rateLimit)) {
				// DS-13.5.B forwarding: rateLimiter primitive is widened to
				// accept `NodeOrValue<RateLimiterOptions>` directly. Forward
				// the Node form to preserve internal state (pending buffer,
				// dropped counter) across opts swaps. Companion nodes
				// (droppedCount / rateLimitState) lift onto the pipeline
				// bundle. The pre-DS-13.5.B switchMap-rebuild path is gone.
				const bundle = rateLimiter(current, opts.rateLimit as NodeOrValue<RateLimiterOptions>);
				current = bundle.node;
				droppedCount = bundle.droppedCount;
				rateLimitState = bundle.rateLimitState;
				this.add(current, { name: "rateLimited" });
				this.add(droppedCount, { name: "droppedCount" });
				this.add(rateLimitState, { name: "rateLimitState" });
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
							}).node
						: inputForLayer,
				);
				this.add(current, { name: "budgetGated" });
			} else if (opts.budget.length > 0) {
				current = budgetGate(current, opts.budget, {
					meta: domainMeta("resilient", "budget"),
				}).node;
				this.add(current, { name: "budgetGated" });
			}
		}

		// 3. Breaker — skip the resource when unhealthy (fail-fast before retry wastes time).
		if (opts.breaker != null) {
			// DS-13.5.B forwarding: circuitBreaker primitive accepts
			// `NodeOrValue<CircuitBreakerOptions>` directly. Pass the Node
			// form straight through so internal state (`_state`,
			// `_failureCount`, `_openCycle`, …) is preserved across opts
			// swaps. Companion `breakerState` lifts onto the pipeline
			// bundle in both static and Node-form paths.
			const breaker = circuitBreaker(opts.breaker as NodeOrValue<CircuitBreakerOptions>);
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

		// 4. Timeout — per-attempt deadline. Applied BEFORE retry so each retry
		//    resubscribes to a fresh timeout. Swapping the order (timeout
		//    OUTSIDE retry) would apply one global deadline to the entire
		//    retry chain — not what callers expect for "per-attempt timeout."
		if (opts.timeoutMs != null) {
			if (isNode<number>(opts.timeoutMs)) {
				// DS-13.5.B forwarding: build a derived `Node<{ns}>` from
				// the caller's `Node<number>` (ms) and pass directly to the
				// widened timeout primitive. State preservation (in-flight
				// deadline) is handled inside timeout's reactive opts path.
				// Companion `timeoutState` lifts onto the pipeline bundle.
				const reactiveTimeoutMs = opts.timeoutMs;
				const initialMs = reactiveTimeoutMs.cache as number | undefined;
				// QA A5 (2026-05-03): assert validity of the cached initial
				// value at construction so a bad cache fails loud at wire
				// time, not silently at first emit. Reactive emits with
				// invalid values flow through the producer body's ERROR
				// channel rather than throwing into the host scheduler.
				if (initialMs !== undefined) assertTimeoutMsValid(initialMs);
				const optsBridge = node<Partial<TimeoutOptions>>(
					[reactiveTimeoutMs as Node<unknown>],
					(batchData, actions, ctx) => {
						const data = batchData.map((b, i) =>
							b != null && b.length > 0 ? b.at(-1) : ctx.prevData[i],
						);
						const ms = data[0] as number | undefined;
						if (ms === undefined) return;
						// QA A5: route validation failures through the
						// reactive ERROR channel — sync `throw` inside a
						// producer body corrupts the host scheduler's
						// wave dispatch (mirrors timeout primitive's
						// "sync throw would corrupt the host scheduler"
						// rationale).
						if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0 || ms > 9_000_000) {
							actions.down([
								[
									ERROR,
									new RangeError(
										`resilientPipeline: timeoutMs reactive emit invalid (${ms}); must be > 0 and <= 9_000_000.`,
									),
								],
							]);
							return;
						}
						actions.emit({ ns: ms * NS_PER_MS });
					},
					{
						describeKind: "derived",
						name: "timeoutOptsBridge",
						...(initialMs !== undefined
							? { initial: { ns: initialMs * NS_PER_MS } as Partial<TimeoutOptions> }
							: {}),
					},
				);
				// QA A5: register the bridge on the pipeline graph so
				// describe() walks see the full topology (dry-run /
				// real-run equivalence per CLAUDE.md).
				this.add(optsBridge, { name: "timeoutOptsBridge" });
				const bundle = timeout(current, optsBridge, {
					meta: domainMeta("resilient", "timeout"),
				});
				current = bundle.node;
				timeoutState = bundle.timeoutState;
				this.add(current, { name: "timeoutWrapped" });
				this.add(timeoutState, { name: "timeoutState" });
			} else {
				assertTimeoutMsValid(opts.timeoutMs);
				const bundle = timeout(
					current,
					{ ns: opts.timeoutMs * NS_PER_MS },
					{
						meta: domainMeta("resilient", "timeout"),
					},
				);
				current = bundle.node;
				timeoutState = bundle.timeoutState;
				this.add(current, { name: "timeoutWrapped" });
				this.add(timeoutState, { name: "timeoutState" });
			}
		}

		// 5. Retry — resubscribe on `ERROR` up to `count` times. Wraps timeout
		//    so each retry gets its own fresh deadline.
		if (opts.retry != null) {
			// DS-13.5.B forwarding: retry primitive accepts
			// `NodeOrValue<RetryOptions>` directly. Forward Node form so
			// `attempt` / `prevDelay` / in-flight timer survive opts swaps.
			// Companion `retryState` lifts onto the pipeline bundle.
			if (isNode<RetryOptions>(opts.retry)) {
				const bundle = retry(current, opts.retry as NodeOrValue<RetryOptions>);
				current = bundle.node;
				retryState = bundle.retryState;
				this.add(current, { name: "retryWrapped" });
				this.add(retryState, { name: "retryState" });
			} else {
				const bundle = retry(current, {
					...opts.retry,
					meta: domainMeta("resilient", "retry"),
				});
				current = bundle.node;
				retryState = bundle.retryState;
				this.add(current, { name: "retryWrapped" });
				this.add(retryState, { name: "retryState" });
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
		this.timeoutState = timeoutState;
		this.retryState = retryState;

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
 * graphSpecToAscii(safeFetch.describe()); // visualize the chain
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

// Tier 9.1 γ-form: this module now lives inside `extra/resilience/`, so the
// underlying primitive option types are already exported from the same barrel
// (`./index.js`). The previous re-exports of `factoryTag` / `placeholderArgs` /
// `NS_PER_MS` / `NS_PER_SEC` / option types were a workaround for the prior
// `patterns/resilient-pipeline/` folder location and are now redundant.
