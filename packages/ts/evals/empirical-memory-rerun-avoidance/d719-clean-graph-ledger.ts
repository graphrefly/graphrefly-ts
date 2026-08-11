import { depBatch } from "../../src/ctx/types.js";
import type { DataIssue } from "../../src/data/index.js";
import { graph } from "../../src/graph/graph.js";
import type { AgentRequestIssued, EffectRunResult } from "../../src/orchestration/agent-runtime.js";
import { sanitizeAgentRequestIssued } from "../../src/orchestration/agent-runtime-request-ledger.js";
import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";

export const D719_CLEAN_GRAPH_LEDGER_REVISION =
	"graphrefly.b112.d719.clean-eval-ledger.v3" as const;
export const D719_CLEAN_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d719.clean-eval-evidence.v3" as const;
export const D719_CLEAN_GRAPH_ARM_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
export const D719_MAX_EFFECT_FACTS = 2_048;
export const D719_MAX_ATTEMPTS_PER_LOGICAL_REQUEST = 3;

export type D719CleanArm = (typeof D719_CLEAN_GRAPH_ARM_ORDER)[number];
export type D719CleanRunKind = "primary" | "recovery";
export type D719CleanPhase =
	| "none"
	| "inspection"
	| "exact-mutation"
	| "workspace-diff"
	| "focused-validation-attempted"
	| "focused-validation-passed"
	| "hidden-verifier-attempted"
	| "hidden-verifier-passed";
export type D719NextRequiredPhase =
	| "inspection"
	| "exact-mutation"
	| "workspace-diff"
	| "focused-validation"
	| "hidden-verifier"
	| "complete";
export type D719CleanStoppedReason =
	| "budget-exhausted"
	| "materialization-failed"
	| "workspace-cleanup-failed"
	| "cancelled"
	| "executor-failed"
	| "retry-denied"
	| null;
export type D719CleanDisposition = "recover-current" | "admit-next" | "stop";

export interface D719CleanBudgetLimitsV1 {
	readonly maxRequests: number;
	readonly maxRetryWaits: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
}

export type D719CleanBudgetReason =
	| "request-limit"
	| "retry-wait-limit"
	| "cost-limit"
	| "elapsed-limit";

export interface D719CleanBudgetStateV1 {
	readonly requests: number;
	readonly retryWaits: number;
	readonly costMicrousd: number;
	readonly elapsedMs: number;
}

export interface D719CleanRequestInput {
	readonly authority: "D720";
	readonly arm: D719CleanArm;
	readonly armSequence: number;
	readonly runKind: D719CleanRunKind;
	readonly recoveryOrdinal: 0 | 1;
	readonly requiredPhase: D719NextRequiredPhase;
	readonly sourceDigest: string;
}

export interface D719CallerArmResultV1 {
	readonly materialization: {
		readonly status: "ready" | "failed";
		readonly evidenceDigest: string;
	};
	readonly execution: {
		readonly traceComplete: boolean;
		readonly executorFailed: boolean;
		readonly inspectionObserved: boolean;
		readonly contentChangingMutationObserved: boolean;
		readonly nonEmptyDiffAfterLatestMutation: boolean;
		readonly focusedValidationAttempted: boolean;
		readonly focusedValidationPassed: boolean;
		readonly hiddenVerifierAttempted: boolean;
		readonly hiddenVerifierPassed: boolean;
		readonly cancelled: boolean;
	};
	readonly cleanup: {
		readonly status: "succeeded" | "failed";
		readonly evidenceDigest: string;
	};
}

export type D719EffectKind =
	| "materialization"
	| "provider-request"
	| "retry-wait"
	| "tool-action"
	| "hidden-verifier"
	| "cleanup";
export type D719RetryReason =
	| "none"
	| "d671-rate-limit-exceeded"
	| "d671-provider-overloaded"
	| "d675-und-err-socket"
	| "d710-untyped-http-429";

export interface D719EffectReservationV1 {
	readonly effectKind: D719EffectKind;
	readonly logicalRequestDigest: string;
	readonly routeDigest: string;
	readonly attemptOrdinal: number;
	readonly retryReason: D719RetryReason;
	readonly retryAfterMs: number | null;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
}

export interface D719EffectProposalV1 extends D719EffectReservationV1 {
	readonly kind: "effect-reservation-proposed";
	readonly effectSequence: number;
	readonly arm: D719CleanArm;
	readonly runKind: D719CleanRunKind;
	readonly issuedRequestDigest: string;
	readonly proposalDigest: string;
}

export interface D719EffectAdmissionV1 {
	readonly kind: "effect-admission-decided";
	readonly effectSequence: number;
	readonly arm: D719CleanArm;
	readonly runKind: D719CleanRunKind;
	readonly proposalDigest: string;
	readonly admitted: boolean;
	readonly budgetStateBefore: D719CleanBudgetStateV1;
	readonly budgetStateIfReserved: D719CleanBudgetStateV1;
	readonly budgetReasons: readonly D719CleanBudgetReason[];
	readonly retryAuthorized: boolean;
	readonly decisionDigest: string;
}

export interface D719EffectReconciliationV1 {
	readonly kind: "effect-reconciled";
	readonly effectSequence: number;
	readonly proposalDigest: string;
	readonly admissionDigest: string;
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
	readonly outcome: "completed" | "retryable-failure" | "terminal-failure";
	readonly failureDiscriminator: D719RetryReason;
	readonly basis: "measured" | "conservative-reservation";
	readonly reservationExceeded: boolean;
	readonly retryWaitSatisfied: boolean;
	readonly reconciliationDigest: string;
}

export interface D719CleanEffectControllerV1 {
	readonly revision: "graphrefly.b112.d719.effect-controller.v2";
}

export interface D719AdmittedArmFactV1 {
	readonly kind: "arm-execution-completed" | "arm-executor-failed" | "arm-execution-cancelled";
	readonly runSequence: number;
	readonly armSequence: number;
	readonly arm: D719CleanArm;
	readonly runKind: D719CleanRunKind;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly issuedRequestDigest: string;
	readonly materialization:
		| D719CallerArmResultV1["materialization"]
		| {
				readonly status: "unknown";
				readonly evidenceDigest: string;
		  };
	readonly execution: D719CallerArmResultV1["execution"];
	readonly cleanup:
		| D719CallerArmResultV1["cleanup"]
		| {
				readonly status: "unknown";
				readonly evidenceDigest: string;
		  };
	readonly budgetState: D719CleanBudgetStateV1;
	readonly budgetDenialRefs: readonly string[];
	readonly budgetDenialReasons: readonly D719CleanBudgetReason[];
	readonly retryDenialRefs: readonly string[];
	readonly reservationOverrunRefs: readonly string[];
	readonly effectEvidenceRefs: readonly string[];
	readonly factDigest: string;
}

export interface D719ArmDecisionProjectionV1 {
	readonly kind: "arm-decision";
	readonly runSequence: number;
	readonly armSequence: number;
	readonly arm: D719CleanArm;
	readonly runKind: D719CleanRunKind;
	readonly issuedRequestDigest: string;
	readonly phase: D719CleanPhase;
	readonly nextRequiredPhase: D719NextRequiredPhase;
	readonly evaluable: boolean;
	readonly fullTaskCompleted: boolean;
	readonly budgetState: D719CleanBudgetStateV1;
	readonly budgetReasons: readonly D719CleanBudgetReason[];
	readonly retryWithinBound: boolean;
	readonly stoppedReason: D719CleanStoppedReason;
	readonly disposition: D719CleanDisposition;
	readonly admitNextArm: boolean;
	readonly factDigest: string;
	readonly decisionDigest: string;
}

export interface D719HarnessFindingV1 {
	readonly kind: "harness-finding";
	readonly runSequence: number;
	readonly armSequence: number;
	readonly arm: D719CleanArm;
	readonly runKind: D719CleanRunKind;
	readonly code:
		| "materialization-failed"
		| "budget-exhausted"
		| "cleanup-failed"
		| "cancelled"
		| "executor-failed"
		| "retry-denied"
		| "objective-progress-missing"
		| "workspace-diff-missing"
		| "focused-validation-missing"
		| "hidden-verifier-failed"
		| "full-task-completed";
	readonly phase: D719CleanPhase;
	readonly nextRequiredPhase: D719NextRequiredPhase;
	readonly disposition: D719CleanDisposition;
	readonly evidenceRefs: readonly string[];
	readonly findingDigest: string;
}

