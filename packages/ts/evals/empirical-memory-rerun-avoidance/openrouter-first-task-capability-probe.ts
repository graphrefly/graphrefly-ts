import { strictSnapshot } from "./canonical.js";
import type {
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import type { EmpiricalModelTurnRequestV1 } from "./model-execution.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	type OpenRouterResponsesByteTransportV1,
	type OpenRouterResponsesCredentialCapabilityV1,
	type OpenRouterResponsesMonotonicMeasurementV1,
	type OpenRouterResponsesTransportAdmissionV1,
} from "./openrouter-responses-model-turn.js";
import {
	OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
	OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
	OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_GLM_5_2_DEEPINFRA_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_REVISION,
	OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_SOURCE,
	OPENROUTER_GLM_5_2_REQUEST_MODEL,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";

export const B112_OPENROUTER_CAPABILITY_PROBE_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-capability-probe.v1";
export const B112_OPENROUTER_CAPABILITY_PROBE_MAX_REQUESTS = 1;
export const B112_OPENROUTER_CAPABILITY_PROBE_MAX_SPEND_MICROUSD = 20_000;

export interface OpenRouterFirstTaskCapabilityProbeResultV1 {
	readonly schemaVersion: typeof B112_OPENROUTER_CAPABILITY_PROBE_SCHEMA;
	readonly capable: boolean;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly evidenceClass: "mechanical-capability-only";
	readonly efficacyClaim: "none";
	readonly status: "completed" | "non-evaluable";
	readonly finishReason: "tool-intents" | null;
	readonly toolIntentCount: number;
	readonly requests: number;
	readonly providerCostMicrousd: number | null;
	readonly issueCodes: readonly string[];
}

function conservativeCostMicrousd(
	route: OpenRouterRouteQualificationV1,
	wireRequestBytes: number,
	maxOutputTokens: number,
): number {
	const inputTokens =
		wireRequestBytes * route.budget.inputTokensPerCanonicalByteUpperBound +
		route.budget.fixedInputTokenOverheadPerRequest;
	if (inputTokens > route.budget.maxInputTokens || maxOutputTokens > route.budget.maxOutputTokens) {
		return Number.MAX_SAFE_INTEGER;
	}
	return (
		Math.ceil((inputTokens * route.pricing.inputMicrousdPerMillionTokens) / 1_000_000) +
		Math.ceil((maxOutputTokens * route.pricing.outputMicrousdPerMillionTokens) / 1_000_000)
	);
}

function assertD673ProbeRoute(
	frozen: FrozenEmpiricalCampaignManifestV1,
	request: EmpiricalModelTurnRequestV1,
	route: OpenRouterRouteQualificationV1,
): void {
	const configuration = frozen.manifest.modelConfigurations.find(
		(candidate) => candidate.configurationRef === request.configurationRef,
	);
	const firstTaskRef = frozen.manifest.catalog.tasks[0]?.taskRef;
	const effectiveMaxSteps =
		configuration === undefined
			? 0
			: Math.min(
					configuration.settings.tools.maxSteps,
					frozen.manifest.budgets.agentRun.maxSteps,
					frozen.manifest.budgets.agentRun.maxRequests,
					route.budget.maxStepsPerRun,
					route.budget.maxRequests,
					256,
				);
	if (
		configuration === undefined ||
		frozen.manifest.trialPlan.profile !== "smoke" ||
		firstTaskRef === undefined ||
		request.taskRef !== firstTaskRef ||
		request.taskRef !== frozen.manifest.trialPlan.activeTaskRefs[0] ||
		request.trialStage !== "cold" ||
		request.stepIndex !== 0 ||
		request.priorToolResults.length !== 0 ||
		request.availableTools.length === 0 ||
		effectiveMaxSteps <= 1 ||
		configuration.model !== OPENROUTER_GLM_5_2_REQUEST_MODEL ||
		configuration.settings.reasoning.effort !== "high" ||
		configuration.settings.tools.choice !== "required" ||
		route.requestModel !== OPENROUTER_GLM_5_2_REQUEST_MODEL ||
		route.endpoint !== OPENROUTER_CHAT_COMPLETIONS_ENDPOINT ||
		route.bindingRevision !== OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION ||
		route.downstreamProviderSlug !== OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_SLUG ||
		route.downstreamProviderName !== OPENROUTER_GLM_5_2_DEEPINFRA_DOWNSTREAM_PROVIDER_NAME ||
		route.pricing.sourceUrl !== OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_SOURCE ||
		route.pricing.pricingRevision !== OPENROUTER_GLM_5_2_DEEPINFRA_PRICING_REVISION ||
		route.pricing.inputMicrousdPerMillionTokens !==
			OPENROUTER_GLM_5_2_DEEPINFRA_INPUT_MICROUSD_PER_MILLION_TOKENS ||
		route.pricing.outputMicrousdPerMillionTokens !==
			OPENROUTER_GLM_5_2_DEEPINFRA_OUTPUT_MICROUSD_PER_MILLION_TOKENS
	) {
		throw new TypeError("B112 capability probe route does not match frozen D673 coordinates");
	}
}

/**
 * D673's one-request, non-persisted mechanical route probe.
 *
 * This does not run the closed host, verifier, observation, scorecard, retry,
 * reflection, warm branches, or efficacy aggregation.
 */
export async function runOpenRouterFirstTaskCapabilityProbe(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly request: EmpiricalModelTurnRequestV1;
	readonly routeQualification: OpenRouterRouteQualificationV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly signal: AbortSignal;
}): Promise<OpenRouterFirstTaskCapabilityProbeResultV1> {
	assertD673ProbeRoute(input.frozen, input.request, input.routeQualification);
	if (
		(input.executionClass === "live-provider") !==
		(input.routeQualification.dispatchMode === "live-approved")
	) {
		throw new TypeError("B112 capability probe execution class does not match route approval");
	}
	let admittedRequests = 0;
	const binding = createOpenRouterResponsesEmpiricalBinding({
		frozen: input.frozen,
		qualificationReport: input.qualificationReport,
		configurationRef: input.request.configurationRef,
		routeQualification: input.routeQualification,
		credential: input.credential,
		transport: input.transport,
		transportAdmission: Object.freeze({
			admit(admission: Parameters<OpenRouterResponsesTransportAdmissionV1["admit"]>[0]): boolean {
				if (admittedRequests >= B112_OPENROUTER_CAPABILITY_PROBE_MAX_REQUESTS) return false;
				if (
					admission.wireRequestBytes > input.routeQualification.budget.maxCanonicalRequestBytes ||
					conservativeCostMicrousd(
						input.routeQualification,
						admission.wireRequestBytes,
						admission.maxOutputTokens,
					) > B112_OPENROUTER_CAPABILITY_PROBE_MAX_SPEND_MICROUSD
				) {
					return false;
				}
				admittedRequests += 1;
				return true;
			},
		}),
		monotonicMeasurement: input.monotonicMeasurement,
	});
	const outcome = await binding.modelTurnPort.invoke(input.request, input.signal);
	const capable =
		outcome.status === "completed" &&
		outcome.finishReason === "tool-intents" &&
		outcome.toolIntents.length === 1 &&
		outcome.usage.requests === 1 &&
		admittedRequests === 1 &&
		outcome.usage.providerCostMicrousd !== null &&
		outcome.usage.providerCostMicrousd <= B112_OPENROUTER_CAPABILITY_PROBE_MAX_SPEND_MICROUSD;
	const issueCodes = capable
		? []
		: [
				...outcome.issueCodes,
				...(outcome.status === "completed" && outcome.toolIntents.length !== 1
					? ["capability-probe-exactly-one-tool-intent-required"]
					: []),
				...(outcome.usage.providerCostMicrousd !== null &&
				outcome.usage.providerCostMicrousd > B112_OPENROUTER_CAPABILITY_PROBE_MAX_SPEND_MICROUSD
					? ["capability-probe-cost-cap-exceeded"]
					: []),
			].sort();
	return strictSnapshot({
		schemaVersion: B112_OPENROUTER_CAPABILITY_PROBE_SCHEMA,
		capable,
		executionClass: input.executionClass,
		evidenceClass: "mechanical-capability-only" as const,
		efficacyClaim: "none" as const,
		status: outcome.status,
		finishReason: outcome.finishReason === "tool-intents" ? "tool-intents" : null,
		toolIntentCount: outcome.toolIntents.length,
		requests: outcome.usage.requests,
		providerCostMicrousd: outcome.usage.providerCostMicrousd,
		issueCodes,
	});
}
