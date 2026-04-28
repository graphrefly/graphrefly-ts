/**
 * Resilience utilities — roadmap §3.1 + §3.1c (retry, breaker, rate limit, status,
 * fallback, cache, timeout, budgetGate).
 */

// budgetGate lives in its own file per Tier 2.2 (promoted from
// patterns/reduction/) — re-export here so it ships through the barrel.
export {
	type BudgetConstraint,
	type BudgetGateOptions,
	budgetGate,
} from "./budget-gate.js";

// resilientPipeline preset — moved from patterns/resilient-pipeline/ per
// Tier 9.1 γ-form γ-R-2 (semantically belongs with the resilience family,
// not under ai/).
export {
	ResilientPipelineGraph,
	type ResilientPipelineOptions,
	resilientPipeline,
} from "./resilient-pipeline.js";

import { batch } from "../../core/batch.js";
import { monotonicNs } from "../../core/clock.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	RESOLVED,
	TEARDOWN,
} from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { producer } from "../../core/sugar.js";
import {
	type BackoffPreset,
	type BackoffStrategy,
	NS_PER_MS,
	NS_PER_SEC,
	resolveBackoffPreset,
} from "../backoff.js";
import { fromAny } from "../sources.js";
import { ResettableTimer } from "../timer.js";
import { RingBuffer } from "../utils/ring-buffer.js";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function operatorOpts<T>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", ...opts } as NodeOptions<T>;
}

function clampNonNegative(value: number): number {
	return value < 0 ? 0 : value;
}

function msgVal(m: Message): unknown {
	return m[1];
}

function coerceDelayNs(raw: number): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		throw new TypeError("backoff strategy must return a finite number");
	}
	return raw < 0 ? 0 : raw;
}

export type RetryOptions = {
	/**
	 * Max retry attempts after each terminal `ERROR` (not counting the first failure).
	 *
	 * **Required when `backoff` is set.** Pass `Infinity` to opt in to unbounded retries
	 * — the explicit value rules out the silent-infinite-budget footgun (a flaky provider
	 * + exponential backoff + omitted `count` would previously default to ~2.1B retries).
	 */
	count?: number;
	/** Delay between attempts; strategies use **nanoseconds**. */
	backoff?: BackoffStrategy | BackoffPreset;
	/**
	 * Caller-supplied metadata merged into the produced node's `meta` (Tier 5.2
	 * D8 widening). Use {@link domainMeta} to tag the layer for `describe()`
	 * grouping. The primitive's `factoryTag("retry", …)` always wins against
	 * caller keys.
	 */
	meta?: Record<string, unknown>;
};

/** Factory-mode-only options. `initial` seeds the outer node's cache before the first attempt. */
export type RetryFactoryOptions<T> = RetryOptions & {
	/** Initial cache value for the outer node before the factory runs the first time. */
	initial?: T;
};

/**
 * Resolved retry config shared by source-mode and factory-mode wrappers.
 * Centralises the unbounded-retry footgun guard and strategy resolution.
 */
type ResolvedRetryConfig = {
	maxRetries: number;
	strategy: BackoffStrategy | null;
};

function resolveRetryConfig(opts?: RetryOptions): ResolvedRetryConfig {
	const count = opts?.count;
	const backoffOpt = opts?.backoff;

	// Unbounded-retry footgun fix: if `backoff` is set without explicit `count`,
	// throw at construction time. Caller must opt in to `Infinity` for unbounded.
	if (backoffOpt !== undefined && count === undefined) {
		throw new RangeError(
			"retry({ backoff }) requires explicit count to prevent unbounded retries; pass { count: <n>, backoff: ... }",
		);
	}

	const maxRetries = count !== undefined ? count : 0;
	if (maxRetries < 0) throw new RangeError("retry count must be >= 0");

	const strategy: BackoffStrategy | null =
		backoffOpt === undefined
			? null
			: typeof backoffOpt === "string"
				? resolveBackoffPreset(backoffOpt)
				: backoffOpt;

	return { maxRetries, strategy };
}

function retryFactoryArgs(opts?: RetryOptions): Record<string, unknown> | undefined {
	const args: Record<string, unknown> = {};
	if (opts?.count !== undefined) args.count = opts.count;
	if (typeof opts?.backoff === "string") args.backoff = opts.backoff;
	return Object.keys(args).length > 0 ? args : undefined;
}

/**
 * Shared retry state machine. Both `_retrySource` and `_retryFactory` thin-wrap this:
 * the only per-mode logic is supplied via `acquireSource` (returns a fresh `Node<T>`
 * per attempt — for source-mode it just returns the captured `Node`; for factory-mode
 * it calls the user factory and forwards synchronous throws into the same retry path).
 */
