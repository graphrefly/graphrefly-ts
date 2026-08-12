import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import type { AgentRequestIssued } from "../../src/orchestration/agent-runtime.js";
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
import type {
	D719CallerArmResultV1,
	D719CleanBudgetLimitsV1,
	D719CleanBudgetStateV1,
	D719CleanPhase,
	D719CleanRequestInput,
	D719EffectKind,
	D719RetryReason,
} from "./d719-clean-graph-ledger.js";

export const D720_EFFECT_RUNTIME_REVISION =
	"graphrefly.b112.d720.graph-native-effect-runtime.v1" as const;
export const D720_EFFECT_EVIDENCE_SCHEMA =
	"graphrefly.b112.d720.graph-native-effect-evidence.v1" as const;
export const D720_MAX_EFFECT_FACTS_PER_RUN = 512;
export const D720_MAX_TOOL_INTENTS_PER_TURN = 32;
export const D722_COMPLETION_CONTEXT_POLICY_REVISION =
	"graphrefly.b112.d722.graph-completion-context-policy.v1" as const;
export const D722_COMPLETION_CONTEXT_SCHEMA =
	"graphrefly.b112.d722.graph-completion-context.v1" as const;
export const D737_OBJECTIVE_PHASE_RECOVERY_POLICY_REVISION =
	"graphrefly.b112.d737.objective-phase-recovery-policy.v1" as const;
export const D737_OBJECTIVE_PHASE_CONTEXT_SCHEMA =
	"graphrefly.b112.d737.objective-phase-completion-context.v1" as const;
export const D722_EFFECT_RUNTIME_REVISION =
	"graphrefly.b112.d722.graph-native-effect-runtime.v1" as const;
export const D722_EFFECT_EVIDENCE_SCHEMA =
	"graphrefly.b112.d722.graph-native-effect-evidence.v1" as const;
export const D722_MAX_COMPLETION_CONTEXTS_PER_RUN = 1;

function boundedArray(value: unknown, path: string, max: number): readonly unknown[] {
	if (!Array.isArray(value) || value.length > max)
		throw new TypeError(`${path} exceeds its canonical bound`);
	return array(value, path);
}

function assertBoundedEvidenceTree(
	value: unknown,
	path: string,
	depth = 0,
	budget: { nodes: number } = { nodes: 0 },
): void {
	budget.nodes += 1;
	if (budget.nodes > 512 || depth > 10)
		throw new TypeError(`${path} exceeds the bounded evidence tree`);
	if (typeof value === "string") {
		if (value.length > 4_096) throw new TypeError(`${path} contains an oversized string`);
		return;
	}
	if (value === null || typeof value === "number" || typeof value === "boolean") return;
	if (Array.isArray(value)) {
		for (const [index, item] of boundedArray(value, path, 64).entries())
			assertBoundedEvidenceTree(item, `${path}[${index}]`, depth + 1, budget);
		return;
	}
	const candidate = record(value, path);
	const keys = Object.keys(candidate);
	if (keys.length > 32) throw new TypeError(`${path} contains too many fields`);
	if (keys.some((key) => key.length > 128))
		throw new TypeError(`${path} contains an oversized field name`);
	for (const key of keys)
		assertBoundedEvidenceTree(candidate[key], `${path}.${key}`, depth + 1, budget);
}

export type D720ToolRef =
	| "read-file"
	| "search-repository"
	| "replace-exact"
	| "workspace-diff"
	| "focused-validation";

export interface D720ToolIntentV1 {
	readonly toolRef: D720ToolRef;
	readonly intentDigest: string;
}

export interface D722GraphCompletionContextV1 {
	readonly schemaVersion:
		| typeof D722_COMPLETION_CONTEXT_SCHEMA
		| typeof D737_OBJECTIVE_PHASE_CONTEXT_SCHEMA;
	readonly reason: "premature-structured-final" | "objective-phase-policy-violation";
	readonly runSequence: number;
	readonly issuedRequestDigest: string;
	readonly rejectedRequestDigest: string;
	readonly workspaceStateDigest: string;
	readonly nextRequiredPhase: Exclude<D720EffectDecisionV1["nextRequiredPhase"], "complete">;
	readonly missingObjectivePhases: readonly Exclude<
		D720EffectDecisionV1["nextRequiredPhase"],
		"complete" | "hidden-verifier"
	>[];
	readonly evidenceFreshnessRefs: readonly string[];
	readonly requiredDisposition: "tool-intents";
	readonly remainingEffectFacts: number;
	readonly remainingCompletionContexts: 0;
	readonly remainingAdmittedBounds: D719CleanBudgetStateV1;
	readonly budgetProjectionDigest: string;
	readonly contextDigest: string;
}

export type D720ProviderFailureProvenanceV1 = "http-terminal" | "executor-failure";
export type D720ExecutorFailureClassificationV1 =
	| "graph-admission-denied"
	| "executor-threw"
	| "invalid-executor-result"
	| "transport-failure"
	| "route-evidence-failure"
	| "response-decode-failure";

export type D720EffectResultV1 =
	| {
			readonly effectKind: "materialization";
			readonly status: "ready" | "failed";
			readonly workspaceStateDigest: string | null;
			readonly evidenceDigest: string;
	  }
	| {
			readonly effectKind: "provider-request";
			readonly status:
				| "tool-intents"
				| "structured-final"
				| "retryable-failure"
				| "terminal-failure";
			readonly toolIntents: readonly D720ToolIntentV1[];
			readonly failureDiscriminator: D719RetryReason;
			readonly retryAfterMs: number | null;
			readonly workspaceStateDigest: string;
			readonly evidenceDigest: string;
			readonly failureProvenance?: D720ProviderFailureProvenanceV1;
			readonly executorFailureClassification?: D720ExecutorFailureClassificationV1 | null;
	  }
	| {
			readonly effectKind: "retry-wait";
			readonly status: "completed" | "failed";
			readonly evidenceDigest: string;
	  }
	| {
			readonly effectKind: "tool-action";
			readonly toolRef: D720ToolRef;
			readonly intentDigest: string;
			readonly status: "succeeded" | "failed";
			readonly nonEmptyDiff: boolean;
			readonly workspaceStateBeforeDigest: string;
			readonly workspaceStateAfterDigest: string;
			readonly evidenceDigest: string;
	  }
	| {
			readonly effectKind: "hidden-verifier";
			readonly status: "passed" | "failed";
			readonly workspaceStateDigest: string;
			readonly evidenceDigest: string;
	  }
	| {
			readonly effectKind: "cleanup";
			readonly status: "succeeded" | "failed";
			readonly evidenceDigest: string;
	  };

export interface D720GraphEffectRequestV1 {
	readonly kind: "graph-effect-request";
	readonly runSequence: number;
	readonly issuedRequestDigest: string;
	readonly effectSequence: number;
	readonly effectKind: D719EffectKind;
	readonly logicalRequestDigest: string;
	readonly attemptOrdinal: number;
	readonly retryReason: D719RetryReason;
	readonly retryAfterMs: number | null;
	readonly toolIntent: D720ToolIntentV1 | null;
	readonly phaseBefore: D719CleanPhase;
	readonly workspaceStateDigest: string | null;
	readonly completionContext?: D722GraphCompletionContextV1;
	readonly requestDigest: string;
}

export interface D720AdmittedEffectFactV1 {
	readonly kind: "graph-effect-result-admitted";
	readonly request: D720GraphEffectRequestV1;
	readonly admissionDigest: string;
	readonly result: D720EffectResultV1;
	readonly resultDigest: string;
	readonly factDigest: string;
}

export interface D722AdmittedEffectFactV1 extends D720AdmittedEffectFactV1 {
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
}

export interface D720CancellationFactV1 {
	readonly kind: "graph-cancellation-admitted";
	readonly evidenceDigest: string;
	readonly factDigest: string;
}

export interface D720EffectBoundExhaustionFactV1 {
	readonly kind: "graph-effect-bound-exhausted";
	readonly evidenceDigest: string;
	readonly factDigest: string;
}

export type D720RuntimeFactV1 =
	| D720AdmittedEffectFactV1
	| D720CancellationFactV1
	| D720EffectBoundExhaustionFactV1;
export type D722RuntimeFactV1 =
	| D722AdmittedEffectFactV1
	| D720CancellationFactV1
	| D720EffectBoundExhaustionFactV1;

export interface D720EffectDecisionV1 {
	readonly kind: "graph-effect-decision";
	readonly decisionSequence: number;
	readonly phase: D719CleanPhase;
	readonly nextRequiredPhase:
		| "inspection"
		| "exact-mutation"
		| "workspace-diff"
		| "focused-validation"
		| "hidden-verifier"
		| "complete";
	readonly disposition: "execute-effect" | "complete-arm";
	readonly effectRequest: D720GraphEffectRequestV1 | null;
	readonly traceComplete: boolean;
	readonly stoppedReason: "materialization-failed" | "executor-failed" | null;
	readonly decisionDigest: string;
}

