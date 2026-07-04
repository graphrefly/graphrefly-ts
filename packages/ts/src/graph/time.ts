/**
 * Wall-clock time operators (CSP-2.7 / D52 / B23). Authored as COMPOSITIONS over the already-active
 * higher-order *Map machinery (D47) + the `timer` source — NO raw `setTimeout` in any operator body
 * (R-no-raw-async / check-no-raw-async; `setTimeout` stays confined to `sources.ts`'s `timer`). The
 * timer source's `onDeactivation` clearTimeout IS the reset/cancel: switchMap's unsubscribeDep on a new
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
 * superseding source value cancels it via unsubscribeDep→onDeactivation→clearTimeout), so the timer still
 * fires at `ms`, emits the debounced value, and only THEN does the operator COMPLETE (RxJS
 * debounceTime parity). delay emits every still-pending delayed value then COMPLETEs (mergeMap keeps
 * all inners). throttle/throttleTime have NO trailing value (leading-edge only, RxJS default
 * trailing:false) — an open window inner is dropped when the operator completes.
 *
 * B41 tail (landed 2026-05-31, the two shapes reflect WHEN the clock arms):
 *   - audit / auditTime — VALUE-TRIGGERED trailing edge: a source value opens a duration window
 *                        (`audit(durationSelector)` = the general/notifier form, mirroring the *Map
 *                        `Project` idiom + D46; `auditTime(ms)` = `audit(() => timer(ms))`), emits the
 *                        window's LATEST value at the window's close. Self-wires the notifier via
 *                        ctx.rewireNext — a normal `g.initNode(audit(sel), [source])` operator.
 *   - timeout / bufferTime — SUBSCRIBE-ARMED (RxJS-cold): the clock must run from activation, before
 *                        any source value, so the timer/interval is a CONSTRUCTION-time dep (a depless
 *                        source arms lazily on subscribe per node `_activate`). A dep-bearing operator
 *                        body never runs at activation (only depless nodes do, node.ts), so these ship
 *                        as graph composition HELPERS `timeout(source, ms)` / `bufferTime(source, ms)`
 *                        returning a Node — NOT `g.initNode(op, [deps])` operators. timeout resets its
 *                        idle timer per source value via ctx.rewireNext (ERROR on the gap); bufferTime
 *                        is buffer-over-interval with terminal cleanup via ctx.rewireNext.
 *
 * NOT ported (D58): window/windowCount/windowTime — the Node<Node<T>> higher-order forms are a D45
 *   describe island; the array forms (buffer/bufferCount/bufferTime) are the graph-first equivalent.
 *
 * Inspection caveat (timeout/bufferTime): the helper returns a BARE node (free initNode) self-carrying
 * its factory for describe auto-discovery (D51), but it is NOT in a graph's _entries — so g.describe()
 * lists it only when it is a live dep of a registered node (a first-cut limit, like the *Map inners).
 */

import {
	type Ctx,
	depBatch,
	depTerminal,
	isTerminalComplete,
	isTerminalError,
	type NodeFn,
	terminalErrorValue,
} from "../ctx/types.js";
import type { Node } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import { exhaustMap, mergeMap, switchMap } from "./higher-order.js";
import { filter, initNode, map, merge, type Operator } from "./operators.js";
import { fromAny, interval, type NodeInput, of, timer } from "./sources.js";

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
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { delay } from "@graphrefly/ts";
 * ```
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
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { debounce } from "@graphrefly/ts";
 * ```
 */
export function debounce<S>(ms: number): Operator<S, S> {
	return { ...switchMap<S, S>((v) => delayedValue(v, ms)), factory: "debounce" };
}

/** debounceTime: RxJS-named alias of {@link debounce}.
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { debounceTime } from "@graphrefly/ts";
 * ```
 */
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
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { throttle } from "@graphrefly/ts";
 * ```
 */
export function throttle<S>(ms: number): Operator<S, S> {
	return { ...exhaustMap<S, S>((v) => throttleWindow(v, ms)), factory: "throttle" };
}

/** throttleTime: RxJS-named alias of {@link throttle}.
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { throttleTime } from "@graphrefly/ts";
 * ```
 */
