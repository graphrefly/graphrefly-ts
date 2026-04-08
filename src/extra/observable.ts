// ---------------------------------------------------------------------------
// RxJS bridge — reactive interop between GraphReFly nodes and RxJS Observables.
// ---------------------------------------------------------------------------
// Usage:
//   import { toObservable } from '@graphrefly/graphrefly-ts/extra';
//   const values$ = toObservable(myNode);                   // Observable<T>
//   const msgs$   = toObservable(myNode, { raw: true });    // Observable<Messages>
// ---------------------------------------------------------------------------

import { Observable } from "rxjs";
import { COMPLETE, DATA, ERROR, type Messages } from "../core/messages.js";
import type { Node } from "../core/node.js";

/** Options for {@link toObservable}. */
export type ToObservableOptions = {
	/**
	 * When `true`, emit raw `Messages` batches instead of extracted `DATA` values.
	 * Terminal batches are still emitted as the final `next()` before the
	 * Observable signal (error/complete).
	 */
	raw?: boolean;
};

/**
 * Bridge a `Node<T>` to an RxJS `Observable`.
 *
 * Default mode emits the node's value on each `DATA` message. Maps `ERROR` to
 * `subscriber.error()` and `COMPLETE` to `subscriber.complete()`.
 * Protocol-internal signals (DIRTY, RESOLVED, PAUSE, etc.) are skipped.
 *
 * With `{ raw: true }`, emits full `[[Type, Data?], ...]` message batches.
 * The Observable terminates on ERROR or COMPLETE (the terminal batch is still
 * emitted as the final `next()` before the Observable signal).
 *
 * For graph-level observation, use `toObservable(graph.resolve(path))` or
 * subscribe to `graph.observe()` directly.
 *
 * Unsubscribing the Observable unsubscribes the node.
 */
export function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions & { raw?: false },
): Observable<T>;
export function toObservable<T>(
	node: Node<T>,
	options: ToObservableOptions & { raw: true },
): Observable<Messages>;
export function toObservable<T>(
	node: Node<T>,
	options?: ToObservableOptions,
): Observable<T | Messages> {
	if (options?.raw) {
		return new Observable<Messages>((subscriber) => {
			const unsub = node.subscribe((msgs) => {
				if (subscriber.closed) return;
				subscriber.next(msgs);
				for (const m of msgs) {
					if (m[0] === ERROR) {
						subscriber.error(m[1]);
						return;
					}
					if (m[0] === COMPLETE) {
						subscriber.complete();
						return;
					}
				}
			});
			return unsub;
		});
	}

	return new Observable<T>((subscriber) => {
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (subscriber.closed) return;
				if (m[0] === DATA) {
					subscriber.next(m[1] as T);
				} else if (m[0] === ERROR) {
					subscriber.error(m[1]);
					return;
				} else if (m[0] === COMPLETE) {
					subscriber.complete();
					return;
				}
			}
		});
		return unsub;
	});
}
