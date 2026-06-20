import type { DataIssue } from "../../data/index.js";
import type { SourceRef } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemCreated,
	WorkItemDraft,
	WorkItemProjection,
	WorkItemSpawnProposed,
} from "./scheduling-types.js";

/**
 * Workspace-facing WorkItem policy effects (D398/D403/D407).
 * These are projection hints, not commands, runtime bindings, or closed enums.
 */
export type WorkItemPolicyEffect =
	| "attention-needs-me"
	| "attention-review"
	| "attention-waiting"
	| "attention-recent"
	| "side-panel-required-input"
	| "side-panel-context"
	| "side-panel-debug"
	| "topology-edge"
	| "duplicate-suppression"
	| "navigation-rollup"
	| "provenance-only"
	| (string & {});

/**
 * Open WorkItem type catalog entry over WorkItemDraft.kind (D398).
 * Default seeds are Task/Spike/Review, but callers may add or rename kinds.
 */
export interface WorkItemTypeCatalogEntry {
	readonly kind: string;
	readonly label: string;
	readonly description?: string;
	readonly hidden?: boolean;
	readonly order?: number;
	readonly requiredDraftFields?: readonly string[];
	readonly defaultDraft?: Partial<WorkItemDraft>;
	readonly projectionEffects?: readonly WorkItemPolicyEffect[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemTypeCatalog {
	readonly kind: "work-item-type-catalog";
	readonly catalogId: string;
	readonly entries: readonly WorkItemTypeCatalogEntry[];
	readonly defaultKind?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemActionPolicySeed {
	readonly kind: "work-item-action-policy-seed";
	readonly policyId: string;
	readonly typeCatalogId?: string;
	readonly allowedActionKinds?: readonly string[];
	readonly requiresConfirmation?: readonly string[];
	readonly requiresActorCapabilities?: readonly string[];
	readonly projectionEffects?: readonly WorkItemPolicyEffect[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export const DEFAULT_WORK_ITEM_TYPE_CATALOG_SEED = [
	{ kind: "task", label: "Task", order: 10 },
	{ kind: "spike", label: "Spike", order: 20 },
	{ kind: "review", label: "Review", order: 30 },
] as const satisfies readonly WorkItemTypeCatalogEntry[];

export type WorkItemLinkDirection = "directed" | "bidirectional";

/**
 * Open WorkItem link type catalog entry over WorkItemLinked.linkKind (D402/D403).
 * Projection effects describe display/attention behavior without owning link truth.
 */
export interface WorkItemLinkTypeCatalogEntry {
	readonly linkKind: string;
	readonly label: string;
	readonly inverseLabel?: string;
	readonly direction?: WorkItemLinkDirection;
	readonly hidden?: boolean;
	readonly order?: number;
	readonly defaultCollapsed?: boolean;
	readonly allowedFromKinds?: readonly string[];
	readonly allowedToKinds?: readonly string[];
	readonly cyclePolicy?: "allow" | "deny" | "review";
	readonly projectionEffects?: readonly WorkItemPolicyEffect[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemLinkTypeCatalog {
	readonly kind: "work-item-link-type-catalog";
	readonly catalogId: string;
	readonly entries: readonly WorkItemLinkTypeCatalogEntry[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export const DEFAULT_WORK_ITEM_LINK_TYPE_CATALOG_SEED = [
	{
		linkKind: "parent-child",
		label: "Parent",
		inverseLabel: "Child",
		direction: "directed",
		projectionEffects: ["navigation-rollup", "side-panel-context", "topology-edge"],
	},
	{
		linkKind: "blocks",
		label: "Blocks",
		inverseLabel: "Blocked by",
		direction: "directed",
		projectionEffects: ["attention-waiting", "side-panel-context", "topology-edge"],
	},
	{
		linkKind: "related",
		label: "Related",
		direction: "bidirectional",
		projectionEffects: ["side-panel-context"],
	},
	{
		linkKind: "duplicate",
		label: "Duplicate",
		inverseLabel: "Duplicate of",
		direction: "directed",
		projectionEffects: ["attention-review", "duplicate-suppression", "side-panel-context"],
	},
	{
		linkKind: "spawned-from",
		label: "Spawned from",
		direction: "directed",
		projectionEffects: ["provenance-only", "side-panel-context"],
	},
] as const satisfies readonly WorkItemLinkTypeCatalogEntry[];

/**
 * Append-only durable WorkItem relationship fact (D402).
 * Canvas may project this fact but must not directly mutate link truth.
 */
export interface WorkItemLinked {
	readonly kind: "work-item-linked";
	readonly eventId: string;
	readonly linkId: string;
	readonly fromWorkItemId: string;
	readonly toWorkItemId: string;
	readonly linkKind: string;
	readonly direction?: WorkItemLinkDirection;
	readonly sourceRefs?: readonly SourceRef[];
	readonly linkedAtMs?: number;
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemUnlinked {
	readonly kind: "work-item-unlinked";
	readonly eventId: string;
	readonly linkId: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly unlinkedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemLinkProjection {
	readonly linkId: string;
	readonly fromWorkItemId: string;
	readonly toWorkItemId: string;
	readonly linkKind: string;
	readonly direction: WorkItemLinkDirection;
	readonly active: boolean;
	readonly lastEventId: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemSpawnAdmissionOutcome = "admit" | "reject" | "defer" | "merge" | "duplicate";
export type WorkItemSpawnAdmissionState =
	| "admitted"
	| "rejected"
	| "deferred"
	| "merged"
	| "duplicate";

export interface WorkItemSpawnAdmissionDecision {
	readonly kind: "work-item-spawn-admission-decision";
	readonly decisionId: string;
	readonly admissionId: string;
	readonly proposalId: string;
	readonly outcome: WorkItemSpawnAdmissionOutcome;
	readonly policyId?: string;
	readonly targetProposalId?: string;
	readonly targetWorkItemId?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Admission result for WorkItemSpawnProposed (D397/D401).
 * This is visible domain material, not direct WorkItem mutation.
 */
export interface WorkItemSpawnAdmission {
	readonly kind: "work-item-spawn-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly state: WorkItemSpawnAdmissionState;
	readonly decisionId: string;
	readonly proposedWorkItemId?: string;
	readonly policyId?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly admittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemSpawnApplication<TInput = unknown> {
	readonly kind: "work-item-spawn-application";
	readonly applicationId: string;
	readonly admissionId: string;
	readonly proposalId: string;
	readonly state: Exclude<WorkItemSpawnAdmissionState, "admitted"> | "applied";
	readonly created?: WorkItemCreated<TInput>;
	readonly linkFacts?: readonly WorkItemLinked[];
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly appliedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type RequiredInputGateStatus =
	| "requested"
	| "response-proposed"
	| "satisfied"
	| "rejected"
	| "stale"
	| "retention-gap"
	| "mismatched";

export interface RequiredInputRequest {
	readonly kind: "required-input-request";
	readonly requestId: string;
	readonly workItemId: string;
	readonly fieldId?: string;
	readonly prompt: string;
	readonly schema?: Record<string, unknown>;
	readonly reason?: string;
	readonly required?: boolean;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly evidenceRefs?: readonly SourceRef[];
	readonly requestedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Graph-visible Required Input gate projection (D406).
 * User responses require proposal/admission/application before satisfaction.
 */
export interface RequiredInputGate {
	readonly kind: "required-input-gate";
	readonly gateId: string;
	readonly requestId: string;
	readonly workItemId: string;
	readonly status: RequiredInputGateStatus;
	readonly fieldId?: string;
	readonly prompt: string;
	readonly schema?: Record<string, unknown>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly evidenceRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface RequiredInputResponseProposed<TValue = unknown> {
	readonly kind: "required-input-response-proposed";
	readonly proposalId: string;
	readonly requestId: string;
	readonly workItemId: string;
	readonly value?: TValue;
	readonly summary?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly evidenceRefs?: readonly SourceRef[];
	readonly artifactRefs?: readonly SourceRef[];
	readonly proposedBy?: string;
	readonly proposedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface RequiredInputResponseAdmission {
	readonly kind: "required-input-response-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly requestId: string;
	readonly workItemId: string;
	readonly state: "admitted" | "rejected" | "deferred" | "merged";
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly admittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface RequiredInputResponseApplied<TValue = unknown> {
	readonly kind: "required-input-response-applied";
	readonly applicationId: string;
	readonly admissionId: string;
	readonly proposalId: string;
	readonly requestId: string;
	readonly workItemId: string;
	readonly value?: TValue;
	readonly summary?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly evidenceRefs?: readonly SourceRef[];
	readonly artifactRefs?: readonly SourceRef[];
	readonly appliedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type RecommendedActionTone = "neutral" | "attention" | "success" | "warning" | "danger";

export type RecommendedActionLoweringKind =
	| "work-item-spawn-proposed"
	| "work-item-domain-action-proposal-intake"
	| "required-input-response-proposed"
	| "work-item-link-proposal"
	| "admission-decision-proposal"
	| "ui-navigation"
	| (string & {});

/**
 * Side Panel recommended action view material (D407).
 * Button handlers lower to intents/proposals; this view is never a command.
 */
export interface RecommendedActionView {
	readonly kind: "recommended-action-view";
	readonly actionId: string;
	readonly label: string;
	readonly description?: string;
	readonly tone?: RecommendedActionTone;
	readonly priority?: number;
	readonly rank?: number;
	readonly disabledReason?: string;
	readonly confirmationRequired?: boolean;
	readonly formSchema?: Record<string, unknown>;
	readonly draftSeed?: WorkItemDraft | WorkItemSpawnProposed | RequiredInputResponseProposed;
	readonly targetRefs?: readonly SourceRef[];
	readonly loweringKind?: RecommendedActionLoweringKind;
	readonly loweringHints?: Record<string, unknown>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface SidePanelActionIntent<TDraft = unknown> {
	readonly kind: "side-panel-action-intent";
	readonly intentId: string;
	readonly actionId: string;
	readonly loweringKind: RecommendedActionLoweringKind;
	readonly workItemId?: string;
	readonly draft?: TDraft;
	readonly targetRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly submittedBy?: string;
	readonly submittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type WorkspaceMaterialSectionKind = "why-evidence" | "debug";

export interface WorkspaceMaterialSectionRef {
	readonly sectionKind: WorkspaceMaterialSectionKind;
	readonly label: string;
	readonly summary?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly evidenceRefs?: readonly SourceRef[];
	readonly artifactRefs?: readonly SourceRef[];
	readonly issues?: readonly DataIssue[];
	readonly collapsedByDefault?: boolean;
	readonly deliberateOpenOnly?: boolean;
	readonly dryRunOrFixture?: boolean;
	readonly metadata?: Record<string, unknown>;
}

export type WorkspaceFixtureBoundaryKind = "fixture" | "demo" | "story" | "dev-harness" | "test";

/**
 * Explicit marker for demo/test fixture entrypoints (D408).
 * Production fallback is intentionally impossible in this shape.
 */
export interface WorkspaceFixtureBoundary {
	readonly kind: "workspace-fixture-boundary";
	readonly boundaryId: string;
	readonly boundaryKind: WorkspaceFixtureBoundaryKind;
	readonly label: string;
	readonly visibleLabelRequired: true;
	readonly productionFallbackAllowed: false;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceWorkItemProjection<TInput = unknown> {
	readonly workItem: WorkItemProjection<TInput>;
	readonly typeCatalog?: WorkItemTypeCatalog;
	readonly links?: readonly WorkItemLinkProjection[];
	readonly requiredInput?: readonly RequiredInputGate[];
	readonly recommendedActions?: readonly RecommendedActionView[];
	readonly materialSections?: readonly WorkspaceMaterialSectionRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}
