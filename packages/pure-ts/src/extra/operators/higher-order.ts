/**
 * Higher-order operators (roadmap §2.2) — operators whose project fn returns
 * a `NodeInput<R>` for each outer DATA. The shared `forwardInner` helper
 * subscribes to each inner node and folds its lifecycle (`COMPLETE` → finish,
 * `ERROR` → finish + propagate, `INVALIDATE`/`PAUSE`/`RESUME`/`TEARDOWN` →
 * intentionally dropped) into the outer's emit stream.
 *
 * `switchMap` (cancel-on-new), `exhaustMap` (drop-during-active), `concatMap`
 * (sequential queue), `mergeMap` / `flatMap` (parallel up to `concurrent`).
 */

import type { NodeActions } from "../../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Messages,
	RESOLVED,
	START,
} from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { trySubscribeOrDead } from "../../core/subscribe-error.js";
import { fromAny, type NodeInput } from "../sources/index.js";
import { type ExtraOpts, operatorOpts } from "./_internal.js";

/**
 * Forward an inner node's messages into the outer operator's actions.
 *
 * Returns `() => void` on a live inner subscription (caller stores in
 * its `innerUnsub` slot); returns `undefined` when the inner is Dead
 * at subscribe time (R2.2.7.b — non-resubscribable + terminal). In the
 * Dead case `onInnerComplete()` fires SYNCHRONOUSLY before returning so
 * the outer operator's tracker (switchMap's `innerUnsub`, mergeMap's
 * `innerStops` set, concatMap's queue, etc.) sees the "inner is done"
 * state before observing `undefined` as the return — i.e., when the
 * caller assigns the return value to its slot, the slot was ALREADY
 * cleared by `onInnerComplete`'s `clearInner()` / equivalent. The
 * undefined return preserves that cleared state.
 *
 * Prior shape (subscribeOr-based) had a critical bug: subscribeOr
 * returned `() => {}` no-op on Dead, which the caller assigned to its
 * `innerUnsub` slot AFTER `clearInner()` had nilled it during the
 * synchronous Dead path. Result: `innerUnsub` ended up truthy
 * (no-op closure), breaking switchMap's "source done && no inner →
 * COMPLETE" check, exhaustMap's "no inner → start next" gate, and
 * concatMap's queue-pump guard. Fix: return `undefined` so the
 * cleared state propagates to the caller's slot.
 */
function forwardInner<R>(
	inner: Node<R>,
	a: NodeActions,
	onInnerComplete: () => void,
): (() => void) | undefined {
	let finished = false;
	const finish = (): void => {
		if (finished) return;
		finished = true;
		onInnerComplete();
	};

	// R2.2.7.b: Dead inner → treat as immediate inner-Complete so the
	// *Map operator advances (mergeMap decrements active, switchMap
	// looks for the next outer DATA, concatMap drains queue, etc.).
	// Mirrors Rust higher_order.rs `on_complete_for_dead` plumbing.
	let unsubLive: (() => void) | undefined;
	const outcome = trySubscribeOrDead<unknown>(inner as Node, (msgs) => {
		let sawComplete = false;
		let sawError = false;
		for (const m of msgs as Messages) {
			if (m[0] === START) continue;
			if (m[0] === DATA) {
				a.emit(m[1] as R);
			} else if (m[0] === COMPLETE) {
				sawComplete = true;
			} else if (m[0] === ERROR) {
				sawError = true;
				a.down([m]);
			} else if (m[0] === DIRTY || m[0] === RESOLVED) {
				// Reactive wave signals forwarded to outer output.
				a.down([m]);
			}
			// INVALIDATE, PAUSE, RESUME, TEARDOWN from inner are intentionally
			// dropped. Inner lifecycle and flow-control signals are internal to
			// the *Map operator. INVALIDATE is dropped because the inner will
			// follow up with DIRTY+DATA when it recomputes — forwarding
			// INVALIDATE to the outer output's sinks is redundant and wrong for
			// mergeMap (one inner's cache state must not invalidate the whole
			// merged output). PAUSE/RESUME/TEARDOWN: RxJS/callbag precedent —
			// no backpressure forwarding in merge-style operators.
		}
		if (sawError) {
			unsubLive?.();
			unsubLive = undefined;
			finish();
		} else if (sawComplete) {
			finish();
		}
	});

	if (outcome.kind === "dead") {
		// Dead inner → fire onInnerComplete synchronously, no live
		// subscription, no cleanup closure to return.
		finish();
		return undefined;
	}

	unsubLive = outcome.unsub;
	// P4 START handshake guarantees: subscribe delivers [[START], [DATA, cache]]
	// synchronously for settled nodes. Any relevant state is already handled by
	// the callback above — no post-subscribe .status/.cache reads needed.
	return () => {
		unsubLive?.();
		unsubLive = undefined;
	};
}

