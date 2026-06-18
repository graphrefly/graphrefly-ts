import type { Node } from "@graphrefly/ts/core";
import { useEffect, useState } from "react";

export function useNodeValue<T>(node: Node<T> | null | undefined, fallback: T): T {
	const [value, setValue] = useState<T>(() => (node?.cache as T | undefined) ?? fallback);

	useEffect(() => {
		if (node === null || node === undefined) return;
		setValue((node.cache as T | undefined) ?? fallback);
		const unsubscribe = node.subscribe((msg) => {
			if (msg[0] === "DATA") setValue(msg[1] as T);
		});
		return unsubscribe;
	}, [node, fallback]);

	return value;
}
