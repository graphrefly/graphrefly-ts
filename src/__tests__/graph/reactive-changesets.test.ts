/**
 * Tier 1.5.1 (`describe({ reactive: "diff" })`) + Tier 1.5.2
 * (`observe({ reactive: true })` + `tiers`) + Tier 1.5.D2
 * (`observe({ changeset: true })`) coverage.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";

import { type DescribeChangeset, topologyDiff } from "../../extra/composition/topology-diff.js";
import type { GraphChange } from "../../graph/changeset.js";
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
		const a = node([], { initial: 1 });
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
		const a = node([], { initial: 1 });
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
		const b = node([], { initial: 2 });
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
		const a = node<number | null>([], { initial: null });
		g.add(a, { name: "a" });

		const observeNode = g.observe({ reactive: true });
		const changesets: ObserveChangeset[] = [];
		const off = observeNode.subscribe((msgs) => {
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
		const a = node<number | null>([], { initial: null });
		const b = node<number | null>([], { initial: null });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const observeNode = g.observe({ reactive: true });
		const allEvents: ObserveChangeset["events"][number][] = [];
		const off = observeNode.subscribe((msgs) => {
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
		const a = node<number | null>([], { initial: null });
		g.add(a, { name: "a" });

		// "data" events excluded — only "error" / "complete" / "teardown".
		const observeNode = g.observe({ reactive: true, tiers: ["error", "complete", "teardown"] });
		const changesets: ObserveChangeset[] = [];
		const off = observeNode.subscribe((msgs) => {
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

describe("Graph.observe({ changeset: true })", () => {
	const collect = (graph: Graph): { all: GraphChange[]; off: () => void } => {
		const changesetNode = graph.observe({ changeset: true });
		const all: GraphChange[] = [];
		const off = changesetNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) all.push(m[1] as GraphChange);
			}
		});
		return { all, off };
	};

	it("emits node-added topology events when a node lands on the graph", () => {
		const g = new Graph("g");
		const { all, off } = collect(g);

		const a = node([], { initial: 0 });
		g.add(a, { name: "a" });

		const added = all.filter((e) => e.type === "node-added");
		expect(added.length).toBeGreaterThan(0);
		expect(added.some((e) => e.scope === "a")).toBe(true);

		off();
	});

	it("emits a data event with fromPath/fromDepIndex attributing the upstream edge", () => {
		const g = new Graph("g");
		const a = node<number>([], { name: "a", initial: 1 });
		g.add(a, { name: "a" });
		// derived depends on a — when a emits, derived recomputes and we
		// should see a data event scoped to "d" with fromPath "a", fromDepIndex 0.
		g.derived("d", ["a"], (data, ctx) => {
			const batch0 = data[0];
			const v = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
			return [(v as number) * 2];
		});

		const { all, off } = collect(g);
		// Activate the derived node so the changeset stream subscribes through.
		const dNode = g.node("d");
		const offD = dNode.subscribe(() => {});

		// Reset accumulator — only care about changes after subscription kicks
		// the network, so we collect the next emission cleanly.
		all.length = 0;

		g.set("a", 7);

		const dEvents = all.filter((e) => e.type === "data" && e.scope === "d");
		expect(dEvents.length).toBeGreaterThan(0);
		const ev = dEvents[0];
		if (ev.type !== "data") throw new Error("unreachable");
		expect(ev.fromPath).toBe("a");
		expect(ev.fromDepIndex).toBe(0);
		expect(ev.value).toBe(14);

		offD();
		off();
	});

	it("data events from source nodes carry fromDepIndex: -1 (no upstream dep)", () => {
		const g = new Graph("g");
		const a = node<number | null>([], { name: "a", initial: null });
		g.add(a, { name: "a" });
		const { all, off } = collect(g);

		all.length = 0;
		a.emit(99);

		const dataEvents = all.filter((e) => e.type === "data" && e.scope === "a");
		expect(dataEvents.length).toBe(1);
		const ev = dataEvents[0];
		if (ev.type !== "data") throw new Error("unreachable");
		expect(ev.fromDepIndex).toBe(-1);
		expect(ev.fromPath).toBe("a");
		expect(ev.value).toBe(99);

		off();
	});

	it("envelope `version` is monotonic across all events", () => {
		const g = new Graph("g");
		const a = node<number>([], { name: "a", initial: 0 });
		g.add(a, { name: "a" });
		g.derived("d", ["a"], (data, ctx) => {
			const batch0 = data[0];
			const v = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
			return [(v as number) + 1];
		});

		const { all, off } = collect(g);
		g.node("d").subscribe(() => {});

		batch(() => {
			g.set("a", 1);
			g.set("a", 2);
			g.set("a", 3);
		});

		// Strictly increasing version stamps.
		for (let i = 1; i < all.length; i++) {
			expect(all[i].version).toBeGreaterThan(all[i - 1].version);
		}
		off();
	});

	it("wraps a batch in batch-start / batch-end with payload events between", () => {
		const g = new Graph("g");
		const a = node<number | null>([], { name: "a", initial: null });
		const b = node<number | null>([], { name: "b", initial: null });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const { all, off } = collect(g);
		all.length = 0;

		batch(() => {
			a.emit(1);
			b.emit(2);
		});

		// Inside a batch each upstream delivery wave gets one
		// batch-start / batch-end pair. With two distinct sources `a` and `b`,
		// the runtime delivers two coalesced waves (one per source), so we
		// expect ≥2 frame pairs. The pairing invariants — equal counts,
		// strictly nested versions, every data event inside a frame — are
		// what the design guarantees.
		const batchStarts = all.filter((e) => e.type === "batch-start");
		const batchEnds = all.filter((e) => e.type === "batch-end");
		expect(batchStarts.length).toBeGreaterThan(0);
		expect(batchStarts.length).toBe(batchEnds.length);
		// Versions strictly nested per frame: bs[i] < be[i] < bs[i+1].
		for (let i = 0; i < batchStarts.length; i++) {
			expect(batchStarts[i].version).toBeLessThan(batchEnds[i].version);
			if (i > 0) {
				expect(batchEnds[i - 1].version).toBeLessThan(batchStarts[i].version);
			}
		}
		// At least one data event in the wrapped region overall.
		const dataEvents = all.filter((e) => e.type === "data");
		expect(dataEvents.length).toBeGreaterThan(0);
		// Every data event must lie inside SOME frame.
		for (const ev of dataEvents) {
			const enclosing = batchStarts.findIndex(
				(bs, i) =>
					bs.version < ev.version && ev.version < (batchEnds[i]?.version ?? Number.POSITIVE_INFINITY),
			);
			expect(enclosing).toBeGreaterThanOrEqual(0);
		}
		off();
	});

	it("emits node-removed when a node is removed", () => {
		const g = new Graph("g");
		const a = node([], { initial: 0 });
		g.add(a, { name: "a" });

		const { all, off } = collect(g);
		all.length = 0;
		g.remove("a");

		const removed = all.filter((e) => e.type === "node-removed");
		expect(removed.length).toBeGreaterThan(0);
		expect(removed.some((e) => e.scope === "a")).toBe(true);
		off();
	});

	it("emits mount / unmount for child subgraphs", () => {
		const g = new Graph("g");
		const child = new Graph("child");

		const { all, off } = collect(g);
		all.length = 0;

		g.mount("child", child);
		const mounts = all.filter((e) => e.type === "mount");
		expect(mounts.length).toBe(1);
		expect(mounts[0].scope).toBe("child");

		all.length = 0;
		g.remove("child");
		const unmounts = all.filter((e) => e.type === "unmount");
		expect(unmounts.length).toBe(1);
		expect(unmounts[0].scope).toBe("child");
		off();
	});

	it("rejects {changeset:true, reactive:true} mutually-exclusive combination", () => {
		const g = new Graph("g");
		expect(() =>
			(g as unknown as { observe: (...args: unknown[]) => unknown }).observe({
				changeset: true,
				reactive: true,
			}),
		).toThrow(/mutually exclusive/);
	});

	// /qa F-1: changeset stream subscribes to nodes added AFTER activation.
	it("/qa F-1: streams data events for nodes added after subscription", () => {
		const g = new Graph("g");
		const { all, off } = collect(g);
		all.length = 0;

		// Add a fresh node post-activation; emit on it; expect data events.
		const late = node<number>([], { initial: 0, equals: () => false });
		g.add(late, { name: "late" });
		all.length = 0; // drop the node-added event
		g.set("late", 42);
		g.set("late", 43);

		const dataEvents = all.filter((e) => e.type === "data" && e.scope === "late");
		expect(dataEvents.length).toBeGreaterThanOrEqual(2);
		off();
	});

	// /qa F-21: subscriptions detach symmetrically on node-removed.
	it("/qa F-21: stops streaming data events after node-removed", () => {
		const g = new Graph("g");
		const { all, off } = collect(g);

		const live = node<number>([], { initial: 0, equals: () => false });
		g.add(live, { name: "live" });
		all.length = 0;
		g.set("live", 1);
		const before = all.filter((e) => e.type === "data" && e.scope === "live").length;
		expect(before).toBeGreaterThan(0);

		g.remove("live");
		// After removal the node detaches; future emissions on the orphaned
		// Node ref must not surface on the changeset stream.
		all.length = 0;
		live.emit(2);
		const after = all.filter((e) => e.type === "data" && e.scope === "live").length;
		expect(after).toBe(0);
		off();
	});

	// /qa F-4: tier whitelist filters topology + batch frame variants.
	it("/qa F-4: tiers: ['data'] filters out topology + batch events", () => {
		const g = new Graph("g");
		const out = g.observe({ changeset: true, tiers: ["data"] });
		const all: GraphChange[] = [];
		const off = out.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) all.push(m[1] as GraphChange);
		});
		const a = node<number>([], { initial: 0, equals: () => false });
		g.add(a, { name: "a" });
		batch(() => {
			g.set("a", 1);
			g.set("a", 2);
		});
		// No topology or batch-frame events should leak through.
		expect(all.some((e) => e.type === "node-added")).toBe(false);
		expect(all.some((e) => e.type === "batch-start")).toBe(false);
		expect(all.some((e) => e.type === "batch-end")).toBe(false);
		// Data events still flow.
		expect(all.some((e) => e.type === "data")).toBe(true);
		off();
	});

	// /qa F-3: GraphChangeNodeAdded carries the resolved describeKind.
	it("/qa F-3: node-added events carry the resolved describeKind", () => {
		const g = new Graph("g");
		const { all, off } = collect(g);

		// Add a state node — its describeKind is "state".
		g.state("s", 0);
		const stateAdded = all.find(
			(e): e is GraphChange & { type: "node-added"; nodeKind?: string } =>
				e.type === "node-added" && e.scope === "s",
		);
		expect(stateAdded).toBeDefined();
		expect(stateAdded?.nodeKind).toBe("state");

		// Add a derived node — describeKind "derived".
		g.derived("d", ["s"], (data, ctx) => {
			const x = data[0]?.[0] ?? ctx.prevData[0]?.[0] ?? 0;
			return [x as number];
		});
		const derivedAdded = all.find(
			(e): e is GraphChange & { type: "node-added"; nodeKind?: string } =>
				e.type === "node-added" && e.scope === "d",
		);
		expect(derivedAdded).toBeDefined();
		expect(derivedAdded?.nodeKind).toBe("derived");
		off();
	});
});