/**
 * Maps each settled value to an inner node; unsubscribes the previous inner (Rx-style `switchMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via {@link fromAny}.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Emissions from the active inner subscription.
 * @example
 * ```ts
 * import { switchMap, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(0);
 * switchMap(src, (n) => state((n as number) * 2));
 * ```
 *
 * @category extra
 */
export function switchMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: ExtraOpts,
): Node<R> {
	let innerUnsub: (() => void) | undefined;
	let sourceDone = false;

	function clearInner(): void {
		innerUnsub?.();
		innerUnsub = undefined;
	}

	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			// Source ERROR: cleanup inner, autoError forwards
			if (ctx.terminalDeps[0] != null && ctx.terminalDeps[0] !== true) {
				clearInner();
				return;
			}
			// Source COMPLETE
			if (ctx.terminalDeps[0] === true) {
				sourceDone = true;
				if (!innerUnsub) a.down([[COMPLETE]]);
				// inner active: onInnerComplete will fire COMPLETE later
				return;
			}

			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return;

			// Switch: only the latest value matters; skip to the last in the
			// batch to avoid creating and immediately discarding N-1 inners.
			// clearInner() runs once to cancel any prior-wave inner.
			clearInner();
			innerUnsub = forwardInner(
				fromAny(project(batch0[batch0.length - 1] as T), { iter: true }),
				a,
				() => {
					clearInner();
					if (sourceDone) a.down([[COMPLETE]]);
				},
			);

			// Deactivate-only cleanup: must NOT fire before fn reruns
			// because the terminal wave needs to see innerUnsub intact.
			return {
				onDeactivation: () => {
					clearInner();
					sourceDone = false;
				},
			};
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			meta: { ...factoryTag("switchMap"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Like {@link switchMap}, but ignores outer `DATA` while an inner subscription is active (`exhaustMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via {@link fromAny}.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Emissions from the active inner while it runs.
 * @example
 * ```ts
 * import { exhaustMap, state } from "@graphrefly/graphrefly-ts";
 *
 * exhaustMap(state(0), () => state(1));
 * ```
 *
 * @category extra
 */
export function exhaustMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: ExtraOpts,
): Node<R> {
	let innerUnsub: (() => void) | undefined;
	let sourceDone = false;

	function clearInner(): void {
		innerUnsub?.();
		innerUnsub = undefined;
	}

	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			if (ctx.terminalDeps[0] != null && ctx.terminalDeps[0] !== true) {
				clearInner();
				return;
			}
			if (ctx.terminalDeps[0] === true) {
				sourceDone = true;
				if (!innerUnsub) a.down([[COMPLETE]]);
				return;
			}

			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return;

			if (innerUnsub === undefined) {
				// First value in batch wins (FIFO exhaustMap gate)
				innerUnsub = forwardInner(fromAny(project(batch0[0] as T), { iter: true }), a, () => {
					clearInner();
					if (sourceDone) a.down([[COMPLETE]]);
				});
			} else {
				// Inner active — drop, settle the dep-wave
				a.down([[RESOLVED]]);
			}

			return {
				onDeactivation: () => {
					clearInner();
					sourceDone = false;
				},
			};
		},
		{ ...operatorOpts(opts), completeWhenDepsComplete: false },
	);
}

/**
 * Enqueues each outer value and subscribes to inners one at a time (`concatMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via {@link fromAny}.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Sequential concatenation of inner streams.
 * @example
 * ```ts
 * import { concatMap, state } from "@graphrefly/graphrefly-ts";
 *
 * concatMap(state(0), (n) => state((n as number) + 1));
 * ```
 *
 * @category extra
 */
export function concatMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: ExtraOpts & { maxBuffer?: number },
): Node<R> {
	const { maxBuffer: maxBuf, ...concatNodeOpts } = opts ?? {};
	const queue: T[] = [];
	let innerUnsub: (() => void) | undefined;
	let sourceDone = false;
	let actions: NodeActions | undefined;

	function clearInner(): void {
		innerUnsub?.();
		innerUnsub = undefined;
	}

	function tryPump(): void {
		if (!actions || innerUnsub !== undefined) return;
		if (queue.length === 0) {
			if (sourceDone) actions.down([[COMPLETE]]);
			return;
		}
		const v = queue.shift()!;
		innerUnsub = forwardInner(fromAny(project(v), { iter: true }), actions, () => {
			clearInner();
			tryPump();
		});
	}

	function enqueue(v: T): void {
		if (maxBuf && maxBuf > 0 && queue.length >= maxBuf) queue.shift();
		queue.push(v);
		tryPump();
	}

	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			actions = a;

			if (ctx.terminalDeps[0] != null && ctx.terminalDeps[0] !== true) {
				clearInner();
				queue.length = 0;
				return;
			}
			if (ctx.terminalDeps[0] === true) {
				sourceDone = true;
				tryPump();
				return;
			}

			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return;

			for (const v of batch0 as T[]) {
				enqueue(v as T);
			}

			return {
				onDeactivation: () => {
					clearInner();
					queue.length = 0;
					sourceDone = false;
				},
			};
		},
		{ ...operatorOpts(concatNodeOpts), completeWhenDepsComplete: false },
	);
}

/** Options for {@link mergeMap}. */
export type MergeMapOptions = ExtraOpts & {
	/** Maximum number of concurrent inner subscriptions. Default: `Infinity` (unbounded). */
	concurrent?: number;
};

/**
 * Subscribes to inner nodes in parallel (up to `concurrent`) and merges outputs (`mergeMap` / `flatMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner source shape (`Node`, scalar, `PromiseLike`, `Iterable`, or `AsyncIterable`) coerced via {@link fromAny}.
 * @param opts - Optional options including `concurrent` limit.
 * @returns `Node<R>` - Merged output of all active inners; completes when the outer and every inner complete.
 *
 * @remarks
 * **ERROR handling:** An `ERROR` from the outer source cancels all active inner
 * subscriptions and propagates the error downstream. An `ERROR` from an inner
 * subscription propagates downstream immediately but does **not** cancel sibling
 * inner subscriptions — other active inners continue until they complete or the
 * outer errors/completes. This is intentional: for parallel work, isolating
 * failures per-inner is more useful than Rx-style "first error cancels all."
 *
 * @example
 * ```ts
 * import { mergeMap, state } from "@graphrefly/graphrefly-ts";
 *
 * // Unbounded (default)
 * mergeMap(state(0), (n) => state((n as number) + 1));
 *
 * // Limited concurrency
 * mergeMap(state(0), (n) => state((n as number) + 1), { concurrent: 3 });
 * ```
 *
 * @category extra
 */
export function mergeMap<T, R>(
	source: Node<T>,
	project: (value: T) => NodeInput<R>,
	opts?: MergeMapOptions,
): Node<R> {
	const { concurrent: concurrentOpt, ...mergeNodeOpts } = opts ?? {};
	const maxConcurrent =
		concurrentOpt != null && concurrentOpt > 0 ? concurrentOpt : Number.POSITIVE_INFINITY;

	let active = 0;
	let sourceDone = false;
	const innerStops = new Set<() => void>();
	const buffer: T[] = [];
	let actions: NodeActions | undefined;

	function tryComplete(): void {
		if (sourceDone && active === 0 && buffer.length === 0 && actions) {
			actions.down([[COMPLETE]]);
		}
	}

	function spawn(v: T): void {
		if (!actions) return;
		active++;
		// Use `let` (not `const`) so the closure can reference `stop` safely even
		// if onInnerComplete fires synchronously (e.g. already-completed inner node).
		let stop: (() => void) | undefined;
		stop = forwardInner(fromAny(project(v), { iter: true }), actions, () => {
			if (stop) innerStops.delete(stop);
			active--;
			drainBuffer();
			tryComplete();
		});
		// forwardInner returns `undefined` for Dead inners (R2.2.7.b);
		// the onInnerComplete callback has already decremented `active`
		// and run drainBuffer/tryComplete synchronously. Nothing to
		// register in `innerStops`.
		if (stop) innerStops.add(stop);
	}

	function drainBuffer(): void {
		while (buffer.length > 0 && active < maxConcurrent) {
			spawn(buffer.shift()!);
		}
	}

	function enqueue(v: T): void {
		if (active < maxConcurrent) spawn(v);
		else buffer.push(v);
	}

	function clearAll(): void {
		for (const u of innerStops) u();
		innerStops.clear();
		active = 0;
		buffer.length = 0;
	}

	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			actions = a;

			if (ctx.terminalDeps[0] != null && ctx.terminalDeps[0] !== true) {
				clearAll();
				return;
			}
			if (ctx.terminalDeps[0] === true) {
				sourceDone = true;
				tryComplete();
				return;
			}

			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) return;

			for (const v of batch0 as T[]) {
				enqueue(v as T);
			}

			return {
				onDeactivation: () => {
					clearAll();
					sourceDone = false;
				},
			};
		},
		{ ...operatorOpts(mergeNodeOpts), completeWhenDepsComplete: false },
	);
}

/**
 * RxJS-named alias for {@link mergeMap} — projects each `DATA` to an inner node and merges outputs.
 *
 * @param source - Upstream node.
 * @param project - Returns an inner `Node<R>` per value.
 * @param opts - Optional concurrency cap and node options (excluding `describeKind`).
 * @returns Merged projection; behavior matches `mergeMap`.
 *
 * @example
 * ```ts
 * import { flatMap, state } from "@graphrefly/graphrefly-ts";
 *
 * flatMap(state(0), (n) => state(n));
 * ```
 *
 * @category extra
 */
export const flatMap = mergeMap;
