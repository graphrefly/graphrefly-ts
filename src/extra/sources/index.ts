/**
 * Core reactive sources, sinks, and utilities (roadmap §2.3).
 *
 * Each API returns a {@link Node} built with {@link node}, {@link producer},
 * {@link derived}, or {@link effect} — no second protocol.
 *
 * Protocol/system/ingest adapters (fromHTTP, fromWebSocket, fromKafka, etc.)
 * live in {@link ./adapters.ts}.
 */

import { wallClockNs } from "../../core/clock.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, START } from "../../core/messages.js";
import { type Node, type NodeOptions, type NodeSink, node } from "../../core/node.js";
import { producer, state } from "../../core/sugar.js";
import { type CronSchedule, matchesCron, parseCron } from "../cron.js";

type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

function sourceOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

/** Options for {@link fromTimer} / {@link fromPromise} / {@link fromAsyncIter}. */
export type AsyncSourceOpts = ExtraOpts & { signal?: AbortSignal };

/**
 * Values accepted by {@link fromAny}.
 *
 * @category extra
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

/** Options for {@link fromCron}. */
export type FromCronOptions = ExtraOpts & {
	/** Polling interval in ms. Default `60_000`. */
	tickMs?: number;
	/** Output format: `"timestamp_ns"` (default) emits wall-clock nanoseconds; `"date"` emits a `Date` object. */
	output?: "timestamp_ns" | "date";
};

/** DOM-style event target (browser or `node:events`). */
export type EventTargetLike = {
	addEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
	removeEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
};

/** @internal Shared with adapters.ts and sources-fs.ts for glob matching. */
export function escapeRegexChar(ch: string): string {
	return /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
}

/** @internal */
export function globToRegExp(glob: string): RegExp {
	let out = "^";
	for (let i = 0; i < glob.length; i += 1) {
		const ch = glob[i];
		if (ch === "*") {
			const next = glob[i + 1];
			if (next === "*") {
				out += ".*";
				i += 1;
			} else {
				out += "[^/]*";
			}
			continue;
		}
		out += escapeRegexChar(ch);
	}
	out += "$";
	return new RegExp(out);
}

/** @internal */
export function matchesAnyPattern(path: string, patterns: RegExp[]): boolean {
	for (const pattern of patterns) {
		if (pattern.test(path)) return true;
	}
	return false;
}

function wrapSubscribeHook<T>(inner: Node<T>, before: (sink: NodeSink) => void): Node<T> {
	// node() passthrough instead of derived([inner], ([v]) => v) — derived uses
	// .at(-1) and would drop intermediate values from multi-DATA batches (D1 gap).
	const wrapper = node<T>(
		[inner as Node],
		(data, a) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) a.emit(v as T);
		},
		{ describeKind: "derived", initial: inner.cache as T },
	);
	const origSubscribe = wrapper.subscribe.bind(wrapper);
	(wrapper as { subscribe: typeof wrapper.subscribe }).subscribe = (sink, actor) => {
		before(sink);
		return origSubscribe(sink, actor);
	};
	return wrapper;
}

/**
 * Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …).
 *
 * @param ms - Milliseconds before the first emission.
 * @param opts - Producer options plus optional `period` for repeating ticks and optional `signal` (`AbortSignal`) to cancel with `ERROR`.
 * @returns `Node<number>` — tick counter from `0`; teardown clears timers.
 *
 * @example
 * ```ts
 * import { fromTimer } from "@graphrefly/graphrefly-ts";
 *
 * fromTimer(250, { period: 1_000 });
 * ```
 *
 * @category extra
 */
