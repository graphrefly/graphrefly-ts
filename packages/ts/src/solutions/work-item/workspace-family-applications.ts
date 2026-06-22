import type { SourceRef } from "../../orchestration/agent-runtime.js";
import type { WorkItemDomainActionApplication } from "./actions-types.js";
import type {
	WorkItemAuthoringFact,
	WorkItemCreated,
	WorkItemDraft,
	WorkItemProjection,
} from "./scheduling-types.js";
import { validateWorkItemDraft } from "./scheduling-validation.js";
import type {
	RequiredInputGate,
	RequiredInputRequest,
	RequiredInputResponseApplied,
	RequiredInputResponseProposed,
	WorkItemLinked,
	WorkItemLinkProjection,
	WorkItemUnlinked,
} from "./workspace-model.js";
import {
	projectWorkspaceProposalApplicationStatus,
	validateWorkspaceProposalApplicationEnvelope,
	type WorkspaceProposalAdmissionDecision,
	type WorkspaceProposalApplicationFamilyRef,
	type WorkspaceProposalApplicationResult,
	type WorkspaceProposalAuditMaterial,
	type WorkspaceProposalRecorded,
	type WorkspaceProposalRecordedIssue,
	workspaceProposalApplicationFamilyRef,
	workspaceProposalDataOnlyIssues,
} from "./workspace-proposals.js";

export interface WorkspaceProposalRequiredInputResponseApplicationOptions {
	readonly applicationId: string;
	readonly gate: RequiredInputGate;
	readonly request?: RequiredInputRequest;
	readonly appliedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalRequiredInputResponseApplicationResult<TValue = unknown>
	extends WorkspaceProposalApplicationResult {
	readonly applied?: RequiredInputResponseApplied<TValue>;
}

export interface WorkspaceProposalWorkItemSpawnApplicationOptions<TInput = unknown> {
	readonly applicationId: string;
	readonly existingWorkItems?: readonly WorkItemProjection<TInput>[];
	readonly linkParent?: boolean;
	readonly createdAtMs?: number;
	readonly linkedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalWorkItemSpawnApplicationResult<TInput = unknown>
	extends WorkspaceProposalApplicationResult {
	readonly created?: WorkItemCreated<TInput>;
	readonly linked?: WorkItemLinked;
}

export interface WorkItemLinkProposalDraft {
	readonly kind: "work-item-link-proposal";
	readonly action?: "link" | "unlink";
	readonly eventId?: string;
	readonly linkId: string;
	readonly fromWorkItemId?: string;
	readonly toWorkItemId?: string;
	readonly linkKind?: string;
	readonly direction?: WorkItemLinked["direction"];
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalWorkItemLinkApplicationOptions<TInput = unknown> {
	readonly applicationId: string;
	readonly workItems?: readonly WorkItemProjection<TInput>[];
	readonly links?: readonly WorkItemLinkProjection[];
	readonly linkedAtMs?: number;
	readonly unlinkedAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export interface WorkspaceProposalWorkItemLinkApplicationResult
	extends WorkspaceProposalApplicationResult {
	readonly linked?: WorkItemLinked;
	readonly unlinked?: WorkItemUnlinked;
}

export interface WorkspaceProposalDomainActionApplicationStatusOptions {
	readonly applicationId: string;
	readonly emittedFacts: readonly WorkItemAuthoringFact[];
	readonly domainApplication?: WorkItemDomainActionApplication;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

export function projectWorkspaceProposalRequiredInputResponseApplication<TValue = unknown>(
	record: WorkspaceProposalRecorded<RequiredInputResponseProposed<TValue>>,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalRequiredInputResponseApplicationOptions,
): WorkspaceProposalRequiredInputResponseApplicationResult<TValue> {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "required-input-response",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const draft = record.draft;
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "requiredInputApplicationOptions", options);
	const draftIssues = requiredInputDraftIssues(record, draft, options.gate, options.request);
	const issues = [...familyIssues, ...contextIssues, ...draftIssues];
	const applied =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined
			? ({
					kind: "required-input-response-applied",
					applicationId: options.applicationId,
					admissionId: decision.decisionId,
					proposalId: record.proposalId,
					requestId: draft.requestId,
					workItemId: draft.workItemId,
					value: draft.value,
					summary: draft.summary,
					sourceRefs,
					evidenceRefs: draft.evidenceRefs,
					artifactRefs: draft.artifactRefs,
					appliedAtMs: options.appliedAtMs,
					metadata: familyMetadata(record, decision, options.audit, draft.metadata),
				} satisfies RequiredInputResponseApplied<TValue>)
			: undefined;
	const emittedFactRefs =
		applied === undefined
			? []
			: [workspaceProposalApplicationFamilyRef(record.proposalFamily, applied, { sourceRefs })];
	const result = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs,
		familyIssues: issues,
		sourceRefs,
		audit: options.audit,
	});
	return { ...result, applied };
}

export function projectWorkspaceProposalWorkItemSpawnApplication<TInput = unknown>(
	record: WorkspaceProposalRecorded<{
		readonly kind: "work-item-spawn-proposed";
		readonly proposedWorkItemId?: string;
		readonly parentWorkItemId?: string;
		readonly draft: WorkItemDraft<TInput>;
		readonly proposedBy?: string;
		readonly idempotencyKey?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	}>,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalWorkItemSpawnApplicationOptions<TInput>,
): WorkspaceProposalWorkItemSpawnApplicationResult<TInput> {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "work-item-spawn",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const draft = record.draft;
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "workItemSpawnApplicationOptions", options);
	const childWorkItemId =
		typeof draft?.proposedWorkItemId === "string" ? draft.proposedWorkItemId : "";
	const draftIssues = spawnDraftIssues(record, draft, childWorkItemId, options.existingWorkItems);
	const issues = [...familyIssues, ...contextIssues, ...draftIssues];
	const created =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined
			? ({
					kind: "work-item-created",
					eventId: `${options.applicationId}:work-item-created:${childWorkItemId}`,
					workItemId: childWorkItemId,
					draft: draft.draft,
					authorId: draft.proposedBy,
					createdAtMs: options.createdAtMs,
					sourceRefs,
					metadata: {
						...(draft.metadata ?? {}),
						...familyMetadata(record, decision, options.audit, {
							idempotencyKey: draft.idempotencyKey ?? record.idempotencyKey,
						}),
					},
				} satisfies WorkItemCreated<TInput>)
			: undefined;
	const linked =
		created !== undefined &&
		draft !== undefined &&
		options.linkParent === true &&
		typeof draft.parentWorkItemId === "string" &&
		draft.parentWorkItemId.trim() !== ""
			? ({
					kind: "work-item-linked",
					eventId: `${options.applicationId}:work-item-linked:${draft.parentWorkItemId}:${childWorkItemId}`,
					linkId: `${draft.parentWorkItemId}:spawned-from:${childWorkItemId}`,
					fromWorkItemId: childWorkItemId,
					toWorkItemId: draft.parentWorkItemId,
					linkKind: "spawned-from",
					direction: "directed",
					sourceRefs,
					linkedAtMs: options.linkedAtMs,
					idempotencyKey: `${record.idempotencyKey}:spawned-from`,
					metadata: familyMetadata(record, decision, options.audit),
				} satisfies WorkItemLinked)
			: undefined;
	const emittedFactRefs: WorkspaceProposalApplicationFamilyRef[] = [];
	if (created !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, created, { sourceRefs }),
		);
	}
	if (linked !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, linked, { sourceRefs }),
		);
	}
	const result = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs,
		familyIssues: issues,
		sourceRefs,
		audit: options.audit,
	});
	return { ...result, created, linked };
}

