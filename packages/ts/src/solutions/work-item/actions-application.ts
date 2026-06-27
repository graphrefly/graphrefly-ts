import { type Ctx, depBatch } from "../../ctx/types.js";
import type { Graph } from "../../graph/graph.js";
import type { SourceRef } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionProposal,
} from "../../orchestration/work-item-runtime.js";
import {
	auditRecord,
	dataIssue,
	isRecord,
	numberMetadata,
	project,
	ref,
	stringMetadata,
	uniqueSourceRefs,
} from "./actions-shared.js";
import type {
	ApplicationFact,
	ApplicationState,
	WorkItemDomainActionApplication,
	WorkItemDomainActionApplicationBundle,
	WorkItemDomainActionApplicationOptions,
	WorkItemDomainActionApplyPolicy,
	WorkItemDomainActionStatus,
	WorkItemPatchActionPayload,
	WorkItemSpawnActionPayload,
} from "./actions-types.js";
import { patchFieldKeys } from "./actions-types.js";
import {
	type AcceptanceCriterion,
	type VerificationPlan,
	validateAcceptanceCriteria,
	validateVerificationPlan,
	validateWorkItemDraft,
	type WorkItemAuthoringFact,
	type WorkItemCreated,
	type WorkItemPatch,
	type WorkItemProjection,
} from "./scheduling.js";

export function workItemDomainActionApplicationProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkItemDomainActionApplicationOptions<TInput>,
): WorkItemDomainActionApplicationBundle<TInput> {
	const name = opts.name ?? "workItemDomainActionApplication";
	const deps =
		opts.applyPolicies === undefined
			? [opts.proposals, opts.admissions, opts.workItems]
			: [opts.proposals, opts.admissions, opts.workItems, opts.applyPolicies];
	const runtime = graph.node<ApplicationFact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<ApplicationState<TInput>>() ?? {
				proposals: new Map(),
				admissions: new Map(),
				workItems: new Map(),
				policies: new Map(),
				appliedAdmissions: new Set(),
				emittedFactIds: new Set(),
				issueKeys: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as WorkItemDomainActionProposal;
				if (state.proposals.has(proposal.proposalId)) {
					emitApplicationIssue(
						ctx,
						state,
						`duplicate-proposal:${proposal.proposalId}`,
						"duplicate-suppressed",
						`Duplicate WorkItem domain action proposal '${proposal.proposalId}' suppressed`,
						proposal.workItemId,
						proposal.sourceRefs,
					);
					continue;
				}
				state.proposals.set(proposal.proposalId, proposal);
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
			}
			if (opts.applyPolicies !== undefined) {
				for (const raw of depBatch(ctx, 3) ?? []) {
					const policy = raw as WorkItemDomainActionApplyPolicy;
					state.policies.set(policy.policyId, policy);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const admission = raw as WorkItemDomainActionAdmission;
				if (state.admissions.has(admission.admissionId)) {
					emitApplicationIssue(
						ctx,
						state,
						`duplicate-admission:${admission.admissionId}`,
						"duplicate-suppressed",
						`Duplicate WorkItem domain action admission '${admission.admissionId}' suppressed`,
						admission.workItemId,
						admissionRefs(admission),
					);
					continue;
				}
				state.admissions.set(admission.admissionId, admission);
			}
			for (const admission of state.admissions.values()) applyAdmission(ctx, state, admission);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemDomainActionApplicationProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		authoringFacts: project(
			graph,
			runtime,
			`${name}/authoringFacts`,
			"workItemDomainActionAuthoringFacts",
			(fact) => (fact.kind === "authoring-fact" ? fact.value : undefined),
		),
		applications: project(
			graph,
			runtime,
			`${name}/applications`,
			"workItemDomainActionApplications",
			(fact) => (fact.kind === "application" ? fact.value : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "workItemDomainActionStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemDomainActionIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemDomainActionAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

function applyAdmission<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	admission: WorkItemDomainActionAdmission,
): void {
	if (state.appliedAdmissions.has(admission.admissionId)) return;
	const proposal = state.proposals.get(admission.proposalId);
	if (proposal === undefined) {
		emitApplicationIssue(
			ctx,
			state,
			`missing-proposal:${admission.admissionId}:${admission.proposalId}`,
			"dangling-ref",
			`Admission '${admission.admissionId}' cannot apply without proposal '${admission.proposalId}'`,
			admission.workItemId,
			admissionRefs(admission),
		);
		return;
	}
	if (admission.state !== "admitted") {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplication(ctx, state, admission, proposal, admission.state, []);
		return;
	}
	const mismatch = admissionProposalMismatch(admission, proposal);
	if (mismatch !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`admission-proposal-mismatch:${admission.admissionId}:${mismatch.field}`,
			"dangling-ref",
			mismatch.message,
			admission.workItemId,
			admissionRefs(admission, proposal),
			{
				field: mismatch.field,
				admissionValue: mismatch.admissionValue,
				proposalValue: mismatch.proposalValue,
			},
		);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: "dangling-ref",
			message: mismatch.message,
		});
		return;
	}
	const workItem = state.workItems.get(admission.workItemId);
	if (workItem === undefined) {
		emitApplicationIssue(
			ctx,
			state,
			`missing-work-item:${admission.admissionId}:${admission.workItemId}`,
			"dangling-ref",
			`Admission '${admission.admissionId}' references unknown WorkItem '${admission.workItemId}'`,
			admission.workItemId,
			admissionRefs(admission, proposal),
		);
		return;
	}
	const metadataConflict = conflictingApplicationMetadata(proposal, admission);
	if (metadataConflict !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`metadata-conflict:${admission.admissionId}:${metadataConflict.field}`,
			metadataConflict.code,
			metadataConflict.message,
			admission.workItemId,
			admissionRefs(admission, proposal),
			{
				field: metadataConflict.field,
				admissionValue: metadataConflict.admissionValue,
				proposalValue: metadataConflict.proposalValue,
			},
		);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: metadataConflict.code,
			message: metadataConflict.message,
		});
		return;
	}
	const stale = staleRevision(proposal, admission, workItem);
	if (stale !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`stale:${admission.admissionId}:${stale.kind}:${stale.expected}:${stale.current}`,
			stale.kind,
			`Admission '${admission.admissionId}' targets stale WorkItem revision`,
			admission.workItemId,
			admissionRefs(admission, proposal),
			{ expected: stale.expected, current: stale.current },
		);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: stale.kind,
			message: "Stale WorkItem revision",
		});
		return;
	}
	const policyResult = selectApplyPolicy(state, proposal, admission);
	if (typeof policyResult === "string") {
		emitApplicationIssue(
			ctx,
			state,
			`policy:${admission.admissionId}:${policyResult}`,
			policyResult,
			applyPolicyMessage(policyResult, proposal, admission),
			admission.workItemId,
			admissionRefs(admission, proposal),
		);
		return;
	}
	const output = lowerAction(ctx, state, workItem, proposal, admission, policyResult);
	if (output === undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplication(ctx, state, admission, proposal, "rejected", [], {
			code: "invalid-action",
			message: "WorkItem domain action application rejected; see emitted issues",
			policyId: policyResult.policyId,
		});
		return;
	}
	const duplicateFactId = firstDuplicateFactId(state, output.facts);
	if (duplicateFactId !== undefined) {
		state.appliedAdmissions.add(admission.admissionId);
		emitApplicationIssue(
			ctx,
			state,
			`duplicate-authoring-fact:${admission.admissionId}:${duplicateFactId}`,
			"duplicate-suppressed",
			`WorkItem domain action application '${admission.admissionId}' would duplicate authoring fact '${duplicateFactId}'`,
			admission.workItemId,
			admissionRefs(admission, proposal, policyResult),
			{ eventId: duplicateFactId },
		);
		emitApplication(ctx, state, admission, proposal, "duplicate", [], {
			code: "duplicate-suppressed",
			message: "Duplicate WorkItem authoring fact suppressed atomically",
			policyId: policyResult.policyId,
		});
		return;
	}
	state.appliedAdmissions.add(admission.admissionId);
	for (const fact of output.facts) claimFactId(state, fact.eventId);
	for (const fact of output.facts) emitApplicationFact(ctx, "authoring-fact", fact);
	emitApplication(ctx, state, admission, proposal, output.state, output.facts, {
		code: output.code,
		message: output.message,
		policyId: policyResult.policyId,
	});
}