function _runRetryStateMachine<T>(
	cfg: ResolvedRetryConfig,
	acquireSource: () => Node<T>,
	a: { emit: (v: T) => void; down: (msgs: Message[]) => void },
): () => void {
	let attempt = 0;
	let stopped = false;
	let prevDelay: number | null = null;
	let unsub: (() => void) | undefined;
	const timer = new ResettableTimer();

	function disconnectUpstream(): void {
		unsub?.();
		unsub = undefined;
	}

	function scheduleRetryOrFinish(err: unknown): void {
		if (stopped) return;
		if (attempt >= cfg.maxRetries) {
			disconnectUpstream();
			a.down([[ERROR, err]]);
			return;
		}
		const raw = cfg.strategy === null ? 0 : cfg.strategy(attempt, err, prevDelay);
		// null from strategy = "stop retrying" (e.g. withMaxAttempts cap reached)
		if (raw === null || raw === undefined) {
			disconnectUpstream();
			a.down([[ERROR, err]]);
			return;
		}
		// A misbehaving strategy (returns NaN / non-finite / negative) MUST NOT
		// escape into the upstream drain. Treat it like `strategy === null`
		// (stop retrying) and emit the original error — the strategy bug is a
		// separate concern the user can inspect via the emitted error's stack.
		let delayNs: number;
		try {
			delayNs = coerceDelayNs(raw);
		} catch {
			disconnectUpstream();
			a.down([[ERROR, err]]);
			return;
		}
		prevDelay = delayNs;
		attempt += 1;
		disconnectUpstream();
		// `Math.max(1, …)` floor: every backoff schedule floors at 1ms even when
		// the strategy returns 0ns. Avoids 0-delay re-entrancy on the active
		// stack frame (which would risk stack overflow on a tight ERROR loop).
		const delayMs = delayNs > 0 ? delayNs / NS_PER_MS : 1;
		// §5.10: setTimeout (not fromTimer) — retry delay needs clearTimeout/setTimeout;
		// fromTimer creates a new Node per reset, adding lifecycle overhead per retry.
		timer.start(delayMs, () => {
			if (stopped) return;
			connect();
		});
	}

	function connect(): void {
		timer.cancel();
		disconnectUpstream();
		let src: Node<T>;
		try {
			src = acquireSource();
		} catch (err) {
			scheduleRetryOrFinish(err);
			return;
		}
		unsub = src.subscribe((msgs) => {
			if (stopped) return;
			for (const m of msgs) {
				const t = m[0];
				if (t === DIRTY) a.down([[DIRTY]]);
				else if (t === DATA) {
					attempt = 0;
					prevDelay = null;
					a.emit(m[1] as T);
				} else if (t === RESOLVED) a.down([[RESOLVED]]);
				else if (t === COMPLETE) {
					disconnectUpstream();
					a.down([[COMPLETE]]);
				} else if (t === ERROR) {
					scheduleRetryOrFinish(msgVal(m));
					return;
				} else a.down([m]);
			}
		});
	}

	connect();

	return () => {
		stopped = true;
		timer.cancel();
		disconnectUpstream();
	};
}

/**
 * Retry operator — two modes selected by the type of `input`:
 *
 * **Source mode** (`input: Node<T>`): resubscribes to the same node after each terminal
 * `ERROR`. The upstream should use `resubscribable: true` if it must emit again after `ERROR`.
 *
 * **Factory mode** (`input: () => Node<T>`): invokes the factory to build a fresh `Node<T>`
 * on every connect / reconnect. Ideal for producers that capture per-attempt resources
 * (sockets, clients, file handles) that become unusable after an error. Synchronous
 * exceptions thrown by the factory are treated as terminal ERROR and run through the
 * same retry pipeline as inner-node ERROR.
 *
 * @param input - Upstream node or factory that returns a fresh node per attempt.
 * @param opts - `count` caps attempts (**required when `backoff` is set**; pass `Infinity` to opt in to unbounded); `backoff` supplies delay in **nanoseconds** (or a preset name); `initial` seeds the outer node cache (factory mode only).
 * @returns Node that retries on error.
 *
 * @throws {RangeError} when `backoff` is provided without an explicit `count` (unbounded-retry footgun guard) or when `count < 0`.
 *
 * @remarks
 * **Protocol:** Forwards unknown message tuples unchanged; handles `DIRTY`, `DATA`, `RESOLVED`, `COMPLETE`, `ERROR`.
 *
 * **Backoff floor:** every scheduled delay is floored at 1ms via `Math.max(1, delayNs / NS_PER_MS)` even when the strategy returns 0ns. This avoids 0-delay re-entrancy on the active stack frame on a tight ERROR loop. Strategies that return `null`/`undefined` stop retrying immediately and forward the original error.
 *
 * @example
 * ```ts
 * // Source mode — resubscribe the same node:
 * import { ERROR, NS_PER_SEC, producer, retry, constant } from "@graphrefly/graphrefly-ts";
 *
 * const src = producer(
 *   (a) => { a.down([[ERROR, new Error("x")]]); },
 *   { resubscribable: true },
 * );
 * const out = retry(src, { count: 2, backoff: constant(0.25 * NS_PER_SEC) });
 *
 * // Factory mode — fresh node per attempt (e.g. reconnecting WebSocket):
 * import { NS_PER_SEC, exponential, retry, fromWebSocket } from "@graphrefly/graphrefly-ts";
 *
 * const connected$ = retry(
 *   () => fromWebSocket(new WebSocket("wss://example/stream")),
 *   { count: 10, backoff: exponential({ baseNs: 1 * NS_PER_SEC }) },
 * );
 * ```
 *
 * @category extra
 */
export function retry<T>(input: Node<T>, opts?: RetryOptions): Node<T>;
export function retry<T>(input: () => Node<T>, opts?: RetryFactoryOptions<T>): Node<T>;
export function retry<T>(
	input: Node<T> | (() => Node<T>),
	opts?: RetryOptions | RetryFactoryOptions<T>,
): Node<T> {
	if (typeof input === "function") {
		return _retryFactory(input, opts as RetryFactoryOptions<T> | undefined);
	}
	return _retrySource(input, opts);
}

function _retrySource<T>(source: Node<T>, opts?: RetryOptions): Node<T> {
	const cfg = resolveRetryConfig(opts);
	return producer<T>((a) => _runRetryStateMachine(cfg, () => source, a), {
		...operatorOpts(),
		initial: source.cache,
		meta: { ...(opts?.meta ?? {}), ...factoryTag("retry", retryFactoryArgs(opts)) },
	});
}

function _retryFactory<T>(factory: () => Node<T>, opts?: RetryFactoryOptions<T>): Node<T> {
	const cfg = resolveRetryConfig(opts);
	return producer<T>((a) => _runRetryStateMachine(cfg, factory, a), {
		...operatorOpts(),
		initial: opts?.initial as T | undefined,
		meta: { ...(opts?.meta ?? {}), ...factoryTag("retry", retryFactoryArgs(opts)) },
	});
}

export type CircuitState = "closed" | "open" | "half-open";

/**
 * Thrown when {@link withBreaker} is configured with `onOpen: "error"` and the breaker rejects work.
 *
 * @category extra
 */
export class CircuitOpenError extends Error {
	override name = "CircuitOpenError";
	constructor() {
		super("Circuit breaker is open");
	}
}

