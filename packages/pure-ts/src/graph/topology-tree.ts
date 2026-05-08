/**
 * Transitive structural-change subscription helper.
 *
 * Subscribes to a graph's {@link Graph.topology} event stream AND recurses
 * into every mounted subgraph, auto-wiring new mounts when they appear
 * (via parent `added: mount` events) and tearing down subscriptions for
 * unmounted subgraphs (via `removed: mount` events + the audit record).
 *
 * Lives in `graph/` rather than `patterns/` because it depends only on
 * the `Graph` primitive and the `TopologyEvent` type — no domain-layer
 * factories. Consumers that need full-tree dynamic coverage (e.g.
 * `policyGate`, `graphLens`) import from here to avoid circular
 * references between audit/lens modules.
 *
 * @module
 */
import { DATA } from "../core/messages.js";
import type { TopologyEvent } from "./graph.js";
import { Graph } from "./graph.js";

/**
 * Subscribe to structural changes across `graph` and every transitively
 * mounted subgraph. `cb` fires on every {@link TopologyEvent} from any
 * graph in the tree. Newly-mounted subgraphs are auto-wired when their
 * parent emits `{kind: "added", nodeKind: "mount"}`; newly-unmounted
 * subgraphs' subscriptions are disposed via the parent's
 * `{kind: "removed", nodeKind: "mount"}` event plus the returned
 * `GraphRemoveAudit`.
 *
 * The callback receives a third argument `prefix`: the `::`-delimited
 * path from the root watched graph to the emitter, ending with `"::"`
 * (empty string when the event comes from the root itself). Compute
 * a qualified path for an added/removed entry as `prefix + event.name`.
 *
 * @param graph - Root graph to watch.
 * @param cb - Receives `(event, emitterGraph, prefix)`.
 * @returns Dispose function — tears down every active subscription.
 *
 * @category observability
 */
export function watchTopologyTree(
	graph: Graph,
	cb: (event: TopologyEvent, emitter: Graph, prefix: string) => void,
): () => void {
	// Tracks every wired graph with its qualified prefix (path from root).
	// Prefix is used for both qualified-path emission to `cb` AND prefix-match
	// disposal when a mount is removed — more robust than relying on
	// `_parent == null` which only nulls on the direct child, not on
	// grandchildren within an unmounted subtree.
	type Entry = { off: () => void; prefix: string };
	const subs = new Map<Graph, Entry>();

	const wire = (g: Graph, prefix: string): void => {
		if (subs.has(g)) return;
		// Placeholder entry set BEFORE subscribe so any synchronous reentry
		// (e.g. a mount-added handler firing during subscribe's initial push)
		// sees this graph as already wired and skips rewiring.
		const placeholder: Entry = { off: () => {}, prefix };
		subs.set(g, placeholder);
		const off = g.topology.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const event = m[1] as TopologyEvent;
				cb(event, g, prefix);
				if (event.kind === "added" && event.nodeKind === "mount") {
					const child = g._mounts.get(event.name);
					if (child instanceof Graph) {
						const childPrefix = `${prefix}${event.name}::`;
						wire(child, childPrefix);
					}
				} else if (event.kind === "removed" && event.nodeKind === "mount") {
					// Dispose every tracked sub whose prefix is under the removed
					// mount. Matches on qualified-prefix rather than `_parent`
					// so deep descendants are released even when their parent
					// pointers haven't been nulled.
					const removedPrefix = `${prefix}${event.name}::`;
					for (const [trackedGraph, trackedEntry] of Array.from(subs.entries())) {
						if (trackedGraph === graph) continue;
						if (trackedEntry.prefix.startsWith(removedPrefix)) {
							trackedEntry.off();
							subs.delete(trackedGraph);
						}
					}
				}
			}
		});
		placeholder.off = off;
		// Recursively wire any children already mounted when this call runs.
		for (const [mountName, child] of g._mounts) {
			if (child instanceof Graph) {
				const childPrefix = `${prefix}${mountName}::`;
				wire(child, childPrefix);
			}
		}
	};

	wire(graph, "");

	return () => {
		for (const entry of subs.values()) entry.off();
		subs.clear();
	};
}
