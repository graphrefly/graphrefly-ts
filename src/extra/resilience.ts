/**
 * Resilience utilities — roadmap §3.1 (retry, breaker, rate limit, status companions).
 */
import { batch } from "../core/batch.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Message, RESOLVED } from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
import { type PipeOperator, producer } from "../core/sugar.js";
import {
	type BackoffPreset,
	type BackoffStrategy,
	NS_PER_MS,
	NS_PER_SEC,
	resolveBackoffPreset,
} from "./backoff.js";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function operatorOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "operator", ...opts };
}

function clampNonNegative(value: number): number {
	return value < 0 ? 0 : value;
}

function msgVal(m: Message): unknown {
	return m[1];
}

function coerceDelayNs(raw: number | null): number {
	if (raw === null) return 0;
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		throw new TypeError("backoff strategy must return a finite number or null");
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
 * Returns a {@link PipeOperator} that resubscribes to the upstream node after each terminal `ERROR`, after an optional delay.
 *
 * @param opts - `count` caps attempts; `backoff` supplies delay in **nanoseconds** (or a preset name).
 * @returns Unary operator suitable for {@link pipe}.
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
 *   (_d, a) => {
 *     a.down([[ERROR, new Error("x")]]);
 *   },
 *   { resubscribable: true },
 * );
 * pipe(src, retry({ count: 2, backoff: constant(0.25 * NS_PER_SEC) }));
 * ```
 *
 * @category extra
 */
export function retry(opts?: RetryOptions): PipeOperator {
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

	return function retryOperator<T>(source: Node<T>): Node<T> {
		return producer<T>(
			(_d, a) => {
				let attempt = 0;
				let stopped = false;
				let prevDelay: number | null = null;
				let unsub: (() => void) | undefined;
				let timer: ReturnType<typeof setTimeout> | undefined;
				let timerGen = 0;

				function cancelTimer(): void {
					if (timer !== undefined) {
						clearTimeout(timer);
						timer = undefined;
					}
				}

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
					const delayNs = coerceDelayNs(raw === undefined ? null : raw);
					prevDelay = delayNs;
					attempt += 1;
					timerGen += 1;
					const gen = timerGen;
					disconnectUpstream();
					const delayMs = delayNs > 0 ? delayNs / NS_PER_MS : 1;

					timer = setTimeout(() => {
						timer = undefined;
						if (stopped || gen !== timerGen) return;
						connect();
					}, delayMs);
				}

				function connect(): void {
					cancelTimer();
					disconnectUpstream();
					unsub = source.subscribe((msgs) => {
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
					timerGen += 1;
					cancelTimer();
					disconnectUpstream();
				};
			},
			{
				...operatorOpts(),
				initial: source.get(),
			},
		);
	};
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
	/** Clock function returning milliseconds (for testability). Default: `performance.now`. */
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
 * **Timing:** Uses `performance.now()` by default (milliseconds). Override `now` for tests.
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
	const now = options?.now ?? performance.now.bind(performance);

	let _state: CircuitState = "closed";
	let _failureCount = 0;
	let _openCycle = 0;
	let _lastOpenedAt = 0;
	let _lastCooldownMs = baseCooldownNs / NS_PER_MS;
	let _halfOpenAttempts = 0;

	function getCooldownMs(): number {
		if (!cooldownStrategy) return baseCooldownNs / NS_PER_MS;
		const delayNs = cooldownStrategy(_openCycle);
		return delayNs !== null ? delayNs / NS_PER_MS : baseCooldownNs / NS_PER_MS;
	}

	function transitionToOpen(): void {
		_state = "open";
		_lastCooldownMs = getCooldownMs();
		_lastOpenedAt = now();
		_halfOpenAttempts = 0;
	}

	const breaker: CircuitBreaker = {
		canExecute(): boolean {
			if (_state === "closed") return true;

			if (_state === "open") {
				const elapsed = now() - _lastOpenedAt;
				if (elapsed >= _lastCooldownMs) {
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
				initial: source.get(),
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
 * @category extra
 */
export function tokenBucket(capacity: number, refillPerSecond: number): TokenBucket {
	if (capacity <= 0) throw new RangeError("capacity must be > 0");
	if (refillPerSecond < 0) throw new RangeError("refillPerSecond must be >= 0");

	let tokens = capacity;
	let updatedAt = performance.now();

	function refill(now: number): void {
		if (refillPerSecond > 0) {
			const elapsed = (now - updatedAt) / 1000;
			tokens = Math.min(capacity, tokens + elapsed * refillPerSecond);
		}
		updatedAt = now;
	}

	return {
		available(): number {
			refill(performance.now());
			return tokens;
		},
		tryConsume(cost = 1): boolean {
			if (cost <= 0) return true;
			const now = performance.now();
			refill(now);
			if (tokens >= cost) {
				tokens -= cost;
				return true;
			}
			return false;
		},
	};
}

/**
 * Returns a {@link PipeOperator} that enforces a sliding window: at most `maxEvents` `DATA` values per `windowNs`.
 *
 * @param maxEvents - Maximum `DATA` emissions per window (must be positive).
 * @param windowNs - Window length in nanoseconds (must be positive).
 * @returns Unary operator; excess values queue FIFO until a slot frees.
 *
 * @remarks
 * **Terminal:** `COMPLETE` / `ERROR` cancel timers, drop pending queue, and clear window state.
 *
 * @category extra
 */
export function rateLimiter(maxEvents: number, windowNs: number): PipeOperator {
	if (maxEvents <= 0) throw new RangeError("maxEvents must be > 0");
	if (windowNs <= 0) throw new RangeError("windowNs must be > 0");
	const windowMs = windowNs / NS_PER_MS;

	return function rateLimitOperator<T>(source: Node<T>): Node<T> {
		return producer<T>(
			(_d, a) => {
				const times: number[] = [];
				const pending: T[] = [];
				let timer: ReturnType<typeof setTimeout> | undefined;
				let timerGen = 0;

				function cancelTimer(): void {
					if (timer !== undefined) {
						clearTimeout(timer);
						timer = undefined;
					}
				}

				function prune(now: number): void {
					const boundary = now - windowMs;
					while (times.length > 0 && times[0] <= boundary) times.shift();
				}

				function tryEmit(): void {
					while (pending.length > 0) {
						const now = performance.now();
						prune(now);
						if (times.length < maxEvents) {
							times.push(now);
							a.emit(pending.shift() as T);
						} else {
							const oldest = times[0];
							cancelTimer();
							timerGen += 1;
							const gen = timerGen;
							const delay = Math.max(0, oldest + windowMs - performance.now());
							timer = setTimeout(() => {
								timer = undefined;
								if (gen !== timerGen) return;
								tryEmit();
							}, delay);
							return;
						}
					}
				}

				const unsub = source.subscribe((msgs) => {
					for (const m of msgs) {
						const t = m[0];
						if (t === DIRTY) a.down([[DIRTY]]);
						else if (t === DATA) {
							pending.push(m[1] as T);
							tryEmit();
						} else if (t === RESOLVED) a.down([[RESOLVED]]);
						else if (t === COMPLETE) {
							timerGen += 1;
							cancelTimer();
							pending.length = 0;
							times.length = 0;
							a.down([[COMPLETE]]);
						} else if (t === ERROR) {
							timerGen += 1;
							cancelTimer();
							pending.length = 0;
							times.length = 0;
							a.down([m]);
						} else a.down([m]);
					}
				});

				return () => {
					timerGen += 1;
					cancelTimer();
					unsub();
				};
			},
			{
				...operatorOpts(),
				initial: source.get(),
			},
		);
	};
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
			out.meta.status.down([[DATA, initialStatus]]);
			out.meta.error.down([[DATA, null]]);

			const unsub = src.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					if (t === DIRTY) a.down([[DIRTY]]);
					else if (t === DATA) {
						if (out.meta.status.get() === "errored") {
							batch(() => {
								out.meta.error.down([[DATA, null]]);
								out.meta.status.down([[DATA, "active"]]);
							});
						} else {
							out.meta.status.down([[DATA, "active"]]);
						}
						a.emit(m[1] as T);
					} else if (t === RESOLVED) a.down([[RESOLVED]]);
					else if (t === COMPLETE) {
						out.meta.status.down([[DATA, "completed"]]);
						a.down([[COMPLETE]]);
					} else if (t === ERROR) {
						const err = msgVal(m);
						batch(() => {
							out.meta.error.down([[DATA, err]]);
							out.meta.status.down([[DATA, "errored"]]);
						});
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
			initial: src.get(),
		},
	);

	return {
		node: out,
		status: out.meta.status as Node<StatusValue>,
		error: out.meta.error as Node<unknown | null>,
	};
}
