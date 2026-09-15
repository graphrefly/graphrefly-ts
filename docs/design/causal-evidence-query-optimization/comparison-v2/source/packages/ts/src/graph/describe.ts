/**
 * topology()/describe() snapshot shapes (R-describe / D39 / D51 / D173).
 *
 * topology() is the current pure-structure snapshot direction (D173). describe()
 * remains the richer developer inspection snapshot over the same live topology
 * truth source, adding runtime status/value/version fields.
 */

import type { Status } from "../node/node.js";
import type { NodeVersion } from "../node/versioning.js";

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

export interface DescribeNode extends GraphTopologyNode {
	/** R-status-enum (7). */
	status: Status;
	/** Cache snapshot at call time; field ABSENT = SENTINEL / never-emitted. */
	value?: unknown;
	/** D109 node runtime version metadata; absent when versioning:false. */
	version?: NodeVersion;
}

export interface DescribeEdge extends GraphTopologyEdge {}

export interface DescribeSnapshot extends GraphTopologySnapshot {
	name?: string;
	nodes: DescribeNode[];
	edges: DescribeEdge[];
	subgraphs?: DescribeSnapshot[];
}

export interface DescribeOpts {
	/** Causal-chain mode: filter to nodes on a path from→to (R-describe). */
	explain?: { from: string; to: string };
}

/** Project a rich describe snapshot into the D173 pure-structure topology shape. */
export function topologyFromDescribe(snapshot: DescribeSnapshot): GraphTopologySnapshot {
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
	if (snapshot.subgraphs !== undefined)
		out.subgraphs = snapshot.subgraphs.map(topologyFromDescribe);
	return out;
}

function cloneTopologyMeta(meta: Record<string, unknown>): Record<string, unknown> {
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
