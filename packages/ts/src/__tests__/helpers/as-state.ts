/**
 * Test-only: a node a test writes as a host must be a state node (graphrefly-ts:D175). Bundles
 * type some state inputs as plain Node; this checks at run time and narrows the type.
 */
import { type Node, StateNode } from "../../node/node.js";

export function asState<T>(node: Node<T> | undefined): StateNode<T> {
	if (!(node instanceof StateNode))
		throw new TypeError("asState: the test writes a node that is not a state node");
	return node;
}
