/**
 * Deferred SELF-rewire — ctx.rewireNext (R-rewire-deferred / D47 / CSP-2.7).
 *
 * Focused substrate units for the wave-boundary-deferred dep-set mutation that higher-order
 * operators (switchMap/mergeMap/...) build on: defer-not-immediate, drain at the committed
 * boundary, added cached inner pushes [DIRTY,DATA] with the gate NOT re-armed, removed inner
 * drains + deactivates (onDeactivation = abortInFlight), terminal-drains-queue (D62), no-net-change
 * no-op, and the immediate in-fn path still throwing (D37). The exhaustive interleavings are the
 * TLA+ model (~/src/graphrefly/formal/wave_rewire_deferred.tla); the canonical scenario is C-11.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message, NodeFn } from "../index.js";
import {
	batch,
	depBatch,
	depCount,
	depLatest,
	depTerminal,
	graph,
	isTerminalComplete,
	type Node,
	node,
} from "../index.js";

function collect(n: Node) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const types = (m: Message[]) => m.map((x) => x[0]);
const data = (m: Message[]) =>
	m.filter((x) => x[0] === "DATA").map((x) => (x as ["DATA", unknown])[1]);

/** A leaf-source inner whose activation + deactivation are observable (cancellation visible). */
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

describe("ctx.rewireNext — defer + drain (R-rewire-deferred / D47)", () => {
	it("defers addDep to the boundary — NOT applied in place during the fn run", () => {
		const inner = makeInner(99);
		const s = node<number>([], null); // no initial → op's fn first-runs on the driven DATA
		let deferredCorrectly = false;
		const op: Node<number> = node<number>(
			[s],
			function opFn(ctx) {
				if (depBatch(ctx, 0)) {
					ctx.rewireNext.addDep(inner.node, opFn);
					// still inside the fn run: the dep must NOT be wired yet (inner not activated).
					deferredCorrectly = !inner.isActivated();
				}
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		collect(op);

		s.down([["DATA", 1]]); // drives op's fn → requests addDep → drains at this call's boundary
		expect(deferredCorrectly).toBe(true); // mid-fn: inner was NOT yet a live dep
		expect(inner.isActivated()).toBe(true); // post-boundary: drained → inner wired + activated
	});

	it("the added cached inner pushes [DIRTY,DATA] and is forwarded; the gate is NOT re-armed", () => {
		const inner = makeInner(); // no seed — emits on demand
		const s = node<number>([], null); // no initial
		let opRuns = 0;
		const op: Node<number> = node<number>(
			[s],
			function opFn(ctx) {
				opRuns++;
				for (let i = 1; i < depCount(ctx); i++) {
					const b = depBatch(ctx, i);
					if (b) for (const v of b) ctx.down([["DATA", v as number]]);
				}
				if (depBatch(ctx, 0)) ctx.rewireNext.addDep(inner.node, opFn);
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		const { msgs } = collect(op);
		s.down([["DATA", 1]]); // spawn + add inner (SENTINEL inner → START only, no forward yet)
		msgs.length = 0;
		opRuns = 0;

		inner.emit(7); // inner DATA → op forwards as a two-phase wave
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // glitch-free, R-dirty-before-data
		expect(data(msgs)).toEqual([7]);

		// gate NOT re-armed: S alone re-drives op without waiting on the added inner again.
		opRuns = 0;
		s.down([["DATA", 2]]); // also spawns a SECOND inner (deferred); the fn still ran on S alone
		expect(opRuns).toBeGreaterThan(0);
	});

	it("removeDep at the boundary drains the inner + fires onDeactivation (abortInFlight)", () => {
		const inner = makeInner(5);
		const s = node<number>([], null); // no initial
		const inners: Node<number>[] = [];
		const op: Node<number> = node<number>(
			[s],
			function opFn(ctx) {
				const removals: Node<number>[] = [];
				for (let i = 1; i < depCount(ctx); i++) {
					const b = depBatch(ctx, i);
					if (b) for (const v of b) ctx.down([["DATA", v as number]]);
					if (isTerminalComplete(depTerminal(ctx, i))) removals.push(inners[i - 1]);
				}
				if (depBatch(ctx, 0)) {
					inners.push(inner.node);
					ctx.rewireNext.addDep(inner.node, opFn);
				}
				for (const r of removals) {
					inners.splice(inners.indexOf(r), 1);
					ctx.rewireNext.removeDep(r, opFn);
				}
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		const { msgs } = collect(op);
		s.down([["DATA", 1]]); // add inner (seed 5 forwarded on activation)
		expect(inner.isActivated()).toBe(true);
		expect(data(msgs)).toContain(5);

		inner.complete(); // inner COMPLETE → op requests removeDep → drains → inner deactivates
		expect(inner.isDeactivated()).toBe(true); // input-side teardown observable
	});
});

describe("ctx.rewireNext — switch (setDeps) + terminal + no-net-change (D47/D62)", () => {
	it("setDeps atomically tears down the superseded inner and wires the new one", () => {
		const innerA = makeInner(10);
		const innerB = makeInner(20);
		const s = node<number>([], null); // no initial
		let current: Node<number> | null = null;
		const op: Node<number> = node<number>(
			[s],
			function opFn(ctx) {
				for (let i = 1; i < depCount(ctx); i++) {
					const b = depBatch(ctx, i);
					if (b) for (const v of b) ctx.down([["DATA", v as number]]);
				}
				const sv = depBatch(ctx, 0);
				if (sv && sv.length > 0) {
					current = (sv[sv.length - 1] as number) === 1 ? innerA.node : innerB.node;
					ctx.rewireNext.setDeps([s, current], opFn); // switch: one atomic op
				}
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // → inner = innerA (seed 10 forwarded)
		expect(data(msgs)).toContain(10);
		expect(innerA.isActivated()).toBe(true);
		msgs.length = 0;

		s.down([["DATA", 2]]); // switch → innerB; innerA torn down (cancelled)
		expect(innerB.isActivated()).toBe(true);
		expect(innerA.isDeactivated()).toBe(true); // superseded inner's SOURCE torn down, not masked
		expect(data(msgs)).toContain(20); // only the new inner forwarded
		msgs.length = 0;

		innerA.emit(999); // the cancelled inner is DRAINED — no stale forward
		expect(data(msgs)).toEqual([]);
	});

	it("a terminal OP still drains pending rewireNext addDep, but later inner output is sealed", () => {
		const inner = makeInner(1);
		const s = node<number>([], null, { initial: 0 });
		const op: Node<number> = node<number>(
			[s],
			function opFn(ctx) {
				if (depBatch(ctx, 0)) {
					ctx.rewireNext.addDep(inner.node, opFn); // queued…
					ctx.down([["COMPLETE"]]); // …then the OP goes terminal THIS wave
				}
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		collect(op);
		s.down([["DATA", 1]]);
		expect(op.status).toBe("completed");
		expect(inner.isActivated()).toBe(true); // D62: queued addDep drains after terminal
		expect(op.deps).toContain(inner.node);
		inner.emit(2);
		expect(op.cache).toBeUndefined(); // terminal output guard: no post-terminal DATA escapes
	});

	it("a terminal OP drains pending removeDep and deactivates the helper dep", () => {
		const inner = makeInner(1);
		const s = node<number>([], null);
		let added = false;
		const op: Node<number> = node<number>(
			[s],
			function opFn(ctx) {
				if (!added && depBatch(ctx, 0)) {
					added = true;
					ctx.rewireNext.addDep(inner.node, opFn);
					return;
				}
				if (isTerminalComplete(depTerminal(ctx, 0))) {
					ctx.rewireNext.removeDep(inner.node, opFn);
					ctx.down([["COMPLETE"]]);
				}
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		collect(op);
		s.down([["DATA", 1]]);
		expect(inner.isActivated()).toBe(true);
		s.down([["COMPLETE"]]);
		expect(op.status).toBe("completed");
		expect(op.deps).not.toContain(inner.node);
		expect(inner.isDeactivated()).toBe(true);
	});

	it("a no-net-change rewireNext is a no-op (no recompute, no drain loop)", () => {
		const a = node<number>([], null, { initial: 1 });
		let runs = 0;
		const op: Node<number> = node<number>([a], function opFn(ctx) {
			runs++;
			if (runs < 5) ctx.rewireNext.setDeps([a], opFn); // same dep set every run
			ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		});
		collect(op);
		// activation ran once; the idempotent setDeps drains but changes nothing → no fresh
		// settle wave → no re-run. (A net-changing op re-issued every boundary WOULD loop —
		// that is a user-level runaway, not asserted here.)
		expect(runs).toBe(1);
		expect(op.cache).toBe(1);
	});

	it("the immediate in-fn path still throws (D37) — rewireNext is the only legal self-rewire", () => {
		const a = node<number>([], null, { initial: 1 });
		const x = node<number>([], null, { initial: 9 });
		const op: Node<number> = node<number>([a], function opFn(ctx) {
			op.addDep(x, opFn); // IMMEDIATE self-rewire mid-fn → feedback cycle
			ctx.down([["DATA", depLatest(ctx, 0) as number]]);
		});
		expect(() => collect(op)).toThrow(/mid-fn|feedback/);
	});
});

describe("ctx.rewireNext — drain robustness (QA: per-thunk isolation)", () => {
	it("a throwing thunk (error-route hits a throwing sink) does NOT strand a sibling's rewire", () => {
		// QA fix: _applyRewireNext catches an invalid op and routes [[ERROR,e]] down; if that ERROR
		// broadcast reaches a throwing external sink, the escape must NOT abandon the rest of the
		// global drain queue (else a sibling's queued rewire would silently fire at a LATER wave).
		const sA = node<number>([], null);
		const sB = node<number>([], null);
		const innerB = makeInner(7);
		// opA: its deferred op is invalid (self-dep) → _rewire throws → _applyRewireNext routes ERROR.
		const opA: Node<number> = node<number>(
			[sA],
			function fnA(ctx) {
				if (depBatch(ctx, 0)) ctx.rewireNext.addDep(opA, fnA); // self-dep → throws at apply
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		// an external sink on opA that THROWS on ERROR → forces the error-route _down to escape apply().
		opA.subscribe((m) => {
			if (m[0] === "ERROR") throw new Error("sink boom");
		});
		// opB: a perfectly valid deferred addDep, queued AFTER opA's in the same drain.
		const opB: Node<number> = node<number>(
			[sB],
			function fnB(ctx) {
				if (depBatch(ctx, 0)) ctx.rewireNext.addDep(innerB.node, fnB);
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		collect(opB);

		// one batch → both fns run at commit → both thunks queue → drained together at the boundary.
		expect(() =>
			batch(() => {
				sA.down([["DATA", 1]]); // opA's thunk queued first
				sB.down([["DATA", 1]]); // opB's thunk queued second
			}),
		).toThrow(/sink boom/); // the first escape re-surfaces after the queue drains
		expect(innerB.isActivated()).toBe(true); // opB's rewire STILL applied despite opA's throw
	});
});

describe("ctx.rewireNext — batch boundary (D47 / B24)", () => {
	it("a rewireNext issued during batch commit drains AFTER the commit", () => {
		const g = graph();
		const inner = makeInner(42);
		const s = g.node([], null); // manual source, no initial (op's fn first-runs on the driven DATA)
		const op: Node<number> = g.node(
			[s],
			function opFn(ctx: Ctx) {
				for (let i = 1; i < depCount(ctx); i++) {
					const b = depBatch(ctx, i);
					if (b) for (const v of b) ctx.down([["DATA", v as number]]);
				}
				if (depBatch(ctx, 0)) ctx.rewireNext.addDep(inner.node, opFn as NodeFn);
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		const { msgs } = collect(op);

		batch(() => {
			s.down([["DATA", 1]]); // deferred to commit; op's fn runs at commit → requests addDep
			expect(inner.isActivated()).toBe(false); // NOT applied mid-batch (un-committed view)
		});
		// after the batch boundary (post-commit): drained → inner wired + its seed forwarded
		expect(inner.isActivated()).toBe(true);
		expect(data(msgs)).toContain(42);
	});
});
