import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	createD690HistoricalTransferMemory,
	D690_CLAIM_BOUNDARY,
	D690_FAILURE_MECHANISM_REF,
	D690_HISTORICAL_PAIR_EVIDENCE_VERSION,
	D690_SOURCE,
	D690_TARGET_TASK_REF,
	type D690HistoricalPairOfflineEvidenceV1,
} from "./d690-historical-pair-qualification.js";
import {
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import {
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import { createD691HistoricalReflectionCapability } from "./matched-block-memory.js";
import {
	type OpenRouterMatchedTrialBlockInputV4,
	runOpenRouterMatchedTrialBlock,
} from "./openrouter-first-task-smoke.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
} from "./openrouter-route-qualification.js";
import {
	assertPrivateArtifactProtection,
	assertSafePrivateRoot,
	syncDirectory,
	writePrivateFile,
} from "./private-smoke-persistence.js";

export const D691_HISTORICAL_TRANSFER_OBSERVATION_VERSION =
	"graphrefly.private-solution-eval.d691-historical-transfer-observation.v1" as const;
export const D691_HISTORICAL_TRANSFER_SCORECARD_VERSION =
	"graphrefly.private-solution-eval.d691-historical-transfer-scorecard.v1" as const;
export const D691_HISTORICAL_TRANSFER_GENERATION_VERSION =
	"graphrefly.private-solution-eval.d691-historical-transfer-generation.v1" as const;
export const D691_CLAIM_BOUNDARY =
	"single-controlled-historical-transfer-block-exploratory-no-efficacy-claim" as const;
export const D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST =
	"sha256:efd96ff501acefbfbff845f3c34edfbb04e93f7015f5827a717e8870b95ecba1" as const;
export const D691_PRIVATE_PERSISTENCE_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../.private/empirical-memory-rerun-avoidance",
);

export const D691_BUDGET = Object.freeze({
	maxSpendMicrousd: 6_000_000,
	maxHttpAttempts: 576,
	maxStepsPerRun: 32,
	maxActionsPerRun: 256,
	maxCanonicalRequestBytes: 262_144,
	maxInputTokens: 40_000_000,
	maxOutputTokens: 12_582_912,
	maxOutputTokensPerTurn: 65_536,
	maxElapsedMs: 7_200_000,
});

const D690_EVIDENCE_KEYS = Object.freeze([
	"chargedCostMicrousd",
	"claimBoundary",
	"d689OfflineCaseCount",
	"d689OfflineEvidenceDigest",
	"efficacyClaim",
	"evidenceDigest",
	"failureMechanismRef",
	"hiddenVerifierQualified",
	"historicalEvidenceRewritten",
	"historyFreeTargetQualified",
	"leakageProbeSetDigest",
	"naturalChronologyClaimed",
	"networkCallCount",
	"networkIsolationProfile",
	"pairQualificationDigest",
	"preProviderQualityGatePassed",
	"privateMaterialProtectionSetBindingDigest",
	"protectedLeakageClassCount",
	"protectionCoverageClaim",
	"providerCallCount",
	"publicExportDelta",
	"sourceObservationDigest",
	"sourceTaskRef",
	"targetExpectedMaterialPersisted",
	"targetMaterializationEvidenceDigest",
	"targetTaskRef",
	"transferMemoryDigest",
	"verifierCalibrationDigest",
	"verifierRuntimeClosurePackageCount",
	"verifierToolchainBindingDigest",
	"version",
]);

export interface D691HistoricalTransferObservationV1 {
	readonly schemaVersion: typeof D691_HISTORICAL_TRANSFER_OBSERVATION_VERSION;
	readonly claimBoundary: typeof D691_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly executionClass: EmpiricalTrialBlockObservationV3["executionClass"];
	readonly d690OfflineEvidenceDigest: string;
	readonly sourceTaskRef: string;
	readonly targetTaskRef: string;
	readonly failureMechanismRef: string;
	readonly transferMemoryDigest: string;
	readonly underlyingObservationDigest: string;
	readonly underlying: EmpiricalTrialBlockObservationV3;
	readonly relevantActionTraceBoundToMemory: boolean;
	readonly positiveExploratoryTransferPattern: boolean;
	readonly observationDigest: string;
}

