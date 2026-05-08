/**
 * Handle-core prototype tests.
 *
 * Each test maps to one or more invariants from the Phase 13.6 inventory.
 * The test names cite the inventory rule IDs so a failing test points at
 * a concrete spec section.
 */

import { describe, expect, it } from "vitest";
import { HandleRuntime } from "./bindings.js";

type Event =
	| { tag: "start" }
	| { tag: "dirty" }
	| { tag: "data"; value: unknown }
	| { tag: "resolved" };

function record() {
	const events: Event[] = [];
	const sink = (e: Event) => events.push(e);
	const dataValues = () =>
		events.filter((e): e is Event & { tag: "data" } => e.tag === "data").map((e) => e.value);
	const tags = () => events.map((e) => e.tag);
	return { events, sink, dataValues, tags };
}

describe("handle-core: identity dedup (Rule 1.3 — equals-substitution)", () => {
	it("emitting the same primitive twice yields one DATA + one RESOLVED", () => {
		const rt = new HandleRuntime();
		const s = rt.state<number>();
		const r = record();
		rt.subscribe(s, r.sink);
		s.set(42);
		s.set(42); // should be RESOLVED, not DATA — same handle
		expect(r.dataValues()).toEqual([42]);
		// Wave 1: START. Wave 2: DIRTY+DATA. Wave 3: DIRTY+RESOLVED.
		expect(r.tags()).toEqual(["start", "dirty", "data", "dirty", "resolved"]);
	});

	it("emitting the same object reference twice yields one DATA + one RESOLVED", () => {
		const rt = new HandleRuntime();
		const s = rt.state<{ x: number }>();
		const r = record();
		rt.subscribe(s, r.sink);
		const obj = { x: 1 };
		s.set(obj);
		s.set(obj);
		expect(r.dataValues()).toEqual([obj]);
		expect(r.tags().filter((t) => t === "data").length).toBe(1);
		expect(r.tags().filter((t) => t === "resolved").length).toBe(1);
	});

	it("structurally-equal but distinct objects produce TWO DATA (no deep equals by default)", () => {
		const rt = new HandleRuntime();
		const s = rt.state<{ x: number }>();
		const r = record();
		rt.subscribe(s, r.sink);
		s.set({ x: 1 });
		s.set({ x: 1 }); // distinct object reference → distinct handle → DATA
		expect(r.tags().filter((t) => t === "data").length).toBe(2);
		expect(r.tags().filter((t) => t === "resolved").length).toBe(0);
	});
});

describe("handle-core: first-run gate (Rule 2.3 / P.1)", () => {
	it("derived with two state deps does not fire until both have emitted", () => {
		const rt = new HandleRuntime();
		const a = rt.state<number>();
		const b = rt.state<number>();
		let calls = 0;
		const sum = rt.derived([a, b], (av: number, bv: number) => {
			calls++;
			return av + bv;
		});
		// subscribe — neither dep has a value, so derived should NOT fire
		const r = record();
		rt.subscribe(sum, r.sink);
		expect(calls).toBe(0);
		expect(sum.current()).toBeUndefined();
		// emit on a — gate still closed (b is sentinel)
		a.set(10);
		expect(calls).toBe(0);
		// emit on b — gate releases, fn fires
		b.set(20);
		expect(calls).toBe(1);
		expect(sum.current()).toBe(30);
	});

	it("derived with pre-initialized state deps fires on first subscribe", () => {
		const rt = new HandleRuntime();
		const a = rt.state(10);
		const b = rt.state(20);
		let calls = 0;
		const sum = rt.derived([a, b], (av: number, bv: number) => {
			calls++;
			return av + bv;
		});
		const r = record();
		rt.subscribe(sum, r.sink);
		// Both deps have cached handles → push-on-subscribe → fn fires
		expect(calls).toBe(1);
		expect(sum.current()).toBe(30);
		expect(r.dataValues()).toEqual([30]);
	});
});

