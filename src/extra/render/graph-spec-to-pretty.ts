/**
 * `graphSpecToPretty(g, opts?)` — render a {@link GraphDescribeOutput} as
 * human-readable plaintext (Node list with values, plus optional Edges and
 * Subgraphs sections).
 *
 * Pure function over the describe snapshot; no Graph instance dependency.
 *
 * @category extra
 */

import type { GraphDescribeOutput } from "../../graph/graph.js";
import { describeData } from "./_internal.js";

export type GraphSpecToPrettyOptions = {
	/** Include the Edges section (default `true`). */
	includeEdges?: boolean;
	/** Include the Subgraphs section (default `true`). */
	includeSubgraphs?: boolean;
	/** Optional logger hook; fires with the rendered text before return. */
	logger?: (text: string) => void;
};

export function graphSpecToPretty(g: GraphDescribeOutput, opts?: GraphSpecToPrettyOptions): string {
	const includeEdges = opts?.includeEdges ?? true;
	const includeSubgraphs = opts?.includeSubgraphs ?? true;
	const lines: string[] = [];
	lines.push(`Graph ${g.name}`);
	lines.push("Nodes:");
	for (const path of Object.keys(g.nodes).sort()) {
		const n = g.nodes[path]!;
		lines.push(`- ${path} (${n.type}/${n.status}): ${describeData(n.value)}`);
	}
	if (includeEdges) {
		lines.push("Edges:");
		for (const edge of g.edges) {
			lines.push(`- ${edge.from} -> ${edge.to}`);
		}
	}
	if (includeSubgraphs) {
		lines.push("Subgraphs:");
		for (const sg of g.subgraphs) {
			lines.push(`- ${sg}`);
		}
	}
	const text = lines.join("\n");
	opts?.logger?.(text);
	return text;
}