export interface D720GraphEffectEvidenceV1 {
	readonly schemaVersion: typeof D720_EFFECT_EVIDENCE_SCHEMA;
	readonly runtimeRevision: typeof D720_EFFECT_RUNTIME_REVISION;
	readonly runSequence: number;
	readonly issuedRequestDigest: string;
	readonly runtimeStatus: "complete" | "cancelled" | "stopped";
	readonly facts: readonly D720RuntimeFactV1[];
	readonly decisions: readonly D720EffectDecisionV1[];
	readonly topology: {
		readonly nodes: readonly {
			readonly id: string;
			readonly factory: string;
			readonly deps: readonly string[];
		}[];
		readonly edges: readonly { readonly from: string; readonly to: string }[];
	};
	readonly topologyDigest: string;
	readonly evidenceDigest: string;
}

export interface D722GraphEffectEvidenceV1 {
	readonly schemaVersion: typeof D722_EFFECT_EVIDENCE_SCHEMA;
	readonly runtimeRevision: typeof D722_EFFECT_RUNTIME_REVISION;
	readonly runSequence: number;
	readonly issuedRequestDigest: string;
	readonly runtimeStatus: "complete" | "cancelled" | "stopped";
	readonly budgetContext: D722GraphBudgetContextV1;
	readonly facts: readonly D722RuntimeFactV1[];
	readonly decisions: readonly D720EffectDecisionV1[];
	readonly topology: D720GraphEffectEvidenceV1["topology"];
	readonly topologyDigest: string;
	readonly evidenceDigest: string;
}

export interface D720GraphEffectRuntimeV1 {
	readonly revision: typeof D720_EFFECT_RUNTIME_REVISION;
}

export interface D722GraphCompletionContextPolicyV1 {
	readonly revision: typeof D722_COMPLETION_CONTEXT_POLICY_REVISION;
}

export interface D737GraphObjectivePhaseRecoveryPolicyV1 {
	readonly revision: typeof D737_OBJECTIVE_PHASE_RECOVERY_POLICY_REVISION;
}

export interface D726ArmLocalTerminalProviderPolicyV1 {
	readonly revision: "graphrefly.b112.d726.arm-local-terminal-provider.v1";
}

export interface D722GraphEffectRuntimeV1 {
	readonly revision: typeof D722_EFFECT_RUNTIME_REVISION;
}

export interface D722GraphBudgetContextV1 {
	readonly limits: D719CleanBudgetLimitsV1;
	readonly initialState: D719CleanBudgetStateV1;
	readonly providerMaxCostMicrousd: number;
	readonly providerMaxElapsedMs: number;
}

interface RuntimeState {
	readonly owner: ReturnType<typeof graph>;
	readonly request: AgentRequestIssued<D719CleanRequestInput>;
	readonly requestDigest: string;
	readonly runSequence: number;
	readonly factNode: Node<D720RuntimeFactV1 | D722RuntimeFactV1>;
	readonly facts: (D720RuntimeFactV1 | D722RuntimeFactV1)[];
	readonly decisions: D720EffectDecisionV1[];
	readonly projectionState: ProjectionState;
	nextDecision: D720EffectDecisionV1;
	completed: boolean;
	readonly mode: "d720" | "d722";
	readonly budgetContext: D722GraphBudgetContextV1 | null;
	readonly armLocalTerminalProviderFailure: boolean;
	readonly objectivePhaseRecoveryEnabled: boolean;
}

interface ProjectionState {
	phase: D719CleanPhase;
	inspectionObserved: boolean;
	mutationObserved: boolean;
	diffObserved: boolean;
	validationAttempted: boolean;
	validationPassed: boolean;
	verifierAttempted: boolean;
	verifierPassed: boolean;
	materializationStatus: "unknown" | "ready" | "failed";
	materializationEvidenceDigest: string | null;
	cleanupStatus: "unknown" | "succeeded" | "failed";
	cleanupEvidenceDigest: string | null;
	pendingTools: D720ToolIntentV1[];
	providerAttemptOrdinal: number;
	providerTurnSequence: number;
	providerLogicalRequestDigest: string | null;
	workspaceStateDigest: string | null;
	validationWorkspaceStateDigest: string | null;
	traceComplete: boolean;
	executorFailed: boolean;
	cancelled: boolean;
	stoppedReason: "materialization-failed" | "executor-failed" | null;
	effectSequence: number;
	decisionSequence: number;
	completionContextsIssued: number;
	activeCompletionContext: D722GraphCompletionContextV1 | null;
	terminalProviderFailure: boolean;
	armLocalTerminalProviderFailure: boolean;
	objectivePhaseRecoveryEnabled: boolean;
	budgetState: D719CleanBudgetStateV1;
}

const constructedRuntimes = new WeakMap<object, RuntimeState>();
const constructedCompletionPolicies = new WeakSet<object>();
const constructedArmLocalTerminalPolicies = new WeakSet<object>();
const constructedObjectivePhaseRecoveryPolicies = new WeakSet<object>();

function nextRequiredPhase(state: ProjectionState): D720EffectDecisionV1["nextRequiredPhase"] {
	if (!state.inspectionObserved) return "inspection";
	if (!state.mutationObserved) return "exact-mutation";
	if (!state.diffObserved) return "workspace-diff";
	if (!state.validationPassed) return "focused-validation";
	if (!state.verifierPassed) return "hidden-verifier";
	return "complete";
}

function requestMaterial(
	state: ProjectionState,
	runSequence: number,
	issuedRequestDigest: string,
	effectKind: D719EffectKind,
	input: {
		readonly logicalMaterial: unknown;
		readonly logicalRequestDigest?: string;
		readonly retryReason?: D719RetryReason;
		readonly retryAfterMs?: number | null;
		readonly attemptOrdinal?: number;
		readonly toolIntent?: D720ToolIntentV1 | null;
		readonly completionContext?: D722GraphCompletionContextV1;
	},
): D720GraphEffectRequestV1 {
	const effectSequence = state.effectSequence++;
	const base = {
		kind: "graph-effect-request" as const,
		runSequence,
		issuedRequestDigest,
		effectSequence,
		effectKind,
		logicalRequestDigest:
			input.logicalRequestDigest ??
			empiricalStrictJsonDigest({ effectSequence, material: input.logicalMaterial }),
		attemptOrdinal: input.attemptOrdinal ?? 1,
		retryReason: input.retryReason ?? ("none" as const),
		retryAfterMs: input.retryAfterMs ?? null,
		toolIntent: input.toolIntent ?? null,
		phaseBefore: state.phase,
		workspaceStateDigest: state.workspaceStateDigest,
	};
	const material = strictSnapshot(
		input.completionContext === undefined
			? base
			: { ...base, completionContext: input.completionContext },
	);
	return Object.freeze({ ...material, requestDigest: empiricalStrictJsonDigest(material) });
}

function missingObjectivePhases(
	state: ProjectionState,
): D722GraphCompletionContextV1["missingObjectivePhases"] {
	const phases: Array<D722GraphCompletionContextV1["missingObjectivePhases"][number]> = [];
	if (!state.inspectionObserved) phases.push("inspection");
	if (!state.mutationObserved) phases.push("exact-mutation");
	if (!state.diffObserved) phases.push("workspace-diff");
	if (!state.validationPassed) phases.push("focused-validation");
	return Object.freeze(phases);
}

function graphCompletionContext(
	state: ProjectionState,
	budgetContext: D722GraphBudgetContextV1,
	runSequence: number,
	issuedRequestDigest: string,
	lastFact: D720AdmittedEffectFactV1,
	reason: D722GraphCompletionContextV1["reason"] = "premature-structured-final",
): D722GraphCompletionContextV1 {
	if (state.workspaceStateDigest === null)
		throw new TypeError("D722 completion context requires Graph-visible workspace state");
	const required = nextRequiredPhase(state);
	if (required === "complete" || required === "hidden-verifier")
		throw new TypeError("D722 completion context requires an incomplete objective phase");
	const remainingAdmittedBounds = Object.freeze({
		requests: Math.max(0, budgetContext.limits.maxRequests - state.budgetState.requests - 1),
		retryWaits: Math.max(0, budgetContext.limits.maxRetryWaits - state.budgetState.retryWaits),
		costMicrousd: Math.max(
			0,
			budgetContext.limits.maxCostMicrousd -
				state.budgetState.costMicrousd -
				budgetContext.providerMaxCostMicrousd,
		),
		elapsedMs: Math.max(
			0,
			budgetContext.limits.maxElapsedMs -
				state.budgetState.elapsedMs -
				budgetContext.providerMaxElapsedMs,
		),
	});
	const budgetProjectionDigest = empiricalStrictJsonDigest({
		budgetStateBeforeContinuation: state.budgetState,
		providerReservation: {
			maxCostMicrousd: budgetContext.providerMaxCostMicrousd,
			maxElapsedMs: budgetContext.providerMaxElapsedMs,
		},
		remainingAdmittedBounds,
	});
	const material = strictSnapshot({
		schemaVersion:
			reason === "premature-structured-final"
				? D722_COMPLETION_CONTEXT_SCHEMA
				: D737_OBJECTIVE_PHASE_CONTEXT_SCHEMA,
		reason,
		runSequence,
		issuedRequestDigest,
		rejectedRequestDigest: lastFact.request.requestDigest,
		workspaceStateDigest: state.workspaceStateDigest,
		nextRequiredPhase: required,
		missingObjectivePhases: missingObjectivePhases(state),
		evidenceFreshnessRefs: Object.freeze([lastFact.resultDigest, lastFact.factDigest]),
		requiredDisposition: "tool-intents" as const,
		remainingEffectFacts: Math.max(0, D720_MAX_EFFECT_FACTS_PER_RUN - state.effectSequence - 1),
		remainingCompletionContexts: 0 as const,
		remainingAdmittedBounds,
		budgetProjectionDigest,
	});
	return Object.freeze({ ...material, contextDigest: empiricalStrictJsonDigest(material) });
}

