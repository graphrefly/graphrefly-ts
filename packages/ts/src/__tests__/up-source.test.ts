import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { batch, depLatest, node } from "../index.js";

// depless source S (cached) → derived D (passthrough) → sink. D originates ctx.up([msg]),
// which forwards upstream to the terminus S (R-up-at-source / D38).
function setup() {
	const s = node<number>([], null, { initial: 5 });
	const d = node<number>([s], (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
	const seen: Message[] = [];
	d.subscribe((m) => seen.push(m));
	return { s, d, seen };
}

describe("R-up-at-source (D38) — upstream control at a depless source", () => {
	it("INVALIDATE-up is HONORED: source self-invalidates + cascades down", () => {
		const { s, d, seen } = setup();
		expect(s.cache).toBe(5);
		seen.length = 0;
		d.up([["INVALIDATE"]]); // → forwards to S (terminus) → self _invalidate → cascade down
		expect(s.cache).toBeUndefined(); // SENTINEL
		expect(s.status).toBe("sentinel");
		expect(seen.map((m) => m[0])).toContain("INVALIDATE"); // D observed the down-cascade
		expect(d.cache).toBeUndefined();
	});

	it("INVALIDATE-up fires the source's onInvalidate hook once", () => {
		let flushed = 0;
		// a source with a fn so it can register onInvalidate (producer-style depless node)
		const s = node<number>([], (ctx: Ctx) => {
			ctx.onInvalidate(() => {
				flushed++;
			});
			ctx.down([["DATA", 9]]);
		});
		const d = node<number>([s], (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
		d.subscribe(() => {});
		expect(s.cache).toBe(9);
		d.up([["INVALIDATE"]]);
		expect(flushed).toBe(1);
		expect(s.cache).toBeUndefined();
	});

	it("DIRTY-up is DROPPED at the source: untouched, no down-cascade", () => {
		const { s, d, seen } = setup();
		seen.length = 0;
		d.up([["DIRTY"]]); // D forwards DIRTY to S; S is the depless terminus → drop
		expect(s.cache).toBe(5);
		expect(s.status).toBe("settled");
		expect(seen.length).toBe(0); // nothing propagated downstream
	});

	it("TEARDOWN-up is DROPPED at the source: not terminated, no down-cascade", () => {
		const { s, d, seen } = setup();
		seen.length = 0;
		d.up([["TEARDOWN"]]); // forwarded to S → terminus → drop
		expect(s.status).toBe("settled"); // not terminated
		expect(s.cache).toBe(5);
		expect(seen.length).toBe(0);
	});

	it("INVALIDATE-up defers inside a batch, cascades on commit (A-2: routed via _down)", () => {
		const s = node<number>([], null, { initial: 5 });
		const d = node<number>([s], (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
		d.subscribe(() => {});
		batch(() => {
			d.up([["INVALIDATE"]]); // forwarded to depless S → S._down → tier-4 deferred
			expect(s.cache).toBe(5); // deferred — NOT yet applied mid-batch
		});
		expect(s.cache).toBeUndefined(); // committed → source self-invalidated
	});
});