export function projectWorkspaceProposalWorkItemLinkApplication<TInput = unknown>(
	record: WorkspaceProposalRecorded<WorkItemLinkProposalDraft>,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalWorkItemLinkApplicationOptions<TInput>,
): WorkspaceProposalWorkItemLinkApplicationResult {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "work-item-link",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const draft = record.draft;
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "workItemLinkApplicationOptions", options);
	const draftIssues = linkDraftIssues(record, draft, options.workItems, options.links);
	const issues = [...familyIssues, ...contextIssues, ...draftIssues];
	const action = draft?.action ?? "link";
	const linked =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined &&
		action === "link"
			? ({
					kind: "work-item-linked",
					eventId: draft.eventId ?? `${options.applicationId}:work-item-linked:${draft.linkId}`,
					linkId: draft.linkId,
					fromWorkItemId: draft.fromWorkItemId ?? "",
					toWorkItemId: draft.toWorkItemId ?? "",
					linkKind: draft.linkKind ?? "",
					direction: draft.direction ?? "directed",
					sourceRefs,
					linkedAtMs: options.linkedAtMs,
					idempotencyKey: record.idempotencyKey,
					metadata: familyMetadata(record, decision, options.audit, draft.metadata),
				} satisfies WorkItemLinked)
			: undefined;
	const unlinked =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		draftIssues.length === 0 &&
		draft !== undefined &&
		action === "unlink"
			? ({
					kind: "work-item-unlinked",
					eventId: draft.eventId ?? `${options.applicationId}:work-item-unlinked:${draft.linkId}`,
					linkId: draft.linkId,
					reason: draft.reason,
					sourceRefs,
					unlinkedAtMs: options.unlinkedAtMs,
					metadata: familyMetadata(record, decision, options.audit, draft.metadata),
				} satisfies WorkItemUnlinked)
			: undefined;
	const emittedFactRefs: WorkspaceProposalApplicationFamilyRef[] = [];
	if (linked !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, linked, { sourceRefs }),
		);
	}
	if (unlinked !== undefined) {
		emittedFactRefs.push(
			workspaceProposalApplicationFamilyRef(record.proposalFamily, unlinked, { sourceRefs }),
		);
	}
	const result = projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs,
		familyIssues: issues,
		sourceRefs,
		audit: options.audit,
	});
	return { ...result, linked, unlinked };
}

