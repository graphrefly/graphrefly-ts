import { DATA, ERROR, type Messages } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { dynamicNode, state } from "../../core/sugar.js";

/**
 * Options for creating an atom.
 *
 * @category compat
 */
export interface AtomOptions {
	/** Optional identifier for the underlying node. */
	name?: string;
	/** Optional companion meta nodes. */
	meta?: Record<string, unknown>;
}

/**
 * A read-only Jotai-compatible atom.
 *
 * @category compat
 */
export interface ReadableAtom<T> {
	/** Returns the current cached value. */
	get(): T;
	/** Subscribes to value changes. Returns an unsubscribe function. */
	subscribe(callback: (value: T) => void): () => void;
	/** Access to companion meta nodes. */
	readonly meta: Record<string, Node>;
	/** @internal The underlying GraphReFly node. */
	_node: Node<T>;
}

/**
 * A writable Jotai-compatible atom.
 *
 * @category compat
 */
export interface WritableAtom<T> extends ReadableAtom<T> {
	/** Sets a new value. */
	set(value: T): void;
	/** Updates the value using a transformation function. */
	update(fn: (current: T) => T): void;
}

/** Function type for reading other atoms inside a derived atom. */
export type GetFn = <V>(a: ReadableAtom<V>) => V;
/** Function type for writing to other atoms inside a writable derived atom. */
export type SetFn = <V>(a: WritableAtom<V>, value: V) => void;

/** Function that computes the atom's value. */
export type ReadFn<T> = (get: GetFn) => T;
/** Function that handles writes to the atom. */
export type WriteFn<T> = (get: GetFn, set: SetFn, value: T) => void;

/**
 * Creates a Jotai-compatible atom built on GraphReFly primitives.
 *
 * Supports three overloads:
 * 1. `atom(initial)` — Writable primitive atom (wraps `state()`).
 * 2. `atom(read)` — Read-only derived atom (wraps `dynamicNode()`).
 * 3. `atom(read, write)` — Writable derived atom.
 *
 * @param initialOrRead - Initial value or a read function.
 * @param writeOrOptions - Write function or options object.
 * @param options - Optional configuration.
 * @returns WritableAtom or ReadableAtom.
 *
 * @example
 * ```ts
 * const count = atom(0);
 * count.set(1);
 * const doubled = atom((get) => get(count)! * 2);
 * ```
 *
 * @category compat
 */
export function atom<T>(initial: T, options?: AtomOptions): WritableAtom<T>;
export function atom<T>(read: ReadFn<T>, options?: AtomOptions): ReadableAtom<T>;
export function atom<T>(read: ReadFn<T>, write: WriteFn<T>, options?: AtomOptions): WritableAtom<T>;
export function atom<T>(
	initialOrRead: T | ReadFn<T>,
	writeOrOptions?: WriteFn<T> | AtomOptions,
	options?: AtomOptions,
): ReadableAtom<T> | WritableAtom<T> {
	if (typeof initialOrRead === "function") {
		const read = initialOrRead as ReadFn<T>;
		if (typeof writeOrOptions === "function") {
			return createDerivedAtom(read, writeOrOptions as WriteFn<T>, options);
		}
		return createDerivedAtom(read, undefined, writeOrOptions as AtomOptions);
	}

	return createPrimitiveAtom(initialOrRead as T, writeOrOptions as AtomOptions);
}

function pull<T>(n: Node<T>): T {
	let val: T | undefined | null = n.cache;
	let err: any;
	const unsub = n.subscribe((msgs: Messages) => {
		for (const [t, v] of msgs) {
			if (t === DATA) val = v as T;
			if (t === ERROR) err = v;
		}
	});
	unsub();
	if (err) throw err;
	return val as T;
}

function createPrimitiveAtom<T>(initial: T, options?: AtomOptions): WritableAtom<T> {
	const n = state(initial, {
		...options,
		resubscribable: true,
		resetOnTeardown: true,
	});
	return {
		get: () => {
			if (n.status === "sentinel") {
				return pull(n);
			}
			return n.cache as T;
		},
		set: (value: T) => n.down([[DATA, value]]),
		update: (fn: (current: T) => T) => {
			const current = n.status === "sentinel" ? pull(n) : (n.cache as T);
			n.down([[DATA, fn(current)]]);
		},
		subscribe: (cb: (value: T) => void) => {
			// Skip the initial push-on-subscribe DATA — jotai subscribe fires on changes only.
			let initial = true;
			return n.subscribe((msgs: Messages) => {
				for (const [t, v] of msgs) {
					if (t === DATA) {
						if (initial) {
							initial = false;
							continue;
						}
						cb(v as T);
					}
				}
			});
		},
		meta: n.meta,
		_node: n,
	};
}

function createDerivedAtom<T>(
	read: ReadFn<T>,
	write?: WriteFn<T>,
	options?: AtomOptions,
): ReadableAtom<T> | WritableAtom<T> {
	const n = dynamicNode(
		[],
		(track) =>
			read(<V>(a: ReadableAtom<V>) => {
				const dn = a._node;
				if (dn.status === "sentinel") {
					pull(dn);
				}
				return track(dn) as V;
			}),
		{
			...options,
			resubscribable: true,
			resetOnTeardown: true,
		},
	);

	const result: ReadableAtom<T> = {
		get: () => {
			if (n.status === "sentinel") {
				return pull(n);
			}
			return n.cache as T;
		},
		subscribe: (cb: (value: T) => void) => {
			// Skip the initial push-on-subscribe DATA — jotai subscribe fires on changes only.
			let initial = true;
			return n.subscribe((msgs: Messages) => {
				for (const [t, v] of msgs) {
					if (t === DATA) {
						if (initial) {
							initial = false;
							continue;
						}
						cb(v as T);
					}
				}
			});
		},
		meta: n.meta,
		_node: n,
	};

	if (write) {
		const getFn: GetFn = <V>(a: ReadableAtom<V>) => a.get();
		const setFn: SetFn = <V>(a: WritableAtom<V>, value: V) => a.set(value);

		const writable = result as WritableAtom<T>;
		writable.set = (value: T) => write(getFn, setFn, value);
		writable.update = (fn: (current: T) => T) => {
			const current = n.status === "sentinel" ? pull(n) : (n.cache as T);
			return write(getFn, setFn, fn(current));
		};
		return writable;
	}

	return result;
}
