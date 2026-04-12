import type { Actor } from "./actor.js";
import { accessHintForGuard } from "./guard.js";
import { type Node, type NodeDescribeKind, NodeImpl } from "./node.js";

/**
 * JSON-shaped slice of a node for `Graph.describe()`
 * (GRAPHREFLY-SPEC §3.6, Appendix B).
 */
export type DescribeNodeOutput = {
	type: NodeDescribeKind;
	status?: Node["status"];
	deps: string[];
	meta?: Record<string, unknown>;
	name?: string;
	value?: unknown;
	/** True when the node is in `"sentinel"` state (no value ever). */
	sentinel?: boolean;
	v?: { id: string; version: number; cid?: string; prev?: string | null };
	guard?: string;
	lastMutation?: Readonly<{ actor: Actor; timestamp_ns: number }>;
};

/** Detail level for progressive disclosure (Phase 3.3b). */
export type DescribeDetail = "minimal" | "standard" | "full";

/** Valid field names for `describe({ fields: [...] })`. */
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
	if (fields != null && fields.length > 0) return new Set(fields);
	switch (detail) {
		case "standard":
			return new Set(["type", "status", "value", "deps", "meta", "v"]);
		case "full":
			return null;
		default:
			return new Set(["type", "deps"]);
	}
}

function inferDescribeType(n: NodeImpl): NodeDescribeKind {
	if (n._describeKind != null) return n._describeKind;
	const hasDeps = n._deps.length > 0;
	if (!hasDeps) return n._fn != null ? "producer" : "state";
	// With deps: derived (passthrough falls under derived, no fn → derived shape).
	return "derived";
}

/**
 * Reads the current cached value of every companion meta field on a node,
 * suitable for merging into `describe()`-style JSON.
 *
 * Values come from {@link Node.cache}, which returns the last settled cache.
 * If a meta field is in `"dirty"` status (DIRTY received, DATA pending), the
 * snapshot contains the *previous* value — check `node.meta[key].status`
 * when freshness matters.
 */
export function metaSnapshot(node: Node): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(node.meta)) {
		try {
			out[key] = child.cache;
		} catch {
			/* omit key — describe tooling still gets other fields */
		}
	}
	return out;
}

/**
 * Builds a single-node slice of `Graph.describe()` JSON (structure + `meta`
 * snapshot). Parity with `graphrefly-py` `describe_node`.
 */
export function describeNode(
	node: Node,
	includeFields?: Set<string> | null,
): DescribeNodeOutput {
	const all = includeFields == null;
	const metaKeys: string[] | null =
		!all && includeFields != null
			? [...includeFields]
					.filter((f) => f.startsWith("meta."))
					.map((f) => f.slice(5))
			: null;
	const wantsMeta =
		all || includeFields!.has("meta") || (metaKeys != null && metaKeys.length > 0);

	let type: NodeDescribeKind = "state";
	let deps: string[] = [];

	if (node instanceof NodeImpl) {
		type = inferDescribeType(node);
		deps = node._deps.map((d) => d.node.name ?? "");
	}

	const out: DescribeNodeOutput = { type, deps };

	if (all || includeFields!.has("status")) {
		out.status = node.status;
	}

	const guard = node instanceof NodeImpl ? node._guard : undefined;

	if (wantsMeta) {
		const rawMeta: Record<string, unknown> = { ...metaSnapshot(node) };
		if (guard != null && rawMeta.access === undefined) {
			rawMeta.access = accessHintForGuard(guard);
		}
		if (metaKeys != null && metaKeys.length > 0 && !includeFields!.has("meta")) {
			const filtered: Record<string, unknown> = {};
			for (const k of metaKeys) {
				if (k in rawMeta) filtered[k] = rawMeta[k];
			}
			out.meta = filtered;
		} else {
			out.meta = rawMeta;
		}
	}

	if (node.name != null) {
		out.name = node.name;
	}

	if (all || includeFields!.has("value")) {
		if (node.status === "sentinel") out.sentinel = true;
		try {
			out.value = node.cache;
		} catch {
			/* omit value */
		}
	}

	if ((all || includeFields!.has("v")) && node.v != null) {
		const vInfo: NonNullable<DescribeNodeOutput["v"]> = {
			id: node.v.id,
			version: node.v.version,
		};
		if ("cid" in node.v) {
			vInfo.cid = (node.v as { cid: string }).cid;
			vInfo.prev = (node.v as { prev: string | null }).prev;
		}
		out.v = vInfo;
	}

	if (all || includeFields!.has("guard")) {
		if (guard != null) out.guard = accessHintForGuard(guard);
	}

	if (all || includeFields!.has("lastMutation")) {
		if (node.lastMutation != null) out.lastMutation = node.lastMutation;
	}

	return out;
}
