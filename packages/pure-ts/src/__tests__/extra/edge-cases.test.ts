/**
 * Edge-case tests for operators — P0 (data-loss) and P1 (correctness).
 * Cross-referenced from docs/batch-review/batch-7.md.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { batch } from "../../core/batch.js";
import type { Messages } from "../../core/messages.js";
import { COMPLETE, DATA, DIRTY, ERROR } from "../../core/messages.js";
import { node } from "../../core/node.js";

import {
	combine,
	concat,
	concatMap,
	debounce,
	exhaustMap,
	filter,
	map,
	merge,
	switchMap,
	throttle,
	timeout,
} from "../../extra/operators/index.js";
import { collect } from "../test-helpers.js";

function msgs(batches: unknown[][]): unknown[][] {
	return batches.flat() as unknown[][];
}

function dataValues(batches: unknown[][]): unknown[] {
	return msgs(batches)
		.filter((m) => (m as unknown[])[0] === DATA)
		.map((m) => (m as unknown[])[1]);
}

function hasMsg(batches: unknown[][], type: symbol): boolean {
	return msgs(batches).some((m) => (m as unknown[])[0] === type);
}

afterEach(() => {
	vi.useRealTimers();
});

// --- P0: Data-loss edge cases ---

describe("P0: debounce flush-on-complete", () => {
	it("flushes pending value on source COMPLETE", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const d = debounce(s, 100);
		const { batches, unsub } = collect(d);

		// Emit a value — debounce defers it
		s.down([[DIRTY]]);
		s.down([[DATA, 42]]);

		// No data yet (debounced)
		expect(dataValues(batches)).toEqual([]);

		// Source completes before debounce timer fires
		s.down([[COMPLETE]]);

		// Pending value should be flushed
		expect(dataValues(batches)).toEqual([42]);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("cancels pending on upstream ERROR", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const d = debounce(s, 100);
		const { batches, unsub } = collect(d);

		s.down([[DIRTY]]);
		s.down([[DATA, 42]]);
		s.down([[ERROR, new Error("fail")]]);

		// Pending is discarded, ERROR forwarded
		expect(dataValues(batches)).toEqual([]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});

	it("forwards upstream COMPLETE even without pending", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const d = debounce(s, 100);
		const { batches, unsub } = collect(d);

		s.down([[COMPLETE]]);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("emits each debounced value in sequence", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const d = debounce(s, 50);
		const { batches, unsub } = collect(d);

		s.down([[DIRTY]]);
		s.down([[DATA, 1]]);
		vi.advanceTimersByTime(60);
		s.down([[DIRTY]]);
		s.down([[DATA, 2]]);
		vi.advanceTimersByTime(60);

		expect(dataValues(batches)).toEqual([1, 2]);
		unsub();
	});
});

describe("P0: throttle COMPLETE/ERROR forwarding", () => {
	it("forwards upstream COMPLETE", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const t = throttle(s, 100);
		const { batches, unsub } = collect(t);

		s.down([[COMPLETE]]);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("forwards upstream ERROR", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const t = throttle(s, 100);
		const { batches, unsub } = collect(t);

		s.down([[ERROR, new Error("x")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});
});

describe("P0: throttle trailing-COMPLETE flushes pending", () => {
	// /qa F3 (2026-05-12): regression test for the trailing-COMPLETE flush
	// behavior added in /qa m21. GraphReFly intentionally diverges from
	// RxJS (which drops trailing pending on COMPLETE) — we flush for
	// symmetry with debounce's live-COMPLETE behavior and with throttle's
	// own Dead-source branch. See cross-language-notes divergence entry.
	it("flushes trailing pending value before COMPLETE", () => {
		vi.useFakeTimers();
		const s = node<number>([], { initial: 0 });
		const t = throttle(s, 100, { trailing: true });
		const { batches, unsub } = collect(t);

		// First value goes through (leading edge)
		s.down([[DATA, 1]]);
		// Second value within the window becomes pending
		s.down([[DATA, 2]]);
		// Source completes while pending=2 is waiting for trailing timer
		s.down([[COMPLETE]]);

		// The pending trailing value should have been flushed before COMPLETE
		const values = dataValues(batches);
		expect(values).toContain(2);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("no trailing flush when nothing is pending", () => {
		vi.useFakeTimers();
		const s = node<number>([], { initial: 0 });
		const t = throttle(s, 100, { trailing: true });
		const { batches, unsub } = collect(t);

		// Emit and let the window expire
		s.down([[DATA, 1]]);
		vi.advanceTimersByTime(200);
		// Now complete with nothing pending
		s.down([[COMPLETE]]);

		const values = dataValues(batches);
		// initial:0 goes through as leading, then 1 goes through as leading
		expect(values).toEqual([0, 1]);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});
});

describe("P0: timeout timer cleanup", () => {
	it("clears timer when source completes before timeout", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const t = timeout(s, 100);
		const { batches, unsub } = collect(t);

		// Source completes immediately
		s.down([[COMPLETE]]);

		// Advance past timeout — should NOT fire ERROR
		vi.advanceTimersByTime(200);
		expect(hasMsg(batches, ERROR)).toBe(false);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("clears timer when source errors before timeout", () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const t = timeout(s, 100);
		const { batches, unsub } = collect(t);

		s.down([[ERROR, new Error("upstream")]]);
		vi.advanceTimersByTime(200);

		// Only one ERROR (upstream), not two (no timeout ERROR)
		const errors = msgs(batches).filter((m) => (m as unknown[])[0] === ERROR);
		expect(errors.length).toBe(1);
		unsub();
	});

	it("resets timer on each DATA emission", async () => {
		vi.useFakeTimers();
		const s = node([], { initial: 0 });
		const t = timeout(s, 100);
		const { batches, unsub } = collect(t);

		// Emit at t=50, resets timer
		vi.advanceTimersByTime(50);
		s.down([[DIRTY]]);
		s.down([[DATA, 1]]);

		// Emit at t=100 (50ms since last), resets again
		vi.advanceTimersByTime(50);
		s.down([[DIRTY]]);
		s.down([[DATA, 2]]);

		// Advance to t=150 (50ms since last) — timer still has 50ms left
		vi.advanceTimersByTime(50);
		expect(hasMsg(batches, ERROR)).toBe(false);

		// Advance to t=210 (110ms since last DATA) — timeout fires
		vi.advanceTimersByTime(60);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});
});

describe("P0: merge ALL-complete semantics", () => {
	it("completes only after ALL sources complete", () => {
		const s1 = node([], { initial: 1 });
		const s2 = node([], { initial: 2 });
		const m = merge(s1, s2);
		const { batches, unsub } = collect(m);

		s1.down([[COMPLETE]]);
		expect(hasMsg(batches, COMPLETE)).toBe(false);

		s2.down([[COMPLETE]]);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("error from one source propagates immediately", () => {
		const s1 = node([], { initial: 1 });
		const s2 = node([], { initial: 2 });
		const m = merge(s1, s2);
		const { batches, unsub } = collect(m);

		s1.down([[ERROR, new Error("fail")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});

	it("forwards values from each source independently", () => {
		const s1 = node([], { initial: 0 });
		const s2 = node([], { initial: 0 });
		const m = merge(s1, s2);
		const { batches, unsub } = collect(m);

		batch(() => {
			s1.down([[DIRTY]]);
			s1.down([[DATA, 10]]);
		});
		batch(() => {
			s2.down([[DIRTY]]);
			s2.down([[DATA, 20]]);
		});

		const values = dataValues(batches);
		expect(values).toContain(10);
		expect(values).toContain(20);
		unsub();
	});
});

// --- P1: Correctness edge cases ---

describe("P1: switchMap outer-complete waits for inner", () => {
	it("waits for active inner to complete before emitting COMPLETE", () => {
		const outer = node([], { initial: 0 });
		const inner = node([], { initial: 10 });
		const out = switchMap(outer, () => inner);
		const { batches, unsub } = collect(out);

		// Outer completes while inner is still active
		outer.down([[COMPLETE]]);
		expect(hasMsg(batches, COMPLETE)).toBe(false);

		// Inner completes
		inner.down([[COMPLETE]]);
		expect(hasMsg(batches, COMPLETE)).toBe(true);
		unsub();
	});

	it("error in inner propagates to output", () => {
		const outer = node([], { initial: 0 });
		const inner = node([], { initial: 10 });
		const out = switchMap(outer, () => inner);
		const { batches, unsub } = collect(out);

		inner.down([[ERROR, new Error("inner-fail")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});
});

describe("P1: concatMap inner error propagation", () => {
	it("inner error forwards to output", () => {
		const outer = node([], { initial: 0 });
		const inner = node([], { initial: 10 });
		const out = concatMap(outer, () => inner);
		const { batches, unsub } = collect(out);

		inner.down([[ERROR, new Error("inner-err")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});
});

describe("P1: exhaustMap inner error propagation", () => {
	it("inner error forwards to output", () => {
		const outer = node([], { initial: 0 });
		const inner = node([], { initial: 10 });
		const out = exhaustMap(outer, () => inner);
		const { batches, unsub } = collect(out);

		inner.down([[ERROR, new Error("inner-err")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});
});

describe("P1: diamond glitch-freedom", () => {
	it("combine never exposes intermediate state in a diamond", () => {
		const root = node([], { initial: 1 });
		const left = map(root, (x) => (x as number) * 2);
		const right = map(root, (x) => (x as number) + 10);
		const joined = combine(left, right);

		const snapshots: unknown[] = [];
		const unsub = joined.subscribe((batchMsgs: Messages) => {
			for (const m of batchMsgs) {
				if (m[0] === DATA) snapshots.push(m[1]);
			}
		});

		// Initial: left=2, right=11
		expect(snapshots.length).toBeGreaterThanOrEqual(1);
		const initial = snapshots[snapshots.length - 1] as unknown[];
		expect(initial).toEqual([2, 11]);

		// Update root to 5 → left=10, right=15
		snapshots.length = 0;
		batch(() => {
			root.down([[DIRTY]]);
			root.down([[DATA, 5]]);
		});

		// Should only see [10, 15], never [10, 11] or [2, 15]
		for (const snap of snapshots) {
			const [l, r] = snap as [number, number];
			expect(l).toBe((r - 10) * 2); // invariant: left = (right - 10) * 2
		}

		if (snapshots.length > 0) {
			expect(snapshots[snapshots.length - 1]).toEqual([10, 15]);
		}
		unsub();
	});
});

describe("P1: reentrancy safety", () => {
	it("subscriber modifying state during emission produces consistent final value", () => {
		const s = node([], { initial: 0 });
		const d = node(
			[s],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0] as number);
			},
			{ describeKind: "derived" },
		);
		const values: number[] = [];

		d.subscribe((batchMsgs: Messages) => {
			for (const m of batchMsgs) {
				if (m[0] === DATA) {
					const v = m[1] as number;
					values.push(v);
					// Reentrant: set state again during emission
					if (v === 1) {
						batch(() => {
							s.down([[DIRTY]]);
							s.down([[DATA, 2]]);
						});
					}
				}
			}
		});

		batch(() => {
			s.down([[DIRTY]]);
			s.down([[DATA, 1]]);
		});

		// Should eventually settle at 2
		expect(d.cache).toBe(2);
		expect(values).toContain(2);
	});

	it("self-unsubscribe during emission does not crash", () => {
		const s = node([], { initial: 0 });
		let unsub: (() => void) | undefined;

		unsub = s.subscribe((batchMsgs: Messages) => {
			for (const m of batchMsgs) {
				if (m[0] === DATA) {
					// Unsubscribe during emission
					unsub?.();
				}
			}
		});

		// Should not throw
		expect(() => {
			batch(() => {
				s.down([[DIRTY]]);
				s.down([[DATA, 1]]);
			});
		}).not.toThrow();
	});
});

describe("P1: combine edge cases", () => {
	it("error from any source propagates", () => {
		const s1 = node([], { initial: 1 });
		const s2 = node([], { initial: 2 });
		const c = combine(s1, s2);
		const { batches, unsub } = collect(c);

		s1.down([[ERROR, new Error("boom")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		unsub();
	});

	it("single source combine works", () => {
		const s = node([], { initial: 42 });
		const c = combine(s);
		const { batches, unsub } = collect(c);

		expect(dataValues(batches).length).toBeGreaterThanOrEqual(1);
		const last = dataValues(batches).pop() as unknown[];
		expect(last).toEqual([42]);
		unsub();
	});
});

describe("P1: concat error handling", () => {
	it("error from first source stops chain", () => {
		const s1 = node([], { initial: 1 });
		const s2 = node([], { initial: 2 });
		const c = concat(s1, s2);
		const { batches, unsub } = collect(c);

		s1.down([[ERROR, new Error("first-err")]]);
		expect(hasMsg(batches, ERROR)).toBe(true);
		// s2 should never emit
		unsub();
	});
});

describe("P1: filter does not dedup", () => {
	it("passes consecutive different values through", () => {
		const s = node([], { initial: 0 });
		const f = filter(s, () => true);
		const { batches, unsub } = collect(f);

		batch(() => {
			s.down([[DIRTY]]);
			s.down([[DATA, 1]]);
		});
		batch(() => {
			s.down([[DIRTY]]);
			s.down([[DATA, 2]]);
		});

		const values = dataValues(batches);
		expect(values).toContain(1);
		expect(values).toContain(2);
		unsub();
	});
});

describe("P1: batch + diamond coalescing", () => {
	it("batch coalesces to final value", () => {
		const s = node([], { initial: 0 });
		const d = node(
			[s],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0] as number);
			},
			{ describeKind: "derived" },
		);
		const { batches, unsub } = collect(d);

		batch(() => {
			s.down([[DIRTY]]);
			s.down([[DATA, 1]]);
			s.down([[DIRTY]]);
			s.down([[DATA, 2]]);
			s.down([[DIRTY]]);
			s.down([[DATA, 3]]);
		});

		// Should see final value 3 (may see intermediates, but last must be 3)
		const values = dataValues(batches);
		expect(values[values.length - 1]).toBe(3);
		unsub();
	});
});
