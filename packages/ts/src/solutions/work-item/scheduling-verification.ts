import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type { EffectRunResultStatus } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionProposalSpec,
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../../orchestration/work-item-runtime.js";
import {
	emit,
	emitAudit,
	goalWithInlineInput,
	isRecord,
	issue,
	normalizePlan,
	project,
	ref,
	stringArray,
} from "./scheduling-shared.js";
import type {
	Fact,
	RequestState,
	ResultState,
	VerificationPlan,
	VerificationResultRecorded,
	VerificationResultStatus,
	VerificationStep,
	WorkItemDispatchIntent,
	WorkItemProjection,
	WorkItemValidationIssueCode,
	WorkItemValidationStatus,
	WorkItemVerificationLowererPolicy,
	WorkItemVerificationMappingPolicy,
	WorkItemVerificationRequestLowererBundle,
	WorkItemVerificationRequestLowererOptions,
	WorkItemVerificationResultMapperBundle,
	WorkItemVerificationResultMapperOptions,
} from "./scheduling-types.js";
import { validateVerificationPlan } from "./scheduling-validation.js";

export function workItemVerificationRequestLowerer<TInput = unknown>(
	graph: Graph,
	opts: WorkItemVerificationRequestLowererOptions<TInput>,
): WorkItemVerificationRequestLowererBundle<TInput> {
	const name = opts.name ?? "workItemVerificationRequests";
	const deps: Node<unknown>[] = [opts.workItems];
	const dispatchIntentIndex =
		opts.dispatchIntents === undefined ? -1 : deps.push(opts.dispatchIntents) - 1;
	const verificationResultIndex =
		opts.verificationResults === undefined ? -1 : deps.push(opts.verificationResults) - 1;
	const runtime = graph.node<Fact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<RequestState<TInput>>() ?? {
				workItems: new Map(),
				emittedKeys: new Set(),
				passedSteps: new Map(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
				lowerPlan(ctx, state, workItem, opts.policy);
			}
			if (dispatchIntentIndex >= 0) {
				for (const raw of depBatch(ctx, dispatchIntentIndex) ?? [])
					lowerIntent(ctx, state, raw as WorkItemDispatchIntent<TInput>, opts.policy);
			}
			if (verificationResultIndex >= 0) {
				for (const raw of depBatch(ctx, verificationResultIndex) ?? [])
					recordVerificationResult(ctx, state, raw as VerificationResultRecorded, opts.policy);
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemVerificationRequestLowerer",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		effectRequests: project(
			graph,
			runtime,
			`${name}/effectRequests`,
			"workItemVerificationEffectRequests",
			(fact) => (fact.kind === "request" ? fact.value : undefined),
		),
		status: project(
			graph,
			runtime,
			`${name}/status`,
			"workItemVerificationRequestStatus",
			(fact) => (fact.kind === "status" ? fact.value : undefined),
		),
		issues: project(
			graph,
			runtime,
			`${name}/issues`,
			"workItemVerificationRequestIssues",
			(fact) => (fact.kind === "issue" ? fact.value : undefined),
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemVerificationRequestAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

export function workItemVerificationResultMapper<TInput = unknown>(
	graph: Graph,
	opts: WorkItemVerificationResultMapperOptions<TInput>,
): WorkItemVerificationResultMapperBundle {
	const name = opts.name ?? "workItemVerificationResults";
	const deps =
		opts.policies === undefined
			? [opts.workItems, opts.evidence]
			: [opts.workItems, opts.evidence, opts.policies];
	const runtime = graph.node<Fact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<ResultState<TInput>>() ?? {
				workItems: new Map(),
				policies: new Map(),
				evidenceById: new Map(),
				resultEvidence: new Set(),
				proposalKeys: new Set(),
				statusSeq: 0,
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
				replayEvidence(ctx, state, workItem.workItemId);
			}
			if (opts.policies !== undefined) {
				for (const raw of depBatch(ctx, 2) ?? []) {
					const policy = raw as WorkItemVerificationMappingPolicy;
					const issues = validateMappingPolicy(policy);
					if (issues.length > 0) {
						for (const item of issues) emit(ctx, "issue", item);
						emitResultStatus(ctx, state, {
							state: "rejected",
							code: "policy-mismatch",
							metadata: { policyId: isRecord(policy) ? policy.policyId : undefined },
						});
						continue;
					}
					state.policies.set(policy.policyId, policy);
				}
				for (const evidence of state.evidenceById.values()) {
					mapEvidence(ctx, state, evidence, true);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? [])
				mapEvidence(ctx, state, raw as WorkItemEvidenceRecorded);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemVerificationResultMapper",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		results: project(graph, runtime, `${name}/results`, "workItemVerificationResults", (fact) =>
			fact.kind === "result" ? fact.value : undefined,
		),
		proposals: project(
			graph,
			runtime,
			`${name}/proposals`,
			"workItemVerificationProposals",
			(fact) => (fact.kind === "proposal" ? fact.value : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "workItemVerificationResultStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemVerificationResultIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemVerificationResultAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

function lowerPlan<T>(
	ctx: Ctx,
	state: RequestState<T>,
	workItem: WorkItemProjection<T>,
	policy?: WorkItemVerificationLowererPolicy,
): void {
	const plan = normalizePlan(workItem);
	if (plan === undefined) {
		emitRequestStatus(ctx, state, {
			state: "needs-human-review",
			code: "verification-unplanned",
			workItemId: workItem.workItemId,
		});
		return;
	}
	const issues = validateVerificationPlan(plan, workItem.acceptanceCriteria ?? [], {
		workItemId: workItem.workItemId,
		allowedModes: policy?.allowedModes,
		allowedEffectKinds: policy?.allowedEffectKinds,
	});
	if (issues.length > 0) {
		for (const item of issues) emit(ctx, "issue", item);
		return;
	}
	if (policy?.autoRun === false) {
		emitRequestStatus(ctx, state, {
			state: "deferred",
			code: "policy-mismatch",
			workItemId: workItem.workItemId,
			revision: workItem.authoringRevision,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { policyId: policy.policyId, reason: "auto-run-disabled" },
		});
		return;
	}
	for (const step of plan.steps) {
		if (isStepSatisfied(state, workItem, step.stepId)) {
			emitRequestStatus(ctx, state, {
				state: "duplicate",
				code: "duplicate-suppressed",
				workItemId: workItem.workItemId,
				revision: workItem.authoringRevision,
				executionInputRevision: workItem.executionInputRevision,
				stepId: step.stepId,
				message: `Verification step '${step.stepId}' already has valid evidence`,
			});
			continue;
		}
		if (step.mode === "manual") {
			emitRequestStatus(ctx, state, {
				state: "needs-human-review",
				code: "manual-review-required",
				workItemId: workItem.workItemId,
				stepId: step.stepId,
			});
			continue;
		}
		const missingPrerequisites = (step.dependsOnStepIds ?? []).filter(
			(stepId) => !isStepSatisfied(state, workItem, stepId),
		);
		if (missingPrerequisites.length > 0) {
			emitRequestStatus(ctx, state, {
				state: "blocked",
				code: "blocked-prerequisite",
				workItemId: workItem.workItemId,
				stepId: step.stepId,
				metadata: { missingStepIds: missingPrerequisites },
			});
			continue;
		}
		emitRequest(ctx, state, requestFromStep(workItem, plan, step, policy));
	}
}

function lowerIntent<T>(
	ctx: Ctx,
	state: RequestState<T>,
	intent: WorkItemDispatchIntent<T>,
	policy?: WorkItemVerificationLowererPolicy,
): void {
	const workItem = state.workItems.get(intent.workItemId);
	if (workItem === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Dispatch intent '${intent.intentId}' references unknown WorkItem '${intent.workItemId}'`,
				intent.workItemId,
			),
		);
		return;
	}
	if (intent.executionInputRevision !== workItem.executionInputRevision) {
		emit(
			ctx,
			"issue",
			issue(
				"stale-execution-input",
				`Dispatch intent '${intent.intentId}' targets stale execution input`,
				intent.workItemId,
				{
					intentRevision: intent.executionInputRevision,
					currentRevision: workItem.executionInputRevision,
					stalePolicy: policy?.stalePolicy ?? "review",
				},
			),
		);
		emitRequestStatus(ctx, state, {
			state: "stale",
			code: "stale-execution-input",
			workItemId: intent.workItemId,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { intentId: intent.intentId },
		});
		return;
	}
	const effectKind = intent.effectKind ?? intent.targetKind;
	const allowedEffectKinds = new Set(policy?.allowedEffectKinds ?? ["verification"]);
	if (!allowedEffectKinds.has(effectKind)) {
		emit(
			ctx,
			"issue",
			issue(
				"unsupported-effect-kind",
				`Dispatch intent '${intent.intentId}' targets unsupported effect kind '${effectKind}'`,
				intent.workItemId,
				{ intentId: intent.intentId, effectKind },
			),
		);
		emitRequestStatus(ctx, state, {
			state: "rejected",
			code: "unsupported-effect-kind",
			workItemId: intent.workItemId,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { intentId: intent.intentId, effectKind },
		});
		return;
	}
	emitRequest(ctx, state, requestFromIntent(workItem, intent));
}

function recordVerificationResult<T>(
	ctx: Ctx,
	state: RequestState<T>,
	result: VerificationResultRecorded,
	policy?: WorkItemVerificationLowererPolicy,
): void {
	if (result.status !== "passed") return;
	const workItem = state.workItems.get(result.workItemId);
	if (workItem === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Verification result '${result.resultId}' references unknown WorkItem '${result.workItemId}'`,
				result.workItemId,
			),
		);
		return;
	}
	if (result.executionInputRevision !== workItem.executionInputRevision) {
		emit(
			ctx,
			"issue",
			issue(
				"stale-revision",
				`Verification result '${result.resultId}' targets stale execution input`,
				result.workItemId,
			),
		);
		return;
	}
	const key = revisionKey(result.workItemId, result.executionInputRevision);
	const passedSteps = state.passedSteps.get(key) ?? new Set<string>();
	for (const stepId of result.verificationStepIds) passedSteps.add(stepId);
	state.passedSteps.set(key, passedSteps);
	lowerPlan(ctx, state, workItem, policy);
}

function mapEvidence<T>(
	ctx: Ctx,
	state: ResultState<T>,
	evidence: WorkItemEvidenceRecorded,
	replay = false,
): void {
	if (!replay && state.evidenceById.has(evidence.evidenceId)) {
		emit(
			ctx,
			"issue",
			issue(
				"duplicate-suppressed",
				`Duplicate evidence '${evidence.evidenceId}'`,
				evidence.workItemId,
			),
		);
		return;
	}
	state.evidenceById.set(evidence.evidenceId, evidence);
	const workItem = state.workItems.get(evidence.workItemId);
	if (workItem === undefined) {
		emit(
			ctx,
			"issue",
			issue(
				"dangling-ref",
				`Evidence '${evidence.evidenceId}' references unknown WorkItem '${evidence.workItemId}'`,
				evidence.workItemId,
			),
		);
		return;
	}
	const revision =
		typeof evidence.metadata?.executionInputRevision === "number"
			? evidence.metadata.executionInputRevision
			: undefined;
	if (revision !== workItem.executionInputRevision) {
		emit(
			ctx,
			"issue",
			issue(
				"stale-revision",
				`Evidence '${evidence.evidenceId}' targets stale revision`,
				evidence.workItemId,
			),
		);
		emitResultStatus(ctx, state, {
			state: "stale",
			code: "stale-revision",
			workItemId: evidence.workItemId,
			executionInputRevision: workItem.executionInputRevision,
		});
		return;
	}
	const stepIds = stringArray(evidence.metadata?.verificationStepIds);
	const criterionIds = stringArray(evidence.metadata?.acceptanceCriterionIds);
	if (stepIds.length === 0 || criterionIds.length === 0) {
		emit(
			ctx,
			"issue",
			issue(
				"ambiguous-coverage",
				`Evidence '${evidence.evidenceId}' lacks coverage refs`,
				evidence.workItemId,
			),
		);
		return;
	}
	const coverageIssue = validateEvidenceCoverage(workItem, stepIds, criterionIds);
	if (coverageIssue !== undefined) {
		emit(ctx, "issue", {
			...coverageIssue,
			message: `Evidence '${evidence.evidenceId}' has invalid verification coverage: ${coverageIssue.message}`,
		});
		emitResultStatus(ctx, state, {
			state: "rejected",
			code: coverageIssue.code as WorkItemValidationIssueCode,
			workItemId: evidence.workItemId,
			executionInputRevision: workItem.executionInputRevision,
			metadata: { evidenceId: evidence.evidenceId },
		});
		return;
	}
	const result: VerificationResultRecorded = {
		kind: "verification-result-recorded",
		resultId: `verification-result:${evidence.evidenceId}`,
		workItemId: evidence.workItemId,
		evidenceId: evidence.evidenceId,
		effectRunId: evidence.effectRunId,
		effectRunResultId: evidence.effectRunResultId,
		executionInputRevision: revision,
		verificationStepIds: stepIds,
		acceptanceCriterionIds: criterionIds,
		status: resultStatus(evidence.status),
		output: evidence.output,
		error: evidence.error,
		reason: evidence.reason,
		sourceRefs: evidence.sourceRefs,
		recordedAtMs: evidence.recordedAtMs,
		metadata: evidence.metadata,
	};
	if (!state.resultEvidence.has(evidence.evidenceId)) {
		state.resultEvidence.add(evidence.evidenceId);
		emit(ctx, "result", result);
		emitResultStatus(ctx, state, {
			state: "result-recorded",
			workItemId: evidence.workItemId,
			executionInputRevision: revision,
			metadata: { resultId: result.resultId },
		});
	}
	const policyIds = [
		...new Set(
			(evidence.sourceRefs ?? [])
				.filter((sourceRef) => sourceRef.kind === "work-item-verification-mapping-policy")
				.map((sourceRef) => sourceRef.id),
		),
	];
	if (policyIds.length === 0) return;
	for (const policyId of policyIds) {
		const policy = state.policies.get(policyId);
		if (policy === undefined) {
			if (!replay) {
				emit(
					ctx,
					"issue",
					issue(
						"missing-policy",
						`Missing verification mapping policy '${policyId}'`,
						evidence.workItemId,
						{ policyId },
					),
				);
				emitResultStatus(ctx, state, {
					state: "deferred",
					code: "missing-policy",
					workItemId: evidence.workItemId,
					executionInputRevision: revision,
					metadata: { evidenceId: evidence.evidenceId, policyId },
				});
			}
			continue;
		}
		for (const [index, spec] of (policy.actionProposals ?? []).entries()) {
			if (spec.behavior !== undefined && spec.behavior !== "propose") {
				emit(ctx, "issue", actionProposalIssue(policy, spec, evidence, "unsupported behavior"));
				continue;
			}
			if (spec.actionKind.length === 0) {
				emit(ctx, "issue", actionProposalIssue(policy, spec, evidence, "empty actionKind"));
				continue;
			}
			if (spec.statuses !== undefined && !spec.statuses.includes(evidence.status)) continue;
			const outputKind = evidence.output?.kind;
			if (
				spec.outputKinds !== undefined &&
				(outputKind === undefined || !spec.outputKinds.includes(outputKind))
			)
				continue;
			const proposalKey = `${evidence.evidenceId}:${policy.policyId}:${index}:${spec.actionKind}`;
			if (state.proposalKeys.has(proposalKey)) continue;
			state.proposalKeys.add(proposalKey);
			emit(ctx, "proposal", {
				kind: "work-item-domain-action-proposal",
				proposalId: `verification:${result.resultId}:${policy.policyId}:${index}:${spec.actionKind}`,
				workItemId: result.workItemId,
				actionKind: spec.actionKind,
				effectRunId: result.effectRunId,
				effectRunResultId: result.effectRunResultId,
				evidenceId: result.evidenceId,
				policyId: policy.policyId,
				payload: actionProposalPayload(spec, evidence, result),
				reason: spec.reason ?? evidence.reason,
				sourceRefs: [
					ref("work-item-evidence", evidence.evidenceId),
					ref("verification-result", result.resultId),
					ref("effect-run-result", result.effectRunResultId),
					ref("work-item-verification-mapping-policy", policy.policyId),
				],
				metadata: {
					...(policy.metadata ?? {}),
					...(spec.metadata ?? {}),
					resultStatus: evidence.status,
				},
			});
			emitResultStatus(ctx, state, {
				state: "domain-action-proposed",
				workItemId: evidence.workItemId,
				executionInputRevision: revision,
				metadata: { actionKind: spec.actionKind, policyId: policy.policyId },
			});
		}
	}
}

function requestFromStep<T>(
	workItem: WorkItemProjection<T>,
	plan: VerificationPlan<T>,
	step: VerificationStep<T>,
	policy?: WorkItemVerificationLowererPolicy,
): WorkItemEffectRequested<T> {
	const requestId = `work-item:${workItem.workItemId}:verification:${workItem.executionInputRevision}:${plan.planId}:${step.stepId}`;
	const effectKind = step.effectKind ?? "verification";
	const criterionIds =
		step.verifiesCriteriaIds ??
		(workItem.acceptanceCriteria ?? []).map((criterion) => criterion.criterionId);
	const goal = goalWithInlineInput(
		step.goal ?? { kind: effectKind, summary: step.title ?? workItem.summary },
		step.input,
		`verification-step:${step.stepId}:input`,
		effectKind,
		step.contextRefs,
	);
	return {
		kind: "work-item-effect-requested",
		requestId,
		workItemId: workItem.workItemId,
		effectRunId: `effect-run:${requestId}`,
		effectKind,
		executionInputRevision: workItem.executionInputRevision,
		sourceRefs: [
			ref("work-item", workItem.workItemId),
			ref("work-item-revision", `${workItem.workItemId}:${workItem.executionInputRevision}`),
			ref("verification-plan", plan.planId),
			ref("verification-step", step.stepId),
			...(plan.sourceRefs ?? []),
			...(step.sourceRefs ?? []),
		],
		goal,
		policyRefs:
			policy?.policyId === undefined
				? step.policyRefs
				: [
						...(step.policyRefs ?? []),
						ref("work-item-verification-lowerer-policy", policy.policyId),
					],
		idempotencyKey: `${workItem.workItemId}:verification:${workItem.executionInputRevision}:${plan.planId}:${step.stepId}`,
		metadata: {
			...(step.metadata ?? {}),
			executionInputRevision: workItem.executionInputRevision,
			verificationPlanId: plan.planId,
			verificationStepIds: [step.stepId],
			acceptanceCriterionIds: criterionIds,
			...(step.contextRefs === undefined ? {} : { contextRefs: step.contextRefs }),
			...(step.requirements === undefined ? {} : { requirements: step.requirements }),
			...(step.capacityHints === undefined ? {} : { capacityHints: step.capacityHints }),
		},
	};
}

function requestFromIntent<T>(
	workItem: WorkItemProjection<T>,
	intent: WorkItemDispatchIntent<T>,
): WorkItemEffectRequested<T> {
	const requestId = `work-item:${workItem.workItemId}:dispatch:${workItem.executionInputRevision}:${intent.intentId}`;
	const effectKind = intent.effectKind ?? intent.targetKind;
	return {
		kind: "work-item-effect-requested",
		requestId,
		workItemId: workItem.workItemId,
		effectRunId: `effect-run:${requestId}`,
		effectKind,
		executionInputRevision: workItem.executionInputRevision,
		sourceRefs: [
			ref("work-item", workItem.workItemId),
			ref("work-item-dispatch-intent", intent.intentId),
			...(intent.sourceRefs ?? []),
		],
		goal: intent.goal ?? { kind: effectKind, summary: intent.reason ?? workItem.summary },
		policyRefs: intent.policyRefs,
		limits: intent.limits,
		idempotencyKey:
			intent.idempotencyKey ??
			`${workItem.workItemId}:dispatch:${workItem.executionInputRevision}:${intent.intentId}`,
		metadata: {
			...(intent.metadata ?? {}),
			executionInputRevision: workItem.executionInputRevision,
			verificationStepIds: intent.stepIds ?? [],
			acceptanceCriterionIds: intent.acceptanceCriterionIds ?? [],
			...(intent.contextRefs === undefined ? {} : { contextRefs: intent.contextRefs }),
			...(intent.requirements === undefined ? {} : { requirements: intent.requirements }),
			...(intent.capacityHints === undefined ? {} : { capacityHints: intent.capacityHints }),
		},
	};
}

function emitRequest<T>(
	ctx: Ctx,
	state: RequestState<T>,
	request: WorkItemEffectRequested<T>,
): void {
	const key = request.idempotencyKey ?? request.requestId;
	if (state.emittedKeys.has(key)) {
		emitRequestStatus(ctx, state, {
			state: "duplicate",
			code: "duplicate-suppressed",
			workItemId: request.workItemId,
			metadata: { requestId: request.requestId },
		});
		return;
	}
	state.emittedKeys.add(key);
	emit(ctx, "request", request);
	emitRequestStatus(ctx, state, {
		state: "request-emitted",
		workItemId: request.workItemId,
		executionInputRevision:
			request.executionInputRevision ??
			(request.metadata?.executionInputRevision as number | undefined),
		metadata: { requestId: request.requestId },
	});
}

function emitRequestStatus<T>(
	ctx: Ctx,
	state: RequestState<T>,
	status: Omit<WorkItemValidationStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-validation-status",
		statusId: `work-item-verification-request-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemValidationStatus;
	emit(ctx, "status", statusFact);
	emitAudit(ctx, state, "work-item-verification-request-status", statusFact);
}

function emitResultStatus<T>(
	ctx: Ctx,
	state: ResultState<T>,
	status: Omit<WorkItemValidationStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-validation-status",
		statusId: `work-item-verification-result-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemValidationStatus;
	emit(ctx, "status", statusFact);
	emitAudit(ctx, state, "work-item-verification-result-status", statusFact);
}

function _emit<T, K extends Fact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<Fact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as Fact<T>]]);
}

