import type { DataIssue } from "../data/index.js";
import type { StrictJsonValue as SharedStrictJsonValue } from "../json/codec.js";
import type { Node } from "../node/node.js";
import type {
	FactId,
	KnowledgeAssertion,
	KnowledgeAssertionObject,
	KnowledgeAssertionSubject,
	MemoryAnswer,
	MemoryFragment,
} from "../patterns/semantic-memory.js";
import type {
	MemoryRetrievalBundle,
	MemoryRetrievalCursor,
	MemoryRetrievalError,
	MemoryRetrievalIndex,
	MemoryRetrievalQuery,
	MemoryRetrievalSnapshot,
	MemoryRetrievalStatus,
} from "../patterns/semantic-memory-graph.js";
import type {
	AGENTIC_MEMORY_RECORD_FRAME_FORMAT,
	AGENTIC_MEMORY_RECORD_FRAME_VERSION,
} from "./agentic-memory-frame.js";

export type AgenticMemoryStrictJsonValue = SharedStrictJsonValue;

export type StrictJsonValue = SharedStrictJsonValue;

export type {
	KnowledgeAssertion,
	KnowledgeAssertionObject,
	KnowledgeAssertionSubject,
} from "../patterns/semantic-memory.js";

/** Agent-facing memory category. D164 keeps this separate from durability and artifact kind. */
export type AgenticMemoryKind = "working" | "episodic" | "semantic" | "procedural" | "profile";

/** Semantic durability/retention policy metadata. This is not a storage tier handle. */
export type AgenticMemoryPersistenceLevel =
	| "turn"
	| "session"
	| "project"
	| "longTerm"
	| "permanent"
	| "archived";

/** Whether the record is raw evidence or a derived artifact. */
export type AgenticMemoryArtifactKind = "raw" | "insight" | "profile" | "procedure";

/** Optional solution-facing scope metadata. Scope ids are ordinary DATA facts. */
export interface AgenticMemoryScope {
	readonly sessionId?: string;
	readonly projectId?: string;
	readonly userId?: string;
	readonly tenantId?: string;
}

/**
 * D164 solution envelope over a lower-layer MemoryFragment.
 *
 * The envelope carries agentic-memory metadata only. It intentionally owns no
 * storage tiers/keys/adapters, restore/hydration behavior, timers, schedulers,
 * LLM/tool/runner handles, or protocol semantics.
 */
export interface AgenticMemoryRecord<T = unknown> {
	readonly id: FactId;
	readonly kind: AgenticMemoryKind;
	readonly persistenceLevel: AgenticMemoryPersistenceLevel;
	readonly artifactKind: AgenticMemoryArtifactKind;
	readonly scope?: AgenticMemoryScope;
	readonly fragment: MemoryFragment<T>;
}

