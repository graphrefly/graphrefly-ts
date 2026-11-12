import { canonicalTupleKey } from "../identity.js";
import type { RenderChangeset, RenderEvent } from "./composition.js";
import type { RenderEdge, RenderNode, RenderSnapshot } from "./describe.js";
import type { Graph } from "./graph.js";
import { graphRegistrations } from "./graph-lifecycle.js";
import {
	GraphTopologyGroup,
	type TopologyGroup,
	type TopologyGroupOptions,
} from "./graph-topology-group.js";

/**
 * Read the graph name supplied at construction, from its existing registrar.
 * @param graph - Graph whose construction name is read.
 * @returns The optional graph name.
 * @example
 * ```ts
 * const g = graph({ name: "orders" });
 * topology.name(g); // "orders"
 * ```
 * @category graph
 */
export function name(graph: Graph): string | undefined {
	return graphRegistrations.get(graph)!.name;
}

/**
 * Embed a child graph under a stable mount path for topology, rendering and checkpoints.
 * This package module operation uses the existing mount records (D189); it does not connect
 * graph execution domains. Duplicate sibling paths and empty paths are refused.
 * @param parent - Graph that owns the mount record.
 * @param child - Child graph to mount.
 * @param at - Non-empty path unique among the parent's mounts.
 * @returns Nothing; updates the existing mount records.
 * @example
 * ```ts
 * const parent = graph(), child = graph({ name: "orders" });
 * topology.mount(parent, child, "orders");
 * ```
 * @category graph
 */
export function mount(parent: Graph, child: Graph, at: string): void {
	graphRegistrations.get(parent)!.mount(child, { at });
}

/**
 * Create a graph-owned release group without activating its members.
 * @param graph - Graph that owns every member node.
 * @param opts - Optional diagnostic group name.
 * @returns A group for quiescent release of its graph-registered members.
 * @example
 * ```ts
 * const g = graph();
 * const tasks = topology.group(g, { name: "tasks" });
 * tasks.state(0);
 * tasks.release();
 * ```
 * @category graph
 */
export function group(graph: Graph, opts: TopologyGroupOptions = {}): TopologyGroup {
	return new GraphTopologyGroup(graph, opts);
}

function metaEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!metaEqual(a[i], b[i])) return false;
		return true;
	}
	const ak = Object.keys(a as Record<string, unknown>).sort();
	const bk = Object.keys(b as Record<string, unknown>).sort();
	if (ak.length !== bk.length) return false;
	for (let i = 0; i < ak.length; i++) {
		if (ak[i] !== bk[i]) return false;
		if (!metaEqual((a as Record<string, unknown>)[ak[i]], (b as Record<string, unknown>)[bk[i]]))
			return false;
	}
	return true;
}

function edgeKey(e: RenderEdge): string {
	return canonicalTupleKey([e.from, e.to]);
}

function cloneNode(n: RenderNode): RenderNode {
	return {
		...n,
		deps: [...n.deps],
		...(n.meta ? { meta: { ...n.meta } } : {}),
	};
}

function flattenSnapshot(snap: RenderSnapshot): {
	nodes: Map<string, RenderNode>;
	edges: Map<string, RenderEdge>;
	subgraphs: Set<string>;
} {
	const nodes = new Map<string, RenderNode>();
	const edges = new Map<string, RenderEdge>();
	const subgraphs = new Set<string>();
	const visit = (s: RenderSnapshot, indexPath = ""): void => {
		for (const n of s.nodes) nodes.set(n.id, n);
		for (const e of s.edges) edges.set(edgeKey(e), e);
		s.subgraphs?.forEach((child, i) => {
			const prefixed = child.nodes.find((n) => n.id.includes("::"))?.id;
			const key =
				prefixed?.slice(0, prefixed.lastIndexOf("::")) ??
				(child.name ? `${indexPath}${child.name}` : `${indexPath}${i}`);
			subgraphs.add(key);
			visit(child, `${key}/`);
		});
	};
	visit(snap);
	return { nodes, edges, subgraphs };
}

/**
 * Compare two `renderSnapshot(graph)` results without subscribing to their graphs.
 * Values and status changes are not topology events; use `graph.observe()` for data.
 * @param prev - prev value used by the helper.
 * @param next - next value used by the helper.
 * @returns A RenderChangeset value for the boundary or adapter.
 * @category graph
 * @example
 * ```ts
 * import { topology } from "@graphrefly/ts";
 * const g = graph();
 * const previous = renderSnapshot(g);
 * g.state(0, { name: "count" });
 * topology.diff(previous, renderSnapshot(g));
 * ```
 */
export function diff(prev: RenderSnapshot, next: RenderSnapshot): RenderChangeset {
	const p = flattenSnapshot(prev);
	const n = flattenSnapshot(next);
	const events: RenderEvent[] = [];

	for (const path of [...n.subgraphs].filter((x) => !p.subgraphs.has(x)).sort())
		events.push({ type: "subgraph-mounted", path });

	for (const id of [...n.nodes.keys()].filter((x) => !p.nodes.has(x)).sort()) {
		events.push({ type: "node-added", id, node: cloneNode(n.nodes.get(id) as RenderNode) });
	}

	for (const id of [...n.nodes.keys()].filter((x) => p.nodes.has(x)).sort()) {
		const prevMeta = p.nodes.get(id)?.meta ?? {};
		const nextMeta = n.nodes.get(id)?.meta ?? {};
		if (!metaEqual(prevMeta, nextMeta)) {
			events.push({
				type: "node-meta-changed",
				id,
				prevMeta: { ...prevMeta },
				nextMeta: { ...nextMeta },
			});
		}
	}

	for (const [k, e] of [...n.edges.entries()].sort()) {
		if (!p.edges.has(k)) events.push({ type: "edge-added", from: e.from, to: e.to });
	}
	for (const [k, e] of [...p.edges.entries()].sort()) {
		if (!n.edges.has(k)) events.push({ type: "edge-removed", from: e.from, to: e.to });
	}

	for (const id of [...p.nodes.keys()].filter((x) => !n.nodes.has(x)).sort())
		events.push({ type: "node-removed", id });

	for (const path of [...p.subgraphs].filter((x) => !n.subgraphs.has(x)).sort())
		events.push({ type: "subgraph-unmounted", path });

	return { events };
}
