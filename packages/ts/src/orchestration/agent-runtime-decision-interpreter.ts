import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import {
	dataIssue,
	forEachDepBatch,
	isRecord,
	projectRuntimeFact,
	ref,
} from "./agent-runtime-common.js";
import type { EffectRunCompletionState } from "./agent-runtime-effect-completion.js";
import {
	decisionSourceRequestTerminal,
	requiredPendingRequests,
} from "./agent-runtime-effect-completion.js";
import type {
	AgentDecision,
	AgentDecisionBlocked,
	AgentDecisionContinue,
	AgentDecisionFinal,
	AgentRuntimeAuditRecord,
	EffectRunResult,
	StructuredAgentDecisionEnvelope,
	StructuredAgentDecisionInterpreterBundle,
} from "./agent-runtime-types-agent.js";
import type {
	AgentRequestFact,
	AgentRequestIssued,
	ExecutorOutcome,
} from "./agent-runtime-types-core.js";

/**
 * Creates a structured agent decision interpreter.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param outcomes - outcomes value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The structured agent decision interpreter result.
 * @category orchestration
 * @example
 * ```ts
 * import { structuredAgentDecisionInterpreter } from "@graphrefly/ts/orchestration";
 * ```
 */
export function structuredAgentDecisionInterpreter(
	graph: Graph,
	outcomes: Node<ExecutorOutcome>,
	opts: {
		readonly name?: string;
		readonly schemaRef?: string;
		readonly requestFacts?: readonly Node<AgentRequestFact>[];
	} = {},
): StructuredAgentDecisionInterpreterBundle {
	const name = opts.name ?? "structuredAgentDecisionInterpreter";
	const requestFacts = opts.requestFacts ?? [];
	const runtime = graph.node<StructuredAgentDecisionInterpreterFact>(
		[outcomes, ...requestFacts],
		(ctx) => {
			const state = ctx.state.get<StructuredInterpreterState>() ?? {
				requests: new Map<string, AgentRequestIssued>(),
				issueSeq: 0,
			};
			forEachDepBatch(ctx, 1, requestFacts.length, (raw) => {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") state.requests.set(fact.requestId, fact);
			});
			for (const raw of depBatch(ctx, 0) ?? []) {
				const outcome = raw as ExecutorOutcome;
				if (outcome.kind !== "result") {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"non-result-outcome",
						"Only result outcomes can carry AgentDecision envelopes",
					);
					continue;
				}
				const value = outcome.result.value;
				if (!isRecord(value)) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"malformed-agent-decision",
						"ExecutorOutcome result must carry a structured agent-decision envelope",
					);
					continue;
				}
				const envelope = value as Partial<StructuredAgentDecisionEnvelope>;
				if (envelope.kind !== "agent-decision" || !isRecord(envelope.decision)) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"malformed-agent-decision",
						"Structured agent-decision envelope is missing kind or decision",
					);
					continue;
				}
				if (typeof envelope.schemaRef !== "string" || envelope.schemaRef.length === 0) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"missing-agent-decision-schema",
						"Structured agent-decision envelope must carry schemaRef evidence",
					);
					continue;
				}
				if (opts.schemaRef !== undefined && envelope.schemaRef !== opts.schemaRef) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"agent-decision-schema-mismatch",
						"Structured agent-decision envelope schemaRef did not match",
					);
					continue;
				}
				const decision = validateAgentDecision(envelope.decision, outcome);
				if (typeof decision === "string") {
					state.issueSeq += 1;
					emitInterpreterIssue(ctx, state.issueSeq, outcome, "malformed-agent-decision", decision);
					continue;
				}
				const request = state.requests.get(decision.source.requestId);
				if (request === undefined) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"missing-agent-decision-request",
						"AgentDecision source request must be present in the request ledger",
					);
					continue;
				}
				if (
					request.effectRunId !== decision.effectRunId ||
					request.operationId !== decision.source.operationId
				) {
					state.issueSeq += 1;
					emitInterpreterIssue(
						ctx,
						state.issueSeq,
						outcome,
						"stale-agent-decision-source",
						"AgentDecision source request/effectRun/operation identity did not match the request ledger",
					);
					continue;
				}
				ctx.down([
					["DATA", { kind: "decision", decision } satisfies StructuredAgentDecisionInterpreterFact],
					[
						"DATA",
						{
							kind: "audit",
							audit: {
								id: `${outcome.outcomeId}:agent-decision-interpreted`,
								kind: "agent-decision-interpreted",
								subjectId: decision.effectRunId,
								sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
							},
						} satisfies StructuredAgentDecisionInterpreterFact,
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "structuredAgentDecisionInterpreter" },
	);
	return {
		decisions: projectRuntimeFact(
			graph,
			runtime,
			`${name}/decisions`,
			"structuredAgentDecisions",
			(fact) => (fact.kind === "decision" ? fact.decision : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"structuredAgentDecisionIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"structuredAgentDecisionAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export type StructuredAgentDecisionInterpreterFact =
	| { readonly kind: "decision"; readonly decision: AgentDecision }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface StructuredInterpreterState {
	requests: Map<string, AgentRequestIssued>;
	issueSeq: number;
}

export function emitInterpreterIssue(
	ctx: Ctx,
	seq: number,
	outcome: ExecutorOutcome,
	code: string,
	message: string,
): void {
	const issue = dataIssue(code, message, {
		subjectId: outcome.requestId,
		refs: [ref("executor-outcome", outcome.outcomeId)],
	});
	ctx.down([
		["DATA", { kind: "issue", issue } satisfies StructuredAgentDecisionInterpreterFact],
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${outcome.outcomeId}:agent-decision-issue:${seq}`,
					kind: "agent-decision-issue",
					subjectId: outcome.requestId,
					issueCode: code,
					message,
					sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
				},
			} satisfies StructuredAgentDecisionInterpreterFact,
		],
	]);
}

export function validateAgentDecision(
	raw: unknown,
	outcome: ExecutorOutcome,
): AgentDecision | string {
	if (!isRecord(raw)) return "AgentDecision must be an object";
	const kind = raw.kind;
	if (kind !== "continue" && kind !== "final" && kind !== "blocked") {
		return "AgentDecision kind must be continue, final, or blocked";
	}
	if (typeof raw.decisionId !== "string" || raw.decisionId.length === 0)
		return "AgentDecision decisionId must be a non-empty string";
	if (
		raw.effectRunId === undefined ||
		typeof raw.effectRunId !== "string" ||
		raw.effectRunId.length === 0
	)
		return "AgentDecision effectRunId must be a non-empty string";
	if (typeof raw.agentRunId !== "string" || raw.agentRunId.length === 0)
		return "AgentDecision agentRunId must be a non-empty string";
	const source = raw.source;
	if (
		!isRecord(source) ||
		source.requestId !== outcome.requestId ||
		source.operationId !== outcome.operationId ||
		source.outcomeId !== outcome.outcomeId
	) {
		return "AgentDecision source must match the ExecutorOutcome requestId, operationId, and outcomeId";
	}
	if (kind === "continue") {
		if (!Array.isArray(raw.next)) return "AgentDecision.continue next must be an array";
		for (const proposal of raw.next) {
			if (!isAgentRequestProposalLike(proposal, raw.effectRunId)) {
				return "AgentDecision.continue next entries must be AgentRequestProposal-like objects";
			}
		}
		return raw as unknown as AgentDecisionContinue;
	}
	if (kind === "final") {
		if (!isRecord(raw.output) || typeof raw.output.kind !== "string")
			return "AgentDecision.final output must be an envelope with kind";
		return raw as unknown as AgentDecisionFinal;
	}
	if (!Array.isArray(raw.needs)) return "AgentDecision.blocked needs must be an array";
	for (const need of raw.needs) {
		if (!isAgentNeedLike(need))
			return "AgentDecision.blocked needs entries must be AgentNeed-like objects";
	}
	return raw as unknown as AgentDecisionBlocked;
}

export function isAgentRequestProposalLike(value: unknown, effectRunId: string): boolean {
	if (!isRecord(value)) return false;
	if (value.kind !== "proposal") return false;
	if (typeof value.proposalId !== "string" || value.proposalId.length === 0) return false;
	if (value.effectRunId !== effectRunId) return false;
	return (
		value.requestKind === "context" ||
		value.requestKind === "prompt" ||
		value.requestKind === "executor"
	);
}

export function isAgentNeedLike(value: unknown): boolean {
	return isRecord(value) && typeof value.kind === "string" && value.kind.length > 0;
}

export function candidateFromDecision(
	decision: AgentDecision,
	state: EffectRunCompletionState,
	completedAtMs: number,
): EffectRunResult | undefined {
	const run = state.runs.get(decision.effectRunId);
	if (run === undefined) return undefined;
	if (!decisionSourceRequestTerminal(decision, state)) return undefined;
	const requiredPending = requiredPendingRequests(decision.effectRunId, state);
	if (decision.kind === "final") {
		if (requiredPending.length > 0) {
			return undefined;
		}
		return {
			kind: "effect-run-result",
			resultId: `${decision.effectRunId}:result`,
			status: "completed",
			effectRunId: decision.effectRunId,
			subjectRefs: run.subjectRefs,
			operationId: decision.source.operationId,
			sourceRefs: [
				ref("agent-decision", decision.decisionId),
				ref("executor-outcome", decision.source.outcomeId),
			],
			completedAtMs,
			output: decision.output,
		};
	}
	if (decision.kind === "blocked" && requiredPending.length === 0) {
		return {
			kind: "effect-run-result",
			resultId: `${decision.effectRunId}:result`,
			status: "blocked",
			effectRunId: decision.effectRunId,
			subjectRefs: run.subjectRefs,
			operationId: decision.source.operationId,
			sourceRefs: [
				ref("agent-decision", decision.decisionId),
				ref("executor-outcome", decision.source.outcomeId),
			],
			completedAtMs,
			needs: decision.needs,
		};
	}
	return undefined;
}
