import { expect, it } from "vitest";
import {
	type SpendingCreationInputs,
	type SpendingDefaults,
	type SpendingOverrides,
	spendingAlertsFor,
} from "../../../../examples/spending-alerts/causal-entry.js";
import {
	composeOfflineSpending,
	OfflineAlertResource,
} from "../../../../examples/spending-alerts/causal-focused-host.js";
import { runGradedSpendingDemo } from "../../../../examples/spending-alerts/causal-graded-demo.js";
import { drain, inputsFor } from "../../../../scripts/fixtures/spending-focused-host-harness.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "../../../../scripts/fixtures/spending-preset-harness.js";
import { oracleRequest } from "../../../../scripts/fixtures/spending-preset-oracle.js";
import { batch } from "../batch/batch.js";
import { Graph } from "../graph/graph.js";

type Host = ReturnType<typeof composeOfflineSpending>;
function setup(graph = new Graph({ name: "graded-entry" })) {
	const { inputs, sources } = inputsFor(graph);
	const calls: string[] = [];
	const resource = new OfflineAlertResource(presetBinding, async (payload) => {
		calls.push(payload);
		return { bytesWritten: Buffer.byteLength(payload) };
	});
	return { graph, inputs, sources, calls, resource, creation: { ...inputs, inbox: { resource } } };
}
function teardown(graph: Graph, hosts: readonly Host[] = []) {
	for (const host of hosts) for (const lease of host.owner.roots) lease.unsubscribe?.();
	const group = graph.topologyGroup();
	for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
	group.release();
}
function drive(run: ReturnType<typeof setup>, epoch = 1) {
	const e = evaluationFixture(),
		f = policyFacts(e);
	run.sources.pack.down([["DATA", evaluationPack([e])]]);
	batch(() => {
		run.sources.current.down([["DATA", f.current]]);
		run.sources.verification.down([
			["DATA", { ...f.verification, binding: { ...presetBinding, compositionEpoch: epoch } }],
		]);
		run.sources.local.down([["DATA", f.local]]);
		run.sources.arrivals.down([
			["DATA", { packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] }],
		]);
	});
}

it("creating immutable defaults allocates no nodes and does not claim the resource", () => {
	const graph = new Graph();
	const preset = spendingAlertsFor(graph, { name: "spending" });
	expect(Object.isFrozen(preset)).toBe(true);
	expect(graph.describe().nodes).toHaveLength(0);
	expect(Object.keys(preset)).toEqual(["compose"]);
});

for (const value of [
	null,
	[],
	{},
	{ name: "" },
	{ name: "x".repeat(257) },
	{ name: "a", diagnostics: null },
	{ name: "a", diagnostics: "verbose" },
	{ name: "a", maxEffects: 1 },
	{ name: "a", [Symbol("extra")]: true },
]) {
	it(`invalid defaults leave no graph resources (${String(value)})`, () => {
		const graph = new Graph();
		expect(() => spendingAlertsFor(graph, value as SpendingDefaults)).toThrow();
		expect(graph.describe().nodes).toHaveLength(0);
	});
}
it("accessor defaults and overrides are rejected without invoking getters or allocating", () => {
	const run = setup();
	let reads = 0;
	const config = {
		get name() {
			reads++;
			return "spending";
		},
	};
	const baseline = run.graph.topology();
	expect(() => spendingAlertsFor(run.graph, config)).toThrow(/accessor/);
	const preset = spendingAlertsFor(run.graph, { name: "spending" });
	expect(() => preset.compose(run.creation, config)).toThrow(/accessor/);
	expect(reads).toBe(0);
	expect(run.graph.topology()).toEqual(baseline);
	const lease = run.resource.claim();
	lease.abort();
	teardown(run.graph);
});

