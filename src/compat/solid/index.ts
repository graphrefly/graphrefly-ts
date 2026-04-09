// ---------------------------------------------------------------------------
// Solid bindings — useSubscribe / useStore
// ---------------------------------------------------------------------------
// Bridges GraphReFly nodes into Solid reactivity via createSignal.
// Works with any Node<T>, including companion nodes (node.meta.status).
//
// Usage:
//   import { useSubscribe, useStore } from '@graphrefly/graphrefly-ts/compat/solid';
//   // Optional peer install (only for this adapter): pnpm add solid-js
//   const status = useSubscribe(wsStatusNode);     // Accessor<string | undefined>
//   const [count, setCount] = useStore(countNode); // [Accessor<number | undefined>, Setter]
// ---------------------------------------------------------------------------

import { createSignal, getOwner, onCleanup } from "solid-js";
import { DATA, DIRTY, type Messages, messageTier } from "../../core/messages.js";
import type { Node } from "../../core/node.js";

/** Solid accessor function — returns current value when called. */
export type Accessor<T> = () => T;

/**
 * Subscribe to a `Node<T>` as a Solid signal. Auto-cleans up with the owning scope.
 * Subscription lifecycle is tied to Solid scope cleanup (not node terminal messages).
 */
export function useSubscribe<T>(node: Node<T>): Accessor<T | undefined> {
	const [value, setValue] = createSignal(node.get(), { equals: false });

	const unsub = node.subscribe(() => {
		setValue(() => node.get());
	});

	if (getOwner()) {
		onCleanup(() => unsub());
	} else if (typeof console !== "undefined") {
		console.warn(
			"[graphrefly-ts] useSubscribe called outside a Solid reactive owner — subscription will not be auto-disposed.",
		);
	}

	return value;
}

/**
 * Bind a writable `Node<T>` as a Solid resource tuple `[accessor, setter]`.
 * Setter always forwards `[[DIRTY], [DATA, value]]`, including `value === undefined`.
 * Subscription lifecycle is tied to Solid scope cleanup (not node terminal messages).
 */
export function useStore<T>(node: Node<T>): [Accessor<T | undefined>, (v: T) => void] {
	const value = useSubscribe(node);
	const setter = (v: T) => {
		node.down([[DIRTY], [DATA, v]]);
	};
	return [value, setter];
}

/** Maps a key to an object of nodes. Used by `useSubscribeRecord`. */
export type NodeFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Node<R[P]>;
};

/**
 * Subscribe to a dynamic set of keyed node records as a Solid accessor.
 * Re-subscribes all per-key fields whenever `keys` changes.
 * Key re-sync is gated to settled batches (`messageTier >= 3`) to avoid DIRTY-phase churn.
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keysNode: Node<K[]>,
	factory: NodeFactory<K, R>,
): Accessor<Record<K, R>> {
	const [value, setValue] = createSignal({} as Record<K, R>, { equals: false });
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
					setValue(() => buildSnapshot());
				});
				entrySubs.push(unsub);
			}
		}
		setValue(() => buildSnapshot());
	};

	const keysUnsub = keysNode.subscribe((msgs: Messages) => {
		if (msgs.some((m) => messageTier(m[0]) >= 3)) {
			sync(keysNode.get() ?? []);
		}
	});
	sync(keysNode.get() ?? []);

	if (getOwner()) {
		onCleanup(() => {
			keysUnsub();
			cleanupEntries();
		});
	} else if (typeof console !== "undefined") {
		console.warn(
			"[graphrefly-ts] useSubscribeRecord called outside a Solid reactive owner — subscription will not be auto-disposed.",
		);
	}

	return value;
}
