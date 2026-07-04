import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type { EffectRunResult } from "../../orchestration/agent-runtime.js";
import type {
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../../orchestration/work-item-runtime.js";
import {
	memberBlockedByFailure,
	memberCoord,
	memberSucceeded,
	normalizeEffectPlanSnapshot,
	planKey,
	requestFromPlanMember,
	requiredPlanKey,
} from "./scheduling-effect-plan-helpers.js";
import { validateWorkItemEffectPlan } from "./scheduling-effect-plan-validation.js";
import {
	immutableClone,
	isRecord,
	issue,
	numberMetadata,
	project,
	sourceRefId,
	stringMetadata,
} from "./scheduling-shared.js";
import type {
	PlanFact,
	PlanMemberEvidence,
	PlanState,
	WorkItemEffectPlanAdmitted,
	WorkItemEffectPlanPolicy,
	WorkItemEffectPlanProjectorBundle,
	WorkItemEffectPlanProjectorOptions,
	WorkItemEffectPlanProposed,
	WorkItemEffectPlanRejected,
	WorkItemEffectPlanResult,
	WorkItemEffectPlanResultStatus,
	WorkItemEffectPlanStatus,
	WorkItemProjection,
} from "./scheduling-types.js";

/**
 * Creates a work item effect plan projector.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A node bundle that emits the projected records.
 * @category solutions
 * @example
 * ```ts
 * import { workItemEffectPlanProjector } from "@graphrefly/ts/solutions/work-item/scheduling";
 * ```
 */
export function workItemEffectPlanProjector<TInput = unknown>(
	graph: Graph,
	opts: WorkItemEffectPlanProjectorOptions<TInput>,
): WorkItemEffectPlanProjectorBundle<TInput> {
	const name = opts.name ?? "workItemEffectPlans";
	const deps: Node<unknown>[] = [opts.workItems, opts.proposals];
	const evidenceIndex = opts.evidence === undefined ? -1 : deps.push(opts.evidence) - 1;
	const resultIndex =
		opts.effectRunResults === undefined ? -1 : deps.push(opts.effectRunResults) - 1;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<PlanFact<TInput>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<PlanState<TInput>>() ?? emptyPlanState<TInput>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemProjection<TInput>;
				state.workItems.set(workItem.workItemId, workItem);
				for (const proposal of state.proposals.values()) {
					if (proposal.workItemId === workItem.workItemId)
						admitPlan(ctx, state, proposal, opts.policy, now);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const proposal = raw as WorkItemEffectPlanProposed<TInput>;
				if (
					isRecord(proposal) &&
					typeof proposal.planId === "string" &&
					typeof proposal.workItemId === "string"
				) {
					const key = planKey(
						proposal.workItemId,
						proposal.planId,
						proposal.executionInputRevision,
					);
					if (key !== undefined) state.proposals.set(key, proposal);
				}
				admitPlan(ctx, state, proposal, opts.policy, now);
			}
			if (evidenceIndex >= 0) {
				for (const raw of depBatch(ctx, evidenceIndex) ?? [])
					recordPlanEvidence(ctx, state, raw as WorkItemEvidenceRecorded);
			}
			if (resultIndex >= 0) {
				for (const raw of depBatch(ctx, resultIndex) ?? [])
					recordPlanResult(ctx, state, raw as EffectRunResult);
			}
			drainPlanWork(ctx, state, opts.policy);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemEffectPlanProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		admitted: project(graph, runtime, `${name}/admitted`, "workItemEffectPlansAdmitted", (fact) =>
			fact.kind === "admitted" ? fact.value : undefined,
		),
		rejected: project(graph, runtime, `${name}/rejected`, "workItemEffectPlansRejected", (fact) =>
			fact.kind === "rejected" ? fact.value : undefined,
		),
		effectRequests: project(
			graph,
			runtime,
			`${name}/effectRequests`,
			"workItemEffectPlanEffectRequests",
			(fact) => (fact.kind === "request" ? fact.value : undefined),
		),
		results: project(graph, runtime, `${name}/results`, "workItemEffectPlanResults", (fact) =>
			fact.kind === "result" ? fact.value : undefined,
		),
		status: project(graph, runtime, `${name}/status`, "workItemEffectPlanStatus", (fact) =>
			fact.kind === "status" ? fact.value : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemEffectPlanIssues", (fact) =>
			fact.kind === "issue" ? fact.value : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemEffectPlanAudit", (fact) =>
			fact.kind === "audit" ? fact.value : undefined,
		),
	};
}