/** Graph-visible provenance/reference material for D572 proposal/admission facts. */
export interface AgenticMemoryFactRef {
	readonly kind: string;
	readonly id: FactId;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

/**
 * D572 generic proposal fact for creating or changing AgenticMemoryRecord truth.
 *
 * This is not record truth and is not an application command. Only a later
 * agentic-memory-owned application path may turn admitted material into records.
 */
export interface AgenticMemoryRecordProposal<T = unknown> {
	readonly kind: "agentic-memory-record-proposal";
	readonly proposalId: FactId;
	readonly candidateRecord: AgenticMemoryRecord<T>;
	readonly targetRecordId?: FactId;
	readonly reason?: string;
	readonly proposalStatus?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly evidenceRefs?: readonly AgenticMemoryFactRef[];
	readonly idempotencyKey?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export type AgenticMemoryRecordAdmissionDecisionState = "admitted" | "rejected" | "needs-review";

export interface AgenticMemoryRecordAdmissionPolicy {
	readonly kind: "agentic-memory-record-admission-policy";
	readonly policyId: FactId;
	readonly defaultState?: AgenticMemoryRecordAdmissionDecisionState;
	readonly requireSourceRefs?: boolean;
	readonly rejectDuplicateRecordIds?: boolean;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryRecordAdmission<T = unknown> {
	readonly kind: "agentic-memory-record-admission";
	readonly admissionId: FactId;
	readonly proposalId: FactId;
	readonly state: AgenticMemoryRecordAdmissionDecisionState;
	readonly candidateRecord: AgenticMemoryRecord<T>;
	readonly targetRecordId?: FactId;
	readonly reason?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
	readonly evidenceRefs?: readonly AgenticMemoryFactRef[];
	readonly idempotencyKey?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface AgenticMemoryRecordAdmissionAuditEntry {
	readonly kind: "agentic-memory-record-admission-audit";
	readonly admissionId: FactId;
	readonly proposalId: FactId;
	readonly state: AgenticMemoryRecordAdmissionDecisionState;
	readonly reason?: string;
	readonly sourceRefs?: readonly AgenticMemoryFactRef[];
	readonly policyRefs?: readonly AgenticMemoryFactRef[];
}

export interface AgenticMemoryRecordAdmissionCursor {
	readonly evaluation: number;
	readonly proposals: number;
	readonly validProposals: number;
	readonly invalidProposals: number;
	readonly invalidPolicies: number;
	readonly admitted: number;
	readonly rejected: number;
	readonly needsReview: number;
	readonly issues: number;
}

export type AgenticMemoryRecordAdmissionStatusState =
	| "ready"
	| "empty"
	| "partial"
	| "blocked"
	| "error";

export interface AgenticMemoryRecordAdmissionStatus {
	readonly state: AgenticMemoryRecordAdmissionStatusState;
	readonly cursor: AgenticMemoryRecordAdmissionCursor;
}

export interface AgenticMemoryRecordAdmissionSnapshot<T = unknown> {
	readonly admissions: readonly AgenticMemoryRecordAdmission<T>[];
	readonly admitted: readonly AgenticMemoryRecordAdmission<T>[];
	readonly rejected: readonly AgenticMemoryRecordAdmission<T>[];
	readonly needsReview: readonly AgenticMemoryRecordAdmission<T>[];
	readonly status: AgenticMemoryRecordAdmissionStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryRecordAdmissionAuditEntry[];
	readonly cursor: AgenticMemoryRecordAdmissionCursor;
}

export interface AgenticMemoryRecordAdmissionBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly proposals: Node<readonly AgenticMemoryRecordProposal<T>[]>;
		readonly policy: Node<AgenticMemoryRecordAdmissionPolicy>;
	};
	readonly projection: Node<AgenticMemoryRecordAdmissionSnapshot<T>>;
	readonly admissions: Node<readonly AgenticMemoryRecordAdmission<T>[]>;
	readonly admitted: Node<readonly AgenticMemoryRecordAdmission<T>[]>;
	readonly rejected: Node<readonly AgenticMemoryRecordAdmission<T>[]>;
	readonly needsReview: Node<readonly AgenticMemoryRecordAdmission<T>[]>;
	readonly status: Node<AgenticMemoryRecordAdmissionStatus>;
	readonly issues: Node<readonly DataIssue[]>;
	readonly audit: Node<readonly AgenticMemoryRecordAdmissionAuditEntry[]>;
	readonly cursor: Node<AgenticMemoryRecordAdmissionCursor>;
}

export interface AgenticMemoryRecordAdmissionBundleOptions<T = unknown> {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly proposals: Node<readonly AgenticMemoryRecordProposal<T>[]>;
	readonly policy: Node<AgenticMemoryRecordAdmissionPolicy>;
}

export interface AgenticMemoryRecordMetadata {
	readonly recordId: FactId;
	readonly kind: AgenticMemoryKind;
	readonly persistenceLevel: AgenticMemoryPersistenceLevel;
	readonly artifactKind: AgenticMemoryArtifactKind;
	readonly scope?: AgenticMemoryScope;
}

export interface AgenticMemoryProjectionCursor {
	readonly evaluation: number;
	readonly validRecords: number;
	readonly invalidRecords: number;
	readonly projectedFragments: number;
}

export type AgenticMemoryStatusState = "ready" | "empty" | "partial" | "error";

export interface AgenticMemoryStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryProjectionCursor;
}

export type AgenticMemoryErrorCode =
	| "duplicate-record-id"
	| "duplicate-fragment-id"
	| "invalid-records-input"
	| "invalid-record"
	| "invalid-record-kind"
	| "invalid-persistence-level"
	| "invalid-artifact-kind"
	| "invalid-scope"
	| "invalid-fragment";

export interface AgenticMemoryError {
	readonly code: AgenticMemoryErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly recordId?: FactId;
	readonly fragmentId?: FactId;
	readonly record?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryProjectionCursor;
}

export interface AgenticMemoryProjectionSnapshot<T = unknown> {
	readonly records: readonly AgenticMemoryRecord<T>[];
	readonly fragments: readonly MemoryFragment<T>[];
	readonly metadataByFragmentId: Readonly<Record<FactId, AgenticMemoryRecordMetadata>>;
	readonly status: AgenticMemoryStatus;
	readonly errors: readonly AgenticMemoryError[];
	readonly cursor: AgenticMemoryProjectionCursor;
}

/** Source/provenance projection for a valid memory fragment. */
export interface AgenticMemorySourceProjection {
	readonly fragmentId: FactId;
	readonly record?: AgenticMemoryRecordMetadata;
	readonly sources: readonly FactId[];
	readonly parentFragmentId?: FactId;
	readonly provenance?: string;
}

/** A context-ready item derived from ranked memory retrieval results. */
export interface AgenticMemoryContextEntry<T = unknown> {
	readonly fragmentId: FactId;
	readonly payload: T;
	readonly confidence: number;
	readonly tags: readonly string[];
	readonly sources: readonly FactId[];
	readonly record?: AgenticMemoryRecordMetadata;
	readonly fragment: MemoryFragment<T>;
}

export type AgenticMemoryContextState = "ready" | "empty" | "partial" | "error";

/**
 * Context-ready ranked memory output for callers such as prompt builders.
 *
 * This is still only a DATA fact. It does not extract, summarize, reflect, run
 * tools, or choose an autonomous action.
 */
export interface AgenticMemoryContext<T = unknown> {
	readonly state: AgenticMemoryContextState;
	readonly query: MemoryRetrievalQuery;
	readonly entries: readonly AgenticMemoryContextEntry<T>[];
	readonly cursor: MemoryRetrievalCursor;
	readonly errors: readonly AgenticMemoryError[];
	readonly retrievalErrors: readonly MemoryRetrievalError[];
	readonly contextReady: boolean;
}

/** Explicit KG assertion draft fact; extraction/LLM work happens outside this bundle. */
export interface AgenticMemoryKgAssertionDraft {
	readonly id: FactId;
	readonly recordId: FactId;
	readonly fragmentId: FactId;
	readonly subject: KnowledgeAssertionSubject;
	readonly predicate: string;
	readonly object: KnowledgeAssertionObject;
	readonly confidence?: number;
	readonly sources?: readonly FactId[];
	readonly provenance?: string;
}

export interface AgenticMemoryKgProjectionCursor {
	readonly evaluation: number;
	readonly validRecords: number;
	readonly validDrafts: number;
	readonly invalidDrafts: number;
	readonly projectedAssertions: number;
}

export type AgenticMemoryKgProjectionStatusState = AgenticMemoryStatusState;

export interface AgenticMemoryKgProjectionStatus {
	readonly state: AgenticMemoryKgProjectionStatusState;
	readonly cursor: AgenticMemoryKgProjectionCursor;
}

export type AgenticMemoryKgProjectionErrorCode =
	| AgenticMemoryErrorCode
	| "invalid-drafts-input"
	| "invalid-draft"
	| "duplicate-assertion-id"
	| "missing-record-ref"
	| "missing-fragment-ref"
	| "fragment-record-mismatch"
	| "invalid-assertion-shape";

export interface AgenticMemoryKgProjectionError {
	readonly code: AgenticMemoryKgProjectionErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly assertionId?: FactId;
	readonly recordId?: FactId;
	readonly fragmentId?: FactId;
	readonly draft?: unknown;
	readonly record?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryKgProjectionCursor;
}

export interface AgenticMemoryKgProjectionSnapshot {
	readonly assertions: readonly KnowledgeAssertion[];
	readonly status: AgenticMemoryKgProjectionStatus;
	readonly errors: readonly AgenticMemoryKgProjectionError[];
	readonly cursor: AgenticMemoryKgProjectionCursor;
}

export interface AgenticMemoryKgProjectionBundle {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord[]>;
		readonly drafts: Node<readonly AgenticMemoryKgAssertionDraft[]>;
	};
	readonly projection: Node<AgenticMemoryKgProjectionSnapshot>;
	readonly assertions: Node<readonly KnowledgeAssertion[]>;
	readonly status: Node<AgenticMemoryKgProjectionStatus>;
	readonly errors: Node<readonly AgenticMemoryKgProjectionError[]>;
	readonly cursor: Node<AgenticMemoryKgProjectionCursor>;
}

