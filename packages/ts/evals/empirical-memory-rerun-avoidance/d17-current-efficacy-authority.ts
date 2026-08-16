import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
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

export const D17_DECISION_REF = "graphrefly-ts:D17" as const;
export const D17_AUTHORITY_REVISION = "graphrefly-ts.d17.current-efficacy-authority.v1" as const;
export const D17_EVIDENCE_SCHEMA = "graphrefly-ts.d17.current-efficacy-evidence.v1" as const;
export const D17_GATE_SCHEMA = "graphrefly-ts.d17.positive-differential-gate.v1" as const;
export const D17_MUTATION_PROVIDER_DEADLINE_MS = 240_000 as const;
export const D17_DEFAULT_PROVIDER_DEADLINE_MS = 120_000 as const;
export const D17_TASK_STATEMENT =
	"Managed cloud PostgreSQL must admit only producer-owned canonical run-admission proposal provenance before a worker claim. Inspect the producer contract and canonical identity helpers, then make the smallest consumer change that accepts the valid canonical proposal and rejects malformed or locally reconstructed proposal provenance." as const;
export const D17_ACCEPTANCE_CRITERIA = Object.freeze([
	"A fresh producer-owned canonical run-admission proposal is admitted before worker claim.",
	"Malformed and non-canonical proposal provenance is rejected before store mutation.",
	"Locally reconstructed proposal provenance that disagrees with the producer ref is rejected.",
	"Authorization, fencing, lease, credential and claim invariants remain intact.",
	"Only packages/ts/src/executors/managed-cloud-postgresql.ts changes.",
] as const);
export const D17_COMPLETE_TASK_STATEMENT =
	`${D17_TASK_STATEMENT}\n\nAcceptance criteria:\n${D17_ACCEPTANCE_CRITERIA.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}\n\nReadable files: packages/ts/src/executors/managed-cloud-postgresql.ts, packages/ts/src/executors/managed-untrusted-js-compute.ts, packages/ts/src/identity.ts, packages/ts/src/orchestration/agent-runtime-tool-provider-run-admission.ts\nWritable file: packages/ts/src/executors/managed-cloud-postgresql.ts` as const;

export const D17_ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export type D17Arm = (typeof D17_ARMS)[number];
export type D17ToolRef = "read-file" | "replace-exact" | "workspace-diff" | "focused-validation";
export type D17EffectKind =
	| "materialization"
	| "provider-request"
	| "tool-action"
	| "public-semantic-validation"
	| "hidden-verifier"
	| "cleanup";
export type D17Phase =
	| "unmaterialized"
	| "inspection"
	| "mutation"
	| "diff"
	| "focused-validation"
	| "public-semantic-validation"
	| "hidden-verifier"
	| "cleanup"
	| "complete";

export interface D17BudgetLimitsV1 {
	readonly maxProviderRequests: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
	readonly maxEffectFacts: number;
	readonly providerMaxCostMicrousd: number;
	readonly localEffectMaxElapsedMs: number;
}

export interface D17BudgetStateV1 {
	readonly providerRequests: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly effectFacts: number;
}

export const D17_QUALIFICATION_LIMITS = Object.freeze({
	maxProviderRequests: 96,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
	maxEffectFacts: 512,
	providerMaxCostMicrousd: 100_000,
	localEffectMaxElapsedMs: 10_000,
}) satisfies D17BudgetLimitsV1;

const EXPOSURE_DEFINITIONS = Object.freeze({
	cold: Object.freeze({ disposition: "none", insightClass: "none" }),
	"relevant-applied": Object.freeze({
		disposition: "admitted-applied",
		insightClass: "relevant-provenance",
	}),
	"proposal-only": Object.freeze({ disposition: "proposal-unadmitted", insightClass: "none" }),
	"admission-rejected": Object.freeze({
		disposition: "admission-rejected",
		insightClass: "none",
	}),
	"irrelevant-applied": Object.freeze({
		disposition: "admitted-applied",
		insightClass: "irrelevant-retry-accounting",
	}),
	"wrong-scope-applied": Object.freeze({
		disposition: "admitted-applied",
		insightClass: "wrong-scope-executor-cancellation",
	}),
} as const);

const EXPOSURE_TEXT = Object.freeze({
	"relevant-provenance":
		"When accepting a producer-owned canonical proposal, preserve its proposal coordinate separately from the later admission coordinate and reject any locally reconstructed or mismatched provenance before mutation.",
	"irrelevant-retry-accounting":
		"When a bounded retry is admitted, reconcile every transport attempt independently and retain the original logical-request coordinate across the serial retry.",
	"wrong-scope-executor-cancellation":
		"For managed untrusted compute, cancellation ownership must be established before releasing executor capacity to a replacement task.",
} as const);

export type D17ExposureDisposition = (typeof EXPOSURE_DEFINITIONS)[D17Arm]["disposition"];
export type D17InsightClass = (typeof EXPOSURE_DEFINITIONS)[D17Arm]["insightClass"];

export interface D17ExposureFactV1 {
	readonly schemaVersion: "graphrefly-ts.d17.exposure-fact.v1";
	readonly sequence: number;
	readonly arm: D17Arm;
	readonly disposition: D17ExposureDisposition;
	readonly insightClass: D17InsightClass;
	readonly insightDigest: string | null;
	readonly modelVisibleEnvelopeDigest: string;
	readonly factDigest: string;
}

export interface D17EffectRequestV1 {
	readonly schemaVersion: "graphrefly-ts.d17.effect-request.v1";
	readonly sequence: number;
	readonly arm: D17Arm;
	readonly effectKind: D17EffectKind;
	readonly phase: D17Phase;
	readonly toolRef: D17ToolRef | null;
	readonly requiredFirstToolRef: "replace-exact" | null;
	readonly exposureFactDigest: string;
	readonly modelVisibleEnvelopeDigest: string;
	readonly envelopeBindingDigest: string | null;
	readonly workspaceStateDigest: string | null;
	readonly logicalRequestDigest: string | null;
	readonly attemptOrdinal: number | null;
	readonly lifecycleHeadroom: Readonly<{
		providerRequests: 1;
		maxCostMicrousd: number;
		maxElapsedMs: number;
		effectFacts: 7;
	}> | null;
	readonly reservation: Readonly<{
		providerRequests: 0 | 1;
		maxCostMicrousd: number;
		maxElapsedMs: number;
	}>;
	readonly requestDigest: string;
}

export interface D17EffectAdmissionV1 {
	readonly schemaVersion: "graphrefly-ts.d17.effect-admission.v1";
	readonly requestDigest: string;
	readonly admitted: true;
	readonly budgetBefore: D17BudgetStateV1;
	readonly prospectiveBudget: D17BudgetStateV1;
	readonly admissionDigest: string;
}

export interface D17AdmittedEffectV1 {
	readonly request: D17EffectRequestV1;
	readonly admission: D17EffectAdmissionV1;
}

