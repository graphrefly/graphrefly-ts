/**
 * Time-aware operators (roadmap §2.1) — `delay`, `debounce`, `throttle`,
 * `sample`, `audit`, and the `interval` source-source.
 *
 * All time scheduling uses raw `setTimeout` / `setInterval` with monotonic
 * `monotonicNs` reads where the operator's contract requires elapsed-time
 * arithmetic (per spec §5.10's resilience-operator carve-out).
 */

import { monotonicNs } from "../../core/clock.js";
import { COMPLETE, DATA, ERROR, type Messages } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { subscribeOr } from "../../core/subscribe-error.js";

// Inlined during cleave A2 (was imported from resilience/backoff.ts, which
// moved to the presentation package — substrate must not import upward).
// Keep in sync with the canonical NS_PER_MS in src/base/resilience/backoff.ts.
const NS_PER_MS = 1_000_000;

import { type ExtraOpts, operatorOpts } from "./_internal.js";

/**
 * Delays phase-2 emissions by `ms` (timers). `DIRTY` still forwards immediately.
 *
 * @param source - Upstream node.
 * @param ms - Delay in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Same values, shifted in time.
 * @example
 * ```ts
 * import { delay, state } from "@graphrefly/graphrefly-ts";
 *
 * delay(state(1), 100);
 * ```
 *
 * @category extra
 */
export function delay<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	return node<T>((_data, a) => {
		const timers = new Set<ReturnType<typeof setTimeout>>();
		function clearAll(): void {
			for (const id of timers) clearTimeout(id);
			timers.clear();
		}

		// R2.2.7.b: Dead source → no more DATA possible, self-COMPLETE
		// (after any in-flight delayed timers drain via their own
		// callbacks).
		const srcUnsub = subscribeOr<unknown>(
			source as Node,
			(msgs) => {
				for (const m of msgs as Messages) {
					if (m[0] === DATA) {
						const id = setTimeout(() => {
							timers.delete(id);
							a.emit(m[1] as T);
						}, ms);
						timers.add(id);
					} else if (m[0] === COMPLETE) {
						// Wait for all pending timers, then complete
						const id = setTimeout(() => {
							timers.delete(id);
							a.down([[COMPLETE]]);
						}, ms);
						timers.add(id);
					} else if (m[0] === ERROR) {
						clearAll();
						a.down([m]);
					}
					// DIRTY from source is NOT forwarded — delay transforms the
					// timeline. a.emit(v) in the timer callback handles full
					// DIRTY+DATA framing atomically at the delayed time.
				}
			},
			() => {
				clearAll();
				a.down([[COMPLETE]]);
			},
		);

		return () => {
			srcUnsub();
			clearAll();
		};
	}, operatorOpts(opts));
}

/**
 * Emits the latest value only after `ms` quiet time since the last trigger (`debounce`).
 *
 * @param source - Upstream node.
 * @param ms - Quiet window in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Debounced stream.
 * @example
 * ```ts
 * import { debounce, state } from "@graphrefly/graphrefly-ts";
 *
 * debounce(state(0), 50);
 * ```
 *
 * @category extra
 */
export function debounce<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	return node<T>(
		(_data, a) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let pending: T | undefined;

			function clearTimer(): void {
				if (timer !== undefined) {
					clearTimeout(timer);
					timer = undefined;
				}
			}

			// R2.2.7.b: Dead source → flush pending if any, self-COMPLETE.
			const srcUnsub = subscribeOr<unknown>(
				source as Node,
				(msgs) => {
					for (const m of msgs as Messages) {
						if (m[0] === DATA) {
							clearTimer();
							pending = m[1] as T;
							timer = setTimeout(() => {
								timer = undefined;
								a.emit(pending as T);
							}, ms);
						} else if (m[0] === COMPLETE) {
							if (timer !== undefined) {
								clearTimer();
								a.emit(pending as T);
							}
							a.down([[COMPLETE]]);
						} else if (m[0] === ERROR) {
							clearTimer();
							a.down([m]);
						}
					}
				},
				() => {
					if (timer !== undefined) {
						clearTimer();
						a.emit(pending as T);
					}
					a.down([[COMPLETE]]);
				},
			);

			return () => {
				srcUnsub();
				clearTimer();
			};
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("debounce", { ms }), ...(opts?.meta ?? {}) },
		},
	);
}

export type ThrottleOptions = { leading?: boolean; trailing?: boolean };

