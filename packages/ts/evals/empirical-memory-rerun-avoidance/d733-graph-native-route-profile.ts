import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
	string,
} from "./canonical.js";
import { D712_MAX_OFFICIAL_RESPONSE_BYTES } from "./d712-pricing-schedule.js";
import { OPENROUTER_CHAT_COMPLETIONS_ENDPOINT } from "./openrouter-route-qualification.js";

export const D733_DECISION_REF = "decision.D733" as const;
export const D733_DECISION_REVISION = "2026-08-11.v1" as const;
export const D733_ROUTE_PROFILE_SCHEMA =
	"graphrefly.b112.d733.graph-native-route-profile.v1" as const;
export const D733_ROUTE_ACCESS_SCHEMA =
	"graphrefly.b112.d733.graph-native-route-access-projection.v1" as const;
export const D733_ROUTE_ELIGIBILITY_SCHEMA =
	"graphrefly.b112.d733.graph-native-route-eligibility.v1" as const;
export const D733_ROUTE_ADMISSION_SCHEMA =
	"graphrefly.b112.d733.graph-native-route-admission.v1" as const;

const MAX_PROFILE_BYTES = 65_536;
const decoder = new TextDecoder("utf-8", { fatal: true });
const REQUIRED_WIRE_PARAMETERS = Object.freeze(["reasoning", "tool_choice", "tools"] as const);

interface D733RoutePricingV1 {
	readonly sourceUrl: string;
	readonly revision: string;
	readonly promptUsdPerToken: string;
	readonly completionUsdPerToken: string;
	readonly cacheReadUsdPerToken: string;
	readonly inputMicrousdPerMillionTokens: number;
	readonly outputMicrousdPerMillionTokens: number;
	readonly cacheReadMicrousdPerMillionTokens: number;
}

export interface D733GraphNativeRouteProfileV1 {
	readonly schemaVersion: typeof D733_ROUTE_PROFILE_SCHEMA;
	readonly profileRef: string;
	readonly requestModel: string;
	readonly selectedEndpointModel: string;
	readonly providerName: string;
	readonly providerTag: string;
	readonly quantization: string;
	readonly endpointProtocol: "chat-completions";
	readonly endpointUrl: typeof OPENROUTER_CHAT_COMPLETIONS_ENDPOINT;
	readonly reasoningEffort: "high";
	readonly requiredWireModelParameters: typeof REQUIRED_WIRE_PARAMETERS;
	readonly allowFallbacks: false;
	readonly allowProviderSwitch: false;
	readonly pricing: D733RoutePricingV1;
	readonly profileDigest: string;
}

export interface D733RouteAccessProjectionV1 {
	readonly schemaVersion: typeof D733_ROUTE_ACCESS_SCHEMA;
	readonly profileDigest: string;
	readonly observationRevision: string;
	readonly allowedModelSetDigest: string;
	readonly allowedProviderSetDigest: string;
	readonly modelAllowed: true;
	readonly providerAllowed: true;
	readonly accessDigest: string;
}

export interface D733RouteEligibilityV1 {
	readonly schemaVersion: typeof D733_ROUTE_ELIGIBILITY_SCHEMA;
	readonly profileDigest: string;
	readonly officialResponseDigest: string;
	readonly supportedParameterSetDigest: string;
	readonly pricingMatches: true;
	readonly parametersMatch: true;
	readonly eligible: true;
	readonly eligibilityDigest: string;
}

export interface D733GraphNativeRouteAdmissionV1 {
	readonly schemaVersion: typeof D733_ROUTE_ADMISSION_SCHEMA;
	readonly profileDigest: string;
	readonly accessDigest: string;
	readonly eligibilityDigest: string;
	readonly admissionDigest: string;
}

const constructedProfiles = new WeakMap<object, D733GraphNativeRouteProfileV1>();
const constructedAccess = new WeakSet<object>();
const constructedEligibility = new WeakSet<object>();
const constructedAdmissions = new WeakMap<object, D733GraphNativeRouteProfileV1>();

