import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

export interface SourceRef {
	readonly kind: string;
	readonly id: string;
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestInput<T = unknown> {
	readonly inputId: string;
	readonly inputKind: string;
	readonly dataMode?: "ref" | "summary" | "inline";
	readonly ref?: string;
	readonly summary?: string;
	readonly value?: T;
	readonly schemaRef?: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface EffectRunGoal<TInput = unknown> {
	readonly kind: string;
	readonly summary?: string;
	readonly detailRef?: string;
	readonly input?: AgentRequestInput<TInput>;
	readonly metadata?: Record<string, unknown>;
}

export interface EffectRunLimits {
	readonly maxSteps?: number;
	readonly maxRequests?: number;
	readonly maxAttemptsPerOperation?: number;
	readonly maxPendingRequests?: number;
	readonly maxCostUsd?: number;
	readonly timeoutMs?: number;
}

export interface EffectRun<TInput = unknown> {
	readonly kind: "effect-run";
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly goal: EffectRunGoal<TInput>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly limits?: EffectRunLimits;
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface EffectRunOptions<TInput = unknown> {
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly goal: EffectRunGoal<TInput>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly limits?: EffectRunLimits;
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export function effectRun<TInput = unknown>(opts: EffectRunOptions<TInput>): EffectRun<TInput> {
	return {
		kind: "effect-run",
		effectRunId: opts.effectRunId,
		agentRunId: opts.agentRunId,
		subjectRefs: opts.subjectRefs,
		goal: opts.goal,
		sourceRefs: opts.sourceRefs,
		policyRefs: opts.policyRefs,
		limits: opts.limits,
		createdBy: opts.createdBy,
		createdAtMs: opts.createdAtMs,
		metadata: opts.metadata,
	};
}

export type AgentRequestKind = "context" | "prompt" | "executor";

export interface AgentRequestProposal<TPayload = unknown> {
	readonly kind: "proposal";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly parentRequestId?: string;
	readonly sourceDecisionId?: string;
	readonly requestKind: AgentRequestKind;
	readonly required?: boolean;
	readonly subjectId?: string;
	readonly input?: AgentRequestInput<TPayload>;
	readonly payload?: TPayload;
	readonly reason?: string;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestAdmitted {
	readonly kind: "admitted";
	readonly proposalId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly admittedAtMs?: number;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestRejected {
	readonly kind: "rejected";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly issue: DataIssue;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestDeferred {
	readonly kind: "deferred";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly reason?: string;
	readonly untilRef?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestMerged {
	readonly kind: "merged";
	readonly proposalId: string;
	readonly effectRunId: string;
	readonly targetRequestId: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestIssued<TPayload = unknown> {
	readonly kind: "issued";
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly agentRunId?: string;
	readonly proposalId?: string;
	readonly parentRequestId?: string;
	readonly requestKind: AgentRequestKind;
	readonly required: boolean;
	readonly input?: AgentRequestInput<TPayload>;
	readonly payload?: TPayload;
	readonly issuedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type AgentRequestStatus =
	| "proposed"
	| "admitted"
	| "rejected"
	| "deferred"
	| "merged"
	| "issued"
	| "awaiting-context"
	| "awaiting-prompt"
	| "awaiting-route"
	| "awaiting-provider"
	| "in-flight"
	| "completed"
	| "failed"
	| "blocked"
	| "canceled"
	| "timeout"
	| "waived"
	| "retry-exhausted";

export interface AgentRequestStatusChanged {
	readonly kind: "status";
	readonly requestId: string;
	readonly operationId?: string;
	readonly effectRunId: string;
	readonly status: AgentRequestStatus;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export type AgentRequestFact<TPayload = unknown> =
	| AgentRequestProposal<TPayload>
	| AgentRequestAdmitted
	| AgentRequestRejected
	| AgentRequestDeferred
	| AgentRequestMerged
	| AgentRequestIssued<TPayload>
	| AgentRequestStatusChanged;

export interface AgentRequestViews {
	readonly requestsById: ReadonlyMap<string, AgentRequestIssued>;
	readonly requestsByEffectRun: ReadonlyMap<string, readonly string[]>;
	readonly statusByRequest: ReadonlyMap<string, AgentRequestStatusChanged>;
	readonly pending: readonly AgentRequestIssued[];
	readonly awaitingProvider: readonly AgentRequestIssued[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface AgentRequestLedgerBundle {
	readonly views: Node<AgentRequestViews>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface ExecutorProfile {
	readonly profileId: string;
	readonly executorId: string;
	readonly kind: "llm" | "tool" | "human" | "agent";
	readonly acceptedInputKinds?: readonly string[];
	readonly acceptedSchemaRefs?: readonly string[];
	readonly acceptedResultKinds?: readonly string[];
	readonly capabilities?: Record<string, unknown>;
	readonly limits?: Record<string, number>;
	readonly metadata?: Record<string, unknown>;
}

export interface ExecutorRoute {
	readonly kind: "executor-route";
	readonly routeId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly inputId?: string;
	readonly inputKind?: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly allowedParams?: Record<string, unknown>;
	readonly reason?: string;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type ExecutorOutcomeStatus = "result" | "failure" | "canceled" | "timeout" | "blocked";

export interface ExecutorUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheHitTokens?: number;
	readonly cacheMissTokens?: number;
	readonly cacheWriteTokens?: number;
	readonly cacheMode?: string;
	readonly costUsd?: number;
	readonly latencyMs?: number;
}

export interface ExecutorOutcomeBase {
	readonly kind: ExecutorOutcomeStatus;
	readonly outcomeId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly attempt: number;
	readonly inputId?: string;
	readonly inputKind?: string;
	readonly occurredAtMs?: number;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly usage?: ExecutorUsage;
	readonly metadata?: Record<string, unknown>;
}

export interface AgentOutputEnvelope<T = unknown> {
	readonly kind: string;
	readonly value?: T;
	readonly refs?: readonly SourceRef[];
	readonly summary?: string;
	readonly metadata?: Record<string, unknown>;
}

export type ExecutorOutcome<T = unknown> =
	| (ExecutorOutcomeBase & { readonly kind: "result"; readonly result: AgentOutputEnvelope<T> })
	| (ExecutorOutcomeBase & {
			readonly kind: "failure";
			readonly error: DataIssue;
			readonly retryable?: boolean;
	  })
	| (ExecutorOutcomeBase & { readonly kind: "canceled"; readonly reason?: string })
	| (ExecutorOutcomeBase & {
			readonly kind: "timeout";
			readonly timeoutMs?: number;
			readonly retryable?: boolean;
	  })
	| (ExecutorOutcomeBase & {
			readonly kind: "blocked";
			readonly needs: readonly AgentNeed[];
	  });

export interface ContextContribution {
	readonly kind: "context-contribution";
	readonly contributionId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly status: "ready" | "pending" | "issue";
	readonly frameId?: string;
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface PromptBundle {
	readonly kind: "prompt-bundle";
	readonly promptId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly status: "ready" | "partial" | "issue";
	readonly sourceFrameIds?: readonly string[];
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentRequestSatisfactionBundle {
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type AgentDecisionKind = "continue" | "final" | "blocked";

export interface AgentNeed {
	readonly kind: string;
	readonly message?: string;
	readonly refs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentDecisionBase {
	readonly kind: AgentDecisionKind;
	readonly decisionId: string;
	readonly effectRunId: string;
	readonly agentRunId: string;
	readonly source: {
		readonly requestId: string;
		readonly operationId: string;
		readonly outcomeId: string;
	};
	readonly reason?: string;
	readonly confidence?: number;
	readonly evidenceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgentDecisionContinue extends AgentDecisionBase {
	readonly kind: "continue";
	readonly next: readonly AgentRequestProposal[];
}

export interface AgentDecisionFinal extends AgentDecisionBase {
	readonly kind: "final";
	readonly output: AgentOutputEnvelope;
	readonly summary?: string;
}

export interface AgentDecisionBlocked extends AgentDecisionBase {
	readonly kind: "blocked";
	readonly needs: readonly AgentNeed[];
}

export type AgentDecision = AgentDecisionContinue | AgentDecisionFinal | AgentDecisionBlocked;

export interface StructuredAgentDecisionEnvelope {
	readonly kind: "agent-decision";
	readonly decision: AgentDecision;
	readonly schemaRef: string;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface StructuredAgentDecisionInterpreterBundle {
	readonly decisions: Node<AgentDecision>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type EffectRunResultStatus =
	| "completed"
	| "failed"
	| "blocked"
	| "canceled"
	| "timeout"
	| "waived";

export interface EffectRunResultBase {
	readonly kind: "effect-run-result";
	readonly resultId: string;
	readonly status: EffectRunResultStatus;
	readonly effectRunId: string;
	readonly subjectRefs?: readonly SourceRef[];
	readonly operationId?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly auditRefs?: readonly string[];
	readonly completedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type EffectRunResult =
	| (EffectRunResultBase & { readonly status: "completed"; readonly output: AgentOutputEnvelope })
	| (EffectRunResultBase & { readonly status: "failed"; readonly error: DataIssue })
	| (EffectRunResultBase & { readonly status: "blocked"; readonly needs: readonly AgentNeed[] })
	| (EffectRunResultBase & { readonly status: "canceled"; readonly reason?: string })
	| (EffectRunResultBase & { readonly status: "timeout"; readonly timeoutMs?: number })
	| (EffectRunResultBase & { readonly status: "waived"; readonly reason?: string });

export interface EffectRunCompletionBundle {
	readonly results: Node<EffectRunResult>;
	readonly status: Node<EffectRunCompletionStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface EffectRunCompletionStatus {
	readonly effectRunId: string;
	readonly state:
		| "pending"
		| "completed"
		| "failed"
		| "blocked"
		| "canceled"
		| "timeout"
		| "waived";
	readonly requiredPending: readonly string[];
	readonly requiredTerminal: readonly string[];
	readonly sourceRefs?: readonly SourceRef[];
}

export interface AgentRuntimeAuditRecord {
	readonly id: string;
	readonly kind: string;
	readonly subjectId?: string;
	readonly message?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issueCode?: string;
	readonly metadata?: Record<string, unknown>;
}

interface RequestSatisfactionState {
	requests: Map<string, AgentRequestIssued>;
	profiles: Map<string, ExecutorProfile>;
	routes: Map<string, ExecutorRoute>;
	outcomes: Map<string, ExecutorOutcome>;
	contexts: Map<string, ContextContribution>;
	prompts: Map<string, PromptBundle>;
	compatibleRoutesByRouteId: Map<string, ExecutorRoute>;
	terminalRequests: Set<string>;
	acceptedTerminalFactIds: Set<string>;
	issueKeys: Set<string>;
	statusKeys: Set<string>;
	issueSeq: number;
	auditSeq: number;
}

export function agentRequestProposalFromDecision(
	decision: AgentDecisionContinue,
	proposal: Omit<AgentRequestProposal, "kind" | "effectRunId" | "agentRunId" | "sourceDecisionId">,
): AgentRequestProposal {
	return {
		kind: "proposal",
		...proposal,
		effectRunId: decision.effectRunId,
		agentRunId: decision.agentRunId,
		sourceDecisionId: decision.decisionId,
		evidenceRefs: proposal.evidenceRefs ?? decision.evidenceRefs,
	};
}

export function admitAgentRequestProposal(
	proposal: AgentRequestProposal,
	opts: {
		readonly requestId: string;
		readonly operationId: string;
		readonly admittedAtMs?: number;
		readonly reason?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	},
): AgentRequestAdmitted {
	return {
		kind: "admitted",
		proposalId: proposal.proposalId,
		requestId: opts.requestId,
		operationId: opts.operationId,
		effectRunId: proposal.effectRunId,
		agentRunId: proposal.agentRunId,
		admittedAtMs: opts.admittedAtMs,
		reason: opts.reason,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function issueAgentRequest(
	proposal: AgentRequestProposal,
	admission: AgentRequestAdmitted,
	opts: { readonly issuedAtMs?: number; readonly sourceRefs?: readonly SourceRef[] } = {},
): AgentRequestIssued {
	return {
		kind: "issued",
		requestId: admission.requestId,
		operationId: admission.operationId,
		effectRunId: admission.effectRunId,
		agentRunId: admission.agentRunId,
		proposalId: proposal.proposalId,
		parentRequestId: proposal.parentRequestId,
		requestKind: proposal.requestKind,
		required: proposal.required ?? true,
		input: proposal.input,
		payload: proposal.payload,
		issuedAtMs: opts.issuedAtMs,
		sourceRefs: opts.sourceRefs ?? admission.sourceRefs,
		metadata: proposal.metadata,
	};
}

export function agentRequestLedgerViews(
	graph: Graph,
	facts: Node<AgentRequestFact>,
	opts: { readonly name?: string } = {},
): AgentRequestLedgerBundle {
	const name = opts.name ?? "agentRequests";
	const views = graph.node<AgentRequestViews>(
		[facts],
		(ctx) => {
			const prev = ctx.state.get<AgentRequestViewsState>() ?? emptyAgentRequestViewsState();
			const next = cloneAgentRequestViewsState(prev);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				reduceAgentRequestViews(next, fact);
			}
			ctx.state.set(next);
			ctx.down([["DATA", freezeAgentRequestViews(next)]]);
		},
		{ name: `${name}/views`, factory: "agentRequestLedgerViews" },
	);
	const issues = graph.node<DataIssue>(
		[facts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "rejected") ctx.down([["DATA", fact.issue]]);
				if (fact.kind === "status") {
					for (const issue of fact.issues ?? []) ctx.down([["DATA", issue]]);
				}
			}
		},
		{ name: `${name}/issues`, factory: "agentRequestLedgerIssues" },
	);
	const audit = graph.node<AgentRuntimeAuditRecord>(
		[facts],
		(ctx) => {
			let seq = ctx.state.get<number>() ?? 0;
			for (const raw of depBatch(ctx, 0) ?? []) {
				seq += 1;
				const fact = raw as AgentRequestFact;
				ctx.down([
					[
						"DATA",
						{
							id: `${name}:ledger:${seq}`,
							kind: `agent-request-${fact.kind}`,
							subjectId: "requestId" in fact ? fact.requestId : fact.proposalId,
						} satisfies AgentRuntimeAuditRecord,
					],
				]);
			}
			ctx.state.set(seq);
		},
		{ name: `${name}/audit`, factory: "agentRequestLedgerAudit" },
	);
	return { views, issues, audit };
}

export function requestSatisfactionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly requestFacts: Node<AgentRequestFact>;
		readonly executorProfiles?: readonly Node<ExecutorProfile>[];
		readonly executorRoutes?: readonly Node<ExecutorRoute>[];
		readonly executorOutcomes?: readonly Node<ExecutorOutcome>[];
		readonly contextContributions?: readonly Node<ContextContribution>[];
		readonly promptBundles?: readonly Node<PromptBundle>[];
	},
): AgentRequestSatisfactionBundle {
	const name = opts.name ?? "requestSatisfaction";
	const profileDeps = opts.executorProfiles ?? [];
	const routeDeps = opts.executorRoutes ?? [];
	const outcomeDeps = opts.executorOutcomes ?? [];
	const contextDeps = opts.contextContributions ?? [];
	const promptDeps = opts.promptBundles ?? [];
	const deps = [
		opts.requestFacts,
		...profileDeps,
		...routeDeps,
		...outcomeDeps,
		...contextDeps,
		...promptDeps,
	];
	const profileStart = 1;
	const routeStart = profileStart + profileDeps.length;
	const outcomeStart = routeStart + routeDeps.length;
	const contextStart = outcomeStart + outcomeDeps.length;
	const promptStart = contextStart + contextDeps.length;
	const runtime = graph.node<AgentRequestSatisfactionFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<RequestSatisfactionState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				profiles: new Map<string, ExecutorProfile>(),
				routes: new Map<string, ExecutorRoute>(),
				outcomes: new Map<string, ExecutorOutcome>(),
				contexts: new Map<string, ContextContribution>(),
				prompts: new Map<string, PromptBundle>(),
				compatibleRoutesByRouteId: new Map<string, ExecutorRoute>(),
				terminalRequests: new Set<string>(),
				acceptedTerminalFactIds: new Set<string>(),
				issueKeys: new Set<string>(),
				statusKeys: new Set<string>(),
				issueSeq: 0,
				auditSeq: 0,
			};
			for (const fact of depBatch(ctx, 0) ?? []) {
				if ((fact as AgentRequestFact).kind === "issued") {
					const request = fact as AgentRequestIssued;
					state.requests.set(request.requestId, request);
					emitStatus(ctx, state, request, initialRequestStatus(request), [
						ref("agent-request", request.requestId),
					]);
				}
			}
			forEachDepBatch(ctx, profileStart, profileDeps.length, (raw) => {
				const profile = raw as ExecutorProfile;
				state.profiles.set(profile.profileId, profile);
			});
			forEachDepBatch(ctx, routeStart, routeDeps.length, (raw) => {
				const route = raw as ExecutorRoute;
				state.routes.set(route.routeId, route);
			});
			forEachDepBatch(ctx, outcomeStart, outcomeDeps.length, (raw) => {
				const outcome = raw as ExecutorOutcome;
				state.outcomes.set(outcome.outcomeId, outcome);
			});
			forEachDepBatch(ctx, contextStart, contextDeps.length, (raw) => {
				const contribution = raw as ContextContribution;
				state.contexts.set(contribution.contributionId, contribution);
			});
			forEachDepBatch(ctx, promptStart, promptDeps.length, (raw) => {
				const prompt = raw as PromptBundle;
				state.prompts.set(prompt.promptId, prompt);
			});
			evaluateRequestSatisfaction(ctx, state);
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "requestSatisfactionProjector" },
	);
	const status = graph.node<AgentRequestStatusChanged>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "status") ctx.down([["DATA", typed.status]]);
			}
		},
		{ name: `${name}/status`, factory: "requestSatisfactionStatus" },
	);
	const issues = graph.node<DataIssue>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "issue") ctx.down([["DATA", typed.issue]]);
			}
		},
		{ name: `${name}/issues`, factory: "requestSatisfactionIssues" },
	);
	const audit = graph.node<AgentRuntimeAuditRecord>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as AgentRequestSatisfactionFact;
				if (typed.kind === "audit") ctx.down([["DATA", typed.audit]]);
			}
		},
		{ name: `${name}/audit`, factory: "requestSatisfactionAudit" },
	);
	return { status, issues, audit };
}

export function structuredAgentDecisionInterpreter(
	graph: Graph,
	outcomes: Node<ExecutorOutcome>,
	opts: {
		readonly name?: string;
		readonly schemaRef?: string;
		readonly requestFacts?: readonly Node<AgentRequestFact>[];
	} = {},
): StructuredAgentDecisionInterpreterBundle {
	const name = opts.name ?? "structuredAgentDecisionInterpreter";
	const requestFacts = opts.requestFacts ?? [];
	const runtime = graph.node<StructuredAgentDecisionInterpreterFact>(
		[outcomes, ...requestFacts],
		(ctx) => {
			const state = ctx.state.get<StructuredInterpreterState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				issueSeq: 0,
			};
			forEachDepBatch(ctx, 1, requestFacts.length, (raw) => {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") state.requests.set(fact.requestId, fact);
			});
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = raw as ExecutorOutcome;
				if (outcome.kind !== "result") {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"non-result-outcome",
						"Only result outcomes can carry AgentDecision envelopes",
					);
					continue;
				}
				const value = outcome.result.value;
				if (!isRecord(value)) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"malformed-agent-decision",
						"ExecutorOutcome result must carry a structured agent-decision envelope",
					);
					continue;
				}
				const envelope = value as Partial<StructuredAgentDecisionEnvelope>;
				if (envelope.kind !== "agent-decision" || !isRecord(envelope.decision)) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"malformed-agent-decision",
						"Structured agent-decision envelope is missing kind or decision",
					);
					continue;
				}
				if (typeof envelope.schemaRef !== "string" || envelope.schemaRef.length === 0) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"missing-agent-decision-schema",
						"Structured agent-decision envelope must carry schemaRef evidence",
					);
					continue;
				}
				if (opts.schemaRef !== undefined && envelope.schemaRef !== opts.schemaRef) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"agent-decision-schema-mismatch",
						"Structured agent-decision envelope schemaRef did not match",
					);
					continue;
				}
				const decision = validateAgentDecision(envelope.decision, outcome);
				if (typeof decision === "string") {
					state.issueSeq += 1;
					emitInterpreterIssue(ctx, state.issueSeq, outcome, "malformed-agent-decision", decision);
					continue;
				}
				const request = state.requests.get(decision.source.requestId);
				if (request === undefined) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"missing-agent-decision-request",
						"AgentDecision source request must be present in the request ledger",
					);
					continue;
				}
				if (
					request.effectRunId !== decision.effectRunId ||
					request.operationId !== decision.source.operationId
				) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"stale-agent-decision-source",
						"AgentDecision source request/effectRun/operation identity did not match the request ledger",
					);
					continue;
				}
				ctx.down([
					["DATA", { kind: "decision", decision } satisfies StructuredAgentDecisionInterpreterFact],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${outcome.outcomeId}:agent-decision-interpreted`,
								kind: "agent-decision-interpreted",
								subjectId: decision.effectRunId,
								sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
							},
						} satisfies StructuredAgentDecisionInterpreterFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "structuredAgentDecisionInterpreter" },
	);
	return {
		decisions: projectRuntimeFact(
			graph,
			runtime,
			`${name}/decisions`,
			"structuredAgentDecisions",
			(fact) => (fact.kind === "decision" ? fact.decision : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"structuredAgentDecisionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"structuredAgentDecisionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export function effectRunCompletionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly effectRuns: Node<EffectRun>;
		readonly decisions?: readonly Node<AgentDecision>[];
		readonly requestStatuses?: readonly Node<AgentRequestStatusChanged>[];
		readonly requestFacts?: readonly Node<AgentRequestFact>[];
		readonly resultCandidates?: readonly Node<EffectRunResult>[];
		readonly now?: () => number;
	},
): EffectRunCompletionBundle {
	const name = opts.name ?? "effectRunCompletion";
	const decisions = opts.decisions ?? [];
	const requestStatuses = opts.requestStatuses ?? [];
	const requestFacts = opts.requestFacts ?? [];
	const resultCandidates = opts.resultCandidates ?? [];
	const deps = [
		opts.effectRuns,
		...decisions,
		...requestStatuses,
		...requestFacts,
		...resultCandidates,
	];
	const decisionStart = 1;
	const requestStatusStart = decisionStart + decisions.length;
	const requestFactStart = requestStatusStart + requestStatuses.length;
	const resultCandidateStart = requestFactStart + requestFacts.length;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<EffectRunCompletionFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<EffectRunCompletionState>() ?? emptyEffectRunCompletionState();
			const touchedEffectRunIds = new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const run = raw as EffectRun;
				state.runs.set(run.effectRunId, run);
				touchedEffectRunIds.add(run.effectRunId);
			}
			forEachDepBatch(ctx, requestFactStart, requestFacts.length, (raw) => {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") {
					state.requests.set(fact.requestId, fact);
					touchedEffectRunIds.add(fact.effectRunId);
					const existingStatus = state.statusByRequest.get(fact.requestId);
					if (existingStatus !== undefined && !statusMatchesRequest(existingStatus, fact)) {
						emitEffectRunIssue(
							ctx,
							state,
							"stale-request-status",
							`AgentRequest status for '${fact.requestId}' did not match its issued effectRun/operation identity`,
							fact.effectRunId,
							[ref("agent-request", fact.requestId)],
						);
					}
					const result = state.resultsByEffectRun.get(fact.effectRunId);
					if (result !== undefined && fact.required) {
						state.issueSeq += 1;
						const issue = dataIssue(
							"late-required-request-after-effect-run-result",
							`Required request '${fact.requestId}' arrived after EffectRun '${fact.effectRunId}' already had a terminal result`,
							{
								subjectId: fact.effectRunId,
								refs: [
									ref("agent-request", fact.requestId),
									ref("effect-run-result", result.resultId),
								],
							},
						);
						ctx.down([
							["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
							[
								"DATA",
								{
									kind: "audit",
									audit: {
										id: `${fact.effectRunId}:late-required-request:${state.issueSeq}`,
										kind: "late-required-request-after-effect-run-result",
										subjectId: fact.effectRunId,
										issueCode: issue.code,
										sourceRefs: [
											ref("agent-request", fact.requestId),
											ref("effect-run-result", result.resultId),
										],
									},
								} satisfies EffectRunCompletionFact,
							],
						]);
					}
				} else if (fact.kind === "status") {
					acceptRequestStatus(ctx, state, fact);
					touchedEffectRunIds.add(fact.effectRunId);
				}
			});
			forEachDepBatch(ctx, requestStatusStart, requestStatuses.length, (raw) => {
				const status = raw as AgentRequestStatusChanged;
				acceptRequestStatus(ctx, state, status);
				touchedEffectRunIds.add(status.effectRunId);
			});
			forEachDepBatch(ctx, resultCandidateStart, resultCandidates.length, (raw) => {
				acceptEffectRunResultCandidate(ctx, state, raw as EffectRunResult);
			});
			forEachDepBatch(ctx, decisionStart, decisions.length, (raw) => {
				const decision = raw as AgentDecision;
				state.decisions.set(decision.decisionId, decision);
				touchedEffectRunIds.add(decision.effectRunId);
			});
			for (const decision of state.decisions.values()) {
				if (state.resultsByEffectRun.has(decision.effectRunId)) continue;
				const candidate = candidateFromDecision(decision, state, now());
				if (candidate === undefined) continue;
				acceptEffectRunResultCandidate(ctx, state, candidate);
			}
			for (const effectRunId of touchedEffectRunIds) {
				if (!state.resultsByEffectRun.has(effectRunId)) {
					emitEffectRunStatus(
						ctx,
						effectRunId,
						"pending",
						requiredPendingRequests(effectRunId, state),
						requiredTerminalRequests(effectRunId, state),
					);
				}
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "effectRunCompletionProjector" },
	);
	return {
		results: projectRuntimeFact(
			graph,
			runtime,
			`${name}/results`,
			"effectRunCompletionResults",
			(fact) => (fact.kind === "result" ? fact.result : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"effectRunCompletionStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"effectRunCompletionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"effectRunCompletionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export function fakeExecutorResult<T>(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly result: AgentOutputEnvelope<T> },
): ExecutorOutcome<T> {
	return { kind: "result", ...opts };
}

export function fakeExecutorFailure(
	opts: Omit<ExecutorOutcomeBase, "kind"> & {
		readonly error: DataIssue;
		readonly retryable?: boolean;
	},
): ExecutorOutcome {
	return { kind: "failure", ...opts };
}

export function fakeExecutorBlocked(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly needs: readonly AgentNeed[] },
): ExecutorOutcome {
	return { kind: "blocked", ...opts };
}

export function fakeExecutorTimeout(
	opts: Omit<ExecutorOutcomeBase, "kind"> & {
		readonly timeoutMs?: number;
		readonly retryable?: boolean;
	},
): ExecutorOutcome {
	return { kind: "timeout", ...opts };
}

export function fakeExecutorCanceled(
	opts: Omit<ExecutorOutcomeBase, "kind"> & { readonly reason?: string },
): ExecutorOutcome {
	return { kind: "canceled", ...opts };
}

type AgentRequestSatisfactionFact =
	| { readonly kind: "status"; readonly status: AgentRequestStatusChanged }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type StructuredAgentDecisionInterpreterFact =
	| { readonly kind: "decision"; readonly decision: AgentDecision }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type EffectRunCompletionFact =
	| { readonly kind: "result"; readonly result: EffectRunResult }
	| { readonly kind: "status"; readonly status: EffectRunCompletionStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface AgentRequestViewsState {
	requestsById: Map<string, AgentRequestIssued>;
	requestsByEffectRun: Map<string, string[]>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	auditSeq: number;
}

interface EffectRunCompletionState {
	runs: Map<string, EffectRun>;
	requests: Map<string, AgentRequestIssued>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	decisions: Map<string, AgentDecision>;
	resultsByEffectRun: Map<string, EffectRunResult>;
	issueSeq: number;
}

interface StructuredInterpreterState {
	requests: Map<string, AgentRequestIssued>;
	issueSeq: number;
}

function initialRequestStatus(request: AgentRequestIssued): AgentRequestStatus {
	if (request.requestKind === "context") return "awaiting-context";
	if (request.requestKind === "prompt") return "awaiting-prompt";
	return "awaiting-route";
}

function evaluateRequestSatisfaction(ctx: Ctx, state: RequestSatisfactionState): void {
	for (const route of state.routes.values()) handleRoute(ctx, state, route);
	for (const contribution of state.contexts.values())
		handleContextContribution(ctx, state, contribution);
	for (const prompt of state.prompts.values()) handlePromptBundle(ctx, state, prompt);
	for (const outcome of state.outcomes.values()) handleExecutorOutcome(ctx, state, outcome);
}

function handleRoute(ctx: Ctx, state: RequestSatisfactionState, route: ExecutorRoute): void {
	const request = state.requests.get(route.requestId);
	if (request === undefined) {
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (state.compatibleRoutesByRouteId.get(route.routeId)?.requestId !== request.requestId) {
			emitIssueOnce(
				ctx,
				state,
				`late-route:${route.routeId}`,
				"late-route-after-terminal",
				`ExecutorRoute '${route.routeId}' arrived after request '${request.requestId}' was already terminal`,
				request.requestId,
				[ref("executor-route", route.routeId), ref("agent-request", request.requestId)],
			);
		}
		return;
	}
	if (request.operationId !== route.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-route:${route.routeId}`,
			"stale-route-operation",
			`ExecutorRoute '${route.routeId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("executor-route", route.routeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const profile = state.profiles.get(route.profileId);
	if (profile === undefined) {
		return;
	}
	const compatibilityIssue = routeCompatibilityIssue(request, route, profile);
	if (compatibilityIssue !== undefined) {
		emitIssueOnce(
			ctx,
			state,
			`route-incompatible:${route.routeId}:${compatibilityIssue}`,
			compatibilityIssue,
			`ExecutorRoute '${route.routeId}' is incompatible with request '${request.requestId}'`,
			request.requestId,
			[
				ref("executor-route", route.routeId),
				ref("executor-profile", profile.profileId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	state.compatibleRoutesByRouteId.set(route.routeId, route);
	emitStatusOnce(
		ctx,
		state,
		`route:${route.routeId}:awaiting-provider`,
		request,
		"awaiting-provider",
		[
			ref("executor-route", route.routeId),
			ref("executor-profile", profile.profileId),
			ref("agent-request", request.requestId),
		],
	);
}

function handleExecutorOutcome(
	ctx: Ctx,
	state: RequestSatisfactionState,
	outcome: ExecutorOutcome,
): void {
	const request = state.requests.get(outcome.requestId);
	if (request === undefined) {
		return;
	}
	if (request.operationId !== outcome.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-outcome:${outcome.outcomeId}`,
			"stale-outcome-operation",
			`ExecutorOutcome '${outcome.outcomeId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const route = state.compatibleRoutesByRouteId.get(outcome.routeId);
	if (route === undefined || route.requestId !== request.requestId) {
		emitIssueOnce(
			ctx,
			state,
			`missing-route:${outcome.outcomeId}`,
			"missing-compatible-route",
			`ExecutorOutcome '${outcome.outcomeId}' has no compatible route for request '${request.requestId}'`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	const outcomeIssue = outcomeCompatibilityIssue(request, route, outcome);
	if (outcomeIssue !== undefined) {
		emitIssueOnce(
			ctx,
			state,
			`outcome-incompatible:${outcome.outcomeId}:${outcomeIssue}`,
			outcomeIssue,
			`ExecutorOutcome '${outcome.outcomeId}' is incompatible with route '${route.routeId}' for request '${request.requestId}'`,
			request.requestId,
			[
				ref("executor-outcome", outcome.outcomeId),
				ref("executor-route", route.routeId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (state.acceptedTerminalFactIds.has(`outcome:${outcome.outcomeId}`)) return;
		emitIssueOnce(
			ctx,
			state,
			`duplicate-outcome:${outcome.outcomeId}`,
			"duplicate-terminal-outcome",
			`ExecutorOutcome '${outcome.outcomeId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[ref("executor-outcome", outcome.outcomeId), ref("agent-request", request.requestId)],
		);
		return;
	}
	state.terminalRequests.add(request.requestId);
	state.acceptedTerminalFactIds.add(`outcome:${outcome.outcomeId}`);
	const status = outcomeStatus(outcome);
	emitStatus(ctx, state, request, status, [
		ref("executor-outcome", outcome.outcomeId),
		ref("executor-route", route.routeId),
		ref("agent-request", request.requestId),
	]);
}

