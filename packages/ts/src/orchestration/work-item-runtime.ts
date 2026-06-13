import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import {
	type AgentNeed,
	type AgentOutputEnvelope,
	type AgentRuntimeAuditRecord,
	type EffectRun,
	type EffectRunGoal,
	type EffectRunLimits,
	type EffectRunResult,
	type EffectRunResultStatus,
	effectRun,
	type SourceRef,
} from "./agent-runtime.js";

export interface WorkItemSeed {
	readonly kind: "work-item";
	readonly workItemId: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly workItemKind?: string;
	readonly summary?: string;
	readonly detailRef?: string;
	readonly lifecycleStatus?: string;
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectRequested<TInput = unknown> {
	readonly kind: "work-item-effect-requested";
	readonly requestId: string;
	readonly workItemId: string;
	readonly effectRunId: string;
	readonly effectKind: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly goal: EffectRunGoal<TInput>;
	readonly agentRunId?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly limits?: EffectRunLimits;
	readonly createdBy?: string;
	readonly createdAtMs?: number;
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEvidenceRecorded {
	readonly kind: "work-item-evidence-recorded";
	readonly evidenceId: string;
	readonly workItemId: string;
	readonly effectRunId: string;
	readonly effectRunResultId: string;
	readonly status: EffectRunResultStatus;
	readonly sourceRefs?: readonly SourceRef[];
	readonly output?: AgentOutputEnvelope;
	readonly error?: DataIssue;
	readonly needs?: readonly AgentNeed[];
	readonly reason?: string;
	readonly timeoutMs?: number;
	readonly issues?: readonly DataIssue[];
	readonly auditRefs?: readonly string[];
	readonly recordedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectMappingPolicy {
	readonly kind: "work-item-effect-mapping-policy";
	readonly policyId: string;
	readonly effectKinds?: readonly string[];
	readonly evidence?: {
		readonly behavior?: "record";
	};
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemStatusRecord {
	readonly kind: "work-item-status";
	readonly statusId: string;
	readonly workItemId: string;
	readonly state:
		| "effect-request-pending"
		| "effect-run-seeded"
		| "evidence-recorded"
		| "mapping-issue";
	readonly sourceRefs?: readonly SourceRef[];
	readonly effectRunId?: string;
	readonly requestId?: string;
	readonly evidenceId?: string;
	readonly issues?: readonly DataIssue[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkItemEffectRequestViews {
	readonly pendingEffectRequests: readonly WorkItemEffectRequested[];
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface WorkItemEvidenceViews {
	readonly evidenceByWorkItem: ReadonlyMap<string, readonly WorkItemEvidenceRecorded[]>;
	readonly latestEvidenceByEffectRun: ReadonlyMap<string, WorkItemEvidenceRecorded>;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
	readonly pendingEffectRequests: readonly WorkItemEffectRequested[];
}

export interface WorkItemEffectRunBundle {
	readonly effectRuns: Node<EffectRun>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkItemEffectRequestViews>;
}

export interface WorkItemEvidenceMapperBundle {
	readonly evidence: Node<WorkItemEvidenceRecorded>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkItemEvidenceViews>;
}

export function workItemEffectRunProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly workItems: Node<WorkItemSeed>;
		readonly effectRequests: Node<WorkItemEffectRequested>;
	},
): WorkItemEffectRunBundle {
	const name = opts.name ?? "workItemEffectRuns";
	const runtime = graph.node<WorkItemEffectRunFact>(
		[opts.workItems, opts.effectRequests],
		(ctx) => {
			const state = ctx.state.get<WorkItemEffectRunState>() ?? emptyWorkItemEffectRunState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemSeed;
				state.workItems.set(workItem.workItemId, workItem);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const request = raw as WorkItemEffectRequested;
				state.requests.set(request.requestId, request);
				const requestRefs = workItemEffectRequestRefs(request);
				state.statusSeq += 1;
				state.auditSeq += 1;
				ctx.down([
					[
						"DATA",
						{
							kind: "status",
							status: {
								kind: "work-item-status",
								statusId: `${request.workItemId}:effect-request-pending:${state.statusSeq}`,
								workItemId: request.workItemId,
								effectRunId: request.effectRunId,
								requestId: request.requestId,
								state: "effect-request-pending",
								sourceRefs: requestRefs,
								metadata: { effectKind: request.effectKind },
							},
						} satisfies WorkItemEffectRunFact,
					],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${request.workItemId}:effect-request-pending:${state.auditSeq}`,
								kind: "work-item-effect-request-pending",
								subjectId: request.workItemId,
								sourceRefs: requestRefs,
								metadata: { effectRunId: request.effectRunId, effectKind: request.effectKind },
							},
						} satisfies WorkItemEffectRunFact,
					],
				]);
				const workItem = state.workItems.get(request.workItemId);
				if (workItem === undefined) {
					emitWorkItemEffectRunIssue(
						ctx,
						state,
						`unknown-work-item:${request.requestId}`,
						"unknown-work-item-effect-request",
						`WorkItemEffectRequested '${request.requestId}' references unknown WorkItem '${request.workItemId}'`,
						request.workItemId,
						requestRefs,
					);
					continue;
				}
				const existingEffectRunId = state.effectRunsByRequest.get(request.requestId);
				if (existingEffectRunId !== undefined) {
					emitWorkItemEffectRunIssue(
						ctx,
						state,
						`duplicate-effect-request:${request.requestId}`,
						"duplicate-work-item-effect-request",
						`WorkItemEffectRequested '${request.requestId}' was already mapped to EffectRun '${existingEffectRunId}'`,
						request.workItemId,
						requestRefs,
					);
					continue;
				}
				if (state.seededEffectRunIds.has(request.effectRunId)) {
					emitWorkItemEffectRunIssue(
						ctx,
						state,
						`duplicate-effect-run:${request.effectRunId}:${request.requestId}`,
						"duplicate-work-item-effect-run",
						`EffectRun '${request.effectRunId}' was already seeded from another WorkItemEffectRequested fact`,
						request.workItemId,
						requestRefs,
					);
					continue;
				}
				state.effectRunsByRequest.set(request.requestId, request.effectRunId);
				state.seededEffectRunIds.add(request.effectRunId);
				const run = effectRun({
					effectRunId: request.effectRunId,
					agentRunId: request.agentRunId,
					subjectRefs: [ref("work-item", request.workItemId)],
					goal: request.goal,
					sourceRefs: [
						ref("work-item", request.workItemId),
						ref("work-item-effect-request", request.requestId),
						...(request.sourceRefs ?? []),
					],
					policyRefs: request.policyRefs,
					limits: request.limits,
					createdBy: request.createdBy,
					createdAtMs: request.createdAtMs,
					metadata: {
						...(request.metadata ?? {}),
						effectKind: request.effectKind,
						idempotencyKey: request.idempotencyKey,
					},
				});
				state.statusSeq += 1;
				state.auditSeq += 1;
				ctx.down([
					["DATA", { kind: "effect-run", effectRun: run } satisfies WorkItemEffectRunFact],
					[
						"DATA",
						{
							kind: "status",
							status: {
								kind: "work-item-status",
								statusId: `${request.workItemId}:effect-run-seeded:${state.statusSeq}`,
								workItemId: request.workItemId,
								effectRunId: request.effectRunId,
								requestId: request.requestId,
								state: "effect-run-seeded",
								sourceRefs: run.sourceRefs,
							},
						} satisfies WorkItemEffectRunFact,
					],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${request.workItemId}:effect-run-seeded:${state.auditSeq}`,
								kind: "work-item-effect-run-seeded",
								subjectId: request.workItemId,
								sourceRefs: run.sourceRefs,
								metadata: { effectRunId: request.effectRunId, effectKind: request.effectKind },
							},
						} satisfies WorkItemEffectRunFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "workItemEffectRunProjector" },
	);
	return {
		effectRuns: projectRuntimeFact(
			graph,
			runtime,
			`${name}/effectRuns`,
			"workItemEffectRuns",
			(fact) => (fact.kind === "effect-run" ? fact.effectRun : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workItemEffectRunStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workItemEffectRunIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(graph, runtime, `${name}/audit`, "workItemEffectRunAudit", (fact) =>
			fact.kind === "audit" ? fact.audit : undefined,
		),
		views: graph.node<WorkItemEffectRequestViews>(
			[opts.effectRequests, runtime],
			(ctx) => {
				const state = ctx.state.get<WorkItemEffectRunViewsState>() ?? {
					pendingEffectRequests: new Map<string, WorkItemEffectRequested>(),
					settledRequestIds: new Set<string>(),
					issues: [],
					audit: [],
				};
				for (const raw of depBatch(ctx, 0) ?? []) {
					const request = raw as WorkItemEffectRequested;
					if (!state.settledRequestIds.has(request.requestId))
						state.pendingEffectRequests.set(request.requestId, request);
				}
				for (const raw of depBatch(ctx, 1) ?? []) {
					const fact = raw as WorkItemEffectRunFact;
					if (fact.kind === "effect-run") {
						for (const request of state.pendingEffectRequests.values()) {
							if (request.effectRunId === fact.effectRun.effectRunId) {
								state.pendingEffectRequests.delete(request.requestId);
								state.settledRequestIds.add(request.requestId);
								break;
							}
						}
					} else if (fact.kind === "issue") {
						deletePendingWorkItemEffectRequest(state, fact.issue.refs);
						state.issues.push(fact.issue);
					} else if (fact.kind === "audit") state.audit.push(fact.audit);
				}
				ctx.state.set(state);
				ctx.down([["DATA", freezeWorkItemEffectRequestViews(state)]]);
			},
			{ name: `${name}/views`, factory: "workItemEffectRequestViews" },
		),
	};
}

export function workItemEffectResultMapper(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly workItems: Node<WorkItemSeed>;
		readonly effectRuns: Node<EffectRun>;
		readonly effectRunResults: Node<EffectRunResult>;
		readonly effectRequests?: Node<WorkItemEffectRequested>;
		readonly mappingPolicies?: readonly Node<WorkItemEffectMappingPolicy>[];
		readonly now?: () => number;
	},
): WorkItemEvidenceMapperBundle {
	const name = opts.name ?? "workItemEffectResultMapper";
	const policyDeps = opts.mappingPolicies ?? [];
	const deps = [
		opts.workItems,
		opts.effectRuns,
		opts.effectRunResults,
		...(opts.effectRequests === undefined ? [] : [opts.effectRequests]),
		...policyDeps,
	];
	const effectRequestIndex = 3;
	const policyStart = effectRequestIndex + (opts.effectRequests === undefined ? 0 : 1);
	const now = opts.now ?? Date.now;
	const runtime = graph.node<WorkItemEvidenceMapperFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<WorkItemEvidenceState>() ?? emptyWorkItemEvidenceState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const workItem = raw as WorkItemSeed;
				state.workItems.set(workItem.workItemId, workItem);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const run = raw as EffectRun;
				state.effectRuns.set(run.effectRunId, run);
				const workItemRef = singleWorkItemRef([
					...(run.subjectRefs ?? []),
					...(run.sourceRefs ?? []),
				]);
				if (workItemRef !== undefined)
					state.effectRunWorkItems.set(run.effectRunId, workItemRef.id);
			}
			if (opts.effectRequests !== undefined) {
				for (const raw of depBatch(ctx, effectRequestIndex) ?? []) {
					const request = raw as WorkItemEffectRequested;
					state.pendingEffectRequests.set(request.requestId, request);
					const existing = state.requestsByEffectRun.get(request.effectRunId);
					if (existing !== undefined && existing.requestId !== request.requestId) {
						const ambiguous = state.ambiguousRequestsByEffectRun.get(request.effectRunId) ?? [
							existing,
						];
						if (!ambiguous.some((item) => item.requestId === request.requestId))
							ambiguous.push(request);
						state.ambiguousRequestsByEffectRun.set(request.effectRunId, ambiguous);
						emitWorkItemEvidenceIssue(
							ctx,
							state,
							`duplicate-effect-request:${request.effectRunId}:${request.requestId}`,
							"duplicate-work-item-effect-request",
							`EffectRun '${request.effectRunId}' has multiple WorkItemEffectRequested facts`,
							request.workItemId,
							uniqueSourceRefs(ambiguous.flatMap(workItemEffectRequestRefs)),
						);
					} else {
						state.requestsByEffectRun.set(request.effectRunId, request);
					}
				}
			}
			forEachPolicyDepBatch(ctx, policyStart, policyDeps.length, (raw) => {
				const policy = raw as WorkItemEffectMappingPolicy;
				state.policies.set(policy.policyId, policy);
			});
			for (const raw of depBatch(ctx, 2) ?? []) {
				const result = raw as EffectRunResult;
				mapEffectRunResultToWorkItemEvidence(ctx, state, result, now());
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "workItemEffectResultMapper" },
	);
	return {
		evidence: projectRuntimeFact(
			graph,
			runtime,
			`${name}/evidence`,
			"workItemEvidenceRecorded",
			(fact) => (fact.kind === "evidence" ? fact.evidence : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workItemEvidenceStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workItemEvidenceIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(graph, runtime, `${name}/audit`, "workItemEvidenceAudit", (fact) =>
			fact.kind === "audit" ? fact.audit : undefined,
		),
		views: graph.node<WorkItemEvidenceViews>(
			[...(opts.effectRequests === undefined ? [] : [opts.effectRequests]), runtime],
			(ctx) => {
				const state = ctx.state.get<WorkItemEvidenceViewsState>() ?? {
					evidenceByWorkItem: new Map<string, WorkItemEvidenceRecorded[]>(),
					latestEvidenceByEffectRun: new Map<string, WorkItemEvidenceRecorded>(),
					pendingEffectRequests: new Map<string, WorkItemEffectRequested>(),
					settledEffectRunIds: new Set<string>(),
					settledRequestIds: new Set<string>(),
					issues: [],
					audit: [],
				};
				if (opts.effectRequests !== undefined) {
					for (const raw of depBatch(ctx, 0) ?? []) {
						const request = raw as WorkItemEffectRequested;
						if (
							!state.settledRequestIds.has(request.requestId) &&
							!state.settledEffectRunIds.has(request.effectRunId)
						)
							state.pendingEffectRequests.set(request.requestId, request);
					}
				}
				const runtimeIndex = opts.effectRequests === undefined ? 0 : 1;
				for (const raw of depBatch(ctx, runtimeIndex) ?? []) {
					const fact = raw as WorkItemEvidenceMapperFact;
					if (fact.kind === "evidence") {
						const evidence = fact.evidence;
						const byWorkItem = state.evidenceByWorkItem.get(evidence.workItemId) ?? [];
						byWorkItem.push(evidence);
						state.evidenceByWorkItem.set(evidence.workItemId, byWorkItem);
						state.latestEvidenceByEffectRun.set(evidence.effectRunId, evidence);
						for (const request of state.pendingEffectRequests.values()) {
							if (request.effectRunId === evidence.effectRunId) {
								state.pendingEffectRequests.delete(request.requestId);
								state.settledRequestIds.add(request.requestId);
							}
						}
						state.settledEffectRunIds.add(evidence.effectRunId);
					} else if (fact.kind === "issue") {
						deletePendingWorkItemEffectRequest(state, fact.issue.refs);
						state.issues.push(fact.issue);
					} else if (fact.kind === "audit") state.audit.push(fact.audit);
				}
				ctx.state.set(state);
				ctx.down([["DATA", freezeWorkItemEvidenceViews(state)]]);
			},
			{ name: `${name}/views`, factory: "workItemEvidenceViews" },
		),
	};
}

type WorkItemEffectRunFact =
	| { readonly kind: "effect-run"; readonly effectRun: EffectRun }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

type WorkItemEvidenceMapperFact =
	| { readonly kind: "evidence"; readonly evidence: WorkItemEvidenceRecorded }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface WorkItemEffectRunState {
	workItems: Map<string, WorkItemSeed>;
	requests: Map<string, WorkItemEffectRequested>;
	effectRunsByRequest: Map<string, string>;
	seededEffectRunIds: Set<string>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	issueKeys: Set<string>;
	statusSeq: number;
	issueSeq: number;
	auditSeq: number;
}

interface WorkItemEvidenceState {
	workItems: Map<string, WorkItemSeed>;
	effectRuns: Map<string, EffectRun>;
	effectRunWorkItems: Map<string, string>;
	evidenceByWorkItem: Map<string, WorkItemEvidenceRecorded[]>;
	latestEvidenceByEffectRun: Map<string, WorkItemEvidenceRecorded>;
	pendingEffectRequests: Map<string, WorkItemEffectRequested>;
	requestsByEffectRun: Map<string, WorkItemEffectRequested>;
	ambiguousRequestsByEffectRun: Map<string, WorkItemEffectRequested[]>;
	policies: Map<string, WorkItemEffectMappingPolicy>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	issueKeys: Set<string>;
	statusSeq: number;
	issueSeq: number;
	auditSeq: number;
}

interface WorkItemEffectRunViewsState {
	pendingEffectRequests: Map<string, WorkItemEffectRequested>;
	settledRequestIds: Set<string>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

interface WorkItemEvidenceViewsState {
	evidenceByWorkItem: Map<string, WorkItemEvidenceRecorded[]>;
	latestEvidenceByEffectRun: Map<string, WorkItemEvidenceRecorded>;
	pendingEffectRequests: Map<string, WorkItemEffectRequested>;
	settledEffectRunIds: Set<string>;
	settledRequestIds: Set<string>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

interface WorkItemMappingPolicyContext {
	readonly policyRefs: readonly SourceRef[];
	readonly effectKind?: string;
}

function mapEffectRunResultToWorkItemEvidence(
	ctx: Ctx,
	state: WorkItemEvidenceState,
	result: EffectRunResult,
	recordedAtMs: number,
): void {
	const run = state.effectRuns.get(result.effectRunId);
	if (run === undefined) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`unknown-effect-run:${result.resultId}`,
			"unknown-effect-run-result",
			`EffectRunResult '${result.resultId}' references unknown EffectRun '${result.effectRunId}'`,
			result.effectRunId,
			result.sourceRefs,
		);
		return;
	}
	const staleEffectRunRef = (result.sourceRefs ?? []).find(
		(sourceRef) => sourceRef.kind === "effect-run" && sourceRef.id !== result.effectRunId,
	);
	if (staleEffectRunRef !== undefined) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`stale-effect-run-ref:${result.resultId}`,
			"stale-effect-run-source-ref",
			`EffectRunResult '${result.resultId}' carries a stale EffectRun source ref '${staleEffectRunRef.id}'`,
			result.effectRunId,
			result.sourceRefs,
		);
		return;
	}
	const runWorkItemRef = singleWorkItemRef([...(run.subjectRefs ?? []), ...(run.sourceRefs ?? [])]);
	const resultWorkItemRefs = distinctWorkItemRefs([
		...(result.subjectRefs ?? []),
		...(result.sourceRefs ?? []),
	]);
	if (resultWorkItemRefs.length > 1) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`ambiguous-work-item-ref:${result.resultId}`,
			"stale-work-item-source-ref",
			`EffectRunResult '${result.resultId}' carries multiple WorkItem refs`,
			resultWorkItemRefs[0]?.id,
			workItemResultRefs(result),
		);
		return;
	}
	const resultWorkItemRef = resultWorkItemRefs[0];
	if (
		runWorkItemRef !== undefined &&
		resultWorkItemRef !== undefined &&
		runWorkItemRef.id !== resultWorkItemRef.id
	) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`stale-work-item-ref:${result.resultId}`,
			"stale-work-item-source-ref",
			`EffectRunResult '${result.resultId}' WorkItem ref '${resultWorkItemRef.id}' does not match EffectRun '${result.effectRunId}'`,
			resultWorkItemRef.id,
			workItemResultRefs(result),
		);
		return;
	}
	const workItemId =
		resultWorkItemRef?.id ?? runWorkItemRef?.id ?? state.effectRunWorkItems.get(result.effectRunId);
	if (workItemId === undefined) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`missing-work-item-ref:${result.resultId}`,
			"missing-work-item-source-ref",
			`EffectRunResult '${result.resultId}' cannot be mapped without a WorkItem source ref`,
			result.effectRunId,
			workItemResultRefs(result),
		);
		return;
	}
	if (!state.workItems.has(workItemId)) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`unknown-work-item:${result.resultId}`,
			"unknown-work-item-evidence-target",
			`EffectRunResult '${result.resultId}' references unseeded WorkItem '${workItemId}'`,
			workItemId,
			workItemResultRefs(result),
		);
		return;
	}
	const request = state.requestsByEffectRun.get(result.effectRunId);
	const ambiguousRequests = state.ambiguousRequestsByEffectRun.get(result.effectRunId);
	if (ambiguousRequests !== undefined) {
		const refs = uniqueSourceRefs([
			...workItemResultRefs(result),
			...ambiguousRequests.flatMap(workItemEffectRequestRefs),
		]);
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`ambiguous-effect-request:${result.effectRunId}:${result.resultId}`,
			"duplicate-work-item-effect-request",
			`EffectRun '${result.effectRunId}' has ambiguous WorkItemEffectRequested facts`,
			workItemId,
			refs,
		);
		clearPendingWorkItemEffectRequestsForRun(state, result.effectRunId);
		return;
	}
	const policyIssue = workItemMappingPolicyIssue(state, request, run);
	if (policyIssue !== undefined) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`${policyIssue.code}:${result.resultId}`,
			policyIssue.code,
			policyIssue.message,
			workItemId,
			workItemMappingPolicyIssueRefs(result, run, request),
		);
		clearPendingWorkItemEffectRequestsForRun(state, result.effectRunId);
		return;
	}
	if (state.latestEvidenceByEffectRun.has(result.effectRunId)) {
		emitWorkItemEvidenceIssue(
			ctx,
			state,
			`duplicate-evidence:${result.effectRunId}:${result.resultId}`,
			"duplicate-work-item-evidence",
			`EffectRun '${result.effectRunId}' already recorded WorkItem evidence`,
			workItemId,
			workItemResultRefs(result),
		);
		return;
	}
	const evidence = workItemEvidenceFromResult(result, run, workItemId, recordedAtMs);
	const byWorkItem = state.evidenceByWorkItem.get(workItemId) ?? [];
	byWorkItem.push(evidence);
	state.evidenceByWorkItem.set(workItemId, byWorkItem);
	state.latestEvidenceByEffectRun.set(result.effectRunId, evidence);
	clearPendingWorkItemEffectRequestsForRun(state, result.effectRunId);
	state.statusSeq += 1;
	state.auditSeq += 1;
	const refs = evidence.sourceRefs;
	const status: WorkItemStatusRecord = {
		kind: "work-item-status",
		statusId: `${workItemId}:evidence-recorded:${state.statusSeq}`,
		workItemId,
		state: "evidence-recorded",
		sourceRefs: refs,
		effectRunId: result.effectRunId,
		evidenceId: evidence.evidenceId,
		issues: result.issues,
		metadata: { resultStatus: result.status },
	};
	const audit: AgentRuntimeAuditRecord = {
		id: `${workItemId}:evidence-recorded:${state.auditSeq}`,
		kind: "work-item-evidence-recorded",
		subjectId: workItemId,
		sourceRefs: refs,
		metadata: {
			effectRunId: result.effectRunId,
			effectRunResultId: result.resultId,
			resultStatus: result.status,
		},
	};
	state.audit.push(audit);
	ctx.down([
		["DATA", { kind: "evidence", evidence } satisfies WorkItemEvidenceMapperFact],
		["DATA", { kind: "status", status } satisfies WorkItemEvidenceMapperFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemEvidenceMapperFact],
	]);
}