export interface AgenticMemoryKgProjectionBundleOptions {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord[]>;
	readonly drafts: Node<readonly AgenticMemoryKgAssertionDraft[]>;
}

export interface AgenticMemoryFragmentFrame<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly id: FactId;
	readonly payload: TJson;
	readonly tNs: string;
	readonly validFrom?: string;
	readonly validTo?: string;
	readonly confidence: number;
	readonly tags: readonly string[];
	readonly sources: readonly FactId[];
	readonly embedding?: readonly number[];
	readonly parentFragmentId?: FactId;
	readonly provenance?: string;
}

export interface AgenticMemoryRecordFrame<TJson extends StrictJsonValue = StrictJsonValue> {
	readonly format: typeof AGENTIC_MEMORY_RECORD_FRAME_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_RECORD_FRAME_VERSION;
	readonly record: {
		readonly id: FactId;
		readonly kind: AgenticMemoryKind;
		readonly persistenceLevel: AgenticMemoryPersistenceLevel;
		readonly artifactKind: AgenticMemoryArtifactKind;
		readonly scope?: AgenticMemoryScope;
		readonly fragment: AgenticMemoryFragmentFrame<TJson>;
	};
}

export type AgenticMemoryRetentionCommand =
	| {
			readonly id: FactId;
			readonly kind: "archive";
			readonly recordId: FactId;
			readonly reason?: string;
	  }
	| {
			readonly id: FactId;
			readonly kind: "restore";
			readonly recordId: FactId;
			readonly persistenceLevel?: Exclude<AgenticMemoryPersistenceLevel, "archived">;
			readonly reason?: string;
	  }
	| {
			readonly id: FactId;
			readonly kind: "setPersistenceLevel";
			readonly recordId: FactId;
			readonly persistenceLevel: AgenticMemoryPersistenceLevel;
			readonly reason?: string;
	  }
	| {
			readonly id: FactId;
			readonly kind: "requestConsolidation";
			readonly recordIds: readonly FactId[];
			readonly requestId?: FactId;
			readonly reason?: string;
	  };