function handleContextContribution(
	ctx: Ctx,
	state: RequestSatisfactionState,
	contribution: ContextContribution,
): void {
	const request = state.requests.get(contribution.requestId);
	if (request === undefined) return;
	if (request.operationId !== contribution.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-context:${contribution.contributionId}`,
			"stale-context-operation",
			`ContextContribution '${contribution.contributionId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("context-contribution", contribution.contributionId)],
		);
		return;
	}
	if (request.requestKind !== "context") {
		emitIssueOnce(
			ctx,
			state,
			`wrong-context-kind:${contribution.contributionId}`,
			"wrong-kind-context-satisfaction",
			`ContextContribution '${contribution.contributionId}' cannot satisfy ${request.requestKind} request '${request.requestId}'`,
			request.requestId,
			[ref("context-contribution", contribution.contributionId)],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (
			state.acceptedTerminalFactIds.has(`context:${contribution.contributionId}`) ||
			state.statusKeys.has(`context:${contribution.contributionId}:awaiting-context`)
		) {
			return;
		}
		emitIssueOnce(
			ctx,
			state,
			`duplicate-context:${contribution.contributionId}`,
			"duplicate-terminal-context",
			`ContextContribution '${contribution.contributionId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[
				ref("context-contribution", contribution.contributionId),
				ref("agent-request", request.requestId),
			],
		);
		return;
	}
	if (contribution.status === "pending")
		emitStatusOnce(
			ctx,
			state,
			`context:${contribution.contributionId}:awaiting-context`,
			request,
			"awaiting-context",
			[ref("context-contribution", contribution.contributionId)],
		);
	else {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`context:${contribution.contributionId}`);
		emitStatus(
			ctx,
			state,
			request,
			contribution.status === "ready" ? "completed" : "failed",
			[ref("context-contribution", contribution.contributionId)],
			contribution.issues,
		);
	}
}

function handlePromptBundle(ctx: Ctx, state: RequestSatisfactionState, prompt: PromptBundle): void {
	const request = state.requests.get(prompt.requestId);
	if (request === undefined) return;
	if (request.operationId !== prompt.operationId) {
		emitIssueOnce(
			ctx,
			state,
			`stale-prompt:${prompt.promptId}`,
			"stale-prompt-operation",
			`PromptBundle '${prompt.promptId}' operationId does not match request '${request.requestId}'`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId)],
		);
		return;
	}
	if (request.requestKind !== "prompt") {
		emitIssueOnce(
			ctx,
			state,
			`wrong-prompt-kind:${prompt.promptId}`,
			"wrong-kind-prompt-satisfaction",
			`PromptBundle '${prompt.promptId}' cannot satisfy ${request.requestKind} request '${request.requestId}'`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId)],
		);
		return;
	}
	if (state.terminalRequests.has(request.requestId)) {
		if (
			state.acceptedTerminalFactIds.has(`prompt:${prompt.promptId}`) ||
			state.statusKeys.has(`prompt:${prompt.promptId}:awaiting-prompt`)
		) {
			return;
		}
		emitIssueOnce(
			ctx,
			state,
			`duplicate-prompt:${prompt.promptId}`,
			"duplicate-terminal-prompt",
			`PromptBundle '${prompt.promptId}' arrived after request '${request.requestId}' was already terminal`,
			request.requestId,
			[ref("prompt-bundle", prompt.promptId), ref("agent-request", request.requestId)],
		);
		return;
	}
	if (prompt.status === "ready") {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`prompt:${prompt.promptId}`);
		emitStatus(ctx, state, request, "completed", [ref("prompt-bundle", prompt.promptId)]);
	} else if (prompt.status === "issue") {
		state.terminalRequests.add(request.requestId);
		state.acceptedTerminalFactIds.add(`prompt:${prompt.promptId}`);
		emitStatus(
			ctx,
			state,
			request,
			"failed",
			[ref("prompt-bundle", prompt.promptId)],
			prompt.issues,
		);
	} else {
		emitStatusOnce(
			ctx,
			state,
			`prompt:${prompt.promptId}:awaiting-prompt`,
			request,
			"awaiting-prompt",
			[ref("prompt-bundle", prompt.promptId)],
			prompt.issues,
		);
	}
}

function routeCompatibilityIssue(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	profile: ExecutorProfile,
): string | undefined {
	if (request.requestKind !== "executor") return "route-for-non-executor-request";
	if (route.executorId !== profile.executorId) return "route-profile-executor-mismatch";
	if (
		request.input?.inputId !== undefined &&
		route.inputId !== undefined &&
		request.input.inputId !== route.inputId
	) {
		return "route-input-mismatch";
	}
	if (
		request.input?.inputKind !== undefined &&
		route.inputKind !== undefined &&
		request.input.inputKind !== route.inputKind
	) {
		return "route-input-kind-mismatch";
	}
	const inputKind = request.input?.inputKind ?? route.inputKind;
	if (inputKind !== undefined && !profileKindAcceptsInput(profile.kind, inputKind))
		return "profile-kind-input-incompatible";
	if (
		inputKind !== undefined &&
		profile.acceptedInputKinds !== undefined &&
		!profile.acceptedInputKinds.includes(inputKind)
	) {
		return "profile-rejects-input-kind";
	}
	if (
		request.input?.schemaRef !== undefined &&
		profile.acceptedSchemaRefs !== undefined &&
		!profile.acceptedSchemaRefs.includes(request.input.schemaRef)
	) {
		return "profile-rejects-schema";
	}
	return undefined;
}

function outcomeCompatibilityIssue(
	request: AgentRequestIssued,
	route: ExecutorRoute,
	outcome: ExecutorOutcome,
): string | undefined {
	if (outcome.executorId !== route.executorId) return "outcome-route-executor-mismatch";
	if (outcome.profileId !== route.profileId) return "outcome-route-profile-mismatch";
	if (
		route.inputId !== undefined &&
		(outcome.inputId === undefined || outcome.inputId !== route.inputId)
	) {
		return "outcome-route-input-mismatch";
	}
	if (
		request.input?.inputId !== undefined &&
		outcome.inputId !== undefined &&
		outcome.inputId !== request.input.inputId
	) {
		return "outcome-request-input-mismatch";
	}
	if (
		route.inputKind !== undefined &&
		(outcome.inputKind === undefined || outcome.inputKind !== route.inputKind)
	) {
		return "outcome-route-input-kind-mismatch";
	}
	if (
		request.input?.inputKind !== undefined &&
		outcome.inputKind !== undefined &&
		outcome.inputKind !== request.input.inputKind
	) {
		return "outcome-request-input-kind-mismatch";
	}
	return undefined;
}

function profileKindAcceptsInput(kind: ExecutorProfile["kind"], inputKind: string): boolean {
	if (kind === "llm") return inputKind === "llm-call";
	if (kind === "tool") return inputKind === "tool-call";
	if (kind === "human") return inputKind === "human-task";
	return inputKind === "agent-task";
}

function outcomeStatus(outcome: ExecutorOutcome): AgentRequestStatus {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "timeout") return "timeout";
	if (outcome.kind === "canceled") return "canceled";
	return "blocked";
}

function emitStatus(
	ctx: Ctx,
	state: RequestSatisfactionState,
	request: AgentRequestIssued,
	status: AgentRequestStatus,
	sourceRefs?: readonly SourceRef[],
	issues?: readonly DataIssue[],
): void {
	const fact: AgentRequestStatusChanged = {
		kind: "status",
		requestId: request.requestId,
		operationId: request.operationId,
		effectRunId: request.effectRunId,
		status,
		sourceRefs,
		issues,
	};
	state.auditSeq += 1;
	ctx.down([
		["DATA", { kind: "status", status: fact } satisfies AgentRequestSatisfactionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${request.requestId}:status:${state.auditSeq}`,
					kind: "agent-request-status",
					subjectId: request.requestId,
					sourceRefs,
					metadata: { status },
				},
			} satisfies AgentRequestSatisfactionFact,
		],
	]);
}

