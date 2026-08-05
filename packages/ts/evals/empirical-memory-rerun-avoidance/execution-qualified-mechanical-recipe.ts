import { depBatch } from "../../src/ctx/types.js";
import type { DataIssue } from "../../src/data/index.js";
import type { Graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { Node } from "../../src/node/node.js";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestLedgerBundle,
	type AgentRequestProposal,
	admitAgentRequestProposal,
	agentRequestLedgerViews,
	type EffectRun,
	type EffectRunResult,
	issueAgentRequest,
} from "../../src/orchestration/agent-runtime.js";
import {
	type WorkItemSeed,
	workItemEffectRunProjector,
} from "../../src/orchestration/work-item-runtime.js";
import {
	type WorkItemEffectPlanProposed,
	type WorkItemProjection,
	workItemEffectPlanProjector,
} from "../../src/solutions/work-item/scheduling.js";
import { strictSnapshot } from "./canonical.js";

export const D682_MECHANICAL_RECIPE_REVISION = "b112.execution-qualified-mechanical-recipe.d682.v1";
export const D682_MECHANICAL_MAX_ACTIONS = 16;
export const D682_MECHANICAL_MAX_CANONICAL_ACTION_BYTES = 262_144;
export const D682_MECHANICAL_MAX_CANONICAL_PROPOSAL_BYTES = 393_216;
const D682_MECHANICAL_MAX_COORDINATE_CODE_UNITS = 256;

export interface D682MechanicalAction<TInput = unknown> {
	readonly memberId: string;
	readonly effectKind: string;
	readonly input: TInput;
}

export interface D682MechanicalRecipeBundle<TInput = unknown> {
	readonly admittedProposals: Node<WorkItemEffectPlanProposed<TInput>>;
	readonly proposalIssues: Node<DataIssue>;
	readonly plan: ReturnType<typeof workItemEffectPlanProjector<TInput>>;
	readonly effectRuns: ReturnType<typeof workItemEffectRunProjector>;
	readonly admittedEffectRunResults: Node<EffectRunResult>;
	readonly resultIssues: Node<DataIssue>;
	readonly requestFacts: Node<AgentRequestFact>;
	readonly requestLedger: AgentRequestLedgerBundle;
	readonly agentRequests: Node<AgentRequestIssued>;
}

export interface D682EffectRunCompletionV1 {
	readonly kind: "d682-effect-run-completion";
	/** Frozen issued tuple emitted by this recipe and admitted by the outer runner capability. */
	readonly issuedRequest: AgentRequestIssued;
	readonly decisionId: string;
	readonly outcomeId: string;
	readonly result: EffectRunResult;
}

export interface D682EffectRunCompletionAdmissionV1 {
	readonly recordIssued: (request: AgentRequestIssued) => void;
	readonly issueCode: (completion: unknown) => string | null;
}

function d682Record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function d682Coordinate(value: string, field: string): string {
	if (
		value.length === 0 ||
		value.length > D682_MECHANICAL_MAX_COORDINATE_CODE_UNITS ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
	) {
		throw new TypeError(`${field} must be a bounded portable coordinate`);
	}
	return value;
}