function validateEvidenceCoverage<T>(
	workItem: WorkItemProjection<T>,
	stepIds: readonly string[],
	criterionIds: readonly string[],
): DataIssue | undefined {
	const plan = normalizePlan(workItem);
	const validStepIds = new Set((plan?.steps ?? []).map((step) => step.stepId));
	const validCriterionIds = new Set(
		(workItem.acceptanceCriteria ?? []).map((criterion) => criterion.criterionId),
	);
	for (const stepId of stepIds) {
		if (!validStepIds.has(stepId)) {
			return issue("dangling-ref", `unknown verification step '${stepId}'`, workItem.workItemId, {
				stepId,
			});
		}
	}
	for (const criterionId of criterionIds) {
		if (!validCriterionIds.has(criterionId)) {
			return issue(
				"dangling-ref",
				`unknown acceptance criterion '${criterionId}'`,
				workItem.workItemId,
				{ criterionId },
			);
		}
	}
	return undefined;
}

function isStepSatisfied<T>(
	state: RequestState<T>,
	workItem: WorkItemProjection<T>,
	stepId: string,
): boolean {
	return (
		state.passedSteps
			.get(revisionKey(workItem.workItemId, workItem.executionInputRevision))
			?.has(stepId) === true
	);
}

function revisionKey(workItemId: string, executionInputRevision: number): string {
	return `${workItemId}:${executionInputRevision}`;
}