function workItemEvidenceFromResult(
	result: EffectRunResult,
	run: EffectRun,
	workItemId: string,
	recordedAtMs: number,
): WorkItemEvidenceRecorded {
	const base = {
		kind: "work-item-evidence-recorded",
		evidenceId: `${workItemId}:${result.effectRunId}:${result.resultId}`,
		workItemId,
		effectRunId: result.effectRunId,
		effectRunResultId: result.resultId,
		status: result.status,
		sourceRefs: uniqueSourceRefs([
			ref("work-item", workItemId),
			ref("effect-run", result.effectRunId),
			ref("effect-run-result", result.resultId),
			...(run.sourceRefs ?? []),
			...(run.subjectRefs ?? []),
			...(result.sourceRefs ?? []),
			...(result.subjectRefs ?? []),
		]),
		issues: result.issues,
		auditRefs: result.auditRefs,
		recordedAtMs,
		metadata: result.metadata,
	} satisfies Omit<WorkItemEvidenceRecorded, "output" | "error" | "needs" | "reason" | "timeoutMs">;
	if (result.status === "completed") return { ...base, output: result.output };
	if (result.status === "failed") return { ...base, error: result.error };
	if (result.status === "blocked") return { ...base, needs: result.needs };
	if (result.status === "timeout") return { ...base, timeoutMs: result.timeoutMs };
	if (result.status === "canceled" || result.status === "waived")
		return { ...base, reason: result.reason };
	return base;
}