export interface CircuitBreakerOptions {
	/** Number of consecutive failures before opening. Default: 5. */
	failureThreshold?: number;
	/** Base cooldown in nanoseconds before transitioning to half-open. Default: 30s. */
	cooldownNs?: number;
	/** Backoff strategy for cooldown escalation across consecutive open cycles. Overrides `cooldownNs` when provided. */
	cooldown?: BackoffStrategy;
	/** Max trial requests allowed in half-open state. Default: 1. */
	halfOpenMax?: number;
	/**
	 * Clock function returning **nanoseconds** with `monotonicNs()` semantics
	 * (monotonically non-decreasing; suitable for elapsed-time arithmetic — never
	 * use `Date.now()` because wall-clock skew can flip elapsed math negative).
	 * Default: `monotonicNs` from `core/clock`. Override for deterministic tests.
	 */
	now?: () => number;
}

export interface CircuitBreaker {
	/** Whether a request should be allowed through. Triggers open→half-open transition when cooldown expires. */
	canExecute(): boolean;
	/** Record a successful execution. Resets to closed. */
	recordSuccess(): void;
	/** Record a failed execution. May transition to open. */
	recordFailure(error?: unknown): void;
	/**
	 * Current circuit state (read-only, does not trigger transitions).
	 *
	 * **Telemetry:** wrap with {@link withBreaker} to surface this as a reactive
	 * `Node<CircuitState>` companion (`bundle.breakerState`) — every state
	 * transition (`closed`/`open`/`half-open`) emits to subscribers.
	 */
	readonly state: CircuitState;
	/** Number of consecutive failures in the current closed period. */
	readonly failureCount: number;
	/** Manually reset to closed state, clearing all counters. */
	reset(): void;
}

/**
 * Factory for a synchronous circuit breaker with `closed`, `open`, and `half-open` states.
 *
 * Supports escalating cooldown via an optional {@link BackoffStrategy} — each consecutive
 * open→half-open→open cycle increments the backoff attempt.
 *
 * @param options - Threshold, cooldown, half-open limit, and optional clock override.
 * @returns {@link CircuitBreaker} instance.
 *
 * @remarks
 * **Timing:** Uses `monotonicNs()` by default (nanoseconds). Override `now` for tests.
 *
 * @example
 * ```ts
 * import { circuitBreaker, exponential, NS_PER_SEC } from "@graphrefly/graphrefly-ts";
 *
 * const b = circuitBreaker({
 *   failureThreshold: 3,
 *   cooldown: exponential({ baseNs: 1 * NS_PER_SEC }),
 * });
 * ```
 *
 * @category extra
 */
export function circuitBreaker(options?: CircuitBreakerOptions): CircuitBreaker {
	const threshold = Math.max(1, options?.failureThreshold ?? 5);
	const baseCooldownNs = clampNonNegative(options?.cooldownNs ?? 30 * NS_PER_SEC);
	const cooldownStrategy = options?.cooldown ?? null;
	const halfOpenMax = Math.max(1, options?.halfOpenMax ?? 1);
	const now = options?.now ?? monotonicNs;

	let _state: CircuitState = "closed";
	let _failureCount = 0;
	let _openCycle = 0;
	let _lastOpenedAt = 0;
	let _lastCooldownNs = baseCooldownNs;
	let _halfOpenAttempts = 0;

	function getCooldownNs(): number {
		if (!cooldownStrategy) return baseCooldownNs;
		const delayNs = cooldownStrategy(_openCycle);
		return delayNs !== null ? delayNs : baseCooldownNs;
	}

	function transitionToOpen(): void {
		_state = "open";
		_lastCooldownNs = getCooldownNs();
		_lastOpenedAt = now();
		_halfOpenAttempts = 0;
	}

	const breaker: CircuitBreaker = {
		canExecute(): boolean {
			if (_state === "closed") return true;

			if (_state === "open") {
				const elapsed = now() - _lastOpenedAt;
				if (elapsed >= _lastCooldownNs) {
					_state = "half-open";
					_halfOpenAttempts = 1;
					return true;
				}
				return false;
			}

			if (_halfOpenAttempts < halfOpenMax) {
				_halfOpenAttempts++;
				return true;
			}
			return false;
		},

		recordSuccess(): void {
			if (_state === "half-open") {
				_state = "closed";
				_failureCount = 0;
				_openCycle = 0;
			} else if (_state === "closed") {
				_failureCount = 0;
			}
		},

		recordFailure(_error?: unknown): void {
			if (_state === "half-open") {
				_openCycle++;
				transitionToOpen();
				return;
			}

			if (_state === "closed") {
				_failureCount++;
				if (_failureCount >= threshold) {
					transitionToOpen();
				}
			}
		},

		get state(): CircuitState {
			return _state;
		},

		get failureCount(): number {
			return _failureCount;
		},

		reset(): void {
			_state = "closed";
			_failureCount = 0;
			_openCycle = 0;
			_halfOpenAttempts = 0;
		},
	};

	return breaker;
}

export type WithBreakerBundle<T> = {
	node: Node<T>;
	breakerState: Node<CircuitState>;
};

/**
 * Returns a unary wrapper that gates upstream `DATA` through a {@link CircuitBreaker}.
 *
 * @param breaker - Shared breaker instance (typically one per resource).
 * @param options - `onOpen: "skip"` emits `RESOLVED` when open; `"error"` emits {@link CircuitOpenError}.
 * @returns Function mapping `Node<T>` to `{ node, breakerState }` companion nodes.
 *
 * @remarks
 * **Success path:** `COMPLETE` calls {@link CircuitBreaker.recordSuccess}. **Failure path:** upstream `ERROR` calls {@link CircuitBreaker.recordFailure} and is forwarded.
 *
 * **State telemetry:** `breakerState: Node<CircuitState>` is a reactive companion that mirrors `breaker.state` — every transition (`closed`/`open`/`half-open`) emits a `DATA`. Also accessible via `node.meta.breakerState` for `describe()` traversal.
 *
 * @example
 * ```ts
 * import { state, withBreaker, circuitBreaker } from "@graphrefly/graphrefly-ts";
 *
 * const b = circuitBreaker({ failureThreshold: 2 });
 * const s = state(1);
 * const { node, breakerState } = withBreaker(b)(s);
 * ```
 *
 * @category extra
 */