export interface D719CleanGraphEvidenceV1 {
	readonly schemaVersion: typeof D719_CLEAN_GRAPH_EVIDENCE_SCHEMA;
	readonly ledgerRevision: typeof D719_CLEAN_GRAPH_LEDGER_REVISION;
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly armOrder: readonly D719CleanArm[];
	readonly issuedRequests: readonly AgentRequestIssued<D719CleanRequestInput>[];
	readonly completedArms: readonly D719CleanArm[];
	readonly effectProposals: readonly D719EffectProposalV1[];
	readonly effectAdmissions: readonly D719EffectAdmissionV1[];
	readonly effectReconciliations: readonly D719EffectReconciliationV1[];
	readonly facts: readonly D719AdmittedArmFactV1[];
	readonly decisions: readonly D719ArmDecisionProjectionV1[];
	readonly findings: readonly D719HarnessFindingV1[];
	readonly runStatus: "complete" | "stopped";
	readonly maxActiveArms: 1;
	readonly topology: {
		readonly nodes: readonly {
			readonly id: string;
			readonly factory: string;
			readonly deps: readonly string[];
		}[];
		readonly edges: readonly { readonly from: string; readonly to: string }[];
	};
	readonly topologyDigest: string;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D719CleanGraphLedgerV1 {
	readonly revision: typeof D719_CLEAN_GRAPH_LEDGER_REVISION;
}

interface ArmDefinition {
	readonly arm: D719CleanArm;
	readonly armSequence: number;
	readonly runKind: D719CleanRunKind;
	readonly recoveryOrdinal: 0 | 1;
	readonly requiredPhase: D719NextRequiredPhase;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly sourceDigest: string;
}

interface ArmIssued extends ArmDefinition {
	readonly kind: "arm-issued";
}

interface SchedulerState {
	readonly definitions: Map<D719CleanArm, ArmDefinition>;
	readonly completed: Set<D719CleanArm>;
	active: ArmIssued | null;
	stopped: boolean;
}

interface OutstandingEffect {
	readonly proposal: D719EffectProposalV1;
	readonly admission: D719EffectAdmissionV1;
}

interface EffectGraphState {
	budget: D719CleanBudgetStateV1;
	readonly outstanding: Map<number, OutstandingEffect>;
	readonly reconciliations: D719EffectReconciliationV1[];
}

interface LedgerState {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly resultNode: ReturnType<typeof createResultNode>;
	readonly effectProposalNode: ReturnType<typeof createEffectProposalNode>;
	readonly effectReconciliationNode: ReturnType<typeof createEffectReconciliationNode>;
	readonly requests: AgentRequestIssued<D719CleanRequestInput>[];
	readonly issuedRequests: AgentRequestIssued<D719CleanRequestInput>[];
	readonly facts: D719AdmittedArmFactV1[];
	readonly decisions: D719ArmDecisionProjectionV1[];
	readonly findings: D719HarnessFindingV1[];
	readonly effectProposals: D719EffectProposalV1[];
	readonly effectAdmissions: D719EffectAdmissionV1[];
	readonly effectReconciliations: D719EffectReconciliationV1[];
	readonly completedArms: D719CleanArm[];
	activeRequest: AgentRequestIssued<D719CleanRequestInput> | null;
	effectSequence: number;
}

interface ControllerState {
	readonly ledger: LedgerState;
	readonly request: AgentRequestIssued<D719CleanRequestInput>;
}

const constructedLedgers = new WeakMap<object, LedgerState>();
const constructedControllers = new WeakMap<object, ControllerState>();

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D719AdmittedArmFactV1>([], null, { name: "d719/clean/externalFacts" });
}
function createResultNode(owner: ReturnType<typeof graph>) {
	return owner.node<EffectRunResult>([], null, { name: "d719/clean/effectRunResults" });
}
function createEffectProposalNode(owner: ReturnType<typeof graph>) {
	return owner.node<D719EffectProposalV1>([], null, { name: "d719/clean/effectProposals" });
}
function createEffectReconciliationNode(owner: ReturnType<typeof graph>) {
	return owner.node<D719EffectReconciliationV1>([], null, {
		name: "d719/clean/effectReconciliations",
	});
}

const ZERO_BUDGET: D719CleanBudgetStateV1 = Object.freeze({
	requests: 0,
	retryWaits: 0,
	costMicrousd: 0,
	elapsedMs: 0,
});

function phaseFor(execution: D719CallerArmResultV1["execution"]): D719CleanPhase {
	if (execution.hiddenVerifierPassed) return "hidden-verifier-passed";
	if (execution.hiddenVerifierAttempted) return "hidden-verifier-attempted";
	if (execution.focusedValidationPassed) return "focused-validation-passed";
	if (execution.focusedValidationAttempted) return "focused-validation-attempted";
	if (execution.nonEmptyDiffAfterLatestMutation) return "workspace-diff";
	if (execution.contentChangingMutationObserved) return "exact-mutation";
	if (execution.inspectionObserved) return "inspection";
	return "none";
}

function nextRequiredPhaseFor(phase: D719CleanPhase): D719NextRequiredPhase {
	switch (phase) {
		case "none":
			return "inspection";
		case "inspection":
			return "exact-mutation";
		case "exact-mutation":
			return "workspace-diff";
		case "workspace-diff":
		case "focused-validation-attempted":
			return "focused-validation";
		case "focused-validation-passed":
		case "hidden-verifier-attempted":
			return "hidden-verifier";
		case "hidden-verifier-passed":
			return "complete";
	}
}

function budgetReasonsFor(state: D719CleanBudgetStateV1, limits: D719CleanBudgetLimitsV1) {
	const reasons: D719CleanBudgetReason[] = [];
	if (state.requests > limits.maxRequests) reasons.push("request-limit");
	if (state.retryWaits > limits.maxRetryWaits) reasons.push("retry-wait-limit");
	if (state.costMicrousd > limits.maxCostMicrousd) reasons.push("cost-limit");
	if (state.elapsedMs > limits.maxElapsedMs) reasons.push("elapsed-limit");
	return Object.freeze(reasons);
}

function reservedState(
	state: EffectGraphState,
	proposal: D719EffectProposalV1,
): D719CleanBudgetStateV1 {
	let requests = state.budget.requests;
	let retryWaits = state.budget.retryWaits;
	let costMicrousd = state.budget.costMicrousd;
	let elapsedMs = state.budget.elapsedMs;
	for (const entry of state.outstanding.values()) {
		requests += entry.proposal.effectKind === "provider-request" ? 1 : 0;
		retryWaits += entry.proposal.effectKind === "retry-wait" ? 1 : 0;
		costMicrousd += entry.proposal.maxCostMicrousd;
		elapsedMs += entry.proposal.maxElapsedMs;
	}
	return Object.freeze({
		requests: requests + (proposal.effectKind === "provider-request" ? 1 : 0),
		retryWaits: retryWaits + (proposal.effectKind === "retry-wait" ? 1 : 0),
		costMicrousd: costMicrousd + proposal.maxCostMicrousd,
		elapsedMs: elapsedMs + proposal.maxElapsedMs,
	});
}

function findReconciledProposal(
	proposals: readonly D719EffectProposalV1[],
	reconciliations: readonly D719EffectReconciliationV1[],
	input: {
		readonly kind: D719EffectKind;
		readonly logical: string;
		readonly route: string;
		readonly attempt: number;
		readonly issuedRequestDigest: string;
	},
): {
	readonly proposal: D719EffectProposalV1;
	readonly reconciliation: D719EffectReconciliationV1;
} | null {
	let proposal: D719EffectProposalV1 | undefined;
	for (let index = proposals.length - 1; index >= 0; index -= 1) {
		const candidate = proposals[index];
		if (
			candidate !== undefined &&
			candidate.effectKind === input.kind &&
			candidate.logicalRequestDigest === input.logical &&
			candidate.routeDigest === input.route &&
			candidate.attemptOrdinal === input.attempt &&
			candidate.issuedRequestDigest === input.issuedRequestDigest
		) {
			proposal = candidate;
			break;
		}
	}
	if (proposal === undefined) return null;
	const reconciliation = reconciliations.find(
		(candidate) => candidate.effectSequence === proposal.effectSequence,
	);
	return reconciliation === undefined ? null : { proposal, reconciliation };
}

function validateRetryForLedger(state: LedgerState, proposal: D719EffectProposalV1): boolean {
	if (proposal.attemptOrdinal === 1) {
		return proposal.retryReason === "none";
	}
	if (
		(proposal.effectKind !== "provider-request" && proposal.effectKind !== "retry-wait") ||
		proposal.attemptOrdinal > D719_MAX_ATTEMPTS_PER_LOGICAL_REQUEST ||
		proposal.retryReason === "none"
	)
		return false;
	if (
		(proposal.retryReason === "d675-und-err-socket" ||
			proposal.retryReason === "d710-untyped-http-429") &&
		proposal.attemptOrdinal > 2
	)
		return false;
	const previous = findReconciledProposal(state.effectProposals, state.effectReconciliations, {
		kind: "provider-request",
		logical: proposal.logicalRequestDigest,
		route: proposal.routeDigest,
		attempt: proposal.attemptOrdinal - 1,
		issuedRequestDigest: proposal.issuedRequestDigest,
	});
	if (
		previous?.reconciliation.outcome !== "retryable-failure" ||
		previous.reconciliation.failureDiscriminator !== proposal.retryReason
	)
		return false;
	if (proposal.effectKind === "retry-wait")
		return proposal.maxElapsedMs >= requiredRetryWaitMs(proposal);
	const wait = findReconciledProposal(state.effectProposals, state.effectReconciliations, {
		kind: "retry-wait",
		logical: proposal.logicalRequestDigest,
		route: proposal.routeDigest,
		attempt: proposal.attemptOrdinal,
		issuedRequestDigest: proposal.issuedRequestDigest,
	});
	return wait?.reconciliation.outcome === "completed" && wait.reconciliation.retryWaitSatisfied;
}

