import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { Graph, type TopologyEvent } from "../../graph/index.js";

function collectTopology(g: Graph): {
	events: TopologyEvent[];
	stop: () => void;
} {
	const events: TopologyEvent[] = [];
	const off = g.topology.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) events.push(m[1] as TopologyEvent);
		}
	});
	return { events, stop: off };
}

describe("Graph.topology (structural-change companion)", () => {
	it("emits { added, node } on add()", () => {
		const g = new Graph("g");
		const { events, stop } = collectTopology(g);
		g.add(state(1), { name: "a" });
		expect(events).toEqual([{ kind: "added", name: "a", nodeKind: "node" }]);
		stop();
	});

	it("emits { added, mount } on mount()", () => {
		const parent = new Graph("parent");
		const { events, stop } = collectTopology(parent);
		const child = new Graph("child");
		parent.mount("kids", child);
		expect(events).toEqual([{ kind: "added", name: "kids", nodeKind: "mount" }]);
		stop();
	});

	it("emits { removed, node, audit } on remove() of a local node", () => {
		const g = new Graph("g");
		g.add(state(1), { name: "a" });
		const { events, stop } = collectTopology(g);
		g.remove("a");
		expect(events).toHaveLength(1);
		const e = events[0]!;
		expect(e.kind).toBe("removed");
		expect(e.name).toBe("a");
		expect(e.nodeKind).toBe("node");
		if (e.kind === "removed") {
			expect(e.audit).toEqual({ kind: "node", nodes: ["a"], mounts: [] });
		}
		stop();
	});

	it("emits { removed, mount, audit } on unmount", () => {
		const parent = new Graph("parent");
		const child = new Graph("child");
		child.add(state(0), { name: "x" });
		parent.mount("kids", child);
		const { events, stop } = collectTopology(parent);
		parent.remove("kids");
		expect(events).toHaveLength(1);
		const e = events[0]!;
		expect(e.kind).toBe("removed");
		expect(e.name).toBe("kids");
		expect(e.nodeKind).toBe("mount");
		if (e.kind === "removed") {
			expect(e.audit.kind).toBe("mount");
			expect(e.audit.mounts).toContain("kids");
			expect(e.audit.nodes).toContain("x");
		}
		stop();
	});

	it("is silent at construction — constructor does not emit", () => {
		const g = new Graph("g");
		const { events, stop } = collectTopology(g);
		// No mutations, no events.
		expect(events).toEqual([]);
		stop();
	});

	it("does not emit for value mutations (only structural changes)", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		g.add(a, { name: "a" });
		const { events, stop } = collectTopology(g);
		a.emit(1);
		a.emit(2);
		expect(events).toEqual([]);
		stop();
	});

	it("does not emit events that happened before first subscription (no retention)", () => {
		const g = new Graph("g");
		g.add(state(1), { name: "a" });
		g.add(state(2), { name: "b" });
		const { events, stop } = collectTopology(g);
		// Late subscriber sees only subsequent events.
		expect(events).toEqual([]);
		g.add(state(3), { name: "c" });
		expect(events).toEqual([{ kind: "added", name: "c", nodeKind: "node" }]);
		stop();
	});

	it("own-graph only — parent topology does NOT emit for changes inside a mounted child", () => {
		const parent = new Graph("parent");
		const child = new Graph("child");
		parent.mount("kids", child);
		const { events, stop } = collectTopology(parent);
		child.add(state(0), { name: "x" });
		// parent sees no event — the add happened on `child`, not `parent`.
		expect(events).toEqual([]);
		// child's own topology does see it
		const childObs = collectTopology(child);
		child.add(state(1), { name: "y" });
		expect(childObs.events).toEqual([{ kind: "added", name: "y", nodeKind: "node" }]);
		childObs.stop();
		stop();
	});

	it("does not emit on failed add() (name collision) — emit only after successful registration", () => {
		const g = new Graph("g");
		g.add(state(1), { name: "a" });
		const { events, stop } = collectTopology(g);
		expect(() => g.add(state(2), { name: "a" })).toThrow(/already exists/);
		expect(events).toEqual([]);
		stop();
	});

	it("does not emit on failed mount() (cycle / reparent / collision)", () => {
		const parent = new Graph("parent");
		const child = new Graph("child");
		parent.mount("kids", child);
		const { events, stop } = collectTopology(parent);
		// Reparent rejection
		expect(() => parent.mount("kids2", child)).toThrow(/already mounted/);
		expect(events).toEqual([]);
		stop();
	});

	it("lazy: accessing .topology without subscribing does not activate the producer", () => {
		const g = new Graph("g");
		// Access the node (creates it) but do not subscribe.
		const topology = g.topology;
		expect(topology).toBeDefined();
		// Perform mutations — nothing should be observable since no sink exists.
		g.add(state(1), { name: "a" });
		g.add(state(2), { name: "b" });
		// Subscribe AFTER mutations — no retention of past events.
		const { events, stop } = collectTopology(g);
		expect(events).toEqual([]);
		stop();
	});

	it("same Node reference across accesses (getter is cached)", () => {
		const g = new Graph("g");
		const t1 = g.topology;
		const t2 = g.topology;
		expect(t1).toBe(t2);
	});

	it("multiple subscribers each receive each event", () => {
		const g = new Graph("g");
		const a = collectTopology(g);
		const b = collectTopology(g);
		g.add(state(0), { name: "x" });
		expect(a.events).toEqual([{ kind: "added", name: "x", nodeKind: "node" }]);
		expect(b.events).toEqual([{ kind: "added", name: "x", nodeKind: "node" }]);
		a.stop();
		b.stop();
	});

	it("removeAll() emits one 'removed' event per removed entry", () => {
		const g = new Graph("g");
		g.add(state(1), { name: "a" });
		g.add(state(2), { name: "b" });
		g.add(state(3), { name: "c" });
		const { events, stop } = collectTopology(g);
		g.removeAll((name) => name !== "b");
		// Should see two "removed" events for a and c
		expect(events.filter((e) => e.kind === "removed")).toHaveLength(2);
		const names = events.filter((e) => e.kind === "removed").map((e) => e.name);
		expect(names.sort()).toEqual(["a", "c"]);
		stop();
	});

	it("interleaved add + remove yields correct event sequence", () => {
		const g = new Graph("g");
		const { events, stop } = collectTopology(g);
		g.add(state(1), { name: "a" });
		g.add(state(2), { name: "b" });
		g.remove("a");
		g.add(state(3), { name: "c" });
		expect(events.map((e) => `${e.kind}:${e.name}`)).toEqual([
			"added:a",
			"added:b",
			"removed:a",
			"added:c",
		]);
		stop();
	});
});