export function withBreaker<T>(
	breaker: CircuitBreaker,
	options?: { onOpen?: "skip" | "error"; meta?: Record<string, unknown> },
): (source: Node<T>) => WithBreakerBundle<T> {
	const onOpen = options?.onOpen ?? "skip";
	const callerMeta = options?.meta;

	return (source: Node<T>): WithBreakerBundle<T> => {
		const wrapped = node<T>(
			[],
			(_deps, a) => {
				function syncState(): void {
					wrapped.meta.breakerState.down([[DATA, breaker.state]]);
				}

				const unsub = source.subscribe((msgs) => {
					for (const m of msgs) {
						const t = m[0];
						if (t === DIRTY) a.down([[DIRTY]]);
						else if (t === DATA) {
							if (breaker.canExecute()) {
								syncState();
								a.emit(m[1] as T);
							} else {
								syncState();
								if (onOpen === "error") a.down([[ERROR, new CircuitOpenError()]]);
								else a.down([[RESOLVED]]);
							}
						} else if (t === RESOLVED) a.down([[RESOLVED]]);
						else if (t === COMPLETE) {
							breaker.recordSuccess();
							syncState();
							a.down([[COMPLETE]]);
						} else if (t === ERROR) {
							breaker.recordFailure(msgVal(m));
							syncState();
							a.down([m]);
						} else a.down([m]);
					}
				});
				syncState();
				return unsub;
			},
			{
				...operatorOpts(),
				meta: {
					...(callerMeta ?? {}),
					breakerState: breaker.state,
					...factoryTag("withBreaker", { onOpen }),
				},
				completeWhenDepsComplete: false,
				initial: source.cache,
			},
		);

		return { node: wrapped, breakerState: wrapped.meta.breakerState as Node<CircuitState> };
	};
}

export interface TokenBucket {
	/**
	 * Number of tokens currently available (after refill).
	 *
	 * **Float-valued.** When `refillPerSecond` is fractional (or `capacity` × elapsed-fraction
	 * yields a non-integer), the bucket accumulates fractional refill credit between
	 * `tryConsume`s. Consumers should not assume integer tokens — e.g. with
	 * `tokenBucket(10, 2.5)` after 100ms of elapsed time `available()` may report `0.25`.
	 */
	available(): number;
	/** Try to consume `cost` tokens. Returns `true` if successful. */
	tryConsume(cost?: number): boolean;
	/**
	 * Return `cost` tokens to the bucket (capped at capacity). Used when a
	 * multi-bucket admission fails partway — e.g., `adaptiveRateLimiter`
	 * consumes from an rpm bucket, then a tpm bucket; if tpm fails, call
	 * `rpmBucket.putBack(requestCost)` so the rpm slot isn't wasted.
	 * No-op for non-positive `cost`.
	 */
	putBack(cost?: number): void;
}

/** Optional configuration for {@link tokenBucket}. */
export interface TokenBucketOptions {
	/**
	 * Clock function returning **nanoseconds** with `monotonicNs()` semantics
	 * (monotonically non-decreasing). Default: `monotonicNs` from `core/clock`.
	 * Override for deterministic tests — eliminates the need for `vi.useFakeTimers`
	 * to drive token-refill scheduling.
	 */
	clock?: () => number;
}

/**
 * Token-bucket meter (capacity + refill rate per second). Use with {@link rateLimiter} or custom gates.
 *
 * @param capacity - Maximum tokens (must be positive).
 * @param refillPerSecond - Tokens added per elapsed second (non-negative; may be fractional).
 * @param opts - Optional `clock` override for deterministic testing.
 * @returns {@link TokenBucket} instance.
 *
 * @remarks
 * **Float behavior:** the internal token counter is float-valued — fractional refill
 * accumulates between `tryConsume` calls. See {@link TokenBucket.available} for caveats.
 *
 * **Clock injection:** pass `opts.clock` to drive refill scheduling deterministically
 * in tests. The contract matches {@link circuitBreaker}'s `now` option: must return
 * `monotonicNs()`-style nanoseconds, never `Date.now()` (wall-clock skew breaks
 * elapsed math).
 *
 * @example
 * ```ts
 * import { tokenBucket } from "@graphrefly/graphrefly-ts";
 *
 * const bucket = tokenBucket(10, 2); // capacity 10, refill 2 tokens/sec
 * bucket.tryConsume(3); // true — 7 tokens remaining
 * bucket.available();   // ~7 (plus any elapsed refill — float-valued)
 *
 * // Deterministic test:
 * let t = 0;
 * const tb = tokenBucket(5, 1, { clock: () => t });
 * tb.tryConsume(5);    // exhausts
 * t = 1_000_000_000;   // advance 1s → +1 refill
 * tb.tryConsume(1);    // true
 * ```
 *
 * @category extra
 */
export function tokenBucket(
	capacity: number,
	refillPerSecond: number,
	opts?: TokenBucketOptions,
): TokenBucket {
	if (capacity <= 0) throw new RangeError("capacity must be > 0");
	if (refillPerSecond < 0) throw new RangeError("refillPerSecond must be >= 0");

	const clock = opts?.clock ?? monotonicNs;

	let tokens = capacity;
	let updatedAt = clock();

	function refill(now: number): void {
		if (refillPerSecond > 0) {
			const elapsedNs = now - updatedAt;
			tokens = Math.min(capacity, tokens + (elapsedNs / NS_PER_SEC) * refillPerSecond);
		}
		updatedAt = now;
	}

	return {
		available(): number {
			refill(clock());
			return tokens;
		},
		tryConsume(cost = 1): boolean {
			if (cost <= 0) return true;
			const now = clock();
			refill(now);
			if (tokens >= cost) {
				tokens -= cost;
				return true;
			}
			return false;
		},
		putBack(cost = 1): void {
			if (cost <= 0) return;
			refill(clock());
			tokens = Math.min(capacity, tokens + cost);
		},
	};
}

