import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	boolean,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	createD43PolicyCatalog,
	D43_ARMS,
	type D43Arm,
	type D43HarnessPlanV1,
	type D43ModelHarnessPolicyV1,
	type D43PolicyCatalogV1,
	readD43PolicyForPlan,
	resolveD43HarnessPlan,
	validateD43ModelHarnessPolicy,
} from "./d43-model-harness-policy.js";

export const D43_AUTHORITY_REVISION = "graphrefly-ts.d43.graph-harness-authority.v1" as const;
export const D43_EVIDENCE_SCHEMA = "graphrefly-ts.d43.graph-harness-evidence.v1" as const;
export const D43_FACT_SCHEMA = "graphrefly-ts.d43.graph-harness-fact.v1" as const;
export const D43_EFFECT_SCHEMA = "graphrefly-ts.d43.graph-harness-effect.v1" as const;

export const D43_EFFECT_KINDS = Object.freeze([
	"materialization",
	"inspection",
	"mutation",
	"workspace-diff",
	"focused-validation",
	"public-semantic-validation",
	"hidden-verifier",
	"cleanup",
] as const);

export const D43_RESULT_OUTCOMES = Object.freeze([
	"success",
	"passed",
	"failed",
	"wrong-tool",
	"premature-final",
	"length",
	"schema-rejected",
	"replacement-not-found",
	"replacement-not-unique",
	"replacement-unchanged",
	"wrong-scope",
	"provider-rejected",
	"transport-failed",
	"retryable-provider-failure",
	"executor-failed",
] as const);

export type D43EffectKind = (typeof D43_EFFECT_KINDS)[number];
export type D43ResultOutcome = (typeof D43_RESULT_OUTCOMES)[number];
export type D43EffectIntent =
	| "initial"
	| "same-request-retry"
	| "phase-correction"
	| "reinspection"
	| "fresh-mutation"
	| "semantic-correction";

export interface D43UsageV1 {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
}

export interface D43PublicSemanticCriteriaV1 {
	readonly scenarioSetDigest: string;
	readonly observations: readonly Readonly<{
		readonly criterion:
			| "actor-visible-behavior-changed"
			| "acceptance-criteria-satisfied"
			| "scope-preserved"
			| "regression-free";
		readonly scenarioRef: string;
		readonly scenarioDigest: string;
		readonly observationDigest: string;
		readonly freshnessDigest: string;
		readonly passed: boolean;
	}>[];
}

export interface D43AdmittedEffectV1 {
	readonly schemaVersion: typeof D43_EFFECT_SCHEMA;
	readonly sequence: number;
	readonly arm: D43Arm;
	readonly armIndex: number;
	readonly kind: D43EffectKind;
	readonly intent: D43EffectIntent;
	readonly phaseCycle: number;
	readonly providerEffect: boolean;
	readonly namedToolRef: "read-file" | "replace-exact" | null;
	readonly maxOutputTokens: number | null;
	readonly attempt: number;
	readonly logicalRequestDigest: string;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly planDigest: string;
	readonly policyDigest: string;
	readonly modelRef: string;
	readonly providerRef: string;
	readonly endpointProtocol: "chat-completions" | "responses";
	readonly namedToolChoiceEncoding: "function-object" | "tool-name";
	readonly taskEnvelopeDigest: string;
	readonly retainsInspectionSpan: boolean;
	readonly providerReservationMicrousd: number;
	readonly providerDeadlineMs: number;
	readonly elapsedReservationMs: number;
	readonly publicSemanticScenarioSetDigest: string | null;
	readonly effectDigest: string;
}

export interface D43EffectResultInputV1 {
	readonly outcome: D43ResultOutcome;
	readonly elapsedMs: number;
	readonly costMicrousd: number;
	readonly usage: D43UsageV1 | null;
	readonly wireDigest: string | null;
	readonly retryClass: "D671" | "D675" | "D710" | null;
	readonly criteria: D43PublicSemanticCriteriaV1 | null;
}

interface D43EffectResultV1 extends D43EffectResultInputV1 {
	readonly reconciledCostMicrousd: number;
	readonly reconciledElapsedMs: number;
	readonly resultDigest: string;
}

export type D43FactV1 =
	| Readonly<{
			schemaVersion: typeof D43_FACT_SCHEMA;
			sequence: number;
			factKind: "plan-selected";
			plan: D43HarnessPlanV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D43_FACT_SCHEMA;
			sequence: number;
			factKind: "effect-admitted";
			effect: D43AdmittedEffectV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D43_FACT_SCHEMA;
			sequence: number;
			factKind: "effect-result";
			effectDigest: string;
			requestDigest: string;
			admissionDigest: string;
			logicalRequestDigest: string;
			result: D43EffectResultV1;
			factDigest: string;
	  }>;

export interface D43FindingV1 {
	readonly sequence: number;
	readonly arm: D43Arm;
	readonly kind:
		| "phase-policy-violation"
		| "exact-replacement-rejected"
		| "semantic-validation-failed"
		| "hidden-verifier-failed"
		| "provider-result-rejected"
		| "transport-failed"
		| "executor-failed"
		| "budget-exhausted";
	readonly causeCode: string;
	readonly requestDigest: string | null;
	readonly factDigest: string;
}

export interface D43ArmProjectionV1 {
	readonly arm: D43Arm;
	readonly completed: boolean;
	readonly cleanupCompleted: boolean;
	readonly evaluable: boolean;
	readonly hiddenVerifierPassed: boolean | null;
	readonly inspectionCorrections: number;
	readonly mutationCorrections: number;
	readonly exactReplacementRecoveries: number;
	readonly semanticCorrections: number;
	readonly providerAttempts: number;
	readonly findingCount: number;
}

export interface D43BudgetProjectionV1 {
	readonly providerAttempts: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly effectResults: number;
}

