/**
 * D817 kernel report (graphrefly-ts:D817-KERNEL-REPORT-TS): construction seeds and the cycle check.
 *
 * TS harness for the root scenarios C-58 and C-59 and the kernel cycle-check clauses of C-54 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-subscription@5 (graphrefly:D827) and
 * R-request-order@7 (graphrefly:D822, D826). A seed's first-lifetime dependencies are graph ids,
 * which may name a node made later: `seed: { values, terminal, privateState, deps: ["L"], note }`.
 * C-54's capture and restore clauses belong to the checkpoint phase; its seed clauses are tested
 * here with seeds the host gives, as a restore gives them.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { SugarOpts } from "../graph/graph-types.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;
interface Seed {
	readonly values?: readonly unknown[];
	readonly deps?: readonly string[];
}

const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const current = (g: Graph, id: string) => g.describe().find((n) => n.id === id)?.deps;
const idOf = (g: Graph, dep: unknown) =>
	typeof dep === "string" ? dep : g.describe().find((n) => g.find(n.id) === dep)?.id;
const declared = (g: Graph, node: Node<unknown>) => g.definition(node).deps.map((d) => idOf(g, d));
const lifecycle = (g: Graph, id: string) => g.find(id)?.status.lifecycle;

/** Options for a node named `name` with a construction seed (R-subscription@5). */
const seeded = (name: string, seed: Seed) =>
	({
		name,
		seed: { values: [], terminal: undefined, privateState: undefined, note: undefined, ...seed },
	}) as unknown as SugarOpts<number>;

const sum = (ctx: Ctx) =>
	ctx.down([["DATA", ctx.deps.reduce((s, d) => s + ((d.value as number | undefined) ?? 0), 0)]]);

const sinkOf = (node: Node<unknown>) => {
	const log: Wave[] = [];
	node.subscribe((msgs) => log.push(msgs));
	return log;
};

describe("C-58 (R-request-order@7): creating a node is refused when a dependency depends on it through a seed", () => {
	/** a, and X over [a] whose seed names L, a node that does not exist yet. */
	function seededX() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const x = g.node<number>([a], sum, seeded("X", { values: [1], deps: ["L"] }));
		return { g, a, x };
	}

	it("L over [X] is refused: L would depend on itself through X; the node is not made", () => {
		const { g, x } = seededX();
		const before = g.describe();
		expect(() => g.node<number>([x], sum, { name: "L" })).toThrow();
		expect(g.find("L")).toBeUndefined();
		expect(g.describe()).toEqual(before);
	});

	it("L over [M], with M over [X], is refused: through a node between", () => {
		const { g, x } = seededX();
		const m = g.node<number>([x], sum, { name: "M" });
		const before = g.describe();
		expect(() => g.node<number>([m], sum, { name: "L" })).toThrow();
		expect(g.find("L")).toBeUndefined();
		expect(g.describe()).toEqual(before);
	});

	it("L over [a] whose own seed names X is refused: through X by its own seed", () => {
		const { g, a } = seededX();
		const before = g.describe();
		expect(() => g.node<number>([a], sum, seeded("L", { deps: ["X"] }))).toThrow();
		expect(g.find("L")).toBeUndefined();
		expect(g.describe()).toEqual(before);
	});

	it("a node whose own seed names that node is refused", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const before = g.describe();
		expect(() => g.node<number>([a], sum, seeded("X", { deps: ["X"] }))).toThrow();
		expect(g.find("X")).toBeUndefined();
		expect(g.describe()).toEqual(before);
	});

	it("L over [a] is taken: X's first activation starts on [L], and a's write reaches X through L", () => {
		const { g, a, x } = seededX();
		g.node<number>([a], sum, { name: "L" });
		const log = sinkOf(x);
		expect(current(g, "X")).toEqual(["L"]);
		expect(log).toEqual([[["START"], ["DATA", 1]]]);
		log.length = 0;
		a.set(5);
		expect(log).toEqual([pending(["DATA", 5])]);
	});
});

