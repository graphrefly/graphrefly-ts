/**
 * Async sources, sinks, and multicast — Promise / AsyncIterable / NodeInput
 * bridges plus the share / replay / cached / toArray composition family.
 *
 * `singleFromAny` and `singleNodeFromAny` (keyed singleflight) live in
 * `extra/single-from-any.ts` and are re-surfaced here.
 *
 * Lazy-loaded `awaitSettled` bridge to `extra/resilience.ts` lives in
 * `settled.ts` so this file stays free of resilience-side imports.
 */

import { COMPLETE, DATA, ERROR, RESOLVED, START } from "../../core/messages.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import {
	type AsyncSourceOpts,
	type ExtraOpts,
	isNode,
	isThenable,
	type NodeInput,
	sourceOpts,
	wrapSubscribeHook,
} from "./_internal.js";
import { fromIter, of } from "./iter.js";

/**
 * Lifts a Promise (or thenable) to a single-value stream: one `DATA` then `COMPLETE`, or `ERROR` on rejection.
 *
 * @param p - Promise to await.
 * @param opts - Producer options plus optional `signal` for abort → `ERROR` with reason.
 * @returns `Node<T>` — settles once.
 *
 * @example
 * ```ts
 * import { fromPromise } from "@graphrefly/graphrefly-ts";
 *
 * fromPromise(Promise.resolve(42));
 * ```
 *
 * @category extra
 */
export function fromPromise<T>(p: Promise<T> | PromiseLike<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal, ...rest } = opts ?? {};
	return node<T>((_data, a) => {
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		void Promise.resolve(p).then(
			(v) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				a.emit(v as T);
				a.down([[COMPLETE]]);
			},
			(e) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				a.down([[ERROR, e]]);
			},
		);
		return () => {
			settled = true;
			signal?.removeEventListener("abort", onAbort);
		};
	}, sourceOpts(rest));
}

/**
 * Reads an async iterable; each `next()` value becomes `DATA`; `COMPLETE` when done; `ERROR` on failure.
 *
 * @param iterable - Async source (`for await` shape).
 * @param opts - Producer options plus optional `signal` to abort the pump.
 * @returns `Node<T>` — async pull stream.
 *
 * @example
 * ```ts
 * import { fromAsyncIter } from "@graphrefly/graphrefly-ts";
 *
 * async function* gen() {
 *   yield 1;
 * }
 * fromAsyncIter(gen());
 * ```
 *
 * @category extra
 */
export function fromAsyncIter<T>(iterable: AsyncIterable<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal: outerSignal, ...rest } = opts ?? {};
	return node<T>((_data, a) => {
		const ac = new AbortController();
		const onOuterAbort = () => ac.abort(outerSignal?.reason);
		if (outerSignal?.aborted) {
			ac.abort(outerSignal.reason);
		} else {
			outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
		}
		const signal = outerSignal ?? ac.signal;
		let cancelled = false;
		const it = iterable[Symbol.asyncIterator]();
		// Each pump() call chains directly into the next via Promise.then —
		// no queueMicrotask needed; Promise resolution already yields to the
		// microtask queue. COMPLETE is delivered synchronously after the last
		// value, same as fromIter semantics.
		const pump = (): void => {
			if (cancelled || signal.aborted) return;
			void Promise.resolve(it.next()).then(
				(step) => {
					if (cancelled || signal.aborted) return;
					if (step.done) {
						a.down([[COMPLETE]]);
						return;
					}
					a.emit(step.value as T);
					pump();
				},
				(e) => {
					if (!cancelled && !signal.aborted) a.down([[ERROR, e]]);
				},
			);
		};
		pump();
		return () => {
			cancelled = true;
			outerSignal?.removeEventListener("abort", onOuterAbort);
			ac.abort();
			void Promise.resolve(it.return?.()).catch(() => undefined);
		};
	}, sourceOpts(rest));
}

