import { expect } from "vitest";

/** GRAPHREFLY-SPEC Appendix B — mirrors `describe-appendix-b.schema.json` in this folder. */

const NODE_TYPES = new Set(["state", "derived", "producer", "operator", "effect"]);
const STATUSES = new Set(["disconnected", "dirty", "settled", "resolved", "completed", "errored"]);

/**
 * Structural validation matching Appendix B / `describe-appendix-b.schema.json`
 * (no JSON Schema runtime — keeps devDependencies minimal).
 */
export function assertDescribeMatchesAppendixB(data: unknown): void {
	expect(data).toEqual(expect.any(Object));
	const d = data as Record<string, unknown>;
	expect(typeof d.name).toBe("string");
	expect(d.nodes).toEqual(expect.any(Object));
	expect(Array.isArray(d.edges)).toBe(true);
	// `Graph.describe()` always includes `subgraphs` (GRAPHREFLY-SPEC Appendix B).
	expect(Array.isArray(d.subgraphs)).toBe(true);
	for (const s of d.subgraphs as unknown[]) {
		expect(typeof s).toBe("string");
	}

	for (const edge of d.edges as unknown[]) {
		expect(edge).toEqual(expect.any(Object));
		const e = edge as Record<string, unknown>;
		expect(typeof e.from).toBe("string");
		expect(typeof e.to).toBe("string");
	}

	const nodes = d.nodes as Record<string, unknown>;
	for (const [path, slice] of Object.entries(nodes)) {
		expect(path.length).toBeGreaterThan(0);
		expect(slice).toEqual(expect.any(Object));
		const n = slice as Record<string, unknown>;
		expect(typeof n.type).toBe("string");
		expect(NODE_TYPES.has(n.type as string)).toBe(true);
		expect(typeof n.status).toBe("string");
		expect(STATUSES.has(n.status as string)).toBe(true);
		if (n.deps !== undefined) {
			expect(Array.isArray(n.deps)).toBe(true);
			for (const dep of n.deps as unknown[]) {
				expect(typeof dep).toBe("string");
			}
		}
		if (n.meta !== undefined) {
			expect(n.meta).toEqual(expect.any(Object));
		}
	}
}
