/**
 * Vue node bindings for GraphReFly (D238).
 *
 * Vue is imported only from this focused subpath.
 */

import { onScopeDispose, readonly, type ShallowRef, shallowRef } from "vue";
import type { Node } from "../node/node.js";
import { readableStore, recordReadableStore, type WritableNode } from "./store.js";

function assertDataValue(value: unknown): void {
	if (value === undefined) {
		throw new TypeError("useNodeInput: undefined is SENTINEL/no DATA, not a writable DATA value");
	}
}

function bindReadable<T>(store: { get(): T; subscribe(run: (value: T) => void): () => void }) {
	const value = shallowRef(store.get()) as ShallowRef<T>;
	const unsubscribe = store.subscribe((next) => {
		value.value = next;
	});
	onScopeDispose(unsubscribe);
	return readonly(value) as Readonly<ShallowRef<T>>;
}

/** Read a GraphReFly node as a Vue shallow ref. */
export function useNodeValue<T>(node: Node<T>): Readonly<ShallowRef<T | undefined>> {
	return bindReadable(readableStore(node));
}

/** Bind a writable GraphReFly node as `[valueRef, setValue]`. */
export function useNodeInput<T>(
	node: WritableNode<T>,
): readonly [Readonly<ShallowRef<T | undefined>>, (value: T) => void] {
	return [
		useNodeValue(node),
		(value: T) => {
			assertDataValue(value);
			node.set(value);
		},
	] as const;
}

/**
 * Read a keyed record of nodes as a Vue shallow ref.
 *
 * `factory` must have stable identity; callers should define it outside render
 * churn or memoize it in their composition function.
 */
export function useNodeRecord<K extends string, R extends Record<string, unknown>>(
	keysNode: Node<readonly K[]>,
	factory: (key: K) => { [P in keyof R]: Node<R[P]> },
): Readonly<ShallowRef<Record<K, R>>> {
	const store = recordReadableStore(keysNode, factory);
	return bindReadable({
		get: () => store.get() ?? ({} as Record<K, R>),
		subscribe: (run) => store.subscribe((value) => run(value ?? ({} as Record<K, R>))),
	});
}
