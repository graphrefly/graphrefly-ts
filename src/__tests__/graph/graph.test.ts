import { describe, expect, it } from "vitest";
import { DEFAULT_ACTOR } from "../../core/actor.js";
import { GuardDenied, policy } from "../../core/guard.js";
import { DATA, DIRTY, PAUSE, TEARDOWN } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { derived, effect, producer, state } from "../../core/sugar.js";
import { GRAPH_META_SEGMENT, Graph, type GraphPersistSnapshot } from "../../graph/graph.js";
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
		g.add("a", a);
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
		g.add("x", n);
		expect(() => g.add("x", state(1))).toThrow(/already exists/);
	});

	it("add duplicate node instance throws", () => {
		const g = new Graph("g");
		const n = state(0);
		g.add("x", n);
		expect(() => g.add("y", n)).toThrow(/already registered/);
	});

	it("remove sends TEARDOWN", () => {
		const g = new Graph("g");
		const n = state(0);
		const seen: symbol[] = [];
		n.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		g.add("n", n);
		g.remove("n");
		expect(seen).toContain(TEARDOWN);
	});

	it("connect validates deps; disconnect drops registry entry", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) + 1, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
		g.disconnect("a", "b");
		expect(() => g.disconnect("a", "b")).toThrow(/no registered edge/);
	});

	it("connect is idempotent", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
		g.connect("a", "b");
		g.disconnect("a", "b");
		expect(() => g.disconnect("a", "b")).toThrow(/no registered edge/);
	});

	it("connect rejects self-loop", () => {
		const g = new Graph("g");
		const a = state(0);
		g.add("a", a);
		expect(() => g.connect("a", "a")).toThrow(/cannot connect a node to itself/);
	});

	it("connect throws when target deps do not include source instance", () => {
		const g = new Graph("g");
		const a1 = state(0, { name: "a1" });
		const a2 = state(0, { name: "a2" });
		const b = derived([a2], ([v]) => v, { name: "b" });
		g.add("a", a1);
		g.add("b", b);
		expect(() => g.connect("a", "b")).toThrow(/must include/);
	});

	it("disconnect throws when edge missing", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		expect(() => g.disconnect("a", "b")).toThrow(/no registered edge/);
	});

	it("remove prunes incident edges", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
		expect(g.edges().length).toBe(1);
		g.remove("a");
		expect(g.edges()).toEqual([]);
	});

	it("set on graph drives derived value (wiring via deps)", () => {
		const g = new Graph("g");
		const a = state(1, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
		b.subscribe(() => {
			/* ensure b is connected upstream */
		});
		g.set("a", 3);
		expect(g.get("b")).toBe(6);
	});

	it("empty local name throws on add", () => {
		const g = new Graph("g");
		expect(() => g.add("", state(0))).toThrow(/non-empty/);
	});

	it("edges() returns registered edge pairs", () => {
		const g = new Graph("g");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		expect(g.edges()).toEqual([]);
		g.connect("a", "b");
		expect(g.edges()).toEqual([["a", "b"]]);
		g.disconnect("a", "b");
		expect(g.edges()).toEqual([]);
	});

	it("single colon in names is allowed", () => {
		const g = new Graph("g");
		const n = state(0);
		g.add("my:node", n);
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
		child.add("amount", n);
		root.mount("payment", child);
		expect(root.resolve("payment::amount")).toBe(n);
		expect(root.resolve("payment::amount").get()).toBe(7);
	});

	it("resolve strips leading graph name when it matches this.name", () => {
		const root = new Graph("app");
		const child = new Graph("pay");
		const n = state(1, { name: "x" });
		child.add("x", n);
		root.mount("payment", child);
		expect(root.resolve("app::payment::x")).toBe(n);
	});

	it("resolve on child strips child graph name prefix", () => {
		const child = new Graph("pay");
		const n = state(2, { name: "x" });
		child.add("x", n);
		expect(child.resolve("pay::x")).toBe(n);
		expect(child.resolve("x")).toBe(n);
	});

	it("resolve throws when path ends at subgraph", () => {
		const root = new Graph("app");
		const child = new Graph("c");
		child.add("x", state(0));
		root.mount("sub", child);
		expect(() => root.resolve("sub")).toThrow(/subgraph/);
	});

	it("resolve throws for trailing path after a node name", () => {
		const g = new Graph("g");
		g.add("a", state(0));
		expect(() => g.resolve("a::b")).toThrow(/node/);
	});

	it("add after mount at same name throws", () => {
		const root = new Graph("r");
		root.mount("m", new Graph("c"));
		expect(() => root.add("m", state(0))).toThrow(/mount/);
	});

	it("mount after add at same name throws", () => {
		const root = new Graph("r");
		root.add("m", state(0));
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
		child.add("n", state(0));
		root.mount("c1", child);
		expect(() => root.mount("c2", child)).toThrow(/already mounted/);
	});

	it("signal reaches nodes inside mounted graphs once per node", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const n = state(0, { name: "n" });
		child.add("n", n);
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
		child.add("cn", childNode);
		root.add("rn", rootNode);
		root.mount("c", child);
		childNode.subscribe(() => order.push("child"));
		rootNode.subscribe(() => order.push("root"));
		root.signal([[PAUSE, "x"]]);
		expect(order).toEqual(["child", "root"]);
	});

	it(":: in local add name throws", () => {
		const g = new Graph("g");
		expect(() => g.add("a::b", state(0))).toThrow(/path separator/);
	});

	it("single colon in mount name is allowed", () => {
		const root = new Graph("r");
		const child = new Graph("c");
		child.add("x", state(0));
		root.mount("my:mount", child);
		expect(root.resolve("my:mount::x").get()).toBe(0);
	});

	it("node / get / set accept :: qualified paths", () => {
		const root = new Graph("app");
		const child = new Graph("sub");
		const n = state(10, { name: "val" });
		child.add("val", n);
		root.mount("sub", child);
		expect(root.node("sub::val")).toBe(n);
		expect(root.get("sub::val")).toBe(10);
		root.set("sub::val", 42);
		expect(root.get("sub::val")).toBe(42);
	});

	it("connect / disconnect accept :: qualified paths", () => {
		const root = new Graph("app");
		const child = new Graph("sub");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		child.add("a", a);
		child.add("b", b);
		root.mount("sub", child);
		root.connect("sub::a", "sub::b");
		// Same-owner edge is stored on the child graph.
		expect(child.edges()).toEqual([["a", "b"]]);
		root.disconnect("sub::a", "sub::b");
		expect(child.edges()).toEqual([]);
	});

	it("remove(mount_name) unmounts and sends TEARDOWN through subtree", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const grandchild = new Graph("gc");
		const n1 = state(1, { name: "n1" });
		const n2 = state(2, { name: "n2" });
		child.add("n1", n1);
		grandchild.add("n2", n2);
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

	it("remove(mount_name) prunes cross-subgraph edges", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const a = state(0, { name: "a" });
		const b = derived([a], ([v]) => v, { name: "b" });
		root.add("a", a);
		child.add("b", b);
		root.mount("sub", child);
		root.connect("a", "sub::b");
		expect(root.edges().length).toBe(1);
		root.remove("sub");
		expect(root.edges()).toEqual([]);
	});
});

