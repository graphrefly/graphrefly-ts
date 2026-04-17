/**
 * Resilience utilities — roadmap §3.1 + §3.1c (retry, breaker, rate limit, status,
 * fallback, cache, timeout).
 */
import { batch } from "../core/batch.js";
import { monotonicNs } from "../core/clock.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	RESOLVED,
	TEARDOWN,
} from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
import { producer } from "../core/sugar.js";
import {
	type BackoffPreset,
	type BackoffStrategy,
	NS_PER_MS,
	NS_PER_SEC,
	resolveBackoffPreset,
} from "./backoff.js";
import { fromAny } from "./sources.js";
import { ResettableTimer } from "./timer.js";

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
	/** Max retry attempts after each terminal `ERROR` (not counting the first failure). */
	count?: number;
	/** Delay between attempts; strategies use **nanoseconds**. */
	backoff?: BackoffStrategy | BackoffPreset;
};

/**
 * Resubscribes to the upstream node after each terminal `ERROR`, after an optional delay.
 *
 * @param source - Upstream node (should use `resubscribable: true`).
 * @param opts - `count` caps attempts; `backoff` supplies delay in **nanoseconds** (or a preset name).
 * @returns Node that retries on error.
 *
 * @remarks
 * **Resubscribable sources:** The upstream should use `resubscribable: true` if it must emit again after `ERROR`.
 * **Protocol:** Forwards unknown message tuples unchanged; handles `DIRTY`, `DATA`, `RESOLVED`, `COMPLETE`, `ERROR`.
 *
 * @example
 * ```ts
 * import { ERROR, NS_PER_SEC, pipe, producer, retry, constant } from "@graphrefly/graphrefly-ts";
 *
 * const src = producer(
 *   (a) => {
 *     a.down([[ERROR, new Error("x")]]);
 *   },
 *   { resubscribable: true },
 * );
 * const out = retry(src, { count: 2, backoff: constant(0.25 * NS_PER_SEC) });
 * ```
 *
 * @category extra
 */
export function retry<T>(source: Node<T>, opts?: RetryOptions): Node<T> {
	const count = opts?.count;
	const backoffOpt = opts?.backoff;
	const maxRetries = count !== undefined ? count : backoffOpt === undefined ? 0 : 0x7fffffff;
	if (maxRetries < 0) throw new RangeError("retry count must be >= 0");

	const strategy: BackoffStrategy | null =
		backoffOpt === undefined
			? null
			: typeof backoffOpt === "string"
				? resolveBackoffPreset(backoffOpt)
				: backoffOpt;

	return producer<T>(
		(a) => {
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
				if (attempt >= maxRetries) {
					disconnectUpstream();
					a.down([[ERROR, err]]);
					return;
				}
				const raw = strategy === null ? 0 : strategy(attempt, err, prevDelay);
				// null from strategy = "stop retrying" (e.g. withMaxAttempts cap reached)
				if (raw === null || raw === undefined) {
					disconnectUpstream();
					a.down([[ERROR, err]]);
					return;
				}
				// A misbehaving strategy (returns NaN / non-finite) MUST NOT
				// escape into the upstream drain — treat it as "stop retrying"
				// and emit the original error.
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
				unsub = source.subscribe((msgs) => {
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
		},
		{
			...operatorOpts(),
			initial: source.cache,
		},
	);
}

/**
 * Options for {@link retrySource}. Superset of {@link RetryOptions} with an
 * optional `initial` forwarded to the outer node cache.
 *
 * @category extra
 */
export type RetrySourceOptions<T> = RetryOptions & {
	/** Initial cache value for the outer node (forwarded to `NodeOptions.initial`). */
	initial?: T;
};

/**
 * Fresh-instance variant of {@link retry}: invokes the `factory` to build a
 * new `Node<T>` on every connect / reconnect. Unlike {@link retry}, which
 * re-subscribes to the same node (requiring `resubscribable: true`), this
 * creates a new source per attempt — ideal for producers that capture
 * per-attempt resources (sockets, clients, file handles) that become unusable
 * after an error.
 *
 * Synchronous exceptions thrown by `factory` are treated as terminal ERROR
 * and run through the same retry pipeline as inner-node ERROR.
 *
 * @param factory - Called to build a fresh source per attempt.
 * @param opts - `count` caps attempts; `backoff` supplies delay (ns) or preset.
 * @returns Node that retries by rebuilding the source.
 *
 * @example
 * ```ts
 * import { NS_PER_SEC, exponential, retrySource, fromWebSocket } from "@graphrefly/graphrefly-ts";
 *
 * // Each reconnect opens a fresh WebSocket:
 * const connected$ = retrySource(
 *   () => fromWebSocket(new WebSocket("wss://example/stream")),
 *   { count: 10, backoff: exponential({ baseNs: 1 * NS_PER_SEC }) },
 * );
 * ```
 *
 * @category extra
 */
export function retrySource<T>(factory: () => Node<T>, opts?: RetrySourceOptions<T>): Node<T> {
	const count = opts?.count;
	const backoffOpt = opts?.backoff;
	const maxRetries = count !== undefined ? count : backoffOpt === undefined ? 0 : 0x7fffffff;
	if (maxRetries < 0) throw new RangeError("retry count must be >= 0");

	const strategy: BackoffStrategy | null =
		backoffOpt === undefined
			? null
			: typeof backoffOpt === "string"
				? resolveBackoffPreset(backoffOpt)
				: backoffOpt;

	return producer<T>(
		(a) => {
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
				if (attempt >= maxRetries) {
					disconnectUpstream();
					a.down([[ERROR, err]]);
					return;
				}
				const raw = strategy === null ? 0 : strategy(attempt, err, prevDelay);
				if (raw === null || raw === undefined) {
					disconnectUpstream();
					a.down([[ERROR, err]]);
					return;
				}
				// A misbehaving strategy (returns NaN / non-finite / negative)
				// MUST NOT escape into the upstream drain. Treat it like
				// `strategy === null` (stop retrying) and emit the original
				// error — the strategy bug is a separate concern the user
				// can inspect via the emitted error's stack.
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
					src = factory();
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
		},
		{
			...operatorOpts(),
			initial: opts?.initial,
		},
	);
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
	/** Clock function returning nanoseconds (for testability). Default: `monotonicNs`. */
	now?: () => number;
}

export interface CircuitBreaker {
	/** Whether a request should be allowed through. Triggers open→half-open transition when cooldown expires. */
	canExecute(): boolean;
	/** Record a successful execution. Resets to closed. */
	recordSuccess(): void;
	/** Record a failed execution. May transition to open. */
	recordFailure(error?: unknown): void;
	/** Current circuit state (read-only, does not trigger transitions). */
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
	options?: { onOpen?: "skip" | "error" },
): (source: Node<T>) => WithBreakerBundle<T> {
	const onOpen = options?.onOpen ?? "skip";

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
				meta: { breakerState: breaker.state },
				completeWhenDepsComplete: false,
				initial: source.cache,
			},
		);

		return { node: wrapped, breakerState: wrapped.meta.breakerState as Node<CircuitState> };
	};
}

