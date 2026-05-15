/**
 * Graph profiling and inspection utilities.
 *
 * Provides per-node memory estimation, connectivity stats, and hotspot
 * detection. Non-invasive — reads from `describe()` and node internals
 * without modifying state.
 *
 * @module
 */

import { sizeof } from "../core/_internal/sizeof.js";
import { type Node, NodeImpl } from "../core/node.js";
import type { Graph, GraphDescribeOutput } from "./graph.js";

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
	/**
	 * True if this is an effect node with no external subscribers — a classic
	 * leak pattern. See {@link GraphProfileResult.orphans} for the broader
	 * orphan-node detection across `derived` / `producer` / `effect`.
	 */
	isOrphanEffect: boolean;
	/**
	 * Orphan category (batch 8 Unit 13 D). `null` when the node is healthy.
	 * - `"orphan-effect"` — effect with zero subscribers (pre-existing class).
	 * - `"idle-derived"` — derived with zero subscribers (wasted compute path
	 *   if it ever activates; may indicate a factory forgot keepalive).
	 * - `"idle-producer"` — producer with zero subscribers (no external
	 *   consumer; may be an over-eager factory or forgotten cleanup).
	 */
	orphanKind: "orphan-effect" | "idle-derived" | "idle-producer" | null;
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
	/**
	 * Top-N hotspots by dimension. Each list is sorted descending. See
	 * {@link GraphProfileOptions.topN} for the cap (default 10).
	 */
	hotspots: {
		byValueSize: NodeProfile[];
		bySubscriberCount: NodeProfile[];
		byDepCount: NodeProfile[];
	};
	/**
	 * Every orphan across types — `effect`, `derived`, `producer` with zero
	 * subscribers. See {@link NodeProfile.orphanKind} for category.
	 */
	orphans: NodeProfile[];
	/** Effect nodes with no external subscribers (legacy; subset of `orphans`). */
	orphanEffects: NodeProfile[];
}

/** Options for {@link graphProfile}. */
export interface GraphProfileOptions {
	/** Limit hotspot list (default 10). */
	topN?: number;
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
 * @returns Aggregate profile with per-node details, hotspots (multi-dim), and orphans.
 */
export function graphProfile(graph: Graph, opts?: GraphProfileOptions): GraphProfileResult {
	const topN = opts?.topN ?? 10;

	const desc: GraphDescribeOutput = graph.describe({ detail: "standard" });

	// Build path→Node lookup via _collectObserveTargets (same as describe uses).
	// Runtime guard: if the internal method is missing (refactored), degrade
	// gracefully — profiles will show 0 for valueSizeBytes and subscriberCount.
	const targets: [string, Node][] = [];
	const collector = (
		graph as unknown as { _collectObserveTargets?: (prefix: string, out: [string, Node][]) => void }
	)._collectObserveTargets;
	if (typeof collector === "function") {
		collector.call(graph, "", targets);
	}
	const pathToNode = new Map<string, Node>();
	for (const [p, n] of targets) pathToNode.set(p, n);

	const profiles: NodeProfile[] = [];

	for (const [path, nodeDesc] of Object.entries(desc.nodes)) {
		const nd = pathToNode.get(path);
		const impl = nd instanceof NodeImpl ? nd : null;

		const valueSizeBytes = impl ? sizeof(impl.cache) : 0;
		const subscriberCount = impl ? impl._sinkCount : 0;
		const depCount = nodeDesc.deps?.length ?? 0;

		const isOrphanEffect = nodeDesc.type === "effect" && subscriberCount === 0;
		const orphanKind: NodeProfile["orphanKind"] =
			subscriberCount === 0
				? nodeDesc.type === "effect"
					? "orphan-effect"
					: nodeDesc.type === "derived"
						? "idle-derived"
						: nodeDesc.type === "producer"
							? "idle-producer"
							: null
				: null;

		profiles.push({
			path,
			type: nodeDesc.type,
			status: nodeDesc.status ?? "unknown",
			valueSizeBytes,
			subscriberCount,
			depCount,
			isOrphanEffect,
			orphanKind,
		});
	}

	const totalValueSizeBytes = profiles.reduce((sum, p) => sum + p.valueSizeBytes, 0);

	const topBy = <K extends keyof NodeProfile>(
		key: K,
		cmp?: (a: NodeProfile, b: NodeProfile) => number,
	): NodeProfile[] =>
		[...profiles].sort(cmp ?? ((a, b) => (b[key] as number) - (a[key] as number))).slice(0, topN);

	const orphans = profiles.filter((p) => p.orphanKind != null);
	const orphanEffects = profiles.filter((p) => p.isOrphanEffect);

	return {
		nodeCount: profiles.length,
		edgeCount: desc.edges.length,
		subgraphCount: desc.subgraphs.length,
		nodes: profiles,
		totalValueSizeBytes,
		hotspots: {
			byValueSize: topBy("valueSizeBytes"),
			bySubscriberCount: topBy("subscriberCount"),
			byDepCount: topBy("depCount"),
		},
		orphans,
		orphanEffects,
	};
}
