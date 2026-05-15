/**
 * Settled/signal helpers.
 *
 * Moved from extra/sources/settled.ts during cleave A2.
 * keepalive extracted to base/meta/keepalive.ts.
 */

/**
 * Settled / signal helpers — boundary primitives for converting reactive
 * sources into Promise/AbortSignal endpoints.
 *
 * - {@link firstValueFrom} / {@link firstWhere} — Promise of the first
 *   matching DATA.
 * - {@link awaitSettled} — composition over `firstWhere` + reactive
 *   `timeout` from `extra/resilience` (lazy import to avoid a
 *   resilience → sources cycle).
 * - {@link nodeSignal} — `Node<boolean>` → `AbortSignal` bridge.
 * - {@link keepalive} — empty subscription that keeps a derived node wired
 *   for `.cache` reads.
 * - {@link reactiveCounter} — capped counter exposed as a `Node<number>`.
 */

import { COMPLETE, DATA, DIRTY, ERROR, type Messages } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";

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
 * const val = await firstWhere(strategy.snapshot, snap => snap.size > 0);
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
	opts?: { skipCurrent?: boolean; kick?: () => void },
): Promise<T> {
	// Lock 3.A (Phase 13.6.B): subscribe synchronously inside the function
	// body — NOT inside the Promise executor. Subscribing inside the
	// executor would defer the subscription past any synchronous `kick()`
	// the caller fires after the call returns, race-losing the very wave
	// the caller wants to observe.
	//
	// To bridge sync-subscribe with the async Promise contract, we record
	// any settlement that fires *before* the Promise constructor runs, and
	// the executor immediately resolves/rejects with the recorded value.
	// Settlements after the executor runs go straight through resolve/reject.
	type Pending =
		| { kind: "data"; value: T }
		| { kind: "error"; err: unknown }
		| { kind: "complete" };
	let pending: Pending | undefined;
	let resolveFn: ((value: T) => void) | undefined;
	let rejectFn: ((err: unknown) => void) | undefined;
	let settled = false;
	let shouldUnsub = false;
	let unsub: (() => void) | undefined;
	let inInitialSyncPhase = opts?.skipCurrent === true;

	// QA P1: every settler short-circuits when `settled === true` so a
	// later settle attempt (e.g. `kick()` throwing AFTER it synchronously
	// fired matching DATA, OR a `[DATA matched, ERROR]` wave during
	// push-on-subscribe) cannot overwrite an earlier `pending` outcome.
	// Without this gate, a kick that races sink-callback settlement could
	// reject a Promise the user already has resolved-DATA for.
	const settleData = (v: T): void => {
		if (settled) return;
		settled = true;
		if (resolveFn != null) resolveFn(v);
		else pending = { kind: "data", value: v };
	};
	const settleError = (err: unknown): void => {
		if (settled) return;
		settled = true;
		if (rejectFn != null) rejectFn(err);
		else pending = { kind: "error", err };
	};
	const settleComplete = (): void => {
		if (settled) return;
		settled = true;
		const err = new Error("completed without matching value");
		if (rejectFn != null) rejectFn(err);
		else pending = { kind: "complete" };
	};
	const detach = (): void => {
		if (unsub) {
			unsub();
			unsub = undefined;
		} else shouldUnsub = true;
	};

	const sink: (msgs: Messages) => void = (msgs) => {
		if (settled) return;
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
					settleData(v);
					detach();
					return;
				}
			}
			if (m[0] === ERROR) {
				settleError(m[1]);
				detach();
				return;
			}
			if (m[0] === COMPLETE) {
				settleComplete();
				detach();
				return;
			}
		}
	};
	unsub = source.subscribe(sink);
	inInitialSyncPhase = false;
	// Lock 3.A: fire `kick` AFTER subscribe is in place. With sync
	// subscribe + sync kick, the resulting wave reaches `sink` before
	// control returns — making subscribe-before-kick ordering structurally
	// impossible to misuse.
	if (opts?.kick != null && !settled) {
		try {
			opts.kick();
		} catch (err) {
			settleError(err);
			detach();
		}
	}
	if (shouldUnsub) {
		unsub?.();
		unsub = undefined;
	}

	return new Promise<T>((resolve, reject) => {
		// If a settlement landed synchronously before the executor runs,
		// flush it through immediately.
		if (pending != null) {
			if (pending.kind === "data") resolve(pending.value);
			else if (pending.kind === "error") reject(pending.err);
			else reject(new Error("completed without matching value"));
			return;
		}
		resolveFn = resolve;
		rejectFn = reject;
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
let _timeoutOp: typeof import("../resilience/index.js").timeout | undefined;
let _nsPerMs: number | undefined;

export async function awaitSettled<T>(
	source: Node<T>,
	opts?: {
		predicate?: (value: T) => boolean;
		timeoutMs?: number;
		skipCurrent?: boolean;
		/**
		 * Lock 3.A (Phase 13.6.B): fired AFTER subscribe is in place but
		 * BEFORE the helper's async boundary is exposed to the caller.
		 * Subscribe-before-kick is structurally enforced — the kick's
		 * synchronous wave reaches `sink` before control returns. Replaces
		 * the prior load-bearing-comment pattern (M.20-load-bearing) with
		 * a misuse-impossible API shape.
		 *
		 * Common pattern:
		 *   await awaitSettled(node, {
		 *     skipCurrent: true,
		 *     kick: () => producer.emit(value),
		 *   });
		 *
		 * Omit `kick` for external-trigger cases where the wave is fired
		 * by code outside the helper's caller; subscribe still lands
		 * synchronously inside the helper body so the next external wave
		 * is not lost.
		 */
		kick?: () => void;
	},
): Promise<NonNullable<T>> {
	const predicate = opts?.predicate ?? ((v: T) => v != null);
	const skipCurrent = opts?.skipCurrent;
	const kick = opts?.kick;
	if (opts?.timeoutMs == null || opts.timeoutMs <= 0) {
		return (await firstWhere(source, predicate, { skipCurrent, kick })) as NonNullable<T>;
	}
	// Reactive composition: `timeout()` wraps the source as a Node that
	// emits ERROR(TimeoutError) on deadline. `firstWhere` then resolves on
	// the first matching DATA or rejects on that ERROR. One async boundary
	// (the returned Promise), everything inside is sync reactive.
	if (_timeoutOp === undefined) {
		const [resilience, backoff] = await Promise.all([
			import("../resilience/index.js"),
			import("../resilience/backoff.js"),
		]);
		_timeoutOp = resilience.timeout;
		_nsPerMs = backoff.NS_PER_MS;
	}
	const guarded = _timeoutOp(source, { ns: opts.timeoutMs * (_nsPerMs as number) }).node;
	return (await firstWhere(guarded, predicate, { skipCurrent, kick })) as NonNullable<T>;
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
	const counter = node([], { initial: 0 });
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