export interface D691HistoricalTransferScorecardV1 {
	readonly schemaVersion: typeof D691_HISTORICAL_TRANSFER_SCORECARD_VERSION;
	readonly claimBoundary: typeof D691_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completedBlocks: 0 | 1;
	readonly evaluablePairs: 0 | 1;
	readonly positiveExploratoryTransferPatterns: 0 | 1;
	readonly status:
		| "complete-positive-exploratory-signal"
		| "complete-no-positive-signal"
		| "incomplete";
	readonly scorecardDigest: string;
}

export async function runD691HistoricalTransferBlock(input: {
	readonly d690OfflineEvidence: unknown;
	readonly block: OpenRouterMatchedTrialBlockInputV4;
}): Promise<{
	readonly observation: D691HistoricalTransferObservationV1;
	readonly scorecard: D691HistoricalTransferScorecardV1;
	readonly admissionRejection: Awaited<
		ReturnType<typeof runOpenRouterMatchedTrialBlock>
	>["admissionRejection"];
	readonly protectionExecutor: Awaited<
		ReturnType<typeof runOpenRouterMatchedTrialBlock>
	>["protectionExecutor"];
}> {
	const outer = record(input, "d691.input");
	exactKeys(outer, ["block", "d690OfflineEvidence"], "d691.input");
	const block = captureD691Block(outer.block);
	validateD691BlockCoordinates(block);
	const d690OfflineEvidence = validateD690OfflineEvidence(
		outer.d690OfflineEvidence,
		block.executionClass,
	);
	const transferMemory = createD690HistoricalTransferMemory();
	if (empiricalStrictJsonDigest(transferMemory) !== d690OfflineEvidence.transferMemoryDigest) {
		throw new TypeError("D691 transfer memory no longer matches the qualified D690 bytes");
	}
	const result = await runOpenRouterMatchedTrialBlock({
		...block,
		historicalReflectionCapability: createD691HistoricalReflectionCapability({
			transferMemory,
			d690OfflineEvidenceDigest: d690OfflineEvidence.evidenceDigest,
		}),
	});
	if (result.profile !== "smoke") {
		throw new TypeError("D691 requires the one-block smoke profile");
	}
	assertD691UnderlyingCoordinates(result.observation, block);
	const observation = createD691Observation(
		result.observation,
		d690OfflineEvidence,
		empiricalStrictJsonDigest(transferMemory),
	);
	return Object.freeze({
		observation,
		scorecard: createD691Scorecard(observation),
		admissionRejection: result.admissionRejection,
		protectionExecutor: result.protectionExecutor,
	});
}

function captureD691Block(value: unknown): OpenRouterMatchedTrialBlockInputV4 {
	const block = record(value, "d691.input.block");
	const host = record(block.host, "d691.input.block.host");
	const routeQualification = strictSnapshot(
		record(block.routeQualification, "d691.input.block.routeQualification"),
	);
	const frozen = strictSnapshot(record(host.frozen, "d691.input.block.host.frozen"));
	const qualificationReport = strictSnapshot(
		record(host.qualificationReport, "d691.input.block.host.qualificationReport"),
	);
	const initialRequest = strictSnapshot(
		record(host.initialRequest, "d691.input.block.host.initialRequest"),
	);
	const taskProfile = strictSnapshot(record(host.taskProfile, "d691.input.block.host.taskProfile"));
	return Object.freeze({
		...block,
		routeQualification,
		host: Object.freeze({
			...host,
			frozen,
			qualificationReport,
			initialRequest,
			taskProfile,
		}),
	}) as unknown as OpenRouterMatchedTrialBlockInputV4;
}

