/**
 * `graphSpecToJson(g, opts?)` — render a {@link GraphDescribeOutput} as
 * deterministic JSON text with sorted keys.
 *
 * Pure function over the describe snapshot; no Graph instance dependency.
 *
 * @category extra
 */

import type { GraphDescribeOutput } from "@graphrefly/pure-ts/graph";
import { sortJsonValue } from "./_internal.js";

export type GraphSpecToJsonOptions = {
	/** Include the Edges section (default `true`). */
	includeEdges?: boolean;
	/** Include the Subgraphs section (default `true`). */
	includeSubgraphs?: boolean;
	/** JSON indent (default `2`). */
	indent?: number;
	/** Optional logger hook; fires with the rendered text before return. */
	logger?: (text: string) => void;
};

export function graphSpecToJson(g: GraphDescribeOutput, opts?: GraphSpecToJsonOptions): string {
	const includeEdges = opts?.includeEdges ?? true;
	const includeSubgraphs = opts?.includeSubgraphs ?? true;
	const { expand: _expand, ...rest } = g;
	const payload: GraphDescribeOutput = {
		...rest,
		edges: includeEdges ? g.edges : [],
		subgraphs: includeSubgraphs ? g.subgraphs : [],
	};
	const text = JSON.stringify(sortJsonValue(payload), null, opts?.indent ?? 2);
	opts?.logger?.(text);
	return text;
}
