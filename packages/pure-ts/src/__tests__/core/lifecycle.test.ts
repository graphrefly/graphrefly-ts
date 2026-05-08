import { describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, DIRTY, INVALIDATE, type Messages, PAUSE } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("0.6 lifecycle: INVALIDATE", () => {
	it("INVALIDATE on a source node clears cache, transitions to sentinel, reaches subscribers", () => {
		const s = node<number>({ initial: 1 });
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		s.down([[INVALIDATE]]);

		// DS-13.5.A: INVALIDATE is settle-class; status transitions to
		// "sentinel" (no value, nothing pending) — NOT "dirty" (which means
		// "value about to change"). Cache is cleared per spec §1.2.
		expect(s.status).toBe("sentinel");
		expect(seen).toContain(INVALIDATE);
		expect(s.cache).toBeUndefined();

		unsub();
	});

	it("derived node forwards INVALIDATE from a dependency to its sinks", () => {
		const src = node<number>({ initial: 0 });
		const d = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived" },
		);
		const seen: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		src.down([[INVALIDATE]]);

		// DS-13.5.A: post-INVALIDATE the derived's status is "sentinel"
		// (cache cleared, no pending update), not "dirty".
		expect(seen).toContain(INVALIDATE);
		expect(d.status).toBe("sentinel");
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

	it("diamond fan-in: INVALIDATE cascade fires invalidate hook ONCE at the join", () => {
		// TLA+ batch 5 B parity: topology `A → {B, C} → D`. When A is
		// invalidated, D receives INVALIDATE via both parents. The first
		// arrival resets D's cache and fires the invalidate hook; the second
		// must NOT re-fire because there's nothing left to clean up.
		// Before the `_cached === undefined` guard in `_onDepMessage`'s
		// INVALIDATE branch, D's object-form `invalidate` hook double-fired
		// and the INVALIDATE was re-broadcast to D's children. The guard
		// matches the TLA+ `CleanupWitnessNonTrivial` invariant's semantic.
		const a = node<number>({ initial: 1 });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0] as number);
			},
			{ describeKind: "derived" },
		);
		const c = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived" },
		);
		let invalidates = 0;
		const d = node<number>([b, c], (data, actions, _ctx) => {
			// Compute + emit so `d._cached` is populated — the guard's input.
			const bv = data[0].at(-1) ?? 0;
			const cv = data[1].at(-1) ?? 0;
			actions.emit((bv as number) + (cv as number));
			return {
				onInvalidate: () => {
					invalidates += 1;
				},
			};
		});
		// Sink on D's own downstream to observe the INVALIDATE broadcast count
		// reaching children.
		const e = node(
			[d],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0] as number);
			},
			{ describeKind: "derived" },
		);
		const eSeen: symbol[] = [];
		const unsubE = e.subscribe((msgs) => {
			for (const [t] of msgs as Messages) eSeen.push(t);
		});
		const unsubD = d.subscribe(() => undefined);

		// Prime D's cache: first activation runs fn which emits → d._cached set.
		expect(d.cache).toBe(3); // (1) + (1+1)
		expect(invalidates).toBe(0);

		// Invalidate A — cascades to both B and C, then to D via both paths.
		a.down([[INVALIDATE]]);

		// With the diamond fan-in guard: hook fires exactly once at D.
		// Without it: fires twice (the latent bug this test is guarding).
		expect(invalidates).toBe(1);

		// E should also see exactly ONE INVALIDATE forwarded from D. Without
		// the guard, D would re-broadcast INVALIDATE on the second arrival
		// and E would count two.
		const invalidatesAtE = eSeen.filter((t) => t === INVALIDATE).length;
		expect(invalidatesAtE).toBe(1);

		unsubE();
		unsubD();
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
				onRerun: () => {
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
			onDeactivation: () => {
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
			onInvalidate: () => {
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
			onRerun: () => {
				br += 1;
			},
			onDeactivation: () => {
				de += 1;
			},
			onInvalidate: () => {
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
			onDeactivation: () => {
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
			onRerun: () => {
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
		const d = node(
			[a, b],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + (data[1] as number));
			},
			{ describeKind: "derived" },
		);
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
		const d = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived" },
		);
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
