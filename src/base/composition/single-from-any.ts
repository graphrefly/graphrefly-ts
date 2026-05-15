/**
 * `singleFromAny` — keyed promise/Node de-duplication ("singleflight").
 *
 * Given a `factory: (key) => NodeInput<T>`, returns a callable that dedupes
 * concurrent invocations sharing the same key — all callers with the same
 * key while a request is in-flight receive the same `Promise<T>`. Once the
 * underlying source settles (DATA, ERROR, or COMPLETE), the cache entry is
 * cleared so the next call re-invokes the factory.
 *
 * This is the classic "singleflight" pattern from Go, generalised over the
 * library's `NodeInput<T>` bridge so callers can pass Promise-returning
 * factories, Node-returning factories, or plain value factories with
 * identical semantics.
 *
 * Use cases:
 * - `withReplayCache` cache-miss thundering-herd dedup
 * - Shared HTTP fetches keyed by URL
 * - Expensive compute keyed by request fingerprint
 *
 * @example
 * ```ts
 * const fetchUser = singleFromAny<string, User>((id) => fetch(`/users/${id}`).then(r => r.json()));
 * // Two concurrent callers with id="42" → one underlying fetch, two Promises resolving to the same User.
 * const [a, b] = await Promise.all([fetchUser("42"), fetchUser("42")]);
 * ```
 *
 * @category extra
 */

import type { Node } from "@graphrefly/pure-ts/core";
import { COMPLETE, ERROR } from "@graphrefly/pure-ts/core";
// Import directly from the source sub-files (rather than the `./sources.js`
// barrel) so the `single-from-any` module is NOT part of any cycle that runs
// through `extra/sources/index.ts` — eager re-exports through the barrel were
// observed to leave `firstValueFrom` / `keepalive` unresolved during nested
// import chains under vite-node.
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import { firstValueFrom } from "../sources/settled.js";

export interface SingleFromAnyOptions<K> {
	/**
	 * Convert a typed key into a cache-string. Defaults to `String(key)`, which
	 * works for primitive keys; callers with object keys should provide a
	 * stable serializer (e.g., canonical JSON).
	 */
	keyFn?: (key: K) => string;
}

/**
 * Dedupe concurrent `factory(key)` invocations. Returns a bound callable.
 *
 * @param factory - Produces a `NodeInput<T>` for each unique key.
 * @param opts - Optional key-stringification.
 * @returns A function `(key: K) => Promise<T>` whose inflight results are shared per key.
 */
export function singleFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Promise<T> {
	const keyFn = opts.keyFn ?? ((k: K) => String(k));
	const inFlight = new Map<string, Promise<T>>();

	return (key: K): Promise<T> => {
		const k = keyFn(key);
		const existing = inFlight.get(k);
		if (existing) return existing;

		const input = factory(key);

		// Resolve the NodeInput to a Promise<T>. Different input shapes need
		// different bridges — Promise/Node/AsyncIterable/Iterable/plain value.
		let rawPromise: Promise<T>;
		if (input != null && typeof (input as PromiseLike<T>).then === "function") {
			rawPromise = Promise.resolve(input as PromiseLike<T>);
		} else if (
			input != null &&
			typeof input === "object" &&
			"subscribe" in (input as object) &&
			"cache" in (input as object)
		) {
			// Node: bridge via firstValueFrom.
			rawPromise = firstValueFrom(input as Node<T>);
		} else if (
			input != null &&
			typeof input === "object" &&
			Symbol.asyncIterator in (input as object)
		) {
			// AsyncIterable — take the first value, then close the iterator so
			// any owned resources (HTTP body, subscription, timer) are released.
			rawPromise = (async () => {
				const iter = (input as AsyncIterable<T>)[Symbol.asyncIterator]();
				try {
					const { value, done } = await iter.next();
					if (done) throw new Error("singleFromAny: factory returned empty async iterable");
					return value as T;
				} finally {
					await iter.return?.();
				}
			})();
		} else if (input != null && typeof input === "object" && Symbol.iterator in (input as object)) {
			// Iterable — take the first value, close the iterator.
			rawPromise = (async () => {
				const iter = (input as Iterable<T>)[Symbol.iterator]();
				try {
					const { value, done } = iter.next();
					if (done) throw new Error("singleFromAny: factory returned empty iterable");
					return value as T;
				} finally {
					iter.return?.();
				}
			})();
		} else {
			// Plain value.
			rawPromise = Promise.resolve(input as T);
		}

		// Install the cache entry BEFORE attaching `.finally`. Otherwise a
		// sync-resolved Promise's finally microtask could run before the
		// `inFlight.set` below, leaving a stale entry installed afterwards.
		// We wrap in a holder whose reference we capture *before* chaining.
		let tracked!: Promise<T>;
		const cleanup = (): void => {
			if (inFlight.get(k) === tracked) inFlight.delete(k);
		};
		tracked = rawPromise.then(
			(v) => {
				cleanup();
				return v;
			},
			(e) => {
				cleanup();
				throw e;
			},
		);
		inFlight.set(k, tracked);
		return tracked;
	};
}

/**
 * Reactive variant: returns a bound callable that hands out `Node<T>` values.
 * All concurrent callers with the same key during an in-flight source share
 * the same Node. When the underlying source **terminally** settles (ERROR
 * or COMPLETE), the Node is removed from the cache so the next call
 * re-invokes `factory`. DATA is NOT terminal — callers subscribing after
 * the first DATA still receive the shared Node (and push-on-subscribe per
 * the spec's cached-DATA contract).
 *
 * Use when downstream wants reactive subscription (not a one-shot Promise).
 *
 * @category extra
 */
export function singleNodeFromAny<K, T>(
	factory: (key: K) => NodeInput<T>,
	opts: SingleFromAnyOptions<K> = {},
): (key: K) => Node<T> {
	const keyFn = opts.keyFn ?? ((k: K) => String(k));
	const inFlight = new Map<string, Node<T>>();

	return (key: K): Node<T> => {
		const k = keyFn(key);
		const existing = inFlight.get(k);
		if (existing) return existing;

		const node = fromAny(factory(key));
		inFlight.set(k, node);

		// Evict on terminal settle only — ERROR or COMPLETE. DATA is a value
		// emission, not a lifecycle transition; multi-emitting Nodes should
		// continue to share across subscribers after the first value.
		const unsub = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === ERROR || m[0] === COMPLETE) {
					if (inFlight.get(k) === node) inFlight.delete(k);
					unsub();
					return;
				}
			}
		});
		return node;
	};
}
