/**
 * Intra-graph runtime rewire — setDeps/addDep/removeDep (R-rewire / D42 / CSP-2.5).
 *
 * Focused substrate unit tests: each Q-semantic (push-on-subscribe, gate-preserve,
 * cache-preserve, drain, reorder, idempotent, zero-deps) + each reject (self / cycle /
 * terminal-this / non-resubscribable-terminal-dep / mid-fn). The exhaustive mid-wave
 * interleavings are covered by the TLA+ model (~/src/graphrefly/formal/wave_rewire.tla).
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { type Node, node } from "../index.js";

function collect(n: Node) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const num = (ctx: Ctx, i: number): number => ctx.depRecords[i].latest as number;

describe("rewire — Q-semantics (R-rewire / D42)", () => {
	it("addDep wires a cached dep via push-on-subscribe and recomputes", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 100 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		expect(d.cache).toBe(1);

		d.addDep(b, (ctx) => ctx.down([["DATA", num(ctx, 0) + num(ctx, 1)]]));
		expect(d.cache).toBe(101); // 1 + 100 — b's cached DATA pushed on subscribe (R-push-subscribe)
	});

	it("addDep of a never-emitted (SENTINEL) dep does not re-arm the first-run gate (Q2)", () => {
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

		d.addDep(b, (ctx) => {
			runs++;
			const bv = ctx.depRecords[1].latest; // SENTINEL = undefined — fn guards it
			ctx.down([["DATA", num(ctx, 0) * 10 + (bv === undefined ? 0 : (bv as number))]]);
		});
		expect(runs).toBe(0); // a SENTINEL added dep delivers START only — no recompute

		a.down([["DATA", 2]]); // gate NOT re-armed: a alone re-drives d without waiting for b
		expect(runs).toBe(1);
		expect(d.cache).toBe(20); // 2*10 + 0 (b still SENTINEL)
	});

	it("removeDep drains the removed dep + preserves cache (Q3/Q7)", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 2 });
		const sumAB = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0) + num(ctx, 1)]]);
		const aOnly = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0)]]);
		const d = node<number>([a, b], sumAB);
		collect(d);
		expect(d.cache).toBe(3);

		d.removeDep(b, aOnly);
		expect(d.cache).toBe(3); // cache preserved — removeDep of a non-dirty dep does not recompute

		b.down([["DATA", 99]]); // removed dep must NOT drive d (drained)
		expect(d.cache).toBe(3);

		a.down([["DATA", 5]]); // d recomputes with the swapped (a-only) fn
		expect(d.cache).toBe(5);
	});

	it("removeDep to zero deps → inert fn-no-deps, cache preserved (D42 SD-3)", () => {
		const a = node<number>([], null, { initial: 7 });
		let runs = 0;
		const d = node<number>([a], (ctx) => {
			runs++;
			ctx.down([["DATA", num(ctx, 0)]]);
		});
		collect(d);
		expect(d.cache).toBe(7);
		runs = 0;

		d.removeDep(a, (ctx) => {
			runs++;
			ctx.down([["DATA", -1]]);
		});
		expect(d.cache).toBe(7); // preserved
		expect(runs).toBe(0); // inert — does not fire

		a.down([["DATA", 8]]); // a is no longer a dep
		expect(d.cache).toBe(7);
		expect(runs).toBe(0);
	});

	it("setDeps reorders kept deps without losing their state (Option-C, DepRecord-ref dispatch)", () => {
		const a = node<number>([], null, { initial: 10 });
		const b = node<number>([], null, { initial: 20 });
		const f = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0) * 100 + num(ctx, 1)]]);
		const d = node<number>([a, b], f);
		collect(d);
		expect(d.cache).toBe(1020); // dep0=a=10, dep1=b=20 → 1020

		d.setDeps([b, a], f); // reorder; kept-dep state (a=10, b=20) preserved
		a.down([["DATA", 11]]); // a is now dep1; reroutes correctly
		expect(d.cache).toBe(2011); // dep0=b=20, dep1=a=11 → 20*100+11
	});

	it("setDeps to the current dep set is idempotent — no spurious recompute", () => {
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

		d.setDeps([a], f);
		expect(runs).toBe(0);
		expect(d.cache).toBe(1);
	});

	it("addDep returns the new dep index", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 2 });
		const f = (ctx: Ctx) => ctx.down([["DATA", num(ctx, 0)]]);
		const d = node<number>([a], f);
		collect(d);
		expect(d.addDep(b, f)).toBe(1);
		expect(d.addDep(b, f)).toBe(1); // already present → still index 1 (fn swap only)
	});
});

describe("rewire — rejects (R-rewire / D42)", () => {
	it("rejects a self-dependency", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		expect(() => d.setDeps([d as Node<unknown>], (ctx) => ctx.down([["DATA", 0]]))).toThrow(
			/self-dependency/,
		);
	});

	it("rejects a cycle", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		const e = node<number>([d], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(e); // e depends on d (→ a)
		// adding e as a dep of d would close d→e→d
		expect(() => d.addDep(e, (ctx) => ctx.down([["DATA", num(ctx, 0)]]))).toThrow(/cycle/);
	});

	it("rejects rewire on a terminal node", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]), {
			completeWhenDepsComplete: false,
		});
		collect(d);
		d.down([["COMPLETE"]]); // d terminal
		expect(() => d.setDeps([a], (ctx) => ctx.down([["DATA", 0]]))).toThrow(/terminal/);
	});

	it("rejects adding a non-resubscribable terminal dep", () => {
		const term = node<number>([], (ctx) => ctx.down([["COMPLETE"]])); // producer → terminal on activation
		collect(term);
		expect(term.status).toBe("completed");

		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx) => ctx.down([["DATA", num(ctx, 0)]]));
		collect(d);
		expect(() => d.addDep(term, (ctx) => ctx.down([["DATA", num(ctx, 0)]]))).toThrow(
			/terminal dep/,
		);
	});

	it("rejects mid-fn rewire (a fn mutating its own deps mid-wave = D37 feedback cycle)", () => {
		const a = node<number>([], null, { initial: 1 });
		const x = node<number>([], null, { initial: 9 });
		let dh: Node<number> | undefined;
		dh = node<number>([a], (ctx) => {
			dh?.addDep(x, (c) => c.down([["DATA", num(c, 0)]]));
			ctx.down([["DATA", num(ctx, 0)]]);
		});
		expect(() => collect(dh as Node)).toThrow(/mid-fn|feedback/);
	});
});
