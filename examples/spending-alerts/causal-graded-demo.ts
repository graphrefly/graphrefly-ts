/** Runnable application integration: node --import tsx examples/spending-alerts/causal-graded-demo.ts */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { batch } from "../../packages/ts/src/batch/batch.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import {
	evaluationFixture,
	evaluationPack,
	policyFacts,
	presetBinding,
} from "../../scripts/fixtures/spending-preset-harness.js";
import { oracleRequest } from "../../scripts/fixtures/spending-preset-oracle.js";
import { frameworkExample, maintainerExample } from "./causal-audience.examples.js";
import { spendingAlertsFor } from "./causal-entry.js";
import { OfflineAlertResource } from "./causal-focused-host.js";
import type {
	ArrivalFrame,
	CurrentFrame,
	EvaluationPack,
	LocalAuthorityFrame,
	VerificationFrame,
} from "./causal-inputs.js";
import { ordinarySpendingPanel } from "./causal-ordinary-panel.js";

/** Bounded local callback drainage; no timer or external I/O drives this example. */
async function drainOfflineCompletion() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

export async function runGradedSpendingDemo() {
	// Application integration owns the graph and the five actual input Nodes.
	// The independent fixture oracle supplies verification; this is not a qualified real host.
	const graph = new Graph({ name: "offline-spending-app" });
	const sources = {
		pack: graph.node<EvaluationPack>([], null, { name: "input/pack" }),
		arrivals: graph.node<ArrivalFrame>([], null, { name: "input/arrivals" }),
		current: graph.node<CurrentFrame>([], null, { name: "input/current-policy" }),
		verification: graph.node<VerificationFrame>([], null, {
			name: "input/independent-verification",
		}),
		local: graph.node<LocalAuthorityFrame>([], null, { name: "input/local-permission" }),
	};
	const writes: string[] = [];
	let resolveWrite!: (result: { bytesWritten: number }) => void;
	const pendingWrite = new Promise<{ bytesWritten: number }>((resolve) => {
		resolveWrite = resolve;
	});
	const resource = new OfflineAlertResource(presetBinding, (payload) => {
		writes.push(payload);
		return pendingWrite;
	});
	const beforeConfiguration = graph.topology();
	const preset = spendingAlertsFor(graph, { name: "alerts", diagnostics: "off" });
	assert.deepEqual(graph.topology(), beforeConfiguration);
	const app = preset.compose({
		evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
		verification: { receipts: sources.verification },
		localAuthority: { facts: sources.local },
		inbox: { resource },
	});
	// The application keeps app.owner and app.inspect. The ordinary component receives only view.
	let panelText = "";
	let renderCount = 0;
	const show = (text: string) => {
		panelText = text;
		renderCount++;
	};
	let detachPanel = ordinarySpendingPanel(app.view, show);
	try {
		const execution = frameworkExample(graph, app.capabilities, {
			contract: "contract-v2",
			implementationRevision: "construction-v1",
			scope: "full",
			epoch: presetBinding.compositionEpoch,
		});
		assert.equal(execution, app.capabilities.execution);
		assert.equal(execution.identity, app.capabilities.identity);
		assert.equal(app.capabilities.retained.execution, execution);
		const topology = graph.topology();
		await drainOfflineCompletion();
		const evaluation = evaluationFixture();
		const facts = policyFacts(evaluation);
		sources.pack.down([["DATA", evaluationPack([evaluation])]]);
		batch(() => {
			sources.current.down([["DATA", facts.current]]);
			sources.verification.down([["DATA", facts.verification]]);
			sources.local.down([["DATA", facts.local]]);
			sources.arrivals.down([
				["DATA", { packRef: presetBinding.packRef, evaluationRefs: [evaluation.evaluationRef] }],
			]);
		});
		await drainOfflineCompletion();
		assert.deepEqual(writes, [`${oracleRequest(evaluation, presetBinding)!.body.payloadText}\n`]);
		const pending = app.inspect();
		assert.equal(pending.inFlight, 1);
		assert.equal(pending.records[0].outcome, undefined);
		assert.equal(pending.normalEndReady, false);

		detachPanel();
		const rendersAtDetach = renderCount;
		assert.equal(app.inspect().records.length, 1);
		resolveWrite({ bytesWritten: Buffer.byteLength(writes[0]) });
		await drainOfflineCompletion();
		assert.equal(renderCount, rendersAtDetach);
		const completedWhileDetached = app.inspect();
		assert.equal(completedWhileDetached.records[0].outcome?.state, "succeeded");
		assert.equal(completedWhileDetached.inFlight, 0);
		assert.equal(completedWhileDetached.normalEndReady, false);
		detachPanel = ordinarySpendingPanel(app.view, show);
		assert.ok(renderCount > rendersAtDetach);
		assert.equal(app.inspect().writes, 1);

		// Existing local stop fact stops new work; it does not manufacture an outcome.
		sources.local.down([["DATA", { ...facts.local, stop: true }]]);
		await drainOfflineCompletion();
		const finished = app.inspect();
		assert.equal(finished.normalEndReady, true);
		assert.equal(finished.records.length, 1);
		assert.deepEqual(graph.topology(), topology);
		const maintainer = maintainerExample(graph);
		const record = finished.records[0];
		return {
			mode: "offline-simulation",
			realInboxIO: false,
			ordinary: { received: Object.keys(app.view), finalDisplay: panelText },
			framework: {
				originalExecutionHandle: true,
				originalIdentityHandle: true,
				originalRetainedLineage: true,
			},
			maintainer: {
				graph: maintainer.name,
				topology: { nodes: maintainer.nodes, edges: maintainer.edges },
				nodes: maintainer.nodes.length,
				edges: maintainer.edges.length,
				authority: maintainer.nodes.find((node) => node.id === "alerts/causal/authority")?.id,
				owner: app.owner.instance,
				startup: app.owner.phase,
			},
			observations: {
				configurationAddedNodes: 0,
				simulatedWrites: writes.length,
				pendingAtDetach: pending.inFlight,
				retainedAfterDetach: completedWhileDetached.records.length,
				completedWhileDetached: record.outcome?.state,
				reconnectReusedOriginalView: app.view === app.consume.view,
				topologyUnchanged: true,
				normalEndReady: finished.normalEndReady,
			},
			evidence: {
				occurrence: record.request.body.occurrence,
				requestRef: record.request.requestRef,
				admissionRef: record.admission.admissionRef,
				outcome: record.outcome?.state,
				verifier: facts.verification.receipts[0].verifierRevision,
				verifierArtifact: facts.verification.receipts[0].artifactRef,
				codeBinding: "fixture source/runtime digests; not an attestation of this loaded source",
				modificationProvenance: "unknown; this run does not establish who changed an algorithm",
			},
		};
	} finally {
		detachPanel();
		// Deterministic test/example cleanup, not a newly introduced public lifecycle method.
		for (const lease of app.owner.roots) lease.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of graph.describe().nodes) group.add(graph.find(node.id)!);
		group.release();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	console.log(JSON.stringify(await runGradedSpendingDemo(), null, 2));
