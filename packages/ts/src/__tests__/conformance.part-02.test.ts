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
import {
	batch,
	defaultRestoreRegistry,
	define,
	depBatch,
	depCount,
	depLatest,
	depTerminal,
	graph,
	isTerminalError,
	map,
	type Node,
	node,
	restoreGraph,
	restoreRegistry,
} from "../index.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const _flush = () => new Promise((r) => setTimeout(r, 0));
function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

describe("C-14 cleanup hooks are per-run (cleared + re-registered each fn run) (R-cleanup-hooks / D28)", () => {
	it("after K runs, onInvalidate + onDeactivation fire ONCE (the latest run's), not K times", () => {
		let flush = 0;
		let cleanup = 0;
		const s = node<number>([], null, { initial: 0 });
		const d = node<number>([s], (ctx: Ctx) => {
			ctx.onInvalidate(() => flush++);
			ctx.onDeactivation(() => cleanup++);
			ctx.down([["DATA", depLatest(ctx, 0) as number]]);
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
			ctx.down([["DATA", depLatest(ctx, 0) as number]]);
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
			["DATA", ((depLatest(ctx, 0) as number) ?? 0) + ((depLatest(ctx, 1) as number) ?? 0)],
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
			const bt = depTerminal(ctx, 0);
			const bv = isTerminalError(bt) ? 0 : ((depLatest(ctx, 0) as number) ?? 0);
			ctx.down([["DATA", bv + ((depLatest(ctx, 1) as number) ?? 0)]]);
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
					["DATA", ((depLatest(ctx, 0) as number) ?? 0) + ((depLatest(ctx, 1) as number) ?? 0)],
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

// C-16 (R-pull / R-up-routing / D269): a pull-mode node (NodeOptions.pullId:<Symbol>) is QUIET by
// default — ABSORBS an upstream DIRTY without relaying it (the wedge fix), no push-on-subscribe (START
// only). A DEMAND = a cone-routed PULL({pullId, params?}) (demand-if-holder-else-forward-up;
// no node reference): fires EXACTLY ONE delivery (DIRTY-before-DATA) then re-quiets (1:1);
// content = pausable mode (true→latest / resumeAll→backlog). A SELF-demand defers via ctx.upNext
// (R-rewire-deferred); an immediate in-fn demand whose delivery loops back is the D37 feedback cycle.
// pullId disambiguates siblings; pullId+pausable:false is rejected.
describe("C-16 pull-mode node: quiet absorbs DIRTY + cone-routed demand delivers once then re-quiets (R-pull / R-up-routing / D269)", () => {
	const PSNAP = Symbol("snapshot"); // the author-supplied pullId, shared between the pull node + the demander
	// SNAP = a pull node over an accumulator ACC, projecting ACC's latest as the "snapshot".
	const snapFn = (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]);
	const fwd: NodeFn = (ctx) => {
		// a non-pull intermediate: forward any dep DATA downstream (relays a routed demand's delivery).
		for (let i = 0; i < depCount(ctx); i++) {
			const b = depBatch(ctx, i);
			if (b) for (const v of b) ctx.down([["DATA", v]]);
		}
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

	it("(demand true) one routed PULL({pullId}) delivers the coalesced LATEST as DIRTY→DATA, re-quiets (1:1)", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const { msgs } = collect(snap);
		msgs.length = 0;
		acc.down([["DATA", 1]]);
		acc.down([["DATA", 2]]); // two changes while quiet → coalesced

		snap.up([["PULL", { pullId: PSNAP }]]); // DEMAND — direct on SNAP for this unit edge
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // DIRTY-before-DATA on the demand wave
		expect(data(msgs)).toEqual([2]); // the coalesced LATEST (one DATA), not [1,2]
		msgs.length = 0;

		snap.up([["PULL", { pullId: PSNAP }]]); // D278: raw holder invokes even with no intervening change
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(data(msgs)).toEqual([2]);
		msgs.length = 0;

		acc.down([["DATA", 3]]); // re-quiet held: a further change is again absorbed silently
		expect(msgs).toEqual([]);
	});

	it("(demand resumeAll) one PULL drains the buffered BACKLOG incl. the activation value", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP, pausable: "resumeAll" });
		const { msgs } = collect(snap);
		msgs.length = 0;
		acc.down([["DATA", 1]]);
		acc.down([["DATA", 2]]);

		snap.up([["PULL", { pullId: PSNAP }]]); // DEMAND
		expect(data(msgs)).toEqual([0, 1, 2]); // activation value 0 + the backlog 1,2 (per-entry replay)
		expect(types(msgs).filter((t) => t === "DIRTY").length).toBeGreaterThan(0); // DIRTY-before-DATA
		msgs.length = 0;

		snap.up([["PULL", { pullId: PSNAP }]]); // D278: raw holder invokes even with no intervening change
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(data(msgs)).toEqual([2]);
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
			const snapB = depBatch(ctx, 1);
			if (snapB) for (const v of snapB) received.push(v as number);
			const streamB = depBatch(ctx, 0);
			// boundary-deferred self-demand: a cone-routed PULL({pullId}), NO snap reference held.
			if (streamB && streamB.length > 0) ctx.upNext([["PULL", { pullId: PSNAP }]]);
		};
		const c = node<number>([stream, snap], cFn, { partial: true });
		collect(c); // C is NOT wedged by the quiet snapshot
		acc.down([["DATA", 7]]); // ACC change — absorbed by quiet SNAP
		expect(received).toEqual([]); // no snapshot yet

		stream.down([["DATA", 1]]); // a delta → C demands up the cone; the boundary drain delivers it
		expect(received).toEqual([7]); // got the coalesced latest, no D37, no hang
	});

	it("(routing: pullId disambiguates siblings) a cone-routed PULL reaches ONLY the matching holder", () => {
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
			const b = depBatch(ctx, 0);
			if (b) for (const v of b) received.push(v as number);
		});
		collect(d);

		d.up([["PULL", { pullId: PF }]]); // demand F up the cone (D→G→{F,H}); only F (holds PF) fires, H forwards+drops
		expect(received).toEqual([100]); // F's value, NOT H's 200 — disambiguated by pullId identity
		received.length = 0;

		d.up([["PULL", { pullId: PH }]]); // now demand H — the sibling
		expect(received).toEqual([200]); // only H fires
	});

	it("(routing: towardDep prunes) a directed demand reaches the pull dep but not the other branch", () => {
		const acc = node<number>([], null, { initial: 5 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const stream = node<number>([], null);
		const received: number[] = [];
		const cFn: NodeFn = (ctx) => {
			const snapB = depBatch(ctx, 1); // snap is dep index 1
			if (snapB) for (const v of snapB) received.push(v as number);
		};
		const c = node<number>([stream, snap], cFn, { partial: true });
		collect(c);

		// directed toward dep 0 (stream) — routes AWAY from snap → snap never reached → silent
		c.up([["PULL", { pullId: PSNAP }]], 0);
		expect(received).toEqual([]);

		// directed toward dep 1 (snap) — reaches the pull holder → delivers
		c.up([["PULL", { pullId: PSNAP }]], 1);
		expect(received).toEqual([5]);
	});

	it("(immediate) an in-fn demand whose delivery loops back to the consumer is the D37 feedback cycle", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PSNAP });
		const stream = node<number>([], null);
		const cFn: NodeFn = (ctx) => {
			const streamB = depBatch(ctx, 0);
			// IMMEDIATE (non-deferred) demand: SNAP's delivery loops straight back → re-enters C mid-wave.
			if (streamB && streamB.length > 0) ctx.up([["PULL", { pullId: PSNAP }]]);
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
		for (let i = 0; i < depCount(ctx); i++) {
			const b = depBatch(ctx, i);
			if (b) for (const v of b) ctx.down([["DATA", v]]);
		}
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

// C-18 (R-up-routing-diamond / D63): a routed broadcast PULL over a diamond can reach the same
// pull holder through multiple upstream paths, but that holder fires at most once for the wave.
describe("C-18 — routed pull demand over a diamond is holder-idempotent (R-up-routing-diamond / D63)", () => {
	it("broadcast PULL over D→G1/G2→SNAP invokes SNAP's demand handler once", () => {
		const PSNAP = Symbol("snapshot");
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			pullId: PSNAP,
		});
		let demands = 0;
		const snapProbe = snap as unknown as {
			_onDemand: () => void;
		};
		const originalOnDemand = snapProbe._onDemand.bind(snap);
		snapProbe._onDemand = () => {
			demands++;
			originalOnDemand();
		};

		const fwd: NodeFn = (ctx) => {
			for (let i = 0; i < depCount(ctx); i++) {
				const b = depBatch(ctx, i);
				if (b) for (const v of b) ctx.down([["DATA", v]]);
			}
		};
		const g1 = node<number>([snap], fwd, { partial: true });
		const g2 = node<number>([snap], fwd, { partial: true });
		const d = node<number>([g1, g2], fwd, { partial: true });
		collect(d);

		acc.down([["DATA", 1]]); // quiet SNAP absorbs the change
		d.up([["PULL", { pullId: PSNAP }]]); // D broadcasts through both G1 and G2 to the same holder

		expect(demands).toBe(1);
	});
});

// C-19 (R-undirty-settle-timing / D64): substrate-synthesized undirty RESOLVED from non-fn settle
// arms must use the normal down path, so pause resumeAll and batch timing apply.
describe("C-19 — undirty RESOLVED from non-fn settle arms respects pause and batch (R-undirty-settle-timing / D64)", () => {
	it("resumeAll buffers a never-valued INVALIDATE un-dirty until RESUME", () => {
		const b = node<number>([], null, { initial: 1 });
		const c = node<number>([], null);
		const d = node<number>(
			[b, c],
			(ctx) =>
				ctx.down([
					["DATA", ((depLatest(ctx, 0) as number) ?? 0) + ((depLatest(ctx, 1) as number) ?? 0)],
				]),
			{ pausable: "resumeAll" },
		);
		const { msgs } = collect(d);
		msgs.length = 0;

		const L = Symbol("pause");
		d.up([["PAUSE", L]]);
		b.down([["DIRTY"]]);
		b.down([["INVALIDATE"]]);
		expect(types(msgs)).toEqual(["DIRTY"]);

		d.up([["RESUME", L]]);
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]);
		expect(d.status).toBe("sentinel");
	});

	it("batch commit emits the un-dirty only after the batch body closes", () => {
		const b = node<number>([], null, { initial: 1 });
		const c = node<number>([], null);
		const d = node<number>([b, c], (ctx) =>
			ctx.down([
				["DATA", ((depLatest(ctx, 0) as number) ?? 0) + ((depLatest(ctx, 1) as number) ?? 0)],
			]),
		);
		const { msgs } = collect(d);
		msgs.length = 0;

		batch(() => {
			b.down([["DIRTY"]]);
			b.down([["INVALIDATE"]]);
			expect(types(msgs)).toEqual(["DIRTY"]);
		});

		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]);
	});
});

