/**
 * Graph description and module presentation shapes.
 *
 * describe() is R-graph-surface@2's topology as data: exactly `{ id, kind, deps, quiet }` per
 * node. renderSnapshot(graph) is this package's richer snapshot over the same live dependencies (names,
 * factories, status, values, annotations, edges and mounted subgraphs, graphrefly-ts:D183), and
 * topology() its pure-structure projection (D173).
 */

import type { Status } from "../node/node.js";

/** One node of describe() (R-graph-surface@2), and nothing else. */
export interface DescribedNode {
	/** The node's id in this graph. */
	id: string;
	/** A state (no dependencies and no function, R-node) or any other node. */
	kind: "state" | "node";
	/** The current dependencies' ids, a ctx.rewire's included. */
	deps: string[];
	/** Whether the node's output is quiet (R-node). */
	quiet: boolean;
}

export interface GraphTopologyNode {
	/** Stable mount-aware `::` path (auto-numbered when unnamed). Edge key. */
	id: string;
	/** Optional debug name. */
	name?: string;
	/** Operator/verb real name (D6/L1.5 — "map"/"state", not "derived"). */
	factory: string;
	/** Dep ids (R-edges-derived: edges are a pure fn of live deps). */
	deps: string[];
	/** Static annotations attached via g.* opts (R-meta-presentation). */
	meta?: Record<string, unknown>;
}

export interface GraphTopologyEdge {
	from: string;
	to: string;
}

export interface GraphTopologySnapshot {
	/** Graph-owned identity of this snapshot at its parent mount; absent on the root. */
	mountId?: string;
	name?: string;
	nodes: GraphTopologyNode[];
	edges: GraphTopologyEdge[];
	subgraphs?: GraphTopologySnapshot[];
}

export interface RenderNode extends GraphTopologyNode {
	/** The node's derived status: cache, output and lifecycle (R-node). */
	status: Status;
	/** Cache snapshot at call time; field ABSENT = SENTINEL / never-emitted. */
	value?: unknown;
}

export interface RenderEdge extends GraphTopologyEdge {}

export interface RenderSnapshot extends GraphTopologySnapshot {
	name?: string;
	nodes: RenderNode[];
	edges: RenderEdge[];
	subgraphs?: RenderSnapshot[];
}

export interface RenderOpts {
	/** Causal-chain mode: filter to nodes on a path from→to (graphrefly-ts:D183). */
	explain?: { from: string; to: string };
}

/** Project a render snapshot into the D173 pure-structure topology shape. */
export function topologyFromRender(snapshot: RenderSnapshot): GraphTopologySnapshot {
	const nodes = snapshot.nodes.map((node) => {
		const topologyNode: GraphTopologyNode = {
			id: node.id,
			factory: node.factory,
			deps: [...node.deps],
		};
		if (node.name !== undefined) topologyNode.name = node.name;
		if (node.meta !== undefined) topologyNode.meta = cloneTopologyMeta(node.meta);
		return topologyNode;
	});
	const out: GraphTopologySnapshot = {
		nodes,
		edges: snapshot.edges.map((edge) => ({ from: edge.from, to: edge.to })),
	};
	if (snapshot.mountId !== undefined) out.mountId = snapshot.mountId;
	if (snapshot.name !== undefined) out.name = snapshot.name;
	if (snapshot.subgraphs !== undefined) out.subgraphs = snapshot.subgraphs.map(topologyFromRender);
	return out;
}

/** Copy metadata for a detached presentation snapshot. */
export function cloneTopologyMeta(meta: Record<string, unknown>): Record<string, unknown> {
	return cloneTopologyValue(meta, new WeakMap()) as Record<string, unknown>;
}

function cloneTopologyValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
	if (value === null) return null;
	const kind = typeof value;
	if (kind === "string" || kind === "boolean") return value;
	if (kind === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("topology(): meta must be finite JSON-compatible data (D39/D173)");
		}
		return value;
	}
	if (kind !== "object") {
		throw new Error("topology(): meta must be JSON-compatible data (D39/D173)");
	}
	const objectValue = value as object;
	const cached = seen.get(objectValue);
	if (cached !== undefined) return cached;
	if (Array.isArray(value)) {
		const out = new Array<unknown>(value.length);
		seen.set(objectValue, out);
		for (let i = 0; i < value.length; i += 1) {
			if (!(i in value)) {
				throw new Error("topology(): meta arrays must be dense JSON-compatible data (D39/D173)");
			}
			out[i] = cloneTopologyValue(value[i], seen);
		}
		return out;
	}
	const proto = Object.getPrototypeOf(objectValue);
	if (proto !== Object.prototype && proto !== null) {
		throw new Error("topology(): meta must be plain JSON-compatible data (D39/D173)");
	}
	const out: Record<string, unknown> = {};
	seen.set(objectValue, out);
	for (const [key, item] of Object.entries(value as Record<string, unknown>))
		out[key] = cloneTopologyValue(item, seen);
	return out;
}
