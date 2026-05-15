/**
 * Regression: operator-level protocol and lifecycle vs GRAPHREFLY-SPEC §1.3 (two-phase, RESOLVED, subscriptions).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, Messages } from "../../core/messages.js";
import { COMPLETE, DATA, DIRTY, ERROR } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { node } from "../../core/node.js";

import {
	audit,
	buffer,
	bufferCount,
	bufferTime,
	catchError,
	combine,
	combineLatest,
	concat,
	concatMap,
	debounce,
	debounceTime,
	delay,
	distinctUntilChanged,
	elementAt,
	exhaustMap,
	filter,
	find,
	first,
	flatMap,
	interval,
	last,
	map,
	merge,
	mergeMap,
	pairwise,
	pausable,
	race,
	reduce,
	repeat,
	rescue,
	sample,
	scan,
	skip,
	switchMap,
	take,
	takeUntil,
	takeWhile,
	tap,
	throttle,
	throttleTime,
	timeout,
	valve,
	window,
	windowCount,
	windowTime,
	withLatestFrom,
	zip,
} from "../../extra/operators/index.js";
import {
	globalDirtyBeforePhase2,
	sawResolved,
	subscribeProtocol,
} from "./operator-protocol-harness.js";

function assertDirtyBeforeDataOnTwoPhase(node: Node<unknown>, push: () => void): void {
	const cap = subscribeProtocol(node);
	push();
	try {
		expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
	} finally {
		cap.unsub();
	}
}

/** Second push uses a distinct value so sinks get DATA, not only RESOLVED (same cached output). */
function assertReconnectSeesData(
	build: () => { source: Node<number>; out: Node<unknown>; pushSecond?: () => void },
): void {
	const { source, out, pushSecond } = build();
	const a = subscribeProtocol(out);
	source.down([[DATA, 1]]);
	expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
	a.unsub();
	const b = subscribeProtocol(out);
	(pushSecond ?? (() => source.down([[DIRTY], [DATA, 99]])))();
	expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
	b.unsub();
}

