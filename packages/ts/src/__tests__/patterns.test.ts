import { describe, expect, it } from "vitest";
import { Dispatcher, graph, type ObserveTraceEvent } from "../index.js";
import { observeTrace, profileSummary } from "../patterns/index.js";

describe("patterns inspection helpers (B62 / D125)", () => {
	it("observeTrace records structured stage-labeled observe events without adding topology", () => {
		let now = 1_000;
		const clock = () => {
			now += 10;
			return now;
		};
		const g = graph();
		const count = g.state(1, { name: "count" });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		doubled.subscribe(() => {});
		const lines: string[] = [];

		const trace = observeTrace(g, {
			paths: ["doubled"],
			stageLabels: { doubled: "compute" },
			includeTypes: ["DATA"],
			detail: "full",
			logger: (line) => lines.push(line),
			nowNs: clock,
		});

		count.set(2);
		trace.dispose();
		count.set(3);

		const events = trace.events as readonly ObserveTraceEvent[];
		expect(events.map((event) => event.data)).toEqual([2, 4]);
		expect(events.every((event) => event.stage === "compute")).toBe(true);
		expect(events.every((event) => event.type === "DATA")).toBe(true);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("[compute] doubled DATA 2");
		expect(
			g
				.describe()
				.nodes.map((node) => node.id)
				.sort(),
		).toEqual(["count", "doubled"]);
	});

	it("observeTrace cleans up subscriptions if attachment throws during cached delivery", () => {
		const g = graph();
		const count = g.state(1, { name: "count" });
		let calls = 0;

		expect(() =>
			observeTrace(g, {
				paths: ["count"],
				includeTypes: ["DATA"],
				logger: () => {
					calls += 1;
					throw new Error("logger failed");
				},
			}),
		).toThrow(/logger failed/);

		expect(calls).toBe(1);
		expect(() => count.set(2)).not.toThrow();
		expect(calls).toBe(1);
	});

	it("profileSummary rolls up graph-local profile counters", () => {
		const g = graph({ dispatcher: new Dispatcher(), profile: true });
		const count = g.state(0, { name: "count" });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		doubled.subscribe(() => {});
		count.set(1);
		count.set(2);

		const summary = profileSummary(g, { limit: 1 });

		expect(summary.nodeCount).toBe(2);
		expect(summary.totalInvokes).toBeGreaterThanOrEqual(3);
		expect(summary.byStatus.settled).toBe(2);
		expect(summary.hotNodes).toEqual([
			expect.objectContaining({ path: "doubled", invokes: 3, status: "settled" }),
		]);
	});
});
