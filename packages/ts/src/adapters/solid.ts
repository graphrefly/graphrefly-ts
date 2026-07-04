/**
 * Solid node bindings for GraphReFly (D238).
 *
 * Solid is imported only from this focused subpath.
 */

import { type Accessor, createSignal, onCleanup } from "solid-js";
import type { Node } from "../node/node.js";
import { readableStore, recordReadableStore, type WritableNode } from "./store.js";

function assertDataValue(value: unknown): void {
	if (value === undefined) {
		throw new TypeError(
			"createNodeInput: undefined is SENTINEL/no DATA, not a writable DATA value",
		);
	}
}

function bindReadable<T>(store: { get(): T; subscribe(run: (value: T) => void): () => void }) {
	const [value, setValue] = createSignal<T>(store.get());
	const unsubscribe = store.subscribe((next) => {
		setValue(() => next);
	});
	onCleanup(unsubscribe);
	return value;
}

/** Read a GraphReFly node as a Solid accessor.
 * @param node - Node to observe, adapt, or connect.
 * @returns A `Accessor<T | undefined>` value.
 * @category adapters
 * @example
 * ```ts
 * import { createNodeValue } from "@graphrefly/ts/adapters/solid";
 * ```
 */
export function createNodeValue<T>(node: Node<T>): Accessor<T | undefined> {
	return bindReadable(readableStore(node));
}

/** Bind a writable GraphReFly node as `[valueAccessor, setValue]`.
 * @param node - Node to observe, adapt, or connect.
 * @returns A `readonly [Accessor<T | undefined>, (value: T) => void]` value.
 * @category adapters
 * @example
 * ```ts
 * import { createNodeInput } from "@graphrefly/ts/adapters/solid";
 * ```
 */
export function createNodeInput<T>(
	node: WritableNode<T>,
): readonly [Accessor<T | undefined>, (value: T) => void] {
	return [
		createNodeValue(node),
		(value: T) => {
			assertDataValue(value);
			node.set(value);
		},
	] as const;
}

/**
 * Read a keyed record of nodes as a Solid accessor.
 *
 * `factory` must have stable identity; callers should define it outside render
 * churn or memoize it in their component setup.
 * @param keysNode - keys node value used by the helper.
 * @param factory - factory value used by the helper.
 * @returns A `Accessor<Record<K, R>>` value.
 * @category adapters
 * @example
 * ```ts
 * import { createNodeRecord } from "@graphrefly/ts/adapters/solid";
 * ```
 */
export function createNodeRecord<K extends string, R extends Record<string, unknown>>(
	keysNode: Node<readonly K[]>,
	factory: (key: K) => { [P in keyof R]: Node<R[P]> },
): Accessor<Record<K, R>> {
	const store = recordReadableStore(keysNode, factory);
	return bindReadable({
		get: () => store.get() ?? ({} as Record<K, R>),
		subscribe: (run) => store.subscribe((value) => run(value ?? ({} as Record<K, R>))),
	});
}
