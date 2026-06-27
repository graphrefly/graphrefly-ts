import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	type AgentDecisionContinue,
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	admitAgentRequestProposal,
	agentRequestProposalFromDecision,
	buildToolProviderAdapterInputs,
	type ContextContribution,
	type EffectRun,
	type EffectRunResult,
	type ExecutorOutcome,
	type ExecutorProfile,
	type ExecutorRoute,
	effectRun,
	effectRunCompletionProjector,
	executorOutcomeViewProjector,
	fakeExecutorFailure,
	fakeExecutorResult,
	issueAgentRequest,
	localBuiltinToolProviderCatalog,
	type PromptBundle,
	requestSatisfactionProjector,
	resolveToolProviderExecutionPolicies,
	structuredAgentDecisionInterpreter,
	type ToolProviderAdapterInput,
	type ToolProviderExecutionPolicy,
	validateToolProviderExecutionPolicy,
} from "../orchestration/agent-runtime.js";
import {
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionProposal,
	type WorkItemEffectRequested,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemEffectResultMapper,
	workItemEffectRunProjector,
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 1", () => {
	it("projects ExecutorOutcome views with bounded agent-observation material", () => {
		const g = graph();
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const views = executorOutcomeViewProjector(g, {
			outcomes,
			policy: { maxSummaryChars: 20, includeIssues: true, includeUsage: true },
		});
		const projected: unknown[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		views.views.subscribe((msg) => msg[0] === "DATA" && projected.push(msg[1]));
		views.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		views.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		outcomes.down([
			[
				"DATA",
				fakeExecutorFailure({
					outcomeId: "outcome-1",
					requestId: "request-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					retryable: true,
					error: {
						kind: "issue",
						code: "provider-failed",
						message: "Provider returned a long failure message for compact projection",
					},
					usage: { inputTokens: 10, outputTokens: 2 },
					evidenceRefs: [{ kind: "executor-outcome", id: "outcome-1" }],
				}),
			],
		]);

		expect(projected.at(-1)).toMatchObject({
			kind: "executor-outcome-view",
			audience: "agent-observation",
			status: "failure",
			errorKind: "provider-failed",
			retryable: true,
			nextActions: ["retry-or-route"],
			summaryTruncated: true,
			summaryLimitChars: 20,
			usage: { inputTokens: 10, outputTokens: 2 },
		});
		expect((projected.at(-1) as { summary: string }).summary.length).toBeLessThanOrEqual(20);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "provider-failed" }),
				expect.objectContaining({
					code: "executor-outcome-view-summary-truncated",
					severity: "warning",
					subjectId: "request-1",
				}),
			]),
		);
		expect(audit.at(-1)).toMatchObject({
			kind: "executor-outcome-view-projected",
			subjectId: "request-1",
		});
	});

	it("maps WorkItemEffectRequested through EffectRun completion into WorkItemEvidenceRecorded", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const profiles = g.node<ExecutorProfile>([], null, { name: "profiles" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const workItemRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
		const satisfaction = requestSatisfactionProjector(g, {
			requestFacts,
			executorProfiles: [profiles],
			executorRoutes: [routes],
			executorOutcomes: [outcomes],
		});
		const interpreter = structuredAgentDecisionInterpreter(g, outcomes, {
			requestFacts: [requestFacts],
		});
		const completion = effectRunCompletionProjector(g, {
			effectRuns: workItemRuns.effectRuns,
			decisions: [interpreter.decisions],
			requestStatuses: [satisfaction.status],
			requestFacts: [requestFacts],
			now: () => 700,
		});
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns: workItemRuns.effectRuns,
			effectRunResults: completion.results,
			effectRequests,
			now: () => 800,
		});
		const seededRuns: EffectRun[] = [];
		const evidence: WorkItemEvidenceRecorded[] = [];
		const views: unknown[] = [];
		workItemRuns.effectRuns.subscribe(
			(msg) => msg[0] === "DATA" && seededRuns.push(msg[1] as EffectRun),
		);
		interpreter.decisions.subscribe(() => {});
		completion.results.subscribe(() => {});
		mapper.evidence.subscribe(
			(msg) => msg[0] === "DATA" && evidence.push(msg[1] as WorkItemEvidenceRecorded),
		);
		mapper.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));

		workItems.down([
			[
				"DATA",
				{
					kind: "work-item",
					workItemId: "wi-1",
					sourceRefs: [{ kind: "work-item", id: "wi-1" }],
					workItemKind: "issue",
					lifecycleStatus: "open",
				},
			],
		]);
		effectRequests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify", summary: "check acceptance" },
					sourceRefs: [{ kind: "acceptance-criteria", id: "ac-1" }],
				},
			],
		]);
		expect(seededRuns.at(-1)).toMatchObject({
			effectRunId: "run-1",
			subjectRefs: [{ kind: "work-item", id: "wi-1" }],
			sourceRefs: [
				{ kind: "work-item", id: "wi-1" },
				{ kind: "work-item-effect-request", id: "wi-effect-1" },
				{ kind: "acceptance-criteria", id: "ac-1" },
			],
		});

		const continueDecision: AgentDecisionContinue = {
			kind: "continue",
			decisionId: "decision-continue",
			effectRunId: "run-1",
			agentRunId: "agent-1",
			source: { requestId: "seed", operationId: "seed-op", outcomeId: "seed-outcome" },
			next: [],
		};
		const proposal = agentRequestProposalFromDecision(continueDecision, {
			proposalId: "proposal-1",
			requestKind: "executor",
			required: true,
			input: { inputId: "input-1", inputKind: "llm-call", dataMode: "ref", ref: "prompt:p-1" },
		});
		const admitted = admitAgentRequestProposal(proposal, {
			requestId: "request-1",
			operationId: "op-1",
			sourceRefs: [{ kind: "agent-decision", id: "decision-continue" }],
		});
		const issued = issueAgentRequest(proposal, admitted);
		requestFacts.down([
			["DATA", proposal],
			["DATA", admitted],
			["DATA", issued],
		]);
		profiles.down([
			[
				"DATA",
				{
					profileId: "profile-1",
					executorId: "exec-1",
					kind: "llm",
					acceptedInputKinds: ["llm-call"],
				},
			],
		]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-1",
					requestId: "request-1",
					operationId: "op-1",
					inputId: "input-1",
					inputKind: "llm-call",
					executorId: "exec-1",
					profileId: "profile-1",
				},
			],
		]);
		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "outcome-1",
					requestId: "request-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					inputId: "input-1",
					inputKind: "llm-call",
					result: {
						kind: "agent-decision",
						value: {
							kind: "agent-decision",
							schemaRef: "graphrefly.agent-decision.v0",
							decision: {
								kind: "final",
								decisionId: "decision-final",
								effectRunId: "run-1",
								agentRunId: "agent-1",
								source: {
									requestId: "request-1",
									operationId: "op-1",
									outcomeId: "outcome-1",
								},
								output: { kind: "verified", value: { ok: true } },
							},
						},
					},
				}),
			],
		]);

		expect(evidence.at(-1)).toMatchObject({
			kind: "work-item-evidence-recorded",
			workItemId: "wi-1",
			effectRunId: "run-1",
			status: "completed",
			output: { kind: "verified", value: { ok: true } },
			recordedAtMs: 800,
		});
		expect(evidence.at(-1)?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-item", id: "wi-1" },
				{ kind: "work-item-effect-request", id: "wi-effect-1" },
				{ kind: "acceptance-criteria", id: "ac-1" },
				{ kind: "effect-run", id: "run-1" },
				{ kind: "effect-run-result", id: "run-1:result" },
				{ kind: "agent-decision", id: "decision-final" },
				{ kind: "executor-outcome", id: "outcome-1" },
			]),
		);
		const latestView = views.at(-1) as {
			evidenceByWorkItem: Map<string, readonly WorkItemEvidenceRecorded[]>;
			latestEvidenceByEffectRun: Map<string, WorkItemEvidenceRecorded>;
			pendingEffectRequests: readonly WorkItemEffectRequested[];
		};
		expect(latestView.evidenceByWorkItem.get("wi-1")).toHaveLength(1);
		expect(latestView.latestEvidenceByEffectRun.get("run-1")?.status).toBe("completed");
		expect(latestView.pendingEffectRequests).toEqual([]);
	});

	it("runs the deterministic EffectRun -> request -> fake outcome -> final result path", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const profiles = g.node<ExecutorProfile>([], null, { name: "profiles" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const satisfaction = requestSatisfactionProjector(g, {
			name: "satisfaction",
			requestFacts,
			executorProfiles: [profiles],
			executorRoutes: [routes],
			executorOutcomes: [outcomes],
		});
		const interpreter = structuredAgentDecisionInterpreter(g, outcomes, {
			requestFacts: [requestFacts],
		});
		const completion = effectRunCompletionProjector(g, {
			name: "completion",
			effectRuns,
			decisions: [interpreter.decisions],
			requestStatuses: [satisfaction.status],
			requestFacts: [requestFacts],
			now: () => 500,
		});
		const statuses: AgentRequestStatusChanged[] = [];
		const results: EffectRunResult[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		interpreter.decisions.subscribe(() => {});
		completion.results.subscribe(
			(msg) => msg[0] === "DATA" && results.push(msg[1] as EffectRunResult),
		);

		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					agentRunId: "agent-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify", summary: "check acceptance" },
				}),
			],
		]);
		const continueDecision: AgentDecisionContinue = {
			kind: "continue",
			decisionId: "decision-continue",
			effectRunId: "run-1",
			agentRunId: "agent-1",
			source: { requestId: "seed", operationId: "seed-op", outcomeId: "seed-outcome" },
			next: [],
		};
		const proposal = agentRequestProposalFromDecision(continueDecision, {
			proposalId: "proposal-1",
			requestKind: "executor",
			required: true,
			input: { inputId: "input-1", inputKind: "llm-call", dataMode: "ref", ref: "prompt:p-1" },
		});
		const admitted = admitAgentRequestProposal(proposal, {
			requestId: "request-1",
			operationId: "op-1",
			sourceRefs: [{ kind: "agent-decision", id: "decision-continue" }],
		});
		const issued = issueAgentRequest(proposal, admitted);
		requestFacts.down([
			["DATA", proposal],
			["DATA", admitted],
			["DATA", issued],
		]);
		profiles.down([
			[
				"DATA",
				{
					profileId: "profile-1",
					executorId: "exec-1",
					kind: "llm",
					acceptedInputKinds: ["llm-call"],
				},
			],
		]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-1",
					requestId: "request-1",
					operationId: "op-1",
					inputId: "input-1",
					inputKind: "llm-call",
					executorId: "exec-1",
					profileId: "profile-1",
				},
			],
		]);
		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "outcome-1",
					requestId: "request-1",
					operationId: "op-1",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					inputId: "input-1",
					inputKind: "llm-call",
					result: {
						kind: "agent-decision",
						value: {
							kind: "agent-decision",
							schemaRef: "graphrefly.agent-decision.v0",
							decision: {
								kind: "final",
								decisionId: "decision-final",
								effectRunId: "run-1",
								agentRunId: "agent-1",
								source: {
									requestId: "request-1",
									operationId: "op-1",
									outcomeId: "outcome-1",
								},
								output: { kind: "verified", value: { ok: true } },
							},
						},
					},
				}),
			],
		]);

		expect(statuses.map((s) => s.status)).toContain("awaiting-provider");
		expect(statuses.at(-1)).toMatchObject({ requestId: "request-1", status: "completed" });
		expect(results.at(-1)).toMatchObject({
			kind: "effect-run-result",
			effectRunId: "run-1",
			status: "completed",
			completedAtMs: 500,
			output: { kind: "verified", value: { ok: true } },
			sourceRefs: [
				{ kind: "agent-decision", id: "decision-final" },
				{ kind: "executor-outcome", id: "outcome-1" },
			],
		});
	});

	it("matches context, prompt, and executor satisfaction by requestId and operationId", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const context = g.node<ContextContribution>([], null, { name: "context" });
		const prompts = g.node<PromptBundle>([], null, { name: "prompts" });
		const profiles = g.node<ExecutorProfile>([], null, { name: "profiles" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const satisfaction = requestSatisfactionProjector(g, {
			requestFacts,
			contextContributions: [context],
			promptBundles: [prompts],
			executorProfiles: [profiles],
			executorRoutes: [routes],
			executorOutcomes: [outcomes],
		});
		const statuses: AgentRequestStatusChanged[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		const contextReq = issued("context-1", "ctx-op", "context");
		const promptReq = issued("prompt-1", "prompt-op", "prompt");
		const executorReq = issued("exec-1", "exec-op", "executor", "tool-call");

		requestFacts.down([
			["DATA", contextReq],
			["DATA", promptReq],
			["DATA", executorReq],
		]);
		context.down([
			[
				"DATA",
				{
					kind: "context-contribution",
					contributionId: "ctx-1",
					requestId: "context-1",
					operationId: "ctx-op",
					status: "ready",
					frameId: "frame-1",
				},
			],
		]);
		prompts.down([
			[
				"DATA",
				{
					kind: "prompt-bundle",
					promptId: "prompt-bundle-1",
					requestId: "prompt-1",
					operationId: "prompt-op",
					status: "ready",
					sourceFrameIds: ["frame-1"],
				},
			],
		]);
		profiles.down([["DATA", { profileId: "tool-profile", executorId: "tool-exec", kind: "tool" }]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "tool-route",
					requestId: "exec-1",
					operationId: "exec-op",
					inputKind: "tool-call",
					executorId: "tool-exec",
					profileId: "tool-profile",
				},
			],
		]);
		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "tool-outcome",
					requestId: "exec-1",
					operationId: "exec-op",
					routeId: "tool-route",
					executorId: "tool-exec",
					profileId: "tool-profile",
					attempt: 1,
					inputKind: "tool-call",
					result: { kind: "tool-result", value: { ok: true } },
				}),
			],
		]);

		expect(
			statuses
				.filter((s) => s.status === "completed")
				.map((s) => s.requestId)
				.sort(),
		).toEqual(["context-1", "exec-1", "prompt-1"]);
	});

	it("uses local builtin tool catalog facts without adding provider handles to WorkItem core", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const profiles = g.node<ExecutorProfile>([], null, { name: "profiles" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const satisfaction = requestSatisfactionProjector(g, {
			requestFacts,
			executorProfiles: [profiles],
			executorRoutes: [routes],
			executorOutcomes: [outcomes],
		});
		const statuses: AgentRequestStatusChanged[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		const catalog = localBuiltinToolProviderCatalog({
			providerId: "local",
			limits: { timeoutMs: 1000 },
		});
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected local builtin tool profile");
		const policy = catalog.policies?.[0];
		if (policy === undefined) throw new Error("expected default tool provider policy");
		expect(catalog.tools.map((tool) => tool.toolName)).toEqual(
			expect.arrayContaining(["file.read", "bash.run", "url.fetch"]),
		);
		expect(policy).toMatchObject({
			kind: "tool-provider-execution-policy",
			providerId: "local",
			profileIds: [profile.profileId],
			toolNames: expect.arrayContaining(["file.read", "bash.run", "url.fetch"]),
			operations: expect.arrayContaining(["read", "run", "fetch"]),
			timeout: { timeoutMs: 30_000 },
			redaction: { mode: "summary" },
			filesystem: { cwd: ".", allowRead: true, allowWrite: false },
			approval: {
				mode: "require",
				requiredForToolNames: expect.arrayContaining(["file.edit/apply-patch", "bash.run"]),
			},
			artifacts: { defaultDataMode: "summary" },
			network: { mode: "custom", protocols: ["https:"] },
		} satisfies Partial<ToolProviderExecutionPolicy>);
		expect(policy.sizeCapacity?.limits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ unit: "chars", perRequest: true }),
				expect.objectContaining({ unit: "bytes", perArtifact: true }),
				expect.objectContaining({ unit: "lines", perStream: true }),
			]),
		);
		expect(validateToolProviderExecutionPolicy(policy)).toEqual([]);
		expect(catalog.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: policy.policyId },
		]);
		expect(profile.policyRefs).toEqual(catalog.policyRefs);
		for (const tool of catalog.tools) expect(tool.policyRefs).toEqual(catalog.policyRefs);
		expect(profile).toMatchObject({
			kind: "tool",
			acceptedInputKinds: ["tool-call"],
			limits: { timeoutMs: 1000 },
		});
		expect(JSON.stringify(catalog)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);

		requestFacts.down([["DATA", issued("tool-req", "tool-op", "executor", "tool-call")]]);
		profiles.down([["DATA", profile]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "tool-route",
					requestId: "tool-req",
					operationId: "tool-op",
					inputKind: "tool-call",
					executorId: profile.executorId,
					profileId: profile.profileId,
				},
			],
		]);
		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "tool-outcome",
					requestId: "tool-req",
					operationId: "tool-op",
					routeId: "tool-route",
					executorId: profile.executorId,
					profileId: profile.profileId,
					attempt: 1,
					inputKind: "tool-call",
					result: {
						kind: "tool-result",
						summary: "read complete",
						refs: [{ kind: "artifact", id: "artifact:file-read:1" }],
					},
				}),
			],
		]);

		expect(statuses.at(-1)).toMatchObject({ requestId: "tool-req", status: "completed" });
	});
});