function requiredRetryWaitMs(proposal: D719EffectProposalV1): number {
	if (proposal.effectKind !== "retry-wait") return 0;
	const directed = proposal.retryAfterMs ?? 0;
	if (proposal.retryReason === "d710-untyped-http-429") return Math.max(60_000, directed);
	if (
		proposal.retryReason === "d671-rate-limit-exceeded" ||
		proposal.retryReason === "d671-provider-overloaded"
	)
		return Math.max(proposal.attemptOrdinal === 2 ? 5_000 : 10_000, directed);
	return directed;
}

function stoppedReasonFor(fact: D719AdmittedArmFactV1): D719CleanStoppedReason {
	if (fact.kind === "arm-executor-failed") return "executor-failed";
	if (fact.materialization.status === "failed") return "materialization-failed";
	if (
		fact.cleanup.status === "failed" ||
		(fact.cleanup.status === "unknown" && fact.materialization.status === "ready")
	)
		return "workspace-cleanup-failed";
	if (fact.execution.cancelled) return "cancelled";
	if (fact.reservationOverrunRefs.length > 0) return "budget-exhausted";
	if (fact.budgetDenialRefs.length > 0) return "budget-exhausted";
	if (fact.retryDenialRefs.length > 0) return "retry-denied";
	if (fact.execution.executorFailed) return "executor-failed";
	return null;
}

function decisionFor(fact: D719AdmittedArmFactV1, limits: D719CleanBudgetLimitsV1) {
	const phase = phaseFor(fact.execution);
	const stoppedReason = stoppedReasonFor(fact);
	const disposition: D719CleanDisposition =
		stoppedReason !== null
			? "stop"
			: fact.runKind === "primary" && phase !== "hidden-verifier-passed"
				? "recover-current"
				: "admit-next";
	const material = strictSnapshot({
		kind: "arm-decision" as const,
		runSequence: fact.runSequence,
		armSequence: fact.armSequence,
		arm: fact.arm,
		runKind: fact.runKind,
		issuedRequestDigest: fact.issuedRequestDigest,
		phase,
		nextRequiredPhase: nextRequiredPhaseFor(phase),
		evaluable:
			fact.kind === "arm-execution-completed" &&
			fact.materialization.status === "ready" &&
			fact.cleanup.status === "succeeded" &&
			fact.execution.traceComplete &&
			phase !== "none",
		fullTaskCompleted: fact.execution.hiddenVerifierPassed,
		budgetState: fact.budgetState,
		budgetReasons: fact.budgetDenialReasons,
		retryWithinBound: fact.budgetState.retryWaits <= limits.maxRetryWaits,
		stoppedReason,
		disposition,
		admitNextArm: disposition === "admit-next",
		factDigest: fact.factDigest,
	});
	return Object.freeze({ ...material, decisionDigest: empiricalStrictJsonDigest(material) });
}

function findingFor(decision: D719ArmDecisionProjectionV1): D719HarnessFindingV1 {
	let code: D719HarnessFindingV1["code"];
	if (decision.stoppedReason === "materialization-failed") code = "materialization-failed";
	else if (decision.stoppedReason === "budget-exhausted") code = "budget-exhausted";
	else if (decision.stoppedReason === "workspace-cleanup-failed") code = "cleanup-failed";
	else if (decision.stoppedReason === "cancelled") code = "cancelled";
	else if (decision.stoppedReason === "executor-failed") code = "executor-failed";
	else if (decision.stoppedReason === "retry-denied") code = "retry-denied";
	else if (decision.phase === "none" || decision.phase === "inspection")
		code = "objective-progress-missing";
	else if (decision.phase === "exact-mutation") code = "workspace-diff-missing";
	else if (decision.phase === "workspace-diff" || decision.phase === "focused-validation-attempted")
		code = "focused-validation-missing";
	else if (
		decision.phase === "focused-validation-passed" ||
		decision.phase === "hidden-verifier-attempted"
	)
		code = "hidden-verifier-failed";
	else code = "full-task-completed";
	const material = strictSnapshot({
		kind: "harness-finding" as const,
		runSequence: decision.runSequence,
		armSequence: decision.armSequence,
		arm: decision.arm,
		runKind: decision.runKind,
		code,
		phase: decision.phase,
		nextRequiredPhase: decision.nextRequiredPhase,
		disposition: decision.disposition,
		evidenceRefs: Object.freeze([decision.factDigest, decision.decisionDigest]),
	});
	return Object.freeze({ ...material, findingDigest: empiricalStrictJsonDigest(material) });
}

function workItemFor(definition: ArmDefinition): WorkItemProjection<D719CleanRequestInput> {
	return Object.freeze({
		workItemId: definition.workItemId,
		summary: `D720 Graph-native eval ${definition.runKind} ${definition.arm}`,
		authoringRevision: 1,
		executionInputRevision: definition.executionInputRevision,
		lastEventId: `event:${definition.workItemId}:${definition.executionInputRevision}`,
		revisionSourceRefs: Object.freeze([
			{ kind: "d719-clean-graph-admission", id: definition.sourceDigest },
		]),
	});
}

function proposalFor(definition: ArmDefinition): WorkItemEffectPlanProposed<D719CleanRequestInput> {
	const value = Object.freeze({
		authority: "D720" as const,
		arm: definition.arm,
		armSequence: definition.armSequence,
		runKind: definition.runKind,
		recoveryOrdinal: definition.recoveryOrdinal,
		requiredPhase: definition.requiredPhase,
		sourceDigest: definition.sourceDigest,
	});
	return Object.freeze({
		kind: "work-item-effect-plan-proposed",
		planId: `plan:D720:${definition.arm}:${definition.runKind}`,
		workItemId: definition.workItemId,
		executionInputRevision: definition.executionInputRevision,
		joinPolicy: "all-required",
		sourceRefs: Object.freeze([
			{ kind: "d719-clean-graph-admission", id: definition.sourceDigest },
		]),
		members: Object.freeze([
			Object.freeze({
				memberId: `member:${definition.arm}:${definition.runKind}`,
				effectKind: "graph-native-eval-arm",
				required: true,
				goal: Object.freeze({
					kind: "graph-native-eval-arm",
					input: Object.freeze({
						inputId: `input:D720:${definition.arm}:${definition.runKind}`,
						inputKind: "graph-native-eval-arm",
						dataMode: "inline" as const,
						value,
					}),
				}),
				limits: Object.freeze({ maxSteps: 1, maxRequests: 1 }),
				sourceRefs: Object.freeze([
					{ kind: "d719-clean-graph-admission", id: definition.sourceDigest },
				]),
			}),
		]),
	});
}

function validateCallerResult(value: unknown): D719CallerArmResultV1 {
	const candidate = record(value, "d719.clean.callerResult");
	exactKeys(candidate, ["cleanup", "execution", "materialization"], "d719.clean.callerResult");
	const materialization = record(candidate.materialization, "d719.clean.materialization");
	exactKeys(materialization, ["evidenceDigest", "status"], "d719.clean.materialization");
	oneOf(materialization.status, ["ready", "failed"], "d719.clean.materialization.status");
	digest(materialization.evidenceDigest, "d719.clean.materialization.evidenceDigest");
	const cleanup = record(candidate.cleanup, "d719.clean.cleanup");
	exactKeys(cleanup, ["evidenceDigest", "status"], "d719.clean.cleanup");
	oneOf(cleanup.status, ["succeeded", "failed"], "d719.clean.cleanup.status");
	digest(cleanup.evidenceDigest, "d719.clean.cleanup.evidenceDigest");
	const execution = record(candidate.execution, "d719.clean.execution");
	exactKeys(
		execution,
		[
			"cancelled",
			"contentChangingMutationObserved",
			"executorFailed",
			"focusedValidationAttempted",
			"focusedValidationPassed",
			"hiddenVerifierAttempted",
			"hiddenVerifierPassed",
			"inspectionObserved",
			"nonEmptyDiffAfterLatestMutation",
			"traceComplete",
		],
		"d719.clean.execution",
	);
	for (const key of Object.keys(execution)) {
		if (typeof execution[key] !== "boolean") throw new TypeError(`D719 ${key} is invalid`);
	}
	if (
		(execution.hiddenVerifierPassed && !execution.hiddenVerifierAttempted) ||
		(execution.hiddenVerifierAttempted && !execution.focusedValidationPassed) ||
		(execution.focusedValidationPassed && !execution.focusedValidationAttempted) ||
		(execution.focusedValidationAttempted && !execution.nonEmptyDiffAfterLatestMutation) ||
		(execution.nonEmptyDiffAfterLatestMutation && !execution.contentChangingMutationObserved) ||
		(execution.contentChangingMutationObserved && !execution.inspectionObserved)
	)
		throw new TypeError("D719 objective progress facts are not monotonically ordered");
	return strictSnapshot(candidate) as unknown as D719CallerArmResultV1;
}