// C-20 (R-teardown-terminal-relay / D65): COMPLETE/ERROR seal value output, but they do not block
// a later upstream TEARDOWN needed to unwind downstream lifecycle.
describe("C-20 — TEARDOWN relays through a terminal intermediate (R-teardown-terminal-relay / D65)", () => {
	it("a completed node relays later upstream TEARDOWN without re-completing", () => {
		const s = node<number>([], null, { initial: 1 });
		const mid = node<number>([s], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			completeWhenDepsComplete: false,
		});
		const { msgs } = collect(mid);
		mid.down([["COMPLETE"]]);
		msgs.length = 0;

		s.down([["TEARDOWN"]]);

		expect(types(msgs)).toEqual(["TEARDOWN"]);
	});

	it("a terminal relay forwards repeated upstream TEARDOWNs without re-completing", () => {
		const s = node<number>([], null, { initial: 1 });
		const mid = node<number>([s], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			completeWhenDepsComplete: false,
		});
		const { msgs } = collect(mid);
		mid.down([["COMPLETE"]]);
		msgs.length = 0;

		s.down([["TEARDOWN"]]);
		s.down([["TEARDOWN"]]);

		expect(types(msgs)).toEqual(["TEARDOWN", "TEARDOWN"]);
	});
});

// C-21 (R-rewire-async-live-edge / D66): async ctx objects are allowed to keep the old dep input
// snapshot for reads, but their late up/down emissions target the node's live topology.
describe("C-21 — late async ctx emission uses live deps after rewire (R-rewire-async-live-edge / D66)", () => {
	it("a ctx captured before rewire routes ctx.up through the node's current deps", () => {
		let captured: Ctx | null = null;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 2 });
		const d = node<number>(
			[a],
			(ctx) => {
				captured = ctx;
			},
			{ pool: "async" },
		);
		collect(d);

		d.replaceDeps([b], () => {});
		(captured as Ctx).up([["INVALIDATE"]]);

		expect(a.cache).toBe(1);
		expect(b.cache).toBeUndefined();
	});
});

