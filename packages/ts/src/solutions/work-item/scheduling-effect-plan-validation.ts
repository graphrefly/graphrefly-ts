import type { DataIssue } from "../../data/index.js";
import { isRecord, issue } from "./scheduling-shared.js";
import type {
	WorkItemEffectPlanJoinPolicy,
	WorkItemEffectPlanMember,
	WorkItemEffectPlanPolicy,
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "./scheduling-types.js";

/**
 * Validates work item effect plan input.
 *
 * @param proposal - Proposal to admit, issue, or project.
 * @param workItem - work item value used by the helper.
 * @param policy - Policy object used to admit, retry, or route work.
 * @returns Validation diagnostics or the validated projection.
 * @category solutions
 * @example
 * ```ts
 * import { validateWorkItemEffectPlan } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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
