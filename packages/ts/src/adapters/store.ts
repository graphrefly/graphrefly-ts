/**
 * Framework-neutral store adapters.
 *
 * React/Vue/Solid/Svelte/Zustand/Jotai/Nanostores bindings can build on this
 * tiny Node-facing layer without importing framework packages or reviving the
 * old `compat` namespace (D125/B61).
 */

import type { DeliveryMeta, Sink } from "../ctx/types.js";
import type { Node } from "../node/node.js";

/** A minimal readable store contract shared by Svelte/Nanostores-style adapters. */
export interface ReadableStore<T> {
	get(): T | undefined;
	subscribe(run: (value: T | undefined) => void): () => void;
}

/** A minimal writable store contract over a clean-slate writable node. */
export interface WritableStore<T> extends ReadableStore<T> {
	set(value: T): void;
	update(fn: (value: T | undefined) => T): void;
}

/** React `useSyncExternalStore`-compatible shape, without importing React. */
export interface ExternalStore<T> {
	getSnapshot(): T | undefined;
	getServerSnapshot(): T | undefined;
	subscribe(onStoreChange: () => void): () => void;
}

/** Object-of-nodes factory used by record subscription adapters. */
export type NodeRecordFactory<K extends string, R extends Record<string, unknown>> = (key: K) => {
	[P in keyof R]: Node<R[P]>;
};

/** Zustand-compatible store API over a caller-owned clean-slate state node. */
export interface ZustandStoreApi<T extends object> {
	getState(): T;
	setState(partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean): void;
	getInitialState(): T;
	subscribe(listener: (state: T, prevState: T) => void): () => void;
	destroy(): void;
}

/** Jotai-style atom facade over a caller-owned node. */
export interface JotaiAtom<T> {
	get(): T | undefined;
	subscribe(callback: (value: T | undefined) => void): () => void;
	readonly _node: Node<T>;
}

/** Writable Jotai-style atom facade over a caller-owned writable node. */
export interface WritableJotaiAtom<T> extends JotaiAtom<T> {
	set(value: T): void;
	update(fn: (value: T | undefined) => T): void;
}

/** Nanostores-style atom facade over a caller-owned node. */
export interface NanoAtom<T> {
	get(): T | undefined;
	subscribe(callback: (value: T | undefined) => void): () => void;
	listen(callback: (value: T | undefined) => void): () => void;
	readonly _node: Node<T>;
}

/** Writable Nanostores-style atom facade over a caller-owned writable node. */
export interface WritableNanoAtom<T> extends NanoAtom<T> {
	set(value: T): void;
	update(fn: (value: T | undefined) => T): void;
}

/** TC39-Signals-style facade over a caller-owned node. */
export interface SignalLike<T> {
	get(): T | undefined;
	subscribe(callback: (value: T | undefined) => void): () => void;
	readonly _node: Node<T>;
}

/** Writable TC39-Signals-style facade over a caller-owned writable node. */
export interface WritableSignalLike<T> extends SignalLike<T> {
	set(value: T): void;
	update(fn: (value: T | undefined) => T): void;
}

export interface SubscribeValuesOptions<T> {
	/** Emit the current cache snapshot immediately. `undefined` means SENTINEL/no DATA. */
	immediate?: boolean;
	/** Suppress synchronous push-on-subscribe/replay DATA. Useful for change-only store listeners. */
	changesOnly?: boolean;
	onError?: (error: unknown) => void;
	onComplete?: () => void;
	/** Custom cache reader for wrappers that keep their own snapshot object. */
	getSnapshot?: () => T | undefined;
}

export interface WritableNode<T> extends Node<T> {
	set(value: T): void;
}

export interface WritableStoreOptions<T> extends SubscribeValuesOptions<T> {
	/** Override writes for adapters that need a framework-owned reducer. */
	write?: (node: WritableNode<T>, value: T) => void;
}

/** Read a node cache without activating it. */
export function nodeSnapshot<T>(node: Node<T>): T | undefined {
	return node.cache as T | undefined;
}

/**
 * Subscribe to DATA values from a Node. Protocol internals stay below the adapter boundary:
 * DATA drives value listeners, ERROR/COMPLETE route to optional lifecycle callbacks.
 */
export function subscribeNodeValues<T>(
	node: Node<T>,
	run: (value: T | undefined) => void,
	opts: SubscribeValuesOptions<T> = {},
): () => void {
	const read = opts.getSnapshot ?? (() => nodeSnapshot(node));
	if (opts.immediate) run(read());

	let subscribing = true;
	const skipSynchronousHandshakeData = opts.changesOnly || opts.immediate;
	const sink: Sink = (msg, delivery?: DeliveryMeta) => {
		switch (msg[0]) {
			case "DATA":
				if (skipSynchronousHandshakeData && subscribing && delivery === undefined) {
					return;
				}
				run(msg[1] as T);
				return;
			case "ERROR":
				opts.onError?.(msg[1]);
				return;
			case "COMPLETE":
				opts.onComplete?.();
				return;
		}
	};
	const unsubscribe = node.subscribe(sink);
	subscribing = false;
	return unsubscribe;
}

