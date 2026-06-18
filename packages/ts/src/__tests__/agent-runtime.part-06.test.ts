import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	attachToolProviderAdapterRuntime,
	buildToolProviderAdapterInputs,
	buildToolProviderExecutorOutcome,
	type ExecutorRoute,
	localBuiltinToolProviderCatalog,
	requestToolProviderAdapterRun,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunStatus,
	type ToolProviderAdapterRuntimeStatus,
	type ToolProviderCatalog,
	type ToolProviderPolicyResolution,
	toolProviderPolicyResolutionProjector,
} from "../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionProposal,
	WorkItemSeed,
} from "../orchestration/work-item-runtime.js";

function _issued(
	requestId: string,
	operationId: string,
	requestKind: AgentRequestIssued["requestKind"],
	inputKind?: string,
): AgentRequestIssued {
	return {
		kind: "issued",
		requestId,
		operationId,
		effectRunId: "run-1",
		requestKind,
		required: true,
		input:
			inputKind === undefined
				? undefined
				: { inputId: `${requestId}:input`, inputKind, dataMode: "summary", summary: inputKind },
	};
}

function toolRequest(
	requestId: string,
	operationId: string,
	toolName: string,
	operation?: string,
): AgentRequestIssued {
	return {
		kind: "issued",
		requestId,
		operationId,
		effectRunId: "run-1",
		requestKind: "executor",
		required: true,
		input: {
			inputId: `${requestId}:input`,
			inputKind: "tool-call",
			dataMode: "inline",
			value: {
				kind: "tool-call",
				toolName,
				operation,
				arguments: { path: "README.md" },
			},
		},
	};
}

const forbiddenRetentionPayloadPattern =
	/SCORER_SECRET|SCORER_RAW|rawResponse|stdout|stderr|stack|apiKey|password|arguments|providerClient|oauthState|subprocessHandle|transport|sdkObject/i;

const retentionScorerEntryKeys: Record<string, readonly string[]> = {
	adapterInputs: [
		"adapterInputId",
		"executorId",
		"insertedAtMs",
		"key",
		"operationId",
		"profileId",
		"providerId",
		"requestId",
		"routeId",
		"sequence",
		"status",
	],
	runRequests: [
		"adapterInputId",
		"attempt",
		"executorId",
		"key",
		"operationId",
		"profileId",
		"providerId",
		"reason",
		"requestId",
		"requestedAtMs",
		"routeId",
		"runId",
		"sequence",
	],
	executions: [
		"adapterInputId",
		"attempt",
		"executorId",
		"key",
		"occurredAtMs",
		"operationId",
		"outcomeId",
		"profileId",
		"providerId",
		"reason",
		"requestId",
		"routeId",
		"runId",
		"sequence",
		"status",
	],
	runStatuses: [
		"adapterInputId",
		"attempt",
		"issueCode",
		"key",
		"occurredAtMs",
		"operationId",
		"outcomeId",
		"requestId",
		"runId",
		"sequence",
		"status",
	],
	runIssues: [
		"adapterInputId",
		"attempt",
		"issueCode",
		"key",
		"occurredAtMs",
		"operationId",
		"requestId",
		"runId",
		"sequence",
		"severity",
		"subjectId",
	],
	retentionEvidence: [
		"adapterInputId",
		"attemptHighWater",
		"evidenceKind",
		"key",
		"occurredAtMs",
		"reason",
		"sequence",
	],
};

function _expectRetentionScorerEntryPayloadSafe(index: string, entry: unknown): void {
	expect(entry).toBeTypeOf("object");
	expect(Array.isArray(entry)).toBe(false);
	const record = entry as Record<string, unknown>;
	const allowed = retentionScorerEntryKeys[index];
	expect(allowed, `unknown retention scorer index ${index}`).toBeDefined();
	for (const [key, value] of Object.entries(record)) {
		expect(allowed).toContain(key);
		expect(value === undefined || typeof value === "string" || typeof value === "number").toBe(
			true,
		);
		if (key === "key") expect(value).toEqual(expect.stringMatching(/^key:[a-z0-9]+:\d+$/));
	}
	expectNoForbiddenRetentionPayload(record);
}

function expectNoForbiddenRetentionPayload(value: unknown): void {
	expect(JSON.stringify(value)).not.toMatch(forbiddenRetentionPayloadPattern);
}

