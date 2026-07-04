import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../../identity.js";
import type { BoundaryCapabilityKind, BoundaryCapabilityRef } from "../../inspection/boundary.js";
import type { SourceRef } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionProposal,
} from "../../orchestration/work-item-runtime.js";
import type { CapabilityAdmission, CapabilityAdmissionStatus } from "../capability-admission.js";
import {
	dataIssue,
	isRecord,
	project,
	recordString,
	ref,
	stringMetadata,
	uniqueSourceRefs,
} from "./actions-shared.js";
import type {
	CapabilityGuardFact,
	CapabilityGuardState,
	WorkItemDomainActionCapabilityGuardBundle,
	WorkItemDomainActionCapabilityGuardOptions,
	WorkItemDomainActionCapabilityGuardPolicy,
	WorkItemDomainActionCapabilityGuardStatus,
} from "./actions-types.js";

/**
 * Connects CapabilityAdmission facts to WorkItem domain-action admission as a
 * product-owned guard (D357), without adding protocol/boundary vocabulary or
 * treating AutoPanel display affordances as hard security enforcement.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A node bundle that emits the projected records.
 * @category solutions
 * @example
 * ```ts
 * import { workItemDomainActionCapabilityGuardProjector } from "@graphrefly/ts/solutions/work-item/actions";
 * ```
 */
export function workItemDomainActionCapabilityGuardProjector(
	graph: Graph,
	opts: WorkItemDomainActionCapabilityGuardOptions,
): WorkItemDomainActionCapabilityGuardBundle {
	const name = opts.name ?? "workItemDomainActionCapabilityGuard";
	const deps =
		opts.capabilityAdmissionStatus === undefined
			? [opts.proposals, opts.capabilityAdmissions, opts.guardPolicies]
			: [
					opts.proposals,
					opts.capabilityAdmissions,
					opts.guardPolicies,
					opts.capabilityAdmissionStatus,
				];
	const statusIndex = opts.capabilityAdmissionStatus === undefined ? -1 : 3;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<CapabilityGuardFact>(
		deps,
		(ctx) => {
			const state: CapabilityGuardState = ctx.state.get<CapabilityGuardState>() ?? {
				proposals: new Map(),
				admissionsByCapability: new Map(),
				issueStatusesByCapability: new Map(),
				issueStatusesWithoutCapability: [],
				policies: new Map(),
				emittedProposalDecisions: new Set(),
				emittedStatusKeys: new Set(),
				issueKeys: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 2) ?? []) {
				const policyIssue = capabilityGuardPolicyIssue(raw);
				if (policyIssue !== undefined) {
					emitCapabilityGuardIssue(
						ctx,
						state,
						`malformed-policy:${recordString(raw, "policyId") ?? "unknown"}`,
						policyIssue,
					);
					continue;
				}
				const policy = raw as WorkItemDomainActionCapabilityGuardPolicy;
				state.policies.set(policy.policyId, policy);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const admissionIssue = capabilityAdmissionIssue(raw);
				if (admissionIssue !== undefined) {
					emitCapabilityGuardIssue(
						ctx,
						state,
						`malformed-admission:${recordString(raw, "admissionId") ?? "unknown"}`,
						admissionIssue,
					);
					continue;
				}
				const admission = raw as CapabilityAdmission;
				const capabilityKey = capabilityBoundaryRefId(admission.capability);
				const byCapability: CapabilityAdmission[] =
					state.admissionsByCapability.get(capabilityKey) ?? [];
				if (!byCapability.some((item) => item.admissionId === admission.admissionId)) {
					state.admissionsByCapability.set(capabilityKey, [...byCapability, admission]);
				}
			}
			if (statusIndex >= 0) {
				for (const raw of depBatch(ctx, statusIndex) ?? []) {
					const statusIssue = capabilityAdmissionStatusIssue(raw);
					if (statusIssue !== undefined) {
						emitCapabilityGuardIssue(
							ctx,
							state,
							`malformed-capability-status:${recordString(raw, "statusId") ?? "unknown"}`,
							statusIssue,
						);
						continue;
					}
					const status = raw as CapabilityAdmissionStatus;
					if (status.state !== "capability-admission-issue") continue;
					const capabilityId = status.capabilityId;
					const capabilityKind = status.capabilityKind;
					if (capabilityId !== undefined && capabilityKind !== undefined) {
						const capabilityKey = capabilityBoundaryRefId({
							id: capabilityId,
							kind: capabilityKind,
						});
						const statuses: CapabilityAdmissionStatus[] =
							state.issueStatusesByCapability.get(capabilityKey) ?? [];
						if (!statuses.some((item) => item.statusId === status.statusId)) {
							state.issueStatusesByCapability.set(capabilityKey, [...statuses, status]);
						}
					} else if (
						!state.issueStatusesWithoutCapability.some((item) => item.statusId === status.statusId)
					) {
						state.issueStatusesWithoutCapability.push(status);
					}
					for (const proposal of state.proposals.values())
						emitCapabilityStatusIssueForProposal(ctx, state, proposal, status);
				}
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposalIssue = capabilityGuardProposalIssue(raw);
				if (proposalIssue !== undefined) {
					emitCapabilityGuardIssue(
						ctx,
						state,
						`malformed-proposal:${recordString(raw, "proposalId") ?? "unknown"}`,
						proposalIssue,
					);
					continue;
				}
				const proposal = raw as WorkItemDomainActionProposal;
				state.proposals.set(proposal.proposalId, proposal);
			}
			for (const proposal of state.proposals.values())
				evaluateCapabilityGuardProposal(ctx, state, proposal, now());
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemDomainActionCapabilityGuardProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		decisions: project(
			graph,
			runtime,
			`${name}/decisions`,
			"workItemDomainActionCapabilityGuardDecisions",
			(fact) => (fact.kind === "decision" ? fact.value : undefined),
		),
		status: project(
			graph,
			runtime,
			`${name}/status`,
			"workItemDomainActionCapabilityGuardStatus",
			(fact) => (fact.kind === "status" ? fact.value : undefined),
		),
		issues: project(
			graph,
			runtime,
			`${name}/issues`,
			"workItemDomainActionCapabilityGuardIssues",
			(fact) => (fact.kind === "issue" ? fact.value : undefined),
		),
		audit: project(
			graph,
			runtime,
			`${name}/audit`,
			"workItemDomainActionCapabilityGuardAudit",
			(fact) => (fact.kind === "audit" ? fact.value : undefined),
		),
	};
}