function validateD691BlockCoordinates(block: OpenRouterMatchedTrialBlockInputV4): void {
	if (
		block.historicalReflectionCapability !== undefined ||
		block.host.initialRequest.taskRef !== D690_TARGET_TASK_REF ||
		block.host.frozen.manifest.trialPlan.profile !== "smoke" ||
		block.prepareWarmHost === undefined
	) {
		throw new TypeError("D691 block does not bind the exact target and warm-host boundary");
	}
	const route = block.routeQualification;
	const budget = route.budget;
	if (
		route.requestModel !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
		route.downstreamProviderSlug !== OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG ||
		route.downstreamProviderName !== OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME ||
		route.pricing.inputMicrousdPerMillionTokens !==
			OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS ||
		route.pricing.outputMicrousdPerMillionTokens !==
			OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS ||
		budget.maxSmokeSpendMicrousd !== D691_BUDGET.maxSpendMicrousd ||
		budget.maxRequests !== D691_BUDGET.maxHttpAttempts ||
		budget.maxStepsPerRun !== D691_BUDGET.maxStepsPerRun ||
		budget.maxCanonicalRequestBytes !== D691_BUDGET.maxCanonicalRequestBytes ||
		budget.maxInputTokens !== D691_BUDGET.maxInputTokens ||
		budget.maxOutputTokens !== D691_BUDGET.maxOutputTokens ||
		budget.maxLatencyMs !== D691_BUDGET.maxElapsedMs
	) {
		throw new TypeError("D691 route or budget coordinates drifted from decision.D691");
	}
	const configuration = block.host.frozen.manifest.modelConfigurations.find(
		(candidate) => candidate.configurationRef === block.host.initialRequest.configurationRef,
	);
	if (
		configuration?.settings.reasoning.effort !== "high" ||
		block.host.initialRequest.remainingTurnBudget.maxOutputTokens !==
			D691_BUDGET.maxOutputTokensPerTurn ||
		block.host.frozen.manifest.budgets.agentRun.maxSteps !== D691_BUDGET.maxStepsPerRun ||
		block.host.frozen.manifest.budgets.agentRun.maxRequests !== D691_BUDGET.maxStepsPerRun ||
		block.host.frozen.manifest.budgets.agentRun.maxElapsedMs !== D691_BUDGET.maxElapsedMs / 6
	) {
		throw new TypeError("D691 host configuration or per-run bounds drifted");
	}
}

function validateD690OfflineEvidence(
	value: unknown,
	executionClass: OpenRouterMatchedTrialBlockInputV4["executionClass"],
): D690HistoricalPairOfflineEvidenceV1 {
	const candidate = record(value, "d691.d690OfflineEvidence");
	exactKeys(candidate, D690_EVIDENCE_KEYS, "d691.d690OfflineEvidence");
	literal(candidate.version, D690_HISTORICAL_PAIR_EVIDENCE_VERSION, "d691.d690.version");
	literal(candidate.claimBoundary, D690_CLAIM_BOUNDARY, "d691.d690.claimBoundary");
	literal(candidate.efficacyClaim, "none", "d691.d690.efficacyClaim");
	literal(candidate.sourceTaskRef, D690_SOURCE.taskRef, "d691.d690.sourceTaskRef");
	literal(candidate.targetTaskRef, D690_TARGET_TASK_REF, "d691.d690.targetTaskRef");
	literal(
		candidate.failureMechanismRef,
		D690_FAILURE_MECHANISM_REF,
		"d691.d690.failureMechanismRef",
	);
	for (const key of [
		"historyFreeTargetQualified",
		"hiddenVerifierQualified",
		"preProviderQualityGatePassed",
	] as const) {
		literal(candidate[key], true, `d691.d690.${key}`);
	}
	for (const key of [
		"historicalEvidenceRewritten",
		"naturalChronologyClaimed",
		"targetExpectedMaterialPersisted",
		"publicExportDelta",
	] as const) {
		literal(candidate[key], false, `d691.d690.${key}`);
	}
	for (const key of ["providerCallCount", "networkCallCount", "chargedCostMicrousd"] as const) {
		literal(candidate[key], 0, `d691.d690.${key}`);
	}
	literal(candidate.protectedLeakageClassCount, 5, "d691.d690.protectedLeakageClassCount");
	literal(
		candidate.networkIsolationProfile,
		"macos-sandbox-exec-deny-network.v1",
		"d691.d690.networkIsolationProfile",
	);
	literal(
		candidate.protectionCoverageClaim,
		"exact-frozen-needle-set-plus-exact-memory-digest",
		"d691.d690.protectionCoverageClaim",
	);
	literal(
		candidate.sourceObservationDigest,
		D690_SOURCE.observationDigest,
		"d691.d690.sourceObservationDigest",
	);
	for (const key of [
		"sourceObservationDigest",
		"targetMaterializationEvidenceDigest",
		"verifierCalibrationDigest",
		"verifierToolchainBindingDigest",
		"transferMemoryDigest",
		"pairQualificationDigest",
		"d689OfflineEvidenceDigest",
		"privateMaterialProtectionSetBindingDigest",
		"leakageProbeSetDigest",
		"evidenceDigest",
	] as const) {
		digest(candidate[key], `d691.d690.${key}`);
	}
	safeInteger(candidate.verifierRuntimeClosurePackageCount, "d691.d690.verifierPackageCount", {
		min: 1,
	});
	literal(candidate.d689OfflineCaseCount, 9, "d691.d690.caseCount");
	const evidenceDigest = candidate.evidenceDigest as string;
	const { evidenceDigest: ignored, ...material } = candidate;
	if (ignored !== evidenceDigest || empiricalStrictJsonDigest(material) !== evidenceDigest) {
		throw new TypeError("D691 rejected non-canonical or tampered D690 evidence");
	}
	if (
		executionClass === "live-provider" &&
		evidenceDigest !== D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST
	) {
		throw new TypeError("D691 live dispatch requires the exact qualified D690 evidence receipt");
	}
	return strictSnapshot(candidate) as unknown as D690HistoricalPairOfflineEvidenceV1;
}