describe("Tier 1 operator protocol matrix", () => {
	describe("map", () => {
		// Regression: GRAPHREFLY-SPEC §1.3.1 — DIRTY precedes DATA/RESOLVED in two-phase push.
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = map(s, (n) => (n as number) * 2);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 3]]));
		});

		// Regression: GRAPHREFLY-SPEC §1.3.3 — RESOLVED when recomputed value unchanged.
		it("emits RESOLVED when projected value is unchanged", () => {
			const s = node([], { initial: 2 });
			const out = map(s, (n) => (n as number) % 2);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			s.down([[DIRTY], [DATA, 4]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		// Regression: GRAPHREFLY-SPEC §2 — subscribe lifecycle; operators reset inner state on teardown where applicable.
		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				const out = map(s, (n) => (n as number) + 1);
				return {
					source: s,
					out,
					pushSecond: () => s.down([[DATA, 5]]),
				};
			});
		});
	});

	describe("filter", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = filter(s, (n) => (n as number) > -1);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 3]]));
		});

		it("emits RESOLVED when filtered output value repeats", () => {
			const s = node([], { initial: 1 });
			const out = filter(s, (n) => (n as number) % 2 === 1);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			s.down([[DIRTY], [DATA, 3]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				const out = filter(s, (n) => (n as number) >= 0);
				return { source: s, out, pushSecond: () => s.down([[DATA, 2]]) };
			});
		});
	});

	describe("tap", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = tap(s, () => undefined);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 3]]));
		});

		it("emits RESOLVED when upstream value maps to same output via following map semantics", () => {
			const s = node([], { initial: 2 });
			const out = tap(
				map(s, (n) => (n as number) % 2),
				() => undefined,
			);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			s.down([[DIRTY], [DATA, 4]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				const out = tap(s, () => undefined);
				return { source: s, out, pushSecond: () => s.down([[DATA, 2]]) };
			});
		});
	});

	describe("scan", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = scan(s, (a, x) => a + (x as number), 0);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 2]]));
		});

		it("may emit RESOLVED when accumulator unchanged (same protocol as derived nodes)", () => {
			const s = node([], { initial: 0 });
			const out = scan(s, (_a, x) => (x as number) % 2, 0);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			s.down([[DIRTY], [DATA, 4]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { resubscribable: true, initial: 0 });
				const out = scan(s, (a, x) => a + (x as number), 0);
				return { source: s, out };
			});
		});
	});

	describe("take", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = take(s, 5);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 1]]));
		});

		it("emits RESOLVED when further DATA would repeat current output before take limit", () => {
			const s = node([], { initial: 1 });
			const out = take(
				map(s, (n) => (n as number) % 2),
				3,
			);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			s.down([[DIRTY], [DATA, 4]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { resubscribable: true, initial: 0 });
				const out = take(s, 10);
				return { source: s, out };
			});
		});
	});

	describe("skip", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = skip(s, 0);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 1]]));
		});

		it("forwards RESOLVED when inner mapped value unchanged", () => {
			const s = node([], { initial: 2 });
			const out = skip(
				map(s, (n) => (n as number) % 2),
				0,
			);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			s.down([[DIRTY], [DATA, 4]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				const out = skip(s, 0);
				return { source: s, out, pushSecond: () => s.down([[DATA, 2]]) };
			});
		});
	});

	describe("distinctUntilChanged", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = distinctUntilChanged(s);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 1]]));
		});

		it("suppresses duplicate consecutive values (RESOLVED / no duplicate DATA)", () => {
			const s = node([], { initial: 1 });
			const out = distinctUntilChanged(s);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			s.down([[DIRTY], [DATA, 1]]);
			expect(sawResolved(cap.batches) || cap.flat().filter((m) => m[0] === DATA).length === 1).toBe(
				true,
			);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { resubscribable: true, initial: 0 });
				const out = distinctUntilChanged(s);
				return { source: s, out };
			});
		});
	});

	describe("pairwise", () => {
		// Regression: GRAPHREFLY-SPEC §1.3 — after two source values, output delivers a DATA tuple (ordering may omit DIRTY at sink per single-callback batches).
		it("emits DATA tuple after two source emissions", () => {
			const s = node([], { initial: 0 });
			const out = pairwise(s);
			const cap = subscribeProtocol(out);
			s.down([[DATA, 0]]);
			s.down([[DIRTY], [DATA, 1]]);
			expect(cap.flat().some((m) => m[0] === DATA)).toBe(true);
			cap.unsub();
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				const out = pairwise(s);
				return {
					source: s,
					out,
					pushSecond: () => {
						s.down([[DATA, 0]]);
						s.down([[DATA, 1]]);
					},
				};
			});
		});
	});

	describe("derived with initial (replaces startWith)", () => {
		it("DIRTY precedes DATA when source uses two-phase down after seed", () => {
			const s = node([], { initial: 0 });
			const out = node(
				[s as Node],
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ describeKind: "derived", initial: -1 },
			);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 0]]));
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { resubscribable: true, initial: 0 });
				const out = node(
					[s as Node],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit(data[0]);
					},
					{ describeKind: "derived", initial: 0 },
				);
				return { source: s, out };
			});
		});
	});

	describe("first", () => {
		it("DIRTY precedes DATA when source uses two-phase down", () => {
			const s = node([], { initial: 0 });
			const out = first(s);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 7]]));
		});

		// Regression: GRAPHREFLY-SPEC §2 — resubscribable `take(1)` resets counters on resubscribe (`onResubscribe`).
		it("resubscribable first() delivers DATA again after prior COMPLETE", () => {
			const s = node([], { resubscribable: true, initial: 0 });
			const out = first(s, { resubscribable: true });
			const a = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
			b.unsub();
		});
	});

	describe("combine", () => {
		it("DIRTY precedes DATA on two-phase update", () => {
			const a = node([], { initial: 1 });
			const b = node([], { initial: 2 });
			const c = combine(a, b);
			assertDirtyBeforeDataOnTwoPhase(c, () => a.down([[DIRTY], [DATA, 10]]));
		});

		it("emits RESOLVED when tuple unchanged", () => {
			const a = node([], { initial: 1 });
			const b = node([], { initial: 2 });
			const c = combine(a, b);
			const cap = subscribeProtocol(c);
			a.down([[DATA, 0]]);
			b.down([[DATA, 0]]);
			a.down([[DIRTY], [DATA, 0]]);
			b.down([[DIRTY], [DATA, 0]]);
			expect(sawResolved(cap.batches)).toBe(true);
			cap.unsub();
		});

		it("second subscription sees updates after unsubscribe", () => {
			const a = node([], { initial: 1 });
			const b = node([], { initial: 2 });
			const c = combine(a, b);
			const x = subscribeProtocol(c);
			a.down([[DATA, 3]]);
			expect(x.flat().some((m) => m[0] === DATA)).toBe(true);
			x.unsub();
			const y = subscribeProtocol(c);
			b.down([[DATA, 4]]);
			expect(y.flat().some((m) => m[0] === DATA)).toBe(true);
			y.unsub();
		});
	});

	describe("zip", () => {
		it("DIRTY precedes DATA when first arm uses two-phase", () => {
			const x = node([], { initial: 1 });
			const y = node([], { initial: 2 });
			const z = zip(x, y);
			const cap = subscribeProtocol(z);
			x.down([[DIRTY], [DATA, 10]]);
			y.down([[DATA, 20]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});

		it("second subscription receives paired DATA after unsubscribe", () => {
			const x = node([], { initial: 1 });
			const y = node([], { initial: 2 });
			const z = zip(x, y);
			const a = subscribeProtocol(z);
			x.down([[DATA, 1]]);
			y.down([[DATA, 2]]);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(z);
			x.down([[DATA, 3]]);
			y.down([[DATA, 4]]);
			expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
			b.unsub();
		});
	});

	describe("merge", () => {
		// Regression: GRAPHREFLY-SPEC §1.3.5 — merge completes only after all sources complete.
		it("DIRTY precedes DATA when a source uses two-phase down", () => {
			const a = node([], { initial: 0 });
			const b = node([], { initial: 0 });
			const m = merge(a, b);
			assertDirtyBeforeDataOnTwoPhase(m, () => a.down([[DIRTY], [DATA, 1]]));
		});

		it("second subscription receives DATA from either source after unsubscribe", () => {
			const a = node([], { initial: 0 });
			const b = node([], { initial: 0 });
			const m = merge(a, b);
			const x = subscribeProtocol(m);
			a.down([[DATA, 1]]);
			expect(x.flat().some((m) => m[0] === DATA)).toBe(true);
			x.unsub();
			const y = subscribeProtocol(m);
			b.down([[DATA, 2]]);
			expect(y.flat().some((m) => m[0] === DATA)).toBe(true);
			y.unsub();
		});
	});

	describe("race", () => {
		it("DIRTY precedes DATA when winning source uses two-phase", () => {
			const a = node([], { initial: 0 });
			const b = node([], { initial: 0 });
			const r = race(a, b);
			assertDirtyBeforeDataOnTwoPhase(r, () => a.down([[DIRTY], [DATA, 1]]));
		});

		it("new race() instance forwards DATA after prior race completed", () => {
			const a1 = node([], { resubscribable: true, initial: 0 });
			const b1 = node([], { resubscribable: true, initial: 0 });
			const r1 = race(a1, b1);
			const x = subscribeProtocol(r1);
			a1.down([[DATA, 1]]);
			expect(x.flat().some((m) => m[0] === DATA)).toBe(true);
			x.unsub();
			const a2 = node([], { resubscribable: true, initial: 0 });
			const b2 = node([], { resubscribable: true, initial: 0 });
			const r2 = race(a2, b2);
			const y = subscribeProtocol(r2);
			b2.down([[DATA, 2]]);
			expect(y.flat().some((m) => m[0] === DATA)).toBe(true);
			y.unsub();
		});
	});

	describe("concat", () => {
		it("DIRTY precedes DATA on first source two-phase", () => {
			const a = node<number>();
			const b = node<number>();
			const c = concat(a, b);
			assertDirtyBeforeDataOnTwoPhase(c, () => a.down([[DIRTY], [DATA, 1]]));
		});

		it("second subscription receives DATA after unsubscribe", () => {
			const a = node([], { resubscribable: true, initial: 0 });
			const b = node([], { resubscribable: true, initial: 0 });
			const c = concat(a, b);
			const x = subscribeProtocol(c);
			a.down([[DATA, 1]]);
			a.down([[COMPLETE]]);
			b.down([[DATA, 2]]);
			expect(x.flat().some((m) => m[0] === DATA)).toBe(true);
			x.unsub();
			const y = subscribeProtocol(c);
			a.down([[DATA, 3]]);
			a.down([[COMPLETE]]);
			b.down([[DATA, 4]]);
			expect(y.flat().some((m) => m[0] === DATA)).toBe(true);
			y.unsub();
		});
	});

	describe("withLatestFrom", () => {
		it("DIRTY on primary precedes DATA when paired", () => {
			const p = node([], { initial: 1 });
			const q = node([], { initial: 2 });
			const w = withLatestFrom(p, q);
			const cap = subscribeProtocol(w);
			q.down([[DATA, 20]]);
			p.down([[DIRTY], [DATA, 10]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});

		it("second subscription receives DATA after unsubscribe", () => {
			const p = node([], { initial: 1 });
			const q = node([], { initial: 2 });
			const w = withLatestFrom(p, q);
			const x = subscribeProtocol(w);
			q.down([[DATA, 1]]);
			p.down([[DATA, 2]]);
			expect(x.flat().some((m) => m[0] === DATA)).toBe(true);
			x.unsub();
			const y = subscribeProtocol(w);
			q.down([[DATA, 3]]);
			p.down([[DATA, 4]]);
			expect(y.flat().some((m) => m[0] === DATA)).toBe(true);
			y.unsub();
		});
	});

	describe("reduce", () => {
		it("does not emit DATA until upstream COMPLETE (operator semantics)", () => {
			const s = node([], { initial: 0 });
			const r = reduce(s, (a, x) => a + (x as number), 0);
			const cap = subscribeProtocol(r);
			s.down([[DIRTY], [DATA, 1]]);
			expect(cap.flat().filter((m) => m[0] === DATA).length).toBe(0);
			cap.unsub();
		});

		it("second subscription can complete again with resubscribable source", () => {
			const s = node([], { resubscribable: true, initial: 0 });
			const r = reduce(s, (a, x) => a + (x as number), 0, { resubscribable: true });
			const x = subscribeProtocol(r);
			s.down([[DATA, 1]]);
			s.down([[COMPLETE]]);
			expect(x.flat().some((m) => m[0] === DATA)).toBe(true);
			x.unsub();
			const y = subscribeProtocol(r);
			s.down([[DATA, 2]]);
			s.down([[COMPLETE]]);
			expect(y.flat().filter((m) => m[0] === DATA).length).toBeGreaterThanOrEqual(1);
			y.unsub();
		});
	});

	describe("takeUntil", () => {
		// Regression: GRAPHREFLY-SPEC §1.3 — primary stream two-phase before notifier stops.
		// Notifier must be SENTINEL (no initial value) so it doesn't trigger
		// takeUntil's COMPLETE on subscribe — the test verifies the primary
		// stream's two-phase protocol while the notifier is idle.
		it("DIRTY precedes DATA on primary when notifier has not fired", () => {
			const s = node([], { initial: 0 });
			const stop = node<number>();
			const out = takeUntil(s, stop);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 3]]));
		});

		it("second subscription receives DATA after unsubscribe (notifier idle)", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				// Use SENTINEL for notifier — node([], { initial: 0 }) would push DATA on resubscribe,
				// triggering takeUntil's COMPLETE (notifier must be truly idle).
				const stop = node<number>();
				const out = takeUntil(s, stop);
				return { source: s, out };
			});
		});
	});

	describe("takeWhile", () => {
		it("DIRTY precedes DATA when predicate still holds", () => {
			const s = node([], { initial: 0 });
			const out = takeWhile(s, (n) => (n as number) < 9);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 1]]));
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			assertReconnectSeesData(() => {
				const s = node([], { initial: 0 });
				const out = takeWhile(s, (n) => (n as number) < 100);
				return { source: s, out };
			});
		});
	});

	describe("find", () => {
		it("DIRTY precedes DATA on two-phase source", () => {
			const s = node([], { initial: 0 });
			const out = find(s, (n) => (n as number) >= 0);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 1]]));
		});

		// Regression: GRAPHREFLY-SPEC §2 — resubscribable take(1) inside find.
		it("resubscribable find allows another first match after COMPLETE", () => {
			const s = node([], { resubscribable: true, initial: 0 });
			const out = find(s, (n) => (n as number) > 0, { resubscribable: true });
			const a = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
			b.unsub();
		});
	});

	describe("elementAt", () => {
		it("DIRTY precedes DATA when reaching indexed emission", () => {
			const s = node([], { initial: 0 });
			const out = elementAt(s, 1);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY], [DATA, 10]]);
			s.down([[DIRTY], [DATA, 20]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("last", () => {
		it("DIRTY precedes final DATA on COMPLETE after two-phase source", () => {
			const s = node([], { initial: 0 });
			const out = last(s);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY], [DATA, 7]]);
			s.down([[COMPLETE]]);
			const flat = cap.flat();
			// last emits RESOLVED during activation (accumulating, no value
			// yet). That's an activation-ceremony emission — no DIRTY
			// precedes it (spec §2.2: ceremony ≠ transition). The two-phase
			// check applies to the terminal DATA emission: there must be a
			// DIRTY before the final DATA.
			const dataIdx = flat.findIndex((m) => m[0] === DATA);
			expect(dataIdx).toBeGreaterThanOrEqual(0);
			const dirtyBeforeData = flat.slice(0, dataIdx).some((m) => m[0] === DIRTY);
			expect(dirtyBeforeData).toBe(true);
			cap.unsub();
		});
	});

	describe("valve", () => {
		// Regression: GRAPHREFLY-SPEC §1.3 — valve derives from source when control is open.
		it("DIRTY precedes DATA when control is true", () => {
			const data = node([], { initial: 0 });
			const open = node([], { initial: true });
			const out = valve(data, open);
			assertDirtyBeforeDataOnTwoPhase(out, () => data.down([[DIRTY], [DATA, 5]]));
		});

		it("second subscription receives later DATA after unsubscribe", () => {
			const data = node([], { initial: 0 });
			const open = node([], { initial: true });
			const out = valve(data, open);
			const a = subscribeProtocol(out);
			data.down([[DATA, 1]]);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			data.down([[DIRTY], [DATA, 99]]);
			expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
			b.unsub();
		});
	});
});

