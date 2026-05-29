import { describe, expect, it } from "vitest";
import type { Ctx } from "../index.js";
import { node } from "../index.js";

const plus1 = (ctx: Ctx) => ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 1]]);

describe("R-reentrancy (D37) — synchronous feedback cycle is rejected", () => {
	it("a fn that re-drives its own dep mid-wave throws (cycle detected node-locally)", () => {
		// state S → derived D (=n+1) → effect E; E feeds back into S, closing S→D→E→S.
		// Activating the chain drives the cycle synchronously and must reject.
		const s = node<number>([], null, { initial: 0 });
		const d = node<number>([s], plus1);
		const e = node<number>([d], (ctx: Ctx) => {
			// feedback write back to S (an indirect dep of E) — re-enters the wave.
			s.down([["DATA", ctx.depRecords[0].latest as number]]);
		});
		expect(() => e.subscribe(() => {})).toThrow(/feedback cycle|R-reentrancy/i);
	});

	it("an acyclic chain does NOT throw (the guard does not false-positive)", () => {
		const s = node<number>([], null, { initial: 1 });
		const d = node<number>([s], plus1);
		const e = node<number>([d], (ctx: Ctx) =>
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]),
		);
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(e.cache).toBe(2);
	});

	it("a rejected cycle leaves other graphs usable (try/finally resets the flag on unwind)", () => {
		const s = node<number>([], null, { initial: 0 });
		const d = node<number>([s], plus1);
		const e = node<number>([d], (ctx: Ctx) => {
			s.down([["DATA", ctx.depRecords[0].latest as number]]);
		});
		expect(() => e.subscribe(() => {})).toThrow();
		// A fresh, independent chain still computes — no node left with a stuck in-wave flag.
		const a = node<number>([], null, { initial: 7 });
		const b = node<number>([a], plus1);
		b.subscribe(() => {});
		expect(b.cache).toBe(8);
	});
});
