/**
 * Circuit breaker — open/half-open/closed state machine + companion bundle.
 *
 * - {@link circuitBreaker} returns a synchronous breaker handle (counters,
 *   state machine, optional reactive-options subscription).
 * - {@link withBreaker} wraps a `Node<T>` and surfaces a reactive
 *   `Node<CircuitState>` companion (`bundle.breakerState`) for telemetry.
 */

import { monotonicNs } from "../../core/clock.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { type BackoffStrategy, NS_PER_SEC } from "./backoff.js";
import {
	clampNonNegative,
	msgVal,
	type NodeOrValue,
	operatorOpts,
	resolveReactiveOption,
} from "./_internal.js";

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
	/**
	 * Release the reactive-options subscription (Tier 6.5 3.2.4, 2026-04-29).
	 * No-op when constructed with static options. Call when retiring a
	 * breaker whose options came from a `Node<CircuitBreakerOptions>` to
	 * avoid leaking the option-Node subscription.
	 */
	dispose(): void;
}

/**
 * Factory for a synchronous circuit breaker with `closed`, `open`, and `half-open` states.
 *
 * Supports escalating cooldown via an optional {@link BackoffStrategy} — each consecutive
 * open→half-open→open cycle increments the backoff attempt.
 *
 * @param options - Threshold, cooldown, half-open limit, and optional clock
 *   override; OR a `Node<CircuitBreakerOptions>` carrying the same shape
 *   reactively (Tier 6.5 3.2.4).
 * @returns {@link CircuitBreaker} instance.
 *
 * @remarks
 * **Timing:** Uses `monotonicNs()` by default (nanoseconds). Override `now` for tests.
 *
 * **Reactive options (locked semantics, Tier 6.5 3.2.4, 2026-04-29).**
 * When `options` is a `Node<CircuitBreakerOptions>`, the breaker
 * subscribes at construction and re-reads `failureThreshold` /
 * `cooldownNs` / `cooldown` / `halfOpenMax` / `now` on each DATA. **An
 * option swap RESETS the breaker to `"closed"`** with all counters
 * cleared — operators tuning a runaway breaker get a clean baseline.
 * If retaining failure history across re-tunings matters, derive a new
 * breaker per-tuning instead. Call `breaker.dispose()` when retiring to
 * release the option-Node subscription.
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
export function circuitBreaker(options?: NodeOrValue<CircuitBreakerOptions>): CircuitBreaker {
	let threshold = 5;
	let baseCooldownNs = 30 * NS_PER_SEC;
	let cooldownStrategy: BackoffStrategy | null = null;
	let halfOpenMax = 1;
	let now: () => number = monotonicNs;

	function applyOptions(o: CircuitBreakerOptions | undefined): void {
		threshold = Math.max(1, o?.failureThreshold ?? 5);
		baseCooldownNs = clampNonNegative(o?.cooldownNs ?? 30 * NS_PER_SEC);
		cooldownStrategy = o?.cooldown ?? null;
		halfOpenMax = Math.max(1, o?.halfOpenMax ?? 1);
		now = o?.now ?? monotonicNs;
	}

	let _state: CircuitState = "closed";
	let _failureCount = 0;
	let _openCycle = 0;
	let _lastOpenedAt = 0;
	let _lastCooldownNs = baseCooldownNs;
	let _halfOpenAttempts = 0;

	// Initial application + reactive subscription. On every DATA from a
	// reactive option Node, reset the breaker to "closed" so re-tuning
	// produces a clean baseline (locked semantic).
	const optMirror = resolveReactiveOption<CircuitBreakerOptions>(
		options as NodeOrValue<CircuitBreakerOptions>,
		(next) => {
			applyOptions(next);
			_state = "closed";
			_failureCount = 0;
			_openCycle = 0;
			_halfOpenAttempts = 0;
			_lastCooldownNs = baseCooldownNs;
		},
	);
	applyOptions(optMirror.current());
	_lastCooldownNs = baseCooldownNs;

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

		dispose(): void {
			optMirror.unsub();
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
