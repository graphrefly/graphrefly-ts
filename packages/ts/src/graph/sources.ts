/**
 * Async + sync sources (binding-layer sugar, D43 / D40 / feedback_async_sources_binding_layer).
 *
 * Sources are depless {@link Operator}`<never, T>` specs built on the `producer`/`node` path:
 * the body runs ONCE on activation (node `_activate`), schedules its work, and emits later via
 * the captured `ctx.down` (an external tier-3 emit → the leading DIRTY is synthesized for it,
 * R-dirty-before-data). Async lives ONLY here (R-no-raw-async / F-SYNC-CORE): `setTimeout` /
 * `Promise` / `for await` are confined to source bodies; the wave core stays sync. Cleanup is
 * `ctx.onDeactivation` (D28), NOT a returned object. Per-language (D6/D24), never in parity.
 *
 * Instantiate via `g.initNode(timer(1000), [])` (graph-bound, inspectable) or
 * {@link initNode}(timer(1000), []) (bare). Pool/pause defaults (D43): timer/interval =
 * sync + pausable:false (keep producing through PAUSE); fromPromise/fromAsyncIter = async
 * (default pausable, so a paused source buffers its late emits — R-async-paused).
 */

import type { Ctx } from "../ctx/types.js";
import type { Node, NodeOptions } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import { toCheckpointJson } from "./checkpoint.js";
import { initNode, type Operator } from "./operators.js";

/**
 * Values accepted by {@link fromAny}: an existing Node, a Promise, an (a)sync iterable, or a
 * bare scalar. The universal coercion target for higher-order operators (CSP-2.7).
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

/** Host-boundary options for {@link singleFromAny}. */
export interface SingleFromAnyOptions<K> {
	/**
	 * Map a caller key to the in-flight dedupe key. Defaults to key identity; object keys dedupe only
	 * when the same object reference is reused. Return a stable string/canonical value for structural
	 * object-key dedupe.
	 */
	keyOf?: (key: K) => unknown;
	/** Treat a sync iterable result as a stream and take its first item. Defaults to scalar value. */
	iter?: boolean;
}

/**
 * Internal: build a depless source spec. `setup` runs once on activation; its returned fn (if
 * any) is registered as the deactivation cleanup (clear timers / abort). `setup` schedules the
 * async work and emits via `ctx.down` — synchronously (sync sources) or later (async sources).
 */
function source<T>(
	factory: string,
	// biome-ignore lint/suspicious/noConfusingVoidType: setup returns a cleanup fn OR nothing — the void arm keeps no-return source bodies (e.g. `of`/`fromIter`) ergonomic, same idiom as EffectFn.
	setup: (ctx: Ctx) => void | (() => void),
	opts?: Partial<NodeOptions<T>>,
): Operator<never, T> {
	return {
		factory,
		opts,
		body: (ctx) => {
			let cleanup: undefined | (() => void);
			let deactivated = false;
			ctx.onDeactivation(() => {
				deactivated = true;
				if (typeof cleanup === "function") cleanup();
			});
			cleanup = setup(ctx);
			if (deactivated && typeof cleanup === "function") cleanup();
		},
	};
}

function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof x === "object" &&
		"cache" in x &&
		typeof (x as Node).subscribe === "function"
	);
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

