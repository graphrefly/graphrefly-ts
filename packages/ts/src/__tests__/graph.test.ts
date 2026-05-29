import { describe, expect, it } from "vitest";
import type { Message } from "../index.js";
import { graph } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	n.subscribe((m) => msgs.push(m));
	return msgs;
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("Graph — 8-verb sugar (CSP-2)", () => {
	it("state + derived: value-level fn computes from dep values (D27)", () => {
		const g = graph();
		const count = g.state(0);
		const doubled = g.derived([count], (n) => n * 2);
		collect(doubled);
		expect(doubled.cache).toBe(0);
		count.set(5);
		expect(doubled.cache).toBe(10);
	});

	it("derived over multiple deps receives typed values in order", () => {
		const g = graph();
		const a = g.state(2);
		const b = g.state(3);
		const sum = g.derived([a, b], (x, y) => x + y);
		collect(sum);
		expect(sum.cache).toBe(5);
		b.set(10);
		expect(sum.cache).toBe(12);
	});

	it("effect runs on dep settle and registers a deactivation cleanup", () => {
		const g = graph();
		const s = g.state(1);
		const seen: number[] = [];
		let cleaned = 0;
		const e = g.effect([s], (n) => {
			seen.push(n);
			return () => {
				cleaned++;
			};
		});
		const unsub = e.subscribe(() => {});
		expect(seen).toEqual([1]);
		s.set(2);
		expect(seen).toEqual([1, 2]);
		unsub(); // last subscriber → deactivate → cleanup
		expect(cleaned).toBe(1);
	});

	it("D30: a value-level fn that throws emits ERROR downstream (not a crash)", () => {
		const g = graph();
		const s = g.state(1);
		const bad = g.derived([s], (n) => {
			if (n > 0) throw new Error("boom");
			return n;
		});
		const msgs = collect(bad);
		expect(types(msgs)).toContain("ERROR");
		expect(bad.status).toBe("errored");
	});

	it("R-reentrancy via graph (D37): a synchronous feedback cycle yields ERROR, not a hang", () => {
		const g = graph();
		const s = g.state(0);
		const d = g.derived([s], (n) => n + 1);
		const seen: Message[] = [];
		// effect feeds back into s → S→D→E→S cycle. The substrate rejects the re-entry
		// (throw); the graph layer's value-level boundary catches it → ERROR. No hang.
		const e = g.effect([d], (n) => {
			s.set(n as number);
		});
		expect(() => e.subscribe((m) => seen.push(m))).not.toThrow(); // caught, not escaped
		// R-reentrancy: the ERROR lands on a node ON the cycle — the value-level catch nearest
		// the throw on the synchronous unwind (impl-determined, d or e), NOT necessarily the
		// re-entered node. Assert SOME cycle node errored, not which (per the amended spec).
		expect([d.status, e.status]).toContain("errored");
	});
});

describe("Graph.describe — snapshot shape (R-describe / D39)", () => {
	it("emits a flat snapshot with ids, factory names, status, value, deps, edges", () => {
		const g = graph({ name: "demo" });
		const count = g.state(0, { name: "count" });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);

		const snap = g.describe();
		expect(snap.name).toBe("demo");
		const byId = Object.fromEntries(snap.nodes.map((n) => [n.id, n]));
		expect(byId.count.factory).toBe("state");
		expect(byId.count.value).toBe(5);
		expect(byId.count.status).toBe("settled");
		expect(byId.doubled.factory).toBe("derived");
		expect(byId.doubled.value).toBe(10);
		expect(byId.doubled.deps).toEqual(["count"]);
		expect(snap.edges).toContainEqual({ from: "count", to: "doubled" });
	});

	it("absent value field = SENTINEL (never-emitted)", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		g.derived([s], (n) => n, { name: "d" }); // not subscribed → never runs
		const snap = g.describe();
		const dNode = snap.nodes.find((n) => n.id === "d");
		expect(dNode && "value" in dNode).toBe(false); // SENTINEL → field absent
	});

	it("explain mode filters to the causal chain from→to", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.derived([a], (x) => x + 1, { name: "b" });
		const c = g.derived([b], (x) => x + 1, { name: "c" });
		const side = g.state(9, { name: "side" }); // off the a→c chain
		collect(c);
		collect(g.derived([side], (x) => x, { name: "sideD" }));

		const snap = g.describe({ explain: { from: "a", to: "c" } });
		const ids = snap.nodes.map((n) => n.id).sort();
		expect(ids).toEqual(["a", "b", "c"]);
	});

	it("mount nests a subgraph under a :: prefixed path", () => {
		const parent = graph({ name: "p" });
		parent.state(0, { name: "root" });
		const child = graph({ name: "c" });
		child.state(1, { name: "leaf" });
		parent.mount(child, { at: "sub" });

		const snap = parent.describe();
		expect(snap.subgraphs?.[0].nodes.some((n) => n.id === "sub::leaf")).toBe(true);
	});
});