export type RateLimiterOverflowPolicy = "drop-oldest" | "drop-newest" | "error";

export type RateLimiterOptions = {
	/** Maximum `DATA` emissions per window (must be > 0). */
	maxEvents: number;
	/** Window length in nanoseconds (must be > 0). */
	windowNs: number;
	/**
	 * Cap on items queued while waiting for token refill.
	 *
	 * **Required.** Pass a finite positive integer (>= 1) for a bounded queue, OR
	 * the literal `Infinity` to opt in to an unbounded queue (caller acknowledges
	 * the unbounded-memory-growth risk on a high-rate source). Omitting this
	 * throws at construction time — the silent-unbounded-buffer footgun is the
	 * most common rateLimiter mis-configuration.
	 */
	maxBuffer: number;
	/** Overflow policy when `maxBuffer` is exceeded. Default: `"drop-newest"`. */
	onOverflow?: RateLimiterOverflowPolicy;
	/**
	 * Caller-supplied metadata merged into the produced node's `meta` (Tier 5.2
	 * D8 widening). Use {@link domainMeta} to tag the layer for `describe()` /
	 * mermaid grouping (e.g. `domainMeta("resilient", "rate-limit")`). The
	 * primitive's own `factoryTag("rateLimiter", opts)` and the `droppedCount`
	 * / `rateLimitState` companion seeds always win against caller-supplied
	 * keys so the audit trail can't be silently overwritten.
	 */
	meta?: Record<string, unknown>;
};

/**
 * Thrown by {@link rateLimiter} when `onOverflow: "error"` and the pending buffer is full.
 *
 * @category extra
 */
export class RateLimiterOverflowError extends Error {
	override name = "RateLimiterOverflowError";
	constructor(maxBuffer: number) {
		super(`rateLimiter buffer overflow (maxBuffer=${maxBuffer})`);
	}
}

/**
 * Combined runtime state surfaced by {@link rateLimiter} alongside `droppedCount`.
 * Tier 5.2 D7 widening — exposes pending-buffer occupancy and a `paused`
 * flag so consumers can render backpressure (UI), feed `lens.health`, or
 * gate downstream effects.
 */
export type RateLimiterState = {
	/** Cumulative `DATA` items dropped due to overflow since this subscription cycle started. */
	droppedCount: number;
	/** Items currently buffered awaiting a token refill. `0` when the limiter is passing through. */
	pendingCount: number;
	/** `true` when at least one item is queued (the limiter is actively throttling). */
	paused: boolean;
};

function rateLimiterStateEqual(a: RateLimiterState, b: RateLimiterState): boolean {
	return (
		a.droppedCount === b.droppedCount && a.pendingCount === b.pendingCount && a.paused === b.paused
	);
}

const RATE_LIMITER_INITIAL_STATE: RateLimiterState = Object.freeze({
	droppedCount: 0,
	pendingCount: 0,
	paused: false,
});

/** Bundle returned by {@link rateLimiter}. */
export type RateLimiterBundle<T> = {
	/** The throttled stream — at most `maxEvents` `DATA` per `windowNs`. */
	node: Node<T>;
	/**
	 * Reactive companion: count of `DATA` items dropped since the producer
	 * activated.
	 *
	 * - Increments on every drop under any overflow policy (`drop-newest`,
	 *   `drop-oldest`). The `error` policy terminates the stream after a single
	 *   overflow, so `droppedCount` increments at most once in that path.
	 * - **Lifecycle scoping (qa A1 + EC7):** the counter retains its final
	 *   value through terminal (`COMPLETE` / `ERROR` / `TEARDOWN`) so consumers
	 *   see the final drop count, not zero. The closure-held counter resets to
	 *   `0` only when the producer fn re-runs — which only happens on a new
	 *   subscription cycle, and only if the producer was constructed with
	 *   `resubscribable: true`. The default `rateLimiter` producer is NOT
	 *   resubscribable, so a single producer-fn run is the typical lifetime.
	 * - Producer-pattern note: this companion is invisible to `describe()`
	 *   traversal from `node` (effect-mirror limitation; same shape as
	 *   `withBreaker.breakerState` and `withStatus.status`). Surface it via
	 *   `node.meta.droppedCount` if you need it in topology snapshots.
	 */
	droppedCount: Node<number>;
	/**
	 * Reactive companion: combined `{droppedCount, pendingCount, paused}` view.
	 *
	 * - `pendingCount` reflects the live buffer occupancy and updates on every
	 *   push / shift / overflow drop; `paused` is shorthand for
	 *   `pendingCount > 0`.
	 * - Equality-deduped — re-emits only when one of the three fields actually
	 *   changes (so a busy steady-state where every DATA passes immediately
	 *   produces one `paused: false` emission, not one per DATA).
	 * - **Lifecycle scoping (qa EC7):** same contract as `droppedCount` —
	 *   retains its final value through terminal; resets to the initial
	 *   `{droppedCount: 0, pendingCount: 0, paused: false}` only on a new
	 *   producer-fn run (resubscribable upstream required).
	 * - Same producer-pattern caveat as `droppedCount` re: `describe()` visibility.
	 */
	rateLimitState: Node<RateLimiterState>;
};

/**
 * Token-bucket rate limiter: at most `maxEvents` `DATA` values per `windowNs`.
 *
 * Uses {@link tokenBucket} internally (capacity = `maxEvents`, refill = `maxEvents / windowSeconds`).
 * Excess items are queued FIFO (in a fixed-capacity {@link RingBuffer} for O(1) push/shift)
 * until a token is available. The queue is bounded by the **required** `maxBuffer` option
 * with a configurable overflow policy.
 *
 * @param source - Upstream node.
 * @param opts - Rate + bounded-buffer configuration. `maxBuffer` is required (use `Infinity` to opt in to unbounded).
 * @returns `{ node, droppedCount }` bundle. Subscribe to `node` for the throttled stream and to `droppedCount` for backpressure pressure.
 *
 * @throws {RangeError} when `maxEvents` / `windowNs` is non-positive, when `maxBuffer` is omitted, or when `maxBuffer` is a finite value < 1.
 *
 * @remarks
 * **Terminal:** `COMPLETE` / `ERROR` cancel the refill timer, drop the pending queue,
 * reset `droppedCount` to `0`, and propagate.
 *
 * @example
 * ```ts
 * import { rateLimiter, state, NS_PER_SEC } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(0);
 * // Allow at most 5 DATA values per second; queue up to 100 excess items, drop newest beyond.
 * const { node: limited, droppedCount } = rateLimiter(src, {
 *   maxEvents: 5,
 *   windowNs: NS_PER_SEC,
 *   maxBuffer: 100,
 * });
 * droppedCount.subscribe(([m]) => console.log("dropped so far:", m[1]));
 * ```
 *
 * @category extra
 */
