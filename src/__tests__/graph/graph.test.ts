import { describe, expect, it } from "vitest";
import { DEFAULT_ACTOR } from "../../core/actor.js";
import { batch } from "../../core/batch.js";
import { GuardDenied, policy } from "../../core/guard.js";
import { COMPLETE, DATA, DIRTY, PAUSE, RESUME, TEARDOWN } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { derived, effect, producer, state } from "../../core/sugar.js";
import {
	GRAPH_META_SEGMENT,
	Graph,
	type GraphPersistSnapshot,
	type ObserveResult,
	reachable,
} from "../../graph/graph.js";
import { assertDescribeMatchesAppendixB } from "./validate-describe-appendix-b.js";

describe("Graph (Phase 1.1)", () => {
	it("Graph(name) and empty name throws", () => {
		const g = new Graph("app");
		expect(g.name).toBe("app");
		expect(() => new Graph("")).toThrow(/non-empty/);
	});

	it("add / remove / node / get / set", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		g.add(a, { name: "a" });
		expect(g.get("a")).toBe(1);
		g.set("a", 2);
		expect(g.get("a")).toBe(2);
		expect(g.node("a")).toBe(a);
		g.remove("a");
		expect(() => g.node("a")).toThrow(/unknown node/);
	});

	it("add duplicate name throws", () => {
		const g = new Graph("g");
		const n = state(0);
		g.add(n, { name: "x" });
		expect(() => g.add(state(1), { name: "x" })).toThrow(/already exists/);
	});

	it("add duplicate node instance throws", () => {
		const g = new Graph("g");
		const n = state(0);
		g.add(n, { name: "x" });
		expect(() => g.add(n, { name: "y" })).toThrow(/already registered/);
	});

	it("remove sends TEARDOWN", () => {
		const g = new Graph("g");
		const n = state(0);
		const seen: symbol[] = [];
		n.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		g.add(n, { name: "n" });
		g.remove("n");
		expect(seen).toContain(TEARDOWN);
	});

	it("remove removes node and derived edges go with it", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		expect(g.edges().length).toBe(1);
		g.remove("a");
		// `a` is gone from _nodes, so the derived edge a→b no longer surfaces
		// (`edges()` only emits edges where both endpoints resolve to a
		// registered node in the tree).
		expect(g.edges()).toEqual([]);
	});

	it("set on graph drives derived value (wiring via deps)", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		b.subscribe(() => {
			/* ensure b is connected upstream */
		});
		g.set("a", 3);
		expect(g.get("b")).toBe(6);
	});

	it("empty local name throws on add", () => {
		const g = new Graph("g");
		expect(() => g.add(state(0), { name: "" })).toThrow(/non-empty/);
	});

	it("edges() returns edges derived from constructor deps", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		// Derived from b's _deps — no explicit connect() call needed.
		expect(g.edges()).toEqual([["a", "b"]]);
	});

	it("single colon in names is allowed", () => {
		const g = new Graph("g");
		const n = state(0);
		g.add(n, { name: "my:node" });
		expect(g.node("my:node")).toBe(n);
		expect(g.get("my:node")).toBe(0);
		g.set("my:node", 5);
		expect(g.get("my:node")).toBe(5);
	});

	it("Graph name with single colon is allowed", () => {
		const g = new Graph("app:v2");
		expect(g.name).toBe("app:v2");
	});

	it("Graph name with :: throws", () => {
		expect(() => new Graph("a::b")).toThrow(/must not contain/);
	});
});

describe("Graph composition (Phase 1.2)", () => {
	it("mount + resolve by relative path", () => {
		const root = new Graph("app");
		const child = new Graph("payment");
		const n = state(7, { name: "amount" });
		child.add(n, { name: "amount" });
		root.mount("payment", child);
		expect(root.resolve("payment::amount")).toBe(n);
		expect(root.resolve("payment::amount").cache).toBe(7);
	});

	it("resolve strips leading graph name when it matches this.name", () => {
		const root = new Graph("app");
		const child = new Graph("pay");
		const n = state(1, { name: "x" });
		child.add(n, { name: "x" });
		root.mount("payment", child);
		expect(root.resolve("app::payment::x")).toBe(n);
	});

	it("resolve on child strips child graph name prefix", () => {
		const child = new Graph("pay");
		const n = state(2, { name: "x" });
		child.add(n, { name: "x" });
		expect(child.resolve("pay::x")).toBe(n);
		expect(child.resolve("x")).toBe(n);
	});

	it("resolve throws when path ends at subgraph", () => {
		const root = new Graph("app");
		const child = new Graph("c");
		child.add(state(0), { name: "x" });
		root.mount("sub", child);
		expect(() => root.resolve("sub")).toThrow(/subgraph/);
	});

	it("resolve throws for trailing path after a node name", () => {
		const g = new Graph("g");
		g.add(state(0), { name: "a" });
		expect(() => g.resolve("a::b")).toThrow(/node/);
	});

	it("add after mount at same name throws", () => {
		const root = new Graph("r");
		root.mount("m", new Graph("c"));
		expect(() => root.add(state(0), { name: "m" })).toThrow(/mount/);
	});

	it("mount after add at same name throws", () => {
		const root = new Graph("r");
		root.add(state(0), { name: "m" });
		expect(() => root.mount("m", new Graph("c"))).toThrow(/node/);
	});

	it("mount cycle is rejected", () => {
		const a = new Graph("a");
		const b = new Graph("b");
		a.mount("b", b);
		expect(() => b.mount("a", a)).toThrow(/cycle/);
	});

	it("same child graph instance mounted twice is rejected", () => {
		const root = new Graph("root");
		const child = new Graph("ch");
		child.add(state(0), { name: "n" });
		root.mount("c1", child);
		expect(() => root.mount("c2", child)).toThrow(/already mounted/);
	});

	it("signal reaches nodes inside mounted graphs once per node", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const n = state(0, { name: "n" });
		child.add(n, { name: "n" });
		root.mount("c", child);
		const seen: symbol[] = [];
		n.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		root.signal([[PAUSE, "id1"]]);
		expect(seen.filter((t) => t === PAUSE).length).toBe(1);
	});

	it("signal visits mounts before local nodes", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const order: string[] = [];
		const rootNode = state(0, { name: "rootN" });
		const childNode = state(0, { name: "childN" });
		child.add(childNode, { name: "cn" });
		root.add(rootNode, { name: "rn" });
		root.mount("c", child);
		childNode.subscribe(() => order.push("child"));
		rootNode.subscribe(() => order.push("root"));
		// Clear initial push-on-subscribe emissions
		order.length = 0;
		root.signal([[PAUSE, "x"]]);
		expect(order).toEqual(["child", "root"]);
	});

	it(":: in local add name throws", () => {
		const g = new Graph("g");
		expect(() => g.add(state(0), { name: "a::b" })).toThrow(/path separator/);
	});

	it("single colon in mount name is allowed", () => {
		const root = new Graph("r");
		const child = new Graph("c");
		child.add(state(0), { name: "x" });
		root.mount("my:mount", child);
		expect(root.resolve("my:mount::x").cache).toBe(0);
	});

	it("node / get / set accept :: qualified paths", () => {
		const root = new Graph("app");
		const child = new Graph("sub");
		const n = state(10, { name: "val" });
		child.add(n, { name: "val" });
		root.mount("sub", child);
		expect(root.node("sub::val")).toBe(n);
		expect(root.get("sub::val")).toBe(10);
		root.set("sub::val", 42);
		expect(root.get("sub::val")).toBe(42);
	});

	it("child graph's edges() reflects constructor deps regardless of parent mount", () => {
		const root = new Graph("app");
		const child = new Graph("sub");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		child.add(a, { name: "a" });
		child.add(b, { name: "b" });
		root.mount("sub", child);
		// Derived directly from node _deps — no connect() call needed.
		expect(child.edges()).toEqual([["a", "b"]]);
	});

	it("remove(mount_name) unmounts and sends TEARDOWN through subtree", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const grandchild = new Graph("gc");
		const n1 = state(1, { name: "n1" });
		const n2 = state(2, { name: "n2" });
		child.add(n1, { name: "n1" });
		grandchild.add(n2, { name: "n2" });
		child.mount("gc", grandchild);
		root.mount("child", child);

		const teardowns: string[] = [];
		n1.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === TEARDOWN) teardowns.push("n1");
		});
		n2.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === TEARDOWN) teardowns.push("n2");
		});

		root.remove("child");
		// Both nodes in the subtree should receive TEARDOWN.
		expect(teardowns).toContain("n1");
		expect(teardowns).toContain("n2");
		// Mount should be gone.
		expect(() => root.resolve("child::n1")).toThrow();
	});

	it("remove(mount_name) unmounts subgraph — tree edges drop accordingly", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		root.add(a, { name: "a" });
		child.add(b, { name: "b" });
		root.mount("sub", child);
		// Cross-subgraph edge is derived (b's constructor dep points at a).
		expect(root.edges({ recursive: true }).length).toBe(1);
		root.remove("sub");
		expect(root.edges({ recursive: true })).toEqual([]);
	});
});