function emitStatusOnce(
	ctx: Ctx,
	state: RequestSatisfactionState,
	key: string,
	request: AgentRequestIssued,
	status: AgentRequestStatus,
	sourceRefs?: readonly SourceRef[],
	issues?: readonly DataIssue[],
): void {
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	emitStatus(ctx, state, request, status, sourceRefs, issues);
}

function emitIssue(
	ctx: Ctx,
	state: RequestSatisfactionState,
	code: string,
	message: string,
	subjectId?: string,
	refs?: readonly SourceRef[],
): void {
	state.issueSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs });
	state.auditSeq += 1;
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies AgentRequestSatisfactionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${subjectId ?? "request"}:issue:${state.auditSeq}`,
					kind: "agent-request-issue",
					subjectId,
					issueCode: code,
					message,
					sourceRefs: refs,
				},
			} satisfies AgentRequestSatisfactionFact,
		],
	]);
}

function emitIssueOnce(
	ctx: Ctx,
	state: RequestSatisfactionState,
	key: string,
	code: string,
	message: string,
	subjectId?: string,
	refs?: readonly SourceRef[],
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	emitIssue(ctx, state, code, message, subjectId, refs);
}

function emitInterpreterIssue(
	ctx: Ctx,
	seq: number,
	outcome: ExecutorOutcome,
	code: string,
	message: string,
): void {
	const issue = dataIssue(code, message, {
		subjectId: outcome.requestId,
		refs: [ref("executor-outcome", outcome.outcomeId)],
	});
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies StructuredAgentDecisionInterpreterFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${outcome.outcomeId}:agent-decision-issue:${seq}`,
					kind: "agent-decision-issue",
					subjectId: outcome.requestId,
					issueCode: code,
					message,
					sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
				},
			} satisfies StructuredAgentDecisionInterpreterFact,
		],
	]);
}

