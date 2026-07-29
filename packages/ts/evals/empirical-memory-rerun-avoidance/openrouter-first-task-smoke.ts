import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, safeInteger, strictSnapshot } from "./canonical.js";
import {
	type ClosedTaskProfileHostRunInputV1,
	runClosedTaskProfileHost,
} from "./closed-task-profile-host.js";
import {
	createEmpiricalCampaignScorecard,
	createEmpiricalTrialBlockObservation,
	type EmpiricalCampaignScorecardV1,
	type EmpiricalSmokeCostLedgerV1,
	type EmpiricalTrialBlockObservationV1,
} from "./empirical-smoke-evidence.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelTurnEvidenceRefV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
} from "./model-execution.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	OPENROUTER_RESPONSES_ISSUE_CODES,
	type OpenRouterResponsesByteTransportV1,
	type OpenRouterResponsesCredentialCapabilityV1,
	type OpenRouterResponsesMonotonicMeasurementV1,
	type OpenRouterResponsesTransportAdmissionV1,
} from "./openrouter-responses-model-turn.js";
import {
	calculateOpenRouterCostMicrousd,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";
import {
	type PersistedPrivateSmokeGenerationV1,
	persistPrivateSmokeGeneration,
} from "./private-smoke-persistence.js";

export const OPENROUTER_API_KEY_ENVIRONMENT_NAME = "OPENROUTER_API_KEY";
export const B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION =
	"b112-first-task-smoke-single-observation.v1";
export const B112_SMOKE_BUDGET_ISSUE_CODE = "smoke-budget-exhausted";

export interface OpenRouterFirstTaskSmokeResultV1 {
	readonly observation: EmpiricalTrialBlockObservationV1;
	readonly scorecard: EmpiricalCampaignScorecardV1;
	readonly persistence: PersistedPrivateSmokeGenerationV1;
}

function assertFirstSmokeRoute(route: OpenRouterRouteQualificationV1): void {
	if (
		route.requestModel !== OPENROUTER_FIRST_SMOKE_REQUEST_MODEL ||
		route.downstreamProviderSlug !== OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG ||
		route.downstreamProviderName !== OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME ||
		route.pricing.sourceUrl !== OPENROUTER_OFFICIAL_PRICING_SOURCE ||
		route.pricing.pricingRevision !== OPENROUTER_OFFICIAL_PRICING_REVISION ||
		route.pricing.inputMicrousdPerMillionTokens !== 5_000_000 ||
		route.pricing.outputMicrousdPerMillionTokens !== 30_000_000
	) {
		throw new TypeError("B112 first smoke route does not match its frozen exact route and pricing");
	}
	if (route.dispatchMode === "live-approved") {
		const liveCoordinates = [
			route.qualificationRef,
			route.qualificationRevision,
			route.budget.approvalRef,
			route.budget.approvalRevision,
			route.keySpendLimit.qualificationRef,
			route.keySpendLimit.qualificationRevision,
			route.sharedCapacityQualification.qualificationRef,
			route.sharedCapacityQualification.qualificationRevision,
			route.sharedCapacityQualification.workspaceRef,
			route.sharedCapacityQualification.workspaceRevision,
		];
		if (liveCoordinates.some((value) => /pending|placeholder|simulated/i.test(value))) {
			throw new TypeError("live B112 route still contains unapproved qualification coordinates");
		}
	}
}

/**
 * Outermost operator-only loader. The caller supplies an environment snapshot;
 * neither the model-turn binding nor transport can discover ambient state.
 */
export function createOpenRouterCredentialCapabilityFromOperatorEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
	routeQualification: OpenRouterRouteQualificationV1,
): OpenRouterResponsesCredentialCapabilityV1 {
	if (routeQualification.dispatchMode !== "live-approved") {
		throw new TypeError("OpenRouter credential construction requires a live-approved route");
	}
	const bearerToken = environment[OPENROUTER_API_KEY_ENVIRONMENT_NAME];
	if (typeof bearerToken !== "string" || bearerToken.length < 16 || bearerToken.length > 4_096) {
		throw new TypeError(`operator environment must provide ${OPENROUTER_API_KEY_ENVIRONMENT_NAME}`);
	}
	return Object.freeze({
		credentialBindingRef: routeQualification.sharedCapacityQualification.credentialBindingRef,
		credentialBindingRevision:
			routeQualification.sharedCapacityQualification.credentialBindingRevision,
		bearerToken,
	});
}

