import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey, parseCanonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type { AgentRuntimeAuditRecord, EffectRunResult, SourceRef } from "./agent-runtime.js";
import type {
	WorkItemDomainActionAdmission,
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionAdmissionFact,
	WorkItemDomainActionAdmissionPolicy,
	WorkItemDomainActionAdmissionStateInternal,
	WorkItemDomainActionAdmissionViews,
	WorkItemDomainActionAdmissionViewsState,
	WorkItemDomainActionProposal,
	WorkItemDomainActionProposalFact,
	WorkItemDomainActionProposalSpec,
	WorkItemDomainActionProposalState,
	WorkItemDomainActionProposalViews,
	WorkItemDomainActionProposalViewsState,
	WorkItemEffectMappingPolicy,
	WorkItemEffectRequested,
	WorkItemEffectRequestViews,
	WorkItemEffectRunFact,
	WorkItemEffectRunState,
	WorkItemEffectRunViewsState,
	WorkItemEvidenceMapperFact,
	WorkItemEvidenceRecorded,
	WorkItemEvidenceState,
	WorkItemEvidenceViews,
	WorkItemEvidenceViewsState,
	WorkItemSeed,
	WorkItemStatusRecord,
} from "./work-item-runtime-types.js";

export function policyAppliesToRequest(
	policy: WorkItemEffectMappingPolicy,
	effectKind: string | undefined,
): boolean {
	return (
		policy.effectKinds === undefined ||
		(effectKind !== undefined && policy.effectKinds.includes(effectKind))
	);
}

export function emitWorkItemEffectRunIssue(
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
		statusId: compoundTupleKey("work-item-mapping-issue", [
			subjectId ?? "work-item",
			String(state.statusSeq),
		]),
		workItemId: subjectId ?? "unknown",
		state: "mapping-issue",
		sourceRefs,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: compoundTupleKey("work-item-effect-run-issue-audit", [
			subjectId ?? "work-item",
			code,
			String(state.auditSeq),
		]),
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

export function emitWorkItemEvidenceIssue(
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
		statusId: compoundTupleKey("work-item-mapping-issue", [
			subjectId ?? "work-item",
			String(state.statusSeq),
		]),
		workItemId: subjectId ?? "unknown",
		state: "mapping-issue",
		sourceRefs,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: compoundTupleKey("work-item-evidence-mapping-issue-audit", [
			subjectId ?? "work-item",
			code,
			String(state.auditSeq),
		]),
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

export function emitWorkItemActionProposalIssue(
	ctx: Ctx,
	state: WorkItemDomainActionProposalState,
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
		statusId: compoundTupleKey("work-item-mapping-issue", [
			subjectId ?? "work-item",
			String(state.statusSeq),
		]),
		workItemId: subjectId ?? "unknown",
		state: "mapping-issue",
		sourceRefs,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: compoundTupleKey("work-item-action-proposal-issue-audit", [
			subjectId ?? "work-item",
			code,
			String(state.auditSeq),
		]),
		kind: "work-item-action-proposal-issue",
		subjectId,
		issueCode: code,
		message,
		sourceRefs,
	};
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies WorkItemDomainActionProposalFact],
		["DATA", { kind: "status", status } satisfies WorkItemDomainActionProposalFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemDomainActionProposalFact],
	]);
}

export function emitWorkItemAdmissionIssue(
	ctx: Ctx,
	state: WorkItemDomainActionAdmissionStateInternal,
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
		statusId: compoundTupleKey("work-item-mapping-issue", [
			subjectId ?? "work-item",
			String(state.statusSeq),
		]),
		workItemId: subjectId ?? "unknown",
		state: "mapping-issue",
		sourceRefs,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: compoundTupleKey("work-item-domain-action-admission-issue-audit", [
			subjectId ?? "work-item",
			code,
			String(state.auditSeq),
		]),
		kind: "work-item-domain-action-admission-issue",
		subjectId,
		issueCode: code,
		message,
		sourceRefs,
	};
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies WorkItemDomainActionAdmissionFact],
		["DATA", { kind: "status", status } satisfies WorkItemDomainActionAdmissionFact],
		["DATA", { kind: "audit", audit } satisfies WorkItemDomainActionAdmissionFact],
	]);
}

