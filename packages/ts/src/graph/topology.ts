import type { Graph } from "./graph.js";
import { graphRegistrations } from "./graph-lifecycle.js";

/**
 * Read the graph name supplied at construction, from its existing registrar.
 * @example
 * ```ts
 * const g = graph({ name: "orders" });
 * graphName(g); // "orders"
 * ```
 * @category graph
 */
export function graphName(graph: Graph): string | undefined {
	return graphRegistrations.get(graph)!.name;
}

/**
 * Embed a child graph under a stable mount path for topology, rendering and checkpoints.
 * This package module operation uses the existing mount records (D189); it does not connect
 * graph execution domains. Duplicate sibling paths and empty paths are refused.
 * @example
 * ```ts
 * const parent = graph(), child = graph({ name: "orders" });
 * mountGraph(parent, child, { at: "orders" });
 * ```
 * @category graph
 */
export function mountGraph(parent: Graph, child: Graph, opts: { at: string }): void {
	graphRegistrations.get(parent)!.mount(child, opts);
}
