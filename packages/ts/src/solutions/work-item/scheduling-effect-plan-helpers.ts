import type { WorkItemEffectRequested } from "../../orchestration/work-item-runtime.js";
import { immutableClone, ref } from "./scheduling-shared.js";
import type {
	PlanState,
	WorkItemEffectPlanAdmitted,
	WorkItemEffectPlanMember,
	WorkItemEffectPlanPolicy,
	WorkItemEffectPlanProposed,
	WorkItemEffectPlanSnapshot,
} from "./scheduling-types.js";

export function normalizeEffectPlanSnapshot<T>(
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

export function requestFromPlanMember<T>(
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

export function memberSucceeded<T>(
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	memberId: string,
): boolean {
	return state.memberEvidence.get(memberCoord(admitted, memberId))?.status === "completed";
}

export function memberBlockedByFailure<T>(
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

export function memberCoord<T>(admitted: WorkItemEffectPlanAdmitted<T>, memberId: string): string {
	return `${admitted.workItemId}:${admitted.executionInputRevision}:${admitted.planId}:${memberId}`;
}

export function planKey(
	workItemId: string | undefined,
	planId: string | undefined,
	executionInputRevision: number | undefined,
): string | undefined {
	if (workItemId === undefined || planId === undefined || executionInputRevision === undefined)
		return undefined;
	return `${workItemId}:${executionInputRevision}:${planId}`;
}

export function requiredPlanKey(
	workItemId: string,
	planId: string,
	executionInputRevision: number,
): string {
	return `${workItemId}:${executionInputRevision}:${planId}`;
}
