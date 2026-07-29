import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { ClosedTaskProfileHostRunOutcomeV1 } from "./closed-task-profile-host.js";
import type { FrozenEmpiricalCampaignManifestV1 } from "./contracts.js";
import type { QualifiedOpenRouterRouteV1 } from "./openrouter-route-qualification.js";

export const EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.empirical-trial-block-observation.v1";
export const EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.empirical-campaign-scorecard.v1";
export const B112_SMOKE_NO_EFFICACY_CLAIM = "smoke-integration-no-efficacy-claim";

export type EmpiricalSmokeEvidenceClassV1 =
	| "simulated-contract"
	| "live-approved-no-provider-evidence"
	| "live-provider";

export interface EmpiricalSmokeCostLedgerV1 {
	readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly costMicrousd: number;
}

export interface EmpiricalTrialBlockObservationV1 {
	readonly schemaVersion: typeof EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA;
	readonly executionClass: EmpiricalSmokeEvidenceClassV1;
	readonly empiricalLiveEvidence: boolean;
	readonly claimBoundary: typeof B112_SMOKE_NO_EFFICACY_CLAIM;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly profile: "smoke";
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly route: {
		readonly qualificationRef: string;
		readonly qualificationRevision: string;
		readonly qualificationDigest: string;
		readonly configurationRef: string;
		readonly configurationDigest: string;
		readonly model: string;
		readonly modelIdentityKind: "exact-snapshot" | "alias-disclosed";
		readonly providerFamily: "openrouter";
		readonly downstreamProviderSlug: string;
		readonly downstreamProviderName: string;
		readonly endpoint: string;
		readonly endpointRevision: string;
		readonly adapterRevision: string;
		readonly bindingRevision: string;
		readonly capabilitiesDigest: string;
		readonly settingsDigest: string;
		readonly usageSource: string;
		readonly usageRevision: string;
		readonly routeEvidenceSchemaRevision: string;
		readonly pricingSourceUrl: string;
		readonly pricingRevision: string;
		readonly inputMicrousdPerMillionTokens: number;
		readonly outputMicrousdPerMillionTokens: number;
		readonly budgetApprovalRef: string;
		readonly budgetApprovalRevision: string;
		readonly maxSmokeSpendMicrousd: number;
		readonly maxRequests: number;
		readonly maxStepsPerRun: number;
		readonly maxCanonicalRequestBytes: number;
		readonly maxInputTokens: number;
		readonly maxOutputTokens: number;
		readonly maxLatencyMs: number;
		readonly reservationRevision: string;
	};
	readonly result: {
		readonly classification: "complete" | "incomplete" | "non-evaluable";
		readonly verifierStatus: "passed" | "failed" | "unverifiable" | "not-run";
		readonly coldRunsAttempted: 1;
		readonly warmRunsAttempted: 0;
		readonly requests: number;
		readonly steps: number;
		readonly inputTokens: number | null;
		readonly outputTokens: number | null;
		readonly totalTokens: number | null;
		readonly hostInputBytes: number;
		readonly hostOutputBytes: number;
		readonly latencyMs: number;
		readonly costMicrousd: number;
		readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
		readonly reservedInputTokens: number;
		readonly reservedOutputTokens: number;
	};
	readonly hostOutcomeDigest: string;
	readonly routeEvidenceDigests: readonly string[];
	readonly verifierEvidenceDigests: readonly string[];
	readonly protectionReceiptDigests: readonly string[];
	readonly issueCodes: readonly string[];
}

export interface EmpiricalCampaignScorecardV1 {
	readonly schemaVersion: typeof EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly profile: "smoke";
	readonly evidenceClass: EmpiricalSmokeEvidenceClassV1;
	readonly empiricalLiveEvidence: boolean;
	readonly efficacyClaim: "none";
	readonly claimBoundary: typeof B112_SMOKE_NO_EFFICACY_CLAIM;
	readonly aggregationRevision: string;
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completeBlocks: 0 | 1;
	readonly incompleteBlocks: 0 | 1;
	readonly nonEvaluableBlocks: 0 | 1;
	readonly verifierPassedBlocks: 0 | 1;
	readonly requests: number;
	readonly steps: number;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly hostInputBytes: number;
	readonly hostOutputBytes: number;
	readonly latencyMs: number;
	readonly costMicrousd: number;
	readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly status: "smoke-complete-no-efficacy-claim" | "incomplete" | "non-evaluable";
	readonly issueCodes: readonly string[];
}

function sortedUniqueCoordinates(values: readonly string[], path: string): readonly string[] {
	if (values.length > 128) throw new TypeError(`${path} exceeds its bounded item count`);
	return Object.freeze(
		[...new Set(values.map((value, index) => coordinate(value, `${path}[${index}]`)))].sort(),
	);
}