function decimalToMicrousdPerMillion(value: unknown, path: string): number {
	const atomic = string(value, path, 64);
	if (!/^(?:0|[1-9]\d*)\.\d{1,12}$/.test(atomic))
		throw new TypeError(`${path} must be an exact decimal with at most 12 fractional digits`);
	const [whole = "0", fraction = ""] = atomic.split(".");
	const scaled = BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
	if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`${path} exceeds the bound`);
	return Number(scaled);
}

function boundedUrl(value: unknown, path: string): string {
	const result = string(value, path, 2_048);
	let url: URL;
	try {
		url = new URL(result);
	} catch (error) {
		throw new TypeError(`${path} must be an absolute URL`, { cause: error });
	}
	if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
		throw new TypeError(`${path} must be an HTTPS URL without user info`);
	return result;
}

function validatePricing(value: unknown): D733RoutePricingV1 {
	const candidate = record(value, "d733.profile.pricing");
	exactKeys(
		candidate,
		[
			"cacheReadMicrousdPerMillionTokens",
			"cacheReadUsdPerToken",
			"completionUsdPerToken",
			"inputMicrousdPerMillionTokens",
			"outputMicrousdPerMillionTokens",
			"promptUsdPerToken",
			"revision",
			"sourceUrl",
		],
		"d733.profile.pricing",
	);
	const pricing = strictSnapshot({
		sourceUrl: boundedUrl(candidate.sourceUrl, "d733.profile.pricing.sourceUrl"),
		revision: string(candidate.revision, "d733.profile.pricing.revision", 256),
		promptUsdPerToken: string(
			candidate.promptUsdPerToken,
			"d733.profile.pricing.promptUsdPerToken",
			64,
		),
		completionUsdPerToken: string(
			candidate.completionUsdPerToken,
			"d733.profile.pricing.completionUsdPerToken",
			64,
		),
		cacheReadUsdPerToken: string(
			candidate.cacheReadUsdPerToken,
			"d733.profile.pricing.cacheReadUsdPerToken",
			64,
		),
		inputMicrousdPerMillionTokens: safeInteger(
			candidate.inputMicrousdPerMillionTokens,
			"d733.profile.pricing.inputMicrousdPerMillionTokens",
			{ max: 100_000_000 },
		),
		outputMicrousdPerMillionTokens: safeInteger(
			candidate.outputMicrousdPerMillionTokens,
			"d733.profile.pricing.outputMicrousdPerMillionTokens",
			{ max: 100_000_000 },
		),
		cacheReadMicrousdPerMillionTokens: safeInteger(
			candidate.cacheReadMicrousdPerMillionTokens,
			"d733.profile.pricing.cacheReadMicrousdPerMillionTokens",
			{ max: 100_000_000 },
		),
	}) as D733RoutePricingV1;
	if (
		decimalToMicrousdPerMillion(
			pricing.promptUsdPerToken,
			"d733.profile.pricing.promptUsdPerToken",
		) !== pricing.inputMicrousdPerMillionTokens ||
		decimalToMicrousdPerMillion(
			pricing.completionUsdPerToken,
			"d733.profile.pricing.completionUsdPerToken",
		) !== pricing.outputMicrousdPerMillionTokens ||
		decimalToMicrousdPerMillion(
			pricing.cacheReadUsdPerToken,
			"d733.profile.pricing.cacheReadUsdPerToken",
		) !== pricing.cacheReadMicrousdPerMillionTokens
	)
		throw new TypeError("D733 profile pricing representations disagree");
	return pricing;
}