function objectiveContinuationRequest(
	state: ProjectionState,
	budgetContext: D722GraphBudgetContextV1,
	runSequence: number,
	issuedRequestDigest: string,
	lastFact: D720AdmittedEffectFactV1,
	reason: D722GraphCompletionContextV1["reason"],
): D720GraphEffectRequestV1 {
	const completionContext = graphCompletionContext(
		state,
		budgetContext,
		runSequence,
		issuedRequestDigest,
		lastFact,
		reason,
	);
	state.completionContextsIssued += 1;
	state.activeCompletionContext = completionContext;
	state.pendingTools = [];
	state.providerAttemptOrdinal = 1;
	state.providerTurnSequence += 1;
	state.providerLogicalRequestDigest = empiricalStrictJsonDigest({
		issuedRequestDigest,
		providerTurn: state.providerTurnSequence,
		completionContextDigest: completionContext.contextDigest,
	});
	return requestMaterial(state, runSequence, issuedRequestDigest, "provider-request", {
		logicalMaterial: {
			issuedRequestDigest,
			providerTurn: state.providerTurnSequence,
			completionContextDigest: completionContext.contextDigest,
		},
		logicalRequestDigest: state.providerLogicalRequestDigest,
		completionContext,
	});
}

function decisionMaterial(
	state: ProjectionState,
	effectRequest: D720GraphEffectRequestV1 | null,
): D720EffectDecisionV1 {
	const material = strictSnapshot({
		kind: "graph-effect-decision" as const,
		decisionSequence: state.decisionSequence++,
		phase: state.phase,
		nextRequiredPhase: nextRequiredPhase(state),
		disposition: effectRequest === null ? ("complete-arm" as const) : ("execute-effect" as const),
		effectRequest,
		traceComplete: state.traceComplete,
		stoppedReason: state.stoppedReason,
	});
	return Object.freeze({ ...material, decisionDigest: empiricalStrictJsonDigest(material) });
}

function toolIntentAllowed(state: ProjectionState, intent: D720ToolIntentV1): boolean {
	if (intent.toolRef === "read-file" || intent.toolRef === "search-repository") return true;
	if (intent.toolRef === "replace-exact") return state.inspectionObserved;
	if (intent.toolRef === "workspace-diff") return state.mutationObserved;
	return state.diffObserved;
}

function toolIntentBatchAllowed(
	state: ProjectionState,
	intents: readonly D720ToolIntentV1[],
): boolean {
	let inspectionObserved = state.inspectionObserved;
	let mutationObserved = state.mutationObserved;
	let diffObserved = state.diffObserved;
	for (const intent of intents) {
		if (intent.toolRef === "read-file" || intent.toolRef === "search-repository") {
			inspectionObserved = true;
			continue;
		}
		if (intent.toolRef === "replace-exact") {
			if (!inspectionObserved) return false;
			mutationObserved = true;
			diffObserved = false;
			continue;
		}
		if (intent.toolRef === "workspace-diff") {
			if (!mutationObserved) return false;
			diffObserved = true;
			continue;
		}
		if (!diffObserved) return false;
	}
	return true;
}

function nextToolOrStop(
	state: ProjectionState,
	runSequence: number,
	issuedRequestDigest: string,
	toolIntent: D720ToolIntentV1 | undefined,
): D720GraphEffectRequestV1 {
	if (toolIntent === undefined) {
		return requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
			logicalMaterial: { issuedRequestDigest, effect: "empty-tool-batch-cleanup" },
		});
	}
	if (!toolIntentAllowed(state, toolIntent)) {
		state.executorFailed = true;
		state.stoppedReason = "executor-failed";
		state.pendingTools = [];
		return requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
			logicalMaterial: {
				issuedRequestDigest,
				effect: "out-of-order-tool-intent-cleanup",
				intentDigest: toolIntent.intentDigest,
			},
		});
	}
	return requestMaterial(state, runSequence, issuedRequestDigest, "tool-action", {
		logicalMaterial: { issuedRequestDigest, toolIntent },
		toolIntent,
	});
}

function nextEffect(
	state: ProjectionState,
	budgetContext: D722GraphBudgetContextV1 | null,
	runSequence: number,
	issuedRequestDigest: string,
	lastFact: D720AdmittedEffectFactV1 | null,
): D720EffectDecisionV1 {
	let request: D720GraphEffectRequestV1 | null;
	if (lastFact === null) {
		request = requestMaterial(state, runSequence, issuedRequestDigest, "materialization", {
			logicalMaterial: { issuedRequestDigest, effect: "materialization" },
		});
	} else if (lastFact.result.effectKind === "materialization") {
		if (lastFact.result.status === "ready") {
			state.materializationStatus = "ready";
			state.materializationEvidenceDigest = lastFact.result.evidenceDigest;
			state.workspaceStateDigest = lastFact.result.workspaceStateDigest;
			state.providerAttemptOrdinal = 1;
			state.activeCompletionContext = null;
			state.providerTurnSequence += 1;
			state.providerLogicalRequestDigest = empiricalStrictJsonDigest({
				issuedRequestDigest,
				providerTurn: state.providerTurnSequence,
			});
			request = requestMaterial(state, runSequence, issuedRequestDigest, "provider-request", {
				logicalMaterial: { issuedRequestDigest, providerTurn: state.providerTurnSequence },
				logicalRequestDigest: state.providerLogicalRequestDigest,
			});
		} else {
			state.materializationStatus = "failed";
			state.materializationEvidenceDigest = lastFact.result.evidenceDigest;
			state.stoppedReason = "materialization-failed";
			request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
				logicalMaterial: { issuedRequestDigest, effect: "cleanup" },
			});
		}
	} else if (lastFact.result.effectKind === "provider-request") {
		const result = lastFact.result;
		if (result.status === "tool-intents") {
			if (
				!toolIntentBatchAllowed(state, result.toolIntents) &&
				state.objectivePhaseRecoveryEnabled &&
				state.completionContextsIssued < D722_MAX_COMPLETION_CONTEXTS_PER_RUN
			) {
				if (budgetContext === null)
					throw new TypeError("D737 objective phase recovery requires Graph budget context");
				request = objectiveContinuationRequest(
					state,
					budgetContext,
					runSequence,
					issuedRequestDigest,
					lastFact,
					"objective-phase-policy-violation",
				);
			} else {
				state.pendingTools = [...result.toolIntents];
				const toolIntent = state.pendingTools.shift();
				request = nextToolOrStop(state, runSequence, issuedRequestDigest, toolIntent);
			}
		} else if (result.status === "structured-final") {
			if (state.validationPassed) {
				request = requestMaterial(state, runSequence, issuedRequestDigest, "hidden-verifier", {
					logicalMaterial: { issuedRequestDigest, effect: "hidden-verifier" },
				});
			} else if (state.completionContextsIssued < D722_MAX_COMPLETION_CONTEXTS_PER_RUN) {
				if (budgetContext === null)
					throw new TypeError("D722 completion context requires Graph budget context");
				request = objectiveContinuationRequest(
					state,
					budgetContext,
					runSequence,
					issuedRequestDigest,
					lastFact,
					"premature-structured-final",
				);
			} else {
				request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
					logicalMaterial: { issuedRequestDigest, effect: "cleanup" },
				});
			}
		} else if (
			result.status === "retryable-failure" &&
			state.providerAttemptOrdinal <
				(result.failureDiscriminator === "d675-und-err-socket" ||
				result.failureDiscriminator === "d710-untyped-http-429"
					? 2
					: 3)
		) {
			request = requestMaterial(state, runSequence, issuedRequestDigest, "retry-wait", {
				logicalMaterial: { issuedRequestDigest, providerTurn: state.providerTurnSequence },
				logicalRequestDigest:
					state.providerLogicalRequestDigest ??
					empiricalStrictJsonDigest({
						issuedRequestDigest,
						providerTurn: state.providerTurnSequence,
					}),
				attemptOrdinal: state.providerAttemptOrdinal + 1,
				retryReason: result.failureDiscriminator,
				retryAfterMs: result.retryAfterMs,
			});
		} else if (result.status === "terminal-failure" && state.armLocalTerminalProviderFailure) {
			state.terminalProviderFailure = true;
			request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
				logicalMaterial: { issuedRequestDigest, effect: "terminal-provider-cleanup" },
			});
		} else {
			state.executorFailed = true;
			state.stoppedReason = "executor-failed";
			request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
				logicalMaterial: { issuedRequestDigest, effect: "cleanup" },
			});
		}
	} else if (lastFact.result.effectKind === "retry-wait") {
		if (lastFact.result.status === "completed") {
			state.providerAttemptOrdinal += 1;
			request = requestMaterial(state, runSequence, issuedRequestDigest, "provider-request", {
				logicalMaterial: { issuedRequestDigest, providerTurn: state.providerTurnSequence },
				logicalRequestDigest:
					state.providerLogicalRequestDigest ??
					empiricalStrictJsonDigest({
						issuedRequestDigest,
						providerTurn: state.providerTurnSequence,
					}),
				attemptOrdinal: state.providerAttemptOrdinal,
				retryReason: lastFact.request.retryReason,
				completionContext: state.activeCompletionContext ?? undefined,
			});
		} else {
			state.executorFailed = true;
			state.stoppedReason = "executor-failed";
			request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
				logicalMaterial: { issuedRequestDigest, effect: "cleanup" },
			});
		}
	} else if (lastFact.result.effectKind === "tool-action") {
		const result = lastFact.result;
		if (result.status === "failed") {
			state.executorFailed = true;
			state.stoppedReason = "executor-failed";
			request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
				logicalMaterial: { issuedRequestDigest, effect: "cleanup" },
			});
		} else {
			state.workspaceStateDigest = result.workspaceStateAfterDigest;
			if (result.toolRef === "read-file" || result.toolRef === "search-repository") {
				state.inspectionObserved = true;
				if (state.phase === "none") state.phase = "inspection";
			} else if (result.toolRef === "replace-exact") {
				state.mutationObserved = true;
				state.diffObserved = false;
				state.validationAttempted = false;
				state.validationPassed = false;
				state.phase = "exact-mutation";
			} else if (result.toolRef === "workspace-diff" && result.nonEmptyDiff) {
				state.diffObserved = true;
				state.validationAttempted = false;
				state.validationPassed = false;
				state.phase = "workspace-diff";
			} else if (result.toolRef === "focused-validation") {
				state.validationAttempted = true;
				state.validationPassed = state.diffObserved;
				state.validationWorkspaceStateDigest = state.validationPassed
					? result.workspaceStateAfterDigest
					: null;
				state.phase = state.validationPassed
					? "focused-validation-passed"
					: "focused-validation-attempted";
			}
			const toolIntent = state.pendingTools.shift();
			request =
				toolIntent === undefined
					? (() => {
							state.providerAttemptOrdinal = 1;
							state.activeCompletionContext = null;
							state.providerTurnSequence += 1;
							state.providerLogicalRequestDigest = empiricalStrictJsonDigest({
								issuedRequestDigest,
								providerTurn: state.providerTurnSequence,
							});
							return requestMaterial(state, runSequence, issuedRequestDigest, "provider-request", {
								logicalMaterial: {
									issuedRequestDigest,
									providerTurn: state.providerTurnSequence,
								},
								logicalRequestDigest: state.providerLogicalRequestDigest,
							});
						})()
					: nextToolOrStop(state, runSequence, issuedRequestDigest, toolIntent);
		}
	} else if (lastFact.result.effectKind === "hidden-verifier") {
		state.verifierAttempted = true;
		state.verifierPassed = lastFact.result.status === "passed";
		state.phase = state.verifierPassed ? "hidden-verifier-passed" : "hidden-verifier-attempted";
		request = requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
			logicalMaterial: { issuedRequestDigest, effect: "cleanup" },
		});
	} else {
		state.cleanupStatus = lastFact.result.status;
		state.cleanupEvidenceDigest = lastFact.result.evidenceDigest;
		state.traceComplete = state.cleanupStatus === "succeeded";
		request = null;
	}
	return decisionMaterial(state, request);
}