// C-22 (R-rewire-batch-boundary / D67): if a node has an uncommitted batched settle slice, an
// external rewire request waits until the batch commits, so the old slice is not overwritten.
describe("C-22 — batch commit precedes rewire requested during the open batch (R-rewire-batch-boundary / D67)", () => {
	it("commits the old batched DATA before applying the rewire's fresh DATA", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 10 });
		const fwd: NodeFn = (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		const d = node<number>([a], fwd);
		const { msgs } = collect(d);
		msgs.length = 0;

		batch(() => {
			d.down([["DATA", 2]]);
			d.replaceDeps([b], fwd);
			expect(d.deps[0]).toBe(a);
			expect(data(msgs)).toEqual([]);
		});

		expect(data(msgs)).toEqual([2, 10]);
		expect(d.deps[0]).toBe(b);
		expect(d.cache).toBe(10);
	});

	it("does not apply a deferred rewire when the batch rolls back", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 10 });
		const fwd: NodeFn = (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		const d = node<number>([a], fwd);
		const { msgs } = collect(d);
		msgs.length = 0;

		batch((bctx) => {
			d.down([["DATA", 2]]);
			d.replaceDeps([b], fwd);
			bctx.rollback();
		});

		expect(d.deps[0]).toBe(a);
		expect(data(msgs)).toEqual([]);
		expect(d.cache).toBe(1);
	});

	it("applies an accepted rewire after a terminal batch slice while terminal output stays sealed", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 10 });
		const fwd: NodeFn = (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		const d = node<number>([a], fwd, { completeWhenDepsComplete: false });
		const { msgs } = collect(d);
		msgs.length = 0;

		batch(() => {
			d.down([["COMPLETE"]]);
			d.replaceDeps([b], fwd);
			expect(d.deps[0]).toBe(a);
		});

		expect(d.status).toBe("completed");
		expect(d.deps[0]).toBe(b);
		expect(types(msgs)).toEqual(["DIRTY", "COMPLETE"]);
		msgs.length = 0;
		b.down([["DATA", 11]]);
		expect(msgs).toEqual([]);
	});

	it("returns the future index for an subscribeDep deferred behind a batch commit", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 10 });
		const sum: NodeFn = (ctx) =>
			ctx.down([
				["DATA", ((depLatest(ctx, 0) as number) ?? 0) + ((depLatest(ctx, 1) as number) ?? 0)],
			]);
		const d = node<number>([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
		collect(d);

		let idx = -2;
		batch(() => {
			d.down([["DATA", 2]]);
			idx = d.subscribeDep(b, sum);
			expect(d.deps).toEqual([a]);
		});

		expect(idx).toBe(1);
		expect(d.deps).toEqual([a, b]);
	});
});

