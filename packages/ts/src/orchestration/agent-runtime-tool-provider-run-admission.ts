import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	requestToolProviderAdapterRun,
	runRequestIdentityIssues,
} from "./agent-runtime-adapter-run.js";
import {
	dataIssue,
	forEachDepBatch,
	projectRuntimeFact,
	ref,
	sanitizeAdapterInputSourceRefs,
	sanitizeProviderGraphVisibleRecord,
	uniqueSourceRefs,
} from "./agent-runtime-common.js";
import type { AgentNeed, AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { SourceRef } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderApprovalPolicy,
	ToolProviderExecutionPolicy,
	ToolProviderRunAdmission,
	ToolProviderRunAdmissionBundle,
	ToolProviderRunAdmissionDecision,
	ToolProviderRunAdmissionOutcome,
	ToolProviderRunAdmissionProposal,
	ToolProviderRunAdmissionState,
	ToolProviderRunAdmissionStatus,
	ToolProviderRunAdmissionViews,
} from "./agent-runtime-types-tool.js";

/**
 * Creates a tool provider run admission projector.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A node bundle that emits the projected records.
 * @category orchestration
 * @example
 * ```ts
 * import { toolProviderRunAdmissionProjector } from "@graphrefly/ts/orchestration";
 * ```
 */