export interface TokenBucket {
	/** Number of tokens currently available (after refill). */
	available(): number;
	/** Try to consume `cost` tokens. Returns `true` if successful. */
	tryConsume(cost?: number): boolean;
}

/**
 * Token-bucket meter (capacity + refill rate per second). Use with {@link rateLimiter} or custom gates.
 *
 * @param capacity - Maximum tokens (must be positive).
 * @param refillPerSecond - Tokens added per elapsed second (non-negative).
 * @returns {@link TokenBucket} instance.
 *
 * @example
 * ```ts
 * import { tokenBucket } from "@graphrefly/graphrefly-ts";
 *
 * const bucket = tokenBucket(10, 2); // capacity 10, refill 2 tokens/sec
 * bucket.tryConsume(3); // true — 7 tokens remaining
 * bucket.available();   // ~7 (plus any elapsed refill)
 * ```
 *
 * @category extra
 */
export function tokenBucket(capacity: number, refillPerSecond: number): TokenBucket {
	if (capacity <= 0) throw new RangeError("capacity must be > 0");
	if (refillPerSecond < 0) throw new RangeError("refillPerSecond must be >= 0");

	let tokens = capacity;
	let updatedAt = monotonicNs();

	function refill(now: number): void {
		if (refillPerSecond > 0) {
			const elapsedNs = now - updatedAt;
			tokens = Math.min(capacity, tokens + (elapsedNs / NS_PER_SEC) * refillPerSecond);
		}
		updatedAt = now;
	}

	return {
		available(): number {
			refill(monotonicNs());
			return tokens;
		},
		tryConsume(cost = 1): boolean {
			if (cost <= 0) return true;
			const now = monotonicNs();
			refill(now);
			if (tokens >= cost) {
				tokens -= cost;
				return true;
			}
			return false;
		},
	};
}

export type RateLimiterOverflowPolicy = "drop-oldest" | "drop-newest" | "error";

