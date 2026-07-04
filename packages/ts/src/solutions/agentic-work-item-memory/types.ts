import type { DataIssue } from "../../data/index.js";
import type { Node } from "../../node/node.js";
import type { EffectRunResult, SourceRef } from "../../orchestration/agent-runtime.js";
import type { WorkItemEvidenceRecorded } from "../../orchestration/work-item-runtime.js";
import type { ScoreSignal } from "../../scoring/index.js";
import type {
	AgenticMemoryFactRef,
	AgenticMemoryRecord,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordCandidateMaterial,
	AgenticMemoryRecordProposal,
	StrictJsonValue,
} from "../agentic-memory/index.js";
import type { WorkItemProjection } from "../work-item/index.js";

export type AgenticWorkItemMemoryInputLane = "workItem" | "evidence" | "outcome" | "context";

export type AgenticWorkItemMemoryFieldPath = readonly (string | number)[];

export interface AgenticWorkItemMemoryDataSelector {
	readonly input: AgenticWorkItemMemoryInputLane;
	readonly refId?: string;
	readonly path: AgenticWorkItemMemoryFieldPath;
	readonly fallback?: StrictJsonValue;
}

export interface AgenticWorkItemMemoryContextFact<T = unknown> {
	readonly kind: "agentic-work-item-memory-context";
	readonly contextId: string;
	readonly workItemId?: string;
	readonly value?: T;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AgenticWorkItemMemoryScoreMappingRule {
	readonly kind?: "agentic-work-item-memory-score-mapping-rule";
	readonly ruleId: string;
	readonly subjectId?: string | AgenticWorkItemMemoryDataSelector;
	readonly dimension: string;
	readonly value?: number;
	readonly valueFrom?: AgenticWorkItemMemoryDataSelector;
	readonly confidence?: number;
	readonly confidenceFrom?: AgenticWorkItemMemoryDataSelector;
	readonly weight?: number;
	readonly weightFrom?: AgenticWorkItemMemoryDataSelector;
	readonly validFromMs?: number;
	readonly validToMs?: number;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticWorkItemMemoryRecordMappingRule<T = unknown> {
	readonly kind?: "agentic-work-item-memory-record-mapping-rule";
	readonly ruleId: string;
	readonly candidateId?: string;
	readonly operation?: AgenticMemoryRecordApplicationOperation;
	readonly targetRecordId?: string | AgenticWorkItemMemoryDataSelector;
	readonly record?: AgenticMemoryRecord<T>;
	readonly candidateMaterial?: AgenticMemoryRecordCandidateMaterial<T>;
	readonly candidateMaterialFrom?: AgenticWorkItemMemoryDataSelector;
	readonly reason?: string;
	readonly proposalStatus?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly evidenceRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticWorkItemMemoryMappingPolicy<T = unknown> {
	readonly kind: "agentic-work-item-memory-mapping-policy";
	readonly policyId: string;
	readonly scoreRules?: readonly AgenticWorkItemMemoryScoreMappingRule[];
	readonly recordRules?: readonly AgenticWorkItemMemoryRecordMappingRule<T>[];
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticWorkItemMemoryRecordCandidate<T = unknown> {
	readonly kind: "agentic-work-item-memory-record-candidate";
	readonly candidateId: string;
	readonly workItemId: string;
	readonly candidateMaterial: AgenticMemoryRecordCandidateMaterial<T>;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export type AgenticWorkItemMemoryBridgeStatusState =
	| "ready"
	| "empty"
	| "partial"
	| "blocked"
	| "candidate-conflict";

export type AgenticWorkItemMemoryBridgeIssue = DataIssue;

export interface AgenticWorkItemMemoryBridgeCursor {
	readonly evaluation: number;
	readonly workItems: number;
	readonly scoreRules: number;
	readonly recordRules: number;
	readonly explicitCandidates: number;
	readonly scoreSignals: number;
	readonly proposals: number;
	readonly duplicateSuppressions: number;
	readonly candidateConflicts: number;
	readonly invalidPolicies: number;
	readonly invalidCandidates: number;
	readonly issues: number;
}

export interface AgenticWorkItemMemoryBridgeStatus {
	readonly kind: "agentic-work-item-memory-bridge-status";
	readonly state: AgenticWorkItemMemoryBridgeStatusState;
	readonly cursor: AgenticWorkItemMemoryBridgeCursor;
	readonly issueCodes?: readonly string[];
}

export interface AgenticWorkItemMemoryBridgeAuditEntry {
	readonly kind: "agentic-work-item-memory-bridge-audit";
	readonly auditId: string;
	readonly action:
		| "score-signal-emitted"
		| "record-proposal-emitted"
		| "duplicate-suppressed"
		| "candidate-conflict"
		| "issue-recorded";
	readonly workItemId?: string;
	readonly candidateId?: string;
	readonly proposalId?: string;
	readonly scoreSignalId?: string;
	readonly coordinate?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticWorkItemMemoryBridgeResult<T = unknown> {
	readonly kind: "agentic-work-item-memory-bridge-result";
	readonly scoreSignals: readonly ScoreSignal[];
	readonly proposals: readonly AgenticMemoryRecordProposal<T>[];
	readonly status: AgenticWorkItemMemoryBridgeStatus;
	readonly issues: readonly AgenticWorkItemMemoryBridgeIssue[];
	readonly audit: readonly AgenticWorkItemMemoryBridgeAuditEntry[];
	readonly cursor: AgenticWorkItemMemoryBridgeCursor;
}

export interface AgenticWorkItemMemoryBridgeInput<TInput = unknown, TRecord = unknown> {
	readonly workItem: WorkItemProjection<TInput>;
	readonly policy: AgenticWorkItemMemoryMappingPolicy<TRecord>;
	readonly evidence?: readonly WorkItemEvidenceRecorded[];
	readonly outcomes?: readonly EffectRunResult[];
	readonly context?: readonly AgenticWorkItemMemoryContextFact[];
	readonly candidates?: readonly AgenticWorkItemMemoryRecordCandidate<TRecord>[];
	readonly evaluation?: number;
}

export interface AgenticWorkItemMemoryBridgeBundle<TInput = unknown, TRecord = unknown> {
	readonly input: {
		readonly workItem: Node<WorkItemProjection<TInput>>;
		readonly policy: Node<AgenticWorkItemMemoryMappingPolicy<TRecord>>;
		readonly evidence?: Node<readonly WorkItemEvidenceRecorded[]>;
		readonly outcomes?: Node<readonly EffectRunResult[]>;
		readonly context?: Node<readonly AgenticWorkItemMemoryContextFact[]>;
		readonly candidates?: Node<readonly AgenticWorkItemMemoryRecordCandidate<TRecord>[]>;
	};
	readonly projection: Node<AgenticWorkItemMemoryBridgeResult<TRecord>>;
	readonly scoreSignals: Node<readonly ScoreSignal[]>;
	readonly proposals: Node<readonly AgenticMemoryRecordProposal<TRecord>[]>;
	readonly status: Node<AgenticWorkItemMemoryBridgeStatus>;
	readonly issues: Node<readonly AgenticWorkItemMemoryBridgeIssue[]>;
	readonly audit: Node<readonly AgenticWorkItemMemoryBridgeAuditEntry[]>;
	readonly cursor: Node<AgenticWorkItemMemoryBridgeCursor>;
}

export interface AgenticWorkItemMemoryBridgeBundleOptions<TInput = unknown, TRecord = unknown> {
	readonly name?: string;
	readonly workItem: Node<WorkItemProjection<TInput>>;
	readonly policy: Node<AgenticWorkItemMemoryMappingPolicy<TRecord>>;
	readonly evidence?: Node<readonly WorkItemEvidenceRecorded[]>;
	readonly outcomes?: Node<readonly EffectRunResult[]>;
	readonly context?: Node<readonly AgenticWorkItemMemoryContextFact[]>;
	readonly candidates?: Node<readonly AgenticWorkItemMemoryRecordCandidate<TRecord>[]>;
}
