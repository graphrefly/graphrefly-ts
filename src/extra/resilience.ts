/**
 * Resilience utilities — roadmap §3.1 (retry, breaker, rate limit, status companions).
 */
import { batch } from "../core/batch.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Message, RESOLVED } from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
import { type PipeOperator, producer } from "../core/sugar.js";
import { type BackoffPreset, type BackoffStrategy, resolveBackoffPreset } from "./backoff.js";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function operatorOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "operator", ...opts };
}

function msgVal(m: Message): unknown {
	return m[1];
}

function coerceDelaySeconds(raw: number | null): number {
	if (raw === null) return 0;
	if (typeof raw !== "number" || !Number.isFinite(raw)) {
		throw new TypeError("backoff strategy must return a finite number or null");
	}
	return raw < 0 ? 0 : raw;
}

export type RetryOptions = {
	/** Max retry attempts after each terminal `ERROR` (not counting the first failure). */
	count?: number;
	/** Delay between attempts; strategies use **seconds** (converted internally). */
	backoff?: BackoffStrategy | BackoffPreset;
};

/**
 * Returns a {@link PipeOperator} that resubscribes to the upstream node after each terminal `ERROR`, after an optional delay.
 *
 * @param opts - `count` caps attempts; `backoff` supplies delay in **seconds** (or a preset name).
 * @returns Unary operator suitable for {@link pipe}.
 *
 * @remarks
 * **Resubscribable sources:** The upstream should use `resubscribable: true` if it must emit again after `ERROR`.
 * **Protocol:** Forwards unknown message tuples unchanged; handles `DIRTY`, `DATA`, `RESOLVED`, `COMPLETE`, `ERROR`.
 *
 * @example
 * ```ts
 * import { ERROR, pipe, producer, retry, constant } from "@graphrefly/graphrefly-ts";
 *
 * const src = producer(
 *   (_d, a) => {
 *     a.down([[ERROR, new Error("x")]]);
 *   },
 *   { resubscribable: true },
 * );
 * pipe(src, retry({ count: 2, backoff: constant(0.05) }));
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
					const delaySec = coerceDelaySeconds(raw === undefined ? null : raw);
					prevDelay = delaySec;
					attempt += 1;
					timerGen += 1;
					const gen = timerGen;
					disconnectUpstream();
					const delayMs = delaySec > 0 ? delaySec * 1000 : 1;

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

/**
 * Small synchronous circuit breaker with `closed`, `open`, and `half-open` states (aligned with roadmap §3.1).
 *
 * @remarks
 * **Timing:** Uses `performance.now()` for cooldown (milliseconds). Not thread-safe across workers; JS runtimes are single-threaded.
 *
 * @category extra
 */
export class CircuitBreaker {
	readonly #failureThreshold: number;
	readonly #cooldownMs: number;
	readonly #halfOpenMax: number;
	#state: CircuitState = "closed";
	#failures = 0;
	#openedAt = 0;
	#trials = 0;

	constructor(options?: {
		failureThreshold?: number;
		cooldownSeconds?: number;
		halfOpenMax?: number;
	}) {
		this.#failureThreshold = Math.max(1, options?.failureThreshold ?? 5);
		this.#cooldownMs = Math.max(0, (options?.cooldownSeconds ?? 30) * 1000);
		this.#halfOpenMax = Math.max(1, options?.halfOpenMax ?? 1);
	}

	get state(): CircuitState {
		return this.#state;
	}

	canExecute(): boolean {
		if (this.#state === "closed") return true;
		if (this.#state === "open") {
			if (performance.now() - this.#openedAt >= this.#cooldownMs) {
				this.#state = "half-open";
				this.#trials = 1;
				return true;
			}
			return false;
		}
		if (this.#trials < this.#halfOpenMax) {
			this.#trials += 1;
			return true;
		}
		return false;
	}

	recordSuccess(): void {
		this.#state = "closed";
		this.#failures = 0;
		this.#trials = 0;
	}

	recordFailure(_error?: unknown): void {
		if (this.#state === "half-open") {
			this.#state = "open";
			this.#openedAt = performance.now();
			this.#trials = 0;
			return;
		}
		this.#failures += 1;
		if (this.#failures >= this.#failureThreshold) {
			this.#state = "open";
			this.#openedAt = performance.now();
			this.#trials = 0;
		}
	}
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
 * import { state, withBreaker, CircuitBreaker } from "@graphrefly/graphrefly-ts";
 *
 * const b = new CircuitBreaker({ failureThreshold: 2 });
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

/**
 * Token-bucket meter (capacity + refill rate per second). Use with {@link rateLimiter} or custom gates.
 *
 * @category extra
 */
export class TokenBucket {
	readonly #capacity: number;
	readonly #refillPerSec: number;
	#tokens: number;
	#updatedAt: number;
	constructor(capacity: number, refillPerSecond: number) {
		if (capacity <= 0) throw new RangeError("capacity must be > 0");
		if (refillPerSecond < 0) throw new RangeError("refillPerSecond must be >= 0");
		this.#capacity = capacity;
		this.#refillPerSec = refillPerSecond;
		this.#tokens = capacity;
		this.#updatedAt = performance.now();
	}

	#refillLocked(now: number): void {
		if (this.#refillPerSec > 0) {
			const elapsed = (now - this.#updatedAt) / 1000;
			this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerSec);
		}
		this.#updatedAt = now;
	}

	available(): number {
		const now = performance.now();
		this.#refillLocked(now);
		return this.#tokens;
	}

	tryConsume(cost = 1): boolean {
		if (cost <= 0) return true;
		const now = performance.now();
		this.#refillLocked(now);
		if (this.#tokens >= cost) {
			this.#tokens -= cost;
			return true;
		}
		return false;
	}
}

/**
 * Alias for `new TokenBucket(capacity, refillPerSecond)` (parity with graphrefly-py `token_tracker`).
 *
 * @param capacity - Maximum tokens (must be positive).
 * @param refillPerSecond - Tokens added per elapsed second (non-negative).
 * @returns A new {@link TokenBucket}.
 *
 * @category extra
 */
export function tokenTracker(capacity: number, refillPerSecond: number): TokenBucket {
	return new TokenBucket(capacity, refillPerSecond);
}

/**
 * Returns a {@link PipeOperator} that enforces a sliding window: at most `maxEvents` `DATA` values per `windowSeconds`.
 *
 * @param maxEvents - Maximum `DATA` emissions per window (must be positive).
 * @param windowSeconds - Window length in seconds (must be positive).
 * @returns Unary operator; excess values queue FIFO until a slot frees.
 *
 * @remarks
 * **Terminal:** `COMPLETE` / `ERROR` cancel timers, drop pending queue, and clear window state.
 *
 * @category extra
 */
export function rateLimiter(maxEvents: number, windowSeconds: number): PipeOperator {
	if (maxEvents <= 0) throw new RangeError("maxEvents must be > 0");
	if (windowSeconds <= 0) throw new RangeError("windowSeconds must be > 0");
	const windowMs = windowSeconds * 1000;

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
