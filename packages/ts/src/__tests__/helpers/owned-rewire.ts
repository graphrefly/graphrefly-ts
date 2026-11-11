/**
 * Test-only: change a node's declared dependencies from outside, through the internal rewire, to
 * set up topology for tests of describe, incoming topology and restore. The package has no
 * graph-level rewire (R-request-order): nodes rewire themselves through ctx.rewire.
 */
import type { NodeFn } from "../../ctx/types.js";
import type { Node } from "../../node/node.js";
import { nodeRuntimeHost } from "../../node/node-runtime-host.js";

export function rewireOwnedNode(node: Node<unknown>, deps: Node<unknown>[], fn?: NodeFn): void {
	nodeRuntimeHost(node)._rewire(deps, fn, { declare: true });
}

export function addOwnedNodeDep(node: Node<unknown>, dep: Node<unknown>, fn?: NodeFn): void {
	const current = node.deps;
	rewireOwnedNode(node, current.includes(dep) ? [...current] : [...current, dep], fn);
}

export function removeOwnedNodeDep(node: Node<unknown>, dep: Node<unknown>, fn?: NodeFn): void {
	rewireOwnedNode(
		node,
		node.deps.filter((d) => d !== dep),
		fn,
	);
}
