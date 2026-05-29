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
import { initNode, type Operator } from "./operators.js";

/**
 * Values accepted by {@link fromAny}: an existing Node, a Promise, an (a)sync iterable, or a
 * bare scalar. The universal coercion target for higher-order operators (CSP-2.7).
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

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
			const cleanup = setup(ctx);
			if (typeof cleanup === "function") ctx.onDeactivation(cleanup);
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

/**
 * R-data-payload: an ERROR wave must carry a non-SENTINEL payload. A rejection / abort /
 * `throw` can legitimately be `undefined` (`Promise.reject(undefined)`, a bare
 * `controller.abort()`, `throw undefined`); emitting `[[ERROR, undefined]]` would be rejected
 * by the substrate (node `_down`) — and since the source emits from an async callback OUTSIDE
 * the synchronous D30 boundary, that throw would surface as an unhandled rejection rather than
 * a clean ERROR wave. Coerce `undefined` to a real Error so the source always emits a valid wave.
 */
function errorPayload(reason: unknown): unknown {
	return reason === undefined ? new Error("source errored without a reason") : reason;
}

/** Options shared by the async sources: an optional AbortSignal → ERROR on abort. */
export interface AsyncSourceOpts {
	signal?: AbortSignal;
}

/**
 * Timer source: one-shot (first tick then COMPLETE) or periodic (`{period}` → 0, 1, 2, …).
 * sync pool + pausable:false (a timer keeps producing through PAUSE, R-pause-modes). Emits the
 * tick counter from 0; deactivation clears the timers.
 */
export function timer(ms: number, opts?: { period?: number }): Operator<never, number> {
	const period = opts?.period;
	return source<number>(
		"timer",
		(ctx) => {
			let done = false;
			let count = 0;
			let t: ReturnType<typeof setTimeout> | undefined;
			let iv: ReturnType<typeof setInterval> | undefined;
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
					ctx.down([["DATA", count++], ["COMPLETE"]]);
				}
			};
			t = setTimeout(finish, ms);
			return () => {
				done = true;
				if (t !== undefined) clearTimeout(t);
				if (iv !== undefined) clearInterval(iv);
			};
		},
		{ pool: "sync", pausable: false },
	);
}

/** interval: periodic ticks (0, 1, 2, …), first at `ms`, then every `ms` (RxJS semantics). */
export function interval(ms: number): Operator<never, number> {
	return timer(ms, { period: ms });
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

/** of: a single synchronous value — DATA then COMPLETE, emitted on activation. */
export function of<T>(value: T): Operator<never, T> {
	return source<T>(
		"of",
		(ctx) => {
			ctx.down([["DATA", value], ["COMPLETE"]]);
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