export interface D43GraphHarnessEvidenceV1 {
	readonly schemaVersion: typeof D43_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D43";
	readonly authorityRevision: typeof D43_AUTHORITY_REVISION;
	readonly policy: D43ModelHarnessPolicyV1;
	readonly plan: D43HarnessPlanV1;
	readonly facts: readonly D43FactV1[];
	readonly findings: readonly D43FindingV1[];
	readonly arms: readonly D43ArmProjectionV1[];
	readonly budget: D43BudgetProjectionV1;
	readonly exactSixArmsCompleted: boolean;
	readonly maxActiveEffectsObserved: 1;
	readonly liveGateEvaluated: false;
	readonly frozenGateWouldPass: boolean;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D43GraphHarnessAuthorityV1 {
	readonly revision: typeof D43_AUTHORITY_REVISION;
}

interface PendingDirective {
	readonly kind: D43EffectKind;
	readonly intent: D43EffectIntent;
	readonly attempt: number;
	readonly logicalRequestDigest: string;
}

interface MutableArmState {
	readonly arm: D43Arm;
	completed: boolean;
	cleanupCompleted: boolean;
	evaluable: boolean;
	hiddenVerifierPassed: boolean | null;
	inspectionCorrections: number;
	mutationCorrections: number;
	exactReplacementRecoveries: number;
	semanticCorrections: number;
	providerAttempts: number;
	findingCount: number;
	phaseCycle: number;
	pendingFreshMutation: boolean;
	initialInspectionReads: number;
}

interface AuthorityState {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly plan: D43HarnessPlanV1;
	readonly policy: D43ModelHarnessPolicyV1;
	readonly facts: D43FactV1[];
	readonly findings: D43FindingV1[];
	readonly arms: MutableArmState[];
	readonly wireByLogicalRequest: Map<string, string>;
	readonly retriesByLogicalRequest: Map<string, number>;
	budget: D43BudgetProjectionV1;
	armIndex: number;
	nextFactSequence: number;
	nextEffectSequence: number;
	nextLogicalSequence: number;
	pending: PendingDirective | null;
	active: D43AdmittedEffectV1 | null;
	finished: boolean;
	stopAfterCleanup: boolean;
}

const states = new WeakMap<object, AuthorityState>();
const effectOwners = new WeakMap<object, object>();

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D43FactV1>([], null, { name: "d43/canonical-facts" });
}

function armState(arm: D43Arm): MutableArmState {
	return {
		arm,
		completed: false,
		cleanupCompleted: false,
		evaluable: false,
		hiddenVerifierPassed: null,
		inspectionCorrections: 0,
		mutationCorrections: 0,
		exactReplacementRecoveries: 0,
		semanticCorrections: 0,
		providerAttempts: 0,
		findingCount: 0,
		phaseCycle: 0,
		pendingFreshMutation: false,
		initialInspectionReads: 0,
	};
}

function stateFor(authority: D43GraphHarnessAuthorityV1): AuthorityState {
	const state = states.get(authority as object);
	if (state === undefined) throw new TypeError("D43 Graph harness authority is forged");
	return state;
}

function fact<T extends Omit<D43FactV1, "factDigest">>(value: T): D43FactV1 {
	const material = strictSnapshot(value);
	return Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D43FactV1;
}

function emit(state: AuthorityState, value: D43FactV1): void {
	state.factNode.down([["DATA", value]]);
}

function isProviderKind(kind: D43EffectKind): boolean {
	return kind === "inspection" || kind === "mutation";
}

function nextLogicalRequestDigest(
	state: AuthorityState,
	kind: D43EffectKind,
	intent: D43EffectIntent,
): string {
	return empiricalStrictJsonDigest({
		planDigest: state.plan.planDigest,
		arm: D43_ARMS[state.armIndex],
		kind,
		intent,
		phaseCycle: state.arms[state.armIndex]?.phaseCycle ?? 0,
		logicalSequence: state.nextLogicalSequence++,
	});
}

function queue(
	state: AuthorityState,
	kind: D43EffectKind,
	intent: D43EffectIntent = "initial",
	retry?: Readonly<{ logicalRequestDigest: string; attempt: number }>,
): void {
	if (state.pending !== null || state.active !== null || state.finished)
		throw new TypeError("D43 Graph attempted to overlap effects");
	const elapsedReservationMs = isProviderKind(kind)
		? state.policy.provider.providerDeadlineMs
		: state.policy.campaign.localEffectReservationMs;
	if (
		kind !== "cleanup" &&
		state.budget.confirmedElapsedMs + elapsedReservationMs > state.policy.campaign.maxElapsedMs
	) {
		addFinding(state, "budget-exhausted", "elapsed-headroom-insufficient", null);
		state.pending = {
			kind: "cleanup",
			intent: "initial",
			attempt: 0,
			logicalRequestDigest: nextLogicalRequestDigest(state, "cleanup", "initial"),
		};
		return;
	}
	if (isProviderKind(kind)) {
		const campaign = state.policy.campaign;
		const insufficient =
			state.budget.providerAttempts >= campaign.maxProviderAttempts ||
			state.budget.confirmedCostMicrousd + campaign.providerReservationMicrousd >
				campaign.maxCostMicrousd;
		if (insufficient) {
			addFinding(state, "budget-exhausted", "provider-headroom-insufficient", null);
			state.pending = {
				kind: "cleanup",
				intent: "initial",
				attempt: 0,
				logicalRequestDigest: nextLogicalRequestDigest(state, "cleanup", "initial"),
			};
			return;
		}
	}
	state.pending = {
		kind,
		intent,
		attempt: retry?.attempt ?? 0,
		logicalRequestDigest:
			retry?.logicalRequestDigest ?? nextLogicalRequestDigest(state, kind, intent),
	};
}

