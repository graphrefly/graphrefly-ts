import { describe, expect, it } from "vitest";
import type { ObserveEvent, ObserveStream } from "../index.js";
import { coalesceObserve, Dispatcher, filterObserve, graph } from "../index.js";

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

describe("observe helpers — read-only egress sugar (R-observe / D39)", () => {
	function observeFrom(events: readonly ObserveEvent[], onUnsubscribe?: () => void): ObserveStream {
		return {
			subscribe(sink) {
				for (const event of events) {
					sink(event);
				}
				return () => onUnsubscribe?.();
			},
		};
	}

	it("filterObserve forwards matching events and preserves source unsubscribe", () => {
		const events: ObserveEvent[] = [
			{ path: "a", msg: ["DIRTY"], tier: 2, seq: 1 },
			{ path: "a", msg: ["DATA", 1], tier: 3, seq: 2 },
			{ path: "b", msg: ["DATA", 2], tier: 3, seq: 3 },
			{ path: "a", msg: ["DATA", 3], tier: 3, seq: 4 },
		];
		let unsubscribes = 0;
		const seen: ObserveEvent[] = [];

		const stop = filterObserve(
			observeFrom(events, () => {
				unsubscribes += 1;
			}),
			(event) => event.path === "a" && event.msg[0] === "DATA",
		).subscribe((event) => seen.push(event));

		expect(seen.map((event) => event.seq)).toEqual([2, 4]);
		stop();
		expect(unsubscribes).toBe(1);
	});

	it("coalesceObserve suppresses adjacent duplicates without reordering retained seq values", () => {
		const events: ObserveEvent[] = [
			{ path: "a", msg: ["DATA", 1], tier: 3, seq: 1 },
			{ path: "a", msg: ["DATA", 1], tier: 3, seq: 2 },
			{ path: "a", msg: ["DATA", 2], tier: 3, seq: 3 },
			{ path: "b", msg: ["DATA", 2], tier: 3, seq: 4 },
			{ path: "b", msg: ["DATA", 2], tier: 3, seq: 5 },
			{ path: "a", msg: ["DATA", 1], tier: 3, seq: 6 },
			{ path: "a", msg: ["DIRTY"], tier: 2, seq: 7 },
			{ path: "a", msg: ["DIRTY"], tier: 2, seq: 8 },
		];
		const seen: ObserveEvent[] = [];

		coalesceObserve(observeFrom(events)).subscribe((event) => seen.push(event));

		expect(seen.map((event) => event.seq)).toEqual([1, 3, 4, 6, 7]);
		expect(seen.map((event) => event.msg[0])).toEqual(["DATA", "DATA", "DATA", "DATA", "DIRTY"]);
	});

	it("coalesceObserve accepts a caller-owned equality for narrower egress coalescing", () => {
		const events: ObserveEvent[] = [
			{ path: "a", msg: ["DATA", 1], tier: 3, seq: 1 },
			{ path: "a", msg: ["DATA", 2], tier: 3, seq: 2 },
			{ path: "b", msg: ["DATA", 2], tier: 3, seq: 3 },
		];
		const seen: ObserveEvent[] = [];

		coalesceObserve(observeFrom(events), (prev, next) => prev.path === next.path).subscribe(
			(event) => seen.push(event),
		);

		expect(seen.map((event) => event.seq)).toEqual([1, 3]);
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
