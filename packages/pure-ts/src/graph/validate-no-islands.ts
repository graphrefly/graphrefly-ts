/**
 * Topology check: detect "island" nodes with no in-edges AND no out-edges.
 *
 * Companion to {@link validateGraphObservability} for user validation. Catches
 * the kind of disconnected-node smell flagged in the pagerduty-demo audit
 * ("decisions/log not linked to any other nodes", "tokens only by itself") —
 * the visible symptom of imperative writes or closure-held state that bypassed
 * the reactive edge graph.
 *
 * **What counts as an island.** A node is an island when:
 *   - it has zero declared deps (zero **in-edges**), AND
 *   - no other node in the graph declares it as a dep (zero **out-edges**).
 *
 * Source nodes (producers / state nodes that act as roots) typically have zero
 * in-edges but ≥1 out-edge — those are NOT islands. Sink nodes (effects that
 * terminate a chain) have ≥1 in-edge but zero out-edges — also NOT islands.
 * Only nodes that satisfy BOTH conditions are reported.
 *
 * **Sub-graph paths.** When the graph mounts subgraphs, the check walks the
 * full path-qualified node table from `graph.describe({ detail: "minimal" })`
 * — both top-level and mounted children participate.
 *
 * **False-positive caveat (D7 /qa lock).** A `state(0, { name: "metric" })`
 * whose only consumer is an external (non-graph) subscriber — e.g. a React /
 * Vue / CLI subscription that calls `.subscribe(...)` directly — looks like
 * an island from `describe()`'s perspective: zero declared in-edges, and no
 * other node lists it as a dep. The check WILL flag it. Treat
 * `validateNoIslands` as a smell-detector, not a definitive correctness gate;
 * complement with `graph.observe(...)` instrumentation when external
 * consumers are part of the design. If you have known external-consumer
 * roots, filter them from `result.orphans` before deciding what to act on.
 *
 * **Synthetic `__internal__/` paths (EH-9).** Compound factories sometimes
 * surface unnamed helper nodes under the `__internal__/` namespace
 * (auto-generated when a producer / derived is added without a `name` and
 * the registrar falls back to a synthetic prefix). These never represent
 * user-authored topology and should not surface as actionable orphans;
 * `validateNoIslands` filters them out before reporting. If a real factory
 * regression accidentally leaks a user-meaningful node under this prefix,
 * the fix is to give the node a real name — not to remove the filter.
 *
 * **Non-throwing by default.** Returns a structured result so callers
 * (dry-run blocks, CI smoke tests) can exit non-zero with a diagnostic
 * instead of crashing.
 *
 * @module
 */

import type { Graph } from "./graph.js";

/** A reported island node, surfacing both path and node kind for triage. */
export interface IslandReport {
	/** Path-qualified node name (mounted children included). */
	readonly path: string;
	/** `describe()` node `type` — `"state"` / `"derived"` / `"effect"` etc. Helps distinguish "forgot to wire" from "compositional bug". */
	readonly kind: string;
}

/** Result returned by {@link validateNoIslands}. */
export interface ValidateNoIslandsResult {
	/** `true` when the graph has zero island nodes. */
	readonly ok: boolean;
	/**
	 * Path-qualified names + kinds of nodes that are both zero-in and
	 * zero-out. Sorted ASCII-asc by `path` for deterministic output.
	 */
	readonly orphans: readonly IslandReport[];
	/** Single-line summary suitable for `process.stderr`. */
	summary(): string;
}

/**
 * Walk the graph's describe output and report island nodes (zero in + zero out edges).
 *
 * @example
 * ```ts
 * const result = validateNoIslands(graph);
 * if (!result.ok) {
 *   console.error(result.summary());
 *   for (const o of result.orphans) console.error(`  - ${o.path} (${o.kind})`);
 *   process.exit(3);
 * }
 * ```
 */
export function validateNoIslands(graph: Graph): ValidateNoIslandsResult {
	const desc = graph.describe({ detail: "minimal" });
	const allPaths = Object.keys(desc.nodes);

	// Build the set of paths that appear as a dep on at least one OTHER node —
	// i.e. paths that have ≥1 incoming edge from the perspective of the
	// dep-pointer. (`deps` on node X means X receives DATA FROM each entry;
	// each entry's referenced path therefore has an out-edge into X.)
	const referencedAsDep = new Set<string>();
	for (const path of allPaths) {
		const entry = desc.nodes[path];
		if (!entry) continue;
		const deps = (entry.deps as readonly string[] | undefined) ?? [];
		for (const dep of deps) {
			referencedAsDep.add(dep);
		}
	}

	const orphans: IslandReport[] = [];
	for (const path of allPaths) {
		const entry = desc.nodes[path];
		if (!entry) continue;
		// EH-9: synthetic `__internal__/` paths are factory bookkeeping, not
		// user topology. Suppress before edge-counting so they never surface.
		if (path.startsWith("__internal__/")) continue;
		const deps = (entry.deps as readonly string[] | undefined) ?? [];
		const inEdges = deps.length;
		// `hasOutEdge` is a 0/1 indicator (not a count) — `validateNoIslands`
		// only needs the boolean answer to "does any other node depend on
		// this path?".
		const hasOutEdge = referencedAsDep.has(path);
		if (inEdges === 0 && !hasOutEdge) {
			const kind = (entry.type as string | undefined) ?? "unknown";
			orphans.push({ path, kind });
		}
	}

	orphans.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

	return {
		ok: orphans.length === 0,
		orphans,
		summary(): string {
			if (orphans.length === 0) return "validateNoIslands: ok (no islands)";
			const head = orphans
				.slice(0, 3)
				.map((o) => `${o.path} (${o.kind})`)
				.join(", ");
			return `validateNoIslands: ${orphans.length} island node(s) — ${head}${orphans.length > 3 ? ", …" : ""}`;
		},
	};
}