function emptyPlanState<T>(): PlanState<T> {
	return {
		workItems: new Map(),
		proposals: new Map(),
		admitted: new Map(),
		rejected: new Set(),
		emittedMemberKeys: new Set(),
		statusKeys: new Set(),
		resultKeys: new Set(),
		requestByEffectRun: new Map(),
		requestByRequestId: new Map(),
		memberEvidence: new Map(),
		pendingEvidence: new Map(),
		pendingResults: new Map(),
		unmatchedEvidence: new Set(),
		unmatchedResults: new Set(),
		statusSeq: 0,
		auditSeq: 0,
	};
}

function admitPlan<T>(
	ctx: Ctx,
	state: PlanState<T>,
	proposal: WorkItemEffectPlanProposed<T>,
	policy: WorkItemEffectPlanPolicy | undefined,
	now: () => number,
): void {
	if (!isRecord(proposal) || typeof proposal.planId !== "string") {
		const issues = validateWorkItemEffectPlan(proposal, undefined, policy);
		emitPlanIssues(ctx, state, issues);
		return;
	}
	const key = planKey(proposal.workItemId, proposal.planId, proposal.executionInputRevision);
	if (key === undefined) {
		const issues = validateWorkItemEffectPlan(proposal, undefined, policy);
		emitPlanIssues(ctx, state, issues);
		return;
	}
	if (state.admitted.has(key) || state.rejected.has(key)) return;
	const workItem = state.workItems.get(proposal.workItemId);
	if (workItem === undefined) {
		emitPlanStatusOnce(ctx, state, `${key}:deferred:missing-work-item`, {
			workItemId: proposal.workItemId,
			planId: proposal.planId,
			executionInputRevision: proposal.executionInputRevision,
			state: "deferred",
			message: `WorkItemEffectPlan '${proposal.planId}' is waiting for WorkItem '${proposal.workItemId}'`,
			sourceRefs: proposal.sourceRefs,
			metadata: { reason: "missing-work-item" },
		});
		return;
	}
	const issues = validateWorkItemEffectPlan(proposal, workItem, policy);
	if (issues.length > 0) {
		state.rejected.add(key);
		emitPlanIssues(ctx, state, issues);
		const rejected: WorkItemEffectPlanRejected = {
			kind: "work-item-effect-plan-rejected",
			planId: proposal.planId,
			workItemId: proposal.workItemId,
			executionInputRevision: proposal.executionInputRevision,
			issues,
			sourceRefs: proposal.sourceRefs,
			rejectedAtMs: now(),
			metadata: proposal.metadata,
		};
		emitPlan(ctx, "rejected", rejected);
		emitPlanStatus(ctx, state, {
			workItemId: proposal.workItemId,
			planId: proposal.planId,
			executionInputRevision: proposal.executionInputRevision,
			state: "rejected",
			issues,
			sourceRefs: proposal.sourceRefs,
			metadata: { issueCodes: issues.map((item) => item.code) },
		});
		return;
	}
	const snapshot = normalizeEffectPlanSnapshot(proposal, policy);
	const admitted: WorkItemEffectPlanAdmitted<T> = {
		kind: "work-item-effect-plan-admitted",
		planId: snapshot.planId,
		workItemId: snapshot.workItemId,
		executionInputRevision: snapshot.executionInputRevision,
		plan: snapshot,
		sourceRefs: immutableClone(proposal.sourceRefs),
		admittedAtMs: now(),
		metadata: immutableClone(proposal.metadata),
	};
	state.admitted.set(key, admitted);
	emitPlan(ctx, "admitted", admitted);
	emitPlanStatus(ctx, state, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: "eligible",
		sourceRefs: admitted.sourceRefs,
		metadata: { memberCount: admitted.plan.members.length },
	});
}