function cancellationDecision(
	state: ProjectionState,
	runSequence: number,
	issuedRequestDigest: string,
): D720EffectDecisionV1 {
	state.cancelled = true;
	state.pendingTools = [];
	const request =
		state.materializationStatus !== "unknown" && state.cleanupStatus === "unknown"
			? requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
					logicalMaterial: { issuedRequestDigest, effect: "cancellation-cleanup" },
				})
			: null;
	return decisionMaterial(state, request);
}

function effectBoundExhaustionDecision(
	state: ProjectionState,
	runSequence: number,
	issuedRequestDigest: string,
): D720EffectDecisionV1 {
	state.executorFailed = true;
	state.stoppedReason = "executor-failed";
	state.pendingTools = [];
	const request =
		state.materializationStatus === "ready" && state.cleanupStatus === "unknown"
			? requestMaterial(state, runSequence, issuedRequestDigest, "cleanup", {
					logicalMaterial: { issuedRequestDigest, effect: "effect-bound-cleanup" },
				})
			: null;
	return decisionMaterial(state, request);
}

function initialProjectionState(): ProjectionState {
	return {
		phase: "none",
		inspectionObserved: false,
		mutationObserved: false,
		diffObserved: false,
		validationAttempted: false,
		validationPassed: false,
		verifierAttempted: false,
		verifierPassed: false,
		materializationStatus: "unknown",
		materializationEvidenceDigest: null,
		cleanupStatus: "unknown",
		cleanupEvidenceDigest: null,
		pendingTools: [],
		providerAttemptOrdinal: 1,
		providerTurnSequence: 0,
		providerLogicalRequestDigest: null,
		workspaceStateDigest: null,
		validationWorkspaceStateDigest: null,
		traceComplete: false,
		executorFailed: false,
		cancelled: false,
		stoppedReason: null,
		effectSequence: 0,
		decisionSequence: 0,
		completionContextsIssued: D722_MAX_COMPLETION_CONTEXTS_PER_RUN,
		activeCompletionContext: null,
		terminalProviderFailure: false,
		armLocalTerminalProviderFailure: false,
		objectivePhaseRecoveryEnabled: false,
		budgetState: Object.freeze({ requests: 0, retryWaits: 0, costMicrousd: 0, elapsedMs: 0 }),
	};
}

function initialD722ProjectionState(): ProjectionState {
	return { ...initialProjectionState(), completionContextsIssued: 0 };
}

export function createD722GraphCompletionContextPolicy(): D722GraphCompletionContextPolicyV1 {
	const policy = Object.freeze({ revision: D722_COMPLETION_CONTEXT_POLICY_REVISION });
	constructedCompletionPolicies.add(policy);
	return policy;
}

export function createD737GraphObjectivePhaseRecoveryPolicy(): D737GraphObjectivePhaseRecoveryPolicyV1 {
	const policy = Object.freeze({ revision: D737_OBJECTIVE_PHASE_RECOVERY_POLICY_REVISION });
	constructedObjectivePhaseRecoveryPolicies.add(policy);
	return policy;
}

function createGraphEffectRuntime(
	inputValue: {
		readonly request: AgentRequestIssued<D719CleanRequestInput>;
		readonly runSequence: number;
		readonly budgetContext?: D722GraphBudgetContextV1;
		readonly armLocalTerminalProviderFailure?: boolean;
		readonly objectivePhaseRecoveryEnabled?: boolean;
	},
	mode: "d720" | "d722",
): D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1 {
	const input = record(inputValue, "d720.effectRuntime.create");
	exactKeys(
		input,
		mode === "d722"
			? [
					"budgetContext",
					"request",
					"runSequence",
					...(Object.hasOwn(input, "armLocalTerminalProviderFailure")
						? ["armLocalTerminalProviderFailure" as const]
						: []),
					...(Object.hasOwn(input, "objectivePhaseRecoveryEnabled")
						? ["objectivePhaseRecoveryEnabled" as const]
						: []),
				]
			: ["request", "runSequence"],
		"d720.effectRuntime.create",
	);
	const request = strictSnapshot(input.request) as AgentRequestIssued<D719CleanRequestInput>;
	const runSequence = safeInteger(input.runSequence, "d720.effectRuntime.runSequence", {
		min: 0,
		max: 11,
	});
	const requestDigest = empiricalStrictJsonDigest(request);
	const namespace = mode === "d720" ? "d720" : "d722";
	const owner = graph({ name: `${namespace}/effect-runtime/${runSequence}` });
	const budgetContext = (input.budgetContext as D722GraphBudgetContextV1 | undefined) ?? null;
	const factNode = owner.node<D720RuntimeFactV1 | D722RuntimeFactV1>([], null, {
		name: `${namespace}/external-effect-facts`,
	});
	const projectionState = mode === "d720" ? initialProjectionState() : initialD722ProjectionState();
	projectionState.armLocalTerminalProviderFailure = input.armLocalTerminalProviderFailure === true;
	projectionState.objectivePhaseRecoveryEnabled = input.objectivePhaseRecoveryEnabled === true;
	if (budgetContext !== null) projectionState.budgetState = budgetContext.initialState;
	const decisions: D720EffectDecisionV1[] = [];
	const decisionNode = owner.node<D720EffectDecisionV1>(
		[factNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as D720RuntimeFactV1 | D722RuntimeFactV1;
				if ("actualCostMicrousd" in fact) {
					projectionState.budgetState = Object.freeze({
						requests:
							projectionState.budgetState.requests +
							(fact.result.effectKind === "provider-request" ? 1 : 0),
						retryWaits:
							projectionState.budgetState.retryWaits +
							(fact.result.effectKind === "retry-wait" ? 1 : 0),
						costMicrousd: projectionState.budgetState.costMicrousd + fact.actualCostMicrousd,
						elapsedMs: projectionState.budgetState.elapsedMs + fact.actualElapsedMs,
					});
				}
				const decision =
					fact.kind === "graph-cancellation-admitted"
						? cancellationDecision(projectionState, runSequence, requestDigest)
						: fact.kind === "graph-effect-bound-exhausted"
							? effectBoundExhaustionDecision(projectionState, runSequence, requestDigest)
							: nextEffect(projectionState, budgetContext, runSequence, requestDigest, fact);
				ctx.down([["DATA", decision]]);
			}
		},
		{
			name: `${namespace}/effect-decisions`,
			factory: mode === "d720" ? "d720GraphEffectDecision" : "d722GraphEffectDecision",
		},
	);
	decisionNode.subscribe((message) => {
		if (message[0] === "DATA") decisions.push(message[1] as D720EffectDecisionV1);
	});
	const initial = nextEffect(projectionState, budgetContext, runSequence, requestDigest, null);
	decisions.push(initial);
	const runtime = Object.freeze({
		revision: mode === "d720" ? D720_EFFECT_RUNTIME_REVISION : D722_EFFECT_RUNTIME_REVISION,
	});
	constructedRuntimes.set(runtime, {
		owner,
		request,
		requestDigest,
		runSequence,
		factNode,
		facts: [],
		decisions,
		projectionState,
		nextDecision: initial,
		completed: false,
		mode,
		budgetContext,
		armLocalTerminalProviderFailure: input.armLocalTerminalProviderFailure === true,
		objectivePhaseRecoveryEnabled: input.objectivePhaseRecoveryEnabled === true,
	});
	return runtime;
}

