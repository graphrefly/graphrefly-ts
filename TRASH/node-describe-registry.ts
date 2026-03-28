import type { Node } from "./node.js";

/**
 * Snapshot of node factory configuration for {@link describeNode} (graphrefly-py
 * `describe_node` parity). Populated only for nodes created via {@link node}.
 */
export type NodeDescribeMirror = {
	readonly hasDeps: boolean;
	readonly hasFn: boolean;
	readonly depNames: () => readonly string[];
	readonly manualEmitUsed: () => boolean;
};

const mirrors = new WeakMap<Node, NodeDescribeMirror>();

/** @internal */
export function setNodeDescribeMirror(node: Node, mirror: NodeDescribeMirror): void {
	mirrors.set(node, mirror);
}

/** @internal */
export function getNodeDescribeMirror(node: Node): NodeDescribeMirror | undefined {
	return mirrors.get(node);
}
