import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";

export const CURRENT_GRAPH_NATIVE_EVAL_REVISION =
	"graphrefly-ts.d5.inspection-batch-graph-authority.v1" as const;
export const D5_MAX_INSPECTION_BATCH = 4 as const;
export const CURRENT_GRAPH_NATIVE_EVIDENCE_SCHEMA =
	"graphrefly-ts.d5.current-graph-native-evidence.v1" as const;
export const CURRENT_GRAPH_CORRECTION_SCHEMA =
	"graphrefly-ts.d5.graph-correction-directive.v1" as const;

export const CURRENT_GRAPH_ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export const CURRENT_PUBLIC_CRITERION_FAILURES = Object.freeze([
	"canonical-proposal-not-admitted",
	"malformed-provenance-not-rejected",
	"local-reconstruction-not-rejected",
	"authorization-claim-invariant-regressed",
] as const);

const TOOL_REFS = Object.freeze([
	"read-file",
	"replace-exact",
	"workspace-diff",
	"focused-validation",
] as const);
const TOOL_REJECTION_CAUSES = Object.freeze([
	"exact-replacement-unchanged",
	"exact-replacement-old-text-not-found",
	"exact-replacement-old-text-not-unique",
	"malformed-arguments",
	"unexpected-arguments",
	"path-not-allowed",
	"focused-validation-failed",
] as const);
const FINDING_CODES = Object.freeze([
	"exact-replacement-rejected",
	"focused-validation-failed",
	"public-semantic-validation-failed",
	"hidden-verifier-failed",
	"inspection-batch-policy-violated",
	"executor-failed",
	"budget-exhausted",
	"cleanup-failed",
] as const);

export type CurrentGraphArm = (typeof CURRENT_GRAPH_ARMS)[number];
export type CurrentGraphToolRef = (typeof TOOL_REFS)[number];
export type CurrentGraphToolRejectionCause = (typeof TOOL_REJECTION_CAUSES)[number];
export type CurrentPublicCriterionFailure = (typeof CURRENT_PUBLIC_CRITERION_FAILURES)[number];
export type CurrentGraphFindingCode = (typeof FINDING_CODES)[number];
export type CurrentGraphPhase =
	| "none"
	| "inspection"
	| "exact-mutation"
	| "workspace-diff"
	| "focused-validation-passed"
	| "public-semantic-validation-passed"
	| "hidden-verifier-passed"
	| "complete";
export type CurrentGraphEffectKind =
	| "materialization"
	| "provider-request"
	| "tool-action"
	| "public-semantic-validation"
	| "hidden-verifier"
	| "cleanup";

export interface CurrentGraphBudgetLimitsV1 {
	readonly maxProviderRequests: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
	readonly maxEffectFacts: number;
	readonly providerMaxCostMicrousd: number;
	readonly providerMaxElapsedMs: number;
	readonly localEffectMaxElapsedMs: number;
}

export interface CurrentGraphBudgetStateV1 {
	readonly providerRequests: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly effectFacts: number;
}

export interface CurrentGraphCorrectionDirectiveV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_CORRECTION_SCHEMA;
	readonly reason:
		| "exact-replacement-unchanged"
		| "exact-replacement-old-text-not-found"
		| "exact-replacement-old-text-not-unique"
		| "focused-validation-failed"
		| "public-semantic-validation-failed";
	readonly stage:
		| "reinspect"
		| "fresh-mutation"
		| "validation-reinspect"
		| "validation-mutation"
		| "semantic-correction";
	readonly recoveryDigest: string;
	readonly sourceFactDigest: string;
	readonly workspaceStateDigest: string;
	readonly requiredFirstToolRef: "read-file" | "replace-exact";
	readonly criterionFailures: readonly CurrentPublicCriterionFailure[];
	readonly remainingProviderRequests: number;
	readonly remainingCostMicrousd: number;
	readonly remainingElapsedMs: number;
	readonly remainingEffectFacts: number;
	readonly contextDigest: string;
}

export interface CurrentGraphEffectRequestV1 {
	readonly schemaVersion: "graphrefly-ts.d5.graph-effect-request.v1";
	readonly sequence: number;
	readonly arm: CurrentGraphArm;
	readonly runSequence: number;
	readonly effectKind: CurrentGraphEffectKind;
	readonly toolRef: CurrentGraphToolRef | null;
	readonly phaseBefore: CurrentGraphPhase;
	readonly workspaceStateDigest: string | null;
	readonly correctionDirective: CurrentGraphCorrectionDirectiveV1 | null;
	readonly reservation: Readonly<{
		providerRequests: number;
		maxCostMicrousd: number;
		maxElapsedMs: number;
	}>;
	readonly requestDigest: string;
}

export interface CurrentGraphEffectAdmissionV1 {
	readonly schemaVersion: "graphrefly-ts.d5.graph-effect-admission.v1";
	readonly requestDigest: string;
	readonly admitted: true;
	readonly budgetBefore: CurrentGraphBudgetStateV1;
	readonly prospectiveBudget: CurrentGraphBudgetStateV1;
	readonly decisionDigest: string;
}

export interface CurrentGraphAdmittedEffectV1 {
	readonly request: CurrentGraphEffectRequestV1;
	readonly admission: CurrentGraphEffectAdmissionV1;
}

