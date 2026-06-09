import { reactExternalStore, type WritableNode } from "@graphrefly/ts/adapters";
import type { Node } from "@graphrefly/ts/core";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export function useSubscribe<T>(node: Node<T>): T | undefined {
	const store = useMemo(() => reactExternalStore(node), [node]);
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export function useStore<T>(node: WritableNode<T>): [T | undefined, (value: T) => void] {
	const value = useSubscribe(node);
	const setValue = useCallback((next: T) => node.set(next), [node]);
	return [value, setValue];
}
