/**
 * Take / skip / find operators — bounded subsets of a stream.
 *
 * `take`, `skip`, `takeWhile`, `takeUntil`, `first`, `last`, `find`,
 * `elementAt` — counts and predicates that gate which `DATA` reaches the
 * downstream output.
 */

import { COMPLETE, DATA, ERROR, type Message, RESOLVED } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { type ExtraOpts, operatorOpts } from "./_internal.js";
import { filter } from "./transform.js";

/**
 * Emits at most `count` **`DATA`** values, then **`COMPLETE`**. `RESOLVED` does not advance the counter.
 *
 * @param source - Upstream node.
 * @param count - Maximum `DATA` emissions (≤0 completes immediately).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Limited stream.
 *
 * @example
 * ```ts
 * import { take, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = take(state(0), 3);
 * ```
 *
 * @category extra
 */
export function take<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T> {
	if (count <= 0) {
		return node<T>(
			[source as Node],
			(_d, a, ctx) => {
				if (ctx.store.completed) return;
				ctx.store.completed = true;
				a.down([[COMPLETE]]);
			},
			{
				...operatorOpts(opts),
				completeWhenDepsComplete: false,
				meta: { ...factoryTag("take", { count }), ...(opts?.meta ?? {}) },
			},
		);
	}
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			if (!("taken" in ctx.store)) ctx.store.taken = 0;
			if (ctx.store.done) {
				a.down([[RESOLVED]]);
				return;
			}
			// Upstream COMPLETE before count reached → forward COMPLETE.
			if (ctx.terminalDeps[0] === true) {
				ctx.store.done = true;
				a.down([[COMPLETE]]);
				return;
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			// DATA wave: iterate full batch, stop at count
			for (const v of batch0) {
				(ctx.store.taken as number)++;
				a.emit(v as T);
				if ((ctx.store.taken as number) >= count) {
					ctx.store.done = true;
					a.down([[COMPLETE]]);
					return;
				}
			}
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			meta: { ...factoryTag("take", { count }), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Skips the first `count` **`DATA`** emissions. `RESOLVED` does not advance the counter.
 *
 * @param source - Upstream node.
 * @param count - Number of `DATA` values to drop.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Skipped stream.
 *
 * @example
 * ```ts
 * import { skip, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = skip(state(0), 2);
 * ```
 *
 * @category extra
 */
export function skip<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T> {
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			if (!("skipped" in ctx.store)) ctx.store.skipped = 0;
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				// RESOLVED wave — pass through
				a.down([[RESOLVED]]);
				return;
			}
			let emitted = false;
			for (const v of batch0) {
				(ctx.store.skipped as number)++;
				if ((ctx.store.skipped as number) <= count) {
					// Still in skip window
				} else {
					a.emit(v as T);
					emitted = true;
				}
			}
			if (!emitted) a.down([[RESOLVED]]);
		},
		operatorOpts(opts),
	);
}

/**
 * Emits while `predicate` holds; on first false, sends **`COMPLETE`**.
 *
 * @param source - Upstream node.
 * @param predicate - Continuation test.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Truncated stream.
 *
 * @example
 * ```ts
 * import { takeWhile, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = takeWhile(state(1), (x) => x < 10);
 * ```
 *
 * @category extra
 */
export function takeWhile<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			if (ctx.store.done) {
				a.down([[RESOLVED]]);
				return;
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) {
				if (!predicate(v as T)) {
					ctx.store.done = true;
					a.down([[COMPLETE]]);
					return;
				}
				a.emit(v as T);
			}
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
		},
	);
}

/**
 * Forwards `source` until `notifier` matches `predicate` (default: notifier **`DATA`**), then **`COMPLETE`**.
 *
 * @param source - Main upstream.
 * @param notifier - Triggers completion when `predicate(msg)` is true.
 * @param opts - Optional {@link NodeOptions}, plus `predicate` for custom notifier matching.
 * @returns `Node<T>` - Truncated stream.
 *
 * @example
 * ```ts
 * import { producer, takeUntil, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(1);
 * const stop = producer((_d, a) => a.emit(undefined));
 * const n = takeUntil(src, stop);
 * ```
 *
 * @category extra
 */