function validateAgentDecision(raw: unknown, outcome: ExecutorOutcome): AgentDecision | string {
	if (!isRecord(raw)) return "AgentDecision must be an object";
	const kind = raw.kind;
	if (kind !== "continue" && kind !== "final" && kind !== "blocked") {
		return "AgentDecision kind must be continue, final, or blocked";
	}
	if (typeof raw.decisionId !== "string" || raw.decisionId.length === 0)
		return "AgentDecision decisionId must be a non-empty string";
	if (
		raw.effectRunId === undefined ||
		typeof raw.effectRunId !== "string" ||
		raw.effectRunId.length === 0
	)
		return "AgentDecision effectRunId must be a non-empty string";
	if (typeof raw.agentRunId !== "string" || raw.agentRunId.length === 0)
		return "AgentDecision agentRunId must be a non-empty string";
	const source = raw.source;
	if (
		!isRecord(source) ||
		source.requestId !== outcome.requestId ||
		source.operationId !== outcome.operationId ||
		source.outcomeId !== outcome.outcomeId
	) {
		return "AgentDecision source must match the ExecutorOutcome requestId, operationId, and outcomeId";
	}
	if (kind === "continue") {
		if (!Array.isArray(raw.next)) return "AgentDecision.continue next must be an array";
		for (const proposal of raw.next) {
			if (!isAgentRequestProposalLike(proposal, raw.effectRunId)) {
				return "AgentDecision.continue next entries must be AgentRequestProposal-like objects";
			}
		}
		return raw as unknown as AgentDecisionContinue;
	}
	if (kind === "final") {
		if (!isRecord(raw.output) || typeof raw.output.kind !== "string")
			return "AgentDecision.final output must be an envelope with kind";
		return raw as unknown as AgentDecisionFinal;
	}
	if (!Array.isArray(raw.needs)) return "AgentDecision.blocked needs must be an array";
	for (const need of raw.needs) {
		if (!isAgentNeedLike(need))
			return "AgentDecision.blocked needs entries must be AgentNeed-like objects";
	}
	return raw as unknown as AgentDecisionBlocked;
}