/** Build a Svelte/Nanostores-style readable store from a clean-slate Node. */
export function readableStore<T>(
	node: Node<T>,
	opts: SubscribeValuesOptions<T> = {},
): ReadableStore<T> {
	return {
		get: () => (opts.getSnapshot ?? (() => nodeSnapshot(node)))(),
		subscribe: (run) => subscribeNodeValues(node, run, { immediate: true, ...opts }),
	};
}

function hasWritableSet<T>(node: Node<T>): node is WritableNode<T> {
	return typeof (node as { set?: unknown }).set === "function";
}

function defaultWrite<T>(node: WritableNode<T>, value: T): void {
	node.set(value);
}

/** Build a writable store over a StateNode or compatible clean-slate writable Node. */
export function writableStore<T>(
	node: WritableNode<T>,
	opts?: WritableStoreOptions<T>,
): WritableStore<T>;
export function writableStore<T>(
	node: Node<T>,
	opts: WritableStoreOptions<T> & { write: (node: WritableNode<T>, value: T) => void },
): WritableStore<T>;
export function writableStore<T>(
	node: Node<T>,
	opts: WritableStoreOptions<T> = {},
): WritableStore<T> {
	const read = opts.getSnapshot ?? (() => nodeSnapshot(node));
	const write = opts.write ?? (hasWritableSet(node) ? defaultWrite : undefined);
	if (!write) {
		throw new TypeError("writableStore: node must expose set(value) or opts.write");
	}
	const writable = node as WritableNode<T>;
	return {
		get: read,
		subscribe: (run) => subscribeNodeValues(node, run, { immediate: true, ...opts }),
		set: (value) => write(writable, value),
		update: (fn) => write(writable, fn(read())),
	};
}

/** Build the tiny shape React's `useSyncExternalStore` expects, without importing React. */
export function externalStore<T>(
	node: Node<T>,
	opts: Pick<SubscribeValuesOptions<T>, "getSnapshot" | "onError" | "onComplete"> = {},
): ExternalStore<T> {
	const read = opts.getSnapshot ?? (() => nodeSnapshot(node));
	return {
		getSnapshot: read,
		getServerSnapshot: read,
		subscribe: (onStoreChange) =>
			subscribeNodeValues(node, () => onStoreChange(), {
				changesOnly: true,
				onError: opts.onError,
				onComplete: opts.onComplete,
			}),
	};
}

/** Alias for React-facing bindings; dependency-free so React stays a peer of user code. */
export const reactExternalStore = externalStore;

/** Alias for Svelte-style readable stores. */
export const svelteReadableStore = readableStore;

/** Alias for Svelte-style writable stores. */
export const svelteWritableStore = writableStore;

/** Build a framework-neutral keyed record store (the core of old useSubscribeRecord helpers). */
export function recordReadableStore<K extends string, R extends Record<string, unknown>>(
	keysNode: Node<readonly K[]>,
	factory: NodeRecordFactory<K, R>,
	opts: SubscribeValuesOptions<Record<K, R>> = {},
): ReadableStore<Record<K, R>> {
	const read = () => {
		const keys = keysNode.cache ?? [];
		const out = {} as Record<K, R>;
		for (const key of keys) {
			const nodes = factory(key);
			const values = {} as R;
			for (const field of Object.keys(nodes) as Array<keyof R>) {
				values[field] = nodes[field].cache as R[keyof R];
			}
			out[key] = values;
		}
		return out;
	};

	return {
		get: read,
		subscribe(run) {
			const entryUnsubs: Array<() => void> = [];
			const cleanupEntries = () => {
				for (const unsub of entryUnsubs.splice(0)) unsub();
			};
			const sync = () => {
				cleanupEntries();
				for (const key of keysNode.cache ?? []) {
					const nodes = factory(key);
					for (const field of Object.keys(nodes) as Array<keyof R>) {
						entryUnsubs.push(
							subscribeNodeValues(nodes[field], () => run(read()), {
								changesOnly: true,
								onError: opts.onError,
								onComplete: opts.onComplete,
							}),
						);
					}
				}
				run(read());
			};
			const keysUnsub = subscribeNodeValues(keysNode, sync, {
				changesOnly: true,
				onError: opts.onError,
				onComplete: opts.onComplete,
			});
			sync();
			return () => {
				keysUnsub();
				cleanupEntries();
			};
		},
	};
}

