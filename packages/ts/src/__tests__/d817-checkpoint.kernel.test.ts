/**
 * D817 checkpoint re-port, step 1 (graphrefly-ts:D817): the kernel's later rules across a capture
 * and restore.
 *
 * TS harness for the capture and restore clauses of the root scenarios C-51, C-52, C-53, C-54,
 * C-55 and C-57 in ~/src/graphrefly/spec/conformance.jsonl, against R-checkpoint@3 with
 * R-request-order@7, R-subscription@5, R-invocation@4 and R-node@4. Their live-graph clauses are
 * in d817-kernel.*.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, CtxDep } from "../ctx/types.js";
import type { GraphCheckpoint } from "../graph/checkpoint.js";
import { graph } from "../graph/graph.js";
import { type GraphRestoreRegistry, restoreGraph } from "../graph/restore.js";
import type { Node, StateNode } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;
type Entry = readonly [string, Wave];

const none = <T>() => undefined as unknown as T;
const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const current = (g: Graph, id: string) => g.describe().find((n) => n.id === id)?.deps;
const idOf = (g: Graph, dep: unknown) =>
	typeof dep === "string" ? dep : g.describe().find((n) => g.find(n.id) === dep)?.id;
const declared = (g: Graph, id: string) => g.definition(id).deps.map((d) => idOf(g, d));
const stateOf = <T>(g: Graph, id: string) => g.find(id) as unknown as StateNode<T>;
const nodeOf = (g: Graph, id: string): Node<unknown> => {
	const n = g.find(id);
	if (n === undefined) throw new Error(`no node ${id}`);
	return n;
};
const sinkOf = (node: Node<unknown>) => {
	const log: Wave[] = [];
	node.subscribe((msgs) => log.push(msgs));
	return log;
};
const restore = (g: Graph | GraphCheckpoint, registry: GraphRestoreRegistry) =>
	restoreGraph(roundTrip("checkpoint" in g ? g.checkpoint() : g), { registry });
const sum = (ctx: Ctx) =>
	ctx.down([["DATA", ctx.deps.reduce((s, d) => s + ((d.value as number | undefined) ?? 0), 0)]]);

describe("C-51 (R-checkpoint@3): a restored graph runs one wave's requests in its nodes' creation order", () => {
	/**
	 * C-51's first graph, every computed node from a recipe: X over t and Y over u, X created first.
	 * At its dependency's first value each function writes twice to the log and then rewires itself
	 * to add ex (X) or ey (Y). The factory finds the log and the extra state in the graph it builds in.
	 */
	const moving = (g: Graph, name: string, extra: string) => (ctx: Ctx) => {
		if (ctx.deps.length === 1 && ctx.deps[0].waves.some((w) => w.length > 0)) {
			const log = stateOf<string>(g, "log");
			log.set(`${name}1`);
			log.set(`${name}2`);
			ctx.rewire([nodeOf(g, ctx.deps[0].id), nodeOf(g, extra)]);
		}
		ctx.down([["DATA", ctx.deps.map((d) => `${d.id}=${d.has ? d.value : "-"}`).join(",")]]);
	};
	const registry: GraphRestoreRegistry = {
		moving: {
			ref: "moving",
			build: (config, ctx) => {
				const { name, extra } = config as { name: string; extra: string };
				return { fn: moving(ctx.graph, name, extra) };
			},
		},
	};
	function firstGraph() {
		const g = graph();
		const t = g.state<number>(none(), { name: "t" });
		const u = g.state<number>(none(), { name: "u" });
		g.state<string>(none(), { name: "log" });
		g.state("X", { name: "ex" });
		g.state("Y", { name: "ey" });
		for (const [name, dep, extra] of [
			["x", t, "ex"],
			["y", u, "ey"],
		] as const)
			g.node<string>([dep], moving(g, name, extra), {
				name,
				recipe: { ref: "moving", config: { name, extra } },
			});
		return g;
	}
	const moved = (order: readonly Entry[]) =>
		order.filter(
			([id, msgs]) =>
				id === "log" || msgs.some((m) => m[0] === "DATA" && /e[xy]=/.test(String(m[1]))),
		);
	const X_THEN_Y: Entry[] = [
		["log", pending(["DATA", "x1"])],
		["log", pending(["DATA", "x2"])],
		["x", pending(["DATA", "t=1,ex=X"])],
		["log", pending(["DATA", "y1"])],
		["log", pending(["DATA", "y2"])],
		["y", pending(["DATA", "u=1,ey=Y"])],
	];

	for (const sinks of [
		["x", "y"],
		["y", "x"],
	] as const)
		for (const writes of [
			["u", "t"],
			["t", "u"],
		] as const)
			it(`C-51 (R-checkpoint@3): captured before any write and restored, X's requests run before Y's: sinks ${sinks.join(", ")}, batch writes ${writes.join(", ")}`, () => {
				const live = firstGraph();
				for (const id of ["x", "y"]) nodeOf(live, id).subscribe(() => {});
				for (const g of [live, firstGraph()]) {
					const r = restore(g, registry);
					const order: Entry[] = [];
					for (const id of [...sinks, "log"])
						nodeOf(r, id).subscribe((msgs) => order.push([id, msgs]));
					order.length = 0;
					r.batch(() => {
						for (const id of writes) stateOf<number>(r, id).set(1);
					});
					expect(moved(order)).toEqual(X_THEN_Y);
				}
			});
});

