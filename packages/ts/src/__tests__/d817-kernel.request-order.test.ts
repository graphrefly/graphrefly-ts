/**
 * D817 kernel report (graphrefly-ts:D817-KERNEL-REPORT-TS): the order of queued requests.
 *
 * TS harness for the live-graph clauses of the root scenario C-51 and the corrected clauses of
 * C-35 in ~/src/graphrefly/spec/conformance.jsonl, against R-request-order@7 (graphrefly:D818,
 * D821, D826). C-51's capture and restore clause belongs to the checkpoint phase.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { HostFailure } from "../graph/graph-types.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;
type Entry = readonly [string, Wave];

const none = <T>() => undefined as unknown as T;
const current = (g: Graph, id: string) => g.describe().find((n) => n.id === id)?.deps;
/** A dependency's graph id, whether the definition gives it as an id or as the node. */
const idOf = (g: Graph, dep: unknown) =>
	typeof dep === "string" ? dep : g.describe().find((n) => g.find(n.id) === dep)?.id;
const declared = (g: Graph, node: Node<unknown>) => g.definition(node).deps.map((d) => idOf(g, d));
const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];

/**
 * C-51's first graph: X over t and Y over u, X created first. At its dependency's first value each
 * function writes twice to the log (or, with `batchLog`, opens a batch of the two writes) and then
 * rewires itself to add ex (X) or ey (Y). Every sink pushes what it receives into one `order`.
 */
function firstGraph(opts: { batchLog?: boolean } = {}) {
	const g = graph();
	const t = g.state<number>(none(), { name: "t" });
	const u = g.state<number>(none(), { name: "u" });
	const log = g.state<string>(none(), { name: "log" });
	const ex = g.state("X", { name: "ex" });
	const ey = g.state("Y", { name: "ey" });
	const ctxs: Record<string, Ctx> = {};
	const moving = (name: string, own: Node<unknown>, extra: Node<unknown>) => (ctx: Ctx) => {
		ctxs[name] = ctx;
		if (ctx.deps.length === 1 && ctx.deps[0].waves.some((w) => w.length > 0)) {
			const write = () => {
				log.set(`${name}1`);
				log.set(`${name}2`);
			};
			if (opts.batchLog) g.batch(write);
			else write();
			ctx.rewire([own, extra]);
		}
		ctx.down([["DATA", ctx.deps.map((d) => `${d.id}=${d.has ? d.value : "-"}`).join(",")]]);
	};
	const x = g.node<string>([t], moving("x", t, ex), { name: "x" });
	const y = g.node<string>([u], moving("y", u, ey), { name: "y" });
	const order: Entry[] = [];
	const sink = (id: string, node: { subscribe(s: (m: Wave) => void): () => void }) =>
		node.subscribe((msgs) => order.push([id, msgs]));
	return { g, t, u, log, ex, ey, x, y, ctxs, order, sink };
}

/** The log's arrays and the arrays X and Y send after their rewires, in delivery order. */
const moved = (order: readonly Entry[]) =>
	order.filter(
		([id, msgs]) =>
			id === "log" ||
			id === "z" ||
			msgs.some((m) => m[0] === "DATA" && /e[xy]=/.test(String(m[1]))),
	);

const X_REQUESTS: Entry[] = [
	["log", pending(["DATA", "x1"])],
	["log", pending(["DATA", "x2"])],
	["x", pending(["DATA", "t=1,ex=X"])],
];
const Y_REQUESTS: Entry[] = [
	["log", pending(["DATA", "y1"])],
	["log", pending(["DATA", "y2"])],
	["y", pending(["DATA", "u=1,ey=Y"])],
];