export function toolProviderRunAdmissionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly inputs: Node<ToolProviderAdapterInput>;
		readonly runRequests: readonly Node<ToolProviderAdapterRunRequested>[];
		readonly decisions?: readonly Node<ToolProviderRunAdmissionDecision>[];
		readonly now?: () => number;
	},
): ToolProviderRunAdmissionBundle {
	const name = opts.name ?? "toolProviderRunAdmission";
	const decisionDeps = opts.decisions ?? [];
	const runtime = graph.node<ToolProviderRunAdmissionFact>(
		[opts.inputs, ...opts.runRequests, ...decisionDeps],
		(ctx) => {
			const state = ctx.state.get<ToolProviderRunAdmissionProjectorState>() ?? {
				inputs: new Map<string, ToolProviderAdapterInput>(),
				proposalsById: new Map<string, InternalAdmissionProposal>(),
				proposalsByRun: new Map<string, ToolProviderRunAdmissionProposal[]>(),
				decisionsByProposal: new Map<string, ToolProviderRunAdmissionDecision>(),
				admissionsByProposal: new Map<string, ToolProviderRunAdmission>(),
				admissionsByRun: new Map<string, ToolProviderRunAdmission[]>(),
				proposalKeys: new Set<string>(),
				admissionKeys: new Set<string>(),
				approvedRunKeys: new Set<string>(),
				statusKeys: new Set<string>(),
				issueKeys: new Set<string>(),
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const input = raw as ToolProviderAdapterInput;
				state.inputs.set(input.adapterInputId, input);
			}
			forEachDepBatch(ctx, 1, opts.runRequests.length, (raw) => {
				const request = raw as ToolProviderAdapterRunRequested;
				const input = state.inputs.get(request.adapterInputId);
				if (input === undefined) {
					emitAdmissionIssue(
						ctx,
						state,
						dataIssue(
							"tool-provider-run-admission-missing-input",
							"Tool provider run admission request references an unknown adapter input.",
							{
								subjectId: request.adapterInputId,
								refs: sanitizeAdapterInputSourceRefs([
									ref("tool-provider-adapter-run", request.runId),
									...(request.sourceRefs ?? []),
								]),
							},
						),
					);
					emitAdmissionStatus(ctx, state, {
						kind: "tool-provider-run-admission-status",
						proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [request.runId]),
						runId: request.runId,
						adapterInputId: request.adapterInputId,
						requestId: request.requestId,
						operationId: request.operationId,
						state: "issue",
						sourceRefs: request.sourceRefs,
					});
					return;
				}
				handleRunRequest(ctx, state, input, request, opts.now);
			});
			forEachDepBatch(ctx, 1 + opts.runRequests.length, decisionDeps.length, (raw) => {
				const decision = sanitizeAdmissionDecision(raw as ToolProviderRunAdmissionDecision);
				state.decisionsByProposal.set(decision.proposalId, decision);
				const internal = state.proposalsById.get(decision.proposalId);
				if (internal !== undefined) applyDecision(ctx, state, internal, decision, opts.now);
			});
			ctx.down([["DATA", { kind: "views", views: buildAdmissionViews(state) }]]);
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderRunAdmissionProjector", partial: true },
	);
	return {
		proposals: projectRuntimeFact(
			graph,
			runtime,
			`${name}/proposals`,
			"toolProviderRunAdmissionProposals",
			(fact) => (fact.kind === "proposal" ? fact.proposal : undefined),
		),
		admissions: projectRuntimeFact(
			graph,
			runtime,
			`${name}/admissions`,
			"toolProviderRunAdmissions",
			(fact) => (fact.kind === "admission" ? fact.admission : undefined),
		),
		approvedRunRequests: projectRuntimeFact(
			graph,
			runtime,
			`${name}/approvedRunRequests`,
			"toolProviderRunAdmissionApprovedRunRequests",
			(fact) => (fact.kind === "approved-run-request" ? fact.request : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"toolProviderRunAdmissionStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"toolProviderRunAdmissionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"toolProviderRunAdmissionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: projectRuntimeFact(
			graph,
			runtime,
			`${name}/views`,
			"toolProviderRunAdmissionViews",
			(fact) => (fact.kind === "views" ? fact.views : undefined),
		),
	};
}

type ToolProviderRunAdmissionFact =
	| { readonly kind: "proposal"; readonly proposal: ToolProviderRunAdmissionProposal }
	| { readonly kind: "admission"; readonly admission: ToolProviderRunAdmission }
	| { readonly kind: "approved-run-request"; readonly request: ToolProviderAdapterRunRequested }
	| { readonly kind: "status"; readonly status: ToolProviderRunAdmissionStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord }
	| { readonly kind: "views"; readonly views: ToolProviderRunAdmissionViews };

interface InternalAdmissionProposal {
	readonly proposal: ToolProviderRunAdmissionProposal;
	readonly request: ToolProviderAdapterRunRequested;
	readonly input: ToolProviderAdapterInput;
}

interface ToolProviderRunAdmissionProjectorState {
	inputs: Map<string, ToolProviderAdapterInput>;
	proposalsById: Map<string, InternalAdmissionProposal>;
	proposalsByRun: Map<string, ToolProviderRunAdmissionProposal[]>;
	decisionsByProposal: Map<string, ToolProviderRunAdmissionDecision>;
	admissionsByProposal: Map<string, ToolProviderRunAdmission>;
	admissionsByRun: Map<string, ToolProviderRunAdmission[]>;
	proposalKeys: Set<string>;
	admissionKeys: Set<string>;
	approvedRunKeys: Set<string>;
	statusKeys: Set<string>;
	issueKeys: Set<string>;
	auditSeq: number;
}

function handleRunRequest(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	input: ToolProviderAdapterInput,
	request: ToolProviderAdapterRunRequested,
	now: (() => number) | undefined,
): void {
	const issues = runRequestIdentityIssues(request, input);
	if (input.status !== "ready") {
		issues.push(
			dataIssue(
				"tool-provider-run-admission-input-not-ready",
				"Tool provider run admission requires a ready adapter input.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					details: { status: input.status },
				},
			),
		);
	}
	if (issues.length > 0) {
		for (const issue of issues) emitAdmissionIssue(ctx, state, issue);
		emitAdmissionStatus(ctx, state, {
			kind: "tool-provider-run-admission-status",
			proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [request.runId]),
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			state: "issue",
			issues: Object.freeze(issues),
			sourceRefs: request.sourceRefs,
		});
		emitAdmissionAudit(ctx, state, "tool-provider-run-admission-request-rejected", request, {
			issueCodes: issues.map((issue) => issue.code),
		});
		return;
	}
	const approval = resolveApprovalPolicy(input);
	const proposal = admissionProposal(input, request, approval);
	const internal = { proposal, request, input };
	state.proposalsById.set(proposal.proposalId, internal);
	pushMapArrayBy(state.proposalsByRun, request.runId, proposal, (entry) => entry.proposalId);
	emitProposal(ctx, state, proposal);
	emitAdmissionAudit(ctx, state, "tool-provider-run-admission-proposed", proposal, {
		approvalMode: proposal.approvalMode,
	});
	if (proposal.approvalMode === "auto") {
		admit(ctx, state, internal, undefined, now);
		return;
	}
	if (proposal.approvalMode === "never") {
		recordAdmission(ctx, state, internal, "blocked", {
			reason: "blocked by tool provider approval policy",
			now,
		});
		return;
	}
	const decision = state.decisionsByProposal.get(proposal.proposalId);
	if (decision === undefined) {
		emitAdmissionStatus(ctx, state, {
			kind: "tool-provider-run-admission-status",
			proposalId: proposal.proposalId,
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			state: "waiting",
			sourceRefs: proposal.sourceRefs,
		});
		return;
	}
	applyDecision(ctx, state, internal, decision, now);
}

