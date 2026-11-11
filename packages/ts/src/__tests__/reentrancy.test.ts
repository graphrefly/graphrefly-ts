import { describe, expect, it } from "vitest";
import type { Ctx } from "../index.js";
import { depLatest, node } from "../index.js";
import { eachMessage } from "../node/each-message.js";

const plus1 = (ctx: Ctx) => ctx.down([["DATA", (depLatest(ctx, 0) as number) + 1]]);

describe("R-reentrancy (D37) — synchronous feedback cycle is rejected", () => {
	it("a fn that re-drives its own dep mid-wave ends with ERROR (cycle detected node-locally)", () => {
		// state S → derived D (=n+1) → effect E; E feeds back into S, closing S→D→E→S.
		// Activating the chain drives the cycle synchronously and must reject.
		const s = node<number>([], null, { initial: 0 });
		const d = node<number>([s], plus1);
		const e = node<number>([d], (ctx: Ctx) => {
			// feedback write back to S (an indirect dep of E) — re-enters the wave.
			s.down([["DATA", depLatest(ctx, 0) as number]]);
		});
		// R-failure@3: the rejected re-entry is E's ERROR, not a host throw. (Phase 5 of the D797
		// migration makes the write a request that runs after the wave, C-6.)
		let error: unknown;
		expect(() =>
			e.subscribe(
				eachMessage((m) => {
					if (m[0] === "ERROR") error = m[1];
				}),
			),
		).not.toThrow();
		expect(e.status.output).toBe("errored");
		expect(String((error as Error).message)).toMatch(/feedback cycle|R-reentrancy/i);
	});

	it("an acyclic chain does NOT throw (the guard does not false-positive)", () => {
		const s = node<number>([], null, { initial: 1 });
		const d = node<number>([s], plus1);
		const e = node<number>([d], (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(e.cache).toBe(2);
	});

	it("a rejected cycle leaves other graphs usable (try/finally resets the flag on unwind)", () => {
		const s = node<number>([], null, { initial: 0 });
		const d = node<number>([s], plus1);
		const e = node<number>([d], (ctx: Ctx) => {
			s.down([["DATA", depLatest(ctx, 0) as number]]);
		});
		e.subscribe(() => {});
		expect(e.status.output).toBe("errored");
		// A fresh, independent chain still computes — no node left with a stuck in-wave flag.
		const a = node<number>([], null, { initial: 7 });
		const b = node<number>([a], plus1);
		b.subscribe(() => {});
		expect(b.cache).toBe(8);
	});
});