/**
 * Coerces a value to a `Node` by shape, treating sync values as **single
 * DATA payloads** by default (including arrays, Sets, Maps, and other sync
 * iterables). For per-element streaming over a sync iterable, pass
 * `{ iter: true }` to opt into {@link fromIter} dispatch.
 *
 * Dispatch table (default — `iter !== true`):
 * - existing `Node` → passthrough
 * - thenable → {@link fromPromise} (one DATA on resolve)
 * - async iterable → {@link fromAsyncIter} (per-yield DATA stream)
 * - everything else (scalar, array, Set, Map, generator, ...) → {@link of}
 *   (one DATA + COMPLETE; sync values emit immediately at subscribe time)
 *
 * Dispatch table (with `{ iter: true }`):
 * - same as above EXCEPT sync iterables (incl. arrays / Sets / Maps) →
 *   {@link fromIter} (per-element DATA stream)
 *
 * **Why arrays default to single-value semantics (DS-13.5 follow-up,
 * 2026-05-01):** the previous implementation dispatched every sync iterable
 * to `fromIter`, which conflated "I have a list-shaped value" (most common
 * caller intent — `tier.list()`, snapshot arrays, batched results) with "I
 * have a stream of N values to emit one-by-one." The footgun bit the
 * `processManager` restore pipeline. Pre-1.0 lock: per-element streaming is
 * an explicit opt via `{ iter: true }` OR an explicit `fromIter(...)` call;
 * everything else is a value.
 *
 * @param input - Any value to wrap.
 * @param opts - Passed through when a Promise/async path is chosen.
 *   `iter: true` opts a sync iterable into per-element streaming.
 * @returns `Node` of the inferred element type.
 *
 * @example
 * ```ts
 * import { fromAny, state } from "@graphrefly/graphrefly-ts";
 *
 * fromAny(state(1));                        // Node passthrough
 * fromAny(Promise.resolve(2));              // one DATA on resolve
 * fromAny([1, 2, 3]);                       // one DATA = [1, 2, 3]
 * fromAny([1, 2, 3], { iter: true });       // three DATA: 1, 2, 3
 * fromAny(asyncGenerator());                // per-yield DATA stream
 * ```
 *
 * @category extra
 */
export function fromAny<T>(
	input: NodeInput<T>,
	opts?: AsyncSourceOpts & { iter?: boolean },
): Node<T> {
	if (isNode(input)) {
		return input as Node<T>;
	}
	if (isThenable(input)) {
		return fromPromise(input as PromiseLike<T>, opts);
	}
	if (input !== null && input !== undefined) {
		const candidate = input as { [Symbol.asyncIterator]?: unknown; [Symbol.iterator]?: unknown };
		if (typeof candidate[Symbol.asyncIterator] === "function") {
			return fromAsyncIter(input as AsyncIterable<T>, opts);
		}
		if (opts?.iter === true && typeof candidate[Symbol.iterator] === "function") {
			return fromIter(input as Iterable<T>, opts);
		}
	}
	// Default: treat as single value. `of(input)` emits one DATA + COMPLETE
	// synchronously at subscribe time, regardless of whether the value is a
	// scalar, array, Set, Map, generator, or anything else. Per-element
	// streaming requires explicit `{ iter: true }` or `fromIter(...)`.
	return of(input as T);
}

/**
 * Lazily constructs a {@link Node} from a thunk that runs at **activation
 * time** (first subscriber after a teardown to zero sinks), not factory time.
 *
 * **Resubscribable by default.** Diverges from `fromPromise` / `fromIter` /
 * `fromAsyncIter` (which are single-shot — second subscriber sees the cached
 * terminal value). `defer`'s contract matches RxJS `defer`: every fresh
 * activation cycle re-runs the thunk. To opt out and get one-shot semantics,
 * pass `{ resubscribable: false }`.
 *
 * **Sharing across overlapping subscribers.** The thunk only re-runs on a
 * fresh activation cycle (zero → one sink). Overlapping subscribers share
 * the single activation; the thunk does NOT re-run for each subscriber. If
 * the thunk returns an existing `Node`, that Node is shared across activations
 * — `defer` will subscribe to it on each activation but does not isolate state
 * across subscribers. For per-subscriber isolation, the thunk must construct
 * a fresh source (`state(...)`, `fromPromise(fetch(...))`, etc.) on each call.
 *
 * **Use cases:**
 * - Lazy upstream construction (avoid eager evaluation of expensive factories
 *   at module load — the thunk runs only when something subscribes).
 * - Per-activation resource construction (open a connection / file handle on
 *   subscribe, when paired with full teardown between sessions).
 * - Bridging non-Node inputs (Promise, AsyncIterable, Iterable, scalar) into
 *   the graph behind a lazy boundary.
 *
 * The thunk's return value is bridged via {@link fromAny}. Errors thrown by
 * the thunk surface as a single `[[ERROR, err]]` on the output (with `err`
 * coerced to a non-`undefined` value to satisfy spec §1.3 — bare `throw` and
 * `throw undefined` are wrapped in a `defer: thunk threw undefined` Error).
 *
 * Upstream messages are forwarded transparently (DIRTY / DATA / RESOLVED /
 * COMPLETE / ERROR / INVALIDATE / PAUSE / RESUME / TEARDOWN), preserving
 * batch boundaries. The producer's own `START` handshake is delivered to
 * subscribers automatically; the upstream's `START` is filtered.
 *
 * @param thunk - Called on each activation; returns the upstream input.
 * @param opts - Forwarded to `fromAny` (e.g. `signal` for async inputs).
 *   `signal` is only consumed by `fromAny` for async input shapes (Promise,
 *   AsyncIterable); it does NOT abort a Node-input or scalar-input defer.
 * @returns `Node<T>` — lazy upstream-on-activation.
 *
 * @example
 * ```ts
 * import { defer } from "@graphrefly/graphrefly-ts";
 *
 * // Lazy fetch — runs on the first activation, NOT at factory time.
 * // Each fresh activation cycle (after teardown) re-runs the thunk →
 * // a new fetch. Overlapping subscribers share the single activation.
 * const live = defer(() => fetch("/api/feed").then((r) => r.json()));
 * ```
 *
 * @category extra
 */