function addFinding(
	state: AuthorityState,
	kind: D43FindingV1["kind"],
	causeCode: string,
	requestDigest: string | null,
): void {
	const arm = state.arms[state.armIndex];
	if (arm === undefined) throw new TypeError("D43 finding has no active arm");
	const material = strictSnapshot({
		sequence: state.findings.length + 1,
		arm: arm.arm,
		kind,
		causeCode,
		requestDigest,
	});
	state.findings.push(
		Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) }),
	);
	arm.findingCount += 1;
}

function providerFailureKind(outcome: D43ResultOutcome): D43FindingV1["kind"] | null {
	if (outcome === "provider-rejected") return "provider-result-rejected";
	if (outcome === "transport-failed") return "transport-failed";
	if (outcome === "executor-failed") return "executor-failed";
	return null;
}

function phaseViolation(outcome: D43ResultOutcome): boolean {
	return (
		outcome === "wrong-tool" ||
		outcome === "premature-final" ||
		outcome === "length" ||
		outcome === "schema-rejected"
	);
}

function hasRecipe(
	state: AuthorityState,
	recipe: D43ModelHarnessPolicyV1["enhancementRecipes"][number],
): boolean {
	return state.policy.enhancementRecipes.includes(recipe);
}

function exactReplacementRejection(outcome: D43ResultOutcome): boolean {
	return (
		outcome === "replacement-not-found" ||
		outcome === "replacement-not-unique" ||
		outcome === "replacement-unchanged"
	);
}

function scheduleRetry(state: AuthorityState, effect: D43AdmittedEffectV1): boolean {
	const used = state.retriesByLogicalRequest.get(effect.logicalRequestDigest) ?? 0;
	if (used >= state.policy.campaign.maxSameLogicalRequestRetries) return false;
	state.retriesByLogicalRequest.set(effect.logicalRequestDigest, used + 1);
	queue(state, effect.kind, "same-request-retry", {
		logicalRequestDigest: effect.logicalRequestDigest,
		attempt: effect.attempt + 1,
	});
	return true;
}

function scheduleCleanup(state: AuthorityState): void {
	queue(state, "cleanup");
}

function applyResult(
	state: AuthorityState,
	effect: D43AdmittedEffectV1,
	result: D43EffectResultV1,
): void {
	const arm = state.arms[state.armIndex];
	if (arm === undefined || arm.arm !== effect.arm) throw new TypeError("D43 result arm drifted");
	state.budget = Object.freeze({
		providerAttempts: state.budget.providerAttempts + (effect.providerEffect ? 1 : 0),
		confirmedCostMicrousd: state.budget.confirmedCostMicrousd + result.reconciledCostMicrousd,
		confirmedElapsedMs: state.budget.confirmedElapsedMs + result.reconciledElapsedMs,
		effectResults: state.budget.effectResults + 1,
	});
	if (effect.providerEffect) arm.providerAttempts += 1;
	if (effect.providerEffect && result.wireDigest !== null)
		state.wireByLogicalRequest.set(effect.logicalRequestDigest, result.wireDigest);

	if (effect.kind === "cleanup") {
		if (result.outcome !== "success") {
			addFinding(state, "executor-failed", "cleanup-failed", effect.requestDigest);
			state.finished = true;
			return;
		}
		arm.cleanupCompleted = true;
		arm.completed = true;
		if (state.stopAfterCleanup) {
			state.finished = true;
			return;
		}
		state.armIndex += 1;
		if (state.armIndex >= D43_ARMS.length) state.finished = true;
		else queue(state, "materialization");
		return;
	}

	const hardFailure = providerFailureKind(result.outcome);
	if (hardFailure !== null) {
		addFinding(state, hardFailure, result.outcome, effect.requestDigest);
		if (effect.providerEffect && !hasRecipe(state, "sanitized-provider-failure-continuation"))
			state.stopAfterCleanup = true;
		scheduleCleanup(state);
		return;
	}
	if (result.outcome === "retryable-provider-failure") {
		if (scheduleRetry(state, effect)) return;
		addFinding(state, "provider-result-rejected", "retry-bound-exhausted", effect.requestDigest);
		scheduleCleanup(state);
		return;
	}

	switch (effect.kind) {
		case "materialization":
			if (result.outcome === "success") queue(state, "inspection");
			else {
				addFinding(state, "executor-failed", result.outcome, effect.requestDigest);
				scheduleCleanup(state);
			}
			return;
		case "inspection":
			if (result.outcome === "success") {
				if (arm.pendingFreshMutation) {
					arm.pendingFreshMutation = false;
					queue(state, "mutation", "fresh-mutation");
				} else {
					arm.initialInspectionReads += 1;
					if (arm.initialInspectionReads < 4) queue(state, "inspection");
					else queue(state, "mutation");
				}
				return;
			}
			if (
				phaseViolation(result.outcome) &&
				arm.inspectionCorrections === 0 &&
				hasRecipe(state, "premature-final-correction")
			) {
				arm.inspectionCorrections = 1;
				addFinding(state, "phase-policy-violation", result.outcome, effect.requestDigest);
				queue(state, "inspection", "phase-correction");
				return;
			}
			addFinding(state, "phase-policy-violation", result.outcome, effect.requestDigest);
			scheduleCleanup(state);
			return;
		case "mutation":
			if (result.outcome === "success") {
				queue(state, "workspace-diff");
				return;
			}
			if (
				exactReplacementRejection(result.outcome) &&
				arm.exactReplacementRecoveries === 0 &&
				hasRecipe(state, "fresh-mutation-after-exact-replacement-rejection")
			) {
				arm.exactReplacementRecoveries = 1;
				arm.pendingFreshMutation = true;
				arm.phaseCycle += 1;
				addFinding(state, "exact-replacement-rejected", result.outcome, effect.requestDigest);
				queue(state, "inspection", "reinspection");
				return;
			}
			if (
				phaseViolation(result.outcome) &&
				arm.mutationCorrections === 0 &&
				hasRecipe(state, "premature-final-correction")
			) {
				arm.mutationCorrections = 1;
				arm.phaseCycle += 1;
				addFinding(state, "phase-policy-violation", result.outcome, effect.requestDigest);
				queue(state, "mutation", "phase-correction");
				return;
			}
			addFinding(
				state,
				exactReplacementRejection(result.outcome)
					? "exact-replacement-rejected"
					: "phase-policy-violation",
				result.outcome,
				effect.requestDigest,
			);
			scheduleCleanup(state);
			return;
		case "workspace-diff":
			if (result.outcome === "success") queue(state, "focused-validation");
			else if (
				result.outcome === "wrong-scope" &&
				arm.semanticCorrections === 0 &&
				hasRecipe(state, "actor-visible-semantic-correction")
			) {
				arm.semanticCorrections = 1;
				arm.phaseCycle += 1;
				addFinding(state, "semantic-validation-failed", "wrong-scope", effect.requestDigest);
				queue(state, "mutation", "semantic-correction");
			} else {
				addFinding(
					state,
					result.outcome === "wrong-scope" ? "semantic-validation-failed" : "executor-failed",
					result.outcome,
					effect.requestDigest,
				);
				scheduleCleanup(state);
			}
			return;
		case "focused-validation":
			if (result.outcome === "passed") queue(state, "public-semantic-validation");
			else if (
				result.outcome === "failed" &&
				arm.semanticCorrections === 0 &&
				hasRecipe(state, "actor-visible-semantic-correction")
			) {
				arm.semanticCorrections = 1;
				arm.phaseCycle += 1;
				addFinding(
					state,
					"semantic-validation-failed",
					"focused-validation-failed",
					effect.requestDigest,
				);
				queue(state, "mutation", "semantic-correction");
			} else {
				addFinding(
					state,
					result.outcome === "failed" ? "semantic-validation-failed" : "executor-failed",
					result.outcome,
					effect.requestDigest,
				);
				scheduleCleanup(state);
			}
			return;
		case "public-semantic-validation":
			if (result.outcome === "passed") queue(state, "hidden-verifier");
			else if (
				result.outcome === "failed" &&
				arm.semanticCorrections === 0 &&
				hasRecipe(state, "actor-visible-semantic-correction")
			) {
				arm.semanticCorrections = 1;
				arm.phaseCycle += 1;
				addFinding(
					state,
					"semantic-validation-failed",
					"public-criterion-failed",
					effect.requestDigest,
				);
				queue(state, "mutation", "semantic-correction");
			} else {
				addFinding(state, "semantic-validation-failed", result.outcome, effect.requestDigest);
				scheduleCleanup(state);
			}
			return;
		case "hidden-verifier":
			if (result.outcome !== "passed" && result.outcome !== "failed") {
				addFinding(state, "executor-failed", result.outcome, effect.requestDigest);
				scheduleCleanup(state);
				return;
			}
			arm.evaluable = true;
			arm.hiddenVerifierPassed = result.outcome === "passed";
			if (!arm.hiddenVerifierPassed)
				addFinding(state, "hidden-verifier-failed", "hidden-verifier-failed", effect.requestDigest);
			scheduleCleanup(state);
			return;
	}
}

