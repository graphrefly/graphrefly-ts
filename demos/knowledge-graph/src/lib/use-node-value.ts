import type { Node } from "@graphrefly/graphrefly/core";
import { useEffect, useRef, useState } from "react";

/** Subscribe to a GraphReFly node and return its current cache as React state. */
export function useNodeValue<T>(node: Node<T> | null | undefined, initial: T): T {
	// `initial` is captured by ref so callers can pass a fresh literal each
	// render (e.g., `[]`) without forcing re-subscription on every render.
	const initialRef = useRef(initial);
	initialRef.current = initial;
	const [v, set] = useState<T>(() => (node?.cache as T) ?? initial);
	useEffect(() => {
		if (!node) return;
		set((node.cache as T) ?? initialRef.current);
		return node.subscribe(() => {
			set((node.cache as T) ?? initialRef.current);
		});
	}, [node]);
	return v;
}