describe("C-52 (R-checkpoint@3): a dependency replaced before the capture is saved as such, and the restored function is told once", () => {
	/** a passes its input on. */
	const passOn = (ctx: Ctx) => {
		for (const w of ctx.deps[0].waves)
			if (w.length > 0) ctx.down(w.map((v) => ["DATA", v]) as Wave);
	};
	type Told = CtxDep & { readonly replaced: boolean };
	/** Z: counts completed inputs in private state, drops an input it is told was replaced. */
	const counting = (ctx: Ctx) => {
		const deps = ctx.deps as readonly Told[];
		const was = ctx.state.get<boolean[]>() ?? deps.map(() => false);
		const done = deps.map(
			(d, i) => (was[i] === true && d.replaced !== true) || d.terminal?.kind === "complete",
		);
		ctx.state.set(done);
		const flags = (xs: readonly unknown[]) => xs.map((x) => (x === true ? 1 : 0)).join("");
		ctx.down([["DATA", `done=${flags(done)} replaced=${flags(deps.map((d) => d.replaced))}`]]);
		if (done.every(Boolean)) ctx.down([["COMPLETE"]]);
	};
	const registry: GraphRestoreRegistry = {
		pass: { ref: "pass", build: () => ({ fn: passOn }) },
		counting: { ref: "counting", build: () => ({ fn: counting }) },
	};
	/** sa = 1, empty without a value, b = 0; a over sa; Z over [a, b] with the manual COMPLETE policy. */
	function replacedBeforeCapture() {
		const g = graph();
		const sa = g.state(1, { name: "sa" });
		const empty = g.state<number>(none(), { name: "empty" });
		const b = g.state(0, { name: "b" });
		const a = g.node<number>([sa], passOn, { name: "a", recipe: { ref: "pass" } });
		const z = g.node<string>([a, b], counting, {
			name: "z",
			complete: "manual",
			recipe: { ref: "counting" },
		});
		const log = sinkOf(z);
		sa.complete();
		g.replace(a, [empty], passOn, { recipe: { ref: "pass" } }); // Z does not run
		expect(log.at(-1)).toEqual(pending(["DATA", "done=10 replaced=00"]));
		return { g, b, z, log };
	}

	it("C-52 (R-checkpoint@3): restored before Z's next run, Z runs once at its first activation, told that a was replaced", () => {
		const { g } = replacedBeforeCapture();
		const r = restore(g, registry);
		const log = sinkOf(nodeOf(r, "z"));
		expect(log).toEqual([[["START"], ["DATA", "done=00 replaced=10"]]]);
		stateOf<number>(r, "b").set(10);
		expect(log.slice(1)).toEqual([pending(["DATA", "done=00 replaced=00"])]);
		stateOf<number>(r, "b").complete();
		expect(log.slice(2)).toEqual([pending(["DATA", "done=01 replaced=00"])]);
		expect(nodeOf(r, "z").status.output).toBe("open");
	});

	it("C-52 (R-checkpoint@3): the restored graph captured again before anything subscribes restores the same", () => {
		const { g } = replacedBeforeCapture();
		const again = restore(restore(g, registry), registry);
		const log = sinkOf(nodeOf(again, "z"));
		expect(log).toEqual([[["START"], ["DATA", "done=00 replaced=10"]]]);
		stateOf<number>(again, "b").set(10);
		expect(log.slice(1)).toEqual([pending(["DATA", "done=00 replaced=00"])]);
	});

	it("C-52 (R-checkpoint@3): captured after Z was told, the restored Z keeps its saved value and is not told", () => {
		const { g, b, log: live } = replacedBeforeCapture();
		b.set(10);
		expect(live.at(-1)).toEqual(pending(["DATA", "done=00 replaced=10"]));
		const r = restore(g, registry);
		const log = sinkOf(nodeOf(r, "z"));
		expect(log).toEqual([[["START"], ["DATA", "done=00 replaced=10"]]]);
		stateOf<number>(r, "b").set(11);
		expect(log.slice(1)).toEqual([pending(["DATA", "done=00 replaced=00"])]);
	});
});

