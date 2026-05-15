/**
 * `graphSpecToMermaid(g, opts?)` — render a {@link GraphDescribeOutput} as
 * Mermaid flowchart text.
 *
 * Pure function over the describe snapshot; no Graph instance dependency.
 * Compose with `derived` for live formatted output:
 *
 * ```ts
 * import { graphSpecToMermaid } from "@graphrefly/graphrefly/extra/render";
 * import { derived } from "@graphrefly/graphrefly";
 *
 * const live = derived(
 *   [graph.describe({ reactive: true }).node],
 *   ([g]) => graphSpecToMermaid(g),
 * );
 * ```
 *
 * @category extra
 */

import type { GraphDescribeOutput } from "@graphrefly/pure-ts/graph/graph.js";
import {
	collectDiagramArrows,
	type DiagramDirection,
	escapeMermaidLabel,
	normalizeDiagramDirection,
} from "./_internal.js";

export type GraphSpecToMermaidOptions = {
	/** Diagram direction; default `"LR"`. */
	direction?: DiagramDirection;
};

export function graphSpecToMermaid(
	g: GraphDescribeOutput,
	opts?: GraphSpecToMermaidOptions,
): string {
	const direction = normalizeDiagramDirection(opts?.direction);
	const paths = Object.keys(g.nodes).sort();
	const ids = new Map<string, string>();
	for (let i = 0; i < paths.length; i += 1) ids.set(paths[i]!, `n${i}`);
	const lines: string[] = [`flowchart ${direction}`];
	for (const path of paths) {
		const id = ids.get(path)!;
		lines.push(`  ${id}["${escapeMermaidLabel(path)}"]`);
	}
	for (const [from, to] of collectDiagramArrows(g)) {
		const fromId = ids.get(from);
		const toId = ids.get(to);
		if (!fromId || !toId) continue;
		lines.push(`  ${fromId} --> ${toId}`);
	}
	return lines.join("\n");
}