describe("C-59 (R-subscription@5): a request that would activate a node whose seed names a missing node is refused", () => {
	/** a and b, and X over [a] whose seed holds the value 7 and names G, which does not exist. */
	function seededX() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const x = g.node<number>([a], sum, seeded("X", { values: [7], deps: ["G"] }));
		return { g, a, b, x };
	}

	it("each subscription to X is refused and changes nothing; once G exists X starts on [G]", () => {
		const { g, a, x } = seededX();
		const log: Wave[] = [];
		expect(() => x.subscribe((msgs) => log.push(msgs))).toThrow();
		expect(() => x.subscribe((msgs) => log.push(msgs))).toThrow();
		expect(log).toEqual([]);
		expect(lifecycle(g, "X")).toBe("inactive");
		expect(lifecycle(g, "a")).toBe("inactive");
		expect(current(g, "X")).toEqual(["a"]);

		g.node<number>([a], sum, { name: "G" });
		const taken = sinkOf(x);
		expect(current(g, "X")).toEqual(["G"]);
		expect(taken).toEqual([[["START"], ["DATA", 1]]]); // what X sends on G's value
		taken.length = 0;
		a.set(5);
		expect(taken).toEqual([pending(["DATA", 5])]);
	});

	it("a subscription to Y over [b, X] is refused, and Y, X, a and b stay inactive on their dependencies", () => {
		const { g, b, x } = seededX();
		const y = g.node<number>([b, x], sum, { name: "Y" });
		expect(() => y.subscribe(() => {})).toThrow();
		for (const id of ["Y", "X", "a", "b"]) expect(lifecycle(g, id)).toBe("inactive");
		expect(current(g, "Y")).toEqual(["b", "X"]);
		expect(current(g, "X")).toEqual(["a"]);
	});

	it("Z's rewire onto [a, X] and the replace of Z onto [a, X] are refused; Z stays active on [a]", () => {
		const { g, a, x } = seededX();
		let zctx: Ctx | undefined;
		const z = g.node<number>(
			[a],
			(ctx) => {
				zctx = ctx;
				sum(ctx);
			},
			{ name: "Z" },
		);
		const log = sinkOf(z);
		expect(() => zctx?.rewire([a, x])).toThrow();
		expect(() => g.replace(z, [a, x], sum)).toThrow();
		expect(current(g, "Z")).toEqual(["a"]);
		expect(declared(g, z)).toEqual(["a"]);
		expect(lifecycle(g, "Z")).toBe("active");
		expect(lifecycle(g, "X")).toBe("inactive");
		log.length = 0;
		a.set(5);
		expect(log).toEqual([pending(["DATA", 5])]);
	});
});

describe("C-54 (R-request-order@7): replace and rewire are refused through current and seed dependencies", () => {
	it("on the live graph, the replace of Y onto [X] is refused after X rewired itself to [Y]", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let xctx: Ctx | undefined;
		const x = g.node<number>(
			[a],
			(ctx) => {
				xctx = ctx;
				sum(ctx);
			},
			{ name: "X", recipe: { ref: "sum" } },
		);
		const y = g.node<number>([a], sum, { name: "Y", recipe: { ref: "sum" } });
		const xs = sinkOf(x);
		sinkOf(y);
		xctx?.rewire([y]);
		expect(current(g, "X")).toEqual(["Y"]);
		expect(() => g.replace(y, [x], sum, { recipe: { ref: "sum" } })).toThrow();
		expect(declared(g, y)).toEqual(["a"]);
		xs.length = 0;
		a.set(2);
		expect(xs).toEqual([pending(["DATA", 2])]); // a reaches X through Y
	});

	/** y and z over [a]; x over [a] with a seed whose first lifetime is on [y, z]. */
	function seededOnYZ() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const y = g.node<number>([a], sum, { name: "y" });
		let zctx: Ctx | undefined;
		const z = g.node<number>(
			[a],
			(ctx) => {
				zctx = ctx;
				sum(ctx);
			},
			{ name: "z" },
		);
		const x = g.node<number>([a], sum, seeded("x", { values: [2], deps: ["y", "z"] }));
		return { g, a, x, y, z, zctx: () => zctx as Ctx };
	}

	it("the replace of y onto [x] is refused before and after x's first activation", () => {
		const { g, a, x, y } = seededOnYZ();
		expect(() => g.replace(y, [x], sum)).toThrow();
		expect(declared(g, y)).toEqual(["a"]);
		const log = sinkOf(x);
		expect(current(g, "x")).toEqual(["y", "z"]);
		expect(() => g.replace(y, [x], sum)).toThrow();
		expect(declared(g, y)).toEqual(["a"]);
		log.length = 0;
		a.set(3);
		expect(log).toEqual([pending(["DATA", 6])]); // a reaches x through y and z
	});

	it("z's rewire onto [x] is refused; z keeps its dependencies and a's write reaches it", () => {
		const { g, a, z, x, zctx } = seededOnYZ();
		const log = sinkOf(z);
		expect(() => zctx().rewire([x])).toThrow();
		expect(current(g, "z")).toEqual(["a"]);
		log.length = 0;
		a.set(2);
		expect(log).toEqual([pending(["DATA", 2])]);
	});

	it("after a replace of x itself, whose new instance holds no seed, the replace of y onto [x] is accepted", () => {
		const { g, a, x, y } = seededOnYZ();
		g.replace(x, [a], sum);
		expect(() => g.replace(y, [x], sum)).not.toThrow();
		expect(declared(g, y)).toEqual(["x"]);
	});

	it("a seed may name a node not made yet, and the check passes over it", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const x = g.node<number>([a], sum, seeded("x", { deps: ["later"] }));
		const y = g.node<number>([a], sum, { name: "y" });
		expect(() => g.replace(y, [x], sum)).not.toThrow();
		expect(declared(g, y)).toEqual(["x"]);
	});
});
