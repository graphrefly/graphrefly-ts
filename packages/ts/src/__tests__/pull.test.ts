/**
 * R-pull (D55) + R-up-routing (D59) — pull-mode node (NodeOptions.pullId:<Symbol>) unit edges beyond
 * the C-16 conformance scenario: the owed-demand machinery (a demand that can't fire immediately is
 * deferred and fired when able) across its three triggers — pin-5 (a dep DIRTY in flight), F4/F5 (an
 * external PAUSE lock co-holds the node), B1/F6 (an in-flight dep settles via INVALIDATE/terminal) —
 * plus reactivation-restores-quiet, an unknown-pullId demand is a silent no-op, the multi-dep
 * first-run-gate guard (QA-B2), and a pull node never push-on-subscribes (QA-B4).
 *
 * Authority: ~/src/graphrefly/spec/rules.jsonl R-pull / R-up-routing / R-pause-modes / R-rewire-deferred
 * (D55, D59). The end-to-end quiet/absorb + cone-routing + reject/defer/immediate matrix is C-16.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { node } from "../index.js";

const types = (m: Message[]) => m.map((x) => x[0]);
const data = (m: Message[]) =>
	m.filter((x) => x[0] === "DATA").map((x) => (x as ["DATA", unknown])[1]);
function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const snapFn = (ctx: Ctx) => ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
const PID = Symbol("pullId"); // an author-supplied pullId, shared by the node + the demander

describe("R-pull / R-up-routing (D55, D59) — pull-mode node finer edges", () => {
	it("pin 5: a demand arriving while a dep DIRTY is in flight is OWED, fires once settle-ready (1:1)", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PID });
		const { msgs } = collect(snap);
		msgs.length = 0;

		acc.down([["DIRTY"]]); // phase 1 only — an ACC change in flight, no settle yet (pending>0)
		expect(msgs).toEqual([]); // absorbed while quiet
		snap.up([["RESUME", PID]]); // DEMAND while NOT settle-ready → OWED
		expect(msgs).toEqual([]); // deferred — nothing delivered yet

		acc.down([["DATA", 5]]); // ACC settles → settle-ready → the owed demand fires
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]); // one delivery, DIRTY-before-DATA
		expect(data(msgs)).toEqual([5]);
		msgs.length = 0;

		snap.up([["RESUME", PID]]); // re-quieted: a no-change demand is silent
		expect(msgs).toEqual([]);
	});

	it("F4/F5: a demand arriving while the node is EXTERNALLY paused is OWED, fires on external resume", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PID });
		const ext = Symbol("external-pause");
		const { msgs } = collect(snap);
		msgs.length = 0;
		acc.down([["DATA", 9]]); // a change coalesced while quiet

		snap.up([["PAUSE", ext]]); // an EXTERNAL party also pauses SNAP (lockset = {pullId, ext})
		snap.up([["RESUME", PID]]); // DEMAND while externally paused → cannot fire now → OWED
		expect(msgs).toEqual([]); // not lost, not fired yet

		snap.up([["RESUME", ext]]); // external resume → the owed demand fires (pull/pause orthogonal)
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(data(msgs)).toEqual([9]);
	});

	it("B1/F6: an owed demand is serviced (not stranded) when the in-flight dep settles via INVALIDATE", () => {
		const acc = node<number>([], null, { initial: 1 });
		const snap = node<number>([acc], snapFn, { pullId: PID });
		const { msgs } = collect(snap);
		msgs.length = 0;

		acc.down([["DIRTY"]]); // ACC change in flight (pending>0)
		snap.up([["RESUME", PID]]); // DEMAND → OWED
		acc.down([["INVALIDATE"]]); // ACC's value is GONE — settles pending with NO new value
		// the owed demand is serviced (silent — no coalesced value) and CLEARED, not stranded:
		acc.down([["DATA", 8]]); // a fresh ACC value coalesces
		snap.up([["RESUME", PID]]); // a fresh demand → delivers the new value (node not stuck)
		expect(data(msgs)).toEqual([8]); // exactly one delivery for the fresh demand (owed one didn't double-fire)
	});

	it("QA: a throwing pull fn does NOT leave the node permanently non-quiet (pullId re-held in finally)", () => {
		const acc = node<number>([], null, { initial: 0 });
		let boom = false;
		const snap = node<number>(
			[acc],
			(ctx: Ctx) => {
				if (boom) throw new Error("boom");
				ctx.down([["DATA", ctx.depRecords[0].latest as number]]);
			},
			{ pullId: PID },
		);
		collect(snap);
		acc.down([["DATA", 1]]); // coalesced while quiet
		boom = true;
		expect(() => snap.up([["RESUME", PID]])).toThrow(/boom/); // demand fires the fn → throws

		// the finally re-held the pullId → the node is STILL quiet: a further ACC change is ABSORBED
		// (the fn does NOT run, so no re-throw). With the bug (pullId left deleted) the node would be
		// non-quiet → the change drives the fn → throws again.
		expect(() => acc.down([["DATA", 2]])).not.toThrow();
	});

	it("reactivation restores QUIET (deactivate → re-subscribe = START only, demand still works)", () => {
		const acc = node<number>([], null, { initial: 0 });
		const snap = node<number>([acc], snapFn, { pullId: PID });
		const first = collect(snap);
		first.unsub(); // last subscriber gone → snap deactivates (lockset cleared, RAM cache dropped)

		const { msgs } = collect(snap); // re-subscribe
		expect(types(msgs)).toEqual(["START"]); // quiet restored — no cached push on re-subscribe
		msgs.length = 0;

		acc.down([["DATA", 9]]); // absorbed (quiet again, the wedge fix survives reactivation)
		expect(msgs).toEqual([]);
		snap.up([["RESUME", PID]]); // demand still works after reactivation
		expect(data(msgs)).toEqual([9]);
	});

	it("a cone-routed RESUME whose pullId no node holds is a silent no-op (drops at the source terminus)", () => {
		const src = node<number>([], null, { initial: 1 });
		const mid = node<number>([src], (ctx: Ctx) => ctx.down([["DATA", ctx.depRecords[0].latest]]));
		const { msgs } = collect(mid);
		msgs.length = 0;
		// demand a pullId NO node up the cone holds → forwards up → drops at the depless source. No throw, no emit.
		expect(() => mid.up([["RESUME", Symbol("nobody")]])).not.toThrow();
		expect(msgs).toEqual([]);
	});

	it("QA-B2: a demand before a MULTI-dep pull node's first-run gate opens stays SILENT (no dangling DIRTY)", () => {
		const a = node<number>([], null); // no initial — delivers only when driven
		const b = node<number>([], null);
		const sum = (ctx: Ctx) =>
			ctx.down([
				[
					"DATA",
					((ctx.depRecords[0].latest as number) ?? 0) + ((ctx.depRecords[1].latest as number) ?? 0),
				],
			]);
		const snap = node<number>([a, b], sum, { pullId: PID }); // non-partial → gate needs BOTH deps
		const { msgs } = collect(snap);
		msgs.length = 0;

		a.down([["DATA", 10]]); // only A delivers while quiet → coalesced, but the gate still needs B
		snap.up([["RESUME", PID]]); // DEMAND before the gate opens
		expect(msgs).toEqual([]); // SILENT — no value to deliver, and crucially NO dangling DIRTY (no wedge)

		b.down([["DATA", 5]]); // B delivers → the gate is now open (snap still quiet, coalesces)
		snap.up([["RESUME", PID]]); // DEMAND now deliverable
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(data(msgs)).toEqual([15]);
	});

	it("QA-B4: a pull node never push-on-subscribes its cache, incl. across reactivation (START only)", () => {
		const src = node<number>([], null, { pullId: PID, initial: 42 }); // depless pull state node (has a cache)
		const first = collect(src);
		expect(types(first.msgs)).toEqual(["START"]); // quiet from birth — initial NOT pushed on subscribe
		first.unsub(); // deactivate — a depless non-compute node PRESERVES its cache
		expect(src.cache).toBe(42);

		const { msgs } = collect(src); // re-subscribe
		expect(types(msgs)).toEqual(["START"]); // STILL quiet — cache NOT leaked on reactivation (the B4 fix)
	});
});