function validateBudgetLimits(value: unknown): D719CleanBudgetLimitsV1 {
	const candidate = record(value, "d719.clean.budgetLimits");
	exactKeys(
		candidate,
		["maxCostMicrousd", "maxElapsedMs", "maxRequests", "maxRetryWaits"],
		"d719.clean.budgetLimits",
	);
	for (const key of ["maxCostMicrousd", "maxElapsedMs", "maxRequests"] as const)
		safeInteger(candidate[key], `d719.clean.budgetLimits.${key}`, { min: 1, max: 1_000_000_000 });
	safeInteger(candidate.maxRetryWaits, "d719.clean.budgetLimits.maxRetryWaits", {
		max: 1_000_000_000,
	});
	return strictSnapshot(candidate) as unknown as D719CleanBudgetLimitsV1;
}

function ledgerState(value: unknown): LedgerState {
	if (typeof value !== "object" || value === null) throw new TypeError("D719 ledger is invalid");
	const state = constructedLedgers.get(value);
	if (state === undefined) throw new TypeError("D719 ledger is not Graph-constructed");
	return state;
}

function controllerState(value: unknown): ControllerState {
	if (typeof value !== "object" || value === null)
		throw new TypeError("D719 effect controller is invalid");
	const state = constructedControllers.get(value);
	if (state === undefined) throw new TypeError("D719 effect controller is not Graph-constructed");
	return state;
}

export function createD719CleanGraphLedger(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
}): D719CleanGraphLedgerV1 {
	const input = record(inputValue, "d719.clean.create");
	exactKeys(input, ["budgetLimits", "sourceDigest"], "d719.clean.create");
	const sourceDigest = digest(input.sourceDigest, "d719.clean.sourceDigest");
	const budgetLimits = validateBudgetLimits(input.budgetLimits);
	const owner = graph({ name: "d719/clean-eval-ledger" });
	const definitions = owner.node<ArmDefinition>([], null, { name: "d719/clean/armDefinitions" });
	const factNode = createFactNode(owner);
	const effectProposalNode = createEffectProposalNode(owner);
	const effectReconciliationNode = createEffectReconciliationNode(owner);
	const effectAdmissionNode = owner.node<D719EffectAdmissionV1>(
		[effectProposalNode, effectReconciliationNode],
		(ctx) => {
			const state = ctx.state.get<EffectGraphState>() ?? {
				budget: ZERO_BUDGET,
				outstanding: new Map<number, OutstandingEffect>(),
				reconciliations: [],
			};
			for (const raw of depBatch(ctx, 1) ?? []) {
				const reconciliation = raw as D719EffectReconciliationV1;
				const outstanding = state.outstanding.get(reconciliation.effectSequence);
				if (outstanding === undefined)
					throw new TypeError("D719 Graph reconciliation lacks admission");
				state.outstanding.delete(reconciliation.effectSequence);
				state.reconciliations.push(reconciliation);
				state.budget = Object.freeze({
					requests:
						state.budget.requests +
						(outstanding.proposal.effectKind === "provider-request" ? 1 : 0),
					retryWaits:
						state.budget.retryWaits + (outstanding.proposal.effectKind === "retry-wait" ? 1 : 0),
					costMicrousd: state.budget.costMicrousd + reconciliation.actualCostMicrousd,
					elapsedMs: state.budget.elapsedMs + reconciliation.actualElapsedMs,
				});
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const proposal = raw as D719EffectProposalV1;
				const budgetStateIfReserved = reservedState(state, proposal);
				// Cleanup is a compensating ownership effect. Once an arm has acquired resources,
				// budget exhaustion must stop new work but may not prevent release of those resources.
				const budgetReasons =
					proposal.effectKind === "cleanup"
						? Object.freeze([] as D719CleanBudgetReason[])
						: budgetReasonsFor(budgetStateIfReserved, budgetLimits);
				const retryOk = validateRetryForLedger(
					currentLedgerForNode.get(effectAdmissionNode) as LedgerState,
					proposal,
				);
				const material = strictSnapshot({
					kind: "effect-admission-decided" as const,
					effectSequence: proposal.effectSequence,
					arm: proposal.arm,
					runKind: proposal.runKind,
					proposalDigest: proposal.proposalDigest,
					admitted: budgetReasons.length === 0 && retryOk,
					budgetStateBefore: state.budget,
					budgetStateIfReserved,
					budgetReasons,
					retryAuthorized: retryOk,
				});
				const decision = Object.freeze({
					...material,
					decisionDigest: empiricalStrictJsonDigest(material),
				});
				if (decision.admitted)
					state.outstanding.set(proposal.effectSequence, { proposal, admission: decision });
				ctx.down([["DATA", decision]]);
			}
			ctx.state.set(state);
		},
		{
			name: "d719/clean/effectAdmissions",
			factory: "d719CleanEffectAdmission",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const decisionNode = owner.node<D719ArmDecisionProjectionV1>(
		[factNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", decisionFor(raw as D719AdmittedArmFactV1, budgetLimits)]]);
		},
		{ name: "d719/clean/armDecisions", factory: "d719CleanArmDecisionProjection" },
	);
	const findingNode = owner.node<D719HarnessFindingV1>(
		[decisionNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", findingFor(raw as D719ArmDecisionProjectionV1)]]);
		},
		{ name: "d719/clean/harnessFindings", factory: "d719HarnessFindingProjection" },
	);
	const scheduler = owner.node<ArmIssued>(
		[definitions, decisionNode],
		(ctx) => {
			const state = ctx.state.get<SchedulerState>() ?? {
				definitions: new Map(),
				completed: new Set(),
				active: null,
				stopped: false,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const definition = raw as ArmDefinition;
				state.definitions.set(definition.arm, definition);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const decision = raw as D719ArmDecisionProjectionV1;
				if (
					state.active === null ||
					state.active.arm !== decision.arm ||
					state.active.runKind !== decision.runKind
				)
					throw new TypeError("D719 decision does not match the active Graph arm");
				state.active = null;
				if (decision.disposition === "stop") state.stopped = true;
				else if (decision.disposition === "admit-next") state.completed.add(decision.arm);
				else {
					state.active = Object.freeze({
						kind: "arm-issued" as const,
						arm: decision.arm,
						armSequence: decision.armSequence,
						runKind: "recovery" as const,
						recoveryOrdinal: 1 as const,
						requiredPhase: decision.nextRequiredPhase,
						workItemId: `d720-arm-${decision.arm}-recovery-1`,
						executionInputRevision: decision.armSequence * 2 + 2,
						sourceDigest,
					});
					ctx.down([["DATA", state.active]]);
				}
			}
			if (
				!state.stopped &&
				state.active === null &&
				state.definitions.size === 6 &&
				state.completed.size < 6
			) {
				const arm = D719_CLEAN_GRAPH_ARM_ORDER[state.completed.size];
				const definition = arm === undefined ? undefined : state.definitions.get(arm);
				if (definition !== undefined) {
					state.active = Object.freeze({ kind: "arm-issued" as const, ...definition });
					ctx.down([["DATA", state.active]]);
				}
			}
			ctx.state.set(state);
		},
		{
			name: "d719/clean/serialScheduler",
			factory: "d719CleanSerialArmScheduler",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const workItems = owner.node<WorkItemProjection<D719CleanRequestInput>>(
		[scheduler],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", workItemFor(raw as ArmIssued)]]);
		},
		{ name: "d719/clean/workItems", factory: "d719CleanScheduledWorkItems" },
	);
	const proposals = owner.node<WorkItemEffectPlanProposed<D719CleanRequestInput>>(
		[scheduler],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", proposalFor(raw as ArmIssued)]]);
		},
		{ name: "d719/clean/effectPlans", factory: "d719CleanScheduledEffectPlans" },
	);
	const resultNode = createResultNode(owner);
	const recipe = workItemExecutionRecipe(owner, {
		name: "d719/clean/workItemExecution",
		workItems,
		effectPlanProposals: proposals,
		effectRunResults: resultNode,
		policy: { allowedEffectKinds: ["graph-native-eval-arm"] },
		now: () => 0,
	});
	const requests: AgentRequestIssued<D719CleanRequestInput>[] = [];
	const issuedRequests: AgentRequestIssued<D719CleanRequestInput>[] = [];
	const facts: D719AdmittedArmFactV1[] = [];
	const decisions: D719ArmDecisionProjectionV1[] = [];
	const findings: D719HarnessFindingV1[] = [];
	const effectProposals: D719EffectProposalV1[] = [];
	const effectAdmissions: D719EffectAdmissionV1[] = [];
	const effectReconciliations: D719EffectReconciliationV1[] = [];
	const completedArms: D719CleanArm[] = [];
	recipe.requests.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const request = sanitizeAgentRequestIssued(
			message[1] as AgentRequestIssued<D719CleanRequestInput>,
		) as AgentRequestIssued<D719CleanRequestInput>;
		requests.push(request);
		issuedRequests.push(request);
	});
	factNode.subscribe((message) => {
		if (message[0] === "DATA") facts.push(message[1] as D719AdmittedArmFactV1);
	});
	decisionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const decision = message[1] as D719ArmDecisionProjectionV1;
		decisions.push(decision);
		if (decision.disposition === "admit-next") completedArms.push(decision.arm);
	});
	findingNode.subscribe((message) => {
		if (message[0] === "DATA") findings.push(message[1] as D719HarnessFindingV1);
	});
	effectProposalNode.subscribe((message) => {
		if (message[0] === "DATA") effectProposals.push(message[1] as D719EffectProposalV1);
	});
	effectAdmissionNode.subscribe((message) => {
		if (message[0] === "DATA") effectAdmissions.push(message[1] as D719EffectAdmissionV1);
	});
	effectReconciliationNode.subscribe((message) => {
		if (message[0] === "DATA") effectReconciliations.push(message[1] as D719EffectReconciliationV1);
	});
	definitions.down(
		D719_CLEAN_GRAPH_ARM_ORDER.map((arm, armSequence) => [
			"DATA",
			Object.freeze({
				arm,
				armSequence,
				runKind: "primary" as const,
				recoveryOrdinal: 0 as const,
				requiredPhase: "inspection" as const,
				workItemId: `d720-arm-${arm}`,
				executionInputRevision: armSequence * 2 + 1,
				sourceDigest,
			}),
		]),
	);
	const capability = Object.freeze({ revision: D719_CLEAN_GRAPH_LEDGER_REVISION });
	const state: LedgerState = {
		sourceDigest,
		budgetLimits,
		owner,
		factNode,
		resultNode,
		effectProposalNode,
		effectReconciliationNode,
		requests,
		issuedRequests,
		facts,
		decisions,
		findings,
		effectProposals,
		effectAdmissions,
		effectReconciliations,
		completedArms,
		activeRequest: null,
		effectSequence: 0,
	};
	constructedLedgers.set(capability, state);
	currentLedgerForNode.set(effectAdmissionNode, state);
	return capability;
}

