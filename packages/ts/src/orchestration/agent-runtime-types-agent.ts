import type { DataIssue } from "../data/index.js";
import type { Node } from "../node/node.js";
import type {
	AgentOutputEnvelope,
	AgentRequestProposal,
	AgentRequestStatusChanged,
	SourceRef,
} from "./agent-runtime-types-core.js";

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