export function throttleTime<S>(ms: number): Operator<S, S> {
	return { ...exhaustMap<S, S>((v) => throttleWindow(v, ms)), factory: "throttleTime" };
}

// ── B41 tail: value-triggered (audit) + subscribe-armed (timeout/bufferTime) ──

/** Per-node bookkeeping for {@link audit}: the open window's notifier + the latest value seen. */
interface AuditState<S> {
	windowOpen: boolean;
	latest: { v: S } | undefined;
	notifier: Node<unknown> | null;
}

/**
 * audit: VALUE-TRIGGERED trailing throttle. A source value (when no window is open) opens a duration
 * window via `durationSelector(value)` → a notifier `NodeInput` wired as dep 1 with `ctx.rewireNext`
 * (D47 — the *Map self-rewire idiom, NOT an internal subscribe, D45); during the window new source
 * values only UPDATE the tracked latest (no emit); when the notifier fires (its first DATA / COMPLETE)
 * the window closes and the LATEST value is emitted. This is throttle's trailing-edge twin
 * (throttle emits the window's FIRST value at the leading edge; audit emits the LAST at the close).
 *
 * `durationSelector` is the general/notifier form (mirrors the *Map `Project` idiom + D46); the source
 * is dep 0, the live notifier (if any) is dep 1. On source COMPLETE the pending latest is FLUSHED then
 * COMPLETE (RxJS-7 audit flush-on-complete, B44). A source/notifier ERROR is read as a real terminal
 * input so the live notifier can be removed before ERROR. Self-catching (D30); re-supplies its body on
 * every rewire.
 * @param durationSelector - duration selector value used by the helper.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { audit } from "@graphrefly/ts";
 * ```
 */
