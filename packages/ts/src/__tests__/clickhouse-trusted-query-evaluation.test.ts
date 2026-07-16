import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type {
	ExecutorOutcome,
	ToolProviderAdapterRunRequested,
	ToolProviderRunAdmissionDecision,
} from "../orchestration/index.js";
import {
	requestToolProviderAdapterRun,
	toolProviderRunAdmissionProjector,
} from "../orchestration/index.js";
import {
	CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID,
	CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION,
	CLICKHOUSE_TRUSTED_QUERY_OPERATION,
	CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND,
	CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID,
	type ClickHouseTrustedQueryCancellationDecision,
	type ClickHouseTrustedQueryCancellationRequested,
	type ClickHouseTrustedQueryEvaluationProfile,
	type ClickHouseTrustedQueryHostExecutionRequest,
	clickHouseTrustedQueryRuntime,
	createClickHouseTrustedQueryAdapterInput,
	createClickHouseTrustedQueryCampaignRevision,
	createClickHouseTrustedQueryScenarioResult,
	createClickHouseTrustedQueryScenarioResultFromOutcome,
	isClickHouseTrustedQueryCandidate,
} from "../solutions/clickhouse-trusted-query-evaluation.js";
import type { ProductionCandidatePins } from "../solutions/production-evaluation-authority.js";

const ref = (id: string, revision = "r1") => ({ id, revision });
const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
const candidate: ProductionCandidatePins = {
	adapter: ref(CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID, "adapter-r1"),
	runtime: ref("clickhouse-runtime-profile", "runtime-r1"),
	configurationFingerprint: "clickhouse-config-fingerprint-r1",
};
const profile = (at = 100): ClickHouseTrustedQueryEvaluationProfile => ({
	kind: CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND,
	contractVersion: CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION,
	scope,
	campaign: ref("clickhouse-campaign", "campaign-r1"),
	previousCampaignRevision: null,
	candidate,
	scenarioPack: ref("trusted-query-scenarios", "pack-r1"),
	criteria: ref("trusted-query-criteria", "criteria-r1"),
	scenarios: [
		{ scenarioId: "latency-and-correctness", revision: "scenario-r1", dependencyIds: [] },
	],
	environmentRefs: [ref("environment-profile")],
	dataRefs: [ref("dataset-snapshot")],
	sourceRefs: [ref("source-catalog")],
	schemaRefs: [ref("schema-fingerprint")],
	policyRefs: [ref("query-policy")],
	queryPlanRefs: [ref("query-plan-fingerprint")],
	createdBy: "actor",
	createdAtMs: at,
});
const resultInput = (at = 110) => ({
	kind: "clickhouse-trusted-query-scenario-result-input" as const,
	profile: profile(100),
	scenario: ref("latency-and-correctness", "scenario-r1"),
	resultId: "result-1",
	requestId: "request-1",
	admissionId: "admission-1",
	runId: "run-1",
	attempt: 1,
	outcomeId: "outcome-1",
	evidenceId: "evidence-1",
	evidenceHighWater: 8,
	outcome: "succeeded" as const,
	measurements: { correctness: 1, latencyMs: 42 },
	evidenceRefs: [ref("evidence-1"), ref("source-catalog"), ref("query-plan-fingerprint")],
	recordedAtMs: at,
});

const executionArguments = () => ({
	contractVersion: CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION,
	profile: profile(),
	scenario: ref("latency-and-correctness", "scenario-r1"),
	queryPlan: ref("query-plan-fingerprint"),
	source: ref("source-catalog"),
	schema: ref("schema-fingerprint"),
	policy: ref("query-policy"),
});

const adapterInput = (mode: "auto" | "require" | "never" = "require") =>
	createClickHouseTrustedQueryAdapterInput({
		requestId: "request-1",
		operationId: "operation-1",
		effectRunId: "effect-run-1",
		routeId: "route-clickhouse-evaluation",
		executorId: "clickhouse-evaluation-executor",
		profileId: "clickhouse-evaluation-profile-r1",
		arguments: executionArguments(),
		approval: { policyId: "clickhouse-evaluation-approval", mode },
	});