function replayEvidence<T>(ctx: Ctx, state: ResultState<T>, workItemId: string): void {
	for (const evidence of state.evidenceById.values()) {
		if (evidence.workItemId === workItemId) mapEvidence(ctx, state, evidence, true);
	}
}

function validateMappingPolicy(policy: WorkItemVerificationMappingPolicy): readonly DataIssue[] {
	if (
		!isRecord(policy) ||
		policy.kind !== "work-item-verification-mapping-policy" ||
		typeof policy.policyId !== "string" ||
		policy.policyId.trim() === ""
	) {
		return [
			issue(
				"policy-mismatch",
				"WorkItemVerificationMappingPolicy requires kind and policyId",
				undefined,
			),
		];
	}
	if (policy.actionProposals !== undefined && !Array.isArray(policy.actionProposals)) {
		return [
			issue(
				"policy-mismatch",
				"WorkItemVerificationMappingPolicy.actionProposals must be an array",
				undefined,
				{
					policyId: policy.policyId,
				},
			),
		];
	}
	const out: DataIssue[] = [];
	for (const [index, spec] of (policy.actionProposals ?? []).entries()) {
		if (!isRecord(spec) || typeof spec.actionKind !== "string") {
			out.push(
				issue("policy-mismatch", "WorkItem action proposal requires actionKind", undefined, {
					policyId: policy.policyId,
					index,
				}),
			);
		}
	}
	return out;
}

