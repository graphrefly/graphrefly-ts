/**
 * Control operators (roadmap §2.1) — gate, recover, repeat, observe.
 *
 * `valve` (boolean control), `rescue` / `catchError` (recover from ERROR),
 * `pausable` (deprecated identity), `repeat` (sequential resubscribe), `tap`
 * (side-effect passthrough with optional observer object),
 * `onFirstData` / `tapFirst` (one-shot first-DATA tap), `timeout` (idle
 * watchdog).
 */

import type { Message, Messages } from "../../core/messages.js";
import { COMPLETE, DATA, ERROR, RESOLVED } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { type ExtraOpts, operatorOpts, partialOperatorOpts } from "./_internal.js";

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

	return node<T>((_data, a) => {
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
	return node<T>((_data, a) => {
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
	return node<T>((_data, a) => {
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
