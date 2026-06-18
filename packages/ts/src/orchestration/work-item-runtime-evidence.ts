import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type {
	AgentNeed,
	AgentOutputEnvelope,
	AgentRuntimeAuditRecord,
	EffectRun,
	EffectRunResult,
	SourceRef,
} from "./agent-runtime.js";
import {
	boundPublicText,
	canonicalPublicSourceRefs,
	cloneGraphVisibleMaterial,
	oversizedInlineTextKeys,
	publicMaterialForbiddenKeys,
	sanitizePublicRecordWithEvidence,
} from "./agent-runtime-common.js";
import {
	deletePendingWorkItemEffectRequest,
	distinctWorkItemRefs,
	emitWorkItemEvidenceIssue,
	emptyWorkItemEvidenceState,
	forEachPolicyDepBatch,
	freezeWorkItemEvidenceViews,
	policyAppliesToRequest,
	projectRuntimeFact,
	ref,
	singleWorkItemRef,
	uniqueSourceRefs,
	workItemEffectRequestRefs,
	workItemResultRefs,
} from "./work-item-runtime-shared.js";
import type {
	WorkItemEffectMappingPolicy,
	WorkItemEffectRequested,
	WorkItemEvidenceMapperBundle,
	WorkItemEvidenceMapperFact,
	WorkItemEvidenceRecorded,
	WorkItemEvidenceState,
	WorkItemEvidenceViews,
	WorkItemEvidenceViewsState,
	WorkItemMappingPolicyContext,
	WorkItemSeed,
	WorkItemStatusRecord,
} from "./work-item-runtime-types.js";

const WORK_ITEM_EVIDENCE_INLINE_TEXT_LIMIT_CHARS = 512;

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
	const evidence = workItemEvidenceFromResult(result, run, workItemId, request, recordedAtMs);
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
	request: WorkItemEffectRequested | undefined,
	recordedAtMs: number,
): WorkItemEvidenceRecorded {
	const materialIssues: DataIssue[] = [];
	const base = {
		kind: "work-item-evidence-recorded",
		evidenceId: `${workItemId}:${result.effectRunId}:${result.resultId}`,
		workItemId,
		requestId: request?.requestId,
		effectRunId: result.effectRunId,
		effectRunResultId: result.resultId,
		executionInputRevision: request?.executionInputRevision,
		planId: request?.planId,
		planMemberId: request?.planMemberId,
		status: result.status,
		sourceRefs: canonicalPublicSourceRefs(
			uniqueSourceRefs([
				ref("work-item", workItemId),
				ref("effect-run", result.effectRunId),
				ref("effect-run-result", result.resultId),
				...(run.sourceRefs ?? []),
				...(run.subjectRefs ?? []),
				...(run.policyRefs ?? []),
				...(result.sourceRefs ?? []),
				...(result.subjectRefs ?? []),
			]),
		),
		issues: sanitizeEvidenceIssues(result.issues, result, materialIssues),
		auditRefs: cloneStringArray(result.auditRefs),
		recordedAtMs,
		metadata: sanitizeEvidenceMetadata(
			{
				...(result.metadata ?? {}),
				...(request?.requestId === undefined ? {} : { requestId: request.requestId }),
				...(request?.executionInputRevision === undefined
					? {}
					: { executionInputRevision: request.executionInputRevision }),
				...(request?.planId === undefined ? {} : { planId: request.planId }),
				...(request?.planMemberId === undefined ? {} : { planMemberId: request.planMemberId }),
			},
			result,
			materialIssues,
		),
	} satisfies Omit<WorkItemEvidenceRecorded, "output" | "error" | "needs" | "reason" | "timeoutMs">;
	const finalize = (
		evidence: Omit<WorkItemEvidenceRecorded, "issues"> & {
			readonly issues?: readonly DataIssue[];
		},
	): WorkItemEvidenceRecorded => ({
		...evidence,
		issues: Object.freeze([...(evidence.issues ?? []), ...materialIssues]),
	});
	if (result.status === "completed") {
		const output = sanitizeEvidenceOutput(result.output, result, materialIssues);
		return finalize({ ...base, output });
	}
	if (result.status === "failed") {
		const error = sanitizeEvidenceIssue(result.error, result, materialIssues);
		return finalize({ ...base, error });
	}
	if (result.status === "blocked") {
		const needs = result.needs.map((need) => sanitizeEvidenceNeed(need, result, materialIssues));
		return {
			...finalize({ ...base, needs }),
		};
	}
	if (result.status === "timeout") return finalize({ ...base, timeoutMs: result.timeoutMs });
	if (result.status === "canceled" || result.status === "waived")
		return finalize({
			...base,
			reason: result.reason === undefined ? undefined : boundPublicText(result.reason, 280).text,
		});
	return finalize(base);
}