export function projectWorkspaceProposalDomainActionApplicationStatus(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalDomainActionApplicationStatusOptions,
): WorkspaceProposalApplicationResult {
	const envelopeIssues = validateWorkspaceProposalApplicationEnvelope(record, decision, {
		expectedFamily: "work-item-domain-action",
	});
	const familyIssues = familySpecificEnvelopeIssues(envelopeIssues);
	const sourceRefs = applicationSourceRefs(
		record,
		decision,
		options.applicationId,
		options.sourceRefs,
		options.audit,
	);
	const contextIssues = dataOnlyFamilyIssues(record, "domainActionApplicationOptions", options);
	const emittedFactRefs =
		envelopeIssues.length === 0 && contextIssues.length === 0
			? options.emittedFacts.map((fact) =>
					workspaceProposalApplicationFamilyRef(record.proposalFamily, fact, { sourceRefs }),
				)
			: [];
	const applicationRef =
		envelopeIssues.length === 0 &&
		contextIssues.length === 0 &&
		options.domainApplication !== undefined
			? workspaceProposalApplicationFamilyRef(record.proposalFamily, options.domainApplication, {
					sourceRefs,
				})
			: undefined;
	return projectWorkspaceProposalApplicationStatus(record, decision, {
		applicationId: options.applicationId,
		emittedFactRefs:
			applicationRef === undefined ? emittedFactRefs : [...emittedFactRefs, applicationRef],
		familyIssues: [...familyIssues, ...contextIssues],
		sourceRefs,
		audit: options.audit,
	});
}

function dataOnlyFamilyIssues(
	record: WorkspaceProposalRecorded,
	label: string,
	value: unknown,
): readonly WorkspaceProposalRecordedIssue[] {
	return workspaceProposalDataOnlyIssues(value, label).map((entry) => ({
		...entry,
		subjectId: entry.subjectId ?? record.proposalId,
		refs: entry.refs ?? recordRefs(record),
	}));
}

function familySpecificEnvelopeIssues(
	issues: readonly WorkspaceProposalRecordedIssue[],
): readonly WorkspaceProposalRecordedIssue[] {
	return issues.filter((entry) => entry.code === "unexpected-proposal-family");
}

function requiredInputDraftIssues<TValue>(
	record: WorkspaceProposalRecorded,
	draft: RequiredInputResponseProposed<TValue> | undefined,
	gate: RequiredInputGate,
	request: RequiredInputRequest | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (!isRecord(draft) || draft.kind !== "required-input-response-proposed") {
		issues.push(
			familyIssue("malformed-family-draft", "Required Input response draft is malformed", record),
		);
		return issues;
	}
	if (gate.kind !== "required-input-gate") {
		issues.push(
			familyIssue("malformed-family-context", "Required Input gate is malformed", record),
		);
		return issues;
	}
	if (gate.status !== "requested" && gate.status !== "response-proposed") {
		issues.push(familyIssue("stale-target-ref", "Required Input gate is not open", record));
	}
	if (gate.requestId !== draft.requestId || gate.workItemId !== draft.workItemId) {
		issues.push(
			familyIssue(
				"proposal-target-mismatch",
				"Required Input response does not match gate target",
				record,
			),
		);
	}
	if (
		request !== undefined &&
		(request.requestId !== draft.requestId || request.workItemId !== draft.workItemId)
	) {
		issues.push(
			familyIssue(
				"proposal-target-mismatch",
				"Required Input response does not match request target",
				record,
			),
		);
	}
	return issues;
}

