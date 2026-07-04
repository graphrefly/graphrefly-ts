import type { DataIssue } from "../../data/index.js";
import {
	isRecord,
	issue,
	isVerificationPlanShape,
	normalizePlanFromUnknown,
} from "./scheduling-shared.js";
import type {
	AcceptanceCriterion,
	VerificationPlan,
	VerificationStep,
	VerificationStepMode,
	WorkItemDraft,
} from "./scheduling-types.js";

/**
 * Validates work item draft input.
 *
 * @param draft - draft value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns Validation diagnostics or the validated projection.
 * @category solutions
 * @example
 * ```ts
 * import { validateWorkItemDraft } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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

/**
 * Validates acceptance criteria input.
 *
 * @param criteria - criteria value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns Validation diagnostics or the validated projection.
 * @category solutions
 * @example
 * ```ts
 * import { validateAcceptanceCriteria } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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

/**
 * Validates verification plan input.
 *
 * @param plan - plan value used by the helper.
 * @param criteria - criteria value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns Validation diagnostics or the validated projection.
 * @category solutions
 * @example
 * ```ts
 * import { validateVerificationPlan } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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