export function fromTimer(ms: number, opts?: AsyncSourceOpts & { period?: number }): Node<number> {
	const { signal, period, ...rest } = opts ?? {};
	return producer<number>((a) => {
		let done = false;
		let count = 0;
		let t: ReturnType<typeof setTimeout> | undefined;
		let iv: ReturnType<typeof setInterval> | undefined;
		const cleanup = () => {
			done = true;
			if (t !== undefined) clearTimeout(t);
			if (iv !== undefined) clearInterval(iv);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = () => {
			if (done) return;
			if (period != null) {
				a.emit(count++);
				iv = setInterval(() => {
					if (done) return;
					a.emit(count++);
				}, period);
			} else {
				// One-shot: mark done, emit, complete synchronously.
				// a.emit() delivers DATA to downstream synchronously before
				// COMPLETE arrives — no queueMicrotask needed.
				done = true;
				signal?.removeEventListener("abort", onAbort);
				a.emit(count++);
				a.down([[COMPLETE]]);
			}
		};
		const onAbort = () => {
			if (done) return;
			cleanup();
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		t = setTimeout(finish, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		return cleanup;
	}, sourceOpts(rest));
}

/**
 * Animation-frame-driven source. Emits on every `requestAnimationFrame` tick,
 * yielding the frame timestamp (DOMHighResTimeStamp, ms since navigation).
 *
 * Use instead of `fromTimer({ period: 16 })` when animation smoothness matters.
 * In a real browser, `requestAnimationFrame` synchronizes with the display
 * refresh. The source keeps ticking even when the tab is hidden — it
 * transparently switches to `setTimeout` while the tab is backgrounded (so
 * downstream state updates continue) and returns to `requestAnimationFrame`
 * when the tab regains focus.
 *
 * When `requestAnimationFrame` is unavailable (Node test environments, SSR),
 * this falls back to `setTimeout(~16ms)` unconditionally. Abortable via
 * `signal` (emits `ERROR`).
 *
 * @example
 * ```ts
 * import { fromRaf, derived } from "@graphrefly/graphrefly-ts";
 *
 * const frame = fromRaf();
 * const bouncingX = derived([frame], ([t]) => 50 + 40 * Math.sin((t as number) * 0.001));
 * ```
 *
 * @category extra
 */
export function fromRaf(opts?: AsyncSourceOpts): Node<number> {
	const { signal, ...rest } = opts ?? {};
	return producer<number>((a) => {
		let done = false;
		let rafId: number | undefined;
		let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
		let abortListenerAdded = false;
		let visibilityListenerAdded = false;

		const raf: typeof requestAnimationFrame | undefined =
			typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined;
		const caf: typeof cancelAnimationFrame | undefined =
			typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined;
		const doc: Document | undefined = typeof document !== "undefined" ? document : undefined;

		const clearPending = () => {
			if (rafId !== undefined && caf) caf(rafId);
			if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
			rafId = undefined;
			fallbackTimer = undefined;
		};
		const cleanup = () => {
			done = true;
			clearPending();
			if (abortListenerAdded) {
				signal?.removeEventListener("abort", onAbort);
				abortListenerAdded = false;
			}
			if (visibilityListenerAdded && doc) {
				doc.removeEventListener("visibilitychange", onVisibilityChange);
				visibilityListenerAdded = false;
			}
		};
		const onAbort = () => {
			if (done) return;
			cleanup();
			a.down([[ERROR, signal!.reason]]);
		};
		const tick = (now: number) => {
			if (done) return;
			a.emit(now);
			scheduleNext();
		};
		const scheduleNext = () => {
			if (done) return;
			// Prefer rAF for display-synced ticks when the tab is visible; when
			// hidden, rAF is throttled to ~0 by the browser, so fall back to
			// setTimeout so downstream state continues updating.
			if (raf && (!doc || doc.visibilityState !== "hidden")) {
				rafId = raf(tick);
			} else {
				fallbackTimer = setTimeout(() => tick(performance.now()), 16);
			}
		};
		const onVisibilityChange = () => {
			if (done) return;
			// Cancel any pending schedule and re-schedule via the path now
			// appropriate for the current visibility state.
			clearPending();
			scheduleNext();
		};

		if (signal?.aborted) {
			onAbort();
			return cleanup;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		abortListenerAdded = signal !== undefined;
		if (doc && raf) {
			doc.addEventListener("visibilitychange", onVisibilityChange);
			visibilityListenerAdded = true;
		}
		scheduleNext();
		return cleanup;
	}, sourceOpts(rest));
}

/**
 * Polls on an interval; when the current minute matches a 5-field cron expression, emits once (see {@link parseCron}).
 *
 * @param expr - Cron string (`min hour dom month dow`).
 * @param opts - Producer options plus `tickMs` (default `60_000`) and `output` (`timestamp_ns` default, or `date` for `Date` values).
 * @returns `Node<number>` (nanosecond timestamp) or `Node<Date>` when `output: "date"`.
 *
 * @example
 * ```ts
 * import { fromCron } from "@graphrefly/graphrefly-ts";
 *
 * fromCron("0 9 * * 1");
 * ```
 *
 * @category extra
 */
export function fromCron(expr: string, opts?: FromCronOptions & { output: "date" }): Node<Date>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number | Date> {
	const schedule: CronSchedule = parseCron(expr);
	const { tickMs: tickOpt, output, ...rest } = opts ?? {};
	const tickMs = tickOpt ?? 60_000;
	const emitDate = output === "date";
	return producer<number | Date>(
		(a) => {
			let lastFiredKey = -1;
			const check = () => {
				const now = new Date();
				const key =
					now.getFullYear() * 100_000_000 +
					(now.getMonth() + 1) * 1_000_000 +
					now.getDate() * 10_000 +
					now.getHours() * 100 +
					now.getMinutes();
				if (key !== lastFiredKey && matchesCron(schedule, now)) {
					lastFiredKey = key;
					a.emit(emitDate ? now : wallClockNs());
				}
			};
			check();
			const id = setInterval(check, tickMs);
			return () => clearInterval(id);
		},
		{ ...sourceOpts(rest), name: rest.name ?? `cron:${expr}` },
	);
}

/**
 * Wraps a DOM-style `addEventListener` target; each event becomes a `DATA` emission.
 *
 * @param target - Object with `addEventListener` / `removeEventListener`.
 * @param type - Event name (e.g. `"click"`).
 * @param opts - Producer options plus listener options (`capture`, `passive`, `once`).
 * @returns `Node<T>` — event payloads; teardown removes the listener.
 *
 * @example
 * ```ts
 * import { fromEvent } from "@graphrefly/graphrefly-ts";
 *
 * fromEvent(document.body, "click");
 * ```
 *
 * @category extra
 */
export function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts?: ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean },
): Node<T> {
	const { capture, passive, once, ...rest } = opts ?? {};
	return producer<T>((a) => {
		const handler = (e: unknown) => {
			a.emit(e as T);
		};
		const options = { capture, passive, once };
		target.addEventListener(type, handler, options);
		return () => target.removeEventListener(type, handler, options);
	}, sourceOpts(rest));
}

/**
 * Drains a synchronous iterable; each item is `DATA`, then `COMPLETE`, or `ERROR` if iteration throws.
 *
 * @param iterable - Values to emit in order.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — one emission per element.
 *
 * @example
 * ```ts
 * import { fromIter } from "@graphrefly/graphrefly-ts";
 *
 * fromIter([1, 2, 3]);
 * ```
 *
 * @category extra
 */
export function fromIter<T>(iterable: Iterable<T>, opts?: ExtraOpts): Node<T> {
	return producer<T>((a) => {
		let cancelled = false;
		try {
			for (const x of iterable) {
				if (cancelled) return;
				a.emit(x);
			}
			if (!cancelled) a.down([[COMPLETE]]);
		} catch (e) {
			if (!cancelled) a.down([[ERROR, e]]);
		}
		return () => {
			cancelled = true;
		};
	}, sourceOpts(opts));
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

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
	return producer<T>((a) => {
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
	return producer<T>((a) => {
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

function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node).subscribe === "function"
	);
}

/**
 * Coerces a value to a `Node` by shape: existing `Node` passthrough, thenable → {@link fromPromise},
 * async iterable → {@link fromAsyncIter}, sync iterable → {@link fromIter}, else scalar → {@link of}.
 *
 * @param input - Any value to wrap.
 * @param opts - Passed through when a Promise/async path is chosen.
 * @returns `Node` of the inferred element type.
 *
 * @example
 * ```ts
 * import { fromAny, state } from "@graphrefly/graphrefly-ts";
 *
 * fromAny(state(1));
 * fromAny(Promise.resolve(2));
 * ```
 *
 * @category extra
 */
export function fromAny<T>(input: NodeInput<T>, opts?: AsyncSourceOpts): Node<T> {
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
		if (typeof candidate[Symbol.iterator] === "function") {
			return fromIter(input as Iterable<T>, opts);
		}
	}
	// scalar fallback
	return of(input as T);
}

/**
 * Emits each argument as `DATA` in order, then `COMPLETE` (implemented via {@link fromIter}).
 *
 * @param values - Values to emit.
 * @returns `Node<T>` — finite sequence.
 *
 * @example
 * ```ts
 * import { of } from "@graphrefly/graphrefly-ts";
 *
 * of(1, 2, 3);
 * ```
 *
 * @category extra
 */
export function of<T>(...values: T[]): Node<T> {
	return fromIter(values, undefined);
}

/**
 * Completes immediately with no `DATA` (cold `EMPTY` analogue).
 *
 * @param opts - Optional producer options.
 * @returns `Node<T>` — terminal `COMPLETE` only.
 *
 * @example
 * ```ts
 * import { empty } from "@graphrefly/graphrefly-ts";
 *
 * empty();
 * ```
 *
 * @category extra
 */
export function empty<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>((a) => {
		a.down([[COMPLETE]]);
		return undefined;
	}, sourceOpts(opts));
}

/**
 * Never emits and never completes until teardown (cold `NEVER` analogue).
 *
 * @param opts - Optional producer options.
 * @returns `Node<T>` — silent until unsubscribed.
 *
 * @example
 * ```ts
 * import { never } from "@graphrefly/graphrefly-ts";
 *
 * never();
 * ```
 *
 * @category extra
 */
export function never<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>(() => undefined, sourceOpts(opts));
}

/**
 * Emits `ERROR` as soon as the producer starts (cold error source).
 *
 * @param err - Error payload forwarded as `ERROR` data.
 * @param opts - Optional producer options.
 * @returns `Node<never>` — terminates with `ERROR`.
 *
 * @example
 * ```ts
 * import { throwError } from "@graphrefly/graphrefly-ts";
 *
 * throwError(new Error("fail"));
 * ```
 *
 * @category extra
 */
export function throwError(err: unknown, opts?: ExtraOpts): Node<never> {
	return producer<never>((a) => {
		a.down([[ERROR, err]]);
		return undefined;
	}, sourceOpts(opts));
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
	return producer<T>((a) => {
		let unsub: (() => void) | undefined;
		let stopped = false;
		try {
			const input = thunk();
			const src = fromAny(input, opts);
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
	return node<T[]>(
		[source as Node],
		(data, actions, ctx) => {
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
				return;
			}
			// RESOLVED wave: propagate RESOLVED. Covers first-wave case; after first
			// call the pre-fn skip handles this automatically.
			if (batch0 == null || batch0.length === 0) {
				actions.down([[RESOLVED]]);
			}
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
	return producer<T>(
		(a) =>
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
	const inner = producer<T>(
		(a) =>
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

/**
 * Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data.
 *
 * **Important:** This subscribes and waits for a **future** emission. Data that
 * has already flowed is gone and will not be seen. Call this *before* the upstream
 * emits, or use `source.cache` / `source.status` for already-cached state.
 * See COMPOSITION-GUIDE §2 (subscription ordering).
 *
 * @param source - Node to read once.
 * @returns Promise of the first value.
 *
 * @example
 * ```ts
 * import { firstValueFrom, of } from "@graphrefly/graphrefly-ts";
 *
 * await firstValueFrom(of(42));
 * ```
 *
 * @category extra
 */
export function firstValueFrom<T>(source: Node<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let shouldUnsub = false;
		let unsub: (() => void) | undefined;
		unsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (settled) return;
				if (m[0] === DATA) {
					settled = true;
					resolve(m[1] as T);
					if (unsub) {
						unsub();
						unsub = undefined;
					} else shouldUnsub = true;
					return;
				}
				if (m[0] === ERROR) {
					settled = true;
					reject(m[1]);
					if (unsub) {
						unsub();
						unsub = undefined;
					} else shouldUnsub = true;
					return;
				}
				if (m[0] === COMPLETE) {
					settled = true;
					reject(new Error("completed without DATA"));
					if (unsub) {
						unsub();
						unsub = undefined;
					} else shouldUnsub = true;
					return;
				}
			}
		});
		if (shouldUnsub) {
			unsub?.();
			unsub = undefined;
		}
	});
}

/**
 * Wait for the first DATA value from `source` that satisfies `predicate`.
 *
 * Subscribes directly and resolves on the first DATA value where
 * `predicate` returns true. Reactive, no polling. Use in tests and
 * bridging code where you need a single matching value as a Promise.
 *
 * **Important:** This only captures **future** emissions — data that has
 * already flowed through the node is gone. Call this *before* the upstream
 * emits. For already-cached values, use `source.cache` / `source.status`.
 * See COMPOSITION-GUIDE §2 (subscription ordering).
 *
 * ```ts
 * const val = await firstWhere(strategy.node, snap => snap.size > 0);
 * ```
 *
 * @param source - Upstream node to observe.
 * @param predicate - Returns `true` for the value to resolve on.
 * @param opts - `{ skipCurrent?: boolean }`. When `skipCurrent: true`, any DATA
 *   delivered during the synchronous `subscribe()` call (push-on-subscribe §2.2
 *   replay of the cached value) is ignored — the promise resolves only on the
 *   next future emission. Useful when the caller wants to await the next
 *   settlement event after an imperative action (e.g. `run()` minting a new
 *   runVersion, where the currently-cached value belongs to the previous run).
 *
 * @category extra
 */
export function firstWhere<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: { skipCurrent?: boolean },
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let shouldUnsub = false;
		let unsub: (() => void) | undefined;
		// Push-on-subscribe (§2.2) delivers the cached value synchronously
		// during the subscribe() call — i.e. before `subscribe()` returns.
		// When `skipCurrent: true`, we swallow any message batch delivered
		// in that synchronous window so the promise only observes *future*
		// emissions. The flag flips to `false` as soon as subscribe() returns.
		let inInitialSyncPhase = opts?.skipCurrent === true;
		unsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (settled) return;
				// During the initial sync phase, swallow only cached DATA
				// (push-on-subscribe §2.2). Terminal ERROR / COMPLETE must
				// still reject the promise — otherwise an already-terminated
				// source synchronously delivering `[[ERROR, ...]]` or
				// `[[COMPLETE]]` during `subscribe()` would hang forever
				// under `skipCurrent: true`.
				if (inInitialSyncPhase && m[0] === DATA) continue;
				if (m[0] === DATA) {
					const v = m[1] as T;
					if (predicate(v)) {
						settled = true;
						resolve(v);
						if (unsub) {
							unsub();
							unsub = undefined;
						} else shouldUnsub = true;
						return;
					}
				}
				if (m[0] === ERROR) {
					settled = true;
					reject(m[1]);
					if (unsub) {
						unsub();
						unsub = undefined;
					} else shouldUnsub = true;
					return;
				}
				if (m[0] === COMPLETE) {
					settled = true;
					reject(new Error("completed without matching value"));
					if (unsub) {
						unsub();
						unsub = undefined;
					} else shouldUnsub = true;
					return;
				}
			}
		});
		inInitialSyncPhase = false;
		if (shouldUnsub) {
			unsub?.();
			unsub = undefined;
		}
	});
}

