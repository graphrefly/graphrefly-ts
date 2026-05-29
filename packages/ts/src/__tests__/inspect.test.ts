import { describe, expect, it } from "vitest";
import type { ObserveEvent } from "../index.js";
import { Dispatcher, graph } from "../index.js";

describe("observe — read-only enveloped egress (R-observe / D39)", () => {
	it("streams ObserveEvents with path/msg/tier/seq; cached node pushes on subscribe", () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		doubled.subscribe(() => {}); // activate so it has a cache

		const events: ObserveEvent[] = [];
		const stop = g.observe("doubled").subscribe((e) => events.push(e));
		// push-on-subscribe: the cached DATA arrives immediately
		expect(events.some((e) => e.path === "doubled" && e.msg[0] === "DATA")).toBe(true);

		count.set(5);
		const data = events.filter((e) => e.msg[0] === "DATA").map((e) => e.msg[1]);
		expect(data).toContain(10);
		// envelope carries tier + a monotonic seq
		const last = events[events.length - 1];
		expect(typeof last.seq).toBe("number");
		expect(last.tier).toBe(3); // DATA tier
		stop();
	});

	it("whole-graph observe (no path) taps every node; observe is NOT itself a node", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		g.derived([a], (n) => n + 1, { name: "b" });
		const events: ObserveEvent[] = [];
		g.observe().subscribe((e) => events.push(e));
		a.set(2);
		const paths = new Set(events.map((e) => e.path));
		expect(paths.has("a")).toBe(true);
		expect(paths.has("b")).toBe(true);
		// observing did not add a node to the graph (egress, not a node)
		expect(
			g
				.describe()
				.nodes.map((n) => n.id)
				.sort(),
		).toEqual(["a", "b"]);
	});
});

describe("profile — dispatcher-backed counters, never on the thin node (R-profile / D39)", () => {
	it("counts invokes per node when profiling is enabled (opt-in)", () => {
		const g = graph({ dispatcher: new Dispatcher(), profile: true });
		const s = g.state(0, { name: "s" });
		const d = g.derived([s], (n) => n + 1, { name: "d" });
		d.subscribe(() => {});
		s.set(1);
		s.set(2);
		const p = g.profile();
		// d's fn ran: once on activation + once per set = 3
		expect(p.nodes.d.invokes).toBe(3);
		expect(p.nodes.d.status).toBe("settled");
		// state node has no fn → no invokes
		expect(p.nodes.s.invokes).toBe(0);
		expect(p.totalInvokes).toBeGreaterThanOrEqual(3);
	});

	it("default graph does not record (zero overhead, F-PERF)", () => {
		const g = graph({ dispatcher: new Dispatcher() }); // profile not enabled
		const s = g.state(0, { name: "s" });
		const d = g.derived([s], (n) => n + 1, { name: "d" });
		d.subscribe(() => {});
		s.set(1);
		expect(g.profile().nodes.d.invokes).toBe(0); // not recorded
		expect(g.profile().totalInvokes).toBe(0);
	});
});