export function validateD733GraphNativeRouteProfile(value: unknown): D733GraphNativeRouteProfileV1 {
	const candidate = record(value, "d733.profile");
	exactKeys(
		candidate,
		[
			"allowFallbacks",
			"allowProviderSwitch",
			"endpointProtocol",
			"endpointUrl",
			"pricing",
			"profileDigest",
			"profileRef",
			"providerName",
			"providerTag",
			"quantization",
			"reasoningEffort",
			"requestModel",
			"requiredWireModelParameters",
			"schemaVersion",
			"selectedEndpointModel",
		],
		"d733.profile",
	);
	literal(candidate.schemaVersion, D733_ROUTE_PROFILE_SCHEMA, "d733.profile.schema");
	const required = array(
		candidate.requiredWireModelParameters,
		"d733.profile.requiredWireModelParameters",
	);
	literal(
		empiricalStrictJsonDigest(required),
		empiricalStrictJsonDigest(REQUIRED_WIRE_PARAMETERS),
		"d733.profile.requiredWireModelParameters",
	);
	const material = strictSnapshot({
		schemaVersion: D733_ROUTE_PROFILE_SCHEMA,
		profileRef: string(candidate.profileRef, "d733.profile.profileRef", 256),
		requestModel: string(candidate.requestModel, "d733.profile.requestModel", 256),
		selectedEndpointModel: string(
			candidate.selectedEndpointModel,
			"d733.profile.selectedEndpointModel",
			256,
		),
		providerName: string(candidate.providerName, "d733.profile.providerName", 128),
		providerTag: string(candidate.providerTag, "d733.profile.providerTag", 128),
		quantization: string(candidate.quantization, "d733.profile.quantization", 64),
		endpointProtocol: literal(
			candidate.endpointProtocol,
			"chat-completions",
			"d733.profile.endpointProtocol",
		),
		endpointUrl: literal(
			boundedUrl(candidate.endpointUrl, "d733.profile.endpointUrl"),
			OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
			"d733.profile.endpointUrl",
		),
		reasoningEffort: literal(candidate.reasoningEffort, "high", "d733.profile.reasoningEffort"),
		requiredWireModelParameters: REQUIRED_WIRE_PARAMETERS,
		allowFallbacks: literal(candidate.allowFallbacks, false, "d733.profile.allowFallbacks"),
		allowProviderSwitch: literal(
			candidate.allowProviderSwitch,
			false,
			"d733.profile.allowProviderSwitch",
		),
		pricing: validatePricing(candidate.pricing),
	});
	const profileDigest = digest(candidate.profileDigest, "d733.profile.profileDigest");
	literal(profileDigest, empiricalStrictJsonDigest(material), "d733.profile.profileDigest");
	return strictSnapshot({ ...material, profileDigest }) as D733GraphNativeRouteProfileV1;
}

export function createD733GraphNativeRouteProfile(
	input: Omit<D733GraphNativeRouteProfileV1, "schemaVersion" | "profileDigest">,
): D733GraphNativeRouteProfileV1 {
	const candidate = record(input, "d733.profile.input");
	exactKeys(
		candidate,
		[
			"allowFallbacks",
			"allowProviderSwitch",
			"endpointProtocol",
			"endpointUrl",
			"pricing",
			"profileRef",
			"providerName",
			"providerTag",
			"quantization",
			"reasoningEffort",
			"requestModel",
			"requiredWireModelParameters",
			"selectedEndpointModel",
		],
		"d733.profile.input",
	);
	const material = strictSnapshot({
		schemaVersion: D733_ROUTE_PROFILE_SCHEMA,
		profileRef: candidate.profileRef,
		requestModel: candidate.requestModel,
		selectedEndpointModel: candidate.selectedEndpointModel,
		providerName: candidate.providerName,
		providerTag: candidate.providerTag,
		quantization: candidate.quantization,
		endpointProtocol: candidate.endpointProtocol,
		endpointUrl: candidate.endpointUrl,
		reasoningEffort: candidate.reasoningEffort,
		requiredWireModelParameters: candidate.requiredWireModelParameters,
		allowFallbacks: candidate.allowFallbacks,
		allowProviderSwitch: candidate.allowProviderSwitch,
		pricing: candidate.pricing,
	});
	const profile = validateD733GraphNativeRouteProfile(
		strictSnapshot({ ...material, profileDigest: empiricalStrictJsonDigest(material) }),
	);
	constructedProfiles.set(profile, profile);
	return profile;
}

export function createD733GraphNativeRouteProfileFromCanonicalBytes(
	inputBytes: Uint8Array,
): D733GraphNativeRouteProfileV1 {
	if (
		!(inputBytes instanceof Uint8Array) ||
		inputBytes.byteLength < 1 ||
		inputBytes.byteLength > MAX_PROFILE_BYTES
	)
		throw new TypeError("D733 route profile bytes are outside the bound");
	const bytes = new Uint8Array(inputBytes);
	const profile = validateD733GraphNativeRouteProfile(strictJsonCodec.decode(bytes));
	if (!sameBytes(strictJsonCodec.encode(profile as unknown as StrictJsonValue), bytes))
		throw new TypeError("D733 route profile bytes are not canonical");
	constructedProfiles.set(profile, profile);
	return profile;
}

