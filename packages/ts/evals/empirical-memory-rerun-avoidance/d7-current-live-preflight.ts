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
	CURRENT_GRAPH_LIVE_PRICING,
	CURRENT_GRAPH_LIVE_PRICING_SOURCE,
	CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_QUANTIZATION,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
} from "./d7-current-live-coordinates.js";

export const CURRENT_GRAPH_LIVE_PRICING_OBSERVATION_SCHEMA =
	"graphrefly-ts.d7.current-graph-live-pricing-observation.v1" as const;
export const CURRENT_GRAPH_LIVE_ZERO_BYOK_SCHEMA =
	"graphrefly-ts.d7.current-graph-live-zero-byok-observation.v1" as const;
export const CURRENT_GRAPH_LIVE_PRECLAIM_SCHEMA =
	"graphrefly-ts.d7.current-graph-live-preclaim.v1" as const;
export const CURRENT_GRAPH_LIVE_MAX_OFFICIAL_BYTES = 1_048_576 as const;
export const CURRENT_GRAPH_LIVE_MAX_ZERO_BYOK_BYTES = 16_384 as const;
export const CURRENT_GRAPH_LIVE_ZERO_BYOK_MAX_AGE_MS = 3_600_000;

export interface CurrentGraphLiveCredentialV1 {
	readonly bearerToken: string;
	readonly credentialBindingRef: "openrouter.local-eval-2";
	readonly credentialBindingRevision: "2026-08-14.v1";
}

export interface CurrentGraphLivePricingObservationV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_PRICING_OBSERVATION_SCHEMA;
	readonly sourceUrl: typeof CURRENT_GRAPH_LIVE_PRICING_SOURCE;
	readonly routeDigest: string;
	readonly officialResponseDigest: string;
	readonly selectedEndpointDigest: string;
	readonly supportedParametersDigest: string;
	readonly pricingRevision: string;
	readonly inputMicrousdPerMillionTokens: 80_000;
	readonly outputMicrousdPerMillionTokens: 180_000;
	readonly cacheReadMicrousdPerMillionTokens: 16_000;
	readonly observedAtMs: number;
	readonly observationDigest: string;
}

export interface CurrentGraphLiveZeroByokObservationV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_ZERO_BYOK_SCHEMA;
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

export interface CurrentGraphLivePreclaimV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_PRECLAIM_SCHEMA;
	readonly routeDigest: string;
	readonly pricingObservation: CurrentGraphLivePricingObservationV1;
	readonly zeroByokObservation: CurrentGraphLiveZeroByokObservationV1;
	readonly credentialBindingDigest: string;
	readonly preclaimDigest: string;
}

const pricingCapabilities = new WeakSet<object>();
const zeroByokCapabilities = new WeakSet<object>();
const preclaimCapabilities = new WeakSet<object>();

function ownData(value: Record<string, unknown>, key: string, path: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (
		descriptor === undefined ||
		descriptor.get !== undefined ||
		descriptor.set !== undefined ||
		!("value" in descriptor)
	)
		throw new TypeError(`${path}.${key} must be an own data property`);
	return descriptor.value;
}

function boundedString(value: unknown, path: string, maxBytes = 2_048): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value, "utf8") > maxBytes
	)
		throw new TypeError(`${path} is outside the bound`);
	return value;
}

function exactStringSet(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length < 1 || values.length > 128) throw new TypeError(`${path} is outside the bound`);
	const strings = values.map((entry, index) => boundedString(entry, `${path}[${index}]`, 256));
	if (new Set(strings).size !== strings.length) throw new TypeError(`${path} contains duplicates`);
	return Object.freeze([...strings].sort());
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		const length = Number(declared);
		if (
			!Number.isSafeInteger(length) ||
			length < 1 ||
			length > CURRENT_GRAPH_LIVE_MAX_OFFICIAL_BYTES
		)
			throw new TypeError("current live pricing response exceeds its declared bound");
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength < 1 || bytes.byteLength > CURRENT_GRAPH_LIVE_MAX_OFFICIAL_BYTES)
		throw new TypeError("current live pricing response exceeds its byte bound");
	return bytes;
}

