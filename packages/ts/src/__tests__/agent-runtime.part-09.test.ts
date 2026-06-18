import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import {
	type AgentDecision,
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	type AgentRequestViews,
	agentRequestLedgerViews,
	buildToolProviderAdapterInputs,
	type EffectRun,
	type EffectRunResult,
	type ExecutorOutcome,
	type ExecutorRoute,
	effectRun,
	effectRunCompletionProjector,
	fakeExecutorFailure,
	fakeExecutorResult,
	localBuiltinToolProviderCatalog,
	resolveToolProviderExecutionPolicies,
	structuredAgentDecisionInterpreter,
	type ToolProviderAdapterInput,
} from "../orchestration/agent-runtime.js";
import {
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionProposal,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemEffectResultMapper,
} from "../orchestration/work-item-runtime.js";

function issued(
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

function _readyToolProviderAdapterInput(
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

function workItemSeed(workItemId: string): WorkItemSeed {
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 9", () => {
	it("does not reprocess accepted final decisions into false conflicts", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const decisions = g.node<AgentDecision>([], null, { name: "decisions" });
		let clock = 1000;
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			requestFacts: [requestFacts],
			decisions: [decisions],
			now: () => clock++,
		});
		const results: EffectRunResult[] = [];
		const issues: unknown[] = [];
		completion.results.subscribe(
			(msg) => msg[0] === "DATA" && results.push(msg[1] as EffectRunResult),
		);
		completion.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		effectRuns.down([["DATA", effectRun({ effectRunId: "run-1", goal: { kind: "test" } })]]);
		requestFacts.down([
			["DATA", issued("request-1", "op-1", "executor", "llm-call")],
			[
				"DATA",
				{
					kind: "status",
					requestId: "request-1",
					operationId: "op-1",
					effectRunId: "run-1",
					status: "completed",
				},
			],
		]);
		decisions.down([
			[
				"DATA",
				{
					kind: "final",
					decisionId: "decision-final",
					effectRunId: "run-1",
					agentRunId: "agent-1",
					source: { requestId: "request-1", operationId: "op-1", outcomeId: "outcome-1" },
					output: { kind: "done", value: true },
				},
			],
		]);
		effectRuns.down([["DATA", effectRun({ effectRunId: "run-2", goal: { kind: "unrelated" } })]]);

		expect(results).toHaveLength(1);
		expect(issues).not.toContainEqual(
			expect.objectContaining({ code: "conflicting-effect-run-result" }),
		);
	});

	it("rejects prose and malformed structured agent-decision output", () => {
		const g = graph();
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const interpreter = structuredAgentDecisionInterpreter(g, outcomes);
		const decisions: unknown[] = [];
		const issues: unknown[] = [];
		interpreter.decisions.subscribe((msg) => msg[0] === "DATA" && decisions.push(msg[1]));
		interpreter.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		const base = {
			requestId: "request-1",
			operationId: "op-1",
			routeId: "route-1",
			executorId: "exec-1",
			profileId: "profile-1",
			attempt: 1,
		};

		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					...base,
					outcomeId: "prose",
					result: { kind: "text", value: "please ask a human to look at this" },
				}),
			],
			[
				"DATA",
				fakeExecutorResult({
					...base,
					outcomeId: "malformed",
					result: {
						kind: "agent-decision",
						value: { kind: "agent-decision", decision: { kind: "final" } },
					},
				}),
			],
		]);

		expect(decisions).toEqual([]);
		expect(issues).toHaveLength(2);
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual([
			"malformed-agent-decision",
			"missing-agent-decision-schema",
		]);
	});

	it("rejects malformed structured decision arrays and does not fabricate completion", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const interpreter = structuredAgentDecisionInterpreter(g, outcomes, {
			requestFacts: [requestFacts],
		});
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			decisions: [interpreter.decisions],
			requestFacts: [requestFacts],
		});
		const decisions: unknown[] = [];
		const results: unknown[] = [];
		const issues: unknown[] = [];
		interpreter.decisions.subscribe((msg) => msg[0] === "DATA" && decisions.push(msg[1]));
		interpreter.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		completion.results.subscribe((msg) => msg[0] === "DATA" && results.push(msg[1]));
		effectRuns.down([["DATA", effectRun({ effectRunId: "run-1", goal: { kind: "test" } })]]);
		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);
		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "bad-next",
					requestId: "request-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					result: {
						kind: "agent-decision",
						value: {
							kind: "agent-decision",
							schemaRef: "graphrefly.agent-decision.v0",
							decision: {
								kind: "continue",
								decisionId: "decision-1",
								effectRunId: "run-1",
								agentRunId: "agent-1",
								source: {
									requestId: "request-1",
									operationId: "op-1",
									outcomeId: "bad-next",
								},
								next: [null],
							},
						},
					},
				}),
			],
		]);

		expect(decisions).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "malformed-agent-decision" });
		expect(results).toEqual([]);
	});

	it("rejects continue decisions with malformed or cross-run request proposals", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const interpreter = structuredAgentDecisionInterpreter(g, outcomes, {
			requestFacts: [requestFacts],
		});
		const decisions: unknown[] = [];
		const issues: unknown[] = [];
		interpreter.decisions.subscribe((msg) => msg[0] === "DATA" && decisions.push(msg[1]));
		interpreter.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);

		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "bad-proposal",
					requestId: "request-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					result: {
						kind: "agent-decision",
						value: {
							kind: "agent-decision",
							schemaRef: "graphrefly.agent-decision.v0",
							decision: {
								kind: "continue",
								decisionId: "decision-continue",
								effectRunId: "run-1",
								agentRunId: "agent-1",
								source: {
									requestId: "request-1",
									operationId: "op-1",
									outcomeId: "bad-proposal",
								},
								next: [
									{
										kind: "proposal",
										proposalId: "proposal-1",
										effectRunId: "other-run",
										requestKind: "executor",
									},
								],
							},
						},
					},
				}),
			],
		]);

		expect(decisions).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "malformed-agent-decision" });
	});

	it("projects a small AgentRequest ledger default view set", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const ledger = agentRequestLedgerViews(g, requestFacts);
		const views: unknown[] = [];
		ledger.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));

		requestFacts.down([
			["DATA", issued("request-1", "op-1", "executor", "llm-call")],
			[
				"DATA",
				{
					kind: "status",
					requestId: "request-1",
					operationId: "op-1",
					effectRunId: "run-1",
					status: "awaiting-provider",
				},
			],
		]);
		requestFacts.down([
			[
				"DATA",
				{
					kind: "status",
					requestId: "request-1",
					operationId: "op-1",
					effectRunId: "run-1",
					status: "completed",
				},
			],
		]);

		const latest = views.at(-1) as {
			requestsById: Map<string, AgentRequestIssued>;
			requestsByEffectRun: Map<string, readonly string[]>;
			statusByRequest: Map<string, AgentRequestStatusChanged>;
			pending: readonly AgentRequestIssued[];
			awaitingProvider: readonly AgentRequestIssued[];
			audit: readonly { readonly kind: string }[];
		};
		expect(latest.requestsById.get("request-1")).toMatchObject({ operationId: "op-1" });
		expect(latest.requestsByEffectRun.get("run-1")).toEqual(["request-1"]);
		expect(latest.statusByRequest.get("request-1")?.status).toBe("completed");
		expect(latest.pending).toHaveLength(0);
		expect(latest.awaitingProvider).toHaveLength(0);
		expect(latest.audit.map((record) => record.kind)).toEqual([
			"agent-request-issued",
			"agent-request-status",
			"agent-request-status",
		]);
	});

	it("sanitizes rejected and status issues before storing AgentRequest ledger views", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const ledger = agentRequestLedgerViews(g, requestFacts);
		const views: AgentRequestViews[] = [];
		const issues: DataIssue[] = [];
		ledger.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1] as AgentRequestViews));
		ledger.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		requestFacts.down([
			["DATA", issued("request-raw-issue", "op-raw-issue", "executor", "tool-call")],
			[
				"DATA",
				{
					kind: "status",
					requestId: "request-raw-issue",
					operationId: "op-raw-issue",
					effectRunId: "run-1",
					status: "failed",
					sourceRefs: [
						{
							kind: "provider-raw",
							id: "status-ref",
							metadata: { stdout: "RAW_LEDGER_STATUS_REF_SHOULD_NOT_PROJECT" },
						},
					],
					issues: [
						{
							kind: "issue",
							code: "raw-status-issue",
							source: "runtime-status",
							message: "raw status issue",
							correlationId: "corr-status-issue",
							path: ["status", 0],
							retryable: true,
							details: { rawResponse: "RAW_LEDGER_STATUS_ISSUE_SHOULD_NOT_PROJECT" },
							metadata: { summary: "safe status issue metadata" },
						},
					],
					metadata: { apiKey: "RAW_LEDGER_STATUS_METADATA_SHOULD_NOT_PROJECT" },
				} satisfies AgentRequestStatusChanged,
			],
			[
				"DATA",
				{
					kind: "rejected",
					proposalId: "proposal-raw-issue",
					effectRunId: "run-1",
					issue: {
						kind: "issue",
						code: "raw-rejected-issue",
						message: "raw rejected issue",
						details: { stderr: "RAW_LEDGER_REJECTED_ISSUE_SHOULD_NOT_PROJECT" },
					},
				},
			],
		]);

		const latest = views.at(-1);
		expect(latest?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "raw-status-issue",
					source: "runtime-status",
					correlationId: "corr-status-issue",
					path: ["status", 0],
					retryable: true,
					details: expect.objectContaining({
						redacted: true,
						reason: "forbidden-runtime-material",
					}),
					metadata: { summary: "safe status issue metadata" },
				}),
				expect.objectContaining({
					code: "raw-rejected-issue",
					details: expect.objectContaining({
						redacted: true,
						reason: "forbidden-runtime-material",
					}),
				}),
			]),
		);
		expect(latest?.statusByRequest.get("request-raw-issue")?.sourceRefs).toEqual([
			{ kind: "provider-raw", id: "status-ref" },
		]);
		expect(latest?.statusByRequest.get("request-raw-issue")).not.toHaveProperty("metadata");
		expect(issues).toEqual(latest?.issues);
		expect(JSON.stringify({ views, issues })).not.toMatch(
			/RAW_LEDGER_|rawResponse|stdout|stderr|apiKey/,
		);
	});

	it("keeps fake ExecutorOutcome fixtures provider-neutral", () => {
		expect(
			fakeExecutorFailure({
				outcomeId: "failure-1",
				requestId: "request-1",
				operationId: "op-1",
				routeId: "route-1",
				executorId: "exec-1",
				profileId: "profile-1",
				attempt: 1,
				error: { kind: "issue", code: "adapter-failure", message: "adapter failed" },
			}),
		).toMatchObject({
			kind: "failure",
			error: { kind: "issue", code: "adapter-failure" },
		});
	});

	it("maps every terminal EffectRunResult status to WorkItem evidence, status, issues, and audit", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			now: () => 900,
		});
		const evidence: WorkItemEvidenceRecorded[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		mapper.evidence.subscribe(
			(msg) => msg[0] === "DATA" && evidence.push(msg[1] as WorkItemEvidenceRecorded),
		);
		mapper.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);

		const terminalResults: EffectRunResult[] = [
			{
				kind: "effect-run-result",
				resultId: "run-completed:result",
				status: "completed",
				effectRunId: "run-completed",
				output: { kind: "ok", value: true },
			},
			{
				kind: "effect-run-result",
				resultId: "run-failed:result",
				status: "failed",
				effectRunId: "run-failed",
				error: { kind: "issue", code: "failed", message: "failed" },
				issues: [{ kind: "issue", code: "detail", message: "detail" }],
			},
			{
				kind: "effect-run-result",
				resultId: "run-blocked:result",
				status: "blocked",
				effectRunId: "run-blocked",
				needs: [{ kind: "human-review", message: "needs review" }],
			},
			{
				kind: "effect-run-result",
				resultId: "run-timeout:result",
				status: "timeout",
				effectRunId: "run-timeout",
				timeoutMs: 1000,
			},
			{
				kind: "effect-run-result",
				resultId: "run-canceled:result",
				status: "canceled",
				effectRunId: "run-canceled",
				reason: "user canceled",
			},
			{
				kind: "effect-run-result",
				resultId: "run-waived:result",
				status: "waived",
				effectRunId: "run-waived",
				reason: "not needed",
			},
		];
		for (const result of terminalResults) {
			effectRuns.down([
				[
					"DATA",
					effectRun({
						effectRunId: result.effectRunId,
						subjectRefs: [{ kind: "work-item", id: "wi-1" }],
						goal: { kind: "verify" },
					}),
				],
			]);
			results.down([["DATA", result]]);
		}

		expect(evidence.map((fact) => fact.status)).toEqual([
			"completed",
			"failed",
			"blocked",
			"timeout",
			"canceled",
			"waived",
		]);
		expect(evidence.find((fact) => fact.status === "failed")?.error).toMatchObject({
			code: "failed",
		});
		expect(evidence.find((fact) => fact.status === "blocked")?.needs).toEqual([
			{ kind: "human-review", message: "needs review" },
		]);
		expect(evidence.find((fact) => fact.status === "timeout")?.timeoutMs).toBe(1000);
		expect(evidence.find((fact) => fact.status === "waived")?.reason).toBe("not needed");
		expect(statuses).toHaveLength(6);
		expect(issues).toEqual([]);
		expect(audit).toHaveLength(6);
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
	});

	it("clones evidence arrays and redacts oversized WorkItem output values", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			now: () => 901,
		});
		const evidence: WorkItemEvidenceRecorded[] = [];
		mapper.evidence.subscribe(
			(msg) => msg[0] === "DATA" && evidence.push(msg[1] as WorkItemEvidenceRecorded),
		);
		mapper.issues.subscribe(() => {});
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		for (const runId of ["run-oversized", "run-mutable"]) {
			effectRuns.down([
				[
					"DATA",
					effectRun({
						effectRunId: runId,
						subjectRefs: [{ kind: "work-item", id: "wi-1" }],
						goal: { kind: "verify" },
					}),
				],
			]);
		}

		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-oversized:result",
					status: "completed",
					effectRunId: "run-oversized",
					output: {
						kind: "tool-output",
						value: { content: "large-content-".repeat(80) },
					},
				},
			],
		]);

		const auditRefs = ["audit-1"];
		const issueRefs = ["issue-ref-1"];
		const issuePath: (string | number)[] = ["error", 0];
		const issue: DataIssue = {
			kind: "issue",
			code: "provider-failed",
			message: "provider failed",
			refs: issueRefs,
			path: issuePath,
		};
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-mutable:result",
					status: "failed",
					effectRunId: "run-mutable",
					auditRefs,
					error: issue,
					issues: [issue],
				},
			],
		]);
		auditRefs.push("audit-mutated");
		issueRefs.push("issue-ref-mutated");
		issuePath.push("mutated");

		const oversized = evidence.find((fact) => fact.effectRunId === "run-oversized");
		expect(oversized?.output).toEqual({ kind: "tool-output", value: undefined });
		expect(oversized?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "work-item-evidence-public-material-redacted",
					details: expect.objectContaining({
						area: "output.value.content",
						reason: "oversized-inline-text",
					}),
				}),
			]),
		);
		expect(JSON.stringify(oversized)).not.toContain("large-content-");

		const mutable = evidence.find((fact) => fact.effectRunId === "run-mutable");
		expect(mutable?.auditRefs).toEqual(["audit-1"]);
		expect(mutable?.error?.refs).toEqual(["issue-ref-1"]);
		expect(mutable?.error?.path).toEqual(["error", 0]);
		expect(mutable?.issues?.[0]?.refs).toEqual(["issue-ref-1"]);
		expect(mutable?.issues?.[0]?.path).toEqual(["error", 0]);
		expect(Object.isFrozen(mutable?.auditRefs)).toBe(true);
		expect(Object.isFrozen(mutable?.error?.refs)).toBe(true);
		expect(Object.isFrozen(mutable?.error?.path)).toBe(true);
	});

	it("emits DataIssue instead of evidence for stale or unknown WorkItem/effectRun refs", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
			],
		]);

		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "wrong-work-item",
					status: "completed",
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-2" }],
					output: { kind: "ok" },
				},
			],
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "wrong-effect-run-ref",
					status: "completed",
					effectRunId: "run-1",
					sourceRefs: [{ kind: "effect-run", id: "other-run" }],
					output: { kind: "ok" },
				},
			],
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "unknown-run",
					status: "completed",
					effectRunId: "missing-run",
					output: { kind: "ok" },
				},
			],
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "wrong-work-item-source-ref",
					status: "completed",
					effectRunId: "run-1",
					sourceRefs: [{ kind: "work-item", id: "wi-2" }],
					output: { kind: "ok" },
				},
			],
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "ambiguous-work-item-subjects",
					status: "completed",
					effectRunId: "run-1",
					subjectRefs: [
						{ kind: "work-item", id: "wi-1" },
						{ kind: "work-item", id: "wi-2" },
					],
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual([
			"stale-work-item-source-ref",
			"stale-effect-run-source-ref",
			"unknown-effect-run-result",
			"stale-work-item-source-ref",
			"stale-work-item-source-ref",
		]);
	});

	it("requires explicit WorkItem seed facts before recording evidence", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-other")]]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-missing" }],
					goal: { kind: "verify" },
				}),
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "unknown-work-item-evidence-target" });
	});
});
