/** Real private consumer + owned host source. Resource performs no actual inbox I/O. */
import { expect, it } from "vitest";
import {
	composeOfflineSpending,
	OfflineAlertResource,
} from "../../../../examples/spending-alerts/causal-focused-host.js";
import {
	drain,
	inputsFor,
	runHost,
} from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import {
	evaluationFixture,
	policyFacts,
	presetBinding,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { oracleRequest } from "../../../../scripts/fixtures/spending-preset-oracle.js";
import { Graph } from "../graph/graph.js";

for (const mode of ["off", "summary"] as const) {
	it(`real host closes exact authority obligation and replays without another call (${mode})`, async () => {
		const run = runHost(mode);
		try {
			await drain();
			const evaluation = evaluationFixture();
			run.drive([evaluation]);
			const expected = `${oracleRequest(evaluation, presetBinding)!.body.payloadText}\n`;
			expect(run.calls).toEqual([expected]);
			const before = [...run.state().effects.values()][0];
			expect(before.admission?.state).toBe("admitted");
			expect(before.outcome).toBeUndefined();
			run.pending.resolve({ bytesWritten: Buffer.byteLength(expected) });
			await drain();
			const after = [...run.state().effects.values()][0];
			expect(after.outcome).toMatchObject({
				...after.proposal,
				admissionRef: before.admission!.admissionRef,
				state: "succeeded",
			});
			expect(run.host.inspect().records).toHaveLength(1);
			run.drive([evaluation]);
			await drain();
			expect(run.calls).toHaveLength(1);
			expect([...run.state().effects.values()][0].outcome).toEqual(after.outcome);
			expect(Object.keys(run.host.consume.view)).toEqual([
				"assessment",
				"publication",
				"coverage",
				"issues",
				"startup",
			]);
		} finally {
			run.teardown();
		}
	});
	it(`two genuine admissions share readiness but only one owns write slot (${mode})`, async () => {
		const run = runHost(mode);
		try {
			await drain();
			run.drive([evaluationFixture(0, "coffee"), evaluationFixture(0, "tea")]);
			expect(
				[...run.state().effects.values()].filter((r) => r.admission?.state === "admitted"),
			).toHaveLength(2);
			expect(run.calls).toHaveLength(1);
			expect(run.host.inspect().inFlight).toBe(1);
			await drain();
			const refused = [...run.state().effects.values()].find(
				(r) => r.outcome?.state === "cancelled",
			);
			expect(refused?.outcome?.result).toMatchObject({
				kind: "error",
				error: { code: "spending-host/busy-or-write-budget" },
			});
			run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
			await drain();
			expect(run.calls).toHaveLength(1);
			expect(run.host.inspect().records).toHaveLength(2);
			expect([...run.state().effects.values()].map((r) => r.outcome?.state).sort()).toEqual([
				"cancelled",
				"succeeded",
			]);
		} finally {
			run.teardown();
		}
	});
	it(`UI detach never releases in-flight execution or retained result (${mode})`, async () => {
		const run = runHost(mode);
		try {
			await drain();
			run.drive([evaluationFixture()]);
			const ids = run.graph.describe().nodes.map((n) => n.id);
			run.disconnect();
			expect(run.host.inspect().inFlight).toBe(1);
			expect(run.host.inspect().records).toHaveLength(1);
			run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
			await drain();
			expect([...run.state().effects.values()][0].outcome?.state).toBe("succeeded");
			run.connect();
			await drain();
			expect(run.host.inspect().records).toHaveLength(1);
			expect(run.calls).toHaveLength(1);
			expect(run.graph.describe().nodes.map((n) => n.id)).toEqual(ids);
			expect(run.publications.length).toBeGreaterThan(0);
		} finally {
			run.teardown();
		}
	});
}
for (const failure of ["throw", "reject", "short"] as const) {
	it(`possible submission remains unknown after ${failure}`, async () => {
		const run = runHost("off", () => {
			if (failure === "throw") throw new Error("may have submitted");
			if (failure === "reject") return Promise.reject(new Error("may have submitted"));
			return Promise.resolve({ bytesWritten: 1 });
		});
		try {
			await drain();
			run.drive([evaluationFixture()]);
			await drain();
			expect(run.calls).toHaveLength(1);
			expect(run.host.inspect().inFlight).toBe(0);
			expect([...run.state().effects.values()][0].outcome?.state).toBe("unknown");
			expect(run.host.inspect().records[0].outcome?.state).toBe("unknown");
			run.drive([evaluationFixture()]);
			await drain();
			expect(run.calls).toHaveLength(1);
		} finally {
			run.teardown();
		}
	});
}
it("normal branch completes without a host record or call", async () => {
	const run = runHost();
	try {
		await drain();
		run.drive([evaluationFixture(0, "coffee", 2, false)]);
		await drain();
		expect(run.calls).toHaveLength(0);
		expect(run.host.inspect().records).toHaveLength(0);
		expect(run.state().effects.size).toBe(0);
	} finally {
		run.teardown();
	}
});
it("wrong resource binding rejects before touching original graph", () => {
	const graph = new Graph();
	const { inputs } = inputsFor(graph);
	const before = graph.describe();
	expect(() =>
		composeOfflineSpending(
			graph,
			inputs,
			presetBinding,
			new OfflineAlertResource({ ...presetBinding, hostEpoch: 2 }, async () => ({
				bytesWritten: 0,
			})),
			{ name: "spending" },
		),
	).toThrow("offline resource binding");
	expect(graph.describe()).toEqual(before);
});
it("invalid cold diagnostics aborts only new owned construction", () => {
	const graph = new Graph();
	const { inputs } = inputsFor(graph);
	const before = graph.describe();
	expect(() =>
		composeOfflineSpending(
			graph,
			inputs,
			presetBinding,
			new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 })),
			{ name: "spending", diagnostics: "invalid" as "off" },
		),
	).toThrow();
	expect(graph.describe()).toEqual(before);
});
it("one resource epoch cannot belong to two compositions", async () => {
	const graph = new Graph();
	const { inputs } = inputsFor(graph);
	const resource = new OfflineAlertResource(presetBinding, async (payload) => ({
		bytesWritten: Buffer.byteLength(payload),
	}));
	const first = composeOfflineSpending(graph, inputs, presetBinding, resource, {
		name: "spending",
	});
	try {
		await drain();
		const secondGraph = new Graph();
		const secondInputs = inputsFor(secondGraph).inputs;
		const before = secondGraph.describe();
		expect(() =>
			composeOfflineSpending(secondGraph, secondInputs, presetBinding, resource, {
				name: "second",
			}),
		).toThrow("already claimed");
		expect(secondGraph.describe()).toEqual(before);
	} finally {
		for (const root of first.owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of graph.describe().nodes) group.add(graph.find(node.id)!);
		group.release();
	}
});
it("failed cold construction releases only its untransferred resource claim", async () => {
	const graph = new Graph();
	const { inputs } = inputsFor(graph);
	const resource = new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 }));
	const before = graph.describe();
	expect(() =>
		composeOfflineSpending(graph, inputs, presetBinding, resource, {
			name: "spending",
			diagnostics: "bad" as "off",
		}),
	).toThrow();
	expect(graph.describe()).toEqual(before);
	// Aborted node IDs remain retired by the existing construction contract.
	const retryGraph = new Graph();
	const retryInputs = inputsFor(retryGraph).inputs;
	const retried = composeOfflineSpending(retryGraph, retryInputs, presetBinding, resource, {
		name: "spending",
	});
	try {
		await drain();
		expect(retried.inspect().fault).toBeUndefined();
	} finally {
		for (const root of retried.owner.roots) root.unsubscribe?.();
		const group = retryGraph.topologyGroup();
		for (const node of retryGraph.describe().nodes) group.add(retryGraph.find(node.id)!);
		group.release();
	}
});
for (const malformed of ["null", "getter"] as const) {
	it(`malformed completion ${malformed} retains unknown instead of losing the obligation`, async () => {
		const run = runHost("off", async () =>
			malformed === "null"
				? (null as unknown as { bytesWritten: number })
				: (Object.defineProperty({}, "bytesWritten", {
						get() {
							throw new Error("untrusted result");
						},
					}) as { bytesWritten: number }),
		);
		try {
			await drain();
			const e = evaluationFixture();
			run.drive([e]);
			await drain();
			expect(run.calls).toHaveLength(1);
			expect([...run.state().effects.values()][0].outcome?.state).toBe("unknown");
			run.send("local", { ...policyFacts(e).local, stop: true });
			await drain();
			expect(run.host.inspect().normalEndReady).toBe(false);
		} finally {
			run.teardown();
		}
	});
}
it("normal end needs stop, exact known completion and authority quiescence", async () => {
	const run = runHost();
	try {
		await drain();
		const e = evaluationFixture();
		run.drive([e]);
		run.send("local", { ...policyFacts(e).local, stop: true });
		expect(run.host.inspect().normalEndReady).toBe(false);
		run.pending.resolve({ bytesWritten: Buffer.byteLength(run.calls[0]) });
		expect(run.host.inspect().normalEndReady).toBe(false);
		await drain();
		expect(run.host.inspect().normalEndReady).toBe(true);
	} finally {
		run.teardown();
	}
});
