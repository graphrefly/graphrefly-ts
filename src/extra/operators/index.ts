/**
 * Tier 1 sync operators (roadmap §2.1) and Tier 2 async/dynamic operators (roadmap §2.2) —
 * each returns a {@link Node} built with {@link node} (or {@link producer} for cold sources).
 *
 * v5 foundation redesign: all operators use `actions.emit()` for value emission,
 * `ctx.store` for persistent state, `ctx.terminalDeps` for terminal handling,
 * and `data[i]` batch shape for DATA vs RESOLVED discrimination. `onMessage`
 * and `onResubscribe` are removed.
 */

import { monotonicNs } from "../../core/clock.js";
import type { NodeActions } from "../../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	type Messages,
	RESOLVED,
	START,
} from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { derived, producer } from "../../core/sugar.js";
import { NS_PER_MS } from "../backoff.js";
import { fromAny, type NodeInput } from "../sources.js";

type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

function operatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", ...opts } as NodeOptions<T>;
}

/**
 * Like {@link operatorOpts} but declares `partial: true` — use for operators
 * whose fn body deliberately handles partial-dep waves (fires on primary
 * alone, emits RESOLVED when a required peer is still sentinel, etc.). Opts
 * out of the core §2.7 first-run gate. User `opts.partial = false` override
 * wins via the spread, but this is rare — the gate-on default only makes
 * sense for fns that expect all deps to have delivered.
 */
function partialOperatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", partial: true, ...opts } as NodeOptions<T>;
}

/**
 * Like {@link partialOperatorOpts} but declares `partial: false` — first-run
 * gate ON. Use for operators that DO need to wait for every dep to deliver
 * real DATA before firing the first time, but want the standard derived/
 * effect "operator" describeKind for describe() output.
 *
 * Phase 10.5 (2026-04-29; `archive/docs/SESSION-graph-narrow-waist.md` §
 * "Phase 10.5"): introduced when `withLatestFrom` flipped from `partial:
 * true` to `partial: false`. The first-run gate fixes the documented W1
 * initial-pair drop without breaking post-warmup semantics (the gate is
 * `_hasCalledFnOnce === false` only — once fn fires, subsequent waves are
 * gate-free).
 *
 * **Caller override:** the spread order is `{ ..., ...opts }`, so a
 * user-supplied `opts.partial = true` silently overrides the helper's
 * default. Same shape as {@link partialOperatorOpts}'s override behavior.
 * If you want to FORCE `partial: false` on a specific operator regardless
 * of caller opts, write the helper inline at the call site (e.g.
 * `{ describeKind: "derived", ...opts, partial: false }`) so the override
 * is rejected.
 */
function gatedOperatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", partial: false, ...opts } as NodeOptions<T>;
}

/**
 * Maps each settled value from `source` through `project`.
 *
 * @param source - Upstream node.
 * @param project - Transform for each value.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Derived node emitting mapped values.
 *
 * @example
 * ```ts
 * import { map, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = map(state(2), (x) => x * 3);
 * ```
 *
 * @category extra
 */