function summedProviderUsage(
	outcome: ClosedTaskProfileHostRunOutcomeV1,
	field: "inputTokens" | "outputTokens" | "totalTokens",
): number | null {
	let total = 0;
	for (const turn of outcome.turnEvidence) {
		const value = turn[field];
		if (value === null) return null;
		total += value;
		if (!Number.isSafeInteger(total)) throw new TypeError(`smoke ${field} total overflow`);
	}
	return total;
}

export function createEmpiricalTrialBlockObservation(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly route: QualifiedOpenRouterRouteV1;
	readonly hostOutcome: ClosedTaskProfileHostRunOutcomeV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly costLedger: EmpiricalSmokeCostLedgerV1;
}): EmpiricalTrialBlockObservationV1 {
	const manifest = input.frozen.manifest;
	if (manifest.trialPlan.profile !== "smoke") {
		throw new TypeError("B112 smoke observation requires the smoke trial plan");
	}
	const taskRef = manifest.trialPlan.activeTaskRefs[0];
	const task = manifest.catalog.tasks.find((candidate) => candidate.taskRef === taskRef);
	if (
		task === undefined ||
		input.hostOutcome.taskRef !== taskRef ||
		input.hostOutcome.taskDigest !== empiricalStrictJsonDigest(task)
	) {
		throw new TypeError("B112 smoke observation is not for the preregistered first task");
	}
	const route = input.route.qualification;
	if ((input.executionClass === "live-provider") !== (route.dispatchMode === "live-approved")) {
		throw new TypeError("smoke execution class does not match route dispatch approval");
	}
	const costLedger = validateCostLedger(input.costLedger, input.executionClass);
	const verifierStatus =
		input.hostOutcome.verifierVerdict === null
			? ("not-run" as const)
			: input.hostOutcome.verifierVerdict;
	const classification =
		input.hostOutcome.status === "non-evaluable"
			? ("non-evaluable" as const)
			: verifierStatus === "passed"
				? ("complete" as const)
				: ("incomplete" as const);
	const issueCodes = sortedUniqueCoordinates(
		[
			...input.hostOutcome.issueCodes,
			...(classification === "incomplete" ? ["smoke-cold-failed-warm-arms-not-attempted"] : []),
		],
		"smoke.issueCodes",
	);
	const latencyMs = input.hostOutcome.turnEvidence.reduce((total, turn) => {
		const next = total + turn.latencyMs;
		if (!Number.isSafeInteger(next)) throw new TypeError("smoke latency total overflow");
		return next;
	}, 0);
	const hasLiveProviderAttempt = input.hostOutcome.remoteRequests > 0;
	const executionClass: EmpiricalSmokeEvidenceClassV1 =
		input.executionClass === "live-provider" && !hasLiveProviderAttempt
			? "live-approved-no-provider-evidence"
			: input.executionClass;
	const observation = strictSnapshot({
		schemaVersion: EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		executionClass,
		empiricalLiveEvidence: executionClass === "live-provider",
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		campaignRef: manifest.campaignRef,
		manifestDigest: input.frozen.manifestDigest,
		profile: "smoke" as const,
		taskRef,
		taskDigest: input.hostOutcome.taskDigest,
		trialBlockRef: coordinate(input.trialBlockRef, "smoke.trialBlockRef"),
		trialBlockDigest: digest(input.trialBlockDigest, "smoke.trialBlockDigest"),
		route: {
			qualificationRef: route.qualificationRef,
			qualificationRevision: route.qualificationRevision,
			qualificationDigest: input.route.qualificationDigest,
			configurationRef: route.configurationRef,
			configurationDigest: route.configurationDigest,
			model: route.requestModel,
			modelIdentityKind: route.modelIdentityKind,
			providerFamily: "openrouter" as const,
			downstreamProviderSlug: route.downstreamProviderSlug,
			downstreamProviderName: route.downstreamProviderName,
			endpoint: route.endpoint,
			endpointRevision: route.endpointRevision,
			adapterRevision: route.adapterRevision,
			bindingRevision: route.bindingRevision,
			capabilitiesDigest: route.capabilitiesDigest,
			settingsDigest: route.settingsDigest,
			usageSource: route.usageSource,
			usageRevision: route.usageRevision,
			routeEvidenceSchemaRevision: route.routeEvidenceSchemaRevision,
			pricingSourceUrl: route.pricing.sourceUrl,
			pricingRevision: route.pricing.pricingRevision,
			inputMicrousdPerMillionTokens: route.pricing.inputMicrousdPerMillionTokens,
			outputMicrousdPerMillionTokens: route.pricing.outputMicrousdPerMillionTokens,
			budgetApprovalRef: route.budget.approvalRef,
			budgetApprovalRevision: route.budget.approvalRevision,
			maxSmokeSpendMicrousd: route.budget.maxSmokeSpendMicrousd,
			maxRequests: route.budget.maxRequests,
			maxStepsPerRun: route.budget.maxStepsPerRun,
			maxCanonicalRequestBytes: route.budget.maxCanonicalRequestBytes,
			maxInputTokens: route.budget.maxInputTokens,
			maxOutputTokens: route.budget.maxOutputTokens,
			maxLatencyMs: route.budget.maxLatencyMs,
			reservationRevision: route.budget.reservationRevision,
		},
		result: {
			classification,
			verifierStatus,
			coldRunsAttempted: 1 as const,
			warmRunsAttempted: 0 as const,
			requests: input.hostOutcome.remoteRequests,
			steps: input.hostOutcome.turnCount,
			inputTokens: summedProviderUsage(input.hostOutcome, "inputTokens"),
			outputTokens: summedProviderUsage(input.hostOutcome, "outputTokens"),
			totalTokens: summedProviderUsage(input.hostOutcome, "totalTokens"),
			hostInputBytes: input.hostOutcome.hostInputBytes,
			hostOutputBytes: input.hostOutcome.hostOutputBytes,
			latencyMs,
			costMicrousd: costLedger.costMicrousd,
			costBasis: costLedger.costBasis,
			reservedInputTokens: costLedger.reservedInputTokens,
			reservedOutputTokens: costLedger.reservedOutputTokens,
		},
		hostOutcomeDigest: empiricalStrictJsonDigest(input.hostOutcome),
		routeEvidenceDigests: sortedUniqueCoordinates(
			input.hostOutcome.turnEvidence.flatMap((turn) =>
				turn.evidenceRefs.map((evidence) => evidence.digest),
			),
			"smoke.routeEvidenceDigests",
		),
		verifierEvidenceDigests: sortedUniqueCoordinates(
			input.hostOutcome.verifierEvidenceRefs.map((evidence) => evidence.digest),
			"smoke.verifierEvidenceDigests",
		),
		protectionReceiptDigests: sortedUniqueCoordinates(
			input.hostOutcome.turnEvidence.map((turn) => turn.protectionReceipt.receiptDigest),
			"smoke.protectionReceiptDigests",
		),
		issueCodes,
	});
	return validateEmpiricalTrialBlockObservation(observation);
}