export interface AgenticMemoryConsolidationRequest {
	readonly id: FactId;
	readonly commandId: FactId;
	readonly recordIds: readonly FactId[];
	readonly reason?: string;
}

export interface AgenticMemoryRetentionCursor {
	readonly evaluation: number;
	readonly validRecords: number;
	readonly validCommands: number;
	readonly invalidCommands: number;
	readonly activeRecords: number;
	readonly archivedRecords: number;
	readonly consolidationRequests: number;
}

export interface AgenticMemoryRetentionStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryRetentionCursor;
}

export type AgenticMemoryRetentionErrorCode =
	| AgenticMemoryErrorCode
	| "invalid-commands-input"
	| "invalid-command"
	| "duplicate-command-id"
	| "missing-record-ref";

export interface AgenticMemoryRetentionError {
	readonly code: AgenticMemoryRetentionErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly commandId?: FactId;
	readonly recordId?: FactId;
	readonly recordIds?: readonly FactId[];
	readonly command?: unknown;
	readonly record?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryRetentionCursor;
}

export interface AgenticMemoryRetentionSnapshot<T = unknown> {
	readonly activeRecords: readonly AgenticMemoryRecord<T>[];
	readonly archivedRecords: readonly AgenticMemoryRecord<T>[];
	readonly consolidationRequests: readonly AgenticMemoryConsolidationRequest[];
	readonly status: AgenticMemoryRetentionStatus;
	readonly errors: readonly AgenticMemoryRetentionError[];
	readonly cursor: AgenticMemoryRetentionCursor;
}

export interface AgenticMemoryRetentionBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly commands: Node<readonly AgenticMemoryRetentionCommand[]>;
	};
	readonly projection: Node<AgenticMemoryRetentionSnapshot<T>>;
	readonly activeRecords: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly archivedRecords: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly consolidationRequests: Node<readonly AgenticMemoryConsolidationRequest[]>;
	readonly status: Node<AgenticMemoryRetentionStatus>;
	readonly errors: Node<readonly AgenticMemoryRetentionError[]>;
	readonly cursor: Node<AgenticMemoryRetentionCursor>;
}

export interface AgenticMemoryRetentionBundleOptions<T = unknown> {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly commands: Node<readonly AgenticMemoryRetentionCommand[]>;
}