function evaluateCapabilityGuardProposal(
	ctx: Ctx,
	state: CapabilityGuardState,
	proposal: WorkItemDomainActionProposal,
	decidedAtMs: number,
): void {
	if (state.emittedProposalDecisions.has(proposal.proposalId)) return;
	const policy = selectCapabilityGuardPolicy(state, proposal);
	if (typeof policy === "string") {
		emitCapabilityGuardIssue(
			ctx,
			state,
			compoundTupleKey("policy", [proposal.proposalId, policy]),
			dataIssue(policy, capabilityGuardPolicyMessage(policy, proposal), {
				subjectId: proposal.workItemId,
				refs: [ref("work-item-domain-action-proposal", proposal.proposalId)],
			}),
		);
		return;
	}
	for (const status of state.issueStatusesWithoutCapability)
		emitCapabilityStatusIssueForProposal(ctx, state, proposal, status);
	for (const capabilityRef of policy.capabilityRefs) {
		for (const status of state.issueStatusesByCapability.get(
			capabilityBoundaryRefId(capabilityRef),
		) ?? [])
			emitCapabilityStatusIssueForProposal(ctx, state, proposal, status);
	}
	const admissions = policy.capabilityRefs.map((capabilityRef) =>
		latestCapabilityAdmission(state, policy, capabilityRef),
	);
	const missingCapabilityRefs = policy.capabilityRefs.filter(
		(_, index) => admissions[index] === undefined,
	);
	const deferredCapabilityRefs = admissions
		.filter((admission): admission is CapabilityAdmission => admission !== undefined)
		.filter((admission) => admission.state === "deferred")
		.map((admission) => capabilityBoundaryRefId(admission.capability));
	if (missingCapabilityRefs.length > 0 || deferredCapabilityRefs.length > 0) {
		emitCapabilityGuardStatusOnce(
			ctx,
			state,
			compoundTupleKey("deferred", [
				proposal.proposalId,
				policy.policyId,
				canonicalTupleKey(missingCapabilityRefs.map(capabilityBoundaryRefId)),
				canonicalTupleKey(deferredCapabilityRefs),
			]),
			{
				state: "deferred",
				workItemId: proposal.workItemId,
				proposalId: proposal.proposalId,
				actionKind: proposal.actionKind,
				policyId: policy.policyId,
				capabilityRefs: policy.capabilityRefs,
				admissionSubjectIds: policy.admissionSubjectIds,
				message: "WorkItem domain action is waiting for capability admission",
				sourceRefs: capabilityGuardRefs(proposal, policy, admissions),
				metadata: {
					missingCapabilityRefs: missingCapabilityRefs.map(capabilityBoundaryRefId),
					deferredCapabilityRefs,
				},
			},
		);
		return;
	}
	const presentAdmissions = admissions.filter(
		(admission): admission is CapabilityAdmission => admission !== undefined,
	);
	const blocked = presentAdmissions.filter((admission) => admission.state === "blocked");
	const outcome: WorkItemDomainActionAdmissionDecision["outcome"] =
		blocked.length === 0 ? "admit" : "reject";
	const decision: WorkItemDomainActionAdmissionDecision = {
		kind: "work-item-domain-action-admission-decision",
		decisionId: compoundTupleKey("capability-guard-decision", [proposal.proposalId]),
		admissionId: compoundTupleKey("capability-guard-admission", [proposal.proposalId]),
		proposalId: proposal.proposalId,
		outcome,
		reason:
			blocked.length === 0
				? "Capability guard admitted required capabilities"
				: "Capability guard rejected blocked capabilities",
		decidedAtMs,
		sourceRefs: capabilityGuardRefs(proposal, policy, presentAdmissions),
		metadata: {
			capabilityGuardPolicyId: policy.policyId,
			capabilityRefs: policy.capabilityRefs.map(capabilityBoundaryRefId),
			admissionSubjectIds: policy.admissionSubjectIds,
			blockedCapabilityRefs: blocked.map((admission) =>
				capabilityBoundaryRefId(admission.capability),
			),
		},
	};
	state.emittedProposalDecisions.add(proposal.proposalId);
	emitCapabilityGuard(ctx, "decision", decision);
	emitCapabilityGuardStatus(ctx, state, {
		state: outcome === "admit" ? "admitted" : "rejected",
		workItemId: proposal.workItemId,
		proposalId: proposal.proposalId,
		actionKind: proposal.actionKind,
		policyId: policy.policyId,
		capabilityRefs: policy.capabilityRefs,
		admissionSubjectIds: policy.admissionSubjectIds,
		admissionIds: presentAdmissions.map((admission) => admission.admissionId),
		sourceRefs: decision.sourceRefs,
		metadata: { decisionId: decision.decisionId, admissionId: decision.admissionId },
	});
}