export function defer<T>(thunk: () => NodeInput<T>, opts?: AsyncSourceOpts): Node<T> {
	// A4: strip `signal` before forwarding to NodeOptions — sibling sources
	// (fromTimer / fromPromise / fromAsyncIter) destructure first; signal
	// continues to flow into fromAny(input, opts) for async input shapes.
	const { signal: _sig, ...nodeOpts } = (opts ?? {}) as AsyncSourceOpts;
	const sOpts = sourceOpts<T>(nodeOpts);
	const merged = sOpts.resubscribable === undefined ? { ...sOpts, resubscribable: true } : sOpts;
	return node<T>((_data, a) => {
		let unsub: (() => void) | undefined;
		let stopped = false;
		try {
			const input = thunk();
			// `iter: true` preserves defer's RxJS-aligned per-element
			// streaming for sync iterable thunk returns (post DS-13.5
			// fromAny default flip; defer's documented contract is
			// "forwards iterable values" per-element).
			const src = fromAny(input, { ...opts, iter: true });
			unsub = src.subscribe((msgs) => {
				if (stopped) return;
				for (const m of msgs) {
					const t = m[0];
					if (t === START) continue; // producer's own START is delivered separately
					if (t === DATA) {
						a.emit(m[1] as T);
					} else if (t === COMPLETE) {
						stopped = true;
						a.down([[COMPLETE]]);
						break; // A2: don't forward post-terminal messages in the same batch
					} else if (t === ERROR) {
						stopped = true;
						a.down([[ERROR, m[1]]]);
						break; // A2
					} else {
						// Forward DIRTY / RESOLVED / INVALIDATE / PAUSE / RESUME /
						// TEARDOWN, plus any unknown types (spec §1.3.6 forward-compat).
						a.down([m]);
					}
				}
			});
		} catch (err) {
			// A5: spec §1.3 — ERROR payload must not be undefined. Wrap a
			// `throw` or `throw undefined` so dispatch doesn't reject the emit.
			const safe = err === undefined ? new Error("defer: thunk threw undefined") : err;
			a.down([[ERROR, safe]]);
		}
		return () => {
			stopped = true;
			unsub?.();
		};
	}, merged);
}

/**
 * Subscribes immediately and runs `fn` for each upstream `DATA`; returns unsubscribe.
 *
 * @param source - Upstream node.
 * @param fn - Side effect per value.
 * @param opts - Effect node options.
 * @returns Unsubscribe function (idempotent).
 *
 * @example
 * ```ts
 * import { forEach, state } from "@graphrefly/graphrefly-ts";
 *
 * const u = forEach(state(1), (v) => console.log(v));
 * u();
 * ```
 *
 * @category extra
 */
export function forEach<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): () => void {
	const inner = node(
		[source as Node],
		(data, _actions) => {
			const batch0 = data[0];
			if (batch0 != null && batch0.length > 0) {
				for (const v of batch0) fn(v as T);
			}
		},
		{ describeKind: "effect", ...opts } as NodeOptions,
	);
	return inner.subscribe(() => {});
}

/**
 * Buffers every `DATA`; on upstream `COMPLETE` emits one `DATA` with the full array then `COMPLETE`.
 *
 * @param source - Upstream node.
 * @param opts - Optional node options (derived describe kind).
 * @returns `Node<T[]>` — single array emission before completion.
 *
 * @example
 * ```ts
 * import { of, toArray } from "@graphrefly/graphrefly-ts";
 *
 * toArray(of(1, 2, 3));
 * ```
 *
 * @category extra
 */