export type AgenticMemoryConsolidationOutcome<T = unknown> =
	| {
			readonly id: FactId;
			readonly requestId: FactId;
			readonly kind: "proposedRecords";
			readonly records: readonly AgenticMemoryRecord<T>[];
			readonly provenance?: string;
	  }
	| {
			readonly id: FactId;
			readonly requestId: FactId;
			readonly kind: "failed";
			readonly message: string;
			readonly provenance?: string;
	  };

export interface AgenticMemoryConsolidationRecordDraft<T = unknown> {
	readonly id: FactId;
	readonly requestId: FactId;
	readonly outcomeId: FactId;
	readonly record: AgenticMemoryRecord<T>;
}

export interface AgenticMemoryConsolidationCommand {
	readonly id: FactId;
	readonly kind: "proposeRecords" | "markFailed";
	readonly requestId: FactId;
	readonly outcomeId: FactId;
	readonly draftIds?: readonly FactId[];
	readonly message?: string;
}

export interface AgenticMemoryConsolidationResult {
	readonly id: FactId;
	readonly requestId: FactId;
	readonly outcomeId: FactId;
	readonly state: "proposed" | "failed";
	readonly sourceRecordIds: readonly FactId[];
	readonly proposedRecordIds: readonly FactId[];
	readonly message?: string;
	readonly provenance?: string;
}

export interface AgenticMemoryConsolidationCursor {
	readonly evaluation: number;
	readonly validRequests: number;
	readonly validOutcomes: number;
	readonly invalidOutcomes: number;
	readonly results: number;
	readonly proposedRecordDrafts: number;
}

export interface AgenticMemoryConsolidationStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryConsolidationCursor;
}

export type AgenticMemoryConsolidationErrorCode =
	| AgenticMemoryRetentionErrorCode
	| "invalid-outcomes-input"
	| "invalid-outcome"
	| "duplicate-outcome-id"
	| "missing-request-ref"
	| "invalid-proposed-record";

export interface AgenticMemoryConsolidationError {
	readonly code: AgenticMemoryConsolidationErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly outcomeId?: FactId;
	readonly requestId?: FactId;
	readonly recordId?: FactId;
	readonly outcome?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryConsolidationCursor;
}

export interface AgenticMemoryConsolidationSnapshot<T = unknown> {
	readonly results: readonly AgenticMemoryConsolidationResult[];
	readonly proposedRecordDrafts: readonly AgenticMemoryConsolidationRecordDraft<T>[];
	readonly commands: readonly AgenticMemoryConsolidationCommand[];
	readonly status: AgenticMemoryConsolidationStatus;
	readonly errors: readonly AgenticMemoryConsolidationError[];
	readonly cursor: AgenticMemoryConsolidationCursor;
}

export interface AgenticMemoryConsolidationBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly requests: Node<readonly AgenticMemoryConsolidationRequest[]>;
		readonly outcomes: Node<readonly AgenticMemoryConsolidationOutcome<T>[]>;
	};
	readonly projection: Node<AgenticMemoryConsolidationSnapshot<T>>;
	readonly results: Node<readonly AgenticMemoryConsolidationResult[]>;
	readonly proposedRecordDrafts: Node<readonly AgenticMemoryConsolidationRecordDraft<T>[]>;
	readonly commands: Node<readonly AgenticMemoryConsolidationCommand[]>;
	readonly status: Node<AgenticMemoryConsolidationStatus>;
	readonly errors: Node<readonly AgenticMemoryConsolidationError[]>;
	readonly cursor: Node<AgenticMemoryConsolidationCursor>;
}

export interface AgenticMemoryConsolidationBundleOptions<T = unknown> {
	readonly name?: string;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly requests: Node<readonly AgenticMemoryConsolidationRequest[]>;
	readonly outcomes: Node<readonly AgenticMemoryConsolidationOutcome<T>[]>;
}

