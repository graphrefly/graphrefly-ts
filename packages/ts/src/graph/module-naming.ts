import { assertLocalName } from "../node/naming.js";
import type { Graph } from "./graph.js";
import { graphRegistrations } from "./graph-lifecycle.js";

/** Internal module scopes preserve caller names and allocate collision-free defaults. */
export function moduleName(graph: Graph, name: string | undefined, prefix: string): string {
	assertLocalName(name);
	if (name !== undefined) return name;
	const registrar = graphRegistrations.get(graph);
	if (registrar === undefined) throw new Error("module name: graph lifecycle unavailable");
	return registrar.allocateModuleName(prefix);
}