function applyFact(state: AuthorityState, value: D43FactV1): void {
	if (value.sequence !== state.facts.length + 1)
		throw new TypeError("D43 canonical fact sequence drifted");
	state.facts.push(value);
	if (value.factKind === "plan-selected") {
		if (value.plan.planDigest !== state.plan.planDigest || state.pending !== null)
			throw new TypeError("D43 selected plan drifted");
		queue(state, "materialization");
		return;
	}
	if (value.factKind === "effect-admitted") {
		if (state.active !== null || state.pending === null)
			throw new TypeError("D43 effect admission state drifted");
		state.pending = null;
		state.active = value.effect;
		return;
	}
	const active = state.active;
	if (
		active === null ||
		value.effectDigest !== active.effectDigest ||
		value.requestDigest !== active.requestDigest ||
		value.admissionDigest !== active.admissionDigest ||
		value.logicalRequestDigest !== active.logicalRequestDigest
	)
		throw new TypeError("D43 result fact lost its admitted effect binding");
	state.active = null;
	applyResult(state, active, value.result);
}

export function createD43GraphHarnessAuthority(input: {
	readonly catalog: D43PolicyCatalogV1;
	readonly assignment: {
		readonly assignmentRef: string;
		readonly modelRef: string;
		readonly providerRef: string;
		readonly campaignRef: string;
	};
}): D43GraphHarnessAuthorityV1 {
	const plan = resolveD43HarnessPlan(input.catalog, input.assignment);
	const policy = readD43PolicyForPlan(input.catalog, plan);
	const owner = graph({ name: "d43/graph-native-harness" });
	const factNode = createFactNode(owner);
	let state!: AuthorityState;
	const projectionNode = owner.node<D43FactV1>(
		[factNode],
		(ctx) => {
			for (const item of (depBatch(ctx, 0) ?? []) as readonly D43FactV1[]) {
				applyFact(state, item);
				ctx.down([["DATA", item]]);
			}
		},
		{ name: "d43/canonical-projection", factory: "d43GraphHarnessProjection" },
	);
	const authority = Object.freeze({ revision: D43_AUTHORITY_REVISION });
	state = {
		owner,
		factNode,
		plan,
		policy,
		facts: [],
		findings: [],
		arms: D43_ARMS.map(armState),
		wireByLogicalRequest: new Map(),
		retriesByLogicalRequest: new Map(),
		budget: Object.freeze({
			providerAttempts: 0,
			confirmedCostMicrousd: 0,
			confirmedElapsedMs: 0,
			effectResults: 0,
		}),
		armIndex: 0,
		nextFactSequence: 1,
		nextEffectSequence: 1,
		nextLogicalSequence: 1,
		pending: null,
		active: null,
		finished: false,
		stopAfterCleanup: false,
	};
	projectionNode.subscribe(() => undefined);
	states.set(authority, state);
	emit(
		state,
		fact({
			schemaVersion: D43_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "plan-selected",
			plan,
		}),
	);
	return authority;
}