describe("C-51 (R-request-order@7): requests functions make in one wave run in their nodes' creation order", () => {
	for (const sinks of [
		["x", "y"],
		["y", "x"],
	] as const)
		for (const writes of [
			["u", "t"],
			["t", "u"],
		] as const)
			it(`X's requests run before Y's: sinks ${sinks.join(", ")}, batch writes ${writes.join(", ")}`, () => {
				const f = firstGraph();
				for (const id of sinks) f.sink(id, f[id]);
				f.sink("log", f.log);
				f.order.length = 0;
				f.g.batch(() => {
					for (const id of writes) f[id].set(1);
				});
				expect(moved(f.order)).toEqual([...X_REQUESTS, ...Y_REQUESTS]);
			});

	it("a sink callback's write keeps the place it was made at: X's requests, the write, Y's requests", () => {
		const f = firstGraph();
		const z = f.g.state(0, { name: "z" });
		f.sink("x", f.x);
		let wrote = false;
		f.y.subscribe((msgs) => {
			f.order.push(["y", msgs]);
			if (!wrote && msgs.some((m) => m[0] === "DATA" && m[1] === "u=1")) {
				wrote = true;
				z.set(1);
			}
		});
		f.sink("log", f.log);
		f.sink("z", z);
		f.order.length = 0;
		f.g.batch(() => {
			f.u.set(1);
			f.t.set(1);
		});
		expect(moved(f.order)).toEqual([...X_REQUESTS, ["z", pending(["DATA", 1])], ...Y_REQUESTS]);
	});

	it("requests made in different waves keep the order of their waves: Y's (u's wave) before X's (t's wave)", () => {
		const f = firstGraph();
		f.u.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === "DATA")) f.t.set(1);
		});
		f.sink("x", f.x);
		f.sink("y", f.y);
		f.sink("log", f.log);
		f.order.length = 0;
		f.u.set(1);
		expect(moved(f.order)).toEqual([...Y_REQUESTS, ...X_REQUESTS]);
	});

	it("rewires asked for in a batch body, outside any function, run in the body's order", () => {
		const f = firstGraph();
		f.sink("x", f.x);
		f.sink("y", f.y);
		f.order.length = 0;
		f.g.batch(() => {
			(f.ctxs.y as Ctx).rewire([f.u, f.ey]);
			(f.ctxs.x as Ctx).rewire([f.t, f.ex]);
		});
		expect(f.order).toEqual([
			["y", pending(["DATA", "u=-,ey=Y"])],
			["x", pending(["DATA", "t=-,ex=X"])],
		]);
	});

	it("a batch a function opened commits as that function's request: X's commit runs before Y's", () => {
		const f = firstGraph({ batchLog: true });
		f.sink("y", f.y);
		f.sink("x", f.x);
		f.sink("log", f.log);
		f.order.length = 0;
		f.g.batch(() => {
			f.u.set(1);
			f.t.set(1);
		});
		expect(moved(f.order)).toEqual([
			["log", pending(["DATA", "x1"], ["DATA", "x2"])],
			["x", pending(["DATA", "t=1,ex=X"])],
			["log", pending(["DATA", "y1"], ["DATA", "y2"])],
			["y", pending(["DATA", "u=1,ey=Y"])],
		]);
	});
});

/**
 * C-51's second graph: operators A (created first) and B over one source s. On each source value
 * an operator replaces its inner with an instance over its feed and then rewires itself onto it;
 * when its inner ends it rewires itself back to [s]. The inners are created after the operators.
 */
function operators() {
	const g = graph();
	const s = g.state(1, { name: "s" });
	const feeds = { A: g.state(0, { name: "fa" }), B: g.state(0, { name: "fb" }) };
	const inners: Record<string, Node<string>> = {};
	const innerCtx: Record<string, Ctx> = {};
	const innerFn = (name: string, tag: string) => (ctx: Ctx) => {
		innerCtx[name] = ctx;
		for (const w of ctx.deps[0].waves)
			if (w.length > 0) ctx.down(w.map((v) => ["DATA", `${tag}:${v}`]) as Wave);
	};
	const op = (name: "A" | "B") => (ctx: Ctx) => {
		const inner = inners[name] as Node<string>;
		for (const v of ctx.deps[0].waves.flat()) {
			g.replace(inner, [feeds[name]], innerFn(name, `${name}${v}`));
			ctx.rewire([s, inner]);
		}
		const held = ctx.deps[1];
		if (held === undefined) return;
		for (const w of held.waves) if (w.length > 0) ctx.down(w.map((v) => ["DATA", v]) as Wave);
		if (held.terminal !== undefined) ctx.rewire([s]);
	};
	const a = g.node<string>([s], op("A"), { name: "A", complete: "manual" });
	const b = g.node<string>([s], op("B"), { name: "B", complete: "manual" });
	inners.A = g.node<string>([feeds.A], innerFn("A", "A0"), { name: "iA" });
	inners.B = g.node<string>([feeds.B], innerFn("B", "B0"), { name: "iB" });
	return { g, s, feeds, a, b, innerCtx };
}

