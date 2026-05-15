/**
 * Internal helpers shared across renderers in `extra/render/`.
 *
 * These are pure functions over `GraphDescribeOutput` — no Graph instance
 * dependency. Extracted from `src/graph/graph.ts` (the consolidated
 * ex-dumpGraph / ex-graphSpecToMermaid / ex-graphSpecToD2 renderers) per
 * Tier 2.1 A2.
 */

import type { GraphDescribeOutput } from "@graphrefly/pure-ts/graph/graph.js";

/** Direction options for diagram exports. */
export type DiagramDirection = "TD" | "LR" | "BT" | "RL";

/** Recursively sort object keys for deterministic JSON (git-diffable). */
export function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		out[k] = sortJsonValue(obj[k]);
	}
	return out;
}

/** Escape characters that are illegal inside a quoted Mermaid label. */
export function escapeMermaidLabel(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** Escape characters that are illegal inside a quoted D2 label. */
export function escapeD2Label(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** Map our 4-direction enum to D2's `direction:` keyword. */
export function d2DirectionFromGraphDirection(direction: DiagramDirection): string {
	if (direction === "TD") return "down";
	if (direction === "BT") return "up";
	if (direction === "RL") return "left";
	return "right";
}

/** Collect deduplicated (from, to) arrows from deps + edges. */
export function collectDiagramArrows(described: GraphDescribeOutput): [string, string][] {
	const seen = new Set<string>();
	const arrows: [string, string][] = [];
	function add(from: string, to: string): void {
		const key = `${from}\0${to}`;
		if (seen.has(key)) return;
		seen.add(key);
		arrows.push([from, to]);
	}
	for (const [path, info] of Object.entries(described.nodes)) {
		const deps: string[] | undefined = (info as Record<string, unknown>).deps as
			| string[]
			| undefined;
		if (deps) {
			for (const dep of deps) add(dep, path);
		}
	}
	for (const edge of described.edges) add(edge.from, edge.to);
	return arrows;
}

/** Default to "LR"; throw on unknown values to surface caller bugs early. */
export function normalizeDiagramDirection(direction: unknown): DiagramDirection {
	if (direction === undefined) return "LR";
	if (direction === "TD" || direction === "LR" || direction === "BT" || direction === "RL") {
		return direction;
	}
	throw new Error(
		`invalid diagram direction ${String(direction)}; expected one of: TD, LR, BT, RL`,
	);
}

/** JSON-aware single-value formatter (used by `graphSpecToPretty`). */
export function describeData(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value == null)
		return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable]";
	}
}
