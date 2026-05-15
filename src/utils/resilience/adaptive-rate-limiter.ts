/**
 * Adaptive rate limiter — reactive, live-tunable, 429-aware.
 *
 * Wraps two `tokenBucket` instances (requests, tokens) with:
 *   - Reactive `rpm` / `tpm` knobs that can be re-tuned at runtime via `NodeInput<number>`.
 *   - An adaptation signal input (`Node<RateLimitSignal>`) that feeds back
 *     provider 429 / retry-after / x-ratelimit-* headers to tighten limits.
 *   - A `clampCooldownMs` TTL on signal-induced caps so a transient 429 doesn't
 *     permanently throttle — caps decay back to user-configured values after
 *     the cooldown elapses.
 *   - TPM-miss recovery: consumed RPM tokens are returned to the request
 *     bucket when the TPM admit fails, via `TokenBucket.putBack`.
 *   - Imperative `acquire()` for bridging to Promise-based call paths
 *     (used by the `withRateLimiter` adapter middleware).
 *
 * **Timer policy:** sleeps use `ResettableTimer` (documented spec §5.10
 * escape hatch in `src/extra/timer.ts`) rather than `fromTimer` to avoid
 * allocating a new Node per acquire cycle.
 *
 * Design lives in `docs/optimizations.md` § "Reactive adaptive rate limiter".
 */

import { DATA, monotonicNs, type Node, node, ResettableTimer } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import { NS_PER_SEC } from "./backoff.js";
import { type TokenBucket, tokenBucket } from "./rate-limiter.js";

// ---------------------------------------------------------------------------
// Signal shape
// ---------------------------------------------------------------------------

/**
 * Rate-limit signal emitted by an adaptation source (e.g., an HTTP 429 parser).
 *
 * Any subset of fields may be present. The adaptive rate limiter uses:
 * - `retryAfterMs` — blocks acquire() for this duration.
 * - `rpmCap` / `tpmCap` — tightens effective rpm/tpm to this value (decays
 *   back to the user-configured cap after `clampCooldownMs`).
 * - `usageHint` — updates the last-known rpm/tpm usage ratio for logging.
 */
