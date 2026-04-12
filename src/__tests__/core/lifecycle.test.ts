import { describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, DIRTY, INVALIDATE, type Messages, PAUSE } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { derived } from "../../core/sugar.js";

describe("0.6 lifecycle: INVALIDATE", () => {
	it("INVALIDATE marks a source node dirty and reaches subscribers", () => {
		const s = node<number>({ initial: 1 });
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		s.down([[INVALIDATE]]);

		expect(s.status).toBe("dirty");
		expect(seen).toContain(INVALIDATE);
		// GRAPHREFLY-SPEC §1.2: INVALIDATE clears cached state (no auto-emit).
		expect(s.cache).toBeUndefined();

		unsub();
	});

	it("derived node forwards INVALIDATE from a dependency to its sinks", () => {
		const src = node<number>({ initial: 0 });
		const d = derived([src], ([v]) => (v as number) * 2);
		const seen: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		src.down([[INVALIDATE]]);

		expect(seen).toContain(INVALIDATE);
		expect(d.status).toBe("dirty");
		expect(d.cache).toBeUndefined();

		unsub();
	});

	it("INVALIDATE after COMPLETE reaches sinks and clears cache", () => {
		const s = node<number>({ initial: 1 });
		const types: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) types.push(m[0] as symbol);
		});

		s.down([[COMPLETE]]);
		s.down([[INVALIDATE]]);

		expect(types).toContain(INVALIDATE);
		expect(s.cache).toBeUndefined();

		unsub();
	});

	it("INVALIDATE runs fn cleanup once", () => {
		const src = node<number>({ initial: 0 });
		let cleanups = 0;
		const n = node([src], (_data, _actions, _ctx) => () => {
			cleanups += 1;
		});
		const unsub = n.subscribe(() => undefined);

		expect(cleanups).toBe(0);
		n.down([[INVALIDATE]]);
		expect(cleanups).toBe(1);
		n.down([[INVALIDATE]]);
		expect(cleanups).toBe(1);

		unsub();
	});
});

describe("0.6 lifecycle: node.up fan-out", () => {
	it("up() invokes each dependency's up with the same message batch", () => {
		const a = node<number>({ initial: 0 });
		const b = node<number>({ initial: 0 });
		const d = derived([a, b], ([x, y]) => (x as number) + (y as number));
		d.subscribe(() => {});

		const spyA = vi.spyOn(a, "up");
		const spyB = vi.spyOn(b, "up");
		const batch: Messages = [[PAUSE, "lock"]];
		d.up(batch);

		expect(spyA).toHaveBeenCalledTimes(1);
		expect(spyA).toHaveBeenCalledWith(batch, { internal: true });
		expect(spyB).toHaveBeenCalledTimes(1);
		expect(spyB).toHaveBeenCalledWith(batch, { internal: true });

		spyA.mockRestore();
		spyB.mockRestore();
	});
});

describe("0.6 two-phase ordering", () => {
	it("derived subscriber sees DIRTY before DATA in dep push order", () => {
		const src = node<number>({ initial: 0 });
		const d = derived([src], ([v]) => (v as number) + 1);
		const batches: symbol[][] = [];
		const unsub = d.subscribe((msgs) => {
			batches.push(msgs.map((m) => m[0] as symbol));
		});

		src.down([[DIRTY], [DATA, 5]]);

		const order = batches.flat();
		expect(order.indexOf(DIRTY)).toBeGreaterThanOrEqual(0);
		expect(order.indexOf(DATA)).toBeGreaterThan(order.indexOf(DIRTY));
		expect(d.cache).toBe(6);
		unsub();
	});
});
