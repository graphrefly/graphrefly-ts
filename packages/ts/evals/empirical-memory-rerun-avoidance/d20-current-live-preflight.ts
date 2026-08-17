import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	D20_COORDINATES_DIGEST,
	D20_DECISION_REF,
	D20_PRICING_REVISION,
	D20_PRICING_SOURCE,
	D20_PROVIDER,
	D20_PROVIDER_TAG,
	D20_QUANTIZATION,
	D20_REQUEST_MODEL,
	D20_SELECTED_ENDPOINT_MODEL,
} from "./d20-current-live-coordinates.js";

export const D20_PRICING_OBSERVATION_SCHEMA =
	"graphrefly-ts.d20.live-pricing-observation.v1" as const;
export const D20_ZERO_BYOK_SCHEMA = "graphrefly-ts.d20.zero-byok-observation.v1" as const;
export const D20_PRECLAIM_SCHEMA = "graphrefly-ts.d20.live-preclaim.v1" as const;
export const D20_MAX_PRICING_BYTES = 1_048_576;
export const D20_MAX_ZERO_BYOK_BYTES = 16_384;
export const D20_PRICING_MAX_AGE_MS = 120_000;
export const D20_ZERO_BYOK_MAX_AGE_MS = 3_600_000;

export interface D20CredentialV1 {
	readonly bearerToken: string;
	readonly credentialBindingRef: "openrouter.local-eval-2";
	readonly credentialBindingRevision: "2026-08-14.v1";
}

export interface D20PricingObservationV1 {
	readonly schemaVersion: typeof D20_PRICING_OBSERVATION_SCHEMA;
	readonly sourceUrl: typeof D20_PRICING_SOURCE;
	readonly coordinatesDigest: string;
	readonly officialResponseDigest: string;
	readonly selectedEndpointDigest: string;
	readonly supportedParametersDigest: string;
	readonly pricingRevision: typeof D20_PRICING_REVISION;
	readonly inputMicrousdPerMillionTokens: 80_000;
	readonly outputMicrousdPerMillionTokens: 180_000;
	readonly cacheReadMicrousdPerMillionTokens: 16_000;
	readonly observedAtMs: number;
	readonly observationDigest: string;
}

export interface D20ZeroByokObservationV1 {
	readonly schemaVersion: typeof D20_ZERO_BYOK_SCHEMA;
	readonly decisionRef: typeof D20_DECISION_REF;
	readonly workspaceName: "GraphReFly";
	readonly workspaceSlug: "graph-re-fly";
	readonly keyName: "Local Eval 2";
	readonly byokCredentialCount: 0;
	readonly allowedModelSetDigest: string;
	readonly allowedProviderSetDigest: string;
	readonly observedAt: string;
	readonly source: "openrouter-browser-settings";
	readonly sourceArtifactDigest: string;
	readonly credentialBindingDigest: string;
	readonly observationDigest: string;
}

export interface D20PreclaimV1 {
	readonly schemaVersion: typeof D20_PRECLAIM_SCHEMA;
	readonly coordinatesDigest: string;
	readonly pricingObservation: D20PricingObservationV1;
	readonly zeroByokObservation: D20ZeroByokObservationV1;
	readonly credentialBindingDigest: string;
	readonly expiresAtMs: number;
	readonly preclaimDigest: string;
}

const pricingCapabilities = new WeakSet<object>();
const zeroByokCapabilities = new WeakSet<object>();
const preclaimCapabilities = new WeakSet<object>();

function ownData(value: Record<string, unknown>, key: string, path: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor === undefined || !("value" in descriptor) || descriptor.get || descriptor.set)
		throw new TypeError(`${path}.${key} must be an own data property`);
	return descriptor.value;
}

function boundedString(value: unknown, path: string, maxBytes: number): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value, "utf8") > maxBytes
	)
		throw new TypeError(`${path} is outside its byte bound`);
	return value;
}

function exactStringSet(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length < 1 || values.length > 128) throw new TypeError(`${path} is outside its bound`);
	const strings = values.map((entry, index) => boundedString(entry, `${path}[${index}]`, 256));
	if (new Set(strings).size !== strings.length) throw new TypeError(`${path} contains duplicates`);
	return Object.freeze([...strings].sort());
}

