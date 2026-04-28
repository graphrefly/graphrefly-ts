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
	/**
	 * Latest annotation attached via `graph.trace(path, annotation)` or via
	 * `graph.add(node, { name: path, annotation })`, when present. Populated by
	 * `Graph.describe` only — `describeNode` has no graph context.
	 */
	annotation?: string;
};

/**
 * Detail level for progressive disclosure (Phase 3.3b).
 *
 * - `"minimal"` — `type`, `deps` only.
 * - `"standard"` — minimal + `status`, `value`, `meta`, `v`.
 * - `"full"` — every field.
 * - `"spec"` — Tier 1.5.3 / Session A.1 lock. Projects spec-relevant fields
 *   (`type`, `deps`, `meta` — including `meta.factory` / `meta.factoryArgs`)
 *   and strips runtime fields (`status`, `value`, `lastMutation`, `guard`,
 *   `sentinel`). The output is structurally identical to the `GraphSpec`
 *   shape so `decompileSpec(g) === describe(g, { detail: "spec" })`.
 */
export type DescribeDetail = "minimal" | "standard" | "full" | "spec";

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
		case "spec":
			// Spec projection: structural fields + meta (carries factory/factoryArgs);
			// strips runtime status/value/lastMutation/guard. Tier 1.5.3 lock.
			return new Set(["type", "deps", "meta"]);
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
 * Walk an arbitrary value, replacing non-JSON-serializable fields with
 * descriptive string placeholders (Tier 1.5.3 Phase 2.5 — DG2=ii). Useful for
 * `Graph.prototype.tagFactory(name, args)` when the factory's options include
 * `LLMAdapter` instances, callbacks, or `Node`s that don't survive
 * serialization. Output preserves structure for documentation / audit value;
 * recipients of the spec see "<Node>" / "<function>" / etc. in place of the
 * unserializable bits.
 *
 * Heuristics:
 * - `null` / `undefined` / boolean / number / string — kept as-is.
 * - `function` — `"<function>"`.
 * - Object with `subscribe` method — `"<Node>"` (matches Node-shape duck check).
 * - Array — recursed.
 * - Plain object — recursed.
 * - Anything else — `"<unserializable>"`.
 */
export function placeholderArgs(opts: Record<string, unknown>): Record<string, unknown> {
	const seen = new WeakSet<object>();
	const out: Record<string, unknown> = {};
	for (const [k, v] of safeEntries(opts)) {
		out[k] = _placeholderValue(v, seen);
	}
	return out;
}

function _placeholderValue(v: unknown, seen: WeakSet<object>): unknown {
	if (v === null || v === undefined) return v;
	const t = typeof v;
	if (t === "boolean" || t === "number" || t === "string") return v;
	if (t === "function") return "<function>";
	if (Array.isArray(v)) {
		// QA F6: cycle guard.
		if (seen.has(v)) return "<cycle>";
		seen.add(v);
		return v.map((x) => _placeholderValue(x, seen));
	}
	if (t === "object") {
		const obj = v as Record<string, unknown>;
		// QA F6: cycle guard for plain objects.
		if (seen.has(obj)) return "<cycle>";
		seen.add(obj);
		// Node-shape duck check: subscribe() + cache. Wrapped in try/catch in
		// case `subscribe` is a getter with side effects (QA F7).
		try {
			if (typeof obj.subscribe === "function" && "cache" in obj) return "<Node>";
		} catch {
			return "<unserializable>";
		}
		const out: Record<string, unknown> = {};
		for (const [k2, v2] of safeEntries(obj)) out[k2] = _placeholderValue(v2, seen);
		return out;
	}
	return "<unserializable>";
}

/**
 * QA F7: `Object.entries` triggers all enumerable own getters. A user-supplied
 * options bag may include proxies or lazy adapters whose property access has
 * side effects (connections, counters, throws). Skip properties that throw on
 * read so `placeholderArgs` can't crash `tagFactory` time.
 */
function safeEntries(obj: Record<string, unknown>): Array<[string, unknown]> {
	const out: Array<[string, unknown]> = [];
	let keys: string[];
	try {
		keys = Object.keys(obj);
	} catch {
		return out;
	}
	for (const k of keys) {
		try {
			out.push([k, (obj as Record<string, unknown>)[k]]);
		} catch {
			out.push([k, "<unserializable>"]);
		}
	}
	return out;
}

/**
 * Build a `meta` fragment that stamps a factory identifier and its construction
 * arguments onto a node, so `describe({ detail: "spec" })` exposes enough
 * information for `compileSpec` to recreate the node from the snapshot.
 *
 * Use inside node-producing factories at construction time:
 *
 * ```ts
 * import { factoryTag } from "@graphrefly/graphrefly";
 *
 * export function rateLimiter<T>(source: NodeInput<T>, opts: RateLimiterOptions): Node<T> {
 *   return derived([fromAny(source)], fn, {
 *     name: "rate-limiter",
 *     meta: { ...factoryTag("rateLimiter", opts), domain: "resilience" },
 *   });
 * }
 * ```
 *
 * `factoryArgs` should be JSON-serializable so the spec round-trips through
 * `decompileSpec → compileSpec`. Function-typed args break determinism — use
 * the {@link COMPOSITION-GUIDE} §39 `meta.fnId` pattern for those.
 *
 * Tier 1.5.3 (Session A.1 lock).
 */
export function factoryTag(
	factory: string,
	factoryArgs?: unknown,
): { factory: string; factoryArgs?: unknown } {
	const out: { factory: string; factoryArgs?: unknown } = { factory };
	if (factoryArgs !== undefined) out.factoryArgs = factoryArgs;
	return out;
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
export function describeNode(node: Node, includeFields?: Set<string> | null): DescribeNodeOutput {
	const all = includeFields == null;
	const metaKeys: string[] | null =
		!all && includeFields != null
			? [...includeFields].filter((f) => f.startsWith("meta.")).map((f) => f.slice(5))
			: null;
	const wantsMeta = all || includeFields!.has("meta") || (metaKeys != null && metaKeys.length > 0);

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
