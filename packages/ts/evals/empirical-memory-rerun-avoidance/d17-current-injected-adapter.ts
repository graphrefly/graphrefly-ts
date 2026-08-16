import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	type D17AdmittedEffectV1,
	type D17AuthorityV1,
	type D17EffectResultInputV1,
	takeD17ProviderMaterial,
} from "./d17-current-efficacy-authority.js";

export const D17_INJECTED_ADAPTER_REVISION =
	"graphrefly-ts.d17.injected-provider-adapter.v1" as const;

export interface D17InjectedWireRequestV1 {
	readonly endpoint: "https://openrouter.ai/api/v1/chat/completions";
	readonly method: "POST";
	readonly body: Readonly<{
		model: "deepseek/deepseek-v4-flash-0731";
		provider: Readonly<{
			only: readonly ["DeepInfra"];
			require_parameters: true;
			allow_fallbacks: false;
		}>;
		reasoning: Readonly<{ effort: "high" }>;
		messages: readonly [Readonly<{ role: "user"; content: string }>];
		tools: readonly Readonly<Record<string, unknown>>[];
		tool_choice:
			| "auto"
			| Readonly<{ type: "function"; function: Readonly<{ name: "replace_exact" }> }>;
		parallel_tool_calls?: never;
	}>;
	readonly deadlineMs: number;
	readonly bodyDigest: string;
}

export interface D17InjectedTransportResultV1 {
	readonly status: "completed" | "failed";
	readonly toolIntents: readonly ("read-file" | "replace-exact")[];
	readonly failureFamily: "transport" | "http" | "executor" | null;
	readonly usage: Readonly<{ costMicrousd: number; elapsedMs: number }>;
	readonly responseDigest: string;
}

export type D17InjectedTransportV1 = (
	request: D17InjectedWireRequestV1,
) => Promise<D17InjectedTransportResultV1>;

const TOOLS = Object.freeze([
	Object.freeze({
		type: "function",
		function: Object.freeze({
			name: "read_file",
			description: "Read one allowed workspace file.",
			parameters: Object.freeze({
				type: "object",
				properties: Object.freeze({ path: Object.freeze({ type: "string" }) }),
				required: Object.freeze(["path"]),
				additionalProperties: false,
			}),
		}),
	}),
	Object.freeze({
		type: "function",
		function: Object.freeze({
			name: "replace_exact",
			description: "Replace one exact occurrence in the allowed writable file.",
			parameters: Object.freeze({
				type: "object",
				properties: Object.freeze({
					path: Object.freeze({ type: "string" }),
					oldText: Object.freeze({ type: "string" }),
					newText: Object.freeze({ type: "string" }),
				}),
				required: Object.freeze(["path", "oldText", "newText"]),
				additionalProperties: false,
			}),
		}),
	}),
]);

function lower(authority: D17AuthorityV1, effect: D17AdmittedEffectV1): D17InjectedWireRequestV1 {
	if (effect.request.effectKind !== "provider-request")
		throw new TypeError("D17 injected adapter accepts only provider effects");
	const material = takeD17ProviderMaterial(authority, effect);
	const messages = Object.freeze([
		Object.freeze({ role: "user" as const, content: material.modelVisibleEnvelope }),
	] as const);
	const body = Object.freeze({
		model: "deepseek/deepseek-v4-flash-0731" as const,
		provider: Object.freeze({
			only: Object.freeze(["DeepInfra"] as const),
			require_parameters: true as const,
			allow_fallbacks: false as const,
		}),
		reasoning: Object.freeze({ effort: "high" as const }),
		messages,
		tools: TOOLS,
		tool_choice:
			effect.request.requiredFirstToolRef === "replace-exact"
				? Object.freeze({
						type: "function" as const,
						function: Object.freeze({ name: "replace_exact" as const }),
					})
				: ("auto" as const),
	});
	const modelVisibleEnvelopeDigest = empiricalStrictJsonDigest({ messages });
	if (modelVisibleEnvelopeDigest !== effect.request.modelVisibleEnvelopeDigest)
		throw new TypeError("D17 final wire messages do not match the Graph exposure");
	const bodyDigest = empiricalSha256(strictJsonCodec.encode(body as unknown as StrictJsonValue));
	return Object.freeze({
		endpoint: "https://openrouter.ai/api/v1/chat/completions" as const,
		method: "POST" as const,
		body,
		deadlineMs: effect.request.reservation.maxElapsedMs,
		bodyDigest,
	});
}

export async function executeD17InjectedProviderEffect(input: {
	readonly authority: D17AuthorityV1;
	readonly effect: D17AdmittedEffectV1;
	readonly transport: D17InjectedTransportV1;
}): Promise<D17EffectResultInputV1> {
	const request = lower(input.authority, input.effect);
	const result = await input.transport(request);
	if (
		result.usage.costMicrousd < 0 ||
		!Number.isSafeInteger(result.usage.costMicrousd) ||
		result.usage.costMicrousd > input.effect.request.reservation.maxCostMicrousd ||
		result.usage.elapsedMs < 0 ||
		!Number.isSafeInteger(result.usage.elapsedMs) ||
		result.usage.elapsedMs > input.effect.request.reservation.maxElapsedMs ||
		result.toolIntents.length > 4
	)
		throw new TypeError("D17 injected provider result exceeded its admitted bounds");
	const resultMaterial = strictSnapshot({
		adapterRevision: D17_INJECTED_ADAPTER_REVISION,
		requestDigest: input.effect.request.requestDigest,
		admissionDigest: input.effect.admission.admissionDigest,
		bodyDigest: request.bodyDigest,
		responseDigest: result.responseDigest,
		status: result.status,
		failureFamily: result.failureFamily,
		toolIntents: result.toolIntents,
		usage: result.usage,
	});
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: result.status,
		toolIntents: Object.freeze([...result.toolIntents]),
		observedModelVisibleEnvelopeDigest: input.effect.request.modelVisibleEnvelopeDigest,
		wireMessagesDigest: empiricalStrictJsonDigest({ messages: request.body.messages }),
		failureFamily: result.failureFamily,
		evidenceDigest: empiricalStrictJsonDigest(resultMaterial),
		actualCostMicrousd: result.usage.costMicrousd,
		actualElapsedMs: result.usage.elapsedMs,
	});
}

export function lowerD17ProviderEffectForTest(
	authority: D17AuthorityV1,
	effect: D17AdmittedEffectV1,
): D17InjectedWireRequestV1 {
	return lower(authority, effect);
}