function drainPlanWork<T>(ctx: Ctx, state: PlanState<T>, policy?: WorkItemEffectPlanPolicy): void {
	const maxPasses =
		state.admitted.size +
		state.pendingEvidence.size +
		state.pendingResults.size +
		state.emittedMemberKeys.size +
		1;
	for (let pass = 0; pass < maxPasses; pass += 1) {
		let changed = false;
		for (const admitted of state.admitted.values()) {
			changed = lowerEligiblePlanMembers(ctx, state, admitted, policy) || changed;
			derivePlanResult(ctx, state, admitted);
		}
		changed = replayPendingPlanFacts(ctx, state) || changed;
		if (!changed) break;
	}
	for (const admitted of state.admitted.values()) derivePlanResult(ctx, state, admitted);
}

function lowerEligiblePlanMembers<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	policy?: WorkItemEffectPlanPolicy,
): boolean {
	if (isAdmittedPlanStale(state, admitted)) {
		emitStaleAdmittedPlanOnce(ctx, state, admitted);
		return false;
	}
	let changed = false;
	for (const member of admitted.plan.members) {
		const coord = memberCoord(admitted, member.memberId);
		if (state.memberEvidence.has(coord)) continue;
		const missing = (member.dependsOnMemberIds ?? []).filter(
			(memberId) => !memberSucceeded(state, admitted, memberId),
		);
		if (missing.length > 0) {
			emitPlanStatusOnce(ctx, state, `${coord}:blocked:${missing.join(",")}`, {
				workItemId: admitted.workItemId,
				planId: admitted.planId,
				executionInputRevision: admitted.executionInputRevision,
				state: "blocked",
				planMemberId: member.memberId,
				issues: [
					issue(
						"blocked-prerequisite",
						`WorkItemEffectPlan member '${member.memberId}' is blocked by prerequisites`,
						admitted.workItemId,
						{ planId: admitted.planId, planMemberId: member.memberId, missingMemberIds: missing },
					),
				],
				sourceRefs: member.sourceRefs,
				metadata: { missingMemberIds: missing },
			});
			continue;
		}
		if (state.emittedMemberKeys.has(coord)) continue;
		state.emittedMemberKeys.add(coord);
		changed = true;
		const request = requestFromPlanMember(admitted, member, policy);
		state.requestByEffectRun.set(request.effectRunId, request);
		state.requestByRequestId.set(request.requestId, request);
		emitPlan(ctx, "request", request);
		emitPlanStatus(ctx, state, {
			workItemId: admitted.workItemId,
			planId: admitted.planId,
			executionInputRevision: admitted.executionInputRevision,
			state: "requested",
			planMemberId: member.memberId,
			requestId: request.requestId,
			effectRunId: request.effectRunId,
			sourceRefs: request.sourceRefs,
			metadata: { effectKind: request.effectKind },
		});
	}
	return changed;
}