function validateCostLedger(
	value: EmpiricalSmokeCostLedgerV1,
	executionClass: EmpiricalTrialBlockObservationV1["executionClass"],
): EmpiricalSmokeCostLedgerV1 {
	const ledger = record(value, "smoke.costLedger");
	exactKeys(
		ledger,
		["costBasis", "costMicrousd", "reservedInputTokens", "reservedOutputTokens"],
		"smoke.costLedger",
	);
	const costBasis = oneOf(
		ledger.costBasis,
		["simulated-contract", "provider-usage", "conservative-reservation"],
		"smoke.costLedger.costBasis",
	);
	if (
		(executionClass === "simulated-contract") !== (costBasis === "simulated-contract") ||
		(costBasis === "simulated-contract" && ledger.costMicrousd !== 0)
	) {
		throw new TypeError("simulated smoke cost must remain contract-only and zero");
	}
	return strictSnapshot({
		costBasis,
		reservedInputTokens: safeInteger(
			ledger.reservedInputTokens,
			"smoke.costLedger.reservedInputTokens",
			{ min: 0 },
		),
		reservedOutputTokens: safeInteger(
			ledger.reservedOutputTokens,
			"smoke.costLedger.reservedOutputTokens",
			{ min: 0 },
		),
		costMicrousd: safeInteger(ledger.costMicrousd, "smoke.costLedger.costMicrousd", {
			min: 0,
		}),
	});
}