function d691DerivedPattern(underlying: EmpiricalTrialBlockObservationV3): {
	readonly relevantActionTraceBoundToMemory: boolean;
	readonly positiveExploratoryTransferPattern: boolean;
} {
	const byKind = (kind: string) =>
		underlying.warmBranches.find((branch) => branch.branchKind === kind);
	const relevant = byKind("relevant-applied");
	const proposal = byKind("proposal-only");
	const negativeControls = [
		byKind("admission-rejected"),
		byKind("irrelevant-applied"),
		byKind("wrong-scope-applied"),
	];
	const selectedRecordDigest = relevant?.lifecycle?.selectedRecordDigest ?? null;
	const relevantActionTraceBoundToMemory =
		selectedRecordDigest !== null &&
		(relevant?.run?.actionTrace.some(
			(action) => action.memoryContextRecordDigest === selectedRecordDigest,
		) ??
			false);
	return Object.freeze({
		relevantActionTraceBoundToMemory,
		positiveExploratoryTransferPattern:
			underlying.cold.verifierStatus === "failed" &&
			relevant?.run?.verifierStatus === "passed" &&
			proposal?.run?.verifierStatus === "failed" &&
			negativeControls.every((branch) => branch?.run?.verifierStatus === "failed") &&
			relevantActionTraceBoundToMemory,
	});
}

function createD691Observation(
	underlying: EmpiricalTrialBlockObservationV3,
	d690: D690HistoricalPairOfflineEvidenceV1,
	transferMemoryDigest: string,
): D691HistoricalTransferObservationV1 {
	const validatedUnderlying = validateEmpiricalTrialBlockObservation(underlying);
	const { relevantActionTraceBoundToMemory, positiveExploratoryTransferPattern } =
		d691DerivedPattern(validatedUnderlying);
	const material = strictSnapshot({
		schemaVersion: D691_HISTORICAL_TRANSFER_OBSERVATION_VERSION,
		claimBoundary: D691_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		executionClass: validatedUnderlying.executionClass,
		d690OfflineEvidenceDigest: d690.evidenceDigest,
		sourceTaskRef: d690.sourceTaskRef,
		targetTaskRef: d690.targetTaskRef,
		failureMechanismRef: d690.failureMechanismRef,
		transferMemoryDigest,
		underlyingObservationDigest: empiricalStrictJsonDigest(validatedUnderlying),
		underlying: validatedUnderlying,
		relevantActionTraceBoundToMemory,
		positiveExploratoryTransferPattern,
	});
	return strictSnapshot({ ...material, observationDigest: empiricalStrictJsonDigest(material) });
}