/**
 * Await the first non-nullish DATA value from `source`, with optional
 * timeout. Composition sugar over `firstWhere` + reactive timeout.
 *
 * Designed as the CLI/boundary sink for reactive pipelines that end in a
 * nullable node (e.g. `promptNode` — per COMPOSITION-GUIDE §8, it emits
 * `null` before it settles with a real value). Replaces the common pattern
 * `firstValueFrom(filter(source, v => v != null))` with a deadline.
 *
 * - Rejects with `TimeoutError` (from `extra/resilience`) if no matching
 *   value arrives within `timeoutMs`. Omit `timeoutMs` for unbounded wait.
 * - `predicate` defaults to `v => v != null`. Pass a custom predicate to
 *   gate on a stronger condition (e.g. `v => typeof v === "string"`).
 * - Pass `skipCurrent: true` to ignore the currently-cached value delivered
 *   synchronously via push-on-subscribe and resolve only on the *next*
 *   matching emission. Useful after an imperative action that should produce
 *   a fresh settlement (e.g. `run()` minting a new version — the stale
 *   cached value from the previous run must not resolve the new caller).
 *
 * ```ts
 * const brief = await awaitSettled(briefNode, { timeoutMs: 120_000 });
 * // or with a predicate:
 * const rich = await awaitSettled(node, {
 *   predicate: (v): v is MyShape => typeof v === "object" && v != null && "key" in v,
 *   timeoutMs: 60_000,
 * });
 * // or after kicking off a fresh run:
 * kickOff();
 * const fresh = await awaitSettled(resultNode, { skipCurrent: true });
 * ```
 *
 * Reactive inside, sync propagation — the one async boundary is the
 * returned `Promise<T>` (spec §5.10: async belongs at sources and
 * boundaries, not in the graph).
 *
 * @param source - Upstream node to observe.
 * @param opts - `{ predicate?, timeoutMs?, skipCurrent? }`.
 * @returns Promise that resolves with the first matching value, or rejects on timeout / ERROR / COMPLETE-without-DATA.
 *
 * @category extra
 */
