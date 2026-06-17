import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
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
	attachToolProviderAdapterRuntime,
	buildToolProviderAdapterInputs,
	buildToolProviderExecutorOutcome,
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
	requestToolProviderAdapterRun,
	resolveToolProviderExecutionPolicies,
	structuredAgentDecisionInterpreter,
	type ToolProviderAdapterBinding,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunResult,
	type ToolProviderAdapterRunStatus,
	type ToolProviderAdapterRuntimeStatus,
	type ToolProviderCatalog,
	type ToolProviderExecutionPolicy,
	type ToolProviderPolicyResolution,
	toolProviderAdapterInputProjector,
	toolProviderPolicyResolutionProjector,
	validateToolProviderExecutionPolicy,
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

	it("scopes D360 tool policy refs and omits stale default policy sections", () => {
		const scopedCatalog = localBuiltinToolProviderCatalog({
			providerId: "scoped",
			tools: [
				{ toolName: "file.read", operation: "read" },
				{ toolName: "bash.run", operation: "run" },
			],
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "scoped:policy:file-read",
					providerId: "scoped",
					toolNames: ["file.read"],
					operations: ["read"],
					sizeCapacity: { limits: [{ unit: "chars", hardLimit: 100 }] },
				},
				{
					kind: "tool-provider-execution-policy",
					policyId: "scoped:policy:bash",
					providerId: "scoped",
					toolNames: ["bash.run"],
					operations: ["run"],
					timeout: { timeoutMs: 1000 },
				},
			],
		});
		expect(scopedCatalog.profiles[0]?.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:file-read" },
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:bash" },
		]);
		expect(scopedCatalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:file-read" },
		]);
		expect(scopedCatalog.tools.find((tool) => tool.toolName === "bash.run")?.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:bash" },
		]);

		const dateOnlyCatalog = localBuiltinToolProviderCatalog({
			providerId: "date-only",
			tools: [{ toolName: "date.now", operation: "read" }],
		});
		expect(dateOnlyCatalog.policies?.[0]?.toolNames).toEqual(["date.now"]);
		expect(dateOnlyCatalog.policies?.[0]?.network).toBeUndefined();
		expect(dateOnlyCatalog.policies?.[0]?.filesystem).toBeUndefined();
		expect(dateOnlyCatalog.policies?.[0]?.approval).toMatchObject({ mode: "auto" });

		const invalidCatalog = localBuiltinToolProviderCatalog({
			providerId: "invalid",
			policyOverrides: { metadata: { apiKey: "do-not-publish" } },
		});
		expect(invalidCatalog.status).toBe("misconfigured");
		expect(invalidCatalog.policies).toEqual([]);
		expect(invalidCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-forbidden-runtime-material" }),
			]),
		);
		expect(JSON.stringify(invalidCatalog)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);
		const malformedCatalog = localBuiltinToolProviderCatalog({
			providerId: "malformed",
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "malformed:policy",
					providerId: "malformed",
					sizeCapacity: { limits: [{ unit: "bytes", softLimit: 2, hardLimit: 1 }] },
				},
			],
		});
		expect(malformedCatalog.status).toBe("misconfigured");
		expect(malformedCatalog.policies).toEqual([]);
		expect(malformedCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-invalid-size-limit" }),
			]),
		);
	});

	it("keeps local builtin catalog caller material data-only and provider-scoped", () => {
		const leakyCatalog = localBuiltinToolProviderCatalog({
			providerId: "leaky",
			metadata: { apiKey: "do-not-publish" },
			capabilities: { client: "do-not-publish" },
			tools: [
				{
					toolName: "file.read",
					operation: "read",
					metadata: { secret: "do-not-publish" },
					capabilities: { transport: "do-not-publish" },
					policyRefs: [{ kind: "foreign-policy", id: "stale" }],
				},
			],
			policyOverrides: {
				providerId: "foreign",
				policyId: "secret-policy-id",
			} as Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">>,
		});
		expect(leakyCatalog.status).toBe("misconfigured");
		expect(leakyCatalog.policies?.[0]).toMatchObject({
			policyId: "leaky:policy:default",
			providerId: "leaky",
		});
		expect(leakyCatalog.tools[0]?.policyRefs).toEqual(leakyCatalog.policyRefs);
		expect(leakyCatalog.metadata).toBeUndefined();
		expect(leakyCatalog.profiles[0]?.capabilities).toEqual({ toolNames: ["file.read"] });
		expect(leakyCatalog.tools[0]?.metadata).toBeUndefined();
		expect(leakyCatalog.tools[0]?.capabilities).toBeUndefined();
		expect(leakyCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-catalog-forbidden-runtime-material",
				}),
			]),
		);
		expect(JSON.stringify(leakyCatalog)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);

		const foreignPolicyCatalog = localBuiltinToolProviderCatalog({
			providerId: "provider-a",
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "foreign-policy",
					providerId: "provider-b",
					timeout: { timeoutMs: 1000 },
				},
			],
		});
		expect(foreignPolicyCatalog.status).toBe("misconfigured");
		expect(foreignPolicyCatalog.policies).toEqual([]);
		expect(foreignPolicyCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-provider-mismatch" }),
			]),
		);
	});

	it("resolves D360 policy material for routed tool-call requests without executing tools", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "resolver" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("tool-req", "tool-op", "file.read", "read");
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "tool-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
		};

		expect(resolveToolProviderExecutionPolicies({ request, catalogs: [catalog] })).toEqual([
			expect.objectContaining({
				kind: "tool-provider-policy-resolution",
				status: "pending-route",
				requestId: "tool-req",
				toolName: "file.read",
			}),
		]);
		expect(
			resolveToolProviderExecutionPolicies({ request, routes: [route], catalogs: [catalog] }),
		).toEqual([
			expect.objectContaining({
				kind: "tool-provider-policy-resolution",
				status: "resolved",
				routeId: "tool-route",
				providerId: "resolver",
				policyRefs: catalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs,
			}),
		]);

		const wrongKindCatalog: ToolProviderCatalog = {
			...catalog,
			tools: catalog.tools.map((tool) =>
				tool.toolName === "file.read"
					? {
							...tool,
							policyRefs: [{ kind: "other-policy", id: catalog.policies?.[0]?.policyId ?? "" }],
						}
					: tool,
			),
		};
		expect(
			resolveToolProviderExecutionPolicies({
				request,
				routes: [route],
				catalogs: [wrongKindCatalog],
			}),
		).toEqual([
			expect.objectContaining({
				status: "invalid-policy",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "tool-provider-policy-invalid-ref-kind" }),
				]),
			}),
		]);
	});

	it("builds ready D360 adapter inputs from routed tool-call policy resolutions", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-req", "adapter-op", "file.read", "read");
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
			allowedParams: { cwd: ".", timeoutMs: 1000 },
		};
		const resolutions = resolveToolProviderExecutionPolicies({
			request,
			routes: [route],
			catalogs: [catalog],
		});

		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions,
		});

		expect(inputs).toEqual([
			expect.objectContaining({
				kind: "tool-provider-adapter-input",
				status: "ready",
				requestId: "adapter-req",
				operationId: "adapter-op",
				routeId: "adapter-route",
				providerId: "adapter",
				executorId: profile.executorId,
				profileId: profile.profileId,
				toolName: "file.read",
				operation: "read",
				toolCall: expect.objectContaining({ kind: "tool-call", toolName: "file.read" }),
				policies: catalog.policies,
				policyRefs: catalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs,
			}),
		]);
		expect(inputs[0]?.input).toBe(request.input);
		expect(inputs[0]?.route).toBe(route);
		expect(inputs[0]?.policies?.[0]).toBe(catalog.policies?.[0]);
		expect(JSON.stringify(inputs)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);
	});

	it("attaches runtime-private tool provider bindings and publishes neutral outcomes", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-provider", "runtime-req");
		const calls: ToolProviderAdapterInput[] = [];
		const binding: ToolProviderAdapterBinding = {
			providerId: "runtime-provider",
			run(input) {
				calls.push(input);
				return {
					kind: "result",
					result: {
						kind: "tool-output",
						value: { ok: true },
						summary: "fake adapter result",
					},
					usage: { latencyMs: 7 },
				};
			},
		};
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [binding],
			now: () => 123,
		});
		const outcomes: ExecutorOutcome[] = [];
		const status: AgentRequestStatusChanged[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.status.subscribe(
			(msg) => msg[0] === "DATA" && status.push(msg[1] as AgentRequestStatusChanged),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", { ...ready, status: "missing-policy" }]]);
		inputs.down([["DATA", ready]]);

		expect(calls).toEqual([ready]);
		expect(status.map((fact) => fact.status)).toEqual(["in-flight", "completed"]);
		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				requestId: "runtime-req",
				operationId: "runtime-req-op",
				routeId: "runtime-req-route",
				executorId: ready.executorId,
				profileId: ready.profileId,
				attempt: 1,
				occurredAtMs: 123,
				usage: { latencyMs: 7 },
				result: expect.objectContaining({ summary: "fake adapter result" }),
			}),
		]);
		expect(issues).toEqual([]);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "tool-provider-adapter-runtime-started" }),
				expect.objectContaining({ kind: "tool-provider-adapter-runtime-finished" }),
			]),
		);
		runtime.dispose();
	});

	it("reports missing tool provider runtime bindings as blocked outcomes", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-missing-inputs" });
		const runtime = attachToolProviderAdapterRuntime(g, { inputs, bindings: [] });
		const ready = readyToolProviderAdapterInput("missing-runtime-provider", "missing-runtime-req");
		const outcomes: ExecutorOutcome[] = [];
		const status: AgentRequestStatusChanged[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.status.subscribe(
			(msg) => msg[0] === "DATA" && status.push(msg[1] as AgentRequestStatusChanged),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "blocked",
				requestId: "missing-runtime-req",
				needs: [expect.objectContaining({ kind: "tool-provider-binding" })],
			}),
		]);
		expect(status.at(-1)).toMatchObject({ status: "blocked" });
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-runtime-missing-binding" }),
			]),
		);
	});

	it("blocks runtime-private material returned by tool provider bindings", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-leak-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-leak-provider", "runtime-leak-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-leak-provider",
					run() {
						return {
							kind: "result",
							result: {
								kind: "tool-output",
								value: { accessToken: "secret-token" },
							},
						};
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "tool-provider-adapter-runtime-forbidden-runtime-material",
				}),
			}),
		]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-forbidden-runtime-material",
				}),
			]),
		);
		expect(JSON.stringify({ outcomes, issues })).not.toMatch(/accessToken|secret-token/i);
	});

	it("blocks non-plain runtime objects returned by tool provider bindings", () => {
		class RuntimeClient {}
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-object-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-object-provider", "runtime-object-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-object-provider",
					run() {
						return {
							kind: "result",
							result: {
								kind: "tool-output",
								value: new RuntimeClient(),
							},
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

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "tool-provider-adapter-runtime-forbidden-runtime-material",
				}),
			}),
		]);
		expect(issues.at(-1)).toMatchObject({
			code: "tool-provider-adapter-runtime-forbidden-runtime-material",
		});
	});

	it("does not expose thrown adapter error messages as graph material", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-throw-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-throw-provider", "runtime-throw-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-throw-provider",
					run() {
						throw new Error("secret-token should stay runtime-private");
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "tool-provider-adapter-runtime-threw" }),
			}),
		]);
		expect(issues).toEqual([
			expect.objectContaining({ code: "tool-provider-adapter-runtime-threw" }),
		]);
		expect(JSON.stringify({ outcomes, issues })).not.toContain("secret-token");
	});

	it("does not expose rejected adapter error messages as graph material", async () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-reject-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-reject-provider", "runtime-reject-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-reject-provider",
					run() {
						return Promise.reject(new Error("provider raw stack secret should not project"));
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);
		await Promise.resolve();

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "tool-provider-adapter-runtime-rejected" }),
			}),
		]);
		expect(issues).toEqual([
			expect.objectContaining({ code: "tool-provider-adapter-runtime-rejected" }),
		]);
		expect(JSON.stringify({ outcomes, issues })).not.toMatch(/provider raw stack secret/i);
	});

	it("does not let a hostile thenable getter strand an execution proof", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-hostile-thenable-inputs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-hostile-thenable-provider",
			"runtime-hostile-thenable-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-hostile-thenable-provider",
					run() {
						const thenKey = ["th", "en"].join("");
						return Object.defineProperty({}, thenKey, {
							get() {
								throw new Error("raw then getter secret");
							},
						}) as PromiseLike<ToolProviderAdapterRunResult>;
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

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "tool-provider-adapter-runtime-rejected" }),
			}),
		]);
		expect(issues).toEqual([
			expect.objectContaining({ code: "tool-provider-adapter-runtime-rejected" }),
		]);
		expect(JSON.stringify({ outcomes, issues })).not.toContain("raw then getter secret");
	});

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
		const attempts: number[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			bindings: [
				{
					providerId: "runtime-run-provider",
					run(_input, ctx) {
						attempts.push(ctx.attempt);
						return {
							kind: "result",
							result: { kind: "tool-output", summary: `attempt ${ctx.attempt}` },
						};
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);

		inputs.down([["DATA", ready]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(ready, {
					runId: "run-shared",
					attempt: 1,
					reason: "initial",
				}),
			],
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

		expect(attempts).toEqual([1, 2]);
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
				expect.objectContaining({ status: "retention-gap", index: "executions" }),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-replay", status: "retention-gap", attempt: 1 }),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-runtime-retention-gap" }),
			]),
		);
	});

	it("rejects same adapterInputId and attempt under a different runId without executing twice", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-coordinate-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-coordinate-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-coordinate-provider",
			"runtime-retention-coordinate-req",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { executions: { maxSize: 2 } },
			bindings: [
				{
					providerId: "runtime-retention-coordinate-provider",
					run(_input, ctx) {
						calls.push(ctx.runId ?? "");
						return { kind: "result", result: { kind: "tool-output" } };
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
			["DATA", requestToolProviderAdapterRun(ready, { runId: "run-once", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "run-twice", attempt: 1 })],
		]);

		expect(calls).toEqual(["run-once"]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-twice", status: "mismatched-request" }),
			]),
		);
		expect(runtimeStatus).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-gap",
					issueCode: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
	});

	it("bounds retention evidence horizon and fails closed after high-water proof is evicted", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-evidence-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-evidence-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-evidence-provider",
			"runtime-retention-evidence-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-evidence-provider",
			"runtime-retention-evidence-req-b",
		);
		const calls: string[] = [];
		const evidenceScorerEntries: unknown[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				executions: { maxSize: 1 },
				retentionEvidence: {
					maxSize: 1,
					score(entry) {
						evidenceScorerEntries.push(entry);
						return entry.adapterInputId === second.adapterInputId ? 10 : 0;
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-evidence-provider",
					run(input, ctx) {
						calls.push(`${input.adapterInputId}:${ctx.attempt}`);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([
			["DATA", first],
			["DATA", second],
		]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(first, { runId: "evidence-first", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(first, { runId: "evidence-first", attempt: 2 })],
			["DATA", requestToolProviderAdapterRun(second, { runId: "evidence-second", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(second, { runId: "evidence-second", attempt: 2 })],
			["DATA", requestToolProviderAdapterRun(first, { runId: "evidence-replay", attempt: 1 })],
		]);
		inputs.down([["DATA", first]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(first, {
					runId: "evidence-replay-after-input-reemit",
					attempt: 1,
				}),
			],
		]);

		expect(calls).toEqual([
			`${first.adapterInputId}:1`,
			`${first.adapterInputId}:2`,
			`${second.adapterInputId}:1`,
			`${second.adapterInputId}:2`,
		]);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-trimmed",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					issueCode: "tool-provider-adapter-runtime-retention-evidence-trimmed",
					metadata: expect.objectContaining({ evidenceKind: "execution-high-water" }),
				}),
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					runId: "evidence-replay",
					issueCode: "tool-provider-adapter-runtime-retention-evidence-gap",
				}),
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					runId: "evidence-replay-after-input-reemit",
					issueCode: "tool-provider-adapter-runtime-retention-evidence-gap",
				}),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "evidence-replay", status: "retention-gap" }),
				expect.objectContaining({
					runId: "evidence-replay-after-input-reemit",
					status: "retention-gap",
				}),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-retention-evidence-gap",
					subjectId: first.adapterInputId,
				}),
			]),
		);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					issueCode: "tool-provider-adapter-runtime-retention-evidence-gap",
				}),
			]),
		);
		expect(JSON.stringify(evidenceScorerEntries)).not.toMatch(/tool-output|arguments|raw/i);
		expect(evidenceScorerEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: expect.any(String),
					sequence: expect.any(Number),
					adapterInputId: first.adapterInputId,
					evidenceKind: "execution-high-water",
					attemptHighWater: expect.any(Number),
					reason: "execution-proof-retention",
				}),
			]),
		);
	});

	it("uses score-based retention over bounded public run request entries", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-score-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-score-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-score-provider",
			"runtime-retention-score-req",
		);
		const scorerEntries: unknown[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				runRequests: {
					maxSize: 1,
					score(entry) {
						scorerEntries.push(entry);
						return entry.runId === "keep-run" ? 10 : 0;
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-score-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([["DATA", ready]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(ready, {
					runId: "drop-run",
					attempt: 1,
					metadata: { rawResponse: "RAW_SHOULD_NOT_REACH_SCORER" },
				}),
			],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "keep-run", attempt: 2 })],
		]);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "runRequests" }),
			]),
		);
		expect(JSON.stringify(scorerEntries)).not.toMatch(/rawResponse|RAW_SHOULD_NOT_REACH_SCORER/);
		expect(scorerEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: expect.any(String),
					sequence: expect.any(Number),
					runId: "drop-run",
					adapterInputId: ready.adapterInputId,
					attempt: 1,
					requestId: ready.requestId,
					operationId: ready.operationId,
				}),
			]),
		);
	});

	it("makes Node-valued retention maxSize describe-visible and downsizing trims", () => {
		const g = graph();
		const maxSize = g.state(2, { name: "retentionMax" });
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-node-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-node-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-node-provider",
			"runtime-retention-node-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			name: "runtimeRetentionNode",
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { executions: { maxSize } },
			bindings: [
				{
					providerId: "runtime-retention-node-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		const described = g.describe();
		expect(
			described.nodes.find((node) => node.id === "runtimeRetentionNode/retentionPolicy")?.factory,
		).toBe("toolProviderAdapterRuntimeRetentionPolicy");
		expect(described.edges).toContainEqual({
			from: "retentionMax",
			to: "runtimeRetentionNode/retentionPolicy",
		});

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "node-run", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "node-run", attempt: 2 })],
		]);
		maxSize.set(1);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "executions" }),
			]),
		);
	});

	it("keeps last-known-good retention policy for invalid maxSize/order/scorer without leaking throws", () => {
		const g = graph();
		const maxSize = g.state(2, { name: "invalidRetentionMax" });
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-invalid-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-invalid-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-invalid-provider",
			"runtime-retention-invalid-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				executions: { maxSize },
				runStatuses: { maxSize: 1 },
				runRequests: {
					maxSize: 1,
					score() {
						throw new Error("secret-score-throw");
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-invalid-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "invalid-run", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "invalid-run", attempt: 2 })],
		]);
		maxSize.set(0);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "invalid-run", attempt: 3 })],
		]);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "invalid-retention-policy" }),
				expect.objectContaining({ status: "retention-trimmed", index: "runStatuses" }),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-invalid-retention-policy",
				}),
				expect.objectContaining({
					code: "tool-provider-adapter-retention-score-invalid",
				}),
			]),
		);
		expect(JSON.stringify({ runtimeStatus, issues, audit })).not.toContain("secret-score-throw");

		const orderGraph = graph();
		const orderInputs = orderGraph.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-order-inputs",
		});
		const orderRuntime = attachToolProviderAdapterRuntime(orderGraph, {
			inputs: orderInputs,
			autoRunReadyInputs: false,
			retention: { runStatuses: { maxSize: 1, order: "lifo" as "fifo" } },
			bindings: [],
		});
		const orderIssues: DataIssue[] = [];
		orderRuntime.issues.subscribe(
			(msg) => msg[0] === "DATA" && orderIssues.push(msg[1] as DataIssue),
		);
		expect(orderIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-invalid-retention-policy",
				}),
			]),
		);
	});

	it("does not recursively feed runIssues when its retention scorer is invalid", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-run-issues-score-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-run-issues-score-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-run-issues-score-provider",
			"runtime-retention-run-issues-score-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				runIssues: {
					maxSize: 1,
					score() {
						throw new Error("recursive-score-secret");
					},
				},
			},
			bindings: [],
		});
		const issues: DataIssue[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([["DATA", ready]]);
		expect(() =>
			runRequests.down([
				[
					"DATA",
					{
						...requestToolProviderAdapterRun(ready, { runId: "run-issues-score-invalid" }),
						requestId: "stale-request",
					},
				],
			]),
		).not.toThrow();

		expect(
			issues.filter((issue) => issue.code === "tool-provider-adapter-retention-score-invalid"),
		).toHaveLength(1);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "invalid-retention-policy",
					index: "runIssues",
					issueCode: "tool-provider-adapter-retention-score-invalid",
				}),
			]),
		);
		expect(JSON.stringify({ issues, runtimeStatus })).not.toContain("recursive-score-secret");
	});

	it("gaps explicit run requests after adapterInputs retention trims the input cache", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-input-cache-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-input-cache-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-input-cache-provider",
			"runtime-retention-input-cache-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-input-cache-provider",
			"runtime-retention-input-cache-req-b",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { adapterInputs: { maxSize: 1 } },
			bindings: [
				{
					providerId: "runtime-retention-input-cache-provider",
					run(input) {
						calls.push(input.adapterInputId);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([
			["DATA", first],
			["DATA", second],
		]);
		runRequests.down([["DATA", requestToolProviderAdapterRun(first, { runId: "trimmed-input" })]]);

		expect(calls).toEqual([]);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "adapterInputs" }),
				expect.objectContaining({ status: "retention-gap", index: "adapterInputs" }),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-gap" })]),
		);
	});

	it("refreshes FIFO retention order when an adapter input is re-emitted", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-refresh-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-refresh-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-refresh-provider",
			"runtime-retention-refresh-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-refresh-provider",
			"runtime-retention-refresh-req-b",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { adapterInputs: { maxSize: 1 } },
			bindings: [
				{
					providerId: "runtime-retention-refresh-provider",
					run(input) {
						calls.push(input.adapterInputId);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);

		inputs.down([
			["DATA", first],
			["DATA", second],
			["DATA", first],
		]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(first, { runId: "refreshed-first" })],
			["DATA", requestToolProviderAdapterRun(second, { runId: "trimmed-second" })],
		]);

		expect(calls).toEqual([first.adapterInputId]);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "refreshed-first", status: "started" }),
				expect.objectContaining({ runId: "trimmed-second", status: "retention-gap" }),
			]),
		);
	});

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
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { runRequests: { maxSize: 1 } },
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
		runtime.runRequests.subscribe(
			(msg) => msg[0] === "DATA" && emittedRequests.push(msg[1] as ToolProviderAdapterRunRequested),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "request-key-a", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "request-key-b", attempt: 2 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "request-key-a", attempt: 1 })],
		]);

		expect(emittedRequests.filter((request) => request.runId === "request-key-a")).toHaveLength(2);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "runRequests" }),
			]),
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
		]);

		expect(calls).toEqual([]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-run-request-stale-request" }),
				expect.objectContaining({ code: "tool-provider-adapter-run-request-missing-input" }),
				expect.objectContaining({ code: "tool-provider-adapter-run-request-invalid-shape" }),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "mismatched-request" }),
				expect.objectContaining({ status: "missing-input" }),
			]),
		);
		expect(protocolErrors).toEqual([]);
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

	it("projects adapter inputs, issues, and audit without executing real tool providers", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requests" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const catalogs = g.node<ToolProviderCatalog>([], null, { name: "catalogs" });
		const resolutions = toolProviderPolicyResolutionProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
		});
		const adapterInputs = toolProviderAdapterInputProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
			policyResolutions: [resolutions.resolutions],
		});
		const inputs: ToolProviderAdapterInput[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		const protocolErrors: unknown[] = [];
		adapterInputs.inputs.subscribe((msg) => {
			if (msg[0] === "DATA") inputs.push(msg[1] as ToolProviderAdapterInput);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		adapterInputs.issues.subscribe((msg) => {
			if (msg[0] === "DATA") issues.push(msg[1]);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		adapterInputs.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter-projector" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-proj-req", "adapter-proj-op", "file.read", "read");

		requestFacts.down([["DATA", request]]);
		catalogs.down([["DATA", catalog]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "adapter-proj-route",
					requestId: "adapter-proj-req",
					operationId: "adapter-proj-op",
					executorId: profile.executorId,
					profileId: profile.profileId,
					inputKind: "tool-call",
				},
			],
		]);

		expect(inputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "ready",
					requestId: "adapter-proj-req",
					routeId: "adapter-proj-route",
					providerId: "adapter-projector",
					toolName: "file.read",
					policies: catalog.policies,
				}),
			]),
		);
		expect(audit.at(-1)).toMatchObject({
			kind: "tool-provider-adapter-input",
			subjectId: "adapter-proj-req",
		});
		expect(protocolErrors).toEqual([]);
		expect(JSON.stringify({ inputs, issues, audit })).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);

		const bareCatalog: ToolProviderCatalog = {
			kind: "tool-provider-catalog",
			providerId: "adapter-bare",
			providerKind: "local-builtin",
			status: "ready",
			profiles: [
				{
					profileId: "adapter-bare-profile",
					executorId: "adapter-bare-exec",
					kind: "tool",
					acceptedInputKinds: ["tool-call"],
				},
			],
			tools: [
				{
					kind: "tool-catalog-entry",
					providerId: "adapter-bare",
					toolName: "file.read",
					operation: "read",
					inputKind: "tool-call",
					profileId: "adapter-bare-profile",
					executorId: "adapter-bare-exec",
				},
			],
			policies: [],
			policyRefs: [],
		};
		const missingPolicyRequest = toolRequest(
			"adapter-issue-req",
			"adapter-issue-op",
			"file.read",
			"read",
		);
		requestFacts.down([["DATA", missingPolicyRequest]]);
		catalogs.down([["DATA", bareCatalog]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "adapter-issue-route",
					requestId: "adapter-issue-req",
					operationId: "adapter-issue-op",
					executorId: "adapter-bare-exec",
					profileId: "adapter-bare-profile",
					inputKind: "tool-call",
				},
			],
		]);

		expect(inputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "missing-policy",
					requestId: "adapter-issue-req",
					routeId: "adapter-issue-route",
					input: undefined,
					toolCall: undefined,
					policies: undefined,
				}),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-missing-policy-ref" }),
			]),
		);
		expect(protocolErrors).toEqual([]);
	});

	it("blocks runtime-private keys from adapter inputs as DataIssue material", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter-scan" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request: AgentRequestIssued = {
			...toolRequest("adapter-scan-req", "adapter-scan-op", "file.read", "read"),
			input: {
				inputId: "adapter-scan-input",
				inputKind: "tool-call",
				dataMode: "inline",
				value: {
					kind: "tool-call",
					toolName: "file.read",
					operation: "read",
					arguments: { path: "README.md", accessToken: "do-not-project" },
				},
			},
		};
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-scan-route",
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
		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions,
		});

		expect(inputs[0]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			toolCall: undefined,
			route: undefined,
			tool: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-forbidden-runtime-material",
				}),
			]),
		});
		expect(JSON.stringify(inputs)).not.toMatch(/do-not-project/);
	});

	it("rejects stale adapter-input route identities and unavailable catalogs", () => {
		const readyCatalog = localBuiltinToolProviderCatalog({ providerId: "adapter-stale" });
		const profile = readyCatalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-stale-req", "adapter-stale-op", "file.read", "read");
		const staleRoute: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-stale-route",
			requestId: request.requestId,
			operationId: "other-op",
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
		};
		const forgedResolution: ToolProviderPolicyResolution = {
			kind: "tool-provider-policy-resolution",
			resolutionId: "adapter-stale-resolution",
			status: "resolved",
			requestId: request.requestId,
			operationId: request.operationId,
			routeId: staleRoute.routeId,
			providerId: readyCatalog.providerId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			toolName: "file.read",
			operation: "read",
			policyRefs: readyCatalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs,
		};
		const staleInputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [staleRoute],
			catalogs: [readyCatalog],
			resolutions: [forgedResolution],
		});

		expect(staleInputs[0]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			route: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-stale-route-operation",
				}),
			]),
		});

		const unavailableCatalog: ToolProviderCatalog = {
			...readyCatalog,
			status: "unavailable",
			issues: [
				{
					kind: "issue",
					code: "provider-down",
					message: "Provider is unavailable",
					severity: "error",
					details: { password: "do-not-project" },
				},
			],
		};
		const route: ExecutorRoute = {
			...staleRoute,
			operationId: request.operationId,
		};
		const unavailableInputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [unavailableCatalog],
			resolutions: [{ ...forgedResolution, resolutionId: "adapter-unavailable-resolution" }],
		});

		expect(unavailableInputs[0]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-catalog-unavailable",
				}),
				expect.objectContaining({
					code: "provider-down",
					details: { redacted: true, reason: "forbidden-runtime-material" },
				}),
			]),
		});
		expect(JSON.stringify(unavailableInputs)).not.toMatch(/do-not-project/);
	});

	it("does not trust resolved adapter-input resolutions without D360 policy material", () => {
		const request = toolRequest("adapter-forged-req", "adapter-forged-op", "file.read", "read");
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-forged-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: "adapter-forged-exec",
			profileId: "adapter-forged-profile",
			inputKind: "tool-call",
		};
		const catalog: ToolProviderCatalog = {
			kind: "tool-provider-catalog",
			providerId: "adapter-forged",
			providerKind: "local-builtin",
			status: "ready",
			profiles: [
				{
					profileId: "adapter-forged-profile",
					executorId: "adapter-forged-exec",
					kind: "tool",
					acceptedInputKinds: ["tool-call"],
				},
			],
			tools: [
				{
					kind: "tool-catalog-entry",
					providerId: "adapter-forged",
					toolName: "file.read",
					operation: "read",
					inputKind: "tool-call",
					profileId: "adapter-forged-profile",
					executorId: "adapter-forged-exec",
				},
			],
			policies: [],
		};
		const forgedResolved: ToolProviderPolicyResolution = {
			kind: "tool-provider-policy-resolution",
			resolutionId: "adapter-forged-resolution",
			status: "resolved",
			requestId: request.requestId,
			operationId: request.operationId,
			routeId: route.routeId,
			providerId: catalog.providerId,
			executorId: route.executorId,
			profileId: route.profileId,
			toolName: "file.read",
			operation: "read",
			policyRefs: [],
		};
		const missingMaterial: ToolProviderPolicyResolution = {
			...forgedResolved,
			resolutionId: "adapter-forged-missing-material",
			policyRefs: [{ kind: "tool-provider-execution-policy", id: "missing" }],
		};

		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions: [forgedResolved, missingMaterial],
		});

		expect(inputs[0]).toMatchObject({
			status: "missing-policy",
			input: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-input-missing-policy-ref" }),
			]),
		});
		expect(inputs[1]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-policy-ref-missing-material",
				}),
			]),
		});
	});

	it("sanitizes incoming resolution issues before adapter-input projection", () => {
		const request = toolRequest(
			"adapter-issue-sanitize-req",
			"adapter-issue-sanitize-op",
			"file.read",
			"read",
		);
		const resolution: ToolProviderPolicyResolution = {
			kind: "tool-provider-policy-resolution",
			resolutionId: "adapter-issue-sanitize-resolution",
			status: "invalid-policy",
			requestId: request.requestId,
			operationId: request.operationId,
			issues: [
				{
					kind: "issue",
					code: "raw-provider-issue",
					message: "Provider issue",
					severity: "error",
					details: { authorization: "do-not-project" },
				},
			],
		};

		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			resolutions: [resolution],
		});

		expect(inputs[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "raw-provider-issue",
					details: { redacted: true, reason: "forbidden-runtime-material" },
				}),
			]),
		);
		expect(JSON.stringify(inputs)).not.toMatch(/do-not-project/);
	});

	it("emits updated adapter input material when same policy refs change", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requests" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const catalogs = g.node<ToolProviderCatalog>([], null, { name: "catalogs" });
		const resolutions = toolProviderPolicyResolutionProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
		});
		const adapterInputs = toolProviderAdapterInputProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
			policyResolutions: [resolutions.resolutions],
		});
		const inputs: ToolProviderAdapterInput[] = [];
		adapterInputs.inputs.subscribe(
			(msg) => msg[0] === "DATA" && inputs.push(msg[1] as ToolProviderAdapterInput),
		);
		const catalogV1 = localBuiltinToolProviderCatalog({
			providerId: "adapter-revision",
			policyOverrides: { timeout: { timeoutMs: 1000 } },
		});
		const profile = catalogV1.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-revision-req", "adapter-revision-op", "file.read", "read");

		requestFacts.down([["DATA", request]]);
		catalogs.down([["DATA", catalogV1]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "adapter-revision-route",
					requestId: request.requestId,
					operationId: request.operationId,
					executorId: profile.executorId,
					profileId: profile.profileId,
					inputKind: "tool-call",
				},
			],
		]);
		const catalogV2 = localBuiltinToolProviderCatalog({
			providerId: "adapter-revision",
			policyOverrides: { timeout: { timeoutMs: 2000 } },
		});
		catalogs.down([["DATA", catalogV2]]);

		expect(
			inputs
				.filter((input) => input.status === "ready" && input.requestId === "adapter-revision-req")
				.map((input) => input.policies?.[0]?.timeout?.timeoutMs),
		).toEqual([1000, 2000]);
	});

	it("scrubs returned refs before marking adapter input ready", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter-route-scan" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest(
			"adapter-route-scan-req",
			"adapter-route-scan-op",
			"file.read",
			"read",
		);
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-route-scan-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
			evidenceRefs: [{ kind: "runtime", id: "route", metadata: { client: "do-not-project" } }],
		};
		const resolutions = resolveToolProviderExecutionPolicies({
			request,
			routes: [route],
			catalogs: [catalog],
		}).map((resolution) => ({
			...resolution,
			sourceRefs: [
				...(resolution.sourceRefs ?? []),
				{ kind: "runtime", id: "resolution", metadata: { oauth: "do-not-project" } },
			],
			policyRefs: (resolution.policyRefs ?? []).map((policyRef) => ({
				...policyRef,
				metadata: { secret: "do-not-project" },
			})),
		}));
		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions,
		});

		expect(inputs[0]).toMatchObject({
			status: "invalid-policy",
			route: undefined,
			input: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-forbidden-runtime-material",
				}),
			]),
		});
		expect(JSON.stringify(inputs)).not.toMatch(/do-not-project/);
	});

	it("validates malformed D360 tool provider policies as DataIssue facts", () => {
		const issues = validateToolProviderExecutionPolicy({
			kind: "tool-provider-execution-policy",
			policyId: "",
			providerId: "",
			sizeCapacity: {
				limits: [{ unit: "bytes", softLimit: 20, hardLimit: 10 }, { softLimit: Number.NaN }],
			},
			timeout: { timeoutMs: -1, idleTimeoutMs: Number.POSITIVE_INFINITY },
			metadata: { apiKey: "do-not-store" },
		});
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-policy-id",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-provider-id",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-invalid-size-limit",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-invalid-timeout",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-forbidden-runtime-material",
				}),
			]),
		);
		expect(issues.every((issue) => issue.kind === "issue")).toBe(true);

		expect(
			validateToolProviderExecutionPolicy({
				kind: "tool-provider-execution-policy",
				policyId: "policy-empty",
				providerId: "local",
			}),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-material",
				}),
			]),
		);
		expect(validateToolProviderExecutionPolicy({ sizeCapacity: {} })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-invalid-kind" }),
				expect.objectContaining({ code: "tool-provider-policy-missing-policy-id" }),
				expect.objectContaining({ code: "tool-provider-policy-missing-provider-id" }),
				expect.objectContaining({ code: "tool-provider-policy-invalid-size-capacity" }),
			]),
		);
		expect(
			validateToolProviderExecutionPolicy({
				kind: "tool-provider-execution-policy",
				policyId: "bad-timeout",
				providerId: "local",
				timeout: { timeoutMs: "fast" },
			}),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-invalid-timeout" }),
			]),
		);
		expect(validateToolProviderExecutionPolicy(null)).toEqual([
			expect.objectContaining({
				kind: "issue",
				code: "tool-provider-policy-invalid-shape",
			}),
		]);
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
