import type { DataIssue } from "../data/index.js";
import type { Node } from "../node/node.js";
import type { AgentNeed, AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";

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
	readonly policyRefs?: readonly SourceRef[];
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

export interface SizeCapacityEvidence {
	readonly kind: "size-capacity-evidence";
	readonly unit: string;
	readonly quantity: number;
	readonly measurementSource: string;
	readonly estimated?: boolean;
	readonly encoding?: string;
	readonly mediaType?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly refs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly sensitivity?: readonly string[];
	readonly redaction?: Record<string, unknown>;
	readonly metadata?: Record<string, unknown>;
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
	readonly artifacts?: readonly ExecutorArtifactMaterial[];
	readonly metadata?: Record<string, unknown>;
}

export interface ExecutorArtifactMaterial<T = unknown> {
	readonly kind: string;
	readonly format?: string;
	readonly schemaRef?: string;
	readonly schemaKind?: string;
	readonly mimeType?: string;
	readonly mediaType?: string;
	readonly filename?: string;
	readonly byteLength?: number;
	readonly digest?: string;
	readonly encoding?: string;
	readonly dataMode: "inline" | "summary" | "ref" | (string & {});
	readonly summary?: string;
	readonly value?: T;
	readonly ref?: SourceRef;
	readonly refs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly sizeEvidence?: readonly SizeCapacityEvidence[];
	readonly sensitivity?: readonly string[];
	readonly redaction?: Record<string, unknown>;
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
