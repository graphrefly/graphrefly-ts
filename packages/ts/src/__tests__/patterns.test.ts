import { describe, expect, it } from "vitest";
import { Dispatcher, graph } from "../index.js";
import { profileSummary } from "../patterns/index.js";

describe("patterns inspection helpers (B62 / D125)", () => {
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