function lowerAction<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	workItem: WorkItemProjection<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	policy: WorkItemDomainActionApplyPolicy,
):
	| {
			readonly state: WorkItemDomainActionApplication["state"];
			readonly facts: readonly WorkItemAuthoringFact<T>[];
			readonly code?: string;
			readonly message?: string;
	  }
	| undefined {
	if (!policyAllowsAction(policy, proposal.actionKind)) {
		emitApplicationIssue(
			ctx,
			state,
			`policy-action:${admission.admissionId}:${policy.policyId}:${proposal.actionKind}`,
			"policy-mismatch",
			`Apply policy '${policy.policyId}' does not allow actionKind '${proposal.actionKind}'`,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return { state: "policy-rejected", facts: [], code: "policy-mismatch" };
	}
	if (proposal.actionKind === "patch") {
		const lowered = lowerPatchAction(ctx, state, workItem, proposal, admission, policy);
		if (lowered === undefined) return undefined;
		return { state: "applied", facts: lowered };
	}
	if (proposal.actionKind === "mark-verified" || proposal.actionKind === "require-review") {
		return {
			state: "proposal-only",
			facts: [],
			code: "domain-fact-unimplemented",
			message: `Action '${proposal.actionKind}' recorded as visible application status only; no WorkItem domain mutation fact was emitted`,
		};
	}
	if (proposal.actionKind === "spawn-proposed" || proposal.actionKind === "spawn-child") {
		return lowerSpawnAction(ctx, state, proposal, admission, policy);
	}
	emitApplicationIssue(
		ctx,
		state,
		`unsupported-action:${admission.admissionId}:${proposal.actionKind}`,
		"unsupported-effect-kind",
		`Unsupported WorkItem domain actionKind '${proposal.actionKind}'`,
		proposal.workItemId,
		admissionRefs(admission, proposal, policy),
	);
	return { state: "rejected", facts: [], code: "unsupported-effect-kind" };
}

function lowerPatchAction<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	workItem: WorkItemProjection<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	policy: WorkItemDomainActionApplyPolicy,
): readonly WorkItemAuthoringFact<T>[] | undefined {
	const payload = normalizePatchPayload<T>(proposal.payload);
	if (typeof payload === "string") {
		emitApplicationIssue(
			ctx,
			state,
			`invalid-patch:${admission.admissionId}`,
			"invalid-patch",
			payload,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return undefined;
	}
	const splitPayload = splitDedicatedPatchFields(payload, workItem);
	const facts: WorkItemAuthoringFact<T>[] = [];
	if (splitPayload.patch !== undefined) {
		const invalid = invalidPatchKeys(splitPayload.patch, policy);
		if (invalid.length > 0) {
			emitApplicationIssue(
				ctx,
				state,
				`invalid-patch-fields:${admission.admissionId}:${invalid.join(",")}`,
				"invalid-patch",
				`Patch action uses unsupported fields: ${invalid.join(", ")}`,
				proposal.workItemId,
				admissionRefs(admission, proposal, policy),
				{ invalidFields: invalid },
			);
			return undefined;
		}
		facts.push({
			kind: "work-item-patched",
			eventId: splitPayload.eventId ?? `${admission.admissionId}:work-item-patched`,
			workItemId: workItem.workItemId,
			patch: splitPayload.patch,
			executionRelevantFields:
				splitPayload.executionRelevantFields ?? policy.patch?.executionRelevantFields,
			authorId: splitPayload.authorId,
			sourceRefs: actionSourceRefs(admission, proposal, policy),
			metadata: { ...(splitPayload.metadata ?? {}), actionKind: proposal.actionKind },
		});
	}
	if (splitPayload.acceptanceCriteria !== undefined) {
		if (!allowsAcceptanceCriteria(policy)) {
			emitApplicationIssue(
				ctx,
				state,
				`ac-policy:${admission.admissionId}`,
				"policy-mismatch",
				`Apply policy '${policy.policyId}' does not allow acceptance criteria changes`,
				proposal.workItemId,
				admissionRefs(admission, proposal, policy),
			);
			return undefined;
		}
		const issues = validateAcceptanceCriteria(splitPayload.acceptanceCriteria, {
			workItemId: workItem.workItemId,
		});
		if (issues.length > 0) {
			for (const item of issues) emitApplicationFact(ctx, "issue", item);
			emitApplicationStatus(ctx, state, {
				state: "rejected",
				code: issues[0]?.code,
				message: issues[0]?.message,
				workItemId: workItem.workItemId,
				proposalId: proposal.proposalId,
				admissionId: admission.admissionId,
				actionKind: proposal.actionKind,
				sourceRefs: admissionRefs(admission, proposal, policy),
			});
			return undefined;
		}
		facts.push({
			kind: "acceptance-criteria-changed",
			eventId: `${admission.admissionId}:acceptance-criteria-changed`,
			workItemId: workItem.workItemId,
			acceptanceCriteria: splitPayload.acceptanceCriteria,
			authorId: splitPayload.authorId,
			sourceRefs: actionSourceRefs(admission, proposal, policy),
			metadata: { ...(splitPayload.metadata ?? {}), actionKind: proposal.actionKind },
		});
	}
	if (splitPayload.verificationPlan !== undefined) {
		if (!allowsVerificationPlan(policy)) {
			emitApplicationIssue(
				ctx,
				state,
				`plan-policy:${admission.admissionId}`,
				"policy-mismatch",
				`Apply policy '${policy.policyId}' does not allow verification plan changes`,
				proposal.workItemId,
				admissionRefs(admission, proposal, policy),
			);
			return undefined;
		}
		const issues = validateVerificationPlan(
			splitPayload.verificationPlan,
			splitPayload.acceptanceCriteria ?? workItem.acceptanceCriteria ?? [],
			{ workItemId: workItem.workItemId },
		);
		if (issues.length > 0) {
			for (const item of issues) emitApplicationFact(ctx, "issue", item);
			emitApplicationStatus(ctx, state, {
				state: "rejected",
				code: issues[0]?.code,
				message: issues[0]?.message,
				workItemId: workItem.workItemId,
				proposalId: proposal.proposalId,
				admissionId: admission.admissionId,
				actionKind: proposal.actionKind,
				sourceRefs: admissionRefs(admission, proposal, policy),
			});
			return undefined;
		}
		facts.push({
			kind: "verification-plan-changed",
			eventId: `${admission.admissionId}:verification-plan-changed`,
			workItemId: workItem.workItemId,
			verificationPlan: splitPayload.verificationPlan,
			authorId: splitPayload.authorId,
			sourceRefs: actionSourceRefs(admission, proposal, policy),
			metadata: { ...(splitPayload.metadata ?? {}), actionKind: proposal.actionKind },
		});
	}
	if (facts.length === 0) {
		emitApplicationIssue(
			ctx,
			state,
			`empty-patch:${admission.admissionId}`,
			"invalid-patch",
			"Patch action payload did not contain patch, acceptanceCriteria, or verificationPlan",
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return undefined;
	}
	return facts;
}

function lowerSpawnAction<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	policy: WorkItemDomainActionApplyPolicy,
): {
	readonly state: WorkItemDomainActionApplication["state"];
	readonly facts: readonly WorkItemAuthoringFact<T>[];
	readonly code?: string;
	readonly message?: string;
} {
	if (policy.spawn?.create !== true) {
		return {
			state: "proposal-only",
			facts: [],
			message: "Spawn action remains proposal/admission only without explicit create policy",
		};
	}
	const policyIssue = validateSpawnCreatePolicy(policy, proposal);
	if (policyIssue !== undefined) {
		emitApplicationIssue(
			ctx,
			state,
			`spawn-create-policy:${admission.admissionId}:${policy.policyId}:${policyIssue.field}`,
			"policy-mismatch",
			policyIssue.message,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
			{ field: policyIssue.field },
		);
		return {
			state: "policy-rejected",
			facts: [],
			code: "policy-mismatch",
			message: policyIssue.message,
		};
	}
	const payload = normalizeSpawnPayload<T>(proposal.payload);
	if (typeof payload === "string") {
		emitApplicationIssue(
			ctx,
			state,
			`invalid-spawn-payload:${admission.admissionId}`,
			"invalid-patch",
			payload,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return { state: "rejected", facts: [], code: "invalid-patch", message: payload };
	}
	const childWorkItemId =
		payload.childWorkItemId ??
		payload.workItemId ??
		policy.spawn.childWorkItemId ??
		(policy.spawn.childIdPrefix === undefined
			? undefined
			: `${policy.spawn.childIdPrefix}${admission.admissionId}`);
	if (childWorkItemId === undefined || childWorkItemId.trim() === "") {
		const message = "Spawn create action requires a childWorkItemId or create policy child id";
		emitApplicationIssue(
			ctx,
			state,
			`missing-spawn-child-id:${admission.admissionId}`,
			"missing-required-field",
			message,
			proposal.workItemId,
			admissionRefs(admission, proposal, policy),
		);
		return { state: "rejected", facts: [], code: "missing-required-field", message };
	}
	if (state.workItems.has(childWorkItemId)) {
		const message = `Spawn create action would duplicate WorkItem '${childWorkItemId}'`;
		emitApplicationIssue(
			ctx,
			state,
			`duplicate-spawn-child:${admission.admissionId}:${childWorkItemId}`,
			"duplicate-id",
			message,
			childWorkItemId,
			admissionRefs(admission, proposal, policy),
		);
		return { state: "duplicate", facts: [], code: "duplicate-id", message };
	}
	if (payload.draft === undefined) {
		const message = "Spawn create action requires a draft payload";
		emitApplicationIssue(
			ctx,
			state,
			`missing-spawn-draft:${admission.admissionId}`,
			"missing-required-field",
			message,
			childWorkItemId,
			admissionRefs(admission, proposal, policy),
		);
		return { state: "rejected", facts: [], code: "missing-required-field", message };
	}
	const issues = validateWorkItemDraft(payload.draft, { workItemId: childWorkItemId });
	if (issues.length > 0) {
		for (const item of issues) emitApplicationFact(ctx, "issue", item);
		return {
			state: "rejected",
			facts: [],
			code: issues[0]?.code,
			message: issues[0]?.message,
		};
	}
	const metadata = {
		...(payload.metadata ?? {}),
		actionKind: proposal.actionKind,
		parentWorkItemId: policy.spawn.linkParent === true ? proposal.workItemId : undefined,
		sourceProposalId: proposal.proposalId,
		idempotencyKey: payload.idempotencyKey ?? policy.spawn.idempotencyKey,
	};
	const created: WorkItemCreated<T> = {
		kind: "work-item-created",
		eventId: payload.eventId ?? `${admission.admissionId}:work-item-created:${childWorkItemId}`,
		workItemId: childWorkItemId,
		draft: payload.draft,
		authorId: payload.authorId,
		sourceRefs: actionSourceRefs(admission, proposal, policy),
		metadata,
	};
	return { state: "applied", facts: [created] };
}

function validateSpawnCreatePolicy(
	policy: WorkItemDomainActionApplyPolicy,
	proposal: WorkItemDomainActionProposal,
): { readonly field: string; readonly message: string } | undefined {
	if (policy.spawn?.idempotencyKey === undefined || policy.spawn.idempotencyKey.trim() === "") {
		return {
			field: "idempotencyKey",
			message: `Spawn create policy '${policy.policyId}' requires an idempotencyKey`,
		};
	}
	if (
		policy.spawn.maxChildrenPerAdmission === undefined ||
		policy.spawn.maxChildrenPerAdmission < 1
	) {
		return {
			field: "maxChildrenPerAdmission",
			message: `Spawn create policy '${policy.policyId}' requires maxChildrenPerAdmission >= 1`,
		};
	}
	if (proposal.actionKind === "spawn-child" && policy.spawn.linkParent !== true) {
		return {
			field: "linkParent",
			message: `Spawn child create policy '${policy.policyId}' requires linkParent: true`,
		};
	}
	return undefined;
}

function normalizeSpawnPayload<T>(payload: unknown): WorkItemSpawnActionPayload<T> | string {
	if (!isRecord(payload)) return "Spawn action payload must be an object";
	if ("draft" in payload && payload.draft !== undefined && !isRecord(payload.draft)) {
		return "Spawn action payload.draft must be an object";
	}
	if ("metadata" in payload && payload.metadata !== undefined && !isRecord(payload.metadata)) {
		return "Spawn action payload.metadata must be an object";
	}
	return payload as WorkItemSpawnActionPayload<T>;
}

function normalizePatchPayload<T>(payload: unknown): WorkItemPatchActionPayload<T> | string {
	if (!isRecord(payload)) return "Patch action payload must be an object";
	if (
		"patch" in payload ||
		"acceptanceCriteria" in payload ||
		"verificationPlan" in payload ||
		"executionRelevantFields" in payload
	) {
		if ("patch" in payload && payload.patch !== undefined && !isRecord(payload.patch))
			return "Patch action payload.patch must be an object";
		if (
			"acceptanceCriteria" in payload &&
			payload.acceptanceCriteria !== undefined &&
			!Array.isArray(payload.acceptanceCriteria)
		)
			return "Patch action payload.acceptanceCriteria must be an array";
		if (
			"verificationPlan" in payload &&
			payload.verificationPlan !== undefined &&
			!isRecord(payload.verificationPlan)
		)
			return "Patch action payload.verificationPlan must be an object";
		const inlinePatch = inlinePatchFields<T>(payload);
		const explicitPatch = isRecord(payload.patch) ? (payload.patch as WorkItemPatch<T>) : undefined;
		const patch =
			explicitPatch === undefined
				? inlinePatch
				: ({ ...inlinePatch, ...explicitPatch } as WorkItemPatch<T>);
		return {
			...(payload as unknown as WorkItemPatchActionPayload<T>),
			patch: Object.keys(patch).length === 0 ? undefined : patch,
		};
	}
	return { patch: payload as WorkItemPatch<T> };
}

function inlinePatchFields<T>(payload: Record<string, unknown>): WorkItemPatch<T> {
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (key === "metadata") continue;
		if (patchFieldKeys.has(key)) patch[key] = value;
	}
	return patch as WorkItemPatch<T>;
}

function splitDedicatedPatchFields<T>(
	payload: WorkItemPatchActionPayload<T>,
	workItem: WorkItemProjection<T>,
): WorkItemPatchActionPayload<T> {
	if (!isRecord(payload.patch)) return payload;
	const patchRecord = payload.patch as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patchRecord)) {
		if (key === "acceptanceCriteria" || key === "verificationPlan" || key === "verificationSteps")
			continue;
		patch[key] = value;
	}
	const acceptanceCriteria =
		payload.acceptanceCriteria ??
		(Array.isArray(patchRecord.acceptanceCriteria)
			? (patchRecord.acceptanceCriteria as readonly AcceptanceCriterion[])
			: undefined);
	const verificationPlan =
		payload.verificationPlan ??
		(isRecord(patchRecord.verificationPlan)
			? (patchRecord.verificationPlan as unknown as VerificationPlan<T>)
			: Array.isArray(patchRecord.verificationSteps)
				? ({
						...(workItem.verificationPlan ?? { planId: "default" }),
						steps: patchRecord.verificationSteps,
					} as VerificationPlan<T>)
				: undefined);
	return {
		...payload,
		patch: Object.keys(patch).length === 0 ? undefined : (patch as WorkItemPatch<T>),
		acceptanceCriteria,
		verificationPlan,
	};
}

