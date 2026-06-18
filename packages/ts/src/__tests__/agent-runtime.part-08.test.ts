import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	type AgentDecision,
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	buildToolProviderAdapterInputs,
	type EffectRun,
	type EffectRunResult,
	type ExecutorOutcome,
	type ExecutorProfile,
	type ExecutorRoute,
	effectRun,
	effectRunCompletionProjector,
	executorOutcomeViewProjector,
	fakeExecutorResult,
	localBuiltinToolProviderCatalog,
	type PromptBundle,
	requestSatisfactionProjector,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
} from "../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionProposal,
	WorkItemSeed,
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 8", () => {
	it("projects compact ExecutorOutcome views without inlining raw result payloads", () => {
		const g = graph();
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const projector = executorOutcomeViewProjector(g, {
			outcomes,
			policy: { maxSummaryChars: 18, includeMetadata: true },
		});
		const views: unknown[] = [];
		const audit: unknown[] = [];
		projector.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		projector.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "outcome-large",
					requestId: "request-large",
					operationId: "op-large",
					routeId: "route-large",
					executorId: "exec-tool",
					profileId: "profile-tool",
					attempt: 1,
					inputKind: "tool-call",
					result: {
						kind: "tool-result",
						summary: "stdout contained a very long failure explanation",
						value: { stdout: "RAW_STDOUT_SHOULD_NOT_APPEAR".repeat(20) },
						refs: [{ kind: "artifact", id: "stdout-summary-ref" }],
					},
					evidenceRefs: [{ kind: "executor-route", id: "route-large" }],
					metadata: { rawResponse: "raw-123" },
				}),
			],
		]);

		expect(views).toHaveLength(1);
		expect(views.at(-1)).toMatchObject({
			kind: "executor-outcome-view",
			audience: "agent-observation",
			outcomeId: "outcome-large",
			status: "result",
			materialRefs: [{ kind: "artifact", id: "stdout-summary-ref" }],
			sourceRefs: [
				{ kind: "executor-outcome", id: "outcome-large" },
				{ kind: "executor-route", id: "route-large" },
			],
		});
		expect(views.at(-1)).not.toHaveProperty("metadata");
		expect((views.at(-1) as { summary: string }).summary).toMatch(/^stdout/);
		expect((views.at(-1) as { summary: string }).summary.length).toBeLessThanOrEqual(18);
		expect(JSON.stringify(views.at(-1))).not.toContain("RAW_STDOUT_SHOULD_NOT_APPEAR");
		expect(JSON.stringify(views.at(-1))).not.toContain("raw-123");
		expect(audit.at(-1)).toMatchObject({
			kind: "executor-outcome-view-projected",
			subjectId: "request-large",
		});
	});

	it("emits DataIssue for stale operationId and does not satisfy the request", () => {
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
		const issues: unknown[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		satisfaction.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		requestFacts.down([["DATA", issued("request-1", "op-good", "executor", "llm-call")]]);
		profiles.down([["DATA", { profileId: "profile-1", executorId: "exec-1", kind: "llm" }]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-1",
					requestId: "request-1",
					operationId: "op-good",
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
					outcomeId: "stale",
					requestId: "request-1",
					operationId: "op-stale",
					routeId: "route-1",
					executorId: "exec-1",
					profileId: "profile-1",
					attempt: 1,
					inputKind: "llm-call",
					result: { kind: "value", value: true },
				}),
			],
		]);

		expect(issues.at(-1)).toMatchObject({ kind: "issue", code: "stale-outcome-operation" });
		expect(statuses.map((s) => s.status)).not.toContain("completed");
	});

	it("keeps ExecutorRoute nonterminal and reports incompatible routes as DataIssue", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const profiles = g.node<ExecutorProfile>([], null, { name: "profiles" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const satisfaction = requestSatisfactionProjector(g, {
			requestFacts,
			executorProfiles: [profiles],
			executorRoutes: [routes],
		});
		const statuses: AgentRequestStatusChanged[] = [];
		const issues: unknown[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		satisfaction.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);
		profiles.down([["DATA", { profileId: "profile-1", executorId: "exec-1", kind: "llm" }]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-1",
					requestId: "request-1",
					operationId: "op-1",
					inputKind: "llm-call",
					executorId: "exec-1",
					profileId: "profile-1",
				},
			],
		]);
		expect(statuses.at(-1)).toMatchObject({ status: "awaiting-provider" });
		expect(statuses.map((s) => s.status)).not.toContain("completed");

		requestFacts.down([["DATA", issued("request-2", "op-2", "executor", "tool-call")]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-2",
					requestId: "request-2",
					operationId: "op-2",
					inputKind: "tool-call",
					executorId: "exec-1",
					profileId: "profile-1",
				},
			],
		]);
		expect(issues.at(-1)).toMatchObject({
			kind: "issue",
			code: "profile-kind-input-incompatible",
		});
	});

	it("rejects route input-kind rewrites and mismatched executor outcomes", () => {
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
		const issues: unknown[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		satisfaction.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);
		profiles.down([
			["DATA", { profileId: "llm-profile", executorId: "llm-exec", kind: "llm" }],
			["DATA", { profileId: "tool-profile", executorId: "tool-exec", kind: "tool" }],
		]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "bad-route",
					requestId: "request-1",
					operationId: "op-1",
					inputKind: "tool-call",
					executorId: "tool-exec",
					profileId: "tool-profile",
				},
			],
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "good-route",
					requestId: "request-1",
					operationId: "op-1",
					inputKind: "llm-call",
					executorId: "llm-exec",
					profileId: "llm-profile",
				},
			],
		]);
		outcomes.down([
			[
				"DATA",
				fakeExecutorResult({
					outcomeId: "spoofed",
					requestId: "request-1",
					operationId: "op-1",
					routeId: "good-route",
					executorId: "tool-exec",
					profileId: "llm-profile",
					attempt: 1,
					inputKind: "llm-call",
					result: { kind: "value", value: true },
				}),
			],
		]);

		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "route-input-kind-mismatch" }),
				expect.objectContaining({ code: "outcome-route-executor-mismatch" }),
			]),
		);
		expect(statuses.map((s) => s.status)).not.toContain("completed");
	});

	it("keeps multiple compatible routes valid by routeId", () => {
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
		const issues: unknown[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);
		satisfaction.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);
		profiles.down([
			["DATA", { profileId: "profile-1", executorId: "exec-1", kind: "llm" }],
			["DATA", { profileId: "profile-2", executorId: "exec-2", kind: "llm" }],
		]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-1",
					requestId: "request-1",
					operationId: "op-1",
					inputKind: "llm-call",
					executorId: "exec-1",
					profileId: "profile-1",
				},
			],
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-2",
					requestId: "request-1",
					operationId: "op-1",
					inputKind: "llm-call",
					executorId: "exec-2",
					profileId: "profile-2",
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
					inputKind: "llm-call",
					result: { kind: "value", value: true },
				}),
			],
		]);

		expect(issues).not.toContainEqual(
			expect.objectContaining({ code: "missing-compatible-route" }),
		);
		expect(statuses.at(-1)).toMatchObject({ requestId: "request-1", status: "completed" });
	});

	it("replays out-of-order route and outcome facts once the request/profile arrives", () => {
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

		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "route-1",
					requestId: "request-1",
					operationId: "op-1",
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
					inputKind: "llm-call",
					result: { kind: "value", value: true },
				}),
			],
		]);
		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);
		profiles.down([["DATA", { profileId: "profile-1", executorId: "exec-1", kind: "llm" }]]);

		expect(statuses.at(-1)).toMatchObject({ requestId: "request-1", status: "completed" });
	});

	it("does not let late nonterminal prompt facts reopen a terminal request", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const prompts = g.node<PromptBundle>([], null, { name: "prompts" });
		const satisfaction = requestSatisfactionProjector(g, {
			requestFacts,
			promptBundles: [prompts],
		});
		const statuses: AgentRequestStatusChanged[] = [];
		satisfaction.status.subscribe(
			(msg) => msg[0] === "DATA" && statuses.push(msg[1] as AgentRequestStatusChanged),
		);

		requestFacts.down([["DATA", issued("prompt-1", "op-1", "prompt")]]);
		prompts.down([
			[
				"DATA",
				{
					kind: "prompt-bundle",
					promptId: "prompt-ready",
					requestId: "prompt-1",
					operationId: "op-1",
					status: "ready",
				},
			],
			[
				"DATA",
				{
					kind: "prompt-bundle",
					promptId: "prompt-late",
					requestId: "prompt-1",
					operationId: "op-1",
					status: "partial",
				},
			],
		]);

		expect(statuses.map((s) => s.status)).toContain("completed");
		expect(
			statuses.slice(statuses.findIndex((s) => s.status === "completed") + 1),
		).not.toContainEqual(expect.objectContaining({ status: "awaiting-prompt" }));
	});

	it("represents retry exhaustion only as graph-visible status facts", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			requestFacts: [requestFacts],
		});
		const status: unknown[] = [];
		completion.status.subscribe((msg) => msg[0] === "DATA" && status.push(msg[1]));
		effectRuns.down([["DATA", effectRun({ effectRunId: "run-1", goal: { kind: "retry-test" } })]]);
		requestFacts.down([
			["DATA", issued("request-1", "op-1", "executor", "llm-call")],
			[
				"DATA",
				{
					kind: "status",
					requestId: "request-1",
					operationId: "op-1",
					effectRunId: "run-1",
					status: "retry-exhausted",
				},
			],
		]);

		expect(status.at(-1)).toMatchObject({ effectRunId: "run-1", state: "pending" });
	});

	it("consumes terminal AgentRequestFact ledger statuses for EffectRun completion", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const decisions = g.node<AgentDecision>([], null, { name: "decisions" });
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			requestFacts: [requestFacts],
			decisions: [decisions],
			now: () => 1000,
		});
		const results: EffectRunResult[] = [];
		completion.results.subscribe(
			(msg) => msg[0] === "DATA" && results.push(msg[1] as EffectRunResult),
		);

		effectRuns.down([["DATA", effectRun({ effectRunId: "run-1", goal: { kind: "test" } })]]);
		requestFacts.down([["DATA", issued("request-1", "op-1", "executor", "llm-call")]]);
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
		expect(results).toEqual([]);

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

		expect(results.at(-1)).toMatchObject({
			effectRunId: "run-1",
			status: "completed",
			completedAtMs: 1000,
		});
	});

	it("rejects stale request status identities for completion", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requestFacts" });
		const decisions = g.node<AgentDecision>([], null, { name: "decisions" });
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			requestFacts: [requestFacts],
			decisions: [decisions],
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
					operationId: "op-stale",
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

		expect(issues.at(-1)).toMatchObject({ code: "stale-request-status" });
		expect(results).toEqual([]);
	});

	it("emits DataIssue and audit for late conflicting EffectRunResult candidates", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const candidates = g.node<EffectRunResult>([], null, { name: "candidates" });
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			resultCandidates: [candidates],
		});
		const results: EffectRunResult[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		completion.results.subscribe(
			(msg) => msg[0] === "DATA" && results.push(msg[1] as EffectRunResult),
		);
		completion.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		completion.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		effectRuns.down([["DATA", effectRun({ effectRunId: "run-1", goal: { kind: "test" } })]]);
		candidates.down([
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
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:other",
					status: "failed",
					effectRunId: "run-1",
					error: { kind: "issue", code: "failed", message: "failed" },
				},
			],
		]);

		expect(results).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({ kind: "issue", code: "conflicting-effect-run-result" });
		expect(audit.at(-1)).toMatchObject({ kind: "effect-run-result-conflict" });
	});

	it("rejects EffectRunResult candidates for unknown EffectRuns", () => {
		const g = graph();
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const candidates = g.node<EffectRunResult>([], null, { name: "candidates" });
		const completion = effectRunCompletionProjector(g, {
			effectRuns,
			resultCandidates: [candidates],
		});
		const results: EffectRunResult[] = [];
		const issues: unknown[] = [];
		completion.results.subscribe(
			(msg) => msg[0] === "DATA" && results.push(msg[1] as EffectRunResult),
		);
		completion.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		effectRuns.down([["DATA", effectRun({ effectRunId: "run-1", goal: { kind: "test" } })]]);

		candidates.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "missing-run:result",
					status: "completed",
					effectRunId: "missing-run",
					output: { kind: "ok" },
				},
			],
		]);

		expect(results).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "unknown-effect-run-result-candidate" });
	});
});
