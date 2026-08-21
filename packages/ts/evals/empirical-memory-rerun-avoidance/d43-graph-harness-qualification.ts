import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	admitD43EffectResult,
	createD43GraphHarnessAuthority,
	D43_RESULT_OUTCOMES,
	type D43AdmittedEffectV1,
	type D43EffectResultInputV1,
	type D43GraphHarnessEvidenceV1,
	runD43GraphHarness,
	snapshotD43GraphHarnessEvidence,
	takeD43AdmittedEffect,
	validateD43GraphHarnessEvidence,
} from "./d43-graph-harness-authority.js";
import { lowerD43ProviderEffect } from "./d43-mechanical-provider-adapter.js";
import {
	createD43ModelHarnessPolicy,
	createD43PolicyCatalog,
	createD43QualificationPolicy,
	D43_ARMS,
	D43_ENHANCEMENT_RECIPES,
	D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
	D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIOS,
	resolveD43HarnessPlan,
} from "./d43-model-harness-policy.js";

export const D43_QUALIFICATION_SCHEMA = "graphrefly-ts.d43.graph-harness-qualification.v1" as const;
export const D43_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d43.graph-harness-qualification-bundle.v1" as const;
export const D43_QUALIFICATION_GENERATION_REF =
	"current-graph-native-model-policy-no-network-2026-08-20-d43-v2" as const;

const ASSIGNMENT = Object.freeze({
	assignmentRef: "assignment.deepseek-deepinfra.d43-qualification",
	modelRef: "deepseek/deepseek-v4-flash-0731",
	providerRef: "deepinfra/fp8/chat",
	campaignRef: "campaign.memory-rerun-avoidance.six-arm.d43-v1",
});