function invalidPatchKeys<T>(
	patch: WorkItemPatch<T>,
	policy: WorkItemDomainActionApplyPolicy,
): readonly string[] {
	const allowed = new Set(policy.patch?.allowedFields ?? Array.from(patchFieldKeys));
	return Object.keys(patch).filter((key) => !patchFieldKeys.has(key) || !allowed.has(key));
}

function allowsAcceptanceCriteria(policy: WorkItemDomainActionApplyPolicy): boolean {
	if (policy.patch?.allowAcceptanceCriteria === false) return false;
	const allowed = policy.patch?.allowedFields;
	return (
		allowed === undefined ||
		allowed.includes("acceptanceCriteria") ||
		policy.patch?.allowAcceptanceCriteria === true
	);
}

function allowsVerificationPlan(policy: WorkItemDomainActionApplyPolicy): boolean {
	if (policy.patch?.allowVerificationPlan === false) return false;
	const allowed = policy.patch?.allowedFields;
	return (
		allowed === undefined ||
		allowed.includes("verificationPlan") ||
		allowed.includes("verificationSteps") ||
		policy.patch?.allowVerificationPlan === true
	);
}

function selectApplyPolicy<T>(
	state: ApplicationState<T>,
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
):
	| WorkItemDomainActionApplyPolicy
	| "missing-policy"
	| "unknown-work-item-domain-action-apply-policy"
	| "policy-mismatch" {
	const explicitId = explicitApplyPolicyId(proposal, admission);
	if (explicitId !== undefined)
		return state.policies.get(explicitId) ?? "unknown-work-item-domain-action-apply-policy";
	const matching = Array.from(state.policies.values()).filter((policy) =>
		policyAllowsAction(policy, proposal.actionKind),
	);
	if (matching.length === 0) return "missing-policy";
	if (matching.length > 1) return "policy-mismatch";
	return matching[0];
}

