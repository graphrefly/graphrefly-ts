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

describe("NodeFnCleanup object form — granular hooks", () => {
	it("{ beforeRun } fires only before re-runs, not on deactivation or INVALIDATE", () => {
		const src = node<number>({ initial: 0 });
		let beforeRuns = 0;
		let fnRuns = 0;
		const n = node([src], (_data, _actions, _ctx) => {
			fnRuns += 1;
			return {
				beforeRun: () => {
					beforeRuns += 1;
				},
			};
		});
		const unsub = n.subscribe(() => undefined);
		expect(fnRuns).toBe(1);
		expect(beforeRuns).toBe(0);

		// Trigger a re-run by emitting new DATA from src.
		src.down([[DIRTY], [DATA, 1]]);
		expect(fnRuns).toBe(2);
		expect(beforeRuns).toBe(1);

		// INVALIDATE must NOT fire beforeRun.
		n.down([[INVALIDATE]]);
		expect(beforeRuns).toBe(1);

		// Deactivation must NOT fire beforeRun.
		unsub();
		expect(beforeRuns).toBe(1);
	});

	it("{ deactivate } fires only on deactivation, not on re-run or INVALIDATE", () => {
		const src = node<number>({ initial: 0 });
		let deactivates = 0;
		const n = node([src], (_data, _actions, _ctx) => ({
			deactivate: () => {
				deactivates += 1;
			},
		}));
		const unsub = n.subscribe(() => undefined);
		expect(deactivates).toBe(0);

		src.down([[DIRTY], [DATA, 1]]);
		expect(deactivates).toBe(0);

		n.down([[INVALIDATE]]);
		expect(deactivates).toBe(0);

		unsub();
		expect(deactivates).toBe(1);
	});

	it("{ invalidate } fires only on INVALIDATE, not on re-run or deactivation", () => {
		const src = node<number>({ initial: 0 });
		let invalidates = 0;
		const n = node([src], (_data, _actions, _ctx) => ({
			invalidate: () => {
				invalidates += 1;
			},
		}));
		const unsub = n.subscribe(() => undefined);
		expect(invalidates).toBe(0);

		src.down([[DIRTY], [DATA, 1]]);
		expect(invalidates).toBe(0);

		n.down([[INVALIDATE]]);
		expect(invalidates).toBe(1);

		unsub();
		expect(invalidates).toBe(1);
	});

	it("object with multiple hooks fires each on its own transition", () => {
		const src = node<number>({ initial: 0 });
		let br = 0;
		let de = 0;
		let iv = 0;
		const n = node([src], (_data, _actions, _ctx) => ({
			beforeRun: () => {
				br += 1;
			},
			deactivate: () => {
				de += 1;
			},
			invalidate: () => {
				iv += 1;
			},
		}));
		const unsub = n.subscribe(() => undefined);
		expect([br, de, iv]).toEqual([0, 0, 0]);

		src.down([[DIRTY], [DATA, 1]]);
		expect([br, de, iv]).toEqual([1, 0, 0]);

		n.down([[INVALIDATE]]);
		expect([br, de, iv]).toEqual([1, 0, 1]);

		unsub();
		expect([br, de, iv]).toEqual([1, 1, 1]);
	});

	it("function-form cleanup still fires on all three transitions (backward compat)", () => {
		const src = node<number>({ initial: 0 });
		let cleanups = 0;
		const n = node([src], (_data, _actions, _ctx) => () => {
			cleanups += 1;
		});
		const unsub = n.subscribe(() => undefined);
		expect(cleanups).toBe(0);

		// Re-run: pre-run cleanup fires, new cleanup attached.
		src.down([[DIRTY], [DATA, 1]]);
		expect(cleanups).toBe(1);

		// INVALIDATE: current cleanup fires and is cleared (NOT replaced
		// until fn re-runs).
		n.down([[INVALIDATE]]);
		expect(cleanups).toBe(2);

		// Next DATA re-runs fn and attaches a fresh cleanup.
		src.down([[DIRTY], [DATA, 2]]);
		expect(cleanups).toBe(2);

		// Deactivate: the fresh cleanup fires.
		unsub();
		expect(cleanups).toBe(3);
	});

	it("object cleanup is preserved across re-runs (deactivate still fires after many re-runs)", () => {
		const src = node<number>({ initial: 0 });
		let deactivates = 0;
		const n = node([src], (_data, _actions, _ctx) => ({
			deactivate: () => {
				deactivates += 1;
			},
		}));
		const unsub = n.subscribe(() => undefined);

		for (let i = 1; i <= 5; i++) {
			src.down([[DIRTY], [DATA, i]]);
		}
		expect(deactivates).toBe(0);

		unsub();
		expect(deactivates).toBe(1);
	});

	it("object cleanup with only beforeRun does not block deactivation", () => {
		const src = node<number>({ initial: 0 });
		let beforeRuns = 0;
		const n = node([src], (_data, _actions, _ctx) => ({
			beforeRun: () => {
				beforeRuns += 1;
			},
		}));
		const unsub = n.subscribe(() => undefined);
		src.down([[DIRTY], [DATA, 1]]);
		expect(beforeRuns).toBe(1);
		unsub(); // should not throw; absent deactivate hook is a no-op
		expect(beforeRuns).toBe(1);
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