export type RateLimiterOptions = {
	/** Maximum `DATA` emissions per window (must be > 0). */
	maxEvents: number;
	/** Window length in nanoseconds (must be > 0). */
	windowNs: number;
	/** Cap on items queued while waiting for token refill (must be >= 1). Unbounded if omitted. */
	maxBuffer?: number;
	/** Overflow policy when `maxBuffer` is exceeded. Default: `"drop-newest"`. */
	onOverflow?: RateLimiterOverflowPolicy;
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
 * Token-bucket rate limiter: at most `maxEvents` `DATA` values per `windowNs`.
 *
 * Uses {@link tokenBucket} internally (capacity = `maxEvents`, refill = `maxEvents / windowSeconds`).
 * Excess items are queued FIFO until a token is available. The queue may be bounded via
 * `maxBuffer` with a configurable overflow policy.
 *
 * @param source - Upstream node.
 * @param opts - Rate + optional bounded-buffer configuration.
 * @returns Node that emits DATA at most `maxEvents` per `windowNs`.
 *
 * @remarks
 * **Terminal:** `COMPLETE` / `ERROR` cancel the refill timer, drop the pending queue, and propagate.
 *
 * @example
 * ```ts
 * import { rateLimiter, state, NS_PER_SEC } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(0);
 * // Allow at most 5 DATA values per second; queue up to 100 excess items, drop newest beyond.
 * const limited = rateLimiter(src, { maxEvents: 5, windowNs: NS_PER_SEC, maxBuffer: 100 });
 * ```
 *
 * @category extra
 */
export function rateLimiter<T>(source: Node<T>, opts: RateLimiterOptions): Node<T> {
	const { maxEvents, windowNs } = opts;
	if (maxEvents <= 0) throw new RangeError("maxEvents must be > 0");
	if (windowNs <= 0) throw new RangeError("windowNs must be > 0");
	const maxBuffer = opts.maxBuffer;
	if (maxBuffer !== undefined && maxBuffer < 1) throw new RangeError("maxBuffer must be >= 1");
	const onOverflow: RateLimiterOverflowPolicy = opts.onOverflow ?? "drop-newest";
	const refillPerSec = (maxEvents * NS_PER_SEC) / windowNs;

	return producer<T>(
		(a) => {
			const bucket = tokenBucket(maxEvents, refillPerSec);
			const pending: T[] = [];
			const timer = new ResettableTimer();
			let terminated = false;

			const tokenTimeNs = NS_PER_SEC / refillPerSec;

			function tryEmit(): void {
				while (pending.length > 0) {
					if (bucket.tryConsume(1)) {
						a.emit(pending.shift() as T);
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

			const unsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (terminated) return;
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) {
						if (maxBuffer !== undefined && pending.length >= maxBuffer) {
							if (onOverflow === "drop-newest") {
								// silently drop the incoming item
							} else if (onOverflow === "drop-oldest") {
								pending.shift();
								pending.push(m[1] as T);
							} else {
								terminated = true;
								timer.cancel();
								pending.length = 0;
								a.down([[ERROR, new RateLimiterOverflowError(maxBuffer)]]);
								return;
							}
						} else {
							pending.push(m[1] as T);
						}
						tryEmit();
					} else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) {
						terminated = true;
						timer.cancel();
						pending.length = 0;
						a.down([[COMPLETE]]);
					} else if (t === ERROR) {
						terminated = true;
						timer.cancel();
						pending.length = 0;
						a.down([m]);
					} else if (t === TEARDOWN) {
						terminated = true;
						timer.cancel();
						pending.length = 0;
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
		},
	);
}

export type StatusValue = "pending" | "active" | "completed" | "errored";

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
 * @returns `{ node, status, error }` where `error` holds the last `ERROR` payload.
 *
 * @remarks
 * **Recovery:** After `errored`, the next `DATA` clears `error` and sets `active` inside {@link batch} (matches graphrefly-py).
 *
 * @example
 * ```ts
 * import { withStatus, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state<number>(0);
 * const { node, status, error } = withStatus(src);
 *
 * status.subscribe((msgs) => console.log("status:", msgs));
 * src.down([[DATA, 42]]); // status → "active"
 * ```
 *
 * @category extra
 */
export function withStatus<T>(
	src: Node<T>,
	options?: { initialStatus?: StatusValue },
): WithStatusBundle<T> {
	const initialStatus = options?.initialStatus ?? "pending";

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
								out.meta.status.down([[DATA, "active"]]);
							});
						} else {
							out.meta.status.down([[DATA, "active"]]);
						}
						currentStatus = "active";
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
			meta: { status: initialStatus, error: null },
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
export function fallback<T>(source: Node<T>, fb: FallbackInput<T>): Node<T> {
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
 * @param timeoutNs - Deadline in nanoseconds.
 * @returns Node that errors on timeout.
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
export function timeout<T>(source: Node<T>, timeoutNs: number): Node<T> {
	if (timeoutNs <= 0) throw new RangeError("timeoutNs must be > 0");

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
		},
	);
}
