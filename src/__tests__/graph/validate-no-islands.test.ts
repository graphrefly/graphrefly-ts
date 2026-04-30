import { describe, expect, it } from "vitest";
import { node } from "../../core/node.js";

import { Graph } from "../../graph/graph.js";
import { validateNoIslands } from "../../graph/validate-no-islands.js";

describe("validateNoIslands (Tier 9.3)", () => {
	it("passes a connected graph (state → derived chain)", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.ok).toBe(true);
		expect(r.orphans).toEqual([]);
		expect(r.summary()).toBe("validateNoIslands: ok (no islands)");
	});

	it("reports a node with zero in-edges AND zero out-edges as an island", () => {
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		const orphan = node([], { name: "orphan", initial: 99 });
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
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.orphans.find((o) => o.path === "a")).toBeUndefined();
	});

	it("does NOT flag sink nodes (≥1 in-edge, zero out-edges)", () => {
		// `b` has deps but no other node references it → in=1, out=0 → not an island.
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
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
		g.add(node([], { name: "Zeta", initial: 0 }), { name: "Zeta" });
		g.add(node([], { name: "alpha", initial: 0 }), { name: "alpha" });
		g.add(node([], { name: "Beta", initial: 0 }), { name: "Beta" });
		g.add(node([], { name: "10gamma", initial: 0 }), { name: "10gamma" });
		const r = validateNoIslands(g);
		// ASCII-asc: digits < uppercase < lowercase.
		expect(r.orphans.map((o) => o.path)).toEqual(["10gamma", "Beta", "Zeta", "alpha"]);
	});

	it("walks mounted subgraphs (path-qualified orphans appear with subgraph prefix)", () => {
		const g = new Graph("parent");
		const sub = new Graph("child");
		sub.add(node([], { name: "subOrphan", initial: 0 }), { name: "subOrphan" });
		g.mount("child", sub);
		// Add a connected pair on the parent so the mounted-orphan is the only flag.
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const r = validateNoIslands(g);
		expect(r.ok).toBe(false);
		// Mounted child paths use `<mountName>::<path>` qualification.
		expect(r.orphans.map((o) => o.path)).toContain("child::subOrphan");
	});

	it("EH-9: filters synthetic __internal__/ paths from orphan list", () => {
		// `__internal__/` is the synthetic prefix the registrar falls back to
		// for unnamed factory helpers; those are bookkeeping, not user
		// topology. validateNoIslands suppresses them so callers don't get
		// false-positives from compound factories.
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		// Inject a node under the synthetic prefix that would otherwise look
		// like an orphan (zero deps, no other node references it).
		const helper = node([], { name: "__internal__/helper", initial: 0 });
		g.add(helper, { name: "__internal__/helper" });
		const r = validateNoIslands(g);
		expect(r.ok).toBe(true);
		expect(r.orphans.find((o) => o.path.startsWith("__internal__/"))).toBeUndefined();
	});

	it("EH-9 (qa P6): filter is path-prefix based and coexists with real orphans", () => {
		// qa P6: the prior test only covered the prefix-string-filter contract
		// using a user-named node. This test exercises the real
		// graph.ts transitive-walk path that synthesizes `__internal__/N`
		// names — a registered derived whose dep is an UNREGISTERED unnamed
		// state. describe() walks the dep into `__internal__/0`. Confirm
		// (a) the synthetic path actually appears in describe under the
		// `__internal__/` prefix, and (b) the filter still surfaces a
		// genuine orphan alongside it.
		const g = new Graph("g");
		// Unregistered unnamed source. graph.ts:1959 will assign it
		// `__internal__/0` during describe().
		const unnamedSource = node([], { initial: 7 });
		const consumer = node(
			[unnamedSource],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived", name: "consumer" },
		);
		g.add(consumer, { name: "consumer" });
		// A real orphan — must still be flagged.
		g.add(node([], { name: "real-orphan", initial: 99 }), { name: "real-orphan" });

		const desc = g.describe({ detail: "minimal" });
		const allPaths = Object.keys(desc.nodes);
		const synthPath = allPaths.find((p) => p.startsWith("__internal__/"));
		expect(
			synthPath,
			"describe should synthesize an __internal__/ path for the unnamed dep",
		).toBeDefined();

		const r = validateNoIslands(g);
		// Synthetic paths NEVER appear in orphans regardless of edges.
		expect(r.orphans.find((o) => o.path.startsWith("__internal__/"))).toBeUndefined();
		// Real orphan still flagged.
		expect(r.orphans.map((o) => o.path)).toContain("real-orphan");
	});
});
