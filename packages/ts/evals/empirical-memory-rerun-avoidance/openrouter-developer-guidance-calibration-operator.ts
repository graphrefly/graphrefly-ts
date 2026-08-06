import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	createD682MechanicalQualificationScorecard,
	type D682MechanicalQualificationCatalogV1,
	type D682MechanicalQualificationScorecardV1,
} from "./d682-mechanical-qualification.js";
import {
	aggregateDeveloperGuidanceScorecard,
	createDeveloperGuidanceObservation,
	createDeveloperGuidanceRecommendation,
	type DeveloperGuidanceArm,
	type DeveloperGuidanceIndependentVerifierCapabilityV1,
	type DeveloperGuidanceObservationV2,
	developerGuidanceComparisonCoordinatesDigest,
} from "./developer-guidance-utility.js";
import type { EmpiricalCalibrationTrialBlockObservationV4 } from "./empirical-smoke-evidence.js";
import {
	B112_D678_AGENT_MAX_STEPS,
	B112_D678_BLOCK_MAX_COST_MICROUSD,
	B112_D678_CALIBRATION_BLOCK_COUNT,
	B112_D678_CAMPAIGN_MAX_COST_MICROUSD,
	B112_D679_TASK_MAX_COST_MICROUSD,
	executeLoadedOpenRouterCalibrationCampaign,
	type OpenRouterCalibrationFreshRouteQualificationCapabilityV1,
	type OpenRouterCalibrationOperatorInputV1,
	openRouterCalibrationModelProfileDigest,
	openRouterCalibrationStableRouteProfileDigest,
} from "./openrouter-calibration-operator.js";
import type { OpenRouterCurrentKeySpendAdmissionCapabilityV1 } from "./openrouter-current-key-spend-admission.js";
import type { OpenRouterFirstTaskRetryWaitCapabilityV1 } from "./openrouter-first-task-smoke.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
	OpenRouterResponsesMonotonicMeasurementV1,
} from "./openrouter-responses-model-turn.js";
import { OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL } from "./openrouter-route-qualification.js";
import {
	type PersistedPrivateDeveloperGuidanceCalibrationGenerationV1,
	persistPrivateDeveloperGuidanceCalibrationGeneration,
} from "./private-smoke-persistence.js";