export function takeUntil<T>(
	source: Node<T>,
	notifier: Node,
	opts?: ExtraOpts & { predicate?: (msg: Message) => boolean },
): Node<T> {
	const pred = opts?.predicate ?? ((m: Message) => m[0] === DATA);
	const { predicate: _, ...restOpts } = opts ?? {};
	// Use producer pattern — subscribe to both manually for message-level control.
	return node<T>(
		(_data, a) => {
			let stopped = false;
			const srcUnsub = source.subscribe((msgs) => {
				if (stopped) return;
				for (const m of msgs) {
					if (stopped) return;
					if (m[0] === DATA) a.emit(m[1] as T);
					else if (m[0] === COMPLETE || m[0] === ERROR) {
						stopped = true;
						a.down([m]);
					}
				}
			});
			const notUnsub = notifier.subscribe((msgs) => {
				if (stopped) return;
				for (const m of msgs) {
					if (stopped) return;
					if (pred(m)) {
						stopped = true;
						a.down([[COMPLETE]]);
						return;
					}
				}
			});
			return () => {
				srcUnsub();
				notUnsub();
			};
		},
		operatorOpts(restOpts as ExtraOpts),
	);
}

/**
 * Emits the first **`DATA`** then **`COMPLETE`** (same as `take(source, 1)`).
 *
 * @param source - Upstream node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Single-value stream.
 *
 * @example
 * ```ts
 * import { first, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = first(state(42));
 * ```
 *
 * @category extra
 */
export function first<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return take(source, 1, opts);
}

/**
 * Buffers values and emits the last **`DATA`** on **`COMPLETE`**; optional `defaultValue` if none arrived.
 *
 * @param source - Upstream node.
 * @param options - Optional {@link NodeOptions} and `defaultValue` when empty.
 * @returns `Node<T>` - Last-or-default node.
 *
 * @example
 * ```ts
 * import { last, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = last(state(1), { defaultValue: 0 });
 * ```
 *
 * @category extra
 */
export function last<T>(source: Node<T>, options?: ExtraOpts & { defaultValue?: T }): Node<T> {
	const { defaultValue, ...rest } = options ?? {};
	const useDefault = options != null && Object.hasOwn(options, "defaultValue");
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			// COMPLETE (terminal === true): emit latest or default, then COMPLETE.
			// ERROR: autoError propagates automatically.
			if (ctx.terminalDeps[0] === true) {
				if (ctx.store.has) {
					a.emit(ctx.store.latest as T);
				} else if (useDefault) {
					a.emit(defaultValue as T);
				}
				a.down([[COMPLETE]]);
				return;
			}
			const batch0 = data[0];
			// RESOLVED wave: propagate RESOLVED. Covers first-wave case; after first
			// call the pre-fn skip handles this automatically.
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			// DATA: accumulate latest — emit nothing until COMPLETE.
			ctx.store.latest = batch0.at(-1) as T;
			ctx.store.has = true;
		},
		{
			...operatorOpts(rest),
			completeWhenDepsComplete: false,
		},
	);
}

/**
 * Emits the first value matching `predicate`, then **`COMPLETE`**.
 *
 * @param source - Upstream node.
 * @param predicate - Match test.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - First-match stream.
 *
 * @example
 * ```ts
 * import { find, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = find(state(1), (x) => x > 0);
 * ```
 *
 * @category extra
 */
export function find<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	return take(filter(source, predicate, opts), 1, opts);
}

/**
 * Emits the `index`th **`DATA`** (zero-based), then **`COMPLETE`**.
 *
 * @param source - Upstream node.
 * @param index - Zero-based emission index.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Single indexed value.
 *
 * @example
 * ```ts
 * import { elementAt, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = elementAt(state(0), 2);
 * ```
 *
 * @category extra
 */
export function elementAt<T>(source: Node<T>, index: number, opts?: ExtraOpts): Node<T> {
	return take(skip(source, index, opts), 1, opts);
}