describe("C-51 (R-request-order@7): each operator's replace runs before its own rewire", () => {
	it("A sends the new inner's value once, not the ended inner's again, and later values reach A's sink", () => {
		const f = operators();
		const logs: Record<string, Wave[]> = { A: [], B: [] };
		f.b.subscribe((msgs) => logs.B?.push(msgs));
		f.a.subscribe((msgs) => logs.A?.push(msgs));
		for (const id of ["A", "B"])
			expect(logs[id]).toEqual([[["START"]], pending(["DATA", `${id}1:0`])]);

		for (const id of ["A", "B"]) {
			logs[id]!.length = 0;
			(f.innerCtx[id] as Ctx).down([["COMPLETE"]]);
			expect(logs[id]).toEqual([pending(["RESOLVED"])]);
			expect(current(f.g, id)).toEqual(["s"]);
			logs[id]!.length = 0;
		}

		f.s.set(2);
		for (const id of ["A", "B"]) {
			expect(logs[id]).toEqual([pending(["RESOLVED"]), pending(["DATA", `${id}2:0`])]);
			expect(current(f.g, id)).toEqual(["s", `i${id}`]);
			logs[id]!.length = 0;
		}
		f.feeds.A.set(5);
		expect(logs.A).toEqual([pending(["DATA", "A2:5"])]);
	});
});

describe("C-35 (R-request-order@7): corrected rewire and replace clauses", () => {
	it("a rewire with a repeated dependency is accepted", () => {
		const g = graph();
		const b = g.state(1, { name: "b" });
		let kept: Ctx | undefined;
		const d = g.node<number>(
			[b],
			(ctx) => {
				kept = ctx;
				ctx.down([["DATA", ctx.deps[0].value as number]]);
			},
			{ name: "d" },
		);
		d.subscribe(() => {});
		expect(() => kept?.rewire([b, b])).not.toThrow();
		expect(current(g, "d")).toEqual(["b", "b"]);
		expect(declared(g, d)).toEqual(["b"]);
	});

	it("of two replaces in one batch body, the second closes a cycle: refused when it runs, reported as a queued request", () => {
		const reports: HostFailure[] = [];
		const g = graph({ report: (failure) => reports.push(failure) });
		const b = g.state(1, { name: "b" });
		const x = g.node<number>([b], () => {}, { name: "x" });
		const y = g.node<number>([b], () => {}, { name: "y" });
		g.batch(() => {
			g.replace(x, [y], () => {});
			g.replace(y, [x], () => {});
		});
		expect(declared(g, x)).toEqual(["y"]);
		expect(declared(g, y)).toEqual(["b"]);
		expect(reports.map((r) => r.source)).toEqual(["queued request"]);
		expect(text(reports[0]?.error)).toMatch(/itself|depends on it/);
	});

	it("of two rewires asked for from one sink callback, the second closes a cycle: refused when it runs, reported as a queued request", () => {
		const reports: HostFailure[] = [];
		const g = graph({ report: (failure) => reports.push(failure) });
		const b = g.state(1, { name: "b" });
		const ctxs: Record<string, Ctx> = {};
		const keep = (id: string) => (ctx: Ctx) => {
			ctxs[id] = ctx;
		};
		const x = g.node<number>([b], keep("x"), { name: "x" });
		const y = g.node<number>([b], keep("y"), { name: "y" });
		x.subscribe(() => {});
		y.subscribe(() => {});
		let asked = false;
		b.subscribe((msgs) => {
			if (asked || !msgs.some((m) => m[0] === "DATA" && m[1] === 2)) return;
			asked = true;
			(ctxs.x as Ctx).rewire([b, y]);
			(ctxs.y as Ctx).rewire([b, x]);
		});
		b.set(2);
		expect(current(g, "x")).toEqual(["b", "y"]);
		expect(current(g, "y")).toEqual(["b"]);
		expect(reports.map((r) => r.source)).toEqual(["queued request"]);
		expect(text(reports[0]?.error)).toMatch(/itself|depends on it/);
	});
});
