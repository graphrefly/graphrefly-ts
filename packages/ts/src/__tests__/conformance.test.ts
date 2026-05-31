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
import type { Ctx, Message, NodeFn } from "../index.js";
import { distinctUntilChanged, filter, fromIter, graph, type Node, node, take } from "../index.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
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

describe("C-9 pausable:false async source ignores PAUSE (R-pause-modes / R-async-paused / D44)", () => {
	it("delivers its async production immediately under PAUSE — never buffers (resolves B20)", () => {
		let cctx: Ctx | null = null;
		// depless async LEAF source, pausable:false (timer/interval-class).
		const s = node<number>(
			[],
			(ctx: Ctx) => {
				cctx = ctx;
			},
			{ pool: "async", pausable: false },
		);
		const { msgs } = collect(s);
		expect(cctx).not.toBeNull(); // fn ran on activation, no emit yet

		const L = Symbol("pause");
		s.up([["PAUSE", L]]); // pausable:false ⇒ lockset never consulted
		msgs.length = 0;

		(cctx as Ctx).down([["DATA", 42]]); // async production WHILE "paused" → delivered immediately
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // NOT buffered (contrast C-2's compute node)
		expect(msgs.at(-1)).toEqual(["DATA", 42]);
		expect(s.cache).toBe(42);
	});
});

describe("C-10 true-mode async leaf source delivers immediately under PAUSE (R-pause-modes / R-async-paused / D44)", () => {
	it("a depless async source's own production is not gated in true (default) mode (B20's twin)", () => {
		let cctx: Ctx | null = null;
		// depless async LEAF source, pausable:true default (fromPromise/fromAsyncIter-class).
		const s = node<number>(
			[],
			(ctx: Ctx) => {
				cctx = ctx;
			},
			{ pool: "async" },
		);
		const { msgs } = collect(s);
		expect(cctx).not.toBeNull();

		const L = Symbol("pause");
		s.up([["PAUSE", L]]);
		msgs.length = 0;

		(cctx as Ctx).down([["DATA", 7]]); // leaf source's OWN production → delivered immediately
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // NOT buffered (a COMPUTE node WOULD buffer — C-2)
		expect(msgs.at(-1)).toEqual(["DATA", 7]);
		expect(s.cache).toBe(7);
	});
});