export type D17EffectResultInputV1 =
	| Readonly<{
			effectKind: "materialization";
			status: "completed" | "failed";
			workspaceStateDigest: string | null;
			evidenceDigest: string;
			actualCostMicrousd: 0;
			actualElapsedMs: number;
	  }>
	| Readonly<{
			effectKind: "provider-request";
			status: "completed" | "failed";
			toolIntents: readonly D17ToolRef[];
			observedModelVisibleEnvelopeDigest: string;
			wireMessagesDigest: string;
			failureFamily: "transport" | "http" | "executor" | null;
			evidenceDigest: string;
			actualCostMicrousd: number;
			actualElapsedMs: number;
	  }>
	| Readonly<{
			effectKind: "tool-action";
			toolRef: D17ToolRef;
			status: "succeeded" | "failed";
			workspaceStateBeforeDigest: string;
			workspaceStateAfterDigest: string;
			nonEmptyDiff: boolean;
			evidenceDigest: string;
			actualCostMicrousd: 0;
			actualElapsedMs: number;
	  }>
	| Readonly<{
			effectKind: "public-semantic-validation";
			status: "passed" | "failed";
			criterionFailureCodes: readonly string[];
			workspaceStateDigest: string;
			evidenceDigest: string;
			actualCostMicrousd: 0;
			actualElapsedMs: number;
	  }>
	| Readonly<{
			effectKind: "hidden-verifier";
			status: "passed" | "failed";
			workspaceStateDigest: string;
			evidenceDigest: string;
			actualCostMicrousd: 0;
			actualElapsedMs: number;
	  }>
	| Readonly<{
			effectKind: "cleanup";
			status: "completed" | "failed";
			workspaceStateDigest: string | null;
			evidenceDigest: string;
			actualCostMicrousd: 0;
			actualElapsedMs: number;
	  }>;

export interface D17AdmittedEffectFactV1 {
	readonly schemaVersion: "graphrefly-ts.d17.effect-fact.v1";
	readonly sequence: number;
	readonly arm: D17Arm;
	readonly request: D17EffectRequestV1;
	readonly admission: D17EffectAdmissionV1;
	readonly result: D17EffectResultInputV1;
	readonly reconciliation: Readonly<{
		actualCostMicrousd: number;
		actualElapsedMs: number;
		budgetAfter: D17BudgetStateV1;
		reconciliationDigest: string;
	}>;
	readonly factDigest: string;
}

export interface D17RunProjectionV1 {
	readonly arm: D17Arm;
	readonly exposureFactDigest: string;
	readonly phase: D17Phase;
	readonly evaluable: boolean;
	readonly mutationCompleted: boolean;
	readonly diffCompleted: boolean;
	readonly focusedValidationPassed: boolean;
	readonly publicSemanticValidationPassed: boolean;
	readonly hiddenVerifierPassed: boolean;
	readonly cleanupCompleted: boolean;
	readonly providerFailureFamily: "transport" | "http" | "executor" | null;
	readonly projectionDigest: string;
}

export interface D17PositiveDifferentialGateV1 {
	readonly schemaVersion: typeof D17_GATE_SCHEMA;
	readonly definitionDigest: string;
	readonly evaluated: boolean;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly gateDigest: string;
}

export interface D17EvidenceV1 {
	readonly schemaVersion: typeof D17_EVIDENCE_SCHEMA;
	readonly decisionRef: typeof D17_DECISION_REF;
	readonly authorityRevision: typeof D17_AUTHORITY_REVISION;
	readonly topology: Readonly<{
		exposureNode: "current/d17/exposures";
		factNode: "current/d17/admitted-facts";
		projectionNode: "current/d17/projection";
		arms: typeof D17_ARMS;
		topologyDigest: string;
	}>;
	readonly limits: D17BudgetLimitsV1;
	readonly exposureFacts: readonly D17ExposureFactV1[];
	readonly effectFacts: readonly D17AdmittedEffectFactV1[];
	readonly runs: readonly D17RunProjectionV1[];
	readonly budget: D17BudgetStateV1;
	readonly maxActiveEffects: 1;
	readonly runStatus: "complete" | "stopped";
	readonly gate: D17PositiveDifferentialGateV1;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly evidenceDigest: string;
}

export interface D17AuthorityV1 {
	readonly revision: typeof D17_AUTHORITY_REVISION;
}

interface RunState {
	armIndex: number;
	phase: D17Phase;
	workspaceStateDigest: string | null;
	exposure: D17ExposureFactV1;
	inspectionCount: number;
	inspectionOutputs: string[];
	mutationCompleted: boolean;
	diffCompleted: boolean;
	focusedValidationPassed: boolean;
	publicSemanticValidationPassed: boolean;
	hiddenVerifierPassed: boolean;
	cleanupCompleted: boolean;
	providerFailureFamily: "transport" | "http" | "executor" | null;
}

interface RuntimeMaterial {
	readonly taskStatement: string;
	readonly exposureText: string | null;
	readonly modelVisibleEnvelope: string;
}

function createD17FactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D17AdmittedEffectFactV1>([], null, {
		name: "current/d17/admitted-facts",
	});
}

function createD17ExposureNode(owner: ReturnType<typeof graph>) {
	return owner.node<D17ExposureFactV1>([], null, { name: "current/d17/exposures" });
}

interface AuthorityState {
	readonly owner: ReturnType<typeof graph>;
	readonly exposureNode: ReturnType<typeof createD17ExposureNode>;
	readonly factNode: ReturnType<typeof createD17FactNode>;
	readonly limits: D17BudgetLimitsV1;
	readonly exposureFacts: D17ExposureFactV1[];
	readonly effectFacts: D17AdmittedEffectFactV1[];
	readonly runs: D17RunProjectionV1[];
	budget: D17BudgetStateV1;
	nextSequence: number;
	active: D17AdmittedEffectV1 | null;
	run: RunState;
	finished: boolean;
}

const states = new WeakMap<object, AuthorityState>();
const providerMaterials = new WeakMap<object, RuntimeMaterial>();

const ZERO_BUDGET = Object.freeze({
	providerRequests: 0,
	confirmedCostMicrousd: 0,
	confirmedElapsedMs: 0,
	effectFacts: 0,
}) satisfies D17BudgetStateV1;

export const D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION = strictSnapshot({
	revision: "graphrefly-ts.d17.positive-differential-gate-definition.v1",
	armOrder: D17_ARMS,
	exposureMatrix: EXPOSURE_DEFINITIONS,
	taskStatementDigest: empiricalStrictJsonDigest({ taskStatement: D17_COMPLETE_TASK_STATEMENT }),
	phaseDeadlines: {
		mutationProviderMs: D17_MUTATION_PROVIDER_DEADLINE_MS,
		otherProviderMs: D17_DEFAULT_PROVIDER_DEADLINE_MS,
	},
	requireAllEvaluable: true,
	requireNoProviderFailures: true,
	requireExactAccountingCleanupAndProvenance: true,
	requiredHiddenVerifierOutcomes: {
		cold: false,
		"relevant-applied": true,
		"proposal-only": false,
		"admission-rejected": false,
		"irrelevant-applied": false,
		"wrong-scope-applied": false,
	},
	causalAttribution: "undetermined",
});
export const D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST = empiricalStrictJsonDigest(
	D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION,
);