function workItemMappingPolicyIssue(
	state: WorkItemEvidenceState,
	request: WorkItemEffectRequested | undefined,
	run: EffectRun,
): { readonly code: string; readonly message: string } | undefined {
	const context = workItemMappingPolicyContext(request, run);
	const referencedPolicyIds = context.policyRefs
		.filter((sourceRef) => sourceRef.kind === "work-item-effect-mapping-policy")
		.map((sourceRef) => sourceRef.id);
	for (const policyId of referencedPolicyIds) {
		const policy = state.policies.get(policyId);
		if (policy === undefined) {
			return {
				code: "missing-work-item-effect-mapping-policy",
				message: `WorkItemEffectMappingPolicy '${policyId}' was required but not present`,
			};
		}
		const issue = validateWorkItemMappingPolicy(policy, context.effectKind);
		if (issue !== undefined) return issue;
	}
	return undefined;
}

function validateWorkItemMappingPolicy(
	policy: WorkItemEffectMappingPolicy,
	effectKind: string | undefined,
): { readonly code: string; readonly message: string } | undefined {
	if (!policyAppliesToRequest(policy, effectKind)) {
		return {
			code: "work-item-effect-mapping-policy-mismatch",
			message: `WorkItemEffectMappingPolicy '${policy.policyId}' does not apply to effectKind '${effectKind ?? "unknown"}'`,
		};
	}
	const behavior = policy.evidence?.behavior ?? "record";
	if (behavior !== "record") {
		return {
			code: "unsupported-work-item-evidence-behavior",
			message: `WorkItemEffectMappingPolicy '${policy.policyId}' uses unsupported evidence behavior '${behavior}'`,
		};
	}
	return undefined;
}