export function validateEmpiricalTrialBlockObservation(
	value: unknown,
): EmpiricalTrialBlockObservationV1 {
	const observation = record(value, "trialBlockObservation");
	exactKeys(
		observation,
		[
			"campaignRef",
			"claimBoundary",
			"empiricalLiveEvidence",
			"executionClass",
			"hostOutcomeDigest",
			"issueCodes",
			"manifestDigest",
			"profile",
			"protectionReceiptDigests",
			"result",
			"route",
			"routeEvidenceDigests",
			"schemaVersion",
			"taskDigest",
			"taskRef",
			"trialBlockDigest",
			"trialBlockRef",
			"verifierEvidenceDigests",
		],
		"trialBlockObservation",
	);
	literal(
		observation.schemaVersion,
		EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		"trialBlockObservation.schemaVersion",
	);
	const executionClass = oneOf(
		observation.executionClass,
		["simulated-contract", "live-approved-no-provider-evidence", "live-provider"],
		"trialBlockObservation.executionClass",
	);
	literal(
		observation.empiricalLiveEvidence,
		executionClass === "live-provider",
		"trialBlockObservation.empiricalLiveEvidence",
	);
	literal(
		observation.claimBoundary,
		B112_SMOKE_NO_EFFICACY_CLAIM,
		"trialBlockObservation.claimBoundary",
	);
	literal(observation.profile, "smoke", "trialBlockObservation.profile");
	const route = validateObservationRoute(observation.route);
	const result = validateObservationResult(observation.result);
	const routeEvidenceDigests = validateDigestList(
		observation.routeEvidenceDigests,
		"trialBlockObservation.routeEvidenceDigests",
	);
	const verifierEvidenceDigests = validateDigestList(
		observation.verifierEvidenceDigests,
		"trialBlockObservation.verifierEvidenceDigests",
	);
	const protectionReceiptDigests = validateDigestList(
		observation.protectionReceiptDigests,
		"trialBlockObservation.protectionReceiptDigests",
	);
	const issueCodes = validateCoordinateList(
		observation.issueCodes,
		"trialBlockObservation.issueCodes",
	);
	const hasBudgetExhaustion =
		result.classification === "non-evaluable" && issueCodes.includes("smoke-budget-exhausted");
	const postAttemptBudgetExceeded =
		(result.inputTokens !== null && result.inputTokens > route.maxInputTokens) ||
		(result.outputTokens !== null && result.outputTokens > route.maxOutputTokens) ||
		result.latencyMs > route.maxLatencyMs ||
		result.costMicrousd > route.maxSmokeSpendMicrousd;
	if (
		(executionClass === "simulated-contract") !== (result.costBasis === "simulated-contract") ||
		(executionClass === "simulated-contract" && result.costMicrousd !== 0) ||
		(executionClass === "live-approved-no-provider-evidence" &&
			(result.requests !== 0 ||
				result.costBasis !== "conservative-reservation" ||
				result.inputTokens !== null ||
				result.outputTokens !== null ||
				result.totalTokens !== null)) ||
		(executionClass === "live-provider" && result.requests === 0) ||
		result.requests > route.maxRequests ||
		result.steps > route.maxStepsPerRun ||
		(postAttemptBudgetExceeded && !hasBudgetExhaustion)
	) {
		throw new TypeError("trial observation result exceeds or mismatches its frozen route budget");
	}
	if (
		(result.classification === "complete") !== (result.verifierStatus === "passed") ||
		(result.classification === "incomplete") !== (result.verifierStatus === "failed")
	) {
		throw new TypeError("trial observation classification does not match verifier status");
	}
	if (
		(result.steps > 0 && protectionReceiptDigests.length !== result.steps) ||
		(executionClass === "live-approved-no-provider-evidence" &&
			routeEvidenceDigests.length !== 0) ||
		(hasBudgetExhaustion &&
			result.inputTokens !== null &&
			result.outputTokens !== null &&
			routeEvidenceDigests.length !== result.requests) ||
		(result.classification === "complete" &&
			(result.requests === 0 ||
				routeEvidenceDigests.length !== result.requests ||
				verifierEvidenceDigests.length === 0))
	) {
		throw new TypeError("trial observation lacks required frozen evidence");
	}
	return strictSnapshot({
		schemaVersion: EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		executionClass,
		empiricalLiveEvidence: executionClass === "live-provider",
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		campaignRef: coordinate(observation.campaignRef, "trialBlockObservation.campaignRef"),
		manifestDigest: digest(observation.manifestDigest, "trialBlockObservation.manifestDigest"),
		profile: "smoke" as const,
		taskRef: coordinate(observation.taskRef, "trialBlockObservation.taskRef"),
		taskDigest: digest(observation.taskDigest, "trialBlockObservation.taskDigest"),
		trialBlockRef: coordinate(observation.trialBlockRef, "trialBlockObservation.trialBlockRef"),
		trialBlockDigest: digest(
			observation.trialBlockDigest,
			"trialBlockObservation.trialBlockDigest",
		),
		route,
		result,
		hostOutcomeDigest: digest(
			observation.hostOutcomeDigest,
			"trialBlockObservation.hostOutcomeDigest",
		),
		routeEvidenceDigests,
		verifierEvidenceDigests,
		protectionReceiptDigests,
		issueCodes,
	});
}