describe("C-53 (R-checkpoint@3): a repeated dependency across a capture and restore", () => {
	/** X sends, for each place of its list, the dependency's id, the arrays it delivered and its value. */
	const report = (ctx: Ctx) =>
		ctx.down([
			[
				"DATA",
				ctx.deps.map((d) => `${d.id}:${JSON.stringify(d.waves)}:${String(d.value)}`).join(" "),
			],
		]);
	const ctxs: Record<string, Ctx> = {};
	const registry: GraphRestoreRegistry = {
		report: {
			ref: "report",
			build: (_config, rctx) => ({
				fn: (ctx: Ctx) => {
					ctxs[rctx.id] = ctx;
					report(ctx);
				},
			}),
		},
		sum: { ref: "sum", build: () => ({ fn: sum }) },
	};

	it("C-53 (R-checkpoint@3): X rewired to [a, a] is restored onto [a, a] with its saved value, and a's next value reaches both places", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		let xctx: Ctx | undefined;
		const x = g.node<string>(
			[a, b],
			(ctx) => {
				xctx = ctx;
				report(ctx);
			},
			{ name: "X", recipe: { ref: "report" } },
		);
		const live = sinkOf(x);
		xctx?.rewire([a, a]);
		expect(current(g, "X")).toEqual(["a", "a"]);
		const saved = x.cache;
		const r = restore(g, registry);
		expect(current(r, "X")).toEqual(["a", "b"]);
		const log = sinkOf(nodeOf(r, "X"));
		expect(log).toEqual([[["START"], ["DATA", saved]]]);
		expect(current(r, "X")).toEqual(["a", "a"]);
		expect(declared(r, "X")).toEqual(["a", "b"]);
		live.length = 0;
		a.set(3);
		stateOf<number>(r, "a").set(3);
		expect(log.slice(1)).toEqual([pending(["DATA", "a:[[3]]:3 a:[[3]]:3"])]);
		expect(log.slice(1)).toEqual(live);
	});

	for (const activateFirst of [true, false])
		it(`C-53 (R-checkpoint@3): a restored node that declares [a, a] is replaced onto [a, b] ${activateFirst ? "after" : "before"} its first activation, and its checkpoint then declares [a, b]`, () => {
			const g = graph();
			const a = g.state(1, { name: "a" });
			g.state(10, { name: "b" });
			sinkOf(g.node<number>([a, a], sum, { name: "n", recipe: { ref: "sum" } }));
			const r = restore(g, registry);
			const R = { recipe: { ref: "sum" } };
			const ra = nodeOf(r, "a");
			const rb = nodeOf(r, "b");
			let log: Wave[] = [];
			if (activateFirst) {
				log = sinkOf(nodeOf(r, "n"));
				expect(log).toEqual([[["START"], ["DATA", 2]]]);
				stateOf<number>(r, "a").set(2);
				expect(log.slice(1)).toEqual([pending(["DATA", 4])]);
				r.replace("n", [ra, rb], sum, R);
				expect(log.slice(2)).toEqual([[["START"], ["DATA", 12]]]);
			} else {
				r.replace("n", [ra, rb], sum, R);
				log = sinkOf(nodeOf(r, "n"));
				expect(log).toEqual([[["START"], ["DATA", 11]]]);
			}
			expect(declared(r, "n")).toEqual(["a", "b"]);
			expect(declared(restore(r, registry), "n")).toEqual(["a", "b"]);
		});
});

