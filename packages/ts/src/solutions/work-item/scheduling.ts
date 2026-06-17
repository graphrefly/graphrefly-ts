/**
 * WorkItem authoring, verification, and scheduling facts (D333-D343).
 *
 * This focused solution subpath is data-first glue. It emits graph-visible
 * projections, requests, results, status, issues, and audit facts; it does not
 * run verification, claim queues, dispatch executors, or mutate WorkItems.
 */

import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type {
	AgentOutputEnvelope,
	AgentRuntimeAuditRecord,
	EffectRunGoal,
	EffectRunLimits,
	EffectRunResult,
	EffectRunResultStatus,
	SourceRef,
} from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalSpec,
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../../orchestration/work-item-runtime.js";

export type WorkItemValidationIssueCode =
	| "malformed-draft"
	| "missing-required-field"
	| "invalid-patch"
	| "duplicate-id"
	| "dangling-ref"
	| "cyclic-dependency"
	| "unsupported-mode"
	| "unsupported-effect-kind"
	| "oversized-inline-data"
	| "policy-mismatch"
	| "missing-policy"
	| "stale-revision"
	| "stale-execution-input"
	| "blocked-prerequisite"
	| "verification-unplanned"
	| "manual-review-required"
	| "duplicate-suppressed"
	| "ambiguous-coverage"
	| "partial-coverage"
	| "unverifiable-output"
	| "unauthorized-author"
	| "unauthorized-target"
	| "invalid-schedule";

export type WorkItemValidationStatusState =
	| "projected"
	| "rejected"
	| "deferred"
	| "blocked"
	| "needs-human-review"
	| "stale"
	| "duplicate"
	| "request-emitted"
	| "result-recorded"
	| "domain-action-proposed";