export function audit<S>(durationSelector: (v: S) => NodeInput<unknown>): Operator<S, S> {
	const body: NodeFn = (ctx: Ctx) => {
		try {
			const st: AuditState<S> = ctx.state.get<AuditState<S>>() ?? {
				windowOpen: false,
				latest: undefined,
				notifier: null,
			};
			const sourceBatch = depBatch(ctx, 0);
			const notifierBatch = depBatch(ctx, 1); // live duration notifier while a window is open
			const sourceTerminal = depTerminal(ctx, 0);
			const notifierTerminal = depTerminal(ctx, 1);

			// every source value updates the window's latest (the value emitted at the window's close).
			const sb = sourceBatch as readonly S[] | null;
			if (sb) for (const v of sb) st.latest = { v };

			// the window closes when its duration notifier fires (DATA or COMPLETE) → emit the latest.
			const notifierFired =
				st.windowOpen &&
				((notifierBatch != null && notifierBatch.length > 0) ||
					isTerminalComplete(notifierTerminal));
			if (notifierFired) {
				if (st.latest !== undefined) ctx.down([["DATA", st.latest.v]]);
				const old = st.notifier;
				st.windowOpen = false;
				st.notifier = null;
				st.latest = undefined;
				if (old) ctx.rewireNext.unsubscribeDep(old, body);
			}

			// source/notifier ERROR → forward ERROR, but first remove the helper-owned notifier.
			const sourceError = isTerminalError(sourceTerminal);
			const notifierError = isTerminalError(notifierTerminal);
			if (sourceError || notifierError) {
				const err = terminalErrorValue(sourceError ? sourceTerminal : notifierTerminal);
				if (st.notifier) ctx.rewireNext.unsubscribeDep(st.notifier, body);
				ctx.state.set({ windowOpen: false, latest: undefined, notifier: null });
				ctx.down([["ERROR", err]]);
				return;
			}

			// source COMPLETE → flush the pending latest (B44 audit flush-on-complete) then COMPLETE.
			if (isTerminalComplete(sourceTerminal)) {
				if (st.windowOpen && st.latest !== undefined) ctx.down([["DATA", st.latest.v]]);
				if (st.notifier) ctx.rewireNext.unsubscribeDep(st.notifier, body);
				ctx.state.set({ windowOpen: false, latest: undefined, notifier: null });
				ctx.down([["COMPLETE"]]);
				return;
			}

			// a fresh source value with no open window → open one (value-triggered, trailing edge).
			if (!st.windowOpen && sb != null && sb.length > 0 && st.latest !== undefined) {
				const n = fromAny<unknown>(durationSelector(st.latest.v), { iter: true });
				st.windowOpen = true;
				st.notifier = n;
				ctx.rewireNext.subscribeDep(n, body); // (a same-wave close+reopen issues remove-before-add)
			}

			ctx.state.set(st);
		} catch (e) {
			ctx.down([["ERROR", errorPayload(e, "audit threw without a valid error payload")]]);
		}
	};
	return {
		factory: "audit",
		body,
		opts: {
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
	};
}

/** auditTime: the `ms`-specialization of {@link audit} — the window is a `timer(ms)`.
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Operator<S, S>` value.
 * @category graph
 * @example
 * ```ts
 * import { auditTime } from "@graphrefly/ts";
 * ```
 */
export function auditTime<S>(ms: number): Operator<S, S> {
	return { ...audit<S>(() => initNode(timer(ms), [])), factory: "auditTime" };
}

/** Per-node bookkeeping for {@link timeout}: the live idle timer (reset on each source value). */
interface TimeoutState {
	timer: Node<unknown> | null;
}

/**
 * timeout: idle watchdog — forward every source value, but ERROR if more than `ms` elapses with no
 * value (RxJS `timeout(ms)`, `first === each === ms`). SUBSCRIBE-ARMED: the first `timer(ms)` is a
 * CONSTRUCTION-time dep, so it arms when `timeout`'s node is subscribed/activated (a depless source
 * runs lazily on `_activate`) — i.e. a source that never emits its FIRST value within `ms` still
 * errors. A dep-bearing operator body never runs at activation (only depless nodes do, node.ts), which
 * is why this is a HELPER returning a Node, not a `g.initNode(op, [source])` operator.
 *
 * Each source value forwards as-is and RESETS the idle timer (unsubscribeDep the current `timer(ms)`,
 * subscribeDep a fresh one — its `onDeactivation` clearTimeout cancels the prior countdown). The timer
 * firing (its DATA/COMPLETE) is the timeout → `[[ERROR]]`. Source COMPLETE forwards COMPLETE (no
 * error) and removes the idle timer during the terminal wave (D62 terminal-drains-queued-rewire);
 * a source ERROR forwards likewise. The idle timer is also torn down when the consumer unsubscribes
 * (timeout deactivates → dep unsub → timer onDeactivation). Self-catching (D30).
 * @param source - Source node that provides graph-visible input.
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Node<S>` value.
 * @category graph
 * @example
 * ```ts
 * import { timeout } from "@graphrefly/ts";
 * ```
 */
export function timeout<S>(source: Node<S>, ms: number): Node<S> {
	const makeTimer = (): Node<unknown> => initNode(timer(ms), []);
	const initial = makeTimer();
	const body: NodeFn = (ctx: Ctx) => {
		try {
			const st: TimeoutState = ctx.state.get<TimeoutState>() ?? { timer: initial };
			const srcBatch = depBatch(ctx, 0);
			const srcTerminal = depTerminal(ctx, 0);

			// a source value forwards as-is and resets the idle window.
			const sb = srcBatch as readonly S[] | null;
			if (sb != null && sb.length > 0) {
				for (const v of sb) ctx.down([["DATA", v]]);
				const old = st.timer;
				const next = makeTimer();
				st.timer = next;
				ctx.state.set(st);
				if (old) ctx.rewireNext.unsubscribeDep(old, body); // remove-before-add (alignment)
				ctx.rewireNext.subscribeDep(next, body);
				return; // a value-bearing wave is never also a timeout-fire wave
			}

			// source COMPLETE → forward COMPLETE (no timeout fires).
			if (isTerminalComplete(srcTerminal)) {
				if (st.timer) ctx.rewireNext.unsubscribeDep(st.timer, body);
				ctx.down([["COMPLETE"]]);
				return;
			}
			// source ERROR (absorbed via errorWhenDepsError:false) → forward it.
			if (isTerminalError(srcTerminal)) {
				if (st.timer) ctx.rewireNext.unsubscribeDep(st.timer, body);
				ctx.down([["ERROR", terminalErrorValue(srcTerminal)]]);
				return;
			}

			// otherwise this wave is the idle timer firing → timeout ERROR.
			const timerBatch = depBatch(ctx, 1);
			if (
				(timerBatch != null && timerBatch.length > 0) ||
				isTerminalComplete(depTerminal(ctx, 1))
			) {
				ctx.down([["ERROR", new Error(`timeout: no value within ${ms}ms`)]]);
				return;
			}
			ctx.state.set(st);
		} catch (e) {
			ctx.down([["ERROR", errorPayload(e, "timeout threw without a valid error payload")]]);
		}
	};
	return initNode<S, S>(
		{
			factory: "timeout",
			body,
			opts: {
				partial: true,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				terminalAsRealInput: true,
			},
		},
		[source as Node<unknown>, initial],
	);
}

/**
 * bufferTime: buffer source values and flush them as an array every `ms` (RxJS `bufferTime(ms)`).
 * SUBSCRIBE-ARMED: the `interval(ms)` notifier is a CONSTRUCTION-time dep (arms on subscribe), so an
 * empty window flushes `[]` even before the first source value — matching the landed {@link buffer}
 * (which flushes on every notifier signal). On source COMPLETE the remainder flushes then COMPLETE
 * (B44), and D62 lets the terminal wave still drain `unsubscribeDep(interval)` so the helper-owned
 * interval source deactivates instead of ticking forever.
 * @param source - Source node that provides graph-visible input.
 * @param ms - Duration or timestamp in milliseconds.
 * @returns A `Node<S[]>` value.
 * @category graph
 * @example
 * ```ts
 * import { bufferTime } from "@graphrefly/ts";
 * ```
 */
export function bufferTime<S>(source: Node<S>, ms: number): Node<S[]> {
	const iv: Node<unknown> = initNode(interval(ms), []);
	const body: NodeFn = (ctx: Ctx) => {
		const srcBatch = depBatch(ctx, 0);
		const tickBatch = depBatch(ctx, 1);
		const srcTerminal = depTerminal(ctx, 0);
		const buf = ctx.state.get<S[]>() ?? [];
		if (srcBatch) for (const v of srcBatch) buf.push(v as S);
		if (isTerminalComplete(srcTerminal)) {
			if (buf.length > 0) ctx.down([["DATA", [...buf]]]);
			ctx.state.set([]);
			ctx.rewireNext.unsubscribeDep(iv, body);
			ctx.down([["COMPLETE"]]);
			return;
		}
		if (isTerminalError(srcTerminal)) {
			ctx.state.set([]);
			ctx.rewireNext.unsubscribeDep(iv, body);
			ctx.down([["ERROR", terminalErrorValue(srcTerminal)]]);
			return;
		}
		if (tickBatch && tickBatch.length > 0) {
			ctx.down([["DATA", [...buf]]]);
			ctx.state.set([]);
			return;
		}
		ctx.state.set(buf);
	};
	return initNode<unknown, S[]>(
		{
			factory: "bufferTime",
			body,
			opts: {
				partial: true,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				terminalAsRealInput: true,
			},
		},
		[source as Node<unknown>, iv],
	);
}
