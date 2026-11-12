import { describe, expect, it } from "vitest";
import type { Ctx, CtxDep } from "../ctx/types.js";
import { graph, restoreGraph, type StateNode } from "../index.js";

const expired = "ctx.deps is only available during setup or function invocation";

describe("R-invocation@3: every dependency view expires with its supplying invocation", () => {
	it("allows setup input, closes on a throwing function, and keeps cleanup private state", () => {
		const g = graph();
		const a = g.state(42);
		let setupCtx: Ctx | undefined;
		let dep: CtxDep | undefined;
		let cleaned: unknown;
		const n = g.node(
			[a],
			() => {
				throw new Error("failed run");
			},
			{
				setup: (ctx) => {
					setupCtx = ctx;
					dep = ctx.deps[0];
					ctx.state.set(dep.value);
					return () => {
						expect(() => setupCtx!.deps).toThrow(expired);
						expect(() => dep!.waves).toThrow(expired);
						cleaned = ctx.state.get();
					};
				},
			},
		);
		n.subscribe(() => {});
		expect(n.status.output).toBe("errored");
		expect(cleaned).toBe(42);
		expect(() => dep!.id).toThrow(expired);
	});

	it("does not let the restore wrapper's filtered views escape", () => {
		let kept: Ctx | undefined;
		let unchanged: CtxDep | undefined;
		const fn = (ctx: Ctx) => {
			kept = ctx;
			unchanged = ctx.deps[1];
			ctx.emit(ctx.deps[0].value);
		};
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		g.node([a, b], fn, { name: "n", recipe: { ref: "n" } }).subscribe(() => {});
		const r = restoreGraph(g.checkpoint(), {
			registry: { n: { ref: "n", build: () => ({ fn }) } },
		});
		(r.find("a") as StateNode<number>).set(3);
		r.find("n")!.subscribe(() => {});
		expect(() => kept!.deps).toThrow(expired);
		for (const key of ["id", "waves", "terminal", "value", "has", "invalidated"] as const)
			expect(() => unchanged![key]).toThrow(expired);
	});
});
