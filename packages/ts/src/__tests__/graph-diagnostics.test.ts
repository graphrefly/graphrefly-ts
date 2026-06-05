import { describe, expect, it } from "vitest";
import {
	type DescribeSnapshot,
	explainPath,
	graph,
	reachable,
	validateNoIslands,
} from "../index.js";

describe("graph diagnostics over DescribeSnapshot (D39/R-describe)", () => {
	it("reachable walks upstream, downstream, and max-depth frontiers deterministically", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.derived([a], (x) => x + 1, { name: "b" });
		g.derived([b], (x) => x + 1, { name: "c" });
		const sink = g.effect([a], () => {}, { name: "sink" });
		sink.subscribe(() => {});

		const snap = g.describe();
		expect(reachable(snap, "c", "upstream")).toEqual(["a", "b"]);
		expect(reachable(snap, "a", "downstream")).toEqual(["b", "c", "sink"]);
		expect(reachable(snap, "b", "upstream", { both: true })).toEqual(["a", "c", "sink"]);

		const detailed = reachable(snap, "a", "downstream", {
			maxDepth: 1,
			withDetail: true,
		});
		expect(detailed).toEqual({
			paths: ["b", "sink"],
			depths: { b: 1, sink: 1 },
			truncated: true,
		});
		expect(reachable(snap, "a", "downstream", { maxDepth: 0, withDetail: true })).toEqual({
			paths: [],
			depths: {},
			truncated: true,
		});
	});

	it("explainPath returns a rich shortest causal chain without changing describe shape", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.derived([a], (x) => x + 1, { name: "b" });
		g.derived([b], (x) => x + 1, { name: "c" });

		const snap = g.describe();
		const chain = explainPath(snap, "a", "c");
		expect(chain.found).toBe(true);
		expect(chain.reason).toBe("ok");
		expect(chain.steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
		expect(chain.steps.map((s) => s.hop)).toEqual([0, 1, 2]);
		expect(chain.steps[0]).toMatchObject({ factory: "state", depIndex: 0 });
		expect(chain.steps[1]).toMatchObject({ factory: "derived", depIndex: 0 });
		expect(chain.text).toBe("a -> b -> c");
		expect(chain.toJSON()).toMatchObject({ from: "a", to: "c", found: true });

		expect(explainPath(snap, "missing", "c").reason).toBe("no-such-from");
		expect(explainPath(snap, "a", "missing").reason).toBe("no-such-to");
		expect(explainPath(snap, "c", "a", { maxDepth: 1 }).reason).toBe("no-path");
	});

	it("validateNoIslands reports mount-aware nodes with zero deps and zero dependents", () => {
		const parent = graph();
		const root = parent.state(0, { name: "root" });
		parent.derived([root], (x) => x, { name: "rootD" });

		const child = graph();
		const leaf = child.state(1, { name: "leaf" });
		child.derived([leaf], (x) => x, { name: "leafD" });
		child.state(9, { name: "orphan" });
		parent.mount(child, { at: "child" });

		const result = validateNoIslands(parent.describe());
		expect(result.ok).toBe(false);
		expect(result.orphans).toEqual([{ id: "child::orphan", factory: "state" }]);
		expect(result.summary()).toBe("validateNoIslands: 1 island node(s) - child::orphan (state)");
	});

	it("diagnostics also accept synthetic snapshots without requiring a Graph instance", () => {
		const snap: DescribeSnapshot = {
			nodes: [
				{ id: "x", factory: "state", status: "sentinel", deps: [] },
				{ id: "y", factory: "derived", status: "sentinel", deps: [] },
			],
			edges: [{ from: "x", to: "y" }],
		};
		expect(reachable(snap, "x", "downstream")).toEqual(["y"]);
		expect(explainPath(snap, "x", "y").steps.map((s) => s.id)).toEqual(["x", "y"]);
		expect(validateNoIslands(snap).ok).toBe(true);

		const dangling: DescribeSnapshot = {
			nodes: [
				{ id: "x", factory: "state", status: "sentinel", deps: ["missing"] },
				{ id: "y", factory: "derived", status: "sentinel", deps: [] },
			],
			edges: [
				{ from: "x", to: "missing" },
				{ from: "missing", to: "y" },
			],
		};
		expect(reachable(dangling, "x", "downstream")).toEqual([]);
		expect(explainPath(dangling, "x", "y").reason).toBe("no-path");
	});

	it("explainPath findCycle searches for a non-trivial self path in synthetic snapshots", () => {
		const snap: DescribeSnapshot = {
			nodes: [
				{ id: "a", factory: "node", status: "sentinel", deps: ["b"] },
				{ id: "b", factory: "node", status: "sentinel", deps: ["a"] },
			],
			edges: [
				{ from: "b", to: "a" },
				{ from: "a", to: "b" },
			],
		};
		expect(explainPath(snap, "a", "a", { findCycle: true }).steps.map((s) => s.id)).toEqual([
			"a",
			"b",
			"a",
		]);
		expect(explainPath(snap, "a", "a", { findCycle: true, maxDepth: 1 }).reason).toBe(
			"max-depth-exceeded",
		);

		const selfLoop: DescribeSnapshot = {
			nodes: [{ id: "a", factory: "node", status: "sentinel", deps: ["a"] }],
			edges: [{ from: "a", to: "a" }],
		};
		expect(explainPath(selfLoop, "a", "a", { findCycle: true, maxDepth: 0 }).reason).toBe(
			"max-depth-exceeded",
		);
	});
});