function validateObservationRoute(value: unknown): EmpiricalTrialBlockObservationV1["route"] {
	const route = record(value, "trialBlockObservation.route");
	const keys = [
		"adapterRevision",
		"bindingRevision",
		"budgetApprovalRef",
		"budgetApprovalRevision",
		"capabilitiesDigest",
		"configurationDigest",
		"configurationRef",
		"downstreamProviderName",
		"downstreamProviderSlug",
		"endpoint",
		"endpointRevision",
		"inputMicrousdPerMillionTokens",
		"maxCanonicalRequestBytes",
		"maxInputTokens",
		"maxLatencyMs",
		"maxOutputTokens",
		"maxRequests",
		"maxSmokeSpendMicrousd",
		"maxStepsPerRun",
		"model",
		"modelIdentityKind",
		"outputMicrousdPerMillionTokens",
		"pricingRevision",
		"pricingSourceUrl",
		"providerFamily",
		"qualificationDigest",
		"qualificationRef",
		"qualificationRevision",
		"routeEvidenceSchemaRevision",
		"reservationRevision",
		"settingsDigest",
		"usageRevision",
		"usageSource",
	] as const;
	exactKeys(route, keys, "trialBlockObservation.route");
	literal(route.providerFamily, "openrouter", "trialBlockObservation.route.providerFamily");
	return strictSnapshot({
		qualificationRef: coordinate(
			route.qualificationRef,
			"trialBlockObservation.route.qualificationRef",
		),
		qualificationRevision: coordinate(
			route.qualificationRevision,
			"trialBlockObservation.route.qualificationRevision",
		),
		qualificationDigest: digest(
			route.qualificationDigest,
			"trialBlockObservation.route.qualificationDigest",
		),
		configurationRef: coordinate(
			route.configurationRef,
			"trialBlockObservation.route.configurationRef",
		),
		configurationDigest: digest(
			route.configurationDigest,
			"trialBlockObservation.route.configurationDigest",
		),
		model: coordinate(route.model, "trialBlockObservation.route.model"),
		modelIdentityKind: oneOf(
			route.modelIdentityKind,
			["exact-snapshot", "alias-disclosed"],
			"trialBlockObservation.route.modelIdentityKind",
		),
		providerFamily: "openrouter" as const,
		downstreamProviderSlug: coordinate(
			route.downstreamProviderSlug,
			"trialBlockObservation.route.downstreamProviderSlug",
		),
		downstreamProviderName: coordinate(
			route.downstreamProviderName,
			"trialBlockObservation.route.downstreamProviderName",
		),
		endpoint: coordinate(route.endpoint, "trialBlockObservation.route.endpoint"),
		endpointRevision: coordinate(
			route.endpointRevision,
			"trialBlockObservation.route.endpointRevision",
		),
		adapterRevision: coordinate(
			route.adapterRevision,
			"trialBlockObservation.route.adapterRevision",
		),
		bindingRevision: coordinate(
			route.bindingRevision,
			"trialBlockObservation.route.bindingRevision",
		),
		capabilitiesDigest: digest(
			route.capabilitiesDigest,
			"trialBlockObservation.route.capabilitiesDigest",
		),
		settingsDigest: digest(route.settingsDigest, "trialBlockObservation.route.settingsDigest"),
		usageSource: coordinate(route.usageSource, "trialBlockObservation.route.usageSource"),
		usageRevision: coordinate(route.usageRevision, "trialBlockObservation.route.usageRevision"),
		routeEvidenceSchemaRevision: coordinate(
			route.routeEvidenceSchemaRevision,
			"trialBlockObservation.route.routeEvidenceSchemaRevision",
		),
		pricingSourceUrl: coordinate(
			route.pricingSourceUrl,
			"trialBlockObservation.route.pricingSourceUrl",
		),
		pricingRevision: coordinate(
			route.pricingRevision,
			"trialBlockObservation.route.pricingRevision",
		),
		inputMicrousdPerMillionTokens: safeInteger(
			route.inputMicrousdPerMillionTokens,
			"trialBlockObservation.route.inputMicrousdPerMillionTokens",
			{ min: 1 },
		),
		outputMicrousdPerMillionTokens: safeInteger(
			route.outputMicrousdPerMillionTokens,
			"trialBlockObservation.route.outputMicrousdPerMillionTokens",
			{ min: 1 },
		),
		budgetApprovalRef: coordinate(
			route.budgetApprovalRef,
			"trialBlockObservation.route.budgetApprovalRef",
		),
		budgetApprovalRevision: coordinate(
			route.budgetApprovalRevision,
			"trialBlockObservation.route.budgetApprovalRevision",
		),
		maxSmokeSpendMicrousd: safeInteger(
			route.maxSmokeSpendMicrousd,
			"trialBlockObservation.route.maxSmokeSpendMicrousd",
			{ min: 1 },
		),
		maxRequests: safeInteger(route.maxRequests, "trialBlockObservation.route.maxRequests", {
			min: 1,
			max: 24,
		}),
		maxStepsPerRun: safeInteger(
			route.maxStepsPerRun,
			"trialBlockObservation.route.maxStepsPerRun",
			{ min: 1, max: 64 },
		),
		maxCanonicalRequestBytes: safeInteger(
			route.maxCanonicalRequestBytes,
			"trialBlockObservation.route.maxCanonicalRequestBytes",
			{ min: 1, max: 262_144 },
		),
		maxInputTokens: safeInteger(
			route.maxInputTokens,
			"trialBlockObservation.route.maxInputTokens",
			{ min: 1 },
		),
		maxOutputTokens: safeInteger(
			route.maxOutputTokens,
			"trialBlockObservation.route.maxOutputTokens",
			{ min: 1 },
		),
		maxLatencyMs: safeInteger(route.maxLatencyMs, "trialBlockObservation.route.maxLatencyMs", {
			min: 1,
			max: 86_400_000,
		}),
		reservationRevision: coordinate(
			route.reservationRevision,
			"trialBlockObservation.route.reservationRevision",
		),
	});
}

