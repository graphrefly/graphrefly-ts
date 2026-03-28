import { type Node, NodeImpl } from "./node.js";

/** JSON-shaped slice of a node for Phase 1 `Graph.describe()` (GRAPHREFLY-SPEC §3.6, Appendix B). */
export type DescribeNodeOutput = {
	type: "state" | "derived" | "producer" | "operator" | "effect";
	status: Node["status"];
	deps: string[];
	meta: Record<string, unknown>;
	name?: string;
	value?: unknown;
};

function inferDescribeType(n: NodeImpl): DescribeNodeOutput["type"] {
	if (!n._hasDeps) return n._fn != null ? "producer" : "state";
	if (n._fn == null) return "derived";
	if (n._manualEmitUsed) return "operator";
	return "derived";
}

/**
 * Reads the current cached value of every companion meta field on a node,
 * suitable for merging into `describe()`-style JSON (GRAPHREFLY-SPEC §2.3, §3.6).
 *
 * @remarks
 * Values come from {@link Node.get}, which returns the **last settled** cache.
 * If a meta field is in `"dirty"` status (DIRTY received, DATA pending), the
 * snapshot contains the *previous* value — check `node.meta[key].status` when
 * freshness matters. Avoid calling mid-batch for the same reason.
 *
 * Meta nodes are **not** terminated when their parent receives COMPLETE or
 * ERROR — they remain writable so callers can record post-mortem metadata
 * (e.g. `meta.error`). They *are* torn down when the parent receives TEARDOWN.
 *
 * @param node - The node whose meta fields to snapshot.
 * @returns Plain object of `{ key: value }` pairs (empty if no meta defined).
 * Keys whose companion node's {@link Node.get} throws are omitted.
 *
 * @example
 * ```ts
 * import { core } from "@graphrefly/graphrefly-ts";
 *
 * const n = core.node({ initial: 0, meta: { tag: "a" } });
 * core.metaSnapshot(n); // { tag: "a" }
 * ```
 */
export function metaSnapshot(node: Node): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(node.meta)) {
		try {
			out[key] = child.get();
		} catch {
			/* omit key — describe tooling still gets other fields */
		}
	}
	return out;
}

/**
 * Single-node slice of `Graph.describe()` JSON (structure + `meta` snapshot).
 * Parity with graphrefly-py `describe_node`.
 *
 * `type` is inferred from factory configuration and the last `manualEmitUsed`
 * hint after the most recent compute run. Pure effect nodes (fn returns
 * `undefined` without `down`/`emit`) may still report `"derived"` until sugar
 * supplies explicit kinds.
 *
 * Nodes not created by {@link node} fall back to `type: "state"` and empty `deps`.
 */
export function describeNode(node: Node): DescribeNodeOutput {
	const meta = metaSnapshot(node);
	let type: DescribeNodeOutput["type"] = "state";
	let deps: string[] = [];

	if (node instanceof NodeImpl) {
		type = inferDescribeType(node);
		deps = node._deps.map((d) => d.name ?? "");
	}

	const out: DescribeNodeOutput = {
		type,
		status: node.status,
		deps,
		meta,
	};

	if (node.name != null) {
		out.name = node.name;
	}

	try {
		out.value = node.get();
	} catch {
		/* omit value */
	}

	return out;
}
