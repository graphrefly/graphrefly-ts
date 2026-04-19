import { describe, expect, it } from "vitest";
import { derived, state } from "../../core/sugar.js";
import { explainPath, Graph } from "../../graph/index.js";

describe("explainPath (roadmap §9.2)", () => {
	it("single-hop: state → derived returns 2-step chain", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		// Activate so derived computes.
		g.observe("b").subscribe(() => {});

		const chain = g.explain("a", "b");
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
		g.add("a", a);
		g.add("b", b);
		g.add("c", c);
		g.add("d", d);
		g.observe("d").subscribe(() => {});

		const chain = g.explain("a", "d");
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
		g.add("a", a);
		g.add("z", z);

		const chain = g.explain("a", "z");
		expect(chain.found).toBe(false);
		expect(chain.reason).toBe("no-path");
		expect(chain.steps).toEqual([]);
		expect(chain.text).toMatch(/no path/);
	});

	it("returns no-such-from / no-such-to for unknown nodes", () => {
		const g = new Graph("g");
		g.add("a", state(1, { name: "a" }));

		expect(g.explain("missing", "a").reason).toBe("no-such-from");
		expect(g.explain("a", "missing").reason).toBe("no-such-to");
	});

	it("from === to returns single-step chain", () => {
		const g = new Graph("g");
		g.add("a", state(42, { name: "a" }));
		const chain = g.explain("a", "a");
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
		g.add("a", a);
		g.add("b", b);
		g.add("c", c);
		g.add("d", d);
		g.observe("d").subscribe(() => {});

		const ok = g.explain("a", "d");
		expect(ok.found).toBe(true);
		expect(ok.steps).toHaveLength(4);

		const trunc = g.explain("a", "d", { maxDepth: 2 });
		expect(trunc.found).toBe(false);
		expect(trunc.reason).toBe("max-depth-exceeded");
	});

	it("attaches graph.trace() reason annotations to steps", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		g.observe("b").subscribe(() => {});

		g.trace("b", "doubled because pricing rule R7");
		const chain = g.explain("a", "b");
		expect(chain.steps[1]?.reason).toBe("doubled because pricing rule R7");
		expect(chain.text).toMatch(/reason: doubled because/);
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
		g.add("a", a);
		g.set("a", 5, { actor: { type: "llm", id: "agent-7" } });
		const chain = g.explain("a", "a");
		expect(chain.steps[0]?.lastMutation?.actor.type).toBe("llm");
		expect(chain.steps[0]?.lastMutation?.actor.id).toBe("agent-7");
	});

	it("includes lastMutation for unguarded nodes when actor is provided", () => {
		// QA fix A1: actor attribution no longer requires a guard.
		const g = new Graph("g");
		g.add("a", state<number>(0, { name: "a" })); // no guard
		g.set("a", 9, { actor: { type: "human", id: "alice" } });
		const chain = g.explain("a", "a");
		expect(chain.steps[0]?.lastMutation?.actor.id).toBe("alice");
	});

	it("findCycle: returns shortest cycle when from === to and a cycle exists", () => {
		// a → b → a (feedback)
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = state(2, { name: "b" });
		g.add("a", a);
		g.add("b", b);
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
});