function recordPlanEvidence<T>(
	ctx: Ctx,
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
): boolean {
	const coordinate = planCoordinateFromEvidence(state, evidence);
	if (coordinate === undefined) {
		state.pendingEvidence.set(evidence.evidenceId, evidence);
		emitUnmatchedEvidence(ctx, state, `evidence:${evidence.evidenceId}`, evidence.workItemId, {
			evidenceId: evidence.evidenceId,
			effectRunId: evidence.effectRunId,
		});
		return false;
	}
	if (emitConflictingPlanEvidenceCoordinate(ctx, state, evidence, coordinate)) return true;
	const key = requiredPlanKey(
		coordinate.workItemId,
		coordinate.planId,
		coordinate.executionInputRevision,
	);
	const admitted = state.admitted.get(key);
	if (admitted === undefined) {
		state.pendingEvidence.set(evidence.evidenceId, evidence);
		emitUnmatchedEvidence(ctx, state, `evidence:${evidence.evidenceId}`, coordinate.workItemId, {
			evidenceId: evidence.evidenceId,
			effectRunId: evidence.effectRunId,
			planId: coordinate.planId,
			planMemberId: coordinate.planMemberId,
			executionInputRevision: coordinate.executionInputRevision,
		});
		return false;
	}
	if (isAdmittedPlanStale(state, admitted)) {
		emitStaleAdmittedPlanOnce(ctx, state, admitted);
		return true;
	}
	if (!hasPlanMember(admitted, coordinate.planMemberId)) {
		emitUnknownPlanMember(ctx, state, admitted, coordinate.planMemberId, {
			evidenceId: evidence.evidenceId,
			effectRunId: evidence.effectRunId,
		});
		return true;
	}
	const recorded = recordMemberEvidence(ctx, state, admitted, coordinate.planMemberId, {
		status: evidence.status,
		requestId: coordinate.requestId ?? coordinate.request?.requestId,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		effectRunResultId: evidence.effectRunResultId,
		sourceRefs: evidence.sourceRefs,
	});
	if (!recorded) return true;
	emitPlanStatus(ctx, state, {
		workItemId: coordinate.workItemId,
		planId: coordinate.planId,
		executionInputRevision: coordinate.executionInputRevision,
		state: evidence.status === "completed" ? "completed" : "failed",
		planMemberId: coordinate.planMemberId,
		requestId: coordinate.requestId ?? coordinate.request?.requestId,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		effectRunResultId: evidence.effectRunResultId,
		sourceRefs: evidence.sourceRefs,
		metadata: { evidenceStatus: evidence.status },
	});
	return true;
}

function emitConflictingPlanEvidenceCoordinate<T>(
	ctx: Ctx,
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
	coordinate: PlanCoordinate<T>,
): boolean {
	const expectedRequest = planRequestForCoordinate(state, coordinate);
	const expectedRequestIdMismatch =
		expectedRequest !== undefined &&
		evidence.requestId !== undefined &&
		evidence.requestId !== expectedRequest.requestId;
	if (
		expectedRequest !== undefined &&
		(expectedRequestIdMismatch || evidence.effectRunId !== expectedRequest.effectRunId)
	) {
		emitPlanEvidenceCoordinateMismatch(ctx, state, evidence, coordinate, expectedRequest);
		return true;
	}
	const requestRefs = [
		evidence.requestId === undefined ? undefined : state.requestByRequestId.get(evidence.requestId),
		state.requestByEffectRun.get(evidence.effectRunId),
	].filter((request): request is WorkItemEffectRequested<T> => request !== undefined);
	const conflicting = requestRefs.find(
		(request) =>
			!requestMatchesPlanCoordinate(request, coordinate) ||
			!requestMatchesEvidenceIdentity(request, evidence),
	);
	if (conflicting === undefined) return false;
	emitPlanEvidenceCoordinateMismatch(ctx, state, evidence, coordinate, conflicting);
	return true;
}

function emitPlanEvidenceCoordinateMismatch<T>(
	ctx: Ctx,
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
	coordinate: PlanCoordinate<T>,
	conflicting: WorkItemEffectRequested<T>,
): void {
	const item = issue(
		"dangling-ref",
		"WorkItemEffectPlan evidence request/effectRun coordinates do not match its plan member coordinates",
		evidence.workItemId,
		{
			evidenceId: evidence.evidenceId,
			requestId: evidence.requestId,
			effectRunId: evidence.effectRunId,
			planId: coordinate.planId,
			planMemberId: coordinate.planMemberId,
			executionInputRevision: coordinate.executionInputRevision,
			requestPlanId: conflicting.planId,
			requestPlanMemberId: conflicting.planMemberId,
			requestExecutionInputRevision: conflicting.executionInputRevision,
		},
	);
	emitPlan(ctx, "issue", item);
	emitPlanStatus(ctx, state, {
		workItemId: coordinate.workItemId,
		planId: coordinate.planId,
		executionInputRevision: coordinate.executionInputRevision,
		state: "rejected",
		planMemberId: coordinate.planMemberId,
		requestId: evidence.requestId,
		effectRunId: evidence.effectRunId,
		evidenceId: evidence.evidenceId,
		issues: [item],
		sourceRefs: evidence.sourceRefs,
		metadata: item.metadata,
	});
}