interface MutableSmokeBudget {
	requests: number;
	reservedInputTokens: number;
	reservedOutputTokens: number;
	reservedCostMicrousd: number;
	allProviderUsageKnown: boolean;
	providerInputTokens: number;
	providerOutputTokens: number;
	latencyMs: number;
	exhausted: boolean;
}

function budgetExhaustedOutcome(
	request: EmpiricalModelTurnRequestV1,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	usage: EmpiricalModelTurnOutcomeV1["usage"] = {
		source: request.usageSource,
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		requests: 0,
		hostInputBytes: 0,
		hostOutputBytes: 0,
	},
	latencyMs = 0,
	evidenceRefs: readonly EmpiricalModelTurnEvidenceRefV1[] = [],
): EmpiricalModelTurnOutcomeV1 {
	const issueCodes = [B112_SMOKE_BUDGET_ISSUE_CODE];
	const protectedSubject = strictJsonCodec.decode(
		strictJsonCodec.encode({
			evidenceRefs,
			issueCodes,
			structuredOutput: null,
			toolIntents: [],
		}),
	) as StrictJsonValue;
	const protectionReceipt = executeEmpiricalProtection(protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: protectedSubject,
	}).receipt;
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
		requestRef: request.requestRef,
		requestDigest: empiricalStrictJsonDigest(request),
		configurationRef: request.configurationRef,
		configurationDigest: request.configurationDigest,
		role: request.role,
		status: "non-evaluable" as const,
		finishReason: null,
		outputSchemaDigest: request.outputSchema.schemaDigest,
		structuredOutput: null,
		structuredOutputDigest: null,
		toolIntents: [],
		usage,
		latencyMs,
		issueCodes,
		evidenceRefs,
		protectionReceipt,
	});
}

function createBudgetedModelTurnPort(
	delegate: EmpiricalModelTurnPortV1,
	route: OpenRouterRouteQualificationV1,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	ledger: MutableSmokeBudget,
): EmpiricalModelTurnPortV1 {
	return Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1, signal: AbortSignal) {
			const outcome = await delegate.invoke(request, signal);
			if (
				ledger.exhausted &&
				outcome.issueCodes.includes(OPENROUTER_RESPONSES_ISSUE_CODES.transportAdmissionRejected)
			) {
				return budgetExhaustedOutcome(request, protectionExecutor);
			}
			if (outcome.usage.inputTokens === null || outcome.usage.outputTokens === null) {
				ledger.allProviderUsageKnown = false;
			} else {
				ledger.providerInputTokens += outcome.usage.inputTokens;
				ledger.providerOutputTokens += outcome.usage.outputTokens;
			}
			ledger.latencyMs += outcome.latencyMs;
			const providerCost = calculateOpenRouterCostMicrousd(
				ledger.providerInputTokens,
				ledger.providerOutputTokens,
				route.pricing,
			);
			if (
				ledger.latencyMs > route.budget.maxLatencyMs ||
				ledger.providerInputTokens > route.budget.maxInputTokens ||
				ledger.providerOutputTokens > route.budget.maxOutputTokens ||
				providerCost > route.budget.maxSmokeSpendMicrousd
			) {
				ledger.exhausted = true;
				return budgetExhaustedOutcome(
					request,
					protectionExecutor,
					outcome.usage,
					outcome.latencyMs,
					outcome.evidenceRefs,
				);
			}
			return outcome;
		},
	});
}

