import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/index.js";
import { graphLens, type HealthReport, type TopologyStats } from "../../patterns/lens.js";

function getStatsCache(node: { cache: unknown }): TopologyStats {
	return node.cache as TopologyStats;
}
function getHealthCache(node: { cache: unknown }): HealthReport {
	return node.cache as HealthReport;
}

describe("graphLens — topology stats", () => {
	it("reflects the initial graph shape", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const lens = graphLens(g);
		// Activate
		lens.stats.subscribe(() => {});

		const stats = getStatsCache(lens.stats);
		expect(stats.nodeCount).toBe(2);
		expect(stats.edgeCount).toBe(1);
		expect(stats.sources).toEqual(["a"]);
		expect(stats.sinks).toEqual(["b"]);
		expect(stats.depth).toBe(1);
		expect(stats.hasCycles).toBe(false);
	});

	it("recomputes when a node is added to the target", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const lens = graphLens(g);

		const seen: TopologyStats[] = [];
		lens.stats.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as TopologyStats);
			}
		});

		expect(seen.at(-1)?.nodeCount).toBe(1);
		g.add(state(1, { name: "b" }), { name: "b" });
		expect(seen.at(-1)?.nodeCount).toBe(2);
	});

	it("includes transitively-mounted subgraph nodes in the counts", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const child = new Graph("child");
		child.add(state(1, { name: "x" }), { name: "x" });
		g.mount("kids", child);

		const lens = graphLens(g);
		lens.stats.subscribe(() => {});

		const stats = getStatsCache(lens.stats);
		// a + kids::x
		expect(stats.nodeCount).toBe(2);
		expect(stats.subgraphCount).toBe(1);
		expect(stats.sources.sort()).toEqual(["a", "kids::x"].sort());
	});

	it("recomputes when nodes are added to a mounted subgraph after lens creation", () => {
		const g = new Graph("g");
		const child = new Graph("child");
		g.mount("kids", child);

		const lens = graphLens(g);
		lens.stats.subscribe(() => {});

		expect(getStatsCache(lens.stats).nodeCount).toBe(0);

		// Add into the already-mounted child — transitive subscription should catch this.
		child.add(state(0, { name: "x" }), { name: "x" });
		expect(getStatsCache(lens.stats).nodeCount).toBe(1);
	});

	it("recomputes when a new subgraph is mounted after lens creation", () => {
		const g = new Graph("g");
		const lens = graphLens(g);
		lens.stats.subscribe(() => {});

		const child = new Graph("late");
		child.add(state(0), { name: "x" });
		g.mount("late", child);
		expect(getStatsCache(lens.stats).nodeCount).toBe(1);

		// Add a second node to the newly-mounted child — auto-wired subscription.
		child.add(state(0), { name: "y" });
		expect(getStatsCache(lens.stats).nodeCount).toBe(2);
	});
});

describe("graphLens — health", () => {
	it("ok=true when no nodes are errored", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const lens = graphLens(g);
		lens.health.subscribe(() => {});
		expect(getHealthCache(lens.health).ok).toBe(true);
		expect(getHealthCache(lens.health).problems).toHaveLength(0);
	});

	it("flips to ok=false with a problem entry when a node errors", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived(
			[a],
			([v]) => {
				if ((v as number) < 0) throw new Error("negative");
				return (v as number) + 1;
			},
			{ name: "b" },
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const lens = graphLens(g);
		lens.health.subscribe(() => {});
		expect(getHealthCache(lens.health).ok).toBe(true);

		a.emit(-1); // triggers b's fn to throw → b errors
		const report = getHealthCache(lens.health);
		expect(report.ok).toBe(false);
		expect(report.problems).toHaveLength(1);
		expect(report.problems[0]?.path).toBe("b");
		expect(report.problems[0]?.status).toBe("errored");
	});

	it("sets upstreamCause when the error originates upstream", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived(
			[a],
			([v]) => {
				if ((v as number) < 0) throw new Error("from b");
				return (v as number) + 1;
			},
			{ name: "b" },
		);
		// c depends on b — if b errors, c also errors via ERROR propagation
		const c = derived([b], ([v]) => (v as number) * 2, { name: "c" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });

		const lens = graphLens(g);
		lens.health.subscribe(() => {});

		a.emit(-1);
		const report = getHealthCache(lens.health);
		expect(report.ok).toBe(false);
		const cProblem = report.problems.find((p) => p.path === "c");
		expect(cProblem?.upstreamCause).toBe("b");
	});
});

