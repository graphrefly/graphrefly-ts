import type {
	AcceptanceCriteriaChanged,
	AcceptanceCriterion,
	VerificationPlan,
	VerificationPlanChanged,
	WorkItemCreated,
	WorkItemDraft,
	WorkItemSpawnProposed,
} from "./scheduling-types.js";

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
		proposedWorkItemId: opts.proposedWorkItemId,
		parentWorkItemId: opts.parentWorkItemId,
		proposedBy: opts.proposedBy,
		idempotencyKey: opts.idempotencyKey,
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
