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
import { graph, node } from "../index.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

describe("C-2 async-result arriving at paused node (R-async-paused, R-pause-lockset)", () => {
	it("buffers the async result while paused, replays it on final-lock RESUME", () => {
		let cctx: Ctx | null = null;
		const trigger = node<number>([], null, { initial: 0 });
		// async-pool node: the fn stashes its ctx and resolves later (simulated async).
		const n = node<number>(
			[trigger],
			(ctx: Ctx) => {
				cctx = ctx;
			},
			{ pool: "async" },
		);
		const { msgs } = collect(n);
		expect(cctx).not.toBeNull(); // fn ran on activation, no emit yet

		const L = Symbol("pause");
		n.up([["PAUSE", L]]);

		msgs.length = 0;
		// async result resolves WHILE paused -> buffered, not delivered (DR-3).
		(cctx as Ctx).down([["DATA", 42]]);
		expect(msgs).toEqual([]);
		expect(n.cache).toBeUndefined();

		n.up([["RESUME", L]]); // final-lock RESUME -> replay the buffered settle slice
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(msgs.at(-1)).toEqual(["DATA", 42]);
		expect(n.cache).toBe(42);
	});
});

describe("C-3 INVALIDATE × ctx.state × onInvalidate (R-invalidate-idempotent, R-ctx-state)", () => {
	it("cascades once, fires onInvalidate, preserves ctx.state, resets dep prevData", () => {
		const statesAtRun: unknown[] = [];
		let onInv = 0;
		const s = node<number>([], null, { initial: 1 });
		const d = node<number>([s], (ctx: Ctx) => {
			statesAtRun.push(ctx.state.get()); // prior state visible at run time
			ctx.state.set("kept");
			ctx.onInvalidate(() => {
				onInv++;
			});
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) * 2]]);
		});
		const { msgs } = collect(d);
		expect(d.cache).toBe(2);
		expect(statesAtRun).toEqual([undefined]); // first run: fresh state

		msgs.length = 0;
		s.down([["INVALIDATE"]]);
		expect(types(msgs)).toEqual(["INVALIDATE"]); // cascaded downstream exactly once
		expect(onInv).toBe(1);
		expect(d.cache).toBeUndefined();
		expect(d.status).toBe("sentinel");

		// idempotent: a second INVALIDATE on an already-reset upstream is a no-op
		msgs.length = 0;
		s.down([["INVALIDATE"]]);
		expect(msgs).toEqual([]);
		expect(onInv).toBe(1);

		// ctx.state preserved across INVALIDATE (lifecycle-continue, NOT fresh-lifecycle)
		s.down([["DATA", 5]]);
		expect(statesAtRun).toEqual([undefined, "kept"]);
		expect(d.cache).toBe(10);
	});
});

describe("C-4 mixed sync/async diamond (R-diamond, R-two-phase, R-first-run-gate, R-dirty-before-data)", () => {
	it("joins exactly once after BOTH legs settle, re-emitting DIRTY before DATA on the next wave", () => {
		let dRuns = 0;
		let cctx: Ctx | null = null;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 10]]),
		); // sync leg
		const c = node<number>(
			[a],
			(ctx: Ctx) => {
				cctx = ctx; // async leg: defer the emit
			},
			{ pool: "async" },
		);
		const d = node<number>([b, c], (ctx: Ctx) => {
			dRuns++;
			ctx.down([
				["DATA", (ctx.depRecords[0].latest as number) + (ctx.depRecords[1].latest as number)],
			]);
		});

		const { msgs } = collect(d);
		// b settled synchronously (11); the async leg is deferred -> first-run gate holds d
		expect(dRuns).toBe(0);
		expect(d.cache).toBeUndefined();

		(cctx as Ctx).down([["DATA", 21]]); // async leg resolves -> first join (activation)
		expect(dRuns).toBe(1); // joined exactly once
		expect(d.cache).toBe(32); // 11 + 21

		// R-dirty-before-data: a non-activation tier-3 emission is preceded by a synthesized
		// DIRTY in the same wave (the join fn calls ctx.down([["DATA",...]]) only). Drive a
		// second settle through both legs so we observe d past its first-run exemption.
		msgs.length = 0;
		a.down([["DATA", 2]]); // re-drives b (sync, 12) and c (async, deferred again)
		expect(dRuns).toBe(1); // still gated on the async leg
		(cctx as Ctx).down([["DATA", 30]]); // async leg re-resolves
		expect(dRuns).toBe(2);
		expect(d.cache).toBe(42); // 12 + 30
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // DIRTY precedes DATA, glitch-free two-phase
		expect(msgs.at(-1)).toEqual(["DATA", 42]);
	});
});

