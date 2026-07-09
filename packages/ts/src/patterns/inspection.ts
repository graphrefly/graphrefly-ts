/**
 * Horizontal inspection patterns re-derived from old presets (B62 / D125).
 *
 * These helpers compose GraphReFly graph inspection egresses. They do not
 * add graph nodes, hidden subscriptions, policy gates, or storage ownership.
 */

import type { Graph } from "../graph/graph.js";
import type { NodeProfile } from "../graph/inspect.js";

export interface ProfileSummaryNode {
	path: string;
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
	status: NodeProfile["status"];
}

export interface ProfileSummary {
	/** Number of nodes in describe(), including nodes with zero invokes. */
	nodeCount: number;
	totalInvokes: number;
	byStatus: Partial<Record<NodeProfile["status"], number>>;
	/** Nodes sorted by invokes desc, then path asc. */
	hotNodes: ProfileSummaryNode[];
}

/**
 * Summarize an opt-in Graph.profile() snapshot while keeping describe() as the
 * source of node cardinality. No counters are stored on nodes (R-profile).
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A `ProfileSummary` value.
 * @category patterns
 * @example
 * ```ts
 * import { profileSummary } from "@graphrefly/ts/patterns";
 * ```
 */
export function profileSummary(graph: Graph, opts: { limit?: number } = {}): ProfileSummary {
	const profile = graph.profile();
	const described = graph.describe();
	const nodeIds = new Set(described.nodes.map((node) => node.id));
	for (const id of Object.keys(profile.nodes)) nodeIds.add(id);

	const byStatus: Partial<Record<NodeProfile["status"], number>> = {};
	const hotNodes: ProfileSummaryNode[] = [];
	for (const path of [...nodeIds].sort()) {
		const nodeProfile = profile.nodes[path];
		if (nodeProfile === undefined) continue;
		byStatus[nodeProfile.status] = (byStatus[nodeProfile.status] ?? 0) + 1;
		hotNodes.push({
			path,
			invokes: nodeProfile.invokes,
			totalDurationNs: nodeProfile.totalDurationNs,
			lastDurationNs: nodeProfile.lastDurationNs,
			status: nodeProfile.status,
		});
	}
	hotNodes.sort((a, b) => b.invokes - a.invokes || a.path.localeCompare(b.path));
	return {
		nodeCount: nodeIds.size,
		totalInvokes: profile.totalInvokes,
		byStatus,
		hotNodes: hotNodes.slice(0, opts.limit ?? hotNodes.length),
	};
}
