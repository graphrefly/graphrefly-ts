import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";

export const OPENROUTER_FRESH_PRICING_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-fresh-pricing-observation.v1" as const;
export const D706_FRESH_PRICING_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d706-fresh-pricing-qualification.v1" as const;
export const D706_PRICING_OBSERVATION_REF = "d706-deepseek-v4-flash-0731-deepinfra-fp4" as const;
export const D706_PRICING_OBSERVATION_REVISION =
	"openrouter-deepseek-v4-flash-0731-deepinfra-fp4-observed-2026-08-09.v6" as const;
export const D706_MODEL_SLUG = "deepseek/deepseek-v4-flash-0731" as const;
export const D706_PROVIDER_TAG = "deepinfra/fp4" as const;
export const D706_QUANTIZATION = "fp4" as const;
export const D706_PROMPT_USD_PER_TOKEN = "0.00000009" as const;
export const D706_COMPLETION_USD_PER_TOKEN = "0.00000018" as const;
export const D706_CACHE_READ_USD_PER_TOKEN = "0.000000018" as const;
export const D706_CACHE_READ_MICROUSD_PER_MILLION_TOKENS = 18_000 as const;
export const D706_MAX_OFFICIAL_RESPONSE_BYTES = 1_048_576 as const;

export interface OpenRouterFreshPricingObservationV1 {
	readonly schemaVersion: typeof OPENROUTER_FRESH_PRICING_OBSERVATION_SCHEMA;
	readonly observationRef: typeof D706_PRICING_OBSERVATION_REF;
	readonly observationRevision: typeof D706_PRICING_OBSERVATION_REVISION;
	readonly sourceUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly modelSlug: typeof D706_MODEL_SLUG;
	readonly downstreamProviderName: typeof OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME;
	readonly downstreamProviderSlug: typeof OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG;
	readonly providerTag: typeof D706_PROVIDER_TAG;
	readonly quantization: typeof D706_QUANTIZATION;
	readonly promptUsdPerToken: string;
	readonly completionUsdPerToken: string;
	readonly cacheReadUsdPerToken: string;
	readonly inputMicrousdPerMillionTokens: number;
	readonly outputMicrousdPerMillionTokens: number;
	readonly cacheReadMicrousdPerMillionTokens: number;
	readonly frozenScheduleRevision: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly responseDigest: string;
	readonly matchesFrozenSchedule: true;
	readonly observationDigest: string;
}

export interface OpenRouterFreshPricingScheduleMatchV1 {
	readonly capabilityRef: "openrouter-fresh-pricing-schedule-match";
	readonly capabilityRevision: "decision.D706.2026-08-09.v1";
	readonly observationDigest: string;
	readonly responseDigest: string;
	readonly frozenScheduleRevision: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
}

export interface D706FreshPricingQualificationV1 {
	readonly schemaVersion: typeof D706_FRESH_PRICING_QUALIFICATION_SCHEMA;
	readonly decisionRef: "decision.D706";
	readonly decisionRevision: "decision.D706.2026-08-09.v1";
	readonly executionClass: "simulated-contract";
	readonly observationDigest: string;
	readonly responseDigest: string;
	readonly frozenScheduleRevision: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly routeSchemaChanged: false;
	readonly historicalEvidenceReinterpreted: false;
	readonly providerCalls: 0;
	readonly networkCalls: 0;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualified: true;
	readonly qualificationDigest: string;
}

const constructedObservations = new WeakSet<object>();
const constructedMatches = new WeakSet<object>();
const constructedQualifications = new WeakSet<object>();
const utf8 = new TextDecoder("utf-8", { fatal: true });

function exactUsdPerTokenToMicrousdPerMillion(
	value: unknown,
	path: string,
): {
	readonly atomic: string;
	readonly microusdPerMillionTokens: number;
} {
	const atomic = string(value, path, 32);
	if (!/^(0|[1-9]\d*)\.\d{1,12}$/.test(atomic)) {
		throw new TypeError(`${path}: expected canonical decimal USD-per-token string`);
	}
	const [whole = "0", fractional = ""] = atomic.split(".");
	const scaled = BigInt(whole) * 1_000_000_000_000n + BigInt(fractional.padEnd(12, "0"));
	if (scaled <= 0n || scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new TypeError(`${path}: price is outside the exact integer evidence range`);
	}
	return Object.freeze({ atomic, microusdPerMillionTokens: Number(scaled) });
}

