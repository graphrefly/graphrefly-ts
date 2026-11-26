/**
 * D817 kernel report (graphrefly-ts:D817-KERNEL-REPORT-TS): a dependency given more than once.
 *
 * TS harness for the live-graph clauses of the root scenario C-53 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-request-order@7 (graphrefly:D821: each place
 * is a connection of its own, at a creation, a rewire and a replace), R-wave@4, R-terminals@2 and
 * R-invocation@4. C-53's capture and restore clauses belong to the checkpoint phase.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, CtxDep } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;
type Told = CtxDep & { readonly replaced: boolean };

const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const sent = (text: string): Wave => pending(["DATA", text]);
const current = (g: Graph, id: string) => g.describe().find((n) => n.id === id)?.deps;
const idOf = (g: Graph, dep: unknown) =>
	typeof dep === "string" ? dep : g.describe().find((n) => g.find(n.id) === dep)?.id;
const declared = (g: Graph, node: Node<unknown>) => g.definition(node).deps.map((d) => idOf(g, d));

/** For each place: the dependency's id, its arrays in this run, its latest value and its terminal. */
const seen = (ctx: Ctx) =>
	ctx.down([
		[
			"DATA",
			ctx.deps
				.map(
					(d) =>
						`${d.id}:${JSON.stringify(d.waves)}/${d.has ? d.value : "-"}${d.terminal ? `/${d.terminal.kind}` : ""}`,
				)
				.join(" "),
		],
	]);

/** X with a sink; its function is `seen` and its ctx is kept for rewires from outside. */
function withX(g: Graph, deps: readonly Node<unknown>[]) {
	let kept: Ctx | undefined;
	const x = g.node<string>(
		[...deps],
		(ctx) => {
			kept = ctx;
			seen(ctx);
		},
		{ name: "x" },
	);
	const log: Wave[] = [];
	x.subscribe((msgs) => log.push(msgs));
	log.length = 0;
	return { x, log, ctx: () => kept as Ctx };
}

describe("C-53 (R-request-order@7): a rewire with a repeated dependency", () => {
	it("[a] -> [a, a] keeps the connection and adds one whose snapshot alone is the input; a's next array reaches both places in one run", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const { log, ctx } = withX(g, [a]);
		ctx().rewire([a, a]);
		expect(log).toEqual([sent("a:[]/1 a:[[1]]/1")]);
		expect(current(g, "x")).toEqual(["a", "a"]);
		log.length = 0;
		a.set(2);
		expect(log).toEqual([sent("a:[[2]]/2 a:[[2]]/2")]);
	});

	it("[a, a] -> [a] keeps the earlier connection and releases the later without a wave; a stays active", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const order: string[] = [];
		let kept: Ctx | undefined;
		const x = g.node<string>(
			[a],
			(ctx) => {
				kept = ctx;
				seen(ctx);
			},
			{ name: "x" },
		);
		const y = g.node<string>([a], seen, { name: "y" });
		const xs: Wave[] = [];
		x.subscribe((msgs) => {
			xs.push(msgs);
			order.push("x");
		});
		y.subscribe(() => order.push("y"));
		kept?.rewire([a, a]);
		xs.length = 0;
		kept?.rewire([a]);
		expect(xs).toEqual([]);
		expect(current(g, "x")).toEqual(["a"]);
		expect(a.status.lifecycle).toBe("active");
		order.length = 0;
		a.set(3);
		expect(xs).toEqual([sent("a:[[3]]/3")]);
		// The earlier connection stayed, so x is before y among a's subscribers again.
		expect(order).toEqual(["x", "y"]);
	});

	it("[a, a] -> [a, b, a] keeps both connections in order; only b's snapshot is the input", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(10, { name: "b" });
		const { log, ctx } = withX(g, [a, a]);
		ctx().rewire([a, b, a]);
		expect(log).toEqual([sent("a:[]/1 b:[[10]]/10 a:[]/1")]);
		log.length = 0;
		a.set(2);
		expect(log).toEqual([sent("a:[[2]]/2 b:[]/10 a:[[2]]/2")]);
		log.length = 0;
		b.set(20);
		expect(log).toEqual([sent("a:[]/2 b:[[20]]/20 a:[]/2")]);
	});

	it("[a, b] -> [b, a, a] keeps a's first connection and brings a's snapshot at the second; -> [b] releases every connection to a", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(10, { name: "b" });
		const { log, ctx } = withX(g, [a, b]);
		ctx().rewire([b, a, a]);
		expect(log).toEqual([sent("b:[]/10 a:[]/1 a:[[1]]/1")]);
		log.length = 0;
		ctx().rewire([b]);
		expect(log).toEqual([]);
		expect(a.status.lifecycle).toBe("inactive");
		a.set(3);
		expect(log).toEqual([]);
		b.set(11);
		expect(log).toEqual([sent("b:[[11]]/11")]);
	});
});