function explicitApplyPolicyId(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
): string | undefined {
	const metadataPolicy =
		stringMetadata(admission.metadata, "applyPolicyId") ??
		stringMetadata(proposal.metadata, "applyPolicyId");
	if (metadataPolicy !== undefined) return metadataPolicy;
	return [...(admission.sourceRefs ?? []), ...(proposal.sourceRefs ?? [])].find(
		(sourceRef) => sourceRef.kind === "work-item-domain-action-apply-policy",
	)?.id;
}

function policyAllowsAction(policy: WorkItemDomainActionApplyPolicy, actionKind: string): boolean {
	return policy.actionKinds === undefined || policy.actionKinds.includes(actionKind);
}

function admissionProposalMismatch(
	admission: WorkItemDomainActionAdmission,
	proposal: WorkItemDomainActionProposal,
):
	| {
			readonly field: "workItemId" | "actionKind";
			readonly admissionValue: string;
			readonly proposalValue: string;
			readonly message: string;
	  }
	| undefined {
	if (admission.workItemId !== proposal.workItemId)
		return {
			field: "workItemId",
			admissionValue: admission.workItemId,
			proposalValue: proposal.workItemId,
			message: `Admission '${admission.admissionId}' workItemId does not match proposal '${proposal.proposalId}'`,
		};
	if (admission.actionKind !== proposal.actionKind)
		return {
			field: "actionKind",
			admissionValue: admission.actionKind,
			proposalValue: proposal.actionKind,
			message: `Admission '${admission.admissionId}' actionKind does not match proposal '${proposal.proposalId}'`,
		};
	return undefined;
}

