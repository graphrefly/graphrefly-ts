import { describe, expect, it } from "vitest";
import type { Ctx } from "../index.js";
import { depLatest, graph } from "../index.js";

const plus1 = (ctx: Ctx) => ctx.down([["DATA", (depLatest(ctx, 0) as number) + 1]]);

describe("C-6: a function's write to its own upstream is a later request, never a reentry", () => {
	it("runs as a request after the wave; the loop ends when the composition stops writing", () => {
		// state S -> D (= n+1) -> E; E writes S while D is below 3, closing S->D->E->S.
		const g = graph();
		const s = g.node<number>([], null, { initial: 0 });
		const d = g.node<number>([s], plus1);
		const runs: number[] = [];
		const e = g.node<number>([d], (ctx: Ctx) => {
			const v = depLatest(ctx, 0) as number;
			runs.push(v);
			if (v < 3) s.set(v);
		});
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(runs).toEqual([1, 2, 3]);
		expect(d.cache).toBe(3);
		expect(e.status.output).toBe("open");
	});

	it("an acyclic chain does NOT throw (the guard does not false-positive)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>([s], plus1);
		const e = g.node<number>([d], (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(e.cache).toBe(2);
	});
});
