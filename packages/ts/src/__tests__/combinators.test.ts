import { describe, expect, it } from "vitest";
import {
	buffer,
	bufferCount,
	combine,
	combineLatest,
	concat,
	fromIter,
	graph,
	type Message,
	race,
	sample,
	takeUntil,
	withLatestFrom,
	zip,
} from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const lastType = (msgs: Message[]) => msgs[msgs.length - 1]?.[0];

// CSP-2.7 Slice 2 (D40 / D45): multi-source combinators + notifier-driven operators as
// declared-dep nodes (NOT the frozen reference's banned internal-subscribe islands).
describe("Slice 2 — multi-source combinators (CSP-2.7 / D45)", () => {
	it("combine emits a tuple of latest values when any dep updates", () => {
		const g = graph();
		const a = g.state(1);
		const b = g.state("x");
		const c = g.initNode(combine<[number, string]>(), [a, b]);
		const msgs: Message[] = [];
		c.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([[1, "x"]]);
		a.set(2);
		b.set("y");
		expect(data(msgs)).toEqual([
			[1, "x"],
			[2, "x"],
			[2, "y"],
		]);
	});

	it("combineLatest is the combine alias", () => {
		expect(combineLatest).toBe(combine);
	});

	it("withLatestFrom pairs primary with the latest secondary (initial pair not dropped)", () => {
		const g = graph();
		const p = g.state(1);
		const s = g.state("a");
		const w = g.initNode(withLatestFrom<number, string>(), [p, s]);
		const msgs: Message[] = [];
		w.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([[1, "a"]]); // W1 fix — initial pair emitted
		p.set(2);
		s.set("b"); // secondary-only → no emit
		p.set(3);
		expect(data(msgs)).toEqual([
			[1, "a"],
			[2, "a"],
			[3, "b"],
		]);
	});

	it("withLatestFrom ignores secondary COMPLETE but propagates secondary ERROR", () => {
		const completeCase = graph();
		const primary = completeCase.state(1);
		const secondary = completeCase.state("a");
		const paired = completeCase.initNode(withLatestFrom<number, string>(), [primary, secondary]);
		const completeMsgs: Message[] = [];
		paired.subscribe((m) => completeMsgs.push(m));

		secondary.down([["COMPLETE"]]);
		primary.set(2);
		expect(data(completeMsgs)).toEqual([
			[1, "a"],
			[2, "a"],
		]);
		expect(paired.status).not.toBe("completed");

		const errorCase = graph();
		const primary2 = errorCase.state(1);
		const secondary2 = errorCase.state("a");
		const paired2 = errorCase.initNode(withLatestFrom<number, string>(), [primary2, secondary2]);
		const errorMsgs: Message[] = [];
		paired2.subscribe((m) => errorMsgs.push(m));
		const err = new Error("secondary boom");
		secondary2.down([["ERROR", err]]);
		expect(errorMsgs.at(-1)).toEqual(["ERROR", err]);
		expect(paired2.status).toBe("errored");
	});

	it("withLatestFrom completes only when the primary completes", () => {
		const g = graph();
		const primary = g.state(1);
		const secondary = g.state("a");
		const paired = g.initNode(withLatestFrom<number, string>(), [primary, secondary]);
		const msgs: Message[] = [];
		paired.subscribe((m) => msgs.push(m));

		secondary.set("b");
		expect(paired.status).not.toBe("completed");
		primary.down([["COMPLETE"]]);

		expect(data(msgs)).toEqual([[1, "a"]]);
		expect(msgs.at(-1)?.[0]).toBe("COMPLETE");
		expect(paired.status).toBe("completed");
	});

	it("zip combines one value from each dep in lockstep, completes with the shorter", () => {
		const g = graph();
		const a = g.initNode(fromIter([1, 2, 3]), []);
		const b = g.initNode(fromIter(["a", "b"]), []);
		const z = g.initNode(zip<[number, string]>(), [a, b]);
		const msgs: Message[] = [];
		z.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([
			[1, "a"],
			[2, "b"],
		]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("zip with no deps completes immediately", () => {
		const g = graph();
		const z = g.initNode(zip<[]>(), []);
		const msgs: Message[] = [];
		z.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([]);
		expect(lastType(msgs)).toBe("COMPLETE");
		expect(z.status).toBe("completed");
	});

	it("concat plays all of dep 0 then all of dep 1, then COMPLETE", () => {
		const g = graph();
		const a = g.initNode(fromIter([1, 2]), []);
		const b = g.initNode(fromIter([3, 4]), []);
		const c = g.initNode(concat<number>(), [a, b]);
		const msgs: Message[] = [];
		c.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1, 2, 3, 4]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("race forwards only the first dep to deliver DATA", () => {
		const g = graph();
		const a = g.initNode(fromIter([1, 2]), []);
		const b = g.initNode(fromIter([10, 20]), []);
		const r = g.initNode(race<number>(), [a, b]);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1, 2]); // a subscribed first → wins; b ignored
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("race (n>=3): a live dep can still win after others terminate empty (QA: no double-count)", () => {
		// Regression for the cross-wave terminal double-count: with 3 deps, two completing empty in
		// separate waves must NOT prematurely COMPLETE the race while the 3rd is still live.
		const g = graph();
		const a = g.node<number>([], null); // manual sources, silent until .down
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const r = g.initNode(race<number>(), [a, b, c]);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		a.down([["COMPLETE"]]); // 1 terminal
		b.down([["COMPLETE"]]); // 2 terminal — OLD code: 1+2=3>=n → premature COMPLETE
		expect(r.status).not.toBe("completed"); // c still live → race open
		c.down([["DATA", 99]]); // c wins
		c.down([["DATA", 100]]);
		expect(data(msgs)).toEqual([99, 100]);
		c.down([["COMPLETE"]]); // winner terminal → COMPLETE
		expect(r.status).toBe("completed");
	});

	it("race COMPLETEs when EVERY dep terminates without any DATA", () => {
		const g = graph();
		const a = g.node<number>([], null);
		const b = g.node<number>([], null);
		const c = g.node<number>([], null);
		const r = g.initNode(race<number>(), [a, b, c]);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		a.down([["COMPLETE"]]);
		b.down([["COMPLETE"]]);
		expect(r.status).not.toBe("completed");
		c.down([["COMPLETE"]]); // all terminal, no winner → COMPLETE
		expect(data(msgs)).toEqual([]);
		expect(r.status).toBe("completed");
	});
});

describe("Slice 2 — notifier-driven (D46 first-cut)", () => {
	it("buffer flushes accumulated source DATA on each notifier signal", () => {
		const g = graph();
		const src = g.state(1);
		const notify = g.state(false);
		const b = g.initNode(buffer<number>(), [src, notify]);
		const msgs: Message[] = [];
		b.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([[1]]); // notifier's initial flushes [1]
		src.set(2);
		src.set(3);
		notify.set(true);
		expect(data(msgs)).toEqual([[1], [2, 3]]);
	});

	it("bufferCount batches into fixed-size arrays, flushes remainder on COMPLETE", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4, 5]), []);
		const b = g.initNode(bufferCount<number>(2), [src]);
		const msgs: Message[] = [];
		b.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([[1, 2], [3, 4], [5]]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("sample emits the latest source value on each notifier signal", () => {
		const g = graph();
		const src = g.state(1);
		const notify = g.state(false);
		const s = g.initNode(sample<number>(), [src, notify]);
		const msgs: Message[] = [];
		s.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1]); // notifier initial samples the latest source (1)
		src.set(2);
		notify.set(true);
		expect(data(msgs)).toEqual([1, 2]);
	});

	it("sample clears the held source value on source COMPLETE and completes on notifier COMPLETE", () => {
		const g = graph();
		const src = g.state(1);
		const notify = g.node<boolean>([]);
		const sampled = g.initNode(sample<number>(), [src, notify]);
		const msgs: Message[] = [];
		sampled.subscribe((m) => msgs.push(m));

		src.set(2);
		src.down([["COMPLETE"]]);
		notify.down([["DATA", true]]);
		expect(data(msgs)).toEqual([]); // source COMPLETE clears the held value; no flush.

		notify.down([["COMPLETE"]]);
		expect(msgs.at(-1)?.[0]).toBe("COMPLETE");
		expect(sampled.status).toBe("completed");
	});

	it("sample forwards ERROR from either source or notifier", () => {
		const sourceCase = graph();
		const src = sourceCase.state(1);
		const notify = sourceCase.node<boolean>([]);
		const sampled = sourceCase.initNode(sample<number>(), [src, notify]);
		const sourceMsgs: Message[] = [];
		sampled.subscribe((m) => sourceMsgs.push(m));
		const sourceErr = new Error("source boom");
		src.down([["ERROR", sourceErr]]);
		expect(sourceMsgs.at(-1)).toEqual(["ERROR", sourceErr]);
		expect(sampled.status).toBe("errored");

		const notifierCase = graph();
		const src2 = notifierCase.state(1);
		const notify2 = notifierCase.node<boolean>([]);
		const sampled2 = notifierCase.initNode(sample<number>(), [src2, notify2]);
		const notifierMsgs: Message[] = [];
		sampled2.subscribe((m) => notifierMsgs.push(m));
		const notifierErr = new Error("notifier boom");
		notify2.down([["ERROR", notifierErr]]);
		expect(notifierMsgs.at(-1)).toEqual(["ERROR", notifierErr]);
		expect(sampled2.status).toBe("errored");
	});

	it("takeUntil forwards source DATA until the notifier delivers, then COMPLETE", () => {
		const g = graph();
		const src = g.state(1);
		const stop = g.node<boolean>([]); // silent until .down (no initial → SENTINEL)
		const tu = g.initNode(takeUntil<number>(), [src, stop]);
		const msgs: Message[] = [];
		tu.subscribe((m) => msgs.push(m));
		src.set(2);
		stop.down([["DATA", true]]); // notifier fires → stop
		src.set(3); // terminated, ignored
		expect(data(msgs)).toEqual([1, 2]);
		expect(tu.status).toBe("completed");
	});

	it("takeUntil ignores notifier COMPLETE without DATA and still forwards source COMPLETE", () => {
		const g = graph();
		const src = g.state(1);
		const stop = g.node<boolean>([]);
		const tu = g.initNode(takeUntil<number>(), [src, stop]);
		const msgs: Message[] = [];
		tu.subscribe((m) => msgs.push(m));

		stop.down([["COMPLETE"]]);
		src.set(2);
		expect(data(msgs)).toEqual([1, 2]);
		expect(tu.status).not.toBe("completed");

		src.down([["COMPLETE"]]);
		expect(msgs.at(-1)?.[0]).toBe("COMPLETE");
		expect(tu.status).toBe("completed");
	});

	it("describe shows the combinator factory names (D6)", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		g.initNode(combine<[number, number]>(), [a, b], { name: "c" });
		g.initNode(zip<[number, number]>(), [a, b], { name: "z" });
		const byId = Object.fromEntries(g.describe().nodes.map((n) => [n.id, n]));
		expect(byId.c.factory).toBe("combine");
		expect(byId.z.factory).toBe("zip");
	});
});
