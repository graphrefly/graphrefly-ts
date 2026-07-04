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
export type BoundaryCapabilityKind = "auth" | "permission" | "config" | "resource";

export interface BoundaryCapabilityRef {
	id: string;
	kind: BoundaryCapabilityKind;
	required: boolean;
	sourceRefs?: readonly string[];
}

export interface BaseBoundaryNode {
	/** Registered graph node id/path. */
	name: string;
	/** Structural boundary role inferred from current describe() topology. */
	role: BoundaryRole;
	/** describe() factory: "state" | "producer" | "derived" | operator real name. */
	type: string;
	/** Live handle for framework adapters such as useNodeInput/useNodeValue. */
	node: Node<unknown>;
	/**
	 * D348 generic capability refs only. Product/OAuth/config-form semantics stay in trusted
	 * React/Canvas/product registries and do not affect structural boundary role inference.
	 */
	capabilities?: readonly BoundaryCapabilityRef[];
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
 * @param graph - Graph that owns the created nodes or projector.
 * @returns A `BoundaryManifest` value.
 * @category inspection
 * @example
 * ```ts
 * import { boundaryManifest } from "@graphrefly/ts/inspection/boundary";
 * ```
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
			const capabilities = boundaryCapabilities(entry.meta);
			const isSource = (entry.deps?.length ?? 0) === 0;
			const base =
				capabilities === undefined
					? { name: entry.id, type: entry.factory, node }
					: { name: entry.id, type: entry.factory, node, capabilities };
			if (isSource && isWritableNode(node)) {
				inputs.push({ ...base, role: "input", node });
			} else if (!consumed.has(entry.id)) {
				outputs.push({ ...base, role: "output" });
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

function boundaryCapabilities(
	meta: Record<string, unknown> | undefined,
): BoundaryCapabilityRef[] | undefined {
	const raw = meta?.boundaryCapabilities;
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) return undefined;
	const refs: BoundaryCapabilityRef[] = [];
	for (const item of raw) {
		const ref = boundaryCapabilityRef(item);
		if (ref !== undefined) refs.push(ref);
	}
	return refs.length === 0 ? undefined : refs;
}

function boundaryCapabilityRef(value: unknown): BoundaryCapabilityRef | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (!Object.keys(record).every(isBoundaryCapabilityRefKey)) return undefined;
	if (typeof record.id !== "string" || !isBoundaryCapabilityKind(record.kind)) return undefined;
	if (typeof record.required !== "boolean") return undefined;
	const sourceRefs = stringArray(record.sourceRefs);
	if (record.sourceRefs !== undefined && sourceRefs === undefined) return undefined;
	return {
		id: record.id,
		kind: record.kind,
		required: record.required,
		...(sourceRefs === undefined ? {} : { sourceRefs }),
	};
}

function isBoundaryCapabilityKind(value: unknown): value is BoundaryCapabilityKind {
	return value === "auth" || value === "permission" || value === "config" || value === "resource";
}

function isBoundaryCapabilityRefKey(value: string): value is keyof BoundaryCapabilityRef {
	return value === "id" || value === "kind" || value === "required" || value === "sourceRefs";
}

function stringArray(value: unknown): readonly string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return undefined;
	return value;
}