function requestMatchesPlanCoordinate<T>(
	request: WorkItemEffectRequested<T>,
	coordinate: PlanCoordinate<T>,
): boolean {
	return (
		request.workItemId === coordinate.workItemId &&
		request.planId === coordinate.planId &&
		request.planMemberId === coordinate.planMemberId &&
		request.executionInputRevision === coordinate.executionInputRevision
	);
}

function requestMatchesEvidenceIdentity<T>(
	request: WorkItemEffectRequested<T>,
	evidence: WorkItemEvidenceRecorded,
): boolean {
	return (
		(evidence.requestId === undefined || evidence.requestId === request.requestId) &&
		evidence.effectRunId === request.effectRunId
	);
}

function planRequestForCoordinate<T>(
	state: PlanState<T>,
	coordinate: PlanCoordinate<T>,
): WorkItemEffectRequested<T> | undefined {
	for (const request of state.requestByRequestId.values()) {
		if (requestMatchesPlanCoordinate(request, coordinate)) return request;
	}
	return undefined;
}

function recordPlanResult<T>(ctx: Ctx, state: PlanState<T>, result: EffectRunResult): boolean {
	const coordinate = planCoordinateFromResult(state, result);
	if (coordinate === undefined) {
		state.pendingResults.set(result.resultId, result);
		emitUnmatchedEvidence(ctx, state, `result:${result.resultId}`, undefined, {
			effectRunResultId: result.resultId,
			effectRunId: result.effectRunId,
		});
		return false;
	}
	const key = requiredPlanKey(
		coordinate.workItemId,
		coordinate.planId,
		coordinate.executionInputRevision,
	);
	const admitted = state.admitted.get(key);
	if (admitted === undefined) {
		state.pendingResults.set(result.resultId, result);
		emitUnmatchedEvidence(ctx, state, `result:${result.resultId}`, coordinate.workItemId, {
			effectRunResultId: result.resultId,
			effectRunId: result.effectRunId,
			planId: coordinate.planId,
			planMemberId: coordinate.planMemberId,
			executionInputRevision: coordinate.executionInputRevision,
		});
		return false;
	}
	if (isAdmittedPlanStale(state, admitted)) {
		emitStaleAdmittedPlanOnce(ctx, state, admitted);
		return true;
	}
	if (!hasPlanMember(admitted, coordinate.planMemberId)) {
		emitUnknownPlanMember(ctx, state, admitted, coordinate.planMemberId, {
			effectRunResultId: result.resultId,
			effectRunId: result.effectRunId,
		});
		return true;
	}
	const recorded = recordMemberEvidence(ctx, state, admitted, coordinate.planMemberId, {
		status: result.status,
		requestId: coordinate.request?.requestId,
		effectRunId: result.effectRunId,
		effectRunResultId: result.resultId,
		sourceRefs: result.sourceRefs,
	});
	if (!recorded) return true;
	emitPlanStatus(ctx, state, {
		workItemId: coordinate.workItemId,
		planId: coordinate.planId,
		executionInputRevision: coordinate.executionInputRevision,
		state: result.status === "completed" ? "completed" : "failed",
		planMemberId: coordinate.planMemberId,
		requestId: coordinate.request?.requestId,
		effectRunId: result.effectRunId,
		effectRunResultId: result.resultId,
		sourceRefs: result.sourceRefs,
		metadata: { resultStatus: result.status },
	});
	return true;
}

function replayPendingPlanFacts<T>(ctx: Ctx, state: PlanState<T>): boolean {
	let changed = false;
	for (const [evidenceId, evidence] of [...state.pendingEvidence]) {
		if (recordPlanEvidence(ctx, state, evidence)) {
			state.pendingEvidence.delete(evidenceId);
			changed = true;
		}
	}
	for (const [resultId, result] of [...state.pendingResults]) {
		if (recordPlanResult(ctx, state, result)) {
			state.pendingResults.delete(resultId);
			changed = true;
		}
	}
	return changed;
}