// Lazy module-cache to avoid the `resilience.ts` → `sources.ts` circular
// import (`resilience.ts` imports `fromAny`). First call pays the one-shot
// dynamic import; subsequent calls hit cached references.
let _timeoutOp: typeof import("../resilience.js").timeout | undefined;
let _nsPerMs: number | undefined;

export async function awaitSettled<T>(
	source: Node<T>,
	opts?: { predicate?: (value: T) => boolean; timeoutMs?: number; skipCurrent?: boolean },
): Promise<NonNullable<T>> {
	const predicate = opts?.predicate ?? ((v: T) => v != null);
	const skipCurrent = opts?.skipCurrent;
	if (opts?.timeoutMs == null || opts.timeoutMs <= 0) {
		return (await firstWhere(source, predicate, { skipCurrent })) as NonNullable<T>;
	}
	// Reactive composition: `timeout()` wraps the source as a Node that
	// emits ERROR(TimeoutError) on deadline. `firstWhere` then resolves on
	// the first matching DATA or rejects on that ERROR. One async boundary
	// (the returned Promise), everything inside is sync reactive.
	if (_timeoutOp === undefined) {
		const [resilience, backoff] = await Promise.all([
			import("../resilience.js"),
			import("../backoff.js"),
		]);
		_timeoutOp = resilience.timeout;
		_nsPerMs = backoff.NS_PER_MS;
	}
	const guarded = _timeoutOp(source, opts.timeoutMs * (_nsPerMs as number));
	return (await firstWhere(guarded, predicate, { skipCurrent })) as NonNullable<T>;
}