function exposureEnvelope(arm: D17Arm, taskStatement: string): RuntimeMaterial {
	const definition = EXPOSURE_DEFINITIONS[arm];
	const exposureText =
		definition.insightClass === "none" ? null : EXPOSURE_TEXT[definition.insightClass];
	const dispositionLine = `Memory disposition: ${definition.disposition}.`;
	const insightLine = exposureText === null ? "No admitted memory insight content." : exposureText;
	return Object.freeze({
		taskStatement,
		exposureText,
		modelVisibleEnvelope: `${taskStatement}\n\n${dispositionLine}\n${insightLine}`,
	});
}

function createExposureFact(sequence: number, arm: D17Arm, material: RuntimeMaterial) {
	const definition = EXPOSURE_DEFINITIONS[arm];
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d17.exposure-fact.v1" as const,
		sequence,
		arm,
		disposition: definition.disposition,
		insightClass: definition.insightClass,
		insightDigest:
			material.exposureText === null
				? null
				: empiricalStrictJsonDigest({ insight: material.exposureText }),
		modelVisibleEnvelopeDigest: empiricalStrictJsonDigest({
			messages: [{ role: "user", content: material.modelVisibleEnvelope }],
		}),
	});
	return Object.freeze({ ...base, factDigest: empiricalStrictJsonDigest(base) });
}

function initialRun(sequence: number, armIndex: number, taskStatement: string): RunState {
	const arm = D17_ARMS[armIndex];
	if (arm === undefined) throw new TypeError("D17 arm index is out of bounds");
	const material = exposureEnvelope(arm, taskStatement);
	const exposure = createExposureFact(sequence, arm, material);
	return {
		armIndex,
		phase: "unmaterialized",
		workspaceStateDigest: null,
		exposure,
		inspectionCount: 0,
		inspectionOutputs: [],
		mutationCompleted: false,
		diffCompleted: false,
		focusedValidationPassed: false,
		publicSemanticValidationPassed: false,
		hiddenVerifierPassed: false,
		cleanupCompleted: false,
		providerFailureFamily: null,
	};
}

function currentArm(state: AuthorityState): D17Arm {
	const arm = D17_ARMS[state.run.armIndex];
	if (arm === undefined) throw new TypeError("D17 current arm is invalid");
	return arm;
}

function reservationFor(state: AuthorityState, kind: D17EffectKind, phase: D17Phase) {
	if (kind !== "provider-request")
		return Object.freeze({
			providerRequests: 0 as const,
			maxCostMicrousd: 0,
			maxElapsedMs: state.limits.localEffectMaxElapsedMs,
		});
	return Object.freeze({
		providerRequests: 1 as const,
		maxCostMicrousd: state.limits.providerMaxCostMicrousd,
		maxElapsedMs:
			phase === "mutation" ? D17_MUTATION_PROVIDER_DEADLINE_MS : D17_DEFAULT_PROVIDER_DEADLINE_MS,
	});
}

function prospectiveBudget(
	state: AuthorityState,
	reservation: ReturnType<typeof reservationFor>,
): D17BudgetStateV1 {
	return Object.freeze({
		providerRequests: state.budget.providerRequests + reservation.providerRequests,
		confirmedCostMicrousd: state.budget.confirmedCostMicrousd + reservation.maxCostMicrousd,
		confirmedElapsedMs: state.budget.confirmedElapsedMs + reservation.maxElapsedMs,
		effectFacts: state.budget.effectFacts + 1,
	});
}

function withinLimits(state: AuthorityState, candidate: D17BudgetStateV1): boolean {
	return (
		candidate.providerRequests <= state.limits.maxProviderRequests &&
		candidate.confirmedCostMicrousd <= state.limits.maxCostMicrousd &&
		candidate.confirmedElapsedMs <= state.limits.maxElapsedMs &&
		candidate.effectFacts <= state.limits.maxEffectFacts
	);
}

function schedule(
	state: AuthorityState,
	effectKind: D17EffectKind,
	phase: D17Phase,
	toolRef: D17ToolRef | null = null,
): void {
	if (state.active !== null || state.finished) throw new TypeError("D17 effect overlap");
	const reservation = reservationFor(state, effectKind, phase);
	const prospective = prospectiveBudget(state, reservation);
	const lifecycleHeadroom =
		effectKind === "provider-request" && phase === "mutation"
			? Object.freeze({
					providerRequests: 1 as const,
					maxCostMicrousd: state.limits.providerMaxCostMicrousd,
					maxElapsedMs:
						D17_MUTATION_PROVIDER_DEADLINE_MS + 6 * state.limits.localEffectMaxElapsedMs,
					effectFacts: 7 as const,
				})
			: null;
	const lifecycleBudget =
		lifecycleHeadroom === null
			? prospective
			: Object.freeze({
					providerRequests: state.budget.providerRequests + lifecycleHeadroom.providerRequests,
					confirmedCostMicrousd:
						state.budget.confirmedCostMicrousd + lifecycleHeadroom.maxCostMicrousd,
					confirmedElapsedMs: state.budget.confirmedElapsedMs + lifecycleHeadroom.maxElapsedMs,
					effectFacts: state.budget.effectFacts + lifecycleHeadroom.effectFacts,
				});
	if (!withinLimits(state, lifecycleBudget) && effectKind !== "cleanup") {
		schedule(state, "cleanup", "cleanup");
		return;
	}
	const sequence = state.nextSequence++;
	const providerMaterial =
		effectKind === "provider-request"
			? modelVisibleMaterial(stateTaskStatements.get(state.owner) ?? "", state.run, phase)
			: null;
	const logicalRequestDigest =
		effectKind === "provider-request"
			? empiricalStrictJsonDigest({
					arm: currentArm(state),
					phase,
					workspaceStateDigest: state.run.workspaceStateDigest,
					exposureFactDigest: state.run.exposure.factDigest,
				})
			: null;
	const modelVisibleEnvelopeDigest =
		providerMaterial === null
			? state.run.exposure.modelVisibleEnvelopeDigest
			: empiricalStrictJsonDigest({
					messages: [{ role: "user", content: providerMaterial.modelVisibleEnvelope }],
				});
	const envelopeBindingDigest =
		effectKind === "provider-request"
			? empiricalStrictJsonDigest({
					exposureFactDigest: state.run.exposure.factDigest,
					modelVisibleEnvelopeDigest,
					phase,
					workspaceStateDigest: state.run.workspaceStateDigest,
					logicalRequestDigest,
				})
			: null;
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d17.effect-request.v1" as const,
		sequence,
		arm: currentArm(state),
		effectKind,
		phase,
		toolRef,
		requiredFirstToolRef:
			effectKind === "provider-request" && phase === "mutation" ? ("replace-exact" as const) : null,
		exposureFactDigest: state.run.exposure.factDigest,
		modelVisibleEnvelopeDigest,
		envelopeBindingDigest,
		workspaceStateDigest: state.run.workspaceStateDigest,
		logicalRequestDigest,
		attemptOrdinal: effectKind === "provider-request" ? 1 : null,
		lifecycleHeadroom,
		reservation,
	});
	const request = Object.freeze({ ...base, requestDigest: empiricalStrictJsonDigest(base) });
	const admissionBase = strictSnapshot({
		schemaVersion: "graphrefly-ts.d17.effect-admission.v1" as const,
		requestDigest: request.requestDigest,
		admitted: true as const,
		budgetBefore: state.budget,
		prospectiveBudget: prospective,
	});
	const admitted = Object.freeze({
		request,
		admission: Object.freeze({
			...admissionBase,
			admissionDigest: empiricalStrictJsonDigest(admissionBase),
		}),
	});
	state.active = admitted;
	if (effectKind === "provider-request") {
		const material = providerMaterial;
		if (material === null) throw new TypeError("D17 provider material is unavailable");
		if (
			empiricalStrictJsonDigest({
				messages: [{ role: "user", content: material.modelVisibleEnvelope }],
			}) !== request.modelVisibleEnvelopeDigest
		)
			throw new TypeError("D17 model-visible envelope drifted before provider admission");
		providerMaterials.set(admitted, material);
	}
}

