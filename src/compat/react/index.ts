// ---------------------------------------------------------------------------
// React bindings — useStore / useSubscribe
// ---------------------------------------------------------------------------
// Bridges GraphReFly nodes into React via useSyncExternalStore.
// Works with any Node<T>, including companion nodes (node.meta.status).
//
// Usage:
//   import { useStore, useSubscribe } from '@graphrefly/graphrefly-ts/compat/react';
//   // Optional peer install (only for this adapter): pnpm add react react-dom
//   const value = useSubscribe(myNode);          // T | undefined (read-only)
//   const [count, setCount] = useStore(counter); // [T | undefined, setter]
// ---------------------------------------------------------------------------

import { DATA, DIRTY, type Messages, RESOLVED } from "@graphrefly/pure-ts/core/messages.js";
import type { Node } from "@graphrefly/pure-ts/core/node.js";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * Subscribe to a read-only `Node<T>` as a React value. Re-renders on node value settlement.
 * Subscription lifecycle is tied to React mount/unmount (not node terminal messages).
 *
 * @param node - Any `Node<T>`.
 * @returns `T | undefined` — the current node value, kept in sync via `useSyncExternalStore`.
 */
export function useSubscribe<T>(node: Node<T>): T | undefined | null {
	return useSyncExternalStore(
		(onStoreChange) => {
			let disposed = false;
			const unsub = node.subscribe(() => {
				if (!disposed) onStoreChange();
			});
			return () => {
				disposed = true;
				unsub();
			};
		},
		() => node.cache,
		() => node.cache, // Server snapshot
	);
}

/**
 * Bind a writable `Node<T>` as a React `[value, setter]` tuple.
 * Setting the value always pushes `[[DIRTY], [DATA, value]]`, including `value === undefined`.
 * Subscription lifecycle is tied to React mount/unmount (not node terminal messages).
 *
 * @param node - A `Node<T>` (e.g. state node).
 * @returns `[T | undefined, (value: T) => void]` — current value and setter function.
 */
export function useStore<T>(node: Node<T>): [T | undefined | null, (value: T) => void] {
	const value = useSubscribe(node);
	const setter = useCallback(
		(v: T) => {
			node.down([[DIRTY], [DATA, v]]);
		},
		[node],
	);
	return [value, setter];
}

/** Maps a key to an object of nodes. Used by `useSubscribeRecord`. */
export type NodeFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Node<R[P]>;
};

/**
 * Subscribe to a dynamic set of keyed node records.
 * Re-subscribes all per-key fields whenever `keysNode` changes.
 * Key re-sync is gated to settled batches (`messageTier >= 3`) to avoid DIRTY-phase churn.
 * Guaranteed to clean up strictly with React hook lifecycle, utilizing no global mappings.
 *
 * @param keysNode - Node of current keys (e.g. node IDs)
 * @param factory - Function returning `{ [field]: Node<V> }` for each key.
 * @returns `Record<K, R>` — snapshot of resolved values for all keys.
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keysNode: Node<K[]>,
	factory: NodeFactory<K, R>,
): Record<K, R> {
	const factoryRef = useRef(factory);
	factoryRef.current = factory;

	const store = useMemo(() => {
		const computeSnap = () => {
			const snap = {} as Record<K, R>;
			const keys = keysNode.cache ?? [];
			for (const key of keys) {
				const nodes = factoryRef.current(key);
				const values = {} as R;
				for (const field of Object.keys(nodes) as (keyof R)[]) {
					values[field] = nodes[field].cache as R[keyof R];
				}
				snap[key] = values;
			}
			return snap;
		};

		let currentSnapshot = computeSnap();

		return {
			subscribe: (onStoreChange: () => void) => {
				let disposed = false;
				let entrySubs: Array<() => void> = [];

				const cleanupEntries = () => {
					for (const unsub of entrySubs) unsub();
					entrySubs = [];
				};

				const sync = (nextKeys: K[]) => {
					cleanupEntries();
					for (const key of nextKeys) {
						const nodes = factoryRef.current(key);
						for (const field of Object.keys(nodes) as (keyof R)[]) {
							const unsub = nodes[field].subscribe(() => {
								currentSnapshot = computeSnap();
								if (!disposed) onStoreChange();
							});
							entrySubs.push(unsub);
						}
					}
					currentSnapshot = computeSnap();
					if (!disposed) onStoreChange();
				};

				const keysUnsub = keysNode.subscribe((msgs: Messages) => {
					const hasSettled = msgs.some((m) => m[0] === DATA || m[0] === RESOLVED);
					if (!disposed && hasSettled) sync(keysNode.cache ?? []);
				});
				sync(keysNode.cache ?? []);

				return () => {
					disposed = true;
					keysUnsub();
					cleanupEntries();
				};
			},
			getSnapshot: () => currentSnapshot,
		};
	}, [keysNode]);

	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
