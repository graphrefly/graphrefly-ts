import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import {
	boundPublicText,
	cloneGraphVisibleMaterial,
	maxPublicReasonChars,
	publicMaterialForbiddenKeys,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
	sanitizeProviderGraphVisibleRecord,
} from "./agent-runtime-common.js";
import { isTerminalRequestStatus } from "./agent-runtime-effect-completion.js";
import type {
	AgentDecisionContinue,
	AgentRuntimeAuditRecord,
} from "./agent-runtime-types-agent.js";
import type {
	AgentRequestAdmitted,
	AgentRequestFact,
	AgentRequestInput,
	AgentRequestIssued,
	AgentRequestLedgerBundle,
	AgentRequestProposal,
	AgentRequestStatusChanged,
	AgentRequestViews,
	SourceRef,
} from "./agent-runtime-types-core.js";

export function agentRequestProposalFromDecision(
	decision: AgentDecisionContinue,
	proposal: Omit<AgentRequestProposal, "kind" | "effectRunId" | "agentRunId" | "sourceDecisionId">,
): AgentRequestProposal {
	return {
		kind: "proposal",
		...proposal,
		effectRunId: decision.effectRunId,
		agentRunId: decision.agentRunId,
		sourceDecisionId: decision.decisionId,
		evidenceRefs: proposal.evidenceRefs ?? decision.evidenceRefs,
	};
}

