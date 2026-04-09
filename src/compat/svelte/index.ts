// ---------------------------------------------------------------------------
// Svelte bindings — useSubscribe / useStore
// ---------------------------------------------------------------------------
// Bridges GraphReFly nodes into Svelte's store contract. Works with any
// Node<T>, including companion nodes (node.meta.status).
//
// Usage:
//   import { useSubscribe, useStore } from '@graphrefly/graphrefly-ts/compat/svelte';
//   // Optional peer install (only for this adapter): pnpm add svelte
//   const status = useSubscribe(wsStatusNode);   // Svelte readable store
//   const count = useStore(countNode);           // Svelte writable store
//   // In template: $status, $count
//   // $count = 42
// ---------------------------------------------------------------------------

import { DATA, DIRTY, type Messages, messageTier } from "../../core/messages.js";
import type { Node } from "../../core/node.js";

/** Svelte store contract — implements the minimal `subscribe` method. */
export interface SvelteReadable<T> {
	subscribe(run: (value: T) => void): () => void;
}

/** Svelte writable store contract. */
export interface SvelteWritable<T> extends SvelteReadable<T> {
	set(value: T): void;
	update(updater: (value: T) => T): void;
}

/**
 * Subscribe to a `Node<T>` as a Svelte readable store (implements Svelte store contract).
 * Subscription lifecycle is tied to Svelte store unsubscription (not node terminal messages).
 */
export function useSubscribe<T>(node: Node<T>): SvelteReadable<T | undefined> {
	return {
		subscribe(run: (value: T | undefined) => void): () => void {
			const unsub = node.subscribe(() => {
				run(node.get());
			});
			run(node.get());
			return unsub;
		},
	};
}

/**
 * Bind a writable `Node<T>` as a Svelte writable store.
 * Reads and writes adapt seamlessly.
 * Setter/update always forward `[[DIRTY], [DATA, value]]`, including `value === undefined`.
 * Subscription lifecycle is tied to Svelte store unsubscription (not node terminal messages).
 */
export function useStore<T>(node: Node<T>): SvelteWritable<T | undefined> {
	return {
		subscribe(run: (value: T | undefined) => void): () => void {
			const unsub = node.subscribe(() => {
				run(node.get());
			});
			run(node.get());
			return unsub;
		},
		set(value: T | undefined) {
			node.down([[DIRTY], [DATA, value]]);
		},
		update(updater: (value: T | undefined) => T | undefined) {
			const next = updater(node.get());
			node.down([[DIRTY], [DATA, next]]);
		},
	};
}

/** Maps a key to an object of nodes. Used by `useSubscribeRecord`. */
export type NodeFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Node<R[P]>;
};

/**
 * Subscribe to a dynamic keyed record of nodes as a Svelte readable store.
 * Re-subscribes all per-key fields whenever `keysNode` changes.
 * Key re-sync is gated to settled batches (`messageTier >= 3`) to avoid DIRTY-phase churn.
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keysNode: Node<K[]>,
	factory: NodeFactory<K, R>,
): SvelteReadable<Record<K, R>> {
	return {
		subscribe(run: (value: Record<K, R>) => void): () => void {
			let entrySubs: Array<() => void> = [];

			const cleanupEntries = () => {
				for (const unsub of entrySubs) unsub();
				entrySubs = [];
			};

			const buildSnapshot = (): Record<K, R> => {
				const snap = {} as Record<K, R>;
				for (const key of keysNode.get() ?? []) {
					const nodes = factory(key);
					const values = {} as R;
					for (const field of Object.keys(nodes) as (keyof R)[]) {
						values[field] = nodes[field].get() as R[keyof R];
					}
					snap[key] = values;
				}
				return snap;
			};

			const sync = (nextKeys: K[]) => {
				cleanupEntries();
				for (const key of nextKeys) {
					const nodes = factory(key);
					for (const field of Object.keys(nodes) as (keyof R)[]) {
						const unsub = nodes[field].subscribe(() => {
							run(buildSnapshot());
						});
						entrySubs.push(unsub);
					}
				}
				run(buildSnapshot());
			};

			const keysUnsub = keysNode.subscribe((msgs: Messages) => {
				if (msgs.some((m) => messageTier(m[0]) >= 3)) {
					sync(keysNode.get() ?? []);
				}
			});
			sync(keysNode.get() ?? []);

			return () => {
				keysUnsub();
				cleanupEntries();
			};
		},
	};
}
