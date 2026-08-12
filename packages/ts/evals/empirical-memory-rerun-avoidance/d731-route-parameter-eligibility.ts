import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
	string,
} from "./canonical.js";
import { D712_MAX_OFFICIAL_RESPONSE_BYTES } from "./d712-pricing-schedule.js";
import {
	D729_MODEL_SLUG,
	D729_PROVIDER_NAME,
	D729_PROVIDER_TAG,
	D729_QUANTIZATION,
	D729_SELECTED_ENDPOINT_MODEL,
} from "./d729-coordinates.js";

export const D731_DECISION_REF = "decision.D731" as const;
export const D731_DECISION_REVISION = "2026-08-11.v1" as const;
export const D731_ROUTE_ELIGIBILITY_SCHEMA =
	"graphrefly.b112.d731.route-parameter-eligibility.v1" as const;
export const D731_REQUIRED_WIRE_MODEL_PARAMETERS = Object.freeze([
	"reasoning",
	"tool_choice",
	"tools",
] as const);

export interface D731RouteParameterEligibilityV1 {
	readonly schemaVersion: typeof D731_ROUTE_ELIGIBILITY_SCHEMA;
	readonly decisionRef: typeof D731_DECISION_REF;
	readonly decisionRevision: typeof D731_DECISION_REVISION;
	readonly modelSlug: typeof D729_MODEL_SLUG;
	readonly selectedEndpointModel: typeof D729_SELECTED_ENDPOINT_MODEL;
	readonly providerName: typeof D729_PROVIDER_NAME;
	readonly providerTag: typeof D729_PROVIDER_TAG;
	readonly quantization: typeof D729_QUANTIZATION;
	readonly requireParameters: true;
	readonly parallelToolCallsFieldPresent: false;
	readonly requiredWireModelParameters: typeof D731_REQUIRED_WIRE_MODEL_PARAMETERS;
	readonly supportedParameterSetDigest: string;
	readonly officialResponseDigest: string;
	readonly eligible: true;
	readonly eligibilityDigest: string;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const constructed = new WeakSet<object>();

function endpointRecords(responseBytes: Uint8Array): readonly Record<string, unknown>[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decoder.decode(responseBytes));
	} catch (error) {
		throw new TypeError("D731 official endpoint response is not strict UTF-8 JSON", {
			cause: error,
		});
	}
	const root = record(parsed, "d731.officialResponse");
	const data = record(root.data, "d731.officialResponse.data");
	literal(data.id, D729_MODEL_SLUG, "d731.officialResponse.data.id");
	return array(data.endpoints, "d731.officialResponse.data.endpoints").map((value, index) =>
		record(value, `d731.officialResponse.data.endpoints[${index}]`),
	);
}

function supportedParameters(endpoint: Record<string, unknown>): readonly string[] {
	const raw = array(endpoint.supported_parameters, "d731.endpoint.supportedParameters");
	if (raw.length < 1 || raw.length > 128)
		throw new TypeError("D731 endpoint supported-parameter bound is invalid");
	const values = raw.map((value, index) =>
		string(value, `d731.endpoint.supportedParameters[${index}]`, 128),
	);
	if (new Set(values).size !== values.length)
		throw new TypeError("D731 endpoint supported parameters contain duplicates");
	return Object.freeze([...values].sort());
}

