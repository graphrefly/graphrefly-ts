import type { Node } from "@graphrefly/graphrefly/core";
import { useEffect, useState } from "react";

/**
 * React subscription hook for any graphrefly `Node<T>`. Reads `.cache` lazily;
 * re-renders whenever the node pushes a new DATA value. Deliberately avoids
 * `useSyncExternalStore` so we can tolerate nodes whose cache is `undefined`
 * (SENTINEL) before they've resolved — React's SES contract requires a
 * non-undefined snapshot and would throw for an unresolved derived.
 */
export function useNodeValue<T>(node: Node<T>): T | null {
	const [value, setValue] = useState<T | null>(() => (node.cache as T | null) ?? null);
	useEffect(() => {
		const unsub = node.subscribe(() => {
			setValue((node.cache as T | null) ?? null);
		});
		setValue((node.cache as T | null) ?? null);
		return unsub;
	}, [node]);
	return value;
}
