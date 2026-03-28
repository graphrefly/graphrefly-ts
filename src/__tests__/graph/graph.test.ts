import { describe, expect, it } from "vitest";
import { PAUSE, TEARDOWN } from "../../core/messages.js";
import { derived, state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";

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