interface PlanCoordinate<T> {
	readonly workItemId: string;
	readonly planId: string;
	readonly executionInputRevision: number;
	readonly planMemberId: string;
	readonly requestId?: string;
	readonly request?: WorkItemEffectRequested<T>;
}

function planCoordinateFromEvidence<T>(
	state: PlanState<T>,
	evidence: WorkItemEvidenceRecorded,
): PlanCoordinate<T> | undefined {
	const topLevelRequest =
		evidence.requestId === undefined ? undefined : state.requestByRequestId.get(evidence.requestId);
	const effectRunRequest = state.requestByEffectRun.get(evidence.effectRunId);
	if (
		evidence.planId !== undefined &&
		evidence.planMemberId !== undefined &&
		evidence.executionInputRevision !== undefined
	) {
		return {
			workItemId: evidence.workItemId,
			planId: evidence.planId,
			executionInputRevision: evidence.executionInputRevision,
			planMemberId: evidence.planMemberId,
			requestId: topLevelRequest?.requestId ?? effectRunRequest?.requestId ?? evidence.requestId,
			request: topLevelRequest ?? effectRunRequest,
		};
	}
	const request = effectRunRequest;
	if (
		request?.planId !== undefined &&
		request.planMemberId !== undefined &&
		request.executionInputRevision !== undefined
	) {
		return {
			workItemId: request.workItemId,
			planId: request.planId,
			executionInputRevision: request.executionInputRevision,
			planMemberId: request.planMemberId,
			requestId: request.requestId,
			request,
		};
	}
	const planId = stringMetadata(evidence.metadata, "planId");
	const planMemberId = stringMetadata(evidence.metadata, "planMemberId");
	const executionInputRevision = numberMetadata(evidence.metadata, "executionInputRevision");
	const requestId = stringMetadata(evidence.metadata, "requestId");
	if (planId === undefined || planMemberId === undefined || executionInputRevision === undefined)
		return undefined;
	return {
		workItemId: evidence.workItemId,
		planId,
		executionInputRevision,
		planMemberId,
		requestId,
	};
}

function planCoordinateFromResult<T>(
	state: PlanState<T>,
	result: EffectRunResult,
): PlanCoordinate<T> | undefined {
	const request = state.requestByEffectRun.get(result.effectRunId);
	if (
		request?.planId !== undefined &&
		request.planMemberId !== undefined &&
		request.executionInputRevision !== undefined
	) {
		return {
			workItemId: request.workItemId,
			planId: request.planId,
			executionInputRevision: request.executionInputRevision,
			planMemberId: request.planMemberId,
			requestId: request.requestId,
			request,
		};
	}
	const workItemId =
		sourceRefId(result.subjectRefs, "work-item") ?? sourceRefId(result.sourceRefs, "work-item");
	const planId = stringMetadata(result.metadata, "planId");
	const planMemberId = stringMetadata(result.metadata, "planMemberId");
	const executionInputRevision = numberMetadata(result.metadata, "executionInputRevision");
	if (
		workItemId === undefined ||
		planId === undefined ||
		planMemberId === undefined ||
		executionInputRevision === undefined
	)
		return undefined;
	return { workItemId, planId, executionInputRevision, planMemberId };
}