export function createD720GraphEffectRuntime(inputValue: {
	readonly request: AgentRequestIssued<D719CleanRequestInput>;
	readonly runSequence: number;
}): D720GraphEffectRuntimeV1 {
	return createGraphEffectRuntime(inputValue, "d720") as D720GraphEffectRuntimeV1;
}

export function createD722GraphEffectRuntime(inputValue: {
	readonly request: AgentRequestIssued<D719CleanRequestInput>;
	readonly runSequence: number;
	readonly completionContextPolicy: D722GraphCompletionContextPolicyV1;
	readonly budgetContext: D722GraphBudgetContextV1;
	readonly armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1;
	readonly objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1;
}): D722GraphEffectRuntimeV1 {
	const input = record(inputValue, "d722.effectRuntime.create");
	exactKeys(
		input,
		[
			"budgetContext",
			"completionContextPolicy",
			"request",
			"runSequence",
			...(Object.hasOwn(input, "armLocalTerminalPolicy")
				? ["armLocalTerminalPolicy" as const]
				: []),
			...(Object.hasOwn(input, "objectivePhaseRecoveryPolicy")
				? ["objectivePhaseRecoveryPolicy" as const]
				: []),
		],
		"d722.effectRuntime.create",
	);
	if (
		typeof input.completionContextPolicy !== "object" ||
		input.completionContextPolicy === null ||
		!constructedCompletionPolicies.has(input.completionContextPolicy)
	)
		throw new TypeError("D722 completion context policy must be Graph-constructed");
	if (
		Object.hasOwn(input, "armLocalTerminalPolicy") &&
		(typeof input.armLocalTerminalPolicy !== "object" ||
			input.armLocalTerminalPolicy === null ||
			!constructedArmLocalTerminalPolicies.has(input.armLocalTerminalPolicy))
	)
		throw new TypeError("D726 arm-local terminal policy must be Graph-constructed");
	if (
		Object.hasOwn(input, "objectivePhaseRecoveryPolicy") &&
		(typeof input.objectivePhaseRecoveryPolicy !== "object" ||
			input.objectivePhaseRecoveryPolicy === null ||
			!constructedObjectivePhaseRecoveryPolicies.has(input.objectivePhaseRecoveryPolicy))
	)
		throw new TypeError("D737 objective phase recovery policy must be Graph-constructed");
	return createGraphEffectRuntime(
		{
			request: input.request as AgentRequestIssued<D719CleanRequestInput>,
			runSequence: input.runSequence as number,
			budgetContext: strictSnapshot(input.budgetContext) as unknown as D722GraphBudgetContextV1,
			armLocalTerminalProviderFailure: Object.hasOwn(input, "armLocalTerminalPolicy"),
			objectivePhaseRecoveryEnabled: Object.hasOwn(input, "objectivePhaseRecoveryPolicy"),
		},
		"d722",
	) as D722GraphEffectRuntimeV1;
}

export function createD726ArmLocalTerminalProviderPolicy(): D726ArmLocalTerminalProviderPolicyV1 {
	const policy = Object.freeze({
		revision: "graphrefly.b112.d726.arm-local-terminal-provider.v1" as const,
	});
	constructedArmLocalTerminalPolicies.add(policy);
	return policy;
}

function runtimeState(runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1): RuntimeState {
	const state = constructedRuntimes.get(runtime);
	if (state === undefined) throw new TypeError("D720 effect runtime is not Graph-constructed");
	return state;
}

export function nextD720GraphEffectDecision(
	runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1,
): D720EffectDecisionV1 {
	return runtimeState(runtime).nextDecision;
}

function validateToolIntent(value: unknown, path: string): D720ToolIntentV1 {
	const candidate = record(value, path);
	exactKeys(candidate, ["intentDigest", "toolRef"], path);
	oneOf(
		candidate.toolRef,
		["read-file", "search-repository", "replace-exact", "workspace-diff", "focused-validation"],
		`${path}.toolRef`,
	);
	digest(candidate.intentDigest, `${path}.intentDigest`);
	return strictSnapshot(candidate) as unknown as D720ToolIntentV1;
}

export function validateD720GraphEffectResult(
	value: unknown,
	request: D720GraphEffectRequestV1,
): D720EffectResultV1 {
	const candidate = record(value, "d720.effectResult");
	if (candidate.effectKind !== request.effectKind)
		throw new TypeError("D720 executor result does not match the Graph effect request");
	if (candidate.effectKind === "materialization") {
		exactKeys(
			candidate,
			["effectKind", "evidenceDigest", "status", "workspaceStateDigest"],
			"d720.effectResult",
		);
		oneOf(candidate.status, ["ready", "failed"], "d720.effectResult.status");
		if (candidate.status === "ready")
			digest(candidate.workspaceStateDigest, "d720.effectResult.workspaceStateDigest");
		else if (candidate.workspaceStateDigest !== null)
			throw new TypeError("D720 failed materialization cannot claim workspace state");
	} else if (candidate.effectKind === "provider-request") {
		const hasFailureProvenance = Object.hasOwn(candidate, "failureProvenance");
		const hasExecutorClassification = Object.hasOwn(candidate, "executorFailureClassification");
		if (hasFailureProvenance !== hasExecutorClassification)
			throw new TypeError("D720 provider failure provenance fields must be paired");
		exactKeys(
			candidate,
			[
				"effectKind",
				"evidenceDigest",
				...(hasExecutorClassification ? ["executorFailureClassification" as const] : []),
				"failureDiscriminator",
				...(hasFailureProvenance ? ["failureProvenance" as const] : []),
				"retryAfterMs",
				"status",
				"toolIntents",
				"workspaceStateDigest",
			],
			"d720.effectResult",
		);
		oneOf(
			candidate.status,
			["tool-intents", "structured-final", "retryable-failure", "terminal-failure"],
			"d720.effectResult.status",
		);
		oneOf(
			candidate.failureDiscriminator,
			[
				"none",
				"d671-rate-limit-exceeded",
				"d671-provider-overloaded",
				"d675-und-err-socket",
				"d710-untyped-http-429",
			],
			"d720.effectResult.failureDiscriminator",
		);
		if (candidate.retryAfterMs !== null)
			safeInteger(candidate.retryAfterMs, "d720.effectResult.retryAfterMs", { max: 86_400_000 });
		const toolIntents = boundedArray(
			candidate.toolIntents,
			"d720.effectResult.toolIntents",
			D720_MAX_TOOL_INTENTS_PER_TURN,
		);
		for (const [index, intent] of toolIntents.entries())
			validateToolIntent(intent, `d720.effectResult.toolIntents[${index}]`);
		if ((candidate.status === "tool-intents") !== toolIntents.length > 0)
			throw new TypeError("D720 provider tool-intent disposition is inconsistent");
		if (candidate.status === "retryable-failure" && candidate.failureDiscriminator === "none")
			throw new TypeError("D720 retryable failure requires a discriminator");
		if (
			candidate.status !== "retryable-failure" &&
			(candidate.failureDiscriminator !== "none" || candidate.retryAfterMs !== null)
		)
			throw new TypeError("D720 non-retry result cannot carry retry material");
		if (hasFailureProvenance) {
			if (candidate.status !== "terminal-failure")
				throw new TypeError("D720 failure provenance requires terminal failure");
			const provenance = oneOf(
				candidate.failureProvenance,
				["http-terminal", "executor-failure"],
				"d720.effectResult.failureProvenance",
			);
			if (provenance === "http-terminal") {
				if (candidate.executorFailureClassification !== null)
					throw new TypeError("D720 HTTP terminal cannot claim executor failure");
			} else {
				oneOf(
					candidate.executorFailureClassification,
					[
						"graph-admission-denied",
						"executor-threw",
						"invalid-executor-result",
						"transport-failure",
						"route-evidence-failure",
						"response-decode-failure",
					],
					"d720.effectResult.executorFailureClassification",
				);
			}
		}
		digest(candidate.workspaceStateDigest, "d720.effectResult.workspaceStateDigest");
		if (candidate.workspaceStateDigest !== request.workspaceStateDigest)
			throw new TypeError("D720 provider result workspace state drifted during the effect");
	} else if (candidate.effectKind === "retry-wait") {
		exactKeys(candidate, ["effectKind", "evidenceDigest", "status"], "d720.effectResult");
		oneOf(candidate.status, ["completed", "failed"], "d720.effectResult.status");
	} else if (candidate.effectKind === "tool-action") {
		exactKeys(
			candidate,
			[
				"effectKind",
				"evidenceDigest",
				"intentDigest",
				"nonEmptyDiff",
				"status",
				"toolRef",
				"workspaceStateAfterDigest",
				"workspaceStateBeforeDigest",
			],
			"d720.effectResult",
		);
		oneOf(candidate.status, ["succeeded", "failed"], "d720.effectResult.status");
		if (typeof candidate.nonEmptyDiff !== "boolean")
			throw new TypeError("D720 tool diff evidence must be boolean");
		const expected = request.toolIntent;
		if (
			expected === null ||
			candidate.toolRef !== expected.toolRef ||
			candidate.intentDigest !== expected.intentDigest
		)
			throw new TypeError("D720 tool result is not bound to the Graph-issued intent");
		digest(candidate.workspaceStateBeforeDigest, "d720.effectResult.workspaceStateBeforeDigest");
		digest(candidate.workspaceStateAfterDigest, "d720.effectResult.workspaceStateAfterDigest");
		if (candidate.workspaceStateBeforeDigest !== request.workspaceStateDigest)
			throw new TypeError("D720 tool result used a stale workspace state");
		if (candidate.toolRef !== "workspace-diff" && candidate.nonEmptyDiff)
			throw new TypeError("D720 non-diff tool cannot claim a non-empty diff");
		const changed = candidate.workspaceStateBeforeDigest !== candidate.workspaceStateAfterDigest;
		if ((candidate.status === "succeeded" && candidate.toolRef === "replace-exact") !== changed)
			throw new TypeError("D720 tool state transition does not match its Graph phase");
	} else if (candidate.effectKind === "hidden-verifier") {
		exactKeys(
			candidate,
			["effectKind", "evidenceDigest", "status", "workspaceStateDigest"],
			"d720.effectResult",
		);
		oneOf(candidate.status, ["passed", "failed"], "d720.effectResult.status");
		digest(candidate.workspaceStateDigest, "d720.effectResult.workspaceStateDigest");
		if (candidate.workspaceStateDigest !== request.workspaceStateDigest)
			throw new TypeError("D720 verifier did not observe the Graph-authorized workspace state");
	} else {
		exactKeys(candidate, ["effectKind", "evidenceDigest", "status"], "d720.effectResult");
		oneOf(candidate.status, ["succeeded", "failed"], "d720.effectResult.status");
	}
	digest(candidate.evidenceDigest, "d720.effectResult.evidenceDigest");
	return strictSnapshot(candidate) as unknown as D720EffectResultV1;
}

