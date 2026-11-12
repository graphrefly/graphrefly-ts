import { describe, expect, it } from "vitest";
import type { Ctx } from "../index.js";
import { graph } from "../index.js";
import { collect, types } from "./helpers/collect.js";

describe("batch (R-batch-coalesce / D12)", () => {
	it("coalesces a diamond join to ONE recompute when both sources change", () => {
		const g = graph();
		let fires = 0;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>([a, b], (ctx: Ctx) => {
			fires++;
			ctx.down([["DATA", (ctx.deps[0].value as number) + (ctx.deps[1].value as number)]]);
		});
		collect(d);
		expect(d.cache).toBe(2);

		fires = 0;
		g.batch(() => {
			a.set(10);
			b.set(20);
		});
		expect(fires).toBe(1); // one recompute, not two
		expect(d.cache).toBe(30);
	});

	it("a batch body delivers nothing; the commit delivers one array (R-request-order, O3)", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(a);
		msgs.length = 0;
		g.batch(() => {
			a.set(9);
			// inside the batch nothing is delivered and nothing changes
			expect(types(msgs)).toEqual([]);
			expect(a.cache).toBe(1); // not yet committed
		});
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(a.cache).toBe(9);
	});
});

describe("selective reads over declared deps (R-invocation; D49 — no equals-absorption)", () => {
	it("reads a selected dep; an unread dep's change re-emits the value as DATA (D49)", () => {
		const g = graph();
		const sel = g.node<"a" | "b">([], null, { initial: "a" });
		const a = g.node<number>([], null, { initial: 100 });
		const b = g.node<number>([], null, { initial: 200 });
		const router = g.node<number>([sel, a, b], (ctx: Ctx) => {
			const which = ctx.deps[0].value as "a" | "b";
			const value = which === "a" ? (ctx.deps[1].value as number) : (ctx.deps[2].value as number);
			ctx.down([["DATA", value]]);
		});
		const { msgs } = collect(router);
		expect(router.cache).toBe(100); // sel="a" -> reads a
		msgs.length = 0;

		// change the UNREAD dep b -> fn fires, re-emits the (unchanged) value 100. D49 removed
		// equals-absorption: an occurrence is always DATA, never collapsed to RESOLVED. Pair with
		// distinctUntilChanged if unread-dep silence is required (dedup is opt-in).
		b.set(999);
		expect(router.cache).toBe(100);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(msgs).toContainEqual(["DATA", 100]);

		// change the READ dep a -> recompute with the new value
		msgs.length = 0;
		a.set(111);
		expect(router.cache).toBe(111);
		expect(msgs).toContainEqual(["DATA", 111]);
	});
});