export function createD731RouteParameterEligibility(inputValue: {
	readonly responseBytes: Uint8Array;
}): D731RouteParameterEligibilityV1 {
	const input = record(inputValue, "d731.routeEligibility.input");
	exactKeys(input, ["responseBytes"], "d731.routeEligibility.input");
	if (!(input.responseBytes instanceof Uint8Array))
		throw new TypeError("D731 route eligibility requires Uint8Array response bytes");
	const responseBytes = new Uint8Array(input.responseBytes);
	if (responseBytes.byteLength < 1 || responseBytes.byteLength > D712_MAX_OFFICIAL_RESPONSE_BYTES)
		throw new TypeError("D731 official endpoint response byte bound exceeded");
	const matches = endpointRecords(responseBytes).filter(
		(endpoint) =>
			endpoint.name === `${D729_PROVIDER_NAME} | ${D729_SELECTED_ENDPOINT_MODEL}` &&
			endpoint.provider_name === D729_PROVIDER_NAME &&
			endpoint.tag === D729_PROVIDER_TAG &&
			endpoint.quantization === D729_QUANTIZATION,
	);
	if (matches.length !== 1)
		throw new TypeError("D731 requires exactly one selected DeepInfra fp4 endpoint");
	const supported = supportedParameters(matches[0]!);
	for (const parameter of D731_REQUIRED_WIRE_MODEL_PARAMETERS)
		if (!supported.includes(parameter))
			throw new TypeError(`D731 selected endpoint does not support ${parameter}`);
	const material = strictSnapshot({
		schemaVersion: D731_ROUTE_ELIGIBILITY_SCHEMA,
		decisionRef: D731_DECISION_REF,
		decisionRevision: D731_DECISION_REVISION,
		modelSlug: D729_MODEL_SLUG,
		selectedEndpointModel: D729_SELECTED_ENDPOINT_MODEL,
		providerName: D729_PROVIDER_NAME,
		providerTag: D729_PROVIDER_TAG,
		quantization: D729_QUANTIZATION,
		requireParameters: true as const,
		parallelToolCallsFieldPresent: false as const,
		requiredWireModelParameters: D731_REQUIRED_WIRE_MODEL_PARAMETERS,
		supportedParameterSetDigest: empiricalStrictJsonDigest(supported),
		officialResponseDigest: empiricalSha256(responseBytes),
		eligible: true as const,
	});
	const eligibility = strictSnapshot({
		...material,
		eligibilityDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D731RouteParameterEligibilityV1;
	constructed.add(eligibility);
	return eligibility;
}

export function validateD731RouteParameterEligibility(
	value: unknown,
): D731RouteParameterEligibilityV1 {
	const candidate = record(value, "d731.routeEligibility");
	exactKeys(
		candidate,
		[
			"decisionRef",
			"decisionRevision",
			"eligibilityDigest",
			"eligible",
			"modelSlug",
			"officialResponseDigest",
			"parallelToolCallsFieldPresent",
			"providerName",
			"providerTag",
			"quantization",
			"requireParameters",
			"requiredWireModelParameters",
			"schemaVersion",
			"selectedEndpointModel",
			"supportedParameterSetDigest",
		],
		"d731.routeEligibility",
	);
	literal(candidate.schemaVersion, D731_ROUTE_ELIGIBILITY_SCHEMA, "d731.schema");
	literal(candidate.decisionRef, D731_DECISION_REF, "d731.decisionRef");
	literal(candidate.decisionRevision, D731_DECISION_REVISION, "d731.decisionRevision");
	literal(candidate.modelSlug, D729_MODEL_SLUG, "d731.modelSlug");
	literal(
		candidate.selectedEndpointModel,
		D729_SELECTED_ENDPOINT_MODEL,
		"d731.selectedEndpointModel",
	);
	literal(candidate.providerName, D729_PROVIDER_NAME, "d731.providerName");
	literal(candidate.providerTag, D729_PROVIDER_TAG, "d731.providerTag");
	literal(candidate.quantization, D729_QUANTIZATION, "d731.quantization");
	literal(candidate.requireParameters, true, "d731.requireParameters");
	literal(candidate.parallelToolCallsFieldPresent, false, "d731.parallelToolCallsFieldPresent");
	literal(
		empiricalStrictJsonDigest(candidate.requiredWireModelParameters),
		empiricalStrictJsonDigest(D731_REQUIRED_WIRE_MODEL_PARAMETERS),
		"d731.requiredWireModelParameters",
	);
	digest(candidate.supportedParameterSetDigest, "d731.supportedParameterSetDigest");
	digest(candidate.officialResponseDigest, "d731.officialResponseDigest");
	literal(candidate.eligible, true, "d731.eligible");
	const eligibilityDigest = digest(candidate.eligibilityDigest, "d731.eligibilityDigest");
	const { eligibilityDigest: _ignored, ...material } = candidate;
	literal(eligibilityDigest, empiricalStrictJsonDigest(material), "d731.eligibilityDigest");
	return strictSnapshot(candidate) as unknown as D731RouteParameterEligibilityV1;
}

export function consumeD731RouteParameterEligibility(
	value: unknown,
): D731RouteParameterEligibilityV1 {
	if (typeof value !== "object" || value === null || !constructed.delete(value))
		throw new TypeError("D731 route eligibility must be same-process and single-use");
	return validateD731RouteParameterEligibility(value);
}
