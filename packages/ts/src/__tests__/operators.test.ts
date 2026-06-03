import { describe, expect, it, vi } from "vitest";
import type { Message } from "../index.js";
import {
	catchError,
	distinctUntilChanged,
	elementAt,
	filter,
	find,
	first,
	fromIter,
	graph,
	initNode,
	last,
	map,
	merge,
	node,
	onFirstData,
	pairwise,
	reduce,
	rescue,
	scan,
	settle,
	skip,
	take,
	takeWhile,
	tap,
	valve,
} from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const lastType = (msgs: Message[]) => msgs[msgs.length - 1]?.[0];

// D43: operators are free-standing factory definitions instantiated via the generic
// g.initNode funnel (config folded into the factory; fn params annotated). describe still
// shows the real factory name (D6) — recorded at initNode→_add, node stays thin.
describe("core operators (free-standing factories via g.initNode, D43/D6)", () => {
	it("map emits fn(value)", () => {
		const g = graph();
		const s = g.state(1);
		const m = g.initNode(
			map((n: number) => n * 2),
			[s],
		);
		const msgs: Message[] = [];
		m.subscribe((x) => msgs.push(x));
		expect(m.cache).toBe(2);
		s.set(3);
		expect(m.cache).toBe(6);
		expect(data(msgs)).toEqual([2, 6]);
	});

	it("map consumes every DATA occurrence in one dep-batch (B43 / D49)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3]), []);
		const m = g.initNode(
			map((n: number) => n * 10),
			[src],
		);
		const msgs: Message[] = [];
		m.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([10, 20, 30]);
	});

	it("map does not treat same-wave INVALIDATE SENTINEL as DATA (D77/R-sentinel)", () => {
		const s = node<number>([], null, { initial: 1 });
		const m = initNode(
			map((n: number) => n * 2),
			[s],
		);
		const msgs: Message[] = [];
		m.subscribe((x) => msgs.push(x));
		msgs.length = 0;

		s.down([["DATA", 9], ["INVALIDATE"]]);

		expect(msgs).toEqual([["DIRTY"], ["DATA", 18], ["INVALIDATE"]]);
		expect(m.cache).toBeUndefined();
		expect(m.status).toBe("sentinel");
	});

	it("filter emits only when pred holds", () => {
		const g = graph();
		const s = g.state(2);
		const evens = g.initNode(
			filter((n: number) => n % 2 === 0),
			[s],
		);
		const msgs: Message[] = [];
		evens.subscribe((x) => msgs.push(x));
		s.set(3); // filtered out
		s.set(4);
		expect(data(msgs)).toEqual([2, 4]);
		expect(evens.cache).toBe(4);
	});

	it("filter consumes every DATA occurrence in one dep-batch (B43 / D49)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const evens = g.initNode(
			filter((n: number) => n % 2 === 0),
			[src],
		);
		const msgs: Message[] = [];
		evens.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([2, 4]);
	});

	it("downstream map does not re-emit stale DATA on upstream RESOLVED (B43)", () => {
		const g = graph();
		const s = g.state(2);
		const evens = g.initNode(
			filter((n: number) => n % 2 === 0),
			[s],
		);
		const m = g.initNode(
			map((n: number) => n * 10),
			[evens],
		);
		const msgs: Message[] = [];
		m.subscribe((x) => msgs.push(x));
		s.set(3); // filtered out => evens settles with RESOLVED, no new DATA
		expect(data(msgs)).toEqual([20]);
	});

	it("scan accumulates with a seed", () => {
		const g = graph();
		const s = g.state(1);
		const sum = g.initNode(
			scan((acc: number, v: number) => acc + v, 0),
			[s],
		);
		const msgs: Message[] = [];
		sum.subscribe((x) => msgs.push(x));
		s.set(2);
		s.set(3);
		expect(data(msgs)).toEqual([1, 3, 6]);
	});

	it("scan accumulates every DATA occurrence in one dep-batch (B43 / D49)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3]), []);
		const sum = g.initNode(
			scan((acc: number, v: number) => acc + v, 0),
			[src],
		);
		const msgs: Message[] = [];
		sum.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([1, 3, 6]);
	});

	it("take emits the first n then COMPLETE (terminal-is-forever)", () => {
		const g = graph();
		const s = g.state(1);
		const first2 = g.initNode(take<number>(2), [s]);
		const msgs: Message[] = [];
		first2.subscribe((x) => msgs.push(x));
		s.set(2); // 2nd value → DATA + COMPLETE (a DIRTY precedes the DATA, two-phase)
		s.set(3); // ignored (terminated)
		expect(data(msgs)).toEqual([1, 2]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
		expect(first2.status).toBe("completed");
	});

	it("take counts occurrences inside one dep-batch (B43 / D49)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3]), []);
		const first2 = g.initNode(take<number>(2), [src]);
		const msgs: Message[] = [];
		first2.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1, 2]);
		expect(first2.status).toBe("completed");
	});

	it("take(0) emits no DATA and completes immediately", () => {
		const g = graph();
		const s = g.state(1);
		const none = g.initNode(take<number>(0), [s]);
		const msgs: Message[] = [];
		none.subscribe((m) => msgs.push(m));
		const terminalMsgs = [...msgs];
		s.set(2); // ignored after terminal completion
		expect(data(msgs)).toEqual([]);
		expect(lastType(msgs)).toBe("COMPLETE");
		expect(msgs).toEqual(terminalMsgs);
		expect(none.status).toBe("completed");
	});

	it("take completes quietly when upstream completes before n", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2]), []);
		const first5 = g.initNode(take<number>(5), [src]);
		const msgs: Message[] = [];
		first5.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1, 2]);
		expect(lastType(msgs)).toBe("COMPLETE");
		expect(first5.status).toBe("completed");
	});

	it("distinctUntilChanged suppresses repeats", () => {
		const g = graph();
		const s = g.state(1);
		const d = g.initNode(distinctUntilChanged<number>(), [s]);
		const msgs: Message[] = [];
		d.subscribe((x) => msgs.push(x));
		s.set(1); // same → suppressed
		s.set(2);
		s.set(2); // same → suppressed
		s.set(3);
		expect(data(msgs)).toEqual([1, 2, 3]);
	});

	it("distinctUntilChanged handles repeats within one dep-batch (B43)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 1, 2, 2, 3]), []);
		const d = g.initNode(distinctUntilChanged<number>(), [src]);
		const msgs: Message[] = [];
		d.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([1, 2, 3]);
	});

	it("merge interleaves several sources (partial — fires on any)", () => {
		const g = graph();
		const a = g.state(1);
		const b = g.state(2);
		const m = g.initNode(merge<number>(), [a, b]);
		const vals: unknown[] = [];
		m.subscribe((msg) => {
			if (msg[0] === "DATA") vals.push(msg[1]);
		});
		expect(vals).toContain(1);
		expect(vals).toContain(2);
		a.set(10);
		expect(vals).toContain(10);
		b.set(20);
		expect(vals).toContain(20);
	});

	it("describe shows the real operator factory name (D6), not 'derived'", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		g.initNode(
			map((n: number) => n + 1),
			[s],
			{ name: "inc" },
		);
		g.initNode(
			filter((n: number) => n > 0),
			[s],
			{ name: "pos" },
		);
		const snap = g.describe();
		const byId = Object.fromEntries(snap.nodes.map((n) => [n.id, n]));
		expect(byId.inc.factory).toBe("map");
		expect(byId.pos.factory).toBe("filter");
	});

	it("operators work bare (no Graph) via the free initNode", () => {
		const g = graph();
		const s = g.state(5);
		// Bare-node path (D43): the free initNode builds a working Node with NO graph
		// registration (s is created on g, the bare operator just subscribes to it).
		const doubled = initNode(
			map((n: number) => n * 2),
			[s],
		);
		const msgs: Message[] = [];
		doubled.subscribe((x) => msgs.push(x));
		expect(doubled.cache).toBe(10);
		s.set(6);
		expect(doubled.cache).toBe(12);
		expect(data(msgs)).toEqual([10, 12]);
	});
});