export function map<T, R>(source: Node<T>, project: (value: T) => R, opts?: ExtraOpts): Node<R> {
	return node<R>(
		[source as Node],
		(data, a) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) {
				a.emit(project(v as T));
			}
		},
		{
			...operatorOpts<R>(opts),
			meta: { ...factoryTag("map"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Forwards values that satisfy `predicate`; otherwise emits `RESOLVED` with no `DATA` (two-phase semantics).
 *
 * **Wave-exclusivity contract** (COMPOSITION-GUIDE §41 / spec §1.3.3): the
 * `RESOLVED` is emitted only when the entire wave produces zero passing
 * values — never per-dropped-item, never trailing a wave that already
 * emitted `DATA`. Mixed-batch inputs like `[v_pass, v_fail, v_pass2]`
 * forward `[DATA, v_pass]` and `[DATA, v_pass2]` with no `RESOLVED` for
 * the dropped middle entry. Consumers needing per-input drain accounting
 * count upstream of `filter`, not on its output.
 *
 * @param source - Upstream node.
 * @param predicate - Inclusion test.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Filtered node.
 *
 * @example
 * ```ts
 * import { filter, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = filter(state(1), (x) => x > 0);
 * ```
 *
 * @category extra
 */
export function filter<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>(
		[source as Node],
		(data, a) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			let emitted = false;
			for (const v of batch0) {
				if (predicate(v as T)) {
					a.emit(v as T);
					emitted = true;
				}
			}
			if (!emitted) a.down([[RESOLVED]]);
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("filter"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Folds each upstream value into an accumulator; emits the new accumulator every time.
 *
 * Unlike RxJS, `seed` is always required — there is no seedless mode where the first
 * value silently becomes the accumulator.
 *
 * @param source - Upstream node.
 * @param reducer - `(acc, value) => nextAcc`.
 * @param seed - Initial accumulator (required).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Scan node.
 *
 * @example
 * ```ts
 * import { scan, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = scan(state(1), (a, x) => a + x, 0);
 * ```
 *
 * @category extra
 */
export function scan<T, R>(
	source: Node<T>,
	reducer: (acc: R, value: T) => R,
	seed: R,
	opts?: ExtraOpts,
): Node<R> {
	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			if (!("acc" in ctx.store)) ctx.store.acc = seed;
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) {
				ctx.store.acc = reducer(ctx.store.acc as R, v as T);
				a.emit(ctx.store.acc as R);
			}
		},
		{
			...operatorOpts(opts),
			initial: seed,
			resetOnTeardown: true,
			meta: { ...factoryTag("scan", { initial: seed }), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Reduces to one value emitted when `source` completes; if no `DATA` arrived, emits `seed`.
 *
 * Unlike RxJS, `seed` is always required. If the source completes without emitting
 * DATA, the seed value is emitted (RxJS would throw without a seed).
 *
 * @param source - Upstream node.
 * @param reducer - `(acc, value) => nextAcc`.
 * @param seed - Empty-completion default and initial accumulator (required).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Node that emits once on completion.
 *
 * @example
 * ```ts
 * import { reduce, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = reduce(state(1), (a, x) => a + x, 0);
 * ```
 *
 * @category extra
 */
export function reduce<T, R>(
	source: Node<T>,
	reducer: (acc: R, value: T) => R,
	seed: R,
	opts?: ExtraOpts,
): Node<R> {
	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			if (!("acc" in ctx.store)) ctx.store.acc = seed;
			// COMPLETE: emit accumulated value then COMPLETE.
			// ERROR: autoError propagates automatically; nothing to emit.
			if (ctx.terminalDeps[0] === true) {
				a.emit(ctx.store.acc as R);
				a.down([[COMPLETE]]);
				return;
			}
			const batch0 = data[0];
			// RESOLVED wave (empty batch): propagate RESOLVED. After fn has run once
			// the pre-fn skip handles this; this guard covers the first-wave case.
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			// DATA: accumulate silently — emit nothing until COMPLETE.
			for (const v of batch0) {
				ctx.store.acc = reducer(ctx.store.acc as R, v as T);
			}
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			meta: { ...factoryTag("reduce", { initial: seed }), ...(opts?.meta ?? {}) },
		},
	);
}

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
	return producer<T>(
		(a) => {
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

/**
 * Observer shape for {@link tap} — side effects for data, error, and/or complete.
 */
export type TapObserver<T> = {
	data?: (value: T) => void;
	error?: (err: unknown) => void;
	complete?: () => void;
};

/**
 * Invokes side effects; values pass through unchanged.
 *
 * Accepts either a function (called on each DATA) or an observer object
 * `{ data?, error?, complete? }` for lifecycle-aware side effects.
 *
 * @param source - Upstream node.
 * @param fnOrObserver - Side effect function or observer object.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Passthrough node.
 *
 * @example
 * ```ts
 * import { tap, state } from "@graphrefly/graphrefly-ts";
 *
 * // Function form (DATA only)
 * tap(state(1), (x) => console.log(x));
 *
 * // Observer form (DATA + ERROR + COMPLETE)
 * tap(state(1), { data: console.log, error: console.error, complete: () => console.log("done") });
 * ```
 *
 * @category extra
 */
export function tap<T>(
	source: Node<T>,
	fnOrObserver: ((value: T) => void) | TapObserver<T>,
	opts?: ExtraOpts,
): Node<T> {
	if (typeof fnOrObserver === "function") {
		return node<T>(
			[source as Node],
			(data, a) => {
				const batch0 = data[0];
				if (batch0 == null || batch0.length === 0) {
					a.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0) {
					fnOrObserver(v as T);
					a.emit(v as T);
				}
			},
			{
				...operatorOpts(opts),
				meta: { ...factoryTag("tap"), ...(opts?.meta ?? {}) },
			},
		);
	}
	const obs = fnOrObserver;
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			// Check for terminal events
			if (ctx.terminalDeps[0] !== undefined) {
				if (ctx.terminalDeps[0] === true) {
					obs.complete?.();
					a.down([[COMPLETE]]);
				} else {
					obs.error?.(ctx.terminalDeps[0]);
					a.down([[ERROR, ctx.terminalDeps[0]]]);
				}
				return;
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) {
				obs.data?.(v as T);
				a.emit(v as T);
			}
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			meta: { ...factoryTag("tap"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Invokes `fn` exactly once on the first qualifying DATA emission, then passes
 * all values (including subsequent DATA) through unchanged.
 *
 * Motivation: call-boundary instrumentation (record stats, debit budget, log
 * first-token latency) where the wrapper is re-subscribed by downstream
 * composition (push-on-subscribe §2.2 would otherwise re-deliver the cached
 * value and re-fire the side effect). The closure guard is scoped to the node
 * instance, so the side effect fires exactly once per node lifetime.
 *
 * By default `null` / `undefined` values pass through WITHOUT counting as
 * "first" — matches the SENTINEL convention (COMPOSITION-GUIDE §8) used by
 * `promptNode`, `fromAny(Promise)`, and friends where a cached `null` means
 * "not yet settled." Pass `where` to override with a custom predicate.
 *
 * @param source - Upstream node.
 * @param fn - Side effect invoked once on the first qualifying value.
 * @param opts - Optional {@link NodeOptions} plus `where` predicate. Default
 *   `where: (v) => v != null`.
 * @returns `Node<T>` - Passthrough node.
 *
 * @example
 * ```ts
 * import { onFirstData, fromAny } from "@graphrefly/graphrefly-ts";
 *
 * const tap = onFirstData(fromAny(adapter.invoke(msgs)), (resp) => recordStats(resp));
 * ```
 *
 * @category extra
 */
export function onFirstData<T>(
	source: Node<T>,
	fn: (value: T) => void,
	opts?: ExtraOpts & { where?: (value: T) => boolean },
): Node<T> {
	const where = opts?.where ?? ((v: T) => v != null);
	let fired = false;
	return node<T>(
		[source as Node],
		(data, a) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) {
				if (!fired && where(v as T)) {
					fired = true;
					fn(v as T);
				}
				a.emit(v as T);
			}
		},
		operatorOpts(opts),
	);
}

/**
 * Alias for {@link onFirstData}. Parallels `tap` naming for discoverability —
 * `tapFirst` is the one-shot companion of `tap`.
 *
 * @category extra
 */
export const tapFirst = onFirstData;

/**
 * Suppresses adjacent duplicates using `equals` (default `Object.is`).
 *
 * @param source - Upstream node.
 * @param equals - Optional equality for consecutive values.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Deduped stream.
 *
 * @example
 * ```ts
 * import { distinctUntilChanged, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = distinctUntilChanged(state(1));
 * ```
 *
 * @category extra
 */
export function distinctUntilChanged<T>(
	source: Node<T>,
	equals: (a: T, b: T) => boolean = Object.is,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			let emitted = false;
			for (const val of batch0 as T[]) {
				if (ctx.store.hasPrev && equals(ctx.store.prev as T, val)) {
					// Suppressed — same as previous
				} else {
					ctx.store.prev = val;
					ctx.store.hasPrev = true;
					a.emit(val);
					emitted = true;
				}
			}
			if (!emitted) a.down([[RESOLVED]]);
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("distinctUntilChanged"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Emits `[previous, current]` pairs starting after the second value (first pair uses `RESOLVED` only).
 *
 * @param source - Upstream node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<readonly [T, T]>` - Pair stream.
 *
 * @example
 * ```ts
 * import { pairwise, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = pairwise(state(0));
 * ```
 *
 * @category extra
 */
export function pairwise<T>(source: Node<T>, opts?: ExtraOpts): Node<readonly [T, T]> {
	return node<readonly [T, T]>(
		[source as Node],
		(data, a, ctx) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			let emitted = false;
			for (const x of batch0 as T[]) {
				if (!ctx.store.hasPrev) {
					ctx.store.prev = x;
					ctx.store.hasPrev = true;
					// First value — no pair yet
				} else {
					const pair = [ctx.store.prev as T, x] as const;
					ctx.store.prev = x;
					a.emit(pair);
					emitted = true;
				}
			}
			if (!emitted) a.down([[RESOLVED]]);
		},
		operatorOpts(opts),
	);
}

/**
 * Combines the latest value from each dependency whenever any dep settles (combineLatest).
 *
 * @param sources - Nodes to combine (variadic).
 * @returns `Node<T>` - Tuple of latest values.
 *
 * @example
 * ```ts
 * import { combine, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = combine(state(1), state("a"));
 * ```
 *
 * @remarks
 * Unlike RxJS `combineLatest`, this is named `combine`. Use the {@link combineLatest} alias
 * if you prefer the RxJS name. Seed is always required for `scan`/`reduce` (no seedless mode).
 *
 * @category extra
 */
export function combine<const T extends readonly unknown[]>(
	...sources: { [K in keyof T]: Node<T[K]> }
): Node<T> {
	const deps = [...sources] as unknown as Node[];
	return derived(deps, (vals) => vals as unknown as T, {
		...operatorOpts<T>(),
		equals: (a, b) => {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				if (!Object.is(a[i], b[i])) return false;
			}
			return true;
		},
	});
}

/**
 * When `primary` settles, emits `[primary, latestSecondary]`. `secondary` alone updates cache only.
 *
 * @param primary - Main stream.
 * @param secondary - Latest value is paired on each primary emission.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<readonly [A, B]>` - Paired stream.
 *
 * @example
 * ```ts
 * import { state, withLatestFrom } from "@graphrefly/graphrefly-ts";
 *
 * const n = withLatestFrom(state(1), state("x"));
 * ```
 *
 * @category extra
 */
export function withLatestFrom<A, B>(
	primary: Node<A>,
	secondary: Node<B>,
	opts?: ExtraOpts,
): Node<readonly [A, B]> {
	// **Phase 10.5 (2026-04-29; see `archive/docs/SESSION-graph-narrow-waist.md`
	// § "Phase 10.5 — `partial: false` is the actual fix"):** flipped from
	// `partial: true` to `partial: false`. Previously withLatestFrom opted
	// out of the §2.7 first-run gate to admit partial-dep waves; the side
	// effect was that on initial activation with state+state-cached deps,
	// the paired emission was dropped (W1 — see [optimizations.md "Multi-dep
	// push-on-subscribe ordering"](../../../docs/optimizations.md), and
	// COMPOSITION-GUIDE §28). With `partial: false` the gate holds during
	// activation until both deps deliver real DATA, then fires once with
	// `[primary, latestSecondary]` populated. The gate scope is
	// `_hasCalledFnOnce === false` only ([core/node.ts:1642-1645]) — once
	// fn fires, subsequent waves are gate-free and the "fire on primary
	// alone after warmup" semantic is preserved. Behavior diff vs the prior
	// `partial: true`: at activation when one dep is sentinel forever, fn
	// no longer emits a RESOLVED; it stays silent until the missing dep
	// delivers real DATA. **Audit (in-tree `withLatestFrom` consumers):**
	// `harness-loop.ts:511 triageInput` (both deps state-cached, gate
	// releases at activation), `harness-loop.ts:547 routerInput` (both deps
	// sentinel until first triage cycle, gate holds in both pre and post
	// Phase 10.5 — equivalent), `suggest-strategy.ts:176 paired`
	// (sentinel-forever-secondary case: pre-Phase-10.5 dispatched RESOLVED
	// but RESOLVED does not release downstream first-run gates per
	// [core/node.ts:1651-1660], so end state is identical). Flipping
	// individually in this fn (not via `partialOperatorOpts`) so `valve`
	// (which deliberately needs `partial: true` for control-alone-on-
	// activation) and any other partial-dep operators remain unaffected.
	return node<readonly [A, B]>(
		[primary as Node, secondary as Node],
		(data, a, ctx) => {
			const batch0 = data[0];
			const batch1 = data[1];
			// Current secondary value: this wave's last DATA if secondary fired,
			// otherwise last known value from ctx.prevData (previous wave).
			const secondaryVal = (
				batch1 != null && batch1.length > 0 ? batch1.at(-1) : ctx.prevData[1]
			) as B | undefined;

			// Only emit when primary (dep 0) sent DATA this wave.
			if (batch0 != null && batch0.length > 0) {
				// secondary has never produced DATA — undefined is the protocol
				// sentinel for "never sent DATA"; null is a valid DATA value.
				// With `partial: false` the gate holds during activation until
				// secondary delivers real DATA, so this branch is dead on the
				// first wave. It IS reachable post-warmup if secondary
				// INVALIDATEs (which clears `prevData[1]` to undefined per
				// `_depInvalidated` at [core/node.ts:1624-1635]) and then
				// primary fires before secondary re-delivers. INVALIDATE does
				// NOT re-arm the first-run gate ([core/node.ts:269] "Subsequent
				// waves, INVALIDATE, and `_addDep` do not re-gate"), so this
				// guard catches that re-delivery-pending window. (Terminal
				// settlement on secondary leaves `prevData[1]` populated per
				// `_depSettledAsTerminal` at [core/node.ts:1609-1617] — that
				// path doesn't reach this branch.)
				if (!(batch1 != null && batch1.length > 0) && ctx.prevData[1] === undefined) {
					a.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0 as A[]) {
					a.emit([v, secondaryVal]);
				}
			} else {
				// Secondary update only (or both RESOLVED) — no downstream DATA.
				a.down([[RESOLVED]]);
			}
		},
		{
			...gatedOperatorOpts<readonly [A, B]>(opts),
			meta: { ...factoryTag("withLatestFrom"), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Merges **`DATA`** from any source with correct two-phase dirty tracking. **`COMPLETE`** after **all** sources complete (spec §1.3.5).
 *
 * @param sources - Nodes to merge (variadic; empty completes immediately).
 * @returns `Node<T>` - Merged stream.
 *
 * @remarks
 * **Ordering:** DIRTY/RESOLVED rules follow multi-source semantics in `~/src/graphrefly/GRAPHREFLY-SPEC.md`.
 *
 * @example
 * ```ts
 * import { merge, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = merge(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function merge<T>(...sources: readonly Node<T>[]): Node<T> {
	if (sources.length === 0) {
		return producer<T>(
			(a) => {
				a.down([[COMPLETE]]);
			},
			{ ...operatorOpts(), meta: { ...factoryTag("merge") } },
		);
	}
	// producer pattern: node() cannot be used here because the sentinel gate
	// would block the fn until ALL sources have sent their first DATA, which
	// defeats the purpose of merge (forward whichever source fires first).
	return producer<T>(
		(a) => {
			const n = sources.length;
			let completed = 0;
			const unsubs: (() => void)[] = [];
			for (const src of sources) {
				const u = src.subscribe((msgs) => {
					for (const m of msgs) {
						if (m[0] === DATA) {
							a.emit(m[1] as T);
						} else if (m[0] === COMPLETE) {
							completed += 1;
							if (completed >= n) {
								a.down([[COMPLETE]]);
							}
						} else if (m[0] === ERROR) {
							a.down([m]);
						}
						// DIRTY, RESOLVED, START silently absorbed
					}
				});
				unsubs.push(u);
			}
			return () => {
				for (const u of unsubs) u();
			};
		},
		{ ...operatorOpts(), meta: { ...factoryTag("merge") } },
	);
}

/**
 * Zips one **`DATA`** from each source per cycle into a tuple. Only **`DATA`** enqueues (spec §1.3.3).
 *
 * @param sources - Nodes to zip (variadic).
 * @returns `Node<T>` - Zipped tuples.
 *
 * @example
 * ```ts
 * import { state, zip } from "@graphrefly/graphrefly-ts";
 *
 * const n = zip(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function zip<const T extends readonly unknown[]>(
	...sources: { [K in keyof T]: Node<T[K]> }
): Node<T> {
	const n = sources.length;
	if (n === 0) {
		return producer<T>((a) => {
			a.emit([] as unknown as T);
			a.down([[COMPLETE]]);
		}, operatorOpts());
	}
	// Producer pattern: manage queues internally.
	return producer<T>((a) => {
		const queues: unknown[][] = Array.from({ length: n }, () => []);
		let active = n;

		function tryEmit(): void {
			while (queues.every((q) => q.length > 0)) {
				const tuple = queues.map((q) => q.shift()!) as unknown as T;
				a.emit(tuple);
			}
		}

		const unsubs: (() => void)[] = [];
		for (let i = 0; i < n; i++) {
			const idx = i;
			const u = (sources[i] as Node).subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						queues[idx].push(m[1]);
						tryEmit();
					} else if (m[0] === COMPLETE) {
						active -= 1;
						if (active === 0 || queues[idx].length === 0) {
							a.down([[COMPLETE]]);
						}
					} else if (m[0] === ERROR) {
						a.down([m]);
					}
				}
			});
			unsubs.push(u);
		}
		return () => {
			for (const u of unsubs) u();
		};
	}, operatorOpts());
}

/**
 * Plays all of `firstSrc`, then all of `secondSrc`. **`DATA`** from `secondSrc` during phase one is buffered until handoff.
 *
 * @param firstSrc - First segment.
 * @param secondSrc - Second segment.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Concatenated stream.
 *
 * @example
 * ```ts
 * import { concat, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = concat(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function concat<T>(firstSrc: Node<T>, secondSrc: Node<T>, opts?: ExtraOpts): Node<T> {
	// producer pattern: node() cannot be used here because the sentinel gate
	// would block the fn until ALL sources have sent their first DATA, which
	// defeats the purpose of concat (start forwarding firstSrc immediately,
	// regardless of secondSrc state).
	return producer<T>((a) => {
		let phase: 0 | 1 = 0;
		const pending: unknown[] = [];
		let firstUnsub: (() => void) | undefined;
		let secondUnsub: (() => void) | undefined;

		secondUnsub = secondSrc.subscribe((msgs) => {
			for (const m of msgs) {
				if (phase === 0) {
					if (m[0] === DATA) pending.push(m[1]);
					else if (m[0] === ERROR) a.down([m]);
				} else {
					// phase 1 — forward everything from second
					if (m[0] === DATA) a.emit(m[1] as T);
					else if (m[0] === COMPLETE || m[0] === ERROR) a.down([m]);
				}
			}
		});

		firstUnsub = firstSrc.subscribe((msgs) => {
			for (const m of msgs) {
				if (phase === 0) {
					if (m[0] === DATA) {
						a.emit(m[1] as T);
					} else if (m[0] === COMPLETE) {
						phase = 1;
						// Flush buffered second-source DATA
						for (const v of pending) {
							a.emit(v as T);
						}
						pending.length = 0;
					} else if (m[0] === ERROR) {
						a.down([m]);
					}
				}
				// phase 1: ignore further first-source messages
			}
		});

		return () => {
			firstUnsub?.();
			secondUnsub?.();
		};
	}, operatorOpts(opts));
}

/**
 * First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`).
 *
 * @param sources - Contestants (variadic; empty completes immediately; one node is identity).
 * @returns `Node<T>` - Winning stream.
 *
 * @example
 * ```ts
 * import { race, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = race(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function race<T>(...sources: readonly Node<T>[]): Node<T> {
	if (sources.length === 0) {
		return producer<T>((a) => {
			a.down([[COMPLETE]]);
		}, operatorOpts());
	}
	if (sources.length === 1) {
		// Identity passthrough — full batch iteration, not derived's .at(-1).
		return node<T>(
			[sources[0] as Node],
			(data, a) => {
				const batch0 = data[0];
				if (batch0 == null || batch0.length === 0) {
					a.down([[RESOLVED]]);
					return;
				}
				for (const v of batch0) a.emit(v as T);
			},
			operatorOpts<T>(),
		);
	}
	// Producer pattern: first DATA wins.
	return producer<T>((a) => {
		let winner: number | null = null;
		const unsubs: (() => void)[] = [];
		for (let i = 0; i < sources.length; i++) {
			const idx = i;
			const u = (sources[i] as Node).subscribe((msgs) => {
				for (const m of msgs) {
					if (winner !== null && idx !== winner) return;
					if (m[0] === DATA) {
						if (winner === null) winner = idx;
						a.emit(m[1] as T);
					} else if (m[0] === COMPLETE || m[0] === ERROR) {
						if (winner === null || idx === winner) {
							a.down([m]);
						}
					}
				}
			});
			unsubs.push(u);
		}
		return () => {
			for (const u of unsubs) u();
		};
	}, operatorOpts());
}

// --- Tier 2: async / dynamic (roadmap §2.2), all on `node` / `producer` ---

function forwardInner<R>(inner: Node<R>, a: NodeActions, onInnerComplete: () => void): () => void {
	let unsub: (() => void) | undefined;
	let finished = false;
	const finish = (): void => {
		if (finished) return;
		finished = true;
		onInnerComplete();
	};
	unsub = inner.subscribe((msgs) => {
		let sawComplete = false;
		let sawError = false;
		for (const m of msgs) {
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
			unsub?.();
			unsub = undefined;
			finish();
		} else if (sawComplete) {
			finish();
		}
	});
	// P4 START handshake guarantees: subscribe delivers [[START], [DATA, cache]]
	// synchronously for settled nodes. Any relevant state is already handled by
	// the callback above — no post-subscribe .status/.cache reads needed.
	return () => {
		unsub?.();
		unsub = undefined;
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
			innerUnsub = forwardInner(fromAny(project(batch0[batch0.length - 1] as T)), a, () => {
				clearInner();
				if (sourceDone) a.down([[COMPLETE]]);
			});

			// Deactivate-only cleanup: must NOT fire before fn reruns
			// because the terminal wave needs to see innerUnsub intact.
			return {
				deactivate: () => {
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
				innerUnsub = forwardInner(fromAny(project(batch0[0] as T)), a, () => {
					clearInner();
					if (sourceDone) a.down([[COMPLETE]]);
				});
			} else {
				// Inner active — drop, settle the dep-wave
				a.down([[RESOLVED]]);
			}

			return {
				deactivate: () => {
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
		innerUnsub = forwardInner(fromAny(project(v)), actions, () => {
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
				deactivate: () => {
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
		stop = forwardInner(fromAny(project(v)), actions, () => {
			if (stop) innerStops.delete(stop);
			active--;
			drainBuffer();
			tryComplete();
		});
		innerStops.add(stop);
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
				deactivate: () => {
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

/**
 * Delays phase-2 emissions by `ms` (timers). `DIRTY` still forwards immediately.
 *
 * @param source - Upstream node.
 * @param ms - Delay in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Same values, shifted in time.
 * @example
 * ```ts
 * import { delay, state } from "@graphrefly/graphrefly-ts";
 *
 * delay(state(1), 100);
 * ```
 *
 * @category extra
 */
export function delay<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	return producer<T>((a) => {
		const timers = new Set<ReturnType<typeof setTimeout>>();
		function clearAll(): void {
			for (const id of timers) clearTimeout(id);
			timers.clear();
		}

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const id = setTimeout(() => {
						timers.delete(id);
						a.emit(m[1] as T);
					}, ms);
					timers.add(id);
				} else if (m[0] === COMPLETE) {
					// Wait for all pending timers, then complete
					const id = setTimeout(() => {
						timers.delete(id);
						a.down([[COMPLETE]]);
					}, ms);
					timers.add(id);
				} else if (m[0] === ERROR) {
					clearAll();
					a.down([m]);
				}
				// DIRTY from source is NOT forwarded — delay transforms the
				// timeline. a.emit(v) in the timer callback handles full
				// DIRTY+DATA framing atomically at the delayed time.
			}
		});

		return () => {
			srcUnsub();
			clearAll();
		};
	}, operatorOpts(opts));
}

/**
 * Emits the latest value only after `ms` quiet time since the last trigger (`debounce`).
 *
 * @param source - Upstream node.
 * @param ms - Quiet window in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Debounced stream.
 * @example
 * ```ts
 * import { debounce, state } from "@graphrefly/graphrefly-ts";
 *
 * debounce(state(0), 50);
 * ```
 *
 * @category extra
 */
export function debounce<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	return producer<T>(
		(a) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let pending: T | undefined;

			function clearTimer(): void {
				if (timer !== undefined) {
					clearTimeout(timer);
					timer = undefined;
				}
			}

			const srcUnsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						clearTimer();
						pending = m[1] as T;
						timer = setTimeout(() => {
							timer = undefined;
							a.emit(pending as T);
						}, ms);
					} else if (m[0] === COMPLETE) {
						if (timer !== undefined) {
							clearTimer();
							a.emit(pending as T);
						}
						a.down([[COMPLETE]]);
					} else if (m[0] === ERROR) {
						clearTimer();
						a.down([m]);
					}
				}
			});

			return () => {
				srcUnsub();
				clearTimer();
			};
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("debounce", { ms }), ...(opts?.meta ?? {}) },
		},
	);
}

