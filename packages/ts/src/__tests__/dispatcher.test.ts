import { describe, expect, it } from "vitest";
import type { Ctx } from "../index.js";
import { Dispatcher } from "../index.js";

// invoke only forwards ctx to the fn; these probe fns ignore it.
const ctx = {} as unknown as Ctx;

describe("dispatcher handle GC (B15 / R-dispatch-all)", () => {
	it("unregister frees the slot — the old handle is dead, invoking it throws", () => {
		const d = new Dispatcher();
		let ran = 0;
		const h = d.register(() => {
			ran++;
		}, "sync");
		d.invoke(h, ctx);
		expect(ran).toBe(1);

		d.unregister(h);
		expect(() => d.invoke(h, ctx)).toThrow(); // freed slot → dead handle, not silently ran
		expect(ran).toBe(1); // the dropped fn never runs again
	});

	it("register reuses a freed id → the fn table stays bounded under repeated fn-swap", () => {
		const d = new Dispatcher();
		const h1 = d.register(() => {}, "sync");
		d.unregister(h1);
		const h2 = d.register(() => {}, "sync");
		expect(h2.handleId).toBe(h1.handleId); // reused the freed slot, did not grow
		expect(h2.poolId).toBe(h1.poolId);

		// 100 swaps (register new, free old) stay bounded to peak-live, not +100 (the B15 leak).
		let peak = h2.handleId;
		let cur = h2;
		for (let i = 0; i < 100; i++) {
			const next = d.register(() => {}, "sync");
			d.unregister(cur);
			peak = Math.max(peak, next.handleId);
			cur = next;
		}
		expect(peak).toBeLessThanOrEqual(h1.handleId + 1); // bounded, not h1.handleId + 100
	});

	it("unregister is idempotent and pool-scoped", () => {
		const d = new Dispatcher();
		let ranAsync = 0;
		const hs = d.register(() => {}, "sync");
		const ha = d.register(() => {
			ranAsync++;
		}, "async");
		d.unregister(hs);
		d.unregister(hs); // idempotent → no throw on a double free
		d.invoke(ha, ctx); // the async pool is untouched by the sync-pool unregister
		expect(ranAsync).toBe(1);
		expect(ha.poolId).not.toBe(hs.poolId);
	});

	it("a reused handle id does not inherit the previous tenant's profile stat", () => {
		const d = new Dispatcher();
		d.setRecording(true);
		const h1 = d.register(() => {}, "sync");
		d.invoke(h1, ctx);
		d.invoke(h1, ctx);
		expect(d.statFor(h1)?.invokes).toBe(2);

		d.unregister(h1); // clears the stat too
		const h2 = d.register(() => {}, "sync");
		expect(h2.handleId).toBe(h1.handleId); // same id reused
		expect(d.statFor(h2)?.invokes ?? 0).toBe(0); // fresh counters, not the stale 2
	});

	it("QA F2.1: unregister clears the stat even when recording is OFF (no later inheritance)", () => {
		// The stale-stat trap: recording is OFF at unregister time, so a naive `if (recording)`
		// delete would leave the key — then a reused id inherits it once recording resumes.
		const d = new Dispatcher();
		d.setRecording(true);
		const h1 = d.register(() => {}, "sync");
		d.invoke(h1, ctx);
		d.invoke(h1, ctx);
		expect(d.statFor(h1)?.invokes).toBe(2);

		d.setRecording(false); // recording paused around the rewire/unregister window
		d.unregister(h1); // must STILL drop the stat (unconditional delete, QA F2.1)
		const h2 = d.register(() => {}, "sync");
		expect(h2.handleId).toBe(h1.handleId); // free-list reused the id

		d.setRecording(true); // resume — h2 must NOT see h1's stale count of 2
		expect(d.statFor(h2)?.invokes ?? 0).toBe(0);
		d.invoke(h2, ctx);
		expect(d.statFor(h2)?.invokes).toBe(1); // counts from 0, not from the stale 2 → 3
	});
});