function isAgentRequestProposalLike(value: unknown, effectRunId: string): boolean {
	if (!isRecord(value)) return false;
	if (value.kind !== "proposal") return false;
	if (typeof value.proposalId !== "string" || value.proposalId.length === 0) return false;
	if (value.effectRunId !== effectRunId) return false;
	return (
		value.requestKind === "context" ||
		value.requestKind === "prompt" ||
		value.requestKind === "executor"
	);
}

function isAgentNeedLike(value: unknown): boolean {
	return isRecord(value) && typeof value.kind === "string" && value.kind.length > 0;
}

function candidateFromDecision(
	decision: AgentDecision,
	state: EffectRunCompletionState,
	completedAtMs: number,
): EffectRunResult | undefined {
	const run = state.runs.get(decision.effectRunId);
	if (run === undefined) return undefined;
	if (!decisionSourceRequestTerminal(decision, state)) return undefined;
	const requiredPending = requiredPendingRequests(decision.effectRunId, state);
	if (decision.kind === "final") {
		if (requiredPending.length > 0) {
			return undefined;
		}
		return {
			kind: "effect-run-result",
			resultId: `${decision.effectRunId}:result`,
			status: "completed",
			effectRunId: decision.effectRunId,
			subjectRefs: run.subjectRefs,
			operationId: decision.source.operationId,
			sourceRefs: [
				ref("agent-decision", decision.decisionId),
				ref("executor-outcome", decision.source.outcomeId),
			],
			completedAtMs,
			output: decision.output,
		};
	}
	if (decision.kind === "blocked" && requiredPending.length === 0) {
		return {
			kind: "effect-run-result",
			resultId: `${decision.effectRunId}:result`,
			status: "blocked",
			effectRunId: decision.effectRunId,
			subjectRefs: run.subjectRefs,
			operationId: decision.source.operationId,
			sourceRefs: [
				ref("agent-decision", decision.decisionId),
				ref("executor-outcome", decision.source.outcomeId),
			],
			completedAtMs,
			needs: decision.needs,
		};
	}
	return undefined;
}