const stateTaskStatements = new WeakMap<object, string>();

function modelVisibleMaterial(
	taskStatement: string,
	run: RunState,
	phase: D17Phase,
): RuntimeMaterial {
	const base = exposureEnvelope(currentArmFromRun(run), taskStatement);
	const inspectionSection =
		run.inspectionOutputs.length === 0
			? ""
			: `\n\nGraph-admitted inspection results, in provider order:\n${run.inspectionOutputs
					.map((output, index) => `--- result ${index + 1} ---\n${output}`)
					.join("\n")}`;
	const phaseInstruction =
		phase === "mutation"
			? "\n\nGraph directive: return exactly one replace_exact tool intent as the first and only intent."
			: "\n\nGraph directive: inspect the four allowed files before proposing a mutation.";
	return Object.freeze({
		taskStatement,
		exposureText: base.exposureText,
		modelVisibleEnvelope: `${base.modelVisibleEnvelope}${inspectionSection}${phaseInstruction}`,
	});
}

function currentArmFromRun(run: RunState): D17Arm {
	const arm = D17_ARMS[run.armIndex];
	if (arm === undefined) throw new TypeError("D17 run arm is invalid");
	return arm;
}

function runProjection(state: AuthorityState): D17RunProjectionV1 {
	const evaluable =
		state.run.mutationCompleted &&
		state.run.diffCompleted &&
		state.run.focusedValidationPassed &&
		state.run.publicSemanticValidationPassed &&
		state.run.cleanupCompleted &&
		state.run.providerFailureFamily === null;
	const base = strictSnapshot({
		arm: currentArm(state),
		exposureFactDigest: state.run.exposure.factDigest,
		phase: state.run.phase,
		evaluable,
		mutationCompleted: state.run.mutationCompleted,
		diffCompleted: state.run.diffCompleted,
		focusedValidationPassed: state.run.focusedValidationPassed,
		publicSemanticValidationPassed: state.run.publicSemanticValidationPassed,
		hiddenVerifierPassed: state.run.hiddenVerifierPassed,
		cleanupCompleted: state.run.cleanupCompleted,
		providerFailureFamily: state.run.providerFailureFamily,
	});
	return Object.freeze({ ...base, projectionDigest: empiricalStrictJsonDigest(base) });
}

function advanceAfterCleanup(state: AuthorityState): void {
	state.runs.push(runProjection(state));
	if (state.run.armIndex === D17_ARMS.length - 1) {
		state.finished = true;
		return;
	}
	const nextIndex = state.run.armIndex + 1;
	const task = stateTaskStatements.get(state.owner);
	if (task === undefined) throw new TypeError("D17 task statement is unavailable");
	state.run = initialRun(state.nextSequence++, nextIndex, task);
	state.exposureNode.down([["DATA", state.run.exposure]]);
	schedule(state, "materialization", "unmaterialized");
}

function applyResult(state: AuthorityState, fact: D17AdmittedEffectFactV1): void {
	const result = fact.result;
	if (result.effectKind === "materialization") {
		if (result.status !== "completed" || result.workspaceStateDigest === null) {
			schedule(state, "cleanup", "cleanup");
			return;
		}
		state.run.workspaceStateDigest = result.workspaceStateDigest;
		state.run.phase = "inspection";
		schedule(state, "provider-request", "inspection");
		return;
	}
	if (result.effectKind === "provider-request") {
		if (result.status !== "completed") {
			state.run.providerFailureFamily = result.failureFamily;
			schedule(state, "cleanup", "cleanup");
			return;
		}
		if (
			result.observedModelVisibleEnvelopeDigest !== fact.request.modelVisibleEnvelopeDigest ||
			result.wireMessagesDigest !== fact.request.modelVisibleEnvelopeDigest
		)
			throw new TypeError("D17 provider wire exposure binding drifted");
		if (fact.request.phase === "inspection") {
			if (
				result.toolIntents.length !== 4 ||
				result.toolIntents.some((tool) => tool !== "read-file")
			)
				throw new TypeError("D17 inspection response is not the exact four-read batch");
			state.run.inspectionCount = 4;
			schedule(state, "tool-action", "inspection", "read-file");
			return;
		}
		if (result.toolIntents.length !== 1 || result.toolIntents[0] !== "replace-exact")
			throw new TypeError("D17 mutation response did not honor the named replace_exact directive");
		schedule(state, "tool-action", "mutation", "replace-exact");
		return;
	}
	if (result.effectKind === "tool-action") {
		if (result.status !== "succeeded") {
			schedule(state, "cleanup", "cleanup");
			return;
		}
		state.run.workspaceStateDigest = result.workspaceStateAfterDigest;
		if (result.toolRef === "read-file") {
			state.run.inspectionCount -= 1;
			if (state.run.inspectionCount > 0) schedule(state, "tool-action", "inspection", "read-file");
			else {
				state.run.phase = "mutation";
				schedule(state, "provider-request", "mutation");
			}
			return;
		}
		if (result.toolRef === "replace-exact") {
			state.run.mutationCompleted = true;
			state.run.phase = "diff";
			schedule(state, "tool-action", "diff", "workspace-diff");
			return;
		}
		if (result.toolRef === "workspace-diff") {
			if (!result.nonEmptyDiff) throw new TypeError("D17 mutation produced no diff");
			state.run.diffCompleted = true;
			state.run.phase = "focused-validation";
			schedule(state, "tool-action", "focused-validation", "focused-validation");
			return;
		}
		state.run.focusedValidationPassed = true;
		state.run.phase = "public-semantic-validation";
		schedule(state, "public-semantic-validation", "public-semantic-validation");
		return;
	}
	if (result.effectKind === "public-semantic-validation") {
		if (result.status !== "passed") {
			schedule(state, "cleanup", "cleanup");
			return;
		}
		state.run.publicSemanticValidationPassed = true;
		state.run.phase = "hidden-verifier";
		schedule(state, "hidden-verifier", "hidden-verifier");
		return;
	}
	if (result.effectKind === "hidden-verifier") {
		state.run.hiddenVerifierPassed = result.status === "passed";
		state.run.phase = "cleanup";
		schedule(state, "cleanup", "cleanup");
		return;
	}
	state.run.cleanupCompleted = result.status === "completed";
	state.run.phase = result.status === "completed" ? "complete" : "cleanup";
	advanceAfterCleanup(state);
}

