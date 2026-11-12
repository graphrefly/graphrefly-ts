/**
 * Test-only: change a node's declared dependencies from outside, through the internal rewire, to
 * set up topology for tests of describe, incoming topology and restore. The package has no
 * graph-level rewire (R-request-order): nodes rewire themselves through ctx.rewire.
 */
import type { NodeFn } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type { Node, StateNode } from "../../node/node.js";
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

/**
 * Test-only: give a computed node an extra state input whose values it sends as its own and whose
 * ERROR ends it, the way a test once wrote the node from outside. The node's function still runs
 * for its own inputs; in a wave of only the extra input their batches are empty. With `only`, the
 * extra input replaces the node's inputs and function, for a node whose own inputs never get a
 * value in the test (its first run would wait for them).
 */
export function injectOwnedNodeInput<T>(
	graph: Graph,
	node: Node<T>,
	opts: { only?: boolean } = {},
): StateNode<T> {
	const host = nodeRuntimeHost(node as Node<unknown>);
	const original = opts.only ? null : host._slot.fn;
	const kept = opts.only ? [] : [...node.deps];
	const index = kept.length;
	const input = graph.node<T>([], null, { name: `test/inject/${node.name ?? "node"}` });
	host._rewire(
		[...kept, input as Node<unknown>],
		(ctx) => {
			const ended = ctx.deps[index].terminal;
			if (ended?.kind === "error") {
				ctx.down([["ERROR", ended.error]]);
				return;
			}
			const values = ctx.deps[index].waves.flat();
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value] as const));
			if (original !== null) original(ctx);
		},
		{ declare: true },
	);
	return input;
}
