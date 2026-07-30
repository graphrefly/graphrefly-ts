import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION,
	nodeLocalUntrustedJsComputeDriver,
} from "../executors/local-untrusted-js-compute/node.js";
import {
	LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
	LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
	type LocalUntrustedJsComputeArguments,
	type LocalUntrustedJsComputeCancellationAdmission,
	type LocalUntrustedJsComputeDriver,
	type LocalUntrustedJsComputeManifest,
	type LocalUntrustedJsComputeReadiness,
	localUntrustedJsComputeManifest,
	localUntrustedJsComputeRuntime,
	runLocalUntrustedJsComputeAttempt,
} from "../executors/local-untrusted-js-compute.js";
import { Graph } from "../graph/graph.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type {
	AgentRuntimeAuditRecord,
	ExecutorOutcome,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
	ToolProviderRunAdmission,
} from "../orchestration/index.js";

const imageDigest = `sha256:${"1".repeat(64)}`;
const sourceDigest = `sha256:${"2".repeat(64)}`;
const bundle = new Uint8Array([1, 2, 3]);
const input = { question: "count rows", rows: [{ id: 1 }, { id: 2 }] };
const sha256 = (bytes: Uint8Array): string =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bundleDigest = sha256(bundle);
const inputDigest = sha256(strictCanonicalJsonBytes(input));

const manifest = (): LocalUntrustedJsComputeManifest => ({
	kind: "local-untrusted-js-compute-manifest",
	manifestId: "manifest:local-js:1",
	revision: "manifest-revision:1",
	fingerprint: "manifest-fingerprint:1",
	compatibilityRevision: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	backend: LOCAL_UNTRUSTED_JS_COMPUTE_BACKEND,
	runnerApiRevision: LOCAL_UNTRUSTED_JS_COMPUTE_RUNNER_API,
	runnerImageDigest: imageDigest,
	runnerRevision: "runner:1",
	compilerRevision: "compiler:1",
	allowedApiRevision: "api:1",
	graphreflyPackageRevision: NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION,
	sandboxPolicyRevision: "sandbox:1",
	networkPolicyRevision: "deny-all-v1",
	filesystemPolicyRevision: "read-only-input-bounded-tmp-v1",
	resourcePolicyRevision: "resource:1",
	outputPolicyRevision: "output:1",
	executionTimeoutMs: 1_000,
	killGraceMs: 1_000,
	cleanupTimeoutMs: 1_000,
	maxBundleBytes: 8_192,
	maxInputBytes: 1_024,
	maxOutputBytes: 16_384,
	maxTopologyNodes: 8,
	maxTopologyEdges: 8,
});

const readiness = (): LocalUntrustedJsComputeReadiness => ({
	kind: "local-untrusted-js-compute-readiness",
	manifestFingerprint: "manifest-fingerprint:1",
	state: "ready",
	observedAtMs: 100,
	expiresAtMs: 1_000,
	rootlessVerified: true,
	imageDigestVerified: true,
	runnerVerified: true,
	nonRootVerified: true,
	readOnlyRootFilesystemVerified: true,
	noNewPrivilegesVerified: true,
	capabilitiesDroppedVerified: true,
	noEngineSocketMountVerified: true,
	noHostBindMountVerified: true,
	denyNetworkVerified: true,
	resourceBoundsVerified: true,
	cancellationVerified: true,
	cleanupVerified: true,
	hostBindingDigest: `sha256:${"4".repeat(64)}`,
	attestationRefs: ["attestation:d667:1"],
});

const args = (): LocalUntrustedJsComputeArguments => ({
	contractVersion: "1",
	runId: "run:1",
	attempt: 1,
	epoch: "epoch:1",
	sourceRevision: "source:1",
	sourceDigest,
	bundleRevision: "bundle:1",
	bundleDigest,
	compilerRevision: "compiler:1",
	allowedApiRevision: "api:1",
	graphreflyPackageRevision: NODE_LOCAL_UNTRUSTED_JS_GRAPHREFLY_PACKAGE_REVISION,
	runnerRevision: "runner:1",
	runnerImageDigest: imageDigest,
	sandboxPolicyRevision: "sandbox:1",
	networkPolicyRevision: "deny-all-v1",
	filesystemPolicyRevision: "read-only-input-bounded-tmp-v1",
	resourcePolicyRevision: "resource:1",
	outputPolicyRevision: "output:1",
	admittedInputRefs: ["input:postgresql-result:1"],
	inputDigest,
});

