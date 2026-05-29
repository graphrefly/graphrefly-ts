import { describe, expect, it } from "vitest";
import type { Message } from "../index.js";
import { distinctUntilChanged, filter, graph, initNode, map, merge, scan, take } from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

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