function conflictingApplicationMetadata(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
):
	| {
			readonly field: "authoringRevision" | "executionInputRevision" | "applyPolicyId";
			readonly code: "stale-revision" | "stale-execution-input" | "policy-mismatch";
			readonly proposalValue: number | string;
			readonly admissionValue: number | string;
			readonly message: string;
	  }
	| undefined {
	const authoringRevision = conflictingMetadataNumber(proposal, admission, "authoringRevision");
	if (authoringRevision !== undefined)
		return {
			field: "authoringRevision",
			code: "stale-revision",
			...authoringRevision,
			message: `Admission '${admission.admissionId}' carries conflicting authoringRevision metadata`,
		};
	const executionInputRevision = conflictingMetadataNumber(
		proposal,
		admission,
		"executionInputRevision",
	);
	if (executionInputRevision !== undefined)
		return {
			field: "executionInputRevision",
			code: "stale-execution-input",
			...executionInputRevision,
			message: `Admission '${admission.admissionId}' carries conflicting executionInputRevision metadata`,
		};
	const applyPolicyId = conflictingMetadataString(proposal, admission, "applyPolicyId");
	if (applyPolicyId !== undefined)
		return {
			field: "applyPolicyId",
			code: "policy-mismatch",
			...applyPolicyId,
			message: `Admission '${admission.admissionId}' carries conflicting applyPolicyId metadata`,
		};
	return undefined;
}

