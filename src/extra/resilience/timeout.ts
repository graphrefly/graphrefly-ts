/**
 * Timeout — emits `ERROR` with `TimeoutError` if no `DATA` arrives within the deadline.
 *
 * §3.1c — caching, fallback & composition sugar. Uses
 * `core/clock.js`-style nanoseconds and a `ResettableTimer` so the deadline
 * resets on each DATA. Distinct from the `operators/control.ts` timeout
 * (which forwards a caller-supplied error/value) — this one is the
 * resilience family's "deadline → ERROR" primitive.
 */

import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, TEARDOWN } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { ResettableTimer } from "../timer.js";
import { isNode, type NodeOrValue, operatorOpts, resolveReactiveOption } from "./_internal.js";
import { NS_PER_MS } from "./backoff.js";

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

/**
 * Emits `ERROR` with {@link TimeoutError} if no `DATA` arrives within the deadline.
 *
 * The timer starts on subscription and resets on each `DATA`. `DIRTY` does NOT reset
 * the timer. Terminal messages (`COMPLETE`/`ERROR`) cancel the timer.
 *
 * @param source - Upstream node.
 * @param timeoutNs - Deadline in **nanoseconds** (must be > 0), or a
 *   `Node<number>` carrying the deadline reactively (Tier 6.5 3.2.1).
 *   Internally converted to milliseconds for `setTimeout` scheduling.
 * @returns Node that errors on timeout.
 *
 * @throws {RangeError} when `timeoutNs <= 0`.
 *
 * @remarks
 * **Scheduling:** internally uses {@link ResettableTimer} (raw `setTimeout`) per spec §5.10's resilience-operator carve-out. The deadline is `timeoutNs / NS_PER_MS` ms; sub-millisecond `timeoutNs` values get the same minimum-1ms host-scheduler granularity that `setTimeout` provides.
 *
 * **Reactive `timeoutNs` (locked semantics, Tier 6.5 3.2.1, 2026-04-29).**
 * When `timeoutNs` is a `Node<number>`, each timer-(re)start reads the
 * latest value. An option swap mid-flight applies to the **next** timer
 * window (no in-flight reset) — the active timer keeps its original
 * deadline; the next DATA-driven `startTimer()` call reads the new
 * value. Static-form callers see no behavior change.
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
	timeoutNs: NodeOrValue<number>,
	options?: { meta?: Record<string, unknown> },
): Node<T> {
	// Static-form validation: only validate up-front when the arg is a
	// literal number. Reactive-form validation runs lazily inside the
	// producer body (each emit reads latest cache and re-validates).
	if (!isNode(timeoutNs) && timeoutNs <= 0) {
		throw new RangeError("timeoutNs must be > 0");
	}
	const callerMeta = options?.meta;
	const factoryArgs = isNode(timeoutNs) ? { timeoutNs: "Node<number>" } : { timeoutNs };

	return node<T>(
		(_data, a) => {
			let stopped = false;
			const timer = new ResettableTimer();
			// Closure-mirror per §28: subscribe to the option Node (static-form
			// returns a no-op unsub). Each `startTimer()` reads the latest via
			// `currentNs()` so option swaps take effect at the next attempt
			// boundary per the locked semantic rule.
			const optMirror = resolveReactiveOption<number>(timeoutNs);
			const currentNs = (): number => {
				const v = optMirror.current();
				return typeof v === "number" && v > 0 ? v : 0;
			};

			function startTimer(): void {
				const ns = currentNs();
				if (ns <= 0) {
					// Reactive option not yet populated (or invalid) — skip
					// scheduling; next DATA will retry.
					return;
				}
				const delayMs = ns / NS_PER_MS;
				// §5.10: setTimeout (not fromTimer) — resettable deadline needs clearTimeout/setTimeout; fromTimer creates a new Node per reset, adding lifecycle overhead on every DATA.
				timer.start(delayMs, () => {
					if (stopped) return;
					stopped = true;
					unsub();
					a.down([[ERROR, new TimeoutError(ns)]]);
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
				optMirror.unsub();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: { ...(callerMeta ?? {}), ...factoryTag("timeout", factoryArgs) },
		},
	);
}