function policyAppliesToRequest(
	policy: WorkItemEffectMappingPolicy,
	effectKind: string | undefined,
): boolean {
	return (
		policy.effectKinds === undefined ||
		(effectKind !== undefined && policy.effectKinds.includes(effectKind))
	);
}

function workItemMappingPolicyContext(
	request: WorkItemEffectRequested | undefined,
	run: EffectRun,
): WorkItemMappingPolicyContext {
	return {
		policyRefs: request?.policyRefs ?? run.policyRefs ?? [],
		effectKind: request?.effectKind ?? effectKindFromRun(run),
	};
}

function effectKindFromRun(run: EffectRun): string | undefined {
	const effectKind = run.metadata?.effectKind;
	return typeof effectKind === "string" ? effectKind : undefined;
}

function workItemMappingPolicyIssueRefs(
	result: EffectRunResult,
	run: EffectRun,
	request: WorkItemEffectRequested | undefined,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		...workItemResultRefs(result),
		...(request === undefined
			? [...(run.sourceRefs ?? []), ...(run.subjectRefs ?? []), ...(run.policyRefs ?? [])]
			: workItemEffectRequestRefs(request)),
	]);
}

function clearPendingWorkItemEffectRequestsForRun(
	state: Pick<WorkItemEvidenceState, "pendingEffectRequests">,
	effectRunId: string,
): void {
	for (const pendingRequest of state.pendingEffectRequests.values()) {
		if (pendingRequest.effectRunId === effectRunId)
			state.pendingEffectRequests.delete(pendingRequest.requestId);
	}
}