function createSmokeTransportAdmission(
	route: OpenRouterRouteQualificationV1,
	ledger: MutableSmokeBudget,
): OpenRouterResponsesTransportAdmissionV1 {
	return Object.freeze({
		admit(input: Parameters<OpenRouterResponsesTransportAdmissionV1["admit"]>[0]) {
			const wireRequestBytes = safeInteger(input.wireRequestBytes, "smoke.wireRequestBytes", {
				min: 1,
			});
			const maxOutputTokens = safeInteger(input.maxOutputTokens, "smoke.maxOutputTokens", {
				min: 1,
			});
			const reservedInputTokens =
				wireRequestBytes * route.budget.inputTokensPerCanonicalByteUpperBound +
				route.budget.fixedInputTokenOverheadPerRequest;
			const prospectiveInputTokens = ledger.reservedInputTokens + reservedInputTokens;
			const prospectiveOutputTokens = ledger.reservedOutputTokens + maxOutputTokens;
			const prospectiveCost = calculateOpenRouterCostMicrousd(
				prospectiveInputTokens,
				prospectiveOutputTokens,
				route.pricing,
			);
			if (
				ledger.requests >= route.budget.maxRequests ||
				ledger.requests >= route.budget.maxStepsPerRun ||
				wireRequestBytes > route.budget.maxCanonicalRequestBytes ||
				prospectiveInputTokens > route.budget.maxInputTokens ||
				prospectiveOutputTokens > route.budget.maxOutputTokens ||
				prospectiveCost > route.budget.maxSmokeSpendMicrousd
			) {
				ledger.exhausted = true;
				return false;
			}
			ledger.requests += 1;
			ledger.reservedInputTokens = prospectiveInputTokens;
			ledger.reservedOutputTokens = prospectiveOutputTokens;
			ledger.reservedCostMicrousd = prospectiveCost;
			return true;
		},
	});
}

function finalCostLedger(
	ledger: MutableSmokeBudget,
	executionClass: "simulated-contract" | "live-provider",
	route: OpenRouterRouteQualificationV1,
): EmpiricalSmokeCostLedgerV1 {
	if (executionClass === "simulated-contract") {
		return Object.freeze({
			costBasis: "simulated-contract",
			reservedInputTokens: ledger.reservedInputTokens,
			reservedOutputTokens: ledger.reservedOutputTokens,
			costMicrousd: 0,
		});
	}
	const providerCost = calculateOpenRouterCostMicrousd(
		ledger.providerInputTokens,
		ledger.providerOutputTokens,
		route.pricing,
	);
	return Object.freeze({
		costBasis: ledger.allProviderUsageKnown ? "provider-usage" : "conservative-reservation",
		reservedInputTokens: ledger.reservedInputTokens,
		reservedOutputTokens: ledger.reservedOutputTokens,
		costMicrousd: ledger.allProviderUsageKnown ? providerCost : ledger.reservedCostMicrousd,
	});
}

/**
 * Executes exactly the preregistered first task as one cold attempted smoke
 * block, emits no efficacy claim, and never auto-runs warm/calibration work.
 */