function endpointRecords(responseBytes: Uint8Array): readonly Record<string, unknown>[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(utf8.decode(responseBytes));
	} catch (error) {
		throw new TypeError("D706 official pricing response is not strict UTF-8 JSON", {
			cause: error,
		});
	}
	const root = record(parsed, "d706.officialResponse");
	const data = record(root.data, "d706.officialResponse.data");
	literal(data.id, D706_MODEL_SLUG, "d706.officialResponse.data.id");
	return array(data.endpoints, "d706.officialResponse.data.endpoints").map((value, index) =>
		record(value, `d706.officialResponse.data.endpoints[${index}]`),
	);
}

export function createD706FreshPricingObservation(input: {
	readonly sourceUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly responseBytes: Uint8Array;
}): OpenRouterFreshPricingObservationV1 {
	const request = record(input, "d706.pricingObservationInput");
	exactKeys(request, ["responseBytes", "sourceUrl"], "d706.pricingObservationInput");
	literal(
		request.sourceUrl,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		"d706.pricingObservationInput.sourceUrl",
	);
	if (!(request.responseBytes instanceof Uint8Array)) {
		throw new TypeError("D706 pricing observation requires Uint8Array response bytes");
	}
	const responseBytes = new Uint8Array(request.responseBytes);
	if (
		responseBytes.byteLength === 0 ||
		responseBytes.byteLength > D706_MAX_OFFICIAL_RESPONSE_BYTES
	) {
		throw new TypeError("D706 official pricing response byte bound exceeded");
	}
	const matches = endpointRecords(responseBytes).filter(
		(endpoint) =>
			endpoint.provider_name === OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME &&
			endpoint.tag === D706_PROVIDER_TAG &&
			endpoint.quantization === D706_QUANTIZATION,
	);
	if (matches.length !== 1) {
		throw new TypeError("D706 requires exactly one DeepInfra fp4 official pricing endpoint");
	}
	const endpoint = matches[0];
	if (endpoint === undefined) throw new TypeError("D706 official endpoint selection failed");
	const pricing = record(endpoint.pricing, "d706.officialResponse.endpoint.pricing");
	const prompt = exactUsdPerTokenToMicrousdPerMillion(
		pricing.prompt,
		"d706.officialResponse.endpoint.pricing.prompt",
	);
	const completion = exactUsdPerTokenToMicrousdPerMillion(
		pricing.completion,
		"d706.officialResponse.endpoint.pricing.completion",
	);
	const cacheRead = exactUsdPerTokenToMicrousdPerMillion(
		pricing.input_cache_read,
		"d706.officialResponse.endpoint.pricing.input_cache_read",
	);
	literal(prompt.atomic, D706_PROMPT_USD_PER_TOKEN, "d706.officialResponse.promptAtomic");
	literal(
		completion.atomic,
		D706_COMPLETION_USD_PER_TOKEN,
		"d706.officialResponse.completionAtomic",
	);
	literal(cacheRead.atomic, D706_CACHE_READ_USD_PER_TOKEN, "d706.officialResponse.cacheReadAtomic");
	if (
		prompt.microusdPerMillionTokens !==
			OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS ||
		completion.microusdPerMillionTokens !==
			OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS ||
		cacheRead.microusdPerMillionTokens !== D706_CACHE_READ_MICROUSD_PER_MILLION_TOKENS
	) {
		throw new TypeError("D706 fresh pricing does not match the frozen execution schedule");
	}
	const material = strictSnapshot({
		schemaVersion: OPENROUTER_FRESH_PRICING_OBSERVATION_SCHEMA,
		observationRef: D706_PRICING_OBSERVATION_REF,
		observationRevision: D706_PRICING_OBSERVATION_REVISION,
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		modelSlug: D706_MODEL_SLUG,
		downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
		downstreamProviderSlug: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
		providerTag: D706_PROVIDER_TAG,
		quantization: D706_QUANTIZATION,
		promptUsdPerToken: prompt.atomic,
		completionUsdPerToken: completion.atomic,
		cacheReadUsdPerToken: cacheRead.atomic,
		inputMicrousdPerMillionTokens: prompt.microusdPerMillionTokens,
		outputMicrousdPerMillionTokens: completion.microusdPerMillionTokens,
		cacheReadMicrousdPerMillionTokens: cacheRead.microusdPerMillionTokens,
		frozenScheduleRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		responseDigest: empiricalSha256(responseBytes),
		matchesFrozenSchedule: true as const,
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	constructedObservations.add(observation);
	return observation as unknown as OpenRouterFreshPricingObservationV1;
}

export function validateD706FreshPricingObservation(
	value: unknown,
): OpenRouterFreshPricingObservationV1 {
	const candidate = record(value, "d706.pricingObservation");
	exactKeys(
		candidate,
		[
			"cacheReadMicrousdPerMillionTokens",
			"cacheReadUsdPerToken",
			"completionUsdPerToken",
			"downstreamProviderName",
			"downstreamProviderSlug",
			"frozenScheduleRevision",
			"inputMicrousdPerMillionTokens",
			"matchesFrozenSchedule",
			"modelSlug",
			"observationDigest",
			"observationRef",
			"observationRevision",
			"outputMicrousdPerMillionTokens",
			"promptUsdPerToken",
			"providerTag",
			"quantization",
			"responseDigest",
			"schemaVersion",
			"sourceUrl",
		],
		"d706.pricingObservation",
	);
	literal(candidate.schemaVersion, OPENROUTER_FRESH_PRICING_OBSERVATION_SCHEMA, "d706.schema");
	literal(candidate.observationRef, D706_PRICING_OBSERVATION_REF, "d706.observationRef");
	literal(
		candidate.observationRevision,
		D706_PRICING_OBSERVATION_REVISION,
		"d706.observationRevision",
	);
	literal(candidate.sourceUrl, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d706.sourceUrl");
	literal(candidate.modelSlug, D706_MODEL_SLUG, "d706.modelSlug");
	literal(
		candidate.downstreamProviderName,
		OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
		"d706.downstreamProviderName",
	);
	literal(
		candidate.downstreamProviderSlug,
		OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
		"d706.downstreamProviderSlug",
	);
	literal(candidate.providerTag, D706_PROVIDER_TAG, "d706.providerTag");
	literal(candidate.quantization, D706_QUANTIZATION, "d706.quantization");
	const prompt = exactUsdPerTokenToMicrousdPerMillion(candidate.promptUsdPerToken, "d706.prompt");
	const completion = exactUsdPerTokenToMicrousdPerMillion(
		candidate.completionUsdPerToken,
		"d706.completion",
	);
	const cacheRead = exactUsdPerTokenToMicrousdPerMillion(
		candidate.cacheReadUsdPerToken,
		"d706.cacheRead",
	);
	literal(prompt.atomic, D706_PROMPT_USD_PER_TOKEN, "d706.promptAtomic");
	literal(completion.atomic, D706_COMPLETION_USD_PER_TOKEN, "d706.completionAtomic");
	literal(cacheRead.atomic, D706_CACHE_READ_USD_PER_TOKEN, "d706.cacheReadAtomic");
	literal(
		safeInteger(candidate.inputMicrousdPerMillionTokens, "d706.inputRate"),
		OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		"d706.inputRate",
	);
	literal(
		safeInteger(candidate.outputMicrousdPerMillionTokens, "d706.outputRate"),
		OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
		"d706.outputRate",
	);
	literal(
		safeInteger(candidate.cacheReadMicrousdPerMillionTokens, "d706.cacheReadRate"),
		D706_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
		"d706.cacheReadRate",
	);
	literal(
		prompt.microusdPerMillionTokens,
		candidate.inputMicrousdPerMillionTokens as number,
		"d706.promptBinding",
	);
	literal(
		completion.microusdPerMillionTokens,
		candidate.outputMicrousdPerMillionTokens as number,
		"d706.completionBinding",
	);
	literal(
		cacheRead.microusdPerMillionTokens,
		candidate.cacheReadMicrousdPerMillionTokens as number,
		"d706.cacheReadBinding",
	);
	literal(
		candidate.frozenScheduleRevision,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d706.frozenScheduleRevision",
	);
	literal(candidate.matchesFrozenSchedule, true, "d706.matchesFrozenSchedule");
	digest(candidate.responseDigest, "d706.responseDigest");
	const observationDigest = digest(candidate.observationDigest, "d706.observationDigest");
	const { observationDigest: _ignored, ...material } = candidate;
	literal(observationDigest, empiricalStrictJsonDigest(material), "d706.observationDigest");
	return strictSnapshot(candidate) as unknown as OpenRouterFreshPricingObservationV1;
}

export function bindD706FreshPricingObservationToRoute(input: {
	readonly observation: OpenRouterFreshPricingObservationV1;
	readonly routePricing: OpenRouterRouteQualificationV1["pricing"];
}): OpenRouterFreshPricingScheduleMatchV1 {
	const request = record(input, "d706.routePricingBinding");
	exactKeys(request, ["observation", "routePricing"], "d706.routePricingBinding");
	if (!constructedObservations.has(request.observation as object)) {
		throw new TypeError("D706 route binding requires a same-process exact-response observation");
	}
	const observation = validateD706FreshPricingObservation(request.observation);
	const routePricing = record(request.routePricing, "d706.routePricing");
	exactKeys(
		routePricing,
		[
			"currency",
			"inputMicrousdPerMillionTokens",
			"outputMicrousdPerMillionTokens",
			"pricingRevision",
			"sourceUrl",
		],
		"d706.routePricing",
	);
	literal(routePricing.sourceUrl, observation.sourceUrl, "d706.routePricing.sourceUrl");
	literal(
		routePricing.pricingRevision,
		observation.frozenScheduleRevision,
		"d706.routePricing.revision",
	);
	literal(routePricing.currency, "USD", "d706.routePricing.currency");
	literal(
		routePricing.inputMicrousdPerMillionTokens,
		observation.inputMicrousdPerMillionTokens,
		"d706.routePricing.inputRate",
	);
	literal(
		routePricing.outputMicrousdPerMillionTokens,
		observation.outputMicrousdPerMillionTokens,
		"d706.routePricing.outputRate",
	);
	const match = Object.freeze({
		capabilityRef: "openrouter-fresh-pricing-schedule-match" as const,
		capabilityRevision: "decision.D706.2026-08-09.v1" as const,
		observationDigest: observation.observationDigest,
		responseDigest: observation.responseDigest,
		frozenScheduleRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	});
	constructedMatches.add(match);
	return match;
}

export function isConstructedD706FreshPricingScheduleMatch(
	value: unknown,
): value is OpenRouterFreshPricingScheduleMatchV1 {
	return typeof value === "object" && value !== null && constructedMatches.has(value);
}

export function createD706FreshPricingOfflineQualification(
	match: OpenRouterFreshPricingScheduleMatchV1,
): D706FreshPricingQualificationV1 {
	if (!isConstructedD706FreshPricingScheduleMatch(match)) {
		throw new TypeError("D706 qualification requires its same-process pricing schedule match");
	}
	const material = strictSnapshot({
		schemaVersion: D706_FRESH_PRICING_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D706" as const,
		decisionRevision: "decision.D706.2026-08-09.v1" as const,
		executionClass: "simulated-contract" as const,
		observationDigest: match.observationDigest,
		responseDigest: match.responseDigest,
		frozenScheduleRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		routeSchemaChanged: false as const,
		historicalEvidenceReinterpreted: false as const,
		providerCalls: 0 as const,
		networkCalls: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = strictSnapshot({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
	constructedQualifications.add(qualification);
	return qualification as unknown as D706FreshPricingQualificationV1;
}

export function validateD706FreshPricingQualification(
	value: unknown,
): D706FreshPricingQualificationV1 {
	const candidate = record(value, "d706.qualification");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"frozenScheduleRevision",
			"historicalEvidenceReinterpreted",
			"networkCalls",
			"observationDigest",
			"providerCalls",
			"qualificationDigest",
			"qualified",
			"responseDigest",
			"routeSchemaChanged",
			"schemaVersion",
		],
		"d706.qualification",
	);
	literal(
		candidate.schemaVersion,
		D706_FRESH_PRICING_QUALIFICATION_SCHEMA,
		"d706.qualification.schema",
	);
	literal(candidate.decisionRef, "decision.D706", "d706.qualification.decisionRef");
	literal(
		candidate.decisionRevision,
		"decision.D706.2026-08-09.v1",
		"d706.qualification.decisionRevision",
	);
	literal(candidate.executionClass, "simulated-contract", "d706.qualification.executionClass");
	digest(candidate.observationDigest, "d706.qualification.observationDigest");
	digest(candidate.responseDigest, "d706.qualification.responseDigest");
	literal(
		candidate.frozenScheduleRevision,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d706.qualification.frozenScheduleRevision",
	);
	literal(candidate.routeSchemaChanged, false, "d706.qualification.routeSchemaChanged");
	literal(
		candidate.historicalEvidenceReinterpreted,
		false,
		"d706.qualification.historicalEvidenceReinterpreted",
	);
	literal(candidate.providerCalls, 0, "d706.qualification.providerCalls");
	literal(candidate.networkCalls, 0, "d706.qualification.networkCalls");
	literal(candidate.causalAttribution, "undetermined", "d706.qualification.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d706.qualification.efficacyClaim");
	literal(candidate.qualified, true, "d706.qualification.qualified");
	const qualificationDigest = digest(
		candidate.qualificationDigest,
		"d706.qualification.qualificationDigest",
	);
	const { qualificationDigest: _ignored, ...material } = candidate;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(material),
		"d706.qualification.qualificationDigest",
	);
	return strictSnapshot(candidate) as unknown as D706FreshPricingQualificationV1;
}

export function isConstructedD706FreshPricingQualification(
	value: unknown,
): value is D706FreshPricingQualificationV1 {
	return typeof value === "object" && value !== null && constructedQualifications.has(value);
}
