import {
	boolean,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	httpsEndpoint,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import type {
	EmpiricalModelConfigurationV1,
	EmpiricalTaskQualificationReportV1,
	EmpiricalUsageSource,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import { validateFrozenEmpiricalCampaignManifest } from "./qualification.js";

export const OPENROUTER_ROUTE_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-route-qualification.v1";
export const OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-shared-capacity-qualification.v1";
export const OPENROUTER_RESPONSES_ENDPOINT = "https://openrouter.ai/api/v1/responses";
export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_FIRST_SMOKE_REQUEST_MODEL = "openai/gpt-5.6-sol";
export const OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG = "openai";
export const OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME = "OpenAI";
export const OPENROUTER_GLM_5_2_REQUEST_MODEL = "z-ai/glm-5.2";
export const OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_SLUG = "decart/fp4";
export const OPENROUTER_GLM_5_2_DOWNSTREAM_PROVIDER_NAME = "Decart";
export const OPENROUTER_RESPONSES_ENDPOINT_REVISION = "openrouter-responses-2026-07-29.v2";
export const OPENROUTER_RESPONSES_ADAPTER_REVISION = "graphrefly-openrouter-responses-turn.v2";
export const OPENROUTER_RESPONSES_BINDING_REVISION = "graphrefly-openrouter-responses-wire.v8";
export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION =
	"openrouter-chat-completions-2026-07-30.v1";
export const OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION =
	"graphrefly-openrouter-chat-completions-turn.v1";
export const OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION =
	"graphrefly-openrouter-chat-completions-wire.v12";
export const OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION = "openrouter-metadata-2026-07-29.v1";
export const OPENROUTER_PROVIDER_USAGE_REVISION =
	"openrouter-provider-reported-cost-microusd-2026-07-29.v2";
export const OPENROUTER_OFFICIAL_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/openai/gpt-5.6-sol/endpoints";
export const OPENROUTER_OFFICIAL_PRICING_REVISION =
	"openrouter-openai-gpt-5.6-sol-openai-under-272k-cache-write-ceiling-2026-07-29.v3";
export const OPENROUTER_FIRST_SMOKE_STANDARD_PRICING_MAX_INPUT_TOKENS = 272_000;
export const OPENROUTER_GLM_5_2_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/z-ai/glm-5.2/endpoints";
export const OPENROUTER_GLM_5_2_PRICING_REVISION =
	"openrouter-z-ai-glm-5.2-decart-fp4-2026-07-30.v1";
export const OPENROUTER_GLM_5_2_INPUT_MICROUSD_PER_MILLION_TOKENS = 600_000;
export const OPENROUTER_GLM_5_2_OUTPUT_MICROUSD_PER_MILLION_TOKENS = 1_250_000;

export type OpenRouterEndpointV1 =
	| typeof OPENROUTER_RESPONSES_ENDPOINT
	| typeof OPENROUTER_CHAT_COMPLETIONS_ENDPOINT;

export interface OpenRouterSharedCapacityQualificationV1 {
	readonly schemaVersion: typeof OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA;
	readonly qualificationRef: string;
	readonly qualificationRevision: string;
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly workspaceRef: string;
	readonly workspaceRevision: string;
	readonly capacityMode: "openrouter-shared-only";
	readonly qualified: true;
	readonly byokCredentialCount: 0;
}

export interface OpenRouterRouteQualificationV1 {
	readonly schemaVersion: typeof OPENROUTER_ROUTE_QUALIFICATION_SCHEMA;
	readonly qualificationRef: string;
	readonly qualificationRevision: string;
	readonly dispatchMode: "simulated" | "live-approved";
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly configurationRef: string;
	readonly configurationDigest: string;
	readonly requestModel: string;
	readonly modelIdentityKind: "exact-snapshot" | "alias-disclosed";
	readonly downstreamProviderSlug: string;
	readonly downstreamProviderName: string;
	readonly endpoint: OpenRouterEndpointV1;
	readonly endpointRevision: string;
	readonly adapterRevision: string;
	readonly bindingRevision: string;
	readonly capabilitiesDigest: string;
	readonly settingsDigest: string;
	readonly usageSource: EmpiricalUsageSource;
	readonly usageRevision: string;
	readonly routeEvidenceSchemaRevision: string;
	readonly pricing: {
		readonly sourceUrl: string;
		readonly pricingRevision: string;
		readonly currency: "USD";
		readonly inputMicrousdPerMillionTokens: number;
		readonly outputMicrousdPerMillionTokens: number;
	};
	readonly budget: {
		readonly approvalRef: string;
		readonly approvalRevision: string;
		readonly maxSmokeSpendMicrousd: number;
		readonly maxRequests: number;
		readonly maxStepsPerRun: number;
		readonly maxCanonicalRequestBytes: number;
		readonly maxInputTokens: number;
		readonly maxOutputTokens: number;
		readonly maxLatencyMs: number;
		readonly reservationRevision: string;
		readonly inputTokensPerCanonicalByteUpperBound: 1;
		readonly fixedInputTokenOverheadPerRequest: number;
	};
	readonly keySpendLimit: {
		readonly qualificationRef: string;
		readonly qualificationRevision: string;
		readonly readOnlyQualified: boolean;
		readonly limitReset: "none";
		readonly limitMicrousd: number;
		readonly remainingMicrousd: number;
		readonly credentialBindingRef: string;
		readonly credentialBindingRevision: string;
		readonly workspaceRef: string;
		readonly workspaceRevision: string;
	};
	readonly sharedCapacityQualification: OpenRouterSharedCapacityQualificationV1;
}

export interface QualifiedOpenRouterRouteV1 {
	readonly qualification: OpenRouterRouteQualificationV1;
	readonly qualificationDigest: string;
}

function qualifiedWireProfile(endpoint: unknown): {
	readonly endpoint: OpenRouterEndpointV1;
	readonly endpointRevision: string;
	readonly adapterRevision: string;
	readonly bindingRevision: string;
} {
	if (endpoint === OPENROUTER_RESPONSES_ENDPOINT) {
		return {
			endpoint: OPENROUTER_RESPONSES_ENDPOINT,
			endpointRevision: OPENROUTER_RESPONSES_ENDPOINT_REVISION,
			adapterRevision: OPENROUTER_RESPONSES_ADAPTER_REVISION,
			bindingRevision: OPENROUTER_RESPONSES_BINDING_REVISION,
		};
	}
	if (endpoint === OPENROUTER_CHAT_COMPLETIONS_ENDPOINT) {
		return {
			endpoint: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
			endpointRevision: OPENROUTER_CHAT_COMPLETIONS_ENDPOINT_REVISION,
			adapterRevision: OPENROUTER_CHAT_COMPLETIONS_ADAPTER_REVISION,
			bindingRevision: OPENROUTER_CHAT_COMPLETIONS_BINDING_REVISION,
		};
	}
	throw new TypeError("OpenRouter route qualification uses an unsupported wire endpoint");
}

export function validateOpenRouterSharedCapacityQualification(
	value: unknown,
	credentialBindingRef: string,
	credentialBindingRevision: string,
): OpenRouterSharedCapacityQualificationV1 {
	const qualification = record(value, "openRouter.sharedCapacityQualification");
	exactKeys(
		qualification,
		[
			"byokCredentialCount",
			"capacityMode",
			"credentialBindingRef",
			"credentialBindingRevision",
			"qualificationRef",
			"qualificationRevision",
			"qualified",
			"schemaVersion",
			"workspaceRef",
			"workspaceRevision",
		],
		"openRouter.sharedCapacityQualification",
	);
	literal(
		qualification.schemaVersion,
		OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
		"openRouter.sharedCapacityQualification.schemaVersion",
	);
	literal(
		qualification.capacityMode,
		"openrouter-shared-only",
		"openRouter.sharedCapacityQualification.capacityMode",
	);
	literal(qualification.qualified, true, "openRouter.sharedCapacityQualification.qualified");
	literal(
		qualification.byokCredentialCount,
		0,
		"openRouter.sharedCapacityQualification.byokCredentialCount",
	);
	literal(
		qualification.credentialBindingRef,
		credentialBindingRef,
		"openRouter.sharedCapacityQualification.credentialBindingRef",
	);
	literal(
		qualification.credentialBindingRevision,
		credentialBindingRevision,
		"openRouter.sharedCapacityQualification.credentialBindingRevision",
	);
	return strictSnapshot({
		schemaVersion: OPENROUTER_SHARED_CAPACITY_QUALIFICATION_SCHEMA,
		qualificationRef: coordinate(
			qualification.qualificationRef,
			"openRouter.sharedCapacityQualification.qualificationRef",
		),
		qualificationRevision: coordinate(
			qualification.qualificationRevision,
			"openRouter.sharedCapacityQualification.qualificationRevision",
		),
		credentialBindingRef,
		credentialBindingRevision,
		workspaceRef: coordinate(
			qualification.workspaceRef,
			"openRouter.sharedCapacityQualification.workspaceRef",
		),
		workspaceRevision: coordinate(
			qualification.workspaceRevision,
			"openRouter.sharedCapacityQualification.workspaceRevision",
		),
		capacityMode: "openrouter-shared-only" as const,
		qualified: true as const,
		byokCredentialCount: 0 as const,
	});
}

export function validateOpenRouterRouteQualification(
	value: unknown,
	configuration: EmpiricalModelConfigurationV1,
	credentialBindingRef: string,
	credentialBindingRevision: string,
	campaignRef: string,
	manifestDigest: string,
): QualifiedOpenRouterRouteV1 {
	const qualification = record(value, "openRouter.routeQualification");
	exactKeys(
		qualification,
		[
			"adapterRevision",
			"bindingRevision",
			"budget",
			"campaignRef",
			"capabilitiesDigest",
			"configurationDigest",
			"configurationRef",
			"dispatchMode",
			"downstreamProviderName",
			"downstreamProviderSlug",
			"endpoint",
			"endpointRevision",
			"keySpendLimit",
			"manifestDigest",
			"modelIdentityKind",
			"pricing",
			"qualificationRef",
			"qualificationRevision",
			"requestModel",
			"routeEvidenceSchemaRevision",
			"schemaVersion",
			"settingsDigest",
			"sharedCapacityQualification",
			"trialBlockDigest",
			"trialBlockRef",
			"usageRevision",
			"usageSource",
		],
		"openRouter.routeQualification",
	);
	literal(
		qualification.schemaVersion,
		OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
		"openRouter.routeQualification.schemaVersion",
	);
	const dispatchMode = oneOf(
		qualification.dispatchMode,
		["simulated", "live-approved"],
		"openRouter.routeQualification.dispatchMode",
	);
	const configurationDigest = digest(
		qualification.configurationDigest,
		"openRouter.routeQualification.configurationDigest",
	);
	const qualifiedCampaignRef = coordinate(
		qualification.campaignRef,
		"openRouter.routeQualification.campaignRef",
	);
	const qualifiedManifestDigest = digest(
		qualification.manifestDigest,
		"openRouter.routeQualification.manifestDigest",
	);
	if (
		qualifiedCampaignRef !== campaignRef ||
		qualifiedManifestDigest !== manifestDigest ||
		qualification.configurationRef !== configuration.configurationRef ||
		configurationDigest !== empiricalStrictJsonDigest(configuration) ||
		qualification.requestModel !== configuration.model ||
		qualification.modelIdentityKind !== configuration.modelIdentityKind ||
		qualification.endpoint !== configuration.endpoint ||
		qualification.endpointRevision !== configuration.endpointRevision ||
		qualification.adapterRevision !== configuration.adapterRevision ||
		qualification.bindingRevision !== configuration.bindingRevision ||
		qualification.capabilitiesDigest !== empiricalStrictJsonDigest(configuration.capabilities) ||
		qualification.settingsDigest !== empiricalStrictJsonDigest(configuration.settings) ||
		qualification.usageSource !== configuration.usageSource
	) {
		throw new TypeError("OpenRouter route qualification does not match its frozen configuration");
	}
	const wireProfile = qualifiedWireProfile(
		httpsEndpoint(qualification.endpoint, "openRouter.routeQualification.endpoint"),
	);
	literal(qualification.endpoint, wireProfile.endpoint, "openRouter.routeQualification.endpoint");
	literal(
		qualification.endpointRevision,
		wireProfile.endpointRevision,
		"openRouter.routeQualification.endpointRevision",
	);
	literal(
		qualification.adapterRevision,
		wireProfile.adapterRevision,
		"openRouter.routeQualification.adapterRevision",
	);
	literal(
		qualification.bindingRevision,
		wireProfile.bindingRevision,
		"openRouter.routeQualification.bindingRevision",
	);
	literal(
		qualification.routeEvidenceSchemaRevision,
		OPENROUTER_ROUTE_EVIDENCE_SCHEMA_REVISION,
		"openRouter.routeQualification.routeEvidenceSchemaRevision",
	);
	const downstreamProviderSlug = coordinate(
		qualification.downstreamProviderSlug,
		"openRouter.routeQualification.downstreamProviderSlug",
	);
	if (downstreamProviderSlug !== downstreamProviderSlug.toLowerCase()) {
		throw new TypeError("OpenRouter downstream provider slug must already be canonical lowercase");
	}
	const pricing = record(qualification.pricing, "openRouter.routeQualification.pricing");
	exactKeys(
		pricing,
		[
			"currency",
			"inputMicrousdPerMillionTokens",
			"outputMicrousdPerMillionTokens",
			"pricingRevision",
			"sourceUrl",
		],
		"openRouter.routeQualification.pricing",
	);
	literal(pricing.currency, "USD", "openRouter.routeQualification.pricing.currency");
	literal(
		pricing.pricingRevision,
		configuration.pricingRevision,
		"openRouter.routeQualification.pricing.pricingRevision",
	);
	literal(
		pricing.sourceUrl,
		configuration.pricingScheduleRef,
		"openRouter.routeQualification.pricing.sourceUrl",
	);
	const budget = validateBudget(qualification.budget);
	const sharedCapacityQualification = validateOpenRouterSharedCapacityQualification(
		qualification.sharedCapacityQualification,
		credentialBindingRef,
		credentialBindingRevision,
	);
	const keySpendLimit = validateKeySpendLimit(
		qualification.keySpendLimit,
		dispatchMode,
		budget,
		sharedCapacityQualification,
	);
	const validated: OpenRouterRouteQualificationV1 = strictSnapshot({
		schemaVersion: OPENROUTER_ROUTE_QUALIFICATION_SCHEMA,
		qualificationRef: coordinate(
			qualification.qualificationRef,
			"openRouter.routeQualification.qualificationRef",
		),
		qualificationRevision: coordinate(
			qualification.qualificationRevision,
			"openRouter.routeQualification.qualificationRevision",
		),
		dispatchMode,
		campaignRef: qualifiedCampaignRef,
		manifestDigest: qualifiedManifestDigest,
		trialBlockRef: coordinate(
			qualification.trialBlockRef,
			"openRouter.routeQualification.trialBlockRef",
		),
		trialBlockDigest: digest(
			qualification.trialBlockDigest,
			"openRouter.routeQualification.trialBlockDigest",
		),
		configurationRef: configuration.configurationRef,
		configurationDigest,
		requestModel: coordinate(
			qualification.requestModel,
			"openRouter.routeQualification.requestModel",
		),
		modelIdentityKind: oneOf(
			qualification.modelIdentityKind,
			["exact-snapshot", "alias-disclosed"],
			"openRouter.routeQualification.modelIdentityKind",
		),
		downstreamProviderSlug,
		downstreamProviderName: coordinate(
			qualification.downstreamProviderName,
			"openRouter.routeQualification.downstreamProviderName",
		),
		endpoint: wireProfile.endpoint,
		endpointRevision: coordinate(
			qualification.endpointRevision,
			"openRouter.routeQualification.endpointRevision",
		),
		adapterRevision: coordinate(
			qualification.adapterRevision,
			"openRouter.routeQualification.adapterRevision",
		),
		bindingRevision: coordinate(
			qualification.bindingRevision,
			"openRouter.routeQualification.bindingRevision",
		),
		capabilitiesDigest: digest(
			qualification.capabilitiesDigest,
			"openRouter.routeQualification.capabilitiesDigest",
		),
		settingsDigest: digest(
			qualification.settingsDigest,
			"openRouter.routeQualification.settingsDigest",
		),
		usageSource: oneOf(
			qualification.usageSource,
			["provider-reported", "provider-count-endpoint", "adapter-estimated", "host-measured"],
			"openRouter.routeQualification.usageSource",
		),
		usageRevision: coordinate(
			qualification.usageRevision,
			"openRouter.routeQualification.usageRevision",
		),
		routeEvidenceSchemaRevision: coordinate(
			qualification.routeEvidenceSchemaRevision,
			"openRouter.routeQualification.routeEvidenceSchemaRevision",
		),
		pricing: {
			sourceUrl: string(pricing.sourceUrl, "openRouter.routeQualification.pricing.sourceUrl", 512),
			pricingRevision: coordinate(
				pricing.pricingRevision,
				"openRouter.routeQualification.pricing.pricingRevision",
			),
			currency: "USD" as const,
			inputMicrousdPerMillionTokens: safeInteger(
				pricing.inputMicrousdPerMillionTokens,
				"openRouter.routeQualification.pricing.inputMicrousdPerMillionTokens",
				{ min: 1, max: 1_000_000_000 },
			),
			outputMicrousdPerMillionTokens: safeInteger(
				pricing.outputMicrousdPerMillionTokens,
				"openRouter.routeQualification.pricing.outputMicrousdPerMillionTokens",
				{ min: 1, max: 1_000_000_000 },
			),
		},
		budget,
		keySpendLimit,
		sharedCapacityQualification,
	});
	return Object.freeze({
		qualification: validated,
		qualificationDigest: empiricalStrictJsonDigest(validated),
	});
}

/**
 * Package-private acquisition seam for an operator-supplied, out-of-band
 * read-only qualification. This owns no OpenRouter management API client and
 * derives the expected credential coordinates from the frozen role policy.
 */
export function validateOperatorSuppliedOpenRouterRouteQualification(
	value: unknown,
	frozenValue: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
	configurationRefValue: string,
): QualifiedOpenRouterRouteV1 {
	const frozen = validateFrozenEmpiricalCampaignManifest(frozenValue, qualificationReport);
	const configurationRef = coordinate(
		configurationRefValue,
		"openRouter.operatorQualification.configurationRef",
	);
	const configuration = frozen.manifest.modelConfigurations.find(
		(candidate) => candidate.configurationRef === configurationRef,
	);
	if (configuration === undefined) {
		throw new TypeError("operator-supplied OpenRouter qualification configuration is not frozen");
	}
	let credentialBindingRef: string | null;
	let credentialBindingRevision: string | null;
	if (configuration.role === "actor") {
		credentialBindingRef = frozen.manifest.policies.actorCredentialBindingRef;
		credentialBindingRevision = frozen.manifest.policies.actorCredentialBindingRevision;
	} else {
		const policy =
			configuration.role === "auxiliary-judge"
				? frozen.manifest.policies.auxiliaryJudge
				: frozen.manifest.policies.semanticRedactor;
		credentialBindingRef = policy.credentialBindingRef;
		credentialBindingRevision = policy.credentialBindingRevision;
	}
	if (credentialBindingRef === null || credentialBindingRevision === null) {
		throw new TypeError("frozen OpenRouter role has no credential binding coordinates");
	}
	return validateOpenRouterRouteQualification(
		value,
		configuration,
		credentialBindingRef,
		credentialBindingRevision,
		frozen.manifest.campaignRef,
		frozen.manifestDigest,
	);
}

function validateBudget(value: unknown): OpenRouterRouteQualificationV1["budget"] {
	const budget = record(value, "openRouter.routeQualification.budget");
	exactKeys(
		budget,
		[
			"approvalRef",
			"approvalRevision",
			"fixedInputTokenOverheadPerRequest",
			"inputTokensPerCanonicalByteUpperBound",
			"maxCanonicalRequestBytes",
			"maxInputTokens",
			"maxLatencyMs",
			"maxOutputTokens",
			"maxRequests",
			"maxSmokeSpendMicrousd",
			"maxStepsPerRun",
			"reservationRevision",
		],
		"openRouter.routeQualification.budget",
	);
	literal(
		budget.inputTokensPerCanonicalByteUpperBound,
		1,
		"openRouter.routeQualification.budget.inputTokensPerCanonicalByteUpperBound",
	);
	return strictSnapshot({
		approvalRef: coordinate(budget.approvalRef, "openRouter.routeQualification.budget.approvalRef"),
		approvalRevision: coordinate(
			budget.approvalRevision,
			"openRouter.routeQualification.budget.approvalRevision",
		),
		maxSmokeSpendMicrousd: safeInteger(
			budget.maxSmokeSpendMicrousd,
			"openRouter.routeQualification.budget.maxSmokeSpendMicrousd",
			{ min: 1 },
		),
		maxRequests: safeInteger(
			budget.maxRequests,
			"openRouter.routeQualification.budget.maxRequests",
			{
				min: 1,
				max: 48,
			},
		),
		maxStepsPerRun: safeInteger(
			budget.maxStepsPerRun,
			"openRouter.routeQualification.budget.maxStepsPerRun",
			{ min: 1, max: 64 },
		),
		maxCanonicalRequestBytes: safeInteger(
			budget.maxCanonicalRequestBytes,
			"openRouter.routeQualification.budget.maxCanonicalRequestBytes",
			{ min: 1, max: 262_144 },
		),
		maxInputTokens: safeInteger(
			budget.maxInputTokens,
			"openRouter.routeQualification.budget.maxInputTokens",
			{ min: 1, max: 2_000_000 },
		),
		maxOutputTokens: safeInteger(
			budget.maxOutputTokens,
			"openRouter.routeQualification.budget.maxOutputTokens",
			{ min: 1, max: 1_000_000 },
		),
		maxLatencyMs: safeInteger(
			budget.maxLatencyMs,
			"openRouter.routeQualification.budget.maxLatencyMs",
			{ min: 1, max: 86_400_000 },
		),
		reservationRevision: coordinate(
			budget.reservationRevision,
			"openRouter.routeQualification.budget.reservationRevision",
		),
		inputTokensPerCanonicalByteUpperBound: 1 as const,
		fixedInputTokenOverheadPerRequest: safeInteger(
			budget.fixedInputTokenOverheadPerRequest,
			"openRouter.routeQualification.budget.fixedInputTokenOverheadPerRequest",
			{ min: 0, max: 65_536 },
		),
	});
}

function validateKeySpendLimit(
	value: unknown,
	dispatchMode: OpenRouterRouteQualificationV1["dispatchMode"],
	budget: OpenRouterRouteQualificationV1["budget"],
	sharedCapacity: OpenRouterSharedCapacityQualificationV1,
): OpenRouterRouteQualificationV1["keySpendLimit"] {
	const limit = record(value, "openRouter.routeQualification.keySpendLimit");
	exactKeys(
		limit,
		[
			"credentialBindingRef",
			"credentialBindingRevision",
			"limitMicrousd",
			"limitReset",
			"qualificationRef",
			"qualificationRevision",
			"readOnlyQualified",
			"remainingMicrousd",
			"workspaceRef",
			"workspaceRevision",
		],
		"openRouter.routeQualification.keySpendLimit",
	);
	const readOnlyQualified = boolean(
		limit.readOnlyQualified,
		"openRouter.routeQualification.keySpendLimit.readOnlyQualified",
	);
	const limitMicrousd = safeInteger(
		limit.limitMicrousd,
		"openRouter.routeQualification.keySpendLimit.limitMicrousd",
		{ min: 1 },
	);
	const remainingMicrousd = safeInteger(
		limit.remainingMicrousd,
		"openRouter.routeQualification.keySpendLimit.remainingMicrousd",
		{ min: 0, max: limitMicrousd },
	);
	const credentialBindingRef = coordinate(
		limit.credentialBindingRef,
		"openRouter.routeQualification.keySpendLimit.credentialBindingRef",
	);
	const credentialBindingRevision = coordinate(
		limit.credentialBindingRevision,
		"openRouter.routeQualification.keySpendLimit.credentialBindingRevision",
	);
	const workspaceRef = coordinate(
		limit.workspaceRef,
		"openRouter.routeQualification.keySpendLimit.workspaceRef",
	);
	const workspaceRevision = coordinate(
		limit.workspaceRevision,
		"openRouter.routeQualification.keySpendLimit.workspaceRevision",
	);
	if (
		credentialBindingRef !== sharedCapacity.credentialBindingRef ||
		credentialBindingRevision !== sharedCapacity.credentialBindingRevision ||
		workspaceRef !== sharedCapacity.workspaceRef ||
		workspaceRevision !== sharedCapacity.workspaceRevision
	) {
		throw new TypeError(
			"OpenRouter key spend qualification does not match the qualified credential workspace",
		);
	}
	if (
		dispatchMode === "live-approved" &&
		(!readOnlyQualified ||
			budget.maxSmokeSpendMicrousd > limitMicrousd ||
			remainingMicrousd < budget.maxSmokeSpendMicrousd)
	) {
		throw new TypeError("live OpenRouter key spend limit does not prove the approved smoke budget");
	}
	return strictSnapshot({
		qualificationRef: coordinate(
			limit.qualificationRef,
			"openRouter.routeQualification.keySpendLimit.qualificationRef",
		),
		qualificationRevision: coordinate(
			limit.qualificationRevision,
			"openRouter.routeQualification.keySpendLimit.qualificationRevision",
		),
		readOnlyQualified,
		limitReset: literal(
			limit.limitReset,
			"none",
			"openRouter.routeQualification.keySpendLimit.limitReset",
		),
		limitMicrousd,
		remainingMicrousd,
		credentialBindingRef,
		credentialBindingRevision,
		workspaceRef,
		workspaceRevision,
	});
}

export function calculateOpenRouterCostMicrousd(
	inputTokens: number,
	outputTokens: number,
	pricing: OpenRouterRouteQualificationV1["pricing"],
): number {
	const input = safeInteger(inputTokens, "openRouter.cost.inputTokens", { min: 0 });
	const output = safeInteger(outputTokens, "openRouter.cost.outputTokens", { min: 0 });
	const numerator =
		input * pricing.inputMicrousdPerMillionTokens + output * pricing.outputMicrousdPerMillionTokens;
	if (!Number.isSafeInteger(numerator)) throw new TypeError("OpenRouter cost calculation overflow");
	return Math.ceil(numerator / 1_000_000);
}
