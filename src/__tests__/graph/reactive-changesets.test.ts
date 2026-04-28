/**
 * Tier 1.5.1 (`describe({ reactive: "diff" })`) + Tier 1.5.2
 * (`observe({ reactive: true })` + `tiers`) coverage.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { type DescribeChangeset, topologyDiff } from "../../extra/composition/topology-diff.js";
import { Graph, type GraphDescribeOutput, type ObserveChangeset } from "../../graph/graph.js";

const emptySnap = (name = "g"): GraphDescribeOutput => ({
	name,
	nodes: {},
	edges: [],
	subgraphs: [],
});

describe("topologyDiff (pure function)", () => {
	it("returns empty events for identical snapshots", () => {
		const snap = emptySnap();
		const result = topologyDiff(snap, snap);
		expect(result.events).toEqual([]);
		expect(typeof result.flushedAt_ns).toBe("number");
	});

	it("emits node-added for new nodes (sorted)", () => {
		const prev = emptySnap();
		const next: GraphDescribeOutput = {
			...emptySnap(),
			nodes: {
				b: { type: "state", deps: [] },
				a: { type: "state", deps: [] },
			},
		};
		const result = topologyDiff(prev, next);
		expect(result.events).toHaveLength(2);
		expect(result.events[0]).toMatchObject({ type: "node-added", path: "a" });
		expect(result.events[1]).toMatchObject({ type: "node-added", path: "b" });
	});

	it("emits node-removed for missing nodes", () => {
		const prev: GraphDescribeOutput = {
			...emptySnap(),
			nodes: { a: { type: "state", deps: [] } },
		};
		const next = emptySnap();
		const result = topologyDiff(prev, next);
		expect(result.events).toEqual([{ type: "node-removed", path: "a" }]);
	});

	it("emits node-meta-changed when meta differs", () => {
		const prev: GraphDescribeOutput = {
			...emptySnap(),
			nodes: { a: { type: "state", deps: [], meta: { x: 1 } } },
		};
		const next: GraphDescribeOutput = {
			...emptySnap(),
			nodes: { a: { type: "state", deps: [], meta: { x: 2 } } },
		};
		const result = topologyDiff(prev, next);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({
			type: "node-meta-changed",
			path: "a",
			prevMeta: { x: 1 },
			nextMeta: { x: 2 },
		});
	});

	it("treats deep-equal meta as unchanged", () => {
		const prev: GraphDescribeOutput = {
			...emptySnap(),
			nodes: { a: { type: "state", deps: [], meta: { x: { y: 1 } } } },
		};
		const next: GraphDescribeOutput = {
			...emptySnap(),
			nodes: { a: { type: "state", deps: [], meta: { x: { y: 1 } } } },
		};
		expect(topologyDiff(prev, next).events).toEqual([]);
	});

	it("emits edge-added and edge-removed", () => {
		const prev: GraphDescribeOutput = {
			...emptySnap(),
			edges: [{ from: "a", to: "b" }],
		};
		const next: GraphDescribeOutput = {
			...emptySnap(),
			edges: [{ from: "b", to: "c" }],
		};
		const result = topologyDiff(prev, next);
		const types = result.events.map((e) => e.type);
		expect(types).toEqual(["edge-added", "edge-removed"]);
	});

	it("emits subgraph-mounted and subgraph-unmounted", () => {
		const prev: GraphDescribeOutput = { ...emptySnap(), subgraphs: ["sub-a"] };
		const next: GraphDescribeOutput = { ...emptySnap(), subgraphs: ["sub-b"] };
		const result = topologyDiff(prev, next);
		const types = result.events.map((e) => e.type);
		expect(types).toContain("subgraph-mounted");
		expect(types).toContain("subgraph-unmounted");
	});

	it("flushedAt_ns is monotonic across calls", () => {
		const snap = emptySnap();
		const a = topologyDiff(snap, snap);
		const b = topologyDiff(snap, snap);
		expect(b.flushedAt_ns).toBeGreaterThanOrEqual(a.flushedAt_ns);
	});
});

describe("Graph.describe({ reactive: 'diff' })", () => {
	it("seeds the initial cache with a synthetic full-add diff", () => {
		const g = new Graph("g");
		const a = state(1);
		g.add(a, { name: "a" });

		const handle = g.describe({ reactive: "diff" });
		const initial = handle.node.cache as DescribeChangeset | undefined;
		expect(initial).toBeDefined();
		const paths = initial?.events
			.filter((e) => e.type === "node-added")
			.map((e) => (e as { path: string }).path);
		expect(paths).toContain("a");

		handle.dispose();
	});

	it("emits a non-empty changeset on topology change", () => {
		const g = new Graph("g");
		const a = state(1);
		g.add(a, { name: "a" });

		const handle = g.describe({ reactive: "diff" });
		const changesets: DescribeChangeset[] = [];
		const off = handle.node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) changesets.push(m[1] as DescribeChangeset);
			}
		});

		// Initial cache push-on-subscribe ⇒ at least one changeset.
		const initialCount = changesets.length;
		expect(initialCount).toBeGreaterThanOrEqual(1);

		// Add another node — should fire a new diff after coalescing.
		const b = state(2);
		g.add(b, { name: "b" });

		expect(changesets.length).toBeGreaterThan(initialCount);
		const last = changesets[changesets.length - 1]!;
		const addedPaths = last.events
			.filter((e) => e.type === "node-added")
			.map((e) => (e as { path: string }).path);
		expect(addedPaths).toContain("b");

		off();
		handle.dispose();
	});
});

describe("Graph.observe({ reactive: true })", () => {
	it("emits an ObserveChangeset wrapping observed events", () => {
		const g = new Graph("g");
		const a = state<number | null>(null);
		g.add(a, { name: "a" });

		const node = g.observe({ reactive: true });
		const changesets: ObserveChangeset[] = [];
		const off = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) changesets.push(m[1] as ObserveChangeset);
			}
		});

		a.emit(42);

		// At least one changeset; events include a "data" entry.
		expect(changesets.length).toBeGreaterThan(0);
		const allEvents = changesets.flatMap((c) => c.events);
		expect(allEvents.some((e) => e.type === "data")).toBe(true);
		expect(typeof changesets[0]!.flushedAt_ns).toBe("number");

		off();
	});

	it("delivers events from multiple sources fired in one batch", () => {
		const g = new Graph("g");
		const a = state<number | null>(null);
		const b = state<number | null>(null);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const node = g.observe({ reactive: true });
		const allEvents: ObserveChangeset["events"][number][] = [];
		const off = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const cs = m[1] as ObserveChangeset;
					allEvents.push(...cs.events);
				}
			}
		});

		batch(() => {
			a.emit(1);
			b.emit(2);
		});

		// Both sources' DATA events should surface across the changesets.
		const paths = new Set(allEvents.filter((e) => e.type === "data").map((e) => e.path));
		expect(paths.has("a")).toBe(true);
		expect(paths.has("b")).toBe(true);

		off();
	});

	it("filters events by tiers", () => {
		const g = new Graph("g");
		const a = state<number | null>(null);
		g.add(a, { name: "a" });

		// "data" events excluded — only "error" / "complete" / "teardown".
		const node = g.observe({ reactive: true, tiers: ["error", "complete", "teardown"] });
		const changesets: ObserveChangeset[] = [];
		const off = node.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) changesets.push(m[1] as ObserveChangeset);
			}
		});

		a.emit(42);

		// "data" event filtered out before accumulation; no changeset emits.
		expect(changesets).toEqual([]);

		off();
	});
});