function isAsyncIterable<T>(x: unknown): x is AsyncIterable<T> {
	return (
		x !== null &&
		x !== undefined &&
		typeof (x as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
	);
}

function isIterable<T>(x: unknown): x is Iterable<T> {
	return (
		x !== null &&
		x !== undefined &&
		typeof (x as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
	);
}

/** Options shared by async/timer sources: an optional AbortSignal → ERROR on abort. */
export interface AsyncSourceOpts {
	signal?: AbortSignal;
}

export interface TimerSourceOpts extends AsyncSourceOpts {
	period?: number;
}

/** DOM/EventEmitter-style target accepted by {@link fromEvent}. */
export interface EventTargetLike {
	addEventListener(
		type: string,
		listener: (event: unknown) => void,
		options?: EventListenerOptionsLike,
	): void;
	removeEventListener(
		type: string,
		listener: (event: unknown) => void,
		options?: EventListenerOptionsLike,
	): void;
}

export interface EventListenerOptionsLike {
	capture?: boolean;
	passive?: boolean;
	once?: boolean;
}

export type FromEventOptions = EventListenerOptionsLike;

/** Host push registration callback accepted by {@link fromPushNotification}. */
export type PushUnsubscribe = () => void;
export type PushRegister<T> = (deliver: (payload: T) => void) => PushUnsubscribe | undefined;

function timerSource(factory: string, ms: number, opts?: TimerSourceOpts): Operator<never, number> {
	const { period, signal } = opts ?? {};
	const op = source<number>(
		factory,
		(ctx) => {
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
			const onAbort = () => {
				if (done) return;
				cleanup();
				ctx.down([["ERROR", errorPayload(signal?.reason)]]);
			};
			const finish = () => {
				if (done) return;
				if (period != null) {
					ctx.down([["DATA", count++]]);
					iv = setInterval(() => {
						if (done) return;
						ctx.down([["DATA", count++]]);
					}, period);
				} else {
					// One-shot: DATA then COMPLETE in one wave (terminal-is-forever).
					done = true;
					signal?.removeEventListener("abort", onAbort);
					ctx.down([["DATA", count++], ["COMPLETE"]]);
				}
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			t = setTimeout(finish, ms);
			return cleanup;
		},
		{ pool: "sync", pausable: false },
	);
	if (factory === "timer" && period === undefined && signal === undefined) {
		return { ...op, restore: { ref: "timer", config: { ms: toCheckpointJson(ms, "timer.ms") } } };
	}
	return op;
}

/**
 * Timer source: one-shot (first tick then COMPLETE) or periodic (`{period}` → 0, 1, 2, …).
 * sync pool + pausable:false (a timer keeps producing through PAUSE, R-pause-modes). Emits the
 * tick counter from 0; deactivation clears the timers.
 */
export function timer(ms: number, opts?: TimerSourceOpts): Operator<never, number> {
	return timerSource("timer", ms, opts);
}

/** Frozen pure-ts name for {@link timer}; preserves the real factory name in describe(). */
export function fromTimer(ms: number, opts?: TimerSourceOpts): Operator<never, number> {
	return timerSource("fromTimer", ms, opts);
}

/** interval: periodic ticks (0, 1, 2, …), first at `ms`, then every `ms` (RxJS semantics). */
export function interval(ms: number): Operator<never, number> {
	return timerSource("interval", ms, { period: ms });
}

/**
 * Lift a Promise (or thenable) to a single-value stream: one DATA then COMPLETE, or ERROR on
 * rejection. async pool (default pausable → a paused source buffers its late emit). Optional
 * `signal` aborts to ERROR.
 */
export function fromPromise<T>(
	p: Promise<T> | PromiseLike<T>,
	opts?: AsyncSourceOpts,
): Operator<never, T> {
	const signal = opts?.signal;
	return source<T>(
		"fromPromise",
		(ctx) => {
			let settled = false;
			const onAbort = () => {
				if (settled) return;
				settled = true;
				// onAbort only runs from a `signal` listener / the `signal.aborted` guard → signal is defined.
				ctx.down([["ERROR", errorPayload((signal as AbortSignal).reason)]]);
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
					ctx.down([["DATA", v], ["COMPLETE"]]);
				},
				(e) => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					ctx.down([["ERROR", errorPayload(e)]]);
				},
			);
			return () => {
				settled = true;
				signal?.removeEventListener("abort", onAbort);
			};
		},
		{ pool: "async" },
	);
}

/**
 * Read an async iterable: each value → DATA; COMPLETE when done; ERROR on failure. async pool.
 * Optional `signal` aborts the pump.
 */
export function fromAsyncIter<T>(
	iterable: AsyncIterable<T>,
	opts?: AsyncSourceOpts,
): Operator<never, T> {
	const outerSignal = opts?.signal;
	return source<T>(
		"fromAsyncIter",
		(ctx) => {
			const ac = new AbortController();
			const onOuterAbort = () => ac.abort(outerSignal?.reason);
			outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
			let done = false;
			const pump = async () => {
				try {
					for await (const v of iterable) {
						if (ac.signal.aborted) break;
						ctx.down([["DATA", v]]);
					}
					if (!ac.signal.aborted) ctx.down([["COMPLETE"]]);
				} catch (e) {
					if (!ac.signal.aborted) ctx.down([["ERROR", errorPayload(e)]]);
				} finally {
					done = true;
				}
			};
			void pump();
			return () => {
				if (!done) ac.abort();
				outerSignal?.removeEventListener("abort", onOuterAbort);
			};
		},
		{ pool: "async" },
	);
}

/**
 * of: synchronous values — each argument as DATA, then COMPLETE. `of()` is the EMPTY source.
 */
export function of<T = never>(...values: T[]): Operator<never, T> {
	return source<T>(
		"of",
		(ctx) => {
			for (const value of values) ctx.down([["DATA", value]]);
			ctx.down([["COMPLETE"]]);
		},
		{ pool: "sync" },
	);
}

/** fromIter: a sync iterable — each value → DATA (in order), then COMPLETE, on activation. */
export function fromIter<T>(iterable: Iterable<T>): Operator<never, T> {
	return source<T>(
		"fromIter",
		(ctx) => {
			for (const v of iterable) ctx.down([["DATA", v]]);
			ctx.down([["COMPLETE"]]);
		},
		{ pool: "sync" },
	);
}

/** EMPTY analogue: complete immediately with no DATA. */
export function empty<T = never>(): Operator<never, T> {
	return source<T>(
		"empty",
		(ctx) => {
			ctx.down([["COMPLETE"]]);
		},
		{ pool: "sync" },
	);
}

/** NEVER analogue: activate and remain silent until deactivation. */
export function never<T = never>(): Operator<never, T> {
	return source<T>("never", () => undefined, { pool: "sync" });
}

/** Error source: terminate with ERROR on activation, coercing invalid host-language payloads. */
export function throwError(err: unknown): Operator<never, never> {
	return source<never>(
		"throwError",
		(ctx) => {
			ctx.down([["ERROR", errorPayload(err)]]);
		},
		{ pool: "sync" },
	);
}

/**
 * Wrap a DOM-style event target. Each event becomes DATA; deactivation removes the listener.
 * External callbacks are source boundaries (D43), so no polling or operator-level async leaks in.
 */
export function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts: FromEventOptions = {},
): Operator<never, T> {
	if (target == null || typeof target.addEventListener !== "function") {
		throw new TypeError("fromEvent: target must implement addEventListener");
	}
	if (typeof target.removeEventListener !== "function") {
		throw new TypeError("fromEvent: target must implement removeEventListener");
	}
	if (typeof type !== "string" || type.length === 0) {
		throw new TypeError("fromEvent: event type must be a non-empty string");
	}
	return source<T>(
		"fromEvent",
		(ctx) => {
			let done = false;
			const handler = (event: unknown) => {
				if (!done) ctx.down([["DATA", event as T]]);
			};
			target.addEventListener(type, handler, opts);
			return () => {
				done = true;
				target.removeEventListener(type, handler, opts);
			};
		},
		{ pool: "sync" },
	);
}

