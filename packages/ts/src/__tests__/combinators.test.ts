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