const currentLedgerForNode = new WeakMap<object, LedgerState>();

export function takeNextD719CleanGraphRequest(ledger: D719CleanGraphLedgerV1) {
	const state = ledgerState(ledger);
	if (state.activeRequest !== null) throw new TypeError("D719 has one active caller-owned arm");
	if (state.requests.length === 0) return null;
	if (state.requests.length !== 1) throw new TypeError("D719 exposed more than one active arm");
	const request = state.requests.shift();
	if (request === undefined) throw new TypeError("D719 next request is missing");
	state.activeRequest = request;
	return request;
}

export function createD719CleanEffectController(
	ledger: D719CleanGraphLedgerV1,
	request: AgentRequestIssued<D719CleanRequestInput>,
): D719CleanEffectControllerV1 {
	const state = ledgerState(ledger);
	if (state.activeRequest !== request)
		throw new TypeError("D719 controller requires the exact active request");
	const controller = Object.freeze({
		revision: "graphrefly.b112.d719.effect-controller.v2" as const,
	});
	constructedControllers.set(controller, { ledger: state, request });
	return controller;
}

function validateReservation(value: unknown): D719EffectReservationV1 {
	const candidate = record(value, "d719.effectReservation");
	exactKeys(
		candidate,
		[
			"attemptOrdinal",
			"effectKind",
			"logicalRequestDigest",
			"maxCostMicrousd",
			"maxElapsedMs",
			"retryAfterMs",
			"retryReason",
			"routeDigest",
		],
		"d719.effectReservation",
	);
	oneOf(
		candidate.effectKind,
		[
			"materialization",
			"provider-request",
			"retry-wait",
			"tool-action",
			"hidden-verifier",
			"cleanup",
		],
		"d719.effectReservation.effectKind",
	);
	if (candidate.retryAfterMs !== null)
		safeInteger(candidate.retryAfterMs, "d719.effectReservation.retryAfterMs", { max: 86_400_000 });
	if (candidate.effectKind === "provider-request" && candidate.retryAfterMs !== null)
		throw new TypeError("D719 provider request cannot carry Retry-After");
	digest(candidate.logicalRequestDigest, "d719.effectReservation.logicalRequestDigest");
	digest(candidate.routeDigest, "d719.effectReservation.routeDigest");
	safeInteger(candidate.attemptOrdinal, "d719.effectReservation.attemptOrdinal", {
		min: 1,
		max: D719_MAX_ATTEMPTS_PER_LOGICAL_REQUEST,
	});
	oneOf(
		candidate.retryReason,
		[
			"none",
			"d671-rate-limit-exceeded",
			"d671-provider-overloaded",
			"d675-und-err-socket",
			"d710-untyped-http-429",
		],
		"d719.effectReservation.retryReason",
	);
	safeInteger(candidate.maxCostMicrousd, "d719.effectReservation.maxCostMicrousd", {
		max: 1_000_000_000,
	});
	safeInteger(candidate.maxElapsedMs, "d719.effectReservation.maxElapsedMs", {
		max: 1_000_000_000,
	});
	if (candidate.effectKind === "retry-wait" && candidate.maxCostMicrousd !== 0)
		throw new TypeError("D719 retry wait cannot reserve provider cost");
	if (
		candidate.effectKind !== "provider-request" &&
		candidate.effectKind !== "retry-wait" &&
		(candidate.attemptOrdinal !== 1 ||
			candidate.retryReason !== "none" ||
			candidate.retryAfterMs !== null ||
			candidate.maxCostMicrousd !== 0)
	)
		throw new TypeError("D719 local effects cannot carry provider retry or cost coordinates");
	return strictSnapshot(candidate) as unknown as D719EffectReservationV1;
}

export function requestD719CleanGraphEffect(
	controller: D719CleanEffectControllerV1,
	value: D719EffectReservationV1,
): D719EffectAdmissionV1 {
	const { ledger, request } = controllerState(controller);
	if (ledger.activeRequest !== request) throw new TypeError("D719 effect controller is stale");
	if (ledger.effectProposals.length >= D719_MAX_EFFECT_FACTS)
		throw new TypeError("D719 effect fact bound exhausted");
	const reservation = validateReservation(value);
	if (
		reservation.effectKind !== "cleanup" &&
		ledger.effectAdmissions.some(
			(fact) =>
				!fact.admitted &&
				fact.arm === request.input?.value?.arm &&
				fact.runKind === request.input?.value?.runKind,
		)
	)
		throw new TypeError("D719 Graph already denied an effect for this run");
	const activeRequestDigest = empiricalStrictJsonDigest(request);
	if (
		ledger.effectAdmissions.some(
			(admission) =>
				admission.admitted &&
				!ledger.effectReconciliations.some(
					(reconciliation) => reconciliation.effectSequence === admission.effectSequence,
				),
		)
	) {
		throw new TypeError("D719 serial eval permits one outstanding effect admission");
	}
	const requestInput = request.input?.value;
	if (requestInput === undefined) throw new TypeError("D719 active request input is missing");
	if (
		ledger.effectProposals.some(
			(proposal) =>
				proposal.issuedRequestDigest === activeRequestDigest &&
				proposal.effectKind === reservation.effectKind &&
				proposal.logicalRequestDigest === reservation.logicalRequestDigest &&
				proposal.routeDigest === reservation.routeDigest &&
				proposal.attemptOrdinal === reservation.attemptOrdinal,
		)
	) {
		throw new TypeError("D719 effect attempt coordinates must be unique within a run");
	}
	const effectSequence = ledger.effectSequence++;
	const material = strictSnapshot({
		kind: "effect-reservation-proposed" as const,
		effectSequence,
		arm: requestInput.arm,
		runKind: requestInput.runKind,
		issuedRequestDigest: activeRequestDigest,
		...reservation,
	});
	const proposal = Object.freeze({
		...material,
		proposalDigest: empiricalStrictJsonDigest(material),
	});
	const before = ledger.effectAdmissions.length;
	ledger.effectProposalNode.down([["DATA", proposal]]);
	const decision = ledger.effectAdmissions[before];
	if (decision === undefined) throw new TypeError("D719 Graph omitted effect admission");
	return decision;
}