function collect<T>(node: {
	subscribe(callback: (message: readonly [string, unknown]) => void): () => void;
}): { readonly values: T[]; readonly unsubscribe: () => void } {
	const values: T[] = [];
	const unsubscribe = node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return { values, unsubscribe };
}

const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
describe("ClickHouse trusted-query evaluation contracts (D628)", () => {
	it("creates a focused ClickHouse candidate and D610 campaign without generic registry fields", () => {
		expect(isClickHouseTrustedQueryCandidate(candidate)).toBe(true);
		expect(
			isClickHouseTrustedQueryCandidate({
				...candidate,
				adapter: ref("generic-database-provider", "adapter-r1"),
			}),
		).toBe(false);
		const campaign = createClickHouseTrustedQueryCampaignRevision(profile());
		expect(campaign).toMatchObject({
			kind: "production-evaluation-campaign-revision",
			campaignId: "clickhouse-campaign",
			revision: "campaign-r1",
			candidate,
			scenarioPack: ref("trusted-query-scenarios", "pack-r1"),
			criteria: ref("trusted-query-criteria", "criteria-r1"),
			sourceRefs: [ref("source-catalog"), ref("query-plan-fingerprint")],
		});
		expect(Object.isFrozen(campaign)).toBe(true);
		expect(campaign).not.toHaveProperty("queryText");
		expect(campaign).not.toHaveProperty("client");
		expect(campaign).not.toHaveProperty("providerRegistry");
	});

	it("maps a pinned scenario execution into D419/D610 result coordinates", () => {
		const result = createClickHouseTrustedQueryScenarioResult(resultInput());
		expect(result).toMatchObject({
			kind: "production-scenario-result",
			scope,
			campaignId: "clickhouse-campaign",
			campaignRevision: "campaign-r1",
			scenarioId: "latency-and-correctness",
			scenarioRevision: "scenario-r1",
			requestId: "request-1",
			admissionId: "admission-1",
			runId: "run-1",
			attempt: 1,
			outcomeId: "outcome-1",
			evidenceId: "evidence-1",
			candidate,
		});
		expect(Object.isFrozen(result.evidenceRefs)).toBe(true);
	});

	it("rejects private material, raw SQL, URLs, cursors, and unpinned scenarios", () => {
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				sourceRefs: [ref("https://clickhouse.example.internal")],
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				queryPlanRefs: [ref("select count from private_table")],
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				queryPlanRefs: [ref("explain select count from events")],
			}),
		).toThrow("private-material");
		for (const rawSql of [
			"show tables",
			"describe table users",
			"system flush logs",
			"use analytics",
		]) {
			expect(() =>
				createClickHouseTrustedQueryCampaignRevision({
					...profile(),
					queryPlanRefs: [ref(rawSql)],
				}),
			).toThrow("private-material");
		}
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				requestId: "request=password",
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				evidenceId: "secret-evidence-id",
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				measurements: { "cursor=private": 1 },
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				measurements: { cursor: 1 },
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				measurements: { pageCursor: 1 },
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				scenario: ref("not-pinned", "scenario-r1"),
			}),
		).toThrow("scenario-not-pinned");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				scenarios: [
					{
						scenarioId: "latency-and-correctness",
						revision: "scenario-r1",
						dependencyIds: ["schema-change", "schema-change"],
					},
					{ scenarioId: "schema-change", revision: "scenario-r1", dependencyIds: [] },
				],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				profile: {
					...profile(),
					scenarios: [
						{
							scenarioId: "latency-and-correctness",
							revision: "scenario-r1",
							dependencyIds: ["schema-change"],
						},
						{
							scenarioId: "schema-change",
							revision: "scenario-r1",
							dependencyIds: ["latency-and-correctness"],
						},
					],
				},
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				environmentRefs: Array(
					1,
				) as unknown as ClickHouseTrustedQueryEvaluationProfile["environmentRefs"],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				scenarios: Array(1) as unknown as ClickHouseTrustedQueryEvaluationProfile["scenarios"],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				scenarios: [
					{
						scenarioId: "latency-and-correctness",
						revision: "scenario-r1",
						dependencyIds: Array(1) as unknown as string[],
					},
				],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				evidenceRefs: Array(1) as unknown as ReturnType<typeof resultInput>["evidenceRefs"],
			}),
		).toThrow("result-invalid");
	});

	it("rejects accessor-bearing runtime/client shaped material before reading it", () => {
		let reads = 0;
		const malicious = {
			...profile(),
			get queryPlanRefs() {
				reads++;
				return [ref("query-plan-fingerprint")];
			},
		};
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision(
				malicious as unknown as ClickHouseTrustedQueryEvaluationProfile,
			),
		).toThrow("accessor");
		expect(reads).toBe(0);
		const accessorCandidate = {
			configurationFingerprint: candidate.configurationFingerprint,
			runtime: candidate.runtime,
		};
		Object.defineProperty(accessorCandidate, "adapter", {
			enumerable: true,
			get() {
				reads++;
				return candidate.adapter;
			},
		});
		expect(isClickHouseTrustedQueryCandidate(accessorCandidate)).toBe(false);
		expect(reads).toBe(0);
	});

	it("lowers only pinned coordinates and never admits raw SQL or runtime material", () => {
		const input = adapterInput();
		expect(input).toMatchObject({
			kind: "tool-provider-adapter-input",
			status: "ready",
			providerId: CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID,
			operation: CLICKHOUSE_TRUSTED_QUERY_OPERATION,
		});
		expect(JSON.stringify(input)).not.toMatch(/endpoint|credential|password|client|pool|rawRows/i);
		expect(() =>
			createClickHouseTrustedQueryAdapterInput({
				requestId: "request-1",
				operationId: "operation-1",
				effectRunId: "effect-run-1",
				routeId: "route-clickhouse-evaluation",
				executorId: "clickhouse-evaluation-executor",
				profileId: "clickhouse-evaluation-profile-r1",
				approval: { policyId: "clickhouse-evaluation-approval", mode: "require" },
				arguments: {
					...executionArguments(),
					queryPlan: ref("select count from private_table"),
				},
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryAdapterInput({
				requestId: "request-1",
				operationId: "operation-1",
				effectRunId: "effect-run-1",
				routeId: "route-clickhouse-evaluation",
				executorId: "clickhouse-evaluation-executor",
				profileId: "clickhouse-evaluation-profile-r1",
				approval: { policyId: "clickhouse-evaluation-approval", mode: "require" },
				arguments: { ...executionArguments(), schema: ref("unpinned-schema") },
			}),
		).toThrow("not-pinned");
	});

	it("keeps the first exact input immutable and rejects a forged require-mode admission", async () => {
		const g = graph({ name: "clickhouse-input-immutability" });
		const inputs = g.node<ReturnType<typeof adapterInput>>([], null);
		const admitted = g.node<ToolProviderAdapterRunRequested>([], null);
		let calls = 0;
		const runtime = clickHouseTrustedQueryRuntime(g, {
			inputs,
			admittedRunRequests: [admitted],
			capability: {
				execute() {
					calls += 1;
					throw new Error("must-not-execute");
				},
			},
		});
		const issues = collect<{ code: string }>(runtime.issues);
		const required = adapterInput("require");
		const conflicting = adapterInput("auto");
		expect(conflicting.adapterInputId).toBe(required.adapterInputId);
		inputs.down([
			["DATA", required],
			["DATA", conflicting],
		]);
		const approvedFromRunId = "forged-candidate-1";
		const proposalId = compoundTupleKey("tool-provider-run-admission-proposal", [
			approvedFromRunId,
		]);
		const admissionId = "forged-admission-1";
		admitted.down([
			[
				"DATA",
				requestToolProviderAdapterRun(required, {
					runId: "forged-approved-run-1",
					reason: "manual",
					sourceRefs: [
						{ kind: "tool-provider-adapter-run", id: approvedFromRunId },
						{ kind: "tool-provider-run-admission-proposal", id: proposalId },
						{ kind: "tool-provider-run-admission", id: admissionId },
					],
					metadata: {
						approval: "granted",
						approvalGranted: true,
						admissionId,
						proposalId,
						approvedFromRunId,
					},
				}),
			],
		]);
		await settle();
		expect(calls).toBe(0);
		expect(issues.values.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"clickhouse-trusted-query-adapter-input-coordinate-conflict",
				"clickhouse-trusted-query-run-input-mismatch",
			]),
		);
		issues.unsubscribe();
		await runtime.dispose();
	});

	it("waits for ordinary D419 admission, executes once, and maps the real outcome to D610", async () => {
		const g = graph({ name: "clickhouse-d419-success" });
		const inputs = g.node<ReturnType<typeof adapterInput>>([], null, { name: "inputs" });
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null, { name: "candidates" });
		const decisions = g.node<ToolProviderRunAdmissionDecision>([], null, { name: "decisions" });
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
			decisions: [decisions],
			now: () => 105,
		});
		const beforeRuntime = g.topology();
		const approvedRuns = collect<ToolProviderAdapterRunRequested>(admission.approvedRunRequests);
		const calls: ClickHouseTrustedQueryHostExecutionRequest[] = [];
		const runtime = clickHouseTrustedQueryRuntime(g, {
			inputs,
			admittedRunRequests: [admission.approvedRunRequests],
			now: () => 110,
			capability: {
				execute(request) {
					calls.push(request);
					return {
						kind: "clickhouse-trusted-query-host-settlement",
						measurements: { correctness: 1, latencyMs: 42 },
						evidenceId: "evidence-1",
						evidenceHighWater: 8,
						evidenceRefs: [
							ref("evidence-1"),
							ref("latency-and-correctness", "scenario-r1"),
							ref("source-catalog"),
							ref("query-plan-fingerprint"),
							ref("schema-fingerprint"),
							ref("query-policy"),
						],
						recordedAtMs: 110,
					};
				},
			},
		});
		const afterRuntime = g.topology();
		expect(afterRuntime.nodes.length - beforeRuntime.nodes.length).toBe(7);
		expect(afterRuntime.edges.length - beforeRuntime.edges.length).toBe(0);
		const seen = collect<ExecutorOutcome>(runtime.outcomes);
		const runtimeIssues = collect<{ code: string }>(runtime.issues);
		const input = adapterInput();
		const candidateRun = requestToolProviderAdapterRun(input, {
			runId: "candidate-run-1",
			reason: "manual",
		});
		inputs.down([["DATA", input]]);
		candidates.down([["DATA", candidateRun]]);
		await settle();
		expect(calls).toHaveLength(0);
		decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision-1",
					proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [
						candidateRun.runId,
					]),
					admissionId: "admission-1",
					outcome: "admit",
					approvedRunId: "run-1",
				} satisfies ToolProviderRunAdmissionDecision,
			],
		]);
		await settle();
		expect(
			calls,
			JSON.stringify({ issues: runtimeIssues.values, approved: approvedRuns.values }),
		).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			requestId: "request-1",
			admissionId: "admission-1",
			runId: "run-1",
			attempt: 1,
		});
		expect(seen.values).toHaveLength(1);
		const result = createClickHouseTrustedQueryScenarioResultFromOutcome({
			arguments: executionArguments(),
			resultId: "result-from-runtime-1",
			outcome: seen.values[0]!,
		});
		expect(result).toMatchObject({
			requestId: "request-1",
			admissionId: "admission-1",
			runId: "run-1",
			outcome: "succeeded",
			measurements: { correctness: 1, latencyMs: 42 },
		});
		const wrongArguments = {
			...executionArguments(),
			profile: {
				...profile(),
				scenarios: [
					...profile().scenarios,
					{ scenarioId: "other-scenario", revision: "scenario-r1", dependencyIds: [] },
				],
			},
			scenario: ref("other-scenario", "scenario-r1"),
		};
		expect(() =>
			createClickHouseTrustedQueryScenarioResultFromOutcome({
				arguments: wrongArguments,
				resultId: "wrong-scenario-result",
				outcome: seen.values[0]!,
			}),
		).toThrow("execution-correlation-mismatch");
		const tamperedOutcome = structuredClone(seen.values[0]!);
		tamperedOutcome.metadata!.evidenceId = "different-evidence";
		expect(() =>
			createClickHouseTrustedQueryScenarioResultFromOutcome({
				arguments: executionArguments(),
				resultId: "tampered-result",
				outcome: tamperedOutcome,
			}),
		).toThrow("settlement-metadata-mismatch");
		const { result: _ignoredResult, ...outcomeBase } = seen.values[0] as Extract<
			ExecutorOutcome,
			{ kind: "result" }
		>;
		expect(() =>
			createClickHouseTrustedQueryScenarioResultFromOutcome({
				arguments: executionArguments(),
				resultId: "blocked-is-not-execution",
				outcome: { ...outcomeBase, kind: "blocked", needs: [] },
			}),
		).toThrow("blocked-is-not-execution");
		const graphEvidence = JSON.stringify({ outcome: seen.values[0], topology: g.topology() });
		expect(graphEvidence).not.toMatch(/sql|credential|password|client|pool|rawRows/i);
		seen.unsubscribe();
		runtimeIssues.unsubscribe();
		approvedRuns.unsubscribe();
		await runtime.dispose();
		const afterDispose = g.topology();
		expect(afterDispose.nodes.length).toBe(beforeRuntime.nodes.length);
		expect(afterDispose.edges.length).toBe(beforeRuntime.edges.length);
	});

	it("fails closed on malformed private host settlement without leaking its material", async () => {
		const g = graph({ name: "clickhouse-malformed-settlement" });
		const inputs = g.node<ReturnType<typeof adapterInput>>([], null);
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null);
		const decisions = g.node<ToolProviderRunAdmissionDecision>([], null);
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
			decisions: [decisions],
		});
		const runtime = clickHouseTrustedQueryRuntime(g, {
			inputs,
			admittedRunRequests: [admission.approvedRunRequests],
			now: () => 115,
			capability: {
				execute() {
					return {
						kind: "clickhouse-trusted-query-host-settlement",
						measurements: { correctness: 1 },
						evidenceId: "password=do-not-leak",
						evidenceHighWater: 8,
						evidenceRefs: [ref("evidence-1")],
						recordedAtMs: 115,
					};
				},
			},
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const input = adapterInput();
		inputs.down([["DATA", input]]);
		const candidateRun = requestToolProviderAdapterRun(input, {
			runId: "candidate-malformed-1",
			reason: "manual",
		});
		candidates.down([["DATA", candidateRun]]);
		decisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision-malformed-1",
					proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [
						candidateRun.runId,
					]),
					admissionId: "admission-malformed-1",
					outcome: "admit",
					approvedRunId: "run-malformed-1",
				} satisfies ToolProviderRunAdmissionDecision,
			],
		]);
		await settle();
		expect(outcomes.values).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "clickhouse-trusted-query-malformed-settlement",
				}),
			}),
		]);
		expect(JSON.stringify({ outcomes: outcomes.values, topology: g.topology() })).not.toContain(
			"do-not-leak",
		);
		outcomes.unsubscribe();
		await runtime.dispose();
	});

	it("requires an admitted cancellation decision before aborting the host capability", async () => {
		const g = graph({ name: "clickhouse-admitted-cancellation" });
		const inputs = g.node<ReturnType<typeof adapterInput>>([], null);
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null);
		const runDecisions = g.node<ToolProviderRunAdmissionDecision>([], null);
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
			decisions: [runDecisions],
		});
		const cancellationRequests = g.node<ClickHouseTrustedQueryCancellationRequested>([], null);
		const cancellationDecisions = g.node<ClickHouseTrustedQueryCancellationDecision>([], null);
		let aborted = 0;
		const runtime = clickHouseTrustedQueryRuntime(g, {
			inputs,
			admittedRunRequests: [admission.approvedRunRequests],
			cancellationRequests: [cancellationRequests],
			cancellationDecisions: [cancellationDecisions],
			capability: {
				execute(request) {
					return new Promise((_, reject) => {
						request.signal.addEventListener(
							"abort",
							() => {
								aborted += 1;
								reject(new Error("host-private-abort"));
							},
							{ once: true },
						);
					});
				},
			},
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const proposals = collect<{ proposalId: string; sourceRefs?: readonly unknown[] }>(
			runtime.cancellationProposals,
		);
		const cancellationAdmissions = collect<{ sourceRefs?: readonly unknown[] }>(
			runtime.cancellationAdmissions,
		);
		const input = adapterInput();
		const admissionId = "admission-cancel-1";
		const candidateRun = requestToolProviderAdapterRun(input, {
			runId: "candidate-cancel-1",
			reason: "manual",
		});
		inputs.down([["DATA", input]]);
		candidates.down([["DATA", candidateRun]]);
		runDecisions.down([
			[
				"DATA",
				{
					kind: "tool-provider-run-admission-decision",
					decisionId: "decision-cancel-run-1",
					proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [
						candidateRun.runId,
					]),
					admissionId,
					outcome: "admit",
					approvedRunId: "run-cancel-1",
				} satisfies ToolProviderRunAdmissionDecision,
			],
		]);
		await settle();
		const run = {
			...candidateRun,
			runId: "run-cancel-1",
		};
		const cancellation = {
			kind: "clickhouse-trusted-query-cancellation-requested",
			cancellationId: "cancel-1",
			admissionId,
			runId: run.runId,
			adapterInputId: run.adapterInputId,
			requestId: run.requestId,
			operationId: run.operationId,
			attempt: run.attempt,
			sourceRefs: [
				{
					kind: "cancellation-request-evidence",
					id: "cancel-request-ref-1",
					metadata: { password: "request-private" },
				},
			],
		} satisfies ClickHouseTrustedQueryCancellationRequested;
		cancellationRequests.down([["DATA", cancellation]]);
		await settle();
		expect(aborted).toBe(0);
		expect(proposals.values).toHaveLength(1);
		expect(proposals.values[0]!.sourceRefs).toEqual([
			{ kind: "cancellation-request-evidence", id: "cancel-request-ref-1" },
		]);
		cancellationDecisions.down([
			[
				"DATA",
				{
					kind: "clickhouse-trusted-query-cancellation-decision",
					decisionId: "cancel-decision-1",
					proposalId: proposals.values[0]!.proposalId,
					outcome: "admit",
					sourceRefs: [
						{
							kind: "cancellation-decision-evidence",
							id: "cancel-decision-ref-1",
							metadata: { password: "decision-private" },
						},
					],
				} satisfies ClickHouseTrustedQueryCancellationDecision,
			],
		]);
		await settle();
		expect(aborted).toBe(1);
		expect(outcomes.values).toEqual([
			expect.objectContaining({ kind: "canceled", reason: "admitted-user-cancellation" }),
		]);
		expect(cancellationAdmissions.values[0]!.sourceRefs).toEqual([
			{ kind: "cancellation-decision-evidence", id: "cancel-decision-ref-1" },
		]);
		expect(JSON.stringify({ proposals: proposals.values, cancellationAdmissions })).not.toContain(
			"private",
		);
		outcomes.unsubscribe();
		proposals.unsubscribe();
		cancellationAdmissions.unsubscribe();
		await runtime.dispose();
	});

	it("emits a bounded timeout and disposes even when the host ignores abort and settles late", async () => {
		const g = graph({ name: "clickhouse-bounded-timeout" });
		const inputs = g.node<ReturnType<typeof adapterInput>>([], null);
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null);
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
		});
		const validSettlement = () => ({
			kind: "clickhouse-trusted-query-host-settlement" as const,
			measurements: { correctness: 1 },
			evidenceId: "late-evidence",
			evidenceHighWater: 9,
			evidenceRefs: [
				ref("late-evidence"),
				ref("latency-and-correctness", "scenario-r1"),
				ref("query-plan-fingerprint"),
				ref("source-catalog"),
				ref("schema-fingerprint"),
				ref("query-policy"),
			],
			recordedAtMs: 130,
		});
		let hostSignal: AbortSignal | undefined;
		let settleHost: ((value: ReturnType<typeof validSettlement>) => void) | undefined;
		const runtime = clickHouseTrustedQueryRuntime(g, {
			inputs,
			admittedRunRequests: [admission.approvedRunRequests],
			timeoutMs: 2,
			now: () => 125,
			capability: {
				execute(request) {
					hostSignal = request.signal;
					return new Promise((resolve) => {
						settleHost = resolve;
					});
				},
			},
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const input = adapterInput("auto");
		inputs.down([["DATA", input]]);
		candidates.down([
			[
				"DATA",
				requestToolProviderAdapterRun(input, { runId: "candidate-timeout-1", reason: "manual" }),
			],
		]);
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
		expect(hostSignal?.aborted).toBe(true);
		expect(outcomes.values).toEqual([
			expect.objectContaining({ kind: "timeout", retryable: false, timeoutMs: 2 }),
		]);
		const disposed = await Promise.race([
			runtime.dispose().then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
		]);
		expect(disposed).toBe(true);
		settleHost?.(validSettlement());
		await settle();
		expect(outcomes.values).toHaveLength(1);
		outcomes.unsubscribe();
		await runtime.dispose();
	});

	it("classifies a getter-bearing host rejection without leaking or marking it retryable", async () => {
		const g = graph({ name: "clickhouse-hostile-rejection" });
		const inputs = g.node<ReturnType<typeof adapterInput>>([], null);
		const candidates = g.node<ToolProviderAdapterRunRequested>([], null);
		const admission = toolProviderRunAdmissionProjector(g, {
			inputs,
			runRequests: [candidates],
		});
		const runtime = clickHouseTrustedQueryRuntime(g, {
			inputs,
			admittedRunRequests: [admission.approvedRunRequests],
			capability: {
				execute() {
					const hostile = new Error("password=host-private");
					Object.defineProperty(hostile, "kind", {
						get() {
							throw new Error("getter-must-not-run");
						},
					});
					throw hostile;
				},
			},
		});
		const outcomes = collect<ExecutorOutcome>(runtime.outcomes);
		const input = adapterInput("auto");
		inputs.down([["DATA", input]]);
		candidates.down([
			[
				"DATA",
				requestToolProviderAdapterRun(input, { runId: "candidate-hostile-1", reason: "manual" }),
			],
		]);
		await settle();
		expect(outcomes.values).toEqual([
			expect.objectContaining({
				kind: "failure",
				retryable: false,
				error: expect.objectContaining({
					code: "clickhouse-trusted-query-capability-unavailable",
				}),
			}),
		]);
		expect(JSON.stringify(outcomes.values)).not.toContain("host-private");
		const failure = outcomes.values[0] as Extract<ExecutorOutcome, { kind: "failure" }>;
		const { error: _error, retryable: _retryable, ...failureBase } = failure;
		expect(() =>
			createClickHouseTrustedQueryScenarioResultFromOutcome({
				arguments: executionArguments(),
				resultId: "tampered-canceled-result",
				outcome: { ...failureBase, kind: "canceled" },
			}),
		).toThrow("terminal-shape-invalid");
		expect(() =>
			createClickHouseTrustedQueryScenarioResultFromOutcome({
				arguments: executionArguments(),
				resultId: "future-terminal-result",
				outcome: { ...failureBase, kind: "future-terminal" } as unknown as ExecutorOutcome,
			}),
		).toThrow("terminal-shape-invalid");
		outcomes.unsubscribe();
		await runtime.dispose();
	});
});