describe("C-53 (R-request-order@7): a replace with a repeated dependency", () => {
	it("gives every place of the new instance a START snapshot and releases b; the replace back acquires b again", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(10, { name: "b" });
		const { x, log } = withX(g, [a, b]);
		g.replace(x, [a, a], seen);
		expect(log).toEqual([[["START"], ["DATA", "a:[[1]]/1 a:[[1]]/1"]]]);
		expect(b.status.lifecycle).toBe("inactive");
		log.length = 0;
		a.set(2);
		expect(log).toEqual([sent("a:[[2]]/2 a:[[2]]/2")]);
		log.length = 0;
		g.replace(x, [a, b], seen);
		expect(log).toEqual([[["START"], ["DATA", "a:[[2]]/2 b:[[10]]/10"]]]);
		expect(declared(g, x)).toEqual(["a", "b"]);
		expect(b.status.lifecycle).toBe("active");
	});

	it("an inactive node only changes its definition and gets both places at its activation", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const cold = g.node<string>([a], seen, { name: "cold" });
		g.replace(cold, [a, a], seen);
		expect(declared(g, cold)).toEqual(["a", "a"]);
		expect(a.status.lifecycle).toBe("inactive");
		const log: Wave[] = [];
		cold.subscribe((msgs) => log.push(msgs));
		expect(log).toEqual([[["START"], ["DATA", "a:[[1]]/1 a:[[1]]/1"]]]);
	});

	it("an ended node gets a new instance over both places", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const e = g.node<number>([a, a], (ctx) => ctx.down([["DATA", 1], ["COMPLETE"]]), {
			name: "e",
		});
		const log: Wave[] = [];
		const stop = e.subscribe((msgs) => log.push(msgs));
		expect(e.status.output).toBe("completed");
		log.length = 0;
		g.replace(e, [a, a], seen);
		expect(log).toEqual([[["START"], ["DATA", "a:[[1]]/1 a:[[1]]/1"]]]);
		expect(e.status.output).toBe("open");
		stop();
		expect(a.status.lifecycle).toBe("inactive");
	});
});

describe("C-53 (R-wave@4): one array of a repeated dependency settles each place once, and the node runs once", () => {
	it("Z over [X, a, X] with X over [a, a]: one run each per write, per batch of two writes, and per INVALIDATE", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const runs = { x: 0, z: 0 };
		const sum = (id: "x" | "z") => (ctx: Ctx) => {
			runs[id]++;
			if (ctx.deps.every((d) => d.has))
				ctx.down([["DATA", ctx.deps.reduce((s, d) => s + (d.value as number), 0)]]);
		};
		const x = g.node<number>([a, a], sum("x"), { name: "x" });
		const z = g.node<number>([x, a, x], sum("z"), { name: "z" });
		const log: Wave[] = [];
		z.subscribe((msgs) => log.push(msgs));
		expect(log).toEqual([[["START"], ["DATA", 5]]]);
		expect(runs).toEqual({ x: 1, z: 1 });
		log.length = 0;
		a.set(2);
		expect(log).toEqual([pending(["DATA", 10])]);
		expect(runs).toEqual({ x: 2, z: 2 });
		log.length = 0;
		g.batch(() => {
			a.set(3);
			a.set(4);
		});
		expect(log).toEqual([pending(["DATA", 20])]);
		expect(runs).toEqual({ x: 3, z: 3 });
		log.length = 0;
		a.invalidate();
		expect(log).toEqual([pending(["INVALIDATE"])]);
	});
});

describe("C-53 (R-terminals@2): a repeated dependency's terminal under the auto policies", () => {
	it("a's COMPLETE counts at each of its places and X stays open until b completes", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(1, { name: "b" });
		const { x, log } = withX(g, [a, b, a]);
		a.complete();
		expect(log).toEqual([pending(["RESOLVED"])]);
		expect(x.status.output).toBe("open");
		log.length = 0;
		b.complete();
		expect(log).toEqual([sent("a:[]/1 b:[]/1/complete a:[]/1"), pending(["COMPLETE"])]);
		expect(x.status.output).toBe("completed");
	});

	it("a's ERROR ends X over [a, a] with one ERROR", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const { log } = withX(g, [a, a]);
		a.error("bad");
		expect(log).toEqual([pending(["ERROR", "bad"])]);
	});
});

describe("C-53 (R-invocation@4): a replaced dependency is told at every place it has", () => {
	it("X over [n, b, n] is told that n was replaced at both of its places and not at b's, in one run", () => {
		const g = graph();
		const s = g.state(1, { name: "s" });
		const b = g.state(0, { name: "b" });
		const passOn = (ctx: Ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]);
		const n = g.node<number>([s], passOn, { name: "n" });
		const toldRuns: string[] = [];
		const x = g.node<number>(
			[n, b, n],
			(ctx) => {
				toldRuns.push((ctx.deps as readonly Told[]).map((d) => (d.replaced ? 1 : 0)).join(""));
			},
			{ name: "x" },
		);
		x.subscribe(() => {});
		g.replace(n, [s], passOn); // the new instance holds a value, so X runs at once
		b.set(1);
		expect(toldRuns).toEqual(["000", "101", "000"]);
	});
});
