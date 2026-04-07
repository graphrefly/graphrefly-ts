import type { Actor } from "./actor.js";
import { DynamicNodeImpl } from "./dynamic-node.js";
import { accessHintForGuard } from "./guard.js";
import { type Node, NodeImpl } from "./node.js";

/** JSON-shaped slice of a node for Phase 1 `Graph.describe()` (GRAPHREFLY-SPEC §3.6, Appendix B). */
export type DescribeNodeOutput = {
	type: "state" | "derived" | "producer" | "operator" | "effect";
	status?: Node["status"];
	deps: string[];
	meta?: Record<string, unknown>;
	name?: string;
	value?: unknown;
	/** Node versioning info (GRAPHREFLY-SPEC §7). Present only when versioning is enabled. */
	v?: { id: string; version: number; cid?: string; prev?: string | null };
	/** Guard info (full detail). */
	guard?: string;
	/** Last mutation attribution (full detail). */
	lastMutation?: Readonly<{ actor: Actor; timestamp_ns: number }>;
};

/**
 * Detail level for `describe()` progressive disclosure (Phase 3.3b).
 * - `"minimal"` — type + deps only (default). LLM-friendly.
 * - `"standard"` — type, status, value, deps, meta, versioning (`v`).
 * - `"full"` — standard + guard, lastMutation.
 */
export type DescribeDetail = "minimal" | "standard" | "full";

/**
 * Valid field names for `describe({ fields: [...] })` (Phase 3.3b).
 * Dotted paths like `"meta.label"` select specific meta keys.
 */
export type DescribeField =
	| "type"
	| "status"
	| "value"
	| "deps"
	| "meta"
	| "v"
	| "guard"
	| "lastMutation"
	| `meta.${string}`;

/** Resolve which fields to include based on detail level or explicit field list. */
export function resolveDescribeFields(
	detail?: DescribeDetail,
	fields?: readonly DescribeField[],
): Set<string> | null {
	// Explicit fields override detail level
	if (fields != null && fields.length > 0) return new Set(fields);
	switch (detail) {
		case "standard":
			return new Set(["type", "status", "value", "deps", "meta", "v"]);
		case "full":
			return null; // null = include everything
		default:
			return new Set(["type", "deps"]);
	}
}

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
/**
 * Builds a single-node slice for `Graph.describe()`.
 *
 * @param node - Node to introspect.
 * @param includeFields - Set of fields to include, or `null` for all. When omitted, all fields are included (legacy behavior).
 */
export function describeNode(node: Node, includeFields?: Set<string> | null): DescribeNodeOutput {
	const all = includeFields == null; // null or undefined → include everything

	// Specific meta keys requested via dotted paths (e.g. "meta.label")
	const metaKeys: string[] | null =
		!all && includeFields != null
			? [...includeFields].filter((f) => f.startsWith("meta.")).map((f) => f.slice(5))
			: null;
	const wantsMeta = all || includeFields!.has("meta") || (metaKeys != null && metaKeys.length > 0);

	let type: DescribeNodeOutput["type"] = "state";
	let deps: string[] = [];

	if (node instanceof NodeImpl) {
		type = inferDescribeType(node);
		deps = node._deps.map((d) => d.name ?? "");
	} else if (node instanceof DynamicNodeImpl) {
		type = node._describeKind ?? "derived";
		deps = [];
	}

	const out: DescribeNodeOutput = { type, deps };

	// status
	if (all || includeFields!.has("status")) {
		out.status = node.status;
	}

	// Resolve guard once — used by both meta.access hint and standalone guard field
	const guard =
		(node instanceof NodeImpl && node._guard) ||
		(node instanceof DynamicNodeImpl && node._guard) ||
		undefined;

	// meta
	if (wantsMeta) {
		const rawMeta: Record<string, unknown> = { ...metaSnapshot(node) };
		if (guard != null && rawMeta.access === undefined) {
			rawMeta.access = accessHintForGuard(guard);
		}

		if (metaKeys != null && metaKeys.length > 0 && !includeFields!.has("meta")) {
			// Only specific meta keys
			const filtered: Record<string, unknown> = {};
			for (const k of metaKeys) {
				if (k in rawMeta) filtered[k] = rawMeta[k];
			}
			out.meta = filtered;
		} else {
			out.meta = rawMeta;
		}
	}

	// name (always include when present — it's identity, not detail)
	if (node.name != null) {
		out.name = node.name;
	}

	// value
	if (all || includeFields!.has("value")) {
		try {
			out.value = node.get();
		} catch {
			/* omit value */
		}
	}

	// Versioning (GRAPHREFLY-SPEC §7)
	if ((all || includeFields!.has("v")) && node.v != null) {
		const vInfo: DescribeNodeOutput["v"] = { id: node.v.id, version: node.v.version };
		if ("cid" in node.v) {
			vInfo!.cid = (node.v as { cid: string }).cid;
			vInfo!.prev = (node.v as { prev: string | null }).prev;
		}
		out.v = vInfo;
	}

	// Guard info (full detail)
	if (all || includeFields!.has("guard")) {
		if (guard != null) {
			out.guard = accessHintForGuard(guard);
		}
	}

	// Last mutation attribution (full detail)
	if (all || includeFields!.has("lastMutation")) {
		if (node.lastMutation != null) {
			out.lastMutation = node.lastMutation;
		}
	}

	return out;
}
