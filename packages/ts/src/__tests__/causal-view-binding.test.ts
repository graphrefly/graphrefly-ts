import { expect, it } from "vitest";
import { runGradedSpendingDemo } from "../../../../examples/spending-alerts/causal-graded-demo.js";
import { ordinarySpendingPanel } from "../../../../examples/spending-alerts/causal-ordinary-panel.js";
import type { SpendingAlertsView } from "../../../../examples/spending-alerts/causal-preset.js";
import { mountSpendingView } from "../../../../examples/spending-alerts/causal-view-binding.js";
import { drain, runHost } from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import { evaluationFixture } from "../../../../scripts/fixtures/spending-preset-harness.js";
import { Graph } from "../graph/graph.js";

for (const mode of ["off", "summary"] as const) {
	it(`${mode}: value binding adds no nodes and detach leaves the in-flight run intact`, async () => {
		const run = runHost(mode);
		const observations: unknown[] = [];
		let stop = () => {};
		try {
			await drain();
			const topology = run.graph.topology();
			stop = mountSpendingView(run.host.consume.view, (value) => observations.push(value));
			expect(run.graph.topology()).toEqual(topology);
			run.drive([evaluationFixture()]);
			expect(run.calls).toHaveLength(1);
			stop();
			stop();
			run.disconnect();
			const count = observations.length;
			expect(run.host.inspect().records[0].outcome).toBeUndefined();
			run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
			await drain();
			expect(observations).toHaveLength(count);
			stop = mountSpendingView(run.host.consume.view, (value) => observations.push(value));
			expect(run.host.inspect().records[0].outcome?.state).toBe("succeeded");
			expect(run.calls).toHaveLength(1);
			expect(observations.length).toBeGreaterThan(count);
			expect(run.graph.topology()).toEqual(topology);
		} finally {
			stop();
			run.teardown();
		}
	});
}
it.each(["INVALIDATE", "ERROR"] as const)("%s makes previous values unavailable", (kind) => {
	const graph = new Graph();
	const node = graph.node([], null);
	const view = Object.fromEntries(
		["assessment", "publication", "coverage", "issues", "startup"].map((k) => [k, node]),
	) as SpendingAlertsView;
	let latest: Parameters<Parameters<typeof mountSpendingView>[1]>[0] | undefined;
	const stop = mountSpendingView(view, (value) => {
		latest = value;
	});
	try {
		expect(latest?.unavailable).toHaveLength(5);
		node.down([["DATA", { observed: true }]]);
		expect(latest?.unavailable).toHaveLength(0);
		node.down(kind === "ERROR" ? [["ERROR", new Error("dependency lost")]] : [["INVALIDATE"]]);
		expect(latest?.unavailable).toHaveLength(5);
		expect(latest?.values).toEqual({});
	} finally {
		stop();
	}
});
it("initial renderer failure removes all newly installed view subscriptions", () => {
	const graph = new Graph();
	const nodes = [0, 1, 2, 3, 4].map(() => graph.node([], null));
	const view = Object.fromEntries(
		["assessment", "publication", "coverage", "issues", "startup"].map((k, i) => [k, nodes[i]]),
	) as SpendingAlertsView;
	let calls = 0;
	expect(() =>
		mountSpendingView(view, () => {
			calls++;
			throw Error("render");
		}),
	).toThrow("render");
	for (const n of nodes) n.down([["DATA", "later"]]);
	expect(calls).toBe(1);
});

it("the runnable application keeps startup, pending work and completed lifecycle distinct", async () => {
	const result = await runGradedSpendingDemo();
	expect(result.observations).toMatchObject({
		simulatedWrites: 1,
		pendingAtDetach: 1,
		retainedAfterDetach: 1,
		completedWhileDetached: "succeeded",
		normalEndReady: true,
	});
	expect(result.ordinary.finalDisplay).toContain("不代表运行结束");
	expect(result.ordinary.finalDisplay).toContain("离线模拟");
	expect(result.maintainer.topology.nodes).toHaveLength(result.maintainer.nodes);
});
it("ordinary display distinguishes a normal assessment from missing facts without inventing verification", async () => {
	const run = runHost();
	let text = "";
	const stop = ordinarySpendingPanel(run.host.consume.view, (value) => {
		text = value;
	});
	try {
		await drain();
		expect(text).toContain("评估：尚无事实");
		run.drive([evaluationFixture(0, "coffee", 1, false)]);
		await drain();
		expect(text).toContain("未触发告警条件（不等于验证已完成）");
		expect(text).toContain("证据覆盖：");
		expect(run.calls).toHaveLength(0);
		expect(run.host.inspect().normalEndReady).toBe(false);
	} finally {
		stop();
		run.teardown();
	}
});