const adapterInput = (): ToolProviderAdapterInput<LocalUntrustedJsComputeArguments> => ({
	kind: "tool-provider-adapter-input",
	adapterInputId: "adapter-input:1",
	status: "ready",
	requestId: "request:1",
	operationId: "operation:1",
	routeId: "route:1",
	providerId: "provider:local-untrusted-js",
	executorId: "executor:d667",
	profileId: "profile:local-v0",
	toolName: "graphrefly.local-untrusted-js-compute",
	operation: "run",
	toolCall: {
		kind: "tool-call",
		toolName: "graphrefly.local-untrusted-js-compute",
		operation: "run",
		arguments: args(),
	},
});

const admittedRunRequest = (): ToolProviderAdapterRunRequested => ({
	kind: "tool-provider-adapter-run-requested",
	runId: "run:1",
	adapterInputId: "adapter-input:1",
	requestId: "request:1",
	operationId: "operation:1",
	routeId: "route:1",
	providerId: "provider:local-untrusted-js",
	executorId: "executor:d667",
	profileId: "profile:local-v0",
	attempt: 1,
	reason: "initial",
	sourceRefs: [
		{ kind: "tool-provider-adapter-run", id: "run:candidate:1" },
		{ kind: "tool-provider-run-admission-proposal", id: "proposal:1" },
		{ kind: "tool-provider-run-admission", id: "run-admission:1" },
	],
	metadata: {
		approval: "granted",
		approvalGranted: true,
		admissionId: "run-admission:1",
		proposalId: "proposal:1",
		approvedFromRunId: "run:candidate:1",
	},
});

const runAdmission = (): ToolProviderRunAdmission => ({
	kind: "tool-provider-run-admission",
	admissionId: "run-admission:1",
	proposalId: "proposal:1",
	runId: "run:candidate:1",
	adapterInputId: "adapter-input:1",
	requestId: "request:1",
	operationId: "operation:1",
	state: "admitted",
	approvedRunId: "run:1",
});

const successfulDriver = (): LocalUntrustedJsComputeDriver => ({
	compatibility: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
	execute: vi.fn((_context, request) => ({
		outcome: "succeeded",
		cleanup: "succeeded",
		result: {
			contractVersion: "1",
			answer: { rows: 2 },
			topology: {
				name: "local-code-workgraph",
				nodes: [
					{ id: "question", name: "question", factory: "source", deps: [] },
					{ id: "answer", name: "answer", factory: "map", deps: ["question"] },
				],
				edges: [{ from: "question", to: "answer" }],
			},
			describe: {
				name: "local-code-workgraph",
				nodes: [
					{
						id: "question",
						name: "question",
						factory: "source",
						deps: [],
						status: "resolved",
						value: { text: "count rows" },
					},
					{
						id: "answer",
						name: "answer",
						factory: "map",
						deps: ["question"],
						status: "resolved",
						value: { rows: 2 },
					},
				],
				edges: [{ from: "question", to: "answer" }],
			},
			provenance: {
				sourceRevision: request.sourceRevision,
				sourceDigest: request.sourceDigest,
				bundleRevision: request.bundleRevision,
				bundleDigest: request.bundleDigest,
				compilerRevision: request.compilerRevision,
				allowedApiRevision: request.allowedApiRevision,
				graphreflyPackageRevision: request.graphreflyPackageRevision,
				runnerRevision: request.runnerRevision,
				runnerImageDigest: request.runnerImageDigest,
				manifestFingerprint: "manifest-fingerprint:1",
				runId: request.runId,
				attempt: request.attempt,
				graphName: "local-code-workgraph",
				answerNodeId: "answer",
				admittedInputRefs: request.admittedInputRefs,
				inputDigest: request.inputDigest,
				runAdmissionId: "run-admission:1",
			},
			cleanup: { graphNodesAfterDispose: 0, graphEdgesAfterDispose: 0 },
		},
	})),
});

const attemptOptions = (driver: LocalUntrustedJsComputeDriver) => ({
	manifest: manifest(),
	readiness: readiness(),
	args: args(),
	material: { bundle, input },
	adapterInput: adapterInput(),
	admittedRunRequest: admittedRunRequest(),
	runAdmission: runAdmission(),
	driver,
	signal: new AbortController().signal,
	now: () => 200,
});