for (const override of [{ diagnostics: "bad" }, { name: "" }, { capacity: 64 }, { name: null }]) {
	it("invalid overrides fail before claiming resource or allocating nodes", () => {
		const run = setup();
		const before = run.graph.topology();
		expect(() =>
			spendingAlertsFor(run.graph, { name: "spending" }).compose(
				run.creation,
				override as SpendingOverrides,
			),
		).toThrow();
		expect(run.graph.topology()).toEqual(before);
		const lease = run.resource.claim();
		lease.abort();
		teardown(run.graph);
	});
}
for (const mode of ["off", "summary"] as const) {
	it(`facade retains exact host handles, topology and output parity (${mode})`, async () => {
		const runs = [setup(), setup()];
		const hosts: Host[] = [];
		const stops: (() => void)[] = [];
		try {
			const created = spendingAlertsFor(runs[0].graph, {
				name: "spending",
				diagnostics: mode,
			}).compose(runs[0].creation);
			hosts.push(
				created,
				composeOfflineSpending(runs[1].graph, runs[1].inputs, presetBinding, runs[1].resource, {
					name: "spending",
					diagnostics: mode,
				}),
			);
			expect(created.view).toBe(created.consume.view);
			expect(created.capabilities).toBe(created.consume.capabilities);
			expect(created.capabilities.execution.identity).toBe(created.capabilities.identity);
			expect(created.capabilities.retained.execution).toBe(created.capabilities.execution);
			expect(Object.isFrozen(created)).toBe(true);
			expect(runs[0].graph.topology()).toEqual(runs[1].graph.topology());
			const outputs: unknown[][] = [[], []];
			hosts.forEach((host, i) => {
				for (const [name, node] of Object.entries(host.consume.view))
					stops.push(
						node.subscribe((m) => {
							if (m[0] === "DATA") outputs[i].push([name, m[1]]);
						}),
					);
			});
			await drain();
			expect(hosts.every((h) => h.inspect().writes === 0)).toBe(true);
			runs.forEach((run) => {
				drive(run);
			});
			await drain();
			expect(runs[0].calls).toEqual([
				`${oracleRequest(evaluationFixture(), presetBinding)!.body.payloadText}\n`,
			]);
			expect(runs[0].calls).toEqual(runs[1].calls);
			expect(outputs[0]).toEqual(outputs[1]);
			expect(hosts[0].inspect()).toEqual(hosts[1].inspect());
		} finally {
			stops.forEach((stop) => {
				stop();
			});
			runs.forEach((run, i) => {
				teardown(run.graph, hosts[i] ? [hosts[i]] : []);
			});
		}
	});
}
it("mutable caller defaults/overrides cannot change captured configuration", async () => {
	const run = setup();
	const defaults: SpendingDefaults = { name: "spending", diagnostics: "off" };
	const factory = spendingAlertsFor(run.graph, defaults);
	Object.assign(defaults, { name: "changed", diagnostics: "summary" });
	const override: SpendingOverrides = { name: undefined, diagnostics: undefined };
	const host = factory.compose(run.creation, override);
	Object.assign(override, { name: "changed-again", diagnostics: "summary" });
	try {
		await drain();
		expect(host.owner.instance).toBe("spending");
		expect(host.built.diagnosticSummary).toBeUndefined();
	} finally {
		teardown(run.graph, [host]);
	}
});
it("wrong graph inputs fail cold and leave the resource reusable", () => {
	const run = setup(),
		other = new Graph();
	const before = run.graph.topology();
	expect(() => spendingAlertsFor(other, { name: "spending" }).compose(run.creation)).toThrow();
	expect(other.describe().nodes).toHaveLength(0);
	expect(run.graph.topology()).toEqual(before);
	const lease = run.resource.claim();
	lease.abort();
	teardown(run.graph);
});
it("caller outcome lane or fake resource cannot replace the host-owned source", () => {
	const run = setup(),
		factory = spendingAlertsFor(run.graph, { name: "spending" }),
		before = run.graph.topology();
	for (const inbox of [
		{ resource: run.resource, facts: run.sources.current },
		{ resource: { binding: presetBinding } },
	])
		expect(() => factory.compose({ ...run.creation, inbox } as SpendingCreationInputs)).toThrow();
	expect(run.graph.topology()).toEqual(before);
	const lease = run.resource.claim();
	lease.abort();
	teardown(run.graph);
});
it("duplicate input nodes clean up partial assembly and return the untransferred resource", () => {
	const run = setup(),
		before = run.graph.topology();
	expect(() =>
		spendingAlertsFor(run.graph, { name: "spending" }).compose({
			...run.creation,
			verification: { receipts: run.sources.current as never },
		}),
	).toThrow();
	expect(run.graph.topology()).toEqual(before);
	const lease = run.resource.claim();
	lease.abort();
	teardown(run.graph);
});
it("wrong runtime epoch stays unexecuted instead of being repaired by convenience defaults", async () => {
	const run = setup(),
		host = spendingAlertsFor(run.graph, { name: "spending" }).compose(run.creation);
	try {
		await drain();
		drive(run, 2);
		await drain();
		expect(run.calls).toHaveLength(0);
		expect(host.inspect().writes).toBe(0);
	} finally {
		teardown(run.graph, [host]);
	}
});
it("one factory composes independent names, inputs, epochs and local overrides on the same graph", async () => {
	const run = setup(),
		factory = spendingAlertsFor(run.graph, { name: "spending" });
	const first = factory.compose(run.creation);
	const binding = { ...presetBinding, compositionEpoch: 2, hostEpoch: 2 };
	const secondSources = Object.fromEntries(
		Object.keys(run.sources).map((key) => [
			key,
			run.graph.node([], null, { name: `second/${key}` }),
		]),
	) as typeof run.sources;
	const calls: string[] = [];
	const resource = new OfflineAlertResource(binding, async (payload) => {
		calls.push(payload);
		return { bytesWritten: Buffer.byteLength(payload) };
	});
	const secondInputs = {
		evaluations: {
			pack: secondSources.pack,
			arrivals: secondSources.arrivals,
			current: secondSources.current,
		},
		verification: { receipts: secondSources.verification },
		localAuthority: { facts: secondSources.local },
		inbox: { resource },
	};
	const second = factory.compose(secondInputs, { name: "second", diagnostics: "summary" });
	try {
		await drain();
		expect(first.owner.instance).toBe("spending");
		expect(first.owner.epoch).toBe(1);
		expect(second.owner.epoch).toBe(2);
		expect(first.built.diagnosticSummary).toBeUndefined();
		expect(second.built.diagnosticSummary).toBeDefined();
		expect(first.view).not.toBe(second.view);
		expect(first.capabilities).not.toBe(second.capabilities);
		drive(run);
		await drain();
		expect(run.calls).toHaveLength(1);
		expect(calls).toHaveLength(0);
		const e = evaluationFixture(),
			f = policyFacts(e, binding);
		secondSources.pack.down([["DATA", evaluationPack([e], binding)]]);
		batch(() => {
			secondSources.current.down([["DATA", f.current]]);
			secondSources.verification.down([["DATA", f.verification]]);
			secondSources.local.down([["DATA", f.local]]);
			secondSources.arrivals.down([
				["DATA", { packRef: binding.packRef, evaluationRefs: [e.evaluationRef] }],
			]);
		});
		await drain();
		expect(calls).toHaveLength(1);
		expect(first.inspect().records[0].outcome?.state).toBe("succeeded");
		expect(second.inspect().records[0].outcome?.state).toBe("succeeded");
		expect(first.inspect().records[0].request.body.hostEpoch).toBe(1);
		expect(second.inspect().records[0].request.body.hostEpoch).toBe(2);
		const before = run.graph.topology();
		expect(() => factory.compose(run.creation, { name: "third" })).toThrow(/claimed/);
		expect(() => factory.compose(secondInputs)).toThrow();
		expect(run.graph.topology()).toEqual(before);
	} finally {
		teardown(run.graph, [first, second]);
	}
});
it("duplicate instance name fails before claiming another resource", async () => {
	const run = setup(),
		factory = spendingAlertsFor(run.graph, { name: "spending" }),
		host = factory.compose(run.creation);
	const resource = new OfflineAlertResource(
		{ ...presetBinding, compositionEpoch: 2, hostEpoch: 2 },
		async () => ({ bytesWritten: 0 }),
	);
	try {
		await drain();
		const before = run.graph.topology();
		expect(() => factory.compose({ ...run.creation, inbox: { resource } })).toThrow();
		expect(run.graph.topology()).toEqual(before);
		const lease = resource.claim();
		lease.abort();
	} finally {
		teardown(run.graph, [host]);
	}
});

