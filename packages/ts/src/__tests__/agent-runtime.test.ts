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
	fakeExecutorFailure,
	fakeExecutorResult,
	issueAgentRequest,
	type PromptBundle,
	requestSatisfactionProjector,
	structuredAgentDecisionInterpreter,
} from "../orchestration/agent-runtime.js";

describe("CSP-8 experimental agent runtime kernel (D236)", () => {
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