async function readBoundedBody(
	response: Response,
	maxBytes: number,
	signal: AbortSignal,
): Promise<Uint8Array> {
	let declared: string | null;
	try {
		declared = response.headers.get("content-length");
	} catch {
		throw new TypeError("D20 response headers were unreadable");
	}
	if (declared !== null) {
		const length = Number(declared);
		if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes) {
			await response.body?.cancel().catch(() => undefined);
			throw new TypeError("D20 response exceeds its declared byte bound");
		}
	}
	if (response.body === null) throw new TypeError("D20 response body is missing");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			if (signal.aborted) throw new DOMException("D20 preflight cancelled", "AbortError");
			const next = await reader.read();
			if (next.done) break;
			if (!(next.value instanceof Uint8Array))
				throw new TypeError("D20 response yielded non-byte data");
			total += next.value.byteLength;
			if (total > maxBytes) throw new TypeError("D20 response exceeds its byte bound");
			chunks.push(next.value.slice());
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (total < 1) throw new TypeError("D20 response body is empty");
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function decodeJson(bytes: Uint8Array, path: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError(`${path} is not bounded UTF-8 JSON`, { cause: error });
	}
}

function parsePricing(bytes: Uint8Array) {
	const root = record(decodeJson(bytes, "D20 pricing response"), "D20 pricing response");
	const data = record(ownData(root, "data", "D20 pricing response"), "D20 pricing data");
	if (ownData(data, "id", "D20 pricing data") !== D20_REQUEST_MODEL)
		throw new TypeError("D20 pricing model drifted");
	const endpoints = array(ownData(data, "endpoints", "D20 pricing data"), "D20 endpoints");
	if (endpoints.length < 1 || endpoints.length > 256)
		throw new TypeError("D20 endpoint cardinality is outside its bound");
	const matches = endpoints
		.map((entry, index) => record(entry, `D20 endpoints[${index}]`))
		.filter(
			(endpoint) =>
				endpoint.provider_name === D20_PROVIDER &&
				endpoint.tag === D20_PROVIDER_TAG &&
				endpoint.quantization === D20_QUANTIZATION &&
				(endpoint.model === D20_SELECTED_ENDPOINT_MODEL ||
					endpoint.name === `${D20_PROVIDER} | ${D20_SELECTED_ENDPOINT_MODEL}`),
		);
	if (matches.length !== 1) throw new TypeError("D20 pricing requires one exact endpoint");
	const endpoint = matches[0]!;
	const supported = exactStringSet(
		ownData(endpoint, "supported_parameters", "D20 pricing endpoint"),
		"D20 supported parameters",
	);
	for (const required of ["max_tokens", "reasoning", "tool_choice", "tools"])
		if (!supported.includes(required))
			throw new TypeError(`D20 endpoint does not support ${required}`);
	const pricing = record(ownData(endpoint, "pricing", "D20 pricing endpoint"), "D20 pricing");
	for (const [key, expected] of [
		["prompt", "0.00000008"],
		["completion", "0.00000018"],
		["input_cache_read", "0.000000016"],
	] as const)
		if (ownData(pricing, key, "D20 pricing") !== expected)
			throw new TypeError(`D20 official ${key} pricing drifted`);
	return Object.freeze({ endpoint: strictSnapshot(endpoint), supported });
}

export async function readD20OfficialPricing(inputValue: {
	readonly fetch: typeof fetch;
	readonly nowMs: () => number;
	readonly signal: AbortSignal;
}): Promise<D20PricingObservationV1> {
	const input = record(inputValue, "D20 pricing input");
	exactKeys(input, ["fetch", "nowMs", "signal"], "D20 pricing input");
	if (typeof input.fetch !== "function" || typeof input.nowMs !== "function")
		throw new TypeError("D20 pricing input is invalid");
	if (!(input.signal instanceof AbortSignal) || input.signal.aborted)
		throw new DOMException("D20 pricing cancelled", "AbortError");
	const response = (await Reflect.apply(input.fetch, undefined, [
		D20_PRICING_SOURCE,
		{
			method: "GET",
			redirect: "error",
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			headers: {
				accept: "application/json",
				"cache-control": "no-cache, no-store, max-age=0",
				pragma: "no-cache",
			},
			signal: input.signal,
		},
	])) as Response;
	if (
		!(response instanceof Response) ||
		response.status !== 200 ||
		response.redirected ||
		response.url !== D20_PRICING_SOURCE
	)
		throw new TypeError("D20 official pricing read was rejected or redirected");
	if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
		throw new TypeError("D20 official pricing response is not JSON");
	const bytes = await readBoundedBody(response, D20_MAX_PRICING_BYTES, input.signal);
	const parsed = parsePricing(bytes);
	const observedAtMs = Number(Reflect.apply(input.nowMs, undefined, []));
	if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0)
		throw new TypeError("D20 pricing clock is invalid");
	const material = strictSnapshot({
		schemaVersion: D20_PRICING_OBSERVATION_SCHEMA,
		sourceUrl: D20_PRICING_SOURCE,
		coordinatesDigest: D20_COORDINATES_DIGEST,
		officialResponseDigest: empiricalSha256(bytes),
		selectedEndpointDigest: empiricalStrictJsonDigest(parsed.endpoint),
		supportedParametersDigest: empiricalStrictJsonDigest(parsed.supported),
		pricingRevision: D20_PRICING_REVISION,
		inputMicrousdPerMillionTokens: 80_000 as const,
		outputMicrousdPerMillionTokens: 180_000 as const,
		cacheReadMicrousdPerMillionTokens: 16_000 as const,
		observedAtMs,
	});
	const observation = Object.freeze({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	}) as D20PricingObservationV1;
	pricingCapabilities.add(observation);
	return observation;
}

