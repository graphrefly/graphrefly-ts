/**
 * Intra-graph runtime rewire — replaceDeps/subscribeDep/unsubscribeDep (R-rewire / D42 / CSP-2.5).
 *
 * Focused substrate unit tests: each Q-semantic (push-on-subscribe, gate-preserve,
 * cache-preserve, drain, reorder, idempotent, zero-deps) + each reject (self / cycle /
 * terminal-this / non-resubscribable-terminal-dep / mid-fn). The exhaustive mid-wave
 * interleavings are covered by the TLA+ model (~/src/graphrefly/formal/wave_rewire.tla).
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { Dispatcher, depLatest, type Node, node } from "../index.js";

function collect(n: Node) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const num = (ctx: Ctx, i: number): number => depLatest(ctx, i) as number;
const types = (m: Message[]) => m.map((x) => x[0]);

describe("rewire — Q-semantics (R-rewire / D42)", () => {
	it("subscribeDep wires a cached dep via push-on-subscribe and recomputes", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 100 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		expect(d.cache).toBe(1);

		d.subscribeDep(b, (ctx) => ctx.down([["DATA", num(ctx, 0) + num(ctx, 1)]]));
		expect(d.cache).toBe(101); // 1 + 100 — b's cached DATA pushed on subscribe (R-push-subscribe)
	});

	it("subscribeDep of a never-emitted (SENTINEL) dep does not re-arm the first-run gate (Q2)", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null); // no initial → SENTINEL, never emits
		let runs = 0;
		const d = node<number>([a], (ctx) => {
			runs++;
			ctx.down([["DATA", num(ctx, 0) * 10]]);
		});
		collect(d);
		expect(d.cache).toBe(10);
		runs = 0;

		d.subscribeDep(b, (ctx) => {
			runs++;
			const bv = depLatest(ctx, 1); // SENTINEL = undefined — fn guards it
			ctx.down([["DATA", num(ctx, 0) * 10 + (bv === undefined ? 0 : (bv as number))]]);
		});
		expect(runs).toBe(0); // a SENTINEL added dep delivers START only — no recompute

		a.down([["DATA", 2]]); // gate NOT re-armed: a alone re-drives d without waiting for b
		expect(runs).toBe(1);
		expect(d.cache).toBe(20); // 2*10 + 0 (b still SENTINEL)
	});

	it("unsubscribeDep drains the removed dep + preserves cache (Q3/Q7)", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 2 });
		const sumAB = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0) + num(ctx, 1)]]);
		const aOnly = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0)]]);
		const d = node<number>([a, b], sumAB);
		collect(d);
		expect(d.cache).toBe(3);

		d.unsubscribeDep(b, aOnly);
		expect(d.cache).toBe(3); // cache preserved — unsubscribeDep of a non-dirty dep does not recompute

		b.down([["DATA", 99]]); // removed dep must NOT drive d (drained)
		expect(d.cache).toBe(3);

		a.down([["DATA", 5]]); // d recomputes with the swapped (a-only) fn
		expect(d.cache).toBe(5);
	});

	it("unsubscribeDep to zero deps → inert fn-no-deps, cache preserved (D42 SD-3)", () => {
		const a = node<number>([], null, { initial: 7 });
		let runs = 0;
		const d = node<number>([a], (ctx) => {
			runs++;
			ctx.down([["DATA", num(ctx, 0)]]);
		});
		collect(d);
		expect(d.cache).toBe(7);
		runs = 0;

		d.unsubscribeDep(a, (ctx) => {
			runs++;
			ctx.down([["DATA", -1]]);
		});
		expect(d.cache).toBe(7); // preserved
		expect(runs).toBe(0); // inert — does not fire

		a.down([["DATA", 8]]); // a is no longer a dep
		expect(d.cache).toBe(7);
		expect(runs).toBe(0);
	});

	it("replaceDeps reorders kept deps without losing their state (Option-C, DepRecord-ref dispatch)", () => {
		const a = node<number>([], null, { initial: 10 });
		const b = node<number>([], null, { initial: 20 });
		const f = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0) * 100 + num(ctx, 1)]]);
		const d = node<number>([a, b], f);
		collect(d);
		expect(d.cache).toBe(1020); // dep0=a=10, dep1=b=20 → 1020

		d.replaceDeps([b, a], f); // reorder; kept-dep state (a=10, b=20) preserved
		a.down([["DATA", 11]]); // a is now dep1; reroutes correctly
		expect(d.cache).toBe(2011); // dep0=b=20, dep1=a=11 → 20*100+11
	});

	it("replaceDeps to the current dep set is idempotent — no spurious recompute", () => {
		const a = node<number>([], null, { initial: 1 });
		let runs = 0;
		const f = (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", num(ctx, 0)]]);
		};
		const d = node<number>([a], f);
		collect(d);
		expect(d.cache).toBe(1);
		runs = 0;

		d.replaceDeps([a], f);
		expect(runs).toBe(0);
		expect(d.cache).toBe(1);
	});

	it("subscribeDep returns the new dep index", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 2 });
		const f = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0)]]);
		const d = node<number>([a], f);
		collect(d);
		expect(d.subscribeDep(b, f)).toBe(1);
		expect(d.subscribeDep(b, f)).toBe(1); // already present → still index 1 (fn swap only)
	});
});

describe("rewire — rejects (R-rewire / D42)", () => {
	it("rejects a self-dependency", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		expect(() => d.replaceDeps([d as Node<unknown>], (ctx) => ctx.down([["DATA", 0]]))).toThrow(
			/self-dependency/,
		);
	});

	it("rejects a cycle", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		const e = node<number>([d], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(e); // e depends on d (→ a)
		// adding e as a dep of d would close d→e→d
		expect(() => d.subscribeDep(e, (ctx) => ctx.down([["DATA", num(ctx, 0)]]))).toThrow(/cycle/);
	});

	it("rejects rewire on a terminal node", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]), {
			completeWhenDepsComplete: false,
		});
		collect(d);
		d.down([["COMPLETE"]]); // d terminal
		expect(() => d.replaceDeps([a], (ctx) => ctx.down([["DATA", 0]]))).toThrow(/terminal/);
	});

	it("rejects adding a non-resubscribable terminal dep", () => {
		const term = node<number>([], (ctx) => ctx.down([["COMPLETE"]])); // producer → terminal on activation
		collect(term);
		expect(term.status).toBe("completed");

		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		expect(() => d.subscribeDep(term, (ctx) => ctx.down([["DATA", num(ctx, 0)]]))).toThrow(
			/terminal dep/,
		);
	});

	it("rejects mid-fn rewire (a fn mutating its own deps mid-wave = D37 feedback cycle)", () => {
		const a = node<number>([], null, { initial: 1 });
		const x = node<number>([], null, { initial: 9 });
		let dh: Node<number> | undefined;
		dh = node<number>([a], (ctx) => {
			dh?.subscribeDep(x, (c) => c.down([["DATA", num(c, 0)]]));
			ctx.down([["DATA", num(ctx, 0)]]);
		});
		expect(() => collect(dh as Node)).toThrow(/mid-fn|feedback/);
	});
});

describe("rewire — QA fixes (atomic settle, DIRTY-before-DATA, pause/batch-safe)", () => {
	it("replaceDeps adding ≥2 cached deps settles ATOMICALLY — fn fires once, never on a partial view (P2)", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 10 });
		const c = node<number>([], null, { initial: 100 });
		let runs = 0;
		const sawPartial: boolean[] = [];
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		runs = 0;

		const sum3 = (ctx: Ctx) => {
			runs++;
			// a SENTINEL added dep at invocation = the fn fired on a partial view (the bug)
			sawPartial.push(depLatest(ctx, 1) === undefined || depLatest(ctx, 2) === undefined);
			ctx.down([["DATA", num(ctx, 0) + num(ctx, 1) + num(ctx, 2)]]);
		};
		d.replaceDeps([a, b, c], sum3); // add b AND c (both cached) in one rewire
		expect(runs).toBe(1); // ONE atomic settle, not one fire per added dep
		expect(sawPartial).toEqual([false]); // never fired with an added dep still SENTINEL
		expect(d.cache).toBe(111); // 1 + 10 + 100
	});

	it("a rewire-triggered settle emits DIRTY before DATA downstream (D1 / R-dirty-before-data)", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 100 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		const { msgs } = collect(d);
		msgs.length = 0; // isolate the rewire wave

		d.subscribeDep(b, (ctx) => ctx.down([["DATA", num(ctx, 0) + num(ctx, 1)]]));
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // two-phase, glitch-free
		expect(msgs.at(-1)).toEqual(["DATA", 101]);
	});

	it("unsubscribeDep of the sole dirty dep to zero deps un-dirties downstream via RESOLVED (Q6 / P1)", () => {
		let cctx: Ctx | null = null;
		const a = node<number>([], null, { initial: 1 });
		const c = node<number>(
			[a],
			(ctx: Ctx) => {
				cctx = ctx; // async leg: defer the emit
			},
			{ pool: "async" },
		);
		const d = node<number>([c], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		const { msgs } = collect(d);
		(cctx as Ctx).down([["DATA", 5]]); // c settles once → d caches 5
		expect(d.cache).toBe(5);

		msgs.length = 0;
		a.down([["DATA", 2]]); // a→c DIRTY/DATA; c (async) defers → c emits DIRTY to d → d dirty
		expect(d.status).toBe("dirty");
		expect(types(msgs)).toContain("DIRTY");

		msgs.length = 0;
		d.unsubscribeDep(c, (ctx) => ctx.down([["DATA", num(ctx, 0)]])); // remove sole dirty dep → zero deps
		expect(types(msgs)).toEqual(["RESOLVED"]); // un-dirtied downstream (not a stray DATA)
		expect(d.cache).toBe(5); // cache preserved (Q7), no recompute
	});

	it("B15: a rewire fn-swap frees the old dispatcher handle (registry stays bounded)", () => {
		// Each replaceDeps/subscribeDep/unsubscribeDep re-registers the fn → a new handle. Before B15 the old
		// handle leaked (the pool fn-table grew by one per swap), unbounded for a rewire-heavy
		// graph (CSP-2.7 *Map). Now _rewire unregisters the old handle, so the table is bounded
		// to peak-live size and freed ids are reused. Observed via a probe registration on a
		// dedicated dispatcher: after N swaps a fresh register reuses a freed slot (small id),
		// not ~N (the leak). Mutation-verified: disabling the unregister in _rewire fails this.
		const disp = new Dispatcher();
		const a = node<number>([], null, { initial: 1, dispatcher: disp });
		const id = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0)]]);
		const d = node<number>([a], id, { dispatcher: disp });
		collect(d);

		const N = 50;
		for (let i = 0; i < N; i++) {
			// idempotent dep-set, but SD-1 still swaps the fn each call → register + free old.
			d.replaceDeps([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		}
		expect(d.cache).toBe(1); // still correct after 50 swaps

		// A fresh registration reuses a freed slot → bounded handleId, NOT ~N (the leak).
		const probe = disp.register(() => {}, "sync");
		expect(probe.handleId).toBeLessThanOrEqual(2);
	});
});
