import type { Node } from "./node.js";

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