// CSP-2.7 catalog re-derive (D40): Slice 1 (single-dep transform/take/control) + Slice 3
// (error-handling). Per-language sugar (D6/D24, never in parity). Terminal-emitting operators read
// depTerminal(ctx, 0) (R-deps-terminal). D49: every occurrence is DATA; a no-emit wave →
// substrate-synthesized undirty RESOLVED.
describe("Slice 1 — single-dep transform/take/control (CSP-2.7)", () => {
	it("reduce emits the final accumulator on source COMPLETE", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3]), []);
		const r = g.initNode(
			reduce((acc: number, v: number) => acc + v, 0),
			[src],
		);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([6]);
		expect(lastType(msgs)).toBe("COMPLETE");
		expect(r.status).toBe("completed");
	});

	it("reduce on an empty source emits the seed", () => {
		const g = graph();
		const empty = g.initNode(fromIter<number>([]), []);
		const r = g.initNode(
			reduce((acc: number, v: number) => acc + v, 42),
			[empty],
		);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([42]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("pairwise emits consecutive [prev, curr]; first value produces no pair", () => {
		const g = graph();
		const s = g.state(1);
		const p = g.initNode(pairwise<number>(), [s]);
		const msgs: Message[] = [];
		p.subscribe((m) => msgs.push(m));
		s.set(2);
		s.set(3);
		expect(data(msgs)).toEqual([
			[1, 2],
			[2, 3],
		]);
	});

	it("pairwise emits in-batch consecutive pairs (B43)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const p = g.initNode(pairwise<number>(), [src]);
		const msgs: Message[] = [];
		p.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([
			[1, 2],
			[2, 3],
			[3, 4],
		]);
	});

	it("skip drops the first n DATA", () => {
		const g = graph();
		const s = g.state(1);
		const sk = g.initNode(skip<number>(2), [s]);
		const msgs: Message[] = [];
		sk.subscribe((m) => msgs.push(m));
		s.set(2); // skipped (count 1)
		s.set(3); // emitted
		s.set(4); // emitted
		expect(data(msgs)).toEqual([3, 4]);
	});

	it("skip drops occurrences inside one dep-batch (B43)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const sk = g.initNode(skip<number>(2), [src]);
		const msgs: Message[] = [];
		sk.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([3, 4]);
	});

	it("skip can swallow the full upstream window without leaking DATA", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2]), []);
		const sk = g.initNode(skip<number>(2), [src]);
		const msgs: Message[] = [];
		sk.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([]);
		expect(lastType(msgs)).toBe("COMPLETE");
		expect(sk.status).toBe("completed");
	});

	it("takeWhile emits while pred holds, then COMPLETE (non-inclusive)", () => {
		const g = graph();
		const s = g.state(1);
		const tw = g.initNode(
			takeWhile((n: number) => n < 3),
			[s],
		);
		const msgs: Message[] = [];
		tw.subscribe((m) => msgs.push(m));
		s.set(2);
		s.set(3); // fails pred → COMPLETE, not emitted
		s.set(4); // terminated, ignored
		expect(data(msgs)).toEqual([1, 2]);
		expect(tw.status).toBe("completed");
	});

	it("takeWhile processes each in-batch occurrence and completes at first failing item (B43)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const tw = g.initNode(
			takeWhile((n: number) => n < 3),
			[src],
		);
		const msgs: Message[] = [];
		tw.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1, 2]);
		expect(tw.status).toBe("completed");
	});

	it("first emits the first matching value then COMPLETE", () => {
		const g = graph();
		const s = g.state(1);
		const f = g.initNode(
			first((n: number) => n > 2),
			[s],
		);
		const msgs: Message[] = [];
		f.subscribe((m) => msgs.push(m));
		s.set(2); // no match
		s.set(5); // first match
		s.set(6); // terminated
		expect(data(msgs)).toEqual([5]);
		expect(f.status).toBe("completed");
	});

	it("first picks the earliest matching occurrence in one dep-batch (B43)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const f = g.initNode(
			first((n: number) => n > 1),
			[src],
		);
		const msgs: Message[] = [];
		f.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([2]);
		expect(f.status).toBe("completed");
	});

	it("last emits the last matching value on COMPLETE", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const l = g.initNode(
			last((n: number) => n % 2 === 0),
			[src],
		);
		const msgs: Message[] = [];
		l.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([4]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("last no-match completes without emitting DATA", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 3]), []);
		const l = g.initNode(
			last((n: number) => n % 2 === 0),
			[src],
		);
		const msgs: Message[] = [];
		l.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([]);
		expect(lastType(msgs)).toBe("COMPLETE");
		expect(l.status).toBe("completed");
	});

	it("find emits the first matching value then COMPLETE", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2, 3, 4]), []);
		const fd = g.initNode(
			find((n: number) => n > 2),
			[src],
		);
		const msgs: Message[] = [];
		fd.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([3]);
		expect(fd.status).toBe("completed");
	});

	it("find not-found → bare COMPLETE (no undefined emit, SENTINEL edge)", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2]), []);
		const fd = g.initNode(
			find((n: number) => n > 100),
			[src],
		);
		const msgs: Message[] = [];
		fd.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("elementAt emits the value at the index then COMPLETE", () => {
		const g = graph();
		const src = g.initNode(fromIter([10, 20, 30]), []);
		const e = g.initNode(elementAt<number>(1), [src]);
		const msgs: Message[] = [];
		e.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([20]);
		expect(e.status).toBe("completed");
	});

	it("tap (function form) runs the side effect and passes values through", () => {
		const g = graph();
		const s = g.state(1);
		const spy = vi.fn();
		const t = g.initNode(tap<number>(spy), [s]);
		const msgs: Message[] = [];
		t.subscribe((m) => msgs.push(m));
		s.set(2);
		expect(data(msgs)).toEqual([1, 2]);
		expect(spy.mock.calls).toEqual([[1], [2]]);
	});

	it("tap (observer form) observes data + complete", () => {
		const g = graph();
		const src = g.initNode(fromIter([7, 8]), []);
		const onData = vi.fn();
		const onComplete = vi.fn();
		const t = g.initNode(tap<number>({ data: onData, complete: onComplete }), [src]);
		const msgs: Message[] = [];
		t.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([7, 8]);
		expect(onData.mock.calls).toEqual([[7], [8]]);
		expect(onComplete).toHaveBeenCalledOnce();
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("onFirstData fires once on the first qualifying value", () => {
		const g = graph();
		const s = g.state(1);
		const spy = vi.fn();
		const o = g.initNode(onFirstData<number>(spy), [s]);
		const msgs: Message[] = [];
		o.subscribe((m) => msgs.push(m));
		s.set(2);
		s.set(3);
		expect(data(msgs)).toEqual([1, 2, 3]);
		expect(spy).toHaveBeenCalledOnce();
		expect(spy).toHaveBeenCalledWith(1);
	});

	it("settle forwards DATA and COMPLETEs after quietWaves of no change", () => {
		const g = graph();
		const s = g.state(1);
		const st = g.initNode(settle<number>({ quietWaves: 2, equals: (a, b) => a === b }), [s]);
		const msgs: Message[] = [];
		st.subscribe((m) => msgs.push(m));
		s.set(1); // no change → quiet 1
		s.set(1); // no change → quiet 2 → COMPLETE
		expect(data(msgs)).toEqual([1, 1, 1]);
		expect(st.status).toBe("completed");
	});

	it("describe shows the real catalog factory names (D6)", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		g.initNode(skip<number>(1), [s], { name: "sk" });
		g.initNode(pairwise<number>(), [s], { name: "pw" });
		const byId = Object.fromEntries(g.describe().nodes.map((n) => [n.id, n]));
		expect(byId.sk.factory).toBe("skip");
		expect(byId.pw.factory).toBe("pairwise");
	});
});

