// ---------------------------------------------------------------------------
// Vue bindings — useStore / useSubscribe
// ---------------------------------------------------------------------------
// Bridges GraphReFly nodes into Vue reactivity. Works with any
// Node<T>, including companion nodes (node.meta.status).
//
// Usage:
//   import { useStore, useSubscribe } from '@graphrefly/graphrefly-ts/compat/vue';
//   // Optional peer install (only for this adapter): pnpm add vue
//   const count = useStore(counterNode);       // Ref<number | undefined> (read + write)
//   const status = useSubscribe(wsStatusNode); // Readonly<Ref<string | undefined>>
// ---------------------------------------------------------------------------

import { DATA, DIRTY, type Node } from "@graphrefly/pure-ts/core";
import {
	computed,
	getCurrentScope,
	isRef,
	onScopeDispose,
	type Ref,
	readonly,
	shallowRef,
	type WatchSource,
	watch,
} from "vue";

/**
 * Subscribe to a read-only `Node<T>` as a Vue `Ref<T>`. Auto-unsubscribes on scope disposal.
 * Subscription lifecycle is tied to Vue scope disposal (not node terminal messages).
 */
export function useSubscribe<T>(node: Node<T>): Readonly<Ref<T | undefined | null>> {
	const ref = shallowRef(node.cache) as Ref<T | undefined | null>;

	const unsub = node.subscribe(() => {
		ref.value = node.cache;
	});

	if (getCurrentScope()) {
		onScopeDispose(() => unsub());
	} else if (typeof console !== "undefined") {
		console.warn(
			"[graphrefly-ts] useSubscribe called outside a Vue scope — subscription will not be auto-disposed.",
		);
	}

	return readonly(ref) as Readonly<Ref<T | undefined | null>>;
}

/**
 * Bind a writable `Node<T>` as a Vue `Ref<T>`. Reads and writes are bidirectional.
 * Value sets always dispatch `[[DIRTY], [DATA, value]]`, including `value === undefined`.
 * Subscription lifecycle is tied to Vue scope disposal (not node terminal messages).
 */
export function useStore<T>(node: Node<T>): Ref<T | undefined | null> {
	const inner = shallowRef(node.cache) as Ref<T | undefined | null>;

	const unsub = node.subscribe(() => {
		inner.value = node.cache;
	});

	if (getCurrentScope()) {
		onScopeDispose(() => unsub());
	} else if (typeof console !== "undefined") {
		console.warn(
			"[graphrefly-ts] useStore called outside a Vue scope — subscription will not be auto-disposed.",
		);
	}

	return computed({
		get: () => inner.value,
		set: (v: T | undefined | null) => {
			node.down([[DIRTY], [DATA, v]]);
		},
	});
}

/** Maps a key to an object of nodes. Used by `useSubscribeRecord` factory. */
export type NodeFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Node<R[P]>;
};

/**
 * Subscribe to a dynamic set of keyed node records. When keys change,
 * old subscriptions are torn down and new ones created automatically.
 * Must be called during Vue `setup()`.
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keys: WatchSource<K[] | undefined>,
	factory: NodeFactory<K, R>,
): Readonly<Ref<Record<K, R>>> {
	const result = shallowRef<Record<K, R>>({} as Record<K, R>);

	// Track active subscriptions per key (strictly enclosed memory mapping)
	const activeSubs = new Map<K, { subs: Array<() => void>; values: R }>();
	function flushResult() {
		const snap = {} as Record<K, R>;
		for (const [key, entry] of activeSubs) {
			snap[key] = { ...entry.values };
		}
		result.value = snap;
	}

	function sync(newKeys: K[]) {
		for (const entry of activeSubs.values()) {
			for (const unsub of entry.subs) unsub();
		}
		activeSubs.clear();

		for (const key of newKeys) {
			const nodes = factory(key);
			const fields = Object.keys(nodes) as (keyof R)[];
			const values = {} as R;
			const subs: Array<() => void> = [];

			for (const field of fields) {
				const node = nodes[field];
				values[field] = node.cache as R[keyof R];
				const unsub = node.subscribe(() => {
					values[field] = node.cache as R[keyof R];
					flushResult();
				});
				subs.push(unsub);
			}

			activeSubs.set(key, { subs, values });
		}

		const snap = {} as Record<K, R>;
		for (const [key, entry] of activeSubs) {
			snap[key] = { ...entry.values };
		}
		result.value = snap;
	}

	const readKeys = (): K[] => {
		const current = typeof keys === "function" ? keys() : isRef(keys) ? keys.value : keys;
		return [...(current ?? [])];
	};

	watch(readKeys, (newKeys) => sync(newKeys ?? []), { immediate: true });

	if (getCurrentScope()) {
		onScopeDispose(() => {
			for (const entry of activeSubs.values()) {
				for (const unsub of entry.subs) unsub();
			}
			activeSubs.clear();
		});
	} else if (typeof console !== "undefined") {
		console.warn(
			"[graphrefly-ts] useSubscribeRecord called outside a Vue scope — subscription will not be auto-disposed.",
		);
	}

	return readonly(result) as Readonly<Ref<Record<K, R>>>;
}