export function admitAgentRequestProposal(
	proposal: AgentRequestProposal,
	opts: {
		readonly requestId: string;
		readonly operationId: string;
		readonly admittedAtMs?: number;
		readonly reason?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	},
): AgentRequestAdmitted {
	const sourceRefs =
		opts.sourceRefs === undefined ? undefined : sanitizeAdapterInputSourceRefs(opts.sourceRefs);
	const metadata = sanitizeProviderGraphVisibleRecord(opts.metadata);
	return {
		kind: "admitted",
		proposalId: proposal.proposalId,
		requestId: opts.requestId,
		operationId: opts.operationId,
		effectRunId: proposal.effectRunId,
		agentRunId: proposal.agentRunId,
		admittedAtMs: opts.admittedAtMs,
		...(opts.reason === undefined
			? {}
			: { reason: boundPublicText(opts.reason, maxPublicReasonChars()).text }),
		...(sourceRefs === undefined || sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(metadata === undefined ? {} : { metadata }),
	};
}

export function issueAgentRequest(
	proposal: AgentRequestProposal,
	admission: AgentRequestAdmitted,
	opts: { readonly issuedAtMs?: number; readonly sourceRefs?: readonly SourceRef[] } = {},
): AgentRequestIssued {
	const input = sanitizeAgentRequestInput(proposal.input);
	const payload = sanitizeAgentRequestMaterial(proposal.payload);
	const sourceRefs = sanitizeAdapterInputSourceRefs(opts.sourceRefs ?? admission.sourceRefs ?? []);
	const metadata = sanitizeProviderGraphVisibleRecord(proposal.metadata);
	return {
		kind: "issued",
		requestId: admission.requestId,
		operationId: admission.operationId,
		effectRunId: admission.effectRunId,
		agentRunId: admission.agentRunId,
		proposalId: proposal.proposalId,
		parentRequestId: proposal.parentRequestId,
		requestKind: proposal.requestKind,
		required: proposal.required ?? true,
		...(input === undefined ? {} : { input }),
		...(payload === undefined ? {} : { payload }),
		issuedAtMs: opts.issuedAtMs,
		...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(metadata === undefined ? {} : { metadata }),
	};
}

export function sanitizeAgentRequestInput<T>(
	input: AgentRequestInput<T> | undefined,
): AgentRequestInput<T> | undefined {
	if (input === undefined) return undefined;
	const {
		value: rawValue,
		subjectRefs: rawSubjectRefs,
		metadata: rawMetadata,
		...inputFields
	} = input;
	const value = sanitizeAgentRequestMaterial(rawValue);
	const subjectRefs =
		rawSubjectRefs === undefined ? undefined : sanitizeAdapterInputSourceRefs(rawSubjectRefs);
	const metadata = sanitizeProviderGraphVisibleRecord(rawMetadata);
	return Object.freeze({
		...inputFields,
		...(value === undefined ? {} : { value }),
		...(subjectRefs === undefined || subjectRefs.length === 0 ? {} : { subjectRefs }),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies AgentRequestInput<T>) as AgentRequestInput<T>;
}

export function sanitizeAgentRequestMaterial<T>(value: T | undefined): T | undefined {
	if (value === undefined) return undefined;
	if (publicMaterialForbiddenKeys(value, "provider").length > 0) return undefined;
	return cloneGraphVisibleMaterial(value) as T;
}

export function sanitizeAgentRequestIssued(request: AgentRequestIssued): AgentRequestIssued {
	const input = sanitizeAgentRequestInput(request.input);
	const payload = sanitizeAgentRequestMaterial(request.payload);
	const sourceRefs =
		request.sourceRefs === undefined
			? undefined
			: sanitizeAdapterInputSourceRefs(request.sourceRefs);
	const metadata = sanitizeProviderGraphVisibleRecord(request.metadata);
	return Object.freeze({
		kind: "issued",
		requestId: request.requestId,
		operationId: request.operationId,
		effectRunId: request.effectRunId,
		...(request.agentRunId === undefined ? {} : { agentRunId: request.agentRunId }),
		...(request.proposalId === undefined ? {} : { proposalId: request.proposalId }),
		...(request.parentRequestId === undefined ? {} : { parentRequestId: request.parentRequestId }),
		requestKind: request.requestKind,
		required: request.required,
		...(input === undefined ? {} : { input }),
		...(payload === undefined ? {} : { payload }),
		...(request.issuedAtMs === undefined ? {} : { issuedAtMs: request.issuedAtMs }),
		...(sourceRefs === undefined || sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies AgentRequestIssued);
}

export function agentRequestLedgerViews(
	graph: Graph,
	facts: Node<AgentRequestFact>,
	opts: { readonly name?: string } = {},
): AgentRequestLedgerBundle {
	const name = opts.name ?? "agentRequests";
	const views = graph.node<AgentRequestViews>(
		[facts],
		(ctx) => {
			const prev = ctx.state.get<AgentRequestViewsState>() ?? emptyAgentRequestViewsState();
			const next = cloneAgentRequestViewsState(prev);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				reduceAgentRequestViews(next, fact);
			}
			ctx.state.set(next);
			ctx.down([["DATA", freezeAgentRequestViews(next)]]);
		},
		{ name: `${name}/views`, factory: "agentRequestLedgerViews" },
	);
	const issues = graph.node<DataIssue>(
		[facts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "rejected") ctx.down([["DATA", sanitizeAdapterInputIssue(fact.issue)]]);
				if (fact.kind === "status") {
					for (const issue of fact.issues ?? []) {
						ctx.down([["DATA", sanitizeAdapterInputIssue(issue)]]);
					}
				}
			}
		},
		{ name: `${name}/issues`, factory: "agentRequestLedgerIssues" },
	);
	const audit = graph.node<AgentRuntimeAuditRecord>(
		[facts],
		(ctx) => {
			let seq = ctx.state.get<number>() ?? 0;
			for (const raw of depBatch(ctx, 0) ?? []) {
				seq += 1;
				const fact = raw as AgentRequestFact;
				ctx.down([
					[
						"DATA",
						{
							id: `${name}:ledger:${seq}`,
							kind: `agent-request-${fact.kind}`,
							subjectId: "requestId" in fact ? fact.requestId : fact.proposalId,
						} satisfies AgentRuntimeAuditRecord,
					],
				]);
			}
			ctx.state.set(seq);
		},
		{ name: `${name}/audit`, factory: "agentRequestLedgerAudit" },
	);
	return { views, issues, audit };
}

export interface AgentRequestViewsState {
	requestsById: Map<string, AgentRequestIssued>;
	requestsByEffectRun: Map<string, string[]>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	issues: DataIssue[];
	audit: AgentRuntimeAuditRecord[];
	auditSeq: number;
}

export function emptyAgentRequestViewsState(): AgentRequestViewsState {
	return {
		requestsById: new Map<string, AgentRequestIssued>(),
		requestsByEffectRun: new Map<string, string[]>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		issues: [],
		audit: [],
		auditSeq: 0,
	};
}

export function cloneAgentRequestViewsState(state: AgentRequestViewsState): AgentRequestViewsState {
	return {
		requestsById: new Map(state.requestsById),
		requestsByEffectRun: new Map(Array.from(state.requestsByEffectRun, ([k, v]) => [k, [...v]])),
		statusByRequest: new Map(state.statusByRequest),
		issues: [...state.issues],
		audit: [...state.audit],
		auditSeq: state.auditSeq,
	};
}

export function reduceAgentRequestViews(
	state: AgentRequestViewsState,
	fact: AgentRequestFact,
): void {
	state.auditSeq += 1;
	if (fact.kind === "issued") {
		const request = sanitizeAgentRequestIssued(fact);
		state.requestsById.set(request.requestId, request);
		const requestIds = state.requestsByEffectRun.get(request.effectRunId) ?? [];
		if (!requestIds.includes(request.requestId)) requestIds.push(request.requestId);
		state.requestsByEffectRun.set(request.effectRunId, requestIds);
		state.statusByRequest.set(request.requestId, {
			kind: "status",
			requestId: request.requestId,
			operationId: request.operationId,
			effectRunId: request.effectRunId,
			status: "issued",
			sourceRefs: [ref("agent-request", request.requestId)],
		});
	} else if (fact.kind === "status") {
		const status = sanitizeAgentRequestStatusChanged(fact);
		state.statusByRequest.set(status.requestId, status);
		if (status.issues !== undefined) state.issues.push(...status.issues);
	} else if (fact.kind === "rejected") {
		state.issues.push(sanitizeAdapterInputIssue(fact.issue));
	}
	state.audit.push({
		id: `agent-request-ledger:${state.auditSeq}`,
		kind: `agent-request-${fact.kind}`,
		subjectId: "requestId" in fact ? fact.requestId : fact.proposalId,
	});
}

export function sanitizeAgentRequestStatusChanged(
	status: AgentRequestStatusChanged,
): AgentRequestStatusChanged {
	const sourceRefs =
		status.sourceRefs === undefined ? undefined : sanitizeAdapterInputSourceRefs(status.sourceRefs);
	const issues =
		status.issues === undefined
			? undefined
			: Object.freeze(status.issues.map((issue) => sanitizeAdapterInputIssue(issue)));
	const metadata = sanitizeProviderGraphVisibleRecord(status.metadata);
	return Object.freeze({
		kind: "status",
		requestId: status.requestId,
		...(status.operationId === undefined ? {} : { operationId: status.operationId }),
		effectRunId: status.effectRunId,
		status: status.status,
		...(sourceRefs === undefined || sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(issues === undefined || issues.length === 0 ? {} : { issues }),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies AgentRequestStatusChanged);
}

export function freezeAgentRequestViews(state: AgentRequestViewsState): AgentRequestViews {
	const pending = Array.from(state.requestsById.values()).filter((request) => {
		const status = state.statusByRequest.get(request.requestId)?.status;
		return status === undefined || !isTerminalRequestStatus(status);
	});
	const awaitingProvider = pending.filter(
		(request) => state.statusByRequest.get(request.requestId)?.status === "awaiting-provider",
	);
	return {
		requestsById: new Map(state.requestsById),
		requestsByEffectRun: new Map(
			Array.from(state.requestsByEffectRun, ([key, value]) => [key, Object.freeze([...value])]),
		),
		statusByRequest: new Map(state.statusByRequest),
		pending: Object.freeze(pending),
		awaitingProvider: Object.freeze(awaitingProvider),
		issues: Object.freeze([...state.issues]),
		audit: Object.freeze([...state.audit]),
	};
}
