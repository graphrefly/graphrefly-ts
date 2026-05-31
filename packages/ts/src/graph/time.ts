/**
 * Wall-clock time operators (CSP-2.7 / D52 / B23). Authored as COMPOSITIONS over the already-active
 * higher-order *Map machinery (D47) + the `timer` source — NO raw `setTimeout` in any operator body
 * (R-no-raw-async / check-no-raw-async; `setTimeout` stays confined to `sources.ts`'s `timer`). The
 * timer source's `onDeactivation` clearTimeout IS the reset/cancel: switchMap's removeDep on a new
 * source value tears the in-flight timer down (the declarative equivalent of the frozen reference's
 * imperative clearTimeout-then-setTimeout). Per-language (D6/D24), never in parity.
 *
 * Shipped this cut (clean *Map+timer):
 *   - delay        = mergeMap(v → timer(ms)→v)   (every value delayed ms, ALL kept, order preserved)
 *   - debounce(Time) = switchMap(v → timer(ms)→v) (cancel-and-restart; emit the latest after quiet ms)
 *   - throttle(Time) = exhaustMap(v → [v now, alive ms]) (leading edge: emit v, ignore for ms)
 *
 * Behavior on source COMPLETE (per-operator, NOT a uniform DROP): debounce/debounceTime EMIT their
 * pending trailing value — switchMap does not cancel the in-flight inner on source COMPLETE (only a
 * superseding source value cancels it via removeDep→onDeactivation→clearTimeout), so the timer still
 * fires at `ms`, emits the debounced value, and only THEN does the operator COMPLETE (RxJS
 * debounceTime parity). delay emits every still-pending delayed value then COMPLETEs (mergeMap keeps
 * all inners). throttle/throttleTime have NO trailing value (leading-edge only, RxJS default
 * trailing:false) — an open window inner is dropped when the operator completes.
 *
 * DEFERRED (flagged, NOT in this cut — each needs a mechanism beyond a clean *Map+timer projector):
 *   - audit/auditTime  — trailing edge with a NON-resetting timer that emits the LATEST value seen in
 *                        the window (not switchMap's cancel-restart, not exhaustMap's leading emit).
 *   - timeout          — idle watchdog: ERROR if no DATA within ms; needs a resettable ERROR-timer
 *                        raced against the source.
 *   - bufferTime/windowTime — buffer/window over interval(ms); bufferTime needs the interval wired as
 *                        a self-added notifier dep, windowTime emits nested Node<Node<T>> (see the
 *                        window-family deferral in combinators.ts).
 */

import type { Node } from "../node/node.js";
import { exhaustMap, mergeMap, switchMap } from "./higher-order.js";
import { filter, initNode, map, merge, type Operator } from "./operators.js";
import { of, timer } from "./sources.js";

/** A bare inner that emits `v` once after `ms`, then COMPLETEs (timer(ms)→map(v); auto-completes). */
function delayedValue<S>(v: S, ms: number): Node<S> {
	return initNode(
		map(() => v),
		[initNode(timer(ms), [])],
	);
}

/**
 * An inner that emits `v` IMMEDIATELY (on activation) and stays alive for `ms` (then COMPLETEs),
 * emitting nothing more — the leading-edge throttle window. `merge(of(v), silentTimer)`: `of(v)`
 * emits v + COMPLETE at t=0; `filter(()=>false)` over `timer(ms)` emits no DATA and COMPLETEs at
 * t=ms; merge forwards v at t=0 and COMPLETEs (all deps complete) at t=ms.
 */
function throttleWindow<S>(v: S, ms: number): Node<S> {
	const silentTimer = initNode(
		filter<number>(() => false),
		[initNode(timer(ms), [])],
	) as Node<S>;
	return initNode(merge<S>(), [initNode(of(v), []), silentTimer]);
}

/**
 * delay: shift every value by `ms`, preserving all values + order. `mergeMap` keeps every inner
 * timer live (equal `ms`, so they fire in arrival order).
 */
export function delay<S>(ms: number): Operator<S, S> {
	return { ...mergeMap<S, S>((v) => delayedValue(v, ms)), factory: "delay" };
}

/**
 * debounce (alias `debounceTime`): emit the latest value only after `ms` of quiet. `switchMap`
 * cancels the prior timer (its onDeactivation clearTimeout) on each new source value and restarts —
 * the declarative debounce.
 *
 * RxJS-7 divergence (reference rxjs@7.8, B44): RxJS `debounceTime` FLUSHES the pending value
 * IMMEDIATELY when the source COMPLETEs (its `_complete` calls `debouncedNext()` before
 * `complete()`). This composition instead emits the pending value when the in-flight `timer(ms)`
 * fires — i.e. at `(last-value-time + ms)` — so if the source completes mid-window the trailing
 * value arrives up to `ms` later than RxJS. Inherent to the `*Map`+`timer` form (the composition
 * cannot flush early without detecting COMPLETE inside the switchMap inner); accepted, not a bug.
 */
export function debounce<S>(ms: number): Operator<S, S> {
	return { ...switchMap<S, S>((v) => delayedValue(v, ms)), factory: "debounce" };
}

/** debounceTime: RxJS-named alias of {@link debounce}. */
export function debounceTime<S>(ms: number): Operator<S, S> {
	return { ...switchMap<S, S>((v) => delayedValue(v, ms)), factory: "debounceTime" };
}

/**
 * throttle (alias `throttleTime`): leading-edge — emit a value immediately, then ignore the source
 * for `ms`. `exhaustMap` drops new source values while the current window inner is alive; the
 * window emits v at its leading edge and stays alive `ms`.
 *
 * Matches the RxJS-7 `throttleTime` DEFAULT (leading:true, trailing:false). The leading/trailing
 * OPTIONS RxJS exposes are NOT provided (a capability gap, not a behavior divergence; B44) — add a
 * trailing-window form if a consumer needs it.
 */
export function throttle<S>(ms: number): Operator<S, S> {
	return { ...exhaustMap<S, S>((v) => throttleWindow(v, ms)), factory: "throttle" };
}

/** throttleTime: RxJS-named alias of {@link throttle}. */
export function throttleTime<S>(ms: number): Operator<S, S> {
	return { ...exhaustMap<S, S>((v) => throttleWindow(v, ms)), factory: "throttleTime" };
}