function validateResult(value: unknown, request: D17EffectRequestV1): D17EffectResultInputV1 {
	const candidate = record(value, "D17 result");
	if (candidate.effectKind !== request.effectKind)
		throw new TypeError("D17 result effect kind mismatches the admitted request");
	const common = {
		evidenceDigest: digest(candidate.evidenceDigest, "D17 result.evidenceDigest"),
		actualCostMicrousd: safeInteger(candidate.actualCostMicrousd, "D17 result.actualCostMicrousd", {
			max: request.reservation.maxCostMicrousd,
		}),
		actualElapsedMs: safeInteger(candidate.actualElapsedMs, "D17 result.actualElapsedMs", {
			max: request.reservation.maxElapsedMs,
		}),
	};
	if (request.effectKind === "materialization") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"D17 result",
		);
		return Object.freeze({
			effectKind: "materialization",
			status: oneOf(candidate.status, ["completed", "failed"], "D17 materialization.status"),
			workspaceStateDigest:
				candidate.workspaceStateDigest === null
					? null
					: digest(candidate.workspaceStateDigest, "D17 materialization.workspace"),
			evidenceDigest: common.evidenceDigest,
			actualCostMicrousd: common.actualCostMicrousd as 0,
			actualElapsedMs: common.actualElapsedMs,
		});
	}
	if (request.effectKind === "provider-request") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"failureFamily",
				"observedModelVisibleEnvelopeDigest",
				"status",
				"toolIntents",
				"wireMessagesDigest",
			],
			"D17 result",
		);
		const tools = array(candidate.toolIntents, "D17 provider.toolIntents");
		if (tools.length > 4) throw new TypeError("D17 provider tool intent bound exceeded");
		return Object.freeze({
			effectKind: "provider-request",
			status: oneOf(candidate.status, ["completed", "failed"], "D17 provider.status"),
			toolIntents: Object.freeze(
				tools.map((tool, index) =>
					oneOf<D17ToolRef>(
						tool,
						["read-file", "replace-exact", "workspace-diff", "focused-validation"],
						`D17 provider.toolIntents[${index}]`,
					),
				),
			),
			observedModelVisibleEnvelopeDigest: digest(
				candidate.observedModelVisibleEnvelopeDigest,
				"D17 provider.observedEnvelope",
			),
			wireMessagesDigest: digest(candidate.wireMessagesDigest, "D17 provider.wireMessagesDigest"),
			failureFamily:
				candidate.failureFamily === null
					? null
					: oneOf(
							candidate.failureFamily,
							["transport", "http", "executor"],
							"D17 provider.failureFamily",
						),
			...common,
		});
	}
	if (request.effectKind === "tool-action") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"nonEmptyDiff",
				"status",
				"toolRef",
				"workspaceStateAfterDigest",
				"workspaceStateBeforeDigest",
			],
			"D17 result",
		);
		return Object.freeze({
			effectKind: "tool-action",
			toolRef: oneOf(
				candidate.toolRef,
				["read-file", "replace-exact", "workspace-diff", "focused-validation"],
				"D17 tool.toolRef",
			),
			status: oneOf(candidate.status, ["succeeded", "failed"], "D17 tool.status"),
			workspaceStateBeforeDigest: digest(candidate.workspaceStateBeforeDigest, "D17 tool.before"),
			workspaceStateAfterDigest: digest(candidate.workspaceStateAfterDigest, "D17 tool.after"),
			nonEmptyDiff: candidate.nonEmptyDiff === true,
			evidenceDigest: common.evidenceDigest,
			actualCostMicrousd: common.actualCostMicrousd as 0,
			actualElapsedMs: common.actualElapsedMs,
		});
	}
	if (request.effectKind === "public-semantic-validation") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"criterionFailureCodes",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"D17 result",
		);
		const codes = array(candidate.criterionFailureCodes, "D17 semantic.codes");
		if (codes.length > 8) throw new TypeError("D17 semantic criterion bound exceeded");
		return Object.freeze({
			effectKind: "public-semantic-validation",
			status: oneOf(candidate.status, ["passed", "failed"], "D17 semantic.status"),
			criterionFailureCodes: Object.freeze(codes.map((code) => String(code))),
			workspaceStateDigest: digest(candidate.workspaceStateDigest, "D17 semantic.workspace"),
			evidenceDigest: common.evidenceDigest,
			actualCostMicrousd: common.actualCostMicrousd as 0,
			actualElapsedMs: common.actualElapsedMs,
		});
	}
	if (request.effectKind === "hidden-verifier") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"D17 result",
		);
		return Object.freeze({
			effectKind: "hidden-verifier",
			status: oneOf(candidate.status, ["passed", "failed"], "D17 hidden.status"),
			workspaceStateDigest: digest(candidate.workspaceStateDigest, "D17 hidden.workspace"),
			evidenceDigest: common.evidenceDigest,
			actualCostMicrousd: common.actualCostMicrousd as 0,
			actualElapsedMs: common.actualElapsedMs,
		});
	}
	exactKeys(
		candidate,
		[
			"actualCostMicrousd",
			"actualElapsedMs",
			"effectKind",
			"evidenceDigest",
			"status",
			"workspaceStateDigest",
		],
		"D17 result",
	);
	return Object.freeze({
		effectKind: "cleanup",
		status: oneOf(candidate.status, ["completed", "failed"], "D17 cleanup.status"),
		workspaceStateDigest:
			candidate.workspaceStateDigest === null
				? null
				: digest(candidate.workspaceStateDigest, "D17 cleanup.workspace"),
		evidenceDigest: common.evidenceDigest,
		actualCostMicrousd: common.actualCostMicrousd as 0,
		actualElapsedMs: common.actualElapsedMs,
	});
}

export function createD17Authority(input: {
	readonly taskStatement: string;
	readonly limits?: D17BudgetLimitsV1;
}): D17AuthorityV1 {
	if (
		typeof input.taskStatement !== "string" ||
		input.taskStatement.length < 1 ||
		input.taskStatement.length > 16_384
	)
		throw new TypeError("D17 task statement is invalid");
	const owner = graph({ name: "current/d17/authority" });
	const exposureNode = createD17ExposureNode(owner);
	const factNode = createD17FactNode(owner);
	const projectionNode = owner.node<D17AdmittedEffectFactV1>(
		[factNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{
			name: "current/d17/projection",
			factory: "d17CurrentCanonicalProjection",
		},
	);
	const limits = Object.freeze({ ...(input.limits ?? D17_QUALIFICATION_LIMITS) });
	const run = initialRun(0, 0, input.taskStatement);
	const authority = Object.freeze({ revision: D17_AUTHORITY_REVISION });
	const state: AuthorityState = {
		owner,
		exposureNode,
		factNode,
		limits,
		exposureFacts: [],
		effectFacts: [],
		runs: [],
		budget: ZERO_BUDGET,
		nextSequence: 1,
		active: null,
		run,
		finished: false,
	};
	states.set(authority, state);
	stateTaskStatements.set(owner, input.taskStatement);
	exposureNode.subscribe((message) => {
		if (message[0] === "DATA") state.exposureFacts.push(message[1] as D17ExposureFactV1);
	});
	projectionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const fact = message[1] as D17AdmittedEffectFactV1;
		state.effectFacts.push(fact);
		applyResult(state, fact);
	});
	exposureNode.down([["DATA", run.exposure]]);
	schedule(state, "materialization", "unmaterialized");
	return authority;
}

