import type { Node } from "@graphrefly/graphrefly/core";
import { useEffect, useState } from "react";

/** Subscribe to a GraphReFly Node and re-render on each DATA emission. */
export function useNodeValue<T>(node: Node<T> | null | undefined, fallback: T): T {
	const [value, setValue] = useState<T>(() => (node?.cache as T) ?? fallback);

	useEffect(() => {
		if (!node) return;
		// Sync immediately in case cache changed between render and effect
		setValue((node.cache as T) ?? fallback);
		const unsub = node.subscribe(() => {
			setValue((node.cache as T) ?? fallback);
		});
		return unsub;
	}, [node, fallback]);

	return value;
}