function emitWorkItemEffectRunIssue(
	ctx: Ctx,
	state: WorkItemEffectRunState,
	key: string,
	code: string,
	message: string,
	subjectId?: string,
	sourceRefs?: readonly SourceRef[],
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	state.issueSeq += 1;
	state.statusSeq += 1;
	state.auditSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs: sourceRefs });
	const status: WorkItemStatusRecord = {
		kind: "work-item-status",
		statusId: `${subjectId ?? "work-item"}:mapping-issue:${state.statusSeq}`,
		workItemId: subjectId ?? "unknown",
		state: "mapping-issue",
		sourceRefs,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: `${subjectId ?? "work-item"}:${code}:${state.auditSeq}`,
		kind: "work-item-effect-run-issue",
		subjectId,
		issueCode: code,
		message,
		sourceRefs,
	};
	state.issues.push(issue);
	state.audit.push(audit);
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies WorkItemEffectRunFact],
		["DATA", { kind: "status", status } satisfies WorkItemEffectRunFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemEffectRunFact],
	]);
}

function emitWorkItemEvidenceIssue(
	ctx: Ctx,
	state: WorkItemEvidenceState,
	key: string,
	code: string,
	message: string,
	subjectId?: string,
	sourceRefs?: readonly SourceRef[],
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	state.issueSeq += 1;
	state.statusSeq += 1;
	state.auditSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs: sourceRefs });
	const status: WorkItemStatusRecord = {
		kind: "work-item-status",
		statusId: `${subjectId ?? "work-item"}:mapping-issue:${state.statusSeq}`,
		workItemId: subjectId ?? "unknown",
		state: "mapping-issue",
		sourceRefs,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: `${subjectId ?? "work-item"}:${code}:${state.auditSeq}`,
		kind: "work-item-evidence-mapping-issue",
		subjectId,
		issueCode: code,
		message,
		sourceRefs,
	};
	state.issues.push(issue);
	state.audit.push(audit);
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies WorkItemEvidenceMapperFact],
		["DATA", { kind: "status", status } satisfies WorkItemEvidenceMapperFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemEvidenceMapperFact],
	]);
}