export function nextD17Effect(authority: D17AuthorityV1): D17AdmittedEffectV1 | null {
	const state = states.get(authority);
	if (state === undefined) throw new TypeError("D17 authority is forged");
	return state.active;
}

export function takeD17ProviderMaterial(
	authority: D17AuthorityV1,
	effect: D17AdmittedEffectV1,
): RuntimeMaterial {
	const state = states.get(authority);
	if (
		state === undefined ||
		state.active !== effect ||
		effect.request.effectKind !== "provider-request"
	)
		throw new TypeError("D17 provider material admission is forged or stale");
	const material = providerMaterials.get(effect);
	if (material === undefined) throw new TypeError("D17 provider material was already consumed");
	providerMaterials.delete(effect);
	return material;
}

export function admitD17EffectResult(
	authority: D17AuthorityV1,
	effect: D17AdmittedEffectV1,
	resultValue: D17EffectResultInputV1,
	runtimeMaterialValue?: unknown,
): D17AdmittedEffectFactV1 {
	const state = states.get(authority);
	if (state === undefined || state.active !== effect)
		throw new TypeError("D17 effect admission is forged, stale or replayed");
	const result = validateResult(resultValue, effect.request);
	let admittedReadOutput: string | null = null;
	if (
		result.effectKind === "tool-action" &&
		result.toolRef === "read-file" &&
		result.status === "succeeded"
	) {
		if (typeof runtimeMaterialValue !== "string" || runtimeMaterialValue.length > 240_000)
			throw new TypeError("D17 admitted read output is missing or exceeds its runtime bound");
		admittedReadOutput = runtimeMaterialValue;
	} else if (runtimeMaterialValue !== undefined) {
		throw new TypeError("D17 runtime material is only allowed for a successful read-file effect");
	}
	const budgetAfter = Object.freeze({
		providerRequests:
			effect.admission.budgetBefore.providerRequests + effect.request.reservation.providerRequests,
		confirmedCostMicrousd:
			effect.admission.budgetBefore.confirmedCostMicrousd + result.actualCostMicrousd,
		confirmedElapsedMs: effect.admission.budgetBefore.confirmedElapsedMs + result.actualElapsedMs,
		effectFacts: effect.admission.budgetBefore.effectFacts + 1,
	});
	const reconciliationBase = strictSnapshot({
		actualCostMicrousd: result.actualCostMicrousd,
		actualElapsedMs: result.actualElapsedMs,
		budgetAfter,
	});
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d17.effect-fact.v1" as const,
		sequence: effect.request.sequence,
		arm: effect.request.arm,
		request: effect.request,
		admission: effect.admission,
		result,
		reconciliation: Object.freeze({
			...reconciliationBase,
			reconciliationDigest: empiricalStrictJsonDigest(reconciliationBase),
		}),
	});
	const fact = Object.freeze({ ...base, factDigest: empiricalStrictJsonDigest(base) });
	state.active = null;
	state.budget = budgetAfter;
	if (admittedReadOutput !== null) state.run.inspectionOutputs.push(admittedReadOutput);
	state.factNode.down([["DATA", fact]]);
	return fact;
}

function evaluateGate(runs: readonly D17RunProjectionV1[], evaluated: boolean) {
	const failures: string[] = [];
	if (runs.length !== 6) failures.push("six-arm-completion-missing");
	for (let index = 0; index < D17_ARMS.length; index += 1) {
		const run = runs[index];
		const arm = D17_ARMS[index];
		if (run?.arm !== arm) failures.push(`arm-order:${arm}`);
		if (run?.evaluable !== true) failures.push(`not-evaluable:${arm}`);
		if (run?.providerFailureFamily !== null) failures.push(`provider-failure:${arm}`);
		if (run?.cleanupCompleted !== true) failures.push(`cleanup:${arm}`);
		const expectedHidden = arm === "relevant-applied";
		if (run?.hiddenVerifierPassed !== expectedHidden) failures.push(`hidden-differential:${arm}`);
	}
	const base = strictSnapshot({
		schemaVersion: D17_GATE_SCHEMA,
		definitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		evaluated,
		passed: evaluated && failures.length === 0,
		failureCodes: Object.freeze(failures),
	});
	return Object.freeze({ ...base, gateDigest: empiricalStrictJsonDigest(base) });
}