function parseOfficialEndpoint(bytes: Uint8Array) {
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("current live pricing response is not bounded UTF-8 JSON", {
			cause: error,
		});
	}
	const root = record(decoded, "current.live.pricing.response");
	const data = record(
		ownData(root, "data", "current.live.pricing.response"),
		"current.live.pricing.data",
	);
	if (ownData(data, "id", "current.live.pricing.data") !== CURRENT_GRAPH_LIVE_REQUEST_MODEL)
		throw new TypeError("current live pricing response model drifted");
	const endpoints = array(
		ownData(data, "endpoints", "current.live.pricing.data"),
		"current.live.pricing.endpoints",
	);
	const matches = endpoints
		.map((entry, index) => record(entry, `current.live.pricing.endpoints[${index}]`))
		.filter(
			(endpoint) =>
				endpoint.provider_name === CURRENT_GRAPH_LIVE_PROVIDER_NAME &&
				endpoint.tag === CURRENT_GRAPH_LIVE_PROVIDER_TAG &&
				endpoint.quantization === CURRENT_GRAPH_LIVE_QUANTIZATION &&
				(endpoint.model === CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL ||
					endpoint.name ===
						`${CURRENT_GRAPH_LIVE_PROVIDER_NAME} | ${CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL}`),
		);
	if (matches.length !== 1) throw new TypeError("current live pricing requires one exact endpoint");
	const endpoint = matches[0]!;
	const supported = exactStringSet(
		ownData(endpoint, "supported_parameters", "current.live.pricing.endpoint"),
		"current.live.pricing.supportedParameters",
	);
	for (const required of ["reasoning", "tool_choice", "tools"])
		if (!supported.includes(required))
			throw new TypeError(`current live endpoint does not support ${required}`);
	const pricing = record(
		ownData(endpoint, "pricing", "current.live.pricing.endpoint"),
		"current.live.pricing.endpoint.pricing",
	);
	for (const [key, expected] of [
		["prompt", CURRENT_GRAPH_LIVE_PRICING.inputUsdPerToken],
		["completion", CURRENT_GRAPH_LIVE_PRICING.outputUsdPerToken],
		["input_cache_read", CURRENT_GRAPH_LIVE_PRICING.cacheReadUsdPerToken],
	] as const)
		if (ownData(pricing, key, "current.live.pricing.endpoint.pricing") !== expected)
			throw new TypeError(`current live official ${key} pricing drifted`);
	return Object.freeze({ endpoint: strictSnapshot(endpoint), supported });
}

export async function readCurrentGraphLiveOfficialPricing(inputValue: {
	readonly fetch: typeof fetch;
	readonly nowMs: () => number;
}): Promise<CurrentGraphLivePricingObservationV1> {
	const input = record(inputValue, "current.live.pricing.input");
	exactKeys(input, ["fetch", "nowMs"], "current.live.pricing.input");
	if (typeof input.fetch !== "function" || typeof input.nowMs !== "function")
		throw new TypeError("current live pricing input is invalid");
	const response = (await Reflect.apply(input.fetch, undefined, [
		CURRENT_GRAPH_LIVE_PRICING_SOURCE,
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
			signal: AbortSignal.timeout(30_000),
		},
	])) as Response;
	if (
		!(response instanceof Response) ||
		response.status !== 200 ||
		response.redirected ||
		response.url !== CURRENT_GRAPH_LIVE_PRICING_SOURCE
	)
		throw new TypeError("current live official pricing read was rejected or redirected");
	const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (contentType !== "application/json")
		throw new TypeError("current live official pricing response is not JSON");
	const bytes = await readBoundedResponse(response);
	const parsed = parseOfficialEndpoint(bytes);
	const observedAtMs = Number(Reflect.apply(input.nowMs, undefined, []));
	if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0)
		throw new TypeError("current live pricing clock is invalid");
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_PRICING_OBSERVATION_SCHEMA,
		sourceUrl: CURRENT_GRAPH_LIVE_PRICING_SOURCE,
		routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
		officialResponseDigest: empiricalSha256(bytes),
		selectedEndpointDigest: empiricalStrictJsonDigest(parsed.endpoint),
		supportedParametersDigest: empiricalStrictJsonDigest(parsed.supported),
		pricingRevision: CURRENT_GRAPH_LIVE_PRICING.revision,
		inputMicrousdPerMillionTokens: 80_000 as const,
		outputMicrousdPerMillionTokens: 180_000 as const,
		cacheReadMicrousdPerMillionTokens: 16_000 as const,
		observedAtMs,
	});
	const observation = Object.freeze({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	}) as CurrentGraphLivePricingObservationV1;
	pricingCapabilities.add(observation);
	return observation;
}