function resultStatus(status: EffectRunResultStatus): VerificationResultStatus {
	if (status === "completed") return "passed";
	if (status === "failed") return "failed";
	if (status === "blocked") return "blocked";
	if (status === "canceled") return "canceled";
	if (status === "timeout") return "timeout";
	return "waived";
}

function actionProposalPayload(
	spec: WorkItemDomainActionProposalSpec,
	evidence: WorkItemEvidenceRecorded,
	result: VerificationResultRecorded,
): unknown {
	if (spec.payload !== undefined) return spec.payload;
	if (spec.payloadFrom === "effect-run-result")
		return { kind: "effect-run-result-ref", resultId: result.effectRunResultId };
	if (spec.payloadFrom === "output") return evidence.output;
	if (spec.payloadFrom === "evidence")
		return { kind: "work-item-evidence-ref", evidenceId: evidence.evidenceId };
	return undefined;
}

function actionProposalIssue(
	policy: WorkItemVerificationMappingPolicy,
	spec: WorkItemDomainActionProposalSpec,
	evidence: WorkItemEvidenceRecorded,
	reason: string,
): DataIssue {
	return issue(
		"policy-mismatch",
		`Verification mapping policy '${policy.policyId}' has an invalid action proposal: ${reason}`,
		evidence.workItemId,
		{ policyId: policy.policyId, actionKind: spec.actionKind },
	);
}