export type ThrottleOptions = { leading?: boolean; trailing?: boolean };

/**
 * Rate-limits emissions to at most once per `ms` window (`throttleTime`).
 *
 * @param source - Upstream node.
 * @param ms - Minimum spacing in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`) plus `leading` / `trailing`.
 * @returns `Node<T>` - Throttled stream.
 * @example
 * ```ts
 * import { throttle, state } from "@graphrefly/graphrefly-ts";
 *
 * throttle(state(0), 1_000, { trailing: false });
 * ```
 *
 * @category extra
 */
export function throttle<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & ThrottleOptions,
): Node<T> {
	const { leading: leadingOpt, trailing: trailingOpt, ...throttleNodeOpts } = opts ?? {};
	const leading = leadingOpt !== false;
	const trailing = trailingOpt === true;
	const windowNs = ms * NS_PER_MS;

	return producer<T>(
		(a) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let lastEmitNs = -Infinity;
			let pending: T | undefined;
			let hasPending = false;

			function clearTimer(): void {
				if (timer !== undefined) {
					clearTimeout(timer);
					timer = undefined;
				}
			}

			const srcUnsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						const v = m[1] as T;
						const nowNs = monotonicNs();
						if (leading && nowNs - lastEmitNs >= windowNs) {
							lastEmitNs = nowNs;
							a.emit(v);
							clearTimer();
							if (trailing) {
								timer = setTimeout(() => {
									timer = undefined;
									if (hasPending) {
										lastEmitNs = monotonicNs();
										a.emit(pending as T);
										hasPending = false;
									}
								}, ms);
							}
						} else if (trailing) {
							pending = v;
							hasPending = true;
							if (timer === undefined) {
								const elapsedMs = (nowNs - lastEmitNs) / NS_PER_MS;
								timer = setTimeout(
									() => {
										timer = undefined;
										if (hasPending) {
											lastEmitNs = monotonicNs();
											a.emit(pending as T);
											hasPending = false;
										}
									},
									Math.max(0, ms - elapsedMs),
								);
							}
						}
					} else if (m[0] === COMPLETE || m[0] === ERROR) {
						clearTimer();
						a.down([m]);
					}
				}
			});

			return () => {
				srcUnsub();
				clearTimer();
			};
		},
		{
			...operatorOpts(throttleNodeOpts),
			meta: {
				...factoryTag("throttle", { ms, leading, trailing }),
				...(throttleNodeOpts.meta ?? {}),
			},
		},
	);
}