const eventually = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for local untrusted JS compute evidence.");
};

describe("D667 local untrusted JS compute contract", () => {
	it("admits only the fixed v0 result and topology ceilings", () => {
		expect(
			localUntrustedJsComputeManifest({
				...manifest(),
				maxOutputBytes: 1024 * 1024,
				maxTopologyNodes: 1_000,
				maxTopologyEdges: 2_000,
			}),
		).toMatchObject({
			maxOutputBytes: 1024 * 1024,
			maxTopologyNodes: 1_000,
			maxTopologyEdges: 2_000,
		});
		expect(() =>
			localUntrustedJsComputeManifest({
				...manifest(),
				maxOutputBytes: 1024 * 1024 + 1,
			}),
		).toThrow("v0 ceiling");
		expect(() =>
			localUntrustedJsComputeManifest({
				...manifest(),
				maxTopologyNodes: 1_001,
			}),
		).toThrow("v0 ceiling");
		expect(() =>
			localUntrustedJsComputeManifest({
				...manifest(),
				maxTopologyEdges: 2_001,
			}),
		).toThrow("v0 ceiling");
	});

	it("runs one exact admitted attempt and returns bounded actual topology/provenance only after cleanup", async () => {
		const driver = successfulDriver();
		const outcome = await runLocalUntrustedJsComputeAttempt({
			manifest: manifest(),
			readiness: readiness(),
			args: args(),
			material: {
				bundle,
				input,
			},
			adapterInput: adapterInput(),
			admittedRunRequest: admittedRunRequest(),
			runAdmission: runAdmission(),
			driver,
			signal: new AbortController().signal,
			now: () => 200,
		});
		expect(outcome).toMatchObject({
			outcome: "succeeded",
			cleanup: "succeeded",
			result: {
				answer: { rows: 2 },
				topology: { name: "local-code-workgraph" },
				provenance: {
					runId: "run:1",
					bundleDigest,
					admittedInputRefs: ["input:postgresql-result:1"],
				},
			},
		});
		expect(driver.execute).toHaveBeenCalledTimes(1);
	});

	it("fails closed before the driver on stale readiness or coordinate drift", async () => {
		for (const changed of [
			{ readiness: { ...readiness(), expiresAtMs: 150 } },
			{ args: { ...args(), runnerRevision: "runner:stale" } },
			{ args: { ...args(), admittedInputRefs: [] } },
		]) {
			const driver = successfulDriver();
			await expect(
				runLocalUntrustedJsComputeAttempt({
					manifest: manifest(),
					readiness: changed.readiness ?? readiness(),
					args: changed.args ?? args(),
					material: { bundle, input },
					adapterInput: adapterInput(),
					admittedRunRequest: admittedRunRequest(),
					runAdmission: runAdmission(),
					driver,
					signal: new AbortController().signal,
					now: () => 200,
				}),
			).rejects.toThrow(TypeError);
			expect(driver.execute).not.toHaveBeenCalled();
		}
	});

	it("downgrades success when cleanup is not verified and rejects forged runtime provenance", async () => {
		const cleanupDriver = successfulDriver();
		vi.mocked(cleanupDriver.execute).mockImplementationOnce(async (...call) => {
			const good = await successfulDriver().execute(...call);
			return { ...good, cleanup: "failed" };
		});
		await expect(
			runLocalUntrustedJsComputeAttempt({
				manifest: manifest(),
				readiness: readiness(),
				args: args(),
				material: { bundle, input },
				adapterInput: adapterInput(),
				admittedRunRequest: admittedRunRequest(),
				runAdmission: runAdmission(),
				driver: cleanupDriver,
				signal: new AbortController().signal,
				now: () => 200,
			}),
		).resolves.toMatchObject({
			outcome: "failed",
			code: "local-untrusted-js-compute-cleanup-not-verified",
			cleanup: "failed",
		});

		const forgedDriver = successfulDriver();
		vi.mocked(forgedDriver.execute).mockImplementationOnce(async (...call) => {
			const good = await successfulDriver().execute(...call);
			if (good.outcome !== "succeeded") return good;
			return {
				...good,
				result: {
					...good.result,
					provenance: { ...good.result.provenance, bundleDigest: `sha256:${"f".repeat(64)}` },
				},
			};
		});
		await expect(
			runLocalUntrustedJsComputeAttempt({
				manifest: manifest(),
				readiness: readiness(),
				args: args(),
				material: { bundle, input },
				adapterInput: adapterInput(),
				admittedRunRequest: admittedRunRequest(),
				runAdmission: runAdmission(),
				driver: forgedDriver,
				signal: new AbortController().signal,
				now: () => 200,
			}),
		).rejects.toThrow("mismatched provenance");

		const detachedAnswerDriver = successfulDriver();
		vi.mocked(detachedAnswerDriver.execute).mockImplementationOnce(async (...call) => {
			const good = await successfulDriver().execute(...call);
			if (good.outcome !== "succeeded") return good;
			return {
				...good,
				result: {
					...good.result,
					provenance: { ...good.result.provenance, answerNodeId: "question" },
				},
			};
		});
		await expect(
			runLocalUntrustedJsComputeAttempt({
				...attemptOptions(detachedAnswerDriver),
				now: () => 200,
			}),
		).rejects.toThrow("topology and describe snapshots disagree");
	});

	it("does not accept a mutable image tag for the Node broker", () => {
		expect(() =>
			nodeLocalUntrustedJsComputeDriver({ imageRef: "docker.io/library/node:24" }),
		).toThrow("digest pinned");
		expect(
			nodeLocalUntrustedJsComputeDriver({
				imageRef: `docker.io/graphrefly/local-untrusted-js@${imageDigest}`,
			}).compatibility,
		).toBe(LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY);
	});

	it("binds immutable bundle/input bytes and exact D419 admission before invoking a driver", async () => {
		for (const changed of [
			{ material: { bundle: new Uint8Array([9]), input } },
			{ material: { bundle, input: { ...input, question: "different admitted bytes" } } },
			{
				admittedRunRequest: { ...admittedRunRequest(), routeId: "route:different" },
			},
			{
				runAdmission: { ...runAdmission(), state: "blocked" as const },
			},
			{
				runAdmission: { ...runAdmission(), approvedRunId: "run:different" },
			},
			{
				admittedRunRequest: {
					...admittedRunRequest(),
					sourceRefs: [
						...(admittedRunRequest().sourceRefs ?? []),
						{ kind: "tool-provider-run-admission", id: "run-admission:other" },
					],
				},
			},
			{
				adapterInput: {
					...adapterInput(),
					toolCall: { ...adapterInput().toolCall, arguments: { ...args(), epoch: "epoch:2" } },
				},
			},
		]) {
			const driver = successfulDriver();
			await expect(
				runLocalUntrustedJsComputeAttempt({ ...attemptOptions(driver), ...changed }),
			).rejects.toThrow(TypeError);
			expect(driver.execute).not.toHaveBeenCalled();
		}
	});

	it("rejects malformed, inconsistent, nested-overflow and private-field Graph evidence", async () => {
		const invalidResults = [
			(
				good: Extract<
					Awaited<ReturnType<LocalUntrustedJsComputeDriver["execute"]>>,
					{ outcome: "succeeded" }
				>,
			) => ({
				...good.result,
				topology: { nodes: [{ totally: "invalid" }], edges: [] },
			}),
			(
				good: Extract<
					Awaited<ReturnType<LocalUntrustedJsComputeDriver["execute"]>>,
					{ outcome: "succeeded" }
				>,
			) => ({
				...good.result,
				describe: { ...good.result.describe, name: "different-graph" },
			}),
			(
				good: Extract<
					Awaited<ReturnType<LocalUntrustedJsComputeDriver["execute"]>>,
					{ outcome: "succeeded" }
				>,
			) => ({
				...good.result,
				topology: {
					...good.result.topology,
					subgraphs: Array.from({ length: 8 }, (_, index) => ({
						name: `nested-${index}`,
						nodes: [{ id: `nested-${index}`, factory: "source", deps: [] }],
						edges: [],
					})),
				},
			}),
			(
				good: Extract<
					Awaited<ReturnType<LocalUntrustedJsComputeDriver["execute"]>>,
					{ outcome: "succeeded" }
				>,
			) => ({
				...good.result,
				provenance: { ...good.result.provenance, secret: "must-not-cross" },
			}),
			(
				good: Extract<
					Awaited<ReturnType<LocalUntrustedJsComputeDriver["execute"]>>,
					{ outcome: "succeeded" }
				>,
			) => ({
				...good.result,
				topology: {
					...good.result.topology,
					subgraphs: [
						{
							mountId: "child:1",
							name: "child-1",
							nodes: [{ id: "question", factory: "source", deps: [] }],
							edges: [],
						},
					],
				},
			}),
			(
				good: Extract<
					Awaited<ReturnType<LocalUntrustedJsComputeDriver["execute"]>>,
					{ outcome: "succeeded" }
				>,
			) => ({
				...good.result,
				topology: {
					...good.result.topology,
					subgraphs: [
						{
							mountId: "child:same",
							name: "child-1",
							nodes: [{ id: "child-1", factory: "source", deps: [] }],
							edges: [],
						},
						{
							mountId: "child:same",
							name: "child-2",
							nodes: [{ id: "child-2", factory: "source", deps: [] }],
							edges: [],
						},
					],
				},
			}),
		];
		for (const invalidResult of invalidResults) {
			const driver = successfulDriver();
			vi.mocked(driver.execute).mockImplementationOnce(async (...call) => {
				const good = await successfulDriver().execute(...call);
				if (good.outcome !== "succeeded") return good;
				return { ...good, result: invalidResult(good) };
			});
			await expect(runLocalUntrustedJsComputeAttempt(attemptOptions(driver))).rejects.toThrow(
				TypeError,
			);
		}
	});

	it("fails closed on output overflow and preserves exact canceled-before-allocation posture", async () => {
		const overflowDriver = successfulDriver();
		vi.mocked(overflowDriver.execute).mockImplementationOnce(async (...call) => {
			const good = await successfulDriver().execute(...call);
			if (good.outcome !== "succeeded") return good;
			const oversizedAnswer = "x".repeat(20_000);
			return {
				...good,
				result: {
					...good.result,
					answer: oversizedAnswer,
					describe: {
						...good.result.describe,
						nodes: good.result.describe.nodes.map((node) =>
							node.id === good.result.provenance.answerNodeId
								? { ...node, value: oversizedAnswer }
								: node,
						),
					},
				},
			};
		});
		await expect(runLocalUntrustedJsComputeAttempt(attemptOptions(overflowDriver))).rejects.toThrow(
			"output byte bound",
		);

		const canceledDriver = successfulDriver();
		const controller = new AbortController();
		controller.abort();
		await expect(
			runLocalUntrustedJsComputeAttempt({
				...attemptOptions(canceledDriver),
				signal: controller.signal,
			}),
		).resolves.toEqual({
			outcome: "canceled",
			code: "local-untrusted-js-compute-canceled-before-allocation",
			cleanup: "succeeded",
		});
		expect(canceledDriver.execute).not.toHaveBeenCalled();
	});
});

