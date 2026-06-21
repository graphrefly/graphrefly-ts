import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import type { ToolProviderAdapterRuntimeStatus } from "../executors/tool-provider-runtime.js";
import { attachToolProviderAdapterRuntime } from "../executors/tool-provider-runtime.js";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestIssued,
	buildToolProviderAdapterInputs,
	buildToolProviderExecutorOutcome,
	type ExecutorOutcome,
	type ExecutorRoute,
	localBuiltinToolProviderCatalog,
	requestToolProviderAdapterRun,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunStatus,
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 3", () => {
	it("bounds provider-returned public text on runtime outcomes", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-text-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-text-provider", "runtime-text-req");
		const longSummary = "summary-".repeat(20);
		const longMetadata = "metadata-".repeat(20);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			publicText: {
				maxSummaryChars: 16,
				maxMessageChars: 18,
				maxReasonChars: 14,
				maxMetadataStringChars: 12,
			},
			bindings: [
				{
					providerId: "runtime-text-provider",
					run() {
						return {
							kind: "result",
							result: {
								kind: "tool-output",
								summary: longSummary,
								metadata: { note: longMetadata },
							},
							metadata: { small: longMetadata },
						};
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: DataIssue[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);

		const outcome = outcomes.at(-1);
		expect(outcome).toMatchObject({
			kind: "result",
			result: { summary: expect.any(String), metadata: { note: expect.any(String) } },
			metadata: { small: expect.any(String) },
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-public-text-truncated",
				}),
			]),
		});
		if (outcome?.kind !== "result") throw new Error("expected result outcome");
		expect(outcome.result.summary?.length).toBeLessThanOrEqual(16);
		expect((outcome.result.metadata as { note: string }).note.length).toBeLessThanOrEqual(12);
		expect((outcome.metadata as { small: string }).small.length).toBeLessThanOrEqual(12);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-public-text-truncated",
				}),
			]),
		);
	});

	it("emits truncation evidence when only metadata strings are bounded", () => {
		const ready = readyToolProviderAdapterInput(
			"runtime-metadata-text-provider",
			"runtime-metadata-text-req",
		);
		const outcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "result",
				result: { kind: "tool-output" },
				metadata: { note: "metadata-only-".repeat(20) },
			},
			{ publicText: { maxMetadataStringChars: 15 } },
		);

		expect(outcome).toMatchObject({
			kind: "result",
			metadata: { note: expect.any(String) },
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-public-text-truncated",
					details: expect.objectContaining({ field: "metadata" }),
				}),
			]),
		});
		expect(((outcome.metadata as { note: string })?.note ?? "").length).toBeLessThanOrEqual(15);
	});

	it("bounds failure messages and canceled reasons from provider-returned public text", () => {
		const ready = readyToolProviderAdapterInput(
			"runtime-build-text-provider",
			"runtime-build-text-req",
		);
		const failure = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "failure",
				error: {
					kind: "issue",
					code: "provider-failed",
					message: "failure-message-".repeat(20),
					details: { response: "failure-detail-".repeat(20) },
				},
				retryable: false,
			},
			{ publicText: { maxMessageChars: 20, maxMetadataStringChars: 18 } },
		);
		const canceled = buildToolProviderExecutorOutcome(
			ready,
			{ kind: "canceled", reason: "cancel-reason-".repeat(20) },
			{ publicText: { maxReasonChars: 18 } },
		);

		expect(failure).toMatchObject({
			kind: "failure",
			error: {
				code: "provider-failed",
				details: expect.objectContaining({
					truncated: true,
					measurementSource: "js-string-length",
				}),
			},
		});
		if (failure.kind !== "failure") throw new Error("expected failure outcome");
		expect(failure.error.message.length).toBeLessThanOrEqual(20);
		expect((failure.error.details as { response: string }).response.length).toBeLessThanOrEqual(18);
		expect(failure.error.details).toMatchObject({
			detailsTruncated: true,
			measurementSource: "js-string-length",
		});
		expect(canceled).toMatchObject({
			kind: "canceled",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-runtime-public-text-truncated" }),
			]),
		});
		if (canceled.kind !== "canceled") throw new Error("expected canceled outcome");
		expect(canceled.reason?.length).toBeLessThanOrEqual(18);
	});

	it("rejects raw metadata and oversized inline result values without leaking them", () => {
		const ready = readyToolProviderAdapterInput("runtime-raw-provider", "runtime-raw-req");
		const rawRunRequest = requestToolProviderAdapterRun(ready, {
			runId: "raw-run-request",
			metadata: { rawResponse: "RAW_RUN_REQUEST_SHOULD_NOT_PROJECT" },
		});
		const rawMetadataOutcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "result",
				result: { kind: "tool-output", summary: "small summary" },
				metadata: { rawResponse: "RAW_PROVIDER_RESPONSE_SHOULD_NOT_PROJECT" },
			},
			{ runId: "raw-run" },
		);
		const rawFailureDetailsOutcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "failure",
				error: {
					kind: "issue",
					code: "provider-raw-failure",
					message: "provider failed",
					details: { rawResponse: "RAW_FAILURE_DETAIL_SHOULD_NOT_PROJECT" },
				},
			},
			{ runId: "raw-failure-run" },
		);
		const blockedNeedMetadataOutcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "blocked",
				needs: [
					{
						kind: "permission",
						message: "needs permission",
						metadata: { rawResponse: "RAW_NEED_METADATA_SHOULD_NOT_PROJECT" },
					},
				],
			},
			{ runId: "raw-need-run" },
		);
		const oversizedValueOutcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "result",
				result: { kind: "tool-output", value: { content: "large-content-".repeat(60) } },
			},
			{ runId: "value-run", publicText: { maxSummaryChars: 20 } },
		);

		expect(rawRunRequest.metadata).toBeUndefined();
		expect(rawMetadataOutcome).toMatchObject({
			kind: "result",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-metadata-redacted",
				}),
			]),
		});
		expect(rawMetadataOutcome.metadata).not.toMatchObject({ rawResponse: expect.anything() });
		expect(rawFailureDetailsOutcome).toMatchObject({
			kind: "failure",
			error: {
				details: { redacted: true, reason: "forbidden-runtime-material" },
			},
		});
		expect(blockedNeedMetadataOutcome).toMatchObject({
			kind: "blocked",
			needs: [expect.not.objectContaining({ metadata: expect.anything() })],
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-metadata-redacted",
				}),
			]),
		});
		expect(oversizedValueOutcome).toMatchObject({
			kind: "failure",
			outcomeId: expect.stringContaining("value-run"),
			error: expect.objectContaining({
				code: "tool-provider-adapter-runtime-forbidden-runtime-material",
			}),
		});
		expect(
			JSON.stringify({
				rawRunRequest,
				rawMetadataOutcome,
				rawFailureDetailsOutcome,
				blockedNeedMetadataOutcome,
				oversizedValueOutcome,
			}),
		).not.toMatch(
			/RAW_RUN_REQUEST_SHOULD_NOT_PROJECT|RAW_PROVIDER_RESPONSE_SHOULD_NOT_PROJECT|RAW_FAILURE_DETAIL_SHOULD_NOT_PROJECT|RAW_NEED_METADATA_SHOULD_NOT_PROJECT|large-content-/,
		);
	});

	it("falls back to finite public text bounds for invalid policy limits", () => {
		const ready = readyToolProviderAdapterInput("runtime-limit-provider", "runtime-limit-req");
		const outcome = buildToolProviderExecutorOutcome(
			ready,
			{
				kind: "result",
				result: { kind: "tool-output", summary: "summary-".repeat(100) },
				metadata: { note: "metadata-".repeat(100) },
			},
			{
				publicText: {
					maxSummaryChars: Number.POSITIVE_INFINITY,
					maxMetadataStringChars: Number.NaN,
				},
			},
		);

		expect(outcome).toMatchObject({
			kind: "result",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-public-text-truncated",
				}),
			]),
		});
		if (outcome.kind !== "result") throw new Error("expected result outcome");
		expect(outcome.result.summary?.length).toBeLessThanOrEqual(512);
		expect((outcome.metadata as { note: string }).note.length).toBeLessThanOrEqual(256);
	});

	it("does not hide a repeated auto-run attempt when adapterInputId is unchanged", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-update-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-update-provider", "runtime-update-req");
		const updated = {
			...ready,
			sourceRefs: [
				...(ready.sourceRefs ?? []),
				{ kind: "tool-provider-policy", id: "runtime-update-policy-v2" },
			],
		} satisfies ToolProviderAdapterInput;
		const calls: ToolProviderAdapterInput[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-update-provider",
					run(input) {
						calls.push(input);
						return {
							kind: "result",
							result: { kind: "tool-output", value: { ok: true } },
						};
					},
				},
			],
		});
		const issues: DataIssue[] = [];
		runtime.outcomes.subscribe(() => undefined);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);
		inputs.down([["DATA", ready]]);
		inputs.down([["DATA", updated]]);

		expect(calls.map((input) => input.sourceRefs?.at(-1)?.id)).toEqual([
			ready.sourceRefs?.at(-1)?.id,
		]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
	});

	it("executes explicit visible run requests as distinct attempts for unchanged adapter input", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-run-request-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-run-requests",
		});
		const ready = readyToolProviderAdapterInput("runtime-run-provider", "runtime-run-req");
		const longReason = `${"provider-reason-".repeat(60)}RAW_REASON_TAIL_SHOULD_NOT_PROJECT`;
		const attempts: number[] = [];
		const reasons: (string | undefined)[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			publicText: { maxReasonChars: 32 },
			bindings: [
				{
					providerId: "runtime-run-provider",
					run(_input, ctx) {
						attempts.push(ctx.attempt);
						reasons.push(ctx.reason);
						return {
							kind: "result",
							result: { kind: "tool-output", summary: `attempt ${ctx.attempt}` },
						};
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const emittedRequests: ToolProviderAdapterRunRequested[] = [];
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const audit: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.runRequests.subscribe(
			(msg) => msg[0] === "DATA" && emittedRequests.push(msg[1] as ToolProviderAdapterRunRequested),
		);
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		const firstRunRequest = {
			...requestToolProviderAdapterRun(ready, {
				runId: "run-shared",
				attempt: 1,
				reason: "manual",
			}),
			reason: longReason,
		} satisfies ToolProviderAdapterRunRequested;

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", firstRunRequest],
			[
				"DATA",
				requestToolProviderAdapterRun(ready, {
					runId: "run-shared",
					attempt: 2,
					reason: "retry",
					retryOfOutcomeId: "run-1:outcome",
				}),
			],
		]);
		const rawFirstRequest = emittedRequests[0];
		expect(rawFirstRequest).toBeDefined();

		expect(attempts).toEqual([1, 2]);
		expect(reasons[0]?.length).toBeLessThanOrEqual(32);
		expect(reasons[1]).toBe("retry");
		expect(outcomes.map((outcome) => outcome.attempt)).toEqual([1, 2]);
		expect(outcomes.map((outcome) => outcome.outcomeId)).toEqual([
			expect.stringContaining("run-shared:attempt-1"),
			expect.stringContaining("run-shared:attempt-2"),
		]);
		expect(outcomes.map((outcome) => outcome.metadata)).toEqual([
			expect.objectContaining({ runId: "run-shared" }),
			expect.objectContaining({ runId: "run-shared" }),
		]);
		expect(
			runStatus.filter((status) => status.status === "requested").map((status) => status.attempt),
		).toEqual([1, 2]);
		expect(
			runStatus.filter((status) => status.status === "result").map((status) => status.attempt),
		).toEqual([1, 2]);
		expect(rawFirstRequest?.reason.length).toBeLessThanOrEqual(32);
		expect(JSON.stringify({ audit, emittedRequests, reasons })).not.toContain(
			"RAW_REASON_TAIL_SHOULD_NOT_PROJECT",
		);
	});

	it("sanitizes fallback invalid-shape run request status and audit material", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-invalid-run-request-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-invalid-run-requests",
		});
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			publicText: { maxReasonChars: 24, maxMetadataStringChars: 20 },
			bindings: [],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		runRequests.down([
			[
				"DATA",
				{
					kind: "tool-provider-adapter-run-requested",
					runId: "invalid-run",
					adapterInputId: "invalid-input",
					requestId: "invalid-request",
					attempt: 1,
					reason: `${"invalid-reason-".repeat(20)}RAW_INVALID_REASON_SHOULD_NOT_PROJECT`,
					sourceRefs: [
						{
							kind: "provider-raw",
							id: "raw-source",
							metadata: { stdout: "RAW_INVALID_SOURCE_REF_SHOULD_NOT_PROJECT" },
						},
					],
					metadata: { rawResponse: "RAW_INVALID_METADATA_SHOULD_NOT_PROJECT" },
				} as unknown as ToolProviderAdapterRunRequested,
			],
		]);

		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					runId: "invalid-run",
					adapterInputId: "invalid-input",
					requestId: "invalid-request",
					operationId: "<invalid-operation>",
					status: "mismatched-request",
					attempt: 1,
					sourceRefs: [
						{ kind: "tool-provider-adapter-run", id: "invalid-run" },
						{ kind: "provider-raw", id: "raw-source" },
					],
					issues: [
						expect.objectContaining({
							code: "tool-provider-adapter-run-request-invalid-shape",
						}),
					],
				}),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-run-request-invalid-shape",
				}),
			]),
		);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tool-provider-adapter-run-request-invalid-shape",
					sourceRefs: [
						{ kind: "tool-provider-adapter-run", id: "invalid-run" },
						{ kind: "provider-raw", id: "raw-source" },
					],
					metadata: expect.objectContaining({
						runId: "invalid-run",
						adapterInputId: "invalid-input",
						issueCode: "tool-provider-adapter-run-request-invalid-shape",
					}),
				}),
			]),
		);
		expect(JSON.stringify({ runStatus, issues, audit })).not.toMatch(
			/RAW_INVALID_|rawResponse|stdout|stderr|apiKey/,
		);
	});

	it("bounds execution proofs, gaps trimmed replay, and still allows explicit attempt 2", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-execution-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-execution-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-execution-provider",
			"runtime-retention-execution-req",
		);
		const attempts: number[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			name: "runtimeRetentionExecution",
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { executions: { maxSize: 1 } },
			bindings: [
				{
					providerId: "runtime-retention-execution-provider",
					run(_input, ctx) {
						attempts.push(ctx.attempt);
						return { kind: "result", result: { kind: "tool-output", summary: "ok" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "run-a", attempt: 1 })],
			[
				"DATA",
				requestToolProviderAdapterRun(ready, { runId: "run-a", attempt: 2, reason: "retry" }),
			],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "run-replay", attempt: 1 })],
		]);

		expect(attempts).toEqual([1, 2]);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "executions" }),
				expect.objectContaining({
					status: "retention-gap",
					index: "executions",
					issueCode: "tool-provider-adapter-runtime-retention-gap",
					metadata: expect.objectContaining({
						gapKind: "execution-proof-trimmed",
						evidenceKind: "execution-high-water",
					}),
				}),
			]),
		);
		expect(runtimeStatus.map((status) => status.status)).toEqual(
			expect.arrayContaining(["retention-trimmed", "retention-gap"]),
		);
		expect(
			runtimeStatus.every((status) =>
				["retention-trimmed", "retention-gap", "invalid-retention-policy"].includes(status.status),
			),
		).toBe(true);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-replay", status: "retention-gap", attempt: 1 }),
			]),
		);
		expect(runStatus).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-trimmed" })]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-runtime-retention-gap" }),
			]),
		);
	});
});