/**
 * Wrap a host push transport. The host owns network/native setup; this factory owns reactive
 * delivery and teardown only, preserving async-at-source-boundary discipline.
 */
export function fromPushNotification<T = unknown>(register: PushRegister<T>): Operator<never, T> {
	if (typeof register !== "function") {
		throw new TypeError("fromPushNotification: register must be a function");
	}
	return source<T>(
		"fromPushNotification",
		(ctx) => {
			let done = false;
			const deliver = (payload: T) => {
				if (!done) ctx.down([["DATA", payload]]);
			};
			const unsubscribe = register(deliver);
			return () => {
				done = true;
				if (typeof unsubscribe === "function") unsubscribe();
			};
		},
		{ pool: "sync" },
	);
}

/**
 * Coerce a {@link NodeInput}`<T>` to a `Node<T>` (D43 — coercion prerequisite for the CSP-2.7
 * higher-order operators). An existing Node passes through; a thenable → {@link fromPromise};
 * an async iterable → {@link fromAsyncIter}; with `{iter:true}` a sync iterable →
 * {@link fromIter}; everything else → {@link of}. Coerced nodes are bare (use
 * `opts.dispatcher` to bind one, default = process-global D26).
 */
export function fromAny<T>(
	input: NodeInput<T>,
	opts: NodeOptions<T> & { iter?: boolean } = {},
): Node<T> {
	if (isNode(input)) return input as Node<T>;
	const { iter, ...nodeOpts } = opts;
	if (isThenable(input)) {
		return initNode(fromPromise(input as PromiseLike<T>), [], nodeOpts);
	}
	if (input !== null && input !== undefined) {
		const candidate = input as {
			[Symbol.asyncIterator]?: unknown;
			[Symbol.iterator]?: unknown;
		};
		if (typeof candidate[Symbol.asyncIterator] === "function") {
			return initNode(fromAsyncIter(input as AsyncIterable<T>), [], nodeOpts);
		}
		if (iter === true && typeof candidate[Symbol.iterator] === "function") {
			return initNode(fromIter(input as Iterable<T>), [], nodeOpts);
		}
	}
	return initNode(of(input as T), [], nodeOpts);
}

