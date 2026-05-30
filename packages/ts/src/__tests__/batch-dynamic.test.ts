import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { batch, dynamicNode, node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("batch (R-batch-coalesce / D12)", () => {
	it("coalesces a diamond join to ONE recompute when both sources change", () => {
		let fires = 0;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 1 });
		const d = node<number>([a, b], (ctx: Ctx) => {
			fires++;
			ctx.down([
				["DATA", (ctx.depRecords[0].latest as number) + (ctx.depRecords[1].latest as number)],
			]);
		});
		collect(d);
		expect(d.cache).toBe(2);

		fires = 0;
		batch(() => {
			a.down([["DATA", 10]]);
			b.down([["DATA", 20]]);
		});
		expect(fires).toBe(1); // one recompute, not two
		expect(d.cache).toBe(30);
	});

	it("defers DATA to commit: downstream sees DIRTY during the batch, DATA after", () => {
		const a = node<number>([], null, { initial: 1 });
		const { msgs } = collect(a);
		msgs.length = 0;
		batch(() => {
			a.down([["DATA", 9]]);
			// inside the batch: DIRTY emitted, DATA still deferred
			expect(types(msgs)).toEqual(["DIRTY"]);
			expect(a.cache).toBe(1); // not yet committed
		});
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(a.cache).toBe(9);
	});

	it("rollback on throw discards deferred emissions (downstream un-dirties)", () => {
		const a = node<number>([], null, { initial: 1 });
		const { msgs } = collect(a);
		msgs.length = 0;
		expect(() =>
			batch(() => {
				a.down([["DATA", 99]]);
				throw new Error("abort");
			}),
		).toThrow("abort");
		expect(a.cache).toBe(1); // unchanged
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]); // dirty balanced by resolved
	});

	it("bctx.rollback() is the explicit escape hatch", () => {
		const a = node<number>([], null, { initial: 1 });
		collect(a);
		batch((bctx) => {
			a.down([["DATA", 50]]);
			bctx.rollback();
		});
		expect(a.cache).toBe(1);
	});
});

describe("dynamicNode (R-dynamic-node / D35; D49 — no equals-absorption)", () => {
	it("reads a selected dep; an unread dep's change re-emits the value as DATA (D49)", () => {
		const sel = node<"a" | "b">([], null, { initial: "a" });
		const a = node<number>([], null, { initial: 100 });
		const b = node<number>([], null, { initial: 200 });
		const router = dynamicNode<number>([sel, a, b], (ctx: Ctx) => {
			const which = ctx.track?.(0) as "a" | "b";
			const value = which === "a" ? (ctx.track?.(1) as number) : (ctx.track?.(2) as number);
			ctx.down([["DATA", value]]);
		});
		const { msgs } = collect(router);
		expect(router.cache).toBe(100); // sel="a" -> reads a
		msgs.length = 0;

		// change the UNREAD dep b -> fn fires, re-emits the (unchanged) value 100. D49 removed
		// equals-absorption: an occurrence is always DATA, never collapsed to RESOLVED. Pair with
		// distinctUntilChanged if unread-dep silence is required (dedup is opt-in).
		b.down([["DATA", 999]]);
		expect(router.cache).toBe(100);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(msgs).toContainEqual(["DATA", 100]);

		// change the READ dep a -> recompute with the new value
		msgs.length = 0;
		a.down([["DATA", 111]]);
		expect(router.cache).toBe(111);
		expect(msgs).toContainEqual(["DATA", 111]);
	});
});