/** Package-private, bounded outer-runner capability for exact issued-request completion binding. */
export function createD682EffectRunCompletionAdmission(): D682EffectRunCompletionAdmissionV1 {
	const issuedCapabilities = new WeakSet<object>();
	const issued = new Map<
		string,
		{ readonly effectRunId: string; readonly operationId: string; readonly requestId: string }
	>();
	return Object.freeze({
		recordIssued(request: AgentRequestIssued): void {
			if (request.kind !== "issued")
				throw new TypeError("D682 completion admission requires issued");
			for (const [field, coordinate] of [
				["requestId", request.requestId],
				["effectRunId", request.effectRunId],
				["operationId", request.operationId],
			] as const) {
				d682Coordinate(coordinate, `d682.completionAdmission.${field}`);
			}
			const existing = issued.get(request.requestId);
			if (existing !== undefined) {
				if (
					existing.effectRunId !== request.effectRunId ||
					existing.operationId !== request.operationId
				) {
					throw new TypeError("D682 completion admission rejected a reused requestId");
				}
				return;
			}
			if (issued.size >= D682_MECHANICAL_MAX_ACTIONS) {
				throw new TypeError("D682 completion admission exceeded its issued-request bound");
			}
			issued.set(
				request.requestId,
				Object.freeze({
					requestId: request.requestId,
					effectRunId: request.effectRunId,
					operationId: request.operationId,
				}),
			);
			issuedCapabilities.add(request);
		},
		issueCode(completion: unknown): string | null {
			if (
				!d682Record(completion) ||
				completion.kind !== "d682-effect-run-completion" ||
				!d682Record(completion.issuedRequest) ||
				!d682Record(completion.result)
			) {
				return "d682-effect-run-result-malformed";
			}
			const request = completion.issuedRequest;
			const result = completion.result;
			if (!issuedCapabilities.has(request)) {
				return "d682-effect-run-result-unissued-request";
			}
			if (
				typeof request.requestId !== "string" ||
				typeof request.effectRunId !== "string" ||
				typeof request.operationId !== "string" ||
				typeof result.effectRunId !== "string" ||
				typeof result.operationId !== "string"
			) {
				return "d682-effect-run-result-malformed";
			}
			const tuple = issued.get(request.requestId);
			if (
				tuple === undefined ||
				tuple.effectRunId !== request.effectRunId ||
				tuple.operationId !== request.operationId
			) {
				return "d682-effect-run-result-unissued-request";
			}
			if (result.effectRunId !== tuple.effectRunId || result.operationId !== tuple.operationId) {
				return "d682-effect-run-result-operation-mismatch";
			}
			if (typeof completion.decisionId !== "string" || typeof completion.outcomeId !== "string") {
				return "d682-effect-run-result-completion-evidence-mismatch";
			}
			try {
				d682Coordinate(completion.decisionId, "d682.completion.decisionId");
				d682Coordinate(completion.outcomeId, "d682.completion.outcomeId");
			} catch {
				return "d682-effect-run-result-completion-evidence-mismatch";
			}
			const sourceRefs = result.sourceRefs;
			if (
				!Array.isArray(sourceRefs) ||
				sourceRefs.length !== 2 ||
				!d682Record(sourceRefs[0]) ||
				sourceRefs[0].kind !== "agent-decision" ||
				sourceRefs[0].id !== completion.decisionId ||
				!d682Record(sourceRefs[1]) ||
				sourceRefs[1].kind !== "executor-outcome" ||
				sourceRefs[1].id !== completion.outcomeId
			) {
				return "d682-effect-run-result-completion-evidence-mismatch";
			}
			return null;
		},
	});
}

/**
 * Package-private D682 prototype for mechanically lowering serial actions into a WorkItem plan.
 * It is deliberately not reachable from a package export.
 */
