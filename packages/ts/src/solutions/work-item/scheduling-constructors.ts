import type {
	AcceptanceCriteriaChanged,
	AcceptanceCriterion,
	VerificationPlan,
	VerificationPlanChanged,
	WorkItemCreated,
	WorkItemDraft,
	WorkItemSpawnProposed,
} from "./scheduling-types.js";

/**
 * Creates a work item created from draft.
 *
 * @param workItemId - Stable identifier used by the emitted record.
 * @param draft - draft value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The work item created from draft result.
 * @category solutions
 * @example
 * ```ts
 * import { workItemCreatedFromDraft } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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

/**
 * Creates a work item spawn proposed.
 *
 * @param proposalId - Stable identifier used by the emitted record.
 * @param draft - draft value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The work item spawn proposed result.
 * @category solutions
 * @example
 * ```ts
 * import { workItemSpawnProposed } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
export function workItemSpawnProposed<TInput = unknown>(
	proposalId: string,
	draft: WorkItemDraft<TInput>,
	opts: Partial<Omit<WorkItemSpawnProposed<TInput>, "kind" | "proposalId" | "draft">> = {},
): WorkItemSpawnProposed<TInput> {
	return {
		kind: "work-item-spawn-proposed",
		proposalId,
		draft,
		proposedWorkItemId: opts.proposedWorkItemId,
		parentWorkItemId: opts.parentWorkItemId,
		proposedBy: opts.proposedBy,
		idempotencyKey: opts.idempotencyKey,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

/**
 * Creates an acceptance criteria changed.
 *
 * @param workItemId - Stable identifier used by the emitted record.
 * @param acceptanceCriteria - acceptance criteria value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The acceptance criteria changed result.
 * @category solutions
 * @example
 * ```ts
 * import { acceptanceCriteriaChanged } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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

/**
 * Creates a verification plan changed.
 *
 * @param workItemId - Stable identifier used by the emitted record.
 * @param verificationPlan - verification plan value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The verification plan changed result.
 * @category solutions
 * @example
 * ```ts
 * import { verificationPlanChanged } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
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