export interface D43QualificationBundleV1 {
	readonly schemaVersion: typeof D43_QUALIFICATION_BUNDLE_SCHEMA;
	readonly mainEvidence: D43GraphHarnessEvidenceV1;
	readonly phaseRecoveryEvidence: D43GraphHarnessEvidenceV1;
	readonly exactAndSemanticRecoveryEvidence: D43GraphHarnessEvidenceV1;
	readonly infrastructureFailureEvidence: D43GraphHarnessEvidenceV1;
	readonly headroomEvidence: D43GraphHarnessEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D43_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D43";
		readonly policyDigest: string;
		readonly planDigest: string;
		readonly mainEvidenceDigest: string;
		readonly phaseRecoveryEvidenceDigest: string;
		readonly exactAndSemanticRecoveryEvidenceDigest: string;
		readonly infrastructureFailureEvidenceDigest: string;
		readonly headroomEvidenceDigest: string;
		readonly automaticallyResolvedPolicy: true;
		readonly humanRuntimeApprovals: 0;
		readonly exactSixArmScenarios: 5;
		readonly maxActiveEffectsObserved: 1;
		readonly coldCensoredWarm: false;
		readonly mainFrozenGateWouldPass: true;
		readonly allKnownFailureOutcomesObserved: true;
		readonly observedResultOutcomes: readonly string[];
		readonly observedFindingCauseCodes: readonly string[];
		readonly exactRetryWireIdentity: true;
		readonly replayRejected: true;
		readonly substitutionRejected: true;
		readonly unknownAssignmentRejected: true;
		readonly profileMutationIsolated: true;
		readonly conservativeReservationObserved: true;
		readonly publicSemanticCriteriaMaterialFree: true;
		readonly historicalRuntimeDependencies: 0;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface D43QualificationPersistenceReceiptV1 {
	readonly generationRef: typeof D43_QUALIFICATION_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
}

function wireDigest(effect: D43AdmittedEffectV1): string {
	return lowerD43ProviderEffect(effect).wireDigest;
}

function providerResult(
	effect: D43AdmittedEffectV1,
	outcome: D43EffectResultInputV1["outcome"] = "success",
	retryClass: D43EffectResultInputV1["retryClass"] = null,
): D43EffectResultInputV1 {
	const usageUnavailable =
		outcome === "provider-rejected" ||
		outcome === "transport-failed" ||
		outcome === "retryable-provider-failure";
	return Object.freeze({
		outcome,
		elapsedMs: 10,
		costMicrousd:
			outcome === "provider-rejected" ||
			outcome === "transport-failed" ||
			outcome === "retryable-provider-failure"
				? 0
				: 10,
		usage: usageUnavailable
			? null
			: Object.freeze({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 }),
		wireDigest: wireDigest(effect),
		retryClass,
		criteria: null,
	});
}

function localResult(
	outcome: D43EffectResultInputV1["outcome"],
	criteria: D43EffectResultInputV1["criteria"] = null,
): D43EffectResultInputV1 {
	return Object.freeze({
		outcome,
		elapsedMs: 1,
		costMicrousd: 0,
		usage: null,
		wireDigest: null,
		retryClass: null,
		criteria,
	});
}

function semanticCriteria(
	effect: D43AdmittedEffectV1,
	failingCriterion:
		| (typeof D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIOS)[number]["criterion"]
		| null,
): NonNullable<D43EffectResultInputV1["criteria"]> {
	if (
		effect.publicSemanticScenarioSetDigest !== D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST
	)
		throw new TypeError("D43 semantic scenario set was not admitted by Graph");
	return Object.freeze({
		scenarioSetDigest: D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
		observations: Object.freeze(
			D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIOS.map((scenario) => {
				const passed = scenario.criterion !== failingCriterion;
				return Object.freeze({
					criterion: scenario.criterion,
					scenarioRef: scenario.scenarioRef,
					scenarioDigest: scenario.scenarioDigest,
					observationDigest: empiricalStrictJsonDigest({
						arm: effect.arm,
						phaseCycle: effect.phaseCycle,
						scenarioDigest: scenario.scenarioDigest,
						passed,
					}),
					freshnessDigest: empiricalStrictJsonDigest({
						requestDigest: effect.requestDigest,
						sequence: effect.sequence,
					}),
					passed,
				});
			}),
		),
	});
}

function successfulResult(effect: D43AdmittedEffectV1): D43EffectResultInputV1 {
	if (effect.providerEffect) return providerResult(effect);
	if (effect.kind === "focused-validation") return localResult("passed");
	if (effect.kind === "public-semantic-validation")
		return localResult("passed", semanticCriteria(effect, null));
	if (effect.kind === "hidden-verifier")
		return localResult(effect.arm === "relevant-applied" ? "passed" : "failed");
	return localResult("success");
}

function scenarioCatalog(maxCostMicrousd = 6_000_000) {
	const base = createD43QualificationPolicy();
	if (maxCostMicrousd === base.campaign.maxCostMicrousd) return createD43PolicyCatalog([base]);
	const policy = createD43ModelHarnessPolicy({
		policyRef: `${base.policyRef}.headroom-${maxCostMicrousd}`,
		model: {
			profileRef: base.model.profileRef,
			modelRef: base.model.modelRef,
			supportsNamedToolChoice: true,
			supportsParallelToolCalls: base.model.supportsParallelToolCalls,
			inspectionMaxOutputTokens: base.model.inspectionMaxOutputTokens,
			mutationMaxOutputTokens: base.model.mutationMaxOutputTokens,
		},
		provider: {
			bindingRef: base.provider.bindingRef,
			providerRef: base.provider.providerRef,
			endpointProtocol: base.provider.endpointProtocol,
			namedToolChoiceEncoding: base.provider.namedToolChoiceEncoding,
			allowFallback: false,
			allowProviderSwitch: false,
			allowParallelEffects: false,
			providerDeadlineMs: base.provider.providerDeadlineMs,
		},
		campaign: {
			campaignRef: base.campaign.campaignRef,
			arms: D43_ARMS,
			maxProviderAttempts: base.campaign.maxProviderAttempts,
			maxCostMicrousd,
			maxElapsedMs: base.campaign.maxElapsedMs,
			localEffectReservationMs: base.campaign.localEffectReservationMs,
			providerReservationMicrousd: base.campaign.providerReservationMicrousd,
			publicSemanticScenarioSetDigest: base.campaign.publicSemanticScenarioSetDigest,
			taskEnvelopeDigest: base.campaign.taskEnvelopeDigest,
			maxSameLogicalRequestRetries: 1,
			retryClasses: ["D671", "D675", "D710"],
		},
		enhancementRecipes: D43_ENHANCEMENT_RECIPES,
	});
	return createD43PolicyCatalog([policy]);
}

async function runScenario(
	execute: (effect: D43AdmittedEffectV1) => D43EffectResultInputV1,
	maxCostMicrousd = 6_000_000,
): Promise<D43GraphHarnessEvidenceV1> {
	return validateD43GraphHarnessEvidence(
		await runD43GraphHarness({
			catalog: scenarioCatalog(maxCostMicrousd),
			assignment: ASSIGNMENT,
			execute: async (effect) => execute(effect),
		}),
	);
}

async function runMainScenario(): Promise<D43GraphHarnessEvidenceV1> {
	return runScenario(successfulResult);
}

async function runPhaseRecoveryScenario(): Promise<D43GraphHarnessEvidenceV1> {
	return runScenario((effect) => {
		if (effect.arm === "cold" && effect.kind === "inspection" && effect.intent === "initial")
			return providerResult(effect, "wrong-tool");
		if (
			effect.arm === "relevant-applied" &&
			effect.kind === "inspection" &&
			effect.intent === "initial"
		)
			return providerResult(effect, "premature-final");
		if (effect.arm === "proposal-only" && effect.kind === "mutation" && effect.intent === "initial")
			return providerResult(effect, "length");
		if (
			effect.arm === "admission-rejected" &&
			effect.kind === "mutation" &&
			effect.intent === "initial"
		)
			return providerResult(effect, "schema-rejected");
		if (
			effect.arm === "irrelevant-applied" &&
			effect.kind === "mutation" &&
			effect.intent === "initial"
		)
			return providerResult(effect, "replacement-not-found");
		if (
			effect.arm === "wrong-scope-applied" &&
			effect.kind === "workspace-diff" &&
			effect.phaseCycle === 0
		)
			return localResult("wrong-scope");
		return successfulResult(effect);
	});
}

async function runExactAndSemanticRecoveryScenario(): Promise<D43GraphHarnessEvidenceV1> {
	return runScenario((effect) => {
		if (effect.arm === "cold" && effect.kind === "mutation" && effect.intent === "initial")
			return providerResult(effect, "replacement-not-unique");
		if (
			effect.arm === "relevant-applied" &&
			effect.kind === "mutation" &&
			effect.intent === "initial"
		)
			return providerResult(effect, "replacement-unchanged");
		if (
			effect.arm === "proposal-only" &&
			effect.kind === "focused-validation" &&
			effect.phaseCycle === 0
		)
			return localResult("failed");
		if (
			effect.arm === "admission-rejected" &&
			effect.kind === "public-semantic-validation" &&
			effect.phaseCycle === 0
		)
			return localResult("failed", semanticCriteria(effect, "scope-preserved"));
		if (effect.arm === "irrelevant-applied" && effect.kind === "mutation" && effect.attempt === 0)
			return providerResult(effect, "retryable-provider-failure", "D710");
		return successfulResult(effect);
	});
}

async function runInfrastructureFailureScenario(): Promise<D43GraphHarnessEvidenceV1> {
	return runScenario((effect) => {
		if (effect.arm === "cold" && effect.kind === "inspection")
			return providerResult(effect, "provider-rejected");
		if (effect.arm === "relevant-applied" && effect.kind === "inspection")
			return providerResult(effect, "transport-failed");
		if (effect.arm === "proposal-only" && effect.kind === "materialization")
			throw new TypeError("injected executor boundary failure must not persist");
		if (effect.arm === "admission-rejected" && effect.kind === "mutation")
			return providerResult(effect, "wrong-tool");
		if (effect.arm === "irrelevant-applied" && effect.kind === "mutation")
			return providerResult(effect, "replacement-not-found");
		if (effect.arm === "wrong-scope-applied" && effect.kind === "public-semantic-validation")
			return localResult("failed", semanticCriteria(effect, "scope-preserved"));
		return successfulResult(effect);
	});
}

async function runHeadroomScenario(): Promise<D43GraphHarnessEvidenceV1> {
	return runScenario(
		(effect) =>
			effect.providerEffect ? providerResult(effect, "transport-failed") : successfulResult(effect),
		100_000,
	);
}

function resultOutcomes(evidences: readonly D43GraphHarnessEvidenceV1[]): readonly string[] {
	return Object.freeze(
		[
			...new Set(
				evidences.flatMap((evidence) =>
					evidence.facts.flatMap((entry) =>
						entry.factKind === "effect-result" ? [entry.result.outcome] : [],
					),
				),
			),
		].sort(),
	);
}

function findingCodes(evidences: readonly D43GraphHarnessEvidenceV1[]): readonly string[] {
	return Object.freeze(
		[
			...new Set(evidences.flatMap((evidence) => evidence.findings.map((item) => item.causeCode))),
		].sort(),
	);
}

function hasExactRetryWireIdentity(evidences: readonly D43GraphHarnessEvidenceV1[]): boolean {
	const retryGroups = new Map<string, string[]>();
	for (const evidence of evidences) {
		for (const entry of evidence.facts) {
			if (entry.factKind !== "effect-result" || entry.result.wireDigest === null) continue;
			const values = retryGroups.get(entry.logicalRequestDigest) ?? [];
			values.push(entry.result.wireDigest);
			retryGroups.set(entry.logicalRequestDigest, values);
		}
	}
	return [...retryGroups.values()].some((values) => values.length === 2 && values[0] === values[1]);
}

function verifyAuthorityGuards(): Readonly<{
	replayRejected: true;
	substitutionRejected: true;
}> {
	const catalog = scenarioCatalog();
	const authority = createD43GraphHarnessAuthority({ catalog, assignment: ASSIGNMENT });
	const effect = takeD43AdmittedEffect(authority)!;
	let substitutionRejected = false;
	try {
		admitD43EffectResult(authority, { ...effect } as D43AdmittedEffectV1, localResult("success"));
	} catch {
		substitutionRejected = true;
	}
	if (!substitutionRejected) throw new TypeError("D43 effect substitution was accepted");
	admitD43EffectResult(authority, effect, localResult("success"));
	let replayRejected = false;
	try {
		admitD43EffectResult(authority, effect, localResult("success"));
	} catch {
		replayRejected = true;
	}
	if (!replayRejected) throw new TypeError("D43 effect replay was accepted");
	return Object.freeze({ replayRejected: true, substitutionRejected: true });
}

function verifyPolicyGuards(): Readonly<{
	unknownAssignmentRejected: true;
	profileMutationIsolated: true;
}> {
	const mutable = {
		policyRef: "policy.mutation-isolation.d43",
		model: {
			profileRef: "model-profile.mutation-isolation.d43",
			modelRef: ASSIGNMENT.modelRef,
			supportsNamedToolChoice: true as const,
			supportsParallelToolCalls: false,
			inspectionMaxOutputTokens: 65_536,
			mutationMaxOutputTokens: 8_192,
		},
		provider: {
			bindingRef: "provider-binding.mutation-isolation.d43",
			providerRef: ASSIGNMENT.providerRef,
			endpointProtocol: "chat-completions" as const,
			namedToolChoiceEncoding: "function-object" as const,
			allowFallback: false as const,
			allowProviderSwitch: false as const,
			allowParallelEffects: false as const,
			providerDeadlineMs: 120_000,
		},
		campaign: {
			campaignRef: ASSIGNMENT.campaignRef,
			arms: D43_ARMS,
			maxProviderAttempts: 96,
			maxCostMicrousd: 6_000_000,
			maxElapsedMs: 7_200_000,
			localEffectReservationMs: 10_000,
			providerReservationMicrousd: 100_000,
			publicSemanticScenarioSetDigest: D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
			taskEnvelopeDigest: `sha256:${"b".repeat(64)}`,
			maxSameLogicalRequestRetries: 1 as const,
			retryClasses: ["D671", "D675", "D710"] as const,
		},
		enhancementRecipes: [...D43_ENHANCEMENT_RECIPES],
	};
	const policy = createD43ModelHarnessPolicy(mutable);
	const catalog = createD43PolicyCatalog([policy]);
	const before = resolveD43HarnessPlan(catalog, ASSIGNMENT);
	mutable.model.mutationMaxOutputTokens = 1;
	mutable.enhancementRecipes.length = 0;
	const after = resolveD43HarnessPlan(catalog, ASSIGNMENT);
	if (before.planDigest !== after.planDigest)
		throw new TypeError("D43 admitted policy retained caller mutability");
	let unknownAssignmentRejected = false;
	try {
		resolveD43HarnessPlan(catalog, { ...ASSIGNMENT, modelRef: "unknown/model" });
	} catch {
		unknownAssignmentRejected = true;
	}
	if (!unknownAssignmentRejected) throw new TypeError("D43 unknown assignment was accepted");
	return Object.freeze({ unknownAssignmentRejected: true, profileMutationIsolated: true });
}

export async function runD43InjectedNoNetworkQualification(): Promise<D43QualificationBundleV1> {
	if (process.env.OPENROUTER_API_KEY !== undefined)
		throw new TypeError("D43 no-network qualification refuses provider credentials");
	const policy = createD43QualificationPolicy();
	const catalog = createD43PolicyCatalog([policy]);
	const plan = resolveD43HarnessPlan(catalog, ASSIGNMENT);
	const [
		mainEvidence,
		phaseRecoveryEvidence,
		exactAndSemanticRecoveryEvidence,
		infrastructureFailureEvidence,
		headroomEvidence,
	] = await Promise.all([
		runMainScenario(),
		runPhaseRecoveryScenario(),
		runExactAndSemanticRecoveryScenario(),
		runInfrastructureFailureScenario(),
		runHeadroomScenario(),
	]);
	const evidences = [
		mainEvidence,
		phaseRecoveryEvidence,
		exactAndSemanticRecoveryEvidence,
		infrastructureFailureEvidence,
		headroomEvidence,
	] as const;
	if (!evidences.every((evidence) => evidence.exactSixArmsCompleted))
		throw new TypeError("D43 qualification did not complete every six-arm scenario");
	if (!mainEvidence.frozenGateWouldPass)
		throw new TypeError("D43 happy-path topology cannot reach the frozen gate");
	const observedResultOutcomes = resultOutcomes(evidences);
	if (!D43_RESULT_OUTCOMES.every((outcome) => observedResultOutcomes.includes(outcome)))
		throw new TypeError("D43 qualification missed a known result outcome");
	const observedFindingCauseCodes = findingCodes(evidences);
	if (!hasExactRetryWireIdentity(evidences))
		throw new TypeError("D43 qualification missed exact mechanical retry wire identity");
	const authorityGuards = verifyAuthorityGuards();
	const policyGuards = verifyPolicyGuards();
	const conservativeReservationObserved = evidences.some((evidence) =>
		evidence.facts.some(
			(entry) =>
				entry.factKind === "effect-result" &&
				entry.result.costMicrousd === 0 &&
				entry.result.reconciledCostMicrousd > 0,
		),
	);
	if (!conservativeReservationObserved)
		throw new TypeError("D43 qualification missed conservative reservation accounting");
	const material = strictSnapshot({
		schemaVersion: D43_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D43" as const,
		policyDigest: policy.policyDigest,
		planDigest: plan.planDigest,
		mainEvidenceDigest: mainEvidence.evidenceDigest,
		phaseRecoveryEvidenceDigest: phaseRecoveryEvidence.evidenceDigest,
		exactAndSemanticRecoveryEvidenceDigest: exactAndSemanticRecoveryEvidence.evidenceDigest,
		infrastructureFailureEvidenceDigest: infrastructureFailureEvidence.evidenceDigest,
		headroomEvidenceDigest: headroomEvidence.evidenceDigest,
		automaticallyResolvedPolicy: true as const,
		humanRuntimeApprovals: 0 as const,
		exactSixArmScenarios: 5 as const,
		maxActiveEffectsObserved: 1 as const,
		coldCensoredWarm: false as const,
		mainFrozenGateWouldPass: true as const,
		allKnownFailureOutcomesObserved: true as const,
		observedResultOutcomes,
		observedFindingCauseCodes,
		exactRetryWireIdentity: true as const,
		...authorityGuards,
		...policyGuards,
		conservativeReservationObserved: true as const,
		publicSemanticCriteriaMaterialFree: true as const,
		historicalRuntimeDependencies: 0 as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D43_QUALIFICATION_BUNDLE_SCHEMA,
		mainEvidence,
		phaseRecoveryEvidence,
		exactAndSemanticRecoveryEvidence,
		infrastructureFailureEvidence,
		headroomEvidence,
		qualification,
	});
	return Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	});
}