// C-11 (D47 / R-rewire-deferred): a node fn's SELF-triggered dep-set mutation via ctx.rewireNext
// is deferred to the committed wave boundary (never mutating _deps mid-run, never the D37 in-fn
// reject), drained as a fresh wave; added cached inners push [DIRTY,DATA] without re-arming the
// gate; removed inners are drained + _deactivate (onDeactivation = abortInFlight). D62: queued
// rewireNext still drains if OP goes terminal; terminal seals output, not topology. The substrate
// prerequisite for the higher-order *Map operators. Distinct from C-8 (external/immediate rewire).
describe("C-11 higher-order inner rewire at the wave boundary (R-rewire-deferred / D47/D62)", () => {
	// Inners are leaf sources whose activation + deactivation are observable (cancellation visible).
	function makeInner(seed?: number) {
		let ictx: Ctx | null = null;
		let activated = false;
		let deactivated = false;
		const n = node<number>([], (ctx) => {
			ictx = ctx;
			activated = true;
			ctx.onDeactivation(() => {
				deactivated = true;
			});
			if (seed !== undefined) ctx.down([["DATA", seed]]);
		});
		return {
			node: n,
			emit: (v: number) => (ictx as Ctx).down([["DATA", v]]),
			complete: () => (ictx as Ctx).down([["COMPLETE"]]),
			isActivated: () => activated,
			isDeactivated: () => deactivated,
		};
	}

	// A merge-style OP: spawn+add an inner per S DATA, forward inner DATA, remove a completed inner.
	function mergeOp(s: Node<number>) {
		const inners: Node<number>[] = [];
		const opFn: NodeFn = (ctx) => {
			const removals: Node<number>[] = [];
			for (let i = 1; i < ctx.depRecords.length; i++) {
				const b = ctx.depRecords[i].batch;
				if (b) for (const v of b) ctx.down([["DATA", v as number]]);
				if (ctx.depRecords[i].terminal === true) removals.push(inners[i - 1]);
			}
			const sv = ctx.depRecords[0].batch;
			if (sv && sv.length > 0) {
				const inner = makeInner((sv[sv.length - 1] as number) * 10);
				inners.push(inner.node);
				ctx.rewireNext.addDep(inner.node, opFn);
			}
			for (const r of removals) {
				inners.splice(inners.indexOf(r), 1);
				ctx.rewireNext.removeDep(r, opFn);
			}
		};
		return node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
	}

	it("(steps 1-3) addDep deferred to the boundary; added cached inner pushes [DIRTY,DATA], gate not re-armed", () => {
		const s = node<number>([], null);
		let opRuns = 0;
		const inners: Node<number>[] = [];
		const opFn: NodeFn = (ctx) => {
			opRuns++;
			for (let i = 1; i < ctx.depRecords.length; i++) {
				const b = ctx.depRecords[i].batch;
				if (b) for (const v of b) ctx.down([["DATA", v as number]]);
			}
			const sv = ctx.depRecords[0].batch;
			if (sv && sv.length > 0) {
				const inner = makeInner((sv[sv.length - 1] as number) * 10);
				inners.push(inner.node);
				// mid-run: _deps is NOT mutated — the inner is not yet wired/activated.
				expect(inner.isActivated()).toBe(false);
				ctx.rewireNext.addDep(inner.node, opFn);
				expect(inner.isActivated()).toBe(false); // still deferred after the request
			}
		};
		const op = node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // step 1: request addDep(innerA); step 2: drain wires it; step 3: forward
		expect(types(msgs)).toContain("DIRTY"); // step 2 boundary wave is two-phase…
		expect(data(msgs)).toEqual([10]); // …innerA's seed (1*10) forwarded as DATA

		opRuns = 0;
		s.down([["DATA", 2]]); // gate NOT re-armed: S alone re-drives the fn (and adds innerB)
		expect(opRuns).toBeGreaterThan(0);
	});

	it("(step 7) an inner COMPLETE removes it (bounding); OP does not COMPLETE while S is live", () => {
		const s = node<number>([], null);
		const op = mergeOp(s);
		const { msgs } = collect(op);

		s.down([["DATA", 5]]); // add innerA (seed 50 forwarded)
		expect(data(msgs)).toContain(50);
		msgs.length = 0;

		s.down([["DATA", 6]]); // add innerB (seed 60 forwarded)
		expect(data(msgs)).toContain(60);

		// OP stays live: S is still live, completeWhenDepsComplete:false → no terminal cascade.
		expect(op.status).not.toBe("completed");
		expect(types(msgs)).not.toContain("COMPLETE");
	});

	it("(steps 4-6, switch) setDeps tears down the superseded inner's source and forwards only the new one", () => {
		const s = node<number>([], null);
		const innerA = makeInner(10);
		const innerB = makeInner(20);
		let current: Node<number> | null = null;
		const opFn: NodeFn = (ctx) => {
			for (let i = 1; i < ctx.depRecords.length; i++) {
				const b = ctx.depRecords[i].batch;
				if (b) for (const v of b) ctx.down([["DATA", v as number]]);
			}
			const sv = ctx.depRecords[0].batch;
			if (sv && sv.length > 0) {
				current = (sv[sv.length - 1] as number) === 1 ? innerA.node : innerB.node;
				ctx.rewireNext.setDeps([s, current], opFn);
			}
		};
		const op = node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // → innerA live (seed 10 forwarded)
		expect(data(msgs)).toContain(10);
		expect(innerA.isActivated()).toBe(true);
		msgs.length = 0;

		s.down([["DATA", 2]]); // switch → innerB; innerA's SOURCE torn down (not masked)
		expect(innerB.isActivated()).toBe(true);
		expect(innerA.isDeactivated()).toBe(true);
		expect(data(msgs)).toEqual([20]); // ONLY the current inner forwarded
		msgs.length = 0;

		innerA.emit(999); // the superseded inner is DRAINED — no stale forward survives
		expect(data(msgs)).toEqual([]);
	});

	it("(variant) an IMMEDIATE in-fn self-rewire is the D37 feedback cycle → graph-layer ERROR (not rewireNext)", () => {
		const g = graph();
		const a = g.state(1);
		const x = g.state(9);
		let op: Node<number>;
		// g.derived carries the D30 value-throw→ERROR boundary; the fn does an IMMEDIATE self-addDep
		// (NOT ctx.rewireNext) mid-run → the D37 reject throws → graph layer converts it to ERROR.
		op = g.derived([a], (av) => {
			op.addDep(x, (c) => c.down([["DATA", c.depRecords[0].latest as number]]));
			return av as number;
		});
		let escaped = false;
		try {
			op.subscribe(() => {});
		} catch {
			escaped = true; // the substrate throw must be caught by the graph layer (D30), not escape
		}
		expect(escaped).toBe(false);
		expect(op.status).toBe("errored");
	});

	it("(variant) a terminal OP still drains its pending rewireNext queue; terminal seals output", () => {
		const s = node<number>([], null);
		const inner = makeInner(1);
		const opFn: NodeFn = (ctx) => {
			if (ctx.depRecords[0].batch) {
				ctx.rewireNext.addDep(inner.node, opFn); // queued…
				ctx.down([["COMPLETE"]]); // …then OP goes terminal THIS wave
			}
		};
		const op = node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		const { msgs } = collect(op);
		s.down([["DATA", 1]]);
		expect(op.status).toBe("completed");
		expect(inner.isActivated()).toBe(true); // D62: queued addDep drains after terminal
		expect(op.deps).toContain(inner.node);
		msgs.length = 0;
		inner.emit(2);
		expect(msgs).toEqual([]); // terminal output guard: no post-terminal DATA escapes
	});

	it("(variant) a terminal OP drains a queued removeDep, releasing helper-owned work", () => {
		const s = node<number>([], null);
		const inner = makeInner(1);
		let added = false;
		const opFn: NodeFn = (ctx) => {
			if (!added && ctx.depRecords[0].batch) {
				added = true;
				ctx.rewireNext.addDep(inner.node, opFn);
				return;
			}
			if (ctx.depRecords[0].terminal === true) {
				ctx.rewireNext.removeDep(inner.node, opFn);
				ctx.down([["COMPLETE"]]);
			}
		};
		const op = node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		collect(op);
		s.down([["DATA", 1]]);
		expect(inner.isActivated()).toBe(true);
		s.down([["COMPLETE"]]);
		expect(op.status).toBe("completed");
		expect(op.deps).not.toContain(inner.node);
		expect(inner.isDeactivated()).toBe(true);
	});

	it("(variant) a no-net-change rewireNext is a no-op (no drain loop)", () => {
		const a = node<number>([], null, { initial: 1 });
		let runs = 0;
		const op = node<number>([a], function opFn(ctx) {
			runs++;
			if (runs < 5) ctx.rewireNext.setDeps([a], opFn); // identical dep set every run
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		});
		collect(op);
		expect(runs).toBe(1); // the idempotent setDeps changes nothing → no fresh wave → no loop
		expect(op.cache).toBe(1);
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
		expect(types(msgs)).toEqual(["START", "DATA", "DATA", "DATA", "COMPLETE"]);
		expect(data(msgs)).toEqual([1, 1, 1]); // not [1] — the pre-D49 equals-absorption bug
	});

	it("(b) take(3) counts occurrences, not distinct values → [1,1,1]", () => {
		const g = graph();
		const src = g.initNode(fromIter<number>([1, 1, 1]), []);
		const t = g.initNode(take<number>(3), [src]);
		const { msgs } = collect(t);
		expect(data(msgs)).toEqual([1, 1, 1]);
		expect(t.status).toBe("completed");
	});

	it("(c) filter-reject: the substrate synthesizes one undirty RESOLVED — no DATA, no wedge", () => {
		const g = graph();
		const s = g.state(50);
		const f = g.initNode(
			filter((n: number) => n >= 100),
			[s],
		);
		const { msgs } = collect(f);
		// activation: 50 rejected, f never produced — no DIRTY on activation, no synth
		expect(f.status).toBe("sentinel");
		expect(f.cache).toBeUndefined();
		msgs.length = 0;

		s.set(60); // rejected: DIRTY'd but no value → substrate-synthesized undirty RESOLVED
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]); // un-dirtied, no DATA, not wedged
		expect(f.status).toBe("sentinel"); // never valued
		msgs.length = 0;

		s.set(150); // accepted → real DATA occurrence
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(f.cache).toBe(150);
		msgs.length = 0;

		s.set(70); // rejected, but f now carries 150 → undirty RESOLVED, status resolved
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]);
		expect(f.status).toBe("resolved");
		expect(f.cache).toBe(150); // cache preserved across the undirty wave
	});

	it("(c') a downstream recompute un-dirties as DATA (occurrence), never wedges", () => {
		const g = graph();
		const s = g.state(100); // accepted by the filter
		const f = g.initNode(
			filter((n: number) => n >= 100),
			[s],
		);
		const d = g.derived([f], (v: number) => v * 2);
		const { msgs } = collect(d);
		expect(d.cache).toBe(200); // f=100 → d=200
		msgs.length = 0;

		s.set(50); // rejected by f → f synthesizes RESOLVED → d clears + recomputes f's cached 100
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // d un-dirtied via a (same-value) DATA, no wedge
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
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // occurrence, NOT equals-absorbed
		expect(s.cache).toBe(1);
		msgs.length = 0;
		s.set(2);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
	});

	it("the tier-3 exclusivity guard stays: a wave cannot mix DATA and RESOLVED", () => {
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["DATA", 2], ["RESOLVED"]])).toThrow(/tier-3 exclusivity/);
	});
});

