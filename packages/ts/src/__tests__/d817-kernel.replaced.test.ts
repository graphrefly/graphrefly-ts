/**
 * D817 kernel report (graphrefly-ts:D817-KERNEL-REPORT-TS): a function is told that a dependency
 * was replaced.
 *
 * TS harness for the live-graph clauses of the root scenario C-52 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-invocation@4 and R-subscription@5
 * (graphrefly:D819): `ctx.deps[i].replaced` is true in the first run after that dependency got a
 * new instance while this node stayed active, and in no later run. C-52's capture and restore
 * clauses belong to the checkpoint phase.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, CtxDep } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Wave } from "../protocol/messages.js";

/** A dependency view with the R-invocation@4 `replaced` flag. */
type Told = CtxDep & { readonly replaced: boolean };
const told = (ctx: Ctx) => ctx.deps as readonly Told[];

const none = <T>() => undefined as unknown as T;
const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const sent = (text: string): Wave => pending(["DATA", text]);

/** a passes its input on. */
const passOn = (ctx: Ctx) => {
	for (const w of ctx.deps[0].waves) if (w.length > 0) ctx.down(w.map((v) => ["DATA", v]) as Wave);
};

/**
 * Z keeps in private state which inputs have completed, drops its count of an input it is told
 * was replaced, sends what it counts and what it was told, and completes once it counts both.
 */
const countingEnds = (ctx: Ctx) => {
	const deps = told(ctx);
	const was = ctx.state.get<boolean[]>() ?? deps.map(() => false);
	const done = deps.map(
		(d, i) => (was[i] === true && d.replaced !== true) || d.terminal?.kind === "complete",
	);
	ctx.state.set(done);
	const flags = (xs: readonly unknown[]) => xs.map((x) => (x === true ? 1 : 0)).join("");
	ctx.down([["DATA", `done=${flags(done)} replaced=${flags(deps.map((d) => d.replaced))}`]]);
	if (done.every(Boolean)) ctx.down([["COMPLETE"]]);
};

function countingGraph() {
	const g = graph();
	const sa = g.state(1, { name: "sa" });
	const full = g.state(2, { name: "full" });
	const empty = g.state<number>(none(), { name: "empty" });
	const b = g.state(0, { name: "b" });
	const a = g.node<number>([sa], passOn, { name: "a" });
	let zctx: Ctx | undefined;
	const z = g.node<string>(
		[a, b],
		(ctx) => {
			zctx = ctx;
			countingEnds(ctx);
		},
		{ name: "z", complete: "manual" },
	);
	const log: Wave[] = [];
	z.subscribe((msgs) => log.push(msgs));
	log.length = 0;
	return { g, sa, full, empty, b, a, z, log, zctx: () => zctx as Ctx };
}

describe("C-52 (R-invocation@4, R-subscription@5): a dependent is told once that a dependency was replaced", () => {
	it("a replace over an empty instance runs nothing; the next run is told, later ones are not, and b's COMPLETE leaves Z open", () => {
		const f = countingGraph();
		f.sa.complete();
		expect(f.log).toEqual([sent("done=10 replaced=00")]);
		f.log.length = 0;

		f.g.replace(f.a, [f.empty], passOn);
		expect(f.log).toEqual([]);
		f.b.set(10);
		expect(f.log).toEqual([sent("done=00 replaced=10")]);
		f.log.length = 0;
		f.b.set(11);
		expect(f.log).toEqual([sent("done=00 replaced=00")]);
		f.log.length = 0;
		f.b.complete();
		expect(f.log).toEqual([sent("done=01 replaced=00")]);
		expect(f.z.status.output).toBe("open");
	});

	it("a replace over an instance that holds a value runs Z at once, told; the next write tells it nothing", () => {
		const f = countingGraph();
		f.sa.complete();
		f.log.length = 0;
		f.g.replace(f.a, [f.full], passOn);
		expect(f.log).toEqual([sent("done=00 replaced=10")]);
		f.log.length = 0;
		f.b.set(10);
		expect(f.log).toEqual([sent("done=00 replaced=00")]);
	});

	it("replaced twice before Z's next run, Z is told once; a dependent created after the replaces is not told", () => {
		const f = countingGraph();
		f.sa.complete();
		f.g.replace(f.a, [f.empty], passOn);
		f.g.replace(f.a, [f.empty], passOn);
		let seen: unknown;
		const y = f.g.node<number>(
			[f.a, f.b],
			(ctx) => {
				seen = told(ctx).map((d) => [d.has, d.terminal, d.replaced]);
			},
			{ name: "y" },
		);
		y.subscribe(() => {});
		expect(seen).toEqual([
			[false, undefined, false],
			[true, undefined, false],
		]);
		f.log.length = 0;
		f.b.set(10);
		expect(f.log).toEqual([sent("done=00 replaced=10")]);
	});

	it("a rewire's run is told for a at its new place and not for the added state; the next run is told nothing", () => {
		const f = countingGraph();
		const c = f.g.state(5, { name: "c" });
		f.g.replace(f.a, [f.empty], passOn);
		expect(f.log).toEqual([]);
		f.zctx().rewire([c, f.a]); // c's snapshot runs Z
		expect(f.g.describe().find((n) => n.id === "z")?.deps).toEqual(["c", "a"]);
		expect(f.log).toEqual([sent("done=00 replaced=01")]);
		f.log.length = 0;
		c.set(6);
		expect(f.log).toEqual([sent("done=00 replaced=00")]);
	});
});
