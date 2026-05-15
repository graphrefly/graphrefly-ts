/**
 * Async source adapters (substrate tier).
 *
 * `fromPromise`, `fromAsyncIter`, and `fromAny` are substrate-level because
 * higher-order operators (switchMap, mergeMap, concatMap, exhaustMap) need
 * `fromAny` to coerce `NodeInput<T>` project-function returns.
 *
 * @module
 */

import { COMPLETE, ERROR } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import {
	type AsyncSourceOpts,
	isNode,
	isThenable,
	type NodeInput,
	sourceOpts,
} from "./_internal.js";
import { fromIter, of } from "./sync/iter.js";

/**
 * Lifts a Promise (or thenable) to a single-value stream: one `DATA` then
 * `COMPLETE`, or `ERROR` on rejection.
 *
 * @param p - Promise to await.
 * @param opts - Producer options plus optional `signal` for abort → `ERROR`.
 * @returns `Node<T>` — settles once.
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
 * Reads an async iterable; each `next()` value becomes `DATA`; `COMPLETE`
 * when done; `ERROR` on failure.
 *
 * @param iterable - Async source (`for await` shape).
 * @param opts - Producer options plus optional `signal` to abort the pump.
 * @returns `Node<T>` — async pull stream.
 *
 * @category extra
 */
export function fromAsyncIter<T>(iterable: AsyncIterable<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal: outerSignal, ...rest } = opts ?? {};
	return node<T>((_data, a) => {
		const ac = new AbortController();
		const onOuterAbort = () => ac.abort(outerSignal?.reason);
		outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

		let done = false;
		const pump = async () => {
			try {
				for await (const v of iterable) {
					if (ac.signal.aborted) break;
					a.emit(v);
				}
				if (!ac.signal.aborted) a.down([[COMPLETE]]);
			} catch (e) {
				if (!ac.signal.aborted) a.down([[ERROR, e]]);
			} finally {
				done = true;
			}
		};
		void pump();
		return () => {
			if (!done) ac.abort();
			outerSignal?.removeEventListener("abort", onOuterAbort);
		};
	}, sourceOpts(rest));
}

/**
 * Coerces a `NodeInput<T>` (Node, scalar, Promise, Iterable, or AsyncIterable)
 * to a `Node<T>`. Used by higher-order operators to normalise project returns.
 *
 * Pass `{ iter: true }` to opt into {@link fromIter} dispatch for Iterables
 * (otherwise Iterables are treated as single-value scalars via `of`).
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
	// Default: treat as single value.
	return of(input as T);
}
