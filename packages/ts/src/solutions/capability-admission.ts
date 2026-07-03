/**
 * Product-owned capability admission facts (D357).
 *
 * This helper consumes generic BoundaryCapabilityRef data and emits ordinary DATA
 * facts for product admission state. It is not AutoPanel security, not a provider
 * registry, and not protocol ERROR/tier/message semantics.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { BoundaryCapabilityRef, BoundaryRole } from "../inspection/boundary.js";
import type { Node } from "../node/node.js";
import type { AgentRuntimeAuditRecord, SourceRef } from "../orchestration/agent-runtime.js";

export type CapabilityAdmissionOutcome = "allow" | "block" | "defer";
export type CapabilityAdmissionState = "allowed" | "blocked" | "deferred";

export interface CapabilityAdmissionProposal {
	readonly kind: "capability-admission-proposal";
	readonly proposalId: string;
	readonly subjectId: string;
	readonly capability: BoundaryCapabilityRef;
	readonly boundaryName?: string;
	readonly role?: BoundaryRole;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly proposedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface CapabilityAdmissionPolicy {
	readonly kind: "capability-admission-policy";
	readonly policyId: string;
	readonly capabilityIds?: readonly string[];
	readonly capabilityKinds?: readonly BoundaryCapabilityRef["kind"][];
	readonly requiredOnly?: boolean;
	readonly allowedOutcomes?: readonly CapabilityAdmissionOutcome[];
	readonly metadata?: Record<string, unknown>;
}

export interface CapabilityAdmissionDecision {
	readonly kind: "capability-admission-decision";
	readonly decisionId: string;
	readonly admissionId: string;
	readonly proposalId: string;
	readonly outcome: CapabilityAdmissionOutcome;
	readonly policyId?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly decidedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface CapabilityAdmission {
	readonly kind: "capability-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly subjectId: string;
	readonly capability: BoundaryCapabilityRef;
	readonly state: CapabilityAdmissionState;
	readonly decisionId: string;
	readonly boundaryName?: string;
	readonly role?: BoundaryRole;
	readonly policyId?: string;
	readonly reason?: string;
	readonly sourceRefs?: readonly SourceRef[];
	readonly admittedAtMs?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface CapabilityAdmissionStatus {
	readonly kind: "capability-admission-status";
	readonly statusId: string;
	readonly state:
		| "capability-admission-allowed"
		| "capability-admission-blocked"
		| "capability-admission-deferred"
		| "capability-admission-issue";
	readonly proposalId?: string;
	readonly admissionId?: string;
	readonly subjectId?: string;
	readonly capabilityId?: string;
	readonly capabilityKind?: BoundaryCapabilityRef["kind"];
	readonly policyId?: string;
	readonly issues?: readonly DataIssue[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface CapabilityAdmissionViews {
	readonly admissionsByProposal: ReadonlyMap<string, CapabilityAdmission>;
	readonly admissionsBySubject: ReadonlyMap<string, readonly CapabilityAdmission[]>;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgentRuntimeAuditRecord[];
}

export interface CapabilityAdmissionBundle {
	readonly admissions: Node<CapabilityAdmission>;
	readonly status: Node<CapabilityAdmissionStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<CapabilityAdmissionViews>;
}

type CapabilityAdmissionFact =
	| { readonly kind: "admission"; readonly admission: CapabilityAdmission }
	| { readonly kind: "status"; readonly status: CapabilityAdmissionStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface CapabilityAdmissionStateInternal {
	proposals: Map<string, CapabilityAdmissionProposal>;
	policies: Map<string, CapabilityAdmissionPolicy>;
	decisions: Map<string, CapabilityAdmissionDecision>;
	admissionsById: Map<string, CapabilityAdmission>;
	admissionsByProposal: Map<string, CapabilityAdmission>;
	terminalDecisionIds: Set<string>;
	issueKeys: Set<string>;
	issueSeq: number;
	statusSeq: number;
	auditSeq: number;
}

interface CapabilityAdmissionViewsState {
	admissionsByProposal: Map<string, CapabilityAdmission>;
	admissionsBySubject: Map<string, CapabilityAdmission[]>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
}

export function capabilityAdmissionProposal(
	opts: Omit<CapabilityAdmissionProposal, "kind">,
): CapabilityAdmissionProposal {
	return { kind: "capability-admission-proposal", ...opts };
}

export function capabilityAdmissionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly proposals: Node<CapabilityAdmissionProposal>;
		readonly decisions: Node<CapabilityAdmissionDecision>;
		readonly admissionPolicies?: readonly Node<CapabilityAdmissionPolicy>[];
		readonly now?: () => number;
	},
): CapabilityAdmissionBundle {
	const name = opts.name ?? "capabilityAdmissions";
	const policyDeps = opts.admissionPolicies ?? [];
	const now = opts.now ?? Date.now;
	const runtime = graph.node<CapabilityAdmissionFact>(
		[opts.proposals, opts.decisions, ...policyDeps],
		(ctx) => {
			const state =
				ctx.state.get<CapabilityAdmissionStateInternal>() ?? emptyCapabilityAdmissionState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as CapabilityAdmissionProposal;
				const issue = capabilityAdmissionProposalIssue(proposal);
				if (issue !== undefined) {
					emitIssue(
						ctx,
						state,
						nextMalformedIssueKey(state, "proposal", proposalKeyFallback(proposal)),
						issue,
					);
					continue;
				}
				if (state.proposals.has(proposal.proposalId)) {
					emitIssue(
						ctx,
						state,
						`duplicate-proposal:${proposal.proposalId}`,
						dataIssue(
							"duplicate-capability-admission-proposal",
							`CapabilityAdmissionProposal '${proposal.proposalId}' was already seen`,
							{ subjectId: proposal.subjectId, refs: capabilityProposalRefs(proposal) },
						),
					);
					continue;
				}
				state.proposals.set(proposal.proposalId, proposal);
			}
			forEachPolicyDepBatch(ctx, 2, policyDeps.length, (raw) => {
				const policy = raw as CapabilityAdmissionPolicy;
				const issue = capabilityAdmissionPolicyIssue(policy);
				if (issue !== undefined) {
					emitIssue(
						ctx,
						state,
						nextMalformedIssueKey(state, "policy", policyKeyFallback(policy)),
						issue,
					);
					return;
				}
				if (state.policies.has(policy.policyId)) {
					emitIssue(
						ctx,
						state,
						`duplicate-policy:${policy.policyId}`,
						dataIssue(
							"duplicate-capability-admission-policy",
							`CapabilityAdmissionPolicy '${policy.policyId}' was already seen`,
							{ refs: [ref("capability-admission-policy", policy.policyId)] },
						),
					);
					return;
				}
				state.policies.set(policy.policyId, policy);
			});
			for (const raw of depBatch(ctx, 1) ?? []) {
				const decision = raw as CapabilityAdmissionDecision;
				const issue = capabilityAdmissionDecisionIssue(decision);
				if (issue !== undefined) {
					emitIssue(
						ctx,
						state,
						nextMalformedIssueKey(state, "decision", decisionKeyFallback(decision)),
						issue,
					);
					continue;
				}
				if (state.decisions.has(decision.decisionId)) {
					emitIssue(
						ctx,
						state,
						`duplicate-decision:${decision.decisionId}`,
						dataIssue(
							"duplicate-capability-admission-decision",
							`CapabilityAdmissionDecision '${decision.decisionId}' was already seen`,
							{ refs: capabilityDecisionRefs(decision) },
						),
					);
					continue;
				}
				state.decisions.set(decision.decisionId, decision);
			}
			evaluateCapabilityAdmissions(ctx, state, now());
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "capabilityAdmissionProjector", partial: true },
	);
	return {
		admissions: projectRuntimeFact(
			graph,
			runtime,
			`${name}/admissions`,
			"capabilityAdmissions",
			(fact) => (fact.kind === "admission" ? fact.admission : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"capabilityAdmissionStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"capabilityAdmissionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"capabilityAdmissionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: capabilityAdmissionViews(graph, runtime, `${name}/views`),
	};
}

function evaluateCapabilityAdmissions(
	ctx: Ctx,
	state: CapabilityAdmissionStateInternal,
	admittedAtMs: number,
): void {
	for (const decision of state.decisions.values()) {
		if (state.terminalDecisionIds.has(decision.decisionId)) continue;
		evaluateCapabilityAdmission(ctx, state, decision, admittedAtMs);
	}
}

function evaluateCapabilityAdmission(
	ctx: Ctx,
	state: CapabilityAdmissionStateInternal,
	decision: CapabilityAdmissionDecision,
	admittedAtMs: number,
): void {
	const proposal = state.proposals.get(decision.proposalId);
	if (proposal === undefined) {
		emitIssue(
			ctx,
			state,
			compoundTupleKey("missing-proposal", [decision.decisionId, decision.proposalId]),
			dataIssue(
				"missing-capability-admission-proposal",
				`CapabilityAdmissionDecision '${decision.decisionId}' references missing proposal '${decision.proposalId}'`,
				{ subjectId: decision.proposalId, refs: capabilityDecisionRefs(decision) },
			),
		);
		return;
	}
	const policy = capabilityPolicyForDecision(state, decision);
	if (typeof policy === "string") {
		emitIssue(
			ctx,
			state,
			compoundTupleKey(policy, [decision.decisionId, decision.policyId ?? "missing"]),
			dataIssue(policy, capabilityPolicyIssueMessage(policy, decision), {
				subjectId: proposal.subjectId,
				refs: capabilityDecisionRefs(decision, proposal),
			}),
		);
		if (policy === "stale-capability-admission-policy-ref")
			state.terminalDecisionIds.add(decision.decisionId);
		return;
	}
	if (policy !== undefined) {
		const policyIssue = validateCapabilityAdmissionPolicy(policy, decision, proposal);
		if (policyIssue !== undefined) {
			emitIssue(
				ctx,
				state,
				compoundTupleKey(policyIssue.code, [decision.decisionId, policy.policyId]),
				dataIssue(policyIssue.code, policyIssue.message, {
					subjectId: proposal.subjectId,
					refs: capabilityDecisionRefs(decision, proposal, policy),
				}),
			);
			return;
		}
	}
	if (state.admissionsById.has(decision.admissionId)) {
		emitIssue(
			ctx,
			state,
			compoundTupleKey("duplicate-admission-id", [decision.admissionId]),
			dataIssue(
				"duplicate-capability-admission",
				`CapabilityAdmission '${decision.admissionId}' was already emitted`,
				{ subjectId: proposal.subjectId, refs: capabilityDecisionRefs(decision, proposal, policy) },
			),
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return;
	}
	if (state.admissionsByProposal.has(decision.proposalId)) {
		emitIssue(
			ctx,
			state,
			compoundTupleKey("duplicate-admission-proposal", [decision.proposalId, decision.decisionId]),
			dataIssue(
				"duplicate-capability-admission-proposal",
				`CapabilityAdmissionProposal '${decision.proposalId}' already has an admission decision`,
				{ subjectId: proposal.subjectId, refs: capabilityDecisionRefs(decision, proposal, policy) },
			),
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return;
	}
	const admissionState = admissionStateForOutcome(decision.outcome);
	if (admissionState === undefined) {
		emitIssue(
			ctx,
			state,
			compoundTupleKey("unsupported-outcome", [decision.decisionId, String(decision.outcome)]),
			dataIssue(
				"unsupported-capability-admission-outcome",
				`CapabilityAdmissionDecision '${decision.decisionId}' uses unsupported outcome '${String(decision.outcome)}'`,
				{ subjectId: proposal.subjectId, refs: capabilityDecisionRefs(decision, proposal, policy) },
			),
		);
		state.terminalDecisionIds.add(decision.decisionId);
		return;
	}
	const admission: CapabilityAdmission = {
		kind: "capability-admission",
		admissionId: decision.admissionId,
		proposalId: proposal.proposalId,
		subjectId: proposal.subjectId,
		capability: cloneCapabilityRef(proposal.capability),
		state: admissionState,
		decisionId: decision.decisionId,
		boundaryName: proposal.boundaryName,
		role: proposal.role,
		policyId: decision.policyId,
		reason: decision.reason ?? proposal.reason,
		sourceRefs: capabilityDecisionRefs(decision, proposal, policy),
		admittedAtMs: decision.decidedAtMs ?? admittedAtMs,
		metadata: {
			...(proposal.metadata ?? {}),
			...(policy?.metadata ?? {}),
			...(decision.metadata ?? {}),
		},
	};
	state.admissionsById.set(admission.admissionId, admission);
	state.admissionsByProposal.set(admission.proposalId, admission);
	state.terminalDecisionIds.add(decision.decisionId);
	emitAdmission(ctx, state, admission);
}

function capabilityAdmissionViews(
	graph: Graph,
	runtime: Node<CapabilityAdmissionFact>,
	name: string,
): Node<CapabilityAdmissionViews> {
	return graph.node<CapabilityAdmissionViews>(
		[runtime],
		(ctx) => {
			const state: CapabilityAdmissionViewsState =
				ctx.state.get<CapabilityAdmissionViewsState>() ?? {
					admissionsByProposal: new Map(),
					admissionsBySubject: new Map(),
					issues: [],
					audit: [],
				};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as CapabilityAdmissionFact;
				if (fact.kind === "admission") {
					const admission = fact.admission;
					state.admissionsByProposal.set(admission.proposalId, admission);
					const bySubject = state.admissionsBySubject.get(admission.subjectId) ?? [];
					bySubject.push(admission);
					state.admissionsBySubject.set(admission.subjectId, bySubject);
				}
				if (fact.kind === "issue") state.issues.push(fact.issue);
				if (fact.kind === "audit") state.audit.push(fact.audit);
			}
			ctx.state.set(state);
			ctx.down([["DATA", freezeCapabilityAdmissionViews(state)]]);
		},
		{ name, factory: "capabilityAdmissionViews" },
	);
}

function emitAdmission(
	ctx: Ctx,
	state: CapabilityAdmissionStateInternal,
	admission: CapabilityAdmission,
): void {
	state.statusSeq += 1;
	state.auditSeq += 1;
	const statusState = capabilityAdmissionStatusState(admission.state);
	const status: CapabilityAdmissionStatus = {
		kind: "capability-admission-status",
		statusId: compoundTupleKey("capability-admission-status", [
			admission.subjectId,
			statusState,
			String(state.statusSeq),
		]),
		state: statusState,
		proposalId: admission.proposalId,
		admissionId: admission.admissionId,
		subjectId: admission.subjectId,
		capabilityId: admission.capability.id,
		capabilityKind: admission.capability.kind,
		policyId: admission.policyId,
		sourceRefs: admission.sourceRefs,
	};
	const audit: AgentRuntimeAuditRecord = {
		id: compoundTupleKey("capability-admission-audit", [
			admission.subjectId,
			statusState,
			String(state.auditSeq),
		]),
		kind: `capability-admission-${admission.state}`,
		subjectId: admission.subjectId,
		sourceRefs: admission.sourceRefs,
		metadata: {
			admissionId: admission.admissionId,
			capabilityId: admission.capability.id,
			capabilityKind: admission.capability.kind,
			policyId: admission.policyId,
			proposalId: admission.proposalId,
		},
	};
	ctx.down([
		["DATA", { kind: "admission", admission } satisfies CapabilityAdmissionFact],
		["DATA", { kind: "status", status } satisfies CapabilityAdmissionFact],
		["DATA", { kind: "audit", audit } satisfies CapabilityAdmissionFact],
	]);
}

function emitIssue(
	ctx: Ctx,
	state: CapabilityAdmissionStateInternal,
	key: string,
	issue: DataIssue,
): void {
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	state.statusSeq += 1;
	state.auditSeq += 1;
	const status: CapabilityAdmissionStatus = {
		kind: "capability-admission-status",
		statusId: compoundTupleKey("capability-admission-issue", [String(state.statusSeq)]),
		state: "capability-admission-issue",
		subjectId: issue.subjectId,
		issues: [issue],
	};
	const audit: AgentRuntimeAuditRecord = {
		id: `capability-admission-issue:${state.auditSeq}`,
		kind: "capability-admission-issue",
		subjectId: issue.subjectId,
		message: issue.message,
		issueCode: issue.code,
	};
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies CapabilityAdmissionFact],
		["DATA", { kind: "status", status } satisfies CapabilityAdmissionFact],
		["DATA", { kind: "audit", audit } satisfies CapabilityAdmissionFact],
	]);
}

function capabilityAdmissionProposalIssue(
	proposal: CapabilityAdmissionProposal,
): DataIssue | undefined {
	if (
		proposal.kind !== "capability-admission-proposal" ||
		typeof proposal.proposalId !== "string" ||
		proposal.proposalId.length === 0 ||
		typeof proposal.subjectId !== "string" ||
		proposal.subjectId.length === 0 ||
		!isBoundaryCapabilityRef(proposal.capability)
	) {
		return dataIssue(
			"malformed-capability-admission-proposal",
			"CapabilityAdmissionProposal requires proposalId, subjectId, and a D348 BoundaryCapabilityRef",
			{ subjectId: typeof proposal.subjectId === "string" ? proposal.subjectId : undefined },
		);
	}
	return undefined;
}

function capabilityAdmissionPolicyIssue(policy: CapabilityAdmissionPolicy): DataIssue | undefined {
	if (
		policy.kind !== "capability-admission-policy" ||
		typeof policy.policyId !== "string" ||
		policy.policyId.length === 0 ||
		(policy.capabilityIds !== undefined &&
			(!Array.isArray(policy.capabilityIds) ||
				!policy.capabilityIds.every((id) => typeof id === "string" && id.length > 0))) ||
		(policy.capabilityKinds !== undefined &&
			(!Array.isArray(policy.capabilityKinds) ||
				!policy.capabilityKinds.every(isBoundaryCapabilityKind))) ||
		(policy.requiredOnly !== undefined && typeof policy.requiredOnly !== "boolean") ||
		(policy.allowedOutcomes !== undefined &&
			(!Array.isArray(policy.allowedOutcomes) ||
				!policy.allowedOutcomes.every(isCapabilityAdmissionOutcome)))
	) {
		return dataIssue(
			"malformed-capability-admission-policy",
			"CapabilityAdmissionPolicy requires a policyId and D348 capability/outcome filters",
			{ subjectId: typeof policy.policyId === "string" ? policy.policyId : undefined },
		);
	}
	return undefined;
}

function capabilityAdmissionDecisionIssue(
	decision: CapabilityAdmissionDecision,
): DataIssue | undefined {
	if (
		decision.kind !== "capability-admission-decision" ||
		typeof decision.decisionId !== "string" ||
		decision.decisionId.length === 0 ||
		typeof decision.admissionId !== "string" ||
		decision.admissionId.length === 0 ||
		typeof decision.proposalId !== "string" ||
		decision.proposalId.length === 0 ||
		!isCapabilityAdmissionOutcome(decision.outcome) ||
		(decision.policyId !== undefined &&
			(typeof decision.policyId !== "string" || decision.policyId.length === 0))
	) {
		return dataIssue(
			"malformed-capability-admission-decision",
			"CapabilityAdmissionDecision requires decisionId, admissionId, proposalId, and allow/block/defer outcome",
			{ subjectId: typeof decision.proposalId === "string" ? decision.proposalId : undefined },
		);
	}
	return undefined;
}

function validateCapabilityAdmissionPolicy(
	policy: CapabilityAdmissionPolicy,
	decision: CapabilityAdmissionDecision,
	proposal: CapabilityAdmissionProposal,
): { readonly code: string; readonly message: string } | undefined {
	if (
		policy.capabilityIds !== undefined &&
		!policy.capabilityIds.includes(proposal.capability.id)
	) {
		return {
			code: "capability-admission-policy-mismatch",
			message: `CapabilityAdmissionPolicy '${policy.policyId}' does not apply to capability '${proposal.capability.id}'`,
		};
	}
	if (
		policy.capabilityKinds !== undefined &&
		!policy.capabilityKinds.includes(proposal.capability.kind)
	) {
		return {
			code: "capability-admission-policy-mismatch",
			message: `CapabilityAdmissionPolicy '${policy.policyId}' does not apply to capability kind '${proposal.capability.kind}'`,
		};
	}
	if (policy.requiredOnly === true && !proposal.capability.required) {
		return {
			code: "capability-admission-policy-mismatch",
			message: `CapabilityAdmissionPolicy '${policy.policyId}' applies only to required capabilities`,
		};
	}
	if (policy.allowedOutcomes !== undefined && !policy.allowedOutcomes.includes(decision.outcome)) {
		return {
			code: "unsupported-capability-admission-outcome",
			message: `CapabilityAdmissionPolicy '${policy.policyId}' does not allow outcome '${decision.outcome}'`,
		};
	}
	return undefined;
}

function capabilityPolicyForDecision(
	state: CapabilityAdmissionStateInternal,
	decision: CapabilityAdmissionDecision,
):
	| CapabilityAdmissionPolicy
	| "missing-capability-admission-policy"
	| "stale-capability-admission-policy-ref"
	| undefined {
	if (decision.policyId === undefined) return undefined;
	const stalePolicyRef = (decision.sourceRefs ?? []).find(
		(sourceRef) =>
			sourceRef.kind === "capability-admission-policy" && sourceRef.id !== decision.policyId,
	);
	if (stalePolicyRef !== undefined) return "stale-capability-admission-policy-ref";
	return state.policies.get(decision.policyId) ?? "missing-capability-admission-policy";
}

function capabilityPolicyIssueMessage(
	code: "missing-capability-admission-policy" | "stale-capability-admission-policy-ref",
	decision: CapabilityAdmissionDecision,
): string {
	if (code === "missing-capability-admission-policy") {
		return `CapabilityAdmissionPolicy '${decision.policyId}' was referenced but not present`;
	}
	return `CapabilityAdmissionDecision '${decision.decisionId}' carries a stale admission policy source ref`;
}

function admissionStateForOutcome(
	outcome: CapabilityAdmissionOutcome,
): CapabilityAdmissionState | undefined {
	if (outcome === "allow") return "allowed";
	if (outcome === "block") return "blocked";
	if (outcome === "defer") return "deferred";
	return undefined;
}

function capabilityAdmissionStatusState(
	state: CapabilityAdmissionState,
): CapabilityAdmissionStatus["state"] {
	if (state === "allowed") return "capability-admission-allowed";
	if (state === "blocked") return "capability-admission-blocked";
	return "capability-admission-deferred";
}

function cloneCapabilityRef(ref: BoundaryCapabilityRef): BoundaryCapabilityRef {
	return {
		id: ref.id,
		kind: ref.kind,
		required: ref.required,
		...(ref.sourceRefs === undefined ? {} : { sourceRefs: [...ref.sourceRefs] }),
	};
}

function isBoundaryCapabilityRef(value: unknown): value is BoundaryCapabilityRef {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Partial<BoundaryCapabilityRef>;
	return (
		typeof record.id === "string" &&
		record.id.length > 0 &&
		isBoundaryCapabilityKind(record.kind) &&
		typeof record.required === "boolean" &&
		(record.sourceRefs === undefined ||
			(Array.isArray(record.sourceRefs) &&
				record.sourceRefs.every((sourceRef) => typeof sourceRef === "string")))
	);
}

function isBoundaryCapabilityKind(value: unknown): value is BoundaryCapabilityRef["kind"] {
	return value === "auth" || value === "permission" || value === "config" || value === "resource";
}

function isCapabilityAdmissionOutcome(value: unknown): value is CapabilityAdmissionOutcome {
	return value === "allow" || value === "block" || value === "defer";
}

function proposalKeyFallback(proposal: CapabilityAdmissionProposal): string {
	return typeof proposal.proposalId === "string" && proposal.proposalId.length > 0
		? proposal.proposalId
		: canonicalTupleKey([
				stringValue(proposal.subjectId) ?? "unknown",
				capabilityKeyFallback(proposal.capability),
			]);
}

function policyKeyFallback(policy: CapabilityAdmissionPolicy): string {
	return typeof policy.policyId === "string" && policy.policyId.length > 0
		? policy.policyId
		: "unknown";
}

function decisionKeyFallback(decision: CapabilityAdmissionDecision): string {
	return typeof decision.decisionId === "string" && decision.decisionId.length > 0
		? decision.decisionId
		: canonicalTupleKey([
				stringValue(decision.proposalId) ?? "unknown",
				stringValue(decision.admissionId) ?? "unknown",
			]);
}

function capabilityKeyFallback(value: unknown): string {
	if (!isBoundaryCapabilityRef(value)) return "unknown-capability";
	return canonicalTupleKey([value.kind, value.id]);
}

function nextMalformedIssueKey(
	state: CapabilityAdmissionStateInternal,
	kind: "decision" | "policy" | "proposal",
	fallback: string,
): string {
	state.issueSeq += 1;
	return compoundTupleKey(`malformed-${kind}`, [String(state.issueSeq), fallback]);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function capabilityProposalRefs(proposal: CapabilityAdmissionProposal): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("capability-admission-proposal", proposal.proposalId),
		ref(
			"boundary-capability",
			canonicalTupleKey([proposal.capability.kind, proposal.capability.id]),
		),
		...(proposal.sourceRefs ?? []),
	]);
}

function capabilityDecisionRefs(
	decision: CapabilityAdmissionDecision,
	proposal?: CapabilityAdmissionProposal,
	policy?: CapabilityAdmissionPolicy,
): readonly SourceRef[] {
	return uniqueSourceRefs([
		ref("capability-admission-decision", decision.decisionId),
		ref("capability-admission", decision.admissionId),
		ref("capability-admission-proposal", decision.proposalId),
		...(proposal === undefined ? [] : capabilityProposalRefs(proposal)),
		...(decision.policyId === undefined
			? []
			: [ref("capability-admission-policy", decision.policyId)]),
		...(policy === undefined ? [] : [ref("capability-admission-policy", policy.policyId)]),
		...(decision.sourceRefs ?? []),
	]);
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

function freezeCapabilityAdmissionViews(
	state: CapabilityAdmissionViewsState,
): CapabilityAdmissionViews {
	return {
		admissionsByProposal: new Map(state.admissionsByProposal),
		admissionsBySubject: new Map(
			Array.from(state.admissionsBySubject, ([key, value]) => [key, Object.freeze([...value])]),
		),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}

function emptyCapabilityAdmissionState(): CapabilityAdmissionStateInternal {
	return {
		proposals: new Map(),
		policies: new Map(),
		decisions: new Map(),
		admissionsById: new Map(),
		admissionsByProposal: new Map(),
		terminalDecisionIds: new Set(),
		issueKeys: new Set(),
		issueSeq: 0,
		statusSeq: 0,
		auditSeq: 0,
	};
}

function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly details?: unknown;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: "error",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((sourceRef) => canonicalTupleKey([sourceRef.kind, sourceRef.id])),
		details: opts.details,
	};
}

function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = canonicalTupleKey([
			sourceRef.kind,
			sourceRef.id,
			JSON.stringify(sourceRef.metadata ?? {}),
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(sourceRef);
	}
	return out;
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}
