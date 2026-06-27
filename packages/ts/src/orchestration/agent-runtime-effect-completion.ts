import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { dataIssue, forEachDepBatch, projectRuntimeFact, ref } from "./agent-runtime-common.js";
import { candidateFromDecision } from "./agent-runtime-decision-interpreter.js";
import type {
	AgentDecision,
	AgentRuntimeAuditRecord,
	EffectRunCompletionBundle,
	EffectRunCompletionStatus,
	EffectRunResult,
} from "./agent-runtime-types-agent.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	AgentRequestStatus,
	AgentRequestStatusChanged,
	EffectRun,
	SourceRef,
} from "./agent-runtime-types-core.js";

export function effectRunCompletionProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly effectRuns: Node<EffectRun>;
		readonly decisions?: readonly Node<AgentDecision>[];
		readonly requestStatuses?: readonly Node<AgentRequestStatusChanged>[];
		readonly requestFacts?: readonly Node<AgentRequestFact>[];
		readonly resultCandidates?: readonly Node<EffectRunResult>[];
		readonly now?: () => number;
	},
): EffectRunCompletionBundle {
	const name = opts.name ?? "effectRunCompletion";
	const decisions = opts.decisions ?? [];
	const requestStatuses = opts.requestStatuses ?? [];
	const requestFacts = opts.requestFacts ?? [];
	const resultCandidates = opts.resultCandidates ?? [];
	const deps = [
		opts.effectRuns,
		...decisions,
		...requestStatuses,
		...requestFacts,
		...resultCandidates,
	];
	const decisionStart = 1;
	const requestStatusStart = decisionStart + decisions.length;
	const requestFactStart = requestStatusStart + requestStatuses.length;
	const resultCandidateStart = requestFactStart + requestFacts.length;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<EffectRunCompletionFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<EffectRunCompletionState>() ?? emptyEffectRunCompletionState();
			const touchedEffectRunIds = new Set<string>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const run = raw as EffectRun;
				state.runs.set(run.effectRunId, run);
				touchedEffectRunIds.add(run.effectRunId);
			}
			forEachDepBatch(ctx, requestFactStart, requestFacts.length, (raw) => {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") {
					state.requests.set(fact.requestId, fact);
					touchedEffectRunIds.add(fact.effectRunId);
					const existingStatus = state.statusByRequest.get(fact.requestId);
					if (existingStatus !== undefined && !statusMatchesRequest(existingStatus, fact)) {
						emitEffectRunIssue(
							ctx,
							state,
							"stale-request-status",
							`AgentRequest status for '${fact.requestId}' did not match its issued effectRun/operation identity`,
							fact.effectRunId,
							[ref("agent-request", fact.requestId)],
						);
					}
					const result = state.resultsByEffectRun.get(fact.effectRunId);
					if (result !== undefined && fact.required) {
						state.issueSeq += 1;
						const issue = dataIssue(
							"late-required-request-after-effect-run-result",
							`Required request '${fact.requestId}' arrived after EffectRun '${fact.effectRunId}' already had a terminal result`,
							{
								subjectId: fact.effectRunId,
								refs: [
									ref("agent-request", fact.requestId),
									ref("effect-run-result", result.resultId),
								],
							},
						);
						ctx.down([
							["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
							[
								"DATA",
								{
									kind: "audit",
									audit: {
										id: `${fact.effectRunId}:late-required-request:${state.issueSeq}`,
										kind: "late-required-request-after-effect-run-result",
										subjectId: fact.effectRunId,
										issueCode: issue.code,
										sourceRefs: [
											ref("agent-request", fact.requestId),
											ref("effect-run-result", result.resultId),
										],
									},
								} satisfies EffectRunCompletionFact,
							],
						]);
					}
				} else if (fact.kind === "status") {
					acceptRequestStatus(ctx, state, fact);
					touchedEffectRunIds.add(fact.effectRunId);
				}
			});
			forEachDepBatch(ctx, requestStatusStart, requestStatuses.length, (raw) => {
				const status = raw as AgentRequestStatusChanged;
				acceptRequestStatus(ctx, state, status);
				touchedEffectRunIds.add(status.effectRunId);
			});
			forEachDepBatch(ctx, resultCandidateStart, resultCandidates.length, (raw) => {
				acceptEffectRunResultCandidate(ctx, state, raw as EffectRunResult);
			});
			forEachDepBatch(ctx, decisionStart, decisions.length, (raw) => {
				const decision = raw as AgentDecision;
				state.decisions.set(decision.decisionId, decision);
				touchedEffectRunIds.add(decision.effectRunId);
			});
			for (const decision of state.decisions.values()) {
				if (state.resultsByEffectRun.has(decision.effectRunId)) continue;
				const candidate = candidateFromDecision(decision, state, now());
				if (candidate === undefined) continue;
				acceptEffectRunResultCandidate(ctx, state, candidate);
			}
			for (const effectRunId of touchedEffectRunIds) {
				if (!state.resultsByEffectRun.has(effectRunId)) {
					emitEffectRunStatus(
						ctx,
						effectRunId,
						"pending",
						requiredPendingRequests(effectRunId, state),
						requiredTerminalRequests(effectRunId, state),
					);
				}
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "effectRunCompletionProjector" },
	);
	return {
		results: projectRuntimeFact(
			graph,
			runtime,
			`${name}/results`,
			"effectRunCompletionResults",
			(fact) => (fact.kind === "result" ? fact.result : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"effectRunCompletionStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"effectRunCompletionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"effectRunCompletionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export type EffectRunCompletionFact =
	| { readonly kind: "result"; readonly result: EffectRunResult }
	| { readonly kind: "status"; readonly status: EffectRunCompletionStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface EffectRunCompletionState {
	runs: Map<string, EffectRun>;
	requests: Map<string, AgentRequestIssued>;
	statusByRequest: Map<string, AgentRequestStatusChanged>;
	decisions: Map<string, AgentDecision>;
	resultsByEffectRun: Map<string, EffectRunResult>;
	issueSeq: number;
}

export function acceptEffectRunResultCandidate(
	ctx: Ctx,
	state: EffectRunCompletionState,
	candidate: EffectRunResult,
): void {
	if (!state.runs.has(candidate.effectRunId)) {
		emitEffectRunIssue(
			ctx,
			state,
			"unknown-effect-run-result-candidate",
			`EffectRunResult candidate '${candidate.resultId}' references unknown EffectRun '${candidate.effectRunId}'`,
			candidate.effectRunId,
			candidate.sourceRefs,
		);
		return;
	}
	const existing = state.resultsByEffectRun.get(candidate.effectRunId);
	if (existing !== undefined) {
		state.issueSeq += 1;
		const duplicate = sameTerminalResult(existing, candidate);
		const code = duplicate ? "duplicate-effect-run-result" : "conflicting-effect-run-result";
		const issue = dataIssue(
			code,
			`EffectRun '${candidate.effectRunId}' already has a terminal result`,
			{
				subjectId: candidate.effectRunId,
				refs: candidate.sourceRefs,
			},
		);
		ctx.down([
			["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
			[
				"DATA",
				{
					kind: "audit",
					audit: {
						id: `${candidate.effectRunId}:${code}:${state.issueSeq}`,
						kind: duplicate ? "effect-run-result-duplicate" : "effect-run-result-conflict",
						subjectId: candidate.effectRunId,
						issueCode: issue.code,
						sourceRefs: candidate.sourceRefs,
					},
				} satisfies EffectRunCompletionFact,
			],
		]);
		return;
	}
	state.resultsByEffectRun.set(candidate.effectRunId, candidate);
	ctx.down([
		["DATA", { kind: "result", result: candidate } satisfies EffectRunCompletionFact],
		[
			"DATA",
			{
				kind: "status",
				status: {
					effectRunId: candidate.effectRunId,
					state: candidate.status,
					requiredPending: [],
					requiredTerminal: requiredTerminalRequests(candidate.effectRunId, state),
					sourceRefs: candidate.sourceRefs,
				},
			} satisfies EffectRunCompletionFact,
		],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${candidate.effectRunId}:terminal-result`,
					kind: "effect-run-terminal-result",
					subjectId: candidate.effectRunId,
					sourceRefs: candidate.sourceRefs,
					metadata: { status: candidate.status },
				},
			} satisfies EffectRunCompletionFact,
		],
	]);
}

export function emitEffectRunStatus(
	ctx: Ctx,
	effectRunId: string,
	state: EffectRunCompletionStatus["state"],
	requiredPending: readonly string[],
	requiredTerminal: readonly string[],
): void {
	ctx.down([
		[
			"DATA",
			{
				kind: "status",
				status: { effectRunId, state, requiredPending, requiredTerminal },
			} satisfies EffectRunCompletionFact,
		],
	]);
}

export function requiredPendingRequests(
	effectRunId: string,
	state: EffectRunCompletionState,
): readonly string[] {
	const pending: string[] = [];
	for (const request of state.requests.values()) {
		if (request.effectRunId !== effectRunId || !request.required) continue;
		const statusFact = matchingStatusForRequest(state, request);
		const status = statusFact?.status;
		if (status === undefined || !isTerminalRequestStatus(status)) pending.push(request.requestId);
	}
	return pending;
}

export function requiredTerminalRequests(
	effectRunId: string,
	state: EffectRunCompletionState,
): readonly string[] {
	const terminal: string[] = [];
	for (const request of state.requests.values()) {
		if (request.effectRunId !== effectRunId || !request.required) continue;
		const statusFact = matchingStatusForRequest(state, request);
		const status = statusFact?.status;
		if (status !== undefined && isTerminalRequestStatus(status)) terminal.push(request.requestId);
	}
	return terminal;
}

export function isTerminalRequestStatus(status: AgentRequestStatus): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "blocked" ||
		status === "canceled" ||
		status === "timeout" ||
		status === "waived" ||
		status === "retry-exhausted"
	);
}

export function decisionSourceRequestTerminal(
	decision: AgentDecision,
	state: EffectRunCompletionState,
): boolean {
	const request = state.requests.get(decision.source.requestId);
	if (request === undefined) return false;
	if (
		request.effectRunId !== decision.effectRunId ||
		request.operationId !== decision.source.operationId
	) {
		return false;
	}
	const status = matchingStatusForRequest(state, request)?.status;
	return status !== undefined && isTerminalRequestStatus(status);
}

export function acceptRequestStatus(
	ctx: Ctx,
	state: EffectRunCompletionState,
	status: AgentRequestStatusChanged,
): void {
	const request = state.requests.get(status.requestId);
	if (request !== undefined && !statusMatchesRequest(status, request)) {
		emitEffectRunIssue(
			ctx,
			state,
			"stale-request-status",
			`AgentRequest status for '${status.requestId}' did not match its issued effectRun/operation identity`,
			request.effectRunId,
			[ref("agent-request", status.requestId)],
		);
		return;
	}
	state.statusByRequest.set(status.requestId, status);
}

export function matchingStatusForRequest(
	state: EffectRunCompletionState,
	request: AgentRequestIssued,
): AgentRequestStatusChanged | undefined {
	const status = state.statusByRequest.get(request.requestId);
	if (status === undefined) return undefined;
	return statusMatchesRequest(status, request) ? status : undefined;
}

export function statusMatchesRequest(
	status: AgentRequestStatusChanged,
	request: AgentRequestIssued,
): boolean {
	return (
		status.effectRunId === request.effectRunId &&
		(status.operationId === undefined || status.operationId === request.operationId)
	);
}

export function emitEffectRunIssue(
	ctx: Ctx,
	state: EffectRunCompletionState,
	code: string,
	message: string,
	subjectId?: string,
	sourceRefs?: readonly SourceRef[],
): void {
	state.issueSeq += 1;
	const issue = dataIssue(code, message, { subjectId, refs: sourceRefs });
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies EffectRunCompletionFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${subjectId ?? "effect-run"}:${code}:${state.issueSeq}`,
					kind: "effect-run-issue",
					subjectId,
					issueCode: code,
					message,
					sourceRefs,
				},
			} satisfies EffectRunCompletionFact,
		],
	]);
}

export function sameTerminalResult(a: EffectRunResult, b: EffectRunResult): boolean {
	return (
		a.status === b.status && a.resultId === b.resultId && JSON.stringify(a) === JSON.stringify(b)
	);
}

export function emptyEffectRunCompletionState(): EffectRunCompletionState {
	return {
		runs: new Map<string, EffectRun>(),
		requests: new Map<string, AgentRequestIssued>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		decisions: new Map<string, AgentDecision>(),
		resultsByEffectRun: new Map<string, EffectRunResult>(),
		issueSeq: 0,
	};
}