export function admitCurrentGraphLiveZeroByok(inputValue: {
	readonly bytes: Uint8Array;
	readonly credential: CurrentGraphLiveCredentialV1;
	readonly nowMs: number;
}): CurrentGraphLiveZeroByokObservationV1 {
	const input = record(inputValue, "current.live.zeroByok.input");
	exactKeys(input, ["bytes", "credential", "nowMs"], "current.live.zeroByok.input");
	if (!(input.bytes instanceof Uint8Array))
		throw new TypeError("current live zero-BYOK bytes are invalid");
	const bytes = new Uint8Array(input.bytes);
	if (bytes.byteLength < 1 || bytes.byteLength > CURRENT_GRAPH_LIVE_MAX_ZERO_BYOK_BYTES)
		throw new TypeError("current live zero-BYOK bytes exceed their bound");
	const credential = record(input.credential, "current.live.zeroByok.credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"current.live.zeroByok.credential",
	);
	const token = boundedString(
		ownData(credential, "bearerToken", "current.live.zeroByok.credential"),
		"current.live.zeroByok.credential.bearerToken",
		4_096,
	);
	if (
		credential.credentialBindingRef !== "openrouter.local-eval-2" ||
		credential.credentialBindingRevision !== "2026-08-14.v1"
	)
		throw new TypeError("current live credential coordinates drifted");
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new TypeError("current live zero-BYOK artifact is not bounded UTF-8 JSON", {
			cause: error,
		});
	}
	const value = record(decoded, "current.live.zeroByok.artifact");
	exactKeys(
		value,
		[
			"allowedModels",
			"allowedProviders",
			"byokCredentialCount",
			"decisionRef",
			"decisionRevision",
			"keyName",
			"keyVisiblePrefix",
			"keyVisibleSuffix",
			"observedAt",
			"schemaVersion",
			"source",
			"workspaceName",
			"workspaceSlug",
		],
		"current.live.zeroByok.artifact",
	);
	if (
		value.schemaVersion !== CURRENT_GRAPH_LIVE_ZERO_BYOK_SCHEMA ||
		value.decisionRef !== "graphrefly-ts:D7" ||
		value.decisionRevision !== "2026-08-15.v1" ||
		value.workspaceName !== "GraphReFly" ||
		value.workspaceSlug !== "graph-re-fly" ||
		value.keyName !== "Local Eval 2" ||
		value.byokCredentialCount !== 0 ||
		value.source !== "openrouter-browser-settings"
	)
		throw new TypeError("current live zero-BYOK coordinates drifted");
	const prefix = boundedString(
		value.keyVisiblePrefix,
		"current.live.zeroByok.keyVisiblePrefix",
		64,
	);
	const suffix = boundedString(
		value.keyVisibleSuffix,
		"current.live.zeroByok.keyVisibleSuffix",
		64,
	);
	if (
		prefix.length < 4 ||
		suffix.length < 3 ||
		!token.startsWith(prefix) ||
		!token.endsWith(suffix)
	)
		throw new TypeError("current live zero-BYOK observation is not bound to the credential");
	const models = exactStringSet(value.allowedModels, "current.live.zeroByok.allowedModels");
	const providers = exactStringSet(
		value.allowedProviders,
		"current.live.zeroByok.allowedProviders",
	);
	if (
		!models.includes(CURRENT_GRAPH_LIVE_REQUEST_MODEL) ||
		!providers.includes(CURRENT_GRAPH_LIVE_PROVIDER_NAME)
	)
		throw new TypeError("current live zero-BYOK observation does not allow the route");
	const observedAt = boundedString(value.observedAt, "current.live.zeroByok.observedAt", 64);
	const observedAtMs = Date.parse(observedAt);
	const nowMs = Number(input.nowMs);
	if (!Number.isSafeInteger(nowMs) || !Number.isFinite(observedAtMs))
		throw new TypeError("current live zero-BYOK clock is invalid");
	const age = nowMs - observedAtMs;
	if (age < 0 || age > CURRENT_GRAPH_LIVE_ZERO_BYOK_MAX_AGE_MS)
		throw new TypeError("current live zero-BYOK observation is not fresh");
	const credentialBindingDigest = empiricalStrictJsonDigest({
		credentialBindingRef: credential.credentialBindingRef,
		credentialBindingRevision: credential.credentialBindingRevision,
		keyVisiblePrefix: prefix,
		keyVisibleSuffix: suffix,
	});
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_ZERO_BYOK_SCHEMA,
		workspaceName: "GraphReFly" as const,
		workspaceSlug: "graph-re-fly" as const,
		keyName: "Local Eval 2" as const,
		byokCredentialCount: 0 as const,
		allowedModelSetDigest: empiricalStrictJsonDigest(models),
		allowedProviderSetDigest: empiricalStrictJsonDigest(providers),
		observedAt,
		source: "openrouter-browser-settings" as const,
		sourceArtifactDigest: empiricalSha256(bytes),
		credentialBindingDigest,
	});
	const observation = Object.freeze({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	}) as CurrentGraphLiveZeroByokObservationV1;
	zeroByokCapabilities.add(observation);
	return observation;
}