export function snapshotD17Evidence(
	authority: D17AuthorityV1,
	options: { readonly evaluateLiveGate: boolean } = { evaluateLiveGate: false },
): D17EvidenceV1 {
	const state = states.get(authority);
	if (state === undefined || !state.finished || state.active !== null)
		throw new TypeError("D17 evidence is not complete");
	const topologyBase = strictSnapshot({
		exposureNode: "current/d17/exposures" as const,
		factNode: "current/d17/admitted-facts" as const,
		projectionNode: "current/d17/projection" as const,
		arms: D17_ARMS,
	});
	const gate = evaluateGate(state.runs, options.evaluateLiveGate);
	const material = strictSnapshot({
		schemaVersion: D17_EVIDENCE_SCHEMA,
		decisionRef: D17_DECISION_REF,
		authorityRevision: D17_AUTHORITY_REVISION,
		topology: Object.freeze({
			...topologyBase,
			topologyDigest: empiricalStrictJsonDigest(topologyBase),
		}),
		limits: state.limits,
		exposureFacts: Object.freeze([...state.exposureFacts]),
		effectFacts: Object.freeze([...state.effectFacts]),
		runs: Object.freeze([...state.runs]),
		budget: state.budget,
		maxActiveEffects: 1 as const,
		runStatus: "complete" as const,
		gate,
		causalAttribution: "undetermined" as const,
		efficacyClaim:
			gate.passed && options.evaluateLiveGate
				? ("frozen-task-block-positive-differential" as const)
				: ("none" as const),
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function validateD17Evidence(value: unknown): D17EvidenceV1 {
	const candidate = record(value, "D17 evidence");
	exactKeys(
		candidate,
		[
			"authorityRevision",
			"budget",
			"causalAttribution",
			"decisionRef",
			"effectFacts",
			"efficacyClaim",
			"evidenceDigest",
			"exposureFacts",
			"gate",
			"limits",
			"maxActiveEffects",
			"runStatus",
			"runs",
			"schemaVersion",
			"topology",
		],
		"D17 evidence",
	);
	if (
		candidate.schemaVersion !== D17_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== D17_DECISION_REF ||
		candidate.authorityRevision !== D17_AUTHORITY_REVISION
	)
		throw new TypeError("D17 evidence coordinates drifted");
	const topology = record(candidate.topology, "D17 evidence.topology");
	exactKeys(
		topology,
		["arms", "exposureNode", "factNode", "projectionNode", "topologyDigest"],
		"D17 evidence.topology",
	);
	const topologyBase = strictSnapshot({
		exposureNode: "current/d17/exposures" as const,
		factNode: "current/d17/admitted-facts" as const,
		projectionNode: "current/d17/projection" as const,
		arms: D17_ARMS,
	});
	if (
		topology.exposureNode !== topologyBase.exposureNode ||
		topology.factNode !== topologyBase.factNode ||
		topology.projectionNode !== topologyBase.projectionNode ||
		empiricalStrictJsonDigest(topology.arms) !== empiricalStrictJsonDigest(D17_ARMS) ||
		topology.topologyDigest !== empiricalStrictJsonDigest(topologyBase)
	)
		throw new TypeError("D17 topology projection drifted");
	if (
		empiricalStrictJsonDigest(candidate.limits) !==
		empiricalStrictJsonDigest(D17_QUALIFICATION_LIMITS)
	)
		throw new TypeError("D17 qualification budget limits drifted");
	const exposures = array(candidate.exposureFacts, "D17 evidence.exposureFacts");
	const effects = array(candidate.effectFacts, "D17 evidence.effectFacts");
	const runs = array(candidate.runs, "D17 evidence.runs");
	if (exposures.length !== 6 || runs.length !== 6 || effects.length !== 78)
		throw new TypeError("D17 evidence cardinality drifted");
	let replayBudget: D17BudgetStateV1 = ZERO_BUDGET;
	const expectedEffects = Object.freeze([
		["materialization", "unmaterialized", null],
		["provider-request", "inspection", null],
		["tool-action", "inspection", "read-file"],
		["tool-action", "inspection", "read-file"],
		["tool-action", "inspection", "read-file"],
		["tool-action", "inspection", "read-file"],
		["provider-request", "mutation", null],
		["tool-action", "mutation", "replace-exact"],
		["tool-action", "diff", "workspace-diff"],
		["tool-action", "focused-validation", "focused-validation"],
		["public-semantic-validation", "public-semantic-validation", null],
		["hidden-verifier", "hidden-verifier", null],
		["cleanup", "cleanup", null],
	] as const);
	for (let index = 0; index < 6; index += 1) {
		const exposure = record(exposures[index], `D17 exposure[${index}]`);
		exactKeys(
			exposure,
			[
				"arm",
				"disposition",
				"factDigest",
				"insightClass",
				"insightDigest",
				"modelVisibleEnvelopeDigest",
				"schemaVersion",
				"sequence",
			],
			`D17 exposure[${index}]`,
		);
		const arm = D17_ARMS[index];
		if (
			exposure.arm !== arm ||
			exposure.disposition !== EXPOSURE_DEFINITIONS[arm].disposition ||
			exposure.insightClass !== EXPOSURE_DEFINITIONS[arm].insightClass
		)
			throw new TypeError("D17 exposure matrix drifted");
		const expectedExposure = createExposureFact(
			index * 14,
			arm,
			exposureEnvelope(arm, D17_COMPLETE_TASK_STATEMENT),
		);
		if (empiricalStrictJsonDigest(exposure) !== empiricalStrictJsonDigest(expectedExposure))
			throw new TypeError("D17 exact exposure fact drifted");
		const exposureDigest = digest(exposure.factDigest, `D17 exposure[${index}].factDigest`);
		const run = record(runs[index], `D17 run[${index}]`);
		exactKeys(
			run,
			[
				"arm",
				"cleanupCompleted",
				"diffCompleted",
				"evaluable",
				"exposureFactDigest",
				"focusedValidationPassed",
				"hiddenVerifierPassed",
				"mutationCompleted",
				"phase",
				"projectionDigest",
				"providerFailureFamily",
				"publicSemanticValidationPassed",
			],
			`D17 run[${index}]`,
		);
		const armEffects = effects.slice(index * 13, index * 13 + 13);
		if (armEffects.length !== 13) throw new TypeError("D17 arm effect cardinality drifted");
		for (let effectIndex = 0; effectIndex < expectedEffects.length; effectIndex += 1) {
			const [expectedKind, expectedPhase, expectedTool] = expectedEffects[effectIndex]!;
			const fact = record(armEffects[effectIndex], `D17 arm[${index}].effect[${effectIndex}]`);
			exactKeys(
				fact,
				[
					"admission",
					"arm",
					"factDigest",
					"reconciliation",
					"request",
					"result",
					"schemaVersion",
					"sequence",
				],
				`D17 arm[${index}].effect[${effectIndex}]`,
			);
			const request = record(fact.request, `D17 arm[${index}].effect[${effectIndex}].request`);
			const admission = record(
				fact.admission,
				`D17 arm[${index}].effect[${effectIndex}].admission`,
			);
			const reconciliation = record(
				fact.reconciliation,
				`D17 arm[${index}].effect[${effectIndex}].reconciliation`,
			);
			const sequence = index * 14 + effectIndex + 1;
			if (
				fact.schemaVersion !== "graphrefly-ts.d17.effect-fact.v1" ||
				fact.sequence !== sequence ||
				fact.arm !== arm ||
				request.sequence !== sequence ||
				request.arm !== arm ||
				request.effectKind !== expectedKind ||
				request.phase !== expectedPhase ||
				request.toolRef !== expectedTool ||
				request.exposureFactDigest !== exposureDigest ||
				request.attemptOrdinal !== (expectedKind === "provider-request" ? 1 : null) ||
				(request.lifecycleHeadroom === null) !==
					!(expectedKind === "provider-request" && expectedPhase === "mutation") ||
				request.requiredFirstToolRef !==
					(expectedKind === "provider-request" && expectedPhase === "mutation"
						? "replace-exact"
						: null)
			)
				throw new TypeError("D17 exact effect lifecycle drifted");
			const requestDigest = digest(request.requestDigest, "D17 request digest");
			const { requestDigest: _requestDigest, ...requestBase } = request;
			if (empiricalStrictJsonDigest(requestBase) !== requestDigest)
				throw new TypeError("D17 request digest drifted");
			if (expectedKind === "provider-request") {
				const expectedEnvelopeBinding = empiricalStrictJsonDigest({
					exposureFactDigest: exposureDigest,
					modelVisibleEnvelopeDigest: request.modelVisibleEnvelopeDigest,
					phase: expectedPhase,
					workspaceStateDigest: request.workspaceStateDigest,
					logicalRequestDigest: request.logicalRequestDigest,
				});
				if (request.envelopeBindingDigest !== expectedEnvelopeBinding)
					throw new TypeError("D17 model-visible exposure binding drifted");
			} else if (request.envelopeBindingDigest !== null) {
				throw new TypeError("D17 local effect carried a provider envelope binding");
			}
			if (expectedKind === "provider-request" && expectedPhase === "mutation") {
				const headroom = record(request.lifecycleHeadroom, "D17 mutation lifecycle headroom");
				if (
					headroom.providerRequests !== 1 ||
					headroom.maxCostMicrousd !== D17_QUALIFICATION_LIMITS.providerMaxCostMicrousd ||
					headroom.maxElapsedMs !==
						D17_MUTATION_PROVIDER_DEADLINE_MS +
							6 * D17_QUALIFICATION_LIMITS.localEffectMaxElapsedMs ||
					headroom.effectFacts !== 7
				)
					throw new TypeError("D17 mutation lifecycle headroom drifted");
			}
			if (admission.requestDigest !== requestDigest || admission.budgetBefore === undefined)
				throw new TypeError("D17 admission request binding drifted");
			if (
				empiricalStrictJsonDigest(admission.budgetBefore) !==
				empiricalStrictJsonDigest(replayBudget)
			)
				throw new TypeError("D17 admission budget-before drifted");
			const reservation = record(request.reservation, "D17 request reservation");
			const prospective = Object.freeze({
				providerRequests: replayBudget.providerRequests + Number(reservation.providerRequests),
				confirmedCostMicrousd:
					replayBudget.confirmedCostMicrousd + Number(reservation.maxCostMicrousd),
				confirmedElapsedMs: replayBudget.confirmedElapsedMs + Number(reservation.maxElapsedMs),
				effectFacts: replayBudget.effectFacts + 1,
			});
			if (
				empiricalStrictJsonDigest(admission.prospectiveBudget) !==
				empiricalStrictJsonDigest(prospective)
			)
				throw new TypeError("D17 prospective budget drifted");
			const admissionDigest = digest(admission.admissionDigest, "D17 admission digest");
			const { admissionDigest: _admissionDigest, ...admissionBase } = admission;
			if (empiricalStrictJsonDigest(admissionBase) !== admissionDigest)
				throw new TypeError("D17 admission digest drifted");
			const result = validateResult(fact.result, request as unknown as D17EffectRequestV1);
			if (
				result.effectKind === "provider-request" &&
				(result.observedModelVisibleEnvelopeDigest !== request.modelVisibleEnvelopeDigest ||
					result.wireMessagesDigest !== request.modelVisibleEnvelopeDigest)
			)
				throw new TypeError("D17 provider result/wire exposure bijection drifted");
			const expectedBudgetAfter = Object.freeze({
				providerRequests: replayBudget.providerRequests + Number(reservation.providerRequests),
				confirmedCostMicrousd: replayBudget.confirmedCostMicrousd + result.actualCostMicrousd,
				confirmedElapsedMs: replayBudget.confirmedElapsedMs + result.actualElapsedMs,
				effectFacts: replayBudget.effectFacts + 1,
			});
			if (
				reconciliation.actualCostMicrousd !== result.actualCostMicrousd ||
				reconciliation.actualElapsedMs !== result.actualElapsedMs ||
				empiricalStrictJsonDigest(reconciliation.budgetAfter) !==
					empiricalStrictJsonDigest(expectedBudgetAfter)
			)
				throw new TypeError("D17 reconciliation arithmetic drifted");
			const reconciliationDigest = digest(
				reconciliation.reconciliationDigest,
				"D17 reconciliation digest",
			);
			const { reconciliationDigest: _reconciliationDigest, ...reconciliationBase } = reconciliation;
			if (empiricalStrictJsonDigest(reconciliationBase) !== reconciliationDigest)
				throw new TypeError("D17 reconciliation digest drifted");
			const factDigest = digest(fact.factDigest, "D17 fact digest");
			const { factDigest: _factDigest, ...factBase } = fact;
			if (empiricalStrictJsonDigest(factBase) !== factDigest)
				throw new TypeError("D17 fact digest drifted");
			replayBudget = expectedBudgetAfter;
		}
		const hiddenResult = record(
			record(armEffects[11], "D17 hidden fact").result,
			"D17 hidden result",
		);
		const expectedRunBase = strictSnapshot({
			arm,
			exposureFactDigest: exposureDigest,
			phase: "complete" as const,
			evaluable: true,
			mutationCompleted: true,
			diffCompleted: true,
			focusedValidationPassed: true,
			publicSemanticValidationPassed: true,
			hiddenVerifierPassed: hiddenResult.status === "passed",
			cleanupCompleted: true,
			providerFailureFamily: null,
		});
		const expectedRun = Object.freeze({
			...expectedRunBase,
			projectionDigest: empiricalStrictJsonDigest(expectedRunBase),
		});
		if (empiricalStrictJsonDigest(run) !== empiricalStrictJsonDigest(expectedRun))
			throw new TypeError("D17 derived run projection drifted");
		if (
			run.arm !== arm ||
			run.exposureFactDigest !== exposureDigest ||
			run.cleanupCompleted !== true ||
			run.evaluable !== true
		)
			throw new TypeError("D17 run projection drifted");
	}
	const effectValues = effects.map((entry, index) => record(entry, `D17 effect[${index}]`));
	for (let index = 0; index < effectValues.length; index += 1) {
		const fact = effectValues[index]!;
		safeInteger(fact.sequence, `D17 effect[${index}].sequence`);
		digest(fact.factDigest, `D17 effect[${index}].factDigest`);
		const request = record(fact.request, `D17 effect[${index}].request`);
		const admission = record(fact.admission, `D17 effect[${index}].admission`);
		if (request.requestDigest !== admission.requestDigest)
			throw new TypeError("D17 request/admission bijection drifted");
	}
	const sortedSequences = [
		...exposures.map((entry) =>
			safeInteger(record(entry, "D17 exposure sequence").sequence, "D17 exposure sequence"),
		),
		...effectValues.map((entry) => safeInteger(entry.sequence, "D17 effect sequence")),
	].sort((a, b) => a - b);
	if (sortedSequences.some((sequence, index) => sequence !== index))
		throw new TypeError("D17 fact sequence is not exact and contiguous");
	const gate = record(candidate.gate, "D17 evidence.gate");
	const expectedGate = evaluateGate(
		runs as unknown as readonly D17RunProjectionV1[],
		gate.evaluated === true,
	);
	if (empiricalStrictJsonDigest(gate) !== empiricalStrictJsonDigest(expectedGate))
		throw new TypeError("D17 gate projection drifted");
	if (
		empiricalStrictJsonDigest(candidate.budget) !== empiricalStrictJsonDigest(replayBudget) ||
		candidate.efficacyClaim !==
			(expectedGate.passed ? "frozen-task-block-positive-differential" : "none")
	)
		throw new TypeError("D17 final budget or efficacy projection drifted");
	const suppliedDigest = digest(candidate.evidenceDigest, "D17 evidence.evidenceDigest");
	const { evidenceDigest: _evidenceDigest, ...material } = candidate;
	if (empiricalStrictJsonDigest(material) !== suppliedDigest)
		throw new TypeError("D17 evidence digest drifted");
	return strictSnapshot(candidate) as unknown as D17EvidenceV1;
}

export function D17ExposureTextForTest(arm: D17Arm): string | null {
	const definition = EXPOSURE_DEFINITIONS[arm];
	return definition.insightClass === "none" ? null : EXPOSURE_TEXT[definition.insightClass];
}