function acceptEffectRunResultCandidate(
	ctx: Ctx,
	state: EffectRunCompletionState,
	candidate: EffectRunResult,
): void {
	if (!state.runs.has(candidate.effectRunId)) {
		emitEffectRunIssue(
			ctx,
			state,
			"unknown-effect-run-result-candidate",
			`EffectRunResult candidate '${candidate.resultId}' references unknown EffectRun '${candidate.effectRunId}'`,
			candidate.effectRunId,
			candidate.sourceRefs,
		);
		return;
	}
	const existing = state.resultsByEffectRun.get(candidate.effectRunId);
	if (existing !== undefined) {
		state.issueSeq += 1;
		const duplicate = sameTerminalResult(existing, candidate);
		const code = duplicate ? "duplicate-effect-run-result" : "conflicting-effect-run-result";
		const issue = dataIssue(
			code,
			`EffectRun '${candidate.effectRunId}' already has a terminal result`,
			{
				subjectId: candidate.effectRunId,
				refs: candidate.sourceRefs,
			},
		);
		ctx.down([
			["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
			[
				"DATA",
				{
					kind: "audit",
					audit: {
						id: `${candidate.effectRunId}:${code}:${state.issueSeq}`,
						kind: duplicate ? "effect-run-result-duplicate" : "effect-run-result-conflict",
						subjectId: candidate.effectRunId,
						issueCode: issue.code,
						sourceRefs: candidate.sourceRefs,
					},
				} satisfies EffectRunCompletionFact,
			],
		]);
		return;
	}
	state.resultsByEffectRun.set(candidate.effectRunId, candidate);
	ctx.down([
		["DATA", { kind: "result", result: candidate } satisfies EffectRunCompletionFact],
		[
			"DATA",
			{
				kind: "status",
				status: {
					effectRunId: candidate.effectRunId,
					state: candidate.status,
					requiredPending: [],
					requiredTerminal: requiredTerminalRequests(candidate.effectRunId, state),
					sourceRefs: candidate.sourceRefs,
				},
			} satisfies EffectRunCompletionFact,
		],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${candidate.effectRunId}:terminal-result`,
					kind: "effect-run-terminal-result",
					subjectId: candidate.effectRunId,
					sourceRefs: candidate.sourceRefs,
					metadata: { status: candidate.status },
				},
			} satisfies EffectRunCompletionFact,
		],
	]);
}

function emitEffectRunStatus(
	ctx: Ctx,
	effectRunId: string,
	state: EffectRunCompletionStatus["state"],
	requiredPending: readonly string[],
	requiredTerminal: readonly string[],
): void {
	ctx.down([
		[
			"DATA",
			{
				kind: "status",
				status: { effectRunId, state, requiredPending, requiredTerminal },
			} satisfies EffectRunCompletionFact,
		],
	]);
}

function requiredPendingRequests(
	effectRunId: string,
	state: EffectRunCompletionState,
): readonly string[] {
	const pending: string[] = [];
	for (const request of state.requests.values()) {
		if (request.effectRunId !== effectRunId || !request.required) continue;
		const statusFact = matchingStatusForRequest(state, request);
		const status = statusFact?.status;
		if (status === undefined || !isTerminalRequestStatus(status)) pending.push(request.requestId);
	}
	return pending;
}

function requiredTerminalRequests(
	effectRunId: string,
	state: EffectRunCompletionState,
): readonly string[] {
	const terminal: string[] = [];
	for (const request of state.requests.values()) {
		if (request.effectRunId !== effectRunId || !request.required) continue;
		const statusFact = matchingStatusForRequest(state, request);
		const status = statusFact?.status;
		if (status !== undefined && isTerminalRequestStatus(status)) terminal.push(request.requestId);
	}
	return terminal;
}

function isTerminalRequestStatus(status: AgentRequestStatus): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "blocked" ||
		status === "canceled" ||
		status === "timeout" ||
		status === "waived" ||
		status === "retry-exhausted"
	);
}

function decisionSourceRequestTerminal(
	decision: AgentDecision,
	state: EffectRunCompletionState,
): boolean {
	const request = state.requests.get(decision.source.requestId);
	if (request === undefined) return false;
	if (
		request.effectRunId !== decision.effectRunId ||
		request.operationId !== decision.source.operationId
	) {
		return false;
	}
	const status = matchingStatusForRequest(state, request)?.status;
	return status !== undefined && isTerminalRequestStatus(status);
}

function acceptRequestStatus(
	ctx: Ctx,
	state: EffectRunCompletionState,
	status: AgentRequestStatusChanged,
): void {
	const request = state.requests.get(status.requestId);
	if (request !== undefined && !statusMatchesRequest(status, request)) {
		emitEffectRunIssue(
			ctx,
			state,
			"stale-request-status",
			`AgentRequest status for '${status.requestId}' did not match its issued effectRun/operation identity`,
			request.effectRunId,
			[ref("agent-request", status.requestId)],
		);
		return;
	}
	state.statusByRequest.set(status.requestId, status);
}

function matchingStatusForRequest(
	state: EffectRunCompletionState,
	request: AgentRequestIssued,
): AgentRequestStatusChanged | undefined {
	const status = state.statusByRequest.get(request.requestId);
	if (status === undefined) return undefined;
	return statusMatchesRequest(status, request) ? status : undefined;
}

function statusMatchesRequest(
	status: AgentRequestStatusChanged,
	request: AgentRequestIssued,
): boolean {
	return (
		status.effectRunId === request.effectRunId &&
		(status.operationId === undefined || status.operationId === request.operationId)
	);
}

function emitEffectRunIssue(
	ctx: Ctx,
	state: EffectRunCompletionState,
	code: string,
	message: string,
	subjectId?: string,
	sourceRefs?: readonly SourceRef[],
): void {
	state.issueSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs: sourceRefs });
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${subjectId ?? "effect-run"}:${code}:${state.issueSeq}`,
					kind: "effect-run-issue",
					subjectId,
					issueCode: code,
					message,
					sourceRefs,
				},
			} satisfies EffectRunCompletionFact,
		],
	]);
}