/**
 * Emits the most recent source value whenever `notifier` emits `DATA` (`sample`).
 *
 * Source `COMPLETE` stops sampling (clears held value); notifier `COMPLETE` terminates the
 * operator. `ERROR` from either dep terminates immediately. At most one terminal message is
 * emitted downstream (latch). Supports `resubscribable` — `ctx.store` resets automatically.
 *
 * @param source - Node whose latest value is sampled.
 * @param notifier - When this node emits `DATA`, a sample is taken.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Sampled snapshots of `source`.
 * @example
 * ```ts
 * import { sample, state } from "@graphrefly/graphrefly-ts";
 *
 * sample(state(1), state(0));
 * ```
 *
 * @category extra
 */
export function sample<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T> {
	return producer<T>((a) => {
		let lastSourceValue: { v: T } | undefined;
		let terminated = false;
		let sourceCompleted = false;

		const srcUnsub = source.subscribe((msgs) => {
			if (terminated) return;
			for (const m of msgs) {
				if (terminated) return;
				if (m[0] === DATA) {
					lastSourceValue = { v: m[1] as T };
				} else if (m[0] === ERROR) {
					terminated = true;
					a.down([m]);
				} else if (m[0] === COMPLETE) {
					sourceCompleted = true;
					lastSourceValue = undefined;
				}
			}
		});

		const notUnsub = notifier.subscribe((msgs) => {
			if (terminated) return;
			for (const m of msgs) {
				if (terminated) return;
				if (m[0] === DATA) {
					if (lastSourceValue !== undefined && !sourceCompleted) {
						a.emit(lastSourceValue.v);
					}
				} else if (m[0] === ERROR) {
					terminated = true;
					a.down([m]);
				} else if (m[0] === COMPLETE) {
					terminated = true;
					a.down([[COMPLETE]]);
				}
			}
		});

		return () => {
			srcUnsub();
			notUnsub();
		};
	}, operatorOpts(opts));
}