describe("Slice 3 — error-handling control (CSP-2.7)", () => {
	// A source that ERRORs on a sentinel value (D30 throw→ERROR at the derived boundary).
	const flakyChain = (g: ReturnType<typeof graph>) => {
		const s = g.state(1);
		const bad = g.derived([s], (v: number) => {
			if (v === 2) throw new Error("boom");
			return v * 10;
		});
		return { s, bad };
	};

	it("rescue replaces an upstream ERROR with a recovered value (stream stays live)", () => {
		const g = graph();
		const { s, bad } = flakyChain(g);
		const r = g.initNode(
			rescue<number>(() => -1),
			[bad],
		);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([10]);
		s.set(2); // bad throws → ERROR → rescue recovers → -1
		expect(data(msgs)).toEqual([10, -1]);
		expect(r.status).not.toBe("errored");
	});

	it("rescue forwards a normal source COMPLETE", () => {
		const g = graph();
		const src = g.initNode(fromIter([1, 2]), []);
		const r = g.initNode(
			rescue<number>(() => -1),
			[src],
		);
		const msgs: Message[] = [];
		r.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1, 2]);
		expect(lastType(msgs)).toBe("COMPLETE");
	});

	it("catchError is the rescue alias", () => {
		expect(catchError).toBe(rescue);
	});

	it("valve gates DATA on a boolean control, re-emits on gate open", () => {
		const g = graph();
		const src = g.state(1);
		const open = g.state(true);
		const v = g.initNode(valve<number>(), [src, open]);
		const msgs: Message[] = [];
		v.subscribe((m) => msgs.push(m));
		expect(data(msgs)).toEqual([1]); // open at activation → forwards
		open.set(false); // close
		src.set(2); // gated out
		expect(data(msgs)).toEqual([1]);
		open.set(true); // re-open → re-emit last source value (2)
		expect(data(msgs)).toEqual([1, 2]);
	});

	it("valve fires abortInFlight on the truthy→falsy edge only", () => {
		const g = graph();
		const src = g.state(1);
		const open = g.state(true);
		const ctrl = new AbortController();
		const v = g.initNode(valve<number>({ abortInFlight: ctrl }), [src, open]);
		v.subscribe(() => {});
		expect(ctrl.signal.aborted).toBe(false);
		open.set(false); // truthy→falsy edge → abort
		expect(ctrl.signal.aborted).toBe(true);
	});
});