function recordMemberEvidence<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	planMemberId: string,
	evidence: PlanMemberEvidence,
): boolean {
	const coord = memberCoord(admitted, planMemberId);
	const existing = state.memberEvidence.get(coord);
	if (existing !== undefined) {
		const duplicateIssue = issue(
			"duplicate-suppressed",
			`WorkItemEffectPlan member '${planMemberId}' already has terminal evidence`,
			admitted.workItemId,
			{
				planId: admitted.planId,
				planMemberId,
				existingEvidenceId: existing.evidenceId,
				existingEffectRunResultId: existing.effectRunResultId,
				evidenceId: evidence.evidenceId,
				effectRunResultId: evidence.effectRunResultId,
			},
		);
		emitPlan(ctx, "issue", duplicateIssue);
		emitPlanStatus(ctx, state, {
			workItemId: admitted.workItemId,
			planId: admitted.planId,
			executionInputRevision: admitted.executionInputRevision,
			state: "duplicate",
			planMemberId,
			requestId: evidence.requestId,
			effectRunId: evidence.effectRunId,
			evidenceId: evidence.evidenceId,
			effectRunResultId: evidence.effectRunResultId,
			issues: [duplicateIssue],
			sourceRefs: evidence.sourceRefs,
		});
		return false;
	}
	state.memberEvidence.set(coord, evidence);
	return true;
}

function hasPlanMember<T>(admitted: WorkItemEffectPlanAdmitted<T>, planMemberId: string): boolean {
	return admitted.plan.members.some((member) => member.memberId === planMemberId);
}

function isAdmittedPlanStale<T>(
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
): boolean {
	const current = state.workItems.get(admitted.workItemId);
	return (
		current !== undefined && current.executionInputRevision !== admitted.executionInputRevision
	);
}

function emitStaleAdmittedPlanOnce<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
): void {
	const current = state.workItems.get(admitted.workItemId);
	emitPlanStatusOnce(ctx, state, `${memberCoord(admitted, "plan")}:stale`, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: "stale",
		issues: [
			issue(
				"stale-execution-input",
				`WorkItemEffectPlan '${admitted.planId}' targets stale execution input`,
				admitted.workItemId,
				{
					planId: admitted.planId,
					proposedRevision: admitted.executionInputRevision,
					currentRevision: current?.executionInputRevision,
				},
			),
		],
		sourceRefs: admitted.sourceRefs,
		metadata: { currentRevision: current?.executionInputRevision },
	});
}

function emitUnknownPlanMember<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
	planMemberId: string,
	metadata: Record<string, unknown>,
): void {
	const item = issue(
		"dangling-ref",
		`WorkItemEffectPlan evidence/result references unknown member '${planMemberId}'`,
		admitted.workItemId,
		{ planId: admitted.planId, planMemberId, ...metadata },
	);
	emitPlan(ctx, "issue", item);
	emitPlanStatus(ctx, state, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: "rejected",
		planMemberId,
		issues: [item],
		sourceRefs: admitted.sourceRefs,
		metadata,
	});
}

function emitUnmatchedEvidence<T>(
	ctx: Ctx,
	state: PlanState<T>,
	key: string,
	workItemId: string | undefined,
	metadata: Record<string, unknown>,
): void {
	const seen = key.startsWith("evidence:") ? state.unmatchedEvidence : state.unmatchedResults;
	if (seen.has(key)) return;
	seen.add(key);
	const item = issue(
		"dangling-ref",
		"WorkItemEffectPlan evidence/result could not be joined to an admitted plan member",
		workItemId,
		metadata,
	);
	emitPlan(ctx, "issue", item);
	emitPlanStatus(ctx, state, {
		workItemId: workItemId ?? "unknown",
		planId: typeof metadata.planId === "string" ? metadata.planId : "unknown",
		executionInputRevision:
			typeof metadata.executionInputRevision === "number" ? metadata.executionInputRevision : 0,
		state: "deferred",
		issues: [item],
		metadata,
	});
}