function spawnDraftIssues<TInput>(
	record: WorkspaceProposalRecorded,
	draft:
		| {
				readonly kind: "work-item-spawn-proposed";
				readonly proposedWorkItemId?: string;
				readonly draft: WorkItemDraft<TInput>;
		  }
		| undefined,
	childWorkItemId: string,
	existingWorkItems: readonly WorkItemProjection<TInput>[] | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (!isRecord(draft) || draft.kind !== "work-item-spawn-proposed") {
		issues.push(familyIssue("malformed-family-draft", "WorkItem spawn draft is malformed", record));
		return issues;
	}
	if (childWorkItemId.trim() === "") {
		issues.push(
			familyIssue("missing-required-field", "WorkItem spawn requires proposedWorkItemId", record),
		);
		return issues;
	}
	if (existingWorkItems?.some((item) => item.workItemId === childWorkItemId) === true) {
		issues.push(
			familyIssue("duplicate-id", `WorkItem '${childWorkItemId}' already exists`, record),
		);
	}
	for (const issue of validateWorkItemDraft(draft.draft, { workItemId: childWorkItemId })) {
		issues.push({
			kind: "issue",
			source: "workspace-proposal",
			severity: "error",
			code: issue.code,
			message: issue.message,
			subjectId: record.proposalId,
			refs: recordRefs(record),
		});
	}
	return issues;
}

function linkDraftIssues<TInput>(
	record: WorkspaceProposalRecorded,
	draft: WorkItemLinkProposalDraft | undefined,
	workItems: readonly WorkItemProjection<TInput>[] | undefined,
	links: readonly WorkItemLinkProjection[] | undefined,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	if (!isRecord(draft) || draft.kind !== "work-item-link-proposal") {
		issues.push(familyIssue("malformed-family-draft", "WorkItem link draft is malformed", record));
		return issues;
	}
	if (!nonBlankString(draft.linkId)) {
		issues.push(
			familyIssue("missing-required-field", "WorkItem link proposal requires linkId", record),
		);
		return issues;
	}
	if (draft.action !== undefined && draft.action !== "link" && draft.action !== "unlink") {
		issues.push(
			familyIssue(
				"unsupported-family-action",
				"WorkItem link proposal action must be link or unlink",
				record,
			),
		);
		return issues;
	}
	if ((draft.action ?? "link") === "unlink") {
		const existing = links?.find((link) => link.linkId === draft.linkId);
		if (existing === undefined || !existing.active) {
			issues.push(
				familyIssue("unknown-target-ref", "WorkItem unlink references no active link", record),
			);
		}
		return issues;
	}
	if (blank(draft.fromWorkItemId) || blank(draft.toWorkItemId) || blank(draft.linkKind)) {
		issues.push(
			familyIssue(
				"missing-required-field",
				"WorkItem link proposal requires fromWorkItemId, toWorkItemId, and linkKind",
				record,
			),
		);
		return issues;
	}
	if (
		workItems !== undefined &&
		(!workItems.some((item) => item.workItemId === draft.fromWorkItemId) ||
			!workItems.some((item) => item.workItemId === draft.toWorkItemId))
	) {
		issues.push(
			familyIssue(
				"unknown-target-ref",
				"WorkItem link proposal references unknown WorkItem",
				record,
			),
		);
	}
	return issues;
}

function familyIssue(
	code: string,
	message: string,
	record: WorkspaceProposalRecorded,
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: record.proposalId,
		refs: recordRefs(record),
	};
}

function familyMetadata(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	audit: WorkspaceProposalAuditMaterial | undefined,
	metadata: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		...metadata,
		applicationProposalId: record.proposalId,
		applicationDecisionId: decision.decisionId,
		applicationIntakeRequestId: record.intakeRequestId,
		applicationIdempotencyKey: record.idempotencyKey,
		applicationPolicyRefs: record.policyRefs,
		applicationAudit: audit ?? record.audit ?? decision.audit,
	};
}

function applicationSourceRefs(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	applicationId: string,
	sourceRefs: readonly SourceRef[] | undefined,
	audit: WorkspaceProposalAuditMaterial | undefined,
): readonly SourceRef[] {
	return uniqueRefs([
		{ kind: "workspace-proposal-recorded", id: record.proposalId },
		{ kind: "workspace-proposal-admission-decision", id: decision.decisionId },
		{ kind: "workspace-proposal-application-status", id: applicationId },
		...record.sourceRefs,
		...decision.sourceRefs,
		...(record.audit?.sourceRefs ?? []),
		...(decision.audit?.sourceRefs ?? []),
		...(audit?.sourceRefs ?? []),
		...(sourceRefs ?? []),
	]);
}

function uniqueRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = `${sourceRef.kind}:${sourceRef.id}:${JSON.stringify(sourceRef.metadata ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(sourceRef);
	}
	return out;
}

function recordRefs(record: WorkspaceProposalRecorded): readonly string[] {
	return [
		`workspace-proposal-recorded:${record.proposalId}`,
		`workspace-proposal-intake-request:${record.intakeRequestId}`,
		...record.sourceRefs.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
	];
}

function blank(value: unknown): value is undefined | null | "" {
	return typeof value !== "string" || value.trim() === "";
}

function nonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
