import { batch } from "../../core/batch.js";
import { type DynGet, dynamicNode } from "../../core/dynamic-node.js";
import { DATA, ERROR, type Messages } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { state } from "../../core/sugar.js";

/**
 * A Nanostores-compatible atom.
 *
 * @category compat
 */
export interface NanoAtom<T> {
	/** Get current value. */
	get(): T;
	/** Set a new value (writable atoms only). */
	set(value: T): void;
	/** Subscribe to value changes. Callback receives the new value.
	 * Returns unsubscribe function. Called immediately with current value. */
	subscribe(cb: (value: T) => void): () => void;
	/** Listen to value changes (no immediate call). Returns unsubscribe. */
	listen(cb: (value: T) => void): () => void;
	/** The underlying GraphReFly node. */
	readonly _node: Node<T>;
}

/**
 * A Nanostores-compatible computed store.
 *
 * @category compat
 */
export interface NanoComputed<T> {
	/** Get current value. */
	get(): T;
	/** Subscribe to value changes. Called immediately with current value.
	 * Returns unsubscribe function. */
	subscribe(cb: (value: T) => void): () => void;
	/** Listen to value changes (no immediate call). Returns unsubscribe. */
	listen(cb: (value: T) => void): () => void;
	/** The underlying GraphReFly node. */
	readonly _node: Node<T>;
}

/**
 * A Nanostores-compatible map.
 *
 * @category compat
 */
export interface NanoMap<T extends Record<string, unknown>> extends NanoAtom<T> {
	/** Set a single key. */
	setKey<K extends keyof T>(key: K, value: T[K]): void;
}

const START_LISTENERS = new WeakMap<Node<any>, Set<() => void>>();
const STOP_LISTENERS = new WeakMap<Node<any>, Set<() => void>>();

function trigger(node: Node<any>, map: WeakMap<Node<any>, Set<() => void>>) {
	const callbacks = map.get(node);
	if (callbacks) {
		for (const cb of callbacks) cb();
	}
}