function capabilityGuardProposalIssue(proposal: unknown): DataIssue | undefined {
	if (
		!isRecord(proposal) ||
		proposal.kind !== "work-item-domain-action-proposal" ||
		typeof proposal.proposalId !== "string" ||
		proposal.proposalId.length === 0 ||
		typeof proposal.workItemId !== "string" ||
		proposal.workItemId.length === 0 ||
		typeof proposal.actionKind !== "string" ||
		proposal.actionKind.length === 0 ||
		(proposal.sourceRefs !== undefined && !isSourceRefArray(proposal.sourceRefs))
	) {
		return dataIssue(
			"malformed-work-item-domain-action-capability-guard-proposal",
			"WorkItem domain action capability guard requires valid proposal DATA facts",
			{ subjectId: recordString(proposal, "workItemId") },
		);
	}
	return undefined;
}

function capabilityGuardPolicyIssue(policy: unknown): DataIssue | undefined {
	if (
		!isRecord(policy) ||
		policy.kind !== "work-item-domain-action-capability-guard-policy" ||
		typeof policy.policyId !== "string" ||
		policy.policyId.length === 0 ||
		!Array.isArray(policy.capabilityRefs) ||
		policy.capabilityRefs.length === 0 ||
		!policy.capabilityRefs.every(isBoundaryCapabilityRef) ||
		!Array.isArray(policy.admissionSubjectIds) ||
		policy.admissionSubjectIds.length === 0 ||
		!policy.admissionSubjectIds.every((id) => typeof id === "string" && id.length > 0) ||
		(policy.actionKinds !== undefined &&
			(!Array.isArray(policy.actionKinds) ||
				!policy.actionKinds.every((kind) => typeof kind === "string" && kind.length > 0)))
	) {
		return dataIssue(
			"malformed-work-item-domain-action-capability-guard-policy",
			"WorkItem domain action capability guard policy requires policyId, capabilityRefs, and admissionSubjectIds",
			{
				subjectId: recordString(policy, "policyId"),
			},
		);
	}
	return undefined;
}

