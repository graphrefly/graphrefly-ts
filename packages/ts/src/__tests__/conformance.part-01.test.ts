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
	depBatch,
	depCount,
	depLatest,
	depTerminal,
	distinctUntilChanged,
	filter,
	fromIter,
	graph,
	isTerminalComplete,
	type Node,
	node,
	take,
} from "../index.js";
import { eachMessage } from "../node/each-message.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const _flush = () => new Promise((r) => setTimeout(r, 0));
function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe(eachMessage((m) => msgs.push(m)));
	return { msgs, unsub };
}

describe("C-3 INVALIDATE × ctx.state × onInvalidate (R-invalidate-idempotent, R-ctx-state)", () => {
	it("cascades once, fires onInvalidate, preserves ctx.state, resets dep cached latest", () => {
		const statesAtRun: unknown[] = [];
		let onInv = 0;
		const s = node<number>([], null, { initial: 1 });
		const d = node<number>([s], (ctx: Ctx) => {
			statesAtRun.push(ctx.state.get()); // prior state visible at run time
			ctx.state.set("kept");
			ctx.onInvalidate(() => {
				onInv++;
			});
			ctx.down([["DATA", (depLatest(ctx, 0) as number) * 2]]);
		});
		const { msgs } = collect(d);
		expect(d.cache).toBe(2);
		expect(statesAtRun).toEqual([undefined]); // first run: fresh state

		msgs.length = 0;
		s.down([["INVALIDATE"]]);
		expect(types(msgs)).toEqual(["PENDING", "INVALIDATE"]); // cascaded downstream exactly once
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

describe("C-4 a sync leg and an async leg: the async result is a later wave, nothing waits across it (R-wave, R-invocation)", () => {
	it("settles the async leg with the kernel's RESOLVED in A's wave; its result is a later wave", () => {
		let dRuns = 0;
		let cctx: Ctx | null = null;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 10]]),
		); // sync leg
		const cOut: Message[] = [];
		const c = node<number>(
			[a],
			(ctx: Ctx) => {
				cctx = ctx; // async leg: the result comes later through this ctx
			},
			{ pool: "async" },
		);
		c.subscribe(eachMessage((m) => cOut.push(m)));
		const d = node<number>([b, c], (ctx: Ctx) => {
			dRuns++;
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]);
		});

		const { msgs } = collect(d);
		// The first-run gate (TS sugar, not protocol) holds d until c has a value.
		expect(dRuns).toBe(0);
		(cctx as Ctx).down([["DATA", 21]]);
		expect(dRuns).toBe(1);
		expect(d.cache).toBe(32); // 11 + 21

		msgs.length = 0;
		cOut.length = 0;
		a.down([["DATA", 2]]);
		// In A's wave c sent nothing, so the kernel settled it; d ran once on b's new value and
		// c's old one, and no PENDING stays open while c's work runs.
		expect(types(cOut)).toEqual(["PENDING", "RESOLVED"]);
		expect(dRuns).toBe(2);
		expect(d.cache).toBe(33); // 12 + 21
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(d.status).not.toBe("dirty");

		// c's result is a new wave from c, in which d runs once more.
		msgs.length = 0;
		(cctx as Ctx).down([["DATA", 30]]);
		expect(dRuns).toBe(3);
		expect(d.cache).toBe(42); // 12 + 30
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
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

describe("C-8 intra-graph runtime rewire (R-rewire / D42)", () => {
	it("surgical subscribeDep (push-on-subscribe) → unsubscribeDep (drain) → idempotent replaceDeps; cache preserved", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null, { initial: 100 }); // B carries cached DATA
		const aOnly = (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		const sum = (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]);
		const d = node<number>([a], aOnly);
		collect(d);
		expect(d.cache).toBe(1); // (1) A settled → D ran

		d.subscribeDep(b, sum); // (2) subscribeDep(B): B cached → push-on-subscribe → D recomputes
		expect(d.cache).toBe(101); // 1 + 100

		b.down([["DATA", 50]]); // (3) B drives D
		expect(d.cache).toBe(51); // 1 + 50

		d.unsubscribeDep(a, aOnly); // (4) unsubscribeDep(A) → deps = [B]
		expect(d.cache).toBe(51); // cache PRESERVED (A was not dirty — no recompute)

		a.down([["DATA", 9]]); // (5) A no longer drives D — its edge is drained
		expect(d.cache).toBe(51);

		b.down([["DATA", 7]]); // B is dep0 now → drives D
		expect(d.cache).toBe(7);

		let runs = 0;
		const f = (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		};
		d.replaceDeps([b], f); // (6) replaceDeps to the current set → idempotent
		expect(runs).toBe(0); // no spurious recompute
		expect(d.cache).toBe(7);
	});

	it("rejects rewire on a terminal node (throw → graph-layer ERROR, D30)", () => {
		const a = node<number>([], null, { initial: 1 });
		const id = (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		const d = node<number>([a], id, { completeWhenDepsComplete: false });
		collect(d);
		d.down([["COMPLETE"]]); // D terminal
		expect(() => d.replaceDeps([a], id)).toThrow(/terminal/);
	});
});

// C-11 (D47 / R-rewire-deferred): a node fn's SELF-triggered dep-set mutation via ctx.rewireNext
// is deferred to the committed wave boundary (never mutating _deps mid-run, never the D37 in-fn
// reject), drained as a fresh wave; added cached inners push [PENDING,DATA] without re-arming the
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
			for (let i = 1; i < depCount(ctx); i++) {
				const b = depBatch(ctx, i);
				if (b) for (const v of b) ctx.down([["DATA", v as number]]);
				if (isTerminalComplete(depTerminal(ctx, i))) removals.push(inners[i - 1]);
			}
			const sv = depBatch(ctx, 0);
			if (sv && sv.length > 0) {
				const inner = makeInner((sv[sv.length - 1] as number) * 10);
				inners.push(inner.node);
				ctx.rewireNext.subscribeDep(inner.node, opFn);
			}
			for (const r of removals) {
				inners.splice(inners.indexOf(r), 1);
				ctx.rewireNext.unsubscribeDep(r, opFn);
			}
		};
		return node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
	}

	it("(steps 1-3) subscribeDep deferred to the boundary; added cached inner pushes [PENDING,DATA], gate not re-armed", () => {
		const s = node<number>([], null);
		let opRuns = 0;
		const inners: Node<number>[] = [];
		const opFn: NodeFn = (ctx) => {
			opRuns++;
			for (let i = 1; i < depCount(ctx); i++) {
				const b = depBatch(ctx, i);
				if (b) for (const v of b) ctx.down([["DATA", v as number]]);
			}
			const sv = depBatch(ctx, 0);
			if (sv && sv.length > 0) {
				const inner = makeInner((sv[sv.length - 1] as number) * 10);
				inners.push(inner.node);
				// mid-run: _deps is NOT mutated — the inner is not yet wired/activated.
				expect(inner.isActivated()).toBe(false);
				ctx.rewireNext.subscribeDep(inner.node, opFn);
				expect(inner.isActivated()).toBe(false); // still deferred after the request
			}
		};
		const op = node<number>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // step 1: request subscribeDep(innerA); step 2: drain wires it; step 3: forward
		expect(types(msgs)).toContain("PENDING"); // step 2 boundary wave is two-phase…
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

	it("(steps 4-6, switch) replaceDeps tears down the superseded inner's source and forwards only the new one", () => {
		const s = node<number>([], null);
		const innerA = makeInner(10);
		const innerB = makeInner(20);
		let current: Node<number> | null = null;
		const opFn: NodeFn = (ctx) => {
			for (let i = 1; i < depCount(ctx); i++) {
				const b = depBatch(ctx, i);
				if (b) for (const v of b) ctx.down([["DATA", v as number]]);
			}
			const sv = depBatch(ctx, 0);
			if (sv && sv.length > 0) {
				current = (sv[sv.length - 1] as number) === 1 ? innerA.node : innerB.node;
				ctx.rewireNext.replaceDeps([s, current], opFn);
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
		// g.derived carries the D30 value-throw→ERROR boundary; the fn does an IMMEDIATE self-subscribeDep
		// (NOT ctx.rewireNext) mid-run → the D37 reject throws → graph layer converts it to ERROR.
		op = g.derived([a], (av) => {
			op.subscribeDep(x, (c) => c.down([["DATA", depLatest(c, 0) as number]]));
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
			if (depBatch(ctx, 0)) {
				ctx.rewireNext.subscribeDep(inner.node, opFn); // queued…
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
		expect(inner.isActivated()).toBe(true); // D62: queued subscribeDep drains after terminal
		expect(op.deps).toContain(inner.node);
		msgs.length = 0;
		inner.emit(2);
		expect(msgs).toEqual([]); // terminal output guard: no post-terminal DATA escapes
	});

	it("(variant) a terminal OP drains a queued unsubscribeDep, releasing helper-owned work", () => {
		const s = node<number>([], null);
		const inner = makeInner(1);
		let added = false;
		const opFn: NodeFn = (ctx) => {
			if (!added && depBatch(ctx, 0)) {
				added = true;
				ctx.rewireNext.subscribeDep(inner.node, opFn);
				return;
			}
			if (isTerminalComplete(depTerminal(ctx, 0))) {
				ctx.rewireNext.unsubscribeDep(inner.node, opFn);
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
			if (runs < 5) ctx.rewireNext.replaceDeps([a], opFn); // identical dep set every run
			ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		});
		collect(op);
		expect(runs).toBe(1); // the idempotent replaceDeps changes nothing → no fresh wave → no loop
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
		// activation: 50 rejected, f never produced — no PENDING on activation, no synth
		expect(f.status).toBe("sentinel");
		expect(f.cache).toBeUndefined();
		msgs.length = 0;

		s.set(60); // rejected: PENDING'd but no value → substrate-synthesized undirty RESOLVED
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]); // un-dirtied, no DATA, not wedged
		expect(f.status).toBe("sentinel"); // never valued
		msgs.length = 0;

		s.set(150); // accepted → real DATA occurrence
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(f.cache).toBe(150);
		msgs.length = 0;

		s.set(70); // rejected, but f now carries 150 → undirty RESOLVED, status resolved
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]);
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
		const s = node<number>([], null, { initial: 1 });
		collect(s);
		expect(() => s.down([["DATA", 2], ["RESOLVED"]])).toThrow(/kernel/);
		expect(s.cache).toBe(1);
	});
});
