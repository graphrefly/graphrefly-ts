/**
 * `graphSpecToD2(g, opts?)` — render a {@link GraphDescribeOutput} as D2
 * diagram text.
 *
 * Pure function over the describe snapshot; no Graph instance dependency.
 *
 * @category extra
 */

import type { GraphDescribeOutput } from "@graphrefly/pure-ts/graph/graph.js";
import {
	collectDiagramArrows,
	type DiagramDirection,
	d2DirectionFromGraphDirection,
	escapeD2Label,
	normalizeDiagramDirection,
} from "./_internal.js";

export type GraphSpecToD2Options = {
	/** Diagram direction; default `"LR"`. */
	direction?: DiagramDirection;
};

export function graphSpecToD2(g: GraphDescribeOutput, opts?: GraphSpecToD2Options): string {
	const direction = normalizeDiagramDirection(opts?.direction);
	const paths = Object.keys(g.nodes).sort();
	const ids = new Map<string, string>();
	for (let i = 0; i < paths.length; i += 1) ids.set(paths[i]!, `n${i}`);
	const lines: string[] = [`direction: ${d2DirectionFromGraphDirection(direction)}`];
	for (const path of paths) {
		const id = ids.get(path)!;
		lines.push(`${id}: "${escapeD2Label(path)}"`);
	}
	for (const [from, to] of collectDiagramArrows(g)) {
		const fromId = ids.get(from);
		const toId = ids.get(to);
		if (!fromId || !toId) continue;
		lines.push(`${fromId} -> ${toId}`);
	}
	return lines.join("\n");
}