describe("C-13 INVALIDATE arriving at a paused compute node (R-paused-invalidate / D50)", () => {
	it("(a) a sole-dep INVALIDATE supersedes the buffered paused dep-wave → no recompute on RESUME", () => {
		let runs = 0;
		const d1 = node<number>([], null, { initial: 0 });
		const n = node<number>([d1], (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 1]]); // non-guarding
		});
		const { msgs } = collect(n);
		expect(n.cache).toBe(1);
		runs = 0;
		msgs.length = 0;

		const L = Symbol("p");
		n.up([["PAUSE", L]]);
		d1.down([["DATA", 5]]); // buffered while paused (no recompute)
		expect(runs).toBe(0);
		d1.down([["INVALIDATE"]]); // supersedes the buffered wave → cancels the paused recompute
		n.up([["RESUME", L]]); // RESUME must NOT recompute against the SENTINEL dep

		expect(runs).toBe(0); // the superseded paused dep-wave does not recompute (D50)
		expect(n.cache).toBeUndefined(); // stays SENTINEL (own INVALIDATE) — no garbage recompute
		expect(msgs.some((m) => m[0] === "DATA")).toBe(false); // no spurious recompute DATA after INVALIDATE
	});

	it("(b) a DATA after the INVALIDATE re-arms the buffer → RESUME recomputes with the new value", () => {
		let runs = 0;
		const d1 = node<number>([], null, { initial: 0 });
		const n = node<number>([d1], (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 100]]);
		});
		collect(n);
		runs = 0;

		const L = Symbol("p");
		n.up([["PAUSE", L]]);
		d1.down([["DATA", 5]]); // buffered
		d1.down([["INVALIDATE"]]); // supersede v1
		d1.down([["DATA", 7]]); // re-arm with v2
		n.up([["RESUME", L]]);

		expect(runs).toBe(1); // recomputes once with the re-armed value
		expect(n.cache).toBe(107); // 7 + 100 (v2, not the superseded v1)
	});

	it("(c) a multi-dep INVALIDATE does NOT cancel a surviving dep's buffered update", () => {
		let runs = 0;
		const d1 = node<number>([], null, { initial: 0 });
		const d2 = node<number>([], null, { initial: 0 });
		const n = node<number>([d1, d2], (ctx: Ctx) => {
			runs++;
			const a = (ctx.depRecords[0].latest as number | undefined) ?? 0; // guards D1 SENTINEL
			const b = ctx.depRecords[1].latest as number;
			ctx.down([["DATA", a + b]]);
		});
		collect(n);
		runs = 0;

		const L = Symbol("p");
		n.up([["PAUSE", L]]);
		d1.down([["DATA", 5]]); // buffered
		d2.down([["DATA", 9]]); // buffered (the survivor)
		d1.down([["INVALIDATE"]]); // D1 superseded; D2's buffered wave survives
		n.up([["RESUME", L]]);

		expect(runs).toBe(1); // still recomputes for the surviving dep (no lost update)
		expect(n.cache).toBe(9); // D1=SENTINEL→0, D2=9
	});
});