/**
 * After each source `DATA`, waits `ms` then emits the latest value if another `DATA` has not arrived (`auditTime` / trailing window).
 *
 * @param source - Upstream node.
 * @param ms - Window in milliseconds after each `DATA`.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Trailing-edge sampled stream.
 * @example
 * ```ts
 * import { audit, state } from "@graphrefly/graphrefly-ts";
 *
 * audit(state(0), 100);
 * ```
 *
 * @category extra
 */
export function audit<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	return producer<T>((a) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let latest: T | undefined;
		let has = false;

		function clearTimer(): void {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		}

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					latest = m[1] as T;
					has = true;
					clearTimer();
					timer = setTimeout(() => {
						timer = undefined;
						if (has) {
							has = false;
							a.emit(latest as T);
						}
					}, ms);
				} else if (m[0] === COMPLETE || m[0] === ERROR) {
					clearTimer();
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			clearTimer();
		};
	}, operatorOpts(opts));
}

/**
 * Errors if no `DATA` arrives within `ms` after subscribe or after the previous `DATA`.
 *
 * @param source - Upstream node.
 * @param ms - Idle budget in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`) and `with` for a custom error payload.
 * @returns `Node<T>` - Pass-through with idle watchdog.
 * @example
 * ```ts
 * import { timeout, state } from "@graphrefly/graphrefly-ts";
 *
 * timeout(state(0), 5_000);
 * ```
 *
 * @category extra
 */