export function createD682SerialEffectPlanProposal<TInput>(input: {
	readonly planId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly actions: readonly D682MechanicalAction<TInput>[];
}): WorkItemEffectPlanProposed<TInput> {
	d682Coordinate(input.planId, "d682.planId");
	d682Coordinate(input.workItemId, "d682.workItemId");
	if (!Number.isSafeInteger(input.executionInputRevision) || input.executionInputRevision < 1) {
		throw new TypeError("d682.executionInputRevision must be a positive safe integer");
	}
	if (input.actions.length < 1 || input.actions.length > D682_MECHANICAL_MAX_ACTIONS) {
		throw new TypeError(`d682.actions must contain 1..${D682_MECHANICAL_MAX_ACTIONS} members`);
	}
	const memberIds = new Set<string>();
	for (const action of input.actions) {
		d682Coordinate(action.memberId, "d682.actions.memberId");
		d682Coordinate(action.effectKind, "d682.actions.effectKind");
		if (memberIds.has(action.memberId)) throw new TypeError("d682.actions memberId must be unique");
		memberIds.add(action.memberId);
	}
	let canonicalActions: readonly D682MechanicalAction<TInput>[];
	let canonicalActionBytesExceeded = false;
	try {
		const encoded = strictJsonCodec.encode(input.actions as never);
		if (encoded.byteLength > D682_MECHANICAL_MAX_CANONICAL_ACTION_BYTES) {
			canonicalActionBytesExceeded = true;
			throw new RangeError("d682.actions exceed the canonical byte bound");
		}
		canonicalActions = strictSnapshot(
			strictJsonCodec.decode(encoded),
		) as unknown as readonly D682MechanicalAction<TInput>[];
	} catch {
		throw new TypeError(
			canonicalActionBytesExceeded
				? "d682.actions exceed the canonical byte bound"
				: "d682.actions must be strict canonical JSON material",
		);
	}
	return Object.freeze({
		kind: "work-item-effect-plan-proposed" as const,
		planId: input.planId,
		workItemId: input.workItemId,
		executionInputRevision: input.executionInputRevision,
		joinPolicy: "all-required" as const,
		members: Object.freeze(
			canonicalActions.map((action, index) =>
				Object.freeze({
					memberId: action.memberId,
					effectKind: action.effectKind,
					required: true,
					dependsOnMemberIds:
						index === 0
							? Object.freeze([])
							: Object.freeze([canonicalActions[index - 1]!.memberId]),
					goal: Object.freeze({
						kind: "d682-mechanical-action",
						input: Object.freeze({
							inputId: `${input.planId}:${action.memberId}:input`,
							inputKind: action.effectKind,
							dataMode: "inline" as const,
							value: action.input,
						}),
					}),
					metadata: Object.freeze({ recipeRevision: D682_MECHANICAL_RECIPE_REVISION }),
				}),
			),
		),
		metadata: Object.freeze({ recipeRevision: D682_MECHANICAL_RECIPE_REVISION }),
	});
}

/**
 * Package-private D682 prototype for the default mechanical
 * WorkItemEffectPlan -> EffectRun -> AgentRequest path.
 *
 * The recipe issues one request for each newly eligible EffectRun. It never executes an effect,
 * schedules work, retries, or invents dependencies; EffectRunResult feedback releases the next
 * plan member through the existing WorkItem projector.
 */