// C-24 (R-snapshot/R-restore, D83/D117): restore is state-preserving. A restored dep-bearing
// node's first post-restore activation wires deps, but the restored deps' push-on-subscribe DATA
// is only bookkeeping seed data; it must not recompute over or clear the restored cache.
describe("C-24 snapshot restore preserves graph state and rejects local-only factories (R-restore / D117)", () => {
	it("late subscriber observes restored derived cache; dep activation does not recompute", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("c24.inc", (n) => n + 1);
		const mapped = original.initNode(map(inc), [src], { name: "mapped" });
		collect(mapped);
		expect(mapped.cache).toBe(2);

		const reloadedInc = define<number, number>("c24.inc", (n) => n + 100);
		const restored = restoreGraph(original.checkpoint(), {
			registry: restoreRegistry([reloadedInc], defaultRestoreRegistry),
		});
		const restoredMapped = restored.find("mapped") as Node<number>;
		const restoredSrc = restored.find("src") as { set(v: number): void };
		const { msgs } = collect(restoredMapped);

		expect(types(msgs)).toEqual(["START", "DATA"]);
		expect(data(msgs)).toEqual([2]);
		expect(restoredMapped.cache).toBe(2);
		expect(restored.describe().edges).toContainEqual({ from: "src", to: "mapped" });

		msgs.length = 0;
		restoredSrc.set(2);
		expect(data(msgs)).toEqual([102]);
		expect(restoredMapped.cache).toBe(102);
	});

	it("fails honestly for local-only and missing registry factories", () => {
		const localOnly = graph();
		const src = localOnly.state(1, { name: "src" });
		localOnly.derived([src], (n) => n, { name: "derived" });
		expect(() =>
			restoreGraph(localOnly.checkpoint(), { registry: defaultRestoreRegistry }),
		).toThrow(/local-only/);

		const missing = graph();
		missing.state(1, { name: "src" });
		expect(() => restoreGraph(missing.checkpoint(), { registry: {} })).toThrow(
			/missing registry descriptor/,
		);
	});
});