describe("C-54 (R-checkpoint@3): the cycle check covers a restored node's saved lifetime dependencies", () => {
	const ctxs: Record<string, Ctx> = {};
	const R = { recipe: { ref: "sum" } };
	const registry: GraphRestoreRegistry = {
		sum: {
			ref: "sum",
			build: (_config, rctx) => ({
				fn: (ctx: Ctx) => {
					ctxs[rctx.id] = ctx;
					sum(ctx);
				},
			}),
		},
	};
	/** a = 1; X and Y over [a] from recipes, each with a sink; X then rewires itself to [Y]. */
	function checkpointed() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let xctx: Ctx | undefined;
		const x = g.node<number>(
			[a],
			(ctx) => {
				xctx = ctx;
				sum(ctx);
			},
			{ name: "X", ...R },
		);
		const y = g.node<number>([a], sum, { name: "Y", ...R });
		sinkOf(x);
		sinkOf(y);
		xctx?.rewire([y]);
		expect(current(g, "X")).toEqual(["Y"]);
		expect(() => g.replace(y, [x], sum, R)).toThrow();
		return roundTrip(g.checkpoint());
	}

	it("C-54 (R-checkpoint@3): before X's first activation the restored graph refuses Y onto [X]; X then starts on [Y], and its capture restores", () => {
		const r = restore(checkpointed(), registry);
		expect(current(r, "X")).toEqual(["a"]);
		expect(() => r.replace("Y", [nodeOf(r, "X")], sum, R)).toThrow();
		expect(declared(r, "Y")).toEqual(["a"]);
		const log = sinkOf(nodeOf(r, "X"));
		expect(log).toEqual([[["START"], ["DATA", 1]]]);
		expect(current(r, "X")).toEqual(["Y"]);
		stateOf<number>(r, "a").set(5);
		expect(log.slice(1)).toEqual([pending(["DATA", 5])]);
		expect(() => restore(r, registry)).not.toThrow();
	});

	it("C-54 (R-checkpoint@3): Y's rewire onto [X] is refused in the restored graph; Y keeps its dependencies and a's write reaches it", () => {
		const r = restore(checkpointed(), registry);
		const log = sinkOf(nodeOf(r, "Y"));
		stateOf<number>(r, "a").set(2); // Y runs, so its ctx is at hand
		expect(log).toEqual([[["START"], ["DATA", 1]], pending(["DATA", 2])]);
		const yctx = ctxs.Y;
		if (yctx === undefined) throw new Error("Y ran");
		expect(() => yctx.rewire([nodeOf(r, "X")])).toThrow();
		expect(current(r, "Y")).toEqual(["a"]);
		stateOf<number>(r, "a").set(3);
		expect(log.slice(2)).toEqual([pending(["DATA", 3])]);
	});

	it("C-54 (R-checkpoint@3): after a replace of X itself before its first activation, Y onto [X] is accepted", () => {
		const r = restore(checkpointed(), registry);
		r.replace("X", [nodeOf(r, "a")], sum, R);
		expect(() => r.replace("Y", [nodeOf(r, "X")], sum, R)).not.toThrow();
		expect(declared(r, "Y")).toEqual(["X"]);
	});
});