export function emptyWorkItemEffectRunState(): WorkItemEffectRunState {
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

export function emptyWorkItemEvidenceState(): WorkItemEvidenceState {
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

export function emptyWorkItemDomainActionProposalState(): WorkItemDomainActionProposalState {
	return {
		workItems: new Map<string, WorkItemSeed>(),
		evidence: new Map<string, WorkItemEvidenceRecorded>(),
		results: new Map<string, EffectRunResult>(),
		policies: new Map<string, WorkItemEffectMappingPolicy>(),
		proposedKeys: new Set<string>(),
		issueKeys: new Set<string>(),
		statusSeq: 0,
		issueSeq: 0,
		auditSeq: 0,
	};
}

export function emptyWorkItemDomainActionAdmissionState(): WorkItemDomainActionAdmissionStateInternal {
	return {
		proposals: new Map<string, WorkItemDomainActionProposal>(),
		policies: new Map<string, WorkItemDomainActionAdmissionPolicy>(),
		decisions: new Map<string, WorkItemDomainActionAdmissionDecision>(),
		admissionsById: new Map<string, WorkItemDomainActionAdmission>(),
		admissionsByProposal: new Map<string, WorkItemDomainActionAdmission>(),
		terminalDecisionIds: new Set<string>(),
		issueKeys: new Set<string>(),
		statusSeq: 0,
		issueSeq: 0,
		auditSeq: 0,
	};
}

export function freezeWorkItemEffectRequestViews(
	state: WorkItemEffectRunViewsState,
): WorkItemEffectRequestViews {
	return {
		pendingEffectRequests: Object.freeze(Array.from(state.pendingEffectRequests.values())),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

export function freezeWorkItemEvidenceViews(
	state: WorkItemEvidenceViewsState,
): WorkItemEvidenceViews {
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

export function freezeWorkItemDomainActionProposalViews(
	state: WorkItemDomainActionProposalViewsState,
): WorkItemDomainActionProposalViews {
	return {
		proposalsByWorkItem: new Map(
			Array.from(state.proposalsByWorkItem, ([key, value]) => [key, Object.freeze([...value])]),
		),
		proposalsByEvidence: new Map(
			Array.from(state.proposalsByEvidence, ([key, value]) => [key, Object.freeze([...value])]),
		),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

export function freezeWorkItemDomainActionAdmissionViews(
	state: WorkItemDomainActionAdmissionViewsState,
): WorkItemDomainActionAdmissionViews {
	return {
		admissionsByProposal: new Map(state.admissionsByProposal),
		admissionsByWorkItem: new Map(
			Array.from(state.admissionsByWorkItem, ([key, value]) => [key, Object.freeze([...value])]),
		),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

export function deletePendingWorkItemEffectRequest(
	state: Pick<
		WorkItemEffectRunViewsState | WorkItemEvidenceViewsState,
		"pendingEffectRequests" | "settledRequestIds"
	>,
	refs: readonly string[] | undefined,
): void {
	for (const requestRef of refs ?? []) {
		const tuple = parseCanonicalTupleKey(requestRef);
		const requestId =
			tuple?.length === 2 && tuple[0] === "work-item-effect-request"
				? tuple[1]
				: requestRef.startsWith("work-item-effect-request:")
					? requestRef.slice("work-item-effect-request:".length)
					: undefined;
		if (requestId === undefined) continue;
		state.pendingEffectRequests.delete(requestId);
		state.settledRequestIds.add(requestId);
	}
}

export function workItemEffectRequestRefs(request: WorkItemEffectRequested): readonly SourceRef[] {
	return [
		ref("work-item", request.workItemId),
		ref("work-item-effect-request", request.requestId),
		...(request.sourceRefs ?? []),
	];
}

export function workItemResultRefs(result: EffectRunResult): readonly SourceRef[] {
	return [
		ref("effect-run", result.effectRunId),
		ref("effect-run-result", result.resultId),
		...(result.sourceRefs ?? []),
		...(result.subjectRefs ?? []),
	];
}

export function workItemActionProposalRefs(
	evidence: WorkItemEvidenceRecorded,
	result: EffectRunResult,
	policy?: WorkItemEffectMappingPolicy,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item", evidence.workItemId),
		ref("effect-run", evidence.effectRunId),
		ref("effect-run-result", evidence.effectRunResultId),
		ref("work-item-evidence", evidence.evidenceId),
		...(policy === undefined ? [] : [ref("work-item-effect-mapping-policy", policy.policyId)]),
		...(evidence.sourceRefs ?? []),
		...(result.sourceRefs ?? []),
		...(result.subjectRefs ?? []),
	]);
}

export function workItemAdmissionProposalRefs(
	proposal: WorkItemDomainActionProposal,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item", proposal.workItemId),
		ref("work-item-domain-action-proposal", proposal.proposalId),
		ref("effect-run", proposal.effectRunId),
		ref("effect-run-result", proposal.effectRunResultId),
		ref("work-item-evidence", proposal.evidenceId),
		ref("work-item-effect-mapping-policy", proposal.policyId),
		...(proposal.sourceRefs ?? []),
	]);
}

export function workItemAdmissionDecisionRefs(
	decision: WorkItemDomainActionAdmissionDecision,
	proposal?: WorkItemDomainActionProposal,
	policy?: WorkItemDomainActionAdmissionPolicy,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		...(proposal === undefined ? [] : workItemAdmissionProposalRefs(proposal)),
		ref("work-item-domain-action-admission-decision", decision.decisionId),
		ref("work-item-domain-action-admission", decision.admissionId),
		ref("work-item-domain-action-proposal", decision.proposalId),
		...(decision.policyId === undefined
			? []
			: [ref("work-item-domain-action-admission-policy", decision.policyId)]),
		...(policy === undefined
			? []
			: [ref("work-item-domain-action-admission-policy", policy.policyId)]),
		...(decision.targetProposalId === undefined
			? []
			: [ref("work-item-domain-action-proposal", decision.targetProposalId)]),
		...(decision.targetAdmissionId === undefined
			? []
			: [ref("work-item-domain-action-admission", decision.targetAdmissionId)]),
		...(decision.sourceRefs ?? []),
	]);
}

export function workItemEvidenceOnlyRefs(evidence: WorkItemEvidenceRecorded): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("work-item", evidence.workItemId),
		ref("effect-run", evidence.effectRunId),
		ref("effect-run-result", evidence.effectRunResultId),
		ref("work-item-evidence", evidence.evidenceId),
		...(evidence.sourceRefs ?? []),
	]);
}

