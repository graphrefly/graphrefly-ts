// ---------------------------------------------------------------------------
// RxJS bridge — reactive interop between GraphReFly nodes and RxJS Observables.
// ---------------------------------------------------------------------------
// Generic utilities for bridging GraphReFly's message protocol to RxJS
// Observables. Works anywhere RxJS is available (NestJS, Angular, standalone).
//
// Usage:
//   import { toObservable, observeNode$ } from '@graphrefly/graphrefly-ts/extra';
//   const values$ = toObservable(myNode);        // Observable<T>
//   const msgs$   = toMessages$(myNode);         // Observable<Messages>
//   const node$   = observeNode$(graph, "path"); // Observable<T> via graph.observe
//   const all$    = observeGraph$(graph);         // Observable<{ path, messages }>
// ---------------------------------------------------------------------------

import { Observable } from "rxjs";
import { COMPLETE, DATA, ERROR, type Messages } from "../core/messages.js";
import type { Node } from "../core/node.js";
import type { Graph, GraphObserveAll, GraphObserveOne, ObserveOptions } from "../graph/graph.js";

/**
 * Bridge a `Node<T>` to an RxJS `Observable<T>`.
 *
 * Emits the node's value on each `DATA` message. Maps `ERROR` to
 * `subscriber.error()` and `COMPLETE` to `subscriber.complete()`.
 * Protocol-internal signals (DIRTY, RESOLVED, PAUSE, etc.) are skipped.
 *
 * Unsubscribing the Observable unsubscribes the node.
 */
export function toObservable<T>(node: Node<T>): Observable<T> {
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

/**
 * Bridge a `Node<T>` to an `Observable<Messages>` — raw message batches.
 *
 * Each emission is a full `[[Type, Data?], ...]` batch. The Observable
 * terminates on ERROR or COMPLETE (the terminal batch is still emitted
 * as the final `next()` before the Observable signal).
 */
export function toMessages$<T>(node: Node<T>): Observable<Messages> {
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

/**
 * Observe a single node in a `Graph` as an `Observable<T>`.
 *
 * Equivalent to `toObservable(graph.resolve(path))` but routes through
 * `graph.observe()` so actor guards are respected when provided.
 */
export function observeNode$<T>(
	graph: Graph,
	path: string,
	options?: ObserveOptions,
): Observable<T> {
	return new Observable<T>((subscriber) => {
		const handle: GraphObserveOne = graph.observe(path, options);
		const unsub = handle.subscribe((msgs) => {
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

/**
 * Observe all nodes in a `Graph` as an `Observable<{ path, messages }>`.
 *
 * Each emission carries the qualified node path and the raw message batch.
 * The Observable never self-completes (graphs are long-lived); dispose by
 * unsubscribing.
 */
export function observeGraph$(
	graph: Graph,
	options?: ObserveOptions,
): Observable<{ path: string; messages: Messages }> {
	return new Observable((subscriber) => {
		const handle: GraphObserveAll = graph.observe(options);
		const unsub = handle.subscribe((nodePath, messages) => {
			if (subscriber.closed) return;
			subscriber.next({ path: nodePath, messages });
		});
		return unsub;
	});
}
