// ---------------------------------------------------------------------------
// Observable bridge — reactive interop between GraphReFly nodes and the TC39
// Observable contract (the well-known `Symbol.observable` / "@@observable"
// method). **Zero runtime dependency on rxjs**: the returned value is a
// spec-interop observable that rxjs `from()`, Angular, the NestJS compat
// layer, and any `Symbol.observable` consumer can adopt. Consumers wanting
// rxjs operators do `from(toObservable(node))`.
//
// Usage:
//   import { toObservable } from '@graphrefly/graphrefly/base';
//   import { from } from 'rxjs';
//   const values$ = from(toObservable(myNode));               // Observable<T>
//   const msgs$   = from(toObservable(myNode, { raw: true })); // Observable<Messages>
// ---------------------------------------------------------------------------

import type { Node } from "@graphrefly/pure-ts/core";
import { COMPLETE, DATA, ERROR, type Messages } from "@graphrefly/pure-ts/core";

/** Observer passed to {@link InteropObservable.subscribe}. */
export interface InteropObserver<T> {
	next?(value: T): void;
	error?(err: unknown): void;
	complete?(): void;
	/** rxjs `Subscriber` sets this; we short-circuit delivery when closed. */
	closed?: boolean;
}

/** Teardown handle returned by {@link InteropObservable.subscribe}. */
export interface InteropSubscription {
	unsubscribe(): void;
}

/**
 * Minimal TC39 Observable. rxjs `from()` (and any `Symbol.observable`
 * consumer) adopts it at runtime via the well-known interop method attached
 * by {@link toObservable}. Pass the result through `from(...)` to get a
 * pipeable rxjs `Observable`.
 */
export interface InteropObservable<T> {
	subscribe(observer: InteropObserver<T> | ((value: T) => void)): InteropSubscription;
}

/** Options for {@link toObservable}. */
export type ToObservableOptions = {
	/**
	 * When `true`, emit raw `Messages` batches instead of extracted `DATA`
	 * values. Terminal batches are still emitted as the final `next()` before
	 * the error/complete signal.
	 */
	raw?: boolean;
};

// Well-known Observable interop key. Mirrors the rxjs / `symbol-observable`
// resolution (the global `Symbol.observable` when the runtime or a polyfill
// provides it, otherwise the `"@@observable"` string) so rxjs `from()` adopts
// our object regardless of polyfill state.
const OBSERVABLE_KEY: PropertyKey =
	(typeof Symbol === "function" && (Symbol as unknown as { observable?: symbol }).observable) ||
	"@@observable";

function normalizeObserver<T>(
	observer: InteropObserver<T> | ((value: T) => void),
): InteropObserver<T> {
	return typeof observer === "function" ? { next: observer } : observer;
}

function makeInterop<T>(
	onSubscribe: (observer: InteropObserver<T>) => () => void,
): InteropObservable<T> {
	const obs: InteropObservable<T> = {
		subscribe(rawObserver): InteropSubscription {
			const observer = normalizeObserver(rawObserver);
			let closed = false;
			let teardown: (() => void) | undefined;
			let teardownPending = false;
			const runTeardown = (): void => {
				if (teardown) teardown();
				else teardownPending = true; // sync push-on-subscribe terminal
			};
			// Guarded observer: latch `closed` and auto-unsubscribe the node on
			// terminal. The prior rxjs-backed impl got this from rxjs's
			// `Subscriber` (closed flag + teardown-on-terminal); a plain TC39
			// consumer has no such machinery, so without this a post-terminal
			// node wave would re-fire next/error/complete and the node
			// subscription would leak until a manual unsubscribe(). `closed` is
			// also read by toObservable's per-message loop to short-circuit.
			const guarded: InteropObserver<T> = {
				get closed() {
					return closed;
				},
				next(value) {
					if (!closed) observer.next?.(value);
				},
				error(err) {
					if (closed) return;
					closed = true;
					try {
						observer.error?.(err);
					} finally {
						runTeardown();
					}
				},
				complete() {
					if (closed) return;
					closed = true;
					try {
						observer.complete?.();
					} finally {
						runTeardown();
					}
				},
			};
			teardown = onSubscribe(guarded);
			if (teardownPending) teardown(); // terminal fired before assignment
			return {
				unsubscribe() {
					if (closed) return;
					closed = true;
					teardown?.();
				},
			};
		},
	};
	// TC39 interop: `x[Symbol.observable]()` returns the observable itself.
	(obs as unknown as Record<PropertyKey, unknown>)[OBSERVABLE_KEY] = function (
		this: InteropObservable<T>,
	) {
		return this;
	};
	return obs;
}

/**
 * Bridge a `Node<T>` to a TC39 interop observable (no rxjs dependency).
 *
 * Default mode emits the node's value on each `DATA` message. Maps `ERROR` to
 * `observer.error()` and `COMPLETE` to `observer.complete()`.
 * Protocol-internal signals (DIRTY, RESOLVED, PAUSE, etc.) are skipped.
 *
 * With `{ raw: true }`, emits full `[[Type, Data?], ...]` message batches.
 * The stream terminates on ERROR or COMPLETE (the terminal batch is still
 * emitted as the final `next()` before the error/complete signal).
 *
 * The returned value is a spec-interop observable, **not** a concrete rxjs
 * `Observable`. Wrap with `from(toObservable(node))` for rxjs operators, or
 * use the NestJS compat layer's `toObservable` which returns a real rxjs
 * `Observable`. For graph-level observation, use
 * `toObservable(graph.resolve(path))` or subscribe to `graph.observe()`.
 *
 * Unsubscribing unsubscribes the node.
 */
export function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions & { raw?: false },
): InteropObservable<T>;
export function toObservable<T>(
	node: Node<T>,
	options: ToObservableOptions & { raw: true },
): InteropObservable<Messages>;
export function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions,
): InteropObservable<T | Messages> {
	if (options?.raw) {
		return makeInterop<Messages>((observer) => {
			return node.subscribe((msgs) => {
				if (observer.closed) return;
				observer.next?.(msgs);
				for (const m of msgs) {
					if (m[0] === ERROR) {
						observer.error?.(m[1]);
						return;
					}
					if (m[0] === COMPLETE) {
						observer.complete?.();
						return;
					}
				}
			});
		});
	}

	return makeInterop<T>((observer) => {
		return node.subscribe((msgs) => {
			for (const m of msgs) {
				if (observer.closed) return;
				if (m[0] === DATA) {
					observer.next?.(m[1] as T);
				} else if (m[0] === ERROR) {
					observer.error?.(m[1]);
					return;
				} else if (m[0] === COMPLETE) {
					observer.complete?.();
					return;
				}
			}
		});
	});
}