function sameTerminalResult(a: EffectRunResult, b: EffectRunResult): boolean {
	return (
		a.status === b.status && a.resultId === b.resultId && JSON.stringify(a) === JSON.stringify(b)
	);
}

function emptyEffectRunCompletionState(): EffectRunCompletionState {
	return {
		runs: new Map<string, EffectRun>(),
		requests: new Map<string, AgentRequestIssued>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		decisions: new Map<string, AgentDecision>(),
		resultsByEffectRun: new Map<string, EffectRunResult>(),
		issueSeq: 0,
	};
}

function emptyAgentRequestViewsState(): AgentRequestViewsState {
	return {
		requestsById: new Map<string, AgentRequestIssued>(),
		requestsByEffectRun: new Map<string, string[]>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		issues: [],
		audit: [],
		auditSeq: 0,
	};
}

function cloneAgentRequestViewsState(state: AgentRequestViewsState): AgentRequestViewsState {
	return {
		requestsById: new Map(state.requestsById),
		requestsByEffectRun: new Map(Array.from(state.requestsByEffectRun, ([k, v]) => [k, [...v]])),
		statusByRequest: new Map(state.statusByRequest),
		issues: [...state.issues],
		audit: [...state.audit],
		auditSeq: state.auditSeq,
	};
}

