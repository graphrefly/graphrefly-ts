import { describe, expect, it } from "vitest";
import type { Ctx } from "../index.js";
import { Dispatcher } from "../index.js";

// invoke only forwards ctx to the fn; these probe fns ignore it.
const ctx = {} as unknown as Ctx;

describe("dispatcher handle GC (B15; one function table, graphrefly:D807)", () => {
	it("unregister frees the slot — the old handle is dead, invoking it throws", () => {
		const d = new Dispatcher();
		let ran = 0;
		const h = d.register(() => {
			ran++;
		});
		d.invoke(h, ctx);
		expect(ran).toBe(1);

		d.unregister(h);
		expect(() => d.invoke(h, ctx)).toThrow(); // freed slot → dead handle, not silently ran
		expect(ran).toBe(1); // the dropped fn never runs again
	});

	it("register reuses a freed id → the fn table stays bounded under repeated fn-swap", () => {
		const d = new Dispatcher();
		const h1 = d.register(() => {});
		d.unregister(h1);
		const h2 = d.register(() => {});
		expect(h2).toBe(h1); // reused the freed slot, did not grow

		// 100 swaps (register new, free old) stay bounded to peak-live, not +100 (the B15 leak).
		let peak = h2;
		let cur = h2;
		for (let i = 0; i < 100; i++) {
			const next = d.register(() => {});
			d.unregister(cur);
			peak = Math.max(peak, next);
			cur = next;
		}
		expect(peak).toBeLessThanOrEqual(h1 + 1); // bounded, not h1 + 100
	});

	it("unregister is idempotent and frees only its own handle", () => {
		const d = new Dispatcher();
		let ranOther = 0;
		const freed = d.register(() => {});
		const other = d.register(() => {
			ranOther++;
		});
		d.unregister(freed);
		d.unregister(freed); // idempotent → no throw on a double free
		d.invoke(other, ctx); // another handle is untouched by the unregister
		expect(ranOther).toBe(1);
		expect(other).not.toBe(freed);
		// A double free offers the index once: two later registers get two distinct handles.
		const a = d.register(() => {});
		const b = d.register(() => {});
		expect(a).not.toBe(b);
	});

	it("a reused handle id does not inherit the previous tenant's profile stat", () => {
		const d = new Dispatcher();
		d.setRecording(true);
		const h1 = d.register(() => {});
		d.invoke(h1, ctx);
		d.invoke(h1, ctx);
		expect(d.statFor(h1)?.invokes).toBe(2);

		d.unregister(h1); // clears the stat too
		const h2 = d.register(() => {});
		expect(h2).toBe(h1); // same id reused
		expect(d.statFor(h2)?.invokes ?? 0).toBe(0); // fresh counters, not the stale 2
	});

	it("QA F2.1: unregister clears the stat even when recording is OFF (no later inheritance)", () => {
		// The stale-stat trap: recording is OFF at unregister time, so a naive `if (recording)`
		// delete would leave the key — then a reused id inherits it once recording resumes.
		const d = new Dispatcher();
		d.setRecording(true);
		const h1 = d.register(() => {});
		d.invoke(h1, ctx);
		d.invoke(h1, ctx);
		expect(d.statFor(h1)?.invokes).toBe(2);

		d.setRecording(false); // recording paused around the rewire/unregister window
		d.unregister(h1); // must STILL drop the stat (unconditional delete, QA F2.1)
		const h2 = d.register(() => {});
		expect(h2).toBe(h1); // free-list reused the id

		d.setRecording(true); // resume — h2 must NOT see h1's stale count of 2
		expect(d.statFor(h2)?.invokes ?? 0).toBe(0);
		d.invoke(h2, ctx);
		expect(d.statFor(h2)?.invokes).toBe(1); // counts from 0, not from the stale 2 → 3
	});
});