export function reconcileD719CleanGraphEffect(
	controller: D719CleanEffectControllerV1,
	admission: D719EffectAdmissionV1,
	value: {
		readonly actualCostMicrousd: number;
		readonly actualElapsedMs: number;
		readonly outcome: "completed" | "failed";
		readonly failureDiscriminator?: D719RetryReason;
	},
): D719EffectReconciliationV1 {
	const { ledger, request } = controllerState(controller);
	if (ledger.activeRequest !== request) throw new TypeError("D719 effect controller is stale");
	const expected = ledger.effectAdmissions.find((candidate) => candidate === admission);
	if (expected === undefined || !expected.admitted)
		throw new TypeError("D719 reconciliation requires exact admitted effect");
	if (
		ledger.effectReconciliations.some(
			(candidate) => candidate.effectSequence === admission.effectSequence,
		)
	)
		throw new TypeError("D719 effect was already reconciled");
	const actual = record(value, "d719.effectReconciliation");
	exactKeys(
		actual,
		Object.hasOwn(actual, "failureDiscriminator")
			? ["actualCostMicrousd", "actualElapsedMs", "failureDiscriminator", "outcome"]
			: ["actualCostMicrousd", "actualElapsedMs", "outcome"],
		"d719.effectReconciliation",
	);
	safeInteger(actual.actualCostMicrousd, "d719.effectReconciliation.actualCostMicrousd", {
		max: 1_000_000_000,
	});
	safeInteger(actual.actualElapsedMs, "d719.effectReconciliation.actualElapsedMs", {
		max: 1_000_000_000,
	});
	oneOf(actual.outcome, ["completed", "failed"], "d719.effectReconciliation.outcome");
	const failureDiscriminator = Object.hasOwn(actual, "failureDiscriminator")
		? oneOf(
				actual.failureDiscriminator,
				[
					"none",
					"d671-rate-limit-exceeded",
					"d671-provider-overloaded",
					"d675-und-err-socket",
					"d710-untyped-http-429",
				],
				"d719.effectReconciliation.failureDiscriminator",
			)
		: "none";
	if (actual.outcome === "completed" && failureDiscriminator !== "none")
		throw new TypeError("D719 completed transport cannot carry a failure discriminator");
	const derivedOutcome =
		actual.outcome === "completed"
			? "completed"
			: failureDiscriminator === "none"
				? "terminal-failure"
				: "retryable-failure";
	const proposal = ledger.effectProposals.find(
		(candidate) => candidate.effectSequence === admission.effectSequence,
	);
	if (proposal === undefined) throw new TypeError("D719 reconciliation proposal is missing");
	const reservationExceeded =
		(actual.actualCostMicrousd as number) > proposal.maxCostMicrousd ||
		(actual.actualElapsedMs as number) > proposal.maxElapsedMs;
	const retryWaitSatisfied =
		proposal.effectKind !== "retry-wait" ||
		(actual.actualElapsedMs as number) >= requiredRetryWaitMs(proposal);
	const material = strictSnapshot({
		kind: "effect-reconciled" as const,
		effectSequence: admission.effectSequence,
		proposalDigest: proposal.proposalDigest,
		admissionDigest: admission.decisionDigest,
		actualCostMicrousd: actual.actualCostMicrousd,
		actualElapsedMs: actual.actualElapsedMs,
		outcome: derivedOutcome,
		failureDiscriminator,
		basis: "measured" as const,
		reservationExceeded,
		retryWaitSatisfied,
	});
	const reconciliation = Object.freeze({
		...material,
		reconciliationDigest: empiricalStrictJsonDigest(material),
	}) as D719EffectReconciliationV1;
	ledger.effectReconciliationNode.down([["DATA", reconciliation]]);
	return reconciliation;
}

export function reconcileD719CleanGraphEffectConservatively(
	controller: D719CleanEffectControllerV1,
	admission: D719EffectAdmissionV1,
): D719EffectReconciliationV1 {
	const { ledger, request } = controllerState(controller);
	if (ledger.activeRequest !== request) throw new TypeError("D719 effect controller is stale");
	const expected = ledger.effectAdmissions.find((candidate) => candidate === admission);
	if (expected === undefined || !expected.admitted)
		throw new TypeError("D719 conservative reconciliation requires exact admitted effect");
	if (
		ledger.effectReconciliations.some(
			(candidate) => candidate.effectSequence === admission.effectSequence,
		)
	)
		throw new TypeError("D719 effect was already reconciled");
	const before = ledger.effectReconciliations.length;
	conservativeReconcileOutstanding(ledger, request);
	const reconciliation = ledger.effectReconciliations[before];
	if (reconciliation === undefined || reconciliation.effectSequence !== admission.effectSequence)
		throw new TypeError("D719 Graph omitted conservative reconciliation");
	return reconciliation;
}

function currentBudget(state: LedgerState): D719CleanBudgetStateV1 {
	let requests = 0,
		retryWaits = 0,
		costMicrousd = 0,
		elapsedMs = 0;
	for (const reconciliation of state.effectReconciliations) {
		const proposal = state.effectProposals.find(
			(candidate) => candidate.effectSequence === reconciliation.effectSequence,
		);
		if (proposal === undefined) throw new TypeError("D719 budget provenance is missing");
		requests += proposal.effectKind === "provider-request" ? 1 : 0;
		retryWaits += proposal.effectKind === "retry-wait" ? 1 : 0;
		costMicrousd += reconciliation.actualCostMicrousd;
		elapsedMs += reconciliation.actualElapsedMs;
	}
	return Object.freeze({ requests, retryWaits, costMicrousd, elapsedMs });
}

export function snapshotD719CleanGraphBudgetState(
	ledger: D719CleanGraphLedgerV1,
): D719CleanBudgetStateV1 {
	return currentBudget(ledgerState(ledger));
}

function conservativeReconcileOutstanding(
	state: LedgerState,
	request: AgentRequestIssued<D719CleanRequestInput>,
) {
	const requestDigest = empiricalStrictJsonDigest(request);
	for (const admission of state.effectAdmissions) {
		if (!admission.admitted) continue;
		const proposal = state.effectProposals.find(
			(candidate) => candidate.effectSequence === admission.effectSequence,
		);
		if (
			proposal?.issuedRequestDigest !== requestDigest ||
			state.effectReconciliations.some(
				(candidate) => candidate.effectSequence === admission.effectSequence,
			)
		)
			continue;
		const material = strictSnapshot({
			kind: "effect-reconciled" as const,
			effectSequence: admission.effectSequence,
			proposalDigest: proposal.proposalDigest,
			admissionDigest: admission.decisionDigest,
			actualCostMicrousd: proposal.maxCostMicrousd,
			actualElapsedMs: proposal.maxElapsedMs,
			outcome: "terminal-failure" as const,
			failureDiscriminator: "none" as const,
			basis: "conservative-reservation" as const,
			reservationExceeded: false,
			retryWaitSatisfied:
				proposal.effectKind !== "retry-wait" ||
				proposal.maxElapsedMs >= requiredRetryWaitMs(proposal),
		});
		state.effectReconciliationNode.down([
			[
				"DATA",
				Object.freeze({ ...material, reconciliationDigest: empiricalStrictJsonDigest(material) }),
			],
		]);
	}
}