export interface WorkItemValidationStatus {
	readonly kind: "work-item-validation-status";
	readonly statusId: string;
	readonly workItemId?: string;
	readonly state: WorkItemValidationStatusState;
	readonly code?: WorkItemValidationIssueCode;
	readonly revision?: number;
	readonly executionInputRevision?: number;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly stepId?: string;
	readonly criterionId?: string;
	readonly message?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface AcceptanceCriterion {
	readonly criterionId: string;
	readonly statement: string;
	readonly required?: boolean;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type VerificationStepMode = "auto" | "manual" | "hybrid";

export interface VerificationStep<TInput = unknown> {
	readonly stepId: string;
	readonly title?: string;
	readonly description?: string;
	readonly verifiesCriteriaIds?: readonly string[];
	readonly mode: VerificationStepMode;
	readonly effectKind?: string;
	readonly goal?: EffectRunGoal<TInput>;
	readonly input?: TInput;
	readonly contextRefs?: readonly SourceRef[];
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly dependsOnStepIds?: readonly string[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface VerificationPlan<TInput = unknown> {
	readonly planId: string;
	readonly planRevision?: string | number;
	readonly steps: readonly VerificationStep<TInput>[];
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDraft<TInput = unknown> {
	readonly summary: string;
	readonly detail?: string;
	readonly detailRefs?: readonly SourceRef[];
	readonly acceptanceCriteria?: readonly AcceptanceCriterion[];
	readonly verificationPlan?: VerificationPlan<TInput>;
	readonly verificationSteps?: readonly VerificationStep<TInput>[];
	readonly kind?: string;
	readonly priority?: number;
	readonly tags?: readonly string[];
	readonly owner?: string;
	readonly assignee?: string;
	readonly deadlineMs?: number;
	readonly customFields?: Record<string, unknown>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemPatch<TInput = unknown> = Partial<WorkItemDraft<TInput>>;

export interface WorkItemCreated<TInput = unknown> {
	readonly kind: "work-item-created";
	readonly eventId: string;
	readonly workItemId: string;
	readonly draft: WorkItemDraft<TInput>;
	readonly authorId?: string;
	readonly createdAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemPatched<TInput = unknown> {
	readonly kind: "work-item-patched";
	readonly eventId: string;
	readonly workItemId: string;
	readonly patch: WorkItemPatch<TInput>;
	readonly executionRelevantFields?: readonly string[];
	readonly authorId?: string;
	readonly patchedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface AcceptanceCriteriaChanged {
	readonly kind: "acceptance-criteria-changed";
	readonly eventId: string;
	readonly workItemId: string;
	readonly acceptanceCriteria: readonly AcceptanceCriterion[];
	readonly authorId?: string;
	readonly changedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface VerificationPlanChanged<TInput = unknown> {
	readonly kind: "verification-plan-changed";
	readonly eventId: string;
	readonly workItemId: string;
	readonly verificationPlan: VerificationPlan<TInput>;
	readonly authorId?: string;
	readonly changedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemAuthoringFact<TInput = unknown> =
	| WorkItemCreated<TInput>
	| WorkItemPatched<TInput>
	| AcceptanceCriteriaChanged
	| VerificationPlanChanged<TInput>;

export interface WorkItemSpawnProposed<TInput = unknown> {
	readonly kind: "work-item-spawn-proposed";
	readonly proposalId: string;
	readonly parentWorkItemId?: string;
	readonly draft: WorkItemDraft<TInput>;
	readonly proposedBy?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemAuthoringInput<TInput = unknown> =
	| WorkItemAuthoringFact<TInput>
	| WorkItemSpawnProposed<TInput>;

export interface WorkItemProjection<TInput = unknown> extends WorkItemDraft<TInput> {
	readonly workItemId: string;
	readonly authoringRevision: number;
	readonly executionInputRevision: number;
	readonly lastEventId: string;
	readonly revisionSourceRefs?: readonly SourceRef[];
	readonly createdAtMs?: number;
	readonly updatedAtMs?: number;
}

export interface WorkItemPriorityAssessment {
	readonly kind: "work-item-priority-assessment";
	readonly assessmentId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly priority?: number;
	readonly rank?: number;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemPlacementDecision {
	readonly kind: "work-item-placement-decision";
	readonly decisionId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly laneId: string;
	readonly targetKind?: string;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemScheduleDecision {
	readonly kind: "work-item-schedule-decision";
	readonly decisionId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision?: number;
	readonly targetKind: "work-item-effect" | "work-queue" | "executor" | "status";
	readonly effectKind?: string;
	readonly notBeforeMs?: number;
	readonly deadlineMs?: number;
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemDispatchIntent<TInput = unknown> {
	readonly kind: "work-item-dispatch-intent";
	readonly intentId: string;
	readonly workItemId: string;
	readonly authoringRevision?: number;
	readonly executionInputRevision: number;
	readonly targetKind:
		| "verification"
		| "approval"
		| "human-review"
		| "external-sync"
		| "spawn-review"
		| "background-evidence"
		| "executor";
	readonly effectKind?: string;
	readonly stepIds?: readonly string[];
	readonly acceptanceCriterionIds?: readonly string[];
	readonly goal?: EffectRunGoal<TInput>;
	readonly contextRefs?: readonly SourceRef[];
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly limits?: EffectRunLimits;
	readonly idempotencyKey?: string;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemAuthoringPolicy {
	readonly executionRelevantFields?: readonly string[];
}

export interface WorkItemAuthoringProjectorOptions<TInput = unknown> {
	readonly name?: string;
	readonly facts: Node<WorkItemAuthoringInput<TInput>>;
	readonly policy?: WorkItemAuthoringPolicy;
}

export interface WorkItemAuthoringProjectorBundle<TInput = unknown> {
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly status: Node<WorkItemValidationStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export interface WorkItemVerificationLowererPolicy {
	readonly policyId?: string;
	readonly autoRun?: boolean;
	readonly allowedModes?: readonly VerificationStepMode[];
	readonly allowedEffectKinds?: readonly string[];
	readonly stalePolicy?: "cancel" | "reschedule" | "requeue" | "replacement-intent" | "review";
}

export interface WorkItemVerificationRequestLowererOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly dispatchIntents?: Node<WorkItemDispatchIntent<TInput>>;
	readonly verificationResults?: Node<VerificationResultRecorded>;
	readonly policy?: WorkItemVerificationLowererPolicy;
}

export interface WorkItemVerificationRequestLowererBundle<TInput = unknown> {
	readonly effectRequests: Node<WorkItemEffectRequested<TInput>>;
	readonly status: Node<WorkItemValidationStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type VerificationResultStatus =
	| "passed"
	| "failed"
	| "blocked"
	| "canceled"
	| "timeout"
	| "waived"
	| "unverifiable";

export interface VerificationResultRecorded {
	readonly kind: "verification-result-recorded";
	readonly resultId: string;
	readonly workItemId: string;
	readonly evidenceId: string;
	readonly effectRunId: string;
	readonly effectRunResultId: string;
	readonly executionInputRevision: number;
	readonly verificationStepIds: readonly string[];
	readonly acceptanceCriterionIds: readonly string[];
	readonly status: VerificationResultStatus;
	readonly output?: AgentOutputEnvelope;
	readonly error?: DataIssue;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly recordedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemVerificationMappingPolicy {
	readonly kind: "work-item-verification-mapping-policy";
	readonly policyId: string;
	readonly actionProposals?: readonly WorkItemDomainActionProposalSpec[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemVerificationResultMapperOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly evidence: Node<WorkItemEvidenceRecorded>;
	readonly policies?: Node<WorkItemVerificationMappingPolicy>;
}

export interface WorkItemVerificationResultMapperBundle {
	readonly results: Node<VerificationResultRecorded>;
	readonly proposals: Node<WorkItemDomainActionProposal>;
	readonly status: Node<WorkItemValidationStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

export type WorkItemEffectPlanJoinPolicy = "all-required" | "evidence-only";

export interface WorkItemEffectPlanMember<TInput = unknown> {
	readonly memberId: string;
	readonly effectKind: string;
	readonly goal: EffectRunGoal<TInput>;
	readonly required?: boolean;
	readonly dependsOnMemberIds?: readonly string[];
	readonly contextRefs?: readonly SourceRef[];
	readonly requirements?: readonly string[];
	readonly capacityHints?: Record<string, unknown>;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanProposed<TInput = unknown> {
	readonly kind: "work-item-effect-plan-proposed";
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly members: readonly WorkItemEffectPlanMember<TInput>[];
	readonly joinPolicy?: WorkItemEffectPlanJoinPolicy;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly proposedBy?: string;
	readonly proposedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanSnapshot<TInput = unknown> {
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly members: readonly WorkItemEffectPlanMember<TInput>[];
	readonly joinPolicy: WorkItemEffectPlanJoinPolicy;
	readonly limits?: EffectRunLimits;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanAdmitted<TInput = unknown> {
	readonly kind: "work-item-effect-plan-admitted";
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly plan: WorkItemEffectPlanSnapshot<TInput>;
	readonly sourceRefs?: readonly SourceRef[];
	readonly admittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanRejected {
	readonly kind: "work-item-effect-plan-rejected";
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision?: number;
	readonly issues: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly rejectedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemEffectPlanMemberStatus =
	| "eligible"
	| "requested"
	| "blocked"
	| "deferred"
	| "evidence-recorded"
	| "completed"
	| "failed"
	| "duplicate"
	| "stale"
	| "rejected";

export interface WorkItemEffectPlanStatus {
	readonly kind: "work-item-effect-plan-status";
	readonly statusId: string;
	readonly workItemId: string;
	readonly planId: string;
	readonly executionInputRevision: number;
	readonly state: WorkItemEffectPlanMemberStatus;
	readonly planMemberId?: string;
	readonly requestId?: string;
	readonly effectRunId?: string;
	readonly evidenceId?: string;
	readonly effectRunResultId?: string;
	readonly issues?: readonly DataIssue[];
	readonly message?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemEffectPlanResultStatus = "succeeded" | "failed" | "evidence-only";

export interface WorkItemEffectPlanResult {
	readonly kind: "work-item-effect-plan-result";
	readonly resultId: string;
	readonly workItemId: string;
	readonly planId: string;
	readonly executionInputRevision: number;
	readonly status: WorkItemEffectPlanResultStatus;
	readonly memberResults: readonly {
		readonly planMemberId: string;
		readonly status: EffectRunResultStatus;
		readonly requestId?: string;
		readonly effectRunId?: string;
		readonly evidenceId?: string;
		readonly effectRunResultId?: string;
	}[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectPlanPolicy {
	readonly policyId?: string;
	readonly allowedEffectKinds?: readonly string[];
	readonly joinPolicy?: WorkItemEffectPlanJoinPolicy;
}

export interface WorkItemEffectPlanProjectorOptions<TInput = unknown> {
	readonly name?: string;
	readonly workItems: Node<WorkItemProjection<TInput>>;
	readonly proposals: Node<WorkItemEffectPlanProposed<TInput>>;
	readonly evidence?: Node<WorkItemEvidenceRecorded>;
	readonly effectRunResults?: Node<EffectRunResult>;
	readonly policy?: WorkItemEffectPlanPolicy;
	readonly now?: () => number;
}

export interface WorkItemEffectPlanProjectorBundle<TInput = unknown> {
	readonly admitted: Node<WorkItemEffectPlanAdmitted<TInput>>;
	readonly rejected: Node<WorkItemEffectPlanRejected>;
	readonly effectRequests: Node<WorkItemEffectRequested<TInput>>;
	readonly results: Node<WorkItemEffectPlanResult>;
	readonly status: Node<WorkItemEffectPlanStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

type Fact<T> =
	| { readonly kind: "work-item"; readonly value: WorkItemProjection<T> }
	| { readonly kind: "request"; readonly value: WorkItemEffectRequested<T> }
	| { readonly kind: "result"; readonly value: VerificationResultRecorded }
	| { readonly kind: "proposal"; readonly value: WorkItemDomainActionProposal }
	| { readonly kind: "status"; readonly value: WorkItemValidationStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

type PlanFact<T> =
	| { readonly kind: "admitted"; readonly value: WorkItemEffectPlanAdmitted<T> }
	| { readonly kind: "rejected"; readonly value: WorkItemEffectPlanRejected }
	| { readonly kind: "request"; readonly value: WorkItemEffectRequested<T> }
	| { readonly kind: "result"; readonly value: WorkItemEffectPlanResult }
	| { readonly kind: "status"; readonly value: WorkItemEffectPlanStatus }
	| { readonly kind: "issue"; readonly value: DataIssue }
	| { readonly kind: "audit"; readonly value: AgentRuntimeAuditRecord };

interface AuthoringState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly seenEvents: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

interface RequestState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly emittedKeys: Set<string>;
	readonly passedSteps: Map<string, Set<string>>;
	statusSeq: number;
	auditSeq: number;
}

interface ResultState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly policies: Map<string, WorkItemVerificationMappingPolicy>;
	readonly evidenceById: Map<string, WorkItemEvidenceRecorded>;
	readonly resultEvidence: Set<string>;
	readonly proposalKeys: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

interface PlanMemberEvidence {
	readonly status: EffectRunResultStatus;
	readonly requestId?: string;
	readonly effectRunId?: string;
	readonly evidenceId?: string;
	readonly effectRunResultId?: string;
	readonly sourceRefs?: readonly SourceRef[];
}

interface PlanState<T> {
	readonly workItems: Map<string, WorkItemProjection<T>>;
	readonly proposals: Map<string, WorkItemEffectPlanProposed<T>>;
	readonly admitted: Map<string, WorkItemEffectPlanAdmitted<T>>;
	readonly rejected: Set<string>;
	readonly emittedMemberKeys: Set<string>;
	readonly statusKeys: Set<string>;
	readonly resultKeys: Set<string>;
	readonly requestByEffectRun: Map<string, WorkItemEffectRequested<T>>;
	readonly requestByRequestId: Map<string, WorkItemEffectRequested<T>>;
	readonly memberEvidence: Map<string, PlanMemberEvidence>;
	readonly pendingEvidence: Map<string, WorkItemEvidenceRecorded>;
	readonly pendingResults: Map<string, EffectRunResult>;
	readonly unmatchedEvidence: Set<string>;
	readonly unmatchedResults: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

const executionRelevantDefaults = new Set([
	"detail",
	"detailRefs",
	"acceptanceCriteria",
	"verificationPlan",
	"verificationSteps",
	"dependencies",
]);

const draftPatchKeys = new Set([
	"summary",
	"detail",
	"detailRefs",
	"acceptanceCriteria",
	"verificationPlan",
	"verificationSteps",
	"kind",
	"priority",
	"tags",
	"owner",
	"assignee",
	"deadlineMs",
	"customFields",
	"sourceRefs",
	"metadata",
]);

export function workItemCreatedFromDraft<TInput = unknown>(
	workItemId: string,
	draft: WorkItemDraft<TInput>,
	opts: Partial<Omit<WorkItemCreated<TInput>, "kind" | "eventId" | "workItemId" | "draft">> & {
		readonly eventId?: string;
	} = {},
): WorkItemCreated<TInput> {
	return {
		kind: "work-item-created",
		eventId: opts.eventId ?? `${workItemId}:created`,
		workItemId,
		draft,
		authorId: opts.authorId,
		createdAtMs: opts.createdAtMs,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function workItemSpawnProposed<TInput = unknown>(
	proposalId: string,
	draft: WorkItemDraft<TInput>,
	opts: Partial<Omit<WorkItemSpawnProposed<TInput>, "kind" | "proposalId" | "draft">> = {},
): WorkItemSpawnProposed<TInput> {
	return {
		kind: "work-item-spawn-proposed",
		proposalId,
		draft,
		parentWorkItemId: opts.parentWorkItemId,
		proposedBy: opts.proposedBy,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function acceptanceCriteriaChanged(
	workItemId: string,
	acceptanceCriteria: readonly AcceptanceCriterion[],
	opts: Partial<
		Omit<AcceptanceCriteriaChanged, "kind" | "eventId" | "workItemId" | "acceptanceCriteria">
	> & {
		readonly eventId: string;
	},
): AcceptanceCriteriaChanged {
	return {
		kind: "acceptance-criteria-changed",
		eventId: opts.eventId,
		workItemId,
		acceptanceCriteria,
		authorId: opts.authorId,
		changedAtMs: opts.changedAtMs,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function verificationPlanChanged<TInput = unknown>(
	workItemId: string,
	verificationPlan: VerificationPlan<TInput>,
	opts: Partial<
		Omit<VerificationPlanChanged<TInput>, "kind" | "eventId" | "workItemId" | "verificationPlan">
	> & {
		readonly eventId: string;
	},
): VerificationPlanChanged<TInput> {
	return {
		kind: "verification-plan-changed",
		eventId: opts.eventId,
		workItemId,
		verificationPlan,
		authorId: opts.authorId,
		changedAtMs: opts.changedAtMs,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

export function validateWorkItemDraft<TInput>(
	draft: WorkItemDraft<TInput> | unknown,
	opts: { readonly workItemId?: string } = {},
): readonly DataIssue[] {
	const out: DataIssue[] = [];
	if (!isRecord(draft)) {
		return [issue("malformed-draft", "WorkItemDraft must be an object", opts.workItemId)];
	}
	if (typeof draft.summary !== "string") {
		out.push(issue("missing-required-field", "WorkItemDraft.summary is required", opts.workItemId));
	} else if (draft.summary.trim() === "") {
		out.push(issue("missing-required-field", "WorkItemDraft.summary is required", opts.workItemId));
	}
	const criteria =
		draft.acceptanceCriteria === undefined || Array.isArray(draft.acceptanceCriteria)
			? (draft.acceptanceCriteria as readonly AcceptanceCriterion[] | undefined)
			: undefined;
	if (draft.acceptanceCriteria !== undefined && criteria === undefined) {
		out.push(
			issue(
				"malformed-draft",
				"WorkItemDraft.acceptanceCriteria must be an array",
				opts.workItemId,
			),
		);
	}
	out.push(...validateAcceptanceCriteria(criteria ?? [], opts));
	if (draft.verificationPlan !== undefined && !isVerificationPlanShape(draft.verificationPlan)) {
		out.push(
			issue("malformed-draft", "WorkItemDraft.verificationPlan is malformed", opts.workItemId),
		);
	}
	if (draft.verificationSteps !== undefined && !Array.isArray(draft.verificationSteps)) {
		out.push(
			issue("malformed-draft", "WorkItemDraft.verificationSteps must be an array", opts.workItemId),
		);
	}
	const plan = normalizePlanFromUnknown(draft);
	if (plan !== undefined) {
		out.push(...validateVerificationPlan(plan, criteria ?? [], opts));
	}
	return out;
}

export function validateAcceptanceCriteria(
	criteria: readonly AcceptanceCriterion[],
	opts: { readonly workItemId?: string } = {},
): readonly DataIssue[] {
	const out: DataIssue[] = [];
	const seen = new Set<string>();
	for (const criterion of criteria) {
		if (!isRecord(criterion)) {
			out.push(issue("malformed-draft", "AcceptanceCriterion must be an object", opts.workItemId));
			continue;
		}
		if (typeof criterion.criterionId !== "string" || criterion.criterionId === "") {
			out.push(
				issue(
					"missing-required-field",
					"AcceptanceCriterion.criterionId is required",
					opts.workItemId,
				),
			);
			continue;
		}
		if (seen.has(criterion.criterionId)) {
			out.push(
				issue(
					"duplicate-id",
					`Duplicate acceptance criterion id '${criterion.criterionId}'`,
					opts.workItemId,
					{ criterionId: criterion.criterionId },
				),
			);
		}
		seen.add(criterion.criterionId);
		if (typeof criterion.statement !== "string" || criterion.statement.trim() === "") {
			out.push(
				issue(
					"missing-required-field",
					"AcceptanceCriterion.statement is required",
					opts.workItemId,
					{ criterionId: criterion.criterionId },
				),
			);
		}
	}
	return out;
}

export function validateVerificationPlan<TInput>(
	plan: VerificationPlan<TInput>,
	criteria: readonly AcceptanceCriterion[] = [],
	opts: {
		readonly workItemId?: string;
		readonly allowedModes?: readonly VerificationStepMode[];
		readonly allowedEffectKinds?: readonly string[];
	} = {},
): readonly DataIssue[] {
	const out: DataIssue[] = [];
	if (!isRecord(plan) || !Array.isArray(plan.steps)) {
		return [issue("malformed-draft", "VerificationPlan.steps must be an array", opts.workItemId)];
	}
	const criterionIds = new Set(criteria.map((criterion) => criterion.criterionId));
	const stepIds = new Set<string>();
	const modes = new Set(opts.allowedModes ?? ["auto", "manual", "hybrid"]);
	const effectKinds = new Set(opts.allowedEffectKinds ?? ["verification"]);
	for (const step of plan.steps) {
		if (!isRecord(step)) {
			out.push(issue("malformed-draft", "VerificationStep must be an object", opts.workItemId));
			continue;
		}
		if (typeof step.stepId !== "string" || step.stepId === "") {
			out.push(
				issue("missing-required-field", "VerificationStep.stepId is required", opts.workItemId),
			);
			continue;
		}
		if (stepIds.has(step.stepId)) {
			out.push(
				issue("duplicate-id", `Duplicate verification step id '${step.stepId}'`, opts.workItemId, {
					stepId: step.stepId,
				}),
			);
		}
		stepIds.add(step.stepId);
		if (typeof step.mode !== "string" || !modes.has(step.mode as VerificationStepMode)) {
			out.push(
				issue(
					"unsupported-mode",
					`Unsupported verification step mode '${step.mode}'`,
					opts.workItemId,
					{ stepId: step.stepId },
				),
			);
		}
		if (
			step.effectKind !== undefined &&
			(typeof step.effectKind !== "string" || !effectKinds.has(step.effectKind))
		) {
			out.push(
				issue(
					"unsupported-effect-kind",
					`Unsupported verification effect kind '${step.effectKind}'`,
					opts.workItemId,
					{ stepId: step.stepId },
				),
			);
		}
		const verifiesCriteriaIds = Array.isArray(step.verifiesCriteriaIds)
			? step.verifiesCriteriaIds
			: [];
		for (const criterionId of verifiesCriteriaIds) {
			if (!criterionIds.has(criterionId)) {
				out.push(
					issue("dangling-ref", `Unknown acceptance criterion '${criterionId}'`, opts.workItemId, {
						stepId: step.stepId,
						criterionId,
					}),
				);
			}
		}
	}
	for (const step of plan.steps) {
		if (!isRecord(step) || typeof step.stepId !== "string") continue;
		const dependsOnStepIds = Array.isArray(step.dependsOnStepIds) ? step.dependsOnStepIds : [];
		for (const depId of dependsOnStepIds) {
			if (!stepIds.has(depId)) {
				out.push(
					issue("dangling-ref", `Unknown verification dependency '${depId}'`, opts.workItemId, {
						stepId: step.stepId,
					}),
				);
			}
		}
	}
	const cycle = findCycle(
		plan.steps.filter(
			(step): step is VerificationStep =>
				isRecord(step) && typeof step.stepId === "string" && Array.isArray(step.dependsOnStepIds),
		),
	);
	if (cycle !== undefined) {
		out.push(
			issue(
				"cyclic-dependency",
				`Verification step cycle detected: ${cycle.join(" -> ")}`,
				opts.workItemId,
				{ stepId: cycle[0] },
			),
		);
	}
	return out;
}

export function workItemAuthoringProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkItemAuthoringProjectorOptions<TInput>,
): WorkItemAuthoringProjectorBundle<TInput> {
	const name = opts.name ?? "workItemAuthoring";
	const runtime = graph.node<Fact<TInput>>(
		[opts.facts],
		(ctx) => {
			const state = ctx.state.get<AuthoringState<TInput>>() ?? {
				workItems: new Map(),
				seenEvents: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? [])
				reduceAuthoring(ctx, state, raw as WorkItemAuthoringInput<TInput>, opts.policy);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemAuthoringProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		workItems: project(graph, runtime, `${name}/workItems`, "workItemAuthoringWorkItems", (fact) =>
			fact.kind === "work-item" ? fact.value : undefined,
		),
		status: project(graph, runtime, `${name}/status`, "workItemAuthoringStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemAuthoringIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemAuthoringAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

export function workItemVerificationRequestLowerer<TInput = unknown>(
	graph: Graph,
	opts: WorkItemVerificationRequestLowererOptions<TInput>,
): WorkItemVerificationRequestLowererBundle<TInput> {
	const name = opts.name ?? "workItemVerificationRequests";
	const deps: Node<unknown>[] = [opts.workItems];
	const dispatchIntentIndex =
		opts.dispatchIntents === undefined ? -1 : deps.push(opts.dispatchIntents) - 1;
	const verificationResultIndex =
		opts.verificationResults === undefined ? -1 : deps.push(opts.verificationResults) - 1;
	const runtime = graph.node<Fact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<RequestState<TInput>>() ?? {
				workItems: new Map(),
				emittedKeys: new Set(),
				passedSteps: new Map(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
				lowerPlan(ctx, state, workItem, opts.policy);
			}
			if (dispatchIntentIndex >= 0) {
				for (const raw of depBatch(ctx, dispatchIntentIndex) ?? [])
					lowerIntent(ctx, state, raw as WorkItemDispatchIntent<TInput>, opts.policy);
			}
			if (verificationResultIndex >= 0) {
				for (const raw of depBatch(ctx, verificationResultIndex) ?? [])
					recordVerificationResult(ctx, state, raw as VerificationResultRecorded, opts.policy);
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemVerificationRequestLowerer",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		effectRequests: project(
			graph,
			runtime,
			`${name}/effectRequests`,
			"workItemVerificationEffectRequests",
			(fact) => (fact.kind === "request" ? fact.value : undefined),
		),
		status: project(
			graph,
			runtime,
			`${name}/status`,
			"workItemVerificationRequestStatus",
			(fact) => (fact.kind === "status" ? fact.value : undefined),
		),
		issues: project(
			graph,
			runtime,
			`${name}/issues`,
			"workItemVerificationRequestIssues",
			(fact) => (fact.kind === "issue" ? fact.value : undefined),
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemVerificationRequestAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

export function workItemVerificationResultMapper<TInput = unknown>(
	graph: Graph,
	opts: WorkItemVerificationResultMapperOptions<TInput>,
): WorkItemVerificationResultMapperBundle {
	const name = opts.name ?? "workItemVerificationResults";
	const deps =
		opts.policies === undefined
			? [opts.workItems, opts.evidence]
			: [opts.workItems, opts.evidence, opts.policies];
	const runtime = graph.node<Fact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<ResultState<TInput>>() ?? {
				workItems: new Map(),
				policies: new Map(),
				evidenceById: new Map(),
				resultEvidence: new Set(),
				proposalKeys: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
				replayEvidence(ctx, state, workItem.workItemId);
			}
			if (opts.policies !== undefined) {
				for (const raw of depBatch(ctx, 2) ?? []) {
					const policy = raw as WorkItemVerificationMappingPolicy;
					const issues = validateMappingPolicy(policy);
					if (issues.length > 0) {
						for (const item of issues) emit(ctx, "issue", item);
						emitResultStatus(ctx, state, {
							state: "rejected",
							code: "policy-mismatch",
							metadata: { policyId: isRecord(policy) ? policy.policyId : undefined },
						});
						continue;
					}
					state.policies.set(policy.policyId, policy);
				}
				for (const evidence of state.evidenceById.values()) {
					mapEvidence(ctx, state, evidence, true);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? [])
				mapEvidence(ctx, state, raw as WorkItemEvidenceRecorded);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemVerificationResultMapper",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		results: project(graph, runtime, `${name}/results`, "workItemVerificationResults", (fact) =>
			fact.kind === "result" ? fact.value : undefined,
		),
		proposals: project(
			graph,
			runtime,
			`${name}/proposals`,
			"workItemVerificationProposals",
			(fact) => (fact.kind === "proposal" ? fact.value : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "workItemVerificationResultStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemVerificationResultIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemVerificationResultAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

export function validateWorkItemEffectPlan<TInput>(
	proposal: WorkItemEffectPlanProposed<TInput> | unknown,
	workItem: WorkItemProjection<TInput> | undefined,
	policy: WorkItemEffectPlanPolicy = {},
): readonly DataIssue[] {
	const out: DataIssue[] = [];
	if (
		!isRecord(proposal) ||
		proposal.kind !== "work-item-effect-plan-proposed" ||
		typeof proposal.planId !== "string" ||
		proposal.planId.trim() === "" ||
		typeof proposal.workItemId !== "string" ||
		proposal.workItemId.trim() === "" ||
		typeof proposal.executionInputRevision !== "number" ||
		!Array.isArray(proposal.members)
	) {
		return [
			issue(
				"malformed-draft",
				"WorkItemEffectPlanProposed requires planId, workItemId, executionInputRevision, and members",
				isRecord(proposal) && typeof proposal.workItemId === "string"
					? proposal.workItemId
					: undefined,
			),
		];
	}
	if (proposal.joinPolicy !== undefined && !isWorkItemEffectPlanJoinPolicy(proposal.joinPolicy)) {
		out.push(
			issue(
				"policy-mismatch",
				`Unsupported WorkItemEffectPlan join policy '${proposal.joinPolicy}'`,
				proposal.workItemId,
				{ planId: proposal.planId, joinPolicy: proposal.joinPolicy },
			),
		);
	}
	if (workItem === undefined) {
		out.push(
			issue(
				"dangling-ref",
				`WorkItemEffectPlan '${proposal.planId}' references unknown WorkItem '${proposal.workItemId}'`,
				proposal.workItemId,
				{ planId: proposal.planId },
			),
		);
	} else if (proposal.executionInputRevision !== workItem.executionInputRevision) {
		out.push(
			issue(
				"stale-execution-input",
				`WorkItemEffectPlan '${proposal.planId}' targets stale execution input`,
				proposal.workItemId,
				{
					planId: proposal.planId,
					proposedRevision: proposal.executionInputRevision,
					currentRevision: workItem.executionInputRevision,
				},
			),
		);
	}
	const memberIds = new Set<string>();
	const allowedEffectKinds =
		policy.allowedEffectKinds === undefined ? undefined : new Set(policy.allowedEffectKinds);
	for (const member of proposal.members) {
		if (!isRecord(member)) {
			out.push(
				issue(
					"malformed-draft",
					"WorkItemEffectPlan member must be an object",
					proposal.workItemId,
					{
						planId: proposal.planId,
					},
				),
			);
			continue;
		}
		if (typeof member.memberId !== "string" || member.memberId.trim() === "") {
			out.push(
				issue(
					"missing-required-field",
					"WorkItemEffectPlan memberId is required",
					proposal.workItemId,
					{ planId: proposal.planId },
				),
			);
			continue;
		}
		if (memberIds.has(member.memberId)) {
			out.push(
				issue(
					"duplicate-id",
					`Duplicate WorkItemEffectPlan member id '${member.memberId}'`,
					proposal.workItemId,
					{ planId: proposal.planId, planMemberId: member.memberId },
				),
			);
		}
		memberIds.add(member.memberId);
		if (typeof member.effectKind !== "string" || member.effectKind.trim() === "") {
			out.push(
				issue(
					"missing-required-field",
					"WorkItemEffectPlan member effectKind is required",
					proposal.workItemId,
					{ planId: proposal.planId, planMemberId: member.memberId },
				),
			);
		} else if (allowedEffectKinds !== undefined && !allowedEffectKinds.has(member.effectKind)) {
			out.push(
				issue(
					"unsupported-effect-kind",
					`Unsupported WorkItemEffectPlan effect kind '${member.effectKind}'`,
					proposal.workItemId,
					{ planId: proposal.planId, planMemberId: member.memberId },
				),
			);
		}
		if (!isRecord(member.goal)) {
			out.push(
				issue(
					"missing-required-field",
					"WorkItemEffectPlan member goal is required",
					proposal.workItemId,
					{ planId: proposal.planId, planMemberId: member.memberId },
				),
			);
		}
		for (const field of [
			"dependsOnMemberIds",
			"contextRefs",
			"requirements",
			"policyRefs",
			"sourceRefs",
		] as const) {
			if (member[field] !== undefined && !Array.isArray(member[field])) {
				out.push(
					issue(
						"malformed-draft",
						`WorkItemEffectPlan member ${field} must be an array`,
						proposal.workItemId,
						{ planId: proposal.planId, planMemberId: member.memberId, field },
					),
				);
			}
		}
	}
	for (const member of proposal.members) {
		if (!isRecord(member) || typeof member.memberId !== "string") continue;
		const deps = Array.isArray(member.dependsOnMemberIds) ? member.dependsOnMemberIds : [];
		for (const depId of deps) {
			if (!memberIds.has(depId)) {
				out.push(
					issue(
						"dangling-ref",
						`Unknown WorkItemEffectPlan dependency '${depId}'`,
						proposal.workItemId,
						{ planId: proposal.planId, planMemberId: member.memberId, depId },
					),
				);
			}
		}
	}
	const cycle = findPlanCycle(
		proposal.members.filter(
			(member): member is WorkItemEffectPlanMember<TInput> =>
				isRecord(member) &&
				typeof member.memberId === "string" &&
				Array.isArray(member.dependsOnMemberIds),
		),
	);
	if (cycle !== undefined) {
		out.push(
			issue(
				"cyclic-dependency",
				`WorkItemEffectPlan member cycle detected: ${cycle.join(" -> ")}`,
				proposal.workItemId,
				{ planId: proposal.planId, planMemberId: cycle[0] },
			),
		);
	}
	return out;
}

export function workItemEffectPlanProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkItemEffectPlanProjectorOptions<TInput>,
): WorkItemEffectPlanProjectorBundle<TInput> {
	const name = opts.name ?? "workItemEffectPlans";
	const deps: Node<unknown>[] = [opts.workItems, opts.proposals];
	const evidenceIndex = opts.evidence === undefined ? -1 : deps.push(opts.evidence) - 1;
	const resultIndex =
		opts.effectRunResults === undefined ? -1 : deps.push(opts.effectRunResults) - 1;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<PlanFact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<PlanState<TInput>>() ?? emptyPlanState<TInput>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
				for (const proposal of state.proposals.values()) {
					if (proposal.workItemId === workItem.workItemId)
						admitPlan(ctx, state, proposal, opts.policy, now);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const proposal = raw as WorkItemEffectPlanProposed<TInput>;
				if (
					isRecord(proposal) &&
					typeof proposal.planId === "string" &&
					typeof proposal.workItemId === "string"
				) {
					const key = planKey(
						proposal.workItemId,
						proposal.planId,
						proposal.executionInputRevision,
					);
					if (key !== undefined) state.proposals.set(key, proposal);
				}
				admitPlan(ctx, state, proposal, opts.policy, now);
			}
			if (evidenceIndex >= 0) {
				for (const raw of depBatch(ctx, evidenceIndex) ?? [])
					recordPlanEvidence(ctx, state, raw as WorkItemEvidenceRecorded);
			}
			if (resultIndex >= 0) {
				for (const raw of depBatch(ctx, resultIndex) ?? [])
					recordPlanResult(ctx, state, raw as EffectRunResult);
			}
			drainPlanWork(ctx, state, opts.policy);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemEffectPlanProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		admitted: project(graph, runtime, `${name}/admitted`, "workItemEffectPlansAdmitted", (fact) =>
			fact.kind === "admitted" ? fact.value : undefined,
		),
		rejected: project(graph, runtime, `${name}/rejected`, "workItemEffectPlansRejected", (fact) =>
			fact.kind === "rejected" ? fact.value : undefined,
		),
		effectRequests: project(
			graph,
			runtime,
			`${name}/effectRequests`,
			"workItemEffectPlanEffectRequests",
			(fact) => (fact.kind === "request" ? fact.value : undefined),
		),
		results: project(graph, runtime, `${name}/results`, "workItemEffectPlanResults", (fact) =>
			fact.kind === "result" ? fact.value : undefined,
		),
		status: project(graph, runtime, `${name}/status`, "workItemEffectPlanStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemEffectPlanIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemEffectPlanAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

function emptyPlanState<T>(): PlanState<T> {
	return {
		workItems: new Map(),
		proposals: new Map(),
		admitted: new Map(),
		rejected: new Set(),
		emittedMemberKeys: new Set(),
		statusKeys: new Set(),
		resultKeys: new Set(),
		requestByEffectRun: new Map(),
		requestByRequestId: new Map(),
		memberEvidence: new Map(),
		pendingEvidence: new Map(),
		pendingResults: new Map(),
		unmatchedEvidence: new Set(),
		unmatchedResults: new Set(),
		statusSeq: 0,
		auditSeq: 0,
	};
}

function admitPlan<T>(
	ctx: Ctx,
	state: PlanState<T>,
	proposal: WorkItemEffectPlanProposed<T>,
	policy: WorkItemEffectPlanPolicy | undefined,
	now: () => number,
): void {
	if (!isRecord(proposal) || typeof proposal.planId !== "string") {
		const issues = validateWorkItemEffectPlan(proposal, undefined, policy);
		emitPlanIssues(ctx, state, issues);
		return;
	}
	const key = planKey(proposal.workItemId, proposal.planId, proposal.executionInputRevision);
	if (key === undefined) {
		const issues = validateWorkItemEffectPlan(proposal, undefined, policy);
		emitPlanIssues(ctx, state, issues);
		return;
	}
	if (state.admitted.has(key) || state.rejected.has(key)) return;
	const workItem = state.workItems.get(proposal.workItemId);
	if (workItem === undefined) {
		emitPlanStatusOnce(ctx, state, `${key}:deferred:missing-work-item`, {
			workItemId: proposal.workItemId,
			planId: proposal.planId,
			executionInputRevision: proposal.executionInputRevision,
			state: "deferred",
			message: `WorkItemEffectPlan '${proposal.planId}' is waiting for WorkItem '${proposal.workItemId}'`,
			sourceRefs: proposal.sourceRefs,
			metadata: { reason: "missing-work-item" },
		});
		return;
	}
	const issues = validateWorkItemEffectPlan(proposal, workItem, policy);
	if (issues.length > 0) {
		state.rejected.add(key);
		emitPlanIssues(ctx, state, issues);
		const rejected: WorkItemEffectPlanRejected = {
			kind: "work-item-effect-plan-rejected",
			planId: proposal.planId,
			workItemId: proposal.workItemId,
			executionInputRevision: proposal.executionInputRevision,
			issues,
			sourceRefs: proposal.sourceRefs,
			rejectedAtMs: now(),
			metadata: proposal.metadata,
		};
		emitPlan(ctx, "rejected", rejected);
		emitPlanStatus(ctx, state, {
			workItemId: proposal.workItemId,
			planId: proposal.planId,
			executionInputRevision: proposal.executionInputRevision,
			state: "rejected",
			issues,
			sourceRefs: proposal.sourceRefs,
			metadata: { issueCodes: issues.map((item) => item.code) },
		});
		return;
	}
	const snapshot = normalizeEffectPlanSnapshot(proposal, policy);
	const admitted: WorkItemEffectPlanAdmitted<T> = {
		kind: "work-item-effect-plan-admitted",
		planId: snapshot.planId,
		workItemId: snapshot.workItemId,
		executionInputRevision: snapshot.executionInputRevision,
		plan: snapshot,
		sourceRefs: immutableClone(proposal.sourceRefs),
		admittedAtMs: now(),
		metadata: immutableClone(proposal.metadata),
	};
	state.admitted.set(key, admitted);
	emitPlan(ctx, "admitted", admitted);
	emitPlanStatus(ctx, state, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: "eligible",
		sourceRefs: admitted.sourceRefs,
		metadata: { memberCount: admitted.plan.members.length },
	});
}

function drainPlanWork<T>(ctx: Ctx, state: PlanState<T>, policy?: WorkItemEffectPlanPolicy): void {
	const maxPasses =
		state.admitted.size +
		state.pendingEvidence.size +
		state.pendingResults.size +
		state.emittedMemberKeys.size +
		1;
	for (let pass = 0; pass < maxPasses; pass += 1) {
		let changed = false;
		for (const admitted of state.admitted.values()) {
			changed = lowerEligiblePlanMembers(ctx, state, admitted, policy) || changed;
			derivePlanResult(ctx, state, admitted);
		}
		changed = replayPendingPlanFacts(ctx, state) || changed;
		if (!changed) break;
	}
	for (const admitted of state.admitted.values()) derivePlanResult(ctx, state, admitted);
}

function lowerEligiblePlanMembers<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	policy?: WorkItemEffectPlanPolicy,
): boolean {
	if (isAdmittedPlanStale(state, admitted)) {
		emitStaleAdmittedPlanOnce(ctx, state, admitted);
		return false;
	}
	let changed = false;
	for (const member of admitted.plan.members) {
		const coord = memberCoord(admitted, member.memberId);
		if (state.memberEvidence.has(coord)) continue;
		const missing = (member.dependsOnMemberIds ?? []).filter(
			(memberId) => !memberSucceeded(state, admitted, memberId),
		);
		if (missing.length > 0) {
			emitPlanStatusOnce(ctx, state, `${coord}:blocked:${missing.join(",")}`, {
				workItemId: admitted.workItemId,
				planId: admitted.planId,
				executionInputRevision: admitted.executionInputRevision,
				state: "blocked",
				planMemberId: member.memberId,
				issues: [
					issue(
						"blocked-prerequisite",
						`WorkItemEffectPlan member '${member.memberId}' is blocked by prerequisites`,
						admitted.workItemId,
						{ planId: admitted.planId, planMemberId: member.memberId, missingMemberIds: missing },
					),
				],
				sourceRefs: member.sourceRefs,
				metadata: { missingMemberIds: missing },
			});
			continue;
		}
		if (state.emittedMemberKeys.has(coord)) continue;
		state.emittedMemberKeys.add(coord);
		changed = true;
		const request = requestFromPlanMember(admitted, member, policy);
		state.requestByEffectRun.set(request.effectRunId, request);
		state.requestByRequestId.set(request.requestId, request);
		emitPlan(ctx, "request", request);
		emitPlanStatus(ctx, state, {
			workItemId: admitted.workItemId,
			planId: admitted.planId,
			executionInputRevision: admitted.executionInputRevision,
			state: "requested",
			planMemberId: member.memberId,
			requestId: request.requestId,
			effectRunId: request.effectRunId,
			sourceRefs: request.sourceRefs,
			metadata: { effectKind: request.effectKind },
		});
	}
	return changed;
}

function recordPlanEvidence<T>(
	ctx: Ctx,
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
): boolean {
	const coordinate = planCoordinateFromEvidence(state, evidence);
	if (coordinate === undefined) {
		state.pendingEvidence.set(evidence.evidenceId, evidence);
		emitUnmatchedEvidence(ctx, state, `evidence:${evidence.evidenceId}`, evidence.workItemId, {
			evidenceId: evidence.evidenceId,
			effectRunId: evidence.effectRunId,
		});
		return false;
	}
	if (emitConflictingPlanEvidenceCoordinate(ctx, state, evidence, coordinate)) return true;
	const key = requiredPlanKey(
		coordinate.workItemId,
		coordinate.planId,
		coordinate.executionInputRevision,
	);
	const admitted = state.admitted.get(key);
	if (admitted === undefined) {
		state.pendingEvidence.set(evidence.evidenceId, evidence);
		emitUnmatchedEvidence(ctx, state, `evidence:${evidence.evidenceId}`, coordinate.workItemId, {
			evidenceId: evidence.evidenceId,
			effectRunId: evidence.effectRunId,
			planId: coordinate.planId,
			planMemberId: coordinate.planMemberId,
			executionInputRevision: coordinate.executionInputRevision,
		});
		return false;
	}
	if (isAdmittedPlanStale(state, admitted)) {
		emitStaleAdmittedPlanOnce(ctx, state, admitted);
		return true;
	}
	if (!hasPlanMember(admitted, coordinate.planMemberId)) {
		emitUnknownPlanMember(ctx, state, admitted, coordinate.planMemberId, {
			evidenceId: evidence.evidenceId,
			effectRunId: evidence.effectRunId,
		});
		return true;
	}
	const recorded = recordMemberEvidence(ctx, state, admitted, coordinate.planMemberId, {
		status: evidence.status,
		requestId: coordinate.requestId ?? coordinate.request?.requestId,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		effectRunResultId: evidence.effectRunResultId,
		sourceRefs: evidence.sourceRefs,
	});
	if (!recorded) return true;
	emitPlanStatus(ctx, state, {
		workItemId: coordinate.workItemId,
		planId: coordinate.planId,
		executionInputRevision: coordinate.executionInputRevision,
		state: evidence.status === "completed" ? "completed" : "failed",
		planMemberId: coordinate.planMemberId,
		requestId: coordinate.requestId ?? coordinate.request?.requestId,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		effectRunResultId: evidence.effectRunResultId,
		sourceRefs: evidence.sourceRefs,
		metadata: { evidenceStatus: evidence.status },
	});
	return true;
}

function emitConflictingPlanEvidenceCoordinate<T>(
	ctx: Ctx,
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
	coordinate: PlanCoordinate<T>,
): boolean {
	const expectedRequest = planRequestForCoordinate(state, coordinate);
	const expectedRequestIdMismatch =
		expectedRequest !== undefined &&
		evidence.requestId !== undefined &&
		evidence.requestId !== expectedRequest.requestId;
	if (
		expectedRequest !== undefined &&
		(expectedRequestIdMismatch || evidence.effectRunId !== expectedRequest.effectRunId)
	) {
		emitPlanEvidenceCoordinateMismatch(ctx, state, evidence, coordinate, expectedRequest);
		return true;
	}
	const requestRefs = [
		evidence.requestId === undefined ? undefined : state.requestByRequestId.get(evidence.requestId),
		state.requestByEffectRun.get(evidence.effectRunId),
	].filter((request): request is WorkItemEffectRequested<T> => request !== undefined);
	const conflicting = requestRefs.find(
		(request) =>
			!requestMatchesPlanCoordinate(request, coordinate) ||
			!requestMatchesEvidenceIdentity(request, evidence),
	);
	if (conflicting === undefined) return false;
	emitPlanEvidenceCoordinateMismatch(ctx, state, evidence, coordinate, conflicting);
	return true;
}

function emitPlanEvidenceCoordinateMismatch<T>(
	ctx: Ctx,
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
	coordinate: PlanCoordinate<T>,
	conflicting: WorkItemEffectRequested<T>,
): void {
	const item = issue(
		"dangling-ref",
		"WorkItemEffectPlan evidence request/effectRun coordinates do not match its plan member coordinates",
		evidence.workItemId,
		{
			evidenceId: evidence.evidenceId,
			requestId: evidence.requestId,
			effectRunId: evidence.effectRunId,
			planId: coordinate.planId,
			planMemberId: coordinate.planMemberId,
			executionInputRevision: coordinate.executionInputRevision,
			requestPlanId: conflicting.planId,
			requestPlanMemberId: conflicting.planMemberId,
			requestExecutionInputRevision: conflicting.executionInputRevision,
		},
	);
	emitPlan(ctx, "issue", item);
	emitPlanStatus(ctx, state, {
		workItemId: coordinate.workItemId,
		planId: coordinate.planId,
		executionInputRevision: coordinate.executionInputRevision,
		state: "rejected",
		planMemberId: coordinate.planMemberId,
		requestId: evidence.requestId,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		issues: [item],
		sourceRefs: evidence.sourceRefs,
		metadata: item.metadata,
	});
}

function requestMatchesPlanCoordinate<T>(
	request: WorkItemEffectRequested<T>,
	coordinate: PlanCoordinate<T>,
): boolean {
	return (
		request.workItemId === coordinate.workItemId &&
		request.planId === coordinate.planId &&
		request.planMemberId === coordinate.planMemberId &&
		request.executionInputRevision === coordinate.executionInputRevision
	);
}

function requestMatchesEvidenceIdentity<T>(
	request: WorkItemEffectRequested<T>,
	evidence: WorkItemEvidenceRecorded,
): boolean {
	return (
		(evidence.requestId === undefined || evidence.requestId === request.requestId) &&
		evidence.effectRunId === request.effectRunId
	);
}

function planRequestForCoordinate<T>(
	state: PlanState<T>,
	coordinate: PlanCoordinate<T>,
): WorkItemEffectRequested<T> | undefined {
	for (const request of state.requestByRequestId.values()) {
		if (requestMatchesPlanCoordinate(request, coordinate)) return request;
	}
	return undefined;
}

function recordPlanResult<T>(ctx: Ctx, state: PlanState<T>, result: EffectRunResult): boolean {
	const coordinate = planCoordinateFromResult(state, result);
	if (coordinate === undefined) {
		state.pendingResults.set(result.resultId, result);
		emitUnmatchedEvidence(ctx, state, `result:${result.resultId}`, undefined, {
			effectRunResultId: result.resultId,
			effectRunId: result.effectRunId,
		});
		return false;
	}
	const key = requiredPlanKey(
		coordinate.workItemId,
		coordinate.planId,
		coordinate.executionInputRevision,
	);
	const admitted = state.admitted.get(key);
	if (admitted === undefined) {
		state.pendingResults.set(result.resultId, result);
		emitUnmatchedEvidence(ctx, state, `result:${result.resultId}`, coordinate.workItemId, {
			effectRunResultId: result.resultId,
			effectRunId: result.effectRunId,
			planId: coordinate.planId,
			planMemberId: coordinate.planMemberId,
			executionInputRevision: coordinate.executionInputRevision,
		});
		return false;
	}
	if (isAdmittedPlanStale(state, admitted)) {
		emitStaleAdmittedPlanOnce(ctx, state, admitted);
		return true;
	}
	if (!hasPlanMember(admitted, coordinate.planMemberId)) {
		emitUnknownPlanMember(ctx, state, admitted, coordinate.planMemberId, {
			effectRunResultId: result.resultId,
			effectRunId: result.effectRunId,
		});
		return true;
	}
	const recorded = recordMemberEvidence(ctx, state, admitted, coordinate.planMemberId, {
		status: result.status,
		requestId: coordinate.request?.requestId,
		effectRunId: result.effectRunId,
		effectRunResultId: result.resultId,
		sourceRefs: result.sourceRefs,
	});
	if (!recorded) return true;
	emitPlanStatus(ctx, state, {
		workItemId: coordinate.workItemId,
		planId: coordinate.planId,
		executionInputRevision: coordinate.executionInputRevision,
		state: result.status === "completed" ? "completed" : "failed",
		planMemberId: coordinate.planMemberId,
		requestId: coordinate.request?.requestId,
		effectRunId: result.effectRunId,
		effectRunResultId: result.resultId,
		sourceRefs: result.sourceRefs,
		metadata: { resultStatus: result.status },
	});
	return true;
}

function replayPendingPlanFacts<T>(ctx: Ctx, state: PlanState<T>): boolean {
	let changed = false;
	for (const [evidenceId, evidence] of [...state.pendingEvidence]) {
		if (recordPlanEvidence(ctx, state, evidence)) {
			state.pendingEvidence.delete(evidenceId);
			changed = true;
		}
	}
	for (const [resultId, result] of [...state.pendingResults]) {
		if (recordPlanResult(ctx, state, result)) {
			state.pendingResults.delete(resultId);
			changed = true;
		}
	}
	return changed;
}

interface PlanCoordinate<T> {
	readonly workItemId: string;
	readonly planId: string;
	readonly executionInputRevision: number;
	readonly planMemberId: string;
	readonly requestId?: string;
	readonly request?: WorkItemEffectRequested<T>;
}

function planCoordinateFromEvidence<T>(
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
): PlanCoordinate<T> | undefined {
	const topLevelRequest =
		evidence.requestId === undefined ? undefined : state.requestByRequestId.get(evidence.requestId);
	const effectRunRequest = state.requestByEffectRun.get(evidence.effectRunId);
	if (
		evidence.planId !== undefined &&
		evidence.planMemberId !== undefined &&
		evidence.executionInputRevision !== undefined
	) {
		return {
			workItemId: evidence.workItemId,
			planId: evidence.planId,
			executionInputRevision: evidence.executionInputRevision,
			planMemberId: evidence.planMemberId,
			requestId: topLevelRequest?.requestId ?? effectRunRequest?.requestId ?? evidence.requestId,
			request: topLevelRequest ?? effectRunRequest,
		};
	}
	const request = effectRunRequest;
	if (
		request?.planId !== undefined &&
		request.planMemberId !== undefined &&
		request.executionInputRevision !== undefined
	) {
		return {
			workItemId: request.workItemId,
			planId: request.planId,
			executionInputRevision: request.executionInputRevision,
			planMemberId: request.planMemberId,
			requestId: request.requestId,
			request,
		};
	}
	const planId = stringMetadata(evidence.metadata, "planId");
	const planMemberId = stringMetadata(evidence.metadata, "planMemberId");
	const executionInputRevision = numberMetadata(evidence.metadata, "executionInputRevision");
	const requestId = stringMetadata(evidence.metadata, "requestId");
	if (planId === undefined || planMemberId === undefined || executionInputRevision === undefined)
		return undefined;
	return {
		workItemId: evidence.workItemId,
		planId,
		executionInputRevision,
		planMemberId,
		requestId,
	};
}

function planCoordinateFromResult<T>(
	state: PlanState<T>,
	result: EffectRunResult,
): PlanCoordinate<T> | undefined {
	const request = state.requestByEffectRun.get(result.effectRunId);
	if (
		request?.planId !== undefined &&
		request.planMemberId !== undefined &&
		request.executionInputRevision !== undefined
	) {
		return {
			workItemId: request.workItemId,
			planId: request.planId,
			executionInputRevision: request.executionInputRevision,
			planMemberId: request.planMemberId,
			requestId: request.requestId,
			request,
		};
	}
	const workItemId =
		sourceRefId(result.subjectRefs, "work-item") ?? sourceRefId(result.sourceRefs, "work-item");
	const planId = stringMetadata(result.metadata, "planId");
	const planMemberId = stringMetadata(result.metadata, "planMemberId");
	const executionInputRevision = numberMetadata(result.metadata, "executionInputRevision");
	if (
		workItemId === undefined ||
		planId === undefined ||
		planMemberId === undefined ||
		executionInputRevision === undefined
	)
		return undefined;
	return { workItemId, planId, executionInputRevision, planMemberId };
}

function recordMemberEvidence<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	planMemberId: string,
	evidence: PlanMemberEvidence,
): boolean {
	const coord = memberCoord(admitted, planMemberId);
	const existing = state.memberEvidence.get(coord);
	if (existing !== undefined) {
		const duplicateIssue = issue(
			"duplicate-suppressed",
			`WorkItemEffectPlan member '${planMemberId}' already has terminal evidence`,
			admitted.workItemId,
			{
				planId: admitted.planId,
				planMemberId,
				existingEvidenceId: existing.evidenceId,
				existingEffectRunResultId: existing.effectRunResultId,
				evidenceId: evidence.evidenceId,
				effectRunResultId: evidence.effectRunResultId,
			},
		);
		emitPlan(ctx, "issue", duplicateIssue);
		emitPlanStatus(ctx, state, {
			workItemId: admitted.workItemId,
			planId: admitted.planId,
			executionInputRevision: admitted.executionInputRevision,
			state: "duplicate",
			planMemberId,
			requestId: evidence.requestId,
			effectRunId: evidence.effectRunId,
			evidenceId: evidence.evidenceId,
			effectRunResultId: evidence.effectRunResultId,
			issues: [duplicateIssue],
			sourceRefs: evidence.sourceRefs,
		});
		return false;
	}
	state.memberEvidence.set(coord, evidence);
	return true;
}

function hasPlanMember<T>(admitted: WorkItemEffectPlanAdmitted<T>, planMemberId: string): boolean {
	return admitted.plan.members.some((member) => member.memberId === planMemberId);
}

function isAdmittedPlanStale<T>(
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
): boolean {
	const current = state.workItems.get(admitted.workItemId);
	return (
		current !== undefined && current.executionInputRevision !== admitted.executionInputRevision
	);
}

function emitStaleAdmittedPlanOnce<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
): void {
	const current = state.workItems.get(admitted.workItemId);
	emitPlanStatusOnce(ctx, state, `${memberCoord(admitted, "plan")}:stale`, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: "stale",
		issues: [
			issue(
				"stale-execution-input",
				`WorkItemEffectPlan '${admitted.planId}' targets stale execution input`,
				admitted.workItemId,
				{
					planId: admitted.planId,
					proposedRevision: admitted.executionInputRevision,
					currentRevision: current?.executionInputRevision,
				},
			),
		],
		sourceRefs: admitted.sourceRefs,
		metadata: { currentRevision: current?.executionInputRevision },
	});
}

function emitUnknownPlanMember<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	planMemberId: string,
	metadata: Record<string, unknown>,
): void {
	const item = issue(
		"dangling-ref",
		`WorkItemEffectPlan evidence/result references unknown member '${planMemberId}'`,
		admitted.workItemId,
		{ planId: admitted.planId, planMemberId, ...metadata },
	);
	emitPlan(ctx, "issue", item);
	emitPlanStatus(ctx, state, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: "rejected",
		planMemberId,
		issues: [item],
		sourceRefs: admitted.sourceRefs,
		metadata,
	});
}

function emitUnmatchedEvidence<T>(
	ctx: Ctx,
	state: PlanState<T>,
	key: string,
	workItemId: string | undefined,
	metadata: Record<string, unknown>,
): void {
	const seen = key.startsWith("evidence:") ? state.unmatchedEvidence : state.unmatchedResults;
	if (seen.has(key)) return;
	seen.add(key);
	const item = issue(
		"dangling-ref",
		"WorkItemEffectPlan evidence/result could not be joined to an admitted plan member",
		workItemId,
		metadata,
	);
	emitPlan(ctx, "issue", item);
	emitPlanStatus(ctx, state, {
		workItemId: workItemId ?? "unknown",
		planId: typeof metadata.planId === "string" ? metadata.planId : "unknown",
		executionInputRevision:
			typeof metadata.executionInputRevision === "number" ? metadata.executionInputRevision : 0,
		state: "deferred",
		issues: [item],
		metadata,
	});
}

function derivePlanResult<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
): void {
	const requiredMembers = admitted.plan.members.filter((member) => member.required !== false);
	if (requiredMembers.length === 0) return;
	const memberResults: WorkItemEffectPlanResult["memberResults"][number][] = [];
	for (const member of admitted.plan.members) {
		const evidence = state.memberEvidence.get(memberCoord(admitted, member.memberId));
		if (evidence === undefined) continue;
		memberResults.push({
			planMemberId: member.memberId,
			status: evidence.status,
			requestId: evidence.requestId,
			effectRunId: evidence.effectRunId,
			evidenceId: evidence.evidenceId,
			effectRunResultId: evidence.effectRunResultId,
		});
	}
	const hasRequiredFailed = requiredMembers.some((member) => {
		const evidence = state.memberEvidence.get(memberCoord(admitted, member.memberId));
		return evidence !== undefined && evidence.status !== "completed";
	});
	const settledRequiredCount = requiredMembers.filter((member) =>
		state.memberEvidence.has(memberCoord(admitted, member.memberId)),
	).length;
	const allRequiredSettled = settledRequiredCount === requiredMembers.length;
	const requiredBlockedByFailure = requiredMembers.some((member) =>
		memberBlockedByFailure(state, admitted, member.memberId, new Set()),
	);
	if (!hasRequiredFailed && !allRequiredSettled && !requiredBlockedByFailure) return;
	const status: WorkItemEffectPlanResultStatus =
		admitted.plan.joinPolicy === "evidence-only"
			? "evidence-only"
			: hasRequiredFailed || requiredBlockedByFailure
				? "failed"
				: "succeeded";
	const key = memberCoord(admitted, "result");
	if (state.resultKeys.has(key)) return;
	state.resultKeys.add(key);
	const result: WorkItemEffectPlanResult = {
		kind: "work-item-effect-plan-result",
		resultId: `work-item-effect-plan-result:${admitted.workItemId}:${admitted.executionInputRevision}:${admitted.planId}`,
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		status,
		memberResults,
		sourceRefs: admitted.sourceRefs,
	};
	emitPlan(ctx, "result", result);
	emitPlanStatus(ctx, state, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: status === "succeeded" || status === "evidence-only" ? "completed" : "failed",
		sourceRefs: admitted.sourceRefs,
		metadata: { resultId: result.resultId, resultStatus: status },
	});
}

function normalizeEffectPlanSnapshot<T>(
	proposal: WorkItemEffectPlanProposed<T>,
	policy?: WorkItemEffectPlanPolicy,
): WorkItemEffectPlanSnapshot<T> {
	const joinPolicy = proposal.joinPolicy ?? policy?.joinPolicy ?? "all-required";
	const members = proposal.members.map((member) =>
		Object.freeze({
			...member,
			goal: immutableClone(member.goal),
			dependsOnMemberIds: immutableClone(member.dependsOnMemberIds ?? []),
			contextRefs: immutableClone(member.contextRefs),
			requirements: immutableClone(member.requirements),
			capacityHints: immutableClone(member.capacityHints),
			limits: immutableClone(member.limits),
			policyRefs: immutableClone(member.policyRefs),
			sourceRefs: immutableClone(member.sourceRefs),
			metadata: immutableClone(member.metadata),
		}),
	);
	return Object.freeze({
		planId: proposal.planId,
		workItemId: proposal.workItemId,
		executionInputRevision: proposal.executionInputRevision,
		members: Object.freeze(members),
		joinPolicy,
		limits: immutableClone(proposal.limits),
		policyRefs: immutableClone(proposal.policyRefs),
		sourceRefs: immutableClone(proposal.sourceRefs),
		metadata: immutableClone(proposal.metadata),
	});
}

function requestFromPlanMember<T>(
	admitted: WorkItemEffectPlanAdmitted<T>,
	member: WorkItemEffectPlanMember<T>,
	policy?: WorkItemEffectPlanPolicy,
): WorkItemEffectRequested<T> {
	const requestId = `work-item:${admitted.workItemId}:effect-plan:${admitted.executionInputRevision}:${admitted.planId}:${member.memberId}`;
	const policyRefs =
		policy?.policyId === undefined
			? [...(admitted.plan.policyRefs ?? []), ...(member.policyRefs ?? [])]
			: [
					...(admitted.plan.policyRefs ?? []),
					...(member.policyRefs ?? []),
					ref("work-item-effect-plan-policy", policy.policyId),
				];
	return {
		kind: "work-item-effect-requested",
		requestId,
		workItemId: admitted.workItemId,
		effectRunId: `effect-run:${requestId}`,
		effectKind: member.effectKind,
		executionInputRevision: admitted.executionInputRevision,
		planId: admitted.planId,
		planMemberId: member.memberId,
		sourceRefs: [
			ref("work-item", admitted.workItemId),
			ref("work-item-revision", `${admitted.workItemId}:${admitted.executionInputRevision}`),
			ref("work-item-effect-plan", admitted.planId),
			ref("work-item-effect-plan-member", member.memberId),
			...(admitted.plan.sourceRefs ?? []),
			...(member.sourceRefs ?? []),
		],
		goal: member.goal,
		policyRefs: policyRefs.length === 0 ? undefined : policyRefs,
		limits: member.limits ?? admitted.plan.limits,
		idempotencyKey:
			member.idempotencyKey ??
			`${admitted.workItemId}:effect-plan:${admitted.executionInputRevision}:${admitted.planId}:${member.memberId}`,
		metadata: {
			...(member.metadata ?? {}),
			executionInputRevision: admitted.executionInputRevision,
			planId: admitted.planId,
			planMemberId: member.memberId,
			...(member.contextRefs === undefined ? {} : { contextRefs: member.contextRefs }),
			...(member.requirements === undefined ? {} : { requirements: member.requirements }),
			...(member.capacityHints === undefined ? {} : { capacityHints: member.capacityHints }),
		},
	};
}

function immutableClone<T>(value: T): T {
	if (Array.isArray(value)) return Object.freeze(value.map((item) => immutableClone(item))) as T;
	if (!isRecord(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) out[key] = immutableClone(child);
	return Object.freeze(out) as T;
}

function stringMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function numberMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = metadata?.[key];
	return typeof value === "number" ? value : undefined;
}

function sourceRefId(refs: readonly SourceRef[] | undefined, kind: string): string | undefined {
	return refs?.find((sourceRef) => sourceRef.kind === kind)?.id;
}

function memberSucceeded<T>(
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	memberId: string,
): boolean {
	return state.memberEvidence.get(memberCoord(admitted, memberId))?.status === "completed";
}

function memberBlockedByFailure<T>(
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	memberId: string,
	seen: Set<string>,
): boolean {
	if (seen.has(memberId)) return false;
	seen.add(memberId);
	const evidence = state.memberEvidence.get(memberCoord(admitted, memberId));
	if (evidence !== undefined) return evidence.status !== "completed";
	const member = admitted.plan.members.find((item) => item.memberId === memberId);
	return (member?.dependsOnMemberIds ?? []).some((depId) =>
		memberBlockedByFailure(state, admitted, depId, seen),
	);
}

function memberCoord<T>(admitted: WorkItemEffectPlanAdmitted<T>, memberId: string): string {
	return `${admitted.workItemId}:${admitted.executionInputRevision}:${admitted.planId}:${memberId}`;
}

function planKey(
	workItemId: string | undefined,
	planId: string | undefined,
	executionInputRevision: number | undefined,
): string | undefined {
	if (workItemId === undefined || planId === undefined || executionInputRevision === undefined)
		return undefined;
	return `${workItemId}:${executionInputRevision}:${planId}`;
}

function requiredPlanKey(
	workItemId: string,
	planId: string,
	executionInputRevision: number,
): string {
	return `${workItemId}:${executionInputRevision}:${planId}`;
}

function emitPlanIssues<T>(ctx: Ctx, state: PlanState<T>, issues: readonly DataIssue[]): void {
	for (const item of issues) emitPlan(ctx, "issue", item);
	if (issues.length > 0) {
		state.auditSeq += 1;
		emitPlan(ctx, "audit", {
			id: `work-item-effect-plan-issue:${state.auditSeq}`,
			kind: "work-item-effect-plan-issue",
			subjectId: issues[0]?.subjectId,
			message: issues[0]?.message,
			issueCode: issues[0]?.code,
			metadata: { issueCodes: issues.map((item) => item.code) },
		});
	}
}

function emitPlanStatusOnce<T>(
	ctx: Ctx,
	state: PlanState<T>,
	key: string,
	status: Omit<WorkItemEffectPlanStatus, "kind" | "statusId">,
): void {
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	emitPlanStatus(ctx, state, status);
}

function emitPlanStatus<T>(
	ctx: Ctx,
	state: PlanState<T>,
	status: Omit<WorkItemEffectPlanStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-effect-plan-status",
		statusId: `work-item-effect-plan-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemEffectPlanStatus;
	emitPlan(ctx, "status", statusFact);
	state.auditSeq += 1;
	emitPlan(ctx, "audit", {
		id: `work-item-effect-plan-status:${state.auditSeq}`,
		kind: "work-item-effect-plan-status",
		subjectId: status.workItemId,
		message: status.message,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: statusFact.statusId,
			state: status.state,
			planId: status.planId,
			planMemberId: status.planMemberId,
			executionInputRevision: status.executionInputRevision,
			...(status.metadata ?? {}),
		},
	});
}

function emitPlan<T, K extends PlanFact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<PlanFact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as PlanFact<T>]]);
}

function isWorkItemEffectPlanJoinPolicy(value: unknown): value is WorkItemEffectPlanJoinPolicy {
	return value === "all-required" || value === "evidence-only";
}

function findPlanCycle<T>(
	members: readonly WorkItemEffectPlanMember<T>[],
): readonly string[] | undefined {
	const byId = new Map(members.map((member) => [member.memberId, member.dependsOnMemberIds ?? []]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const stack: string[] = [];
	const visit = (id: string): readonly string[] | undefined => {
		if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
		if (visited.has(id)) return undefined;
		visiting.add(id);
		stack.push(id);
		for (const dep of byId.get(id) ?? []) {
			if (!byId.has(dep)) continue;
			const cycle = visit(dep);
			if (cycle !== undefined) return cycle;
		}
		stack.pop();
		visiting.delete(id);
		visited.add(id);
		return undefined;
	};
	for (const member of members) {
		const cycle = visit(member.memberId);
		if (cycle !== undefined) return cycle;
	}
	return undefined;
}

function reduceAuthoring<T>(
	ctx: Ctx,
	state: AuthoringState<T>,
	input: WorkItemAuthoringInput<T>,
	policy?: WorkItemAuthoringPolicy,
): void {
	if (input.kind === "work-item-spawn-proposed") {
		const issues = validateWorkItemDraft(input.draft, { workItemId: input.parentWorkItemId });
		if (issues.length > 0) {
			for (const item of issues) emit(ctx, "issue", item);
			emitStatus(ctx, state, {
				state: "rejected",
				code: issues[0]?.code as WorkItemValidationIssueCode | undefined,
				workItemId: input.parentWorkItemId,
				message: issues[0]?.message,
				metadata: { proposalId: input.proposalId },
			});
			return;
		}
		emitStatus(ctx, state, {
			state: "deferred",
			workItemId: input.parentWorkItemId,
			message: `WorkItem spawn proposal '${input.proposalId}' carries draft data but is not applied`,
			metadata: { proposalId: input.proposalId },
		});
		return;
	}
	if (state.seenEvents.has(input.eventId)) {
		emit(
			ctx,
			"issue",
			issue("duplicate-id", `Duplicate WorkItem authoring id '${input.eventId}'`, input.workItemId),
		);
		return;
	}
	state.seenEvents.add(input.eventId);
	if (input.kind === "work-item-created") {
		if (state.workItems.has(input.workItemId)) {
			emit(
				ctx,
				"issue",
				issue("duplicate-id", `Duplicate WorkItem '${input.workItemId}'`, input.workItemId),
			);
			emitStatus(ctx, state, {
				state: "duplicate",
				code: "duplicate-id",
				workItemId: input.workItemId,
				metadata: { eventId: input.eventId },
			});
			return;
		}
		const issues = validateWorkItemDraft(input.draft, { workItemId: input.workItemId });
		if (issues.length > 0) {
			reject(ctx, state, input.workItemId, issues);
			return;
		}
		const projection: WorkItemProjection<T> = {
			...input.draft,
			verificationPlan: normalizePlan(input.draft),
			workItemId: input.workItemId,
			authoringRevision: 1,
			executionInputRevision: 1,
			lastEventId: input.eventId,
			revisionSourceRefs: refs("work-item-authoring-fact", input.eventId, input.sourceRefs),
			createdAtMs: input.createdAtMs,
			updatedAtMs: input.createdAtMs,
		};
		accept(ctx, state, projection);
		return;
	}
	const existing = state.workItems.get(input.workItemId);
	if (existing === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Authoring fact '${input.eventId}' references unknown WorkItem '${input.workItemId}'`,
				input.workItemId,
			),
		);
		return;
	}
	if (input.kind === "work-item-patched") {
		if (!isRecord(input.patch)) {
			reject(ctx, state, input.workItemId, [
				issue("invalid-patch", "WorkItemPatch must be an object", input.workItemId),
			]);
			return;
		}
		const invalidKeys = Object.keys(input.patch).filter((key) => !draftPatchKeys.has(key));
		if (invalidKeys.length > 0) {
			reject(ctx, state, input.workItemId, [
				issue(
					"invalid-patch",
					`WorkItemPatch contains unsupported keys: ${invalidKeys.join(", ")}`,
					input.workItemId,
					{
						invalidKeys,
					},
				),
			]);
			return;
		}
		const draft = applyDraftPatch(existing, input.patch);
		const issues = validateWorkItemDraft(draft, { workItemId: input.workItemId });
		if (issues.length > 0) {
			reject(ctx, state, input.workItemId, issues);
			return;
		}
		const touched = touchesExecutionRelevant(
			input.patch,
			executionRelevant(policy, input.executionRelevantFields),
		);
		accept(ctx, state, {
			...existing,
			...draft,
			authoringRevision: existing.authoringRevision + 1,
			executionInputRevision: touched
				? existing.executionInputRevision + 1
				: existing.executionInputRevision,
			lastEventId: input.eventId,
			revisionSourceRefs: refs("work-item-authoring-fact", input.eventId, input.sourceRefs),
			updatedAtMs: input.patchedAtMs,
		});
		return;
	}
	if (input.kind === "acceptance-criteria-changed") {
		const issues = validateAcceptanceCriteria(input.acceptanceCriteria, {
			workItemId: input.workItemId,
		});
		if (issues.length > 0) {
			reject(ctx, state, input.workItemId, issues);
			return;
		}
		accept(ctx, state, {
			...existing,
			acceptanceCriteria: input.acceptanceCriteria,
			authoringRevision: existing.authoringRevision + 1,
			executionInputRevision: existing.executionInputRevision + 1,
			lastEventId: input.eventId,
			revisionSourceRefs: refs("work-item-authoring-fact", input.eventId, input.sourceRefs),
			updatedAtMs: input.changedAtMs,
		});
		return;
	}
	const issues = validateVerificationPlan(
		input.verificationPlan,
		existing.acceptanceCriteria ?? [],
		{ workItemId: input.workItemId },
	);
	if (issues.length > 0) {
		reject(ctx, state, input.workItemId, issues);
		return;
	}
	accept(ctx, state, {
		...existing,
		verificationPlan: input.verificationPlan,
		verificationSteps: input.verificationPlan.steps,
		authoringRevision: existing.authoringRevision + 1,
		executionInputRevision: existing.executionInputRevision + 1,
		lastEventId: input.eventId,
		revisionSourceRefs: refs("work-item-authoring-fact", input.eventId, input.sourceRefs),
		updatedAtMs: input.changedAtMs,
	});
}

function lowerPlan<T>(
	ctx: Ctx,
	state: RequestState<T>,
	workItem: WorkItemProjection<T>,
	policy?: WorkItemVerificationLowererPolicy,
): void {
	const plan = normalizePlan(workItem);
	if (plan === undefined) {
		emitRequestStatus(ctx, state, {
			state: "needs-human-review",
			code: "verification-unplanned",
			workItemId: workItem.workItemId,
		});
		return;
	}
	const issues = validateVerificationPlan(plan, workItem.acceptanceCriteria ?? [], {
		workItemId: workItem.workItemId,
		allowedModes: policy?.allowedModes,
		allowedEffectKinds: policy?.allowedEffectKinds,
	});
	if (issues.length > 0) {
		for (const item of issues) emit(ctx, "issue", item);
		return;
	}
	if (policy?.autoRun === false) {
		emitRequestStatus(ctx, state, {
			state: "deferred",
			code: "policy-mismatch",
			workItemId: workItem.workItemId,
			revision: workItem.authoringRevision,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { policyId: policy.policyId, reason: "auto-run-disabled" },
		});
		return;
	}
	for (const step of plan.steps) {
		if (isStepSatisfied(state, workItem, step.stepId)) {
			emitRequestStatus(ctx, state, {
				state: "duplicate",
				code: "duplicate-suppressed",
				workItemId: workItem.workItemId,
				revision: workItem.authoringRevision,
				executionInputRevision: workItem.executionInputRevision,
				stepId: step.stepId,
				message: `Verification step '${step.stepId}' already has valid evidence`,
			});
			continue;
		}
		if (step.mode === "manual") {
			emitRequestStatus(ctx, state, {
				state: "needs-human-review",
				code: "manual-review-required",
				workItemId: workItem.workItemId,
				stepId: step.stepId,
			});
			continue;
		}
		const missingPrerequisites = (step.dependsOnStepIds ?? []).filter(
			(stepId) => !isStepSatisfied(state, workItem, stepId),
		);
		if (missingPrerequisites.length > 0) {
			emitRequestStatus(ctx, state, {
				state: "blocked",
				code: "blocked-prerequisite",
				workItemId: workItem.workItemId,
				stepId: step.stepId,
				metadata: { missingStepIds: missingPrerequisites },
			});
			continue;
		}
		emitRequest(ctx, state, requestFromStep(workItem, plan, step, policy));
	}
}

function lowerIntent<T>(
	ctx: Ctx,
	state: RequestState<T>,
	intent: WorkItemDispatchIntent<T>,
	policy?: WorkItemVerificationLowererPolicy,
): void {
	const workItem = state.workItems.get(intent.workItemId);
	if (workItem === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Dispatch intent '${intent.intentId}' references unknown WorkItem '${intent.workItemId}'`,
				intent.workItemId,
			),
		);
		return;
	}
	if (intent.executionInputRevision !== workItem.executionInputRevision) {
		emit(
			ctx,
			"issue",
			issue(
				"stale-execution-input",
				`Dispatch intent '${intent.intentId}' targets stale execution input`,
				intent.workItemId,
				{
					intentRevision: intent.executionInputRevision,
					currentRevision: workItem.executionInputRevision,
					stalePolicy: policy?.stalePolicy ?? "review",
				},
			),
		);
		emitRequestStatus(ctx, state, {
			state: "stale",
			code: "stale-execution-input",
			workItemId: intent.workItemId,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { intentId: intent.intentId },
		});
		return;
	}
	const effectKind = intent.effectKind ?? intent.targetKind;
	const allowedEffectKinds = new Set(policy?.allowedEffectKinds ?? ["verification"]);
	if (!allowedEffectKinds.has(effectKind)) {
		emit(
			ctx,
			"issue",
			issue(
				"unsupported-effect-kind",
				`Dispatch intent '${intent.intentId}' targets unsupported effect kind '${effectKind}'`,
				intent.workItemId,
				{ intentId: intent.intentId, effectKind },
			),
		);
		emitRequestStatus(ctx, state, {
			state: "rejected",
			code: "unsupported-effect-kind",
			workItemId: intent.workItemId,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { intentId: intent.intentId, effectKind },
		});
		return;
	}
	emitRequest(ctx, state, requestFromIntent(workItem, intent));
}

function recordVerificationResult<T>(
	ctx: Ctx,
	state: RequestState<T>,
	result: VerificationResultRecorded,
	policy?: WorkItemVerificationLowererPolicy,
): void {
	if (result.status !== "passed") return;
	const workItem = state.workItems.get(result.workItemId);
	if (workItem === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Verification result '${result.resultId}' references unknown WorkItem '${result.workItemId}'`,
				result.workItemId,
			),
		);
		return;
	}
	if (result.executionInputRevision !== workItem.executionInputRevision) {
		emit(
			ctx,
			"issue",
			issue(
				"stale-revision",
				`Verification result '${result.resultId}' targets stale execution input`,
				result.workItemId,
			),
		);
		return;
	}
	const key = revisionKey(result.workItemId, result.executionInputRevision);
	const passedSteps = state.passedSteps.get(key) ?? new Set<string>();
	for (const stepId of result.verificationStepIds) passedSteps.add(stepId);
	state.passedSteps.set(key, passedSteps);
	lowerPlan(ctx, state, workItem, policy);
}

function mapEvidence<T>(
	ctx: Ctx,
	state: ResultState<T>,
	evidence: WorkItemEvidenceRecorded,
	replay = false,
): void {
	if (!replay && state.evidenceById.has(evidence.evidenceId)) {
		emit(
			ctx,
			"issue",
			issue(
				"duplicate-suppressed",
				`Duplicate evidence '${evidence.evidenceId}'`,
				evidence.workItemId,
			),
		);
		return;
	}
	state.evidenceById.set(evidence.evidenceId, evidence);
	const workItem = state.workItems.get(evidence.workItemId);
	if (workItem === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Evidence '${evidence.evidenceId}' references unknown WorkItem '${evidence.workItemId}'`,
				evidence.workItemId,
			),
		);
		return;
	}
	const revision =
		typeof evidence.metadata?.executionInputRevision === "number"
			? evidence.metadata.executionInputRevision
			: undefined;
	if (revision !== workItem.executionInputRevision) {
		emit(
			ctx,
			"issue",
			issue(
				"stale-revision",
				`Evidence '${evidence.evidenceId}' targets stale revision`,
				evidence.workItemId,
			),
		);
		emitResultStatus(ctx, state, {
			state: "stale",
			code: "stale-revision",
			workItemId: evidence.workItemId,
			executionInputRevision: workItem.executionInputRevision,
		});
		return;
	}
	const stepIds = stringArray(evidence.metadata?.verificationStepIds);
	const criterionIds = stringArray(evidence.metadata?.acceptanceCriterionIds);
	if (stepIds.length === 0 || criterionIds.length === 0) {
		emit(
			ctx,
			"issue",
			issue(
				"ambiguous-coverage",
				`Evidence '${evidence.evidenceId}' lacks coverage refs`,
				evidence.workItemId,
			),
		);
		return;
	}
	const coverageIssue = validateEvidenceCoverage(workItem, stepIds, criterionIds);
	if (coverageIssue !== undefined) {
		emit(ctx, "issue", {
			...coverageIssue,
			message: `Evidence '${evidence.evidenceId}' has invalid verification coverage: ${coverageIssue.message}`,
		});
		emitResultStatus(ctx, state, {
			state: "rejected",
			code: coverageIssue.code as WorkItemValidationIssueCode,
			workItemId: evidence.workItemId,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { evidenceId: evidence.evidenceId },
		});
		return;
	}
	const result: VerificationResultRecorded = {
		kind: "verification-result-recorded",
		resultId: `verification-result:${evidence.evidenceId}`,
		workItemId: evidence.workItemId,
		evidenceId: evidence.evidenceId,
		effectRunId: evidence.effectRunId,
		effectRunResultId: evidence.effectRunResultId,
		executionInputRevision: revision,
		verificationStepIds: stepIds,
		acceptanceCriterionIds: criterionIds,
		status: resultStatus(evidence.status),
		output: evidence.output,
		error: evidence.error,
		reason: evidence.reason,
		sourceRefs: evidence.sourceRefs,
		recordedAtMs: evidence.recordedAtMs,
		metadata: evidence.metadata,
	};
	if (!state.resultEvidence.has(evidence.evidenceId)) {
		state.resultEvidence.add(evidence.evidenceId);
		emit(ctx, "result", result);
		emitResultStatus(ctx, state, {
			state: "result-recorded",
			workItemId: evidence.workItemId,
			executionInputRevision: revision,
			metadata: { resultId: result.resultId },
		});
	}
	const policyIds = [
		...new Set(
			(evidence.sourceRefs ?? [])
				.filter((sourceRef) => sourceRef.kind === "work-item-verification-mapping-policy")
				.map((sourceRef) => sourceRef.id),
		),
	];
	if (policyIds.length === 0) return;
	for (const policyId of policyIds) {
		const policy = state.policies.get(policyId);
		if (policy === undefined) {
			if (!replay) {
				emit(
					ctx,
					"issue",
					issue(
						"missing-policy",
						`Missing verification mapping policy '${policyId}'`,
						evidence.workItemId,
						{ policyId },
					),
				);
				emitResultStatus(ctx, state, {
					state: "deferred",
					code: "missing-policy",
					workItemId: evidence.workItemId,
					executionInputRevision: revision,
					metadata: { evidenceId: evidence.evidenceId, policyId },
				});
			}
			continue;
		}
		for (const [index, spec] of (policy.actionProposals ?? []).entries()) {
			if (spec.behavior !== undefined && spec.behavior !== "propose") {
				emit(ctx, "issue", actionProposalIssue(policy, spec, evidence, "unsupported behavior"));
				continue;
			}
			if (spec.actionKind.length === 0) {
				emit(ctx, "issue", actionProposalIssue(policy, spec, evidence, "empty actionKind"));
				continue;
			}
			if (spec.statuses !== undefined && !spec.statuses.includes(evidence.status)) continue;
			const outputKind = evidence.output?.kind;
			if (
				spec.outputKinds !== undefined &&
				(outputKind === undefined || !spec.outputKinds.includes(outputKind))
			)
				continue;
			const proposalKey = `${evidence.evidenceId}:${policy.policyId}:${index}:${spec.actionKind}`;
			if (state.proposalKeys.has(proposalKey)) continue;
			state.proposalKeys.add(proposalKey);
			emit(ctx, "proposal", {
				kind: "work-item-domain-action-proposal",
				proposalId: `verification:${result.resultId}:${policy.policyId}:${index}:${spec.actionKind}`,
				workItemId: result.workItemId,
				actionKind: spec.actionKind,
				effectRunId: result.effectRunId,
				effectRunResultId: result.effectRunResultId,
				evidenceId: result.evidenceId,
				policyId: policy.policyId,
				payload: actionProposalPayload(spec, evidence, result),
				reason: spec.reason ?? evidence.reason,
				sourceRefs: [
					ref("work-item-evidence", evidence.evidenceId),
					ref("verification-result", result.resultId),
					ref("effect-run-result", result.effectRunResultId),
					ref("work-item-verification-mapping-policy", policy.policyId),
				],
				metadata: {
					...(policy.metadata ?? {}),
					...(spec.metadata ?? {}),
					resultStatus: evidence.status,
				},
			});
			emitResultStatus(ctx, state, {
				state: "domain-action-proposed",
				workItemId: evidence.workItemId,
				executionInputRevision: revision,
				metadata: { actionKind: spec.actionKind, policyId: policy.policyId },
			});
		}
	}
}

function requestFromStep<T>(
	workItem: WorkItemProjection<T>,
	plan: VerificationPlan<T>,
	step: VerificationStep<T>,
	policy?: WorkItemVerificationLowererPolicy,
): WorkItemEffectRequested<T> {
	const requestId = `work-item:${workItem.workItemId}:verification:${workItem.executionInputRevision}:${plan.planId}:${step.stepId}`;
	const effectKind = step.effectKind ?? "verification";
	const criterionIds =
		step.verifiesCriteriaIds ??
		(workItem.acceptanceCriteria ?? []).map((criterion) => criterion.criterionId);
	const goal = goalWithInlineInput(
		step.goal ?? { kind: effectKind, summary: step.title ?? workItem.summary },
		step.input,
		`verification-step:${step.stepId}:input`,
		effectKind,
		step.contextRefs,
	);
	return {
		kind: "work-item-effect-requested",
		requestId,
		workItemId: workItem.workItemId,
		effectRunId: `effect-run:${requestId}`,
		effectKind,
		executionInputRevision: workItem.executionInputRevision,
		sourceRefs: [
			ref("work-item", workItem.workItemId),
			ref("work-item-revision", `${workItem.workItemId}:${workItem.executionInputRevision}`),
			ref("verification-plan", plan.planId),
			ref("verification-step", step.stepId),
			...(plan.sourceRefs ?? []),
			...(step.sourceRefs ?? []),
		],
		goal,
		policyRefs:
			policy?.policyId === undefined
				? step.policyRefs
				: [
						...(step.policyRefs ?? []),
						ref("work-item-verification-lowerer-policy", policy.policyId),
					],
		idempotencyKey: `${workItem.workItemId}:verification:${workItem.executionInputRevision}:${plan.planId}:${step.stepId}`,
		metadata: {
			...(step.metadata ?? {}),
			executionInputRevision: workItem.executionInputRevision,
			verificationPlanId: plan.planId,
			verificationStepIds: [step.stepId],
			acceptanceCriterionIds: criterionIds,
			...(step.contextRefs === undefined ? {} : { contextRefs: step.contextRefs }),
			...(step.requirements === undefined ? {} : { requirements: step.requirements }),
			...(step.capacityHints === undefined ? {} : { capacityHints: step.capacityHints }),
		},
	};
}

function requestFromIntent<T>(
	workItem: WorkItemProjection<T>,
	intent: WorkItemDispatchIntent<T>,
): WorkItemEffectRequested<T> {
	const requestId = `work-item:${workItem.workItemId}:dispatch:${workItem.executionInputRevision}:${intent.intentId}`;
	const effectKind = intent.effectKind ?? intent.targetKind;
	return {
		kind: "work-item-effect-requested",
		requestId,
		workItemId: workItem.workItemId,
		effectRunId: `effect-run:${requestId}`,
		effectKind,
		executionInputRevision: workItem.executionInputRevision,
		sourceRefs: [
			ref("work-item", workItem.workItemId),
			ref("work-item-dispatch-intent", intent.intentId),
			...(intent.sourceRefs ?? []),
		],
		goal: intent.goal ?? { kind: effectKind, summary: intent.reason ?? workItem.summary },
		policyRefs: intent.policyRefs,
		limits: intent.limits,
		idempotencyKey:
			intent.idempotencyKey ??
			`${workItem.workItemId}:dispatch:${workItem.executionInputRevision}:${intent.intentId}`,
		metadata: {
			...(intent.metadata ?? {}),
			executionInputRevision: workItem.executionInputRevision,
			verificationStepIds: intent.stepIds ?? [],
			acceptanceCriterionIds: intent.acceptanceCriterionIds ?? [],
			...(intent.contextRefs === undefined ? {} : { contextRefs: intent.contextRefs }),
			...(intent.requirements === undefined ? {} : { requirements: intent.requirements }),
			...(intent.capacityHints === undefined ? {} : { capacityHints: intent.capacityHints }),
		},
	};
}

function accept<T>(ctx: Ctx, state: AuthoringState<T>, projection: WorkItemProjection<T>): void {
	state.workItems.set(projection.workItemId, projection);
	emit(ctx, "work-item", projection);
	emitStatus(ctx, state, {
		state: "projected",
		workItemId: projection.workItemId,
		revision: projection.authoringRevision,
		executionInputRevision: projection.executionInputRevision,
		metadata: { lastEventId: projection.lastEventId },
	});
}

function reject<T>(
	ctx: Ctx,
	state: AuthoringState<T>,
	workItemId: string,
	issues: readonly DataIssue[],
): void {
	for (const item of issues) emit(ctx, "issue", item);
	emitStatus(ctx, state, {
		state: "rejected",
		code: issues[0]?.code as WorkItemValidationIssueCode | undefined,
		workItemId,
		message: issues[0]?.message,
	});
}

function emitRequest<T>(
	ctx: Ctx,
	state: RequestState<T>,
	request: WorkItemEffectRequested<T>,
): void {
	const key = request.idempotencyKey ?? request.requestId;
	if (state.emittedKeys.has(key)) {
		emitRequestStatus(ctx, state, {
			state: "duplicate",
			code: "duplicate-suppressed",
			workItemId: request.workItemId,
			metadata: { requestId: request.requestId },
		});
		return;
	}
	state.emittedKeys.add(key);
	emit(ctx, "request", request);
	emitRequestStatus(ctx, state, {
		state: "request-emitted",
		workItemId: request.workItemId,
		executionInputRevision:
			request.executionInputRevision ??
			(request.metadata?.executionInputRevision as number | undefined),
		metadata: { requestId: request.requestId },
	});
}

function emitStatus<T>(
	ctx: Ctx,
	state: AuthoringState<T>,
	status: Omit<WorkItemValidationStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-validation-status",
		statusId: `work-item-authoring-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemValidationStatus;
	emit(ctx, "status", statusFact);
	emitAudit(ctx, state, "work-item-authoring-status", statusFact);
}

function emitRequestStatus<T>(
	ctx: Ctx,
	state: RequestState<T>,
	status: Omit<WorkItemValidationStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-validation-status",
		statusId: `work-item-verification-request-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemValidationStatus;
	emit(ctx, "status", statusFact);
	emitAudit(ctx, state, "work-item-verification-request-status", statusFact);
}

function emitResultStatus<T>(
	ctx: Ctx,
	state: ResultState<T>,
	status: Omit<WorkItemValidationStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-validation-status",
		statusId: `work-item-verification-result-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemValidationStatus;
	emit(ctx, "status", statusFact);
	emitAudit(ctx, state, "work-item-verification-result-status", statusFact);
}

function emitAudit(
	ctx: Ctx,
	state: { auditSeq: number },
	kind: string,
	status: WorkItemValidationStatus,
): void {
	state.auditSeq += 1;
	emit(ctx, "audit", {
		id: `${kind}:${state.auditSeq}`,
		kind,
		subjectId: status.workItemId,
		message: status.message,
		issueCode: status.code,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: status.statusId,
			state: status.state,
			revision: status.revision,
			executionInputRevision: status.executionInputRevision,
			...(status.metadata ?? {}),
		},
	});
}

function emit<T, K extends Fact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<Fact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as Fact<T>]]);
}

function project<TFact, TSelected>(
	graph: Graph,
	runtime: Node<TFact>,
	name: string,
	factory: string,
	select: (fact: TFact) => TSelected | undefined,
): Node<TSelected> {
	return graph.node<TSelected>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as TFact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function normalizePlan<T>(
	draft: Pick<WorkItemDraft<T>, "verificationPlan" | "verificationSteps">,
): VerificationPlan<T> | undefined {
	if (draft.verificationPlan !== undefined) return draft.verificationPlan;
	if (draft.verificationSteps !== undefined)
		return { planId: "default", steps: draft.verificationSteps };
	return undefined;
}

function normalizePlanFromUnknown<T>(
	draft: Record<string, unknown>,
): VerificationPlan<T> | undefined {
	const verificationPlan = draft.verificationPlan;
	if (verificationPlan !== undefined) {
		if (!isRecord(verificationPlan) || !Array.isArray(verificationPlan.steps)) {
			return { planId: "malformed", steps: [] };
		}
		return verificationPlan as unknown as VerificationPlan<T>;
	}
	const verificationSteps = draft.verificationSteps;
	if (verificationSteps !== undefined) {
		if (!Array.isArray(verificationSteps)) return { planId: "malformed", steps: [] };
		return { planId: "default", steps: verificationSteps as readonly VerificationStep<T>[] };
	}
	return undefined;
}

function isVerificationPlanShape(value: unknown): value is VerificationPlan {
	return isRecord(value) && typeof value.planId === "string" && Array.isArray(value.steps);
}

function applyDraftPatch<T>(
	existing: WorkItemProjection<T>,
	patch: WorkItemPatch<T>,
): WorkItemDraft<T> {
	return {
		summary: patchValue(patch, existing, "summary"),
		detail: patchValue(patch, existing, "detail"),
		detailRefs: patchValue(patch, existing, "detailRefs"),
		acceptanceCriteria: patchValue(patch, existing, "acceptanceCriteria"),
		verificationPlan: patchValue(patch, existing, "verificationPlan"),
		verificationSteps: patchValue(patch, existing, "verificationSteps"),
		kind: patchValue(patch, existing, "kind"),
		priority: patchValue(patch, existing, "priority"),
		tags: patchValue(patch, existing, "tags"),
		owner: patchValue(patch, existing, "owner"),
		assignee: patchValue(patch, existing, "assignee"),
		deadlineMs: patchValue(patch, existing, "deadlineMs"),
		customFields: patchValue(patch, existing, "customFields"),
		sourceRefs: patchValue(patch, existing, "sourceRefs"),
		metadata: patchValue(patch, existing, "metadata"),
	};
}

function patchValue<T, K extends keyof WorkItemDraft<T>>(
	patch: WorkItemPatch<T>,
	existing: WorkItemProjection<T>,
	key: K,
): WorkItemDraft<T>[K] {
	return Object.hasOwn(patch, key) ? (patch[key] as WorkItemDraft<T>[K]) : existing[key];
}

function validateEvidenceCoverage<T>(
	workItem: WorkItemProjection<T>,
	stepIds: readonly string[],
	criterionIds: readonly string[],
): DataIssue | undefined {
	const plan = normalizePlan(workItem);
	const validStepIds = new Set((plan?.steps ?? []).map((step) => step.stepId));
	const validCriterionIds = new Set(
		(workItem.acceptanceCriteria ?? []).map((criterion) => criterion.criterionId),
	);
	for (const stepId of stepIds) {
		if (!validStepIds.has(stepId)) {
			return issue("dangling-ref", `unknown verification step '${stepId}'`, workItem.workItemId, {
				stepId,
			});
		}
	}
	for (const criterionId of criterionIds) {
		if (!validCriterionIds.has(criterionId)) {
			return issue(
				"dangling-ref",
				`unknown acceptance criterion '${criterionId}'`,
				workItem.workItemId,
				{ criterionId },
			);
		}
	}
	return undefined;
}

function executionRelevant(
	policy?: WorkItemAuthoringPolicy,
	fields?: readonly string[],
): Set<string> {
	return new Set([
		...executionRelevantDefaults,
		...(policy?.executionRelevantFields ?? []),
		...(fields ?? []),
	]);
}

function touchesExecutionRelevant<T>(
	patch: WorkItemPatch<T>,
	relevantFields: Set<string>,
): boolean {
	const paths = patchPaths(patch);
	for (const path of paths) {
		if (relevantFields.has(path)) return true;
	}
	return false;
}

function patchPaths<T>(patch: WorkItemPatch<T>): readonly string[] {
	const paths: string[] = [];
	for (const [key, value] of Object.entries(patch)) {
		paths.push(key);
		if (isRecord(value)) {
			for (const childKey of Object.keys(value)) paths.push(`${key}.${childKey}`);
		}
	}
	return paths;
}

function isStepSatisfied<T>(
	state: RequestState<T>,
	workItem: WorkItemProjection<T>,
	stepId: string,
): boolean {
	return (
		state.passedSteps
			.get(revisionKey(workItem.workItemId, workItem.executionInputRevision))
			?.has(stepId) === true
	);
}

function revisionKey(workItemId: string, executionInputRevision: number): string {
	return `${workItemId}:${executionInputRevision}`;
}

function replayEvidence<T>(ctx: Ctx, state: ResultState<T>, workItemId: string): void {
	for (const evidence of state.evidenceById.values()) {
		if (evidence.workItemId === workItemId) mapEvidence(ctx, state, evidence, true);
	}
}

function validateMappingPolicy(policy: WorkItemVerificationMappingPolicy): readonly DataIssue[] {
	if (
		!isRecord(policy) ||
		policy.kind !== "work-item-verification-mapping-policy" ||
		typeof policy.policyId !== "string" ||
		policy.policyId.trim() === ""
	) {
		return [
			issue(
				"policy-mismatch",
				"WorkItemVerificationMappingPolicy requires kind and policyId",
				undefined,
			),
		];
	}
	if (policy.actionProposals !== undefined && !Array.isArray(policy.actionProposals)) {
		return [
			issue(
				"policy-mismatch",
				"WorkItemVerificationMappingPolicy.actionProposals must be an array",
				undefined,
				{
					policyId: policy.policyId,
				},
			),
		];
	}
	const out: DataIssue[] = [];
	for (const [index, spec] of (policy.actionProposals ?? []).entries()) {
		if (!isRecord(spec) || typeof spec.actionKind !== "string") {
			out.push(
				issue("policy-mismatch", "WorkItem action proposal requires actionKind", undefined, {
					policyId: policy.policyId,
					index,
				}),
			);
		}
	}
	return out;
}

function findCycle(steps: readonly VerificationStep[]): readonly string[] | undefined {
	const byId = new Map(steps.map((step) => [step.stepId, step.dependsOnStepIds ?? []]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const stack: string[] = [];
	const visit = (id: string): readonly string[] | undefined => {
		if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
		if (visited.has(id)) return undefined;
		visiting.add(id);
		stack.push(id);
		for (const dep of byId.get(id) ?? []) {
			if (!byId.has(dep)) continue;
			const cycle = visit(dep);
			if (cycle !== undefined) return cycle;
		}
		stack.pop();
		visiting.delete(id);
		visited.add(id);
		return undefined;
	};
	for (const step of steps) {
		const cycle = visit(step.stepId);
		if (cycle !== undefined) return cycle;
	}
	return undefined;
}

function resultStatus(status: EffectRunResultStatus): VerificationResultStatus {
	if (status === "completed") return "passed";
	if (status === "failed") return "failed";
	if (status === "blocked") return "blocked";
	if (status === "canceled") return "canceled";
	if (status === "timeout") return "timeout";
	return "waived";
}

function goalWithInlineInput<T>(
	goal: EffectRunGoal<T>,
	input: T | undefined,
	inputId: string,
	inputKind: string,
	subjectRefs: readonly SourceRef[] | undefined,
): EffectRunGoal<T> {
	if (input === undefined || goal.input !== undefined) return goal;
	return {
		...goal,
		input: {
			inputId,
			inputKind,
			dataMode: "inline",
			value: input,
			subjectRefs,
		},
	};
}

function actionProposalPayload(
	spec: WorkItemDomainActionProposalSpec,
	evidence: WorkItemEvidenceRecorded,
	result: VerificationResultRecorded,
): unknown {
	if (spec.payload !== undefined) return spec.payload;
	if (spec.payloadFrom === "effect-run-result")
		return { kind: "effect-run-result-ref", resultId: result.effectRunResultId };
	if (spec.payloadFrom === "output") return evidence.output;
	if (spec.payloadFrom === "evidence")
		return { kind: "work-item-evidence-ref", evidenceId: evidence.evidenceId };
	return undefined;
}

function actionProposalIssue(
	policy: WorkItemVerificationMappingPolicy,
	spec: WorkItemDomainActionProposalSpec,
	evidence: WorkItemEvidenceRecorded,
	reason: string,
): DataIssue {
	return issue(
		"policy-mismatch",
		`Verification mapping policy '${policy.policyId}' has an invalid action proposal: ${reason}`,
		evidence.workItemId,
		{ policyId: policy.policyId, actionKind: spec.actionKind },
	);
}

function issue(
	code: WorkItemValidationIssueCode,
	message: string,
	workItemId?: string,
	metadata?: Record<string, unknown>,
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: "error",
		source: "work-item-scheduling",
		subjectId: workItemId,
		metadata,
	};
}

function refs(kind: string, id: string, rest?: readonly SourceRef[]): readonly SourceRef[] {
	return [ref(kind, id), ...(rest ?? [])];
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

function stringArray(value: unknown): readonly string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