export function rateLimiter<T>(source: Node<T>, opts: RateLimiterOptions): RateLimiterBundle<T> {
	const { maxEvents, windowNs } = opts;
	if (maxEvents <= 0) throw new RangeError("maxEvents must be > 0");
	if (windowNs <= 0) throw new RangeError("windowNs must be > 0");
	const maxBuffer = opts.maxBuffer;
	if (maxBuffer === undefined) {
		throw new RangeError(
			"rateLimiter requires explicit maxBuffer (use Infinity to opt in to unbounded)",
		);
	}
	// Allow `Infinity` for opt-in unbounded; otherwise require a positive integer.
	const isUnbounded = maxBuffer === Infinity;
	if (!isUnbounded && (!Number.isInteger(maxBuffer) || maxBuffer < 1)) {
		throw new RangeError("maxBuffer must be a positive integer (or Infinity for unbounded)");
	}
	const onOverflow: RateLimiterOverflowPolicy = opts.onOverflow ?? "drop-newest";
	const refillPerSec = (maxEvents * NS_PER_SEC) / windowNs;

	const out = producer<T>(
		(a) => {
			const bucket = tokenBucket(maxEvents, refillPerSec);
			// RingBuffer for O(1) push + shift. Unbounded mode falls back to a plain
			// array (RingBuffer requires a positive integer capacity); the caller
			// explicitly opted in via `maxBuffer: Infinity` and accepts the cost.
			const pending: { push: (v: T) => void; shift: () => T | undefined; size: number } =
				isUnbounded ? makeArrayQueue<T>() : ringBufferQueue<T>(maxBuffer);
			const timer = new ResettableTimer();
			let terminated = false;
			let dropped = 0;

			const tokenTimeNs = NS_PER_SEC / refillPerSec;

			// Mirror the dropped counter + combined state to the meta companions.
			// The `emit` call is the same subscribe-callback effect-mirror
			// pattern used by `withBreaker.breakerState` / `withStatus.status`
			// (sanctioned per audit § F.7).
			const droppedNode = out.meta.droppedCount;
			const stateNode = out.meta.rateLimitState;
			let lastState: RateLimiterState = RATE_LIMITER_INITIAL_STATE;
			function syncState(): void {
				droppedNode.emit(dropped);
				const next: RateLimiterState = {
					droppedCount: dropped,
					pendingCount: pending.size,
					paused: pending.size > 0,
				};
				// Equality-dedup at the emit boundary so steady-state pass-through
				// (every DATA passes immediately — pendingCount stays 0, paused
				// stays false) doesn't generate one state DATA per source DATA.
				if (!rateLimiterStateEqual(lastState, next)) {
					lastState = next;
					stateNode.emit(next);
				}
			}

			// Reset for this subscription cycle — `dropped` is the closure
			// variable (already 0 at construction); `pending.size` is also 0
			// (fresh queue per producer activation). The companion Node caches
			// may still hold a prior cycle's terminal values, so re-emit the
			// initial state explicitly.
			lastState = RATE_LIMITER_INITIAL_STATE;
			droppedNode.emit(0);
			stateNode.emit(RATE_LIMITER_INITIAL_STATE);

			function tryEmit(): void {
				while (pending.size > 0) {
					if (bucket.tryConsume(1)) {
						a.emit(pending.shift() as T);
						syncState();
					} else {
						// Wait one full token-refill interval. Avoids calling bucket.available()
						// which would advance the internal refill clock and steal fractional credit.
						// §5.10: setTimeout (not fromTimer) — refill-delay scheduling needs clearTimeout/setTimeout;
						// fromTimer creates a new Node per reset, adding lifecycle overhead per retry.
						timer.start(Math.max(1, tokenTimeNs / NS_PER_MS), tryEmit);
						return;
					}
				}
			}

			function recordDrop(): void {
				dropped += 1;
				syncState();
			}

			function resetForTerminal(): void {
				terminated = true;
				timer.cancel();
				// RingBuffer.clear-equivalent: drain remaining slots so refs GC.
				while (pending.size > 0) pending.shift();
				// qa A1: companions retain their last-emitted DATA value
				// through terminal (consumer sees the final drop count, not 0).
				// The closure-held `dropped` resets to 0 so a re-subscribe
				// cycle starts fresh; the activation block above re-emits
				// `RATE_LIMITER_INITIAL_STATE` at that point.
				dropped = 0;
			}

			const unsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (terminated) return;
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) {
						if (!isUnbounded && pending.size >= maxBuffer) {
							if (onOverflow === "drop-newest") {
								recordDrop();
							} else if (onOverflow === "drop-oldest") {
								pending.shift();
								pending.push(m[1] as T);
								recordDrop();
							} else {
								recordDrop();
								resetForTerminal();
								a.down([[ERROR, new RateLimiterOverflowError(maxBuffer)]]);
								return;
							}
						} else {
							pending.push(m[1] as T);
							syncState();
						}
						tryEmit();
					} else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) {
						resetForTerminal();
						a.down([[COMPLETE]]);
					} else if (t === ERROR) {
						resetForTerminal();
						a.down([m]);
					} else if (t === TEARDOWN) {
						resetForTerminal();
						a.down([m]);
						return;
					} else a.down([m]);
				}
			});

			return () => {
				terminated = true;
				timer.cancel();
				unsub();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: {
				// Caller-supplied meta first; companion seeds + factoryTag
				// override below so they always win.
				...(opts.meta ?? {}),
				droppedCount: 0,
				rateLimitState: RATE_LIMITER_INITIAL_STATE,
				...factoryTag("rateLimiter", opts),
			},
		},
	);

	return {
		node: out,
		droppedCount: out.meta.droppedCount as Node<number>,
		rateLimitState: out.meta.rateLimitState as Node<RateLimiterState>,
	};
}