describe("C-5 PAUSE lockset multi-source (R-pause-lockset, R-pause-modes)", () => {
	it("stays paused until every lock RESUMEs; dup PAUSE + unknown RESUME are no-ops", () => {
		let runs = 0;
		const s = node<number>([], null, { initial: 0 });
		const n = node<number>([s], (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		});
		collect(n);
		expect(n.cache).toBe(0);
		runs = 0;

		const LA = Symbol("A");
		const LB = Symbol("B");
		n.up([["PAUSE", LA]]);
		n.up([["PAUSE", LB]]);
		n.up([["PAUSE", LA]]); // duplicate -> idempotent (lockset)

		s.down([["DATA", 1]]); // dep changes while paused
		expect(runs).toBe(0); // fn held
		expect(n.cache).toBe(0);

		n.up([["RESUME", LA]]); // release A — LB still held
		expect(runs).toBe(0); // STILL paused
		expect(n.cache).toBe(0);

		n.up([["RESUME", Symbol("unknown")]]); // unknown id -> no-op
		expect(runs).toBe(0);

		n.up([["RESUME", LB]]); // last lock released -> resume, fire once with latest
		expect(runs).toBe(1);
		expect(n.cache).toBe(1);
	});
});

describe("C-6 synchronous feedback cycle → ERROR (R-reentrancy / D37)", () => {
	it("rejects a sync feedback cycle as ERROR (no hang, no _pending desync)", () => {
		// state S → derived D (=n+1) → effect E; E writes back to S, closing S→D→E→S.
		const g = graph();
		const s = g.state(0);
		const d = g.derived([s], (n) => (n as number) + 1);
		const e = g.effect([d], (n) => {
			s.set(n as number); // feedback → re-enters the wave
		});
		let escaped = false;
		try {
			e.subscribe(() => {});
		} catch {
			escaped = true; // the substrate throw must NOT escape — the graph layer catches it (D30)
		}
		expect(escaped).toBe(false);
		// R-reentrancy: ERROR lands on a node ON the cycle — the value-level catch nearest the
		// throw on the unwind (impl-determined, d or e), not necessarily the re-entered node.
		expect([d.status, e.status]).toContain("errored");
	});
});

describe("C-7 upstream control at a depless source (R-up-at-source / D38)", () => {
	const make = () => {
		const s = node<number>([], null, { initial: 5 });
		const d = node<number>([s], (ctx: Ctx) =>
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]),
		);
		const { msgs } = collect(d);
		msgs.length = 0;
		return { s, d, msgs };
	};

	it("INVALIDATE-up is HONORED: source self-invalidates + cascades down", () => {
		const { s, d, msgs } = make();
		d.up([["INVALIDATE"]]); // forwards to the depless terminus S → self _invalidate
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");
		expect(types(msgs)).toContain("INVALIDATE");
		expect(d.cache).toBeUndefined();
	});

	it("DIRTY-up is DROPPED at the source (untouched, no down-cascade)", () => {
		const { s, d, msgs } = make();
		d.up([["DIRTY"]]);
		expect(s.cache).toBe(5);
		expect(s.status).toBe("settled");
		expect(msgs).toEqual([]);
	});

	it("TEARDOWN-up is DROPPED at the source (not terminated, no down-cascade)", () => {
		const { s, d, msgs } = make();
		d.up([["TEARDOWN"]]);
		expect(s.status).toBe("settled");
		expect(msgs).toEqual([]);
	});
});

describe("C-8 intra-graph runtime rewire (R-rewire / D42)", () => {
	it("surgical addDep (push-on-subscribe) → removeDep (drain) → idempotent setDeps; cache preserved", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 100 }); // B carries cached DATA
		const aOnly = (ctx: Ctx) => ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		const sum = (ctx: Ctx) =>
			ctx.down([
				["DATA", (ctx.depRecords[0].latest as number) + (ctx.depRecords[1].latest as number)],
			]);
		const d = node<number>([a], aOnly);
		collect(d);
		expect(d.cache).toBe(1); // (1) A settled → D ran

		d.addDep(b, sum); // (2) addDep(B): B cached → push-on-subscribe → D recomputes
		expect(d.cache).toBe(101); // 1 + 100

		b.down([["DATA", 50]]); // (3) B drives D
		expect(d.cache).toBe(51); // 1 + 50

		d.removeDep(a, aOnly); // (4) removeDep(A) → deps = [B]
		expect(d.cache).toBe(51); // cache PRESERVED (A was not dirty — no recompute)

		a.down([["DATA", 9]]); // (5) A no longer drives D — its edge is drained
		expect(d.cache).toBe(51);

		b.down([["DATA", 7]]); // B is dep0 now → drives D
		expect(d.cache).toBe(7);

		let runs = 0;
		const f = (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		};
		d.setDeps([b], f); // (6) setDeps to the current set → idempotent
		expect(runs).toBe(0); // no spurious recompute
		expect(d.cache).toBe(7);
	});

	it("rejects rewire on a terminal node (throw → graph-layer ERROR, D30)", () => {
		const a = node<number>([], null, { initial: 1 });
		const id = (ctx: Ctx) => ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		const d = node<number>([a], id, { completeWhenDepsComplete: false });
		collect(d);
		d.down([["COMPLETE"]]); // D terminal
		expect(() => d.setDeps([a], id)).toThrow(/terminal/);
	});
});