function capabilityAdmissionIssue(admission: unknown): DataIssue | undefined {
	if (
		!isRecord(admission) ||
		admission.kind !== "capability-admission" ||
		typeof admission.admissionId !== "string" ||
		admission.admissionId.length === 0 ||
		typeof admission.proposalId !== "string" ||
		admission.proposalId.length === 0 ||
		typeof admission.subjectId !== "string" ||
		admission.subjectId.length === 0 ||
		!isBoundaryCapabilityRef(admission.capability) ||
		!isCapabilityAdmissionState(admission.state) ||
		typeof admission.decisionId !== "string" ||
		admission.decisionId.length === 0 ||
		(admission.sourceRefs !== undefined && !isSourceRefArray(admission.sourceRefs))
	) {
		return dataIssue(
			"malformed-capability-admission",
			"WorkItem domain action capability guard requires valid CapabilityAdmission DATA facts",
			{ subjectId: recordString(admission, "subjectId") },
		);
	}
	return undefined;
}

function capabilityAdmissionStatusIssue(status: unknown): DataIssue | undefined {
	if (
		!isRecord(status) ||
		status.kind !== "capability-admission-status" ||
		typeof status.statusId !== "string" ||
		status.statusId.length === 0 ||
		!isCapabilityAdmissionStatusState(status.state)
	) {
		return dataIssue(
			"malformed-capability-admission-status",
			"WorkItem domain action capability guard requires valid CapabilityAdmissionStatus DATA facts",
			{ subjectId: recordString(status, "subjectId") },
		);
	}
	const hasCapabilityId = status.capabilityId !== undefined;
	const hasCapabilityKind = status.capabilityKind !== undefined;
	if (
		hasCapabilityId !== hasCapabilityKind ||
		(hasCapabilityId &&
			(typeof status.capabilityId !== "string" ||
				status.capabilityId.length === 0 ||
				!isBoundaryCapabilityKind(status.capabilityKind))) ||
		(status.sourceRefs !== undefined && !isSourceRefArray(status.sourceRefs)) ||
		(status.issues !== undefined && !isDataIssueArray(status.issues))
	) {
		return dataIssue(
			"malformed-capability-admission-status",
			"WorkItem domain action capability guard requires valid CapabilityAdmissionStatus DATA facts",
			{ subjectId: recordString(status, "subjectId") },
		);
	}
	return undefined;
}

function isCapabilityAdmissionState(value: unknown): value is CapabilityAdmission["state"] {
	return value === "allowed" || value === "blocked" || value === "deferred";
}

function isCapabilityAdmissionStatusState(
	value: unknown,
): value is CapabilityAdmissionStatus["state"] {
	return (
		value === "capability-admission-allowed" ||
		value === "capability-admission-blocked" ||
		value === "capability-admission-deferred" ||
		value === "capability-admission-issue"
	);
}