export function toArray<T>(source: Node<T>, opts?: ExtraOpts): Node<T[]> {
	// Lock 6.D (Phase 13.6.B): clear the accumulator buffer on
	// deactivation so a resubscribable toArray restarts with an empty
	// array on the next cycle — pre-flip this came for free via
	// `_deactivate`'s store wipe.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<T[]>(
		[source as Node],
		(data, actions, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.buf;
					},
				};
			}
			if (!ctx.store.buf) ctx.store.buf = [];
			const buf = ctx.store.buf as T[];
			// Accumulate DATA first — must happen before the COMPLETE check so
			// that a same-wave DATA+COMPLETE batch (e.g. fromTimer one-shot,
			// fromIter last item) is included in the emitted array.
			const batch0 = data[0];
			if (batch0 != null && batch0.length > 0) {
				for (const v of batch0) buf.push(v as T);
			}
			// COMPLETE: emit accumulated array then complete.
			// ERROR: autoError propagates; do NOT emit the partial buffer.
			if (ctx.terminalDeps[0] === true) {
				actions.emit([...buf]);
				actions.down([[COMPLETE]]);
				return cleanup;
			}
			// RESOLVED wave: propagate RESOLVED. Covers first-wave case; after first
			// call the pre-fn skip handles this automatically.
			if (batch0 == null || batch0.length === 0) {
				actions.down([[RESOLVED]]);
			}
			return cleanup;
		},
		{
			describeKind: "derived",
			completeWhenDepsComplete: false,
			...opts,
		} as NodeOptions<T[]>,
	);
}

/**
 * Multicasts upstream: one subscription to `source` while this wrapper has subscribers (via {@link producer}).
 *
 * @param source - Upstream node to share.
 * @param opts - Producer options; `initial` seeds from `source.cache` when set by factory.
 * @returns `Node<T>` — hot ref-counted bridge.
 *
 * @example
 * ```ts
 * import { share, state } from "@graphrefly/graphrefly-ts";
 *
 * share(state(0));
 * ```
 *
 * @category extra
 */
export function share<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return node<T>(
		(_data, a) =>
			source.subscribe((msgs) => {
				a.down(msgs);
			}),
		{ ...sourceOpts<T>(opts), initial: source.cache },
	);
}

/**
 * Like {@link share} with a bounded replay buffer: new subscribers receive the last `bufferSize`
 * `DATA` payloads (as separate batches) before live updates.
 *
 * @param source - Upstream node.
 * @param bufferSize - Maximum past values to replay (≥ 1).
 * @param opts - Producer options.
 * @returns `Node<T>` — multicast with replay on subscribe.
 *
 * @example
 * ```ts
 * import { replay, state } from "@graphrefly/graphrefly-ts";
 *
 * replay(state(0), 3);
 * ```
 *
 * @category extra
 */
export function replay<T>(source: Node<T>, bufferSize: number, opts?: ExtraOpts): Node<T> {
	if (bufferSize < 1) throw new RangeError("replay expects bufferSize >= 1");
	const buf: T[] = [];
	const inner = node<T>(
		(_data, a) =>
			source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						buf.push(m[1] as T);
						if (buf.length > bufferSize) buf.shift();
					}
				}
				a.down(msgs);
			}),
		{ ...sourceOpts<T>(opts), initial: source.cache },
	);
	return wrapSubscribeHook(inner, (sink) => {
		for (const v of buf) {
			sink([[DATA, v]]);
		}
	});
}

/**
 * {@link replay} with `bufferSize === 1` — replays the latest `DATA` to new subscribers.
 *
 * @param source - Upstream node.
 * @param opts - Producer options.
 * @returns `Node<T>` — share + last-value replay.
 *
 * @example
 * ```ts
 * import { cached, state } from "@graphrefly/graphrefly-ts";
 *
 * cached(state(0));
 * ```
 *
 * @category extra
 */
export function cached<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return replay(source, 1, opts);
}

// ——————————————————————————————————————————————————————————————
//  RxJS-compatible aliases
// ——————————————————————————————————————————————————————————————

/**
 * RxJS-named alias for {@link replay} — multicast with a replay buffer of size `bufferSize`.
 *
 * @param source - Upstream node.
 * @param bufferSize - Replay depth (≥ 1).
 * @param opts - Producer options.
 * @returns Same behavior as `replay`.
 *
 * @example
 * ```ts
 * import { shareReplay, state } from "@graphrefly/graphrefly-ts";
 *
 * shareReplay(state(0), 5);
 * ```
 *
 * @category extra
 */
export const shareReplay = replay;