/**
 * Converts a reactive `Node<boolean>` into a browser-standard `AbortSignal`
 * that fires when the node settles on `true`. Useful for threading a reactive
 * "cancel" flag into any async boundary that accepts a signal (fetch, LLM SDK
 * calls, child-process APIs, timers).
 *
 * **Contract.**
 * - `signal.abort(reason)` fires exactly once, on the first DATA emission with
 *   a truthy value. Subsequent emissions are ignored (AbortSignal is
 *   single-shot).
 * - Null / `false` / sentinel values are ignored. Push-on-subscribe will
 *   check the currently-cached value on subscribe and abort immediately if
 *   it's already `true`.
 * - `reason` defaults to `"cancelled via nodeSignal"`; pass `opts.reason` to
 *   override (`DOMException`, `Error`, or any value accepted by
 *   `AbortController.abort`).
 *
 * **Lifecycle.**
 * - Returns a `{signal, dispose}` bundle. Call `dispose()` when you're done
 *   with the signal (e.g. in a `finally` after the async operation completes).
 *   `dispose()` unsubscribes from the node and is a no-op once the signal has
 *   fired.
 * - **Memory note:** without `dispose()` the subscription keeps the reactive
 *   node alive for the lifetime of the process. For bridge calls inside a
 *   `switchMap` project fn, the switchMap supersede tears the inner subgraph
 *   down, which is usually the right lifetime — but still call `dispose()`
 *   from the caller's `finally` for clarity.
 *
 * @example
 * ```ts
 * const aborted = state(false);
 * const { signal, dispose } = nodeSignal(aborted);
 * try {
 *   const resp = await adapter.invoke(msgs, { signal });
 *   return resp;
 * } finally {
 *   dispose();
 * }
 * ```
 *
 * @category extra
 */