function conflictingMetadataNumber(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	key: string,
): { readonly proposalValue: number; readonly admissionValue: number } | undefined {
	const proposalValue = numberMetadata(proposal.metadata, key);
	const admissionValue = numberMetadata(admission.metadata, key);
	if (
		proposalValue === undefined ||
		admissionValue === undefined ||
		proposalValue === admissionValue
	)
		return undefined;
	return { proposalValue, admissionValue };
}

function conflictingMetadataString(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	key: string,
): { readonly proposalValue: string; readonly admissionValue: string } | undefined {
	const proposalValue = stringMetadata(proposal.metadata, key);
	const admissionValue = stringMetadata(admission.metadata, key);
	if (
		proposalValue === undefined ||
		admissionValue === undefined ||
		proposalValue === admissionValue
	)
		return undefined;
	return { proposalValue, admissionValue };
}

function staleRevision<T>(
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
	workItem: WorkItemProjection<T>,
):
	| { readonly kind: "stale-revision"; readonly expected: number; readonly current: number }
	| { readonly kind: "stale-execution-input"; readonly expected: number; readonly current: number }
	| undefined {
	const authoringRevision =
		numberMetadata(admission.metadata, "authoringRevision") ??
		numberMetadata(proposal.metadata, "authoringRevision");
	if (authoringRevision !== undefined && authoringRevision !== workItem.authoringRevision)
		return {
			kind: "stale-revision",
			expected: authoringRevision,
			current: workItem.authoringRevision,
		};
	const executionInputRevision =
		numberMetadata(admission.metadata, "executionInputRevision") ??
		numberMetadata(proposal.metadata, "executionInputRevision");
	if (
		executionInputRevision !== undefined &&
		executionInputRevision !== workItem.executionInputRevision
	)
		return {
			kind: "stale-execution-input",
			expected: executionInputRevision,
			current: workItem.executionInputRevision,
		};
	return undefined;
}

function applyPolicyMessage(
	code: "missing-policy" | "unknown-work-item-domain-action-apply-policy" | "policy-mismatch",
	proposal: WorkItemDomainActionProposal,
	admission: WorkItemDomainActionAdmission,
): string {
	if (code === "missing-policy")
		return `Admitted action '${admission.admissionId}' requires an explicit apply policy`;
	if (code === "unknown-work-item-domain-action-apply-policy")
		return `Admitted action '${admission.admissionId}' references a missing apply policy`;
	return `Admitted action '${proposal.proposalId}' matches multiple apply policies`;
}