function admitFact(
	state: LedgerState,
	request: AgentRequestIssued<D719CleanRequestInput>,
	caller: Pick<D719AdmittedArmFactV1, "materialization" | "execution" | "cleanup">,
	kind: D719AdmittedArmFactV1["kind"],
): D719ArmDecisionProjectionV1 {
	if (state.activeRequest !== request)
		throw new TypeError("D719 result does not bind the exact active AgentRequest");
	const input = request.input?.value;
	if (input === undefined) throw new TypeError("D719 request input is invalid");
	const requestDigest = empiricalStrictJsonDigest(request);
	const relevantAdmissions = state.effectAdmissions.filter(
		(candidate) => candidate.arm === input.arm && candidate.runKind === input.runKind,
	);
	const relevantReconciliations = state.effectReconciliations.filter((candidate) => {
		const proposal = state.effectProposals.find(
			(item) => item.effectSequence === candidate.effectSequence,
		);
		return proposal?.issuedRequestDigest === requestDigest;
	});
	const unreconciled = relevantAdmissions.filter(
		(admission) =>
			admission.admitted &&
			!relevantReconciliations.some((fact) => fact.effectSequence === admission.effectSequence),
	);
	if (unreconciled.length > 0)
		throw new TypeError("D719 arm completion has unreconciled admitted effects");
	const base = strictSnapshot({
		kind,
		runSequence: state.facts.length,
		armSequence: input.armSequence,
		arm: input.arm,
		runKind: input.runKind,
		workItemId:
			input.runKind === "primary" ? `d720-arm-${input.arm}` : `d720-arm-${input.arm}-recovery-1`,
		executionInputRevision: input.armSequence * 2 + (input.runKind === "primary" ? 1 : 2),
		issuedRequestDigest: requestDigest,
		...caller,
		budgetState: currentBudget(state),
		budgetDenialRefs: Object.freeze(
			relevantAdmissions
				.filter((item) => !item.admitted && item.budgetReasons.length > 0)
				.map((item) => item.decisionDigest),
		),
		budgetDenialReasons: Object.freeze([
			...new Set(
				relevantAdmissions.filter((item) => !item.admitted).flatMap((item) => item.budgetReasons),
			),
		]),
		retryDenialRefs: Object.freeze(
			relevantAdmissions
				.filter((item) => !item.admitted && !item.retryAuthorized)
				.map((item) => item.decisionDigest),
		),
		reservationOverrunRefs: Object.freeze(
			relevantReconciliations
				.filter((item) => item.reservationExceeded)
				.map((item) => item.reconciliationDigest),
		),
		effectEvidenceRefs: Object.freeze(
			relevantReconciliations.map((item) => item.reconciliationDigest),
		),
	});
	const fact = Object.freeze({
		...base,
		factDigest: empiricalStrictJsonDigest(base),
	}) as D719AdmittedArmFactV1;
	const before = state.decisions.length;
	state.factNode.down([["DATA", fact]]);
	const decision = state.decisions[before];
	if (decision === undefined) throw new TypeError("D719 Graph omitted an arm decision");
	state.activeRequest = null;
	const issued = state.issuedRequests.find((candidate) => candidate === request);
	if (issued === undefined) throw new TypeError("D719 request provenance is missing");
	let result: EffectRunResult;
	if (decision.stoppedReason === "cancelled") {
		result = Object.freeze({
			kind: "effect-run-result",
			resultId: `result:D720:${input.arm}:${input.runKind}`,
			status: "canceled",
			effectRunId: issued.effectRunId,
			operationId: issued.operationId,
			reason: "graph-admitted-cancellation",
			sourceRefs: Object.freeze([{ kind: "d719-clean-decision", id: decision.decisionDigest }]),
		});
	} else if (decision.stoppedReason === "budget-exhausted") {
		result = Object.freeze({
			kind: "effect-run-result",
			resultId: `result:D720:${input.arm}:${input.runKind}`,
			status: "timeout",
			effectRunId: issued.effectRunId,
			operationId: issued.operationId,
			sourceRefs: Object.freeze([{ kind: "d719-clean-decision", id: decision.decisionDigest }]),
		});
	} else if (decision.stoppedReason !== null) {
		const error: DataIssue = Object.freeze({
			kind: "issue",
			code: decision.stoppedReason,
			message: "Graph-native eval arm failed",
			severity: "error",
		});
		result = Object.freeze({
			kind: "effect-run-result",
			resultId: `result:D720:${input.arm}:${input.runKind}`,
			status: "failed",
			effectRunId: issued.effectRunId,
			operationId: issued.operationId,
			error,
			sourceRefs: Object.freeze([{ kind: "d719-clean-decision", id: decision.decisionDigest }]),
		});
	} else {
		result = Object.freeze({
			kind: "effect-run-result",
			resultId: `result:D720:${input.arm}:${input.runKind}`,
			status: "completed",
			effectRunId: issued.effectRunId,
			operationId: issued.operationId,
			output: Object.freeze({
				kind: "d719-clean-arm-decision",
				value: Object.freeze({ arm: input.arm, decisionDigest: decision.decisionDigest }),
			}),
			sourceRefs: Object.freeze([{ kind: "d719-clean-decision", id: decision.decisionDigest }]),
		});
	}
	state.resultNode.down([["DATA", result]]);
	return strictSnapshot(decision);
}

export function admitD719CleanGraphArmResult(
	ledger: D719CleanGraphLedgerV1,
	request: AgentRequestIssued<D719CleanRequestInput>,
	value: unknown,
) {
	return admitFact(
		ledgerState(ledger),
		request,
		validateCallerResult(value),
		"arm-execution-completed",
	);
}

export function admitD719CleanGraphExecutorFailure(
	ledger: D719CleanGraphLedgerV1,
	request: AgentRequestIssued<D719CleanRequestInput>,
) {
	const state = ledgerState(ledger);
	if (state.activeRequest !== request)
		throw new TypeError("D719 failure does not bind the exact active request");
	conservativeReconcileOutstanding(state, request);
	const evidenceDigest = empiricalStrictJsonDigest({
		code: "executor-failed",
		requestDigest: empiricalStrictJsonDigest(request),
	});
	return admitFact(
		state,
		request,
		{
			materialization: { status: "unknown", evidenceDigest },
			execution: {
				traceComplete: false,
				executorFailed: true,
				inspectionObserved: false,
				contentChangingMutationObserved: false,
				nonEmptyDiffAfterLatestMutation: false,
				focusedValidationAttempted: false,
				focusedValidationPassed: false,
				hiddenVerifierAttempted: false,
				hiddenVerifierPassed: false,
				cancelled: false,
			},
			cleanup: { status: "unknown", evidenceDigest },
		},
		"arm-executor-failed",
	);
}

export function admitD719CleanGraphCancellation(
	ledger: D719CleanGraphLedgerV1,
	request: AgentRequestIssued<D719CleanRequestInput>,
) {
	const state = ledgerState(ledger);
	if (state.activeRequest !== request)
		throw new TypeError("D719 cancellation does not bind the exact active request");
	conservativeReconcileOutstanding(state, request);
	const evidenceDigest = empiricalStrictJsonDigest({
		code: "cancelled",
		requestDigest: empiricalStrictJsonDigest(request),
	});
	return admitFact(
		state,
		request,
		{
			materialization: { status: "unknown", evidenceDigest },
			execution: {
				traceComplete: false,
				executorFailed: false,
				inspectionObserved: false,
				contentChangingMutationObserved: false,
				nonEmptyDiffAfterLatestMutation: false,
				focusedValidationAttempted: false,
				focusedValidationPassed: false,
				hiddenVerifierAttempted: false,
				hiddenVerifierPassed: false,
				cancelled: true,
			},
			cleanup: { status: "unknown", evidenceDigest },
		},
		"arm-execution-cancelled",
	);
}

function topologyMaterial(state: LedgerState) {
	const topology = state.owner.topology();
	return strictSnapshot({
		nodes: topology.nodes.map((node) => ({
			id: node.id,
			factory: node.factory,
			deps: Object.freeze([...node.deps]),
		})),
		edges: topology.edges,
	});
}

