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

function demoSources(graph: Graph, prefix: string) {
	return {
		pack: graph.node<EvaluationPack>([], null, { name: `${prefix}/pack` }),
		arrivals: graph.node<ArrivalFrame>([], null, { name: `${prefix}/arrivals` }),
		current: graph.node<CurrentFrame>([], null, { name: `${prefix}/current-policy` }),
		verification: graph.node<VerificationFrame>([], null, {
			name: `${prefix}/independent-verification`,
		}),
		local: graph.node<LocalAuthorityFrame>([], null, { name: `${prefix}/local-permission` }),
	};
}

export async function runGradedSpendingDemo() {
	// Application integration owns the graph and the five actual input Nodes.
	// The independent fixture oracle supplies verification; this is not a qualified real host.
	const graph = new Graph({ name: "offline-spending-app" });
	const sources = demoSources(graph, "input");
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
	const beforeInitialPanel = graph.topology();
	let detachPanel = ordinarySpendingPanel(app.view, show);
	assert.deepEqual(graph.topology(), beforeInitialPanel);
	const initialDisplay = panelText;
	let detachB = () => {};
	let appB: ReturnType<typeof preset.compose> | undefined;
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
		// Framework task: a second complete instance shares the Graph, not A's input/resource epoch.
		const bindingB = {
			...presetBinding,
			compositionEpoch: 2,
			hostEpoch: 2,
			runRef: "second-fixture",
		};
		const sourcesB = demoSources(graph, "input-b");
		const writesB: string[] = [];
		appB = preset.compose(
			{
				evaluations: {
					pack: sourcesB.pack,
					arrivals: sourcesB.arrivals,
					current: sourcesB.current,
				},
				verification: { receipts: sourcesB.verification },
				localAuthority: { facts: sourcesB.local },
				inbox: {
					resource: new OfflineAlertResource(bindingB, async (payload) => {
						writesB.push(payload);
						return { bytesWritten: Buffer.byteLength(payload) };
					}),
				},
			},
			{ name: "alerts-b" },
		);
		const executionB = frameworkExample(graph, appB.capabilities, {
			contract: "contract-v2",
			implementationRevision: "construction-v1",
			scope: "full",
			epoch: 2,
		});
		assert.equal(executionB, appB.capabilities.execution);
		assert.equal(appB.capabilities.retained.execution, executionB);
		assert.notEqual(executionB, execution);
		assert.notEqual(appB.view, app.view);
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
		const pendingDisplay = panelText;

		detachPanel();
		const rendersAtDetach = renderCount;
		assert.equal(app.inspect().records.length, 1);
		// Ordinary task switches to B while A still owes its exact result.
		let panelBText = "";
		detachB = ordinarySpendingPanel(appB.view, (text) => {
			panelBText = text;
		});
		assert.deepEqual(graph.topology(), topology);
		const evaluationB = evaluationFixture(0, "tea");
		const factsB = policyFacts(evaluationB, bindingB);
		sourcesB.pack.down([["DATA", evaluationPack([evaluationB], bindingB)]]);
		batch(() => {
			sourcesB.current.down([["DATA", factsB.current]]);
			sourcesB.verification.down([["DATA", factsB.verification]]);
			sourcesB.local.down([["DATA", factsB.local]]);
			sourcesB.arrivals.down([
				["DATA", { packRef: bindingB.packRef, evaluationRefs: [evaluationB.evaluationRef] }],
			]);
		});
		await drainOfflineCompletion();
		assert.deepEqual(writesB, [`${oracleRequest(evaluationB, bindingB)!.body.payloadText}\n`]);
		assert.equal(appB.inspect().records[0].outcome?.state, "succeeded");
		assert.match(panelBText, /succeeded/);
		assert.equal(app.inspect().inFlight, 1);
		assert.equal(app.inspect().records[0].outcome, undefined);
		assert.equal(renderCount, rendersAtDetach);
		const aPendingAfterB = app.inspect().inFlight;
		assert.notDeepEqual(
			app.inspect().records[0].admission.admissionRef,
			appB.inspect().records[0].admission.admissionRef,
		);
		// Maintainer captures B's observed publication before its UI releases demand.
		const publicationB = appB.view.publication.cache;
		assert.ok(publicationB);
		detachB();
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
		assert.match(panelText, /succeeded/);
		assert.deepEqual(graph.topology(), topology);

		// Existing local stop fact stops new work; it does not manufacture an outcome.
		sources.local.down([["DATA", { ...facts.local, stop: true }]]);
		sourcesB.local.down([["DATA", { ...factsB.local, stop: true }]]);
		await drainOfflineCompletion();
		const finished = app.inspect();
		assert.equal(finished.normalEndReady, true);
		assert.equal(finished.records.length, 1);
		assert.deepEqual(graph.topology(), topology);
		const maintainer = maintainerExample(graph);
		const record = finished.records[0];
		const recordB = appB.inspect().records[0];
		assert.equal(appB.inspect().normalEndReady, true);
		// Navigation begins with each actual publication row, then checks the exact retained request.
		const publication = app.view.publication.cache;
		assert.ok(publication);
		assert.deepEqual(publication.rows[0].proposal.requestRef, record.request.requestRef);
		assert.deepEqual(publicationB.rows[0].proposal.requestRef, recordB.request.requestRef);
		const evidenceNavigation = [
			{
				publication,
				hostRecord: record,
				instance: app.owner.instance,
				verification: facts.verification.receipts[0],
			},
			{
				publication: publicationB,
				hostRecord: recordB,
				instance: appB.owner.instance,
				verification: factsB.verification.receipts[0],
			},
		].map(({ publication, hostRecord, instance, verification }) => {
			const authority = graph.find(publication.authorityId);
			const implementationNode = graph.find(`${instance}/vendorStats`);
			assert.ok(authority && implementationNode);
			assert.equal(verification.requestDigest, hostRecord.request.body.payloadDigest);
			assert.equal(publication.rows[0].recorded, hostRecord.outcome?.state);
			return {
				authorityNode: publication.authorityId,
				implementationNode: `${instance}/vendorStats`,
				affectedEdges: maintainer.edges.filter((edge) => edge.from === `${instance}/vendorStats`),
				occurrence: hostRecord.request.body.occurrence,
				requestRef: publication.rows[0].proposal.requestRef,
				admissionRef: hostRecord.admission.admissionRef,
				outcome: hostRecord.outcome,
				verificationArtifact: verification.artifactRef,
				implementationSource: "examples/spending-alerts/causal-business.ts",
				binding: {
					sourceDigest: hostRecord.request.body.sourceDigest,
					runtimeDigest: hostRecord.request.body.runtimeDigest,
				},
				coverage:
					"fixture binding only; current loaded-source implementation mapping is not attested",
				historicalSourceExperiment:
					"docs/design/causal-graded-entry-implementation/source-binding.json",
				historicalScope: "separate recorded experiment; not this A/B run's source attestation",
				modificationProvenance:
					"unknown for this run; recorded tool provenance belongs only to the separate experiment",
			};
		});
		return {
			mode: "offline-simulation",
			realInboxIO: false,
			ordinary: {
				received: Object.keys(app.view),
				initialDisplay,
				pendingDisplay,
				finalDisplay: panelText,
			},
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
			composition: {
				sameGraph: true,
				independentOwners: [app.owner.instance, appB.owner.instance],
				aPendingAfterB,
				bSucceededWhileAPending: recordB.outcome?.state,
				writes: { a: writes.length, b: writesB.length },
				originalExecutionHandles:
					execution === app.capabilities.execution && executionB === appB.capabilities.execution,
				retainedLineages:
					app.capabilities.retained.execution === execution &&
					appB.capabilities.retained.execution === executionB,
				bFinalDisplay: panelBText,
				evidenceNavigation,
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
		detachB();
		// Deterministic test/example cleanup, not a newly introduced public lifecycle method.
		for (const instance of [app, appB])
			for (const lease of instance?.owner.roots ?? []) lease.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const node of graph.describe().nodes) group.add(graph.find(node.id)!);
		group.release();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	console.log(JSON.stringify(await runGradedSpendingDemo(), null, 2));
