/**
 * Rate limiters — `tokenBucket` (raw meter), `rateLimiter` (operator with
 * bounded queue + reactive backpressure companions), and the re-export of
 * `adaptiveRateLimiter` from its standalone module.
 */

import { monotonicNs } from "@graphrefly/pure-ts/core/clock.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	RESOLVED,
	TEARDOWN,
} from "@graphrefly/pure-ts/core/messages.js";
import { factoryTag } from "@graphrefly/pure-ts/core/meta.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { ResettableTimer } from "../timer.js";
import { RingBuffer } from "../utils/ring-buffer.js";
import { isNode, type NodeOrValue, operatorOpts, resolveReactiveOption } from "./_internal.js";
import { NS_PER_MS, NS_PER_SEC } from "./backoff.js";
import type { GateState } from "./gate-state.js";

// `adaptiveRateLimiter` lives in extra/adaptive-rate-limiter.ts (kept independent
// because it has its own internal control-loop machinery).
export * from "../adaptive-rate-limiter.js";

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
/**
 * Lifecycle-shaped state companion emitted by {@link rateLimiter}.
 *
 * **DS-13.5.B widening (2026-05-01).** `status` extends {@link GateState}
 * with `"throttled"` (= `paused === true`). Pre-1.0 break vs the prior
 * shape (which omitted `status`).
 *
 * - `"open"` — passing through (no buffering, no recent overflow drops).
 * - `"throttled"` — at least one item queued awaiting a token refill.
 * - `"closed"` — reserved for future terminal lifecycle reporting.
 */
export type RateLimiterState = {
	/** DS-13.5.B status field — `"open" | "closed" | "throttled"`. */
	status: GateState | "throttled";
	/** Cumulative `DATA` items dropped due to overflow since this subscription cycle started. */
	droppedCount: number;
	/** Items currently buffered awaiting a token refill. `0` when the limiter is passing through. */
	pendingCount: number;
	/** `true` when at least one item is queued (the limiter is actively throttling). */
	paused: boolean;
};

function rateLimiterStateEqual(a: RateLimiterState, b: RateLimiterState): boolean {
	return (
		a.status === b.status &&
		a.droppedCount === b.droppedCount &&
		a.pendingCount === b.pendingCount &&
		a.paused === b.paused
	);
}