function emptyWorkItemEffectRunState(): WorkItemEffectRunState {
	return {
		workItems: new Map<string, WorkItemSeed>(),
		requests: new Map<string, WorkItemEffectRequested>(),
		effectRunsByRequest: new Map<string, string>(),
		seededEffectRunIds: new Set<string>(),
		issues: [],
		audit: [],
		issueKeys: new Set<string>(),
		statusSeq: 0,
		issueSeq: 0,
		auditSeq: 0,
	};
}

function emptyWorkItemEvidenceState(): WorkItemEvidenceState {
	return {
		workItems: new Map<string, WorkItemSeed>(),
		effectRuns: new Map<string, EffectRun>(),
		effectRunWorkItems: new Map<string, string>(),
		evidenceByWorkItem: new Map<string, WorkItemEvidenceRecorded[]>(),
		latestEvidenceByEffectRun: new Map<string, WorkItemEvidenceRecorded>(),
		pendingEffectRequests: new Map<string, WorkItemEffectRequested>(),
		requestsByEffectRun: new Map<string, WorkItemEffectRequested>(),
		ambiguousRequestsByEffectRun: new Map<string, WorkItemEffectRequested[]>(),
		policies: new Map<string, WorkItemEffectMappingPolicy>(),
		issues: [],
		audit: [],
		issueKeys: new Set<string>(),
		statusSeq: 0,
		issueSeq: 0,
		auditSeq: 0,
	};
}