export function timeout<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & { with?: unknown },
): Node<T> {
	const { with: withPayload, ...timeoutNodeOpts } = opts ?? {};
	const err = withPayload ?? new Error("timeout");

	return producer<T>((a) => {
		let timer: ReturnType<typeof setTimeout> | undefined;

		function arm(): void {
			clearTimeout(timer);
			timer = setTimeout(() => {
				timer = undefined;
				a.down([[ERROR, err]]);
			}, ms);
		}

		// Arm immediately on subscribe
		arm();

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					arm();
					a.emit(m[1] as T);
				} else if (m[0] === COMPLETE || m[0] === ERROR) {
					clearTimeout(timer);
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			clearTimeout(timer);
		};
	}, operatorOpts(timeoutNodeOpts));
}

/**
 * Buffers source `DATA` values; flushes an array when `notifier` settles (`buffer`).
 *
 * @param source - Upstream node.
 * @param notifier - Flush trigger on each settlement.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Emits buffered arrays (may be empty-handled via `RESOLVED` when nothing buffered).
 * @example
 * ```ts
 * import { buffer, state } from "@graphrefly/graphrefly-ts";
 *
 * buffer(state(0), state(0));
 * ```
 *
 * @category extra
 */
export function buffer<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T[]> {
	return producer<T[]>((a) => {
		const buf: T[] = [];

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					buf.push(m[1] as T);
				} else if (m[0] === COMPLETE) {
					if (buf.length > 0) a.emit([...buf]);
					buf.length = 0;
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					a.down([m]);
				}
			}
		});

		const notUnsub = notifier.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					if (buf.length > 0) {
						a.emit([...buf]);
						buf.length = 0;
					}
				} else if (m[0] === COMPLETE) {
					// Notifier complete — forward
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			notUnsub();
			buf.length = 0;
		};
	}, operatorOpts(opts));
}

/**
 * Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`).
 *
 * @param source - Upstream node.
 * @param count - Buffer size before emit; must be > 0.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Emits fixed-size arrays; remainder flushes on `COMPLETE`.
 * @example
 * ```ts
 * import { bufferCount, state } from "@graphrefly/graphrefly-ts";
 *
 * bufferCount(state(0), 3);
 * ```
 *
 * @category extra
 */
export function bufferCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T[]> {
	if (count <= 0) throw new RangeError("bufferCount expects count > 0");
	return producer<T[]>((a) => {
		const buf: T[] = [];

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					buf.push(m[1] as T);
					if (buf.length >= count) {
						a.emit(buf.splice(0, buf.length));
					}
				} else if (m[0] === COMPLETE) {
					if (buf.length > 0) a.emit([...buf]);
					buf.length = 0;
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			buf.length = 0;
		};
	}, operatorOpts(opts));
}

/**
 * Splits source `DATA` into sub-nodes of `count` values each. Each sub-node completes after `count` items or when source completes.
 *
 * @param source - Upstream node.
 * @param count - Items per window.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @example
 * ```ts
 * import { windowCount, state } from "@graphrefly/graphrefly-ts";
 *
 * windowCount(state(0), 3);
 * ```
 *
 * @category extra
 */
export function windowCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<Node<T>> {
	if (count <= 0) throw new RangeError("windowCount expects count > 0");

	return producer<Node<T>>((a) => {
		let winDown: ((msgs: Messages) => void) | undefined;
		let n = 0;

		function openWindow(): void {
			const s = producer<T>((actions) => {
				winDown = actions.down.bind(actions);
				return () => {
					winDown = undefined;
				};
			}, operatorOpts());
			n = 0;
			a.emit(s);
		}

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					if (!winDown) openWindow();
					winDown?.([[DATA, m[1]]]);
					n += 1;
					if (n >= count) {
						winDown?.([[COMPLETE]]);
						winDown = undefined;
					}
				} else if (m[0] === COMPLETE) {
					winDown?.([[COMPLETE]]);
					winDown = undefined;
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					winDown?.([m]);
					winDown = undefined;
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			winDown?.([[COMPLETE]]);
			winDown = undefined;
		};
	}, operatorOpts(opts));
}