function validateObservationResult(value: unknown): EmpiricalTrialBlockObservationV1["result"] {
	const result = record(value, "trialBlockObservation.result");
	exactKeys(
		result,
		[
			"classification",
			"coldRunsAttempted",
			"costBasis",
			"costMicrousd",
			"hostInputBytes",
			"hostOutputBytes",
			"inputTokens",
			"latencyMs",
			"outputTokens",
			"requests",
			"reservedInputTokens",
			"reservedOutputTokens",
			"steps",
			"totalTokens",
			"verifierStatus",
			"warmRunsAttempted",
		],
		"trialBlockObservation.result",
	);
	const nullableTokens = (item: unknown, path: string): number | null =>
		item === null ? null : safeInteger(item, path, { min: 0 });
	return strictSnapshot({
		classification: oneOf(
			result.classification,
			["complete", "incomplete", "non-evaluable"],
			"trialBlockObservation.result.classification",
		),
		verifierStatus: oneOf(
			result.verifierStatus,
			["passed", "failed", "unverifiable", "not-run"],
			"trialBlockObservation.result.verifierStatus",
		),
		coldRunsAttempted: literal(
			result.coldRunsAttempted,
			1,
			"trialBlockObservation.result.coldRunsAttempted",
		),
		warmRunsAttempted: literal(
			result.warmRunsAttempted,
			0,
			"trialBlockObservation.result.warmRunsAttempted",
		),
		requests: safeInteger(result.requests, "trialBlockObservation.result.requests", {
			min: 0,
			max: 24,
		}),
		steps: safeInteger(result.steps, "trialBlockObservation.result.steps", { min: 0, max: 64 }),
		inputTokens: nullableTokens(result.inputTokens, "trialBlockObservation.result.inputTokens"),
		outputTokens: nullableTokens(result.outputTokens, "trialBlockObservation.result.outputTokens"),
		totalTokens: nullableTokens(result.totalTokens, "trialBlockObservation.result.totalTokens"),
		hostInputBytes: safeInteger(
			result.hostInputBytes,
			"trialBlockObservation.result.hostInputBytes",
			{ min: 0 },
		),
		hostOutputBytes: safeInteger(
			result.hostOutputBytes,
			"trialBlockObservation.result.hostOutputBytes",
			{ min: 0 },
		),
		latencyMs: safeInteger(result.latencyMs, "trialBlockObservation.result.latencyMs", {
			min: 0,
			max: 86_400_000,
		}),
		costMicrousd: safeInteger(result.costMicrousd, "trialBlockObservation.result.costMicrousd", {
			min: 0,
		}),
		costBasis: oneOf(
			result.costBasis,
			["simulated-contract", "provider-usage", "conservative-reservation"],
			"trialBlockObservation.result.costBasis",
		),
		reservedInputTokens: safeInteger(
			result.reservedInputTokens,
			"trialBlockObservation.result.reservedInputTokens",
			{ min: 0 },
		),
		reservedOutputTokens: safeInteger(
			result.reservedOutputTokens,
			"trialBlockObservation.result.reservedOutputTokens",
			{ min: 0 },
		),
	});
}

function validateDigestList(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length > 128) throw new TypeError(`${path} exceeds its bounded item count`);
	const validated = values.map((item, index) => digest(item, `${path}[${index}]`));
	if (
		new Set(validated).size !== validated.length ||
		[...validated].sort().join() !== validated.join()
	) {
		throw new TypeError(`${path} must be unique and canonical-sort ordered`);
	}
	return Object.freeze(validated);
}

