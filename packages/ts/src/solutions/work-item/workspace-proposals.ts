import type { DataIssue } from "../../data/index.js";
import type { SourceRef } from "../../orchestration/agent-runtime.js";
import { immutableClone } from "./scheduling-shared.js";

export type WorkspaceProposalFamily =
	| "required-input-response"
	| "work-item-spawn"
	| "work-item-link"
	| "work-item-domain-action"
	| (string & {});

export type WorkspaceProposalAdmissionStatus = "admitted" | "rejected" | "blocked" | "needs-review";

export type WorkspaceProposalApplicationState =
	| "applied"
	| "blocked"
	| "not-applied"
	| "pending"
	| "partial"
	| "repair-needed"
	| "idempotency-conflict"
	| "recorded";

export interface WorkspaceProposalAuditMaterial {
	readonly auditId?: string;
	readonly actorId?: string;
	readonly recordedAtMs?: number;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalTargetRef {
	readonly kind: string;
	readonly id: string;
	readonly revision?: string | number;
	readonly freshnessToken?: string;
	readonly workspaceId?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalApplicationFamilyRef {
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly factKind: string;
	readonly factId: string;
	readonly sourceRefs?: readonly SourceRef[];
}

export type WorkspaceProposalEmittedFactRefSource =
	| {
			readonly kind: string;
			readonly eventId: string;
			readonly sourceRefs?: readonly SourceRef[];
	  }
	| {
			readonly kind: string;
			readonly applicationId: string;
			readonly sourceRefs?: readonly SourceRef[];
	  };

export interface WorkspaceProposalApplicationEnvelopeValidationOptions {
	readonly expectedFamily?: WorkspaceProposalFamily;
	readonly expectedLoweringKinds?: readonly string[];
}

export interface WorkspaceProposalProjectionFreshnessEvidence {
	readonly kind: "workspace-proposal-projection-freshness-evidence";
	readonly projectionBundleRef: SourceRef;
	readonly state: "fresh" | "stale" | "unknown";
	readonly currentRevision?: string | number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalReadyRequest<TDraft = unknown> {
	readonly kind: "workspace-proposal-ready-request";
	readonly proposalId: string;
	readonly intakeRequestId: string;
	readonly idempotencyKey: string;
	readonly workspaceId: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly loweringKind: string;
	readonly draft?: TDraft;
	readonly draftRefs?: readonly SourceRef[];
	readonly targetRefs: readonly WorkspaceProposalTargetRef[];
	readonly actorRef: SourceRef;
	readonly capabilityRefs: readonly SourceRef[];
	readonly policyRefs: readonly SourceRef[];
	readonly projectionBundleRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRecorded<TDraft = unknown> {
	readonly kind: "workspace-proposal-recorded";
	readonly proposalId: string;
	readonly intakeRequestId: string;
	readonly idempotencyKey: string;
	readonly workspaceId: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly loweringKind: string;
	readonly draft?: TDraft;
	readonly draftRefs?: readonly SourceRef[];
	readonly draftIdentity: string;
	readonly targetRefs: readonly WorkspaceProposalTargetRef[];
	readonly actorRef: SourceRef;
	readonly capabilityRefs: readonly SourceRef[];
	readonly policyRefs: readonly SourceRef[];
	readonly projectionBundleRefs: readonly SourceRef[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRecordedIssue extends DataIssue {
	readonly source: "workspace-proposal";
}

export interface WorkspaceProposalRecordStatus {
	readonly kind: "workspace-proposal-record-status";
	readonly statusId: string;
	readonly proposalId?: string;
	readonly intakeRequestId?: string;
	readonly workspaceId?: string;
	readonly state: "recorded" | "blocked";
	readonly code?: string;
	readonly issues?: readonly WorkspaceProposalRecordedIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalRecordResult<TDraft = unknown> {
	readonly record?: WorkspaceProposalRecorded<TDraft>;
	readonly status: WorkspaceProposalRecordStatus;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
}

export interface WorkspaceProposalAdmissionPolicy {
	readonly kind: "workspace-proposal-admission-policy";
	readonly policyId: string;
	readonly proposalFamilies?: readonly WorkspaceProposalFamily[];
	readonly loweringKinds?: readonly string[];
	readonly outcome?: WorkspaceProposalAdmissionStatus;
	readonly requiresHumanReview?: boolean;
	readonly requiredCapabilityRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalIdempotencyEvidence {
	readonly kind: "workspace-proposal-idempotency-evidence";
	readonly idempotencyKey: string;
	readonly state: "unique" | "duplicate" | "conflict";
	readonly existingProposalId?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalFreshnessEvidence {
	readonly kind: "workspace-proposal-freshness-evidence";
	readonly targetRef: WorkspaceProposalTargetRef;
	readonly state: "fresh" | "stale" | "unknown";
	readonly currentRevision?: string | number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalCapabilityEvidence {
	readonly kind: "workspace-proposal-capability-evidence";
	readonly capabilityRef: SourceRef;
	readonly state: "present" | "missing" | "blocked";
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalAdmissionMaterial {
	readonly decisionId: string;
	readonly policies?: readonly WorkspaceProposalAdmissionPolicy[];
	readonly idempotencyEvidence?: WorkspaceProposalIdempotencyEvidence;
	readonly freshnessEvidence?: readonly WorkspaceProposalFreshnessEvidence[];
	readonly projectionFreshnessEvidence?: readonly WorkspaceProposalProjectionFreshnessEvidence[];
	readonly capabilityEvidence?: readonly WorkspaceProposalCapabilityEvidence[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly decidedAtMs?: number;
}

export interface WorkspaceProposalAdmissionDecision {
	readonly kind: "workspace-proposal-admission-decision";
	readonly decisionId: string;
	readonly proposalId: string;
	readonly intakeRequestId: string;
	readonly idempotencyKey: string;
	readonly workspaceId: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly loweringKind: string;
	readonly draftIdentity: string;
	readonly targetRefs: readonly WorkspaceProposalTargetRef[];
	readonly actorRef: SourceRef;
	readonly capabilityRefs: readonly SourceRef[];
	readonly policyRefs: readonly SourceRef[];
	readonly status: WorkspaceProposalAdmissionStatus;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly decidedAtMs?: number;
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalAdmissionResult {
	readonly decision: WorkspaceProposalAdmissionDecision;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
}

export interface WorkspaceProposalApplicationStatus {
	readonly kind: "workspace-proposal-application-status";
	readonly applicationId: string;
	readonly proposalId: string;
	readonly intakeRequestId: string;
	readonly idempotencyKey: string;
	readonly workspaceId: string;
	readonly decisionId: string;
	readonly proposalFamily: WorkspaceProposalFamily;
	readonly loweringKind: string;
	readonly targetRefs: readonly WorkspaceProposalTargetRef[];
	readonly policyRefs: readonly SourceRef[];
	readonly state: WorkspaceProposalApplicationState;
	readonly code?: string;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
	readonly emittedFactRefs: readonly WorkspaceProposalApplicationFamilyRef[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalApplicationRecorded {
	readonly kind: "workspace-proposal-application-recorded";
	readonly applicationRecordId: string;
	readonly applicationId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly emittedFactRefs: readonly WorkspaceProposalApplicationFamilyRef[];
	readonly sourceRefs: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkspaceProposalApplicationResult {
	readonly status: WorkspaceProposalApplicationStatus;
	readonly recorded?: WorkspaceProposalApplicationRecorded;
	readonly issues: readonly WorkspaceProposalRecordedIssue[];
}

export interface WorkspaceProposalProjectorOptions {
	readonly supportedFamilies?: readonly WorkspaceProposalFamily[];
	readonly maxInlineDraftBytes?: number;
}

export interface WorkspaceProposalApplicationOptions extends WorkspaceProposalProjectorOptions {
	readonly applicationId: string;
	readonly emittedFactRefs?: readonly WorkspaceProposalApplicationFamilyRef[];
	readonly familyIssues?: readonly WorkspaceProposalRecordedIssue[];
	readonly state?: WorkspaceProposalApplicationState;
	readonly code?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly audit?: WorkspaceProposalAuditMaterial;
}

const DEFAULT_MAX_INLINE_DRAFT_BYTES = 16 * 1024;
const BUILT_IN_FAMILIES = new Set<WorkspaceProposalFamily>([
	"required-input-response",
	"work-item-spawn",
	"work-item-link",
	"work-item-domain-action",
]);

const FORBIDDEN_KEY_NAMES = new Set([
	"accesstoken",
	"apikey",
	"callback",
	"client",
	"clienthandle",
	"command",
	"commandline",
	"credential",
	"credentials",
	"fileedit",
	"fileeditcommand",
	"handler",
	"handlername",
	"mcp",
	"privatekey",
	"providerclient",
	"refreshtoken",
	"registry",
	"provider",
	"runtime",
	"runtimehandle",
	"secret",
	"secrets",
	"sql",
	"sqlquery",
	"cli",
	"bash",
]);

const FORBIDDEN_KEY_PARTS = [
	"accesstoken",
	"apikey",
	"callback",
	"browser",
	"clienthandle",
	"command",
	"credential",
	"fileedit",
	"handlername",
	"mcp",
	"privatekey",
	"provider",
	"refreshtoken",
	"registry",
	"runtime",
	"secret",
	"session",
	"sql",
	"cli",
	"bash",
] as const;

const FAMILY_FACT_KINDS: Readonly<Record<string, readonly string[]>> = {
	"required-input-response": ["required-input-response-applied"],
	"work-item-spawn": ["work-item-created", "work-item-linked"],
	"work-item-link": ["work-item-linked", "work-item-unlinked"],
	"work-item-domain-action": [
		"work-item-domain-action-application",
		"work-item-created",
		"work-item-patched",
		"acceptance-criteria-changed",
		"verification-plan-changed",
	],
};
export function recordWorkspaceProposal<TDraft = unknown>(
	input: WorkspaceProposalReadyRequest<TDraft> | unknown,
	options: WorkspaceProposalProjectorOptions = {},
): WorkspaceProposalRecordResult<TDraft> {
	const issues = readyRequestIssues(input, options);
	if (
		issues.some(
			(entry) =>
				entry.code === "non-data-material" ||
				entry.code === "cyclic-data-material" ||
				entry.code === "forbidden-runtime-material",
		)
	) {
		return {
			status: recordStatus("blocked", {}, issues),
			issues,
		};
	}
	const request = immutableClone(input as WorkspaceProposalReadyRequest<TDraft>);
	if (issues.length > 0) {
		return {
			status: recordStatus("blocked", request, issues),
			issues,
		};
	}
	const draftIdentity = draftIdentityFor(request);
	const record: WorkspaceProposalRecorded<TDraft> = freezeRecord({
		kind: "workspace-proposal-recorded",
		proposalId: request.proposalId,
		intakeRequestId: request.intakeRequestId,
		idempotencyKey: request.idempotencyKey,
		workspaceId: request.workspaceId,
		proposalFamily: request.proposalFamily,
		loweringKind: request.loweringKind,
		...(request.draft === undefined ? {} : { draft: request.draft }),
		...(request.draftRefs === undefined ? {} : { draftRefs: request.draftRefs }),
		draftIdentity,
		targetRefs: request.targetRefs,
		actorRef: request.actorRef,
		capabilityRefs: request.capabilityRefs,
		policyRefs: request.policyRefs,
		projectionBundleRefs: request.projectionBundleRefs ?? [],
		sourceRefs: request.sourceRefs ?? [],
		audit: request.audit,
		metadata: request.metadata,
	});
	return {
		record,
		status: recordStatus("recorded", request, []),
		issues: [],
	};
}

export function decideWorkspaceProposalAdmission(
	record: WorkspaceProposalRecorded,
	material: WorkspaceProposalAdmissionMaterial,
	options: WorkspaceProposalProjectorOptions = {},
): WorkspaceProposalAdmissionResult {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	issues.push(...dataOnlyIssues(record, "record"));
	issues.push(...dataOnlyIssues(material, "admissionMaterial"));
	if (
		issues.some(
			(entry) =>
				entry.code === "non-data-material" ||
				entry.code === "cyclic-data-material" ||
				entry.code === "forbidden-runtime-material",
		)
	) {
		const decision = blockedAdmissionDecision(record, material, issues);
		return { decision, issues };
	}
	if (blank(material.decisionId))
		issues.push(issue("missing-decision-id", "Workspace proposal admission requires decisionId"));
	if (!familySupported(record.proposalFamily, options))
		issues.push(
			issue(
				"unsupported-proposal-family",
				`Unsupported proposal family '${record.proposalFamily}'`,
				{
					subjectId: record.proposalId,
				},
			),
		);
	const policies = material.policies ?? [];
	const matchingPolicies = policies.filter((policy) => policyMatches(policy, record));
	if (policies.length === 0 || matchingPolicies.length === 0) {
		issues.push(
			issue("missing-policy", "Workspace proposal admission has no matching policy material", {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	const policyOutcomes = uniqueStrings(
		matchingPolicies.flatMap((policy) => (policy.outcome === undefined ? [] : [policy.outcome])),
	);
	if (matchingPolicies.length > 0 && policyOutcomes.length === 0) {
		issues.push(
			issue("missing-admission-outcome", "Matching admission policy has no explicit outcome", {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	if (policyOutcomes.length > 1) {
		issues.push(
			issue("conflicting-policy-outcome", "Workspace proposal admission policy outcomes conflict", {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	if (record.capabilityRefs.length === 0) {
		issues.push(
			issue("missing-capability", "Workspace proposal admission requires capability refs", {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	const policyCapabilityRefs = uniqueRefs(
		matchingPolicies.flatMap((policy) => policy.requiredCapabilityRefs ?? []),
	);
	for (const capabilityRef of policyCapabilityRefs) {
		if (!record.capabilityRefs.some((entry) => refEquals(entry, capabilityRef))) {
			issues.push(
				issue(
					"missing-policy-required-capability",
					"Workspace proposal record lacks a policy-required capability ref",
					{ subjectId: record.proposalId, refs: [capabilityRef, ...recordRefs(record)] },
				),
			);
		}
	}
	const requiredCapabilityRefs = uniqueRefs([...record.capabilityRefs, ...policyCapabilityRefs]);
	const capabilityEvidence = material.capabilityEvidence ?? [];
	for (const capabilityRef of requiredCapabilityRefs) {
		const evidence = capabilityEvidence.filter((entry) =>
			refEquals(entry.capabilityRef, capabilityRef),
		);
		const states = uniqueStrings(evidence.map((entry) => entry.state));
		if (evidence.length === 0) {
			issues.push(
				issue(
					"missing-capability-evidence",
					"Workspace proposal admission requires capability evidence",
					{
						subjectId: record.proposalId,
						refs: [capabilityRef, ...recordRefs(record)],
					},
				),
			);
		} else if (states.length > 1) {
			issues.push(
				issue(
					"conflicting-capability-evidence",
					"Workspace proposal capability evidence conflicts",
					{ subjectId: record.proposalId, refs: [capabilityRef, ...recordRefs(record)] },
				),
			);
		} else if (evidence.some((entry) => entry.state !== "present")) {
			const state = evidence.find((entry) => entry.state !== "present")?.state;
			issues.push(
				issue(
					state === "blocked" ? "blocked-capability" : "missing-capability",
					"Workspace proposal capability evidence failed closed",
					{ subjectId: record.proposalId, refs: [capabilityRef, ...recordRefs(record)] },
				),
			);
		}
	}
	const idempotency = material.idempotencyEvidence;
	if (idempotency === undefined) {
		issues.push(
			issue(
				"missing-idempotency-evidence",
				"Workspace proposal admission requires idempotency evidence",
				{
					subjectId: record.proposalId,
					refs: recordRefs(record),
				},
			),
		);
	} else if (idempotency.idempotencyKey !== record.idempotencyKey) {
		issues.push(
			issue(
				"idempotency-key-mismatch",
				"Workspace proposal idempotency evidence mismatches record",
				{
					subjectId: record.proposalId,
					refs: recordRefs(record),
				},
			),
		);
	} else if (idempotency.state !== "unique") {
		issues.push(
			issue(
				idempotency.state === "conflict" ? "idempotency-conflict" : "duplicate-proposal",
				"Workspace proposal idempotency evidence failed closed",
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	const freshness = material.freshnessEvidence ?? [];
	for (const target of record.targetRefs) {
		const evidence = freshness.filter((entry) => targetRefEquals(entry.targetRef, target));
		const states = uniqueStrings(evidence.map((entry) => entry.state));
		if (evidence.length === 0) {
			issues.push(
				issue(
					"missing-freshness-evidence",
					"Workspace proposal admission requires target freshness evidence",
					{
						subjectId: record.proposalId,
						refs: recordRefs(record),
					},
				),
			);
		} else if (states.length > 1) {
			issues.push(
				issue(
					"conflicting-freshness-evidence",
					"Workspace proposal target freshness evidence conflicts",
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
		} else if (evidence.some((entry) => entry.state !== "fresh")) {
			const state = evidence.find((entry) => entry.state !== "fresh")?.state;
			issues.push(
				issue(
					state === "stale" ? "stale-target-ref" : "unknown-target-ref",
					"Workspace proposal target freshness evidence failed closed",
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
		}
	}
	const projectionFreshness = material.projectionFreshnessEvidence ?? [];
	for (const projectionBundleRef of record.projectionBundleRefs) {
		const evidence = projectionFreshness.filter((entry) =>
			refEquals(entry.projectionBundleRef, projectionBundleRef),
		);
		const states = uniqueStrings(evidence.map((entry) => entry.state));
		if (evidence.length === 0) {
			issues.push(
				issue(
					"missing-projection-freshness-evidence",
					"Workspace proposal admission requires projection bundle freshness evidence",
					{ subjectId: record.proposalId, refs: [projectionBundleRef, ...recordRefs(record)] },
				),
			);
		} else if (states.length > 1) {
			issues.push(
				issue(
					"conflicting-projection-freshness-evidence",
					"Workspace proposal projection freshness evidence conflicts",
					{ subjectId: record.proposalId, refs: [projectionBundleRef, ...recordRefs(record)] },
				),
			);
		} else if (evidence.some((entry) => entry.state !== "fresh")) {
			const state = evidence.find((entry) => entry.state !== "fresh")?.state;
			issues.push(
				issue(
					state === "stale" ? "stale-projection-ref" : "unknown-projection-ref",
					"Workspace proposal projection freshness evidence failed closed",
					{ subjectId: record.proposalId, refs: [projectionBundleRef, ...recordRefs(record)] },
				),
			);
		}
	}
	const humanReview = matchingPolicies.some((policy) => policy.requiresHumanReview);
	const policyOutcome =
		policyOutcomes.length === 1
			? (policyOutcomes[0] as WorkspaceProposalAdmissionStatus)
			: undefined;
	const status = admissionStatus(issues, humanReview, policyOutcome);
	const decision: WorkspaceProposalAdmissionDecision = freezeRecord({
		kind: "workspace-proposal-admission-decision",
		decisionId: material.decisionId,
		proposalId: record.proposalId,
		intakeRequestId: record.intakeRequestId,
		idempotencyKey: record.idempotencyKey,
		workspaceId: record.workspaceId,
		proposalFamily: record.proposalFamily,
		loweringKind: record.loweringKind,
		draftIdentity: record.draftIdentity,
		targetRefs: immutableClone(record.targetRefs),
		actorRef: immutableClone(record.actorRef),
		capabilityRefs: immutableClone(record.capabilityRefs),
		policyRefs: immutableClone(record.policyRefs),
		status,
		issues: immutableClone(issues),
		decidedAtMs: material.decidedAtMs,
		sourceRefs: uniqueRefs([...recordRefs(record), ...immutableClone(material.sourceRefs ?? [])]),
		audit: immutableClone(material.audit ?? record.audit),
		metadata: {
			policyIds: matchingPolicies.map((policy) => policy.policyId),
			idempotencyState: idempotency?.state,
		},
	});
	return { decision, issues };
}

export function projectWorkspaceProposalApplicationStatus(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalApplicationOptions,
): WorkspaceProposalApplicationResult {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	issues.push(...dataOnlyIssues(record, "record"));
	issues.push(...dataOnlyIssues(decision, "decision"));
	issues.push(...dataOnlyIssues(options, "applicationOptions"));
	if (
		issues.some(
			(entry) =>
				entry.code === "non-data-material" ||
				entry.code === "cyclic-data-material" ||
				entry.code === "forbidden-runtime-material",
		)
	) {
		return blockedApplicationStatus(record, decision, options, issues);
	}
	if (blank(options.applicationId))
		issues.push(
			issue("missing-application-id", "Workspace proposal application requires applicationId"),
		);
	if (decision.kind !== "workspace-proposal-admission-decision") {
		issues.push(
			issue(
				"malformed-admission-decision",
				"Workspace proposal application requires durable admission decision material",
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	if (!familySupported(record.proposalFamily, options)) {
		issues.push(
			issue(
				"unsupported-proposal-family",
				`Unsupported proposal family '${record.proposalFamily}'`,
				{
					subjectId: record.proposalId,
				},
			),
		);
	}
	const mismatch = envelopeMismatch(record, decision);
	if (mismatch !== undefined) {
		issues.push(
			issue("proposal-envelope-mismatch", mismatch, {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	if (decision.status !== "admitted") {
		issues.push(
			issue("proposal-not-admitted", "Workspace proposal application requires admitted decision", {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	if (decision.issues.length > 0) {
		issues.push(
			issue(
				"admission-decision-has-issues",
				"Workspace proposal application requires issue-free decision",
				{
					subjectId: record.proposalId,
					refs: recordRefs(record),
				},
			),
		);
	}
	issues.push(...immutableClone(options.familyIssues ?? []));
	const emittedFactRefs = immutableClone(options.emittedFactRefs ?? []);
	issues.push(...applicationFamilyRefIssues(emittedFactRefs, record));
	const pendingFamilyRefs =
		emittedFactRefs.length === 0 &&
		familySupported(record.proposalFamily, options) &&
		issues.length === 0;
	const state = resolveApplicationState(issues, pendingFamilyRefs, options.state);
	const terminalRecorded =
		(state === "applied" || state === "recorded") &&
		issues.length === 0 &&
		emittedFactRefs.length > 0;
	const status: WorkspaceProposalApplicationStatus = freezeRecord({
		kind: "workspace-proposal-application-status",
		applicationId: options.applicationId,
		proposalId: record.proposalId,
		intakeRequestId: record.intakeRequestId,
		idempotencyKey: record.idempotencyKey,
		workspaceId: record.workspaceId,
		decisionId: decision.decisionId,
		proposalFamily: record.proposalFamily,
		loweringKind: record.loweringKind,
		targetRefs: immutableClone(record.targetRefs),
		policyRefs: immutableClone(record.policyRefs),
		state,
		code:
			options.code ?? (pendingFamilyRefs ? "pending-family-emitted-fact-refs" : issues[0]?.code),
		issues: immutableClone(issues),
		emittedFactRefs: terminalRecorded ? emittedFactRefs : [],
		sourceRefs: uniqueRefs([
			...recordRefs(record),
			{ kind: "workspace-proposal-admission-decision", id: decision.decisionId },
			...immutableClone(decision.sourceRefs ?? []),
			...immutableClone(options.sourceRefs ?? []),
			...immutableClone(options.audit?.sourceRefs ?? []),
		]),
		audit: immutableClone(options.audit ?? record.audit),
	});
	const recorded = terminalRecorded
		? freezeRecord({
				kind: "workspace-proposal-application-recorded",
				applicationRecordId: `${options.applicationId}:recorded`,
				applicationId: options.applicationId,
				proposalId: record.proposalId,
				decisionId: decision.decisionId,
				emittedFactRefs,
				sourceRefs: status.sourceRefs,
				audit: status.audit,
			} satisfies WorkspaceProposalApplicationRecorded)
		: undefined;
	return { status, recorded, issues };
}

function resolveApplicationState(
	issues: readonly WorkspaceProposalRecordedIssue[],
	pendingFamilyRefs: boolean,
	requestedState: WorkspaceProposalApplicationState | undefined,
): WorkspaceProposalApplicationState {
	if (issues.length > 0) {
		return requestedState === "repair-needed" ||
			requestedState === "idempotency-conflict" ||
			requestedState === "not-applied" ||
			requestedState === "partial"
			? requestedState
			: "blocked";
	}
	if (
		pendingFamilyRefs &&
		(requestedState === undefined || requestedState === "applied" || requestedState === "recorded")
	) {
		return "pending";
	}
	return requestedState ?? (pendingFamilyRefs ? "pending" : "applied");
}

export function validateWorkspaceProposalApplicationEnvelope(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalApplicationEnvelopeValidationOptions = {},
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	issues.push(...dataOnlyIssues(record, "record"));
	issues.push(...dataOnlyIssues(decision, "decision"));
	if (decision.kind !== "workspace-proposal-admission-decision") {
		issues.push(
			issue(
				"malformed-admission-decision",
				"Workspace proposal application requires durable admission decision material",
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	if (options.expectedFamily !== undefined && record.proposalFamily !== options.expectedFamily) {
		issues.push(
			issue(
				"unexpected-proposal-family",
				`Workspace proposal family '${record.proposalFamily}' does not match expected family '${options.expectedFamily}'`,
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	if (
		options.expectedLoweringKinds !== undefined &&
		!options.expectedLoweringKinds.includes(record.loweringKind)
	) {
		issues.push(
			issue(
				"unsupported-lowering-kind",
				`Workspace proposal loweringKind '${record.loweringKind}' is not supported by this family application`,
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	const mismatch = envelopeMismatch(record, decision);
	if (mismatch !== undefined) {
		issues.push(
			issue("proposal-envelope-mismatch", mismatch, {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	if (decision.status !== "admitted") {
		issues.push(
			issue("proposal-not-admitted", "Workspace proposal application requires admitted decision", {
				subjectId: record.proposalId,
				refs: recordRefs(record),
			}),
		);
	}
	if (decision.issues.length > 0) {
		issues.push(
			issue(
				"admission-decision-has-issues",
				"Workspace proposal application requires issue-free decision",
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	if (!decision.sourceRefs.some((entry) => refEquals(entry, recordRefs(record)[0]))) {
		issues.push(
			issue(
				"missing-admission-provenance",
				"Workspace proposal admission decision must reference the recorded proposal",
				{ subjectId: record.proposalId, refs: recordRefs(record) },
			),
		);
	}
	return issues;
}

export function workspaceProposalApplicationFamilyRef(
	proposalFamily: WorkspaceProposalFamily,
	emitted: WorkspaceProposalEmittedFactRefSource,
	options: { readonly sourceRefs?: readonly SourceRef[] } = {},
): WorkspaceProposalApplicationFamilyRef {
	const factId = "eventId" in emitted ? emitted.eventId : emitted.applicationId;
	if (blank(emitted.kind) || blank(factId)) {
		throw new TypeError(
			"Workspace proposal emitted fact refs require fact kind and append-only fact id",
		);
	}
	return freezeRecord({
		proposalFamily,
		factKind: emitted.kind,
		factId,
		sourceRefs: uniqueRefs([...(emitted.sourceRefs ?? []), ...(options.sourceRefs ?? [])]),
	});
}

export function workspaceProposalDataOnlyIssues(
	value: unknown,
	label = "value",
): readonly WorkspaceProposalRecordedIssue[] {
	return dataOnlyIssues(value, label);
}

export function assertWorkspaceProposalDataOnly(value: unknown, label = "value"): void {
	const issues = dataOnlyIssues(value, label);
	if (issues.length > 0) throw new TypeError(issues[0]?.message ?? `${label} is not data-only`);
}

function readyRequestIssues(
	input: unknown,
	options: WorkspaceProposalProjectorOptions,
): WorkspaceProposalRecordedIssue[] {
	const issues = dataOnlyIssues(input, "readyRequest");
	if (!isRecord(input)) {
		issues.push(
			issue("malformed-proposal-envelope", "Workspace proposal ready request must be an object"),
		);
		return issues;
	}
	if (input.kind !== "workspace-proposal-ready-request")
		issues.push(
			issue("malformed-proposal-envelope", "Workspace proposal ready request kind is invalid"),
		);
	for (const key of [
		"proposalId",
		"intakeRequestId",
		"idempotencyKey",
		"workspaceId",
		"proposalFamily",
		"loweringKind",
	] as const) {
		if (blank(input[key])) issues.push(issue(`missing-${kebab(key)}`, `${key} is required`));
	}
	if (!isRef(input.actorRef)) issues.push(issue("missing-actor-ref", "actorRef is required"));
	if (!nonEmptyRefs(input.capabilityRefs))
		issues.push(issue("missing-capability", "capabilityRefs are required"));
	if (!nonEmptyRefs(input.policyRefs))
		issues.push(issue("missing-policy", "policyRefs are required"));
	if (!Array.isArray(input.targetRefs) || input.targetRefs.length === 0) {
		issues.push(issue("missing-target-ref", "targetRefs are required"));
	} else if (!isDenseArray(input.targetRefs) || !input.targetRefs.every(isTargetRef)) {
		issues.push(issue("malformed-target-ref", "targetRefs must be target ref data"));
	}
	if (!nonEmptyRefs(input.projectionBundleRefs))
		issues.push(issue("missing-projection-bundle-ref", "projectionBundleRefs are required"));
	if (!familySupported(input.proposalFamily as WorkspaceProposalFamily, options)) {
		issues.push(
			issue(
				"unsupported-proposal-family",
				`Unsupported proposal family '${String(input.proposalFamily)}'`,
			),
		);
	}
	if (input.draft === undefined && !nonEmptyRefs(input.draftRefs))
		issues.push(issue("missing-draft-material", "draft or draftRefs are required"));
	if (input.draft !== undefined && inlineDraftBytes(input.draft) > maxInlineDraftBytes(options))
		issues.push(issue("oversized-inline-draft", "Workspace proposal inline draft exceeds bound"));
	return issues;
}

function admissionStatus(
	issues: readonly WorkspaceProposalRecordedIssue[],
	humanReview: boolean,
	policyOutcome: WorkspaceProposalAdmissionStatus | undefined,
): WorkspaceProposalAdmissionStatus {
	if (
		issues.some(
			(entry) => entry.code === "missing-policy" || entry.code === "missing-admission-outcome",
		)
	)
		return "needs-review";
	if (humanReview || policyOutcome === "needs-review") return "needs-review";
	if (policyOutcome === "rejected" || issues.some((entry) => entry.code === "duplicate-proposal"))
		return "rejected";
	if (policyOutcome === "blocked" || issues.length > 0) return "blocked";
	return policyOutcome === "admitted" ? "admitted" : "needs-review";
}

function policyMatches(
	policy: WorkspaceProposalAdmissionPolicy,
	record: WorkspaceProposalRecorded,
) {
	if (
		policy.proposalFamilies !== undefined &&
		!policy.proposalFamilies.includes(record.proposalFamily)
	)
		return false;
	if (policy.loweringKinds !== undefined && !policy.loweringKinds.includes(record.loweringKind))
		return false;
	return true;
}

function envelopeMismatch(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
): string | undefined {
	const fields = [
		"proposalId",
		"intakeRequestId",
		"idempotencyKey",
		"workspaceId",
		"proposalFamily",
		"loweringKind",
		"draftIdentity",
	] as const;
	for (const field of fields) if (record[field] !== decision[field]) return `${field} mismatch`;
	if (!refEquals(record.actorRef, decision.actorRef)) return "actorRef mismatch";
	if (stableStringify(record.capabilityRefs) !== stableStringify(decision.capabilityRefs))
		return "capabilityRefs mismatch";
	if (stableStringify(record.policyRefs) !== stableStringify(decision.policyRefs))
		return "policyRefs mismatch";
	if (stableStringify(record.targetRefs) !== stableStringify(decision.targetRefs))
		return "targetRefs mismatch";
	for (const sourceRef of record.sourceRefs) {
		if (!decision.sourceRefs.some((entry) => refEquals(entry, sourceRef)))
			return "sourceRefs mismatch";
	}
	return undefined;
}

function recordStatus(
	state: "recorded" | "blocked",
	request: Partial<WorkspaceProposalReadyRequest>,
	issues: readonly WorkspaceProposalRecordedIssue[],
): WorkspaceProposalRecordStatus {
	return freezeRecord({
		kind: "workspace-proposal-record-status",
		statusId: `${request.proposalId ?? request.intakeRequestId ?? "unknown"}:${state}`,
		proposalId: stringOrUndefined(request.proposalId),
		intakeRequestId: stringOrUndefined(request.intakeRequestId),
		workspaceId: stringOrUndefined(request.workspaceId),
		state,
		code: issues[0]?.code,
		issues: issues.length === 0 ? undefined : issues,
		sourceRefs: request.sourceRefs,
		audit: request.audit,
	});
}

function blockedAdmissionDecision(
	record: WorkspaceProposalRecorded,
	_material: Partial<WorkspaceProposalAdmissionMaterial>,
	issues: readonly WorkspaceProposalRecordedIssue[],
): WorkspaceProposalAdmissionDecision {
	return freezeRecord({
		kind: "workspace-proposal-admission-decision",
		decisionId: `${record.proposalId}:admission-blocked`,
		proposalId: record.proposalId,
		intakeRequestId: record.intakeRequestId,
		idempotencyKey: record.idempotencyKey,
		workspaceId: record.workspaceId,
		proposalFamily: record.proposalFamily,
		loweringKind: record.loweringKind,
		draftIdentity: record.draftIdentity,
		targetRefs: record.targetRefs,
		actorRef: record.actorRef,
		capabilityRefs: record.capabilityRefs,
		policyRefs: record.policyRefs,
		status: "blocked",
		issues,
		sourceRefs: record.sourceRefs,
		audit: record.audit,
	});
}

function blockedApplicationStatus(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	options: WorkspaceProposalApplicationOptions,
	issues: readonly WorkspaceProposalRecordedIssue[],
): WorkspaceProposalApplicationResult {
	const status: WorkspaceProposalApplicationStatus = freezeRecord({
		kind: "workspace-proposal-application-status",
		applicationId: options.applicationId,
		proposalId: record.proposalId,
		intakeRequestId: record.intakeRequestId,
		idempotencyKey: record.idempotencyKey,
		workspaceId: record.workspaceId,
		decisionId: decision.decisionId,
		proposalFamily: record.proposalFamily,
		loweringKind: record.loweringKind,
		targetRefs: record.targetRefs,
		policyRefs: record.policyRefs,
		state: "blocked",
		code: issues[0]?.code,
		issues,
		emittedFactRefs: [],
		sourceRefs: uniqueRefs([
			...recordRefs(record),
			{ kind: "workspace-proposal-admission-decision", id: decision.decisionId },
			...record.sourceRefs,
			...(options.audit?.sourceRefs ?? []),
		]),
		audit: options.audit ?? record.audit,
	});
	return { status, issues };
}

function dataOnlyIssues(value: unknown, label: string): WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	const active = new WeakSet<object>();
	const visit = (entry: unknown, path: string): void => {
		if (
			entry === null ||
			typeof entry === "number" ||
			typeof entry === "boolean" ||
			typeof entry === "undefined"
		)
			return;
		if (typeof entry === "string") {
			if (forbiddenStringMaterial(entry))
				issues.push(issue("forbidden-runtime-material", `${path} is not proposal data material`));
			return;
		}
		if (typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint") {
			issues.push(issue("non-data-material", `${path} is not structured data`));
			return;
		}
		if (typeof entry !== "object") return;
		if (active.has(entry)) {
			issues.push(issue("cyclic-data-material", `${path} contains a cycle`));
			return;
		}
		active.add(entry);
		if (Array.isArray(entry)) {
			for (let index = 0; index < entry.length; index += 1) {
				if (!Object.hasOwn(entry, index)) {
					issues.push(issue("non-data-material", `${path}[${index}] is a sparse array hole`));
					continue;
				}
				visit(entry[index], `${path}[${index}]`);
			}
			for (const key of Reflect.ownKeys(entry))
				inspectOwnKey(entry, key, path, true, visit, issues);
			active.delete(entry);
			return;
		}
		const proto = Object.getPrototypeOf(entry);
		if (proto !== Object.prototype && proto !== null) {
			issues.push(issue("non-data-material", `${path} must be a plain object or array`));
			active.delete(entry);
			return;
		}
		for (const key of Reflect.ownKeys(entry)) {
			inspectOwnKey(entry, key, path, false, visit, issues);
		}
		active.delete(entry);
	};
	visit(value, label);
	return issues;
}

function inspectOwnKey(
	entry: object,
	key: string | symbol,
	path: string,
	arrayKey: boolean,
	visit: (entry: unknown, path: string) => void,
	issues: WorkspaceProposalRecordedIssue[],
): void {
	if (typeof key !== "string") {
		issues.push(issue("non-data-material", `${path} contains a non-string key`));
		return;
	}
	if (arrayKey && (key === "length" || arrayIndexKey(key))) return;
	const childPath = arrayKey ? `${path}.${key}` : `${path}.${key}`;
	const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
	if (forbiddenKeyName(normalized)) {
		issues.push(issue("forbidden-runtime-material", `${childPath} is not proposal data material`));
	}
	const descriptor = Object.getOwnPropertyDescriptor(entry, key);
	if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
		issues.push(issue("non-data-material", `${childPath} uses an accessor`));
		return;
	}
	visit((entry as Record<string, unknown>)[key], childPath);
}

function forbiddenKeyName(normalized: string): boolean {
	return (
		FORBIDDEN_KEY_NAMES.has(normalized) ||
		FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part))
	);
}

function issue(
	code: string,
	message: string,
	opts: { readonly subjectId?: string; readonly refs?: readonly SourceRef[] } = {},
): WorkspaceProposalRecordedIssue {
	return {
		kind: "issue",
		source: "workspace-proposal",
		severity: "error",
		code,
		message,
		subjectId: opts.subjectId,
		refs: opts.refs?.map((entry) => `${entry.kind}:${entry.id}`),
	};
}

function recordRefs(record: WorkspaceProposalRecorded): readonly SourceRef[] {
	return [
		{ kind: "workspace-proposal-recorded", id: record.proposalId },
		{ kind: "workspace-proposal-intake-request", id: record.intakeRequestId },
		...record.sourceRefs,
	];
}

function draftIdentityFor(request: WorkspaceProposalReadyRequest): string {
	if (request.draftRefs !== undefined && request.draftRefs.length > 0)
		return `refs:${stableStringify(request.draftRefs)}`;
	return `inline:${stableStringify(request.draft)}`;
}

function familySupported(
	family: WorkspaceProposalFamily,
	options: WorkspaceProposalProjectorOptions,
): boolean {
	const supported = options.supportedFamilies ?? Array.from(BUILT_IN_FAMILIES);
	return supported.includes(family);
}

function inlineDraftBytes(value: unknown): number {
	return new TextEncoder().encode(stableStringify(value)).byteLength;
}

function maxInlineDraftBytes(options: WorkspaceProposalProjectorOptions): number {
	return options.maxInlineDraftBytes ?? DEFAULT_MAX_INLINE_DRAFT_BYTES;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function targetRefEquals(
	left: WorkspaceProposalTargetRef,
	right: WorkspaceProposalTargetRef,
): boolean {
	return stableStringify(left) === stableStringify(right);
}

function refEquals(left: SourceRef, right: SourceRef): boolean {
	return left.kind === right.kind && left.id === right.id;
}

function uniqueRefs(refs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const ref of refs) {
		const key = `${ref.kind}:${ref.id}:${stableStringify(ref.metadata)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return out;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function applicationFamilyRefIssues(
	refs: readonly WorkspaceProposalApplicationFamilyRef[],
	record: WorkspaceProposalRecorded,
): readonly WorkspaceProposalRecordedIssue[] {
	const issues: WorkspaceProposalRecordedIssue[] = [];
	for (const [index, value] of refs.entries()) {
		if (!isRecord(value)) {
			issues.push(
				issue(
					"malformed-family-emitted-fact-ref",
					"Workspace proposal application emitted fact refs must be closed ref records",
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
			continue;
		}
		for (const key of Object.keys(value)) {
			if (!["proposalFamily", "factKind", "factId", "sourceRefs"].includes(key)) {
				issues.push(
					issue(
						"malformed-family-emitted-fact-ref",
						`Workspace proposal application emitted fact ref contains unsupported field '${key}'`,
						{ subjectId: record.proposalId, refs: recordRefs(record) },
					),
				);
			}
		}
		if (value.proposalFamily !== record.proposalFamily) {
			issues.push(
				issue(
					"family-ref-mismatch",
					"Workspace proposal application emitted fact ref mismatches family",
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
		}
		if (blank(value.factKind) || blank(value.factId)) {
			issues.push(
				issue(
					"malformed-family-emitted-fact-ref",
					`Workspace proposal application emitted fact ref at index ${index} requires factKind and factId`,
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
		}
		const allowedFactKinds = FAMILY_FACT_KINDS[record.proposalFamily];
		if (allowedFactKinds === undefined || !allowedFactKinds.includes(value.factKind as string)) {
			issues.push(
				issue(
					"unsupported-family-fact-kind",
					`Workspace proposal family '${record.proposalFamily}' does not allow emitted fact kind '${String(value.factKind)}'`,
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
		}
		if (value.sourceRefs !== undefined && !refsShape(value.sourceRefs)) {
			issues.push(
				issue(
					"malformed-family-emitted-fact-ref",
					"Workspace proposal application emitted fact ref sourceRefs must be refs",
					{ subjectId: record.proposalId, refs: recordRefs(record) },
				),
			);
		}
	}
	return issues;
}

function isTargetRef(value: unknown): value is WorkspaceProposalTargetRef {
	return isRecord(value) && nonBlankString(value.kind) && nonBlankString(value.id);
}

function isRef(value: unknown): value is SourceRef {
	return isRecord(value) && nonBlankString(value.kind) && nonBlankString(value.id);
}

function nonEmptyRefs(value: unknown): value is readonly SourceRef[] {
	return refsShape(value) && value.length > 0;
}

function refsShape(value: unknown): value is readonly SourceRef[] {
	return Array.isArray(value) && isDenseArray(value) && value.every(isRef);
}

function isDenseArray(value: readonly unknown[]): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function blank(value: unknown): boolean {
	return !nonBlankString(value);
}

function nonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function kebab(value: string): string {
	return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function arrayIndexKey(key: string): boolean {
	if (key === "") return false;
	const index = Number(key);
	return Number.isInteger(index) && index >= 0 && String(index) === key;
}

function forbiddenStringMaterial(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed === "") return false;
	if (/^(https?|file|ssh|sftp|postgres|postgresql|mysql|sqlite|mongodb|redis):\/\//i.test(trimmed))
		return true;
	if (/^(bash|sh|zsh|fish|pwsh|powershell)\s+-[a-z]*c\b/i.test(trimmed)) return true;
	if (/\b(rm\s+-rf|curl\s+https?:|wget\s+https?:|psql\s+|mysql\s+|sqlite3\s+)/i.test(trimmed))
		return true;
	if (
		/\b(bearer\s+[a-z0-9._~+/=-]+|credential:|secret:|api[_-]?key\s*=|access[_-]?token\s*=)/i.test(
			trimmed,
		)
	)
		return true;
	if (
		/^\s*(select|insert|update|delete|drop|alter|create)\s+.+\b(from|into|table|database|where)\b/i.test(
			trimmed,
		)
	)
		return true;
	return false;
}

function freezeRecord<T extends object>(value: T): T {
	return immutableClone(value);
}
