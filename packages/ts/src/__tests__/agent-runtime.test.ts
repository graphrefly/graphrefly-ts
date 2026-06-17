import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	type AgentDecision,
	type AgentDecisionContinue,
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	admitAgentRequestProposal,
	agentRequestLedgerViews,
	agentRequestProposalFromDecision,
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
	structuredAgentDecisionInterpreter,
} from "../orchestration/agent-runtime.js";
import {
	type WorkItemDomainActionAdmission,
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionAdmissionPolicy,
	type WorkItemDomainActionProposal,
	type WorkItemEffectMappingPolicy,
	type WorkItemEffectRequested,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemDomainActionAdmissionProjector,
	workItemDomainActionProposalProjector,
	workItemEffectResultMapper,
	workItemEffectRunProjector,
} from "../orchestration/work-item-runtime.js";

describe("CSP-8 experimental agent runtime kernel (D236)", () => {
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
		expect(catalog.tools.map((tool) => tool.toolName)).toEqual(
			expect.arrayContaining(["file.read", "bash.run", "url.fetch"]),
		);
		expect(profile).toMatchObject({
			kind: "tool",
			acceptedInputKinds: ["tool-call"],
			limits: { timeoutMs: 1000 },
		});
		expect(JSON.stringify(catalog)).not.toMatch(/apiKey|secret|client|transport|subprocess/);

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

	it("projects compact ExecutorOutcome views without inlining raw result payloads", () => {
		const g = graph();
		const outcomes = g.node<ExecutorOutcome>([], null, { name: "outcomes" });
		const projector = executorOutcomeViewProjector(g, {
			outcomes,
			policy: { maxSummaryChars: 18 },
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
					metadata: { providerRawId: "raw-123" },
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

		const latest = views.at(-1) as {
			requestsById: Map<string, AgentRequestIssued>;
			requestsByEffectRun: Map<string, readonly string[]>;
			statusByRequest: Map<string, AgentRequestStatusChanged>;
			pending: readonly AgentRequestIssued[];
			awaitingProvider: readonly AgentRequestIssued[];
		};
		expect(latest.requestsById.get("request-1")).toMatchObject({ operationId: "op-1" });
		expect(latest.requestsByEffectRun.get("run-1")).toEqual(["request-1"]);
		expect(latest.statusByRequest.get("request-1")?.status).toBe("awaiting-provider");
		expect(latest.pending).toHaveLength(1);
		expect(latest.awaitingProvider).toHaveLength(1);
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

	it("emits DataIssue and audit for duplicate WorkItem evidence mapping", () => {
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
		const audit: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
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
		const result: EffectRunResult = {
			kind: "effect-run-result",
			resultId: "run-1:result",
			status: "completed",
			effectRunId: "run-1",
			output: { kind: "ok" },
		};
		results.down([["DATA", result]]);
		results.down([["DATA", result]]);

		expect(evidence).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({ code: "duplicate-work-item-evidence" });
		expect(audit.at(-1)).toMatchObject({ kind: "work-item-evidence-mapping-issue" });
	});

	it("records evidence when WorkItemEffectRequested explicitly references a record mapping policy", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
			now: () => 950,
		});
		const evidence: WorkItemEvidenceRecorded[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe(
			(msg) => msg[0] === "DATA" && evidence.push(msg[1] as WorkItemEvidenceRecorded),
		);
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-record-verification",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
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
					goal: { kind: "verify" },
					policyRefs: [
						{ kind: "work-item-effect-mapping-policy", id: "policy-record-verification" },
					],
				},
			],
		]);
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
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "ok" },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(evidence.at(-1)).toMatchObject({
			workItemId: "wi-1",
			effectRunId: "run-1",
			status: "completed",
			recordedAtMs: 950,
		});
	});

	it("rejects a missing referenced WorkItemEffectMappingPolicy and clears pending effect request", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "other-policy",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
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
					goal: { kind: "verify" },
					policyRefs: [{ kind: "work-item-effect-mapping-policy", id: "missing-policy" }],
				},
			],
		]);
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
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "missing-work-item-effect-mapping-policy" });
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("rejects unsupported WorkItemEffectMappingPolicy behavior without lifecycle side effects", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-close",
					effectKinds: ["verification"],
					evidence: { behavior: "close" },
				} as unknown as WorkItemEffectMappingPolicy,
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
					goal: { kind: "verify" },
					policyRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-close" }],
				},
			],
		]);
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
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "unsupported-work-item-evidence-behavior" });
		expect(statuses.at(-1)).toMatchObject({ state: "mapping-issue" });
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
	});

	it("validates EffectRun policyRefs when raw WorkItemEffectRequested facts are not supplied", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "other-policy",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					sourceRefs: [{ kind: "work-item-effect-request", id: "wi-effect-1" }],
					goal: { kind: "verify" },
					policyRefs: [{ kind: "work-item-effect-mapping-policy", id: "missing-policy" }],
					metadata: { effectKind: "verification" },
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
		expect(issues.at(-1)).toMatchObject({ code: "missing-work-item-effect-mapping-policy" });
	});

	it("rejects ambiguous WorkItemEffectRequested policy joins for duplicate EffectRun ids", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		effectRequests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify" },
				},
			],
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-2",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify-again" },
				},
			],
		]);
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
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "duplicate-work-item-effect-request" }),
		);
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("keeps evidence-only default mapping when a WorkItemEffectRequested has no policyRefs", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "unreferenced-policy",
					effectKinds: ["different-kind"],
					evidence: { behavior: "record" },
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
					goal: { kind: "verify" },
				},
			],
		]);
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
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "ok" },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(evidence).toHaveLength(1);
	});

	it("proposes WorkItem domain actions only from explicit mapping-policy evidence", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			mappingPolicies: [policies],
			now: () => 1000,
		});
		const proposals = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence: mapper.evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
			now: () => 1100,
		});
		const emitted: WorkItemDomainActionProposal[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		mapper.evidence.subscribe(() => {});
		proposals.proposals.subscribe(
			(msg) => msg[0] === "DATA" && emitted.push(msg[1] as WorkItemDomainActionProposal),
		);
		proposals.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		proposals.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		proposals.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose-verification",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
					actionProposals: [
						{
							actionKind: "mark-verification-ready",
							statuses: ["completed"],
							outputKinds: ["verified"],
							payloadFrom: "output",
							reason: "verified output may justify an explicit domain action",
						},
					],
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
					policyRefs: [
						{ kind: "work-item-effect-mapping-policy", id: "policy-propose-verification" },
					],
					metadata: { effectKind: "verification" },
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
					output: { kind: "verified", value: { ok: true } },
					metadata: { effectKind: "verification" },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(emitted.at(-1)).toMatchObject({
			kind: "work-item-domain-action-proposal",
			workItemId: "wi-1",
			actionKind: "mark-verification-ready",
			effectRunId: "run-1",
			effectRunResultId: "run-1:result",
			policyId: "policy-propose-verification",
			payload: { kind: "verified", value: { ok: true } },
			proposedAtMs: 1100,
		});
		expect(emitted.at(-1)?.proposalId).toBe(
			"wi-1:run-1:run-1:result:policy-propose-verification:0:mark-verification-ready",
		);
		expect(emitted.at(-1)?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-item", id: "wi-1" },
				{ kind: "effect-run", id: "run-1" },
				{ kind: "effect-run-result", id: "run-1:result" },
				{ kind: "work-item-effect-mapping-policy", id: "policy-propose-verification" },
			]),
		);
		expect(statuses.at(-1)).toMatchObject({
			state: "domain-action-proposed",
			proposalId: emitted.at(-1)?.proposalId,
		});
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "approved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "verified" }));
		const latestView = views.at(-1) as {
			proposalsByWorkItem: Map<string, readonly WorkItemDomainActionProposal[]>;
			proposalsByEvidence: Map<string, readonly WorkItemDomainActionProposal[]>;
		};
		expect(latestView.proposalsByWorkItem.get("wi-1")).toHaveLength(1);
		expect(latestView.proposalsByEvidence.get("wi-1:run-1:run-1:result")?.[0].actionKind).toBe(
			"mark-verification-ready",
		);
	});

	it("keeps WorkItem domain action proposals disabled without a referenced policy", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "unreferenced-action-policy",
					actionProposals: [{ actionKind: "close-work-item", statuses: ["completed"] }],
				},
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
					sourceRefs: [
						{ kind: "work-item-effect-mapping-policy", id: "unreferenced-action-policy" },
					],
					output: { kind: "verified" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "evidence-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					output: { kind: "verified" },
				},
			],
		]);

		expect(proposals).toEqual([]);
		expect(issues).toEqual([]);
	});

	it("emits DataIssue for stale or missing WorkItem action proposal policy inputs", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "missing-result-evidence",
					workItemId: "wi-1",
					effectRunId: "missing-run",
					effectRunResultId: "missing-run:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose-missing" }],
					output: { kind: "verified" },
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "failed",
					effectRunId: "run-1",
					error: { kind: "issue", code: "failed", message: "failed" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "stale-evidence",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose-missing" }],
					output: { kind: "verified" },
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-2:result",
					status: "completed",
					effectRunId: "run-2",
					output: { kind: "verified" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "missing-policy-evidence",
					workItemId: "wi-1",
					effectRunId: "run-2",
					effectRunResultId: "run-2:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose-missing" }],
					output: { kind: "verified" },
				},
			],
		]);

		expect(proposals).toEqual([]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "missing-work-item-action-proposal-result" }),
				expect.objectContaining({ code: "stale-work-item-action-proposal-result" }),
				expect.objectContaining({ code: "missing-work-item-action-proposal-policy" }),
			]),
		);
	});

	it("emits DataIssue for duplicate WorkItem action proposal evidence ids", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose",
					actionProposals: [{ actionKind: "mark-ready", statuses: ["completed"] }],
				},
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
					output: { kind: "verified" },
				},
			],
		]);
		const firstEvidence: WorkItemEvidenceRecorded = {
			kind: "work-item-evidence-recorded",
			evidenceId: "evidence-1",
			workItemId: "wi-1",
			effectRunId: "run-1",
			effectRunResultId: "run-1:result",
			status: "completed",
			sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose" }],
			output: { kind: "verified" },
		};
		evidence.down([["DATA", firstEvidence]]);
		evidence.down([
			[
				"DATA",
				{
					...firstEvidence,
					output: { kind: "verified", value: { replacement: true } },
				},
			],
		]);

		expect(proposals).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({
			code: "duplicate-work-item-action-proposal-evidence",
		});
	});

	it("emits DataIssue for duplicate WorkItem action proposal result ids", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose",
					actionProposals: [{ actionKind: "mark-ready", statuses: ["completed"] }],
				},
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
					output: { kind: "verified" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "evidence-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose" }],
					output: { kind: "verified" },
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "failed",
					effectRunId: "run-1",
					error: { kind: "issue", code: "failed", message: "replacement" },
				},
			],
		]);

		expect(proposals).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({
			code: "duplicate-work-item-action-proposal-result",
		});
	});

	it("keeps WorkItem action proposal payloads compact and explicit", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: WorkItemDomainActionProposal[] = [];
		projector.proposals.subscribe(
			(msg) => msg[0] === "DATA" && proposals.push(msg[1] as WorkItemDomainActionProposal),
		);
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose",
					actionProposals: [
						{ actionKind: "default-payload" },
						{ actionKind: "result-ref", payloadFrom: "effect-run-result" },
						{ actionKind: "static-payload", payload: { approvedByPolicy: true } },
					],
				},
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
					output: { kind: "verified", value: { ok: true } },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "evidence-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose" }],
					output: { kind: "verified", value: { ok: true } },
				},
			],
		]);

		expect(proposals.find((proposal) => proposal.actionKind === "default-payload")?.payload).toBe(
			undefined,
		);
		expect(proposals.find((proposal) => proposal.actionKind === "result-ref")?.payload).toEqual({
			kind: "effect-run-result-ref",
			resultId: "run-1:result",
		});
		expect(proposals.find((proposal) => proposal.actionKind === "static-payload")?.payload).toEqual(
			{
				approvedByPolicy: true,
			},
		);
	});

	it("does not seed EffectRun for WorkItemEffectRequested targeting unknown WorkItem", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const workItemRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
		const seededRuns: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		workItemRuns.effectRuns.subscribe((msg) => msg[0] === "DATA" && seededRuns.push(msg[1]));
		workItemRuns.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItemRuns.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-other")]]);

		effectRequests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-1",
					workItemId: "wi-missing",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify" },
				},
			],
		]);

		expect(seededRuns).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "unknown-work-item-effect-request" });
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);

		workItems.down([["DATA", workItemSeed("wi-missing")]]);
		expect(seededRuns).toEqual([]);
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("rejects duplicate WorkItemEffectRequested facts that reuse an EffectRun id", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const workItemRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
		const seededRuns: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		workItemRuns.effectRuns.subscribe((msg) => msg[0] === "DATA" && seededRuns.push(msg[1]));
		workItemRuns.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItemRuns.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);

		effectRequests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify" },
				},
			],
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-2",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify-again" },
				},
			],
		]);

		expect(seededRuns).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({ code: "duplicate-work-item-effect-run" });
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("admits WorkItem domain action proposals as a no-op visible ledger", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
			now: () => 1200,
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		const views: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		projector.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		projector.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));

		policies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission-policy",
					policyId: "admit-ready",
					actionKinds: ["mark-ready"],
					allowedOutcomes: ["admit"],
				},
			],
		]);
		proposals.down([["DATA", workItemActionProposal("proposal-1", "mark-ready")]]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision("decision-1", "admission-1", "proposal-1", "admit", {
					policyId: "admit-ready",
					decidedAtMs: 1199,
					sourceRefs: [
						{ kind: "work-item-domain-action-proposal", id: "proposal-1" },
						{ kind: "work-item-domain-action-admission-policy", id: "admit-ready" },
					],
				}),
			],
		]);

		expect(issues).toEqual([]);
		expect(admissions).toEqual([
			expect.objectContaining({
				kind: "work-item-domain-action-admission",
				admissionId: "admission-1",
				proposalId: "proposal-1",
				workItemId: "wi-1",
				actionKind: "mark-ready",
				state: "admitted",
				decisionId: "decision-1",
				policyId: "admit-ready",
				admittedAtMs: 1199,
			}),
		]);
		expect(admissions.at(-1)?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-item-domain-action-proposal", id: "proposal-1" },
				{ kind: "work-item-domain-action-admission-policy", id: "admit-ready" },
				{ kind: "work-item-domain-action-admission-decision", id: "decision-1" },
			]),
		);
		expect(statuses.at(-1)).toMatchObject({
			state: "domain-action-admitted",
			proposalId: "proposal-1",
		});
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "approved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "verified" }));
		expect(Object.keys(projector)).toEqual(["admissions", "status", "issues", "audit", "views"]);
		expect(audit.at(-1)).toMatchObject({ kind: "work-item-domain-action-admitted" });
		const latestView = views.at(-1) as {
			admissionsByProposal: Map<string, WorkItemDomainActionAdmission>;
			admissionsByWorkItem: Map<string, readonly WorkItemDomainActionAdmission[]>;
		};
		expect(latestView.admissionsByProposal.get("proposal-1")?.state).toBe("admitted");
		expect(latestView.admissionsByWorkItem.get("wi-1")?.[0].admissionId).toBe("admission-1");
	});

	it("records rejected, deferred, and merged WorkItem domain action admissions without applying them", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const projector = workItemDomainActionAdmissionProjector(g, { proposals, decisions });
		const admissions: WorkItemDomainActionAdmission[] = [];
		const statuses: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));

		proposals.down([
			["DATA", workItemActionProposal("proposal-reject", "mark-ready")],
			["DATA", workItemActionProposal("proposal-defer", "mark-ready")],
			["DATA", workItemActionProposal("proposal-merge-target", "mark-ready")],
			["DATA", workItemActionProposal("proposal-merge", "mark-ready")],
		]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-reject",
					"admission-reject",
					"proposal-reject",
					"reject",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-defer", "admission-defer", "proposal-defer", "defer"),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-merge-target",
					"admission-merge-target",
					"proposal-merge-target",
					"admit",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-merge", "admission-merge", "proposal-merge", "merge", {
					targetProposalId: "proposal-merge-target",
					sourceRefs: [
						{ kind: "work-item-domain-action-proposal", id: "proposal-merge" },
						{ kind: "work-item-domain-action-proposal", id: "proposal-merge-target" },
					],
				}),
			],
		]);

		expect(admissions.map((admission) => admission.state)).toEqual([
			"rejected",
			"deferred",
			"admitted",
			"merged",
		]);
		expect(admissions.at(-1)).toMatchObject({
			state: "merged",
			targetProposalId: "proposal-merge-target",
		});
		expect(statuses.map((status) => (status as { state: string }).state)).toEqual([
			"domain-action-rejected",
			"domain-action-deferred",
			"domain-action-admitted",
			"domain-action-merged",
		]);
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "approved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "verified" }));
	});

	it("emits DataIssue for duplicate and stale WorkItem admission inputs while preserving first facts", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const issues: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission-policy",
					policyId: "admit-ready",
					actionKinds: ["mark-ready"],
					allowedOutcomes: ["admit"],
				},
			],
		]);

		proposals.down([
			["DATA", workItemActionProposal("proposal-1", "mark-ready")],
			["DATA", workItemActionProposal("proposal-1", "mark-ready")],
			["DATA", workItemActionProposal("proposal-2", "mark-ready")],
			["DATA", workItemActionProposal("proposal-3", "mark-ready")],
			["DATA", workItemActionProposal("proposal-4", "other-action")],
			["DATA", workItemActionProposal("proposal-5", "mark-ready")],
		]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision("decision-ok", "admission-1", "proposal-1", "admit", {
					policyId: "admit-ready",
				}),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-duplicate-admission",
					"admission-1",
					"proposal-2",
					"admit",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-stale", "admission-stale", "proposal-3", "admit", {
					sourceRefs: [{ kind: "work-item-domain-action-proposal", id: "proposal-other" }],
				}),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-missing",
					"admission-missing",
					"proposal-missing",
					"admit",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-policy-mismatch",
					"admission-mismatch",
					"proposal-4",
					"admit",
					{
						policyId: "admit-ready",
					},
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-ok", "admission-5", "proposal-5", "admit", {
					policyId: "admit-ready",
				}),
			],
		]);

		expect(admissions).toHaveLength(1);
		expect(admissions.at(-1)).toMatchObject({
			admissionId: "admission-1",
			proposalId: "proposal-1",
		});
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual(
			expect.arrayContaining([
				"duplicate-work-item-domain-action-proposal",
				"duplicate-work-item-domain-action-admission",
				"duplicate-work-item-domain-action-admission-decision",
				"stale-work-item-domain-action-admission-proposal-ref",
				"missing-work-item-domain-action-admission-proposal",
				"work-item-domain-action-admission-policy-mismatch",
			]),
		);
	});

	it("rejects ambiguous WorkItem admission merge targets and unknown policy refs", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const issues: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		proposals.down([
			["DATA", workItemActionProposal("proposal-1", "mark-ready")],
			["DATA", workItemActionProposal("proposal-2", "mark-ready")],
			["DATA", workItemActionProposal("proposal-3", "mark-ready")],
		]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-missing-policy",
					"admission-missing-policy",
					"proposal-1",
					"admit",
					{
						policyId: "missing-policy",
					},
				),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-stale-policy",
					"admission-stale-policy",
					"proposal-2",
					"admit",
					{
						policyId: "missing-policy",
						sourceRefs: [{ kind: "work-item-domain-action-admission-policy", id: "other-policy" }],
					},
				),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-ambiguous-merge",
					"admission-ambiguous-merge",
					"proposal-3",
					"merge",
					{
						targetProposalId: "proposal-1",
						targetAdmissionId: "admission-1",
					},
				),
			],
		]);

		expect(admissions).toEqual([]);
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual([
			"missing-work-item-domain-action-admission-policy",
			"stale-work-item-domain-action-admission-policy-ref",
			"ambiguous-work-item-domain-action-admission-merge-target",
		]);
	});

	it("replays pending WorkItem admission decisions when proposal, policy, or target admission facts arrive later", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const issues: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision("decision-admit", "admission-admit", "proposal-admit", "admit", {
					policyId: "late-policy",
				}),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-merge", "admission-merge", "proposal-merge", "merge", {
					targetAdmissionId: "admission-admit",
				}),
			],
		]);
		expect(admissions).toEqual([]);
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual(
			expect.arrayContaining(["missing-work-item-domain-action-admission-proposal"]),
		);

		policies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission-policy",
					policyId: "late-policy",
					actionKinds: ["mark-ready"],
					allowedOutcomes: ["admit"],
				},
			],
		]);
		proposals.down([
			["DATA", workItemActionProposal("proposal-merge", "mark-ready")],
			["DATA", workItemActionProposal("proposal-admit", "mark-ready")],
		]);

		expect(admissions.map((admission) => admission.admissionId)).toEqual([
			"admission-admit",
			"admission-merge",
		]);
		expect(admissions.at(-1)).toMatchObject({
			state: "merged",
			targetAdmissionId: "admission-admit",
		});
	});
});

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

function workItemSeed(workItemId: string): WorkItemSeed {
	return {
		kind: "work-item",
		workItemId,
		sourceRefs: [{ kind: "work-item", id: workItemId }],
		workItemKind: "issue",
		lifecycleStatus: "open",
	};
}

function workItemActionProposal(
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

function workItemAdmissionDecision(
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