export interface RateLimitSignal {
	/** Throttle duration — pause acquire() for this long. */
	retryAfterMs?: number;
	/** Hard cap for requests-per-minute; effective rpm = min(current, rpmCap) while clamp is active. */
	rpmCap?: number;
	/** Hard cap for tokens-per-minute; effective tpm = min(current, tpmCap) while clamp is active. */
	tpmCap?: number;
	/** Observed usage-percentage hint (0..1) — for observability, not gating. */
	usageHint?: { rpm?: number; tpm?: number };
	/** Free-form provider-specific payload. */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AdaptiveRateLimiterOptions {
	name?: string;
	/** Effective requests-per-minute cap. Reactive — reads push-on-subscribe. */
	rpm?: NodeInput<number>;
	/** Effective tokens-per-minute cap. Reactive. */
	tpm?: NodeInput<number>;
	/** Source of adaptation signals (429 parser output, etc.). */
	adaptation?: NodeInput<RateLimitSignal>;
	/**
	 * How long (ms) a signal-induced `rpmCap` / `tpmCap` stays in effect before
	 * relaxing back to the user-configured value. Default 60_000 (one minute).
	 * Set to `Infinity` to make signal caps sticky until manually cleared.
	 * A fresh signal with the same cap resets the cooldown.
	 */
	clampCooldownMs?: number;
	/** Burst capacity overshoot above the steady-state rpm/tpm. Default 1 (no burst). */
	burstMultiplier?: number;
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

export interface AdaptiveRateLimiterBundle {
	/** Effective requests-per-minute (post-signal-clamp). Reactive. */
	readonly effectiveRpm: Node<number>;
	/** Effective tokens-per-minute (post-signal-clamp). Reactive. */
	readonly effectiveTpm: Node<number>;
	/** Last adaptation signal observed. */
	readonly lastSignal: Node<RateLimitSignal>;
	/** Pending `acquire()` callers waiting for capacity. */
	readonly pending: Node<number>;
	/** Current request-token-bucket fill (approximate). */
	readonly rpmAvailable: Node<number>;
	/** Current token-bucket fill (approximate). */
	readonly tpmAvailable: Node<number>;
	/**
	 * Imperative bridge: wait until `requestCost` request-tokens and
	 * `tokenCost` tokens are available, then consume them. Honors the
	 * most recent `retryAfterMs` from adaptation signals. Rejects with
	 * an `AbortError`-named error if `signal` aborts while waiting.
	 * `requestCost` defaults to 1; `tokenCost` defaults to 0 (rpm-only gating).
	 */
	acquire(opts?: { requestCost?: number; tokenCost?: number; signal?: AbortSignal }): Promise<void>;
	/**
	 * Feed back observed token usage (post-call) so the TPM bucket reflects
	 * real consumption rather than the pre-call estimate. A positive `delta`
	 * debits additional TPM (undershot estimate); a negative `delta` credits
	 * back overshoot (`putBack`).
	 */
	recordUsage(delta: number): void;
	/** Manually feed an adaptation signal — useful for tests. */
	recordSignal(sig: RateLimitSignal): void;
	/** Dispose internal subscriptions and pending timers. */
	dispose(): void;
}

// ---------------------------------------------------------------------------
// Error construction
// ---------------------------------------------------------------------------

function makeAbortError(reason: string): Error {
	const err = new Error(reason) as Error & { name: string };
	err.name = "AbortError";
	return err;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create an adaptive rate limiter. Compose with any call source via
 * `await limiter.acquire({ requestCost, tokenCost, signal })`.
 */
export function adaptiveRateLimiter(
	opts: AdaptiveRateLimiterOptions = {},
): AdaptiveRateLimiterBundle {
	const burst = Math.max(1, opts.burstMultiplier ?? 1);
	const clampCooldownMs = opts.clampCooldownMs ?? 60_000;

	// Resolve reactive rpm/tpm inputs. Callers may pass `NodeInput` which
	// could be a literal number or a Node. `fromAny` normalizes to a Node.
	const rpmInputNode =
		opts.rpm != null
			? fromAny(opts.rpm as NodeInput<number>)
			: node<number>([], { initial: Number.POSITIVE_INFINITY });
	const tpmInputNode =
		opts.tpm != null
			? fromAny(opts.tpm as NodeInput<number>)
			: node<number>([], { initial: Number.POSITIVE_INFINITY });

	// Signal cap state — updated by recordSignal() / adaptation source.
	// The decay timer relaxes the cap back to Infinity after `clampCooldownMs`.
	const signalRpmCap = node<number>([], {
		initial: Number.POSITIVE_INFINITY,
		name: "adaptiveRateLimiter/signalRpmCap",
	});
	const signalTpmCap = node<number>([], {
		initial: Number.POSITIVE_INFINITY,
		name: "adaptiveRateLimiter/signalTpmCap",
	});
	const lastSignal = node<RateLimitSignal>([], {
		initial: {},
		name: "adaptiveRateLimiter/lastSignal",
	});

	// Compute effective rpm/tpm: min of user-configured cap and signal cap.
	const effectiveRpm = node<number>(
		[rpmInputNode, signalRpmCap],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(Math.min(Number(data[0] ?? Infinity), Number(data[1] ?? Infinity)));
		},
		{ name: "adaptiveRateLimiter/effectiveRpm", describeKind: "derived" },
	);
	const effectiveTpm = node<number>(
		[tpmInputNode, signalTpmCap],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit(Math.min(Number(data[0] ?? Infinity), Number(data[1] ?? Infinity)));
		},
		{ name: "adaptiveRateLimiter/effectiveTpm", describeKind: "derived" },
	);

	// Token buckets — rebuilt when effective caps change.
	let rpmBucket: TokenBucket = makeBucket(
		Number(rpmInputNode.cache ?? Number.POSITIVE_INFINITY),
		burst,
	);
	let tpmBucket: TokenBucket = makeBucket(
		Number(tpmInputNode.cache ?? Number.POSITIVE_INFINITY),
		burst,
	);

	// A signal `rpmCap`/`tpmCap` of 0 means "halt admission entirely" (e.g.,
	// some providers emit this during hard quota exhaustion). We honor it by
	// marking the bucket as closed via a long throttle-until; the bucket itself
	// stays at its previous capacity so decay can relax it naturally.
	let rpmHardStop = false;
	let tpmHardStop = false;

	const unsubRpm = effectiveRpm.subscribe((msgs) => {
		for (const msg of msgs) {
			if (msg[0] === DATA) {
				const v = Number(msg[1]);
				if (Number.isFinite(v) && v > 0) {
					rpmBucket = makeBucket(v, burst);
					rpmHardStop = false;
				} else if (v === Infinity) {
					rpmBucket = makeBucket(Infinity, burst);
					rpmHardStop = false;
				} else if (v <= 0) {
					// Hard stop — no admission until cap relaxes.
					rpmHardStop = true;
				}
			}
		}
	});
	const unsubTpm = effectiveTpm.subscribe((msgs) => {
		for (const msg of msgs) {
			if (msg[0] === DATA) {
				const v = Number(msg[1]);
				if (Number.isFinite(v) && v > 0) {
					tpmBucket = makeBucket(v, burst);
					tpmHardStop = false;
				} else if (v === Infinity) {
					tpmBucket = makeBucket(Infinity, burst);
					tpmHardStop = false;
				} else if (v <= 0) {
					tpmHardStop = true;
				}
			}
		}
	});

	// Throttle-until: set by retryAfterMs signals.
	let throttleUntilNs = 0;

	// Clamp-decay timers — when they fire, the signal cap is relaxed back to Infinity.
	const rpmDecayTimer = new ResettableTimer();
	const tpmDecayTimer = new ResettableTimer();

	// Adaptation source subscription.
	let unsubAdapt: (() => void) | undefined;
	if (opts.adaptation != null) {
		const adaptNode = fromAny(opts.adaptation as NodeInput<RateLimitSignal>);
		unsubAdapt = adaptNode.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) applySignal(msg[1] as RateLimitSignal);
			}
		});
	}

	function applySignal(sig: RateLimitSignal): void {
		lastSignal.emit(sig);
		// Accept `rpmCap`/`tpmCap` of 0 as a valid hard-stop signal. Only
		// reject non-finite caps (NaN/Infinity).
		if (sig.rpmCap != null && Number.isFinite(sig.rpmCap) && sig.rpmCap >= 0) {
			signalRpmCap.emit(sig.rpmCap);
			// Schedule decay. Uses ResettableTimer — each new clamp resets the cooldown.
			if (Number.isFinite(clampCooldownMs) && clampCooldownMs > 0) {
				rpmDecayTimer.start(clampCooldownMs, () => signalRpmCap.emit(Number.POSITIVE_INFINITY));
			}
		}
		if (sig.tpmCap != null && Number.isFinite(sig.tpmCap) && sig.tpmCap >= 0) {
			signalTpmCap.emit(sig.tpmCap);
			if (Number.isFinite(clampCooldownMs) && clampCooldownMs > 0) {
				tpmDecayTimer.start(clampCooldownMs, () => signalTpmCap.emit(Number.POSITIVE_INFINITY));
			}
		}
		if (sig.retryAfterMs != null && sig.retryAfterMs > 0) {
			const resumeAt = monotonicNs() + sig.retryAfterMs * 1_000_000;
			if (resumeAt > throttleUntilNs) throttleUntilNs = resumeAt;
		}
	}

	const pending = node<number>([], { initial: 0, name: "adaptiveRateLimiter/pending" });
	const rpmAvailableNode = node<number>([], {
		initial: Number.POSITIVE_INFINITY,
		name: "adaptiveRateLimiter/rpmAvailable",
	});
	const tpmAvailableNode = node<number>([], {
		initial: Number.POSITIVE_INFINITY,
		name: "adaptiveRateLimiter/tpmAvailable",
	});

	const bumpPending = (delta: number): void => {
		pending.emit((pending.cache ?? 0) + delta);
	};
	const refreshAvailable = (): void => {
		rpmAvailableNode.emit(rpmBucket.available());
		tpmAvailableNode.emit(tpmBucket.available());
	};

	async function acquire(
		acquireOpts: { requestCost?: number; tokenCost?: number; signal?: AbortSignal } = {},
	): Promise<void> {
		const requestCost = acquireOpts.requestCost ?? 1;
		const tokenCost = acquireOpts.tokenCost ?? 0;
		const abortSignal = acquireOpts.signal;

		bumpPending(1);
		try {
			while (true) {
				if (abortSignal?.aborted) throw makeAbortError("AdaptiveRateLimiter.acquire aborted");

				// Honor retry-after window.
				const now = monotonicNs();
				if (throttleUntilNs > now) {
					const waitMs = Math.ceil((throttleUntilNs - now) / 1_000_000);
					await sleepReactive(waitMs, abortSignal);
					continue;
				}

				// Hard-stop (cap=0) → wait for the decay timer to relax.
				if ((requestCost > 0 && rpmHardStop) || (tokenCost > 0 && tpmHardStop)) {
					await sleepReactive(250, abortSignal);
					continue;
				}

				// Capture local refs so a concurrent rpm/tpm cap-change rebuilding
				// the bucket doesn't send `putBack` to a different bucket than
				// `tryConsume` debited. If the cap relaxes mid-flight, the OLD
				// bucket gets the credit (safe — it's closed over a closure the
				// new acquires don't see), and new acquires pick up the new
				// bucket on their own next iteration.
				const rpmAtAcquire = rpmBucket;
				const tpmAtAcquire = tpmBucket;

				// Try consume RPM first.
				const gotRpm = rpmAtAcquire.tryConsume(requestCost);
				if (!gotRpm) {
					await sleepReactive(estimateWaitMs(rpmAtAcquire, requestCost), abortSignal);
					continue;
				}
				// Then TPM — if it fails, return the RPM token (no wasted slot).
				const gotTpm = tokenCost > 0 ? tpmAtAcquire.tryConsume(tokenCost) : true;
				if (!gotTpm) {
					rpmAtAcquire.putBack(requestCost);
					await sleepReactive(estimateWaitMs(tpmAtAcquire, tokenCost), abortSignal);
					continue;
				}
				refreshAvailable();
				return;
			}
		} finally {
			bumpPending(-1);
		}
	}

	function recordUsage(delta: number): void {
		if (delta > 0) {
			// Undershoot: debit additional tokens. Non-blocking — if it fails, the
			// next acquire will just wait longer.
			tpmBucket.tryConsume(delta);
		} else if (delta < 0) {
			// Overshoot: credit back.
			tpmBucket.putBack(-delta);
		}
		refreshAvailable();
	}

	function dispose(): void {
		unsubRpm();
		unsubTpm();
		unsubAdapt?.();
		rpmDecayTimer.cancel();
		tpmDecayTimer.cancel();
	}

	return {
		effectiveRpm,
		effectiveTpm,
		lastSignal,
		pending,
		rpmAvailable: rpmAvailableNode,
		tpmAvailable: tpmAvailableNode,
		acquire,
		recordUsage,
		recordSignal: applySignal,
		dispose,
	};
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function makeBucket(perMinute: number, burst: number): TokenBucket {
	if (!Number.isFinite(perMinute) || perMinute === Infinity) {
		return tokenBucket(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
	}
	const capacity = Math.max(1, perMinute * burst);
	const refillPerSecond = perMinute / 60;
	return tokenBucket(capacity, refillPerSecond);
}

function estimateWaitMs(bucket: TokenBucket, needed: number): number {
	const have = bucket.available();
	const deficit = Math.max(0, needed - have);
	if (deficit <= 0) return 25; // retry quickly; primary path already failed so pacing is forced
	// Heuristic: wait 100ms per missing unit, clamped.
	return Math.min(5_000, Math.max(50, deficit * 100));
}

/**
 * Promise-based sleep using `ResettableTimer` (spec §5.10 escape hatch).
 * Cleanly removes abort listener on both the timer-fires and abort paths;
 * no leaked `AbortSignal.addEventListener` registrations.
 */
function sleepReactive(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted) return Promise.reject(makeAbortError("AdaptiveRateLimiter.acquire aborted"));
	return new Promise((resolve, reject) => {
		const timer = new ResettableTimer();
		let onAbort: (() => void) | undefined;
		const cleanup = (): void => {
			timer.cancel();
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		};
		timer.start(ms, () => {
			cleanup();
			resolve();
		});
		if (signal) {
			onAbort = (): void => {
				cleanup();
				reject(makeAbortError("AdaptiveRateLimiter.acquire aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

export { NS_PER_SEC };