function freezeWorkItemEffectRequestViews(
	state: WorkItemEffectRunViewsState,
): WorkItemEffectRequestViews {
	return {
		pendingEffectRequests: Object.freeze(Array.from(state.pendingEffectRequests.values())),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

function freezeWorkItemEvidenceViews(state: WorkItemEvidenceViewsState): WorkItemEvidenceViews {
	return {
		evidenceByWorkItem: new Map(
			Array.from(state.evidenceByWorkItem, ([key, value]) => [key, Object.freeze([...value])]),
		),
		latestEvidenceByEffectRun: new Map(state.latestEvidenceByEffectRun),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
		pendingEffectRequests: Object.freeze(Array.from(state.pendingEffectRequests.values())),
	};
}

function deletePendingWorkItemEffectRequest(
	state: Pick<
		WorkItemEffectRunViewsState | WorkItemEvidenceViewsState,
		"pendingEffectRequests" | "settledRequestIds"
	>,
	refs: readonly string[] | undefined,
): void {
	for (const requestRef of refs?.filter((value) => value.startsWith("work-item-effect-request:")) ??
		[]) {
		const requestId = requestRef.slice("work-item-effect-request:".length);
		state.pendingEffectRequests.delete(requestId);
		state.settledRequestIds.add(requestId);
	}
}

function workItemEffectRequestRefs(request: WorkItemEffectRequested): readonly SourceRef[] {
	return [
		ref("work-item", request.workItemId),
		ref("work-item-effect-request", request.requestId),
		...(request.sourceRefs ?? []),
	];
}

function workItemResultRefs(result: EffectRunResult): readonly SourceRef[] {
	return [
		ref("effect-run", result.effectRunId),
		ref("effect-run-result", result.resultId),
		...(result.sourceRefs ?? []),
		...(result.subjectRefs ?? []),
	];
}

function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const unique: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = sourceRefKey(sourceRef);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(sourceRef);
	}
	return unique;
}