describe("C-55 (R-checkpoint@3): the checkpoint holds the list and the recipe as they were given", () => {
	type Config = { k: number; nested: { list: number[] } };
	const given: Config[] = [];
	const plusK = (config: Config) => {
		const k = config.k;
		return (ctx: Ctx) =>
			ctx.down([["DATA", ctx.deps.reduce((s, d) => s + (d.value as number), 0) + k]]);
	};
	const registry: GraphRestoreRegistry = {
		plus: {
			ref: "plus",
			build: (config) => {
				given.push(roundTrip(config as Config));
				return { fn: plusK(config as Config) };
			},
		},
	};

	it("C-55 (R-checkpoint@3): changes the host makes to what it gave or read change neither the checkpoint nor the restored P", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const deps: Node<unknown>[] = [a];
		const config: Config = { k: 1, nested: { list: [1, 2] } };
		const p = g.node<number>(deps, plusK(config), { name: "P", recipe: { ref: "plus", config } });
		const live = sinkOf(p);
		deps.push(b);
		config.k = 50;
		config.nested.list.push(3);
		const read = g.definition(p) as unknown as {
			deps: Node<unknown>[];
			recipe: { config: Config };
		};
		try {
			(read.deps as Node<unknown>[]).push(b);
			read.recipe.config.k = 70;
			read.recipe.config.nested.list.push(4);
		} catch (e) {
			if (!(e instanceof TypeError)) throw e; // a frozen read refuses the change, as well
		}
		b.set(3);
		a.set(2);
		expect(live.slice(1)).toEqual([pending(["DATA", 3])]);
		given.length = 0;
		const r = restore(g, registry);
		expect(given).toEqual([{ k: 1, nested: { list: [1, 2] } }]);
		expect(declared(r, "P")).toEqual(["a"]);
		const log = sinkOf(nodeOf(r, "P"));
		expect(log).toEqual([[["START"], ["DATA", 3]]]);
		a.set(4);
		stateOf<number>(r, "a").set(4);
		expect(log.slice(1)).toEqual([pending(["DATA", 5])]);
		expect(live.slice(2)).toEqual(log.slice(1));
	});

	it("C-55 (R-checkpoint@3): a replace asked for in a batch body is captured with the list and recipe it was asked with", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		const c = g.state(3, { name: "c" });
		const config: Config = { k: 1, nested: { list: [] } };
		const p = g.node<number>([a], plusK(config), { name: "P", recipe: { ref: "plus", config } });
		sinkOf(p);
		g.batch(() => {
			const list: Node<unknown>[] = [b];
			const asked: Config = { k: 10, nested: { list: [7] } };
			g.replace(p, list, plusK(asked), { recipe: { ref: "plus", config: asked } });
			list.push(c);
			asked.k = 99;
			asked.nested.list.push(8);
		});
		expect(p.cache).toBe(12);
		given.length = 0;
		const r = restore(g, registry);
		expect(given).toEqual([{ k: 10, nested: { list: [7] } }]);
		expect(declared(r, "P")).toEqual(["b"]);
		expect(sinkOf(nodeOf(r, "P"))).toEqual([[["START"], ["DATA", 12]]]);
	});
});

describe("C-57 (R-checkpoint@3): a restored node does not see an equal value sent again before its first activation", () => {
	/** A running total of the values it was given, kept in private state. */
	const scan = (ctx: Ctx) => {
		const got = ctx.deps.flatMap((d) => d.waves.flat()) as number[];
		const total = got.reduce((s, v) => s + v, ctx.state.get<number>() ?? 0);
		ctx.state.set(total);
		ctx.down([["DATA", total]]);
	};
	const registry: GraphRestoreRegistry = { scan: { ref: "scan", build: () => ({ fn: scan }) } };
	/** a = 1; U, the running total of a; T, the running total of U's values; a sink on T. */
	function build() {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const u = g.node<number>([a], scan, { name: "U", recipe: { ref: "scan" } });
		const t = g.node<number>([u], scan, { name: "T", recipe: { ref: "scan" } });
		return { g, a, log: sinkOf(t) };
	}

	it("C-57 (R-checkpoint@3): live, T receives U's second 1 as an occurrence", () => {
		const { a, log } = build();
		log.length = 0;
		a.set(0);
		a.set(5);
		expect(log).toEqual([pending(["DATA", 2]), pending(["DATA", 8])]);
	});

	it("C-57 (R-checkpoint@3): restored and written first, U holds what T had received, so T does not run", () => {
		const r = restore(build().g, registry);
		stateOf<number>(r, "a").set(0);
		const log = sinkOf(nodeOf(r, "T"));
		expect(log).toEqual([[["START"], ["DATA", 1]]]);
		stateOf<number>(r, "a").set(5);
		expect(log.slice(1)).toEqual([pending(["DATA", 7])]);
	});

	it("C-57 (R-checkpoint@3): restored and subscribed first, T gives what the live graph gives", () => {
		const r = restore(build().g, registry);
		const log = sinkOf(nodeOf(r, "T"));
		expect(log).toEqual([[["START"], ["DATA", 1]]]);
		stateOf<number>(r, "a").set(0);
		stateOf<number>(r, "a").set(5);
		expect(log.slice(1)).toEqual([pending(["DATA", 2]), pending(["DATA", 8])]);
	});
});
