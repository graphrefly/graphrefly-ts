/**
 * Framework-neutral graph boundary projection (D238).
 *
 * The manifest is derived from describe()/live topology (R-describe,
 * R-edges-derived). It does not own widgets, layouts, capabilities, or product
 * metadata; those layers consume this structural boundary.
 */

import type { WritableNode } from "../adapters/store.js";
import type { DescribeSnapshot } from "../graph/describe.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

export type BoundaryRole = "input" | "output";

export interface BaseBoundaryNode {
	/** Registered graph node id/path. */
	name: string;
	/** Structural boundary role inferred from current describe() topology. */
	role: BoundaryRole;
	/** describe() factory: "state" | "producer" | "derived" | operator real name. */
	type: string;
	/** Live handle for framework adapters such as useNodeInput/useNodeValue. */
	node: Node<unknown>;
}

export interface InputBoundaryNode extends BaseBoundaryNode {
	role: "input";
	node: WritableNode<unknown>;
}

export interface OutputBoundaryNode extends BaseBoundaryNode {
	role: "output";
}

export type BoundaryNode = InputBoundaryNode | OutputBoundaryNode;

export interface BoundaryManifest {
	inputs: InputBoundaryNode[];
	outputs: OutputBoundaryNode[];
}

/**
 * Derive a narrow v0 boundary manifest from current graph structure.
 *
 * Writable source nodes are inputs; unconsumed sink nodes are outputs; interior
 * nodes are omitted. Auto-discovered graphless describe entries are skipped
 * because widgets need live graph handles.
 */
export function boundaryManifest(graph: Graph): BoundaryManifest {
	const described = graph.describe();
	const consumed = new Set<string>();
	for (const snapshot of walkSnapshots(described)) {
		for (const edge of snapshot.edges ?? []) consumed.add(edge.from);
	}
	const inputs: InputBoundaryNode[] = [];
	const outputs: OutputBoundaryNode[] = [];

	for (const snapshot of walkSnapshots(described)) {
		for (const entry of snapshot.nodes ?? []) {
			const node = graph.find(entry.id);
			if (node === undefined) continue;
			const isSource = (entry.deps?.length ?? 0) === 0;
			if (isSource && isWritableNode(node)) {
				inputs.push({ name: entry.id, role: "input", type: entry.factory, node });
			} else if (!consumed.has(entry.id)) {
				outputs.push({ name: entry.id, role: "output", type: entry.factory, node });
			}
		}
	}

	return { inputs, outputs };
}

function* walkSnapshots(snapshot: DescribeSnapshot): Generator<DescribeSnapshot> {
	yield snapshot;
	for (const child of snapshot.subgraphs ?? []) yield* walkSnapshots(child);
}

function isWritableNode(node: Node<unknown>): node is WritableNode<unknown> {
	return typeof (node as { set?: unknown }).set === "function";
}