function effectFromPending(state: AuthorityState, pending: PendingDirective): D43AdmittedEffectV1 {
	const arm = state.arms[state.armIndex];
	if (arm === undefined) throw new TypeError("D43 pending effect has no arm");
	const providerEffect = isProviderKind(pending.kind);
	const namedToolRef: D43AdmittedEffectV1["namedToolRef"] = hasRecipe(
		state,
		"named-phase-tool-binding",
	)
		? pending.kind === "inspection"
			? "read-file"
			: pending.kind === "mutation"
				? "replace-exact"
				: null
		: null;
	const retainsInspectionSpan =
		pending.kind === "mutation" && hasRecipe(state, "retained-inspection-span");
	const maxOutputTokens =
		pending.kind === "inspection"
			? state.policy.model.inspectionMaxOutputTokens
			: pending.kind === "mutation"
				? state.policy.model.mutationMaxOutputTokens
				: null;
	const sequence = state.nextEffectSequence++;
	const requestMaterial = strictSnapshot({
		planDigest: state.plan.planDigest,
		policyDigest: state.policy.policyDigest,
		modelRef: state.policy.model.modelRef,
		providerRef: state.policy.provider.providerRef,
		endpointProtocol: state.policy.provider.endpointProtocol,
		namedToolChoiceEncoding: state.policy.provider.namedToolChoiceEncoding,
		taskEnvelopeDigest: state.policy.campaign.taskEnvelopeDigest,
		retainsInspectionSpan,
		sequence,
		arm: arm.arm,
		armIndex: state.armIndex,
		kind: pending.kind,
		intent: pending.intent,
		phaseCycle: arm.phaseCycle,
		attempt: pending.attempt,
		logicalRequestDigest: pending.logicalRequestDigest,
		namedToolRef,
		maxOutputTokens,
		publicSemanticScenarioSetDigest:
			pending.kind === "public-semantic-validation"
				? state.policy.campaign.publicSemanticScenarioSetDigest
				: null,
	});
	const requestDigest = empiricalStrictJsonDigest(requestMaterial);
	const admissionMaterial = strictSnapshot({
		requestDigest,
		planDigest: state.plan.planDigest,
		remainingProviderAttempts:
			state.policy.campaign.maxProviderAttempts - state.budget.providerAttempts,
		remainingCostMicrousd:
			state.policy.campaign.maxCostMicrousd - state.budget.confirmedCostMicrousd,
		remainingElapsedMs: state.policy.campaign.maxElapsedMs - state.budget.confirmedElapsedMs,
	});
	const material = strictSnapshot({
		schemaVersion: D43_EFFECT_SCHEMA,
		sequence,
		arm: arm.arm,
		armIndex: state.armIndex,
		kind: pending.kind,
		intent: pending.intent,
		phaseCycle: arm.phaseCycle,
		providerEffect,
		namedToolRef,
		maxOutputTokens,
		attempt: pending.attempt,
		logicalRequestDigest: pending.logicalRequestDigest,
		requestDigest,
		admissionDigest: empiricalStrictJsonDigest(admissionMaterial),
		planDigest: state.plan.planDigest,
		policyDigest: state.policy.policyDigest,
		modelRef: state.policy.model.modelRef,
		providerRef: state.policy.provider.providerRef,
		endpointProtocol: state.policy.provider.endpointProtocol,
		namedToolChoiceEncoding: state.policy.provider.namedToolChoiceEncoding,
		taskEnvelopeDigest: state.policy.campaign.taskEnvelopeDigest,
		retainsInspectionSpan,
		providerReservationMicrousd: providerEffect
			? state.policy.campaign.providerReservationMicrousd
			: 0,
		providerDeadlineMs: providerEffect ? state.policy.provider.providerDeadlineMs : 0,
		elapsedReservationMs: providerEffect
			? state.policy.provider.providerDeadlineMs
			: state.policy.campaign.localEffectReservationMs,
		publicSemanticScenarioSetDigest:
			pending.kind === "public-semantic-validation"
				? state.policy.campaign.publicSemanticScenarioSetDigest
				: null,
	});
	return Object.freeze({ ...material, effectDigest: empiricalStrictJsonDigest(material) });
}

export function takeD43AdmittedEffect(
	authority: D43GraphHarnessAuthorityV1,
): D43AdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D43 active effect has not been reconciled");
	if (state.finished) return null;
	const pending = state.pending;
	if (pending === null) throw new TypeError("D43 Graph has no derived next effect");
	const effect = effectFromPending(state, pending);
	emit(
		state,
		fact({
			schemaVersion: D43_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "effect-admitted",
			effect,
		}),
	);
	const admitted = state.active as D43AdmittedEffectV1 | null;
	if (admitted === null || admitted.effectDigest !== effect.effectDigest)
		throw new TypeError("D43 Graph did not project the admitted effect");
	effectOwners.set(admitted, authority as object);
	return admitted;
}

function validateUsage(value: unknown): D43UsageV1 {
	const candidate = record(value, "D43 result.usage");
	exactKeys(candidate, ["cacheReadTokens", "inputTokens", "outputTokens"], "D43 result.usage");
	return Object.freeze({
		inputTokens: safeInteger(candidate.inputTokens, "D43 result.usage.inputTokens", {
			max: 10_000_000,
		}),
		outputTokens: safeInteger(candidate.outputTokens, "D43 result.usage.outputTokens", {
			max: 1_000_000,
		}),
		cacheReadTokens: safeInteger(candidate.cacheReadTokens, "D43 result.usage.cacheReadTokens", {
			max: 10_000_000,
		}),
	});
}