export function createD691Scorecard(
	observation: D691HistoricalTransferObservationV1,
): D691HistoricalTransferScorecardV1 {
	const validated = validateD691Observation(observation);
	const evaluable =
		validated.underlying.result.classification === "complete" &&
		validated.underlying.cold.verifierStatus === "failed" &&
		validated.underlying.warmBranches.every(
			(branch) =>
				branch.attempted &&
				(branch.run?.verifierStatus === "passed" || branch.run?.verifierStatus === "failed"),
		);
	const complete = evaluable;
	const status = !evaluable
		? ("incomplete" as const)
		: validated.positiveExploratoryTransferPattern
			? ("complete-positive-exploratory-signal" as const)
			: ("complete-no-positive-signal" as const);
	const material = strictSnapshot({
		schemaVersion: D691_HISTORICAL_TRANSFER_SCORECARD_VERSION,
		claimBoundary: D691_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		observationDigests: [validated.observationDigest] as const,
		attemptedBlocks: 1 as const,
		completedBlocks: (complete ? 1 : 0) as 0 | 1,
		evaluablePairs: (evaluable ? 1 : 0) as 0 | 1,
		positiveExploratoryTransferPatterns: (validated.positiveExploratoryTransferPattern ? 1 : 0) as
			| 0
			| 1,
		status,
	});
	return strictSnapshot({ ...material, scorecardDigest: empiricalStrictJsonDigest(material) });
}

function validateD691Observation(
	value: D691HistoricalTransferObservationV1,
): D691HistoricalTransferObservationV1 {
	const candidate = record(value, "d691.observation");
	exactKeys(
		candidate,
		[
			"claimBoundary",
			"d690OfflineEvidenceDigest",
			"efficacyClaim",
			"executionClass",
			"failureMechanismRef",
			"observationDigest",
			"positiveExploratoryTransferPattern",
			"relevantActionTraceBoundToMemory",
			"schemaVersion",
			"sourceTaskRef",
			"targetTaskRef",
			"transferMemoryDigest",
			"underlying",
			"underlyingObservationDigest",
		],
		"d691.observation",
	);
	literal(
		candidate.schemaVersion,
		D691_HISTORICAL_TRANSFER_OBSERVATION_VERSION,
		"d691.observation.schemaVersion",
	);
	literal(candidate.claimBoundary, D691_CLAIM_BOUNDARY, "d691.observation.claimBoundary");
	literal(candidate.efficacyClaim, "none", "d691.observation.efficacyClaim");
	literal(candidate.sourceTaskRef, D690_SOURCE.taskRef, "d691.observation.sourceTaskRef");
	literal(candidate.targetTaskRef, D690_TARGET_TASK_REF, "d691.observation.targetTaskRef");
	literal(
		candidate.failureMechanismRef,
		D690_FAILURE_MECHANISM_REF,
		"d691.observation.failureMechanismRef",
	);
	const d690OfflineEvidenceDigest = digest(
		candidate.d690OfflineEvidenceDigest,
		"d691.observation.d690OfflineEvidenceDigest",
	);
	const transferMemoryDigest = digest(
		candidate.transferMemoryDigest,
		"d691.observation.transferMemoryDigest",
	);
	const underlying = validateEmpiricalTrialBlockObservation(candidate.underlying);
	assertFrozenD691UnderlyingCoordinates(underlying);
	literal(candidate.executionClass, underlying.executionClass, "d691.observation.executionClass");
	if (
		underlying.executionClass === "live-provider" &&
		d690OfflineEvidenceDigest !== D691_QUALIFIED_D690_OFFLINE_EVIDENCE_DIGEST
	) {
		throw new TypeError("D691 live observation is not bound to the qualified D690 receipt");
	}
	const expectedTransferMemoryDigest = empiricalStrictJsonDigest(
		createD690HistoricalTransferMemory(),
	);
	if (transferMemoryDigest !== expectedTransferMemoryDigest) {
		throw new TypeError("D691 observation transfer memory digest drifted");
	}
	const underlyingObservationDigest = digest(
		candidate.underlyingObservationDigest,
		"d691.observation.underlyingObservationDigest",
	);
	if (underlyingObservationDigest !== empiricalStrictJsonDigest(underlying)) {
		throw new TypeError("D691 underlying observation digest does not bind its canonical bytes");
	}
	const derived = d691DerivedPattern(underlying);
	literal(
		candidate.relevantActionTraceBoundToMemory,
		derived.relevantActionTraceBoundToMemory,
		"d691.observation.relevantActionTraceBoundToMemory",
	);
	literal(
		candidate.positiveExploratoryTransferPattern,
		derived.positiveExploratoryTransferPattern,
		"d691.observation.positiveExploratoryTransferPattern",
	);
	const observationDigest = digest(
		candidate.observationDigest,
		"d691.observation.observationDigest",
	);
	const { observationDigest: ignored, ...material } = candidate;
	if (ignored !== observationDigest || empiricalStrictJsonDigest(material) !== observationDigest) {
		throw new TypeError("D691 observation digest does not bind its canonical material");
	}
	return strictSnapshot(candidate) as unknown as D691HistoricalTransferObservationV1;
}