function createStore<T>(node: Node<T>, extra: any = {}): any {
	let listeners = 0;
	const store = {
		...extra,
		get: () => getVal(node),
		subscribe: (cb: (value: T) => void) => {
			if (listeners === 0) trigger(node, START_LISTENERS);
			listeners++;
			// Push-on-subscribe delivers the initial value via DATA — no explicit cb() needed.
			const sub = node.subscribe((msgs: Messages) => {
				for (const [t, v] of msgs) {
					if (t === DATA) cb(v as T);
				}
			});
			return () => {
				sub();
				listeners--;
				if (listeners === 0) trigger(node, STOP_LISTENERS);
			};
		},
		listen: (cb: (value: T) => void) => {
			if (listeners === 0) trigger(node, START_LISTENERS);
			listeners++;
			// Skip the initial push-on-subscribe DATA — listen() fires on changes only.
			let initial = true;
			const sub = node.subscribe((msgs: Messages) => {
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
			return () => {
				sub();
				listeners--;
				if (listeners === 0) trigger(node, STOP_LISTENERS);
			};
		},
		_node: node,
	};
	return store;
}

function pull<T>(n: Node<T>): T {
	let val: T | undefined = n.get();
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

function getVal<T>(n: Node<T>): T {
	if (n.status === "disconnected") {
		return pull(n);
	}
	return n.get() as T;
}

/**
 * Creates a nanostores-compatible atom.
 *
 * @param initial - Initial value.
 * @returns `NanoAtom<T>`
 *
 * @category compat
 */
export function atom<T>(initial: T): NanoAtom<T> {
	const n = state<T>(initial, {
		resubscribable: true,
		resetOnTeardown: true,
	});

	return createStore(n, {
		set: (value: T) => n.down([[DATA, value]]),
	});
}

/**
 * Creates a nanostores-compatible computed store.
 *
 * @param stores - One or more atoms/computed stores.
 * @param fn - Compute function.
 * @returns `NanoComputed<T>`
 *
 * @category compat
 */
export function computed<T, A>(
	storeA: NanoAtom<A> | NanoComputed<A>,
	fn: (a: A) => T,
): NanoComputed<T>;
export function computed<T, A, B>(
	stores: [NanoAtom<A> | NanoComputed<A>, NanoAtom<B> | NanoComputed<B>],
	fn: (a: A, b: B) => T,
): NanoComputed<T>;
export function computed<T, A, B, C>(
	stores: [
		NanoAtom<A> | NanoComputed<A>,
		NanoAtom<B> | NanoComputed<B>,
		NanoAtom<C> | NanoComputed<C>,
	],
	fn: (a: A, b: B, c: C) => T,
): NanoComputed<T>;
export function computed<T>(stores: any, fn: (...args: any[]) => T): NanoComputed<T> {
	const storeArray: Array<NanoAtom<any> | NanoComputed<any>> = Array.isArray(stores)
		? stores
		: [stores];

	const n = dynamicNode(
		(get: DynGet) => {
			const vals = storeArray.map((s) => {
				const node = s._node;
				if (node.status === "disconnected") {
					pull(node);
				}
				return get(node);
			});
			return fn(...vals);
		},
		{
			resubscribable: true,
			resetOnTeardown: true,
			equals: Object.is as any,
		},
	);

	return createStore(n);
}

/**
 * Creates a nanostores-compatible map.
 *
 * @param initial - Initial object value.
 * @returns `NanoMap<T>`
 *
 * @category compat
 */
export function map<T extends Record<string, unknown>>(initial: T): NanoMap<T> {
	const n = state<T>(initial, {
		resubscribable: true,
		resetOnTeardown: true,
		equals: () => false,
	});

	return createStore(n, {
		set: (value: T) => n.down([[DATA, value]]),
		setKey: <K extends keyof T>(key: K, value: T[K]) => {
			const current = getVal(n);
			n.down([[DATA, { ...current, [key]: value }]]);
		},
	});
}

/**
 * Returns the current value of the store.
 *
 * @category compat
 */
export function getValue<T>(store: NanoAtom<T> | NanoComputed<T>): T {
	return store.get();
}

/**
 * Adds a listener for the store start (first listener connected).
 *
 * @category compat
 */
export function onStart(store: NanoAtom<any> | NanoComputed<any>, cb: () => void): void {
	const node = store._node;
	let callbacks = START_LISTENERS.get(node);
	if (!callbacks) {
		callbacks = new Set();
		START_LISTENERS.set(node, callbacks);
	}
	callbacks.add(cb);
}

/**
 * Adds a listener for the store stop (last listener disconnected).
 *
 * @category compat
 */
export function onStop(store: NanoAtom<any> | NanoComputed<any>, cb: () => void): void {
	const node = store._node;
	let callbacks = STOP_LISTENERS.get(node);
	if (!callbacks) {
		callbacks = new Set();
		STOP_LISTENERS.set(node, callbacks);
	}
	callbacks.add(cb);
}

/**
 * Adds a listener for the store mount (first listener connected).
 *
 * @returns A cleanup function called when the last listener is removed.
 * @category compat
 */
export function onMount(
	store: NanoAtom<any> | NanoComputed<any>,
	cb: () => (() => void) | undefined,
): void {
	onStart(store, () => {
		const stop = cb();
		if (typeof stop === "function") onStop(store, stop);
	});
}

/**
 * Batches multiple store updates.
 *
 * @category compat
 */
export function action<Args extends any[], Return>(
	_store: NanoAtom<any> | NanoComputed<any>,
	_name: string,
	fn: (...args: Args) => Return,
): (...args: Args) => Return {
	return (...args: Args) => {
		let result: any;
		batch(() => {
			result = fn(...args);
		});
		return result as Return;
	};
}