describe("C-14 cleanup hooks are per-run (cleared + re-registered each fn run) (R-cleanup-hooks / D28)", () => {
	it("after K runs, onInvalidate + onDeactivation fire ONCE (the latest run's), not K times", () => {
		let flush = 0;
		let cleanup = 0;
		const s = node<number>([], null, { initial: 0 });
		const d = node<number>([s], (ctx: Ctx) => {
			ctx.onInvalidate(() => flush++);
			ctx.onDeactivation(() => cleanup++);
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		});
		const { unsub } = collect(d); // run 1 (activation, s=0)
		s.down([["DATA", 1]]); // run 2 — re-registers (prior run's hooks cleared)
		s.down([["DATA", 2]]); // run 3 — re-registers (D has now run 3×)

		s.down([["INVALIDATE"]]); // fires onInvalidate ONCE (run-3's), not 3× (the accumulation bug)
		expect(flush).toBe(1);

		unsub(); // D deactivates → fires onDeactivation ONCE (run-3's), not 3×
		expect(cleanup).toBe(1);
	});

	it("a single-run node keeps its one registration (no re-run → no clear)", () => {
		let cleanup = 0;
		const s = node<number>([], null, { initial: 5 });
		const d = node<number>([s], (ctx: Ctx) => {
			ctx.onDeactivation(() => cleanup++);
			ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
		});
		const { unsub } = collect(d); // run 1 only
		unsub();
		expect(cleanup).toBe(1);
	});
});