function applyDecision(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	internal: InternalAdmissionProposal,
	decision: ToolProviderRunAdmissionDecision,
	now: (() => number) | undefined,
): void {
	const existing = state.admissionsByProposal.get(internal.proposal.proposalId);
	if (existing !== undefined) {
		if (existing.decisionId === decision.decisionId) return;
		const issue = dataIssue(
			"tool-provider-run-admission-duplicate-decision",
			"Tool provider run admission proposal already has a terminal admission decision.",
			{
				subjectId: internal.input.requestId,
				refs: admissionSourceRefs(internal, decision),
				severity: "warning",
				details: {
					proposalId: internal.proposal.proposalId,
					existingDecisionId: existing.decisionId,
					rejectedDecisionId: decision.decisionId,
				},
			},
		);
		emitAdmissionIssue(ctx, state, issue);
		emitAdmissionStatus(ctx, state, {
			kind: "tool-provider-run-admission-status",
			proposalId: internal.proposal.proposalId,
			runId: internal.request.runId,
			adapterInputId: internal.input.adapterInputId,
			requestId: internal.input.requestId,
			operationId: internal.input.operationId,
			state: "issue",
			issues: Object.freeze([issue]),
			sourceRefs: admissionSourceRefs(internal, decision),
		});
		emitAdmissionAudit(ctx, state, "tool-provider-run-admission-duplicate-decision", decision, {
			proposalId: internal.proposal.proposalId,
			existingDecisionId: existing.decisionId,
		});
		return;
	}
	if (decision.outcome === "admit") {
		admit(ctx, state, internal, decision, now);
		return;
	}
	recordAdmission(ctx, state, internal, admissionStateForOutcome(decision.outcome), {
		decision,
		reason: decision.reason,
		now,
	});
}

function admit(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	internal: InternalAdmissionProposal,
	decision: ToolProviderRunAdmissionDecision | undefined,
	now: (() => number) | undefined,
): void {
	const approvedRunId =
		decision?.approvedRunId ??
		(decision === undefined
			? compoundTupleKey("tool-provider-run-admitted", [internal.request.runId])
			: compoundTupleKey("tool-provider-run-admitted", [
					internal.request.runId,
					decision.decisionId,
				]));
	const admission = recordAdmission(ctx, state, internal, "admitted", {
		decision,
		approvedRunId,
		reason: decision?.reason,
		now,
	});
	const approvedRequest = requestToolProviderAdapterRun(internal.input, {
		runId: approvedRunId,
		attempt: internal.request.attempt,
		reason: internal.request.reason,
		retryOfOutcomeId: internal.request.retryOfOutcomeId,
		policyRefs: internal.request.policyRefs ?? internal.input.policyRefs,
		sourceRefs: uniqueSourceRefs([
			ref("tool-provider-adapter-run", internal.request.runId),
			ref("tool-provider-run-admission-proposal", internal.proposal.proposalId),
			ref("tool-provider-run-admission", admission.admissionId),
			...(decision === undefined
				? []
				: [ref("tool-provider-run-admission-decision", decision.decisionId)]),
			...(internal.request.sourceRefs ?? []),
		]),
		metadata: {
			...(internal.request.metadata ?? {}),
			approval: "granted",
			approvalGranted: true,
			admissionId: admission.admissionId,
			proposalId: internal.proposal.proposalId,
			approvedFromRunId: internal.request.runId,
			...(decision === undefined ? {} : { decisionId: decision.decisionId }),
		},
		requestedAtMs: now?.(),
	});
	emitApprovedRunRequest(ctx, state, approvedRequest);
	emitAdmissionAudit(
		ctx,
		state,
		"tool-provider-run-admission-approved-run-requested",
		{
			proposalId: internal.proposal.proposalId,
			runId: approvedRequest.runId,
		},
		{
			approvedFromRunId: internal.request.runId,
			decisionId: decision?.decisionId,
		},
	);
}