/**
 * Rate-limits emissions to at most once per `ms` window (`throttleTime`).
 *
 * When `trailing: true`, pending trailing values are flushed on source
 * COMPLETE (and on Dead-source R2.2.7.b). This intentionally diverges from
 * RxJS `throttleTime` v7 (which drops trailing pending on COMPLETE) for
 * symmetry with `debounce`'s live-COMPLETE behavior.
 *
 * @param source - Upstream node.
 * @param ms - Minimum spacing in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`) plus `leading` / `trailing`.
 * @returns `Node<T>` - Throttled stream.
 * @example
 * ```ts
 * import { throttle, state } from "@graphrefly/graphrefly-ts";
 *
 * throttle(state(0), 1_000, { trailing: false });
 * ```
 *
 * @category extra
 */
export function throttle<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & ThrottleOptions,
): Node<T> {
	const { leading: leadingOpt, trailing: trailingOpt, ...throttleNodeOpts } = opts ?? {};
	const leading = leadingOpt !== false;
	const trailing = trailingOpt === true;
	const windowNs = ms * NS_PER_MS;

	return node<T>(
		(_data, a) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let lastEmitNs = -Infinity;
			let pending: T | undefined;
			let hasPending = false;

			function clearTimer(): void {
				if (timer !== undefined) {
					clearTimeout(timer);
					timer = undefined;
				}
			}

			// R2.2.7.b: Dead source → flush trailing pending if any,
			// self-COMPLETE.
			const srcUnsub = subscribeOr<unknown>(
				source as Node,
				(msgs) => {
					for (const m of msgs as Messages) {
						if (m[0] === DATA) {
							const v = m[1] as T;
							const nowNs = monotonicNs();
							if (leading && nowNs - lastEmitNs >= windowNs) {
								lastEmitNs = nowNs;
								a.emit(v);
								clearTimer();
								if (trailing) {
									timer = setTimeout(() => {
										timer = undefined;
										if (hasPending) {
											lastEmitNs = monotonicNs();
											a.emit(pending as T);
											hasPending = false;
										}
									}, ms);
								}
							} else if (trailing) {
								pending = v;
								hasPending = true;
								if (timer === undefined) {
									const elapsedMs = (nowNs - lastEmitNs) / NS_PER_MS;
									timer = setTimeout(
										() => {
											timer = undefined;
											if (hasPending) {
												lastEmitNs = monotonicNs();
												a.emit(pending as T);
												hasPending = false;
											}
										},
										Math.max(0, ms - elapsedMs),
									);
								}
							}
						} else if (m[0] === COMPLETE) {
							// /qa m21 (2026-05-10): flush trailing pending
							// on live-COMPLETE for symmetry with the Dead
							// branch and with `debounce`'s live-COMPLETE
							// behavior. Pre-fix the live-COMPLETE path
							// silently discarded any trailing-mode pending
							// value, which diverged from the Dead branch
							// (and from user intuition: throttle's
							// trailing-mode contract is "emit the latest
							// value seen in each window", so the final
							// pending should flush on terminal).
							clearTimer();
							if (hasPending) {
								a.emit(pending as T);
								hasPending = false;
							}
							a.down([m]);
						} else if (m[0] === ERROR) {
							clearTimer();
							a.down([m]);
						}
					}
				},
				() => {
					clearTimer();
					if (hasPending) {
						a.emit(pending as T);
						hasPending = false;
					}
					a.down([[COMPLETE]]);
				},
			);

			return () => {
				srcUnsub();
				clearTimer();
			};
		},
		{
			...operatorOpts(throttleNodeOpts),
			meta: {
				...factoryTag("throttle", { ms, leading, trailing }),
				...(throttleNodeOpts.meta ?? {}),
			},
		},
	);
}

/**
 * Emits the most recent source value whenever `notifier` emits `DATA` (`sample`).
 *
 * Source `COMPLETE` stops sampling (clears held value); notifier `COMPLETE` terminates the
 * operator. `ERROR` from either dep terminates immediately. At most one terminal message is
 * emitted downstream (latch). Supports `resubscribable` — `ctx.store` resets automatically.
 *
 * @param source - Node whose latest value is sampled.
 * @param notifier - When this node emits `DATA`, a sample is taken.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Sampled snapshots of `source`.
 * @example
 * ```ts
 * import { sample, state } from "@graphrefly/graphrefly-ts";
 *
 * sample(state(1), state(0));
 * ```
 *
 * @category extra
 */
