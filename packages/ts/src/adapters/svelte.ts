/**
 * Svelte node bindings for GraphReFly (D238).
 *
 * Svelte is imported only from this focused subpath.
 */

import { type Readable, readable } from "svelte/store";
import type { Node } from "../node/node.js";
import {
	nodeSnapshot,
	recordReadableStore,
	subscribeNodeValues,
	type WritableNode,
} from "./store.js";

/** A Svelte-readable store plus DATA-only write helpers. */
export interface NodeWritable<T> extends Readable<T | undefined> {
	set(value: T): void;
	update(fn: (value: T | undefined) => T): void;
}

/** Read a GraphReFly node as a Svelte readable store.
 * @param node - Node to observe, adapt, or connect.
 * @returns A `Readable<T | undefined>` value.
 * @category adapters
 * @example
 * ```ts
 * import { nodeReadable } from "@graphrefly/ts/adapters/svelte";
 * ```
 */
export function nodeReadable<T>(node: Node<T>): Readable<T | undefined> {
	return readable<T | undefined>(nodeSnapshot(node), (set) =>
		subscribeNodeValues(node, set, { immediate: true }),
	);
}

function assertDataValue(value: unknown): void {
	if (value === undefined) {
		throw new TypeError("nodeWritable: undefined is SENTINEL/no DATA, not a writable DATA value");
	}
}

/** Bind a writable GraphReFly node as a Svelte store.
 * @param node - Node to observe, adapt, or connect.
 * @returns A `NodeWritable<T>` value.
 * @category adapters
 * @example
 * ```ts
 * import { nodeWritable } from "@graphrefly/ts/adapters/svelte";
 * ```
 */
export function nodeWritable<T>(node: WritableNode<T>): NodeWritable<T> {
	const store = nodeReadable(node);
	return {
		subscribe: store.subscribe,
		set(value) {
			assertDataValue(value);
			node.set(value);
		},
		update(fn) {
			const next = fn(nodeSnapshot(node));
			assertDataValue(next);
			node.set(next);
		},
	};
}

/**
 * Read a keyed record of nodes as a Svelte readable store.
 *
 * `factory` must have stable identity. Recreating it during component churn
 * rebuilds the record subscriptions.
 * @param keysNode - keys node value used by the helper.
 * @param factory - factory value used by the helper.
 * @returns A `Readable<Record<K, R>>` value.
 * @category adapters
 * @example
 * ```ts
 * import { nodeRecord } from "@graphrefly/ts/adapters/svelte";
 * ```
 */
export function nodeRecord<K extends string, R extends Record<string, unknown>>(
	keysNode: Node<readonly K[]>,
	factory: (key: K) => { [P in keyof R]: Node<R[P]> },
): Readable<Record<K, R>> {
	const store = recordReadableStore(keysNode, factory);
	const read = () => store.get() ?? ({} as Record<K, R>);
	return readable(read(), (set) => store.subscribe((value) => set(value ?? ({} as Record<K, R>))));
}