// C-15 (R-terminal-settles-dirty / B35): a dep's terminal (COMPLETE/ERROR) releases its
// outstanding in-wave DIRTY contribution — the exactly-one-settle invariant — exactly as
// DATA/RESOLVED/INVALIDATE do, so a DIRTY-then-terminal-without-DATA dep never strands the
// join node's pending and wedges it. The terminal analogue of the INVALIDATE wedge-guard.
describe("C-15 a dep's terminal releases its in-wave DIRTY contribution (R-terminal-settles-dirty / D-none)", () => {
	const sum2 = (ctx: Ctx) =>
		ctx.down([
			[
				"DATA",
				((ctx.depRecords[0].latest as number) ?? 0) + ((ctx.depRecords[1].latest as number) ?? 0),
			],
		]);

	it("(a) COMPLETE-mid-dirty: D joins ONCE on the live leg, not wedged", () => {
		const b = node<number>([], null, { initial: 1 });
		const c = node<number>([], null, { initial: 10 });
		const d = node<number>([b, c], sum2, { completeWhenDepsComplete: false });
		const { msgs } = collect(d);
		expect(d.cache).toBe(11); // first join (activation): 1 + 10
		msgs.length = 0;

		b.down([["DIRTY"]]); // B signals a change toward D (phase 1) → D dirty, pending=1
		expect(d.status).toBe("dirty");
		c.down([["DATA", 20]]); // C delivers a real value — but D is gated on B's pending
		expect(d.cache).toBe(11); // not yet (B still dirty)
		b.down([["COMPLETE"]]); // B COMPLETEs with NO DATA → releases B's dirty → D joins on C

		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // joined EXACTLY once, glitch-free, no wedge
		expect(d.cache).toBe(21); // B's last value (1) + C's new value (20)
		expect(d.status).not.toBe("completed"); // C is still live (completeWhenDepsComplete:false)
	});

	it("(b) sole-dirty: B's COMPLETE drains pending → D un-dirties via RESOLVED (no fabricated DATA)", () => {
		const b = node<number>([], null, { initial: 1 });
		const c = node<number>([], null, { initial: 10 });
		const d = node<number>([b, c], sum2, { completeWhenDepsComplete: false });
		const { msgs } = collect(d);
		expect(d.cache).toBe(11);
		msgs.length = 0;

		b.down([["DIRTY"]]); // B the SOLE dirty contributor (C unchanged this wave)
		b.down([["COMPLETE"]]); // COMPLETEs with no value → no occurrence → undirty RESOLVED

		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]); // un-dirtied, NOT a fabricated DATA
		expect(d.cache).toBe(11); // cache preserved (a terminal, unlike INVALIDATE, keeps the value)
		expect(d.status).toBe("resolved"); // undirty-RESOLVED convention (hasData → resolved), not "settled"
	});

	it("(c) rescue: an absorbed ERROR releases the dirty + the fn reads the terminal, no wedge", () => {
		const b = node<number>([], null, { initial: 1 });
		const c = node<number>([], null, { initial: 10 });
		const rescue = (ctx: Ctx) => {
			const bt = ctx.depRecords[0].terminal;
			const bv = bt !== undefined && bt !== true ? 0 : ((ctx.depRecords[0].latest as number) ?? 0);
			ctx.down([["DATA", bv + ((ctx.depRecords[1].latest as number) ?? 0)]]);
		};
		const d = node<number>([b, c], rescue, {
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		});
		const { msgs } = collect(d);
		expect(d.cache).toBe(11);
		msgs.length = 0;

		b.down([["DIRTY"]]); // B dirties D
		b.down([["ERROR", new Error("boom")]]); // rescued (errorWhenDepsError:false) → fn reads terminal

		expect(d.status).not.toBe("errored"); // NOT propagated — rescued
		expect(data(msgs)).toEqual([10]); // B rescued to 0 + C(10); released dirty, no stranded pending
	});

	it("(d) gate-holds: a dirtied dep completing-empty on a PRE-first-run multi-dep node un-dirties, never wedges", () => {
		// QA gate-holds corner (mutation-verified): node not yet first-run; C dirties then COMPLETEs
		// with NO value while B has DATA — but the first-run gate STILL holds (C never delivered,
		// terminalAsRealInput:false). The fn cannot run, yet the broadcast DIRTY must be balanced by
		// a RESOLVED, else downstream wedges (the B35 class missed by the naive sawData→_maybeRun).
		let runs = 0;
		const b = node<number>([], null); // no initial — delivers only when driven
		const c = node<number>([], null);
		const d = node<number>(
			[b, c],
			(ctx: Ctx) => {
				runs++;
				ctx.down([
					[
						"DATA",
						((ctx.depRecords[0].latest as number) ?? 0) +
							((ctx.depRecords[1].latest as number) ?? 0),
					],
				]);
			},
			{ completeWhenDepsComplete: false },
		);
		const { msgs } = collect(d);
		expect(runs).toBe(0); // gate holds — neither dep delivered yet
		msgs.length = 0;

		c.down([["DIRTY"]]); // C signals a change → D dirty, broadcasts DIRTY (pending=1)
		b.down([["DATA", 5]]); // B delivers a value, but the gate still needs C → D gated
		expect(runs).toBe(0);
		c.down([["COMPLETE"]]); // C COMPLETEs with NO value → releases dirty; gate STILL holds

		expect(runs).toBe(0); // fn never ran (C never delivered data, terminalAsRealInput:false)
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]); // un-dirtied downstream, NOT wedged
		expect(d.cache).toBeUndefined(); // never produced a value
	});
});