describe("Graph introspection (Phase 1.3)", () => {
	it("does not override options.name on add", () => {
		const g = new Graph("g");
		const n = state(1, { name: "keep" });
		g.add(n, { name: "alias" });
		expect(n.name).toBe("keep");
	});

	it("rejects reserved __meta__ for add and mount", () => {
		const g = new Graph("g");
		expect(() => g.add(state(0), { name: GRAPH_META_SEGMENT })).toThrow(/reserved/);
		expect(() => g.mount(GRAPH_META_SEGMENT, new Graph("c"))).toThrow(/reserved/);
	});

	it("describe includes qualified nodes, edges, subgraphs (recursive)", () => {
		const root = new Graph("app");
		const child = new Graph("pay");
		const grandchild = new Graph("inner");
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) + 1);
		child.add(a, { name: "a" });
		child.add(b, { name: "b" });
		grandchild.add(state(0), { name: "x" });
		child.mount("gc", grandchild);
		root.mount("sub", child);
		const d = root.describe();
		expect(d.name).toBe("app");
		expect(d.subgraphs).toEqual(["sub", "sub::gc"]);
		expect(d.nodes["sub::a"]).toMatchObject({ type: "state" });
		expect(d.nodes["sub::b"]).toMatchObject({ type: "derived", deps: ["sub::a"] });
		expect(d.nodes["sub::gc::x"]).toMatchObject({ type: "state" });
		expect(d.edges).toContainEqual({ from: "sub::a", to: "sub::b" });
	});

	it("describe filter supports depsIncludes, metaHas, and path-aware predicate", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a", meta: { label: "input" } });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const byDeps = g.describe({ filter: { depsIncludes: "a" } });
		expect(Object.keys(byDeps.nodes)).toEqual(["b"]);

		const byMeta = g.describe({ detail: "standard", filter: { metaHas: "label" } });
		expect(Object.keys(byMeta.nodes)).toContain("a");
		const byDepsSnake = g.describe({ filter: { deps_includes: "a" } });
		expect(Object.keys(byDepsSnake.nodes)).toEqual(["b"]);
		const byMetaSnake = g.describe({ detail: "standard", filter: { meta_has: "label" } });
		expect(Object.keys(byMetaSnake.nodes)).toContain("a");

		const byPath = g.describe({
			filter: (path, node) => path.startsWith("a") && node.type === "state",
		});
		expect(Object.keys(byPath.nodes)).toContain("a");
	});

	it("metaHas filter at minimal detail excludes all nodes (no meta at minimal)", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a", meta: { label: "input" } }), { name: "a" });
		// Default (minimal) detail omits meta, so metaHas filter matches nothing
		const d = g.describe({ filter: { metaHas: "label" } });
		expect(Object.keys(d.nodes)).toEqual([]);
		g.destroy();
	});

	it("reachable traverses upstream via deps and incoming edges", () => {
		const d = {
			name: "g",
			nodes: {
				a: { type: "state", status: "settled", deps: [], meta: {} },
				b: { type: "derived", status: "settled", deps: ["a"], meta: {} },
				c: { type: "derived", status: "settled", deps: ["b"], meta: {} },
				x: { type: "state", status: "settled", deps: [], meta: {} },
			},
			edges: [{ from: "x", to: "b" }],
			subgraphs: [],
		} satisfies GraphPersistSnapshot;

		expect(reachable(d, "c", "upstream")).toEqual(["a", "b", "x"]);
		expect(reachable(d, "c", "upstream", { maxDepth: 1 })).toEqual(["b"]);
	});

	it("reachable traverses downstream via reverse deps and outgoing edges", () => {
		const d = {
			name: "g",
			nodes: {
				a: { type: "state", status: "settled", deps: [], meta: {} },
				b: { type: "derived", status: "settled", deps: ["a"], meta: {} },
				c: { type: "derived", status: "settled", deps: ["b"], meta: {} },
				sink: { type: "state", status: "settled", deps: [], meta: {} },
			},
			edges: [{ from: "a", to: "sink" }],
			subgraphs: [],
		} satisfies GraphPersistSnapshot;

		expect(reachable(d, "a", "downstream")).toEqual(["b", "c", "sink"]);
		expect(reachable(d, "a", "downstream", { maxDepth: 1 })).toEqual(["b", "sink"]);
	});

	it("reachable validates direction and maxDepth as integer", () => {
		const d = {
			name: "g",
			nodes: { a: { type: "state", status: "settled", deps: [], meta: {} } },
			edges: [],
			subgraphs: [],
		} satisfies GraphPersistSnapshot;

		expect(() => reachable(d, "a", "sideways" as unknown as "upstream")).toThrow(
			/direction must be/,
		);
		expect(() => reachable(d, "a", "upstream", { maxDepth: 1.5 })).toThrow(/integer >= 0/);
		expect(() => reachable(d, "a", "upstream", { maxDepth: -1 })).toThrow(/integer >= 0/);
		expect(reachable(d, "a", "upstream", { maxDepth: 0 })).toEqual([]);
	});

	it("reachable handles unknown start and malformed edge entries", () => {
		// Unit 16 B (batch 8) dropped the full defensive coercion: we now
		// trust top-level GraphDescribeOutput shape (pre-1.0, no legacy
		// snapshots circulating). Minimal guards remain for malformed edge
		// array entries (common when a persisted snapshot loses its schema).
		const malformed = {
			name: "g",
			nodes: { a: { type: "state", status: "settled", deps: ["b"], meta: {} } },
			edges: [{ from: "b", to: "a" }, { from: 1 }, null],
			subgraphs: [],
		} as unknown as GraphPersistSnapshot;
		expect(reachable(malformed, "missing", "upstream")).toEqual([]);
	});

	it("describe lists each meta companion as its own node entry (Python parity)", () => {
		const g = new Graph("g");
		const n = node({ initial: 0, meta: { desc: "purpose" } });
		g.add(n, { name: "n" });
		const d = g.describe({ detail: "standard" });
		const metaKey = `n::${GRAPH_META_SEGMENT}::desc`;
		expect(d.nodes[metaKey]).toMatchObject({ type: "state" });
		expect(d.nodes.n?.meta).toEqual({ desc: "purpose" });
	});

	it("resolve, set, and observe on meta companion path", () => {
		const g = new Graph("g");
		const n = node({ initial: 0, meta: { tag: "x" } });
		g.add(n, { name: "n" });
		const metaPath = `n::${GRAPH_META_SEGMENT}::tag`;
		expect(g.resolve(metaPath).cache).toBe("x");
		const seen: unknown[] = [];
		const off = g.observe(metaPath).subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1]);
			}
		});
		g.set(metaPath, "y");
		off();
		expect(seen).toContain("y");
	});

	it("signal delivers to meta companions", () => {
		const g = new Graph("g");
		const n = node({ initial: 0, meta: { m: 0 } });
		g.add(n, { name: "n" });
		const metaPath = `n::${GRAPH_META_SEGMENT}::m`;
		const types: symbol[] = [];
		g.observe(metaPath).subscribe((msgs) => {
			for (const m of msgs) types.push(m[0] as symbol);
		});
		g.signal([[PAUSE, "id"]]);
		expect(types).toContain(PAUSE);
	});

	it("signal does not duplicate TEARDOWN to meta (parent already cascades)", () => {
		const g = new Graph("g");
		const n = node({ initial: 0, meta: { m: 0 } });
		g.add(n, { name: "n" });
		const metaPath = `n::${GRAPH_META_SEGMENT}::m`;
		let teardowns = 0;
		g.observe(metaPath).subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === TEARDOWN) teardowns += 1;
			}
		});
		g.signal([[TEARDOWN]]);
		expect(teardowns).toBe(1);
	});

	it("observe() sink sees sorted paths for graph.signal", () => {
		const g = new Graph("g");
		g.add(state(0), { name: "b" });
		g.add(state(0), { name: "a" });
		const order: string[] = [];
		g.observe().subscribe((path, msgs) => {
			for (const m of msgs) {
				if (m[0] === PAUSE) order.push(path);
			}
		});
		g.signal([[PAUSE, "z"]]);
		expect(order).toEqual(["a", "b"]);
	});

	it("observe(path, { timeline: true }) includes timestamp and batch context", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const obs = g.observe("b", { timeline: true });
		batch(() => {
			g.set("a", 2);
		});
		obs.dispose();
		const timed = obs.events.filter((e) => e.timestamp_ns != null);
		expect(timed.length).toBeGreaterThan(0);
		expect(obs.events.some((e) => e.in_batch === true)).toBe(true);
		expect(obs.values.b).toBe(3);
	});

	it("observe(path, { causal: true, derived: true }) captures trigger and dep snapshots", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const obs = g.observe("b", { causal: true, derived: true, timeline: true });
		g.set("a", 5);
		obs.dispose();
		const derivedEvents = obs.events.filter((e) => e.type === "derived");
		const derivedEvent = derivedEvents[derivedEvents.length - 1];
		expect(derivedEvent?.dep_values).toEqual([5]);
		// Single-value wave: dep_batches[0] is a 1-element array of the same value.
		expect(derivedEvent?.dep_batches?.[0]).toEqual([5]);
		const dataEvents = obs.events.filter((e) => e.type === "data");
		const dataEvent = dataEvents[dataEvents.length - 1];
		expect(dataEvent?.trigger_dep_index).toBe(0);
		expect(dataEvent?.trigger_dep_name).toBe("a");
		expect(dataEvent?.dep_values).toEqual([5]);
		expect(dataEvent?.dep_batches?.[0]).toEqual([5]);
		expect(obs.values.b).toBe(6);
	});

	it("dep_batches tracks per-dep wave batches", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = state(100, { name: "b" });
		const c = derived([a, b], ([va, vb]) => (va as number) + (vb as number), { name: "c" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(c, { name: "c" });
		const obs = g.observe("c", { causal: true, derived: true });
		// Drive a single wave with both deps updating via batch().
		batch(() => {
			g.set("a", 5);
			g.set("b", 200);
		});
		obs.dispose();
		const derivedEvents = obs.events.filter((e) => e.type === "derived");
		// After the batched update, the most recent derived run should see both
		// deps' batches — each of length 1 (single DATA per dep in this wave).
		const last = derivedEvents[derivedEvents.length - 1];
		expect(last).toBeDefined();
		expect(last?.dep_batches).toBeDefined();
		expect(last?.dep_batches?.length).toBe(2);
		expect(last?.dep_batches?.[0]).toEqual([5]);
		expect(last?.dep_batches?.[1]).toEqual([200]);
		// dep_values holds the last scalar per dep — matches older tooling.
		expect(last?.dep_values).toEqual([5, 200]);
	});

	it("observe(path, { causal: true, derived: true }) includes initial derived run", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const obs = g.observe("b", { causal: true, derived: true, timeline: true });
		g.set("a", 3);
		obs.dispose();
		const derivedEvents = obs.events.filter((e) => e.type === "derived");
		expect(derivedEvents.length).toBeGreaterThanOrEqual(2);
		expect(derivedEvents.some((e) => JSON.stringify(e.dep_values) === JSON.stringify([0]))).toBe(
			true,
		);
		expect(derivedEvents.some((e) => JSON.stringify(e.dep_values) === JSON.stringify([3]))).toBe(
			true,
		);
	});

	it("observe({ structured: true }) on whole graph returns structured result", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });
		g.add(state(2, { name: "b" }), { name: "b" });
		const obs = g.observe({ structured: true, timeline: true });
		g.set("a", 10);
		g.set("b", 20);
		obs.dispose();
		expect(obs.values.a).toBe(10);
		expect(obs.values.b).toBe(20);
		expect(obs.events.some((e) => e.path === "a" && e.type === "data")).toBe(true);
		expect(obs.events.some((e) => e.path === "b" && e.type === "data")).toBe(true);
		expect(obs.events.some((e) => e.timestamp_ns != null)).toBe(true);
	});

	it("toMermaid exports qualified nodes and edges with direction", () => {
		const g = new Graph("g");
		const child = new Graph("child");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		child.add(a, { name: "a" });
		child.add(b, { name: "b" });
		g.mount("sub", child);
		const text = g.describe({ format: "mermaid", direction: "TD" });
		expect(text).toContain("flowchart TD");
		expect(text).toContain('["sub::a"]');
		expect(text).toContain('["sub::b"]');
		expect(text).toContain("-->");
	});

	it("toD2 exports qualified nodes and maps direction", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const text = g.describe({ format: "d2", direction: "RL" });
		expect(text).toContain("direction: left");
		expect(text).toContain('"a"');
		expect(text).toContain('"b"');
		expect(text).toContain("->");
	});

	it("toMermaid rejects invalid direction at runtime", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		expect(() =>
			g.describe({ format: "mermaid", direction: "SIDEWAYS" as unknown as "TD" }),
		).toThrow(/invalid diagram direction/);
	});

	it("toD2 rejects invalid direction at runtime", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		expect(() => g.describe({ format: "d2", direction: "SIDEWAYS" as unknown as "TD" })).toThrow(
			/invalid diagram direction/,
		);
	});

	it("D2: describe({ reactive: true }) returns a reactive handle that recomputes on graph change", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.observe("b").subscribe(() => {});

		const live = g.describe({ reactive: true });
		const unsub = live.node.subscribe(() => {});
		const first = live.node.cache;
		expect(first?.name).toBe("g");
		expect(Object.keys(first?.nodes ?? {}).sort()).toEqual(["a", "b"]);

		// Structural change — add a new node.
		g.add(state(9, { name: "c" }), { name: "c" });
		const next = live.node.cache;
		expect(Object.keys(next?.nodes ?? {})).toContain("c");

		unsub();
		live.dispose();
	});

	it("D2: describe({ reactive: true, format: 'mermaid' }) returns Node<string>", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });
		const live = g.describe({ reactive: true, format: "mermaid" });
		const unsub = live.node.subscribe(() => {});
		expect(typeof live.node.cache).toBe("string");
		expect(live.node.cache).toContain("flowchart");
		unsub();
		live.dispose();
	});

	it("describe({ format: 'mermaid-url' }) emits mermaid.live deep link round-trippable to mermaid source", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const url = g.describe({ format: "mermaid-url" });
		expect(url).toMatch(/^https:\/\/mermaid\.live\/edit#base64:/);
		const b64 = url.slice("https://mermaid.live/edit#base64:".length);
		// url-safe base64 → standard base64 + padding
		let std = b64.replace(/-/g, "+").replace(/_/g, "/");
		while (std.length % 4 !== 0) std += "=";
		const json = JSON.parse(globalThis.atob(std));
		expect(json.code).toContain("flowchart");
		expect(json.code).toContain("-->");
		expect(json.mermaid?.theme).toBe("default");
	});

	it("toMermaid and toD2 render constructor deps without explicit connect", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		// No connect() — deps only
		const mermaid = g.describe({ format: "mermaid" });
		expect(mermaid).toContain("-->");
		const d2 = g.describe({ format: "d2" });
		expect(d2).toContain("->");
	});

	it("trace() silently drops unknown paths and follows inspector gating", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		g.trace("a", "first");
		expect(g.trace().some((e) => e.annotation === "first")).toBe(true);
		// Unit 14 E (batch 8): unknown path → silent drop (matches observe
		// resilience), no throw. The entry is not recorded.
		g.trace("missing", "x");
		expect(g.trace().some((e) => e.annotation === "x")).toBe(false);

		const prev = g.config.inspectorEnabled;
		try {
			g.config.inspectorEnabled = false;
			expect(g.trace()).toEqual([]);
			g.trace("a", "second");
		} finally {
			g.config.inspectorEnabled = prev;
		}
		expect(g.trace().some((e) => e.annotation === "second")).toBe(false);
	});

	it("observe({ format }) logs events with include/exclude filters", () => {
		const g = new Graph("g");
		const logs: string[] = [];
		g.add(state(0, { name: "a" }), { name: "a" });
		const obs = g.observe("a", {
			format: "pretty",
			includeTypes: ["data", "dirty", "resolved"],
			excludeTypes: ["resolved"],
			theme: "none",
			logger: (line) => logs.push(line),
		});
		g.set("a", 1);
		obs.dispose();
		expect(logs.some((line) => line.includes("DATA"))).toBe(true);
		expect(logs.some((line) => line.includes("RESOLVED"))).toBe(false);
	});

	it("observe({ format: 'json' }) supports JSON output in graph-wide mode", () => {
		const g = new Graph("g");
		const lines: string[] = [];
		g.add(state(0, { name: "a" }), { name: "a" });
		g.add(state(0, { name: "b" }), { name: "b" });
		const obs = g.observe({
			format: "json",
			theme: "none",
			logger: (line) => lines.push(line),
		});
		g.set("a", 2);
		g.set("b", 3);
		obs.dispose();
		const parsed = lines.map((line) => JSON.parse(line) as { type?: string; path?: string });
		expect(parsed.some((evt) => evt.type === "data" && evt.path === "a")).toBe(true);
		expect(parsed.some((evt) => evt.type === "data" && evt.path === "b")).toBe(true);
	});

	it("dumpGraph returns pretty text and JSON variants", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const pretty = g.describe({ format: "pretty" });
		expect(pretty).toContain("Graph g");
		expect(pretty).toContain("Nodes:");
		expect(pretty).toContain("Edges:");
		const jsonText = g.describe({ format: "json", indent: 2 });
		expect(jsonText).toBe(g.describe({ format: "json", indent: 2 }));
		const parsed = JSON.parse(jsonText) as {
			name: string;
			nodes: Record<string, unknown>;
			edges: Array<{ from: string; to: string }>;
		};
		expect(parsed.name).toBe("g");
		expect(parsed.nodes.a).toBeDefined();
		expect(parsed.edges).toEqual([{ from: "a", to: "b" }]);
	});
});