function sourceRefKey(sourceRef: SourceRef): string {
	return `${sourceRef.kind}:${sourceRef.id}:${JSON.stringify(sourceRef.metadata ?? {})}`;
}

function distinctWorkItemRefs(sourceRefs: readonly SourceRef[] | undefined): readonly SourceRef[] {
	const refs = new Map<string, SourceRef>();
	for (const sourceRef of sourceRefs ?? []) {
		if (sourceRef.kind === "work-item") refs.set(sourceRef.id, sourceRef);
	}
	return Array.from(refs.values());
}

function singleWorkItemRef(sourceRefs: readonly SourceRef[] | undefined): SourceRef | undefined {
	const matches = distinctWorkItemRefs(sourceRefs);
	return matches.length === 1 ? matches[0] : undefined;
}

function projectRuntimeFact<T, TOut>(
	graph: Graph,
	runtime: Node<T>,
	name: string,
	factory: string,
	pick: (fact: T) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as T;
				const value = pick(typed);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory },
	);
}

function forEachPolicyDepBatch(
	ctx: Ctx,
	start: number,
	count: number,
	fn: (value: unknown) => void,
): void {
	for (let i = 0; i < count; i += 1) {
		for (const value of depBatch(ctx, start + i) ?? []) fn(value);
	}
}

function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly severity?: DataIssue["severity"];
		readonly details?: unknown;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: opts.severity ?? "error",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((r) => `${r.kind}:${r.id}`),
		details: opts.details,
	};
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}