function validateCoordinateList(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length > 128) throw new TypeError(`${path} exceeds its bounded item count`);
	const validated = values.map((item, index) => coordinate(item, `${path}[${index}]`));
	if (
		new Set(validated).size !== validated.length ||
		[...validated].sort().join() !== validated.join()
	) {
		throw new TypeError(`${path} must be unique and canonical-sort ordered`);
	}
	return Object.freeze(validated);
}

export function createEmpiricalCampaignScorecard(
	observationValue: EmpiricalTrialBlockObservationV1,
	aggregationRevision: string,
): EmpiricalCampaignScorecardV1 {
	const observation = validateEmpiricalTrialBlockObservation(observationValue);
	const complete = observation.result.classification === "complete" ? 1 : 0;
	const incomplete = observation.result.classification === "incomplete" ? 1 : 0;
	const nonEvaluable = observation.result.classification === "non-evaluable" ? 1 : 0;
	return validateEmpiricalCampaignScorecard({
		schemaVersion: EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA,
		campaignRef: observation.campaignRef,
		manifestDigest: observation.manifestDigest,
		profile: "smoke" as const,
		evidenceClass: observation.executionClass,
		empiricalLiveEvidence: observation.empiricalLiveEvidence,
		efficacyClaim: "none" as const,
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		aggregationRevision: coordinate(aggregationRevision, "scorecard.aggregationRevision"),
		observationDigests: [empiricalStrictJsonDigest(observation)] as const,
		attemptedBlocks: 1 as const,
		completeBlocks: complete as 0 | 1,
		incompleteBlocks: incomplete as 0 | 1,
		nonEvaluableBlocks: nonEvaluable as 0 | 1,
		verifierPassedBlocks: (observation.result.verifierStatus === "passed" ? 1 : 0) as 0 | 1,
		requests: observation.result.requests,
		steps: observation.result.steps,
		inputTokens: observation.result.inputTokens,
		outputTokens: observation.result.outputTokens,
		totalTokens: observation.result.totalTokens,
		hostInputBytes: observation.result.hostInputBytes,
		hostOutputBytes: observation.result.hostOutputBytes,
		latencyMs: observation.result.latencyMs,
		costMicrousd: observation.result.costMicrousd,
		costBasis: observation.result.costBasis,
		reservedInputTokens: observation.result.reservedInputTokens,
		reservedOutputTokens: observation.result.reservedOutputTokens,
		status:
			complete === 1
				? ("smoke-complete-no-efficacy-claim" as const)
				: incomplete === 1
					? ("incomplete" as const)
					: ("non-evaluable" as const),
		issueCodes: observation.issueCodes,
	});
}

