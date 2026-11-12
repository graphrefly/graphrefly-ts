/**
 * Behavioral conformance — TS arm of ~/src/graphrefly/spec/conformance.jsonl (D24).
 *
 * Each test is the TS adapter for a language-agnostic scenario: it builds the scenario's
 * topology, drives its input wave sequence, and asserts the expected OBSERVABLE wave output.
 *
 * C-1 (cross-graph diamond) is NOT here — it requires the wire bridge (backlog B2). The
 * in-process diamond core it leans on is green in core.test.ts (R-diamond/R-two-phase).
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { distinctUntilChanged, filter, fromIter, graph, take } from "../index.js";
import type { Subscribable } from "./helpers/collect.js";
import { addOwnedNodeDep, removeOwnedNodeDep, rewireOwnedNode } from "./helpers/owned-rewire.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const _flush = () => new Promise((r) => setTimeout(r, 0));
function collect(n: Subscribable) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}

describe("C-3 INVALIDATE × ctx.state, manual INVALIDATE policy (R-invalidation)", () => {
	it("cascades once, runs the function under the manual policy, preserves ctx.state, resets dep cached latest", () => {
		const g = graph();
		const statesAtRun: unknown[] = [];
		let onInv = 0;
		const s = g.node<number>([], null, { initial: 1 });
		const d = g.node<number>(
			[s],
			(ctx: Ctx) => {
				if (ctx.deps[0].invalidated) {
					onInv++;
					ctx.down([["INVALIDATE"]]);
					return;
				}
				statesAtRun.push(ctx.state.get()); // prior state visible at run time
				ctx.state.set("kept");
				ctx.down([["DATA", (ctx.deps[0].value as number) * 2]]);
			},
			{ invalidate: "manual" },
		);
		const { msgs } = collect(d);
		expect(d.cache).toBe(2);
		expect(statesAtRun).toEqual([undefined]); // first run: fresh state

		msgs.length = 0;
		s.invalidate();
		expect(types(msgs)).toEqual(["PENDING", "INVALIDATE"]); // cascaded downstream exactly once
		expect(onInv).toBe(1);
		expect(d.cache).toBeUndefined();
		expect(d.status.cache).toBe("empty");

		// idempotent: a second INVALIDATE on an already-reset upstream is a no-op
		msgs.length = 0;
		s.invalidate();
		expect(msgs).toEqual([]);
		expect(onInv).toBe(1);

		// ctx.state preserved across INVALIDATE (lifecycle-continue, NOT fresh-lifecycle)
		s.set(5);
		expect(statesAtRun).toEqual([undefined, "kept"]);
		expect(d.cache).toBe(10);
	});
});

describe("C-4 a sync leg and an async leg: the async result is a later wave, nothing waits across it (R-wave, R-invocation)", () => {
	it("settles the async leg with the kernel's RESOLVED in A's wave; its result is a later wave", () => {
		const g = graph();
		let dRuns = 0;
		let cctx = null as Ctx | null;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.deps[0].value as number) + 10]]),
		); // sync leg
		const cOut: Message[] = [];
		const c = g.node<number>(
			[a],
			(ctx: Ctx) => {
				cctx = ctx; // async leg: the result comes later through this ctx
			},
			{ pool: "async" },
		);
		c.subscribe((incoming) => {
			for (const m of incoming) {
				cOut.push(m);
			}
		});
		// C-4: waiting for both legs is sugar (a gate), not kernel behaviour; derived holds it
		// (graphrefly-ts:D184), so its function first runs once c has a value.
		const d = g.derived([b, c], (bv, cv) => {
			dRuns++;
			return (bv as number) + (cv as number);
		});

		const { msgs } = collect(d);
		expect(dRuns).toBe(0);
		(cctx as Ctx).down([["DATA", 21]]);
		expect(dRuns).toBe(1);
		expect(d.cache).toBe(32); // 11 + 21

		msgs.length = 0;
		cOut.length = 0;
		a.set(2);
		// In A's wave c sent nothing, so the kernel settled it; d ran once on b's new value and
		// c's old one, and no PENDING stays open while c's work runs.
		expect(types(cOut)).toEqual(["PENDING", "RESOLVED"]);
		expect(dRuns).toBe(2);
		expect(d.cache).toBe(33); // 12 + 21
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(d.status.cache).not.toBe("stale");

		// c's result is a new wave from c, in which d runs once more.
		msgs.length = 0;
		(cctx as Ctx).down([["DATA", 30]]);
		expect(dRuns).toBe(3);
		expect(d.cache).toBe(42); // 12 + 30
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
	});
});

describe("C-6 a function's write to its own upstream is a later request", () => {
	it("reaches the function in a later wave; nothing is reentered and the loop ends", () => {
		const g = graph();
		const s = g.state(0);
		const d = g.derived([s], (n) => (n as number) + 1);
		const runs: number[] = [];
		const e = g.effect([d], (n) => {
			runs.push(n as number);
			if ((n as number) < 3) s.set(n as number);
		});
		expect(() => e.subscribe(() => {})).not.toThrow();
		expect(runs).toEqual([1, 2, 3]);
		expect(d.cache).toBe(3);
	});
});

describe("C-8 intra-graph runtime rewire (R-rewire / D42)", () => {
	it("surgical subscribeDep (push-on-subscribe) → unsubscribeDep (drain) → idempotent replaceDeps; cache preserved", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null, { initial: 100 }); // B carries cached DATA
		const aOnly = (ctx: Ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]);
		const sum = (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.deps[0].value as number) + (ctx.deps[1].value as number)]]);
		const d = g.node<number>([a], aOnly);
		collect(d);
		expect(d.cache).toBe(1); // (1) A settled → D ran

		addOwnedNodeDep(d, b, sum); // (2) subscribeDep(B): B cached → push-on-subscribe → D recomputes
		expect(d.cache).toBe(101); // 1 + 100

		b.set(50); // (3) B drives D
		expect(d.cache).toBe(51); // 1 + 50

		removeOwnedNodeDep(d, a, aOnly); // (4) unsubscribeDep(A) → deps = [B]
		expect(d.cache).toBe(51); // cache PRESERVED (A was not dirty — no recompute)

		a.set(9); // (5) A no longer drives D — its edge is drained
		expect(d.cache).toBe(51);

		b.set(7); // B is dep0 now → drives D
		expect(d.cache).toBe(7);

		let runs = 0;
		const f = (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", ctx.deps[0].value as number]]);
		};
		rewireOwnedNode(d, [b], f); // (6) replaceDeps to the current set → idempotent
		expect(runs).toBe(0); // no spurious recompute
		expect(d.cache).toBe(7);
	});

	it("rejects rewire on a terminal node (throw → graph-layer ERROR, D30)", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		// D forwards A's value and completes on the value 2.
		const id = (ctx: Ctx) => {
			const v = ctx.deps[0].value as number;
			ctx.down(v === 2 ? [["COMPLETE"]] : [["DATA", v]]);
		};
		const d = g.node<number>([a], id, { complete: "manual" });
		collect(d);
		a.set(2); // D terminal
		expect(d.status.output).toBe("completed");
		expect(() => rewireOwnedNode(d, [a], id)).toThrow(/terminal/);
	});
});

// C-12 (D49 / R-resolved-undirty, supersedes D15/R-equals): every value-occurrence is DATA
// (no auto-equals-substitution); RESOLVED is the substrate-SYNTHESIZED undirty-only signal;
// dedup is opt-in at the operator layer. Folds the former _probe.test.ts probes (the
// fromIter([1,1,1]) / take(3) / state.set-same cases that surfaced D49).
describe("C-12 occurrences stay DATA; RESOLVED is undirty-only (R-resolved-undirty / D49)", () => {
	it("(a) a repeated value is N distinct DATA occurrences, never collapsed to RESOLVED", () => {
		const g = graph();
		const src = g.initNode(fromIter<number>([1, 1, 1]), []);
		const { msgs } = collect(src);
		// Each source array carries the kernel's PENDING first (R-wave).
		expect(types(msgs).filter((t) => t !== "PENDING")).toEqual([
			"START",
			"DATA",
			"DATA",
			"DATA",
			"COMPLETE",
		]);
		expect(data(msgs)).toEqual([1, 1, 1]); // not [1] — the pre-D49 equals-absorption bug
	});

	it("(b) take(3) counts occurrences, not distinct values → [1,1,1]", () => {
		const g = graph();
		const src = g.initNode(fromIter<number>([1, 1, 1]), []);
		const t = g.initNode(take<number>(3), [src]);
		const { msgs } = collect(t);
		expect(data(msgs)).toEqual([1, 1, 1]);
		expect(t.status.output).toBe("completed");
	});

	it("(c) filter-reject: the substrate synthesizes one undirty RESOLVED — no DATA, no wedge", () => {
		const g = graph();
		const s = g.state(50);
		const f = g.initNode(
			filter((n: number) => n >= 100),
			[s],
		);
		const { msgs } = collect(f);
		// activation: 50 rejected, f never produced — no PENDING on activation, no synth
		expect(f.status.cache).toBe("empty");
		expect(f.cache).toBeUndefined();
		msgs.length = 0;

		s.set(60); // rejected: PENDING'd but no value → substrate-synthesized undirty RESOLVED
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]); // un-dirtied, no DATA, not wedged
		expect(f.status.cache).toBe("empty"); // never valued
		msgs.length = 0;

		s.set(150); // accepted → real DATA occurrence
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(f.cache).toBe(150);
		msgs.length = 0;

		s.set(70); // rejected, but f now carries 150 → undirty RESOLVED, status resolved
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]);
		expect(f.status.cache).toBe("ready");
		expect(f.cache).toBe(150); // cache preserved across the undirty wave
	});

	it("(c') a downstream recompute un-dirties as DATA (occurrence), never wedges", () => {
		const g = graph();
		const s = g.state(100); // accepted by the filter
		const f = g.initNode(
			filter((n: number) => n >= 100),
			[s],
		);
		const d = g.derived([f], (v) => v! * 2);
		const { msgs } = collect(d);
		expect(d.cache).toBe(200); // f=100 → d=200
		msgs.length = 0;

		s.set(50); // rejected by f → f synthesizes RESOLVED → d clears + recomputes f's cached 100
		expect(types(msgs)).toEqual(["PENDING", "DATA"]); // d un-dirtied via a (same-value) DATA, no wedge
		expect(d.cache).toBe(200);
	});

	it("(d) distinctUntilChanged is the OPT-IN dedup (operator's job, not substrate)", () => {
		const g = graph();
		const s = g.state(1);
		const duc = g.initNode(distinctUntilChanged<number>(), [s]);
		const { msgs } = collect(duc);
		s.set(1); // dup → operator returns without emitting → substrate synthesizes RESOLVED
		s.set(2);
		s.set(2); // dup → suppressed
		s.set(3);
		expect(data(msgs)).toEqual([1, 2, 3]);
	});

	it("a state node re-set to the same value emits DATA, not RESOLVED (no substrate equals)", () => {
		const g = graph();
		const s = g.state(1);
		const { msgs } = collect(s);
		msgs.length = 0;
		s.set(1); // same value
		expect(types(msgs)).toEqual(["PENDING", "DATA"]); // occurrence, NOT equals-absorbed
		expect(s.cache).toBe(1);
		msgs.length = 0;
		s.set(2);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
	});

	it("RESOLVED is the kernel's alone: output carrying it is rejected (R-wave@2, D799)", () => {
		const g = graph();
		const t = g.node<number>([], null, { initial: 0 });
		let rejected: unknown;
		const s = g.node<number>([t], (ctx) => {
			if ((ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat())?.[0] !== 1)
				return ctx.down([["DATA", 1]]);
			try {
				ctx.down([["DATA", 2], ["RESOLVED"]]);
			} catch (error) {
				rejected = error;
			}
		});
		collect(s);
		t.set(1);
		expect(String(rejected)).toMatch(/kernel/);
		expect(s.cache).toBe(1);
	});
});