export function sample<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T> {
	return node<T>((_data, a) => {
		let lastSourceValue: { v: T } | undefined;
		let terminated = false;
		let sourceCompleted = false;

		// R2.2.7.b: Dead source → no value to sample; mark source-
		// completed so notifier fires become no-ops.
		const srcUnsub = subscribeOr<unknown>(
			source as Node,
			(msgs) => {
				if (terminated) return;
				for (const m of msgs as Messages) {
					if (terminated) return;
					if (m[0] === DATA) {
						lastSourceValue = { v: m[1] as T };
					} else if (m[0] === ERROR) {
						terminated = true;
						a.down([m]);
					} else if (m[0] === COMPLETE) {
						sourceCompleted = true;
						lastSourceValue = undefined;
					}
				}
			},
			() => {
				sourceCompleted = true;
				lastSourceValue = undefined;
			},
		);

		// R2.2.7.b: Dead notifier → no sampling triggers will ever
		// fire; self-COMPLETE (operator has no further work).
		const notUnsub = subscribeOr<unknown>(
			notifier as Node,
			(msgs) => {
				if (terminated) return;
				for (const m of msgs as Messages) {
					if (terminated) return;
					if (m[0] === DATA) {
						if (lastSourceValue !== undefined && !sourceCompleted) {
							a.emit(lastSourceValue.v);
						}
					} else if (m[0] === ERROR) {
						terminated = true;
						a.down([m]);
					} else if (m[0] === COMPLETE) {
						terminated = true;
						a.down([[COMPLETE]]);
					}
				}
			},
			() => {
				if (!terminated) {
					terminated = true;
					a.down([[COMPLETE]]);
				}
			},
		);

		return () => {
			srcUnsub();
			notUnsub();
		};
	}, operatorOpts(opts));
}

/**
 * After each source `DATA`, waits `ms` then emits the latest value if another `DATA` has not arrived (`auditTime` / trailing window).
 *
 * @param source - Upstream node.
 * @param ms - Window in milliseconds after each `DATA`.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Trailing-edge sampled stream.
 * @example
 * ```ts
 * import { audit, state } from "@graphrefly/graphrefly-ts";
 *
 * audit(state(0), 100);
 * ```
 *
 * @category extra
 */
export function audit<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	return node<T>((_data, a) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let latest: T | undefined;
		let has = false;

		function clearTimer(): void {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		}

		// R2.2.7.b: Dead source → emit any pending latest, self-COMPLETE.
		const srcUnsub = subscribeOr<unknown>(
			source as Node,
			(msgs) => {
				for (const m of msgs as Messages) {
					if (m[0] === DATA) {
						latest = m[1] as T;
						has = true;
						clearTimer();
						timer = setTimeout(() => {
							timer = undefined;
							if (has) {
								has = false;
								a.emit(latest as T);
							}
						}, ms);
					} else if (m[0] === COMPLETE || m[0] === ERROR) {
						clearTimer();
						a.down([m]);
					}
				}
			},
			() => {
				clearTimer();
				if (has) {
					has = false;
					a.emit(latest as T);
				}
				a.down([[COMPLETE]]);
			},
		);

		return () => {
			srcUnsub();
			clearTimer();
		};
	}, operatorOpts(opts));
}

/**
 * Increments on each tick (`interval`); uses `setInterval` via {@link producer}.
 *
 * @param periodMs - Time between ticks.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<number>` - Emits `0`, `1`, `2`, … while subscribed.
 * @example
 * ```ts
 * import { interval } from "@graphrefly/graphrefly-ts";
 *
 * interval(1_000);
 * ```
 *
 * @category extra
 */
export function interval(periodMs: number, opts?: ExtraOpts): Node<number> {
	return node<number>((_data, a, ctx) => {
		if (!("n" in ctx.store)) ctx.store.n = 0;
		const id = setInterval(() => {
			a.emit(ctx.store.n as number);
			ctx.store.n = (ctx.store.n as number) + 1;
		}, periodMs);
		// Lock 6.D (Phase 13.6.B): clear `n` on deactivation so a
		// resubscribable interval restarts at 0 on the next cycle.
		// Pre-flip this came for free via `_deactivate`'s store wipe.
		const store = ctx.store;
		return {
			onDeactivation: () => {
				clearInterval(id);
				delete store.n;
			},
		};
	}, operatorOpts(opts));
}

/**
 * RxJS-named alias for {@link debounce} — drops rapid `DATA` until `ms` of quiet.
 *
 * @param source - Upstream node.
 * @param ms - Quiet period in milliseconds.
 * @param opts - Optional node options (excluding `describeKind`).
 * @returns Debounced node; behavior matches `debounce`.
 *
 * @example
 * ```ts
 * import { debounceTime, state } from "@graphrefly/graphrefly-ts";
 *
 * debounceTime(state(0), 100);
 * ```
 *
 * @category extra
 */
export const debounceTime = debounce;

/**
 * RxJS-named alias for {@link throttle} — emits on leading/trailing edges within `ms`.
 *
 * @param source - Upstream node.
 * @param ms - Minimum spacing in milliseconds.
 * @param opts - Optional throttle shape (`leading` / `trailing`) and node options.
 * @returns Throttled node; behavior matches `throttle`.
 *
 * @example
 * ```ts
 * import { throttleTime, state } from "@graphrefly/graphrefly-ts";
 *
 * throttleTime(state(0), 100);
 * ```
 *
 * @category extra
 */
export const throttleTime = throttle;
