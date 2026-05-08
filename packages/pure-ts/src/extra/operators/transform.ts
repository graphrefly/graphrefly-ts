/**
 * Transform operators (roadmap §2.1) — element-wise mappings and folds.
 *
 * `map`, `filter`, `scan`, `reduce`, `distinctUntilChanged`, `pairwise` —
 * each derives a new node from a single upstream by walking each settled
 * batch and emitting via `actions.emit()`.
 */

import { COMPLETE, RESOLVED } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { type ExtraOpts, operatorOpts } from "./_internal.js";

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
	// Lock 6.D (Phase 13.6.B): clear `acc` on deactivation so a
	// resubscribable scan restarts from `seed` on the next cycle.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.acc;
					},
				};
			}
			if (!("acc" in ctx.store)) ctx.store.acc = seed;
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return cleanup;
			}
			for (const v of batch0) {
				ctx.store.acc = reducer(ctx.store.acc as R, v as T);
				a.emit(ctx.store.acc as R);
			}
			return cleanup;
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
	// Lock 6.D: clear acc on deactivation so a resubscribable reduce
	// starts over with `seed` on the next cycle.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<R>(
		[source as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.acc;
					},
				};
			}
			if (!("acc" in ctx.store)) ctx.store.acc = seed;
			// COMPLETE: emit accumulated value then COMPLETE.
			// ERROR: autoError propagates automatically; nothing to emit.
			if (ctx.terminalDeps[0] === true) {
				a.emit(ctx.store.acc as R);
				a.down([[COMPLETE]]);
				return cleanup;
			}
			const batch0 = data[0];
			// RESOLVED wave (empty batch): propagate RESOLVED. After fn has run once
			// the pre-fn skip handles this; this guard covers the first-wave case.
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return cleanup;
			}
			// DATA: accumulate silently — emit nothing until COMPLETE.
			for (const v of batch0) {
				ctx.store.acc = reducer(ctx.store.acc as R, v as T);
			}
			return cleanup;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			meta: { ...factoryTag("reduce", { initial: seed }), ...(opts?.meta ?? {}) },
		},
	);
}

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
	// Lock 6.D: clear prev/hasPrev on deactivation so a resubscribable
	// dedupe doesn't suppress the next cycle's first DATA against a stale
	// "previous" value from the prior cycle.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<T>(
		[source as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.prev;
						delete store.hasPrev;
					},
				};
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return cleanup;
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
			return cleanup;
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
	// Lock 6.D: clear prev/hasPrev on deactivation so a resubscribable
	// pairwise restarts the "first value, no pair yet" state on each cycle.
	let cleanup: { onDeactivation: () => void } | undefined;
	return node<readonly [T, T]>(
		[source as Node],
		(data, a, ctx) => {
			if (cleanup === undefined) {
				const store = ctx.store;
				cleanup = {
					onDeactivation: () => {
						delete store.prev;
						delete store.hasPrev;
					},
				};
			}
			const batch0 = data[0];
			if (batch0 == null || batch0.length === 0) {
				a.down([[RESOLVED]]);
				return cleanup;
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
			return cleanup;
		},
		operatorOpts(opts),
	);
}