export function nodeSignal(
	source: Node<boolean>,
	opts?: { reason?: unknown },
): { signal: AbortSignal; dispose: () => void } {
	const ctrl = new AbortController();
	const reason = opts?.reason ?? new Error("cancelled via nodeSignal");
	let unsub: (() => void) | undefined;
	let shouldUnsub = false;
	const done = () => {
		if (unsub) {
			unsub();
			unsub = undefined;
		} else shouldUnsub = true;
	};
	unsub = source.subscribe((msgs) => {
		if (ctrl.signal.aborted) return;
		for (const m of msgs) {
			if (m[0] === DATA && m[1] === true) {
				ctrl.abort(reason);
				done();
				return;
			}
			if (m[0] === ERROR) {
				// Treat an ERROR on the abort source as a cancel signal too —
				// a broken control channel should fail closed, not leak the
				// in-flight call. Use the error as the abort reason.
				ctrl.abort(m[1]);
				done();
				return;
			}
			if (m[0] === COMPLETE) {
				// Source completed without aborting — no-op. `done()` already
				// released the subscription here, so a later `dispose()` call
				// from the caller is a no-op (safe / idempotent).
				done();
				return;
			}
		}
	});
	if (shouldUnsub) {
		unsub?.();
		unsub = undefined;
	}
	return {
		signal: ctrl.signal,
		dispose: () => {
			if (unsub) {
				unsub();
				unsub = undefined;
			}
		},
	};
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

// ---------------------------------------------------------------------------
// keepalive
// ---------------------------------------------------------------------------

/**
 * Activate a compute node's upstream wiring without a real sink.
 *
 * Derived/effect nodes are lazy — they don't compute until at least one
 * subscriber exists (COMPOSITION-GUIDE §5). `keepalive` subscribes with an
 * empty sink so the node stays wired for `.cache` and upstream propagation.
 *
 * Returns the unsubscribe handle. Common usage:
 * `graph.addDisposer(keepalive(node))`.
 *
 * @category extra
 */
export function keepalive(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}

// ---------------------------------------------------------------------------
// reactiveCounter
// ---------------------------------------------------------------------------

/** Bundle returned by {@link reactiveCounter}. */
export type ReactiveCounterBundle = {
	/** Reactive node holding the current count. */
	readonly node: Node<number>;
	/** Increment by 1. Returns `false` if cap would be exceeded. */
	increment(): boolean;
	/** Current count (synchronous read). */
	get(): number;
	/** Whether the counter has reached its cap. */
	atCap(): boolean;
};

/**
 * Reactive counter with a cap — the building block for circuit breakers.
 *
 * Wraps a `state(0)` node with `increment()` that respects a maximum.
 * The `node` is subscribable and composable like any reactive node. When
 * the cap is reached, `increment()` returns `false`.
 *
 * ```ts
 * const retries = reactiveCounter(10);
 * retries.increment(); // true — count is now 1
 * retries.node.subscribe(...); // reactive updates
 * retries.atCap(); // false
 * ```
 *
 * @param cap - Maximum value (inclusive). 0 = no increments allowed.
 * @category extra
 */
export function reactiveCounter(cap: number): ReactiveCounterBundle {
	const counter = state(0);
	return {
		node: counter,
		increment() {
			const current = counter.cache ?? 0;
			if (current >= cap) return false;
			counter.down([[DIRTY], [DATA, current + 1]]);
			return true;
		},
		get() {
			return counter.cache ?? 0;
		},
		atCap() {
			return (counter.cache ?? 0) >= cap;
		},
	};
}