// C-16 (R-pull / R-up-routing / D55,D59): a pull-mode node (NodeOptions.pullId:<Symbol>) is QUIET by
// default — ABSORBS an upstream DIRTY without relaying it (the wedge fix), no push-on-subscribe (START
// only). A DEMAND = a CONE-ROUTED RESUME of its pullId (R-up-routing release-if-held-else-forward-up;
// no new message type, no node reference): fires EXACTLY ONE delivery (DIRTY-before-DATA) then re-quiets
// (1:1); content = pausable mode (true→latest / resumeAll→backlog). A SELF-demand defers via ctx.upNext
// (R-rewire-deferred); an immediate in-fn demand whose delivery loops back is the D37 feedback cycle.
// pullId disambiguates siblings; pullId+pausable:false is rejected.
describe("C-16 pull-mode node: quiet absorbs DIRTY + cone-routed demand delivers once then re-quiets (R-pull / R-up-routing / D55,D59)", () => {
	const PSNAP = Symbol("snapshot"); // the author-supplied pullId, shared between the pull node + the demander
	// SNAP = a pull node over an accumulator ACC, projecting ACC's latest as the "snapshot".
	const snapFn = (ctx: Ctx) => ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
	const fwd: NodeFn = (ctx) => {
		// a non-pull intermediate: forward any dep DATA downstream (relays a routed demand's delivery).
		for (const r of ctx.depRecords) if (r.batch) for (const v of r.batch) ctx.down([["DATA", v]]);
	};

	it("(quiet/absorb + no push-on-subscribe) ACC changes never relay a DIRTY to SNAP's sink", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP }); // pausable defaults true
		const { msgs } = collect(snap);
		expect(types(msgs)).toEqual(["START"]); // quiet: cached value NOT pushed on subscribe (START only)
		expect(snap.pullId).toBe(PSNAP); // the pullId is the author's value (inspection accessor)
		msgs.length = 0;

		acc.down([["DATA", 1]]); // ACC changes while SNAP is quiet
		acc.down([["DATA", 2]]);
		expect(msgs).toEqual([]); // absorbed — no DIRTY, no DATA relayed → a downstream is NEVER wedged
	});

	it("(demand true) one routed RESUME(pullId) delivers the coalesced LATEST as DIRTY→DATA, re-quiets (1:1)", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const { msgs } = collect(snap);
		msgs.length = 0;
		acc.down([["DATA", 1]]);
		acc.down([["DATA", 2]]); // two changes while quiet → coalesced

		snap.up([["RESUME", PSNAP]]); // DEMAND — a RESUME of the pullId (here direct on SNAP)
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // DIRTY-before-DATA on the demand wave
		expect(data(msgs)).toEqual([2]); // the coalesced LATEST (one DATA), not [1,2]
		msgs.length = 0;

		snap.up([["RESUME", PSNAP]]); // (silent) second demand, no intervening change
		expect(msgs).toEqual([]); // delivers NOTHING

		acc.down([["DATA", 3]]); // re-quiet held: a further change is again absorbed silently
		expect(msgs).toEqual([]);
	});

	it("(demand resumeAll) one RESUME drains the buffered BACKLOG incl. the activation value", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP, pausable: "resumeAll" });
		const { msgs } = collect(snap);
		msgs.length = 0;
		acc.down([["DATA", 1]]);
		acc.down([["DATA", 2]]);

		snap.up([["RESUME", PSNAP]]); // DEMAND
		expect(data(msgs)).toEqual([0, 1, 2]); // activation value 0 + the backlog 1,2 (per-entry replay)
		expect(types(msgs).filter((t) => t === "DIRTY").length).toBeGreaterThan(0); // DIRTY-before-DATA
		msgs.length = 0;

		snap.up([["RESUME", PSNAP]]); // no change → silent
		expect(msgs).toEqual([]);
	});

	it("(reject) pullId + pausable:false throws at construction", () => {
		expect(() => node<number>([], null, { pullId: PSNAP, pausable: false })).toThrow(/pull/);
	});

	it("(routing: no-reference SELF-demand via ctx.upNext applies at the boundary — no D37, end-to-end)", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const stream = node<number>([], null); // cheap delta-notification source
		const received: number[] = [];
		const cFn: NodeFn = (ctx) => {
			const snapB = ctx.depRecords[1].batch;
			if (snapB) for (const v of snapB) received.push(v as number);
			const streamB = ctx.depRecords[0].batch;
			// boundary-deferred self-demand: a cone-routed RESUME(pullId), NO snap reference held.
			if (streamB && streamB.length > 0) ctx.upNext([["RESUME", PSNAP]]);
		};
		const c = node<number>([stream, snap], cFn, { partial: true });
		collect(c); // C is NOT wedged by the quiet snapshot
		acc.down([["DATA", 7]]); // ACC change — absorbed by quiet SNAP
		expect(received).toEqual([]); // no snapshot yet

		stream.down([["DATA", 1]]); // a delta → C demands up the cone; the boundary drain delivers it
		expect(received).toEqual([7]); // got the coalesced latest, no D37, no hang
	});

	it("(routing: pullId disambiguates siblings) a cone-routed RESUME reaches ONLY the matching holder", () => {
		// D → G(non-pull, forwards) → { Fsnap(pullId PF), Hsnap(pullId PH) } ; F,H are pull-over-acc.
		const PF = Symbol("F");
		const PH = Symbol("H");
		const accF = node<number>([], null, { initial: 100 });
		const accH = node<number>([], null, { initial: 200 });
		const fSnap = node<number>([accF], snapFn, { pullId: PF });
		const hSnap = node<number>([accH], snapFn, { pullId: PH });
		const g = node<number>([fSnap, hSnap], fwd, { partial: true }); // intermediate forwards
		const received: number[] = [];
		const d = node<number>([g], (ctx) => {
			const b = ctx.depRecords[0].batch;
			if (b) for (const v of b) received.push(v as number);
		});
		collect(d);

		d.up([["RESUME", PF]]); // demand F up the cone (D→G→{F,H}); only F (holds PF) fires, H forwards+drops
		expect(received).toEqual([100]); // F's value, NOT H's 200 — disambiguated by pullId identity
		received.length = 0;

		d.up([["RESUME", PH]]); // now demand H — the sibling
		expect(received).toEqual([200]); // only H fires
	});

	it("(routing: towardDep prunes) a directed demand reaches the pull dep but not the other branch", () => {
		const acc = node<number>([], null, { initial: 5 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const stream = node<number>([], null);
		const received: number[] = [];
		const cFn: NodeFn = (ctx) => {
			const snapB = ctx.depRecords[1].batch; // snap is dep index 1
			if (snapB) for (const v of snapB) received.push(v as number);
		};
		const c = node<number>([stream, snap], cFn, { partial: true });
		collect(c);

		// directed toward dep 0 (stream) — routes AWAY from snap → snap never reached → silent
		c.up([["RESUME", PSNAP]], 0);
		expect(received).toEqual([]);

		// directed toward dep 1 (snap) — reaches the pull holder → delivers
		c.up([["RESUME", PSNAP]], 1);
		expect(received).toEqual([5]);
	});

	it("(immediate) an in-fn demand whose delivery loops back to the consumer is the D37 feedback cycle", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const stream = node<number>([], null);
		const cFn: NodeFn = (ctx) => {
			const streamB = ctx.depRecords[0].batch;
			// IMMEDIATE (non-deferred) demand: SNAP's delivery loops straight back → re-enters C mid-wave.
			if (streamB && streamB.length > 0) ctx.up([["RESUME", PSNAP]]);
		};
		const c = node<number>([stream, snap], cFn, { partial: true });
		collect(c);
		acc.down([["DATA", 7]]);
		expect(() => stream.down([["DATA", 1]])).toThrow(/feedback cycle|reentrancy/i);
	});
});