function sanitizeEvidenceOutput(
	output: AgentOutputEnvelope,
	result: EffectRunResult,
	issues: DataIssue[],
): AgentOutputEnvelope {
	const value = sanitizeEvidenceValue(output.value, result, "output.value", issues);
	const metadata = sanitizeEvidenceMetadata(output.metadata, result, issues);
	return Object.freeze({
		kind: output.kind,
		value,
		refs: output.refs === undefined ? undefined : canonicalPublicSourceRefs(output.refs),
		summary: output.summary === undefined ? undefined : boundPublicText(output.summary, 280).text,
		metadata,
	} satisfies AgentOutputEnvelope);
}

function sanitizeEvidenceNeed(
	need: AgentNeed,
	result: EffectRunResult,
	issues: DataIssue[],
): AgentNeed {
	return Object.freeze({
		kind: need.kind,
		message: need.message === undefined ? undefined : boundPublicText(need.message, 280).text,
		refs: need.refs === undefined ? undefined : canonicalPublicSourceRefs(need.refs),
		metadata: sanitizeEvidenceMetadata(need.metadata, result, issues),
	} satisfies AgentNeed);
}

function sanitizeEvidenceIssues(
	input: readonly DataIssue[] | undefined,
	result: EffectRunResult,
	issues: DataIssue[],
): readonly DataIssue[] | undefined {
	if (input === undefined) return undefined;
	return Object.freeze(input.map((issue) => sanitizeEvidenceIssue(issue, result, issues)));
}

function sanitizeEvidenceIssue(
	issue: DataIssue,
	result: EffectRunResult,
	issues: DataIssue[],
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code: issue.code,
		message: boundPublicText(issue.message, 280).text,
		severity: issue.severity,
		source: issue.source,
		subjectId: issue.subjectId,
		correlationId: issue.correlationId,
		causationId: issue.causationId,
		path: clonePathArray(issue.path),
		refs: cloneStringArray(issue.refs),
		retryable: issue.retryable,
		details: sanitizeEvidenceValue(issue.details, result, "issue.details", issues),
		metadata: sanitizeEvidenceMetadata(issue.metadata, result, issues),
	} satisfies DataIssue);
}

function sanitizeEvidenceMetadata(
	metadata: Record<string, unknown> | undefined,
	result: EffectRunResult,
	issues: DataIssue[],
): Record<string, unknown> | undefined {
	if (metadata === undefined) return undefined;
	const sanitized = sanitizePublicRecordWithEvidence(metadata, { mode: "provider" });
	if (sanitized === undefined) {
		issues.push(redactedEvidenceMaterialIssue(result, "metadata", "forbidden-runtime-material"));
		return undefined;
	}
	for (const entry of sanitized.truncated) {
		issues.push(
			redactedEvidenceMaterialIssue(result, `metadata.${entry.path.join(".")}`, "text-truncated"),
		);
	}
	return Object.freeze(sanitized.value);
}

function sanitizeEvidenceValue(
	value: unknown,
	result: EffectRunResult,
	area: string,
	issues: DataIssue[],
): unknown {
	if (value === undefined) return undefined;
	const forbidden = [
		...publicMaterialForbiddenKeys(value, "provider"),
		...oversizedInlineTextKeys(value, WORK_ITEM_EVIDENCE_INLINE_TEXT_LIMIT_CHARS),
	];
	if (forbidden.length > 0) {
		const entry = forbidden[0];
		issues.push(
			redactedEvidenceMaterialIssue(
				result,
				formatEvidenceMaterialArea(area, entry?.path ?? []),
				entry?.reason ?? "forbidden",
			),
		);
		return undefined;
	}
	return cloneGraphVisibleMaterial(value);
}

function cloneStringArray(input: readonly string[] | undefined): readonly string[] | undefined {
	if (input === undefined) return undefined;
	return Object.freeze([...input]);
}

function clonePathArray(
	input: readonly (string | number)[] | undefined,
): readonly (string | number)[] | undefined {
	if (input === undefined) return undefined;
	return Object.freeze([...input]);
}

function formatEvidenceMaterialArea(area: string, path: readonly (string | number)[]): string {
	if (path.length === 0) return area;
	return `${area}.${path.map((entry) => String(entry)).join(".")}`;
}

function redactedEvidenceMaterialIssue(
	result: EffectRunResult,
	area: string,
	reason: string,
): DataIssue {
	return Object.freeze({
		kind: "issue",
		code: "work-item-evidence-public-material-redacted",
		message:
			"WorkItem evidence material was omitted because it was not bounded public graph material.",
		severity: "warning",
		subjectId: result.effectRunId,
		refs: [`effect-run-result:${result.resultId}`],
		details: { area, reason },
	} satisfies DataIssue);
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