function recordAdmission(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	internal: InternalAdmissionProposal,
	admissionState: ToolProviderRunAdmissionState,
	opts: {
		readonly decision?: ToolProviderRunAdmissionDecision;
		readonly approvedRunId?: string;
		readonly reason?: string;
		readonly now?: (() => number) | undefined;
	},
): ToolProviderRunAdmission {
	const admissionId =
		opts.decision?.admissionId ??
		compoundTupleKey("tool-provider-run-admission", [internal.proposal.proposalId]);
	const sourceRefs = admissionSourceRefs(internal, opts.decision);
	const admission: ToolProviderRunAdmission = Object.freeze({
		kind: "tool-provider-run-admission",
		admissionId,
		proposalId: internal.proposal.proposalId,
		runId: internal.request.runId,
		adapterInputId: internal.input.adapterInputId,
		requestId: internal.input.requestId,
		operationId: internal.input.operationId,
		state: admissionState,
		...(opts.decision === undefined ? {} : { decisionId: opts.decision.decisionId }),
		...(opts.approvedRunId === undefined ? {} : { approvedRunId: opts.approvedRunId }),
		...(opts.reason === undefined ? {} : { reason: opts.reason }),
		sourceRefs,
		metadata: sanitizeProviderGraphVisibleRecord({
			approvalMode: internal.proposal.approvalMode,
			occurredAtMs: opts.now?.(),
		}),
	});
	state.admissionsByProposal.set(admission.proposalId, admission);
	pushMapArrayBy(state.admissionsByRun, admission.runId, admission, (entry) => entry.admissionId);
	emitAdmission(ctx, state, admission);
	if (admissionState === "blocked") {
		emitAdmissionIssue(
			ctx,
			state,
			dataIssue(
				"tool-provider-run-admission-blocked",
				"Tool provider run admission blocked the candidate run request.",
				{
					subjectId: internal.input.requestId,
					refs: sourceRefs,
					severity: "warning",
					details: { approvalMode: internal.proposal.approvalMode },
				},
			),
		);
	}
	emitAdmissionStatus(ctx, state, {
		kind: "tool-provider-run-admission-status",
		proposalId: admission.proposalId,
		runId: admission.runId,
		adapterInputId: admission.adapterInputId,
		requestId: admission.requestId,
		operationId: admission.operationId,
		state: admission.state,
		admissionId: admission.admissionId,
		...(admission.decisionId === undefined ? {} : { decisionId: admission.decisionId }),
		...(admission.approvedRunId === undefined ? {} : { approvedRunId: admission.approvedRunId }),
		sourceRefs,
	});
	emitAdmissionAudit(ctx, state, `tool-provider-run-admission-${admissionState}`, admission, {
		decisionId: opts.decision?.decisionId,
	});
	return admission;
}

