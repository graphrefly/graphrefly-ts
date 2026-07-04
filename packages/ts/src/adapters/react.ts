/**
 * React node bindings for GraphReFly (D238).
 *
 * React is imported only from this focused subpath. The dependency-free
 * `@graphrefly/ts/adapters` barrel keeps the framework-neutral store contract.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Node } from "../node/node.js";
import { externalStore, recordReadableStore, type WritableNode } from "./store.js";

function assertDataValue(value: unknown): void {
	if (value === undefined) {
		throw new TypeError("useNodeInput: undefined is SENTINEL/no DATA, not a writable DATA value");
	}
}

/** Read a GraphReFly node through React's useSyncExternalStore contract.
 * @param node - Node to observe, adapt, or connect.
 * @returns A `T | undefined` value.
 * @category adapters
 * @example
 * ```ts
 * import { useNodeValue } from "@graphrefly/ts/adapters/react";
 * ```
 */
export function useNodeValue<T>(node: Node<T>): T | undefined {
	const store = useMemo(() => externalStore(node), [node]);
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/**
 * Bind a writable GraphReFly node as `[value, setValue]`.
 *
 * The setter identity is stable for a stable node identity, and writes through
 * the node's reactive DATA boundary rather than a presentation-owned trigger.
 * @param node - Node to observe, adapt, or connect.
 * @returns A `readonly [T | undefined, (value: T) => void]` value.
 * @category adapters
 * @example
 * ```ts
 * import { useNodeInput } from "@graphrefly/ts/adapters/react";
 * ```
 */
export function useNodeInput<T>(
	node: WritableNode<T>,
): readonly [T | undefined, (value: T) => void] {
	const value = useNodeValue(node);
	const setValue = useCallback(
		(next: T) => {
			assertDataValue(next);
			node.set(next);
		},
		[node],
	);
	return [value, setValue] as const;
}

/**
 * Read a keyed record of nodes.
 *
 * `factory` must have stable identity. Recreating it on every render forces the
 * record subscription graph to rebuild on every render.
 * @param keysNode - keys node value used by the helper.
 * @param factory - factory value used by the helper.
 * @returns A `Record<K, R>` value.
 * @category adapters
 * @example
 * ```ts
 * import { useNodeRecord } from "@graphrefly/ts/adapters/react";
 * ```
 */
export function useNodeRecord<K extends string, R extends Record<string, unknown>>(
	keysNode: Node<readonly K[]>,
	factory: (key: K) => { [P in keyof R]: Node<R[P]> },
): Record<K, R> {
	const store = useMemo(() => {
		const recordStore = recordReadableStore(keysNode, factory);
		let current = recordStore.get() ?? ({} as Record<K, R>);
		return {
			getSnapshot: () => current,
			subscribe(onStoreChange: () => void) {
				return recordStore.subscribe((next) => {
					current = next ?? ({} as Record<K, R>);
					onStoreChange();
				});
			},
		};
	}, [keysNode, factory]);
	const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