describe("Tier 2 operator protocol matrix", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	describe("switchMap", () => {
		// Outer two-phase may interleave with inner subscription setup; assert global ordering once inner emits.
		it("DIRTY precedes inner DATA after outer selects inner (two-phase outer)", () => {
			const src = node<number>();
			const inner = node<number>();
			const out = switchMap(src, () => inner);
			const cap = subscribeProtocol(out);
			src.down([[DIRTY], [DATA, 1]]);
			inner.down([[DIRTY], [DATA, 99]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});

		it("second subscription follows new outer DATA after unsubscribe", () => {
			const src = node([], { initial: 0 });
			const inner = node([], { initial: 100 });
			const out = switchMap(src, () => inner);
			const a = subscribeProtocol(out);
			src.down([[DATA, 1]]);
			inner.down([[DATA, 11]]);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			src.down([[DATA, 2]]);
			inner.down([[DATA, 22]]);
			expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
			b.unsub();
		});
	});

	describe("exhaustMap", () => {
		// Regression: GRAPHREFLY-SPEC §1.3 — inner DIRTY propagates before inner DATA.
		// After initial attach on connect, push to the inner and verify ordering.
		it("inner DIRTY precedes inner DATA through exhaustMap", () => {
			const src = node([], { initial: 0 });
			const inner = node([], { initial: 10 });
			const out = exhaustMap(src, () => inner);
			// Subscribe and let initial connect attach to inner.
			const batches: Messages[] = [];
			const unsub = out.subscribe((msgs) => batches.push([...msgs] as unknown as Messages));
			// Clear initial connect messages; isolate the scripted push.
			batches.length = 0;
			inner.down([[DIRTY], [DATA, 20]]);
			const flat = batches.flat() as Message[];
			expect(globalDirtyBeforePhase2(flat)).toBe(true);
			unsub();
		});
	});

	describe("concatMap", () => {
		// Regression: GRAPHREFLY-SPEC §1.3 — inner two-phase ordering must survive queued higher-order dispatch.
		it("DIRTY precedes DATA from active inner after outer two-phase", () => {
			const src = node<number>();
			const inner = node<number>();
			const out = concatMap(src, () => inner);
			const cap = subscribeProtocol(out);
			src.down([[DIRTY], [DATA, 1]]);
			inner.down([[DIRTY], [DATA, 77]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});

		it("second subscription runs sequential inners after unsubscribe", () => {
			const run = (): void => {
				const src = node([], { initial: 0 });
				const a = node([], { initial: 100 });
				const b = node([], { initial: 200 });
				let wave = 0;
				const out = concatMap(src, () => {
					wave += 1;
					return wave === 1 ? a : b;
				});
				const x = subscribeProtocol(out);
				src.down([[DATA, 1]]);
				a.down([[COMPLETE]]);
				src.down([[DATA, 2]]);
				b.down([[DATA, 201]]);
				expect(x.flat().some((m) => m[1] === 201)).toBe(true);
				x.unsub();
				const y = subscribeProtocol(out);
				src.down([[DATA, 1]]);
				a.down([[COMPLETE]]);
				src.down([[DATA, 2]]);
				b.down([[DATA, 202]]);
				expect(y.flat().some((m) => m[1] === 202)).toBe(true);
				y.unsub();
			};
			run();
		});
	});

	describe("mergeMap", () => {
		it("DIRTY precedes DATA from inner after outer two-phase", () => {
			const src = node<number>();
			const inner = node<number>();
			const out = mergeMap(src, () => inner);
			const cap = subscribeProtocol(out);
			src.down([[DIRTY], [DATA, 1]]);
			inner.down([[DIRTY], [DATA, 10]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});

		it("second subscription follows new outer DATA after unsubscribe", () => {
			const src = node([], { initial: 0 });
			const inner = node([], { initial: 100 });
			const out = mergeMap(src, () => inner);
			const a = subscribeProtocol(out);
			src.down([[DATA, 1]]);
			inner.down([[DATA, 11]]);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			src.down([[DATA, 2]]);
			inner.down([[DATA, 22]]);
			expect(b.flat().some((m) => m[0] === DATA)).toBe(true);
			b.unsub();
		});
	});

	describe("flatMap (alias of mergeMap)", () => {
		// Regression: flatMap is the same function reference as mergeMap (RxJS naming).
		it("is mergeMap", () => {
			expect(flatMap).toBe(mergeMap);
		});

		it("DIRTY precedes DATA from inner after outer two-phase", () => {
			const src = node<number>();
			const inner = node<number>();
			const out = flatMap(src, () => inner);
			const cap = subscribeProtocol(out);
			src.down([[DIRTY], [DATA, 1]]);
			inner.down([[DIRTY], [DATA, 10]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("debounce", () => {
		it("after reconnect, emits debounced DATA for new activity (fake timers)", () => {
			vi.useFakeTimers();
			const s = node([], { initial: 0 });
			const out = debounce(s, 50);
			const a = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			vi.advanceTimersByTime(50);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			vi.advanceTimersByTime(50);
			expect(b.flat().some((m) => m[1] === 2)).toBe(true);
			b.unsub();
		});
	});

	describe("delay", () => {
		// v5: delay is a producer that transforms the timeline. DIRTY+DATA
		// arrive atomically at timer-fire time via a.emit(v) → bundle.
		// No early DIRTY forwarding — the downstream doesn't see the
		// source's transition until the delayed value is ready.
		it("DIRTY+DATA arrive together after timer fires (fake timers)", () => {
			vi.useFakeTimers();
			const s = node([], { initial: 0 });
			const out = delay(s, 40);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY]]);
			s.down([[DATA, 7]]);
			// Before timer: no DIRTY, no DATA visible at the delayed node.
			expect(cap.flat().filter((m) => m[0] === DATA).length).toBe(0);
			expect(cap.flat().filter((m) => m[0] === DIRTY).length).toBe(0);
			vi.advanceTimersByTime(40);
			// After timer: DIRTY+DATA arrive together (bundle auto-prefix).
			const flat = cap.flat();
			expect(globalDirtyBeforePhase2(flat)).toBe(true);
			expect(flat.some((m) => m[0] === DATA && m[1] === 7)).toBe(true);
			cap.unsub();
		});
	});

	describe("throttle", () => {
		// Regression: throttle uses `performance.now()` for spacing — lastEmit starts at -Infinity so the first leading edge always fires.
		it("reconnect sees leading DATA again (fake timers)", () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const s = node<number>();
			const out = throttle(s, 1_000, { trailing: false });
			const a = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			expect(a.flat().find((m) => m[0] === DATA)?.[1]).toBe(1);
			a.unsub();
			vi.advanceTimersByTime(2_000);
			// Subscribe and drain initial cached push, then advance past any throttle window it may trigger.
			const bBatches: Messages[] = [];
			const bUnsub = out.subscribe((msgs) => bBatches.push([...msgs] as unknown as Messages));
			bBatches.length = 0;
			vi.advanceTimersByTime(2_000);
			s.down([[DATA, 2]]);
			expect(
				(bBatches as Message[][]).flat().some((m: Message) => m[0] === DATA && m[1] === 2),
			).toBe(true);
			bUnsub();
		});
	});

	describe("sample", () => {
		it("DIRTY on notifier precedes sampled DATA", () => {
			const src = node([], { initial: 1 });
			const tick = node([], { initial: 0 });
			const out = sample(src, tick);
			const cap = subscribeProtocol(out);
			src.down([[DATA, 10]]);
			tick.down([[DIRTY], [DATA, 1]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("audit", () => {
		it("after reconnect, emits audited DATA for new activity (fake timers)", () => {
			vi.useFakeTimers();
			const s = node([], { initial: 0 });
			const out = audit(s, 50);
			const a = subscribeProtocol(out);
			s.down([[DATA, 1]]);
			vi.advanceTimersByTime(60);
			expect(a.flat().some((m) => m[0] === DATA)).toBe(true);
			a.unsub();
			const b = subscribeProtocol(out);
			s.down([[DATA, 2]]);
			vi.advanceTimersByTime(60);
			expect(b.flat().some((m) => m[1] === 2)).toBe(true);
			b.unsub();
		});
	});

	describe("buffer", () => {
		it("DIRTY precedes flushed buffer DATA when notifier uses two-phase", () => {
			const src = node([], { initial: 0 });
			const n = node([], { initial: 0 });
			const out = buffer(src, n);
			const cap = subscribeProtocol(out);
			src.down([[DATA, 1]]);
			src.down([[DATA, 2]]);
			n.down([[DIRTY], [DATA, 0]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			expect(cap.flat().some((m) => m[0] === DATA && Array.isArray(m[1]))).toBe(true);
			cap.unsub();
		});
	});

	describe("bufferCount", () => {
		it("DIRTY precedes DATA when buffer fills on two-phase pushes", () => {
			const s = node([], { initial: 0 });
			const out = bufferCount(s, 2);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY], [DATA, 1]]);
			s.down([[DIRTY], [DATA, 2]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("bufferTime", () => {
		// v5: bufferTime is a producer. DIRTY+DATA arrive atomically
		// when the interval fires via a.emit(buf) → bundle.
		it("DIRTY+DATA arrive together after interval fires (fake timers)", () => {
			vi.useFakeTimers();
			const s = node<number>();
			const out = bufferTime(s, 50);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY]]);
			s.down([[DATA, 7]]);
			// Before interval: nothing visible at the buffered node.
			expect(cap.flat().filter((m) => m[0] === DATA).length).toBe(0);
			vi.advanceTimersByTime(50);
			// After interval: DIRTY+DATA arrive together.
			const flat = cap.flat();
			expect(globalDirtyBeforePhase2(flat)).toBe(true);
			expect(flat.some((m) => m[0] === DATA)).toBe(true);
			cap.unsub();
		});
	});

	describe("windowCount", () => {
		it("DIRTY precedes DATA when filling a window (no eager outer DATA)", () => {
			const src = node<number | undefined>([], { initial: undefined });
			const out = windowCount(src, 2);
			const cap = subscribeProtocol(out);
			src.down([[DIRTY], [DATA, 1]]);
			src.down([[DIRTY], [DATA, 2]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("window", () => {
		it("DIRTY precedes first window emission when notifier closes on two-phase", () => {
			const src = node<number | undefined>([], { initial: undefined });
			const n = node([], { initial: 0 });
			const out = window(src, n);
			const cap = subscribeProtocol(out);
			src.down([[DIRTY], [DATA, 1]]);
			n.down([[DIRTY], [DATA, 0]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("windowTime", () => {
		it("DIRTY precedes DATA after window interval (fake timers)", () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			vi.setSystemTime(10_000);
			const s = node<number>();
			const out = windowTime(s, 100);
			assertDirtyBeforeDataOnTwoPhase(out, () => s.down([[DIRTY], [DATA, 1]]));
		});
	});

	describe("timeout", () => {
		// Regression: split `down` so DIRTY is not elided at the sink (single-dep DIRTY skip when batched with DATA).
		it("DIRTY precedes DATA when idle timer is long", () => {
			const s = node<number>();
			const out = timeout(s, 999_999);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY]]);
			s.down([[DATA, 1]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});

		it("emits ERROR after idle window (fake timers)", () => {
			vi.useFakeTimers();
			const s = node([], { initial: 0 });
			const out = timeout(s, 30);
			const cap = subscribeProtocol(out);
			vi.advanceTimersByTime(30);
			expect(cap.flat().some((m) => m[0] === ERROR)).toBe(true);
			cap.unsub();
		});
	});

	describe("pausable", () => {
		it("DIRTY precedes DATA when not paused", () => {
			const s = node<number>();
			const out = pausable(s);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY]]);
			s.down([[DATA, 1]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("rescue", () => {
		it("DIRTY precedes DATA on successful path", () => {
			const s = node<number>();
			const out = rescue(s, () => 0);
			const cap = subscribeProtocol(out);
			s.down([[DIRTY]]);
			s.down([[DATA, 1]]);
			expect(globalDirtyBeforePhase2(cap.flat())).toBe(true);
			cap.unsub();
		});
	});

	describe("repeat", () => {
		it("completes producer after N inner COMPLETE rounds", () => {
			const s = node([], { resubscribable: true, initial: 1 });
			const out = repeat(s, 2);
			const cap = subscribeProtocol(out);
			s.down([[COMPLETE]]);
			s.down([[COMPLETE]]);
			expect(cap.flat().some((m) => m[0] === COMPLETE)).toBe(true);
			cap.unsub();
		});
	});

	describe("interval", () => {
		it("emits DATA on timer while subscribed (fake timers)", () => {
			vi.useFakeTimers();
			const out = interval(50);
			const cap = subscribeProtocol(out);
			vi.advanceTimersByTime(50);
			expect(cap.flat().some((m) => m[0] === DATA)).toBe(true);
			cap.unsub();
		});
	});

	describe("RxJS alias exports", () => {
		it("combineLatest is combine", () => {
			expect(combineLatest).toBe(combine);
		});

		it("debounceTime is debounce", () => {
			expect(debounceTime).toBe(debounce);
		});

		it("throttleTime is throttle", () => {
			expect(throttleTime).toBe(throttle);
		});

		it("catchError is rescue", () => {
			expect(catchError).toBe(rescue);
		});
	});
});