function validateCriteria(
	value: unknown,
	effect: D43AdmittedEffectV1,
): D43PublicSemanticCriteriaV1 {
	const candidate = record(value, "D43 result.criteria");
	exactKeys(candidate, ["observations", "scenarioSetDigest"], "D43 result.criteria");
	const scenarioSetDigest = digest(
		candidate.scenarioSetDigest,
		"D43 result.criteria.scenarioSetDigest",
	);
	if (
		effect.publicSemanticScenarioSetDigest === null ||
		scenarioSetDigest !== effect.publicSemanticScenarioSetDigest
	)
		throw new TypeError("D43 public semantic scenario set lost Graph admission");
	const criteria = [
		"actor-visible-behavior-changed",
		"acceptance-criteria-satisfied",
		"scope-preserved",
		"regression-free",
	] as const;
	const observations = array(candidate.observations, "D43 result.criteria.observations").map(
		(value, index) => {
			const observation = record(value, `D43 result.criteria.observations[${index}]`);
			exactKeys(
				observation,
				[
					"criterion",
					"freshnessDigest",
					"observationDigest",
					"passed",
					"scenarioDigest",
					"scenarioRef",
				],
				`D43 result.criteria.observations[${index}]`,
			);
			if (observation.criterion !== criteria[index])
				throw new TypeError("D43 public semantic criterion order drifted");
			return Object.freeze({
				criterion: criteria[index]!,
				scenarioRef: coordinate(
					observation.scenarioRef,
					`D43 result.criteria.observations[${index}].scenarioRef`,
				),
				scenarioDigest: digest(
					observation.scenarioDigest,
					`D43 result.criteria.observations[${index}].scenarioDigest`,
				),
				observationDigest: digest(
					observation.observationDigest,
					`D43 result.criteria.observations[${index}].observationDigest`,
				),
				freshnessDigest: digest(
					observation.freshnessDigest,
					`D43 result.criteria.observations[${index}].freshnessDigest`,
				),
				passed: boolean(observation.passed, `D43 result.criteria.observations[${index}].passed`),
			});
		},
	);
	if (observations.length !== criteria.length)
		throw new TypeError("D43 public semantic observation cardinality drifted");
	const expectedFreshnessDigest = empiricalStrictJsonDigest({
		requestDigest: effect.requestDigest,
		sequence: effect.sequence,
	});
	if (observations.some((observation) => observation.freshnessDigest !== expectedFreshnessDigest))
		throw new TypeError("D43 public semantic observation freshness drifted");
	const describedScenarios = observations.map(({ criterion, scenarioRef, scenarioDigest }) => ({
		criterion,
		scenarioRef,
		scenarioDigest,
	}));
	if (empiricalStrictJsonDigest(describedScenarios) !== scenarioSetDigest)
		throw new TypeError("D43 public semantic observations changed the admitted scenario set");
	return Object.freeze({ scenarioSetDigest, observations: Object.freeze(observations) });
}

function allowedOutcomes(kind: D43EffectKind): readonly D43ResultOutcome[] {
	if (kind === "inspection")
		return [
			"success",
			"wrong-tool",
			"premature-final",
			"length",
			"schema-rejected",
			"provider-rejected",
			"transport-failed",
			"retryable-provider-failure",
			"executor-failed",
		];
	if (kind === "mutation")
		return [
			"success",
			"wrong-tool",
			"premature-final",
			"length",
			"schema-rejected",
			"replacement-not-found",
			"replacement-not-unique",
			"replacement-unchanged",
			"provider-rejected",
			"transport-failed",
			"retryable-provider-failure",
			"executor-failed",
		];
	if (
		kind === "focused-validation" ||
		kind === "public-semantic-validation" ||
		kind === "hidden-verifier"
	)
		return ["passed", "failed", "executor-failed"];
	if (kind === "workspace-diff") return ["success", "wrong-scope", "executor-failed"];
	return ["success", "executor-failed"];
}