function assertFrozenD691UnderlyingCoordinates(
	observation: EmpiricalTrialBlockObservationV3,
): void {
	const route = observation.route;
	if (
		observation.taskRef !== D690_TARGET_TASK_REF ||
		route.model !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
		route.downstreamProviderSlug !== OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG ||
		route.downstreamProviderName !== OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME ||
		route.inputMicrousdPerMillionTokens !==
			OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS ||
		route.outputMicrousdPerMillionTokens !==
			OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS ||
		route.maxSmokeSpendMicrousd !== D691_BUDGET.maxSpendMicrousd ||
		route.maxRequests !== D691_BUDGET.maxHttpAttempts ||
		route.maxStepsPerRun !== D691_BUDGET.maxStepsPerRun ||
		route.maxCanonicalRequestBytes !== D691_BUDGET.maxCanonicalRequestBytes ||
		route.maxInputTokens !== D691_BUDGET.maxInputTokens ||
		route.maxOutputTokens !== D691_BUDGET.maxOutputTokens ||
		route.maxLatencyMs !== D691_BUDGET.maxElapsedMs
	) {
		throw new TypeError("D691 observation drifted from its frozen target/route/budget coordinates");
	}
	for (const branch of observation.warmBranches) {
		if (
			branch.lifecycle !== null &&
			(!branch.lifecycle.stagePredicates.same_work_item_input ||
				!branch.lifecycle.stagePredicates.cold_run_failed)
		) {
			throw new TypeError("D691 observation is not a matched cold-failure transfer block");
		}
	}
}

function assertD691UnderlyingCoordinates(
	value: EmpiricalTrialBlockObservationV3,
	block: OpenRouterMatchedTrialBlockInputV4,
): void {
	const observation = validateEmpiricalTrialBlockObservation(value);
	assertFrozenD691UnderlyingCoordinates(observation);
	const route = observation.route;
	const qualified = block.routeQualification;
	if (
		observation.taskRef !== D690_TARGET_TASK_REF ||
		observation.executionClass !== block.executionClass ||
		route.model !== qualified.requestModel ||
		route.downstreamProviderSlug !== qualified.downstreamProviderSlug ||
		route.downstreamProviderName !== qualified.downstreamProviderName ||
		route.qualificationDigest !== empiricalStrictJsonDigest(qualified) ||
		route.maxSmokeSpendMicrousd !== D691_BUDGET.maxSpendMicrousd ||
		route.maxRequests !== D691_BUDGET.maxHttpAttempts ||
		route.maxStepsPerRun !== D691_BUDGET.maxStepsPerRun ||
		route.maxCanonicalRequestBytes !== D691_BUDGET.maxCanonicalRequestBytes ||
		route.maxInputTokens !== D691_BUDGET.maxInputTokens ||
		route.maxOutputTokens !== D691_BUDGET.maxOutputTokens ||
		route.maxLatencyMs !== D691_BUDGET.maxElapsedMs
	) {
		throw new TypeError("D691 underlying observation drifted from its sealed route coordinates");
	}
}

