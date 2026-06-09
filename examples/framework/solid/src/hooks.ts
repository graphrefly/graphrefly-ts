import { nodeSnapshot, subscribeNodeValues, type WritableNode } from "@graphrefly/ts/adapters";
import type { Node } from "@graphrefly/ts/core";
import { type Accessor, createSignal, onCleanup } from "solid-js";

export function useSubscribe<T>(node: Node<T>): Accessor<T | undefined> {
	const [value, setValue] = createSignal<T | undefined>(nodeSnapshot(node));
	const unsubscribe = subscribeNodeValues(node, (next) => setValue(() => next), {
		changesOnly: true,
	});
	onCleanup(unsubscribe);
	return value;
}

export function useStore<T>(node: WritableNode<T>): [Accessor<T | undefined>, (value: T) => void] {
	return [useSubscribe(node), (value) => node.set(value)];
}