describe("Graph lifecycle & persistence (Phase 1.4)", () => {
	it("destroy signals TEARDOWN and clears registries (including mounts)", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const n = state(0, { name: "n" });
		child.add(n, { name: "n" });
		root.mount("c", child);
		const types: symbol[] = [];
		n.subscribe((msgs) => {
			for (const m of msgs) types.push(m[0] as symbol);
		});
		root.destroy();
		expect(types).toContain(TEARDOWN);
		expect(() => root.resolve("c::n")).toThrow();
		expect(root.describe().nodes).toEqual({});
		expect(root.describe().subgraphs).toEqual([]);
	});

	it("snapshot extends describe with version 1", () => {
		const g = new Graph("app");
		g.add(state(1), { name: "z" });
		g.add(state(2), { name: "a" });
		const snap = g.snapshot();
		expect(snap.version).toBe(1);
		expect(snap.name).toBe("app");
		expect(snap.nodes.a?.value).toBe(2);
		expect(snap.nodes.z?.value).toBe(1);
	});

	it("snapshot returns stable output with sorted keys", () => {
		const g = new Graph("g");
		g.add(state(0), { name: "b" });
		g.add(state(0), { name: "a" });
		const o1 = g.snapshot();
		const o2 = g.snapshot();
		expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
		expect(Object.keys(o1.nodes).sort()).toEqual(["a", "b"]);
	});

	it("JSON.stringify(graph) works via toJSON hook", () => {
		const g = new Graph("g");
		g.add(state(0), { name: "b" });
		g.add(state(0), { name: "a" });
		const j1 = JSON.stringify(g);
		const j2 = JSON.stringify(g);
		expect(j1).toBe(j2);
		const parsed = JSON.parse(j1) as GraphPersistSnapshot;
		expect(Object.keys(parsed.nodes).sort()).toEqual(["a", "b"]);
	});

	it("restore applies state (and producer) values; skips derived", () => {
		const g = new Graph("g");
		const a = state(10, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		b.subscribe(() => {});
		const snap = g.snapshot();
		g.set("a", 0);
		expect(g.get("b")).toBe(0);
		g.restore(snap);
		expect(g.get("a")).toBe(10);
		expect(g.get("b")).toBe(20);
	});

	it("restore throws when snapshot name mismatches graph", () => {
		const g = new Graph("one");
		const snap: GraphPersistSnapshot = {
			version: 1,
			name: "other",
			nodes: {},
			edges: [],
			subgraphs: [],
		};
		expect(() => g.restore(snap)).toThrow(/other/);
	});

	it("Graph.fromSnapshot with build restores values", () => {
		const a = state(0, { name: "a" });
		const g0 = new Graph("app");
		g0.add(a, { name: "a" });
		g0.set("a", 7);
		const snap = g0.snapshot();

		const g1 = Graph.fromSnapshot(snap, (g) => {
			g.add(state(0, { name: "a" }), { name: "a" });
		});
		expect(g1.get("a")).toBe(7);
	});

	it("restore sets meta companion paths from snapshot", () => {
		const n0 = node({ initial: 0, meta: { tag: "hi" } });
		const g0 = new Graph("g");
		g0.add(n0, { name: "n" });
		const snap = g0.snapshot();
		const metaPath = `n::${GRAPH_META_SEGMENT}::tag`;

		const n1 = node({ initial: 0, meta: { tag: "" } });
		const g1 = new Graph("g");
		g1.add(n1, { name: "n" });
		g1.restore(snap);
		expect(g1.get(metaPath)).toBe("hi");
	});

	it("attachSnapshotStorage triggers only for messageTier >= 3", async () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const saves: unknown[] = [];
		const tier = {
			name: "test",
			save(data: unknown) {
				saves.push(data);
			},
			debounceMs: 5,
			compactEvery: 2,
		};
		const h = g.attachSnapshotStorage([tier]);
		// Wait for any initial push-on-subscribe checkpoint to drain
		await new Promise((r) => setTimeout(r, 15));
		saves.length = 0;
		g.signal([[PAUSE, "lock"]]);
		await new Promise((r) => setTimeout(r, 15));
		expect(saves.length).toBe(0);
		g.set("a", 1);
		await new Promise((r) => setTimeout(r, 15));
		expect(saves.length).toBe(1);
		h.dispose();
	});

	it("restore supports selective hydration via only pattern", () => {
		const g = new Graph("g");
		g.add(state(1, { name: "a" }), { name: "a" });
		g.add(state(2, { name: "b" }), { name: "b" });
		const snap = g.snapshot();
		g.set("a", 10);
		g.set("b", 20);
		g.restore(snap, { only: "a" });
		expect(g.get("a")).toBe(1);
		expect(g.get("b")).toBe(20);
	});

	it("fromSnapshot reconstructs dynamic nodes via factories option", () => {
		const g0 = new Graph("g");
		const a = state(1, { name: "a" });
		const sum = derived([a], ([v]) => (v as number) + 1, { name: "sum" });
		g0.add(a, { name: "a" });
		g0.add(sum, { name: "sum" });
		sum.subscribe(() => {});
		const snap = g0.snapshot();
		const g1 = Graph.fromSnapshot(snap, {
			factories: {
				sum: (name, ctx) => derived(ctx.resolvedDeps, ([v]) => (v as number) + 1, { name }),
			},
		});
		const s = g1.node("sum");
		s.subscribe(() => {});
		g1.set("a", 5);
		expect(g1.get("sum")).toBe(6);
	});
});