function admissionProposal(
	input: ToolProviderAdapterInput,
	request: ToolProviderAdapterRunRequested,
	approval: ResolvedApprovalPolicy,
): ToolProviderRunAdmissionProposal {
	const sourceRefs = uniqueSourceRefs([
		ref("tool-provider-adapter-run", request.runId),
		ref("tool-provider-adapter-input", input.adapterInputId),
		...(request.sourceRefs ?? []),
		...(input.sourceRefs ?? []),
		...(approval.policy?.approval?.sourceRefs ?? []),
		...(approval.policy?.sourceRefs ?? []),
	]);
	return Object.freeze({
		kind: "tool-provider-run-admission-proposal",
		proposalId: compoundTupleKey("tool-provider-run-admission-proposal", [request.runId]),
		runId: request.runId,
		adapterInputId: input.adapterInputId,
		requestId: input.requestId,
		operationId: input.operationId,
		routeId: input.routeId,
		providerId: input.providerId,
		executorId: input.executorId,
		profileId: input.profileId,
		toolName: input.toolName,
		operation: input.operation,
		attempt: request.attempt,
		reason: request.reason,
		approvalMode: approval.mode,
		policyRefs: sanitizeAdapterInputSourceRefs([
			...(request.policyRefs ?? []),
			...(input.policyRefs ?? []),
			...(approval.policy === undefined
				? []
				: [ref("tool-provider-execution-policy", approval.policy.policyId)]),
		]),
		sourceRefs: sanitizeAdapterInputSourceRefs(sourceRefs),
		needs:
			approval.mode === "require" || approval.mode === "custom"
				? approvalNeeds(approval.policy?.approval)
				: undefined,
		metadata: sanitizeProviderGraphVisibleRecord({
			approvalPolicyId: approval.policy?.policyId,
			approvalMode: approval.mode,
		}),
	});
}

function resolveApprovalPolicy(input: ToolProviderAdapterInput): ResolvedApprovalPolicy {
	for (const policy of input.policies ?? []) {
		const approval = policy.approval;
		const mode = approval?.mode ?? "auto";
		if (matchesApprovalSelector(input, approval)) return { mode, policy };
	}
	return { mode: "auto" };
}

interface ResolvedApprovalPolicy {
	readonly mode: "auto" | "require" | "never" | "custom" | (string & {});
	readonly policy?: ToolProviderExecutionPolicy;
}

function matchesApprovalSelector(
	input: ToolProviderAdapterInput,
	approval: ToolProviderApprovalPolicy | undefined,
): boolean {
	if (approval === undefined) return true;
	const names = approval.requiredForToolNames;
	const operations = approval.requiredForOperations;
	const matchesName =
		names === undefined || (input.toolName !== undefined && names.includes(input.toolName));
	const matchesOperation =
		operations === undefined ||
		(input.operation !== undefined && operations.includes(input.operation));
	return matchesName && matchesOperation;
}

function approvalNeeds(approval: ToolProviderApprovalPolicy | undefined): readonly AgentNeed[] {
	return Object.freeze([
		{
			kind: "approval",
			message: "Tool provider run requires graph-visible admission.",
			refs: sanitizeAdapterInputSourceRefs(approval?.approverRefs ?? []),
			metadata: sanitizeProviderGraphVisibleRecord({ approvalMode: approval?.mode ?? "require" }),
		},
	]);
}

function admissionStateForOutcome(
	outcome: ToolProviderRunAdmissionOutcome,
): ToolProviderRunAdmissionState {
	if (outcome === "admit") return "admitted";
	if (outcome === "defer") return "deferred";
	return "blocked";
}

function admissionSourceRefs(
	internal: InternalAdmissionProposal,
	decision: ToolProviderRunAdmissionDecision | undefined,
): readonly SourceRef[] {
	return sanitizeAdapterInputSourceRefs([
		ref("tool-provider-run-admission-proposal", internal.proposal.proposalId),
		ref("tool-provider-adapter-run", internal.request.runId),
		ref("tool-provider-adapter-input", internal.input.adapterInputId),
		...(decision === undefined
			? []
			: [ref("tool-provider-run-admission-decision", decision.decisionId)]),
		...(decision?.sourceRefs ?? []),
	]);
}