function isSourceRefArray(value: unknown): value is readonly SourceRef[] {
	return (
		Array.isArray(value) &&
		value.every(
			(item) => isRecord(item) && typeof item.kind === "string" && typeof item.id === "string",
		)
	);
}

function isDataIssueArray(value: unknown): value is readonly DataIssue[] {
	return Array.isArray(value) && value.every(isDataIssue);
}

function isDataIssue(value: unknown): value is DataIssue {
	return (
		isRecord(value) &&
		value.kind === "issue" &&
		typeof value.code === "string" &&
		value.code.length > 0 &&
		typeof value.message === "string" &&
		value.message.length > 0
	);
}

function isBoundaryCapabilityRef(value: unknown): value is BoundaryCapabilityRef {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		value.id.length > 0 &&
		isBoundaryCapabilityKind(value.kind) &&
		typeof value.required === "boolean" &&
		(value.sourceRefs === undefined ||
			(Array.isArray(value.sourceRefs) &&
				value.sourceRefs.every((sourceRef) => typeof sourceRef === "string")))
	);
}

function isBoundaryCapabilityKind(value: unknown): value is BoundaryCapabilityKind {
	return value === "auth" || value === "permission" || value === "config" || value === "resource";
}

function selectCapabilityGuardPolicy(
	state: CapabilityGuardState,
	proposal: WorkItemDomainActionProposal,
):
	| WorkItemDomainActionCapabilityGuardPolicy
	| "missing-policy"
	| "unknown-work-item-domain-action-capability-guard-policy"
	| "policy-mismatch" {
	const explicitId =
		stringMetadata(proposal.metadata, "capabilityGuardPolicyId") ??
		proposal.sourceRefs?.find(
			(sourceRef) => sourceRef.kind === "work-item-domain-action-capability-guard-policy",
		)?.id;
	if (explicitId !== undefined)
		return (
			state.policies.get(explicitId) ?? "unknown-work-item-domain-action-capability-guard-policy"
		);
	const matching = [...state.policies.values()].filter(
		(policy) =>
			policy.actionKinds === undefined || policy.actionKinds.includes(proposal.actionKind),
	);
	if (matching.length === 0) return "missing-policy";
	if (matching.length > 1) return "policy-mismatch";
	return matching[0];
}

function latestCapabilityAdmission(
	state: CapabilityGuardState,
	policy: WorkItemDomainActionCapabilityGuardPolicy,
	capabilityRef: BoundaryCapabilityRef,
): CapabilityAdmission | undefined {
	const admissions = state.admissionsByCapability.get(capabilityBoundaryRefId(capabilityRef)) ?? [];
	for (let index = admissions.length - 1; index >= 0; index -= 1) {
		const admission = admissions[index];
		if (admission !== undefined && policy.admissionSubjectIds.includes(admission.subjectId))
			return admission;
	}
	return undefined;
}

function emitCapabilityStatusIssueForProposal(
	ctx: Ctx,
	state: CapabilityGuardState,
	proposal: WorkItemDomainActionProposal,
	status: CapabilityAdmissionStatus,
): void {
	const policy = selectCapabilityGuardPolicy(state, proposal);
	if (typeof policy === "string") return;
	if (status.subjectId !== undefined && !policy.admissionSubjectIds.includes(status.subjectId))
		return;
	const capabilityId = status.capabilityId;
	const capabilityKind = status.capabilityKind;
	const statusCapabilityKey =
		capabilityId === undefined || capabilityKind === undefined
			? undefined
			: capabilityBoundaryRefId({ id: capabilityId, kind: capabilityKind });
	if (
		statusCapabilityKey !== undefined &&
		!policy.capabilityRefs.some(
			(capabilityRef) => capabilityBoundaryRefId(capabilityRef) === statusCapabilityKey,
		)
	)
		return;
	const issue =
		status.issues?.[0] ??
		dataIssue(
			"capability-admission-status-issue",
			"Capability admission status reported an issue",
			{ subjectId: proposal.workItemId },
		);
	emitCapabilityGuardIssue(
		ctx,
		state,
		compoundTupleKey("capability-status", [proposal.proposalId, status.statusId]),
		dataIssue(issue.code, issue.message, {
			subjectId: proposal.workItemId,
			refs: uniqueSourceRefs([
				...capabilityGuardRefs(proposal, policy),
				...(status.sourceRefs ?? []),
			]),
			metadata: {
				...(statusCapabilityKey === undefined ? {} : { capabilityRef: statusCapabilityKey }),
				capabilityAdmissionStatusId: status.statusId,
			},
		}),
	);
}