function readyToolProviderAdapterInput(
	providerId: string,
	requestId: string,
): ToolProviderAdapterInput {
	const catalog = localBuiltinToolProviderCatalog({ providerId });
	const profile = catalog.profiles[0];
	if (profile === undefined) throw new Error("expected profile");
	const request = toolRequest(requestId, `${requestId}-op`, "file.read", "read");
	const route: ExecutorRoute = {
		kind: "executor-route",
		routeId: `${requestId}-route`,
		requestId: request.requestId,
		operationId: request.operationId,
		executorId: profile.executorId,
		profileId: profile.profileId,
		inputKind: "tool-call",
	};
	const resolutions = resolveToolProviderExecutionPolicies({
		request,
		routes: [route],
		catalogs: [catalog],
	});
	const input = buildToolProviderAdapterInputs({
		requests: [request],
		routes: [route],
		catalogs: [catalog],
		resolutions,
	})[0];
	if (input === undefined || input.status !== "ready") throw new Error("expected ready input");
	return input;
}

function _workItemSeed(workItemId: string): WorkItemSeed {
	return {
		kind: "work-item",
		workItemId,
		sourceRefs: [{ kind: "work-item", id: workItemId }],
		workItemKind: "issue",
		lifecycleStatus: "open",
	};
}

function _workItemActionProposal(
	proposalId: string,
	actionKind: string,
	opts: Partial<WorkItemDomainActionProposal> = {},
): WorkItemDomainActionProposal {
	return {
		kind: "work-item-domain-action-proposal",
		proposalId,
		workItemId: opts.workItemId ?? "wi-1",
		actionKind,
		effectRunId: opts.effectRunId ?? "run-1",
		effectRunResultId: opts.effectRunResultId ?? "run-1:result",
		evidenceId: opts.evidenceId ?? "wi-1:run-1:run-1:result",
		policyId: opts.policyId ?? "policy-propose",
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

function _workItemAdmissionDecision(
	decisionId: string,
	admissionId: string,
	proposalId: string,
	outcome: WorkItemDomainActionAdmissionDecision["outcome"],
	opts: Partial<WorkItemDomainActionAdmissionDecision> = {},
): WorkItemDomainActionAdmissionDecision {
	return {
		kind: "work-item-domain-action-admission-decision",
		decisionId,
		admissionId,
		proposalId,
		outcome,
		policyId: opts.policyId,
		reason: opts.reason,
		targetProposalId: opts.targetProposalId,
		targetAdmissionId: opts.targetAdmissionId,
		sourceRefs: opts.sourceRefs,
		decidedAtMs: opts.decidedAtMs,
		metadata: opts.metadata,
	};
}

describe("CSP-8 experimental agent runtime kernel (D236) — part 6", () => {
	it("caps runRequests emission keys without deleting already emitted request facts", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-run-request-key-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-run-request-key-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-run-request-key-provider",
			"runtime-retention-run-request-key-req",
		);
		const longRunA = `request-key-a-${"x".repeat(40)}-runtime-status-key-tail`;
		const longRunB = `request-key-b-${"y".repeat(40)}-runtime-status-key-tail`;
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { runRequests: { maxSize: 1 } },
			publicText: { maxMetadataStringChars: 24 },
			bindings: [
				{
					providerId: "runtime-retention-run-request-key-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const emittedRequests: ToolProviderAdapterRunRequested[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: Record<string, unknown>[] = [];
		runtime.runRequests.subscribe(
			(msg) => msg[0] === "DATA" && emittedRequests.push(msg[1] as ToolProviderAdapterRunRequested),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe(
			(msg) => msg[0] === "DATA" && audit.push(msg[1] as Record<string, unknown>),
		);

		inputs.down([["DATA", ready]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(ready, {
					runId: longRunA,
					attempt: 1,
					sourceRefs: [
						{
							kind: "provider-raw",
							id: "raw-run-request-ref",
							metadata: { stdout: "RAW_RUN_REQUEST_REPLAY_REF_SHOULD_NOT_PROJECT" },
						},
					],
					metadata: { rawResponse: "RAW_RUN_REQUEST_REPLAY_METADATA_SHOULD_NOT_PROJECT" },
				}),
			],
			["DATA", requestToolProviderAdapterRun(ready, { runId: longRunB, attempt: 2 })],
			[
				"DATA",
				requestToolProviderAdapterRun(ready, {
					runId: longRunA,
					attempt: 1,
					sourceRefs: [
						{
							kind: "provider-raw",
							id: "raw-run-request-ref",
							metadata: { stdout: "RAW_RUN_REQUEST_REPLAY_REF_SHOULD_NOT_PROJECT" },
						},
					],
					metadata: { rawResponse: "RAW_RUN_REQUEST_REPLAY_METADATA_SHOULD_NOT_PROJECT" },
				}),
			],
		]);

		const replayed = emittedRequests.filter((request) => request.runId === longRunA);
		expect(replayed).toHaveLength(2);
		expect(replayed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sourceRefs: expect.arrayContaining([{ kind: "provider-raw", id: "raw-run-request-ref" }]),
				}),
			]),
		);
		expect(replayed.every((request) => request.metadata === undefined)).toBe(true);
		const trimmedStatus = runtimeStatus.find(
			(status) => status.status === "retention-trimmed" && status.index === "runRequests",
		);
		expect(trimmedStatus).toMatchObject({
			status: "retention-trimmed",
			index: "runRequests",
			sourceRefs: [{ kind: "tool-provider-adapter-runtime-retention-index", id: "runRequests" }],
			metadata: expect.objectContaining({ index: "runRequests", key: expect.any(String) }),
		});
		expect((trimmedStatus?.key ?? "").length).toBeLessThanOrEqual(24);
		expect(
			((trimmedStatus?.metadata as { key?: string } | undefined)?.key ?? "").length,
		).toBeLessThanOrEqual(24);
		expect(trimmedStatus?.key).toMatch(/^key:[a-z0-9]+:\d+$/);
		expect((trimmedStatus?.metadata as { key?: string } | undefined)?.key).toMatch(
			/^key:[a-z0-9]+:\d+$/,
		);
		const trimmedIssue = issues.find(
			(issue) => issue.code === "tool-provider-adapter-runtime-retention-trimmed",
		);
		expect((trimmedIssue?.details as { key?: string } | undefined)?.key).toMatch(
			/^key:[a-z0-9]+:\d+$/,
		);
		const trimmedAudit = audit.find(
			(record) => record.kind === "tool-provider-adapter-runtime-retention-trimmed",
		);
		expect((trimmedAudit?.metadata as { key?: string } | undefined)?.key).toMatch(
			/^key:[a-z0-9]+:\d+$/,
		);
		expect(
			JSON.stringify({
				statusKey: trimmedStatus?.key,
				statusMetadata: trimmedStatus?.metadata,
				issueDetails: trimmedIssue?.details,
				auditMetadata: trimmedAudit?.metadata,
			}),
		).not.toContain("runtime-status-key-tail");
		expect(JSON.stringify({ emittedRequests, runtimeStatus })).not.toMatch(
			/RAW_RUN_REQUEST_REPLAY|rawResponse|stdout/,
		);
	});

	it("caps runStatuses and runIssues indexes without deleting already emitted facts", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-emission-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-emission-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-emission-provider",
			"runtime-retention-emission-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				runStatuses: { maxSize: 1 },
				runIssues: { maxSize: 1 },
			},
			bindings: [],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const issues: DataIssue[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([["DATA", ready]]);
		runRequests.down([
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(ready, { runId: "bad-run-a", attempt: 1 }),
					requestId: "stale-a",
				},
			],
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(ready, { runId: "bad-run-b", attempt: 2 }),
					requestId: "stale-b",
				},
			],
		]);
		runRequests.down([
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(ready, { runId: "bad-run-a", attempt: 1 }),
					requestId: "stale-a",
				},
			],
		]);

		expect(runStatus.length).toBeGreaterThan(1);
		expect(issues.length).toBeGreaterThan(1);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "runStatuses" }),
				expect.objectContaining({ status: "retention-trimmed", index: "runIssues" }),
			]),
		);
		for (const index of ["runStatuses", "runIssues"] as const) {
			const trimmedStatus = runtimeStatus.find(
				(status) => status.status === "retention-trimmed" && status.index === index,
			);
			expect(trimmedStatus).toMatchObject({
				sourceRefs: [{ kind: "tool-provider-adapter-runtime-retention-index", id: index }],
				metadata: expect.objectContaining({ index, key: expect.any(String) }),
			});
		}
		expect(runStatus).toEqual(
			expect.arrayContaining([expect.objectContaining({ runId: "bad-run-a" })]),
		);
		expect(runStatus.filter((status) => status.runId === "bad-run-a")).toHaveLength(2);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-run-request-stale-request" }),
			]),
		);
		expect(
			issues.filter(
				(issue) =>
					issue.code === "tool-provider-adapter-run-request-stale-request" &&
					issue.subjectId === ready.requestId,
			),
		).toHaveLength(3);
	});

	it("emits DataIssue and run status for missing or stale run requests without protocol ERROR", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-stale-inputs" });
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-stale-requests",
		});
		const ready = readyToolProviderAdapterInput("runtime-stale-provider", "runtime-stale-req");
		const calls: ToolProviderAdapterInput[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			bindings: [
				{
					providerId: "runtime-stale-provider",
					run(input) {
						calls.push(input);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const issues: DataIssue[] = [];
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const audit: unknown[] = [];
		const protocolErrors: unknown[] = [];
		runtime.issues.subscribe((msg) => {
			if (msg[0] === "DATA") issues.push(msg[1] as DataIssue);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		runtime.runStatus.subscribe((msg) => {
			if (msg[0] === "DATA") runStatus.push(msg[1] as ToolProviderAdapterRunStatus);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", ready]]);
		runRequests.down([
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(ready, { runId: "stale-run", attempt: 2 }),
					requestId: "other-request",
				},
			],
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(ready, { runId: "missing-run", attempt: 1 }),
					adapterInputId: "missing-adapter-input",
				},
			],
			[
				"DATA",
				{
					kind: "tool-provider-adapter-run-requested",
					adapterInputId: ready.adapterInputId,
					requestId: ready.requestId,
				} as unknown as ToolProviderAdapterRunRequested,
			],
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(ready, { runId: "raw-request", attempt: 3 }),
					metadata: { rawResponse: "RAW_RUN_REQUEST_SHOULD_NOT_PROJECT" },
					sourceRefs: [
						{
							kind: "provider-raw",
							id: "raw-explicit-request",
							metadata: { stdout: "RAW_RUN_REQUEST_SOURCE_REF_SHOULD_NOT_PROJECT" },
						},
					],
				},
			],
		]);

		expect(calls).toEqual([]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-run-request-stale-request" }),
				expect.objectContaining({ code: "tool-provider-adapter-run-request-missing-input" }),
				expect.objectContaining({ code: "tool-provider-adapter-run-request-invalid-shape" }),
				expect.objectContaining({
					code: "tool-provider-adapter-run-request-forbidden-runtime-material",
				}),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "mismatched-request" }),
				expect.objectContaining({ status: "missing-input" }),
			]),
		);
		expect(runStatus.filter((status) => status.runId === "missing-run")).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "missing-input" })]),
		);
		expect(runStatus.filter((status) => status.runId === "missing-run")).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-gap" })]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-run-request-missing-input",
					subjectId: "missing-adapter-input",
				}),
			]),
		);
		expect(runtimeStatus).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-gap",
					adapterInputId: "missing-adapter-input",
				}),
			]),
		);
		expect(
			runStatus.find((status) => status.runId === `${ready.adapterInputId}:invalid-run`),
		).toMatchObject({
			adapterInputId: ready.adapterInputId,
			requestId: ready.requestId,
			operationId: "<invalid-operation>",
			status: "mismatched-request",
			attempt: 1,
			sourceRefs: [
				{ kind: "tool-provider-adapter-run", id: `${ready.adapterInputId}:invalid-run` },
			],
		});
		expect(protocolErrors).toEqual([]);
		expect(JSON.stringify({ audit, issues, runStatus })).not.toMatch(
			/RAW_RUN_REQUEST_SHOULD_NOT_PROJECT|RAW_RUN_REQUEST_SOURCE_REF_SHOULD_NOT_PROJECT|rawResponse|stdout/,
		);
	});

	it("emits DataIssue when ready inputs have no visible run request source", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-missing-run-request-inputs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-missing-run-provider",
			"runtime-missing-run-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			autoRunReadyInputs: false,
			bindings: [
				{
					providerId: "runtime-missing-run-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const issues: DataIssue[] = [];
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const protocolErrors: unknown[] = [];
		runtime.issues.subscribe((msg) => {
			if (msg[0] === "DATA") issues.push(msg[1] as DataIssue);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		runtime.runStatus.subscribe((msg) => {
			if (msg[0] === "DATA") runStatus.push(msg[1] as ToolProviderAdapterRunStatus);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});

		inputs.down([["DATA", ready]]);

		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-run-request-missing" }),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "missing-request" })]),
		);
		expect(runStatus).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-gap" })]),
		);
		expect(protocolErrors).toEqual([]);
	});

	it("copies adapter failure errors into status issues for auditability", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-failure-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-failure-provider", "runtime-failure-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-failure-provider",
					run() {
						return {
							kind: "failure",
							error: {
								kind: "issue",
								code: "tool-provider-adapter-runtime-failed",
								message: "Adapter failed.",
								subjectId: "runtime-failure-req",
							},
							retryable: false,
						};
					},
				},
			],
		});
		const status: AgentRequestStatusChanged[] = [];
		const issues: DataIssue[] = [];
		runtime.status.subscribe(
			(msg) => msg[0] === "DATA" && status.push(msg[1] as AgentRequestStatusChanged),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);

		expect(status.at(-1)).toMatchObject({
			status: "failed",
			issues: [expect.objectContaining({ code: "tool-provider-adapter-runtime-failed" })],
		});
		expect(issues).toEqual([
			expect.objectContaining({ code: "tool-provider-adapter-runtime-failed" }),
		]);
	});

	it("builds provider-neutral ExecutorOutcome facts from adapter run results", () => {
		const ready = readyToolProviderAdapterInput("build-runtime-provider", "build-runtime-req");
		const mutableValue = { ok: true, nested: { note: "safe" } };
		const outcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "timeout",
				timeoutMs: 10,
				retryable: true,
				usage: { latencyMs: 10 },
			},
			{ attempt: 2, occurredAtMs: 456 },
		);

		expect(outcome).toMatchObject({
			kind: "timeout",
			requestId: "build-runtime-req",
			operationId: "build-runtime-req-op",
			routeId: "build-runtime-req-route",
			executorId: ready.executorId,
			profileId: ready.profileId,
			attempt: 2,
			timeoutMs: 10,
			retryable: true,
			usage: { latencyMs: 10 },
			occurredAtMs: 456,
		});
		expect(outcome.evidenceRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tool-provider-adapter-input",
					id: ready.adapterInputId,
				}),
				expect.objectContaining({ kind: "tool-provider-policy-resolution" }),
			]),
		);
		const cloned = buildToolProviderExecutorOutcome(ready, {
			kind: "result",
			result: { kind: "tool-output", value: mutableValue },
		});
		mutableValue.nested = { note: "RAW_MUTATED_PROVIDER_MATERIAL_SHOULD_NOT_PROJECT" };
		(mutableValue as Record<string, unknown>).rawResponse =
			"RAW_MUTATED_PROVIDER_MATERIAL_SHOULD_NOT_PROJECT";
		expect(JSON.stringify(cloned)).not.toMatch(/RAW_MUTATED_PROVIDER_MATERIAL|rawResponse/);
		expect(Object.isFrozen((cloned as { result: { value: unknown } }).result.value)).toBe(true);
	});

	it("projects D360 policy resolution issues as DATA facts", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requests" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const catalogs = g.node<ToolProviderCatalog>([], null, { name: "catalogs" });
		const projector = toolProviderPolicyResolutionProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
		});
		const resolutions: ToolProviderPolicyResolution[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		projector.resolutions.subscribe(
			(msg) => msg[0] === "DATA" && resolutions.push(msg[1] as ToolProviderPolicyResolution),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		projector.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		const request = toolRequest("policy-req", "policy-op", "file.read", "read");
		const catalog: ToolProviderCatalog = {
			kind: "tool-provider-catalog",
			providerId: "bare",
			providerKind: "local-builtin",
			status: "ready",
			profiles: [
				{
					profileId: "bare-profile",
					executorId: "bare-exec",
					kind: "tool",
					acceptedInputKinds: ["tool-call"],
				},
			],
			tools: [
				{
					kind: "tool-catalog-entry",
					providerId: "bare",
					toolName: "file.read",
					operation: "read",
					inputKind: "tool-call",
					profileId: "bare-profile",
					executorId: "bare-exec",
				},
			],
			policies: [],
			policyRefs: [],
		};
		requestFacts.down([["DATA", request]]);
		catalogs.down([["DATA", catalog]]);
		expect(resolutions.at(-1)).toMatchObject({
			status: "pending-route",
			requestId: "policy-req",
		});
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "policy-route",
					requestId: "policy-req",
					operationId: "policy-op",
					executorId: "bare-exec",
					profileId: "bare-profile",
					inputKind: "tool-call",
				},
			],
		]);

		expect(resolutions.at(-1)).toMatchObject({
			status: "missing-policy",
			requestId: "policy-req",
			routeId: "policy-route",
			providerId: "bare",
		});
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-policy-ref",
				}),
			]),
		);
		expect(audit.at(-1)).toMatchObject({
			kind: "tool-provider-policy-resolution",
			subjectId: "policy-req",
		});
	});
});