describe("Graph introspection (Phase 1.3)", () => {
	it("add assigns registry name when node has no options name", () => {
		const g = new Graph("g");
		const n = state(1);
		g.add("counter", n);
		expect(n.name).toBe("counter");
	});

	it("does not override options.name on add", () => {
		const g = new Graph("g");
		const n = state(1, { name: "keep" });
		g.add("alias", n);
		expect(n.name).toBe("keep");
	});

	it("rejects reserved __meta__ for add and mount", () => {
		const g = new Graph("g");
		expect(() => g.add(GRAPH_META_SEGMENT, state(0))).toThrow(/reserved/);
		expect(() => g.mount(GRAPH_META_SEGMENT, new Graph("c"))).toThrow(/reserved/);
	});

	it("describe includes qualified nodes, edges, subgraphs (recursive)", () => {
		const root = new Graph("app");
		const child = new Graph("pay");
		const grandchild = new Graph("inner");
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) + 1);
		child.add("a", a);
		child.add("b", b);
		child.connect("a", "b");
		grandchild.add("x", state(0));
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

	it("describe lists each meta companion as its own node entry (Python parity)", () => {
		const g = new Graph("g");
		const n = node({ initial: 0, meta: { desc: "purpose" } });
		g.add("n", n);
		const d = g.describe();
		const metaKey = `n::${GRAPH_META_SEGMENT}::desc`;
		expect(d.nodes[metaKey]).toMatchObject({ type: "state" });
		expect(d.nodes.n?.meta).toEqual({ desc: "purpose" });
	});

	it("connect and disconnect reject meta paths (Python parity)", () => {
		const g = new Graph("g");
		const a = node({ initial: 1, meta: { m: 0 } });
		const b = derived([a], ([v]) => v);
		g.add("a", a);
		g.add("b", b);
		const mp = `a::${GRAPH_META_SEGMENT}::m`;
		expect(() => g.connect(mp, "b")).toThrow(/meta paths/);
		expect(() => g.connect("a", mp)).toThrow(/meta paths/);
		g.connect("a", "b");
		expect(() => g.disconnect(mp, "b")).toThrow(/meta paths/);
	});

	it("resolve, set, and observe on meta companion path", () => {
		const g = new Graph("g");
		const n = node({ initial: 0, meta: { tag: "x" } });
		g.add("n", n);
		const metaPath = `n::${GRAPH_META_SEGMENT}::tag`;
		expect(g.resolve(metaPath).get()).toBe("x");
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
		g.add("n", n);
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
		g.add("n", n);
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
		g.add("b", state(0));
		g.add("a", state(0));
		const order: string[] = [];
		g.observe().subscribe((path, msgs) => {
			for (const m of msgs) {
				if (m[0] === PAUSE) order.push(path);
			}
		});
		g.signal([[PAUSE, "z"]]);
		expect(order).toEqual(["a", "b"]);
	});
});

