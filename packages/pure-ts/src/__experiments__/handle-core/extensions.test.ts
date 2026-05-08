/**
 * Tests for the prototype extensions added in the second pass:
 *
 *   - FFI cost counters (invokeFn / customEquals / releaseHandle)
 *   - Dynamic node analogue (selective deps via `tracked()`)
 *   - Refcount snapshot for leak detection
 *
 * These directly answer brainstorm questions:
 *   "Does identity-equals stay zero-FFI on the equality path?"
 *   "How many FFI crossings does a typical wave actually require?"
 *   "Does selective-deps in dynamic nodes save fires?"
 */

import { describe, expect, it } from "vitest";
import { HandleRuntime, tracked } from "./bindings.js";

describe("FFI cost counters — boundary crossing accounting", () => {
	it("identity-equals graph crosses customEquals ZERO times", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const b = rt.state(2);
		const sum = rt.derived([a, b], (av: number, bv: number) => av + bv);
		const events: number[] = [];
		rt.subscribe(sum, (e) => {
			if (e.tag === "data") events.push(e.value);
		});
		a.set(10);
		b.set(20);
		a.set(10); // identity hit — RESOLVED
		const ffi = rt.ffiCounters();
		expect(ffi.customEquals).toBe(0); // identity-equals never crosses
		expect(ffi.invokeFn).toBeGreaterThan(0);
	});

	it("custom-equals graph crosses customEquals exactly once per non-identity emit", () => {
		const rt = new HandleRuntime();
		const src = rt.state(1);
		const wrap = rt.derived([src], (v: number) => ({ kind: v < 10 ? "small" : "big" }), {
			equals: (x: { kind: string }, y: { kind: string }) => x.kind === y.kind,
		});
		rt.subscribe(wrap, () => {});
		rt.resetCounters();
		src.set(2); // produces fresh object → customEquals called once
		src.set(3);
		src.set(4);
		const ffi = rt.ffiCounters();
		// Exactly one customEquals call per fresh object emission.
		expect(ffi.customEquals).toBe(3);
	});

	it("invokeFn count = number of fn fires (one per fire, never more)", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const b = rt.state(2);
		const sum = rt.derived([a, b], (av: number, bv: number) => av + bv);
		const product = rt.derived([a, b], (av: number, bv: number) => av * bv);
		// Subscribe both — each derived fires once on activation
		rt.subscribe(sum, () => {});
		rt.subscribe(product, () => {});
		const baseline = rt.ffiCounters().invokeFn;
		expect(baseline).toBeGreaterThan(0);
		rt.resetCounters();
		// Update root once — both derived should fire exactly once
		a.set(10);
		const ffi = rt.ffiCounters();
		expect(ffi.invokeFn).toBe(2); // sum + product, one fire each
	});

	it("releaseHandle count tracks cache replacements", () => {
		const rt = new HandleRuntime();
		const s = rt.state(1);
		rt.subscribe(s, () => {});
		rt.resetCounters();
		s.set(2);
		s.set(3);
		s.set(4);
		// Each set replaces the cached handle → 3 releases of the prior cache.
		expect(rt.ffiCounters().releaseHandle).toBe(3);
	});
});

describe("Dynamic node — selective deps via tracked()", () => {
	it("untracked dep updates do not fire fn", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const b = rt.state(100);
		let fnCalls = 0;
		// fn reads only a; declares only dep 0 as tracked.
		const sel = rt.dynamic([a, b], (av: number, _bv: number) => {
			fnCalls++;
			return tracked(av * 2, [0]);
		});
		rt.subscribe(sel, () => {});
		expect(fnCalls).toBe(1); // initial activation
		const baseline = fnCalls;
		// Update untracked dep b — fn must NOT fire
		b.set(200);
		expect(fnCalls).toBe(baseline);
		// Update tracked dep a — fn fires
		a.set(5);
		expect(fnCalls).toBe(baseline + 1);
		expect(sel.current()).toBe(10);
	});

	it("dynamic node sees fewer FFI invokeFn calls than equivalent static derived", () => {
		// Same topology, two implementations. Update an unused dep N times.
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const unused = rt.state(0);
		const staticDerived = rt.derived([a, unused], (av: number, _u: number) => av + 1);
		const dynamicSelective = rt.dynamic([a, unused], (av: number, _u: number) =>
			tracked(av + 1, [0]),
		);
		rt.subscribe(staticDerived, () => {});
		rt.subscribe(dynamicSelective, () => {});
		rt.resetCounters();
		// Update unused 5 times — static fires 5 times (then equals dedups
		// downstream), dynamic fires 0 times.
		for (let i = 1; i <= 5; i++) unused.set(i);
		const ffi = rt.ffiCounters();
		// Static derived was hit 5 times; dynamic was hit 0 times.
		// Total invokeFn should equal 5 (only the static one fires).
		expect(ffi.invokeFn).toBe(5);
	});

	it("dynamic node reading all deps behaves like static derived", () => {
		const rt = new HandleRuntime();
		const a = rt.state(1);
		const b = rt.state(2);
		const sum = rt.dynamic([a, b], (av: number, bv: number) => tracked(av + bv, [0, 1]));
		rt.subscribe(sum, () => {});
		expect(sum.current()).toBe(3);
		a.set(10);
		expect(sum.current()).toBe(12);
		b.set(20);
		expect(sum.current()).toBe(30);
	});
});

describe("Refcount / leak detection", () => {
	it("steady-state graph has bounded handle count", () => {
		const rt = new HandleRuntime();
		const a = rt.state(0);
		const dbl = rt.derived([a], (v: number) => v * 2);
		rt.subscribe(dbl, () => {});
		const baseline = rt.debug().liveHandles;
		// Run many updates — handle count should stay bounded.
		for (let i = 1; i <= 20; i++) a.set(i);
		const after = rt.debug().liveHandles;
		// We expect ~2 live handles steady state: a's current cache + dbl's
		// current cache. The exact number depends on intern timing but should
		// be far less than 20.
		expect(after).toBeLessThan(5);
		expect(after).toBeGreaterThanOrEqual(baseline);
	});

	it("refcount snapshot reports refcounts per handle", () => {
		const rt = new HandleRuntime();
		const a = rt.state({ x: 1 });
		const b = rt.state({ x: 1 }); // distinct object → distinct handle
		rt.subscribe(a, () => {});
		rt.subscribe(b, () => {});
		const snap = rt.debug().snapshot;
		expect(snap.handles).toBeGreaterThanOrEqual(2);
		// Refcount entries exist for each live handle.
		for (const [, count] of snap.refcounts) {
			expect(count).toBeGreaterThan(0);
		}
	});
});