function reduceAgentRequestViews(state: AgentRequestViewsState, fact: AgentRequestFact): void {
	state.auditSeq += 1;
	if (fact.kind === "issued") {
		state.requestsById.set(fact.requestId, fact);
		const requestIds = state.requestsByEffectRun.get(fact.effectRunId) ?? [];
		if (!requestIds.includes(fact.requestId)) requestIds.push(fact.requestId);
		state.requestsByEffectRun.set(fact.effectRunId, requestIds);
		state.statusByRequest.set(fact.requestId, {
			kind: "status",
			requestId: fact.requestId,
			operationId: fact.operationId,
			effectRunId: fact.effectRunId,
			status: "issued",
			sourceRefs: [ref("agent-request", fact.requestId)],
		});
	} else if (fact.kind === "status") {
		state.statusByRequest.set(fact.requestId, fact);
		if (fact.issues !== undefined) state.issues.push(...fact.issues);
	} else if (fact.kind === "rejected") {
		state.issues.push(fact.issue);
	}
	state.audit.push({
		id: `agent-request-ledger:${state.auditSeq}`,
		kind: `agent-request-${fact.kind}`,
		subjectId: "requestId" in fact ? fact.requestId : fact.proposalId,
	});
}

function freezeAgentRequestViews(state: AgentRequestViewsState): AgentRequestViews {
	const pending = Array.from(state.requestsById.values()).filter((request) => {
		const status = state.statusByRequest.get(request.requestId)?.status;
		return status === undefined || !isTerminalRequestStatus(status);
	});
	const awaitingProvider = pending.filter(
		(request) => state.statusByRequest.get(request.requestId)?.status === "awaiting-provider",
	);
	return {
		requestsById: new Map(state.requestsById),
		requestsByEffectRun: new Map(
			Array.from(state.requestsByEffectRun, ([key, value]) => [key, Object.freeze([...value])]),
		),
		statusByRequest: new Map(state.statusByRequest),
		pending: Object.freeze(pending),
		awaitingProvider: Object.freeze(awaitingProvider),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

function projectRuntimeFact<T, TOut>(
	graph: Graph,
	runtime: Node<T>,
	name: string,
	factory: string,
	pick: (fact: T) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as T;
				const value = pick(typed);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory },
	);
}

function forEachDepBatch(
	ctx: Ctx,
	start: number,
	count: number,
	fn: (value: unknown) => void,
): void {
	for (let i = 0; i < count; i += 1) {
		for (const value of depBatch(ctx, start + i) ?? []) fn(value);
	}
}

function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly severity?: DataIssue["severity"];
		readonly details?: unknown;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: opts.severity ?? "error",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((r) => `${r.kind}:${r.id}`),
		details: opts.details,
	};
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