export async function persistD691PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D691HistoricalTransferObservationV1;
	readonly scorecard: D691HistoricalTransferScorecardV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}): Promise<{
	readonly generationRef: string;
	readonly observationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const request = record(input, "d691.persistence");
	exactKeys(
		request,
		["generationRef", "observation", "privateRoot", "protectionExecutor", "scorecard"],
		"d691.persistence",
	);
	const observation = validateD691Observation(
		request.observation as D691HistoricalTransferObservationV1,
	);
	const scorecard = createD691Scorecard(observation);
	if (empiricalStrictJsonDigest(request.scorecard) !== empiricalStrictJsonDigest(scorecard)) {
		throw new TypeError("D691 persistence rejected a scorecard not derived from its observation");
	}
	if (
		typeof request.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.generationRef)
	) {
		throw new TypeError("D691 generation ref is not a bounded private directory name");
	}
	if (typeof request.privateRoot !== "string") {
		throw new TypeError("D691 persistence root must be an explicit path");
	}
	const protectionExecutor =
		request.protectionExecutor as EmpiricalExactPrivateNeedleProtectionExecutorV1;
	if (!isEmpiricalExactPrivateNeedleProtectionExecutor(request.protectionExecutor)) {
		throw new TypeError("D691 persistence requires a constructed exact private-needle executor");
	}
	const privateRoot = await assertSafePrivateRoot(request.privateRoot);
	if (privateRoot !== (await assertSafePrivateRoot(D691_PRIVATE_PERSISTENCE_ROOT))) {
		throw new TypeError("D691 persistence root is not the exact repository-private eval root");
	}
	for (const [subject, label] of [
		[observation, "observation"],
		[scorecard, "scorecard"],
	] as const) {
		assertPrivateArtifactProtection({
			subject,
			label: `D691 ${label}`,
			protectionExecutor,
		});
	}
	const staging = join(privateRoot, `.d691-staging-${randomUUID()}`);
	const finalRoot = join(privateRoot, request.generationRef);
	const generation = strictSnapshot({
		schemaVersion: D691_HISTORICAL_TRANSFER_GENERATION_VERSION,
		generationRef: request.generationRef,
		observationDigest: observation.observationDigest,
		scorecardDigest: scorecard.scorecardDigest,
		claimBoundary: D691_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
	});
	assertPrivateArtifactProtection({
		subject: generation,
		label: "D691 generation",
		protectionExecutor,
	});
	try {
		await lstat(finalRoot)
			.then(() => {
				throw new TypeError("D691 generation already exists");
			})
			.catch((error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			});
		await mkdir(staging, { mode: 0o700 });
		await writePrivateCanonical(
			join(staging, "historical-transfer-observation.v1.json"),
			observation,
		);
		await writePrivateCanonical(join(staging, "historical-transfer-scorecard.v1.json"), scorecard);
		await writePrivateCanonical(join(staging, "generation.v1.json"), generation);
		await syncDirectory(staging);
		await rename(staging, finalRoot);
		await syncDirectory(privateRoot).catch(() => undefined);
	} catch (error) {
		await rm(staging, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
	return Object.freeze({
		generationRef: request.generationRef,
		observationDigest: observation.observationDigest,
		scorecardDigest: scorecard.scorecardDigest,
		generationDigest: empiricalStrictJsonDigest(generation),
	});
}

async function writePrivateCanonical(path: string, value: unknown): Promise<void> {
	const bytes = strictJsonCodec.encode(value);
	await writePrivateFile(path, bytes);
	const persisted = await readFile(path);
	if (!Buffer.from(bytes).equals(persisted)) {
		throw new TypeError("D691 canonical private write verification failed");
	}
}
