import { describe, expect, it } from "vitest";
import { derived, state } from "../../core/sugar.js";
import { explainPath, Graph } from "../../graph/index.js";

describe("explainPath (roadmap §9.2)", () => {
	it("single-hop: state → derived returns 2-step chain", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		// Activate so derived computes.
		g.observe("b").subscribe(() => {});

		const chain = g.describe({ explain: { from: "a", to: "b" } });
		expect(chain.found).toBe(true);
		expect(chain.reason).toBe("ok");
		expect(chain.steps.map((s) => s.path)).toEqual(["a", "b"]);
		expect(chain.steps[0]?.value).toBe(1);
		expect(chain.steps[1]?.value).toBe(2);
		expect(chain.steps[0]?.dep_index).toBe(0);
	});

	it("multi-hop diamond returns shortest path", () => {
		// a → b, a → c, d depends on [b, c]
		const g = new Graph("diamond");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		const c = derived([a], ([v]) => (v as number) + 10, { name: "c" });
		const d = derived([b, c], ([x, y]) => (x as number) + (y as number), { name: "d" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		g.add(d, { name: "d" });
		g.observe("d").subscribe(() => {});

		const chain = g.describe({ explain: { from: "a", to: "d" } });
		expect(chain.found).toBe(true);
		// BFS finds shortest: a → b → d OR a → c → d (both 3 steps).
		expect(chain.steps).toHaveLength(3);
		expect(chain.steps[0]?.path).toBe("a");
		expect(chain.steps[2]?.path).toBe("d");
		expect(["b", "c"]).toContain(chain.steps[1]?.path);
	});

	it("returns no-path when nodes are disconnected", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const z = state("z", { name: "z" });
		g.add(a, { name: "a" });
		g.add(z, { name: "z" });

		const chain = g.describe({ explain: { from: "a", to: "z" } });
		expect(chain.found).toBe(false);
		expect(chain.reason).toBe("no-path");
		expect(chain.steps).toEqual([]);
		expect(chain.text).toMatch(/no path/);
	});

	it("returns no-such-from / no-such-to for unknown nodes", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });

		expect(g.describe({ explain: { from: "missing", to: "a" } }).reason).toBe("no-such-from");
		expect(g.describe({ explain: { from: "a", to: "missing" } }).reason).toBe("no-such-to");
	});

	it("from === to returns single-step chain", () => {
		const g = new Graph("g");
		g.add(state(42, { name: "a" }), { name: "a" });
		const chain = g.describe({ explain: { from: "a", to: "a" } });
		expect(chain.found).toBe(true);
		expect(chain.steps).toHaveLength(1);
		expect(chain.steps[0]?.path).toBe("a");
	});

	it("respects maxDepth and reports max-depth-exceeded when truncated", () => {
		// chain: a → b → c → d
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		const c = derived([b], ([v]) => v, { name: "c" });
		const d = derived([c], ([v]) => v, { name: "d" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		g.add(d, { name: "d" });
		g.observe("d").subscribe(() => {});

		const ok = g.describe({ explain: { from: "a", to: "d" } });
		expect(ok.found).toBe(true);
		expect(ok.steps).toHaveLength(4);

		const trunc = g.describe({ explain: { from: "a", to: "d", maxDepth: 2 } });
		expect(trunc.found).toBe(false);
		expect(trunc.reason).toBe("max-depth-exceeded");
	});

	it("attaches graph.trace() reason annotations to steps", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.observe("b").subscribe(() => {});

		g.trace("b", "doubled because pricing rule R7");
		const chain = g.describe({ explain: { from: "a", to: "b" } });
		expect(chain.steps[1]?.annotation).toBe("doubled because pricing rule R7");
		expect(chain.text).toMatch(/annotation: doubled because/);
	});

	it("standalone explainPath works on a hand-built describe snapshot", () => {
		const described = {
			name: "synthetic",
			nodes: {
				x: { type: "state" as const, deps: [], value: 1 },
				y: { type: "derived" as const, deps: ["x"], value: 2 },
			},
			edges: [],
			subgraphs: [],
		};
		const chain = explainPath(described, "x", "y");
		expect(chain.found).toBe(true);
		expect(chain.steps).toHaveLength(2);
		expect(chain.steps[0]?.dep_index).toBe(0);
		const json = chain.toJSON();
		expect(json.found).toBe(true);
		expect(json.steps).toHaveLength(2);
	});

	it("includes lastMutation actor when guarded writes occurred", () => {
		const g = new Graph("g");
		const a = state<number>(0, {
			name: "a",
			guard: () => true, // permissive — we just want the lastMutation populated
		});
		g.add(a, { name: "a" });
		g.set("a", 5, { actor: { type: "llm", id: "agent-7" } });
		const chain = g.describe({ explain: { from: "a", to: "a" } });
		expect(chain.steps[0]?.lastMutation?.actor.type).toBe("llm");
		expect(chain.steps[0]?.lastMutation?.actor.id).toBe("agent-7");
	});

	it("includes lastMutation for unguarded nodes when actor is provided", () => {
		// QA fix A1: actor attribution no longer requires a guard.
		const g = new Graph("g");
		g.add(state<number>(0, { name: "a" }), { name: "a" }); // no guard
		g.set("a", 9, { actor: { type: "human", id: "alice" } });
		const chain = g.describe({ explain: { from: "a", to: "a" } });
		expect(chain.steps[0]?.lastMutation?.actor.id).toBe("alice");
	});

	it("findCycle: returns shortest cycle when from === to and a cycle exists", () => {
		// a → b → a (feedback)
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = state(2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		// Synthesize cycle topology via raw describe (the standalone explainPath
		// works on any GraphDescribeOutput, including hand-built cycles).
		const described = {
			name: "g",
			nodes: {
				a: { type: "state" as const, deps: ["b"], value: 1 },
				b: { type: "state" as const, deps: ["a"], value: 2 },
			},
			edges: [],
			subgraphs: [],
		};
		const chain = explainPath(described, "a", "a", { findCycle: true });
		expect(chain.found).toBe(true);
		expect(chain.steps).toHaveLength(3);
		expect(chain.steps.map((s) => s.path)).toEqual(["a", "b", "a"]);
	});

	it("findCycle: detects direct self-loop (a depends on a)", () => {
		const described = {
			name: "g",
			nodes: {
				a: { type: "derived" as const, deps: ["a"], value: 0 },
			},
			edges: [],
			subgraphs: [],
		};
		const chain = explainPath(described, "a", "a", { findCycle: true });
		expect(chain.found).toBe(true);
		expect(chain.steps).toHaveLength(2);
		expect(chain.steps[0]?.dep_index).toBe(0);
	});

	it("findCycle: falls back to trivial single-step when no cycle exists", () => {
		const described = {
			name: "g",
			nodes: {
				a: { type: "state" as const, deps: [], value: 0 },
			},
			edges: [],
			subgraphs: [],
		};
		const chain = explainPath(described, "a", "a", { findCycle: true });
		expect(chain.found).toBe(true);
		expect(chain.steps).toHaveLength(1);
	});

	it("dep_indices preserves multi-edge slot info", () => {
		// d depends on [a, a] — same node twice
		const described = {
			name: "g",
			nodes: {
				a: { type: "state" as const, deps: [], value: 1 },
				d: { type: "derived" as const, deps: ["a", "a"], value: 2 },
			},
			edges: [],
			subgraphs: [],
		};
		const chain = explainPath(described, "a", "d");
		expect(chain.found).toBe(true);
		expect(chain.steps).toHaveLength(2);
		expect(chain.steps[0]?.dep_index).toBe(0);
		expect(chain.steps[0]?.dep_indices).toEqual([0, 1]);
	});

	it("walks transitively through factory-internal nodes that weren't graph.add-ed", () => {
		// Shape mirrors `promptNode` — a factory adds the terminal output to
		// the graph but not the intermediate `derived` it used to build its
		// input. Before the transitive-deps fix, describe emitted a dangling
		// dep pointer (e.g. `out.deps = ["intermediate"]` with no entry under
		// `intermediate`), so explainPath's BFS had nowhere to walk from
		// `out`. Post-fix the intermediate is surfaced under its meta.name and
		// the chain completes.
		const g = new Graph("factory-internals");
		const src = state(1, { name: "src" });
		// Intermediate is NOT graph.add-ed — simulates promptNode's internal
		// `brief::messages` derived helper.
		const intermediate = derived([src], ([v]) => (v as number) * 2, {
			name: "prompt::messages",
		});
		const out = derived([intermediate], ([v]) => (v as number) + 100, { name: "out" });
		g.add(src, { name: "src" });
		g.add(out, { name: "out" });
		// Activate so every node computes.
		g.observe("out").subscribe(() => {});

		const d = g.describe({ detail: "standard" });
		// All three nodes present in describe — no dangling pointer.
		expect(Object.keys(d.nodes).sort()).toEqual(["out", "prompt::messages", "src"]);
		// Edges derived from _deps cover every hop, including through the
		// un-add-ed intermediate.
		const edgeSet = new Set(d.edges.map((e) => `${e.from}→${e.to}`));
		expect(edgeSet.has("src→prompt::messages")).toBe(true);
		expect(edgeSet.has("prompt::messages→out")).toBe(true);

		const chain = g.describe({ explain: { from: "src", to: "out" } });
		expect(chain.found).toBe(true);
		expect(chain.reason).toBe("ok");
		expect(chain.steps.map((s) => s.path)).toEqual(["src", "prompt::messages", "out"]);
		expect(chain.steps[0]?.value).toBe(1);
		expect(chain.steps[1]?.value).toBe(2);
		expect(chain.steps[2]?.value).toBe(102);
	});

	it("deduplicates orphan-dep paths when two internals share a meta.name", () => {
		// Two factory-internal derived nodes both named "internal" — the
		// describe walk must not collapse them. Second one gets "#2" suffix.
		const g = new Graph("dup-internals");
		const a = state(1, { name: "a" });
		const b = state(10, { name: "b" });
		const internalA = derived([a], ([v]) => (v as number) + 1, { name: "internal" });
		const internalB = derived([b], ([v]) => (v as number) + 1, { name: "internal" });
		// Neither internal is graph.add-ed; both are upstream of their own
		// registered terminal.
		const outA = derived([internalA], ([v]) => (v as number) * 10, { name: "outA" });
		const outB = derived([internalB], ([v]) => (v as number) * 10, { name: "outB" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(outA, { name: "outA" });
		g.add(outB, { name: "outB" });
		g.observe("outA").subscribe(() => {});
		g.observe("outB").subscribe(() => {});

		const d = g.describe({ detail: "standard" });
		const keys = Object.keys(d.nodes).sort();
		expect(keys).toContain("internal");
		expect(keys).toContain("internal#2");
		// Both terminals walk back to their own state via the suffixed pair.
		const chainA = g.describe({ explain: { from: "a", to: "outA" } });
		const chainB = g.describe({ explain: { from: "b", to: "outB" } });
		expect(chainA.found).toBe(true);
		expect(chainB.found).toBe(true);
		expect(chainA.steps.map((s) => s.path)).toEqual([
			"a",
			expect.stringMatching(/^internal/),
			"outA",
		]);
		expect(chainB.steps.map((s) => s.path)).toEqual([
			"b",
			expect.stringMatching(/^internal/),
			"outB",
		]);
	});
});