/**
 * Resolve the first DATA from a Node as a Promise. This is a host-boundary escape hatch, not a
 * graph operator; do not call it from reactive node bodies. ERROR rejects, and COMPLETE before DATA
 * rejects because no value exists.
 */
export function firstValueFrom<T>(source: Node<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let shouldUnsub = false;
		let unsub: (() => void) | undefined;
		const finish = (f: () => void): void => {
			if (settled) return;
			settled = true;
			f();
			if (unsub) {
				unsub();
				unsub = undefined;
			} else {
				shouldUnsub = true;
			}
		};
		unsub = source.subscribe((msg) => {
			if (msg[0] === "DATA") {
				finish(() => resolve(msg[1] as T));
			} else if (msg[0] === "ERROR") {
				finish(() => reject(msg[1]));
			} else if (msg[0] === "COMPLETE") {
				finish(() => reject(new Error("firstValueFrom: completed without DATA")));
			} else if (msg[0] === "TEARDOWN") {
				finish(() => reject(new Error("firstValueFrom: torn down without DATA")));
			}
		});
		if (shouldUnsub) {
			unsub?.();
			unsub = undefined;
		}
	});
}

function singleFromAnyValue<T>(value: T): T {
	if (value === undefined) {
		throw new TypeError("singleFromAny: undefined is the substrate SENTINEL");
	}
	return value;
}

async function firstFromAsyncIterable<T>(input: AsyncIterable<T>): Promise<T> {
	const iter = input[Symbol.asyncIterator]();
	const { value, done } = await iter.next();
	if (done) {
		await iter.return?.();
		throw new Error("singleFromAny: factory returned empty async iterable");
	}
	try {
		await iter.return?.();
	} catch {
		// The first value is the bridge result; close failures after that are cleanup-only.
	}
	return value as T;
}

function firstFromIterable<T>(input: Iterable<T>): Promise<T> {
	const iter = input[Symbol.iterator]();
	const { value, done } = iter.next();
	if (done) {
		iter.return?.();
		return Promise.reject(new Error("singleFromAny: factory returned empty iterable"));
	}
	try {
		iter.return?.();
	} catch {
		// The first value is the bridge result; close failures after that are cleanup-only.
	}
	return Promise.resolve(value as T);
}

function nodeInputToPromise<T>(input: NodeInput<T>, opts: { iter?: boolean }): Promise<T> {
	if (isThenable(input)) return Promise.resolve(input as PromiseLike<T>).then(singleFromAnyValue);
	if (isNode(input)) return firstValueFrom(input as Node<T>).then(singleFromAnyValue);
	if (isAsyncIterable<T>(input)) return firstFromAsyncIterable(input).then(singleFromAnyValue);
	if (opts.iter === true && isIterable<T>(input)) {
		return firstFromIterable(input).then(singleFromAnyValue);
	}
	if (input === undefined) {
		return Promise.reject(new TypeError("singleFromAny: undefined is the substrate SENTINEL"));
	}
	return Promise.resolve(singleFromAnyValue(input as T));
}

/**
 * Keyed singleflight over {@link NodeInput}. Concurrent calls with the same key share one Promise;
 * once that input resolves/rejects, the in-flight entry is cleared and a later call re-runs the
 * factory. Host-boundary helper only; it does not create graph topology.
 */
export function singleFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Promise<T> {
	const keyOf = opts.keyOf ?? ((key: K): unknown => key);
	const inFlight = new Map<unknown, Promise<T>>();

	return (key: K): Promise<T> => {
		const dedupeKey = keyOf(key);
		const existing = inFlight.get(dedupeKey);
		if (existing) return existing;

		let resolvePending!: (value: T) => void;
		let rejectPending!: (reason: unknown) => void;
		let tracked!: Promise<T>;
		const cleanup = (): void => {
			if (inFlight.get(dedupeKey) === tracked) inFlight.delete(dedupeKey);
		};
		const pending = new Promise<T>((resolve, reject) => {
			resolvePending = resolve;
			rejectPending = reject;
		});
		tracked = pending.then(
			(value) => {
				cleanup();
				return value;
			},
			(error) => {
				cleanup();
				throw error;
			},
		);
		inFlight.set(dedupeKey, tracked);
		try {
			nodeInputToPromise(factory(key), opts).then(resolvePending, rejectPending);
		} catch (e) {
			rejectPending(e);
		}
		return tracked;
	};
}