// C-17 (R-deps-terminal / B42): an ABSORBED error (errorWhenDepsError:false) counts as TERMINAL for
// the completeWhenDepsComplete auto-COMPLETE cascade — order-independent (whichever terminal lands
// last fires it). The COMPLETION analogue of C-15's DIRTY-release. NOT hit by the landed catalog
// (rescue/race/sample use completeWhenDepsComplete:false) — a pure latent-wedge fix.
describe("C-17 — absorbed-error dep counts as terminal for auto-COMPLETE (B42 / R-deps-terminal)", () => {
	const fwd: NodeFn = (ctx) => {
		for (const r of ctx.depRecords) if (r.batch) for (const v of r.batch) ctx.down([["DATA", v]]);
	};

	it("(a) error-then-complete: C errors (absorbed), then B completes → D auto-COMPLETEs", () => {
		const g = graph();
		const b = g.node<number>([], null); // manual source
		const c = g.node<number>([], null);
		const d = g.node([b, c], fwd, { errorWhenDepsError: false }); // absorbs C's error, stays live
		collect(d);
		c.down([["ERROR", new Error("boom")]]); // absorbed; B still live → not yet all-terminal
		expect(d.status).not.toBe("completed");
		expect(d.status).not.toBe("errored"); // errorWhenDepsError:false → no auto-ERROR
		b.down([["DATA", 1], ["COMPLETE"]]); // B terminal → ALL deps terminal (C errored) → COMPLETE
		expect(d.status).toBe("completed");
	});

	it("(b) complete-then-error: B completes, then C errors LAST → D still auto-COMPLETEs (ERROR-arm mirror)", () => {
		const g = graph();
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const d = g.node([b, c], fwd, { errorWhenDepsError: false });
		collect(d);
		b.down([["DATA", 1], ["COMPLETE"]]); // B terminal; C still live → not yet all-terminal
		expect(d.status).not.toBe("completed");
		c.down([["ERROR", new Error("boom")]]); // C absorbed-error LANDS LAST → all terminal → COMPLETE
		expect(d.status).toBe("completed"); // the ERROR-absorbed arm mirrors the COMPLETE arm (B42)
	});

	it("(c) errorWhenDepsError:true (default) auto-ERRORs on a dep error (absorbed path gated off)", () => {
		const g = graph();
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const d = g.node([b, c], fwd); // defaults: errorWhenDepsError:true
		collect(d);
		c.down([["ERROR", new Error("boom")]]); // auto-cascade → ERROR before any complete-check
		expect(d.status).toBe("errored");
	});
});