/**
 * RingBuffer-backed queue adapter — exposes the small `{ push, shift, size }`
 * shape rateLimiter needs without leaking the rest of `RingBuffer`'s API.
 */
function ringBufferQueue<T>(capacity: number): {
	push: (v: T) => void;
	shift: () => T | undefined;
	size: number;
} {
	const buf = new RingBuffer<T>(capacity);
	return {
		push: (v: T) => buf.push(v),
		shift: () => buf.shift(),
		get size(): number {
			return buf.size;
		},
	} as { push: (v: T) => void; shift: () => T | undefined; size: number };
}

/**
 * Plain-array fallback queue for `maxBuffer: Infinity`. Accepts the O(N) shift
 * cost — the caller opted in to unbounded growth.
 */
function makeArrayQueue<T>(): {
	push: (v: T) => void;
	shift: () => T | undefined;
	size: number;
} {
	const arr: T[] = [];
	return {
		push: (v: T) => {
			arr.push(v);
		},
		shift: () => arr.shift(),
		get size(): number {
			return arr.length;
		},
	} as { push: (v: T) => void; shift: () => T | undefined; size: number };
}

export type StatusValue = "pending" | "running" | "completed" | "errored";

export type WithStatusBundle<T> = {
	node: Node<T>;
	status: Node<StatusValue>;
	error: Node<unknown | null>;
};

/**
 * Wraps `src` with `status` and `error` {@link state} companions for UI or meta snapshots.
 *
 * @param src - Upstream node to mirror.
 * @param options - `initialStatus` defaults to `"pending"`.
 * @returns `{ node, status, error }` where `out` is the mirrored stream, `status` is a
 *   reactive `Node<StatusValue>` (`"pending" | "running" | "completed" | "errored"`),
 *   and `error` holds the last `ERROR` payload (cleared to `null` on the next `DATA`
 *   after `errored`).
 *
 * @remarks
 * **Lifecycle:** `pending` (no DATA yet) → `running` (on first DATA) → `completed`
 * (on COMPLETE) or `errored` (on ERROR). After `errored`, the next `DATA` clears
 * `error` and re-enters `running` inside a {@link batch} so subscribers see one
 * consistent transition (matches graphrefly-py).
 *
 * **Producer-pattern visibility:** `out` is built via `node([], fn, …)`, so `src`
 * appears as the source dependency in `describe()` traversal but the `status` /
 * `error` companions are mirrored via subscribe-callback effects — they appear
 * under `out.meta.status` / `out.meta.error` (and as `<name>::__meta__::status`
 * paths in `describe()`) rather than as separate top-level edges. Subscribers
 * to `out` see the throttled DATA stream; `status` / `error` companions may not
 * appear as edges in `describe()` if no consumer subscribes to them (per
 * COMPOSITION-GUIDE §1, push-on-subscribe semantics).
 *
 * @example
 * ```ts
 * import { withStatus, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state<number>(0);
 * const { node, status, error } = withStatus(src);
 *
 * status.subscribe((msgs) => console.log("status:", msgs));
 * src.down([[DATA, 42]]); // status → "running"
 * ```
 *
 * @category extra
 */
export function withStatus<T>(
	src: Node<T>,
	options?: { initialStatus?: StatusValue; meta?: Record<string, unknown> },
): WithStatusBundle<T> {
	const initialStatus = options?.initialStatus ?? "pending";
	const callerMeta = options?.meta;

	const out = node<T>(
		[],
		(_deps, a) => {
			let currentStatus: StatusValue = initialStatus;
			out.meta.status.down([[DATA, initialStatus]]);
			out.meta.error.down([[DATA, null]]);

			const unsub = src.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) {
						if (currentStatus === "errored") {
							batch(() => {
								out.meta.error.down([[DATA, null]]);
								out.meta.status.down([[DATA, "running"]]);
							});
						} else {
							out.meta.status.down([[DATA, "running"]]);
						}
						currentStatus = "running";
						a.emit(m[1] as T);
					} else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) {
						out.meta.status.down([[DATA, "completed"]]);
						currentStatus = "completed";
						a.down([[COMPLETE]]);
					} else if (t === ERROR) {
						const err = msgVal(m);
						batch(() => {
							out.meta.error.down([[DATA, err]]);
							out.meta.status.down([[DATA, "errored"]]);
						});
						currentStatus = "errored";
						a.down([m]);
					} else a.down([m]);
				}
			});

			return unsub;
		},
		{
			...operatorOpts(),
			meta: {
				...(callerMeta ?? {}),
				status: initialStatus,
				error: null,
				...factoryTag("withStatus", { initialStatus }),
			},
			completeWhenDepsComplete: false,
			resubscribable: true,
			initial: src.cache,
		},
	);

	return {
		node: out,
		status: out.meta.status as Node<StatusValue>,
		error: out.meta.error as Node<unknown | null>,
	};
}

// ——————————————————————————————————————————————————————————————
//  §3.1c — Caching, fallback & composition sugar
// ——————————————————————————————————————————————————————————————

/**
 * Thrown by {@link timeout} when no `DATA` arrives within the deadline.
 *
 * @category extra
 */
export class TimeoutError extends Error {
	override name = "TimeoutError";
	constructor(ns: number) {
		super(`Timed out after ${ns / NS_PER_MS}ms`);
	}
}

function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node).subscribe === "function"
	);
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

