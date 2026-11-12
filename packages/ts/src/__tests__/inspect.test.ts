import { describe, expect, it } from "vitest";
import type { ObserveEvent } from "../index.js";
import { Dispatcher, graph } from "../index.js";
import { dataValues } from "./helpers/collect.js";

describe("observe — an ordinary subscriber, one event per array (R-graph-surface@1)", () => {
	it("hands on { id, msgs } per delivered array, START first, with no tier or sequence", () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		g.derived([count], (n) => n! * 2, { name: "doubled" });

		const events: ObserveEvent[] = [];
		const stop = g.observe(["doubled"], (e) => events.push(e));
		// the START array, with the value, is the first event
		expect(events).toEqual([{ id: "doubled", msgs: [["START"], ["DATA", 0]] }]);

		count.set(5);
		expect(events[1]).toEqual({ id: "doubled", msgs: [["PENDING"], ["DATA", 10]] });
		expect(Object.keys(events[1] ?? {}).sort()).toEqual(["id", "msgs"]);
		stop();
	});

	it("observing a whole graph is observing every id describe gives; observe adds no node", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		g.derived([a], (n) => n! + 1, { name: "b" });
		const events: ObserveEvent[] = [];
		g.observe(
			g.describe().map((n) => n.id),
			(e) => events.push(e),
		);
		a.set(2);
		expect(new Set(events.map((e) => e.id))).toEqual(new Set(["a", "b"]));
		expect(dataValues(events.filter((e) => e.id === "b").flatMap((e) => e.msgs))).toEqual([2, 3]);
		expect(g.describe().map((n) => n.id)).toEqual(["a", "b"]);
	});

	it("rejects an id the graph does not have", () => {
		const g = graph();
		expect(() => g.observe(["missing"], () => {})).toThrow(/observe: no node 'missing'/);
	});
});

describe("profile — dispatcher-backed counters, never on the thin node (R-profile / D39)", () => {
	it("counts invokes per node when profiling is enabled (opt-in)", () => {
		const g = graph({ dispatcher: new Dispatcher(), profile: true });
		const s = g.state(0, { name: "s" });
		const d = g.derived([s], (n) => n! + 1, { name: "d" });
		d.subscribe(() => {});
		s.set(1);
		s.set(2);
		const p = g.profile();
		// d's fn ran: once on activation + once per set = 3
		expect(p.nodes.d.invokes).toBe(3);
		expect(p.nodes.d.status.cache).toBe("ready");
		// state node has no fn → no invokes
		expect(p.nodes.s.invokes).toBe(0);
		expect(p.totalInvokes).toBeGreaterThanOrEqual(3);
	});

	it("default graph does not record (zero overhead, F-PERF)", () => {
		const g = graph({ dispatcher: new Dispatcher() }); // profile not enabled
		const s = g.state(0, { name: "s" });
		const d = g.derived([s], (n) => n! + 1, { name: "d" });
		d.subscribe(() => {});
		s.set(1);
		expect(g.profile().nodes.d.invokes).toBe(0); // not recorded
		expect(g.profile().totalInvokes).toBe(0);
	});
});
