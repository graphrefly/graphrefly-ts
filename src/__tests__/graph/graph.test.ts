import { describe, expect, it } from "vitest";
import { TEARDOWN } from "../../core/messages.js";
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
		g.remove("a");
		expect(() => g.disconnect("a", "b")).toThrow(/no registered edge/);
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
});