export function snapshotD719CleanGraphEvidence(
	ledger: D719CleanGraphLedgerV1,
): D719CleanGraphEvidenceV1 {
	const state = ledgerState(ledger);
	if (state.activeRequest !== null) throw new TypeError("D719 cannot snapshot an active arm");
	const topology = topologyMaterial(state);
	const last = state.decisions.at(-1);
	const complete = state.completedArms.length === 6 && last?.stoppedReason === null;
	const material = strictSnapshot({
		schemaVersion: D719_CLEAN_GRAPH_EVIDENCE_SCHEMA,
		ledgerRevision: D719_CLEAN_GRAPH_LEDGER_REVISION,
		sourceDigest: state.sourceDigest,
		budgetLimits: state.budgetLimits,
		armOrder: D719_CLEAN_GRAPH_ARM_ORDER,
		issuedRequests: state.issuedRequests,
		completedArms: state.completedArms,
		effectProposals: state.effectProposals,
		effectAdmissions: state.effectAdmissions,
		effectReconciliations: state.effectReconciliations,
		facts: state.facts,
		decisions: state.decisions,
		findings: state.findings,
		runStatus: complete ? ("complete" as const) : ("stopped" as const),
		maxActiveArms: 1 as const,
		topology,
		topologyDigest: empiricalStrictJsonDigest(topology),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function preboundEvidence(value: unknown) {
	const candidate = record(value, "d719.clean.evidence");
	exactKeys(
		candidate,
		[
			"armOrder",
			"budgetLimits",
			"causalAttribution",
			"completedArms",
			"decisions",
			"effectAdmissions",
			"effectProposals",
			"effectReconciliations",
			"efficacyClaim",
			"evidenceDigest",
			"facts",
			"findings",
			"issuedRequests",
			"ledgerRevision",
			"maxActiveArms",
			"runStatus",
			"schemaVersion",
			"sourceDigest",
			"topology",
			"topologyDigest",
		],
		"d719.clean.evidence",
	);
	for (const [key, max] of [
		["armOrder", 6],
		["completedArms", 6],
		["issuedRequests", 12],
		["facts", 12],
		["decisions", 12],
		["findings", 12],
		["effectProposals", D719_MAX_EFFECT_FACTS],
		["effectAdmissions", D719_MAX_EFFECT_FACTS],
		["effectReconciliations", D719_MAX_EFFECT_FACTS],
	] as const) {
		if (array(candidate[key], `d719.clean.evidence.${key}`).length > max)
			throw new TypeError(`D719 ${key} exceeds its frozen bound`);
	}
	const topology = record(candidate.topology, "d719.clean.evidence.topology");
	exactKeys(topology, ["edges", "nodes"], "d719.clean.evidence.topology");
	const nodes = array(topology.nodes, "d719.clean.evidence.topology.nodes");
	const edges = array(topology.edges, "d719.clean.evidence.topology.edges");
	if (nodes.length > 32 || edges.length > 64)
		throw new TypeError("D719 topology exceeds its frozen bound");
	const nodeIds = new Set<string>();
	for (const [index, rawNode] of nodes.entries()) {
		const node = record(rawNode, `d719.clean.evidence.topology.nodes[${index}]`);
		exactKeys(node, ["deps", "factory", "id"], `d719.clean.evidence.topology.nodes[${index}]`);
		if (
			typeof node.id !== "string" ||
			node.id.length === 0 ||
			node.id.length > 256 ||
			typeof node.factory !== "string" ||
			node.factory.length === 0 ||
			node.factory.length > 128
		) {
			throw new TypeError("D719 topology node coordinates are invalid");
		}
		if (nodeIds.has(node.id)) throw new TypeError("D719 topology node ids must be unique");
		nodeIds.add(node.id);
		const deps = array(node.deps, `d719.clean.evidence.topology.nodes[${index}].deps`);
		if (deps.length > 16) throw new TypeError("D719 topology dependency bound exceeded");
		for (const dep of deps) {
			if (typeof dep !== "string" || dep.length === 0 || dep.length > 256) {
				throw new TypeError("D719 topology dependency is invalid");
			}
		}
	}
	for (const [index, rawEdge] of edges.entries()) {
		const edge = record(rawEdge, `d719.clean.evidence.topology.edges[${index}]`);
		exactKeys(edge, ["from", "to"], `d719.clean.evidence.topology.edges[${index}]`);
		for (const endpoint of [edge.from, edge.to]) {
			if (
				typeof endpoint !== "string" ||
				endpoint.length === 0 ||
				endpoint.length > 256 ||
				!nodeIds.has(endpoint)
			) {
				throw new TypeError("D719 topology edge endpoint is invalid");
			}
		}
	}
	assertBoundedEvidenceTree(candidate);
	return strictSnapshot(candidate) as unknown as D719CleanGraphEvidenceV1;
}

function assertBoundedEvidenceTree(root: unknown): void {
	const stack: { readonly value: unknown; readonly depth: number; readonly path: string }[] = [
		{ value: root, depth: 0, path: "d719.clean.evidence" },
	];
	let visited = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		visited += 1;
		if (visited > 100_000 || current.depth > 24) {
			throw new TypeError("D719 evidence exceeds the frozen structural bound");
		}
		if (typeof current.value === "string") {
			if (current.value.length > 4_096)
				throw new TypeError(`D719 evidence string is too large at ${current.path}`);
			continue;
		}
		if (
			current.value === null ||
			typeof current.value === "boolean" ||
			typeof current.value === "number"
		)
			continue;
		if (Array.isArray(current.value)) {
			const items = array(current.value, current.path);
			if (items.length > 4_096 || visited + stack.length + items.length > 100_000)
				throw new TypeError("D719 evidence container exceeds the frozen structural bound");
			for (let index = items.length - 1; index >= 0; index -= 1) {
				stack.push({
					value: items[index],
					depth: current.depth + 1,
					path: `${current.path}[${index}]`,
				});
			}
			continue;
		}
		const object = record(current.value, current.path);
		const entries = Object.entries(object);
		if (entries.length > 64 || visited + stack.length + entries.length > 100_000)
			throw new TypeError("D719 evidence object exceeds the frozen structural bound");
		for (const [key, nested] of entries) {
			if (key.length === 0 || key.length > 128)
				throw new TypeError("D719 evidence property name exceeds the frozen bound");
			stack.push({ value: nested, depth: current.depth + 1, path: `${current.path}.${key}` });
		}
	}
}

export function validateD719CleanGraphEvidence(value: unknown): D719CleanGraphEvidenceV1 {
	const snapshot = preboundEvidence(value);
	if (
		snapshot.schemaVersion !== D719_CLEAN_GRAPH_EVIDENCE_SCHEMA ||
		snapshot.ledgerRevision !== D719_CLEAN_GRAPH_LEDGER_REVISION ||
		snapshot.maxActiveArms !== 1 ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none"
	)
		throw new TypeError("D719 clean evidence coordinates drifted");
	digest(snapshot.sourceDigest, "d719.clean.evidence.sourceDigest");
	const limits = validateBudgetLimits(snapshot.budgetLimits);
	if (snapshot.armOrder.some((arm, index) => arm !== D719_CLEAN_GRAPH_ARM_ORDER[index]))
		throw new TypeError("D719 clean arm order drifted");
	if (
		snapshot.facts.length !== snapshot.decisions.length ||
		snapshot.facts.length !== snapshot.findings.length ||
		snapshot.issuedRequests.length !== snapshot.facts.length
	)
		throw new TypeError("D719 clean evidence run cardinality is invalid");
	const replay = createD719CleanGraphLedger({
		sourceDigest: snapshot.sourceDigest,
		budgetLimits: limits,
	});
	let proposalIndex = 0;
	let reconciliationIndex = 0;
	for (let runIndex = 0; runIndex < snapshot.facts.length; runIndex += 1) {
		const request = takeNextD719CleanGraphRequest(replay);
		if (
			request === null ||
			empiricalStrictJsonDigest(request) !==
				empiricalStrictJsonDigest(snapshot.issuedRequests[runIndex])
		)
			throw new TypeError("D719 issued AgentRequest provenance drifted");
		const controller = createD719CleanEffectController(replay, request);
		while (proposalIndex < snapshot.effectProposals.length) {
			const raw = snapshot.effectProposals[proposalIndex];
			if (raw?.issuedRequestDigest !== empiricalStrictJsonDigest(request)) break;
			const admission = requestD719CleanGraphEffect(controller, {
				effectKind: raw.effectKind,
				logicalRequestDigest: raw.logicalRequestDigest,
				routeDigest: raw.routeDigest,
				attemptOrdinal: raw.attemptOrdinal,
				retryReason: raw.retryReason,
				retryAfterMs: raw.retryAfterMs,
				maxCostMicrousd: raw.maxCostMicrousd,
				maxElapsedMs: raw.maxElapsedMs,
			});
			if (
				empiricalStrictJsonDigest(admission) !==
				empiricalStrictJsonDigest(snapshot.effectAdmissions[proposalIndex])
			)
				throw new TypeError("D719 effect admission is not Graph-derived");
			if (admission.admitted) {
				const rawReconciliation = snapshot.effectReconciliations[reconciliationIndex++];
				if (
					rawReconciliation === undefined ||
					rawReconciliation.effectSequence !== admission.effectSequence
				)
					throw new TypeError("D719 admitted effect reconciliation is missing");
				if (rawReconciliation.basis === "measured") {
					const replayed = reconcileD719CleanGraphEffect(controller, admission, {
						actualCostMicrousd: rawReconciliation.actualCostMicrousd,
						actualElapsedMs: rawReconciliation.actualElapsedMs,
						outcome: rawReconciliation.outcome === "completed" ? "completed" : "failed",
						failureDiscriminator: rawReconciliation.failureDiscriminator,
					});
					if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(rawReconciliation))
						throw new TypeError("D719 reconciliation is not Graph-derived");
				} else {
					const replayed = reconcileD719CleanGraphEffectConservatively(controller, admission);
					if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(rawReconciliation))
						throw new TypeError("D719 conservative reconciliation is not Graph-derived");
				}
			}
			proposalIndex += 1;
		}
		const fact = snapshot.facts[runIndex];
		if (fact === undefined) throw new TypeError("D719 admitted fact is missing");
		const decision =
			fact.kind === "arm-executor-failed"
				? admitD719CleanGraphExecutorFailure(replay, request)
				: fact.kind === "arm-execution-cancelled"
					? admitD719CleanGraphCancellation(replay, request)
					: admitD719CleanGraphArmResult(replay, request, {
							materialization: fact.materialization,
							execution: fact.execution,
							cleanup: fact.cleanup,
						});
		if (
			empiricalStrictJsonDigest(decision) !==
			empiricalStrictJsonDigest(snapshot.decisions[runIndex])
		)
			throw new TypeError("D719 arm decision is not Graph-derived");
	}
	if (
		proposalIndex !== snapshot.effectProposals.length ||
		reconciliationIndex !== snapshot.effectReconciliations.length
	)
		throw new TypeError("D719 effect evidence has surplus facts");
	const replayed = snapshotD719CleanGraphEvidence(replay);
	if (replayed.evidenceDigest !== snapshot.evidenceDigest)
		throw new TypeError("D719 clean evidence does not match canonical Graph replay");
	return snapshot;
}
