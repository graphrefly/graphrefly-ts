import { describe, expect, it } from "vitest";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";
import { validateNoIslands } from "../../graph/validate-no-islands.js";

describe("validateNoIslands (Tier 9.3)", () => {
	it("passes a connected graph (state → derived chain)", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.ok).toBe(true);
		expect(r.orphans).toEqual([]);
		expect(r.summary()).toBe("validateNoIslands: ok (no islands)");
	});

	it("reports a node with zero in-edges AND zero out-edges as an island", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		const orphan = state(99, { name: "orphan" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(orphan, { name: "orphan" });
		const r = validateNoIslands(g);
		expect(r.ok).toBe(false);
		expect(r.orphans).toHaveLength(1);
		expect(r.orphans[0]?.path).toBe("orphan");
		// A3 (qa): orphans surface kind alongside path for triage.
		expect(r.orphans[0]?.kind).toBe("state");
		expect(r.summary()).toContain("1 island node(s)");
		expect(r.summary()).toContain("orphan");
		expect(r.summary()).toContain("(state)");
	});

	it("does NOT flag source nodes (zero in-edges, ≥1 out-edge)", () => {
		// `a` has no deps but `b` declares it; out-edge count = 1 → not an island.
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.orphans.find((o) => o.path === "a")).toBeUndefined();
	});

	it("does NOT flag sink nodes (≥1 in-edge, zero out-edges)", () => {
		// `b` has deps but no other node references it → in=1, out=0 → not an island.
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.orphans.find((o) => o.path === "b")).toBeUndefined();
	});

	it("reports multiple orphans sorted by path (A9: insertion-order doesn't match sort order)", () => {
		// A9: insert in order that does NOT match sorted output, with mixed
		// case and digits, so the assertion actively distinguishes "sorted"
		// from "insertion-ordered".
		const g = new Graph("g");
		g.add(state(0, { name: "Zeta" }), { name: "Zeta" });
		g.add(state(0, { name: "alpha" }), { name: "alpha" });
		g.add(state(0, { name: "Beta" }), { name: "Beta" });
		g.add(state(0, { name: "10gamma" }), { name: "10gamma" });
		const r = validateNoIslands(g);
		// ASCII-asc: digits < uppercase < lowercase.
		expect(r.orphans.map((o) => o.path)).toEqual(["10gamma", "Beta", "Zeta", "alpha"]);
	});

	it("walks mounted subgraphs (path-qualified orphans appear with subgraph prefix)", () => {
		const g = new Graph("parent");
		const sub = new Graph("child");
		sub.add(state(0, { name: "subOrphan" }), { name: "subOrphan" });
		g.mount("child", sub);
		// Add a connected pair on the parent so the mounted-orphan is the only flag.
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.ok).toBe(false);
		// Mounted child paths use `<mountName>::<path>` qualification.
		expect(r.orphans.map((o) => o.path)).toContain("child::subOrphan");
	});
});
