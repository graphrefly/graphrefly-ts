import { DynamicNodeImpl } from "./dynamic-node.js";
import { accessHintForGuard } from "./guard.js";
import { type Node, NodeImpl } from "./node.js";

/** JSON-shaped slice of a node for Phase 1 `Graph.describe()` (GRAPHREFLY-SPEC §3.6, Appendix B). */
export type DescribeNodeOutput = {
	type: "state" | "derived" | "producer" | "operator" | "effect";
	status: Node["status"];
	deps: string[];
	meta: Record<string, unknown>;
	name?: string;
	value?: unknown;
	/** Node versioning info (GRAPHREFLY-SPEC §7). Present only when versioning is enabled. */
	v?: { id: string; version: number; cid?: string; prev?: string | null };
};

function inferDescribeType(n: NodeImpl): DescribeNodeOutput["type"] {
	if (n._describeKind != null) return n._describeKind;
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
 * Builds a single-node slice of `Graph.describe()` JSON (structure + `meta` snapshot).
 * Parity with graphrefly-py `describe_node`.
 *
 * `type` is inferred from factory configuration, optional `describeKind` in node options,
 * and the last `manualEmitUsed` hint (operator vs derived). {@link effect} sets
 * `describeKind: "effect"`. Nodes not created by {@link node} fall back to `type: "state"` and empty `deps`.
 *
 * @param node - Any `Node` to introspect.
 * @returns `DescribeNodeOutput` suitable for merging into graph describe maps.
 *
 * @example
 * ```ts
 * import { describeNode, state } from "@graphrefly/graphrefly-ts";
 *
 * describeNode(state(0));
 * ```
 */
export function describeNode(node: Node): DescribeNodeOutput {
	const meta: Record<string, unknown> = { ...metaSnapshot(node) };

	// Guard-derived access hint (NodeImpl or DynamicNodeImpl)
	const guard =
		(node instanceof NodeImpl && node._guard) ||
		(node instanceof DynamicNodeImpl && node._guard) ||
		undefined;
	if (guard != null && meta.access === undefined) {
		meta.access = accessHintForGuard(guard);
	}

	let type: DescribeNodeOutput["type"] = "state";
	let deps: string[] = [];

	if (node instanceof NodeImpl) {
		type = inferDescribeType(node);
		deps = node._deps.map((d) => d.name ?? "");
	} else if (node instanceof DynamicNodeImpl) {
		type = node._describeKind ?? "derived";
		deps = [];
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

	// Versioning (GRAPHREFLY-SPEC §7)
	if (node.v != null) {
		const vInfo: DescribeNodeOutput["v"] = { id: node.v.id, version: node.v.version };
		if ("cid" in node.v) {
			vInfo!.cid = (node.v as { cid: string }).cid;
			vInfo!.prev = (node.v as { prev: string | null }).prev;
		}
		out.v = vInfo;
	}

	return out;
}