export function readConstructedD733GraphNativeRouteProfile(
	value: unknown,
): D733GraphNativeRouteProfileV1 {
	if (typeof value !== "object" || value === null)
		throw new TypeError("D733 route profile capability is invalid");
	const profile = constructedProfiles.get(value);
	if (profile === undefined)
		throw new TypeError("D733 route profile must be same-process constructed");
	return profile;
}

function boundedUniqueStrings(value: unknown, path: string): readonly string[] {
	const items = array(value, path);
	if (items.length < 1 || items.length > 128)
		throw new TypeError(`${path} count is outside the bound`);
	const result = items.map((item, index) => string(item, `${path}[${index}]`, 256));
	if (new Set(result).size !== result.length) throw new TypeError(`${path} contains duplicates`);
	return Object.freeze([...result].sort());
}

export function createD733RouteAccessProjection(inputValue: {
	readonly profile: D733GraphNativeRouteProfileV1;
	readonly observationRevision: string;
	readonly allowedModels: readonly string[];
	readonly allowedProviders: readonly string[];
}): D733RouteAccessProjectionV1 {
	const input = record(inputValue, "d733.access.input");
	exactKeys(
		input,
		["allowedModels", "allowedProviders", "observationRevision", "profile"],
		"d733.access.input",
	);
	const profile = readConstructedD733GraphNativeRouteProfile(input.profile);
	const models = boundedUniqueStrings(input.allowedModels, "d733.access.allowedModels");
	const providers = boundedUniqueStrings(input.allowedProviders, "d733.access.allowedProviders");
	if (!models.includes(profile.requestModel) || !providers.includes(profile.providerName))
		throw new TypeError("D733 route is not permitted by the credential access observation");
	const material = strictSnapshot({
		schemaVersion: D733_ROUTE_ACCESS_SCHEMA,
		profileDigest: profile.profileDigest,
		observationRevision: string(input.observationRevision, "d733.access.observationRevision", 256),
		allowedModelSetDigest: empiricalStrictJsonDigest(models),
		allowedProviderSetDigest: empiricalStrictJsonDigest(providers),
		modelAllowed: true as const,
		providerAllowed: true as const,
	});
	const access = strictSnapshot({ ...material, accessDigest: empiricalStrictJsonDigest(material) });
	constructedAccess.add(access);
	return access as D733RouteAccessProjectionV1;
}

export function validateD733RouteAccessProjection(value: unknown): D733RouteAccessProjectionV1 {
	const candidate = record(value, "d733.access");
	exactKeys(
		candidate,
		[
			"accessDigest",
			"allowedModelSetDigest",
			"allowedProviderSetDigest",
			"modelAllowed",
			"observationRevision",
			"profileDigest",
			"providerAllowed",
			"schemaVersion",
		],
		"d733.access",
	);
	literal(candidate.schemaVersion, D733_ROUTE_ACCESS_SCHEMA, "d733.access.schema");
	digest(candidate.profileDigest, "d733.access.profileDigest");
	string(candidate.observationRevision, "d733.access.observationRevision", 256);
	digest(candidate.allowedModelSetDigest, "d733.access.allowedModelSetDigest");
	digest(candidate.allowedProviderSetDigest, "d733.access.allowedProviderSetDigest");
	literal(candidate.modelAllowed, true, "d733.access.modelAllowed");
	literal(candidate.providerAllowed, true, "d733.access.providerAllowed");
	const accessDigest = digest(candidate.accessDigest, "d733.access.accessDigest");
	const { accessDigest: _accessDigest, ...material } = candidate;
	literal(accessDigest, empiricalStrictJsonDigest(material), "d733.access.accessDigest");
	return strictSnapshot(candidate) as unknown as D733RouteAccessProjectionV1;
}