function isAsyncIterable(x: unknown): x is AsyncIterable<unknown> {
	return (
		x != null &&
		typeof x === "object" &&
		typeof (x as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
	);
}

/** Inputs accepted by {@link fallback}. */
export type FallbackInput<T> = T | Node<T> | PromiseLike<T> | AsyncIterable<T>;

/**
 * On upstream terminal `ERROR`, switch to a fallback source instead of propagating the error.
 *
 * Accepts any of:
 * - **scalar value** — emits `[[DATA, fb], [COMPLETE]]`
 * - **`Node<T>`** — subscribes and forwards all messages (push-on-subscribe delivers current cache)
 * - **`Promise<T>` / thenable** — resolves into a one-shot `DATA` then `COMPLETE` (via {@link fromAny})
 * - **`AsyncIterable<T>`** — streams each yielded value as `DATA`, then `COMPLETE` (via {@link fromAny})
 *
 * Non-`Node` inputs are routed through {@link fromAny} so the fallback participates in the
 * reactive protocol uniformly. Bare strings, arrays, and other synchronous scalars are treated
 * as single values (NOT split into characters / elements) to avoid the `fromAny`-on-string
 * iteration gotcha.
 *
 * Composes naturally with {@link retry}:
 * `pipe(source, retry({count:3}), fallback("default"))`.
 *
 * @param source - Upstream node.
 * @param fb - Fallback value, node, promise, or async iterable.
 * @returns Node that replaces errors with the fallback.
 *
 * @example
 * ```ts
 * import { fallback, throwError } from "@graphrefly/graphrefly-ts";
 *
 * const safe = fallback(throwError(new Error("boom")), "default");
 * safe.cache; // "default" after subscribe
 * ```
 *
 * @category extra
 */
export function fallback<T>(
	source: Node<T>,
	fb: FallbackInput<T>,
	options?: { meta?: Record<string, unknown> },
): Node<T> {
	const callerMeta = options?.meta;
	return producer<T>(
		(a) => {
			let fallbackUnsub: (() => void) | undefined;
			let sourceUnsub: (() => void) | undefined;

			function switchToFallback(): void {
				sourceUnsub?.();
				sourceUnsub = undefined;
				if (isNode(fb) || isThenable(fb) || isAsyncIterable(fb)) {
					const fbNode = fromAny(fb as Node<T> | PromiseLike<T> | AsyncIterable<T>);
					fallbackUnsub = fbNode.subscribe((fMsgs) => {
						a.down(fMsgs);
						// qa A14: clear fallbackUnsub on terminal so the teardown
						// closure doesn't double-call it. Idempotency of
						// fromAny's unsub is implementation-defined; explicit
						// self-clear is safer.
						for (const fm of fMsgs) {
							const ft = fm[0];
							if (ft === COMPLETE || ft === ERROR || ft === TEARDOWN) {
								fallbackUnsub = undefined;
								return;
							}
						}
					});
				} else {
					a.emit(fb as T);
					a.down([[COMPLETE]]);
				}
			}

			sourceUnsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) a.emit(m[1] as T);
					else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) a.down([[COMPLETE]]);
					else if (t === ERROR) {
						switchToFallback();
						return;
					} else if (t === TEARDOWN) {
						fallbackUnsub?.();
						a.down([m]);
						return;
					} else a.down([m]);
				}
			});

			return () => {
				sourceUnsub?.();
				fallbackUnsub?.();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: { ...(callerMeta ?? {}), ...factoryTag("fallback") },
		},
	);
}

/**
 * Emits `ERROR` with {@link TimeoutError} if no `DATA` arrives within the deadline.
 *
 * The timer starts on subscription and resets on each `DATA`. `DIRTY` does NOT reset
 * the timer. Terminal messages (`COMPLETE`/`ERROR`) cancel the timer.
 *
 * @param source - Upstream node.
 * @param timeoutNs - Deadline in **nanoseconds** (must be > 0). Internally converted to milliseconds for `setTimeout` scheduling.
 * @returns Node that errors on timeout.
 *
 * @throws {RangeError} when `timeoutNs <= 0`.
 *
 * @remarks
 * **Scheduling:** internally uses {@link ResettableTimer} (raw `setTimeout`) per spec §5.10's resilience-operator carve-out. The deadline is `timeoutNs / NS_PER_MS` ms; sub-millisecond `timeoutNs` values get the same minimum-1ms host-scheduler granularity that `setTimeout` provides.
 *
 * @example
 * ```ts
 * import { timeout, never, NS_PER_SEC } from "@graphrefly/graphrefly-ts";
 *
 * const t = timeout(never(), 5 * NS_PER_SEC);
 * // After 5 seconds with no DATA: [[ERROR, TimeoutError]]
 * ```
 *
 * @category extra
 */
export function timeout<T>(
	source: Node<T>,
	timeoutNs: number,
	options?: { meta?: Record<string, unknown> },
): Node<T> {
	if (timeoutNs <= 0) throw new RangeError("timeoutNs must be > 0");
	const callerMeta = options?.meta;

	return producer<T>(
		(a) => {
			let stopped = false;
			const timer = new ResettableTimer();

			function startTimer(): void {
				const delayMs = timeoutNs / NS_PER_MS;
				// §5.10: setTimeout (not fromTimer) — resettable deadline needs clearTimeout/setTimeout; fromTimer creates a new Node per reset, adding lifecycle overhead on every DATA.
				timer.start(delayMs, () => {
					if (stopped) return;
					stopped = true;
					unsub();
					a.down([[ERROR, new TimeoutError(timeoutNs)]]);
				});
			}

			const unsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (stopped) return;
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) {
						startTimer();
						a.emit(m[1] as T);
					} else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) {
						timer.cancel();
						stopped = true;
						a.down([[COMPLETE]]);
						return;
					} else if (t === ERROR) {
						timer.cancel();
						stopped = true;
						a.down([m]);
						return;
					} else if (t === TEARDOWN) {
						timer.cancel();
						stopped = true;
						a.down([m]);
						return;
					} else a.down([m]);
				}
			});

			startTimer();

			return () => {
				stopped = true;
				timer.cancel();
				unsub();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: { ...(callerMeta ?? {}), ...factoryTag("timeout", { timeoutNs }) },
		},
	);
}