export function admitD720GraphEffectResult(
	runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1,
	request: D720GraphEffectRequestV1,
	value: D720EffectResultV1,
	admissionDigestValue: string,
): D720EffectDecisionV1 {
	const state = runtimeState(runtime);
	if (state.completed) throw new TypeError("D720 effect runtime already completed");
	if (state.nextDecision.effectRequest !== request)
		throw new TypeError("D720 effect result requires the exact active Graph request");
	if (state.facts.length >= D720_MAX_EFFECT_FACTS_PER_RUN)
		throw new TypeError("D720 effect fact bound exhausted");
	const result = validateD720GraphEffectResult(value, request);
	const admissionDigest = digest(admissionDigestValue, "d720.effectResult.admissionDigest");
	const material = strictSnapshot({
		kind: "graph-effect-result-admitted" as const,
		request,
		admissionDigest,
		result,
		resultDigest: empiricalStrictJsonDigest(result),
	});
	const fact = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	const before = state.decisions.length;
	state.facts.push(fact);
	state.factNode.down([["DATA", fact]]);
	const decision = state.decisions[before];
	if (decision === undefined) throw new TypeError("D720 Graph omitted the next effect decision");
	state.nextDecision = decision;
	state.completed = decision.disposition === "complete-arm";
	return decision;
}

export function admitD722GraphEffectResult(
	runtime: D722GraphEffectRuntimeV1,
	request: D720GraphEffectRequestV1,
	value: D720EffectResultV1,
	admissionDigestValue: string,
	usage: { readonly actualCostMicrousd: number; readonly actualElapsedMs: number },
): D720EffectDecisionV1 {
	const state = runtimeState(runtime);
	if (state.mode !== "d722" || state.completed)
		throw new TypeError("D722 effect runtime is not active");
	if (state.nextDecision.effectRequest !== request)
		throw new TypeError("D722 effect result requires the exact active Graph request");
	if (state.facts.length >= D720_MAX_EFFECT_FACTS_PER_RUN)
		throw new TypeError("D722 effect fact bound exhausted");
	const result = validateD720GraphEffectResult(value, request);
	const actualCostMicrousd = safeInteger(usage.actualCostMicrousd, "d722.usage.cost", {
		max: 1_000_000_000,
	});
	const actualElapsedMs = safeInteger(usage.actualElapsedMs, "d722.usage.elapsed", {
		max: 1_000_000_000,
	});
	const admissionDigest = digest(admissionDigestValue, "d722.effectResult.admissionDigest");
	const material = strictSnapshot({
		kind: "graph-effect-result-admitted" as const,
		request,
		admissionDigest,
		result,
		resultDigest: empiricalStrictJsonDigest(result),
		actualCostMicrousd,
		actualElapsedMs,
	});
	const fact = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	const before = state.decisions.length;
	state.facts.push(fact);
	state.factNode.down([["DATA", fact]]);
	const decision = state.decisions[before];
	if (decision === undefined) throw new TypeError("D722 Graph omitted the next effect decision");
	state.nextDecision = decision;
	state.completed = decision.disposition === "complete-arm";
	return decision;
}

export function admitD720GraphCancellation(
	runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1,
	evidenceDigestValue: string,
): D720EffectDecisionV1 {
	const state = runtimeState(runtime);
	if (state.projectionState.cancelled)
		throw new TypeError("D720 effect runtime already admitted cancellation");
	if (
		state.completed &&
		!state.facts.some(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" && fact.result.effectKind === "cleanup",
		)
	)
		throw new TypeError("D720 completed runtime cannot admit cancellation");
	if (state.facts.length >= D720_MAX_EFFECT_FACTS_PER_RUN)
		throw new TypeError("D720 effect fact bound exhausted");
	const evidenceDigest = digest(evidenceDigestValue, "d720.cancellation.evidenceDigest");
	const material = strictSnapshot({
		kind: "graph-cancellation-admitted" as const,
		evidenceDigest,
	});
	const fact = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	const before = state.decisions.length;
	state.facts.push(fact);
	state.factNode.down([["DATA", fact]]);
	const decision = state.decisions[before];
	if (decision === undefined) throw new TypeError("D720 Graph omitted cancellation decision");
	state.nextDecision = decision;
	state.completed = decision.disposition === "complete-arm";
	return decision;
}

export function admitD720GraphEffectBoundExhaustion(
	runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1,
	evidenceDigestValue: string,
): D720EffectDecisionV1 {
	const state = runtimeState(runtime);
	if (state.completed) throw new TypeError("D720 effect runtime already completed");
	if (
		state.facts.length !== D720_MAX_EFFECT_FACTS_PER_RUN - 3 ||
		state.projectionState.cancelled ||
		state.facts.some((fact) => fact.kind === "graph-effect-bound-exhausted") ||
		state.nextDecision.effectRequest?.effectKind === "cleanup"
	)
		throw new TypeError("D720 effect bound is not Graph-eligible");
	const evidenceDigest = digest(evidenceDigestValue, "d720.effectBound.evidenceDigest");
	const material = strictSnapshot({
		kind: "graph-effect-bound-exhausted" as const,
		evidenceDigest,
	});
	const fact = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	const before = state.decisions.length;
	state.facts.push(fact);
	state.factNode.down([["DATA", fact]]);
	const decision = state.decisions[before];
	if (decision === undefined) throw new TypeError("D720 Graph omitted effect-bound decision");
	state.nextDecision = decision;
	state.completed = decision.disposition === "complete-arm";
	return decision;
}

