/** Automatic and explicit construction must execute the same private graph. */
import { expect, it } from "vitest";
import {
	frameworkExample,
	maintainerExample,
	ordinaryExample,
} from "../../../../examples/spending-alerts/causal-audience.examples.js";
import {
	composeOfflineSpending,
	OfflineAlertResource,
} from "../../../../examples/spending-alerts/causal-focused-host.js";
import { directOfflineSpending } from "../../../../scripts/fixtures/spending-focused-host-direct.js";
import { drain, inputsFor } from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { oracleRequest } from "../../../../scripts/fixtures/spending-preset-oracle.js";
import { batch } from "../batch/batch.js";
import { ColdConstructionError } from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";

function fixture(create: typeof composeOfflineSpending, diagnostics: "off" | "summary") {
	const graph = new Graph({ name: "same-construction" });
	const { inputs, sources } = inputsFor(graph);
	const calls: string[] = [];
	const host = create(
		graph,
		inputs,
		presetBinding,
		new OfflineAlertResource(presetBinding, async (payload) => {
			calls.push(payload);
			return { bytesWritten: Buffer.byteLength(payload) };
		}),
		{ name: "spending", diagnostics },
	);
	const teardown = () => {
		for (const root of host.owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
		group.release();
	};
	return { graph, host, calls, sources, teardown };
}
function topology(graph: Graph) {
	const snapshot = graph.describe();
	return {
		nodes: snapshot.nodes.map(({ id, name, factory }) => ({ id, name, factory })),
		edges: snapshot.edges,
	};
}
for (const mode of ["off", "summary"] as const) {
	it(`automatic and direct construction have identical topology and exact execution (${mode})`, async () => {
		const runs = [fixture(composeOfflineSpending, mode), fixture(directOfflineSpending, mode)];
		const stops: (() => void)[] = [];
		try {
			await drain();
			expect(topology(runs[0].graph)).toEqual(topology(runs[1].graph));
			const e = evaluationFixture();
			const f = policyFacts(e);
			const observed: unknown[][] = [];
			for (const run of runs) {
				const { view, capabilities } = run.host.consume;
				expect(Object.keys(view)).toEqual([
					"assessment",
					"publication",
					"coverage",
					"issues",
					"startup",
				]);
				expect(view).toBe(run.host.built.consume.view);
				const binding = {
					contract: "contract-v2",
					implementationRevision: "construction-v1",
					scope: "full",
					epoch: 1,
				} as const;
				expect(frameworkExample(run.graph, capabilities, binding)).toBe(capabilities.execution);
				expect(capabilities.execution.identity).toBe(capabilities.identity);
				expect(capabilities.retained.execution).toBe(capabilities.execution);
				const before = topology(run.graph);
				expect(maintainerExample(run.graph).nodes.map((n) => n.id)).toEqual(
					before.nodes.map((n) => n.id),
				);
				const seen: unknown[] = [];
				observed.push(seen);
				stops.push(ordinaryExample(view, (v) => seen.push(v)));
				run.sources.pack.down([["DATA", evaluationPack([e])]]);
				batch(() => {
					run.sources.current.down([["DATA", f.current]]);
					run.sources.verification.down([["DATA", f.verification]]);
					run.sources.local.down([["DATA", f.local]]);
					run.sources.arrivals.down([
						["DATA", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] }],
					]);
				});
				await drain();
				expect(topology(run.graph)).toEqual(before);
				expect(run.calls).toEqual([`${oracleRequest(e, presetBinding)!.body.payloadText}\n`]);
				expect(run.host.inspect().records[0].outcome?.state).toBe("succeeded");
			}
			expect(runs[0].host.inspect().records).toEqual(runs[1].host.inspect().records);
			expect(observed[0].at(-1)).toEqual(observed[1].at(-1));
		} finally {
			for (const stop of stops) stop();
			for (const run of runs) run.teardown();
		}
	});
}
for (const [label, create] of [
	["automatic", composeOfflineSpending],
	["direct", directOfflineSpending],
] as const) {
	it(`${label} rejects wrong graph without allocating owned nodes`, () => {
		const graph = new Graph();
		const { inputs } = inputsFor(new Graph());
		const before = graph.describe();
		expect(() =>
			create(
				graph,
				inputs,
				presetBinding,
				new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 })),
				{ name: "spending" },
			),
		).toThrow();
		expect(graph.describe()).toEqual(before);
	});
	it(`${label} preserves original cold failure and cleans owned nodes`, () => {
		const graph = new Graph();
		const { inputs } = inputsFor(graph);
		const before = graph.describe();
		let caught: unknown;
		try {
			create(
				graph,
				inputs,
				presetBinding,
				new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 })),
				{ name: "spending", diagnostics: "invalid" as "off" },
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ColdConstructionError);
		expect((caught as ColdConstructionError).originalCause).toBeInstanceOf(TypeError);
		expect((caught as ColdConstructionError).cleanupErrors).toEqual([]);
		expect(graph.describe()).toEqual(before);
	});
}
it("explicit afterStart cannot schedule duplicate startup notifications", async () => {
	const graph = new Graph();
	const { inputs } = inputsFor(graph);
	const host = directOfflineSpending(
		graph,
		inputs,
		presetBinding,
		new OfflineAlertResource(presetBinding, async () => ({ bytesWritten: 0 })),
		{ name: "spending" },
	);
	try {
		await drain();
		const before = host.inspect().notifications;
		expect(() => host.afterStart(host.owner)).toThrow("already notified");
		await drain();
		expect(host.inspect().notifications).toBe(before);
	} finally {
		for (const root of host.owner.roots) root.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
		group.release();
	}
});
