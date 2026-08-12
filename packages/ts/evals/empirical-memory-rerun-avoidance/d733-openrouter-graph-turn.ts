import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { D720EffectResultV1 } from "./d722-graph-native-effect-runtime.js";
import {
	type D723OpenRouterConversationV1,
	type D723OpenRouterTurnV1,
	invokeD723OpenRouterGraphTurn,
} from "./d723-openrouter-graph-turn.js";
import {
	type D733GraphNativeRouteAdmissionV1,
	readD733AdmittedRouteProfile,
} from "./d733-graph-native-route-profile.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
	OpenRouterResponsesTransportRequestV1,
	OpenRouterResponsesTransportResponseV1,
} from "./openrouter-responses-model-turn.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
} from "./openrouter-route-qualification.js";

export const D733_OPENROUTER_GRAPH_TURN_REVISION =
	"graphrefly.b112.d733.openrouter-graph-turn.v1" as const;

export interface D733OpenRouterTurnV1 extends D723OpenRouterTurnV1 {
	readonly revision: typeof D733_OPENROUTER_GRAPH_TURN_REVISION;
	readonly routeProfileDigest: string;
	readonly routeAdmissionDigest: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function parseJson(bytes: Uint8Array, path: string): Record<string, unknown> {
	if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
		throw new TypeError(`${path} bytes are outside the bound`);
	let value: unknown;
	try {
		value = JSON.parse(decoder.decode(bytes));
	} catch (error) {
		throw new TypeError(`${path} is not UTF-8 JSON`, { cause: error });
	}
	return record(value, path);
}

function validateTransportResponse(value: unknown): OpenRouterResponsesTransportResponseV1 {
	const candidate = record(value, "d733.transportResponse");
	exactKeys(
		candidate,
		Object.hasOwn(candidate, "retryAfterDisposition")
			? ["body", "retryAfterDisposition", "retryAfterMs", "status"]
			: ["body", "retryAfterMs", "status"],
		"d733.transportResponse",
	);
	const status = safeInteger(candidate.status, "d733.transportResponse.status", {
		min: 100,
		max: 599,
	});
	if (!(candidate.body instanceof Uint8Array) || candidate.body.byteLength > 1_048_576)
		throw new TypeError("D733 transport response body is invalid");
	const body = new Uint8Array(candidate.body);
	const retryAfterMs =
		candidate.retryAfterMs === null
			? null
			: safeInteger(candidate.retryAfterMs, "d733.transportResponse.retryAfterMs", {
					max: 86_400_000,
				});
	if (!Object.hasOwn(candidate, "retryAfterDisposition"))
		return Object.freeze({ status, body, retryAfterMs });
	const retryAfterDisposition = oneOf(
		candidate.retryAfterDisposition,
		["absent", "parsed", "invalid", "unavailable"] as const,
		"d733.transportResponse.retryAfterDisposition",
	);
	if (
		(retryAfterDisposition === "parsed" && retryAfterMs === null) ||
		(retryAfterDisposition !== "parsed" && retryAfterMs !== null)
	)
		throw new TypeError("D733 Retry-After value and disposition disagree");
	return Object.freeze({ status, body, retryAfterMs, retryAfterDisposition });
}

function lowerRequestBody(
	bytes: Uint8Array,
	profile: ReturnType<typeof readD733AdmittedRouteProfile>,
): Uint8Array {
	const body = parseJson(bytes, "d733.requestBody");
	exactKeys(
		body,
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d733.requestBody",
	);
	if (Object.hasOwn(body, "parallel_tool_calls"))
		throw new TypeError("D733 request body contains parallel_tool_calls");
	const lowered = strictSnapshot({
		...body,
		model: profile.requestModel,
		provider: {
			order: [profile.providerTag],
			only: [profile.providerTag],
			allow_fallbacks: false,
			require_parameters: true,
		},
		reasoning: { effort: profile.reasoningEffort },
	}) as StrictJsonValue;
	const encoded = encoder.encode(JSON.stringify(lowered));
	if (encoded.byteLength > 262_144) throw new TypeError("D733 lowered request exceeds the bound");
	return encoded;
}

function routeBoundSuccessfulResponse(
	response: OpenRouterResponsesTransportResponseV1,
	profile: ReturnType<typeof readD733AdmittedRouteProfile>,
): {
	readonly response: OpenRouterResponsesTransportResponseV1;
	readonly actualRouteEvidenceDigest: string;
	readonly usage: Readonly<{ promptTokens: number; completionTokens: number; cost: number | null }>;
} {
	const root = parseJson(response.body, "d733.providerResponse");
	const routeEvidence = record(
		root.openrouter_metadata,
		"d733.providerResponse.openrouterMetadata",
	);
	const endpoints = record(routeEvidence.endpoints, "d733.providerResponse.endpoints");
	const available = array(endpoints.available, "d733.providerResponse.availableEndpoints");
	const selected = available.filter((entry, index) => {
		const endpoint = record(entry, `d733.providerResponse.availableEndpoints[${index}]`);
		return endpoint.selected === true;
	});
	if (selected.length !== 1)
		throw new TypeError("D733 provider response requires one selected route");
	const selectedRoute = record(selected[0], "d733.providerResponse.selectedEndpoint");
	if (
		selectedRoute.provider !== profile.providerName ||
		selectedRoute.model !== profile.selectedEndpointModel
	)
		throw new TypeError("D733 provider route evidence does not match the admitted profile");
	const usage = record(root.usage, "d733.providerResponse.usage");
	const promptTokens = safeInteger(usage.prompt_tokens, "d733.usage.promptTokens", {
		max: 40_000_000,
	});
	const completionTokens = safeInteger(usage.completion_tokens, "d733.usage.completionTokens", {
		max: 12_582_912,
	});
	const cost =
		typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0
			? safeInteger(Math.ceil(usage.cost * 1_000_000), "d733.usage.cost", { max: 6_000_000 })
			: null;
	const rewrittenAvailable = available.map((entry, index) => {
		const endpoint = record(entry, `d733.providerResponse.availableEndpoints[${index}]`);
		return endpoint.selected === true
			? strictSnapshot({
					...endpoint,
					provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
					model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
				})
			: strictSnapshot(endpoint);
	});
	const rewritten = strictSnapshot({
		...root,
		openrouter_metadata: {
			...routeEvidence,
			endpoints: { ...endpoints, available: rewrittenAvailable },
		},
	}) as StrictJsonValue;
	return Object.freeze({
		response: Object.freeze({ ...response, body: encoder.encode(JSON.stringify(rewritten)) }),
		actualRouteEvidenceDigest: empiricalStrictJsonDigest(routeEvidence),
		usage: Object.freeze({ promptTokens, completionTokens, cost }),
	});
}

export async function invokeD733OpenRouterGraphTurn(input: {
	readonly effectRequest: Parameters<typeof invokeD723OpenRouterGraphTurn>[0]["effectRequest"];
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly taskStatement: string;
	readonly conversation: D723OpenRouterConversationV1;
	readonly signal: AbortSignal;
	readonly monotonicNowMs: () => number;
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
}): Promise<D733OpenRouterTurnV1> {
	const descriptor = Object.getOwnPropertyDescriptor(input, "routeAdmission");
	if (
		descriptor === undefined ||
		descriptor.get !== undefined ||
		descriptor.set !== undefined ||
		!("value" in descriptor)
	)
		throw new TypeError("D733 route admission must be an own data property");
	const routeAdmission = descriptor.value as D733GraphNativeRouteAdmissionV1;
	const profile = readD733AdmittedRouteProfile(routeAdmission);
	const transportRecord = record(input.transport, "d733.transport");
	exactKeys(transportRecord, ["request"], "d733.transport");
	const requestPort = transportRecord.request;
	if (typeof requestPort !== "function")
		throw new TypeError("D733 transport request port is invalid");
	let transportCalls = 0;
	let routeEvidenceDigest: string | null = null;
	let usage: Readonly<{
		promptTokens: number;
		completionTokens: number;
		cost: number | null;
	}> | null = null;
	const transport: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			transportCalls += 1;
			if (transportCalls !== 1)
				throw new TypeError("D733 turn transport was called more than once");
			const response = validateTransportResponse(
				await Reflect.apply(requestPort, input.transport, [
					{
						...request,
						endpoint: profile.endpointUrl,
						body: lowerRequestBody(request.body, profile),
					},
				]),
			);
			if (response.status !== 200) return response;
			const bound = routeBoundSuccessfulResponse(response, profile);
			routeEvidenceDigest = bound.actualRouteEvidenceDigest;
			usage = bound.usage;
			return bound.response;
		},
	});
	const turn = await invokeD723OpenRouterGraphTurn({
		effectRequest: input.effectRequest,
		credential: input.credential,
		transport,
		taskStatement: input.taskStatement,
		conversation: input.conversation,
		signal: input.signal,
		monotonicNowMs: input.monotonicNowMs,
	});
	if (transportCalls !== 1) throw new TypeError("D733 turn omitted its transport call");
	const actualCostMicrousd =
		usage === null
			? turn.actualCostMicrousd
			: ((usage as { cost: number | null }).cost ??
				Math.ceil(
					((usage as { promptTokens: number }).promptTokens *
						profile.pricing.inputMicrousdPerMillionTokens) /
						1_000_000 +
						((usage as { completionTokens: number }).completionTokens *
							profile.pricing.outputMicrousdPerMillionTokens) /
							1_000_000,
				));
	const result: D720EffectResultV1 = Object.freeze({
		...turn.result,
		evidenceDigest: empiricalStrictJsonDigest({
			underlyingEvidenceDigest: turn.result.evidenceDigest,
			routeProfileDigest: profile.profileDigest,
			routeAdmissionDigest: routeAdmission.admissionDigest,
			actualRouteEvidenceDigest: routeEvidenceDigest,
		}),
	});
	return Object.freeze({
		...turn,
		result,
		actualCostMicrousd,
		revision: D733_OPENROUTER_GRAPH_TURN_REVISION,
		routeProfileDigest: profile.profileDigest,
		routeAdmissionDigest: routeAdmission.admissionDigest,
	});
}