describe("handle-core: diamond resolution (Spec §1.3.3)", () => {
	it("D = B + C, both depend on A; one update on A → D fires once", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const b = rt.derived([a], (av: number) => av * 2);
		const c = rt.derived([a], (av: number) => av * 3);
		let dCalls = 0;
		const d = rt.derived([b, c], (bv: number, cv: number) => {
			dCalls++;
			return bv + cv;
		});
		const r = record();
		rt.subscribe(d, r.sink);
		expect(dCalls).toBe(1); // initial activation: a=1 → b=2, c=3, d=5
		expect(d.current()).toBe(5);

		const before = dCalls;
		a.set(10);
		// One update at the root must produce ONE fire of D, not two.
		expect(dCalls - before).toBe(1);
		expect(d.current()).toBe(50); // 20 + 30
	});

	it("emitted DATA at root yields one DATA event at sink (single wave-close)", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const b = rt.derived([a], (av: number) => av + 100);
		const c = rt.derived([a], (av: number) => av + 200);
		const sum = rt.derived([b, c], (bv: number, cv: number) => bv + cv);
		const r = record();
		rt.subscribe(sum, r.sink);
		const initialDataCount = r.tags().filter((t) => t === "data").length;
		a.set(5);
		const finalDataCount = r.tags().filter((t) => t === "data").length;
		// Exactly one new DATA after the initial activation DATA.
		expect(finalDataCount - initialDataCount).toBe(1);
		expect(sum.current()).toBe(310); // (5+100) + (5+200)
	});
});

describe("handle-core: push-on-subscribe (Rule 1.2 / 2.1)", () => {
	it("late subscriber to state with cached value receives current handle as DATA", () => {
		const rt = new HandleRuntime();
		const s = rt.state(99);
		// no prior subscribers — but state was constructed with initial
		const r = record();
		rt.subscribe(s, r.sink);
		expect(r.dataValues()).toEqual([99]);
	});

	it("late subscriber to sentinel state receives only START (no DATA)", () => {
		const rt = new HandleRuntime();
		const s = rt.state<number>();
		const r = record();
		rt.subscribe(s, r.sink);
		expect(r.dataValues()).toEqual([]);
		expect(r.tags()).toEqual(["start"]);
	});
});

describe("handle-core: custom equals (FFI-only when opted in)", () => {
	it("derived with custom deep-equals dedups structurally-equal outputs", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		// derived returns a fresh object each fire; with identity equals,
		// every update propagates as DATA. With custom deep equals, equal
		// shapes dedup to RESOLVED.
		const wrapper = rt.derived([a], (av: number) => ({ value: av < 10 ? "small" : "big" }), {
			equals: (x: { value: string }, y: { value: string }) => x.value === y.value,
		});
		const r = record();
		rt.subscribe(wrapper, r.sink);
		const initialDataCount = r.tags().filter((t) => t === "data").length;
		expect(initialDataCount).toBe(1); // initial activation

		a.set(2); // still "small" — should be RESOLVED downstream
		a.set(3);
		const midDataCount = r.tags().filter((t) => t === "data").length;
		expect(midDataCount).toBe(initialDataCount); // no new DATA

		a.set(20); // crosses threshold → "big" → DATA
		const finalDataCount = r.tags().filter((t) => t === "data").length;
		expect(finalDataCount).toBe(initialDataCount + 1);
	});
});

describe("handle-core: undefined is SENTINEL (Rule M.4)", () => {
	it("emitting undefined throws — undefined is reserved as SENTINEL globally", () => {
		const rt = new HandleRuntime();
		const s = rt.state<number | null>();
		expect(() => s.set(undefined as unknown as number)).toThrow(/SENTINEL/);
	});

	it("null is a valid DATA payload", () => {
		const rt = new HandleRuntime();
		const s = rt.state<number | null>();
		const r = record();
		rt.subscribe(s, r.sink);
		s.set(null);
		expect(r.dataValues()).toEqual([null]);
	});
});

describe("handle-core: handle release / refcount (memory hygiene)", () => {
	it("replacing a state value releases the old handle", () => {
		const rt = new HandleRuntime();
		const s = rt.state(1);
		const before = rt.debug().liveHandles;
		s.set(2);
		const after = rt.debug().liveHandles;
		// Old handle for `1` should have been released; new handle for `2`
		// added. Net change: 0.
		expect(after).toBe(before);
	});
});