/**
 * Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`).
 *
 * @param source - Upstream node.
 * @param ms - Flush interval in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Time-windowed batches.
 * @example
 * ```ts
 * import { bufferTime, state } from "@graphrefly/graphrefly-ts";
 *
 * bufferTime(state(0), 250);
 * ```
 *
 * @category extra
 */
export function bufferTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T[]> {
	return producer<T[]>(
		(a) => {
			const buf: T[] = [];

			const iv = setInterval(() => {
				if (buf.length > 0) {
					a.emit([...buf]);
					buf.length = 0;
				}
			}, ms);

			const srcUnsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						buf.push(m[1] as T);
					} else if (m[0] === COMPLETE) {
						clearInterval(iv);
						if (buf.length > 0) a.emit([...buf]);
						buf.length = 0;
						a.down([[COMPLETE]]);
					} else if (m[0] === ERROR) {
						clearInterval(iv);
						a.down([m]);
					}
					// DIRTY from source is NOT forwarded — bufferTime
					// transforms the timeline. a.emit(buf) handles full
					// DIRTY+DATA framing when the interval fires.
				}
			});

			return () => {
				srcUnsub();
				clearInterval(iv);
				buf.length = 0;
			};
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("bufferTime", { ms }), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Splits source `DATA` into time-windowed sub-nodes; each window lasts `ms`.
 *
 * @param source - Upstream node.
 * @param ms - Window duration in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @example
 * ```ts
 * import { windowTime, state } from "@graphrefly/graphrefly-ts";
 *
 * windowTime(state(0), 500);
 * ```
 *
 * @category extra
 */
export function windowTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<Node<T>> {
	return producer<Node<T>>((a) => {
		let winDown: ((msgs: Messages) => void) | undefined;

		function closeWindow(): void {
			winDown?.([[COMPLETE]]);
			winDown = undefined;
		}

		function openWindow(): void {
			const s = producer<T>((actions) => {
				winDown = actions.down.bind(actions);
				return () => {
					winDown = undefined;
				};
			}, operatorOpts());
			a.emit(s);
		}

		openWindow();
		const iv = setInterval(() => {
			closeWindow();
			openWindow();
		}, ms);

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					winDown?.([[DATA, m[1]]]);
				} else if (m[0] === COMPLETE) {
					clearInterval(iv);
					closeWindow();
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					clearInterval(iv);
					winDown?.([m]);
					closeWindow();
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			clearInterval(iv);
			closeWindow();
		};
	}, operatorOpts(opts));
}

/**
 * Splits source `DATA` into sub-nodes, opening a new window each time `notifier` emits `DATA`.
 *
 * @param source - Upstream node.
 * @param notifier - Each `DATA` from `notifier` closes the current window and opens a new one.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @example
 * ```ts
 * import { state, window } from "@graphrefly/graphrefly-ts";
 *
 * window(state(0), state(0));
 * ```
 *
 * @category extra
 */
export function window<T>(
	source: Node<T>,
	notifier: Node<unknown>,
	opts?: ExtraOpts,
): Node<Node<T>> {
	return producer<Node<T>>((a) => {
		let winDown: ((msgs: Messages) => void) | undefined;

		function closeWindow(): void {
			winDown?.([[COMPLETE]]);
			winDown = undefined;
		}

		function openWindow(): void {
			const s = producer<T>((actions) => {
				winDown = actions.down.bind(actions);
				return () => {
					winDown = undefined;
				};
			}, operatorOpts());
			a.emit(s);
		}

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					if (!winDown) openWindow();
					winDown?.([[DATA, m[1]]]);
				} else if (m[0] === COMPLETE) {
					closeWindow();
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					winDown?.([m]);
					winDown = undefined;
					a.down([m]);
				}
			}
		});

		const notUnsub = notifier.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					closeWindow();
					openWindow();
				}
			}
		});

		return () => {
			srcUnsub();
			notUnsub();
			closeWindow();
		};
	}, operatorOpts(opts));
}

/**
 * Increments on each tick (`interval`); uses `setInterval` via {@link producer}.
 *
 * @param periodMs - Time between ticks.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<number>` - Emits `0`, `1`, `2`, … while subscribed.
 * @example
 * ```ts
 * import { interval } from "@graphrefly/graphrefly-ts";
 *
 * interval(1_000);
 * ```
 *
 * @category extra
 */
export function interval(periodMs: number, opts?: ExtraOpts): Node<number> {
	return producer<number>((a, ctx) => {
		if (!("n" in ctx.store)) ctx.store.n = 0;
		const id = setInterval(() => {
			a.emit(ctx.store.n as number);
			ctx.store.n = (ctx.store.n as number) + 1;
		}, periodMs);
		return () => clearInterval(id);
	}, operatorOpts(opts));
}

/**
 * Subscribes to `source` repeatedly (`count` times, sequentially). Best with a fresh or `resubscribable` source.
 *
 * @param source - Upstream node to replay.
 * @param count - Number of subscription rounds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Forwards each round then completes after the last inner `COMPLETE`.
 * @example
 * ```ts
 * import { repeat, state } from "@graphrefly/graphrefly-ts";
 *
 * repeat(state(1, { resubscribable: true }), 2);
 * ```
 *
 * @category extra
 */
export function repeat<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T> {
	if (count <= 0) throw new RangeError("repeat expects count > 0");
	return producer<T>((a) => {
		let remaining = count;
		let innerU: (() => void) | undefined;

		const start = (): void => {
			innerU?.();
			innerU = source.subscribe((msgs) => {
				let completed = false;
				const fwd: Message[] = [];
				for (const m of msgs) {
					if (m[0] === COMPLETE) completed = true;
					else fwd.push(m);
				}
				if (fwd.length > 0) a.down(fwd as unknown as Messages);
				if (completed) {
					innerU?.();
					innerU = undefined;
					remaining -= 1;
					if (remaining > 0) start();
					else a.down([[COMPLETE]]);
				}
			});
		};

		start();
		return () => {
			innerU?.();
		};
	}, operatorOpts(opts));
}

