/**
 * D817 kernel report (graphrefly-ts:D817-KERNEL-REPORT-TS): the kernel keeps a definition as it
 * was given.
 *
 * TS harness for the live-graph clauses of the root scenario C-55 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-node@4 (graphrefly:D823) and
 * R-request-order@7: the dependency list and the recipe a host gives, and a definition it reads,
 * are the kernel's own, so a later change the host makes to them changes neither the node nor
 * describe. C-55's capture and restore clauses belong to the checkpoint phase.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;
type Recipe = { ref: string; config: { k: number; nested?: { list: number[] } } };

const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const current = (g: Graph, id: string) => g.describe().find((n) => n.id === id)?.deps;
const idOf = (g: Graph, dep: unknown) =>
	typeof dep === "string" ? dep : g.describe().find((n) => g.find(n.id) === dep)?.id;
const declared = (g: Graph, node: Node<unknown>) => g.definition(node).deps.map((d) => idOf(g, d));

/**
 * Change something the host holds. A kernel that hands out frozen data refuses the change with a
 * TypeError, which satisfies R-node@4 as well as a copy does.
 */
const tryChange = (change: () => void) => {
	try {
		change();
	} catch (e) {
		if (!(e instanceof TypeError)) throw e;
	}
};

describe("C-55 (R-node@4): the kernel keeps the dependency list and the recipe as they were given", () => {
	function setup() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const c = g.state(3, { name: "c" });
		let pctx: Ctx | undefined;
		// The factory reads k when it builds the function; P sends its dependencies' values plus k.
		const build = (config: Recipe["config"]) => {
			const k = config.k;
			return (ctx: Ctx) => {
				pctx = ctx;
				ctx.down([["DATA", ctx.deps.reduce((s, d) => s + (d.value as number), 0) + k]]);
			};
		};
		const deps: Node<unknown>[] = [a];
		const config = { k: 1, nested: { list: [1, 2] } };
		const p = g.node<number>(deps, build(config), { name: "p", recipe: { ref: "r", config } });
		const log: Wave[] = [];
		p.subscribe((msgs) => log.push(msgs));
		return { g, a, b, c, p, deps, config, build, log, ctx: () => pctx as Ctx };
	}
	const given = { ref: "r", config: { k: 1, nested: { list: [1, 2] } } };

	it("a change to the list or the configuration the host gave changes neither the definition nor describe", () => {
		const f = setup();
		expect(f.log).toEqual([[["START"], ["DATA", 2]]]);
		f.deps.push(f.b);
		f.config.k = 50;
		f.config.nested.list.push(3);
		expect(declared(f.g, f.p)).toEqual(["a"]);
		expect(current(f.g, "p")).toEqual(["a"]);
		expect(f.g.definition(f.p).recipe).toEqual(given);
	});

	it("a change to a definition the host read changes nothing the node holds", () => {
		const f = setup();
		const read = f.g.definition(f.p);
		tryChange(() => (read.deps as Node<unknown>[]).push(f.b));
		const recipe = read.recipe as Recipe;
		tryChange(() => {
			recipe.config.k = 7;
		});
		tryChange(() => {
			if (recipe.config.nested) recipe.config.nested.list.length = 0;
		});
		tryChange(() => {
			recipe.ref = "other";
		});
		expect(declared(f.g, f.p)).toEqual(["a"]);
		expect(current(f.g, "p")).toEqual(["a"]);
		expect(f.g.definition(f.p).recipe).toEqual(given);
	});

	it("b's write does not reach P, and P goes on with the k it was built with", () => {
		const f = setup();
		f.deps.push(f.b);
		f.config.k = 50;
		tryChange(() => {
			(f.g.definition(f.p).recipe as Recipe).config.k = 7;
		});
		f.log.length = 0;
		f.b.set(3);
		expect(f.log).toEqual([]);
		f.a.set(4);
		expect(f.log).toEqual([pending(["DATA", 5])]);
	});

	it("a replace asked for in a batch body takes the list and the recipe as they were when asked for", () => {
		const f = setup();
		const list: Node<unknown>[] = [f.b];
		const recipe = { ref: "r", config: { k: 10 } };
		f.log.length = 0;
		f.g.batch(() => {
			f.g.replace(f.p, list, f.build(recipe.config), { recipe });
			list.push(f.c);
			recipe.config.k = 99;
		});
		expect(declared(f.g, f.p)).toEqual(["b"]);
		expect(current(f.g, "p")).toEqual(["b"]);
		expect(f.g.definition(f.p).recipe).toEqual({ ref: "r", config: { k: 10 } });
		expect(f.log).toEqual([[["START"], ["DATA", 12]]]);
	});

	it("a rewire asked for through P's ctx in a batch body takes the list as it was when asked for", () => {
		const f = setup();
		const wired: Node<unknown>[] = [f.b, f.c];
		f.log.length = 0;
		f.g.batch(() => {
			f.ctx().rewire(wired);
			wired.pop();
		});
		expect(current(f.g, "p")).toEqual(["b", "c"]);
		expect(declared(f.g, f.p)).toEqual(["a"]);
		wired.push(f.a);
		expect(current(f.g, "p")).toEqual(["b", "c"]);
		expect(f.log).toEqual([pending(["DATA", 6])]); // b + c + k
		f.log.length = 0;
		f.c.set(30);
		expect(f.log).toEqual([pending(["DATA", 33])]);
	});
});