function validateResult(
	state: AuthorityState,
	effect: D43AdmittedEffectV1,
	value: unknown,
): D43EffectResultV1 {
	const candidate = record(value, "D43 result");
	exactKeys(
		candidate,
		["costMicrousd", "criteria", "elapsedMs", "outcome", "retryClass", "usage", "wireDigest"],
		"D43 result",
	);
	const outcome = oneOf(candidate.outcome, allowedOutcomes(effect.kind), "D43 result.outcome");
	const elapsedMs = safeInteger(candidate.elapsedMs, "D43 result.elapsedMs", {
		max: effect.elapsedReservationMs,
	});
	const costMicrousd = safeInteger(candidate.costMicrousd, "D43 result.costMicrousd", {
		max: effect.providerEffect ? effect.providerReservationMicrousd : 0,
	});
	const usage = candidate.usage === null ? null : validateUsage(candidate.usage);
	const wireDigest =
		candidate.wireDigest === null ? null : digest(candidate.wireDigest, "D43 result.wireDigest");
	const retryClass =
		candidate.retryClass === null
			? null
			: oneOf(candidate.retryClass, ["D671", "D675", "D710"] as const, "D43 result.retryClass");
	const criteria =
		candidate.criteria === null ? null : validateCriteria(candidate.criteria, effect);
	if (effect.providerEffect) {
		const usageMayBeUnavailable =
			outcome === "provider-rejected" ||
			outcome === "transport-failed" ||
			outcome === "retryable-provider-failure" ||
			outcome === "executor-failed";
		if (
			(!usageMayBeUnavailable && usage === null) ||
			(outcome !== "executor-failed" && wireDigest === null) ||
			criteria !== null
		)
			throw new TypeError("D43 provider result shape drifted");
		const prior = state.wireByLogicalRequest.get(effect.logicalRequestDigest);
		if (prior !== undefined && prior !== wireDigest)
			throw new TypeError("D43 same-logical-request wire identity drifted");
	} else if (usage !== null || wireDigest !== null || retryClass !== null || costMicrousd !== 0) {
		throw new TypeError("D43 local effect supplied provider accounting");
	}
	if ((outcome === "retryable-provider-failure") !== (retryClass !== null))
		throw new TypeError("D43 retry proposal classification drifted");
	if (effect.kind === "public-semantic-validation") {
		if (criteria === null) throw new TypeError("D43 public semantic result omitted criteria");
		const allPassed = criteria.observations.every((entry) => entry.passed);
		if ((outcome === "passed") !== allPassed)
			throw new TypeError("D43 public semantic disposition disagrees with criteria");
	} else if (criteria !== null) {
		throw new TypeError("D43 non-public effect supplied semantic criteria");
	}
	const conservative =
		outcome === "provider-rejected" ||
		outcome === "transport-failed" ||
		outcome === "retryable-provider-failure" ||
		(effect.providerEffect && outcome === "executor-failed")
			? Math.max(costMicrousd, effect.providerReservationMicrousd)
			: costMicrousd;
	const reconciledElapsedMs =
		outcome === "executor-failed" ? effect.elapsedReservationMs : elapsedMs;
	const material = strictSnapshot({
		outcome,
		elapsedMs,
		costMicrousd,
		usage,
		wireDigest,
		retryClass,
		criteria,
		reconciledCostMicrousd: conservative,
		reconciledElapsedMs,
	});
	return Object.freeze({ ...material, resultDigest: empiricalStrictJsonDigest(material) });
}

export function admitD43EffectResult(
	authority: D43GraphHarnessAuthorityV1,
	effect: D43AdmittedEffectV1,
	resultValue: D43EffectResultInputV1,
): void {
	const state = stateFor(authority);
	const owner = effectOwners.get(effect as object);
	if (state.active !== effect || owner !== (authority as object))
		throw new TypeError("D43 effect is forged, substituted, or replayed");
	const result = validateResult(state, effect, resultValue);
	emit(
		state,
		fact({
			schemaVersion: D43_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "effect-result",
			effectDigest: effect.effectDigest,
			requestDigest: effect.requestDigest,
			admissionDigest: effect.admissionDigest,
			logicalRequestDigest: effect.logicalRequestDigest,
			result,
		}),
	);
	effectOwners.delete(effect as object);
}

function armProjection(value: MutableArmState): D43ArmProjectionV1 {
	return Object.freeze({
		arm: value.arm,
		completed: value.completed,
		cleanupCompleted: value.cleanupCompleted,
		evaluable: value.evaluable,
		hiddenVerifierPassed: value.hiddenVerifierPassed,
		inspectionCorrections: value.inspectionCorrections,
		mutationCorrections: value.mutationCorrections,
		exactReplacementRecoveries: value.exactReplacementRecoveries,
		semanticCorrections: value.semanticCorrections,
		providerAttempts: value.providerAttempts,
		findingCount: value.findingCount,
	});
}

function gateWouldPass(
	arms: readonly D43ArmProjectionV1[],
	budget: D43BudgetProjectionV1,
	campaign: D43ModelHarnessPolicyV1["campaign"],
): boolean {
	return (
		budget.providerAttempts <= campaign.maxProviderAttempts &&
		budget.confirmedCostMicrousd <= campaign.maxCostMicrousd &&
		budget.confirmedElapsedMs <= campaign.maxElapsedMs &&
		arms.length === D43_ARMS.length &&
		arms.every((arm) => arm.completed && arm.cleanupCompleted && arm.evaluable) &&
		arms.find((arm) => arm.arm === "relevant-applied")?.hiddenVerifierPassed === true &&
		arms
			.filter((arm) => arm.arm !== "relevant-applied")
			.every((arm) => arm.hiddenVerifierPassed === false)
	);
}