function credential(value: unknown): D20CredentialV1 {
	const candidate = record(value, "D20 credential");
	exactKeys(
		candidate,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"D20 credential",
	);
	const token = boundedString(candidate.bearerToken, "D20 credential bearer token", 4_096);
	if (
		token.length < 16 ||
		candidate.credentialBindingRef !== "openrouter.local-eval-2" ||
		candidate.credentialBindingRevision !== "2026-08-14.v1"
	)
		throw new TypeError("D20 credential coordinates drifted");
	return candidate as unknown as D20CredentialV1;
}

function credentialBinding(value: D20CredentialV1, prefix: string, suffix: string): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: value.credentialBindingRef,
		credentialBindingRevision: value.credentialBindingRevision,
		keyVisiblePrefix: prefix,
		keyVisibleSuffix: suffix,
	});
}

export function admitD20ZeroByok(inputValue: {
	readonly bytes: Uint8Array;
	readonly credential: D20CredentialV1;
	readonly nowMs: number;
}): D20ZeroByokObservationV1 {
	const input = record(inputValue, "D20 zero-BYOK input");
	exactKeys(input, ["bytes", "credential", "nowMs"], "D20 zero-BYOK input");
	if (!(input.bytes instanceof Uint8Array)) throw new TypeError("D20 zero-BYOK bytes are invalid");
	const bytes = new Uint8Array(input.bytes);
	if (bytes.byteLength < 1 || bytes.byteLength > D20_MAX_ZERO_BYOK_BYTES)
		throw new TypeError("D20 zero-BYOK artifact exceeds its byte bound");
	const admittedCredential = credential(input.credential);
	const value = record(decodeJson(bytes, "D20 zero-BYOK artifact"), "D20 zero-BYOK artifact");
	exactKeys(
		value,
		[
			"allowedModels",
			"allowedProviders",
			"byokCredentialCount",
			"decisionRef",
			"keyName",
			"keyVisiblePrefix",
			"keyVisibleSuffix",
			"observedAt",
			"schemaVersion",
			"source",
			"workspaceName",
			"workspaceSlug",
		],
		"D20 zero-BYOK artifact",
	);
	if (
		value.schemaVersion !== D20_ZERO_BYOK_SCHEMA ||
		value.decisionRef !== D20_DECISION_REF ||
		value.workspaceName !== "GraphReFly" ||
		value.workspaceSlug !== "graph-re-fly" ||
		value.keyName !== "Local Eval 2" ||
		value.byokCredentialCount !== 0 ||
		value.source !== "openrouter-browser-settings"
	)
		throw new TypeError("D20 zero-BYOK coordinates drifted");
	const prefix = boundedString(value.keyVisiblePrefix, "D20 zero-BYOK key prefix", 64);
	const suffix = boundedString(value.keyVisibleSuffix, "D20 zero-BYOK key suffix", 64);
	if (
		prefix !== admittedCredential.bearerToken.slice(0, 12) ||
		suffix !== admittedCredential.bearerToken.slice(-3)
	)
		throw new TypeError("D20 zero-BYOK is not bound to the credential");
	const models = exactStringSet(value.allowedModels, "D20 zero-BYOK models");
	const providers = exactStringSet(value.allowedProviders, "D20 zero-BYOK providers");
	if (!models.includes(D20_REQUEST_MODEL) || !providers.includes(D20_PROVIDER))
		throw new TypeError("D20 zero-BYOK does not allow the route");
	const observedAt = boundedString(value.observedAt, "D20 zero-BYOK observedAt", 64);
	const observedAtMs = Date.parse(observedAt);
	const nowMs = Number(input.nowMs);
	if (!Number.isSafeInteger(nowMs) || !Number.isFinite(observedAtMs))
		throw new TypeError("D20 zero-BYOK clock is invalid");
	const ageMs = nowMs - observedAtMs;
	if (ageMs < 0 || ageMs > D20_ZERO_BYOK_MAX_AGE_MS)
		throw new TypeError("D20 zero-BYOK observation is not fresh");
	const binding = credentialBinding(admittedCredential, prefix, suffix);
	const material = strictSnapshot({
		schemaVersion: D20_ZERO_BYOK_SCHEMA,
		decisionRef: D20_DECISION_REF,
		workspaceName: "GraphReFly" as const,
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		allowedModelSetDigest: empiricalStrictJsonDigest(models),
		allowedProviderSetDigest: empiricalStrictJsonDigest(providers),
		observedAt,
		source: "openrouter-browser-settings" as const,
		sourceArtifactDigest: empiricalSha256(bytes),
		credentialBindingDigest: binding,
	});
	const observation = Object.freeze({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	}) as D20ZeroByokObservationV1;
	zeroByokCapabilities.add(observation);
	return observation;
}