export function referencedWorkItemMappingPolicyIds(
	evidence: WorkItemEvidenceRecorded,
): readonly string[] {
	const refs = uniqueSourceRefs([...(evidence.sourceRefs ?? [])]);
	return refs
		.filter((sourceRef) => sourceRef.kind === "work-item-effect-mapping-policy")
		.map((sourceRef) => sourceRef.id);
}

export function effectKindFromMetadata(
	metadata: Record<string, unknown> | undefined,
): string | undefined {
	const effectKind = metadata?.effectKind;
	return typeof effectKind === "string" ? effectKind : undefined;
}

export function workItemActionProposalPayload(
	spec: WorkItemDomainActionProposalSpec,
	evidence: WorkItemEvidenceRecorded,
	result: EffectRunResult,
): unknown {
	if (spec.payload !== undefined) return spec.payload;
	const payloadFrom = spec.payloadFrom;
	if (payloadFrom === undefined) return undefined;
	if (payloadFrom === "effect-run-result")
		return { kind: "effect-run-result-ref", resultId: result.resultId };
	if (payloadFrom === "output") return evidence.output;
	return { kind: "work-item-evidence-ref", evidenceId: evidence.evidenceId };
}

export function resultReason(result: EffectRunResult): string | undefined {
	if (result.status === "canceled" || result.status === "waived") return result.reason;
	return undefined;
}

export function workItemIdForEffectRunResult(
	state: Pick<WorkItemDomainActionProposalState, "evidence">,
	result: EffectRunResult,
): string | undefined {
	for (const evidence of state.evidence.values()) {
		if (
			evidence.effectRunResultId === result.resultId &&
			evidence.effectRunId === result.effectRunId
		)
			return evidence.workItemId;
	}
	return undefined;
}

export function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
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

export function sourceRefKey(sourceRef: SourceRef): string {
	return canonicalTupleKey([
		sourceRef.kind,
		sourceRef.id,
		JSON.stringify(sourceRef.metadata ?? {}),
	]);
}

export function distinctWorkItemRefs(
	sourceRefs: readonly SourceRef[] | undefined,
): readonly SourceRef[] {
	const refs = new Map<string, SourceRef>();
	for (const sourceRef of sourceRefs ?? []) {
		if (sourceRef.kind === "work-item") refs.set(sourceRef.id, sourceRef);
	}
	return Array.from(refs.values());
}

export function singleWorkItemRef(
	sourceRefs: readonly SourceRef[] | undefined,
): SourceRef | undefined {
	const matches = distinctWorkItemRefs(sourceRefs);
	return matches.length === 1 ? matches[0] : undefined;
}

export function projectRuntimeFact<T, TOut>(
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

export function forEachPolicyDepBatch(
	ctx: Ctx,
	start: number,
	count: number,
	fn: (value: unknown) => void,
): void {
	for (let i = 0; i < count; i += 1) {
		for (const value of depBatch(ctx, start + i) ?? []) fn(value);
	}
}

export function dataIssue(
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
		refs: opts.refs?.map((r) => canonicalTupleKey([r.kind, r.id])),
		details: opts.details,
	};
}

export function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}