describe("Graph lifecycle & persistence (Phase 1.4)", () => {
	it("destroy signals TEARDOWN and clears registries (including mounts)", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		const n = state(0, { name: "n" });
		child.add("n", n);
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
		g.add("z", state(1));
		g.add("a", state(2));
		const snap = g.snapshot();
		expect(snap.version).toBe(1);
		expect(snap.name).toBe("app");
		expect(snap.nodes.a?.value).toBe(2);
		expect(snap.nodes.z?.value).toBe(1);
	});

	it("toJSON + JSON.stringify is stable across key insertion order", () => {
		const g = new Graph("g");
		g.add("b", state(0));
		g.add("a", state(0));
		const j1 = JSON.stringify(g);
		const j2 = JSON.stringify(g);
		expect(j1).toBe(j2);
		const parsed = JSON.parse(j1) as GraphPersistSnapshot;
		expect(Object.keys(parsed.nodes).sort()).toEqual(["a", "b"]);
	});

	it("toJSONString is stable and ends with newline", () => {
		const g = new Graph("g");
		g.add("a", state(0));
		const s = g.toJSONString();
		expect(s).toBe(g.toJSONString());
		expect(s.endsWith("\n")).toBe(true);
	});

	it("restore applies state (and producer) values; skips derived", () => {
		const g = new Graph("g");
		const a = state(10, { name: "a" });
		const b = derived([a], ([v]) => (v as number) * 2, { name: "b" });
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
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
		g0.add("a", a);
		g0.set("a", 7);
		const snap = g0.snapshot();

		const g1 = Graph.fromSnapshot(snap, (g) => {
			g.add("a", state(0, { name: "a" }));
		});
		expect(g1.get("a")).toBe(7);
	});

	it("restore sets meta companion paths from snapshot", () => {
		const n0 = node({ initial: 0, meta: { tag: "hi" } });
		const g0 = new Graph("g");
		g0.add("n", n0);
		const snap = g0.snapshot();
		const metaPath = `n::${GRAPH_META_SEGMENT}::tag`;

		const n1 = node({ initial: 0, meta: { tag: "" } });
		const g1 = new Graph("g");
		g1.add("n", n1);
		g1.restore(snap);
		expect(g1.get(metaPath)).toBe("hi");
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
		g.add("n", n);
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
		g.add("x", n);
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
		g.add("secret", secret);
		const dLlm = g.describe({ actor: llm });
		expect(dLlm.nodes.secret).toBeUndefined();
		const dHuman = g.describe({ actor: human });
		expect(dHuman.nodes.secret).toBeDefined();

		expect(() => g.observe("secret", { actor: llm })).toThrow(GuardDenied);
		const sub = g.observe("secret", { actor: human }).subscribe(() => {});
		sub();
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
		g.add("hidden", n);
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
		expect(() => n.subscribe(() => {}, { actor: llm })).toThrow(GuardDenied);
		const unsub = n.subscribe(() => {}, { actor: human });
		unsub();
	});

	it("internal TEARDOWN bypasses guard", () => {
		const g = new Graph("g");
		const n = state(0, { guard: () => false });
		g.add("x", n);
		g.remove("x");
		expect(true).toBe(true);
	});

	it("DEFAULT_ACTOR satisfies allow-all guard", () => {
		const n = state(0, {
			guard: (a) => a.type === "system",
		});
		n.down([[DATA, 1]]);
		expect(n.get()).toBe(1);
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
		g.add("a", a);
		g.add("b", b);
		g.add("p", p);
		g.add("e", e);
		g.connect("a", "b");
		g.connect("a", "e");
		assertDescribeMatchesAppendixB(g.describe());
	});

	it("describe() on nested mounts conforms to Appendix B", () => {
		const root = new Graph("root");
		const child = new Graph("ch");
		const n = state(0, { name: "n" });
		child.add("n", n);
		root.mount("c", child);
		assertDescribeMatchesAppendixB(root.describe());
	});

	it("observe(path) on state sees DATA when graph.set writes (DATA-only batch)", () => {
		const g = new Graph("g");
		const n = state(0, { name: "n" });
		g.add("n", n);
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
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
		const seq: symbol[] = [];
		const off = g.observe("b").subscribe((msgs) => {
			for (const m of msgs) seq.push(m[0] as symbol);
		});
		g.set("a", 5);
		off();
		const iDirty = seq.indexOf(DIRTY);
		const iData = seq.indexOf(DATA);
		expect(iDirty).toBeGreaterThanOrEqual(0);
		expect(iData).toBeGreaterThan(iDirty);
		expect(g.get("b")).toBe(6);
	});

	it("snapshot survives JSON wire and restores nested mount values", () => {
		const root0 = new Graph("app");
		const child0 = new Graph("sub");
		const n0 = state(3, { name: "x" });
		child0.add("x", n0);
		root0.mount("sub", child0);
		const snap = root0.snapshot();
		const wired = JSON.parse(JSON.stringify(snap)) as GraphPersistSnapshot;

		const root1 = Graph.fromSnapshot(wired, (g) => {
			const ch = new Graph("sub");
			ch.add("x", state(0, { name: "x" }));
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
		c1.add("n1", n1);
		c2.add("n2", n2);
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
		expect(n.get()).toBe(1);
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
		expect(n.get()).toBe(9);
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
		g.add("n", n);
		g.set("n", 5, { actor: human });
		expect(n.lastMutation?.actor.type).toBe("human");
		expect(n.lastMutation?.actor.id).toBe("u1");
		expect(typeof n.lastMutation?.timestamp_ns).toBe("number");
	});

	it("observe() whole-graph delivers qualified paths for mounted nodes", () => {
		const g = new Graph("g");
		const child = new Graph("ch");
		const n = state(0, { name: "n" });
		child.add("n", n);
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
		g.add("x", state(0));
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
		g.add("a", a);
		g.add("b", b);
		g.connect("a", "b");
		const snap = g.snapshot();
		expect(() => Graph.fromSnapshot(snap)).toThrow(/edges/);
	});

	it("fromSnapshot without build rejects non-state nodes", () => {
		const snap: GraphPersistSnapshot = {
			version: 1,
			name: "g",
			nodes: { x: { type: "derived", status: "settled", deps: [], meta: {} } },
			edges: [],
			subgraphs: [],
		};
		expect(() => Graph.fromSnapshot(snap)).toThrow(/state/);
	});

	it("fromSnapshot without build auto-creates mounts and state nodes", () => {
		const root = new Graph("app");
		const child = new Graph("sub");
		child.add("x", state(42, { name: "x" }));
		root.mount("sub", child);
		const snap = root.snapshot();
		const wired = JSON.parse(JSON.stringify(snap)) as GraphPersistSnapshot;
		const restored = Graph.fromSnapshot(wired);
		expect(restored.name).toBe("app");
		expect(restored.get("sub::x")).toBe(42);
	});
});
