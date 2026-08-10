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
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";

export const D712_FRESH_PRICING_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.d712-fresh-pricing-observation.v1" as const;
export const D712_FRESH_PRICING_QUALIFICATION_SCHEMA =
	"graphrefly.private-solution-eval.d712-fresh-pricing-qualification.v1" as const;
export const D712_APPROVAL_REF = "decision.D712" as const;
export const D712_APPROVAL_REVISION = "decision.D712.2026-08-10.v1" as const;
export const D712_PRICING_OBSERVATION_REF = "d712-deepseek-v4-flash-0731-deepinfra-fp4" as const;
export const D712_PRICING_OBSERVATION_REVISION =
	"openrouter-deepseek-v4-flash-0731-deepinfra-fp4-observed-2026-08-10.v1" as const;
export const D712_MODEL_SLUG = "deepseek/deepseek-v4-flash-0731" as const;
export const D712_PROVIDER_TAG = "deepinfra/fp4" as const;
export const D712_QUANTIZATION = "fp4" as const;
export const D712_DEEPSEEK_V4_FLASH_PRICING_REVISION =
	"openrouter-deepseek-v4-flash-0731-deepinfra-fp4-2026-08-10.v4" as const;
export const D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS = 80_000 as const;
export const D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS = 180_000 as const;
export const D712_PROMPT_USD_PER_TOKEN = "0.00000008" as const;
export const D712_COMPLETION_USD_PER_TOKEN = "0.00000018" as const;
export const D712_CACHE_READ_USD_PER_TOKEN = "0.000000016" as const;
export const D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS = 16_000 as const;
export const D712_MAX_OFFICIAL_RESPONSE_BYTES = 1_048_576 as const;

export interface D712FreshPricingObservationV1 {
	readonly schemaVersion: typeof D712_FRESH_PRICING_OBSERVATION_SCHEMA;
	readonly observationRef: typeof D712_PRICING_OBSERVATION_REF;
	readonly observationRevision: typeof D712_PRICING_OBSERVATION_REVISION;
	readonly sourceUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly modelSlug: typeof D712_MODEL_SLUG;
	readonly downstreamProviderName: typeof OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME;
	readonly downstreamProviderSlug: typeof OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG;
	readonly providerTag: typeof D712_PROVIDER_TAG;
	readonly quantization: typeof D712_QUANTIZATION;
	readonly promptUsdPerToken: string;
	readonly completionUsdPerToken: string;
	readonly cacheReadUsdPerToken: string;
	readonly inputMicrousdPerMillionTokens: number;
	readonly outputMicrousdPerMillionTokens: number;
	readonly cacheReadMicrousdPerMillionTokens: number;
	readonly frozenScheduleRevision: typeof D712_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly responseDigest: string;
	readonly matchesFrozenSchedule: true;
	readonly observationDigest: string;
}

export interface D712FreshPricingScheduleMatchV1 {
	readonly capabilityRef: "openrouter-fresh-pricing-schedule-match";
	readonly capabilityRevision: "decision.D712.2026-08-10.v1";
	readonly observationDigest: string;
	readonly responseDigest: string;
	readonly frozenScheduleRevision: typeof D712_DEEPSEEK_V4_FLASH_PRICING_REVISION;
}

export interface D712FreshPricingQualificationV1 {
	readonly schemaVersion: typeof D712_FRESH_PRICING_QUALIFICATION_SCHEMA;
	readonly decisionRef: "decision.D712";
	readonly decisionRevision: "decision.D712.2026-08-10.v1";
	readonly executionClass: "simulated-contract";
	readonly observationDigest: string;
	readonly responseDigest: string;
	readonly frozenScheduleRevision: typeof D712_DEEPSEEK_V4_FLASH_PRICING_REVISION;
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
		throw new TypeError("D712 official pricing response is not strict UTF-8 JSON", {
			cause: error,
		});
	}
	const root = record(parsed, "d712.officialResponse");
	const data = record(root.data, "d712.officialResponse.data");
	literal(data.id, D712_MODEL_SLUG, "d712.officialResponse.data.id");
	return array(data.endpoints, "d712.officialResponse.data.endpoints").map((value, index) =>
		record(value, `d712.officialResponse.data.endpoints[${index}]`),
	);
}