export interface AgenticMemoryContextText {
	readonly fragmentId: FactId;
	readonly text: string;
	readonly cost?: number;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryContextPackingPolicy {
	readonly maxEntries?: number;
	readonly maxChars?: number;
	readonly maxCost?: number;
	readonly includeMetadata?: boolean;
}

export interface AgenticMemoryPackedContextEntry {
	readonly fragmentId: FactId;
	readonly text: string;
	readonly cost: number;
	readonly chars: number;
	readonly record?: AgenticMemoryRecordMetadata;
	readonly metadata?: Readonly<Record<string, StrictJsonValue>>;
}

export interface AgenticMemoryPackedContext {
	readonly entries: readonly AgenticMemoryPackedContextEntry[];
	readonly text: string;
	readonly totalChars: number;
	readonly totalCost: number;
	readonly truncated: boolean;
}

export interface AgenticMemoryContextPackingCursor {
	readonly evaluation: number;
	readonly inputEntries: number;
	readonly packedEntries: number;
	readonly omittedEntries: number;
	readonly totalChars: number;
	readonly totalCost: number;
}

export interface AgenticMemoryContextPackingStatus {
	readonly state: AgenticMemoryStatusState;
	readonly cursor: AgenticMemoryContextPackingCursor;
}

export type AgenticMemoryContextPackingErrorCode =
	| "invalid-context"
	| "invalid-texts-input"
	| "invalid-text"
	| "duplicate-text-fragment-id"
	| "missing-text"
	| "invalid-policy";

export interface AgenticMemoryContextPackingError {
	readonly code: AgenticMemoryContextPackingErrorCode;
	readonly message: string;
	readonly index?: number;
	readonly fragmentId?: FactId;
	readonly value?: unknown;
	readonly validationErrors?: readonly string[];
	readonly cursor: AgenticMemoryContextPackingCursor;
}

export interface AgenticMemoryContextPackingSnapshot {
	readonly packedContext: AgenticMemoryPackedContext;
	readonly status: AgenticMemoryContextPackingStatus;
	readonly errors: readonly AgenticMemoryContextPackingError[];
	readonly cursor: AgenticMemoryContextPackingCursor;
}

export interface AgenticMemoryContextPackingBundle<T = unknown> {
	readonly input: {
		readonly context: Node<AgenticMemoryContext<T>>;
		readonly texts: Node<readonly AgenticMemoryContextText[]>;
		readonly policy: Node<AgenticMemoryContextPackingPolicy>;
	};
	readonly projection: Node<AgenticMemoryContextPackingSnapshot>;
	readonly packedContext: Node<AgenticMemoryPackedContext>;
	readonly status: Node<AgenticMemoryContextPackingStatus>;
	readonly errors: Node<readonly AgenticMemoryContextPackingError[]>;
	readonly cursor: Node<AgenticMemoryContextPackingCursor>;
}

export interface AgenticMemoryContextPackingBundleOptions<T = unknown> {
	readonly name?: string;
	readonly context: Node<AgenticMemoryContext<T>>;
	readonly texts: Node<readonly AgenticMemoryContextText[]>;
	readonly policy: Node<AgenticMemoryContextPackingPolicy>;
}

export interface ValidatedPackingContext {
	readonly entries: readonly AgenticMemoryContextEntry[];
}

export interface AgenticMemoryBundle<T = unknown> {
	readonly input: {
		readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
		readonly query: Node<MemoryRetrievalQuery>;
	};
	readonly projection: Node<AgenticMemoryProjectionSnapshot<T>>;
	readonly retrieval: MemoryRetrievalBundle<T>;
	readonly retrievalSnapshot: Node<MemoryRetrievalSnapshot<T>>;
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	readonly fragments: Node<readonly MemoryFragment<T>[]>;
	readonly sources: Node<readonly AgenticMemorySourceProjection[]>;
	readonly indexed: Node<MemoryRetrievalIndex<T>>;
	readonly ranked: Node<MemoryAnswer<T>>;
	readonly context: Node<AgenticMemoryContext<T>>;
	readonly status: Node<AgenticMemoryStatus>;
	readonly errors: Node<readonly AgenticMemoryError[]>;
	readonly retrievalStatus: Node<MemoryRetrievalStatus>;
	readonly retrievalErrors: Node<readonly MemoryRetrievalError[]>;
	readonly cursor: Node<MemoryRetrievalCursor>;
}

export interface AgenticMemoryBundleOptions<T = unknown> {
	readonly name?: string;
	/** Explicit record-envelope input. Persistence, if needed, composes D161 outside this bundle. */
	readonly records: Node<readonly AgenticMemoryRecord<T>[]>;
	/** Explicit retrieval query input. */
	readonly query: Node<MemoryRetrievalQuery>;
}

/**
 * Compose graph-visible semantic-memory retrieval into an agentic-memory v0 bundle.
 *
 * The returned nodes are ordinary graph nodes with declared deps and DATA facts.
 * Invalid record envelopes and duplicate record ids stay graph-visible through
 * solution-level status/errors DATA facts. The lower retrieval bundle remains
 * visible and receives only projected MemoryFragment values.
 */