describe("D667 local untrusted JS compute Graph-visible runtime", () => {
	const setup = (driver: LocalUntrustedJsComputeDriver) => {
		const graph = new Graph();
		const sources = graph.topologyGroup({ name: "local-untrusted-js-compute-fixtures" });
		const inputNode = sources.node<ToolProviderAdapterInput<LocalUntrustedJsComputeArguments>>();
		const requestNode = sources.node<ToolProviderAdapterRunRequested>();
		const admissionNode = sources.node<ToolProviderRunAdmission>();
		const manifestNode = sources.node<LocalUntrustedJsComputeManifest>();
		const readinessNode = sources.node<LocalUntrustedJsComputeReadiness>();
		const cancellationNode = sources.node<LocalUntrustedJsComputeCancellationAdmission>();
		const runtime = localUntrustedJsComputeRuntime(graph, {
			name: "testLocalUntrustedJsCompute",
			inputs: inputNode,
			admittedRunRequests: [requestNode],
			runAdmissions: [admissionNode],
			manifests: [manifestNode],
			readiness: [readinessNode],
			cancellationAdmissions: [cancellationNode],
			driver,
			loadMaterial: vi.fn(async () => ({ bundle, input })),
			now: () => 200,
		});
		const request = {
			...admittedRunRequest(),
			metadata: {
				...admittedRunRequest().metadata,
				manifestFingerprint: manifest().fingerprint,
			},
		};
		const publishAuthority = () => {
			inputNode.down([["DATA", adapterInput()]]);
			admissionNode.down([["DATA", runAdmission()]]);
			manifestNode.down([["DATA", manifest()]]);
			readinessNode.down([["DATA", readiness()]]);
		};
		return {
			graph,
			sources,
			runtime,
			requestNode,
			cancellationNode,
			request,
			publishAuthority,
		};
	};

	it("projects an exact admitted run through status, lifecycle, outcome, usage, audit and cleanup", async () => {
		const driver = successfulDriver();
		const fixture = setup(driver);
		const statuses: ToolProviderAdapterRunStatus[] = [];
		const outcomesSeen: ExecutorOutcome[] = [];
		const lifecycleStates: string[] = [];
		const usageSeen: unknown[] = [];
		const cleanupSeen: unknown[] = [];
		const audits: AgentRuntimeAuditRecord[] = [];
		const unsubscribes = [
			fixture.runtime.runStatus.subscribe((message) => {
				if (message[0] === "DATA") statuses.push(message[1]);
			}),
			fixture.runtime.outcomes.subscribe((message) => {
				if (message[0] === "DATA") outcomesSeen.push(message[1]);
			}),
			fixture.runtime.lifecycle.subscribe((message) => {
				if (message[0] === "DATA") lifecycleStates.push(message[1].state);
			}),
			fixture.runtime.usage.subscribe((message) => {
				if (message[0] === "DATA") usageSeen.push(message[1]);
			}),
			fixture.runtime.cleanup.subscribe((message) => {
				if (message[0] === "DATA") cleanupSeen.push(message[1]);
			}),
			fixture.runtime.audit.subscribe((message) => {
				if (message[0] === "DATA") audits.push(message[1]);
			}),
		];
		fixture.publishAuthority();
		fixture.requestNode.down([["DATA", fixture.request]]);
		await eventually(() => outcomesSeen.length === 1);
		expect(statuses.map((entry) => entry.status)).toEqual(["requested", "started", "result"]);
		expect(lifecycleStates).toEqual([
			"admitted",
			"loading-material",
			"running",
			"cleaning",
			"settled",
		]);
		expect(outcomesSeen[0]).toMatchObject({
			kind: "result",
			requestId: "request:1",
			usage: { latencyMs: 0 },
			result: {
				kind: "local-untrusted-js-compute-result",
				value: {
					answer: { rows: 2 },
					topology: { name: "local-code-workgraph" },
					provenance: { runAdmissionId: "run-admission:1" },
				},
			},
		});
		expect(usageSeen).toEqual([
			{
				kind: "local-untrusted-js-compute-usage",
				runId: "run:1",
				attempt: 1,
				latencyMs: 0,
			},
		]);
		expect(cleanupSeen).toEqual([
			{
				kind: "local-untrusted-js-compute-cleanup-status",
				runId: "run:1",
				attempt: 1,
				epoch: "epoch:1",
				state: "succeeded",
			},
		]);
		expect(audits.map((entry) => entry.kind)).toContain("local-untrusted-js-compute-settled");

		fixture.requestNode.down([["DATA", fixture.request]]);
		await eventually(() => statuses.some((entry) => entry.status === "stale-request"));
		expect(driver.execute).toHaveBeenCalledTimes(1);

		for (const unsubscribe of unsubscribes) unsubscribe();
		await fixture.runtime.dispose();
		expect(fixture.graph.topology().nodes).toHaveLength(6);
		fixture.sources.release({ reason: "test-complete" });
		expect(fixture.graph.topology()).toEqual({ nodes: [], edges: [] });
	});

	it("rejects coordinate drift and delivers only an exact admitted cancellation", async () => {
		const driver: LocalUntrustedJsComputeDriver = {
			compatibility: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
			execute: vi.fn(
				(context) =>
					new Promise((resolve) => {
						context.signal.addEventListener(
							"abort",
							() =>
								resolve({
									outcome: "canceled",
									code: "local-untrusted-js-compute-canceled",
									cleanup: "succeeded",
								}),
							{ once: true },
						);
					}),
			),
		};
		const fixture = setup(driver);
		const statuses: ToolProviderAdapterRunStatus[] = [];
		const outcomesSeen: ExecutorOutcome[] = [];
		const cancellationsSeen: unknown[] = [];
		const issuesSeen: string[] = [];
		const unsubscribes = [
			fixture.runtime.runStatus.subscribe((message) => {
				if (message[0] === "DATA") statuses.push(message[1]);
			}),
			fixture.runtime.outcomes.subscribe((message) => {
				if (message[0] === "DATA") outcomesSeen.push(message[1]);
			}),
			fixture.runtime.cancellations.subscribe((message) => {
				if (message[0] === "DATA") cancellationsSeen.push(message[1]);
			}),
			fixture.runtime.issues.subscribe((message) => {
				if (message[0] === "DATA") issuesSeen.push(message[1].code);
			}),
		];
		fixture.publishAuthority();
		fixture.requestNode.down([["DATA", fixture.request]]);
		await eventually(() => statuses.some((entry) => entry.status === "started"));
		const exactCancellation: LocalUntrustedJsComputeCancellationAdmission = {
			kind: "local-untrusted-js-compute-cancellation-admission",
			admissionId: "cancel-admission:1",
			cancellationId: "cancellation:1",
			state: "admitted",
			runId: "run:1",
			adapterInputId: "adapter-input:1",
			requestId: "request:1",
			operationId: "operation:1",
			routeId: "route:1",
			providerId: "provider:local-untrusted-js",
			executorId: "executor:d667",
			profileId: "profile:local-v0",
			runAdmissionId: "run-admission:1",
			attempt: 1,
			epoch: "epoch:1",
			manifestFingerprint: "manifest-fingerprint:1",
			hostBindingDigest: readiness().hostBindingDigest,
			sourceRefs: [{ kind: "local-cancellation-decision", id: "cancel-decision:1" }],
		};
		fixture.cancellationNode.down([["DATA", { ...exactCancellation, epoch: "epoch:stale" }]]);
		await eventually(() => cancellationsSeen.length === 1);
		expect(cancellationsSeen[0]).toMatchObject({ state: "rejected" });
		expect(outcomesSeen).toHaveLength(0);

		fixture.cancellationNode.down([["DATA", exactCancellation]]);
		await eventually(() => outcomesSeen.length === 1);
		expect(cancellationsSeen[1]).toMatchObject({
			state: "accepted",
			admissionId: "cancel-admission:1",
		});
		expect(outcomesSeen[0]).toMatchObject({
			kind: "canceled",
			metadata: { cleanup: "succeeded" },
		});
		expect(issuesSeen).toContain("local-untrusted-js-compute-cancellation-coordinate-mismatch");

		for (const unsubscribe of unsubscribes) unsubscribe();
		await fixture.runtime.dispose();
		fixture.sources.release({ reason: "test-complete" });
		expect(fixture.graph.topology()).toEqual({ nodes: [], edges: [] });
	});

	it("does not resolve disposal or release topology before active private cleanup settles", async () => {
		let privateCleanupSettled = false;
		let markDriverEntered = () => {};
		const driverEntered = new Promise<void>((resolve) => {
			markDriverEntered = resolve;
		});
		const driver: LocalUntrustedJsComputeDriver = {
			compatibility: LOCAL_UNTRUSTED_JS_COMPUTE_COMPATIBILITY,
			execute: vi.fn((context) => {
				markDriverEntered();
				return new Promise((resolve) => {
					context.signal.addEventListener(
						"abort",
						() => {
							setTimeout(() => {
								privateCleanupSettled = true;
								resolve({
									outcome: "canceled",
									code: "local-untrusted-js-compute-canceled",
									cleanup: "succeeded",
								});
							}, 40);
						},
						{ once: true },
					);
				});
			}),
		};
		const fixture = setup(driver);
		const statuses: ToolProviderAdapterRunStatus[] = [];
		const unsubscribe = fixture.runtime.runStatus.subscribe((message) => {
			if (message[0] === "DATA") statuses.push(message[1]);
		});
		fixture.publishAuthority();
		fixture.requestNode.down([["DATA", fixture.request]]);
		await eventually(() => statuses.some((entry) => entry.status === "started"));
		await driverEntered;
		unsubscribe();

		let disposeResolved = false;
		const disposing = fixture.runtime.dispose().then(() => {
			disposeResolved = true;
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
		expect(privateCleanupSettled).toBe(false);
		expect(disposeResolved).toBe(false);
		expect(fixture.graph.topology().nodes).toHaveLength(15);

		await disposing;
		expect(privateCleanupSettled).toBe(true);
		expect(fixture.graph.topology().nodes).toHaveLength(6);
		fixture.sources.release({ reason: "test-complete" });
		expect(fixture.graph.topology()).toEqual({ nodes: [], edges: [] });
	});
});
