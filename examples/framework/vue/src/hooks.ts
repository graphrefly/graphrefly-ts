import { nodeSnapshot, subscribeNodeValues, type WritableNode } from "@graphrefly/ts/adapters";
import type { Node } from "@graphrefly/ts/core";
import { customRef, onScopeDispose, type Ref, readonly } from "vue";

function nodeRef<T>(node: Node<T>, writable?: WritableNode<T>): Ref<T | undefined> {
	return customRef<T | undefined>((track, trigger) => {
		let value = nodeSnapshot(node);
		const unsubscribe = subscribeNodeValues(
			node,
			(next) => {
				value = next;
				trigger();
			},
			{ changesOnly: true },
		);
		onScopeDispose(unsubscribe);
		return {
			get() {
				track();
				return value;
			},
			set(next) {
				writable?.set(next as T);
			},
		};
	});
}

export function useSubscribe<T>(node: Node<T>): Readonly<Ref<T | undefined>> {
	return readonly(nodeRef(node));
}

export function useStore<T>(node: WritableNode<T>): Ref<T | undefined> {
	return nodeRef(node, node);
}