export type CurrentGraphEffectResultInputV1 =
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
			disposition: "tool-intents" | "structured-final" | null;
			toolIntents: readonly CurrentGraphToolRef[];
			failureCode: "provider-failed" | null;
			evidenceDigest: string;
			actualCostMicrousd: number;
			actualElapsedMs: number;
	  }>
	| Readonly<{
			effectKind: "tool-action";
			toolRef: CurrentGraphToolRef;
			status: "succeeded" | "failed";
			causeCode: CurrentGraphToolRejectionCause | null;
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
			criterionFailures: readonly CurrentPublicCriterionFailure[];
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

interface CurrentGraphFactBaseV1 {
	readonly sequence: number;
	readonly arm: CurrentGraphArm;
	readonly runSequence: number;
	readonly request: CurrentGraphEffectRequestV1;
	readonly admission: CurrentGraphEffectAdmissionV1;
	readonly reconciliation: Readonly<{
		actualCostMicrousd: number;
		actualElapsedMs: number;
		budgetAfter: CurrentGraphBudgetStateV1;
		reconciliationDigest: string;
	}>;
	readonly factDigest: string;
}

export type CurrentGraphAdmittedFactV1 =
	| (CurrentGraphFactBaseV1 &
			Readonly<{
				factKind: "executor-result";
				result: Extract<
					CurrentGraphEffectResultInputV1,
					{ effectKind: "materialization" | "provider-request" | "cleanup" }
				>;
			}>)
	| (CurrentGraphFactBaseV1 &
			Readonly<{
				factKind: "tool-result";
				result: Extract<CurrentGraphEffectResultInputV1, { effectKind: "tool-action" }>;
			}>)
	| (CurrentGraphFactBaseV1 &
			Readonly<{
				factKind: "public-semantic-result";
				result: Extract<
					CurrentGraphEffectResultInputV1,
					{ effectKind: "public-semantic-validation" }
				>;
			}>)
	| (CurrentGraphFactBaseV1 &
			Readonly<{
				factKind: "hidden-verifier-result";
				result: Extract<CurrentGraphEffectResultInputV1, { effectKind: "hidden-verifier" }>;
			}>);

export interface CurrentGraphFindingV1 {
	readonly code: CurrentGraphFindingCode;
	readonly arm: CurrentGraphArm;
	readonly runSequence: number;
	readonly sourceFactDigest: string;
	readonly findingDigest: string;
}

export interface CurrentGraphRunProjectionV1 {
	readonly arm: CurrentGraphArm;
	readonly runSequence: number;
	readonly phase: CurrentGraphPhase;
	readonly replacementRecoveryUsed: boolean;
	readonly validationRecoveryUsed: boolean;
	readonly semanticRecoveryUsed: boolean;
	readonly publicSemanticValidationAttempted: boolean;
	readonly publicSemanticValidationPassed: boolean;
	readonly hiddenVerifierAttempted: boolean;
	readonly hiddenVerifierPassed: boolean;
	readonly cleanupStatus: "completed" | "failed";
	readonly status: "completed" | "incomplete";
	readonly projectionDigest: string;
}

export interface CurrentGraphNativeEvidenceV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_NATIVE_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D5";
	readonly topology: Readonly<{
		factNode: "current/d5/facts";
		projectionNode: "current/d5/projections";
		arms: typeof CURRENT_GRAPH_ARMS;
		topologyDigest: string;
	}>;
	readonly limits: CurrentGraphBudgetLimitsV1;
	readonly facts: readonly CurrentGraphAdmittedFactV1[];
	readonly findings: readonly CurrentGraphFindingV1[];
	readonly runs: readonly CurrentGraphRunProjectionV1[];
	readonly budget: CurrentGraphBudgetStateV1;
	readonly runStatus: "complete" | "stopped";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface CurrentGraphNativeEvalAuthorityV1 {
	readonly revision: typeof CURRENT_GRAPH_NATIVE_EVAL_REVISION;
}

interface MutableRunState {
	armIndex: number;
	runSequence: number;
	phase: CurrentGraphPhase;
	workspaceStateDigest: string | null;
	pendingTools: CurrentGraphToolRef[];
	replacementRecoveryUsed: boolean;
	validationRecoveryUsed: boolean;
	semanticRecoveryUsed: boolean;
	publicSemanticValidationAttempted: boolean;
	publicSemanticValidationPassed: boolean;
	hiddenVerifierAttempted: boolean;
	hiddenVerifierPassed: boolean;
	cleanupStatus: "unknown" | "completed" | "failed";
	activeCorrection: CurrentGraphCorrectionDirectiveV1 | null;
	stopped: boolean;
}

function createCurrentFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<CurrentGraphAdmittedFactV1>([], null, { name: "current/d5/facts" });
}

interface AuthorityState {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createCurrentFactNode>;
	readonly facts: CurrentGraphAdmittedFactV1[];
	readonly findings: CurrentGraphFindingV1[];
	readonly runs: CurrentGraphRunProjectionV1[];
	readonly limits: CurrentGraphBudgetLimitsV1;
	budget: CurrentGraphBudgetStateV1;
	run: MutableRunState;
	nextSequence: number;
	active: CurrentGraphAdmittedEffectV1 | null;
	finished: boolean;
}

const states = new WeakMap<object, AuthorityState>();

const ZERO_BUDGET = Object.freeze({
	providerRequests: 0,
	confirmedCostMicrousd: 0,
	confirmedElapsedMs: 0,
	effectFacts: 0,
}) satisfies CurrentGraphBudgetStateV1;

export const CURRENT_GRAPH_QUALIFICATION_LIMITS = Object.freeze({
	maxProviderRequests: 96,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
	maxEffectFacts: 512,
	providerMaxCostMicrousd: 100_000,
	providerMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 10_000,
}) satisfies CurrentGraphBudgetLimitsV1;

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
	if (typeof value !== "string" || !values.includes(value as T))
		throw new TypeError(`${path} is invalid`);
	return value as T;
}