export function createD712FreshPricingObservation(input: {
	readonly sourceUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly responseBytes: Uint8Array;
}): D712FreshPricingObservationV1 {
	const request = record(input, "d712.pricingObservationInput");
	exactKeys(request, ["responseBytes", "sourceUrl"], "d712.pricingObservationInput");
	literal(
		request.sourceUrl,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		"d712.pricingObservationInput.sourceUrl",
	);
	if (!(request.responseBytes instanceof Uint8Array)) {
		throw new TypeError("D712 pricing observation requires Uint8Array response bytes");
	}
	const responseBytes = new Uint8Array(request.responseBytes);
	if (
		responseBytes.byteLength === 0 ||
		responseBytes.byteLength > D712_MAX_OFFICIAL_RESPONSE_BYTES
	) {
		throw new TypeError("D712 official pricing response byte bound exceeded");
	}
	const matches = endpointRecords(responseBytes).filter(
		(endpoint) =>
			endpoint.provider_name === OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME &&
			endpoint.tag === D712_PROVIDER_TAG &&
			endpoint.quantization === D712_QUANTIZATION,
	);
	if (matches.length !== 1) {
		throw new TypeError("D712 requires exactly one DeepInfra fp4 official pricing endpoint");
	}
	const endpoint = matches[0];
	if (endpoint === undefined) throw new TypeError("D712 official endpoint selection failed");
	const pricing = record(endpoint.pricing, "d712.officialResponse.endpoint.pricing");
	const prompt = exactUsdPerTokenToMicrousdPerMillion(
		pricing.prompt,
		"d712.officialResponse.endpoint.pricing.prompt",
	);
	const completion = exactUsdPerTokenToMicrousdPerMillion(
		pricing.completion,
		"d712.officialResponse.endpoint.pricing.completion",
	);
	const cacheRead = exactUsdPerTokenToMicrousdPerMillion(
		pricing.input_cache_read,
		"d712.officialResponse.endpoint.pricing.input_cache_read",
	);
	literal(prompt.atomic, D712_PROMPT_USD_PER_TOKEN, "d712.officialResponse.promptAtomic");
	literal(
		completion.atomic,
		D712_COMPLETION_USD_PER_TOKEN,
		"d712.officialResponse.completionAtomic",
	);
	literal(cacheRead.atomic, D712_CACHE_READ_USD_PER_TOKEN, "d712.officialResponse.cacheReadAtomic");
	if (
		prompt.microusdPerMillionTokens !== D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS ||
		completion.microusdPerMillionTokens !==
			D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS ||
		cacheRead.microusdPerMillionTokens !== D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS
	) {
		throw new TypeError("D712 fresh pricing does not match the frozen execution schedule");
	}
	const material = strictSnapshot({
		schemaVersion: D712_FRESH_PRICING_OBSERVATION_SCHEMA,
		observationRef: D712_PRICING_OBSERVATION_REF,
		observationRevision: D712_PRICING_OBSERVATION_REVISION,
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		modelSlug: D712_MODEL_SLUG,
		downstreamProviderName: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
		downstreamProviderSlug: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
		providerTag: D712_PROVIDER_TAG,
		quantization: D712_QUANTIZATION,
		promptUsdPerToken: prompt.atomic,
		completionUsdPerToken: completion.atomic,
		cacheReadUsdPerToken: cacheRead.atomic,
		inputMicrousdPerMillionTokens: prompt.microusdPerMillionTokens,
		outputMicrousdPerMillionTokens: completion.microusdPerMillionTokens,
		cacheReadMicrousdPerMillionTokens: cacheRead.microusdPerMillionTokens,
		frozenScheduleRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		responseDigest: empiricalSha256(responseBytes),
		matchesFrozenSchedule: true as const,
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	constructedObservations.add(observation);
	return observation as unknown as D712FreshPricingObservationV1;
}

export function validateD712FreshPricingObservation(value: unknown): D712FreshPricingObservationV1 {
	const candidate = record(value, "d712.pricingObservation");
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
		"d712.pricingObservation",
	);
	literal(candidate.schemaVersion, D712_FRESH_PRICING_OBSERVATION_SCHEMA, "d712.schema");
	literal(candidate.observationRef, D712_PRICING_OBSERVATION_REF, "d712.observationRef");
	literal(
		candidate.observationRevision,
		D712_PRICING_OBSERVATION_REVISION,
		"d712.observationRevision",
	);
	literal(candidate.sourceUrl, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d712.sourceUrl");
	literal(candidate.modelSlug, D712_MODEL_SLUG, "d712.modelSlug");
	literal(
		candidate.downstreamProviderName,
		OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
		"d712.downstreamProviderName",
	);
	literal(
		candidate.downstreamProviderSlug,
		OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
		"d712.downstreamProviderSlug",
	);
	literal(candidate.providerTag, D712_PROVIDER_TAG, "d712.providerTag");
	literal(candidate.quantization, D712_QUANTIZATION, "d712.quantization");
	const prompt = exactUsdPerTokenToMicrousdPerMillion(candidate.promptUsdPerToken, "d712.prompt");
	const completion = exactUsdPerTokenToMicrousdPerMillion(
		candidate.completionUsdPerToken,
		"d712.completion",
	);
	const cacheRead = exactUsdPerTokenToMicrousdPerMillion(
		candidate.cacheReadUsdPerToken,
		"d712.cacheRead",
	);
	literal(prompt.atomic, D712_PROMPT_USD_PER_TOKEN, "d712.promptAtomic");
	literal(completion.atomic, D712_COMPLETION_USD_PER_TOKEN, "d712.completionAtomic");
	literal(cacheRead.atomic, D712_CACHE_READ_USD_PER_TOKEN, "d712.cacheReadAtomic");
	literal(
		safeInteger(candidate.inputMicrousdPerMillionTokens, "d712.inputRate"),
		D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		"d712.inputRate",
	);
	literal(
		safeInteger(candidate.outputMicrousdPerMillionTokens, "d712.outputRate"),
		D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
		"d712.outputRate",
	);
	literal(
		safeInteger(candidate.cacheReadMicrousdPerMillionTokens, "d712.cacheReadRate"),
		D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
		"d712.cacheReadRate",
	);
	literal(
		prompt.microusdPerMillionTokens,
		candidate.inputMicrousdPerMillionTokens as number,
		"d712.promptBinding",
	);
	literal(
		completion.microusdPerMillionTokens,
		candidate.outputMicrousdPerMillionTokens as number,
		"d712.completionBinding",
	);
	literal(
		cacheRead.microusdPerMillionTokens,
		candidate.cacheReadMicrousdPerMillionTokens as number,
		"d712.cacheReadBinding",
	);
	literal(
		candidate.frozenScheduleRevision,
		D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d712.frozenScheduleRevision",
	);
	literal(candidate.matchesFrozenSchedule, true, "d712.matchesFrozenSchedule");
	digest(candidate.responseDigest, "d712.responseDigest");
	const observationDigest = digest(candidate.observationDigest, "d712.observationDigest");
	const { observationDigest: _ignored, ...material } = candidate;
	literal(observationDigest, empiricalStrictJsonDigest(material), "d712.observationDigest");
	return strictSnapshot(candidate) as unknown as D712FreshPricingObservationV1;
}

export function bindD712FreshPricingObservationToRoute(input: {
	readonly observation: D712FreshPricingObservationV1;
	readonly routePricing: OpenRouterRouteQualificationV1["pricing"];
}): D712FreshPricingScheduleMatchV1 {
	const request = record(input, "d712.routePricingBinding");
	exactKeys(request, ["observation", "routePricing"], "d712.routePricingBinding");
	if (!constructedObservations.has(request.observation as object)) {
		throw new TypeError("D712 route binding requires a same-process exact-response observation");
	}
	const observation = validateD712FreshPricingObservation(request.observation);
	const routePricing = record(request.routePricing, "d712.routePricing");
	exactKeys(
		routePricing,
		[
			"currency",
			"inputMicrousdPerMillionTokens",
			"outputMicrousdPerMillionTokens",
			"pricingRevision",
			"sourceUrl",
		],
		"d712.routePricing",
	);
	literal(routePricing.sourceUrl, observation.sourceUrl, "d712.routePricing.sourceUrl");
	literal(
		routePricing.pricingRevision,
		observation.frozenScheduleRevision,
		"d712.routePricing.revision",
	);
	literal(routePricing.currency, "USD", "d712.routePricing.currency");
	literal(
		routePricing.inputMicrousdPerMillionTokens,
		observation.inputMicrousdPerMillionTokens,
		"d712.routePricing.inputRate",
	);
	literal(
		routePricing.outputMicrousdPerMillionTokens,
		observation.outputMicrousdPerMillionTokens,
		"d712.routePricing.outputRate",
	);
	const match = Object.freeze({
		capabilityRef: "openrouter-fresh-pricing-schedule-match" as const,
		capabilityRevision: "decision.D712.2026-08-10.v1" as const,
		observationDigest: observation.observationDigest,
		responseDigest: observation.responseDigest,
		frozenScheduleRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	});
	constructedMatches.add(match);
	return match;
}

export function isConstructedD712FreshPricingScheduleMatch(
	value: unknown,
): value is D712FreshPricingScheduleMatchV1 {
	return typeof value === "object" && value !== null && constructedMatches.has(value);
}

export function createD712FreshPricingOfflineQualification(
	match: D712FreshPricingScheduleMatchV1,
): D712FreshPricingQualificationV1 {
	if (!isConstructedD712FreshPricingScheduleMatch(match)) {
		throw new TypeError("D712 qualification requires its same-process pricing schedule match");
	}
	const material = strictSnapshot({
		schemaVersion: D712_FRESH_PRICING_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D712" as const,
		decisionRevision: "decision.D712.2026-08-10.v1" as const,
		executionClass: "simulated-contract" as const,
		observationDigest: match.observationDigest,
		responseDigest: match.responseDigest,
		frozenScheduleRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
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
	return qualification as unknown as D712FreshPricingQualificationV1;
}

export function validateD712FreshPricingQualification(
	value: unknown,
): D712FreshPricingQualificationV1 {
	const candidate = record(value, "d712.qualification");
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
		"d712.qualification",
	);
	literal(
		candidate.schemaVersion,
		D712_FRESH_PRICING_QUALIFICATION_SCHEMA,
		"d712.qualification.schema",
	);
	literal(candidate.decisionRef, "decision.D712", "d712.qualification.decisionRef");
	literal(
		candidate.decisionRevision,
		"decision.D712.2026-08-10.v1",
		"d712.qualification.decisionRevision",
	);
	literal(candidate.executionClass, "simulated-contract", "d712.qualification.executionClass");
	digest(candidate.observationDigest, "d712.qualification.observationDigest");
	digest(candidate.responseDigest, "d712.qualification.responseDigest");
	literal(
		candidate.frozenScheduleRevision,
		D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d712.qualification.frozenScheduleRevision",
	);
	literal(candidate.routeSchemaChanged, false, "d712.qualification.routeSchemaChanged");
	literal(
		candidate.historicalEvidenceReinterpreted,
		false,
		"d712.qualification.historicalEvidenceReinterpreted",
	);
	literal(candidate.providerCalls, 0, "d712.qualification.providerCalls");
	literal(candidate.networkCalls, 0, "d712.qualification.networkCalls");
	literal(candidate.causalAttribution, "undetermined", "d712.qualification.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d712.qualification.efficacyClaim");
	literal(candidate.qualified, true, "d712.qualification.qualified");
	const qualificationDigest = digest(
		candidate.qualificationDigest,
		"d712.qualification.qualificationDigest",
	);
	const { qualificationDigest: _ignored, ...material } = candidate;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(material),
		"d712.qualification.qualificationDigest",
	);
	return strictSnapshot(candidate) as unknown as D712FreshPricingQualificationV1;
}

export function isConstructedD712FreshPricingQualification(
	value: unknown,
): value is D712FreshPricingQualificationV1 {
	return typeof value === "object" && value !== null && constructedQualifications.has(value);
}