function endpointRecords(
	responseBytes: Uint8Array,
	requestModel: string,
): readonly Record<string, unknown>[] {
	let decoded: unknown;
	try {
		decoded = JSON.parse(decoder.decode(responseBytes));
	} catch (error) {
		throw new TypeError("D733 endpoint response is not bounded UTF-8 JSON", { cause: error });
	}
	const root = record(decoded, "d733.endpointResponse");
	const data = record(root.data, "d733.endpointResponse.data");
	literal(data.id, requestModel, "d733.endpointResponse.data.id");
	return array(data.endpoints, "d733.endpointResponse.data.endpoints").map((entry, index) =>
		record(entry, `d733.endpointResponse.data.endpoints[${index}]`),
	);
}

export function createD733RouteEligibility(inputValue: {
	readonly profile: D733GraphNativeRouteProfileV1;
	readonly responseBytes: Uint8Array;
}): D733RouteEligibilityV1 {
	const input = record(inputValue, "d733.eligibility.input");
	exactKeys(input, ["profile", "responseBytes"], "d733.eligibility.input");
	const profile = readConstructedD733GraphNativeRouteProfile(input.profile);
	if (!(input.responseBytes instanceof Uint8Array))
		throw new TypeError("D733 endpoint response must be Uint8Array");
	const bytes = new Uint8Array(input.responseBytes);
	if (bytes.byteLength < 1 || bytes.byteLength > D712_MAX_OFFICIAL_RESPONSE_BYTES)
		throw new TypeError("D733 endpoint response byte bound exceeded");
	const matches = endpointRecords(bytes, profile.requestModel).filter(
		(endpoint) =>
			endpoint.provider_name === profile.providerName &&
			endpoint.tag === profile.providerTag &&
			endpoint.quantization === profile.quantization &&
			(endpoint.model === profile.selectedEndpointModel ||
				endpoint.name === `${profile.providerName} | ${profile.selectedEndpointModel}`),
	);
	if (matches.length !== 1) throw new TypeError("D733 requires exactly one profile endpoint");
	const endpoint = matches[0]!;
	const supported = boundedUniqueStrings(
		endpoint.supported_parameters,
		"d733.endpoint.supportedParameters",
	);
	for (const parameter of profile.requiredWireModelParameters)
		if (!supported.includes(parameter))
			throw new TypeError(`D733 endpoint does not support ${parameter}`);
	const pricing = record(endpoint.pricing, "d733.endpoint.pricing");
	for (const [key, expected] of [
		["prompt", profile.pricing.promptUsdPerToken],
		["completion", profile.pricing.completionUsdPerToken],
		["input_cache_read", profile.pricing.cacheReadUsdPerToken],
	] as const)
		literal(pricing[key], expected, `d733.endpoint.pricing.${key}`);
	const material = strictSnapshot({
		schemaVersion: D733_ROUTE_ELIGIBILITY_SCHEMA,
		profileDigest: profile.profileDigest,
		officialResponseDigest: empiricalSha256(bytes),
		supportedParameterSetDigest: empiricalStrictJsonDigest(supported),
		pricingMatches: true as const,
		parametersMatch: true as const,
		eligible: true as const,
	});
	const eligibility = strictSnapshot({
		...material,
		eligibilityDigest: empiricalStrictJsonDigest(material),
	});
	constructedEligibility.add(eligibility);
	return eligibility as D733RouteEligibilityV1;
}

export function validateD733RouteEligibility(value: unknown): D733RouteEligibilityV1 {
	const candidate = record(value, "d733.eligibility");
	exactKeys(
		candidate,
		[
			"eligibilityDigest",
			"eligible",
			"officialResponseDigest",
			"parametersMatch",
			"pricingMatches",
			"profileDigest",
			"schemaVersion",
			"supportedParameterSetDigest",
		],
		"d733.eligibility",
	);
	literal(candidate.schemaVersion, D733_ROUTE_ELIGIBILITY_SCHEMA, "d733.eligibility.schema");
	digest(candidate.profileDigest, "d733.eligibility.profileDigest");
	digest(candidate.officialResponseDigest, "d733.eligibility.officialResponseDigest");
	digest(candidate.supportedParameterSetDigest, "d733.eligibility.supportedParameterSetDigest");
	literal(candidate.pricingMatches, true, "d733.eligibility.pricingMatches");
	literal(candidate.parametersMatch, true, "d733.eligibility.parametersMatch");
	literal(candidate.eligible, true, "d733.eligibility.eligible");
	const eligibilityDigest = digest(
		candidate.eligibilityDigest,
		"d733.eligibility.eligibilityDigest",
	);
	const { eligibilityDigest: _eligibilityDigest, ...material } = candidate;
	literal(
		eligibilityDigest,
		empiricalStrictJsonDigest(material),
		"d733.eligibility.eligibilityDigest",
	);
	return strictSnapshot(candidate) as unknown as D733RouteEligibilityV1;
}