export function validateEmpiricalCampaignScorecard(value: unknown): EmpiricalCampaignScorecardV1 {
	const scorecard = record(value, "campaignScorecard");
	exactKeys(
		scorecard,
		[
			"aggregationRevision",
			"attemptedBlocks",
			"campaignRef",
			"claimBoundary",
			"completeBlocks",
			"costBasis",
			"costMicrousd",
			"efficacyClaim",
			"empiricalLiveEvidence",
			"evidenceClass",
			"hostInputBytes",
			"hostOutputBytes",
			"incompleteBlocks",
			"inputTokens",
			"issueCodes",
			"latencyMs",
			"manifestDigest",
			"nonEvaluableBlocks",
			"observationDigests",
			"outputTokens",
			"profile",
			"requests",
			"reservedInputTokens",
			"reservedOutputTokens",
			"schemaVersion",
			"status",
			"steps",
			"totalTokens",
			"verifierPassedBlocks",
		],
		"campaignScorecard",
	);
	literal(
		scorecard.schemaVersion,
		EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA,
		"campaignScorecard.schemaVersion",
	);
	const evidenceClass = oneOf(
		scorecard.evidenceClass,
		["simulated-contract", "live-approved-no-provider-evidence", "live-provider"],
		"campaignScorecard.evidenceClass",
	);
	literal(
		scorecard.empiricalLiveEvidence,
		evidenceClass === "live-provider",
		"campaignScorecard.empiricalLiveEvidence",
	);
	literal(scorecard.profile, "smoke", "campaignScorecard.profile");
	literal(scorecard.efficacyClaim, "none", "campaignScorecard.efficacyClaim");
	literal(scorecard.claimBoundary, B112_SMOKE_NO_EFFICACY_CLAIM, "campaignScorecard.claimBoundary");
	literal(scorecard.attemptedBlocks, 1, "campaignScorecard.attemptedBlocks");
	const completeBlocks = zeroOrOne(scorecard.completeBlocks, "campaignScorecard.completeBlocks");
	const incompleteBlocks = zeroOrOne(
		scorecard.incompleteBlocks,
		"campaignScorecard.incompleteBlocks",
	);
	const nonEvaluableBlocks = zeroOrOne(
		scorecard.nonEvaluableBlocks,
		"campaignScorecard.nonEvaluableBlocks",
	);
	if (completeBlocks + incompleteBlocks + nonEvaluableBlocks !== 1) {
		throw new TypeError("campaign scorecard must classify its one attempted block exactly once");
	}
	const status = oneOf(
		scorecard.status,
		["smoke-complete-no-efficacy-claim", "incomplete", "non-evaluable"],
		"campaignScorecard.status",
	);
	if (
		(status === "smoke-complete-no-efficacy-claim") !== (completeBlocks === 1) ||
		(status === "incomplete") !== (incompleteBlocks === 1) ||
		(status === "non-evaluable") !== (nonEvaluableBlocks === 1)
	) {
		throw new TypeError("campaign scorecard status does not match block classification");
	}
	const observationDigests = validateDigestList(
		scorecard.observationDigests,
		"campaignScorecard.observationDigests",
	);
	if (observationDigests.length !== 1) {
		throw new TypeError("smoke scorecard requires exactly one frozen observation digest");
	}
	const verifierPassedBlocks = zeroOrOne(
		scorecard.verifierPassedBlocks,
		"campaignScorecard.verifierPassedBlocks",
	);
	if (verifierPassedBlocks !== completeBlocks) {
		throw new TypeError("campaign scorecard verifier count does not match complete blocks");
	}
	const nullableTokens = (item: unknown, path: string): number | null =>
		item === null ? null : safeInteger(item, path, { min: 0 });
	const requests = safeInteger(scorecard.requests, "campaignScorecard.requests", {
		min: 0,
		max: 24,
	});
	const costBasis = oneOf(
		scorecard.costBasis,
		["simulated-contract", "provider-usage", "conservative-reservation"],
		"campaignScorecard.costBasis",
	);
	if (
		(evidenceClass === "simulated-contract") !== (costBasis === "simulated-contract") ||
		(evidenceClass === "live-approved-no-provider-evidence" &&
			(requests !== 0 ||
				costBasis !== "conservative-reservation" ||
				scorecard.inputTokens !== null ||
				scorecard.outputTokens !== null ||
				scorecard.totalTokens !== null)) ||
		(evidenceClass === "live-provider" && requests === 0)
	) {
		throw new TypeError("campaign scorecard evidence and cost provenance do not match");
	}
	return strictSnapshot({
		schemaVersion: EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA,
		campaignRef: coordinate(scorecard.campaignRef, "campaignScorecard.campaignRef"),
		manifestDigest: digest(scorecard.manifestDigest, "campaignScorecard.manifestDigest"),
		profile: "smoke" as const,
		evidenceClass,
		empiricalLiveEvidence: evidenceClass === "live-provider",
		efficacyClaim: "none" as const,
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		aggregationRevision: coordinate(
			scorecard.aggregationRevision,
			"campaignScorecard.aggregationRevision",
		),
		observationDigests: observationDigests as readonly [string],
		attemptedBlocks: 1 as const,
		completeBlocks,
		incompleteBlocks,
		nonEvaluableBlocks,
		verifierPassedBlocks,
		requests,
		steps: safeInteger(scorecard.steps, "campaignScorecard.steps", { min: 0, max: 64 }),
		inputTokens: nullableTokens(scorecard.inputTokens, "campaignScorecard.inputTokens"),
		outputTokens: nullableTokens(scorecard.outputTokens, "campaignScorecard.outputTokens"),
		totalTokens: nullableTokens(scorecard.totalTokens, "campaignScorecard.totalTokens"),
		hostInputBytes: safeInteger(scorecard.hostInputBytes, "campaignScorecard.hostInputBytes", {
			min: 0,
		}),
		hostOutputBytes: safeInteger(scorecard.hostOutputBytes, "campaignScorecard.hostOutputBytes", {
			min: 0,
		}),
		latencyMs: safeInteger(scorecard.latencyMs, "campaignScorecard.latencyMs", {
			min: 0,
			max: 86_400_000,
		}),
		costMicrousd: safeInteger(scorecard.costMicrousd, "campaignScorecard.costMicrousd", {
			min: 0,
		}),
		costBasis,
		reservedInputTokens: safeInteger(
			scorecard.reservedInputTokens,
			"campaignScorecard.reservedInputTokens",
			{ min: 0 },
		),
		reservedOutputTokens: safeInteger(
			scorecard.reservedOutputTokens,
			"campaignScorecard.reservedOutputTokens",
			{ min: 0 },
		),
		status,
		issueCodes: validateCoordinateList(scorecard.issueCodes, "campaignScorecard.issueCodes"),
	});
}

function zeroOrOne(value: unknown, path: string): 0 | 1 {
	const validated = safeInteger(value, path, { min: 0, max: 1 });
	return validated as 0 | 1;
}