export function composeCurrentGraphLivePreclaim(inputValue: {
	readonly pricingObservation: CurrentGraphLivePricingObservationV1;
	readonly zeroByokObservation: CurrentGraphLiveZeroByokObservationV1;
	readonly credential: CurrentGraphLiveCredentialV1;
}): CurrentGraphLivePreclaimV1 {
	const input = record(inputValue, "current.live.preclaim.input");
	exactKeys(
		input,
		["credential", "pricingObservation", "zeroByokObservation"],
		"current.live.preclaim.input",
	);
	if (
		typeof input.pricingObservation !== "object" ||
		input.pricingObservation === null ||
		!pricingCapabilities.delete(input.pricingObservation) ||
		typeof input.zeroByokObservation !== "object" ||
		input.zeroByokObservation === null ||
		!zeroByokCapabilities.delete(input.zeroByokObservation)
	)
		throw new TypeError("current live preclaim inputs must be fresh same-process capabilities");
	const pricing = input.pricingObservation as CurrentGraphLivePricingObservationV1;
	const zeroByok = input.zeroByokObservation as CurrentGraphLiveZeroByokObservationV1;
	const credential = record(input.credential, "current.live.preclaim.credential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"current.live.preclaim.credential",
	);
	const binding = empiricalStrictJsonDigest({
		credentialBindingRef: credential.credentialBindingRef,
		credentialBindingRevision: credential.credentialBindingRevision,
		keyVisiblePrefix: (credential.bearerToken as string).slice(0, 12),
		keyVisibleSuffix: (credential.bearerToken as string).slice(-3),
	});
	if (binding !== zeroByok.credentialBindingDigest)
		throw new TypeError("current live preclaim credential binding drifted");
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_PRECLAIM_SCHEMA,
		routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
		pricingObservation: pricing,
		zeroByokObservation: zeroByok,
		credentialBindingDigest: binding,
	});
	const preclaim = Object.freeze({
		...material,
		preclaimDigest: empiricalStrictJsonDigest(material),
	}) as CurrentGraphLivePreclaimV1;
	preclaimCapabilities.add(preclaim);
	return preclaim;
}

export function consumeCurrentGraphLivePreclaim(value: unknown): CurrentGraphLivePreclaimV1 {
	if (typeof value !== "object" || value === null || !preclaimCapabilities.delete(value))
		throw new TypeError("current live preclaim must be fresh and single-use");
	const preclaim = value as CurrentGraphLivePreclaimV1;
	digest(preclaim.preclaimDigest, "current.live.preclaim.digest");
	return preclaim;
}

export function currentGraphLiveOfficialPricingRequestIdentity() {
	return Object.freeze({
		url: CURRENT_GRAPH_LIVE_PRICING_SOURCE,
		method: "GET" as const,
		redirect: "error" as const,
		cache: "no-store" as const,
		credentials: "omit" as const,
		referrerPolicy: "no-referrer" as const,
		headers: Object.freeze({
			accept: "application/json",
			"cache-control": "no-cache, no-store, max-age=0",
			pragma: "no-cache",
		}),
	});
}

export function currentGraphLiveZeroByokCanonicalBytes(value: unknown): Uint8Array {
	const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
	if (bytes.byteLength > CURRENT_GRAPH_LIVE_MAX_ZERO_BYOK_BYTES)
		throw new TypeError("current live zero-BYOK canonical bytes exceed the bound");
	const parsed = JSON.parse(new TextDecoder().decode(bytes));
	if (!sameBytes(bytes, new TextEncoder().encode(`${JSON.stringify(parsed)}\n`)))
		throw new TypeError("current live zero-BYOK bytes are not canonical");
	return bytes;
}
