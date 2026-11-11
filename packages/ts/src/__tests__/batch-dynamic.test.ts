import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { depLatest, graph } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("batch (R-batch-coalesce / D12)", () => {
	it("coalesces a diamond join to ONE recompute when both sources change", () => {
		const g = graph();
		let fires = 0;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>([a, b], (ctx: Ctx) => {
			fires++;
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]);
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

	it("a throwing body commits nothing and delivers nothing (no compensating RESOLVED)", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(a);
		msgs.length = 0;
		expect(() =>
			g.batch(() => {
				a.set(99);
				throw new Error("abort");
			}),
		).toThrow("abort");
		expect(a.cache).toBe(1); // unchanged
		expect(types(msgs)).toEqual([]); // nothing was delivered, so nothing to balance
	});

	it("bctx.rollback() is the explicit escape hatch", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		collect(a);
		g.batch((bctx) => {
			a.set(50);
			bctx.rollback();
		});
		expect(a.cache).toBe(1);
	});
});

describe("dynamic node (R-dynamic-node / D35; D49 — no equals-absorption)", () => {
	it("reads a selected dep; an unread dep's change re-emits the value as DATA (D49)", () => {
		const g = graph();
		const sel = g.node<"a" | "b">([], null, { initial: "a" });
		const a = g.node<number>([], null, { initial: 100 });
		const b = g.node<number>([], null, { initial: 200 });
		const router = g.node<number>(
			[sel, a, b],
			(ctx: Ctx) => {
				const which = ctx.track?.(0) as "a" | "b";
				const value = which === "a" ? (ctx.track?.(1) as number) : (ctx.track?.(2) as number);
				ctx.down([["DATA", value]]);
			},
			{ dynamic: true },
		);
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