const D688_ARMS = Object.freeze([
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const satisfies readonly DeveloperGuidanceArm[]);
export const D688_DEVELOPER_GUIDANCE_MAX_ACTIONS = 256;
export const D688_REQUIRED_D682_LIVE_SCORECARD_DIGEST =
	"sha256:42046553a2e274aabe688ac0d370730497f814413f7259cd14c7c37b0466a9b4";

export interface D688MechanicalQualificationGateV1 {
	readonly catalog: D682MechanicalQualificationCatalogV1;
	readonly observations: readonly [
		EmpiricalCalibrationTrialBlockObservationV4,
		EmpiricalCalibrationTrialBlockObservationV4,
		EmpiricalCalibrationTrialBlockObservationV4,
	];
	readonly scorecard: D682MechanicalQualificationScorecardV1;
}

export interface OpenRouterDeveloperGuidanceCalibrationResultV1 {
	readonly terminalSlots: Awaited<
		ReturnType<typeof executeLoadedOpenRouterCalibrationCampaign>
	>["terminalSlots"];
	readonly sourceScorecard: Awaited<
		ReturnType<typeof executeLoadedOpenRouterCalibrationCampaign>
	>["scorecard"];
	readonly guidanceObservations: readonly DeveloperGuidanceObservationV2[];
	readonly guidanceScorecard: ReturnType<typeof aggregateDeveloperGuidanceScorecard>;
	readonly recommendation: ReturnType<typeof createDeveloperGuidanceRecommendation>;
	readonly persistence: PersistedPrivateDeveloperGuidanceCalibrationGenerationV1;
}

export interface D688DeveloperGuidancePreflightV1 {
	readonly modelProfileDigest: string;
	readonly stableRouteProfileDigest: string;
	readonly mechanicalScorecardDigest: string;
}

function sourceObservationModelProfileDigest(
	observation: EmpiricalCalibrationTrialBlockObservationV4,
): string {
	const { route } = observation;
	return empiricalStrictJsonDigest({
		requestModel: route.model,
		modelIdentityKind: route.modelIdentityKind,
		downstreamProviderSlug: route.downstreamProviderSlug,
		downstreamProviderName: route.downstreamProviderName,
		endpoint: route.endpoint,
		endpointRevision: route.endpointRevision,
		adapterRevision: route.adapterRevision,
		bindingRevision: route.bindingRevision,
		usageSource: route.usageSource,
		usageRevision: route.usageRevision,
		routeEvidenceSchemaRevision: route.routeEvidenceSchemaRevision,
		pricing: {
			sourceUrl: route.pricingSourceUrl,
			currency: "USD",
			inputMicrousdPerMillionTokens: route.inputMicrousdPerMillionTokens,
			outputMicrousdPerMillionTokens: route.outputMicrousdPerMillionTokens,
		},
	});
}

function assertQualifiedMechanicalGate(
	gate: D688MechanicalQualificationGateV1,
	executionClass: "simulated-contract" | "live-provider",
	expectedModelProfileDigest: string,
): void {
	const canonical = createD682MechanicalQualificationScorecard({
		catalog: gate.catalog,
		observations: gate.observations,
	});
	if (
		empiricalStrictJsonDigest(canonical) !== empiricalStrictJsonDigest(gate.scorecard) ||
		canonical.evidenceClass !== executionClass ||
		canonical.empiricalLiveEvidence !== (executionClass === "live-provider") ||
		canonical.status !==
			(executionClass === "live-provider" ? "qualified" : "simulated-contract-passed") ||
		canonical.passedFixtures !== 3 ||
		canonical.completeFixtures !== 3 ||
		canonical.nonEvaluableFixtures !== 0 ||
		(executionClass === "live-provider" &&
			empiricalStrictJsonDigest(canonical) !== D688_REQUIRED_D682_LIVE_SCORECARD_DIGEST) ||
		new Set(gate.observations.map(sourceObservationModelProfileDigest)).size !== 1 ||
		sourceObservationModelProfileDigest(gate.observations[0]) !== expectedModelProfileDigest
	) {
		throw new TypeError("D688 requires the exact qualified D682 live mechanical gate");
	}
}

function assertD688Authority(operatorInput: OpenRouterCalibrationOperatorInputV1): void {
	const manifest = operatorInput.frozen.manifest;
	const actor = manifest.modelConfigurations.filter((candidate) => candidate.role === "actor");
	if (
		manifest.trialPlan.profile !== "calibration" ||
		manifest.catalog.tasks.length !== 5 ||
		manifest.trialPlan.activeTaskRefs.length !== 5 ||
		manifest.trialPlan.attemptedColdBlocksPerTask !== 3 ||
		manifest.trialPlan.branchOrderMode !== "explicit" ||
		manifest.trialPlan.branchOrder.length !== D688_ARMS.length ||
		manifest.trialPlan.branchOrder.some((arm, index) => arm !== D688_ARMS[index]) ||
		manifest.budgets.agentRun.maxRequests !== B112_D678_AGENT_MAX_STEPS ||
		manifest.budgets.agentRun.maxSteps !== B112_D678_AGENT_MAX_STEPS ||
		manifest.budgets.agentRun.maxElapsedMs !== 960_000 ||
		manifest.budgets.taskModel.maxCostMicrousd !== B112_D679_TASK_MAX_COST_MICROUSD ||
		manifest.budgets.campaign.maxCostMicrousd !== B112_D678_CAMPAIGN_MAX_COST_MICROUSD ||
		actor.length !== 1 ||
		actor[0]?.model !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
		actor[0]?.settings.reasoning.effort !== "high"
	) {
		throw new TypeError("OpenRouter developer guidance campaign does not match D688 authority");
	}
}

export function validateOpenRouterDeveloperGuidancePreflight(input: {
	readonly operatorInput: OpenRouterCalibrationOperatorInputV1;
	readonly mechanicalGate: D688MechanicalQualificationGateV1;
	readonly executionClass: "simulated-contract" | "live-provider";
}): D688DeveloperGuidancePreflightV1 {
	assertD688Authority(input.operatorInput);
	const modelProfileDigest = openRouterCalibrationModelProfileDigest(input.operatorInput);
	assertQualifiedMechanicalGate(input.mechanicalGate, input.executionClass, modelProfileDigest);
	return strictSnapshot({
		modelProfileDigest,
		stableRouteProfileDigest: openRouterCalibrationStableRouteProfileDigest(input.operatorInput),
		mechanicalScorecardDigest: empiricalStrictJsonDigest(input.mechanicalGate.scorecard),
	});
}

/**
 * Runs the D688 source campaign, projects D684 evidence, and commits one private generation.
 * Mechanical qualification and authority checks occur before any fresh qualification or transport call.
 */
export async function runLoadedOpenRouterDeveloperGuidanceCalibration(input: {
	readonly operatorInput: OpenRouterCalibrationOperatorInputV1;
	readonly mechanicalGate: D688MechanicalQualificationGateV1;
	readonly guidanceVerifier: DeveloperGuidanceIndependentVerifierCapabilityV1;
	readonly freshRouteQualification: OpenRouterCalibrationFreshRouteQualificationCapabilityV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly currentKeySpendAdmission: OpenRouterCurrentKeySpendAdmissionCapabilityV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly retryWait: OpenRouterFirstTaskRetryWaitCapabilityV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly signal: AbortSignal;
}): Promise<OpenRouterDeveloperGuidanceCalibrationResultV1> {
	const preflight = validateOpenRouterDeveloperGuidancePreflight(input);
	const stableRouteProfileDigest = preflight.stableRouteProfileDigest;
	const execution = await executeLoadedOpenRouterCalibrationCampaign({
		operatorInput: input.operatorInput,
		credential: input.credential,
		transport: input.transport,
		currentKeySpendAdmission: input.currentKeySpendAdmission,
		monotonicMeasurement: input.monotonicMeasurement,
		retryWait: input.retryWait,
		executionClass: input.executionClass,
		signal: input.signal,
		freshRouteQualification: input.freshRouteQualification,
	});
	const guidanceObservations: DeveloperGuidanceObservationV2[] = [];
	const assessedActionCounts: { readonly observationId: string; readonly actionCount: number }[] =
		[];
	const actor = input.operatorInput.frozen.manifest.modelConfigurations.find(
		(configuration) => configuration.role === "actor",
	);
	if (actor === undefined) throw new TypeError("D688 actor configuration is missing");
	for (const slot of execution.terminalSlots) {
		if (!slot.attempted || slot.observation === null) continue;
		const source = slot.observation;
		const comparisonCoordinatesDigest = developerGuidanceComparisonCoordinatesDigest({
			manifestDigest: input.operatorInput.frozen.manifestDigest,
			taskId: slot.taskRef,
			matchedBlockId: source.trialBlockRef,
			configurationRef: actor.configurationRef,
			stableRouteProfileDigest,
			maxRequests: B112_D678_AGENT_MAX_STEPS,
			maxActions: D688_DEVELOPER_GUIDANCE_MAX_ACTIONS,
			verifierRef: input.guidanceVerifier.verifierRef,
			verifierRevision: input.guidanceVerifier.verifierRevision,
		});
		for (const arm of D688_ARMS) {
			const branch = source.warmBranches.find((candidate) => candidate.branchKind === arm);
			if (!branch?.attempted || branch.run === null) continue;
			const observationId = `d688.${slot.taskRef}.block-${slot.blockIndex}.${arm}`;
			guidanceObservations.push(
				createDeveloperGuidanceObservation({
					sourceObservation: source,
					arm,
					observationId,
					comparisonCoordinatesDigest,
					horizon: {
						maxRequests: B112_D678_AGENT_MAX_STEPS,
						maxActions: D688_DEVELOPER_GUIDANCE_MAX_ACTIONS,
					},
					verifier: input.guidanceVerifier,
				}),
			);
			assessedActionCounts.push({
				observationId,
				actionCount: branch.run.actionTrace.length,
			});
		}
	}
	const guidanceScorecard = aggregateDeveloperGuidanceScorecard(guidanceObservations);
	const expectedTaskIds = input.operatorInput.frozen.manifest.catalog.tasks.map(
		(task) => task.taskRef,
	) as [string, string, string, string, string];
	const recommendation = createDeveloperGuidanceRecommendation({
		observations: guidanceObservations,
		scorecard: guidanceScorecard,
		expectedTaskIds,
		assessedActionCounts,
	});
	const persistence = await persistPrivateDeveloperGuidanceCalibrationGeneration({
		privateRoot: input.operatorInput.privateRoot,
		generationRef: input.operatorInput.generationRef,
		frozen: input.operatorInput.frozen,
		qualificationReport: input.operatorInput.qualificationReport,
		terminalSlots: execution.terminalSlots,
		sourceScorecard: execution.scorecard,
		guidanceObservations,
		guidanceScorecard,
		recommendation,
		expectedTaskIds,
		assessedActionCounts,
		protectionExecutor: execution.protectionExecutor,
	});
	return strictSnapshot({
		terminalSlots: execution.terminalSlots,
		sourceScorecard: execution.scorecard,
		guidanceObservations,
		guidanceScorecard,
		recommendation,
		persistence,
	});
}

export const D688_APPROVED_BLOCK_MAX_COST_MICROUSD = B112_D678_BLOCK_MAX_COST_MICROUSD;
export const D688_APPROVED_BLOCK_COUNT = B112_D678_CALIBRATION_BLOCK_COUNT;