export async function runOpenRouterFirstTaskSmoke(input: {
	readonly host: Omit<
		ClosedTaskProfileHostRunInputV1,
		"modelTurnPort" | "protectionExecutor" | "signal"
	>;
	readonly routeQualification: OpenRouterRouteQualificationV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly signal: AbortSignal;
}): Promise<OpenRouterFirstTaskSmokeResultV1> {
	const trialPlan = input.host.frozen.manifest.trialPlan;
	if (
		trialPlan.profile !== "smoke" ||
		input.host.initialRequest.taskRef !== trialPlan.activeTaskRefs[0] ||
		input.host.initialRequest.trialStage !== "cold"
	) {
		throw new TypeError("OpenRouter smoke runner accepts only the preregistered first cold task");
	}
	if (
		(input.executionClass === "live-provider") !==
		(input.routeQualification.dispatchMode === "live-approved")
	) {
		throw new TypeError("OpenRouter smoke execution class does not match route dispatch approval");
	}
	assertFirstSmokeRoute(input.routeQualification);
	if (
		input.routeQualification.campaignRef !== input.host.frozen.manifest.campaignRef ||
		input.routeQualification.manifestDigest !== input.host.frozen.manifestDigest ||
		input.routeQualification.trialBlockRef !== input.host.initialRequest.trialBlockRef ||
		input.routeQualification.trialBlockDigest !== input.host.initialRequest.trialBlockDigest
	) {
		throw new TypeError("OpenRouter smoke route does not qualify this frozen trial block");
	}
	const manifestBudgets = input.host.frozen.manifest.budgets;
	if (
		input.routeQualification.budget.maxRequests >
			Math.min(
				manifestBudgets.campaign.maxRequests,
				manifestBudgets.taskModel.maxRequests,
				manifestBudgets.agentRun.maxRequests,
			) ||
		input.routeQualification.budget.maxStepsPerRun > manifestBudgets.agentRun.maxSteps ||
		input.routeQualification.budget.maxSmokeSpendMicrousd >
			Math.min(
				manifestBudgets.campaign.maxCostMicrousd,
				manifestBudgets.taskModel.maxCostMicrousd,
			) ||
		input.routeQualification.budget.maxLatencyMs >
			Math.min(manifestBudgets.campaign.maxElapsedMs, manifestBudgets.agentRun.maxElapsedMs)
	) {
		throw new TypeError("OpenRouter route budget exceeds the frozen D652 host budget");
	}
	safeInteger(input.routeQualification.budget.maxLatencyMs, "smoke.maxLatencyMs", {
		min: 1,
	});
	const ledger: MutableSmokeBudget = {
		requests: 0,
		reservedInputTokens: 0,
		reservedOutputTokens: 0,
		reservedCostMicrousd: 0,
		allProviderUsageKnown: true,
		providerInputTokens: 0,
		providerOutputTokens: 0,
		latencyMs: 0,
		exhausted: false,
	};
	const binding = createOpenRouterResponsesEmpiricalBinding({
		frozen: input.host.frozen,
		qualificationReport: input.host.qualificationReport,
		configurationRef: input.host.initialRequest.configurationRef,
		routeQualification: input.routeQualification,
		credential: input.credential,
		transport: input.transport,
		transportAdmission: createSmokeTransportAdmission(input.routeQualification, ledger),
		monotonicMeasurement: input.monotonicMeasurement,
	});
	const outcome = await runClosedTaskProfileHost({
		...input.host,
		modelTurnPort: createBudgetedModelTurnPort(
			binding.modelTurnPort,
			input.routeQualification,
			binding.protectionExecutor,
			ledger,
		),
		protectionExecutor: binding.protectionExecutor,
		signal: input.signal,
	});
	const route = Object.freeze({
		qualification: input.routeQualification,
		qualificationDigest: binding.routeQualificationDigest,
	});
	const observation = createEmpiricalTrialBlockObservation({
		frozen: input.host.frozen,
		route,
		hostOutcome: outcome,
		executionClass: input.executionClass,
		trialBlockRef: input.host.initialRequest.trialBlockRef,
		trialBlockDigest: input.host.initialRequest.trialBlockDigest,
		costLedger: finalCostLedger(ledger, input.executionClass, input.routeQualification),
	});
	const scorecard = createEmpiricalCampaignScorecard(
		observation,
		B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
	);
	const persistence = await persistPrivateSmokeGeneration({
		privateRoot: input.privateRoot,
		generationRef: input.generationRef,
		observation,
		scorecard,
		protectionExecutor: binding.protectionExecutor,
	});
	return Object.freeze({ observation, scorecard, persistence });
}