function snapshotGraphEffectEvidence(
	runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1,
	runtimeStatus: "complete" | "cancelled" | "stopped" = "complete",
): D720GraphEffectEvidenceV1 | D722GraphEffectEvidenceV1 {
	const state = runtimeState(runtime);
	if (runtimeStatus === "complete" && !state.completed)
		throw new TypeError("D720 cannot snapshot an active effect runtime as complete");
	const topologyRaw = state.owner.topology();
	const topology = strictSnapshot({
		nodes: topologyRaw.nodes.map((node) => ({
			id: node.id,
			factory: node.factory,
			deps: Object.freeze([...node.deps]),
		})),
		edges: topologyRaw.edges,
	});
	const baseMaterial = {
		schemaVersion:
			state.mode === "d720" ? D720_EFFECT_EVIDENCE_SCHEMA : D722_EFFECT_EVIDENCE_SCHEMA,
		runtimeRevision:
			state.mode === "d720" ? D720_EFFECT_RUNTIME_REVISION : D722_EFFECT_RUNTIME_REVISION,
		runSequence: state.runSequence,
		issuedRequestDigest: state.requestDigest,
		runtimeStatus,
		facts: state.facts,
		decisions: state.decisions,
		topology,
		topologyDigest: empiricalStrictJsonDigest(topology),
	};
	const material = strictSnapshot(
		state.mode === "d722" ? { ...baseMaterial, budgetContext: state.budgetContext } : baseMaterial,
	);
	return Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as D720GraphEffectEvidenceV1 | D722GraphEffectEvidenceV1;
}

export function snapshotD720GraphEffectEvidence(
	runtime: D720GraphEffectRuntimeV1,
	runtimeStatus: "complete" | "cancelled" | "stopped" = "complete",
): D720GraphEffectEvidenceV1 {
	const state = runtimeState(runtime);
	if (state.mode !== "d720") throw new TypeError("D720 snapshot cannot encode a D722 runtime");
	return snapshotGraphEffectEvidence(runtime, runtimeStatus) as D720GraphEffectEvidenceV1;
}

export function snapshotD722GraphEffectEvidence(
	runtime: D722GraphEffectRuntimeV1,
	runtimeStatus: "complete" | "cancelled" | "stopped" = "complete",
): D722GraphEffectEvidenceV1 {
	const state = runtimeState(runtime);
	if (state.mode !== "d722") throw new TypeError("D722 snapshot requires a D722 runtime");
	return snapshotGraphEffectEvidence(runtime, runtimeStatus) as D722GraphEffectEvidenceV1;
}

function validateGraphEffectEvidence(
	value: unknown,
	requestValue: AgentRequestIssued<D719CleanRequestInput>,
	expectedRunSequence?: number,
	mode: "d720" | "d722" = "d720",
	armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1,
	objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1,
): D720GraphEffectEvidenceV1 | D722GraphEffectEvidenceV1 {
	const candidate = record(value, "d720.effectEvidence");
	exactKeys(
		candidate,
		mode === "d722"
			? [
					"budgetContext",
					"decisions",
					"evidenceDigest",
					"facts",
					"issuedRequestDigest",
					"runtimeStatus",
					"runSequence",
					"runtimeRevision",
					"schemaVersion",
					"topology",
					"topologyDigest",
				]
			: [
					"decisions",
					"evidenceDigest",
					"facts",
					"issuedRequestDigest",
					"runtimeStatus",
					"runSequence",
					"runtimeRevision",
					"schemaVersion",
					"topology",
					"topologyDigest",
				],
		"d720.effectEvidence",
	);
	let budgetContext: D722GraphBudgetContextV1 | null = null;
	if (mode === "d722") {
		const rawBudget = record(candidate.budgetContext, "d722.effectEvidence.budgetContext");
		exactKeys(
			rawBudget,
			["initialState", "limits", "providerMaxCostMicrousd", "providerMaxElapsedMs"],
			"d722.effectEvidence.budgetContext",
		);
		const limits = record(rawBudget.limits, "d722.effectEvidence.budgetContext.limits");
		exactKeys(
			limits,
			["maxCostMicrousd", "maxElapsedMs", "maxRequests", "maxRetryWaits"],
			"d722.effectEvidence.budgetContext.limits",
		);
		for (const key of ["maxCostMicrousd", "maxElapsedMs", "maxRequests", "maxRetryWaits"] as const)
			safeInteger(limits[key], `d722.effectEvidence.budgetContext.limits.${key}`, {
				max: 1_000_000_000,
			});
		for (const key of ["providerMaxCostMicrousd", "providerMaxElapsedMs"] as const)
			safeInteger(rawBudget[key], `d722.effectEvidence.budgetContext.${key}`, {
				max: 1_000_000_000,
			});
		const initialState = record(
			rawBudget.initialState,
			"d722.effectEvidence.budgetContext.initialState",
		);
		exactKeys(
			initialState,
			["costMicrousd", "elapsedMs", "requests", "retryWaits"],
			"d722.effectEvidence.budgetContext.initialState",
		);
		for (const key of ["costMicrousd", "elapsedMs", "requests", "retryWaits"] as const)
			safeInteger(initialState[key], `d722.effectEvidence.budgetContext.initialState.${key}`, {
				max: 1_000_000_000,
			});
		budgetContext = strictSnapshot(rawBudget) as unknown as D722GraphBudgetContextV1;
	}
	const facts = boundedArray(
		candidate.facts,
		"d720.effectEvidence.facts",
		D720_MAX_EFFECT_FACTS_PER_RUN,
	);
	const decisions = boundedArray(
		candidate.decisions,
		"d720.effectEvidence.decisions",
		D720_MAX_EFFECT_FACTS_PER_RUN + 1,
	);
	if (facts.length > D720_MAX_EFFECT_FACTS_PER_RUN || decisions.length !== facts.length + 1)
		throw new TypeError("D720 effect evidence cardinality is invalid");
	const topology = record(candidate.topology, "d720.effectEvidence.topology");
	exactKeys(topology, ["edges", "nodes"], "d720.effectEvidence.topology");
	const topologyNodes = boundedArray(topology.nodes, "d720.effectEvidence.topology.nodes", 4);
	const topologyEdges = boundedArray(topology.edges, "d720.effectEvidence.topology.edges", 4);
	for (const [index, rawNode] of topologyNodes.entries()) {
		const node = record(rawNode, `d720.effectEvidence.topology.nodes[${index}]`);
		exactKeys(node, ["deps", "factory", "id"], `d720.effectEvidence.topology.nodes[${index}]`);
		if (
			typeof node.id !== "string" ||
			node.id.length > 128 ||
			typeof node.factory !== "string" ||
			node.factory.length > 128
		)
			throw new TypeError("D720 topology node coordinate is unbounded");
		const deps = boundedArray(node.deps, `d720.effectEvidence.topology.nodes[${index}].deps`, 4);
		if (deps.some((dep) => typeof dep !== "string" || dep.length > 128))
			throw new TypeError("D720 topology dependency coordinate is unbounded");
	}
	for (const [index, rawEdge] of topologyEdges.entries()) {
		const edge = record(rawEdge, `d720.effectEvidence.topology.edges[${index}]`);
		exactKeys(edge, ["from", "to"], `d720.effectEvidence.topology.edges[${index}]`);
		if (
			typeof edge.from !== "string" ||
			edge.from.length > 128 ||
			typeof edge.to !== "string" ||
			edge.to.length > 128
		)
			throw new TypeError("D720 topology edge coordinate is unbounded");
	}
	const request = strictSnapshot(requestValue) as AgentRequestIssued<D719CleanRequestInput>;
	const requestDigest = empiricalStrictJsonDigest(request);
	if (candidate.issuedRequestDigest !== requestDigest)
		throw new TypeError("D720 effect evidence request provenance drifted");
	const runSequence = safeInteger(candidate.runSequence, "d720.effectEvidence.runSequence", {
		min: 0,
		max: 11,
	});
	if (expectedRunSequence !== undefined && runSequence !== expectedRunSequence)
		throw new TypeError("D720 effect evidence run sequence drifted");
	if (
		candidate.schemaVersion !==
			(mode === "d720" ? D720_EFFECT_EVIDENCE_SCHEMA : D722_EFFECT_EVIDENCE_SCHEMA) ||
		candidate.runtimeRevision !==
			(mode === "d720" ? D720_EFFECT_RUNTIME_REVISION : D722_EFFECT_RUNTIME_REVISION) ||
		!(["complete", "cancelled", "stopped"] as const).includes(
			candidate.runtimeStatus as "complete" | "cancelled" | "stopped",
		)
	)
		throw new TypeError("D720 effect evidence coordinates drifted");
	for (const [index, decision] of decisions.entries())
		assertBoundedEvidenceTree(decision, `d720.effectEvidence.decisions[${index}]`);
	const runtime =
		mode === "d720"
			? createD720GraphEffectRuntime({ request, runSequence })
			: createD722GraphEffectRuntime({
					request,
					runSequence,
					completionContextPolicy: createD722GraphCompletionContextPolicy(),
					budgetContext: budgetContext!,
					...(armLocalTerminalPolicy === undefined ? {} : { armLocalTerminalPolicy }),
					...(objectivePhaseRecoveryPolicy === undefined ? {} : { objectivePhaseRecoveryPolicy }),
				});
	if (
		empiricalStrictJsonDigest(nextD720GraphEffectDecision(runtime)) !==
		empiricalStrictJsonDigest(decisions[0])
	)
		throw new TypeError("D720 initial effect decision is not Graph-derived");
	for (const [index, rawFact] of facts.entries()) {
		assertBoundedEvidenceTree(rawFact, `d720.effectEvidence.facts[${index}]`);
		const fact = record(rawFact, `d720.effectEvidence.facts[${index}]`);
		if (fact.kind === "graph-effect-bound-exhausted") {
			exactKeys(
				fact,
				["evidenceDigest", "factDigest", "kind"],
				`d720.effectEvidence.facts[${index}]`,
			);
			const next = admitD720GraphEffectBoundExhaustion(runtime, fact.evidenceDigest as string);
			const replayedFact = runtimeState(runtime).facts[index];
			if (
				replayedFact === undefined ||
				empiricalStrictJsonDigest(replayedFact) !== empiricalStrictJsonDigest(fact) ||
				empiricalStrictJsonDigest(next) !== empiricalStrictJsonDigest(decisions[index + 1])
			)
				throw new TypeError("D720 effect-bound evidence is not a canonical Graph replay");
			continue;
		}
		if (fact.kind === "graph-cancellation-admitted") {
			exactKeys(
				fact,
				["evidenceDigest", "factDigest", "kind"],
				`d720.effectEvidence.facts[${index}]`,
			);
			const next = admitD720GraphCancellation(runtime, fact.evidenceDigest as string);
			const replayedFact = runtimeState(runtime).facts[index];
			if (
				replayedFact === undefined ||
				empiricalStrictJsonDigest(replayedFact) !== empiricalStrictJsonDigest(fact) ||
				empiricalStrictJsonDigest(next) !== empiricalStrictJsonDigest(decisions[index + 1])
			)
				throw new TypeError("D720 cancellation evidence is not a canonical Graph replay");
			continue;
		}
		exactKeys(
			fact,
			mode === "d722"
				? [
						"actualCostMicrousd",
						"actualElapsedMs",
						"admissionDigest",
						"factDigest",
						"kind",
						"request",
						"result",
						"resultDigest",
					]
				: ["admissionDigest", "factDigest", "kind", "request", "result", "resultDigest"],
			`d720.effectEvidence.facts[${index}]`,
		);
		if (fact.kind !== "graph-effect-result-admitted")
			throw new TypeError("D720 effect fact kind drifted");
		const active = nextD720GraphEffectDecision(runtime).effectRequest;
		if (
			active === null ||
			empiricalStrictJsonDigest(active) !== empiricalStrictJsonDigest(fact.request)
		)
			throw new TypeError("D720 effect fact does not bind the active Graph request");
		const next =
			mode === "d722"
				? admitD722GraphEffectResult(
						runtime as D722GraphEffectRuntimeV1,
						active,
						fact.result as D720EffectResultV1,
						fact.admissionDigest as string,
						{
							actualCostMicrousd: fact.actualCostMicrousd as number,
							actualElapsedMs: fact.actualElapsedMs as number,
						},
					)
				: admitD720GraphEffectResult(
						runtime,
						active,
						fact.result as D720EffectResultV1,
						fact.admissionDigest as string,
					);
		const replayedFact = runtimeState(runtime).facts[index];
		if (
			replayedFact === undefined ||
			empiricalStrictJsonDigest(replayedFact) !== empiricalStrictJsonDigest(fact) ||
			empiricalStrictJsonDigest(next) !== empiricalStrictJsonDigest(decisions[index + 1])
		)
			throw new TypeError("D720 effect evidence is not a canonical Graph replay");
	}
	const replayed =
		mode === "d720"
			? snapshotD720GraphEffectEvidence(
					runtime as D720GraphEffectRuntimeV1,
					candidate.runtimeStatus as "complete" | "cancelled" | "stopped",
				)
			: snapshotD722GraphEffectEvidence(
					runtime as D722GraphEffectRuntimeV1,
					candidate.runtimeStatus as "complete" | "cancelled" | "stopped",
				);
	const snapshot = strictSnapshot(candidate) as unknown as
		| D720GraphEffectEvidenceV1
		| D722GraphEffectEvidenceV1;
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(snapshot))
		throw new TypeError("D720 effect evidence digest does not match canonical Graph replay");
	return snapshot;
}