describe("Graph guard (Phase 1.5)", () => {
	const human = { type: "human" as const, id: "u1" };
	const llm = { type: "llm" as const, id: "gpt" };

	it("meta companions inherit primary guard", () => {
		const g = new Graph("g");
		const n = state(0, {
			name: "n",
			meta: { note: "a" },
			guard: policy((allow, deny) => {
				allow("write", { where: (a) => a.type === "human" });
				deny("write", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(n, { name: "n" });
		const metaPath = `n::${GRAPH_META_SEGMENT}::note`;
		g.set(metaPath, "b", { actor: human });
		expect(g.get(metaPath)).toBe("b");
		expect(() => g.set(metaPath, "c", { actor: llm })).toThrow(GuardDenied);
	});

	it("set and signal use write vs signal actions", () => {
		const g = new Graph("g");
		const n = state(0, {
			guard: (_a, action) => action !== "signal",
		});
		g.add(n, { name: "x" });
		expect(() => g.signal([[PAUSE, "p"]])).toThrow(GuardDenied);
		g.set("x", 1, { actor: human });
		expect(g.get("x")).toBe(1);
	});

	it("describe and observe respect observe action", () => {
		const g = new Graph("g");
		const secret = state(0, {
			name: "secret",
			guard: policy((allow, deny) => {
				allow("write");
				allow("observe");
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(secret, { name: "secret" });
		const dLlm = g.describe({ actor: llm });
		expect(dLlm.nodes.secret).toBeUndefined();
		const dHuman = g.describe({ actor: human });
		expect(dHuman.nodes.secret).toBeDefined();

		expect(() => g.observe("secret", { actor: llm })).toThrow(GuardDenied);
		const sub = g.observe("secret", { actor: human }).subscribe(() => {});
		sub();
	});

	// Unit 6 / B.1: GraphDescribeOptions.actor accepts Actor | Node<Actor>.
	it("describe({ actor: Node<Actor> }) static — unwraps current cache", () => {
		const g = new Graph("g");
		const secret = state(0, {
			name: "secret",
			guard: policy((allow, deny) => {
				allow("observe");
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(secret, { name: "secret" });

		const actorNode = state(human, { name: "actor" });
		actorNode.subscribe(() => undefined);

		expect(g.describe({ actor: actorNode }).nodes.secret).toBeDefined();
		actorNode.emit(llm);
		expect(g.describe({ actor: actorNode }).nodes.secret).toBeUndefined();
	});

	it("describe({ reactive: true, actor: Node<Actor> }) re-derives when actor changes", () => {
		const g = new Graph("g");
		const secret = state(0, {
			name: "secret",
			guard: policy((allow, deny) => {
				allow("observe");
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(secret, { name: "secret" });

		const actorNode = state(human, { name: "actor" });
		actorNode.subscribe(() => undefined);

		const handle = g.describe({ reactive: true, actor: actorNode });
		const unsub = handle.node.subscribe(() => undefined);

		// human can observe — secret visible.
		expect((handle.node.cache as { nodes: Record<string, unknown> }).nodes.secret).toBeDefined();

		// Switch actor; describe re-derives and the secret disappears.
		actorNode.emit(llm);
		expect((handle.node.cache as { nodes: Record<string, unknown> }).nodes.secret).toBeUndefined();

		// Back to human — visible again.
		actorNode.emit(human);
		expect((handle.node.cache as { nodes: Record<string, unknown> }).nodes.secret).toBeDefined();

		unsub();
		handle.dispose();
	});

	it("describe({ reactive: true, actor: Node<Actor> }) reflects mixed actor + topology change in final state", () => {
		const g = new Graph("g");
		const secret = state(0, {
			name: "secret",
			guard: policy((allow, deny) => {
				allow("observe");
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(secret, { name: "secret" });

		const actorNode = state(human, { name: "actor" });
		actorNode.subscribe(() => undefined);

		const handle = g.describe({ reactive: true, actor: actorNode });
		const unsub = handle.node.subscribe(() => undefined);

		// Final state must reflect BOTH the actor switch and the new topology.
		batch(() => {
			actorNode.emit(llm);
			g.add(state(1, { name: "b" }), { name: "b" });
		});

		const cache = handle.node.cache as { nodes: Record<string, unknown> };
		expect(Object.keys(cache.nodes)).toContain("b");
		expect(cache.nodes.secret).toBeUndefined(); // llm cannot observe secret

		unsub();
		handle.dispose();
	});

	it("describe({ reactive: true, actor: Node<Actor> }) cleans up actor subscription on dispose", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const actorNode = state(human, { name: "actor" });
		actorNode.subscribe(() => undefined);

		// Spy on the actor's subscribe so we can prove the unsubscribe really
		// ran (the original test only asserted "no throw on post-dispose emit"
		// — that would pass even if `actorUnsub?.()` were dropped in dispose).
		const realSubscribe = actorNode.subscribe.bind(actorNode);
		let unsubCalls = 0;
		(actorNode as unknown as { subscribe: typeof actorNode.subscribe }).subscribe = ((
			cb: Parameters<typeof actorNode.subscribe>[0],
		) => {
			const off = realSubscribe(cb);
			return () => {
				unsubCalls += 1;
				off();
			};
		}) as typeof actorNode.subscribe;

		const handle = g.describe({ reactive: true, actor: actorNode });
		const unsub = handle.node.subscribe(() => undefined);

		unsub();
		handle.dispose();

		// `actorUnsub?.()` must have run — proven by the spy on `subscribe`.
		// The post-dispose emit must not re-enter the disposed handle.
		expect(unsubCalls).toBeGreaterThanOrEqual(1);
		expect(() => actorNode.emit(llm)).not.toThrow();
	});

	it("describe({ reactive: true, actor: Node<Actor> }) releases subscription on actor COMPLETE", () => {
		const g = new Graph("g");
		const secret = state(0, {
			name: "secret",
			guard: policy((allow, deny) => {
				allow("observe");
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(secret, { name: "secret" });

		const actorNode = state(human, { name: "actor" });
		actorNode.subscribe(() => undefined);

		const realSubscribe = actorNode.subscribe.bind(actorNode);
		let unsubCalls = 0;
		(actorNode as unknown as { subscribe: typeof actorNode.subscribe }).subscribe = ((
			cb: Parameters<typeof actorNode.subscribe>[0],
		) => {
			const off = realSubscribe(cb);
			return () => {
				unsubCalls += 1;
				off();
			};
		}) as typeof actorNode.subscribe;

		const handle = g.describe({ reactive: true, actor: actorNode });
		const unsub = handle.node.subscribe(() => undefined);

		// human can observe; secret visible.
		expect((handle.node.cache as { nodes: Record<string, unknown> }).nodes.secret).toBeDefined();

		// Actor terminates. Implementation must release the subscription and
		// re-derive against the last-known cache (which is still `human`).
		actorNode.down([[COMPLETE]]);
		expect(unsubCalls).toBeGreaterThanOrEqual(1);
		expect((handle.node.cache as { nodes: Record<string, unknown> }).nodes.secret).toBeDefined();

		unsub();
		handle.dispose();
	});

	it("observe() filters paths for actor", () => {
		const g = new Graph("g");
		const n = state(0, {
			name: "hidden",
			guard: policy((allow, deny) => {
				allow("observe");
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		g.add(n, { name: "hidden" });
		const paths: string[] = [];
		const unsub = g.observe({ actor: llm }).subscribe((p) => {
			paths.push(p);
		});
		unsub();
		expect(paths.some((p) => p.startsWith("hidden"))).toBe(false);
	});

	it("lastMutation records actor on guarded write (timestamp_ns)", () => {
		const n = state(0, { guard: () => true });
		n.down([[DATA, 5]], { actor: human });
		expect(n.lastMutation?.actor.type).toBe("human");
		expect(typeof n.lastMutation?.timestamp_ns).toBe("number");
		expect(n.lastMutation!.timestamp_ns).toBeGreaterThan(0);
	});

	it("subscribe checks observe guard when actor is passed", () => {
		const n = state(0, {
			guard: policy((allow, deny) => {
				allow("write");
				allow("observe", { where: (a) => a.type === "human" });
				deny("observe", { where: (a) => a.type === "llm" });
			}),
		});
		expect(() => n.subscribe(() => {}, llm)).toThrow(GuardDenied);
		const unsub = n.subscribe(() => {}, human);
		unsub();
	});

	it("internal TEARDOWN bypasses guard", () => {
		const g = new Graph("g");
		const n = state(0, { guard: () => false });
		g.add(n, { name: "x" });
		g.remove("x");
		expect(true).toBe(true);
	});

	it("DEFAULT_ACTOR satisfies allow-all guard", () => {
		const n = state(0, {
			guard: (a) => a.type === "system",
		});
		n.down([[DATA, 1]]);
		expect(n.cache).toBe(1);
		expect(n.lastMutation?.actor).toEqual(DEFAULT_ACTOR);
	});
});

describe("Graph Phase 1.6 — describe schema, observe streams, snapshot, signals, policy", () => {
	const human = { type: "human" as const, id: "u1" };

	it("describe() conforms to GRAPHREFLY-SPEC Appendix B (all node kinds)", () => {
		const g = new Graph("app");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		const p = producer(() => {}, { name: "p" });
		const e = effect([a], () => {});
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		g.add(p, { name: "p" });
		g.add(e, { name: "e" });
		assertDescribeMatchesAppendixB(g.describe({ detail: "standard" }));
	});

	it("describe() on nested mounts conforms to Appendix B", () => {
		const root = new Graph("root");
		const child = new Graph("ch");
		const n = state(0, { name: "n" });
		child.add(n, { name: "n" });
		root.mount("c", child);
		assertDescribeMatchesAppendixB(root.describe({ detail: "standard" }));
	});

	it("observe(path) on state sees DATA when graph.set writes (DATA-only batch)", () => {
		const g = new Graph("g");
		const n = state(0, { name: "n" });
		g.add(n, { name: "n" });
		const seq: symbol[] = [];
		const off = g.observe("n").subscribe((msgs) => {
			for (const m of msgs) seq.push(m[0] as symbol);
		});
		g.set("n", 1);
		off();
		expect(seq).toContain(DATA);
		expect(g.get("n")).toBe(1);
	});

	it("observe(path) on derived sees DIRTY before DATA when upstream graph.set recomputes", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const seq: symbol[] = [];
		const off = g.observe("b").subscribe((msgs) => {
			for (const m of msgs) seq.push(m[0] as symbol);
		});
		g.set("a", 5);
		const iDirty = seq.indexOf(DIRTY);
		const iData = seq.indexOf(DATA);
		expect(iDirty).toBeGreaterThanOrEqual(0);
		expect(iData).toBeGreaterThan(iDirty);
		expect(g.get("b")).toBe(6);
		off();
	});

	it("snapshot survives JSON wire and restores nested mount values", () => {
		const root0 = new Graph("app");
		const child0 = new Graph("sub");
		const n0 = state(3, { name: "x" });
		child0.add(n0, { name: "x" });
		root0.mount("sub", child0);
		const snap = root0.snapshot();
		const wired = JSON.parse(JSON.stringify(snap)) as GraphPersistSnapshot;

		const root1 = Graph.fromSnapshot(wired, (g) => {
			const ch = new Graph("sub");
			ch.add(state(0, { name: "x" }), { name: "x" });
			g.mount("sub", ch);
		});
		expect(root1.name).toBe("app");
		expect(root1.get("sub::x")).toBe(3);
	});

	it("graph.signal reaches every mounted subgraph (sibling mounts)", () => {
		const root = new Graph("root");
		const c1 = new Graph("c1");
		const c2 = new Graph("c2");
		const n1 = state(0, { name: "n1" });
		const n2 = state(0, { name: "n2" });
		c1.add(n1, { name: "n1" });
		c2.add(n2, { name: "n2" });
		root.mount("m1", c1);
		root.mount("m2", c2);
		const pauses: string[] = [];
		n1.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === PAUSE) pauses.push("n1");
		});
		n2.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === PAUSE) pauses.push("n2");
		});
		root.signal([[PAUSE, "k"]]);
		expect(pauses.sort()).toEqual(["n1", "n2"]);
	});

	it("policy: deny wins when both allow and deny match the same actor and action", () => {
		const g = policy((allow, deny) => {
			allow("write", { where: (a) => a.type === "human" });
			deny("write", { where: (a) => a.id === "u1" });
		});
		const n = state(0, { guard: g });
		expect(g(human, "write")).toBe(false);
		expect(g({ type: "human", id: "u2" }, "write")).toBe(true);
		n.down([[DATA, 1]], { actor: { type: "human", id: "u2" } });
		expect(n.cache).toBe(1);
		expect(() => n.down([[DATA, 2]], { actor: human })).toThrow(GuardDenied);
	});

	it("policy: action wildcard * matches any GuardAction", () => {
		const g = policy((allow, _deny) => {
			allow("*", { where: (a) => a.type === "wallet" });
		});
		const w = { type: "wallet" as const, id: "w1" };
		expect(g(w, "write")).toBe(true);
		expect(g(w, "signal")).toBe(true);
		expect(g(w, "observe")).toBe(true);
		expect(g(human, "write")).toBe(false);
	});

	it("policy: composed guards require both policies to allow", () => {
		const p1 = policy((allow, _deny) => {
			allow("write", { where: (a) => a.type === "human" });
		});
		const p2 = policy((allow, _deny) => {
			allow("write", { where: (a) => a.id === "u1" });
		});
		const both = (a: Parameters<typeof p1>[0], act: Parameters<typeof p1>[1]) =>
			p1(a, act) && p2(a, act);
		const n = state(0, { guard: both });
		n.down([[DATA, 9]], { actor: human });
		expect(n.cache).toBe(9);
		expect(() => n.down([[DATA, 0]], { actor: { type: "human", id: "other" } })).toThrow(
			GuardDenied,
		);
	});

	it("policy: default is deny when no rule matches", () => {
		const g = policy((allow, _deny) => {
			allow("write", { where: (a) => a.type === "system" });
		});
		expect(g(human, "write")).toBe(false);
	});

	it("graph.set records lastMutation with actor", () => {
		const g = new Graph("g");
		const n = state(0, { name: "n", guard: () => true });
		g.add(n, { name: "n" });
		g.set("n", 5, { actor: human });
		expect(n.lastMutation?.actor.type).toBe("human");
		expect(n.lastMutation?.actor.id).toBe("u1");
		expect(typeof n.lastMutation?.timestamp_ns).toBe("number");
	});

	it("observe() whole-graph delivers qualified paths for mounted nodes", () => {
		const g = new Graph("g");
		const child = new Graph("ch");
		const n = state(0, { name: "n" });
		child.add(n, { name: "n" });
		g.mount("sub", child);
		const paths: string[] = [];
		const unsub = g.observe().subscribe((path) => {
			paths.push(path);
		});
		g.set("sub::n", 1);
		unsub();
		expect(paths).toContain("sub::n");
	});

	it("restore rejects snapshot with wrong version", () => {
		const g = new Graph("g");
		g.add(state(0), { name: "x" });
		const snap = g.snapshot();
		(snap as Record<string, unknown>).version = 99;
		expect(() => g.restore(snap)).toThrow(/version/);
	});

	it("restore rejects snapshot missing required keys", () => {
		const g = new Graph("g");
		expect(() => g.restore({ name: "g", version: 1 } as GraphPersistSnapshot)).toThrow(
			/required key/,
		);
	});

	it("fromSnapshot without build rejects edges", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		const snap = g.snapshot();
		expect(() => Graph.fromSnapshot(snap)).toThrow(/could not reconstruct/);
	});

	it("fromSnapshot without build rejects non-state nodes", () => {
		const snap: GraphPersistSnapshot = {
			version: 1,
			name: "g",
			nodes: { x: { type: "derived", status: "settled", deps: [], meta: {} } },
			edges: [],
			subgraphs: [],
		};
		expect(() => Graph.fromSnapshot(snap)).toThrow(/could not reconstruct/);
	});

	it("fromSnapshot without build auto-creates mounts and state nodes", () => {
		const root = new Graph("app");
		const child = new Graph("sub");
		child.add(state(42, { name: "x" }), { name: "x" });
		root.mount("sub", child);
		const snap = root.snapshot();
		const wired = JSON.parse(JSON.stringify(snap)) as GraphPersistSnapshot;
		const restored = Graph.fromSnapshot(wired);
		expect(restored.name).toBe("app");
		expect(restored.get("sub::x")).toBe(42);
	});
});

// ---------------------------------------------------------------------------
// Phase 3.3b — Progressive disclosure for describe() and observe()
// ---------------------------------------------------------------------------

describe("describe() detail levels (3.3b)", () => {
	function makeGraph() {
		const g = new Graph("test-detail");
		const a = state(10, { name: "a", meta: { description: "source", access: "both" } });
		const b = derived([a], (av) => av * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		return { g, a, b };
	}

	it("default (minimal) returns only type and deps", () => {
		const { g } = makeGraph();
		const d = g.describe();
		const nodeA = d.nodes.a!;
		expect(nodeA.type).toBe("state");
		expect(nodeA.deps).toEqual([]);
		expect(nodeA.status).toBeUndefined();
		expect(nodeA.value).toBeUndefined();
		expect(nodeA.meta).toBeUndefined();
		expect(nodeA.v).toBeUndefined();

		const nodeB = d.nodes.b!;
		expect(nodeB.type).toBe("derived");
		expect(nodeB.deps).toEqual(["a"]);
		expect(nodeB.status).toBeUndefined();
		g.destroy();
	});

	it('detail: "standard" includes type, status, value, deps, meta', () => {
		const { g, b } = makeGraph();
		// Subscribe to b so it connects and settles
		const unsub = b.subscribe(() => {});
		const d = g.describe({ detail: "standard" });
		const nodeA = d.nodes.a!;
		expect(nodeA.type).toBe("state");
		expect(nodeA.status).toBe("settled");
		expect(nodeA.value).toBe(10);
		expect(nodeA.meta).toEqual(expect.objectContaining({ description: "source" }));
		expect(nodeA.v).toBeUndefined(); // no versioning

		const nodeB = d.nodes.b!;
		expect(nodeB.status).toBe("settled");
		expect(nodeB.value).toBe(20);
		unsub();
		g.destroy();
	});

	it('detail: "full" includes standard + versioning + guard + lastMutation', () => {
		const tester = { type: "human", name: "tester" };
		const g = new Graph("full-detail");
		const a = state(5, {
			name: "a",
			versioning: 0,
			guard: policy((allow) => {
				allow("write");
				allow("observe");
			}),
			meta: { description: "guarded" },
		});
		g.add(a, { name: "a" });
		// Trigger a mutation with actor to populate lastMutation
		a.down([[DATA, 6]], { actor: tester });

		const d = g.describe({ detail: "full" });
		const nodeA = d.nodes.a!;
		expect(nodeA.type).toBe("state");
		expect(nodeA.status).toBe("settled");
		expect(nodeA.value).toBe(6);
		expect(nodeA.v).toBeDefined();
		expect(nodeA.v!.version).toBeGreaterThanOrEqual(1);
		expect(nodeA.guard).toBeDefined();
		expect(nodeA.lastMutation).toBeDefined();
		expect((nodeA.lastMutation!.actor as { name: string }).name).toBe("tester");
		g.destroy();
	});
});

describe("describe() field selection (3.3b)", () => {
	it("fields override detail level", () => {
		const g = new Graph("fields");
		g.add(state(42, { name: "x", meta: { label: "X", extra: "e" } }), { name: "x" });

		const d = g.describe({ fields: ["type", "status"] });
		const x = d.nodes.x!;
		expect(x.type).toBe("state");
		expect(x.status).toBe("settled");
		expect(x.value).toBeUndefined();
		expect(x.meta).toBeUndefined();
		g.destroy();
	});

	it("dotted meta path selects specific meta keys", () => {
		const g = new Graph("meta-dot");
		g.add(state(1, { name: "x", meta: { label: "L", secret: "S", extra: "E" } }), { name: "x" });

		const d = g.describe({ fields: ["type", "meta.label"] });
		const x = d.nodes.x!;
		expect(x.type).toBe("state");
		expect(x.meta).toEqual({ label: "L" });
		expect(x.value).toBeUndefined();
		g.destroy();
	});

	it("fields takes precedence over detail", () => {
		const g = new Graph("precedence");
		g.add(state(1, { name: "x" }), { name: "x" });

		// detail: "full" would include everything, but fields overrides
		const d = g.describe({ detail: "full", fields: ["type"] });
		expect(d.nodes.x!.status).toBeUndefined();
		expect(d.nodes.x!.value).toBeUndefined();
		g.destroy();
	});
});

describe("describe() format: spec (3.3b)", () => {
	it("returns minimal type + deps output usable by compileSpec", () => {
		const g = new Graph("spec-format");
		const a = state(1, { name: "a", meta: { description: "src" } });
		const b = derived([a], (v) => v + 1, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const d = g.describe({ format: "spec" });
		// Spec format forces minimal — no status, no value, no meta
		expect(d.nodes.a!.type).toBe("state");
		expect(d.nodes.a!.status).toBeUndefined();
		expect(d.nodes.a!.value).toBeUndefined();
		expect(d.nodes.a!.meta).toBeUndefined();

		expect(d.nodes.b!.type).toBe("derived");
		expect(d.nodes.b!.deps).toEqual(["a"]);
		g.destroy();
	});
});

describe("describe() expand() (3.3b)", () => {
	it("expand from minimal to standard re-reads live graph", () => {
		const g = new Graph("expand");
		const a = state(1, { name: "a", meta: { label: "A" } });
		g.add(a, { name: "a" });

		const minimal = g.describe();
		expect(minimal.nodes.a!.value).toBeUndefined();

		// Mutate between describe and expand
		g.set("a", 99);

		const expanded = minimal.expand!("standard");
		expect(expanded.nodes.a!.value).toBe(99); // live re-read
		expect(expanded.nodes.a!.status).toBe("settled");
		expect(expanded.nodes.a!.meta).toEqual(expect.objectContaining({ label: "A" }));
		g.destroy();
	});

	it("expand with field array", () => {
		const g = new Graph("expand-fields");
		g.add(state(5, { name: "x" }), { name: "x" });

		const d = g.describe();
		const expanded = d.expand!(["type", "value"]);
		expect(expanded.nodes.x!.value).toBe(5);
		expect(expanded.nodes.x!.status).toBeUndefined();
		g.destroy();
	});
});

describe("observe() detail levels (3.3b)", () => {
	it('detail: "minimal" only includes DATA events', () => {
		Graph.inspectorEnabled = true;
		const g = new Graph("obs-min");
		const a = state(1, { name: "a" });
		const b = derived([a], (v) => v * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const obs = g.observe("b", { detail: "minimal" }) as ObserveResult;
		// Initial DATA from subscription connect + update DATA
		g.set("a", 2);

		// All events should be DATA only — no DIRTY/RESOLVED
		expect(obs.events.every((e) => e.type === "data")).toBe(true);
		expect(obs.events.filter((e) => e.type === "dirty")).toHaveLength(0);
		// But dirtyCount is still tracked internally
		expect(obs.dirtyCount).toBeGreaterThanOrEqual(1);
		expect(obs.values.b).toBe(4);
		obs.dispose();
		g.destroy();
		Graph.inspectorEnabled = false;
	});

	it('detail: "full" enables timeline + causal + derived', () => {
		Graph.inspectorEnabled = true;
		const g = new Graph("obs-full");
		const a = state(10, { name: "a" });
		const b = derived([a], (v: number) => v * 2, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const obs = g.observe("b", { detail: "full" }) as ObserveResult;
		// Initial DATA on subscribe; trigger an update with causal info
		g.set("a", 20);

		// Find the DATA event from the update (last DATA has the post-update value)
		const dataEvents = obs.events.filter((e) => e.type === "data");
		expect(dataEvents.length).toBeGreaterThanOrEqual(2); // initial + update
		const lastData = dataEvents[dataEvents.length - 1]!;
		expect(lastData.data).toBe(40); // 20 * 2
		expect(lastData.timestamp_ns).toBeDefined(); // timeline
		expect(lastData.trigger_dep_name).toBe("a"); // causal

		const derivedEvts = obs.events.filter((e) => e.type === "derived");
		expect(derivedEvts.length).toBeGreaterThanOrEqual(1); // derived
		const lastDerived = derivedEvts[derivedEvts.length - 1]!;
		expect(lastDerived.dep_values).toEqual([20]);
		obs.dispose();
		g.destroy();
		Graph.inspectorEnabled = false;
	});

	it('graph-wide detail: "minimal" filters non-DATA events', () => {
		Graph.inspectorEnabled = true;
		const g = new Graph("obs-all-min");
		const a = state(1, { name: "a" });
		const b = derived([a], (v) => v, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const obs = g.observe({ detail: "minimal" }) as ObserveResult;
		g.set("a", 2);

		expect(obs.events.every((e) => e.type === "data")).toBe(true);
		expect(obs.dirtyCount).toBeGreaterThanOrEqual(1);
		obs.dispose();
		g.destroy();
		Graph.inspectorEnabled = false;
	});
});

describe("observe() expand() (3.3b)", () => {
	it("expand upgrades observation from minimal to full", () => {
		Graph.inspectorEnabled = true;
		const g = new Graph("obs-expand");
		const a = state(1, { name: "a" });
		const b = derived([a], (v) => v + 10, { name: "b" });
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const minimal = g.observe("b", { detail: "minimal" }) as ObserveResult;
		g.set("a", 2);
		expect(minimal.events.filter((e) => e.type === "dirty")).toHaveLength(0);

		// Expand to full — disposes old, creates new subscription
		const full = minimal.expand("full");
		// Clear push-on-subscribe events so we only see the dep-triggered update
		full.events.length = 0;
		g.set("a", 3);

		const dataEvt = full.events.find((e) => e.type === "data");
		expect(dataEvt).toBeDefined();
		expect(dataEvt!.timestamp_ns).toBeDefined();
		expect(dataEvt!.trigger_dep_name).toBe("a");
		full.dispose();
		g.destroy();
		Graph.inspectorEnabled = false;
	});
});

describe("observe() tier-surfacing variants", () => {
	it("surfaces INVALIDATE events with counter", () => {
		const g = new Graph("obs-inv");
		g.add(state(1, { name: "a" }), { name: "a" });
		const obs = g.observe("a", { structured: true }) as ObserveResult;
		obs.events.length = 0;
		g.invalidate("a");
		obs.dispose();
		expect(obs.events.some((e) => e.type === "invalidate" && e.path === "a")).toBe(true);
		expect(obs.invalidateCount).toBe(1);
	});

	it("surfaces PAUSE and RESUME events with lockId payload", () => {
		const g = new Graph("obs-pr");
		g.add(state(1, { name: "a" }), { name: "a" });
		const obs = g.observe("a", { structured: true }) as ObserveResult;
		obs.events.length = 0;
		g.node("a").down([[PAUSE, "lock-1"]], { internal: true });
		g.node("a").down([[RESUME, "lock-1"]], { internal: true });
		obs.dispose();
		const pause = obs.events.find((e) => e.type === "pause");
		const resume = obs.events.find((e) => e.type === "resume");
		expect(pause).toBeDefined();
		expect(resume).toBeDefined();
		expect((pause as { lockId: unknown }).lockId).toBe("lock-1");
		expect((resume as { lockId: unknown }).lockId).toBe("lock-1");
		expect(obs.pauseCount).toBe(1);
		expect(obs.resumeCount).toBe(1);
	});

	it("surfaces TEARDOWN when graph.destroy() runs", () => {
		const g = new Graph("obs-td");
		g.add(state(1, { name: "a" }), { name: "a" });
		const obs = g.observe("a", { structured: true }) as ObserveResult;
		obs.events.length = 0;
		g.destroy();
		expect(obs.events.some((e) => e.type === "teardown" && e.path === "a")).toBe(true);
		expect(obs.teardownCount).toBe(1);
		obs.dispose();
	});

	it('detail: "minimal" bumps new counters without emitting events', () => {
		const g = new Graph("obs-min-new");
		g.add(state(1, { name: "a" }), { name: "a" });
		const obs = g.observe("a", { detail: "minimal" }) as ObserveResult;
		obs.events.length = 0;
		g.invalidate("a");
		g.node("a").down([[PAUSE, "l"]], { internal: true });
		g.node("a").down([[RESUME, "l"]], { internal: true });
		obs.dispose();
		expect(obs.events.every((e) => e.type === "data")).toBe(true);
		expect(obs.invalidateCount).toBe(1);
		expect(obs.pauseCount).toBe(1);
		expect(obs.resumeCount).toBe(1);
	});

	it("pretty format renders lockId for pause/resume", () => {
		const g = new Graph("obs-fmt");
		g.add(state(1, { name: "a" }), { name: "a" });
		const lines: string[] = [];
		const obs = g.observe("a", {
			format: "pretty",
			theme: "none",
			includeTypes: ["pause", "resume", "invalidate", "teardown"],
			logger: (line) => lines.push(line),
		}) as ObserveResult;
		g.invalidate("a");
		g.node("a").down([[PAUSE, "lk"]], { internal: true });
		g.node("a").down([[RESUME, "lk"]], { internal: true });
		obs.dispose();
		expect(lines.some((l) => l.includes("INVALIDATE"))).toBe(true);
		expect(lines.some((l) => l.includes("PAUSE") && l.includes('"lk"'))).toBe(true);
		expect(lines.some((l) => l.includes("RESUME") && l.includes('"lk"'))).toBe(true);
	});
});