function sanitizeAdmissionDecision(
	decision: ToolProviderRunAdmissionDecision,
): ToolProviderRunAdmissionDecision {
	return Object.freeze({
		kind: "tool-provider-run-admission-decision",
		decisionId: decision.decisionId,
		proposalId: decision.proposalId,
		admissionId: decision.admissionId,
		outcome: decision.outcome,
		...(decision.approvedRunId === undefined ? {} : { approvedRunId: decision.approvedRunId }),
		...(decision.reason === undefined ? {} : { reason: decision.reason }),
		...(decision.decidedByRef === undefined
			? {}
			: { decidedByRef: sanitizeAdapterInputSourceRefs([decision.decidedByRef])[0] }),
		...(decision.sourceRefs === undefined
			? {}
			: { sourceRefs: sanitizeAdapterInputSourceRefs(decision.sourceRefs) }),
		metadata: sanitizeProviderGraphVisibleRecord(decision.metadata),
	});
}

function emitProposal(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	proposal: ToolProviderRunAdmissionProposal,
): void {
	const key = `proposal:${proposal.proposalId}`;
	if (state.proposalKeys.has(key)) return;
	state.proposalKeys.add(key);
	ctx.down([["DATA", { kind: "proposal", proposal }]]);
}

function emitAdmission(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	admission: ToolProviderRunAdmission,
): void {
	const key = compoundTupleKey("admission", [
		admission.admissionId,
		admission.state,
		admission.decisionId ?? "",
		admission.approvedRunId ?? "",
	]);
	if (state.admissionKeys.has(key)) return;
	state.admissionKeys.add(key);
	ctx.down([["DATA", { kind: "admission", admission }]]);
}

function emitApprovedRunRequest(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	request: ToolProviderAdapterRunRequested,
): void {
	const key = compoundTupleKey("approved-run", [request.runId]);
	if (state.approvedRunKeys.has(key)) return;
	state.approvedRunKeys.add(key);
	ctx.down([["DATA", { kind: "approved-run-request", request }]]);
}

function emitAdmissionStatus(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	status: ToolProviderRunAdmissionStatus,
): void {
	const key = compoundTupleKey("status", [
		status.proposalId,
		status.state,
		status.admissionId ?? "",
		status.decisionId ?? "",
		status.approvedRunId ?? "",
	]);
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	ctx.down([["DATA", { kind: "status", status }]]);
}

function emitAdmissionIssue(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	issue: DataIssue,
): void {
	const key = compoundTupleKey("issue", [
		issue.code,
		issue.subjectId ?? "",
		JSON.stringify(issue.details ?? {}),
	]);
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	ctx.down([["DATA", { kind: "issue", issue }]]);
}

function emitAdmissionAudit(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunAdmissionFact][]) => void },
	state: ToolProviderRunAdmissionProjectorState,
	kind: string,
	subject: unknown,
	metadata?: Record<string, unknown>,
): void {
	state.auditSeq += 1;
	ctx.down([
		[
			"DATA",
			{
				kind: "audit",
				audit: Object.freeze({
					id: `tool-provider-run-admission-audit-${state.auditSeq}`,
					kind,
					message: kind,
					sourceRefs: [],
					metadata: sanitizeProviderGraphVisibleRecord({
						...metadata,
						subject,
					}),
				} satisfies AgentRuntimeAuditRecord),
			},
		],
	]);
}

function buildAdmissionViews(
	state: ToolProviderRunAdmissionProjectorState,
): ToolProviderRunAdmissionViews {
	return Object.freeze({
		admissionsByProposal: new Map(state.admissionsByProposal),
		admissionsByRun: new Map(
			Array.from(state.admissionsByRun.entries()).map(([key, value]) => [
				key,
				Object.freeze([...value]),
			]),
		),
		proposalsByRun: new Map(
			Array.from(state.proposalsByRun.entries()).map(([key, value]) => [
				key,
				Object.freeze([...value]),
			]),
		),
	});
}

function pushMapArrayBy<T>(
	map: Map<string, T[]>,
	key: string,
	value: T,
	entryKey: (entry: T) => string,
): void {
	const existing = map.get(key);
	if (existing === undefined) {
		map.set(key, [value]);
		return;
	}
	const valueKey = entryKey(value);
	if (existing.some((entry) => entryKey(entry) === valueKey)) return;
	existing.push(value);
}