export function validateD720GraphEffectEvidence(
	value: unknown,
	requestValue: AgentRequestIssued<D719CleanRequestInput>,
	expectedRunSequence?: number,
): D720GraphEffectEvidenceV1 {
	return validateGraphEffectEvidence(
		value,
		requestValue,
		expectedRunSequence,
		"d720",
	) as D720GraphEffectEvidenceV1;
}

export function validateD722GraphEffectEvidence(
	value: unknown,
	requestValue: AgentRequestIssued<D719CleanRequestInput>,
	expectedRunSequence?: number,
	armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1,
	objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1,
): D722GraphEffectEvidenceV1 {
	return validateGraphEffectEvidence(
		value,
		requestValue,
		expectedRunSequence,
		"d722",
		armLocalTerminalPolicy,
		objectivePhaseRecoveryPolicy,
	) as D722GraphEffectEvidenceV1;
}

export function deriveD720GraphArmResultFromEvidence(
	value: unknown,
	request: AgentRequestIssued<D719CleanRequestInput>,
	expectedRunSequence: number,
): D719CallerArmResultV1 {
	const evidence = validateD720GraphEffectEvidence(value, request, expectedRunSequence);
	const runtime = createD720GraphEffectRuntime({ request, runSequence: expectedRunSequence });
	for (const fact of evidence.facts) {
		if (fact.kind === "graph-cancellation-admitted") {
			admitD720GraphCancellation(runtime, fact.evidenceDigest);
		} else if (fact.kind === "graph-effect-bound-exhausted") {
			admitD720GraphEffectBoundExhaustion(runtime, fact.evidenceDigest);
		} else {
			const active = nextD720GraphEffectDecision(runtime).effectRequest;
			if (active === null) throw new TypeError("D720 replay omitted an active effect request");
			admitD720GraphEffectResult(runtime, active, fact.result, fact.admissionDigest);
		}
	}
	return deriveD720GraphArmResult(runtime);
}

export function deriveD722GraphArmResultFromEvidence(
	value: unknown,
	request: AgentRequestIssued<D719CleanRequestInput>,
	expectedRunSequence: number,
	armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1,
	objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1,
): D719CallerArmResultV1 {
	const evidence = validateD722GraphEffectEvidence(
		value,
		request,
		expectedRunSequence,
		armLocalTerminalPolicy,
		objectivePhaseRecoveryPolicy,
	);
	const runtime = createD722GraphEffectRuntime({
		request,
		runSequence: expectedRunSequence,
		completionContextPolicy: createD722GraphCompletionContextPolicy(),
		budgetContext: evidence.budgetContext,
		...(armLocalTerminalPolicy === undefined ? {} : { armLocalTerminalPolicy }),
		...(objectivePhaseRecoveryPolicy === undefined ? {} : { objectivePhaseRecoveryPolicy }),
	});
	for (const fact of evidence.facts) {
		if (fact.kind === "graph-cancellation-admitted") {
			admitD720GraphCancellation(runtime, fact.evidenceDigest);
		} else if (fact.kind === "graph-effect-bound-exhausted") {
			admitD720GraphEffectBoundExhaustion(runtime, fact.evidenceDigest);
		} else {
			const active = nextD720GraphEffectDecision(runtime).effectRequest;
			if (active === null) throw new TypeError("D722 replay omitted an active effect request");
			admitD722GraphEffectResult(runtime, active, fact.result, fact.admissionDigest, {
				actualCostMicrousd: fact.actualCostMicrousd,
				actualElapsedMs: fact.actualElapsedMs,
			});
		}
	}
	return deriveD720GraphArmResult(runtime);
}

export function deriveD720GraphArmResult(
	runtime: D720GraphEffectRuntimeV1 | D722GraphEffectRuntimeV1,
): D719CallerArmResultV1 {
	const state = runtimeState(runtime);
	if (!state.completed) throw new TypeError("D720 cannot derive an active arm result");
	const facts = state.facts.flatMap((fact) =>
		fact.kind === "graph-effect-result-admitted" ? [fact.result] : [],
	);
	const materialization = facts.find((fact) => fact.effectKind === "materialization");
	const cleanup = [...facts].reverse().find((fact) => fact.effectKind === "cleanup");
	const lastDecision = state.decisions.at(-1);
	if (
		materialization?.effectKind !== "materialization" ||
		cleanup?.effectKind !== "cleanup" ||
		lastDecision === undefined
	)
		throw new TypeError("D720 completed runtime lacks ownership evidence");
	const verifier = [...facts].reverse().find((fact) => fact.effectKind === "hidden-verifier");
	return strictSnapshot({
		materialization: {
			status: materialization.status,
			evidenceDigest: materialization.evidenceDigest,
		},
		execution: {
			traceComplete: lastDecision.traceComplete,
			executorFailed: state.projectionState.executorFailed,
			...(state.projectionState.terminalProviderFailure
				? { terminalProviderFailure: true as const }
				: {}),
			inspectionObserved: state.projectionState.inspectionObserved,
			contentChangingMutationObserved: state.projectionState.mutationObserved,
			nonEmptyDiffAfterLatestMutation: state.projectionState.diffObserved,
			focusedValidationAttempted: state.projectionState.validationAttempted,
			focusedValidationPassed: state.projectionState.validationPassed,
			hiddenVerifierAttempted: state.projectionState.verifierAttempted && verifier !== undefined,
			hiddenVerifierPassed: state.projectionState.verifierPassed,
			cancelled: state.projectionState.cancelled,
		},
		cleanup: {
			status: cleanup.status,
			evidenceDigest: cleanup.evidenceDigest,
		},
	}) as unknown as D719CallerArmResultV1;
}