export function snapshotD43GraphHarnessEvidence(
	authority: D43GraphHarnessAuthorityV1,
): D43GraphHarnessEvidenceV1 {
	const state = stateFor(authority);
	if (!state.finished || state.active !== null || state.pending !== null)
		throw new TypeError("D43 Graph harness evidence is unfinished");
	const arms = Object.freeze(state.arms.map(armProjection));
	const material = strictSnapshot({
		schemaVersion: D43_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D43" as const,
		authorityRevision: D43_AUTHORITY_REVISION,
		policy: state.policy,
		plan: state.plan,
		facts: state.facts,
		findings: state.findings,
		arms,
		budget: state.budget,
		exactSixArmsCompleted: arms.every((arm) => arm.completed && arm.cleanupCompleted),
		maxActiveEffectsObserved: 1 as const,
		liveGateEvaluated: false as const,
		frozenGateWouldPass: gateWouldPass(arms, state.budget, state.policy.campaign),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export async function runD43GraphHarness(input: {
	readonly catalog: D43PolicyCatalogV1;
	readonly assignment: {
		readonly assignmentRef: string;
		readonly modelRef: string;
		readonly providerRef: string;
		readonly campaignRef: string;
	};
	readonly execute: (effect: D43AdmittedEffectV1) => Promise<D43EffectResultInputV1>;
}): Promise<D43GraphHarnessEvidenceV1> {
	if (typeof input.execute !== "function") throw new TypeError("D43 executor is invalid");
	const authority = createD43GraphHarnessAuthority({
		catalog: input.catalog,
		assignment: input.assignment,
	});
	for (let guard = 0; guard < 1_024; guard += 1) {
		const effect = takeD43AdmittedEffect(authority);
		if (effect === null) return snapshotD43GraphHarnessEvidence(authority);
		let result: D43EffectResultInputV1;
		try {
			result = await input.execute(effect);
		} catch {
			result = Object.freeze({
				outcome: "executor-failed",
				elapsedMs: 0,
				costMicrousd: 0,
				usage: null,
				wireDigest: null,
				retryClass: null,
				criteria: null,
			});
		}
		admitD43EffectResult(authority, effect, result);
	}
	throw new TypeError("D43 Graph harness exceeded its effect bound");
}

export function validateD43GraphHarnessEvidence(value: unknown): D43GraphHarnessEvidenceV1 {
	const candidate = record(value, "D43 evidence");
	exactKeys(
		candidate,
		[
			"arms",
			"authorityRevision",
			"budget",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"exactSixArmsCompleted",
			"facts",
			"findings",
			"frozenGateWouldPass",
			"liveGateEvaluated",
			"maxActiveEffectsObserved",
			"plan",
			"policy",
			"schemaVersion",
		],
		"D43 evidence",
	);
	if (
		candidate.schemaVersion !== D43_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D43" ||
		candidate.authorityRevision !== D43_AUTHORITY_REVISION ||
		candidate.maxActiveEffectsObserved !== 1 ||
		candidate.liveGateEvaluated !== false ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D43 evidence coordinates drifted");
	const policy = validateD43ModelHarnessPolicy(candidate.policy);
	const budgetCandidate = record(candidate.budget, "D43 evidence.budget");
	exactKeys(
		budgetCandidate,
		["confirmedCostMicrousd", "confirmedElapsedMs", "effectResults", "providerAttempts"],
		"D43 evidence.budget",
	);
	const budget = Object.freeze({
		providerAttempts: safeInteger(
			budgetCandidate.providerAttempts,
			"D43 evidence.budget.providerAttempts",
		),
		confirmedCostMicrousd: safeInteger(
			budgetCandidate.confirmedCostMicrousd,
			"D43 evidence.budget.confirmedCostMicrousd",
		),
		confirmedElapsedMs: safeInteger(
			budgetCandidate.confirmedElapsedMs,
			"D43 evidence.budget.confirmedElapsedMs",
		),
		effectResults: safeInteger(budgetCandidate.effectResults, "D43 evidence.budget.effectResults"),
	});
	const facts = array(candidate.facts, "D43 evidence.facts") as readonly D43FactV1[];
	if (facts.length < 1 || facts.some((entry, index) => entry.sequence !== index + 1))
		throw new TypeError("D43 evidence fact sequence drifted");
	for (const entry of facts) {
		const { factDigest, ...material } = entry;
		if (digest(factDigest, "D43 fact digest") !== empiricalStrictJsonDigest(material))
			throw new TypeError("D43 evidence fact digest drifted");
	}
	const arms = array(candidate.arms, "D43 evidence.arms") as readonly D43ArmProjectionV1[];
	if (
		arms.length !== D43_ARMS.length ||
		arms.some((arm, index) => arm.arm !== D43_ARMS[index]) ||
		boolean(candidate.exactSixArmsCompleted, "D43 exactSixArmsCompleted") !==
			arms.every((arm) => arm.completed && arm.cleanupCompleted) ||
		boolean(candidate.frozenGateWouldPass, "D43 frozenGateWouldPass") !==
			gateWouldPass(arms, budget, policy.campaign)
	)
		throw new TypeError("D43 evidence arm projection drifted");
	const { evidenceDigest, ...material } = candidate;
	if (digest(evidenceDigest, "D43 evidence.evidenceDigest") !== empiricalStrictJsonDigest(material))
		throw new TypeError("D43 evidence digest drifted");
	const replayed = replayD43Evidence(policy, candidate.plan as D43HarnessPlanV1, facts);
	if (replayed.evidenceDigest !== evidenceDigest)
		throw new TypeError("D43 canonical replay drifted");
	return replayed;
}

function replayD43Evidence(
	policy: D43ModelHarnessPolicyV1,
	plan: D43HarnessPlanV1,
	facts: readonly D43FactV1[],
): D43GraphHarnessEvidenceV1 {
	const catalog = createD43PolicyCatalog([policy]);
	const authority = createD43GraphHarnessAuthority({
		catalog,
		assignment: {
			assignmentRef: plan.assignmentRef,
			modelRef: plan.modelRef,
			providerRef: plan.providerRef,
			campaignRef: plan.campaignRef,
		},
	});
	const createdState = stateFor(authority);
	if (
		facts[0]?.factKind !== "plan-selected" ||
		createdState.facts[0]?.factDigest !== facts[0].factDigest
	)
		throw new TypeError("D43 canonical replay plan drifted");
	let index = 1;
	for (;;) {
		const admitted = takeD43AdmittedEffect(authority);
		if (admitted === null) break;
		const admissionFact = facts[index++];
		const resultFact = facts[index++];
		if (
			admissionFact?.factKind !== "effect-admitted" ||
			admissionFact.effect.effectDigest !== admitted.effectDigest ||
			resultFact?.factKind !== "effect-result" ||
			resultFact.effectDigest !== admitted.effectDigest
		)
			throw new TypeError("D43 canonical replay effect binding drifted");
		const {
			reconciledCostMicrousd: _reconciled,
			reconciledElapsedMs: _reconciledElapsed,
			resultDigest: _digest,
			...result
		} = resultFact.result;
		admitD43EffectResult(authority, admitted, result);
		const replayedFacts = stateFor(authority).facts;
		if (
			replayedFacts[index - 2]?.factDigest !== admissionFact.factDigest ||
			replayedFacts[index - 1]?.factDigest !== resultFact.factDigest
		)
			throw new TypeError("D43 canonical replay fact drifted");
	}
	if (index !== facts.length) throw new TypeError("D43 canonical replay left extra facts");
	return snapshotD43GraphHarnessEvidence(authority);
}