function bool(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${path} is invalid`);
	return value;
}

function assertBoundedCanonicalTree(
	value: unknown,
	path: string,
	state: { nodes: number },
	depth = 0,
): void {
	state.nodes += 1;
	if (state.nodes > 512 || depth > 12)
		throw new TypeError(`${path} exceeded the canonical tree bound`);
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "string") {
		if (value.length > 2_048) throw new TypeError(`${path} exceeded the string bound`);
		return;
	}
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) throw new TypeError(`${path} contains an unsafe number`);
		return;
	}
	if (Array.isArray(value)) {
		if (value.length > 32) throw new TypeError(`${path} exceeded the array bound`);
		const entries = array(value, path);
		for (let index = 0; index < entries.length; index += 1)
			assertBoundedCanonicalTree(entries[index], `${path}[${index}]`, state, depth + 1);
		return;
	}
	const candidate = record(value, path);
	const keys = Object.keys(candidate);
	if (keys.length > 32) throw new TypeError(`${path} exceeded the object-key bound`);
	for (const key of keys)
		assertBoundedCanonicalTree(candidate[key], `${path}.${key}`, state, depth + 1);
}

function validateLimits(value: unknown): CurrentGraphBudgetLimitsV1 {
	const candidate = record(value, "current.limits");
	exactKeys(
		candidate,
		[
			"localEffectMaxElapsedMs",
			"maxCostMicrousd",
			"maxEffectFacts",
			"maxElapsedMs",
			"maxProviderRequests",
			"providerMaxCostMicrousd",
			"providerMaxElapsedMs",
		],
		"current.limits",
	);
	for (const key of Object.keys(candidate))
		safeInteger(candidate[key], `current.limits.${key}`, { min: 1 });
	return strictSnapshot(candidate) as unknown as CurrentGraphBudgetLimitsV1;
}

function validateBudget(value: unknown, path: string): CurrentGraphBudgetStateV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		["confirmedCostMicrousd", "confirmedElapsedMs", "effectFacts", "providerRequests"],
		path,
	);
	for (const key of Object.keys(candidate))
		safeInteger(candidate[key], `${path}.${key}`, { min: 0 });
	return strictSnapshot(candidate) as unknown as CurrentGraphBudgetStateV1;
}

function initialRun(): MutableRunState {
	return {
		armIndex: 0,
		runSequence: 0,
		phase: "none",
		workspaceStateDigest: null,
		pendingTools: [],
		replacementRecoveryUsed: false,
		validationRecoveryUsed: false,
		semanticRecoveryUsed: false,
		publicSemanticValidationAttempted: false,
		publicSemanticValidationPassed: false,
		hiddenVerifierAttempted: false,
		hiddenVerifierPassed: false,
		cleanupStatus: "unknown",
		activeCorrection: null,
		stopped: false,
	};
}

function currentArm(state: AuthorityState): CurrentGraphArm {
	const arm = CURRENT_GRAPH_ARMS[state.run.armIndex];
	if (arm === undefined) throw new TypeError("current Graph arm index is out of bounds");
	return arm;
}

function reservationFor(state: AuthorityState, effectKind: CurrentGraphEffectKind) {
	return effectKind === "provider-request"
		? Object.freeze({
				providerRequests: 1,
				maxCostMicrousd: state.limits.providerMaxCostMicrousd,
				maxElapsedMs: state.limits.providerMaxElapsedMs,
			})
		: Object.freeze({
				providerRequests: 0,
				maxCostMicrousd: 0,
				maxElapsedMs: state.limits.localEffectMaxElapsedMs,
			});
}

function prospectiveBudget(
	state: AuthorityState,
	reservation: ReturnType<typeof reservationFor>,
): CurrentGraphBudgetStateV1 {
	return Object.freeze({
		providerRequests: state.budget.providerRequests + reservation.providerRequests,
		confirmedCostMicrousd: state.budget.confirmedCostMicrousd + reservation.maxCostMicrousd,
		confirmedElapsedMs: state.budget.confirmedElapsedMs + reservation.maxElapsedMs,
		effectFacts: state.budget.effectFacts + 1,
	});
}

function withinLimits(state: AuthorityState, budget: CurrentGraphBudgetStateV1): boolean {
	return (
		budget.providerRequests <= state.limits.maxProviderRequests &&
		budget.confirmedCostMicrousd <= state.limits.maxCostMicrousd &&
		budget.confirmedElapsedMs <= state.limits.maxElapsedMs &&
		budget.effectFacts <= state.limits.maxEffectFacts
	);
}

function remainingBounds(state: AuthorityState) {
	return {
		remainingProviderRequests: state.limits.maxProviderRequests - state.budget.providerRequests,
		remainingCostMicrousd: state.limits.maxCostMicrousd - state.budget.confirmedCostMicrousd,
		remainingElapsedMs: state.limits.maxElapsedMs - state.budget.confirmedElapsedMs,
		remainingEffectFacts: state.limits.maxEffectFacts - state.budget.effectFacts,
	};
}

function hasCorrectionHeadroom(
	state: AuthorityState,
	kind: "replacement" | "validation" | "semantic",
): boolean {
	const providerRequests = kind === "semantic" ? 1 : 2;
	const localEffects = kind === "replacement" || kind === "validation" ? 10 : 6;
	const remaining = remainingBounds(state);
	return (
		remaining.remainingProviderRequests >= providerRequests &&
		remaining.remainingCostMicrousd >= providerRequests * state.limits.providerMaxCostMicrousd &&
		remaining.remainingElapsedMs >=
			providerRequests * state.limits.providerMaxElapsedMs +
				localEffects * state.limits.localEffectMaxElapsedMs &&
		remaining.remainingEffectFacts >= providerRequests + localEffects
	);
}

function correctionDirective(
	state: AuthorityState,
	input: {
		reason: CurrentGraphCorrectionDirectiveV1["reason"];
		stage: CurrentGraphCorrectionDirectiveV1["stage"];
		sourceFactDigest: string;
		recoveryDigest?: string;
		requiredFirstToolRef: CurrentGraphCorrectionDirectiveV1["requiredFirstToolRef"];
		criterionFailures?: readonly CurrentPublicCriterionFailure[];
	},
): CurrentGraphCorrectionDirectiveV1 {
	if (state.run.workspaceStateDigest === null)
		throw new TypeError("current correction requires a materialized workspace");
	const remaining = remainingBounds(state);
	const recoveryDigest =
		input.recoveryDigest ??
		empiricalStrictJsonDigest({
			arm: currentArm(state),
			runSequence: state.run.runSequence,
			reason: input.reason,
			sourceFactDigest: input.sourceFactDigest,
			workspaceStateDigest: state.run.workspaceStateDigest,
		});
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_CORRECTION_SCHEMA,
		reason: input.reason,
		stage: input.stage,
		recoveryDigest,
		sourceFactDigest: input.sourceFactDigest,
		workspaceStateDigest: state.run.workspaceStateDigest,
		requiredFirstToolRef: input.requiredFirstToolRef,
		criterionFailures: Object.freeze([...(input.criterionFailures ?? [])]),
		...remaining,
	});
	return Object.freeze({ ...material, contextDigest: empiricalStrictJsonDigest(material) });
}

function finding(state: AuthorityState, code: CurrentGraphFindingCode, sourceFactDigest: string) {
	const material = strictSnapshot({
		code,
		arm: currentArm(state),
		runSequence: state.run.runSequence,
		sourceFactDigest,
	});
	state.findings.push(
		Object.freeze({ ...material, findingDigest: empiricalStrictJsonDigest(material) }),
	);
}

function schedule(
	state: AuthorityState,
	effectKind: CurrentGraphEffectKind,
	toolRef: CurrentGraphToolRef | null = null,
	correction: CurrentGraphCorrectionDirectiveV1 | null = state.run.activeCorrection,
): void {
	if (state.active !== null || state.finished)
		throw new TypeError("current Graph schedule overlap");
	const reservation = reservationFor(state, effectKind);
	const prospective = prospectiveBudget(state, reservation);
	if (!withinLimits(state, prospective) && effectKind !== "cleanup") {
		state.run.stopped = true;
		finding(
			state,
			"budget-exhausted",
			empiricalStrictJsonDigest({ effectKind, arm: currentArm(state), budget: state.budget }),
		);
		schedule(state, "cleanup", null, null);
		return;
	}
	const sequence = state.nextSequence++;
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d5.graph-effect-request.v1" as const,
		sequence,
		arm: currentArm(state),
		runSequence: state.run.runSequence,
		effectKind,
		toolRef,
		phaseBefore: state.run.phase,
		workspaceStateDigest: state.run.workspaceStateDigest,
		correctionDirective: correction,
		reservation,
	});
	const request = Object.freeze({ ...base, requestDigest: empiricalStrictJsonDigest(base) });
	const admissionMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d5.graph-effect-admission.v1" as const,
		requestDigest: request.requestDigest,
		admitted: true as const,
		budgetBefore: state.budget,
		prospectiveBudget: prospective,
	});
	state.active = Object.freeze({
		request,
		admission: Object.freeze({
			...admissionMaterial,
			decisionDigest: empiricalStrictJsonDigest(admissionMaterial),
		}),
	});
}

function exactToolOrder(phase: CurrentGraphPhase, tools: readonly CurrentGraphToolRef[]): boolean {
	if (phase === "none")
		return (
			tools.length >= 1 &&
			tools.length <= D5_MAX_INSPECTION_BATCH &&
			tools.every((tool) => tool === "read-file")
		);
	if (phase === "inspection")
		return (
			tools.length === 3 &&
			tools[0] === "replace-exact" &&
			tools[1] === "workspace-diff" &&
			tools[2] === "focused-validation"
		);
	return false;
}

function scheduleCleanup(state: AuthorityState): void {
	state.run.pendingTools = [];
	state.run.activeCorrection = null;
	schedule(state, "cleanup", null, null);
}

function runProjection(state: AuthorityState): CurrentGraphRunProjectionV1 {
	const completed =
		state.run.cleanupStatus === "completed" && state.run.hiddenVerifierPassed && !state.run.stopped;
	const material = strictSnapshot({
		arm: currentArm(state),
		runSequence: state.run.runSequence,
		phase: state.run.phase,
		replacementRecoveryUsed: state.run.replacementRecoveryUsed,
		validationRecoveryUsed: state.run.validationRecoveryUsed,
		semanticRecoveryUsed: state.run.semanticRecoveryUsed,
		publicSemanticValidationAttempted: state.run.publicSemanticValidationAttempted,
		publicSemanticValidationPassed: state.run.publicSemanticValidationPassed,
		hiddenVerifierAttempted: state.run.hiddenVerifierAttempted,
		hiddenVerifierPassed: state.run.hiddenVerifierPassed,
		cleanupStatus:
			state.run.cleanupStatus === "unknown" ? ("failed" as const) : state.run.cleanupStatus,
		status: completed ? ("completed" as const) : ("incomplete" as const),
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}

function applyFact(state: AuthorityState, fact: CurrentGraphAdmittedFactV1): void {
	const result = fact.result;
	if (result.effectKind === "materialization") {
		if (result.status === "completed" && result.workspaceStateDigest !== null) {
			state.run.workspaceStateDigest = result.workspaceStateDigest;
			schedule(state, "provider-request");
		} else {
			state.run.stopped = true;
			finding(state, "executor-failed", fact.factDigest);
			scheduleCleanup(state);
		}
		return;
	}
	if (result.effectKind === "provider-request") {
		if (result.status === "failed") {
			state.run.stopped = true;
			finding(state, "executor-failed", fact.factDigest);
			scheduleCleanup(state);
			return;
		}
		if (
			result.disposition !== "tool-intents" ||
			!exactToolOrder(state.run.phase, result.toolIntents)
		) {
			state.run.stopped = true;
			finding(
				state,
				state.run.phase === "none" ? "inspection-batch-policy-violated" : "executor-failed",
				fact.factDigest,
			);
			scheduleCleanup(state);
			return;
		}
		const required = state.run.activeCorrection?.requiredFirstToolRef;
		if (required !== undefined && result.toolIntents[0] !== required) {
			state.run.stopped = true;
			finding(state, "executor-failed", fact.factDigest);
			scheduleCleanup(state);
			return;
		}
		state.run.pendingTools = [...result.toolIntents];
		schedule(state, "tool-action", state.run.pendingTools.shift() ?? null);
		return;
	}
	if (result.effectKind === "tool-action") {
		if (result.status === "failed") {
			state.run.workspaceStateDigest = result.workspaceStateAfterDigest;
			state.run.pendingTools = [];
			const exactReplacementRejected =
				result.toolRef === "replace-exact" &&
				(result.causeCode === "exact-replacement-unchanged" ||
					result.causeCode === "exact-replacement-old-text-not-found" ||
					result.causeCode === "exact-replacement-old-text-not-unique") &&
				result.workspaceStateBeforeDigest === result.workspaceStateAfterDigest;
			const focusedValidationRejected =
				result.toolRef === "focused-validation" &&
				result.causeCode === "focused-validation-failed" &&
				result.workspaceStateBeforeDigest === result.workspaceStateAfterDigest;
			if (exactReplacementRejected) finding(state, "exact-replacement-rejected", fact.factDigest);
			if (
				exactReplacementRejected &&
				state.run.activeCorrection?.reason !== "focused-validation-failed" &&
				!state.run.replacementRecoveryUsed &&
				hasCorrectionHeadroom(state, "replacement")
			) {
				state.run.replacementRecoveryUsed = true;
				state.run.activeCorrection = correctionDirective(state, {
					reason: result.causeCode as Extract<
						CurrentGraphCorrectionDirectiveV1["reason"],
						`exact-replacement-${string}`
					>,
					stage: "reinspect",
					sourceFactDigest: fact.factDigest,
					requiredFirstToolRef: "read-file",
				});
				state.run.phase = "none";
				schedule(state, "provider-request");
				return;
			}
			if (focusedValidationRejected) {
				finding(state, "focused-validation-failed", fact.factDigest);
				if (!state.run.validationRecoveryUsed && hasCorrectionHeadroom(state, "validation")) {
					state.run.validationRecoveryUsed = true;
					state.run.activeCorrection = correctionDirective(state, {
						reason: "focused-validation-failed",
						stage: "validation-reinspect",
						sourceFactDigest: fact.factDigest,
						requiredFirstToolRef: "read-file",
					});
					state.run.phase = "none";
					schedule(state, "provider-request");
					return;
				}
			}
			state.run.stopped = true;
			scheduleCleanup(state);
			return;
		}
		state.run.workspaceStateDigest = result.workspaceStateAfterDigest;
		if (result.toolRef === "read-file") {
			state.run.phase = "inspection";
			if (state.run.activeCorrection?.stage === "reinspect") {
				const correction = state.run.activeCorrection;
				state.run.activeCorrection = correctionDirective(state, {
					reason: correction.reason,
					stage: "fresh-mutation",
					sourceFactDigest: correction.sourceFactDigest,
					recoveryDigest: correction.recoveryDigest,
					requiredFirstToolRef: "replace-exact",
				});
			} else if (state.run.activeCorrection?.stage === "validation-reinspect") {
				const correction = state.run.activeCorrection;
				state.run.activeCorrection = correctionDirective(state, {
					reason: "focused-validation-failed",
					stage: "validation-mutation",
					sourceFactDigest: correction.sourceFactDigest,
					recoveryDigest: correction.recoveryDigest,
					requiredFirstToolRef: "replace-exact",
				});
			}
		} else if (result.toolRef === "replace-exact") {
			state.run.phase = "exact-mutation";
			state.run.publicSemanticValidationAttempted = false;
			state.run.publicSemanticValidationPassed = false;
			state.run.hiddenVerifierAttempted = false;
			state.run.hiddenVerifierPassed = false;
		} else if (result.toolRef === "workspace-diff") {
			if (!result.nonEmptyDiff) {
				state.run.stopped = true;
				scheduleCleanup(state);
				return;
			}
			state.run.phase = "workspace-diff";
		} else {
			state.run.phase = "focused-validation-passed";
		}
		const nextTool = state.run.pendingTools.shift();
		if (nextTool !== undefined) schedule(state, "tool-action", nextTool);
		else if (state.run.phase === "focused-validation-passed") {
			state.run.activeCorrection = null;
			schedule(state, "public-semantic-validation");
		} else schedule(state, "provider-request");
		return;
	}
	if (result.effectKind === "public-semantic-validation") {
		state.run.publicSemanticValidationAttempted = true;
		if (result.status === "failed") {
			state.run.publicSemanticValidationPassed = false;
			finding(state, "public-semantic-validation-failed", fact.factDigest);
			if (!state.run.semanticRecoveryUsed && hasCorrectionHeadroom(state, "semantic")) {
				state.run.semanticRecoveryUsed = true;
				state.run.phase = "inspection";
				state.run.activeCorrection = correctionDirective(state, {
					reason: "public-semantic-validation-failed",
					stage: "semantic-correction",
					sourceFactDigest: fact.factDigest,
					requiredFirstToolRef: "replace-exact",
					criterionFailures: result.criterionFailures,
				});
				schedule(state, "provider-request");
				return;
			}
			state.run.stopped = true;
			scheduleCleanup(state);
			return;
		}
		state.run.publicSemanticValidationPassed = true;
		state.run.phase = "public-semantic-validation-passed";
		schedule(state, "hidden-verifier");
		return;
	}
	if (result.effectKind === "hidden-verifier") {
		state.run.hiddenVerifierAttempted = true;
		if (result.status === "failed") {
			state.run.hiddenVerifierPassed = false;
			state.run.stopped = true;
			finding(state, "hidden-verifier-failed", fact.factDigest);
		} else {
			state.run.hiddenVerifierPassed = true;
			state.run.phase = "complete";
		}
		scheduleCleanup(state);
		return;
	}
	state.run.cleanupStatus = result.status;
	if (result.status === "failed") {
		state.run.stopped = true;
		finding(state, "cleanup-failed", fact.factDigest);
	}
	state.runs.push(runProjection(state));
	if (result.status === "failed" || state.run.armIndex === CURRENT_GRAPH_ARMS.length - 1) {
		state.finished = true;
		return;
	}
	const nextArmIndex = state.run.armIndex + 1;
	const nextRunSequence = state.run.runSequence + 1;
	state.run = initialRun();
	state.run.armIndex = nextArmIndex;
	state.run.runSequence = nextRunSequence;
	schedule(state, "materialization", null, null);
}

function validateResult(
	value: unknown,
	request: CurrentGraphEffectRequestV1,
): CurrentGraphEffectResultInputV1 {
	const candidate = record(value, "current.result");
	if (candidate.effectKind !== request.effectKind)
		throw new TypeError("current result effect kind does not match the admitted request");
	const actualElapsedMs = safeInteger(candidate.actualElapsedMs, "current.result.actualElapsedMs", {
		min: 0,
	});
	const actualCostMicrousd = safeInteger(
		candidate.actualCostMicrousd,
		"current.result.actualCostMicrousd",
		{ min: 0 },
	);
	digest(candidate.evidenceDigest, "current.result.evidenceDigest");
	if (request.effectKind !== "provider-request" && actualCostMicrousd !== 0)
		throw new TypeError("current local effect cannot report provider cost");
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
			"current.result",
		);
		const status = oneOf(candidate.status, ["completed", "failed"], "current.result.status");
		if ((status === "completed") !== (typeof candidate.workspaceStateDigest === "string"))
			throw new TypeError("current materialization workspace cardinality drifted");
		if (typeof candidate.workspaceStateDigest === "string")
			digest(candidate.workspaceStateDigest, "current.result.workspaceStateDigest");
	} else if (request.effectKind === "provider-request") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"disposition",
				"effectKind",
				"evidenceDigest",
				"failureCode",
				"status",
				"toolIntents",
			],
			"current.result",
		);
		const status = oneOf(candidate.status, ["completed", "failed"], "current.result.status");
		const tools = array(candidate.toolIntents, "current.result.toolIntents");
		if (tools.length > D5_MAX_INSPECTION_BATCH)
			throw new TypeError("current provider tool intent bound exceeded");
		for (const tool of tools) oneOf(tool, TOOL_REFS, "current.result.toolIntent");
		if (status === "failed") {
			if (
				candidate.disposition !== null ||
				tools.length !== 0 ||
				candidate.failureCode !== "provider-failed"
			)
				throw new TypeError("current failed provider result cardinality drifted");
		} else if (
			candidate.failureCode !== null ||
			candidate.disposition !== "tool-intents" ||
			tools.length === 0
		)
			throw new TypeError("current completed provider result cardinality drifted");
	} else if (request.effectKind === "tool-action") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"causeCode",
				"effectKind",
				"evidenceDigest",
				"nonEmptyDiff",
				"status",
				"toolRef",
				"workspaceStateAfterDigest",
				"workspaceStateBeforeDigest",
			],
			"current.result",
		);
		const status = oneOf(candidate.status, ["succeeded", "failed"], "current.result.status");
		const toolRef = oneOf(candidate.toolRef, TOOL_REFS, "current.result.toolRef");
		if (toolRef !== request.toolRef) throw new TypeError("current tool result ref drifted");
		const before = digest(candidate.workspaceStateBeforeDigest, "current.result.before");
		const after = digest(candidate.workspaceStateAfterDigest, "current.result.after");
		if (before !== request.workspaceStateDigest)
			throw new TypeError("current tool result used a stale workspace state");
		if (status === "failed") {
			oneOf(candidate.causeCode, TOOL_REJECTION_CAUSES, "current.result.causeCode");
			if (before !== after || candidate.nonEmptyDiff !== false)
				throw new TypeError("current failed tool action changed workspace state");
		} else if (candidate.causeCode !== null)
			throw new TypeError("current successful tool action cannot carry a rejection cause");
		else if (toolRef === "read-file" && (before !== after || candidate.nonEmptyDiff !== false))
			throw new TypeError("current read-only inspection changed workspace state");
		bool(candidate.nonEmptyDiff, "current.result.nonEmptyDiff");
	} else if (request.effectKind === "public-semantic-validation") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"criterionFailures",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"current.result",
		);
		const status = oneOf(candidate.status, ["passed", "failed"], "current.result.status");
		const failures = array(candidate.criterionFailures, "current.result.criterionFailures");
		if (failures.length > CURRENT_PUBLIC_CRITERION_FAILURES.length)
			throw new TypeError("current criterion failure bound exceeded");
		for (const failure of failures)
			oneOf(failure, CURRENT_PUBLIC_CRITERION_FAILURES, "current.result.criterionFailure");
		if ((status === "passed") !== (failures.length === 0))
			throw new TypeError("current public semantic result cardinality drifted");
		if (
			digest(candidate.workspaceStateDigest, "current.result.workspaceStateDigest") !==
			request.workspaceStateDigest
		)
			throw new TypeError("current semantic validation used a stale workspace state");
	} else if (request.effectKind === "hidden-verifier") {
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
			"current.result",
		);
		oneOf(candidate.status, ["passed", "failed"], "current.result.status");
		if (
			digest(candidate.workspaceStateDigest, "current.result.workspaceStateDigest") !==
			request.workspaceStateDigest
		)
			throw new TypeError("current hidden verifier used a stale workspace state");
	} else {
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
			"current.result",
		);
		oneOf(candidate.status, ["completed", "failed"], "current.result.status");
		if (candidate.workspaceStateDigest !== null)
			digest(candidate.workspaceStateDigest, "current.result.workspaceStateDigest");
	}
	if (actualElapsedMs > request.reservation.maxElapsedMs)
		throw new TypeError("current effect exceeded its admitted elapsed reservation");
	if (actualCostMicrousd > request.reservation.maxCostMicrousd)
		throw new TypeError("current effect exceeded its admitted cost reservation");
	return strictSnapshot(candidate) as unknown as CurrentGraphEffectResultInputV1;
}

function factKindFor(
	result: CurrentGraphEffectResultInputV1,
): CurrentGraphAdmittedFactV1["factKind"] {
	if (result.effectKind === "tool-action") return "tool-result";
	if (result.effectKind === "public-semantic-validation") return "public-semantic-result";
	if (result.effectKind === "hidden-verifier") return "hidden-verifier-result";
	return "executor-result";
}

export function createCurrentGraphNativeEvalAuthority(inputValue: {
	readonly limits: CurrentGraphBudgetLimitsV1;
}): CurrentGraphNativeEvalAuthorityV1 {
	const input = record(inputValue, "current.authority");
	exactKeys(input, ["limits"], "current.authority");
	const limits = validateLimits(input.limits);
	const owner = graph({ name: "current/graph-native-eval-d5" });
	const factNode = createCurrentFactNode(owner);
	const projectionNode = owner.node<CurrentGraphAdmittedFactV1>(
		[factNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{ name: "current/d5/projections", factory: "currentGraphCanonicalProjection" },
	);
	const facts: CurrentGraphAdmittedFactV1[] = [];
	const capability = Object.freeze({ revision: CURRENT_GRAPH_NATIVE_EVAL_REVISION });
	const state: AuthorityState = {
		owner,
		factNode,
		facts,
		findings: [],
		runs: [],
		limits,
		budget: ZERO_BUDGET,
		run: initialRun(),
		nextSequence: 0,
		active: null,
		finished: false,
	};
	projectionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const fact = message[1] as CurrentGraphAdmittedFactV1;
		facts.push(fact);
		applyFact(state, fact);
	});
	states.set(capability, state);
	schedule(state, "materialization", null, null);
	return capability;
}

function stateFor(value: unknown): AuthorityState {
	if (value === null || typeof value !== "object")
		throw new TypeError("current Graph authority must be an object");
	const state = states.get(value);
	if (state === undefined) throw new TypeError("current Graph authority is forged");
	return state;
}

export function takeCurrentGraphAdmittedEffect(
	authority: CurrentGraphNativeEvalAuthorityV1,
): CurrentGraphAdmittedEffectV1 | null {
	const state = stateFor(authority);
	return state.active;
}

export function admitCurrentGraphEffectResult(
	authority: CurrentGraphNativeEvalAuthorityV1,
	requestDigestValue: string,
	resultValue: unknown,
): CurrentGraphAdmittedFactV1 {
	const state = stateFor(authority);
	const active = state.active;
	if (active === null) throw new TypeError("current Graph has no active effect admission");
	const requestDigest = digest(requestDigestValue, "current.requestDigest");
	if (requestDigest !== active.request.requestDigest)
		throw new TypeError("current result does not match the active Graph request");
	const result = validateResult(resultValue, active.request);
	state.active = null;
	const budgetAfter = Object.freeze({
		providerRequests: state.budget.providerRequests + active.request.reservation.providerRequests,
		confirmedCostMicrousd: state.budget.confirmedCostMicrousd + result.actualCostMicrousd,
		confirmedElapsedMs: state.budget.confirmedElapsedMs + result.actualElapsedMs,
		effectFacts: state.budget.effectFacts + 1,
	});
	const reconciliationMaterial = strictSnapshot({
		actualCostMicrousd: result.actualCostMicrousd,
		actualElapsedMs: result.actualElapsedMs,
		budgetAfter,
	});
	const reconciliation = Object.freeze({
		...reconciliationMaterial,
		reconciliationDigest: empiricalStrictJsonDigest(reconciliationMaterial),
	});
	const material = strictSnapshot({
		factKind: factKindFor(result),
		sequence: state.facts.length,
		arm: active.request.arm,
		runSequence: active.request.runSequence,
		request: active.request,
		admission: active.admission,
		result,
		reconciliation,
	});
	const fact = Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as CurrentGraphAdmittedFactV1;
	state.budget = budgetAfter;
	state.factNode.down([["DATA", fact]]);
	return fact;
}

function evidenceMaterial(state: AuthorityState) {
	const topologyMaterial = strictSnapshot({
		factNode: "current/d5/facts" as const,
		projectionNode: "current/d5/projections" as const,
		arms: CURRENT_GRAPH_ARMS,
	});
	const topology = Object.freeze({
		...topologyMaterial,
		topologyDigest: empiricalStrictJsonDigest(topologyMaterial),
	});
	return strictSnapshot({
		schemaVersion: CURRENT_GRAPH_NATIVE_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D5" as const,
		topology,
		limits: state.limits,
		facts: state.facts,
		findings: state.findings,
		runs: state.runs,
		budget: state.budget,
		runStatus:
			state.finished && state.runs.length === CURRENT_GRAPH_ARMS.length
				? ("complete" as const)
				: ("stopped" as const),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
}

export function snapshotCurrentGraphNativeEvidence(
	authority: CurrentGraphNativeEvalAuthorityV1,
): CurrentGraphNativeEvidenceV1 {
	const state = stateFor(authority);
	if (!state.finished || state.active !== null)
		throw new TypeError("current Graph evidence cannot snapshot an unfinished evaluation");
	const material = evidenceMaterial(state);
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function replayEvidenceFacts(
	limits: CurrentGraphBudgetLimitsV1,
	facts: readonly CurrentGraphAdmittedFactV1[],
): CurrentGraphNativeEvidenceV1 {
	const authority = createCurrentGraphNativeEvalAuthority({ limits });
	for (const fact of facts) {
		const active = takeCurrentGraphAdmittedEffect(authority);
		if (active === null || active.request.requestDigest !== fact.request.requestDigest)
			throw new TypeError("current Graph canonical replay request drifted");
		if (active.admission.decisionDigest !== fact.admission.decisionDigest)
			throw new TypeError("current Graph canonical replay admission drifted");
		const admitted = admitCurrentGraphEffectResult(
			authority,
			active.request.requestDigest,
			fact.result,
		);
		if (admitted.factDigest !== fact.factDigest)
			throw new TypeError("current Graph canonical replay fact drifted");
	}
	return snapshotCurrentGraphNativeEvidence(authority);
}

export function validateCurrentGraphNativeEvidence(value: unknown): CurrentGraphNativeEvidenceV1 {
	const candidate = record(value, "current.evidence");
	exactKeys(
		candidate,
		[
			"budget",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"facts",
			"findings",
			"limits",
			"runStatus",
			"runs",
			"schemaVersion",
			"topology",
		],
		"current.evidence",
	);
	if (
		candidate.schemaVersion !== CURRENT_GRAPH_NATIVE_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D5" ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("current Graph evidence coordinates drifted");
	const limits = validateLimits(candidate.limits);
	const rawFacts = array(candidate.facts, "current.evidence.facts");
	if (rawFacts.length === 0 || rawFacts.length > limits.maxEffectFacts)
		throw new TypeError("current Graph evidence fact bound drifted");
	const facts = rawFacts.map((fact, index) => {
		const value = record(fact, `current.evidence.facts[${index}]`);
		assertBoundedCanonicalTree(value, `current.evidence.facts[${index}]`, { nodes: 0 });
		digest(value.factDigest, `current.evidence.facts[${index}].factDigest`);
		return strictSnapshot(value) as unknown as CurrentGraphAdmittedFactV1;
	});
	const replayed = replayEvidenceFacts(limits, facts);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(replayed))
		throw new TypeError("current Graph evidence canonical replay drifted");
	validateBudget(candidate.budget, "current.evidence.budget");
	return replayed;
}

export async function runCurrentGraphNativeEval(inputValue: {
	readonly limits: CurrentGraphBudgetLimitsV1;
	readonly execute: (
		effect: CurrentGraphAdmittedEffectV1,
	) => Promise<CurrentGraphEffectResultInputV1>;
}): Promise<CurrentGraphNativeEvidenceV1> {
	const input = record(inputValue, "current.run");
	exactKeys(input, ["execute", "limits"], "current.run");
	if (typeof input.execute !== "function") throw new TypeError("current executor is invalid");
	const authority = createCurrentGraphNativeEvalAuthority({ limits: validateLimits(input.limits) });
	for (let guard = 0; guard < CURRENT_GRAPH_QUALIFICATION_LIMITS.maxEffectFacts; guard += 1) {
		const effect = takeCurrentGraphAdmittedEffect(authority);
		if (effect === null) return snapshotCurrentGraphNativeEvidence(authority);
		const result = await (
			input.execute as (
				effect: CurrentGraphAdmittedEffectV1,
			) => Promise<CurrentGraphEffectResultInputV1>
		)(effect);
		admitCurrentGraphEffectResult(authority, effect.request.requestDigest, result);
	}
	throw new TypeError("current Graph eval exceeded its effect bound");
}