export function validateD43QualificationBundle(value: unknown): D43QualificationBundleV1 {
	const candidate = record(value, "D43 qualification bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"exactAndSemanticRecoveryEvidence",
			"headroomEvidence",
			"infrastructureFailureEvidence",
			"mainEvidence",
			"phaseRecoveryEvidence",
			"qualification",
			"schemaVersion",
		],
		"D43 qualification bundle",
	);
	if (candidate.schemaVersion !== D43_QUALIFICATION_BUNDLE_SCHEMA)
		throw new TypeError("D43 qualification bundle schema drifted");
	const mainEvidence = validateD43GraphHarnessEvidence(candidate.mainEvidence);
	const phaseRecoveryEvidence = validateD43GraphHarnessEvidence(candidate.phaseRecoveryEvidence);
	const exactAndSemanticRecoveryEvidence = validateD43GraphHarnessEvidence(
		candidate.exactAndSemanticRecoveryEvidence,
	);
	const infrastructureFailureEvidence = validateD43GraphHarnessEvidence(
		candidate.infrastructureFailureEvidence,
	);
	const headroomEvidence = validateD43GraphHarnessEvidence(candidate.headroomEvidence);
	const qualification = record(candidate.qualification, "D43 qualification");
	exactKeys(
		qualification,
		[
			"allKnownFailureOutcomesObserved",
			"automaticallyResolvedPolicy",
			"causalAttribution",
			"coldCensoredWarm",
			"conservativeReservationObserved",
			"credentialReads",
			"decisionRef",
			"efficacyClaim",
			"exactAndSemanticRecoveryEvidenceDigest",
			"exactRetryWireIdentity",
			"exactSixArmScenarios",
			"headroomEvidenceDigest",
			"historicalRuntimeDependencies",
			"humanRuntimeApprovals",
			"infrastructureFailureEvidenceDigest",
			"liveGateEvaluated",
			"mainEvidenceDigest",
			"mainFrozenGateWouldPass",
			"maxActiveEffectsObserved",
			"observedFindingCauseCodes",
			"observedResultOutcomes",
			"phaseRecoveryEvidenceDigest",
			"planDigest",
			"policyDigest",
			"profileMutationIsolated",
			"providerNetworkCalls",
			"publicSemanticCriteriaMaterialFree",
			"qualificationDigest",
			"replayRejected",
			"schemaVersion",
			"substitutionRejected",
			"unknownAssignmentRejected",
		],
		"D43 qualification",
	);
	const observed = array(
		qualification.observedResultOutcomes,
		"D43 qualification.observedResultOutcomes",
	);
	const observedCodes = array(
		qualification.observedFindingCauseCodes,
		"D43 qualification.observedFindingCauseCodes",
	);
	const evidences = [
		mainEvidence,
		phaseRecoveryEvidence,
		exactAndSemanticRecoveryEvidence,
		infrastructureFailureEvidence,
		headroomEvidence,
	] as const;
	const allSixArmScenariosComplete = evidences.every((evidence) => evidence.exactSixArmsCompleted);
	const derivedOutcomes = resultOutcomes(evidences);
	const derivedCodes = findingCodes(evidences);
	const exactRetryWireIdentity = hasExactRetryWireIdentity(evidences);
	const conservativeReservationObserved = evidences.some((evidence) =>
		evidence.facts.some(
			(entry) =>
				entry.factKind === "effect-result" &&
				entry.result.costMicrousd === 0 &&
				entry.result.reconciledCostMicrousd > 0,
		),
	);
	const materialFree = !/(?:oldText|newText|rawBody|authorization|api[_-]?key)/iu.test(
		JSON.stringify(evidences),
	);
	if (
		qualification.schemaVersion !== D43_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== "graphrefly-ts:D43" ||
		qualification.policyDigest !== mainEvidence.policy.policyDigest ||
		qualification.planDigest !== mainEvidence.plan.planDigest ||
		qualification.mainEvidenceDigest !== mainEvidence.evidenceDigest ||
		qualification.phaseRecoveryEvidenceDigest !== phaseRecoveryEvidence.evidenceDigest ||
		qualification.exactAndSemanticRecoveryEvidenceDigest !==
			exactAndSemanticRecoveryEvidence.evidenceDigest ||
		qualification.infrastructureFailureEvidenceDigest !==
			infrastructureFailureEvidence.evidenceDigest ||
		qualification.headroomEvidenceDigest !== headroomEvidence.evidenceDigest ||
		mainEvidence.frozenGateWouldPass !== true ||
		!allSixArmScenariosComplete ||
		qualification.mainFrozenGateWouldPass !== true ||
		qualification.automaticallyResolvedPolicy !== true ||
		qualification.humanRuntimeApprovals !== 0 ||
		qualification.exactSixArmScenarios !== 5 ||
		qualification.maxActiveEffectsObserved !== 1 ||
		qualification.coldCensoredWarm !== false ||
		qualification.allKnownFailureOutcomesObserved !== true ||
		qualification.exactRetryWireIdentity !== exactRetryWireIdentity ||
		qualification.conservativeReservationObserved !== conservativeReservationObserved ||
		qualification.publicSemanticCriteriaMaterialFree !== materialFree ||
		qualification.replayRejected !== true ||
		qualification.substitutionRejected !== true ||
		qualification.unknownAssignmentRejected !== true ||
		qualification.profileMutationIsolated !== true ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.credentialReads !== 0 ||
		qualification.historicalRuntimeDependencies !== 0 ||
		qualification.efficacyClaim !== "none" ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		!D43_RESULT_OUTCOMES.every((outcome) => observed.includes(outcome)) ||
		JSON.stringify(observed) !== JSON.stringify(derivedOutcomes) ||
		JSON.stringify(observedCodes) !== JSON.stringify(derivedCodes)
	)
		throw new TypeError("D43 qualification coordinates drifted");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (
		digest(qualificationDigest, "D43 qualification.digest") !==
		empiricalStrictJsonDigest(qualificationMaterial)
	)
		throw new TypeError("D43 qualification digest drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (
		digest(bundleDigest, "D43 qualification bundle.digest") !==
		empiricalStrictJsonDigest(bundleMaterial)
	)
		throw new TypeError("D43 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D43QualificationBundleV1;
}

