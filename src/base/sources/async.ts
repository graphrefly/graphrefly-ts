/**
 * Async sources, sinks, and multicast — presentation layer.
 *
 * `fromPromise`, `fromAsyncIter`, `fromAny` are substrate primitives; they are
 * re-exported here from `@graphrefly/pure-ts` for ergonomic single-import use.
 * This file owns the presentation-only async utilities: `defer`, `forEach`,
 * `toArray`, `share`, `replay`, `cached`, `shareReplay`.
 *
 * `singleFromAny` and `singleNodeFromAny` (keyed singleflight) live in
 * `base/composition/single-from-any.ts`.
 */

import { COMPLETE, DATA, ERROR, RESOLVED, START } from "@graphrefly/pure-ts/core";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";
import { type AsyncSourceOpts, type NodeInput, sourceOpts, wrapSubscribeHook } from "@graphrefly/pure-ts/extra";

/** Options for presentation-layer async operators: NodeOptions without `describeKind`. */
type ExtraOpts = Omit<NodeOptions, "describeKind">;

// Import fromAny from substrate — used internally by defer. The three async
// substrate sources (fromAny, fromAsyncIter, fromPromise) are already
// re-exported from @graphrefly/pure-ts; do NOT re-export here to avoid
// duplicate-export conflicts at the root barrel level.
import { fromAny } from "@graphrefly/pure-ts/extra";

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
