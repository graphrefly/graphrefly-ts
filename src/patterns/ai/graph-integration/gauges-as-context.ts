// ---------------------------------------------------------------------------
// gaugesAsContext
// ---------------------------------------------------------------------------

import type { Actor } from "../../../core/actor.js";
import type { Graph } from "../../../graph/graph.js";

export type GaugesAsContextOptions = {
	/** Group gauges by `meta.tags` (default true). */
	groupByTags?: boolean;
	/** Separator between gauge lines (default "\n"). */
	separator?: string;
	/**
	 * V0 delta mode (§6.0b): only include nodes whose `v.version` exceeds
	 * the corresponding entry in this map. Nodes without V0 or not in the
	 * map are always included. Callers maintain this map across calls.
	 *
	 * The `id` field guards against node replacement: if a node is removed
	 * and re-added under the same name (new id), it is always included.
	 */
	sinceVersion?: ReadonlyMap<string, { id: string; version: number }>;
};

/**
 * Format a graph's readable (gauge) nodes as a context string for LLM
 * system prompts.
 *
 * Gauges are nodes with `meta.description` or `meta.format`. Values are
 * formatted using `meta.format` and `meta.unit` hints.
 *
 * @param graph - The graph to introspect.
 * @param actor - Optional actor for guard-scoped describe.
 * @param options - Formatting options.
 * @returns A formatted string ready for system prompt injection.
 */
export function gaugesAsContext(
	graph: Graph,
	actor?: Actor,
	options?: GaugesAsContextOptions,
): string {
	const described = graph.describe({ actor, detail: "full" });
	const groupByTags = options?.groupByTags ?? true;
	const separator = options?.separator ?? "\n";

	type GaugeEntry = { path: string; description: string; formatted: string };
	const entries: GaugeEntry[] = [];

	const sinceVersion = options?.sinceVersion;
	for (const [path, node] of Object.entries(described.nodes)) {
		const meta = node.meta ?? {};
		const desc = meta.description as string | undefined;
		const format = meta.format as string | undefined;
		// Must have description or format to be a gauge
		if (!desc && !format) continue;
		// V0 delta filter: skip nodes unchanged since last seen version (§6.0b).
		if (sinceVersion != null && node.v != null) {
			const lastSeen = sinceVersion.get(path);
			if (lastSeen != null && lastSeen.id === node.v.id && node.v.version <= lastSeen.version)
				continue;
		}

		const label = desc ?? path;
		const value = node.value;
		const unit = meta.unit as string | undefined;

		let formatted: string;
		if (format === "currency" && typeof value === "number") {
			formatted = `$${value.toFixed(2)}`;
		} else if (format === "percentage" && typeof value === "number") {
			formatted = `${(value * 100).toFixed(1)}%`;
		} else if (value === undefined || value === null) {
			formatted = "(no value)";
		} else {
			formatted = String(value);
		}

		if (unit && format !== "currency" && format !== "percentage") {
			formatted = `${formatted} ${unit}`;
		}

		entries.push({ path, description: label, formatted });
	}

	if (entries.length === 0) return "";

	if (groupByTags) {
		const tagGroups = new Map<string, GaugeEntry[]>();
		const ungrouped: GaugeEntry[] = [];

		for (const entry of entries) {
			const node = described.nodes[entry.path]!;
			const tags = node.meta?.tags as string[] | undefined;
			if (tags && tags.length > 0) {
				// Use first tag for grouping to avoid duplicating entries across groups
				const tag = tags[0]!;
				let group = tagGroups.get(tag);
				if (!group) {
					group = [];
					tagGroups.set(tag, group);
				}
				group.push(entry);
			} else {
				ungrouped.push(entry);
			}
		}

		if (tagGroups.size === 0) {
			return entries.map((e) => `- ${e.description}: ${e.formatted}`).join(separator);
		}

		const sections: string[] = [];
		for (const [tag, group] of [...tagGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			sections.push(
				`[${tag}]${separator}${group.map((e) => `- ${e.description}: ${e.formatted}`).join(separator)}`,
			);
		}
		if (ungrouped.length > 0) {
			sections.push(ungrouped.map((e) => `- ${e.description}: ${e.formatted}`).join(separator));
		}
		return sections.join(separator + separator);
	}

	return entries.map((e) => `- ${e.description}: ${e.formatted}`).join(separator);
}