/**
 * Identity passthrough — `pausable()` has been promoted to default node behavior in v5 (§4).
 *
 * @deprecated Default node behavior now handles PAUSE/RESUME. This operator is a no-op
 * identity passthrough kept only for migration compatibility.
 *
 * @param source - Upstream node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Pass-through (identity).
 * @example
 * ```ts
 * import { pausable, state } from "@graphrefly/graphrefly-ts";
 *
 * // No longer needed — default nodes handle PAUSE/RESUME.
 * const s = state(0);
 * pausable(s); // identity passthrough
 * ```
 *
 * @category extra
 */
export function pausable<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return node<T>(
		[source as Node],
		(data, a) => {
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return;
			}
			for (const v of batch0) a.emit(v as T);
		},
		operatorOpts<T>(opts),
	);
}

/**
 * Replaces an upstream `ERROR` with a recovered value (`catchError`-style).
 *
 * @param source - Upstream node.
 * @param recover - Maps the error payload to a replacement value; if it throws, `ERROR` is forwarded.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Recovered stream.
 * @example
 * ```ts
 * import { rescue, state } from "@graphrefly/graphrefly-ts";
 *
 * rescue(state(0), () => 0);
 * ```
 *
 * @category extra
 */
export function rescue<T>(
	source: Node<T>,
	recover: (err: unknown) => T,
	opts?: ExtraOpts,
): Node<T> {
	return producer<T>((a) => {
		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					a.emit(m[1] as T);
				} else if (m[0] === ERROR) {
					try {
						a.emit(recover(m[1]));
					} catch (recoverErr) {
						a.down([[ERROR, recoverErr]]);
					}
				} else if (m[0] === COMPLETE) {
					a.down([[COMPLETE]]);
				}
			}
		});
		return () => {
			srcUnsub();
		};
	}, operatorOpts(opts));
}

/**
 * Forwards upstream `DATA` only while `control.get()` is truthy; when closed, emits `RESOLVED`
 * instead of repeating the last value (value-level valve). For protocol pause/resume, use default
 * node PAUSE/RESUME behavior.
 *
 * @param source - Upstream value node.
 * @param control - Boolean node; when falsy, output stays "closed" for that tick.
 * @param opts - Optional node options (excluding `describeKind`).
 * @returns `Node<T>` gated by `control`.
 *
 * @example
 * ```ts
 * import { valve, state } from "@graphrefly/graphrefly-ts";
 *
 * const data = state(1);
 * const open = state(true);
 * valve(data, open);
 * ```
 *
 * @category extra
 */
export function valve<T>(source: Node<T>, control: Node<boolean>, opts?: ExtraOpts): Node<T> {
	return node<T>(
		[source as Node, control as Node],
		(data, a, ctx) => {
			const batch1 = data[1];
			// undefined = control never sent DATA (gate closed); falsy = explicitly closed.
			const controlValue = batch1 != null && batch1.length > 0 ? batch1.at(-1) : ctx.prevData[1];
			if (!controlValue) {
				a.down([[RESOLVED]]);
				return;
			}
			const batch0 = data[0];
			if (batch0 != null && batch0.length > 0) {
				// Source data this wave: forward it.
				for (const v of batch0) a.emit(v as T);
				return;
			}
			// Control just opened this wave but source didn't fire this wave.
			// Re-emit the last known source value so downstream sees the current
			// value when the gate opens (only when source has a prior value).
			if (batch1 != null && batch1.length > 0 && ctx.prevData[0] !== undefined) {
				a.emit(ctx.prevData[0] as T);
				return;
			}
			a.down([[RESOLVED]]);
		},
		// valve fires on either source-alone (forwards) or control-alone
		// (re-emits prior source when gate opens). Needs partial firing so
		// the control wave can reach fn before source has ever delivered.
		// **Asymmetry vs `withLatestFrom` (Phase 10.5, 2026-04-29):**
		// `withLatestFrom` flipped to `partial: false` to fix the W1
		// initial-pair drop. `valve` cannot make the same flip — its
		// control-alone-on-activation semantic explicitly requires firing
		// before `source` delivers. Consequence: `valve(stateSource,
		// stateControl)` may drop the initial paired emission when both
		// deps are state-cached at activation, same shape as the pre-fix
		// `withLatestFrom`. Callers that need the initial-pair guarantee
		// should use the §28 closure-mirror pattern (capture
		// `source.cache` + `control.cache` at wiring time, read inside a
		// downstream fn). See COMPOSITION-GUIDE §28.
		partialOperatorOpts(opts),
	);
}

// ——————————————————————————————————————————————————————————————
//  RxJS-compatible aliases — improve AI code-generation accuracy
// ——————————————————————————————————————————————————————————————

/**
 * RxJS-named alias for {@link combine} — emits when any dep updates with latest tuple of values.
 *
 * @param sources - Upstream nodes as separate arguments (same calling shape as `combine`).
 * @returns Combined node; signature matches `combine`.
 *
 * @example
 * ```ts
 * import { combineLatest, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = combineLatest(state(1), state("a"));
 * ```
 *
 * @category extra
 */
export const combineLatest = combine;

/**
 * RxJS-named alias for {@link debounce} — drops rapid `DATA` until `ms` of quiet.
 *
 * @param source - Upstream node.
 * @param ms - Quiet period in milliseconds.
 * @param opts - Optional node options (excluding `describeKind`).
 * @returns Debounced node; behavior matches `debounce`.
 *
 * @example
 * ```ts
 * import { debounceTime, state } from "@graphrefly/graphrefly-ts";
 *
 * debounceTime(state(0), 100);
 * ```
 *
 * @category extra
 */
export const debounceTime = debounce;

/**
 * RxJS-named alias for {@link throttle} — emits on leading/trailing edges within `ms`.
 *
 * @param source - Upstream node.
 * @param ms - Minimum spacing in milliseconds.
 * @param opts - Optional throttle shape (`leading` / `trailing`) and node options.
 * @returns Throttled node; behavior matches `throttle`.
 *
 * @example
 * ```ts
 * import { throttleTime, state } from "@graphrefly/graphrefly-ts";
 *
 * throttleTime(state(0), 100);
 * ```
 *
 * @category extra
 */
export const throttleTime = throttle;

/**
 * RxJS-named alias for {@link rescue} — replaces upstream `ERROR` with a recovered value.
 *
 * @param source - Upstream node.
 * @param recover - Maps error payload to replacement value.
 * @param opts - Optional node options (excluding `describeKind`).
 * @returns Recovered stream; behavior matches `rescue`.
 *
 * @example
 * ```ts
 * import { catchError, state } from "@graphrefly/graphrefly-ts";
 *
 * catchError(state(0), () => 0);
 * ```
 *
 * @category extra
 */
export const catchError = rescue;