export function createD682ExecutionQualifiedMechanicalRecipe<TInput>(
	graph: Graph,
	input: {
		readonly workItems: Node<WorkItemProjection<TInput>>;
		readonly workItemSeeds: Node<WorkItemSeed>;
		readonly proposals: Node<WorkItemEffectPlanProposed<TInput>>;
		readonly effectRunCompletions: Node<D682EffectRunCompletionV1>;
		readonly completionAdmission: D682EffectRunCompletionAdmissionV1;
		readonly allowedEffectKinds: readonly string[];
	},
): D682MechanicalRecipeBundle<TInput> {
	if (
		input.allowedEffectKinds.length < 1 ||
		input.allowedEffectKinds.length > D682_MECHANICAL_MAX_ACTIONS
	) {
		throw new TypeError(
			`d682.allowedEffectKinds must contain 1..${D682_MECHANICAL_MAX_ACTIONS} entries`,
		);
	}
	const allowedEffectKinds = new Set<string>();
	for (const effectKind of input.allowedEffectKinds) {
		d682Coordinate(effectKind, "d682.allowedEffectKinds");
		if (allowedEffectKinds.has(effectKind)) {
			throw new TypeError("d682.allowedEffectKinds must be unique");
		}
		allowedEffectKinds.add(effectKind);
	}
	const proposalIssueCode = (raw: unknown): string | null => {
		let proposal: WorkItemEffectPlanProposed<TInput>;
		try {
			const encoded = strictJsonCodec.encode(raw as never);
			if (encoded.byteLength > D682_MECHANICAL_MAX_CANONICAL_PROPOSAL_BYTES) {
				return "d682-effect-plan-proposal-byte-bound-exceeded";
			}
			proposal = strictJsonCodec.decode(encoded) as unknown as WorkItemEffectPlanProposed<TInput>;
		} catch {
			return "d682-effect-plan-proposal-not-canonical";
		}
		try {
			d682Coordinate(proposal.planId, "d682.proposal.planId");
			d682Coordinate(proposal.workItemId, "d682.proposal.workItemId");
		} catch {
			return "d682-effect-plan-proposal-coordinate-invalid";
		}
		if (
			proposal.kind !== "work-item-effect-plan-proposed" ||
			!Number.isSafeInteger(proposal.executionInputRevision) ||
			proposal.executionInputRevision < 1 ||
			proposal.joinPolicy !== "all-required" ||
			proposal.metadata?.recipeRevision !== D682_MECHANICAL_RECIPE_REVISION ||
			!Array.isArray(proposal.members) ||
			proposal.members.length < 1 ||
			proposal.members.length > D682_MECHANICAL_MAX_ACTIONS
		) {
			return "d682-effect-plan-proposal-shape-invalid";
		}
		const memberIds = new Set<string>();
		for (const [index, member] of proposal.members.entries()) {
			try {
				d682Coordinate(member.memberId, "d682.proposal.memberId");
				if (
					memberIds.has(member.memberId) ||
					!allowedEffectKinds.has(member.effectKind) ||
					member.required !== true ||
					member.goal.kind !== "d682-mechanical-action" ||
					member.goal.input?.inputKind !== member.effectKind ||
					member.goal.input?.dataMode !== "inline" ||
					member.metadata?.recipeRevision !== D682_MECHANICAL_RECIPE_REVISION
				) {
					return "d682-effect-plan-proposal-member-invalid";
				}
				memberIds.add(member.memberId);
				const dependencies = member.dependsOnMemberIds ?? [];
				const expected = index === 0 ? [] : [proposal.members[index - 1]!.memberId];
				if (
					dependencies.length !== expected.length ||
					dependencies.some(
						(memberId: string, dependencyIndex: number) => memberId !== expected[dependencyIndex],
					)
				) {
					return "d682-effect-plan-proposal-not-serial";
				}
			} catch {
				return "d682-effect-plan-proposal-member-invalid";
			}
		}
		try {
			const actionBytes = strictJsonCodec.encode(
				proposal.members.map((member) => ({
					memberId: member.memberId,
					effectKind: member.effectKind,
					input: member.goal.input?.value,
				})) as never,
			).byteLength;
			if (actionBytes > D682_MECHANICAL_MAX_CANONICAL_ACTION_BYTES) {
				return "d682-effect-plan-action-byte-bound-exceeded";
			}
		} catch {
			return "d682-effect-plan-proposal-not-canonical";
		}
		return null;
	};
	const admittedProposals = graph.node<WorkItemEffectPlanProposed<TInput>>(
		[input.proposals],
		(ctx) => {
			let proposalAdmitted = ctx.state.get<boolean>() ?? false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (proposalIssueCode(raw) !== null) continue;
				if (proposalAdmitted) continue;
				const proposal = strictSnapshot(raw) as WorkItemEffectPlanProposed<TInput>;
				ctx.down([["DATA", proposal]]);
				proposalAdmitted = true;
			}
			ctx.state.set(proposalAdmitted);
		},
		{ name: "d682AdmittedEffectPlanProposals", factory: "d682EffectPlanProposalAdmission" },
	);
	const proposalIssues = graph.node<DataIssue>(
		[input.proposals],
		(ctx) => {
			let proposalAdmitted = ctx.state.get<boolean>() ?? false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				let code = proposalIssueCode(raw);
				if (code === null && proposalAdmitted) code = "d682-effect-plan-proposal-count-exceeded";
				if (code === null) {
					proposalAdmitted = true;
					continue;
				}
				ctx.down([
					[
						"DATA",
						Object.freeze({
							kind: "issue" as const,
							code,
							message: "D682 rejected a plan outside its bounded serial mechanical recipe.",
							severity: "error" as const,
						}),
					],
				]);
			}
			ctx.state.set(proposalAdmitted);
		},
		{ name: "d682EffectPlanProposalIssues", factory: "d682EffectPlanProposalAdmission" },
	);
	const admittedEffectRunResults = graph.node<EffectRunResult>(
		[input.effectRunCompletions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (input.completionAdmission.issueCode(raw) !== null) continue;
				const completion = raw as D682EffectRunCompletionV1;
				const result = strictSnapshot(completion.result) as EffectRunResult;
				ctx.down([["DATA", result]]);
			}
		},
		{ name: "d682AdmittedEffectRunResults", factory: "d682EffectRunResultAdmission" },
	);
	const resultIssues = graph.node<DataIssue>(
		[input.effectRunCompletions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const code = input.completionAdmission.issueCode(raw);
				if (code !== null) {
					ctx.down([
						[
							"DATA",
							Object.freeze({
								kind: "issue" as const,
								code,
								message: "D682 rejected an effect result outside its issued request tuple.",
								severity: "error" as const,
								subjectId:
									d682Record(raw) &&
									d682Record(raw.result) &&
									typeof raw.result.effectRunId === "string"
										? raw.result.effectRunId
										: undefined,
							}),
						],
					]);
				}
			}
		},
		{ name: "d682EffectRunResultIssues", factory: "d682EffectRunResultAdmission" },
	);
	const plan = workItemEffectPlanProjector(graph, {
		workItems: input.workItems,
		proposals: admittedProposals,
		effectRunResults: admittedEffectRunResults,
		policy: { allowedEffectKinds: input.allowedEffectKinds },
		now: () => 0,
	});
	const effectRuns = workItemEffectRunProjector(graph, {
		workItems: input.workItemSeeds,
		effectRequests: plan.effectRequests,
	});
	const requestFacts = graph.node<AgentRequestFact>(
		[effectRuns.effectRuns],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const run = raw as EffectRun<TInput>;
				const requestId = `d682:request:${run.effectRunId}`;
				const proposal: AgentRequestProposal<TInput> = {
					kind: "proposal",
					proposalId: `d682:proposal:${run.effectRunId}`,
					effectRunId: run.effectRunId,
					agentRunId: run.agentRunId,
					requestKind: "executor",
					required: true,
					input: run.goal.input,
					payload: run.goal.input?.value,
					reason: "D682 mechanical effect execution",
					metadata: {
						recipeRevision: D682_MECHANICAL_RECIPE_REVISION,
						effectKind: run.metadata?.effectKind,
					},
				};
				const admission = admitAgentRequestProposal(proposal, {
					requestId,
					operationId: `d682:operation:${run.effectRunId}`,
					admittedAtMs: 0,
					reason: "D682 mechanical admission",
					sourceRefs: run.sourceRefs,
					metadata: { recipeRevision: D682_MECHANICAL_RECIPE_REVISION },
				});
				const issued = Object.freeze(
					issueAgentRequest(proposal, admission, {
						issuedAtMs: 0,
						sourceRefs: run.sourceRefs,
					}),
				);
				input.completionAdmission.recordIssued(issued);
				ctx.down([
					["DATA", proposal],
					["DATA", admission],
					["DATA", issued],
				]);
			}
		},
		{
			name: "d682ExecutionQualifiedMechanicalAgentRequests",
			factory: "d682ExecutionQualifiedMechanicalRecipe",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const agentRequests = graph.node<AgentRequestIssued>(
		[requestFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as AgentRequestFact;
				if (fact.kind === "issued") ctx.down([["DATA", fact]]);
			}
		},
		{ name: "d682IssuedAgentRequests", factory: "d682ExecutionQualifiedMechanicalRecipe" },
	);
	const requestLedger = agentRequestLedgerViews(graph, requestFacts, {
		name: "d682MechanicalAgentRequests",
	});
	return Object.freeze({
		admittedProposals,
		proposalIssues,
		plan,
		effectRuns,
		admittedEffectRunResults,
		resultIssues,
		requestFacts,
		requestLedger,
		agentRequests,
	});
}