function derivePlanResult<T>(
	ctx: Ctx,
	state: PlanState<T>,
	admitted: WorkItemEffectPlanAdmitted<T>,
): void {
	const requiredMembers = admitted.plan.members.filter((member) => member.required !== false);
	if (requiredMembers.length === 0) return;
	const memberResults: WorkItemEffectPlanResult["memberResults"][number][] = [];
	for (const member of admitted.plan.members) {
		const evidence = state.memberEvidence.get(memberCoord(admitted, member.memberId));
		if (evidence === undefined) continue;
		memberResults.push({
			planMemberId: member.memberId,
			status: evidence.status,
			requestId: evidence.requestId,
			effectRunId: evidence.effectRunId,
			evidenceId: evidence.evidenceId,
			effectRunResultId: evidence.effectRunResultId,
		});
	}
	const hasRequiredFailed = requiredMembers.some((member) => {
		const evidence = state.memberEvidence.get(memberCoord(admitted, member.memberId));
		return evidence !== undefined && evidence.status !== "completed";
	});
	const settledRequiredCount = requiredMembers.filter((member) =>
		state.memberEvidence.has(memberCoord(admitted, member.memberId)),
	).length;
	const allRequiredSettled = settledRequiredCount === requiredMembers.length;
	const requiredBlockedByFailure = requiredMembers.some((member) =>
		memberBlockedByFailure(state, admitted, member.memberId, new Set()),
	);
	if (!hasRequiredFailed && !allRequiredSettled && !requiredBlockedByFailure) return;
	const status: WorkItemEffectPlanResultStatus =
		admitted.plan.joinPolicy === "evidence-only"
			? "evidence-only"
			: hasRequiredFailed || requiredBlockedByFailure
				? "failed"
				: "succeeded";
	const key = memberCoord(admitted, "result");
	if (state.resultKeys.has(key)) return;
	state.resultKeys.add(key);
	const result: WorkItemEffectPlanResult = {
		kind: "work-item-effect-plan-result",
		resultId: `work-item-effect-plan-result:${admitted.workItemId}:${admitted.executionInputRevision}:${admitted.planId}`,
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		status,
		memberResults,
		sourceRefs: admitted.sourceRefs,
	};
	emitPlan(ctx, "result", result);
	emitPlanStatus(ctx, state, {
		workItemId: admitted.workItemId,
		planId: admitted.planId,
		executionInputRevision: admitted.executionInputRevision,
		state: status === "succeeded" || status === "evidence-only" ? "completed" : "failed",
		sourceRefs: admitted.sourceRefs,
		metadata: { resultId: result.resultId, resultStatus: status },
	});
}

function emitPlanIssues<T>(ctx: Ctx, state: PlanState<T>, issues: readonly DataIssue[]): void {
	for (const item of issues) emitPlan(ctx, "issue", item);
	if (issues.length > 0) {
		state.auditSeq += 1;
		emitPlan(ctx, "audit", {
			id: `work-item-effect-plan-issue:${state.auditSeq}`,
			kind: "work-item-effect-plan-issue",
			subjectId: issues[0]?.subjectId,
			message: issues[0]?.message,
			issueCode: issues[0]?.code,
			metadata: { issueCodes: issues.map((item) => item.code) },
		});
	}
}

function emitPlanStatusOnce<T>(
	ctx: Ctx,
	state: PlanState<T>,
	key: string,
	status: Omit<WorkItemEffectPlanStatus, "kind" | "statusId">,
): void {
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	emitPlanStatus(ctx, state, status);
}

function emitPlanStatus<T>(
	ctx: Ctx,
	state: PlanState<T>,
	status: Omit<WorkItemEffectPlanStatus, "kind" | "statusId">,
): void {
	state.statusSeq += 1;
	const statusFact = {
		kind: "work-item-effect-plan-status",
		statusId: `work-item-effect-plan-status:${state.statusSeq}`,
		...status,
	} satisfies WorkItemEffectPlanStatus;
	emitPlan(ctx, "status", statusFact);
	state.auditSeq += 1;
	emitPlan(ctx, "audit", {
		id: `work-item-effect-plan-status:${state.auditSeq}`,
		kind: "work-item-effect-plan-status",
		subjectId: status.workItemId,
		message: status.message,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: statusFact.statusId,
			state: status.state,
			planId: status.planId,
			planMemberId: status.planMemberId,
			executionInputRevision: status.executionInputRevision,
			...(status.metadata ?? {}),
		},
	});
}

function emitPlan<T, K extends PlanFact<T>["kind"]>(
	ctx: Ctx,
	kind: K,
	value: Extract<PlanFact<T>, { kind: K }>["value"],
): void {
	ctx.down([["DATA", { kind, value } as PlanFact<T>]]);
}
