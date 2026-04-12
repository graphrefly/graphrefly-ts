/**
 * Graph profiling and inspection utilities.
 *
 * Provides per-node memory estimation, connectivity stats, and hotspot
 * detection. Non-invasive — reads from `describe()` and node internals
 * without modifying state.
 *
 * @module
 */

import { NodeImpl } from "../core/node.js";
import type { Graph, GraphDescribeOutput } from "./graph.js";
import { sizeof } from "./sizeof.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-node profile entry. */
export interface NodeProfile {
	/** Qualified path within the graph. */
	path: string;
	/** Node type (state, derived, producer, effect). */
	type: string;
	/** Node status (disconnected, dirty, settled, errored, completed). */
	status: string;
	/** Approximate retained bytes for the node's cached value. */
	valueSizeBytes: number;
	/** Number of downstream subscribers (sinks). */
	subscriberCount: number;
	/** Number of upstream dependencies. */
	depCount: number;
	/** True if this is an effect node with no external subscribers (potential leak). */
	isOrphanEffect: boolean;
}

/** Aggregate graph profile. */
export interface GraphProfileResult {
	/** Total node count. */
	nodeCount: number;
	/** Total edge count. */
	edgeCount: number;
	/** Subgraph count. */
	subgraphCount: number;
	/** All node profiles. */
	nodes: NodeProfile[];
	/** Total approximate value memory across all nodes. */
	totalValueSizeBytes: number;
	/** Nodes sorted by valueSizeBytes descending (top N). */
	hotspots: NodeProfile[];
	/** Effect nodes with no external subscribers (potential leaks). */
	orphanEffects: NodeProfile[];
}

/** Options for {@link graphProfile}. */
export interface GraphProfileOptions {
	/** Limit hotspot list (default 10). */
	topN?: number;
	/** Include subgraph nodes recursively (default true). */
	recursive?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Profile a graph's memory and connectivity characteristics.
 *
 * Uses `describe({ detail: "standard" })` for node metadata and direct
 * `NodeImpl` access for subscriber counts and cached values.
 *
 * @param graph - The graph to profile.
 * @param opts - Optional configuration.
 * @returns Aggregate profile with per-node details and hotspots.
 */
export function graphProfile(graph: Graph, opts?: GraphProfileOptions): GraphProfileResult {
	const topN = opts?.topN ?? 10;

	const desc: GraphDescribeOutput = graph.describe({ detail: "standard" });

	// Build path→Node lookup via _collectObserveTargets (same as describe uses).
	// Runtime guard: if the internal method is missing (refactored), degrade
	// gracefully — profiles will show 0 for valueSizeBytes and subscriberCount.
	const targets: [string, import("../core/node.js").Node][] = [];
	if (typeof (graph as any)._collectObserveTargets === "function") {
		(graph as any)._collectObserveTargets("", targets);
	}
	const pathToNode = new Map<string, import("../core/node.js").Node>();
	for (const [p, n] of targets) {
		pathToNode.set(p, n);
	}

	const profiles: NodeProfile[] = [];

	for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
		const nd = pathToNode.get(path);
		const impl = nd instanceof NodeImpl ? nd : null;

		const valueSizeBytes = impl ? sizeof(impl.cache) : 0;
		const subscriberCount = impl ? impl._sinkCount : 0;
		const depCount = nodeDesc.deps?.length ?? 0;

		const isOrphanEffect = nodeDesc.type === "effect" && subscriberCount === 0;

		profiles.push({
			path,
			type: nodeDesc.type,
			status: nodeDesc.status ?? "unknown",
			valueSizeBytes,
			subscriberCount,
			depCount,
			isOrphanEffect,
		});
	}

	const totalValueSizeBytes = profiles.reduce((sum, p) => sum + p.valueSizeBytes, 0);

	const hotspots = [...profiles].sort((a, b) => b.valueSizeBytes - a.valueSizeBytes).slice(0, topN);

	const orphanEffects = profiles.filter((p) => p.isOrphanEffect);

	return {
		nodeCount: profiles.length,
		edgeCount: desc.edges.length,
		subgraphCount: desc.subgraphs.length,
		nodes: profiles,
		totalValueSizeBytes,
		hotspots,
		orphanEffects,
	};
}