function capabilityGuardPolicyMessage(
	code:
		| "missing-policy"
		| "unknown-work-item-domain-action-capability-guard-policy"
		| "policy-mismatch",
	proposal: WorkItemDomainActionProposal,
): string {
	if (code === "missing-policy")
		return `WorkItem domain action '${proposal.proposalId}' has no capability guard policy`;
	if (code === "unknown-work-item-domain-action-capability-guard-policy")
		return `WorkItem domain action '${proposal.proposalId}' references a missing capability guard policy`;
	return `WorkItem domain action '${proposal.proposalId}' matches multiple capability guard policies`;
}

function capabilityGuardRefs(
	proposal: WorkItemDomainActionProposal,
	policy: WorkItemDomainActionCapabilityGuardPolicy,
	admissions: readonly (CapabilityAdmission | undefined)[] = [],
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item", proposal.workItemId),
		ref("work-item-domain-action-proposal", proposal.proposalId),
		ref("work-item-domain-action-capability-guard-policy", policy.policyId),
		...admissions
			.filter((admission): admission is CapabilityAdmission => admission !== undefined)
			.flatMap((admission) => [
				ref("capability-admission", admission.admissionId),
				ref("capability-admission-proposal", admission.proposalId),
				ref("boundary-capability", capabilityBoundaryRefId(admission.capability)),
				...(admission.sourceRefs ?? []),
			]),
		...(proposal.sourceRefs ?? []),
	]);
}

function capabilityBoundaryRefId(capability: Pick<BoundaryCapabilityRef, "id" | "kind">): string {
	return canonicalTupleKey([capability.kind, capability.id]);
}

function emitCapabilityGuardStatus(
	ctx: Ctx,
	state: CapabilityGuardState,
	status: Omit<WorkItemDomainActionCapabilityGuardStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact: WorkItemDomainActionCapabilityGuardStatus = {
		kind: "work-item-domain-action-capability-guard-status",
		statusId: compoundTupleKey("work-item-domain-action-capability-guard-status", [
			String(state.statusSeq),
		]),
		...status,
	};
	emitCapabilityGuard(ctx, "status", statusFact);
	state.auditSeq += 1;
	emitCapabilityGuard(ctx, "audit", {
		id: compoundTupleKey("work-item-domain-action-capability-guard-status-audit", [
			String(state.auditSeq),
		]),
		kind: "work-item-domain-action-capability-guard-status",
		subjectId: status.workItemId,
		message: status.message,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: statusFact.statusId,
			state: status.state,
			proposalId: status.proposalId,
			policyId: status.policyId,
			...(status.metadata ?? {}),
		},
	});
}

function emitCapabilityGuardStatusOnce(
	ctx: Ctx,
	state: CapabilityGuardState,
	key: string,
	status: Omit<WorkItemDomainActionCapabilityGuardStatus, "kind" | "statusId">,
): void {
	if (state.emittedStatusKeys.has(key)) return;
	state.emittedStatusKeys.add(key);
	emitCapabilityGuardStatus(ctx, state, status);
}

function emitCapabilityGuardIssue(
	ctx: Ctx,
	state: CapabilityGuardState,
	key: string,
	issue: DataIssue,
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	emitCapabilityGuard(ctx, "issue", issue);
	emitCapabilityGuardStatus(ctx, state, {
		state: "issue",
		workItemId: issue.subjectId,
		issues: [issue],
		message: issue.message,
		metadata: { issueCode: issue.code },
	});
}

function emitCapabilityGuard<K extends CapabilityGuardFact["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<CapabilityGuardFact, { readonly kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as unknown as CapabilityGuardFact]]);
}
