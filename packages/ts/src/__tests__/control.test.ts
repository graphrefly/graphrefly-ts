import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("PAUSE/RESUME lockset (R-pause-lockset, R-pause-modes default)", () => {
	it("multi-source lockset: releasing one lock does not resume while another holds (C-5)", () => {
		const a = node<number>([], null, { initial: 1 });
		let runs = 0;
		const d = node<number>([a], (ctx: Ctx) => {
			runs++;
			ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 1]]);
		});
		collect(d);
		expect(d.cache).toBe(2);

		const LA = Symbol("LA");
		const LB = Symbol("LB");
		d.up([["PAUSE", LA]]);
		d.up([["PAUSE", LA]]); // same-id repeat is idempotent
		d.up([["PAUSE", LB]]);

		runs = 0;
		a.down([["DATA", 10]]); // dep wave while paused -> default mode skips fn
		expect(runs).toBe(0);
		expect(d.cache).toBe(2); // not recomputed yet

		d.up([["RESUME", LA]]); // LB still held -> stay paused
		expect(runs).toBe(0);
		d.up([["RESUME", Symbol("unknown")]]); // unknown id -> no-op
		expect(runs).toBe(0);

		d.up([["RESUME", LB]]); // final release -> fire once with latest
		expect(runs).toBe(1);
		expect(d.cache).toBe(11);
	});

	it("pausable:false ignores PAUSE/RESUME (timer-source semantics)", () => {
		const a = node<number>([], null, { initial: 1 });
		let runs = 0;
		const d = node<number>(
			[a],
			(ctx: Ctx) => {
				runs++;
				ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 1]]);
			},
			{ pausable: false },
		);
		collect(d);
		runs = 0;
		d.up([["PAUSE", Symbol()]]);
		a.down([["DATA", 5]]);
		expect(runs).toBe(1); // not gated
		expect(d.cache).toBe(6);
	});

	it("resumeAll buffers a compute DATA without synthesizing a mid-pause RESOLVED (B36)", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>(
			[a],
			(ctx: Ctx) => {
				ctx.down([["DATA", (ctx.depRecords[0].latest as number) + 1]]);
			},
			{ pausable: "resumeAll" },
		);
		const { msgs } = collect(d);
		expect(d.cache).toBe(2);
		msgs.length = 0;

		const L = Symbol("L");
		d.up([["PAUSE", L]]);
		a.down([["DATA", 10]]);

		expect(d.cache).toBe(2); // DATA is buffered, not applied while paused
		expect(types(msgs)).toEqual(["DIRTY"]); // no synthetic RESOLVED may pierce the pause

		d.up([["RESUME", L]]);
		expect(d.cache).toBe(11);
		// Replaying the buffered DATA emits a fresh DIRTY-before-DATA wave; the important B36
		// invariant is that no RESOLVED pierced the pause before this replay.
		expect(types(msgs)).toEqual(["DIRTY", "DIRTY", "DATA"]);
	});
});

describe("async pool (R-sync-core async label, R8 late-emit pairing)", () => {
	it("a late ctx.down from an async fn pairs DIRTY+DATA downstream", () => {
		const a = node<number>([], null, { initial: 3 });
		let resolve: (() => void) | null = null;
		const dbl = node<number>(
			[a],
			(ctx: Ctx) => {
				const v = ctx.depRecords[0].latest as number;
				resolve = () => ctx.down([["DATA", v * 2]]);
			},
			{ pool: "async" },
		);
		const { msgs } = collect(dbl);
		// fn ran synchronously (set resolve) but emitted nothing yet.
		expect(dbl.cache).toBeUndefined();
		expect(types(msgs)).toEqual(["START"]);

		resolve?.();
		expect(dbl.cache).toBe(6);
		expect(types(msgs)).toEqual(["START", "DIRTY", "DATA"]);
	});
});

describe("async-result at a paused node (R-async-paused / C-2)", () => {
	it("buffers the result while paused, replays on final RESUME", () => {
		const a = node<number>([], null, { initial: 3 });
		let resolve: (() => void) | null = null;
		const an = node<number>(
			[a],
			(ctx: Ctx) => {
				const v = ctx.depRecords[0].latest as number;
				resolve = () => ctx.down([["DATA", v * 2]]);
			},
			{ pool: "async" },
		);
		const { msgs } = collect(an);
		msgs.length = 0;

		const L = Symbol("L");
		an.up([["PAUSE", L]]);
		resolve?.(); // async result arrives while paused -> buffered, not delivered
		expect(an.cache).toBeUndefined();
		expect(types(msgs)).toEqual([]);

		an.up([["RESUME", L]]); // final RESUME -> replay buffered result
		expect(an.cache).toBe(6);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
	});
});

describe("replayBuffer (R-replay-buffer)", () => {
	it("late subscriber receives the last N DATA after START", () => {
		const s = node<number>([], null, { replayBuffer: 3 });
		collect(s);
		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]);
		s.down([["DATA", 3]]);
		s.down([["DATA", 4]]);

		const { msgs } = collect(s);
		expect(types(msgs)).toEqual(["START", "DATA", "DATA", "DATA"]);
		expect(msgs.slice(1).map((m) => m[1])).toEqual([2, 3, 4]);
	});
});
