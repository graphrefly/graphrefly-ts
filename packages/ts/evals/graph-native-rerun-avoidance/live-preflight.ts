import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const CURRENT_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const;
export const CURRENT_ZERO_BYOK_SCHEMA = "graphrefly-ts.d69.zero-byok-observation.v1" as const;

export interface D44D45CredentialV1 {
	readonly bearerToken: string;
	readonly credentialBindingRef: "openrouter.local-eval-2";
	readonly credentialBindingRevision: "2026-08-21.d45.v1";
}

export interface D44D45PricingObservationV1 {
	readonly sourceUrl: typeof CURRENT_PRICING_SOURCE;
	readonly modelRef: "deepseek/deepseek-v4-flash-0731";
	readonly endpointModelRef: "deepseek/deepseek-v4-flash-20260731";
	readonly providerName: "DeepInfra";
	readonly providerTag: "deepinfra/fp8";
	readonly quantization: "fp8";
	readonly inputMicrousdPerMillionTokens: 80_000;
	readonly outputMicrousdPerMillionTokens: 180_000;
	readonly cacheReadMicrousdPerMillionTokens: 16_000;
	readonly supportedParametersDigest: string;
	readonly officialResponseDigest: string;
	readonly observedAtMs: number;
	readonly observationDigest: string;
}

export interface D44D45ZeroByokObservationV1 {
	readonly workspaceSlug: "graph-re-fly";
	readonly keyName: "Local Eval 2";
	readonly byokCredentialCount: 0;
	readonly providerObservation: "DeepInfra Not configured";
	readonly observedAtMs: number;
	readonly sourceArtifactDigest: string;
	readonly observationDigest: string;
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function strings(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
		throw new TypeError(`${path} must be strings`);
	return Object.freeze([...value].sort()) as readonly string[];
}

export async function readD44D45FreshPricing(input: {
	readonly fetchImpl: typeof fetch;
	readonly nowMs: number;
}): Promise<D44D45PricingObservationV1> {
	const response = await input.fetchImpl(CURRENT_PRICING_SOURCE, {
		method: "GET",
		redirect: "error",
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		headers: { accept: "application/json", "cache-control": "no-cache, no-store, max-age=0" },
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status !== 200 || response.redirected || response.url !== CURRENT_PRICING_SOURCE)
		throw new TypeError("current official pricing response was rejected or redirected");
	if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
		throw new TypeError("current official pricing response was not JSON");
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 1_048_576))
		throw new TypeError("current official pricing response exceeded its declared bound");
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
		throw new TypeError("current official pricing response exceeded its byte bound");
	const root = object(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
		"pricing",
	);
	const data = object(root.data, "pricing.data");
	if (data.id !== "deepseek/deepseek-v4-flash-0731")
		throw new TypeError("current official pricing model drifted");
	if (!Array.isArray(data.endpoints))
		throw new TypeError("current official pricing endpoints drifted");
	const matches = data.endpoints
		.map((entry) => object(entry, "pricing.endpoint"))
		.filter(
			(endpoint) =>
				endpoint.provider_name === "DeepInfra" &&
				endpoint.tag === "deepinfra/fp8" &&
				endpoint.quantization === "fp8" &&
				(endpoint.model === "deepseek/deepseek-v4-flash-20260731" ||
					endpoint.name === "DeepInfra | deepseek/deepseek-v4-flash-20260731"),
		);
	if (matches.length !== 1)
		throw new TypeError("current official pricing exact route was unavailable");
	const endpoint = matches[0]!;
	const supported = strings(endpoint.supported_parameters, "pricing.supported_parameters");
	for (const required of ["reasoning", "tool_choice", "tools"])
		if (!supported.includes(required)) throw new TypeError(`current route omitted ${required}`);
	const pricing = object(endpoint.pricing, "pricing.endpoint.pricing");
	if (
		pricing.prompt !== "0.00000008" ||
		pricing.completion !== "0.00000018" ||
		pricing.input_cache_read !== "0.000000016"
	)
		throw new TypeError("current official pricing drifted from the frozen fp8 schedule");
	const material = strictSnapshot({
		sourceUrl: CURRENT_PRICING_SOURCE,
		modelRef: "deepseek/deepseek-v4-flash-0731" as const,
		endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
		providerName: "DeepInfra" as const,
		providerTag: "deepinfra/fp8" as const,
		quantization: "fp8" as const,
		inputMicrousdPerMillionTokens: 80_000 as const,
		outputMicrousdPerMillionTokens: 180_000 as const,
		cacheReadMicrousdPerMillionTokens: 16_000 as const,
		supportedParametersDigest: empiricalStrictJsonDigest(supported),
		officialResponseDigest: empiricalSha256(bytes),
		observedAtMs: input.nowMs,
	});
	return Object.freeze({ ...material, observationDigest: empiricalStrictJsonDigest(material) });
}

export function admitD44D45FreshZeroByok(input: {
	readonly bytes: Uint8Array;
	readonly credential: D44D45CredentialV1;
	readonly nowMs: number;
}): D44D45ZeroByokObservationV1 {
	if (input.bytes.byteLength < 1 || input.bytes.byteLength > 16_384)
		throw new TypeError("current zero-BYOK artifact exceeded its bound");
	const value = object(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)),
		"zeroByok",
	);
	const observedAtMs = Date.parse(String(value.observedAt));
	if (
		value.schemaVersion !== CURRENT_ZERO_BYOK_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D69" ||
		value.workspaceName !== "GraphReFly" ||
		value.workspaceSlug !== "graph-re-fly" ||
		value.keyName !== "Local Eval 2" ||
		value.byokCredentialCount !== 0 ||
		value.providerObservation !== "DeepInfra Not configured" ||
		value.source !== "openrouter-browser-settings" ||
		!Number.isSafeInteger(observedAtMs) ||
		Math.abs(input.nowMs - observedAtMs) > 3_600_000 ||
		!input.credential.bearerToken.startsWith(String(value.keyVisiblePrefix)) ||
		!input.credential.bearerToken.endsWith(String(value.keyVisibleSuffix)) ||
		JSON.stringify(value.allowedModels) !== JSON.stringify(["deepseek/deepseek-v4-flash-0731"]) ||
		JSON.stringify(value.allowedProviders) !== JSON.stringify(["DeepInfra"])
	)
		throw new TypeError("current zero-BYOK observation failed same-credential admission");
	const material = strictSnapshot({
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		providerObservation: "DeepInfra Not configured" as const,
		observedAtMs,
		sourceArtifactDigest: empiricalSha256(input.bytes),
	});
	return Object.freeze({ ...material, observationDigest: empiricalStrictJsonDigest(material) });
}
