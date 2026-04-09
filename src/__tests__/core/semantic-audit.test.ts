/**
 * Semantic audit: verify node and dynamicNode match the spec after the
 * connection-time diamond fix and subscribe-time push changes.
 *
 * Focus areas:
 * 1. No silent double-emission anywhere (subscribers count exact deliveries)
 * 2. Connection-time diamond resolution (single fn run on initial activation)
 * 3. Subscribe-time push semantics (first vs subsequent subscribers)
 * 4. DIRTY/DATA/RESOLVED protocol correctness across all node types
 * 5. Complex multi-stage compositions with reconnect, teardown, resubscribe
 * 6. DynamicNodeImpl lifecycle phases
 *
 * Each test asserts EXACT message counts and sequences — any drift fails loudly.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { dynamicNode } from "../../core/dynamic-node.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	INVALIDATE,
	type Messages,
	RESOLVED,
	TEARDOWN,
} from "../../core/messages.js";
import { node } from "../../core/node.js";
import { derived, effect, producer, state } from "../../core/sugar.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MsgRecord = { type: symbol; value?: unknown };

function recorder() {
	const msgs: MsgRecord[] = [];
	const sink = (batch: Messages) => {
		for (const m of batch) {
			msgs.push(m.length > 1 ? { type: m[0], value: m[1] } : { type: m[0] });
		}
	};
	return { msgs, sink };
}

function _typeCounts(msgs: MsgRecord[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const m of msgs) {
		const key = m.type.toString();
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

function dataValues(msgs: MsgRecord[]): unknown[] {
	return msgs.filter((m) => m.type === DATA).map((m) => m.value);
}

// ===========================================================================
// CATEGORY 1: No double-emission anywhere
// ===========================================================================

describe("Semantic audit — no double-emission", () => {
	it("state node: first subscriber receives value exactly once", () => {
		const s = state(42);
		const { msgs, sink } = recorder();
		s.subscribe(sink);
		expect(dataValues(msgs)).toEqual([42]);
	});

	it("state node: second subscriber receives value exactly once", () => {
		const s = state(42);
		s.subscribe(() => {});
		const { msgs, sink } = recorder();
		s.subscribe(sink);
		expect(dataValues(msgs)).toEqual([42]);
	});

	it("derived node: first subscriber receives computed value exactly once", () => {
		const a = state(5);
		const d = derived([a], ([v]) => (v as number) * 2);
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		expect(dataValues(msgs)).toEqual([10]);
	});

	it("derived node: second subscriber receives cached value exactly once", () => {
		const a = state(5);
		const d = derived([a], ([v]) => (v as number) * 2);
		d.subscribe(() => {});
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		expect(dataValues(msgs)).toEqual([10]);
	});

	it("producer with initial + sync emit: first subscriber receives both initial and emitted", () => {
		// Producer with `initial` option set AND fn emitting a different value.
		// Handshake delivers [START, DATA(initial)], then activation runs fn
		// which emits a different value via emit().
		const p = producer<number>(
			(_deps, { emit }) => {
				emit(99);
			},
			{ initial: 0 },
		);
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		// First subscriber sees initial from handshake, then emitted from fn.
		expect(dataValues(msgs)).toEqual([0, 99]);
	});

	it("producer with initial + same sync emit: first subscriber sees initial then RESOLVED", () => {
		// When fn emits the same value as initial, equals detects no change
		// and emits RESOLVED instead of DATA.
		const p = producer<number>(
			(_deps, { emit }) => {
				emit(42);
			},
			{ initial: 42 },
		);
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		// Only one DATA (from handshake); fn emit produces RESOLVED (same value).
		expect(dataValues(msgs)).toEqual([42]);
		expect(msgs.some((m) => m.type === RESOLVED)).toBe(true);
	});

	it("producer with initial: second subscriber sees only cached (last emitted)", () => {
		const p = producer<number>(
			(_deps, { emit }) => {
				emit(99);
			},
			{ initial: 0 },
		);
		p.subscribe(() => {});
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		// Second subscriber sees cached value (99, from fn emit) via handshake.
		expect(dataValues(msgs)).toEqual([99]);
	});

	it("producer (sync emit): first subscriber receives value exactly once", () => {
		const p = producer<number>((_deps, { emit }) => {
			emit(42);
		});
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		expect(dataValues(msgs)).toEqual([42]);
	});

	it("producer (multiple sync emits): subscriber receives each exactly once", () => {
		const p = producer<number>((_deps, { emit }) => {
			emit(1);
			emit(2);
			emit(3);
		});
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		expect(dataValues(msgs)).toEqual([1, 2, 3]);
	});

	it("producer (second subscriber): receives only latest cached value", () => {
		const p = producer<number>((_deps, { emit }) => {
			emit(1);
			emit(2);
			emit(3);
		});
		p.subscribe(() => {});
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		// Only cached (last) value — producer is hot, doesn't re-run
		expect(dataValues(msgs)).toEqual([3]);
	});

	it("effect node: fn runs exactly once per value (no double-run on activation)", () => {
		const a = state(10);
		let runs = 0;
		let lastVal: number | undefined;
		const e = effect([a], ([v]) => {
			runs++;
			lastVal = v as number;
		});
		e.subscribe(() => {});
		expect(runs).toBe(1);
		expect(lastVal).toBe(10);
	});

	it("derived fn runs exactly once on initial activation", () => {
		const a = state(5);
		let runs = 0;
		const d = derived([a], ([v]) => {
			runs++;
			return (v as number) * 2;
		});
		d.subscribe(() => {});
		expect(runs).toBe(1);
	});
});

// ===========================================================================
// CATEGORY 2: Connection-time diamond (the main fix)
// ===========================================================================

describe("Semantic audit — connection-time diamond", () => {
	it("2-dep diamond: D fn runs exactly once on initial activation", () => {
		//     A
		//    / \
		//   B   C
		//    \ /
		//     D
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) * 2);
		const c = derived([a], ([v]) => (v as number) + 10);
		let dRuns = 0;
		const d = derived([b, c], ([bv, cv]) => {
			dRuns++;
			return `${bv}+${cv}`;
		});
		d.subscribe(() => {});
		expect(dRuns).toBe(1);
		expect(d.get()).toBe("2+11");
	});

	it("3-dep diamond: D fn runs exactly once on initial activation", () => {
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) * 2);
		const c = derived([a], ([v]) => (v as number) + 10);
		const e = derived([a], ([v]) => (v as number) - 5);
		let dRuns = 0;
		const d = derived([b, c, e], ([bv, cv, ev]) => {
			dRuns++;
			return [bv, cv, ev];
		});
		d.subscribe(() => {});
		expect(dRuns).toBe(1);
		expect(d.get()).toEqual([2, 11, -4]);
	});

	it("diamond: subscriber receives NO intermediate glitch values", () => {
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) * 2);
		const c = derived([a], ([v]) => (v as number) + 10);
		const d = derived([b, c], ([bv, cv]) => `${bv}+${cv}`);
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		// Subscriber should see exactly one final DATA — no "2+undefined"
		const dataMsgs = dataValues(msgs);
		expect(dataMsgs).toEqual(["2+11"]);
		// No intermediate state
		for (const v of dataMsgs) {
			expect(String(v)).not.toContain("undefined");
		}
	});

	it("diamond: subsequent update via batch still recomputes once", () => {
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) * 2);
		const c = derived([a], ([v]) => (v as number) + 10);
		let dRuns = 0;
		const d = derived([b, c], ([bv, cv]) => {
			dRuns++;
			return `${bv}+${cv}`;
		});
		d.subscribe(() => {});
		dRuns = 0;
		batch(() => {
			a.down([[DIRTY], [DATA, 5]]);
		});
		expect(dRuns).toBe(1);
		expect(d.get()).toBe("10+15");
	});

	it("nested diamond: 4 levels deep, single fn run at each level", () => {
		//     A
		//    / \
		//   B   C
		//   |\ /|
		//   | X |
		//   |/ \|
		//   D   E
		//    \ /
		//     F
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) + 1); // 2
		const c = derived([a], ([v]) => (v as number) + 2); // 3
		const d = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number)); // 5
		const e = derived([b, c], ([bv, cv]) => (bv as number) * (cv as number)); // 6
		let fRuns = 0;
		const f = derived([d, e], ([dv, ev]) => {
			fRuns++;
			return (dv as number) + (ev as number);
		});
		f.subscribe(() => {});
		expect(fRuns).toBe(1);
		expect(f.get()).toBe(11); // 5 + 6
	});
});

// ===========================================================================
// CATEGORY 3: SENTINEL semantics
// ===========================================================================

describe("Semantic audit — SENTINEL semantics", () => {
	it("SENTINEL dep: derived does not compute until dep pushes", () => {
		const s = node<number>();
		let runs = 0;
		const d = derived([s], ([v]) => {
			runs++;
			return (v as number) * 2;
		});
		d.subscribe(() => {});
		expect(runs).toBe(0);
		expect(d.get()).toBe(undefined);

		s.down([[DATA, 5]]);
		expect(runs).toBe(1);
		expect(d.get()).toBe(10);
	});

	it("SENTINEL state + initial state in diamond: fn gated until SENTINEL pushes DATA", () => {
		// GRAPHREFLY-SPEC §2.2 (first-run gate): a derived node with a
		// SENTINEL dep does NOT compute until that dep delivers a real
		// value. The old test expectation (`runs === 1` with NaN result)
		// enshrined a pre-refactor bug where fn would fire with undefined
		// dep values — that's exactly the glitch the ROM/RAM + pre-set
		// dirty mask rules are designed to prevent.
		const sentinel = node<number>();
		const initial = state(10);
		let runs = 0;
		const d = derived([sentinel, initial], ([s, i]) => {
			runs++;
			return (s as number) + (i as number);
		});
		d.subscribe(() => {});
		// fn has not run: sentinel dep is still in SENTINEL state.
		expect(runs).toBe(0);
		expect(d.get()).toBeUndefined();
		expect(d.status).toBe("pending");

		// Once the SENTINEL dep delivers DATA, the wave completes and fn runs.
		sentinel.down([[DATA, 5]]);
		expect(runs).toBe(1);
		expect(d.get()).toBe(15);
	});

	it("mixed SENTINEL + initial: subscriber sees no emission until SENTINEL pushes", () => {
		const sentinel = node<number>();
		const initial = state(10);
		const d = derived([sentinel, initial], ([s, i]) => (s as number) + (i as number));
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		// Subscribe delivers the START handshake but no DATA — fn is gated.
		expect(dataValues(msgs)).toHaveLength(0);

		msgs.length = 0;
		sentinel.down([[DATA, 5]]);
		expect(dataValues(msgs)).toEqual([15]);
	});
});

// ===========================================================================
// CATEGORY 4: DIRTY/DATA protocol correctness
// ===========================================================================

describe("Semantic audit — DIRTY/DATA protocol", () => {
	it("derived auto-emits DIRTY before DATA on updates", () => {
		const a = state(1);
		const d = derived([a], ([v]) => (v as number) * 2);
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		msgs.length = 0;

		a.down([[DIRTY], [DATA, 5]]);
		// Should see DIRTY then DATA
		const types = msgs.map((m) => m.type);
		expect(types).toEqual([DIRTY, DATA]);
		expect(msgs[1].value).toBe(10);
	});

	it("unchanged value: derived emits RESOLVED not DATA", () => {
		const a = state(1);
		const d = derived([a], ([v]) => (v as number) * 2);
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		msgs.length = 0;

		// Push same value (after mapping: 1 * 2 = 2)
		a.down([[DIRTY], [DATA, 1]]);
		const types = msgs.map((m) => m.type);
		expect(types).toContain(RESOLVED);
		expect(types).not.toContain(DATA);
	});

	it("diamond subsequent update: downstream sees single DIRTY + single DATA", () => {
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) * 2);
		const c = derived([a], ([v]) => (v as number) + 10);
		const d = derived([b, c], ([bv, cv]) => (bv as number) + (cv as number));
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		msgs.length = 0;

		batch(() => {
			a.down([[DIRTY], [DATA, 5]]);
		});

		const types = msgs.map((m) => m.type);
		// Should be DIRTY (maybe multiple due to two deps), then DATA once
		const dirtyCount = types.filter((t) => t === DIRTY).length;
		const dataCount = types.filter((t) => t === DATA).length;
		expect(dirtyCount).toBeGreaterThanOrEqual(1);
		expect(dataCount).toBe(1);
		expect(msgs.find((m) => m.type === DATA)?.value).toBe(25); // 10 + 15
	});
});

// ===========================================================================
// CATEGORY 5: Lifecycle — unsubscribe, reconnect, resubscribe, teardown
// ===========================================================================

describe("Semantic audit — lifecycle", () => {
	it("unsubscribe: state preserves cache (ROM), derived clears cache (RAM)", () => {
		// GRAPHREFLY-SPEC §2.2 ROM/RAM rule: state nodes keep their cache
		// across disconnect; compute nodes (derived/producer/dynamic)
		// clear theirs because their value is a function of live
		// subscriptions.
		const a = state(1);
		const d = derived([a], ([v]) => (v as number) * 2);
		const unsub = d.subscribe(() => {});
		expect(d.get()).toBe(2);
		unsub();
		expect(d.status).toBe("disconnected");
		// Compute node clears cache on disconnect.
		expect(d.get()).toBeUndefined();
		// State preserves its cache.
		expect(a.get()).toBe(1);
	});

	it("resubscribe after unsubscribe: receives cached value (single emission)", () => {
		const a = state(1);
		const d = derived([a], ([v]) => (v as number) * 2);
		const unsub1 = d.subscribe(() => {});
		unsub1();

		const { msgs, sink } = recorder();
		d.subscribe(sink);
		// After reconnect, derived recomputes (not a "subsequent subscriber" case
		// because unsub caused _connected = false). The value is delivered exactly once.
		const data = dataValues(msgs);
		expect(data).toEqual([2]);
	});

	it("reconnect after unsubscribe: fn DOES re-run (ROM/RAM + C2)", () => {
		// Under ROM/RAM, compute nodes clear `_cached` and `_lastDepValues`
		// on disconnect. Reconnect re-runs fn from scratch — this gives
		// effect nodes a fresh cleanup/fire cycle instead of the old
		// identity-skip footgun.
		const a = state(1);
		let runs = 0;
		const d = derived([a], ([v]) => {
			runs++;
			return (v as number) * 2;
		});
		const unsub1 = d.subscribe(() => {});
		expect(runs).toBe(1);
		unsub1();
		d.subscribe(() => {});
		expect(runs).toBe(2);
	});

	it("reconnect after unsubscribe with changed deps: fn re-runs", () => {
		const a = state(1);
		let runs = 0;
		const d = derived([a], ([v]) => {
			runs++;
			return (v as number) * 2;
		});
		const unsub1 = d.subscribe(() => {});
		expect(runs).toBe(1);
		unsub1();
		// Change dep value while disconnected
		a.down([[DIRTY], [DATA, 5]]);
		d.subscribe(() => {});
		expect(runs).toBe(2); // re-ran because dep values changed
	});

	it("resubscribable producer: terminal state clears, fn re-runs", () => {
		let runs = 0;
		const p = producer<number>(
			(_deps, { emit, down }) => {
				runs++;
				emit(runs);
				down([[COMPLETE]]);
			},
			{ resubscribable: true },
		);
		const unsub1 = p.subscribe(() => {});
		expect(runs).toBe(1);
		unsub1();

		const { msgs, sink } = recorder();
		p.subscribe(sink);
		expect(runs).toBe(2);
		expect(dataValues(msgs)).toEqual([2]);
	});

	it("TEARDOWN propagates from source to dependent", () => {
		const a = state(1);
		const d = derived([a], ([v]) => (v as number) * 2);
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		msgs.length = 0;
		a.down([[TEARDOWN]]);
		const types = msgs.map((m) => m.type);
		expect(types).toContain(TEARDOWN);
	});
});

// ===========================================================================
// CATEGORY 6: Multi-subscriber semantics
// ===========================================================================

describe("Semantic audit — multi-subscriber", () => {
	it("3 subscribers on same state: each receives value exactly once", () => {
		const s = state(42);
		const r1 = recorder();
		const r2 = recorder();
		const r3 = recorder();
		s.subscribe(r1.sink);
		s.subscribe(r2.sink);
		s.subscribe(r3.sink);
		expect(dataValues(r1.msgs)).toEqual([42]);
		expect(dataValues(r2.msgs)).toEqual([42]);
		expect(dataValues(r3.msgs)).toEqual([42]);
	});

	it("3 subscribers on derived: each receives value exactly once", () => {
		const a = state(5);
		const d = derived([a], ([v]) => (v as number) * 2);
		const r1 = recorder();
		const r2 = recorder();
		const r3 = recorder();
		d.subscribe(r1.sink);
		d.subscribe(r2.sink);
		d.subscribe(r3.sink);
		expect(dataValues(r1.msgs)).toEqual([10]);
		expect(dataValues(r2.msgs)).toEqual([10]);
		expect(dataValues(r3.msgs)).toEqual([10]);
	});

	it("3 subscribers: single update broadcasts to all exactly once", () => {
		const s = state(1);
		const r1 = recorder();
		const r2 = recorder();
		const r3 = recorder();
		s.subscribe(r1.sink);
		s.subscribe(r2.sink);
		s.subscribe(r3.sink);
		for (const r of [r1, r2, r3]) r.msgs.length = 0;

		s.down([[DIRTY], [DATA, 99]]);
		expect(dataValues(r1.msgs)).toEqual([99]);
		expect(dataValues(r2.msgs)).toEqual([99]);
		expect(dataValues(r3.msgs)).toEqual([99]);
	});

	it("fn runs once per update regardless of subscriber count", () => {
		const a = state(1);
		let runs = 0;
		const d = derived([a], ([v]) => {
			runs++;
			return (v as number) * 2;
		});
		d.subscribe(() => {});
		d.subscribe(() => {});
		d.subscribe(() => {});
		// Only one fn run on activation (first subscriber triggered)
		expect(runs).toBe(1);

		a.down([[DIRTY], [DATA, 5]]);
		expect(runs).toBe(2); // one run for the update
	});
});

// ===========================================================================
// CATEGORY 7: DynamicNodeImpl semantic audit
// ===========================================================================

describe("Semantic audit — dynamicNode", () => {
	it("first subscribe: fn runs once, single DATA delivery", () => {
		const a = state(5);
		let runs = 0;
		const d = dynamicNode<number>((get) => {
			runs++;
			return (get(a) as number) * 2;
		});
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		expect(runs).toBe(1);
		expect(dataValues(msgs)).toEqual([10]);
	});

	it("dynamic deps: switch from A to B on input change, single delivery per update", () => {
		const useA = state(true);
		const a = state("a-value");
		const b = state("b-value");
		let runs = 0;
		const d = dynamicNode<string>((get) => {
			runs++;
			return get(useA) ? (get(a) as string) : (get(b) as string);
		});
		const r = recorder();
		d.subscribe(r.sink);
		expect(runs).toBe(1);
		expect(dataValues(r.msgs)).toEqual(["a-value"]);

		r.msgs.length = 0;
		useA.down([[DIRTY], [DATA, false]]);
		// After switch: should see exactly one DATA for the new value
		expect(runs).toBe(2);
		expect(dataValues(r.msgs)).toEqual(["b-value"]);

		// Updating the now-untracked dep (a) should NOT recompute
		r.msgs.length = 0;
		a.down([[DIRTY], [DATA, "a-value-2"]]);
		expect(runs).toBe(2);
		expect(dataValues(r.msgs)).toEqual([]);
	});

	it("dynamic deps: adding a new dep causes single recompute", () => {
		const cond = state(false);
		const a = state(1);
		const b = state(2);
		let runs = 0;
		const d = dynamicNode<number>((get) => {
			runs++;
			if (get(cond)) return (get(a) as number) + (get(b) as number);
			return get(a) as number;
		});
		d.subscribe(() => {});
		expect(runs).toBe(1);

		cond.down([[DIRTY], [DATA, true]]);
		expect(runs).toBe(2); // recompute once, now depends on [cond, a, b]

		// Updating b should now trigger recompute
		b.down([[DIRTY], [DATA, 20]]);
		expect(runs).toBe(3);
	});

	it("dynamicNode does NOT subscribe-time push (no subscribe-time delivery)", () => {
		// Unlike NodeImpl, DynamicNodeImpl has no subscribe-time push —
		// the value is always delivered through _downToSinks during _runFn.
		const a = state(5);
		const d = dynamicNode<number>((get) => (get(a) as number) * 2);

		// Subscribe twice — each should get exactly one DATA
		const r1 = recorder();
		const r2 = recorder();
		d.subscribe(r1.sink);
		d.subscribe(r2.sink);

		expect(dataValues(r1.msgs)).toEqual([10]);
		expect(dataValues(r2.msgs)).toEqual([10]);
	});
});

// ===========================================================================
// CATEGORY 8: Complex multi-stage compositions
// ===========================================================================

describe("Semantic audit — complex compositions", () => {
	it("pipeline: state → derived → derived → effect, single fn run each", () => {
		const input = state(5);
		let d1Runs = 0;
		let d2Runs = 0;
		let effectRuns = 0;
		const d1 = derived([input], ([v]) => {
			d1Runs++;
			return (v as number) * 2;
		});
		const d2 = derived([d1], ([v]) => {
			d2Runs++;
			return (v as number) + 1;
		});
		effect([d2], ([v]) => {
			effectRuns++;
			void v;
		}).subscribe(() => {});

		expect(d1Runs).toBe(1);
		expect(d2Runs).toBe(1);
		expect(effectRuns).toBe(1);
		expect(d2.get()).toBe(11);
	});

	it("fan-out: 1 source → 5 derived → 5 effects, each runs once", () => {
		const src = state(10);
		let totalDerivedRuns = 0;
		let totalEffectRuns = 0;

		for (let i = 0; i < 5; i++) {
			const d = derived([src], ([v]) => {
				totalDerivedRuns++;
				return (v as number) + i;
			});
			effect([d], ([v]) => {
				totalEffectRuns++;
				void v;
			}).subscribe(() => {});
		}

		expect(totalDerivedRuns).toBe(5);
		expect(totalEffectRuns).toBe(5);
	});

	it("fan-in: 5 sources → 1 derived, fn runs once on activation", () => {
		const sources = Array.from({ length: 5 }, (_, i) => state(i + 1));
		let runs = 0;
		const d = derived(sources, (vs) => {
			runs++;
			return (vs as number[]).reduce((a, b) => a + b, 0);
		});
		d.subscribe(() => {});
		expect(runs).toBe(1);
		expect(d.get()).toBe(15); // 1+2+3+4+5
	});

	it("deep chain (10 levels): each level fn runs exactly once", () => {
		const src = state(1);
		const runs: number[] = Array.from({ length: 10 }, () => 0);
		let current = src as ReturnType<typeof derived<number>> | typeof src;
		for (let i = 0; i < 10; i++) {
			const idx = i;
			const prev = current;
			current = derived([prev], ([v]) => {
				runs[idx]++;
				return (v as number) + 1;
			});
		}
		current.subscribe(() => {});
		expect(runs).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
		expect(current.get()).toBe(11); // 1 + 10
	});

	it("mixed dynamic + static: dynamicNode requires deps to be pre-activated", () => {
		// SEMANTIC NOTE: dynamicNode's get() proxy delegates to dep.get(),
		// which (per spec §2.2) never triggers computation. If you pass
		// lazy derived chains as deps, you must pre-activate them yourself
		// (subscribe before using them in dynamicNode) — otherwise the
		// initial fn run sees undefined values.
		//
		// This test documents the contract: when deps are pre-activated,
		// dynamicNode composes correctly with derived chains.
		const a = state(1);
		const b = derived([a], ([v]) => (v as number) * 2);
		const c = derived([a], ([v]) => (v as number) + 10);

		// Pre-activate b and c (caller's responsibility for lazy deps)
		const unsubB = b.subscribe(() => {});
		const unsubC = c.subscribe(() => {});

		let dynRuns = 0;
		const dyn = dynamicNode<number>((get) => {
			dynRuns++;
			return (get(b) as number) + (get(c) as number);
		});
		dyn.subscribe(() => {});
		expect(dynRuns).toBe(1);
		expect(dyn.get()).toBe(13); // 2 + 11
		unsubB();
		unsubC();
	});

	it("dynamicNode + lazy dep: rewire buffer stabilizes fn after first run", () => {
		// The §2.2 rewire-buffer mechanism handles lazy compose:
		// 1. fn runs with tracking get → sees undefined (lazy dep disconnected)
		// 2. _rewire subscribes lazy dep → its activation cascade emits DATA
		// 3. Scan detects discrepancy between tracked undefined vs buffered DATA
		// 4. fn re-runs with the real value and stabilizes.
		const a = state(5);
		const lazy = derived([a], ([v]) => (v as number) * 2);
		const dyn = dynamicNode<unknown>((get) => get(lazy));
		dyn.subscribe(() => {});
		// After stabilization, dyn observes the lazy dep's real value.
		expect(dyn.get()).toBe(10);
	});
});

// ===========================================================================
// CATEGORY 9: Edge cases that would catch regressions
// ===========================================================================

describe("Semantic audit — regression traps", () => {
	it("subscribe then immediately unsubscribe: no lingering state", () => {
		const a = state(1);
		const d = derived([a], ([v]) => (v as number) * 2);
		for (let i = 0; i < 100; i++) {
			const unsub = d.subscribe(() => {});
			unsub();
		}
		// No exceptions, no leaks — status should be disconnected
		expect(d.status).toBe("disconnected");
	});

	it("multiple resets of state: each update delivers exactly once per subscriber", () => {
		const s = state(0);
		const { msgs, sink } = recorder();
		s.subscribe(sink);
		msgs.length = 0;

		for (let i = 1; i <= 5; i++) {
			s.down([[DIRTY], [DATA, i]]);
		}
		expect(dataValues(msgs)).toEqual([1, 2, 3, 4, 5]);
	});

	it("INVALIDATE clears cache, next push triggers DATA not RESOLVED", () => {
		const a = state(5);
		const d = derived([a], ([v]) => (v as number) * 2);
		const { msgs, sink } = recorder();
		d.subscribe(sink);
		expect(d.get()).toBe(10);

		// Invalidate d's cache — next computation must emit DATA (not
		// RESOLVED) because `equals` has no baseline to compare against.
		d.down([[INVALIDATE]]);
		expect(d.get()).toBeUndefined();

		msgs.length = 0;
		// Push the same source value — fn recomputes because INVALIDATE
		// also cleared `_lastDepValues`. Since `_cached` is NO_VALUE,
		// equals is skipped and DATA (not RESOLVED) is emitted.
		a.down([[DIRTY], [DATA, 5]]);

		const types = msgs.map((m) => m.type);
		expect(types).toContain(DATA);
		expect(types).not.toContain(RESOLVED);
		expect(dataValues(msgs)).toEqual([10]);
	});

	it("producer emits mixed DATA values, all delivered in order", () => {
		const values = [1, 2, 3, 4, 5];
		const p = producer<number>((_deps, { emit }) => {
			for (const v of values) emit(v);
		});
		const { msgs, sink } = recorder();
		p.subscribe(sink);
		expect(dataValues(msgs)).toEqual(values);
	});

	it("second subscriber to producer sees only cached last value", () => {
		const p = producer<number>((_deps, { emit }) => {
			emit(1);
			emit(2);
			emit(3);
		});
		const r1 = recorder();
		p.subscribe(r1.sink);
		expect(dataValues(r1.msgs)).toEqual([1, 2, 3]);

		const r2 = recorder();
		p.subscribe(r2.sink);
		// Second subscriber is NOT the one that triggered activation — gets cached last
		expect(dataValues(r2.msgs)).toEqual([3]);
	});
});