function emitApplication<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	admission: WorkItemDomainActionAdmission,
	proposal: WorkItemDomainActionProposal,
	applicationState: WorkItemDomainActionApplication["state"],
	facts: readonly WorkItemAuthoringFact<T>[],
	opts: { readonly code?: string; readonly message?: string; readonly policyId?: string } = {},
): void {
	const producedFactIds = facts.map((fact) => fact.eventId);
	const application: WorkItemDomainActionApplication = {
		kind: "work-item-domain-action-application",
		applicationId: `${admission.admissionId}:application`,
		admissionId: admission.admissionId,
		proposalId: proposal.proposalId,
		workItemId: proposal.workItemId,
		actionKind: proposal.actionKind,
		state: applicationState,
		producedFactIds,
		reason: admission.reason ?? proposal.reason,
		sourceRefs: admissionRefs(admission, proposal),
		metadata: { policyId: opts.policyId, code: opts.code },
	};
	emitApplicationFact(ctx, "application", application);
	emitApplicationStatus(ctx, state, {
		state: applicationState,
		code: opts.code,
		message: opts.message,
		workItemId: proposal.workItemId,
		proposalId: proposal.proposalId,
		admissionId: admission.admissionId,
		actionKind: proposal.actionKind,
		sourceRefs: application.sourceRefs,
		metadata: { producedFactIds, policyId: opts.policyId },
	});
}

function emitApplicationIssue<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	key: string,
	code: string,
	message: string,
	workItemId?: string,
	sourceRefs?: readonly SourceRef[],
	metadata?: Record<string, unknown>,
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	const item = dataIssue(code, message, { subjectId: workItemId, refs: sourceRefs, metadata });
	emitApplicationFact(ctx, "issue", item);
	emitApplicationStatus(ctx, state, {
		state: code === "missing-policy" ? "missing-policy" : "rejected",
		code,
		message,
		workItemId,
		sourceRefs,
		metadata,
	});
}

function emitApplicationStatus<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	status: Omit<WorkItemDomainActionStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-domain-action-status",
		statusId: `work-item-domain-action-application-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemDomainActionStatus;
	emitApplicationFact(ctx, "status", statusFact);
	emitApplicationAudit(ctx, state, "work-item-domain-action-application-status", statusFact);
}

function emitApplicationAudit<T>(
	ctx: Ctx,
	state: ApplicationState<T>,
	kind: string,
	status: WorkItemDomainActionStatus,
): void {
	state.auditSeq += 1;
	emitApplicationFact(ctx, "audit", auditRecord(kind, state.auditSeq, status));
}

function emitApplicationFact<T, K extends ApplicationFact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<ApplicationFact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as ApplicationFact<T>]]);
}

function firstDuplicateFactId<T>(
	state: ApplicationState<T>,
	facts: readonly WorkItemAuthoringFact<T>[],
): string | undefined {
	const pending = new Set<string>();
	for (const fact of facts) {
		if (state.emittedFactIds.has(fact.eventId) || pending.has(fact.eventId)) return fact.eventId;
		pending.add(fact.eventId);
	}
	return undefined;
}

function claimFactId<T>(state: ApplicationState<T>, factId: string): boolean {
	if (state.emittedFactIds.has(factId)) return false;
	state.emittedFactIds.add(factId);
	return true;
}

function admissionRefs(
	admission: WorkItemDomainActionAdmission,
	proposal?: WorkItemDomainActionProposal,
	policy?: WorkItemDomainActionApplyPolicy,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item-domain-action-admission", admission.admissionId),
		ref("work-item-domain-action-proposal", admission.proposalId),
		...(proposal === undefined
			? []
			: [
					ref("work-item", proposal.workItemId),
					ref("work-item-evidence", proposal.evidenceId),
					...(proposal.sourceRefs ?? []),
				]),
		...(policy === undefined ? [] : [ref("work-item-domain-action-apply-policy", policy.policyId)]),
		...(admission.sourceRefs ?? []),
	]);
}

function actionSourceRefs(
	admission: WorkItemDomainActionAdmission,
	proposal: WorkItemDomainActionProposal,
	policy: WorkItemDomainActionApplyPolicy,
): readonly SourceRef[] {
	return admissionRefs(admission, proposal, policy);
}