const RATE_LIMITER_INITIAL_STATE: RateLimiterState = Object.freeze({
	status: "open" as const,
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
export function rateLimiter<T>(
	source: Node<T>,
	opts: NodeOrValue<RateLimiterOptions>,
): RateLimiterBundle<T> {
	// Eager validation of static-form opts. Reactive-form opts re-validate
	// on each emit via `applyOpts` (invalid runtime config keeps the previous
	// values rather than throwing — the producer body's swap path never
	// throws into the dataplane).
	const isReactive = isNode(opts);
	if (!isReactive) {
		const o = opts as RateLimiterOptions;
		if (o.maxEvents <= 0) throw new RangeError("maxEvents must be > 0");
		if (o.windowNs <= 0) throw new RangeError("windowNs must be > 0");
		if (o.maxBuffer === undefined) {
			throw new RangeError(
				"rateLimiter requires explicit maxBuffer (use Infinity to opt in to unbounded)",
			);
		}
		const isUnbounded0 = o.maxBuffer === Infinity;
		if (!isUnbounded0 && (!Number.isInteger(o.maxBuffer) || o.maxBuffer < 1)) {
			throw new RangeError("maxBuffer must be a positive integer (or Infinity for unbounded)");
		}
	}
	// Mode (bounded vs unbounded) is locked at construction time per the
	// Tier 6.5 3.2.3 swap rule — runtime opt swaps change the cap WITHIN
	// the same mode. Toggling between bounded/unbounded requires re-mounting
	// the rateLimiter; the queue type is structural, not a tunable. For
	// reactive opts we read the FIRST value (cached or undefined) to lock
	// the mode; if the cache is undefined at construction we conservatively
	// default to bounded with a placeholder cap, and the first emit re-locks.
	const initialOpts: RateLimiterOptions | undefined = isReactive
		? ((opts as Node<RateLimiterOptions>).cache as RateLimiterOptions | undefined)
		: (opts as RateLimiterOptions);
	const initialMaxBuffer = initialOpts?.maxBuffer;
	const isUnbounded = initialMaxBuffer === Infinity;

	const out = node<T>(
		(_data, a) => {
			// Mutable closure-state — replaced on each option swap.
			let maxEvents = initialOpts?.maxEvents ?? 1;
			let windowNs = initialOpts?.windowNs ?? NS_PER_SEC;
			let maxBuffer = initialMaxBuffer ?? 1;
			let onOverflow: RateLimiterOverflowPolicy = initialOpts?.onOverflow ?? "drop-newest";
			let refillPerSec = (maxEvents * NS_PER_SEC) / windowNs;
			let tokenTimeNs = NS_PER_SEC / refillPerSec;
			let bucket = tokenBucket(maxEvents, refillPerSec);

			// RingBuffer for O(1) push + shift. Unbounded mode falls back to a plain
			// array (RingBuffer requires a positive integer capacity); the caller
			// explicitly opted in via `maxBuffer: Infinity` and accepts the cost.
			// Bounded mode allocates with the INITIAL `maxBuffer`; runtime cap
			// reductions enforce drop-oldest at push time without resizing the ring.
			const pending: { push: (v: T) => void; shift: () => T | undefined; size: number } =
				isUnbounded ? makeArrayQueue<T>() : ringBufferQueue<T>(Math.max(1, maxBuffer));
			const timer = new ResettableTimer();
			let terminated = false;
			let dropped = 0;

			// Mirror the dropped counter + combined state to the meta companions.
			// The `emit` call is the same subscribe-callback effect-mirror
			// pattern used by `withBreaker.breakerState` / `withStatus.status`
			// (sanctioned per audit § F.7).
			const droppedNode = out.meta.droppedCount;
			const stateNode = out.meta.rateLimitState;
			let lastState: RateLimiterState = RATE_LIMITER_INITIAL_STATE;
			function syncState(): void {
				droppedNode.emit(dropped);
				const isPaused = pending.size > 0;
				const next: RateLimiterState = {
					status: isPaused ? "throttled" : "open",
					droppedCount: dropped,
					pendingCount: pending.size,
					paused: isPaused,
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

			// Tier 6.5 3.2.3 (2026-04-29): reactive option swap handler.
			// Locked semantics: `maxEvents`/`windowNs` swap rebuilds the
			// token bucket at the next refill window (tokens reset to new
			// capacity, refill rate updates immediately). `maxBuffer` shrink
			// drops oldest pending entries until size ≤ new cap. `onOverflow`
			// swap takes effect at the next overflow check. Mode toggling
			// (bounded ↔ unbounded) is NOT supported — locked at construction.
			const optMirror = resolveReactiveOption<RateLimiterOptions>(
				opts as NodeOrValue<RateLimiterOptions>,
				(next) => {
					if (terminated) return;
					if (next == null) return;
					// QA A9 (2026-05-03): explicit empty `{}` short-circuit
					// for symmetry with timeout / retry / circuitBreaker
					// (DS-13.5.B locked rule: empty `{}` is a no-op — no
					// rebind, no companion fire). Pre-fix, empty `{}` was
					// implicitly a no-op via the validation gate's
					// `next.maxEvents > 0` check on `undefined`; this
					// makes the rule explicit and resilient to future
					// validation refactors.
					if (typeof next === "object" && Object.keys(next).length === 0) return;
					// Validate; if invalid, keep previous values (no throw into dataplane).
					if (!(next.maxEvents > 0) || !(next.windowNs > 0)) return;
					const nextBuf = next.maxBuffer;
					if (nextBuf === undefined) return;
					const nextUnbounded = nextBuf === Infinity;
					if (nextUnbounded !== isUnbounded) {
						// Mode toggle not supported — skip silently. Caller using
						// reactive opts must keep maxBuffer in the same mode.
						return;
					}
					if (!nextUnbounded && (!Number.isInteger(nextBuf) || nextBuf < 1)) return;

					// qa F-C (Tier 5 /qa pass, 2026-04-29): reactive `maxBuffer`
					// is monotonically non-increasing. The pending RingBuffer is
					// allocated once at construction; growing the cap reactively
					// would let the overflow check pass more pushes than the
					// ring's capacity → silent drop-oldest at the substrate level
					// (RingBuffer.push wraps), bypassing our `dropped` counter
					// and `onOverflow: "error"` arm. Reject grow swaps with a
					// console.warn and keep the previous cap. Shrink stays
					// supported (drop-oldest below).
					if (!nextUnbounded && nextBuf > maxBuffer) {
						console.warn(
							`rateLimiter: reactive maxBuffer grow (${maxBuffer} → ${nextBuf}) ` +
								"rejected. The pending ring buffer is allocated at construction; " +
								"reactive maxBuffer is monotonically non-increasing. Recreate " +
								"the rateLimiter with the larger cap if growth is required.",
						);
						return;
					}

					maxEvents = next.maxEvents;
					windowNs = next.windowNs;
					maxBuffer = nextBuf;
					onOverflow = next.onOverflow ?? "drop-newest";
					refillPerSec = (maxEvents * NS_PER_SEC) / windowNs;
					tokenTimeNs = NS_PER_SEC / refillPerSec;
					// Rebuild bucket — tokens snap to new capacity. The old refill
					// timer continues to fire `tryEmit` which will use the new
					// bucket (same closure variable).
					bucket = tokenBucket(maxEvents, refillPerSec);

					// Drop-oldest until pending.size <= maxBuffer (bounded only).
					if (!nextUnbounded) {
						while (pending.size > maxBuffer) {
							pending.shift();
							dropped += 1;
						}
					}
					syncState();
				},
			);

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
				optMirror.unsub();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: {
				// Caller-supplied meta first; companion seeds + factoryTag
				// override below so they always win.
				...(isReactive ? {} : ((opts as RateLimiterOptions).meta ?? {})),
				droppedCount: 0,
				rateLimitState: RATE_LIMITER_INITIAL_STATE,
				...factoryTag("rateLimiter", isReactive ? { reactiveOpts: true } : opts),
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