/** Build a Zustand-compatible StoreApi over a caller-owned clean-slate state node. */
export function zustandStore<T extends object>(
	node: WritableNode<T>,
	initialState?: T,
	opts?: WritableStoreOptions<T>,
): ZustandStoreApi<T>;
export function zustandStore<T extends object>(
	node: Node<T>,
	initialState: T | undefined,
	opts: WritableStoreOptions<T> & { write: (node: WritableNode<T>, value: T) => void },
): ZustandStoreApi<T>;
export function zustandStore<T extends object>(
	node: Node<T>,
	initialState: T = nodeSnapshot(node) as T,
	opts: WritableStoreOptions<T> = {},
): ZustandStoreApi<T> {
	const listeners = new Set<() => void>();
	const read = opts.getSnapshot ?? (() => nodeSnapshot(node));
	const write = opts.write ?? (hasWritableSet(node) ? defaultWrite : undefined);
	if (!write) {
		throw new TypeError("zustandStore: node must expose set(value) or opts.write");
	}
	const writable = node as WritableNode<T>;
	const api: ZustandStoreApi<T> = {
		getState: () => read() as T,
		setState(partial, replace) {
			const prev = api.getState();
			const next = typeof partial === "function" ? partial(prev) : partial;
			write(writable, replace ? (next as T) : ({ ...prev, ...next } as T));
		},
		getInitialState: () => initialState,
		subscribe(listener) {
			let prev = api.getState();
			const unsub = subscribeNodeValues(
				node,
				(value) => {
					const next = value as T;
					listener(next, prev);
					prev = next;
				},
				{ changesOnly: true, onError: opts.onError, onComplete: opts.onComplete },
			);
			listeners.add(unsub);
			return () => {
				if (!listeners.delete(unsub)) return;
				unsub();
			};
		},
		destroy() {
			for (const unsub of [...listeners]) {
				listeners.delete(unsub);
				unsub();
			}
		},
	};
	return api;
}

/** Build a Jotai-style atom facade over a caller-owned node. */
export function jotaiAtom<T>(
	node: WritableNode<T>,
	opts?: WritableStoreOptions<T>,
): WritableJotaiAtom<T>;
export function jotaiAtom<T>(node: Node<T>, opts?: SubscribeValuesOptions<T>): JotaiAtom<T>;
export function jotaiAtom<T>(
	node: Node<T> | WritableNode<T>,
	opts: SubscribeValuesOptions<T> | WritableStoreOptions<T> = {},
): JotaiAtom<T> | WritableJotaiAtom<T> {
	const base: JotaiAtom<T> = {
		get: () => (opts.getSnapshot ?? (() => nodeSnapshot(node)))(),
		subscribe: (callback) => subscribeNodeValues(node, callback, { changesOnly: true, ...opts }),
		_node: node,
	};
	if (hasWritableSet(node) || typeof (opts as WritableStoreOptions<T>).write === "function") {
		const writable = writableStore(
			node,
			opts as WritableStoreOptions<T> & {
				write: (node: WritableNode<T>, value: T) => void;
			},
		);
		return { ...base, set: writable.set, update: writable.update };
	}
	return base;
}

/** Build a Nanostores-style atom facade over a caller-owned node. */
export function nanoAtom<T>(
	node: WritableNode<T>,
	opts?: WritableStoreOptions<T>,
): WritableNanoAtom<T>;
export function nanoAtom<T>(node: Node<T>, opts?: SubscribeValuesOptions<T>): NanoAtom<T>;
export function nanoAtom<T>(
	node: Node<T> | WritableNode<T>,
	opts: SubscribeValuesOptions<T> | WritableStoreOptions<T> = {},
): NanoAtom<T> | WritableNanoAtom<T> {
	const base: NanoAtom<T> = {
		get: () => (opts.getSnapshot ?? (() => nodeSnapshot(node)))(),
		subscribe: (callback) => subscribeNodeValues(node, callback, { immediate: true, ...opts }),
		listen: (callback) => subscribeNodeValues(node, callback, { changesOnly: true, ...opts }),
		_node: node,
	};
	if (hasWritableSet(node) || typeof (opts as WritableStoreOptions<T>).write === "function") {
		const writable = writableStore(
			node,
			opts as WritableStoreOptions<T> & {
				write: (node: WritableNode<T>, value: T) => void;
			},
		);
		return { ...base, set: writable.set, update: writable.update };
	}
	return base;
}

/** Build a TC39-Signals-style facade over a caller-owned node. */
export function signalFromNode<T>(
	node: WritableNode<T>,
	opts?: WritableStoreOptions<T>,
): WritableSignalLike<T>;
export function signalFromNode<T>(node: Node<T>, opts?: SubscribeValuesOptions<T>): SignalLike<T>;
export function signalFromNode<T>(
	node: Node<T> | WritableNode<T>,
	opts: SubscribeValuesOptions<T> | WritableStoreOptions<T> = {},
): SignalLike<T> | WritableSignalLike<T> {
	const base: SignalLike<T> = {
		get: () => (opts.getSnapshot ?? (() => nodeSnapshot(node)))(),
		subscribe: (callback) => subscribeNodeValues(node, callback, { changesOnly: true, ...opts }),
		_node: node,
	};
	if (hasWritableSet(node) || typeof (opts as WritableStoreOptions<T>).write === "function") {
		const writable = writableStore(
			node,
			opts as WritableStoreOptions<T> & {
				write: (node: WritableNode<T>, value: T) => void;
			},
		);
		return { ...base, set: writable.set, update: writable.update };
	}
	return base;
}
