/**
 * Iterable / value sources — synchronous bridges and constructors.
 *
 * `fromIter` drains a sync iterable; `of` lifts a finite arglist; `empty` /
 * `never` / `throwError` are the cold "constant terminal" sources used as
 * graph endpoints in tests and composition.
 */

import { COMPLETE, ERROR } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { type ExtraOpts, sourceOpts } from "./_internal.js";

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
	return node<T>((_data, a) => {
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
	return node<T>((_data, a) => {
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
	return node<T>(() => undefined, sourceOpts(opts));
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
	return node<never>((_data, a) => {
		a.down([[ERROR, err]]);
		return undefined;
	}, sourceOpts(opts));
}