describe("graphLens — flow (reactiveMap)", () => {
	it("counts DATA emissions per path via sync .get()", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		g.add(a, { name: "a" });

		const lens = graphLens(g);
		// Subscribe to entries so `observe()` + flow map stay active
		lens.flow.entries.subscribe(() => {});

		a.emit(1);
		a.emit(2);
		a.emit(3);

		const entry = lens.flow.get("a");
		// The initial subscription state push counts as a data event too; we just
		// assert that the counter is monotonic and ≥ 3.
		expect(entry?.count).toBeGreaterThanOrEqual(3);
		expect(entry?.lastUpdate_ns).not.toBeNull();
	});

	it("exposes O(1) size + has queries", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		g.add(state(0, { name: "b" }), { name: "b" });

		const lens = graphLens(g);
		lens.flow.entries.subscribe(() => {});

		g.set("a", 1);
		g.set("b", 1);

		expect(lens.flow.size).toBe(2);
		expect(lens.flow.has("a")).toBe(true);
		expect(lens.flow.has("nonexistent")).toBe(false);
	});

	it("pathFilter scopes which paths are tracked", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		g.add(state(0, { name: "b" }), { name: "b" });

		const lens = graphLens(g, { pathFilter: (p) => p === "a" });
		lens.flow.entries.subscribe(() => {});

		g.set("a", 1);
		g.set("b", 1);

		expect(lens.flow.has("a")).toBe(true);
		expect(lens.flow.has("b")).toBe(false);
	});

	it("drops per-path entries when a node is removed", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		g.add(state(0, { name: "b" }), { name: "b" });

		const lens = graphLens(g);
		lens.flow.entries.subscribe(() => {});
		g.set("a", 1);
		g.set("b", 1);

		expect(lens.flow.has("b")).toBe(true);

		g.remove("b");
		expect(lens.flow.has("b")).toBe(false);
	});

	it("maxFlowPaths caps the map via LRU eviction", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		g.add(state(0, { name: "b" }), { name: "b" });
		g.add(state(0, { name: "c" }), { name: "c" });

		const lens = graphLens(g, { maxFlowPaths: 2 });
		lens.flow.entries.subscribe(() => {});

		g.set("a", 1);
		g.set("b", 1);
		g.set("c", 1); // evicts "a" (LRU — `a` hasn't been touched since its set)

		expect(lens.flow.size).toBeLessThanOrEqual(2);
		expect(lens.flow.has("c")).toBe(true);
	});

	it("uses qualified path keys for transitively-mounted nodes", () => {
		const g = new Graph("g");
		const child = new Graph("child");
		g.mount("kids", child);
		child.add(state(0, { name: "x" }), { name: "x" });

		const lens = graphLens(g);
		lens.flow.entries.subscribe(() => {});
		child.set("x", 1);

		// Key should be "kids::x", not "x"
		expect(lens.flow.has("kids::x")).toBe(true);
		expect(lens.flow.has("x")).toBe(false);
	});

	it("mount-removal wipes all entries belonging to the unmounted subtree", () => {
		const g = new Graph("g");
		const child = new Graph("child");
		g.mount("kids", child);
		child.add(state(0, { name: "x" }), { name: "x" });
		child.add(state(0, { name: "y" }), { name: "y" });

		const lens = graphLens(g);
		lens.flow.entries.subscribe(() => {});
		child.set("x", 1);
		child.set("y", 1);
		expect(lens.flow.has("kids::x")).toBe(true);
		expect(lens.flow.has("kids::y")).toBe(true);

		g.remove("kids");
		expect(lens.flow.has("kids::x")).toBe(false);
		expect(lens.flow.has("kids::y")).toBe(false);
	});
});

describe("graphLens — why", () => {
	it("returns a live CausalChain node that recomputes on mutation", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.observe("b").subscribe(() => {});

		const lens = graphLens(g);
		const { node, dispose } = lens.why("a", "b");
		node.subscribe(() => {});

		const chain1 = node.cache as { found: boolean; steps: { value: unknown }[] };
		expect(chain1.found).toBe(true);
		expect(chain1.steps[0]?.value).toBe(1);
		expect(chain1.steps[1]?.value).toBe(2);

		a.emit(5);
		const chain2 = node.cache as { found: boolean; steps: { value: unknown }[] };
		expect(chain2.steps[0]?.value).toBe(5);
		expect(chain2.steps[1]?.value).toBe(10);

		dispose();
	});
});

describe("graphLens — lifecycle", () => {
	it("destroy disposes every internal subscription", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const lens = graphLens(g);
		lens.stats.subscribe(() => {});
		lens.health.subscribe(() => {});
		lens.flow.entries.subscribe(() => {});
		// Just call destroy — if a handler leaked it would throw or corrupt later asserts.
		lens.destroy();
		// Mutate after destroy; lens should not react (no assertion beyond "no crash").
		g.add(state(1), { name: "b" });
		g.set("a", 99);
	});
});
