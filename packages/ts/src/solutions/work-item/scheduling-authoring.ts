import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import {
	emit,
	emitAudit,
	isRecord,
	issue,
	normalizePlan,
	project,
	refs,
} from "./scheduling-shared.js";
import type {
	AuthoringState,
	Fact,
	WorkItemAuthoringInput,
	WorkItemAuthoringPolicy,
	WorkItemAuthoringProjectorBundle,
	WorkItemAuthoringProjectorOptions,
	WorkItemDraft,
	WorkItemPatch,
	WorkItemProjection,
	WorkItemValidationIssueCode,
	WorkItemValidationStatus,
} from "./scheduling-types.js";
import { draftPatchKeys, executionRelevantDefaults } from "./scheduling-types.js";
import {
	validateAcceptanceCriteria,
	validateVerificationPlan,
	validateWorkItemDraft,
} from "./scheduling-validation.js";

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

function reduceAuthoring<T>(
	ctx: Ctx,
	state: AuthoringState<T>,
	input: WorkItemAuthoringInput<T>,
	policy?: WorkItemAuthoringPolicy,
): void {
	if (input.kind === "work-item-spawn-proposed") {
		const statusWorkItemId = input.proposedWorkItemId ?? input.parentWorkItemId;
		const issues = validateWorkItemDraft(input.draft, { workItemId: statusWorkItemId });
		if (issues.length > 0) {
			for (const item of issues) emit(ctx, "issue", item);
			emitStatus(ctx, state, {
				state: "rejected",
				code: issues[0]?.code as WorkItemValidationIssueCode | undefined,
				workItemId: statusWorkItemId,
				message: issues[0]?.message,
				metadata: {
					proposalId: input.proposalId,
					parentWorkItemId: input.parentWorkItemId,
					idempotencyKey: input.idempotencyKey,
				},
			});
			return;
		}
		emitStatus(ctx, state, {
			state: "deferred",
			workItemId: statusWorkItemId,
			message: `WorkItem spawn proposal '${input.proposalId}' carries draft data but is not applied`,
			metadata: {
				proposalId: input.proposalId,
				parentWorkItemId: input.parentWorkItemId,
				idempotencyKey: input.idempotencyKey,
			},
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