export async function persistD43Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D43QualificationBundleV1;
}): Promise<D43QualificationPersistenceReceiptV1> {
	if (!isAbsolute(input.privateRoot) || (await realpath(input.privateRoot)) !== input.privateRoot)
		throw new TypeError("D43 private root is not canonical");
	const validated = validateD43QualificationBundle(input.bundle);
	const finalRoot = join(input.privateRoot, D43_QUALIFICATION_GENERATION_REF);
	const stagingRoot = join(input.privateRoot, `.${D43_QUALIFICATION_GENERATION_REF}.staging`);
	await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
	const bundleBytes = strictJsonCodec.encode(validated);
	const commitMaterial = strictSnapshot({
		generationRef: D43_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		qualificationDigest: validated.qualification.qualificationDigest,
	});
	const commitBytes = strictJsonCodec.encode({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	let failed: unknown = null;
	try {
		const bundleHandle = await open(
			join(stagingRoot, "bundle.v1.json"),
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await bundleHandle.writeFile(bundleBytes);
			await bundleHandle.sync();
		} finally {
			await bundleHandle.close();
		}
		const commitHandle = await open(
			join(stagingRoot, "commit.v1.json"),
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await commitHandle.writeFile(commitBytes);
			await commitHandle.sync();
		} finally {
			await commitHandle.close();
		}
		await rename(stagingRoot, finalRoot);
	} catch (error) {
		failed = error;
		await rm(stagingRoot, { recursive: true, force: true });
	}
	if (failed !== null) throw failed;
	const receiptMaterial = strictSnapshot({
		generationRef: D43_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		commitArtifactDigest: empiricalSha256(commitBytes),
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}

export function canonicalReplayD43Qualification(
	bundle: D43QualificationBundleV1,
): D43QualificationBundleV1 {
	return validateD43QualificationBundle(strictJsonCodec.decode(strictJsonCodec.encode(bundle)));
}

export function snapshotPartialD43ForTest(
	authority: ReturnType<typeof createD43GraphHarnessAuthority>,
): D43GraphHarnessEvidenceV1 {
	return snapshotD43GraphHarnessEvidence(authority);
}