it("runnable roles preserve A's obligation while the same graph presents and settles B", async () => {
	const result = await runGradedSpendingDemo();
	expect(result.ordinary.initialDisplay).toContain("评估：尚无事实");
	expect(result.ordinary.pendingDisplay).toContain("admitted-no-outcome");
	expect(result.ordinary.finalDisplay).toContain("succeeded");
	expect(result.composition).toMatchObject({
		sameGraph: true,
		independentOwners: ["alerts", "alerts-b"],
		aPendingAfterB: 1,
		bSucceededWhileAPending: "succeeded",
		writes: { a: 1, b: 1 },
		originalExecutionHandles: true,
		retainedLineages: true,
	});
	expect(result.observations).toMatchObject({
		pendingAtDetach: 1,
		completedWhileDetached: "succeeded",
		reconnectReusedOriginalView: true,
		topologyUnchanged: true,
		normalEndReady: true,
	});
	const [a, b] = result.composition.evidenceNavigation;
	expect(a.requestRef).not.toEqual(b.requestRef);
	expect(a.admissionRef).not.toEqual(b.admissionRef);
	for (const path of [a, b]) {
		expect(result.maintainer.topology.nodes.some((node) => node.id === path.authorityNode)).toBe(
			true,
		);
		expect(
			result.maintainer.topology.nodes.some((node) => node.id === path.implementationNode),
		).toBe(true);
		expect(path.affectedEdges.length).toBeGreaterThan(0);
		expect(path.outcome?.state).toBe("succeeded");
		expect(path.verificationArtifact).toBeTruthy();
		expect(path.coverage).toContain("not attested");
		expect(path.historicalScope).toContain("not this A/B run");
	}
	expect(a.requestRef).toEqual(result.evidence.requestRef);
	expect(a.admissionRef).toEqual(result.evidence.admissionRef);
});