export function composeD20Preclaim(inputValue: {
	readonly pricingObservation: D20PricingObservationV1;
	readonly zeroByokObservation: D20ZeroByokObservationV1;
	readonly credential: D20CredentialV1;
	readonly nowMs: number;
}): D20PreclaimV1 {
	const input = record(inputValue, "D20 preclaim input");
	exactKeys(
		input,
		["credential", "nowMs", "pricingObservation", "zeroByokObservation"],
		"D20 preclaim input",
	);
	if (
		typeof input.pricingObservation !== "object" ||
		input.pricingObservation === null ||
		!pricingCapabilities.delete(input.pricingObservation) ||
		typeof input.zeroByokObservation !== "object" ||
		input.zeroByokObservation === null ||
		!zeroByokCapabilities.delete(input.zeroByokObservation)
	)
		throw new TypeError("D20 preclaim inputs are forged, stale or replayed");
	const pricing = input.pricingObservation as D20PricingObservationV1;
	const zeroByok = input.zeroByokObservation as D20ZeroByokObservationV1;
	const admittedCredential = credential(input.credential);
	const binding = credentialBinding(
		admittedCredential,
		admittedCredential.bearerToken.slice(0, 12),
		admittedCredential.bearerToken.slice(-3),
	);
	if (binding !== zeroByok.credentialBindingDigest)
		throw new TypeError("D20 preclaim credential binding drifted");
	const nowMs = Number(input.nowMs);
	if (
		!Number.isSafeInteger(nowMs) ||
		nowMs < pricing.observedAtMs ||
		nowMs - pricing.observedAtMs > D20_PRICING_MAX_AGE_MS
	)
		throw new TypeError("D20 pricing observation is not fresh at claim composition");
	const material = strictSnapshot({
		schemaVersion: D20_PRECLAIM_SCHEMA,
		coordinatesDigest: D20_COORDINATES_DIGEST,
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credentialBindingDigest: binding,
		expiresAtMs: pricing.observedAtMs + D20_PRICING_MAX_AGE_MS,
	});
	const preclaim = Object.freeze({
		...material,
		preclaimDigest: empiricalStrictJsonDigest(material),
	}) as D20PreclaimV1;
	preclaimCapabilities.add(preclaim);
	return preclaim;
}

export function consumeD20Preclaim(value: unknown, nowMsValue: number): D20PreclaimV1 {
	if (typeof value !== "object" || value === null || !preclaimCapabilities.delete(value))
		throw new TypeError("D20 preclaim must be same-process and single-use");
	const preclaim = value as D20PreclaimV1;
	const nowMs = Number(nowMsValue);
	if (!Number.isSafeInteger(nowMs) || nowMs > preclaim.expiresAtMs)
		throw new TypeError("D20 preclaim expired before claim acquisition");
	digest(preclaim.preclaimDigest, "D20 preclaim digest");
	return preclaim;
}

export function d20ZeroByokCanonicalBytes(value: unknown): Uint8Array {
	const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
	if (bytes.byteLength < 1 || bytes.byteLength > D20_MAX_ZERO_BYOK_BYTES)
		throw new TypeError("D20 zero-BYOK canonical bytes exceed the bound");
	const parsed = decodeJson(bytes, "D20 zero-BYOK canonical bytes");
	if (!sameBytes(bytes, new TextEncoder().encode(`${JSON.stringify(parsed)}\n`)))
		throw new TypeError("D20 zero-BYOK bytes are not canonical");
	return bytes;
}