export function createD733GraphNativeRouteAdmission(inputValue: {
	readonly profile: D733GraphNativeRouteProfileV1;
	readonly access: D733RouteAccessProjectionV1;
	readonly eligibility: D733RouteEligibilityV1;
}): D733GraphNativeRouteAdmissionV1 {
	const input = record(inputValue, "d733.admission.input");
	exactKeys(input, ["access", "eligibility", "profile"], "d733.admission.input");
	const profile = readConstructedD733GraphNativeRouteProfile(input.profile);
	if (
		typeof input.access !== "object" ||
		input.access === null ||
		!constructedAccess.delete(input.access)
	)
		throw new TypeError("D733 route access projection must be same-process and single-use");
	if (
		typeof input.eligibility !== "object" ||
		input.eligibility === null ||
		!constructedEligibility.delete(input.eligibility)
	)
		throw new TypeError("D733 route eligibility must be same-process and single-use");
	const access = input.access as unknown as D733RouteAccessProjectionV1;
	const eligibility = input.eligibility as unknown as D733RouteEligibilityV1;
	if (
		access.profileDigest !== profile.profileDigest ||
		eligibility.profileDigest !== profile.profileDigest
	)
		throw new TypeError("D733 route admission coordinates disagree");
	const material = strictSnapshot({
		schemaVersion: D733_ROUTE_ADMISSION_SCHEMA,
		profileDigest: profile.profileDigest,
		accessDigest: access.accessDigest,
		eligibilityDigest: eligibility.eligibilityDigest,
	});
	const admission = strictSnapshot({
		...material,
		admissionDigest: empiricalStrictJsonDigest(material),
	});
	constructedAdmissions.set(admission, profile);
	return admission as D733GraphNativeRouteAdmissionV1;
}

export function validateD733GraphNativeRouteAdmission(
	value: unknown,
): D733GraphNativeRouteAdmissionV1 {
	const candidate = record(value, "d733.admission");
	exactKeys(
		candidate,
		["accessDigest", "admissionDigest", "eligibilityDigest", "profileDigest", "schemaVersion"],
		"d733.admission",
	);
	literal(candidate.schemaVersion, D733_ROUTE_ADMISSION_SCHEMA, "d733.admission.schema");
	digest(candidate.profileDigest, "d733.admission.profileDigest");
	digest(candidate.accessDigest, "d733.admission.accessDigest");
	digest(candidate.eligibilityDigest, "d733.admission.eligibilityDigest");
	const admissionDigest = digest(candidate.admissionDigest, "d733.admission.admissionDigest");
	const { admissionDigest: _admissionDigest, ...material } = candidate;
	literal(admissionDigest, empiricalStrictJsonDigest(material), "d733.admission.admissionDigest");
	return strictSnapshot(candidate) as unknown as D733GraphNativeRouteAdmissionV1;
}

export function readD733AdmittedRouteProfile(value: unknown): D733GraphNativeRouteProfileV1 {
	if (typeof value !== "object" || value === null)
		throw new TypeError("D733 route admission capability is invalid");
	const profile = constructedAdmissions.get(value);
	if (profile === undefined)
		throw new TypeError("D733 route admission must be same-process constructed");
	return profile;
}

export function d733RouteProfileCanonicalBytes(profile: D733GraphNativeRouteProfileV1): Uint8Array {
	return strictJsonCodec.encode(
		validateD733GraphNativeRouteProfile(profile) as unknown as StrictJsonValue,
	);
}
