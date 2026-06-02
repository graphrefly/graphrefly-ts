import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { depLatest, node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("terminal (R-terminal, R-deps-terminal)", () => {
	it("auto-COMPLETE when ALL deps complete", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 1]]),
		);
		const { msgs } = collect(d);
		msgs.length = 0;
		a.down([["COMPLETE"]]);
		expect(types(msgs)).toEqual(["COMPLETE"]);
		expect(d.status).toBe("completed");
	});

	it("requires ALL deps complete, not ANY", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 2 });
		const d = node<number>([a, b], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]),
		);
		const { msgs } = collect(d);
		msgs.length = 0;
		a.down([["COMPLETE"]]);
		expect(types(msgs)).not.toContain("COMPLETE"); // only one dep complete
		b.down([["COMPLETE"]]);
		expect(types(msgs)).toContain("COMPLETE"); // now all complete
		expect(d.status).toBe("completed");
	});

	it("auto-ERROR when any dep errors (errorWhenDepsError)", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx: Ctx) => ctx.down([["DATA", 1]]));
		const { msgs } = collect(d);
		msgs.length = 0;
		const err = new Error("boom");
		a.down([["ERROR", err]]);
		expect(msgs).toContainEqual(["ERROR", err]);
		expect(d.status).toBe("errored");
	});

	it("ERROR with undefined or boolean payload is rejected (R-data-payload)", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["ERROR", undefined]])).toThrow(/non-SENTINEL/);
		expect(() => s.down([["ERROR", false]])).toThrow(/non-boolean/);
		expect(() => s.down([["ERROR", true]])).toThrow(/non-boolean/);
	});

	it("non-resubscribable terminal rejects late subscribe (R2.2.7.b)", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		s.down([["COMPLETE"]]);
		expect(() => s.subscribe(() => {})).toThrow(/non-resubscribable/);
	});

	it("resubscribable terminal resets on late subscribe (R2.2.7.a)", () => {
		const s = node<number>([], null, { initial: 1, resubscribable: true });
		collect(s);
		s.down([["COMPLETE"]]);
		expect(s.status).toBe("completed");
		const { msgs } = collect(s); // resets, then push-on-subscribe
		expect(s.status).toBe("settled");
		expect(msgs).toContainEqual(["DATA", 1]);
	});

	it("B30: terminal-is-forever on SELF-emit — set()/down() after terminal is a no-op", () => {
		// The upstream path (_receiveFromDep) already drops on terminal; B30 closes the
		// self-emit gap in _down (a post-terminal state.set / ctx.down must not resurrect),
		// matching the Rust arm's Core::down blanket guard (R-terminal / D17).
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		s.down([["COMPLETE"]]);
		expect(s.status).toBe("completed");
		msgs.length = 0;

		s.down([["DATA", 42]]); // self-emit in a LATER wave after terminal → no-op
		expect(msgs).toEqual([]); // nothing emitted
		expect(s.cache).toBe(1); // cache NOT overwritten by 42
		expect(s.status).toBe("completed"); // still terminal

		// also a no-op after ERROR (DATA + INVALIDATE both dropped)
		const e = node<number>([], null, { initial: 7 });
		const ce = collect(e);
		e.down([["ERROR", new Error("boom")]]);
		ce.msgs.length = 0;
		e.down([["DATA", 99]]);
		e.down([["INVALIDATE"]]);
		expect(ce.msgs).toEqual([]); // neither DATA nor INVALIDATE escapes
		expect(e.cache).toBe(7); // cache preserved (errored node)
		expect(e.status).toBe("errored");
	});
});

describe("INVALIDATE (R-invalidate-idempotent, R-cleanup-hooks)", () => {
	it("clears cache, fires onInvalidate, cascades — and is idempotent", () => {
		const a = node<number>([], null, { initial: 5 });
		let flushed = 0;
		const d = node<number>([a], (ctx: Ctx) => {
			ctx.onInvalidate(() => flushed++);
			ctx.down([["DATA", (depLatest(ctx, 0) as number) * 2]]);
		});
		const { msgs } = collect(d);
		expect(d.cache).toBe(10);
		msgs.length = 0;

		a.down([["INVALIDATE"]]);
		expect(flushed).toBe(1);
		expect(d.cache).toBeUndefined();
		expect(types(msgs)).toContain("INVALIDATE");

		// second INVALIDATE: cache already reset -> no-op (no second flush/cascade)
		msgs.length = 0;
		a.down([["INVALIDATE"]]);
		expect(flushed).toBe(1);
		expect(types(msgs)).not.toContain("INVALIDATE");
	});

	it("never-populated INVALIDATE is a no-op", () => {
		const s = node<number>([], null); // no cache
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["INVALIDATE"]]);
		expect(msgs).toEqual([]);
	});
});

describe("same-wave merge (R-same-wave-merge)", () => {
	it("DATA + INVALIDATE: cache advances then clears", () => {
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 9], ["INVALIDATE"]]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA", "INVALIDATE"]);
		expect(s.cache).toBeUndefined();
	});

	it("INVALIDATE + INVALIDATE collapse to one (Q9)", () => {
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["INVALIDATE"], ["INVALIDATE"]]);
		expect(types(msgs)).toEqual(["INVALIDATE"]);
	});
});

describe("TEARDOWN (R-teardown-complete)", () => {
	it("non-terminal TEARDOWN synthesizes a COMPLETE prefix", () => {
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["TEARDOWN"]]);
		expect(types(msgs)).toEqual(["COMPLETE", "TEARDOWN"]);
	});

	it("does not stack COMPLETE when the wave already has one", () => {
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["COMPLETE"], ["TEARDOWN"]]);
		expect(types(msgs)).toEqual(["COMPLETE", "TEARDOWN"]);
	});
});

describe("ROM/RAM + cleanup (R-rom-ram, R-cleanup-hooks)", () => {
	it("compute node clears cache on deactivation and fires onDeactivation", () => {
		const a = node<number>([], null, { initial: 1 });
		let cleaned = 0;
		const d = node<number>([a], (ctx: Ctx) => {
			ctx.onDeactivation(() => cleaned++);
			ctx.down([["DATA", 1]]);
		});
		const { unsub } = collect(d);
		expect(d.cache).toBe(1);
		unsub();
		expect(cleaned).toBe(1);
		expect(d.cache).toBeUndefined(); // RAM
		expect(d.status).toBe("sentinel");
	});

	it("state node retains cache across disconnect (ROM)", () => {
		const s = node<number>([], null, { initial: 7 });
		const { unsub } = collect(s);
		unsub();
		expect(s.cache).toBe(7);
	});
});
