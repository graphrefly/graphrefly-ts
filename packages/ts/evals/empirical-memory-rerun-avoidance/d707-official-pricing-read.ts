import {
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
	type D703_DRY_RUN_GENERATION_DIGEST,
	type D703_DRY_RUN_OBSERVATION_DIGEST,
	type D703_DRY_RUN_SCORECARD_DIGEST,
	validateD703DryRunArtifactBytes,
} from "./d703-mutation-first-recovery-live.js";
import {
	bindD706FreshPricingObservationToRoute,
	createD706FreshPricingObservation,
	D706_MAX_OFFICIAL_RESPONSE_BYTES,
	D706_PRICING_OBSERVATION_REF,
	D706_PRICING_OBSERVATION_REVISION,
	type OpenRouterFreshPricingObservationV1,
	type OpenRouterFreshPricingScheduleMatchV1,
} from "./openrouter-fresh-pricing-observation.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";

export const D707_OFFICIAL_PRICING_GET_REQUEST_SCHEMA =
	"graphrefly.private-solution-eval.d707-official-pricing-get-request.v1" as const;
export const D707_OFFICIAL_PRICING_READ_SCHEMA =
	"graphrefly.private-solution-eval.d707-official-pricing-read.v1" as const;
export const D707_OFFICIAL_PRICING_GET_REF = "d707-openrouter-official-pricing-get" as const;
export const D707_OFFICIAL_PRICING_GET_REVISION = "decision.D707.2026-08-09.v1" as const;
export const D707_D705_MODULE_SOURCE_DIGEST =
	"sha256:a87e58f90e7d137481d47e538c117ecba2f09331c3e144fc58398da642ce780f" as const;
export const D707_MAX_SOURCE_BYTES = 1_048_576 as const;

export interface D707HistoricalPreflightV1 {
	readonly capabilityRef: "d707-exact-historical-preflight";
	readonly capabilityRevision: typeof D707_OFFICIAL_PRICING_GET_REVISION;
	readonly executionClass: "simulated-contract";
	readonly d703ObservationDigest: typeof D703_DRY_RUN_OBSERVATION_DIGEST;
	readonly d703ScorecardDigest: typeof D703_DRY_RUN_SCORECARD_DIGEST;
	readonly d703GenerationDigest: typeof D703_DRY_RUN_GENERATION_DIGEST;
	readonly d705ModuleSourceDigest: typeof D707_D705_MODULE_SOURCE_DIGEST;
	readonly historicalPreflightDigest: string | null;
}

export interface D707OfficialPricingGetRequestV1 {
	readonly schemaVersion: typeof D707_OFFICIAL_PRICING_GET_REQUEST_SCHEMA;
	readonly requestRef: typeof D707_OFFICIAL_PRICING_GET_REF;
	readonly method: "GET";
	readonly url: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly redirect: "error";
	readonly accept: "application/json";
}

export interface D707InjectedOfficialPricingResponseV1 {
	readonly status: number;
	readonly finalUrl: string;
	readonly redirectCount: number;
	readonly contentType: string;
	readonly bodyBytes: Uint8Array;
}

export interface D707InjectedOfficialPricingTransportV1 {
	readonly capabilityRef: "d707-injected-official-pricing-transport";
	readonly capabilityRevision: typeof D707_OFFICIAL_PRICING_GET_REVISION;
	request(input: {
		readonly request: D707OfficialPricingGetRequestV1;
		readonly signal: AbortSignal;
	}): Promise<D707InjectedOfficialPricingResponseV1>;
}

export interface D707FreshPricingReadV1 {
	readonly schemaVersion: typeof D707_OFFICIAL_PRICING_READ_SCHEMA;
	readonly decisionRef: "decision.D707";
	readonly decisionRevision: typeof D707_OFFICIAL_PRICING_GET_REVISION;
	readonly executionClass: "simulated-contract";
	readonly requestDigest: string;
	readonly historicalPreflightDigest: string;
	readonly status: 200;
	readonly finalUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly redirectCount: 0;
	readonly contentType: "application/json" | "application/json; charset=utf-8";
	readonly bodyByteLength: number;
	readonly responseDigest: string;
	readonly observationRef: typeof D706_PRICING_OBSERVATION_REF;
	readonly observationRevision: typeof D706_PRICING_OBSERVATION_REVISION;
	readonly observationDigest: string;
	readonly frozenScheduleRevision: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly routeSchemaChanged: false;
	readonly networkCalls: 0;
	readonly providerCalls: 0;
	readonly readDigest: string;
}

interface InjectedTransportState {
	readonly response: D707InjectedOfficialPricingResponseV1;
	used: boolean;
}

interface ConstructedReadState {
	readonly observation: OpenRouterFreshPricingObservationV1;
	readonly match: OpenRouterFreshPricingScheduleMatchV1;
	readonly historicalPreflight: D707HistoricalPreflightV1;
}

const injectedTransports = new WeakMap<object, InjectedTransportState>();
const constructedHistoricalPreflights = new WeakSet<object>();
const constructedReads = new WeakMap<object, ConstructedReadState>();

function copiedBytes(value: unknown, path: string): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new TypeError(`${path}: expected Uint8Array`);
	if (value.byteLength === 0 || value.byteLength > D706_MAX_OFFICIAL_RESPONSE_BYTES) {
		throw new TypeError(`${path}: official pricing response byte bound exceeded`);
	}
	return new Uint8Array(value);
}

function copiedSource(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array))
		throw new TypeError("D707 requires Uint8Array D705 source bytes");
	if (value.byteLength === 0 || value.byteLength > D707_MAX_SOURCE_BYTES) {
		throw new TypeError("D707 D705 source byte bound exceeded");
	}
	return new Uint8Array(value);
}

export function createD707HistoricalPreflight(input: {
	readonly d703DryRunArtifacts: {
		readonly observationBytes: Uint8Array;
		readonly scorecardBytes: Uint8Array;
		readonly generationBytes: Uint8Array;
	};
	readonly d705ModuleSourceBytes: Uint8Array;
}): D707HistoricalPreflightV1 {
	const candidate = record(input, "d707.historicalPreflightInput");
	exactKeys(
		candidate,
		["d703DryRunArtifacts", "d705ModuleSourceBytes"],
		"d707.historicalPreflightInput",
	);
	const d703 = validateD703DryRunArtifactBytes(candidate.d703DryRunArtifacts);
	literal(
		empiricalSha256(copiedSource(candidate.d705ModuleSourceBytes)),
		D707_D705_MODULE_SOURCE_DIGEST,
		"d707.historicalPreflight.d705Source",
	);
	const material = strictSnapshot({
		capabilityRef: "d707-exact-historical-preflight" as const,
		capabilityRevision: D707_OFFICIAL_PRICING_GET_REVISION,
		executionClass: "simulated-contract" as const,
		d703ObservationDigest: d703.observationDigest,
		d703ScorecardDigest: d703.scorecardDigest,
		d703GenerationDigest: d703.generationDigest,
		d705ModuleSourceDigest: D707_D705_MODULE_SOURCE_DIGEST,
	});
	const capability = strictSnapshot({
		...material,
		historicalPreflightDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D707HistoricalPreflightV1;
	constructedHistoricalPreflights.add(capability);
	return capability;
}

export function createD707InjectedOfficialPricingTransport(input: {
	readonly status: number;
	readonly finalUrl: string;
	readonly redirectCount: number;
	readonly contentType: string;
	readonly bodyBytes: Uint8Array;
}): D707InjectedOfficialPricingTransportV1 {
	const candidate = record(input, "d707.injectedPricingTransport");
	exactKeys(
		candidate,
		["bodyBytes", "contentType", "finalUrl", "redirectCount", "status"],
		"d707.injectedPricingTransport",
	);
	const response = Object.freeze({
		status: safeInteger(candidate.status, "d707.injectedPricingTransport.status", {
			max: 599,
		}),
		finalUrl: string(candidate.finalUrl, "d707.injectedPricingTransport.finalUrl", 512),
		redirectCount: safeInteger(
			candidate.redirectCount,
			"d707.injectedPricingTransport.redirectCount",
			{ max: 16 },
		),
		contentType: string(candidate.contentType, "d707.injectedPricingTransport.contentType", 128),
		bodyBytes: copiedBytes(candidate.bodyBytes, "d707.injectedPricingTransport.bodyBytes"),
	});
	let capability: D707InjectedOfficialPricingTransportV1;
	capability = Object.freeze({
		capabilityRef: "d707-injected-official-pricing-transport" as const,
		capabilityRevision: D707_OFFICIAL_PRICING_GET_REVISION,
		async request(inputValue: {
			readonly request: D707OfficialPricingGetRequestV1;
			readonly signal: AbortSignal;
		}) {
			const state = injectedTransports.get(capability);
			if (state === undefined || state.used) {
				throw new TypeError("D707 injected pricing transport is single-use");
			}
			const requestInput = record(inputValue, "d707.injectedPricingTransport.requestInput");
			exactKeys(requestInput, ["request", "signal"], "d707.injectedPricingTransport.requestInput");
			if (!(requestInput.signal instanceof AbortSignal)) {
				throw new TypeError("D707 injected pricing transport requires AbortSignal");
			}
			requestInput.signal.throwIfAborted();
			const request = record(requestInput.request, "d707.injectedPricingTransport.request");
			exactKeys(
				request,
				["accept", "method", "redirect", "requestRef", "schemaVersion", "url"],
				"d707.injectedPricingTransport.request",
			);
			literal(
				request.schemaVersion,
				D707_OFFICIAL_PRICING_GET_REQUEST_SCHEMA,
				"d707.injectedPricingTransport.request.schema",
			);
			literal(request.requestRef, D707_OFFICIAL_PRICING_GET_REF, "d707.requestRef");
			literal(request.method, "GET", "d707.method");
			literal(request.url, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d707.url");
			literal(request.redirect, "error", "d707.redirect");
			literal(request.accept, "application/json", "d707.accept");
			state.used = true;
			return Object.freeze({
				...state.response,
				bodyBytes: new Uint8Array(state.response.bodyBytes),
			});
		},
	});
	injectedTransports.set(capability, { response, used: false });
	return capability;
}

function contentType(value: unknown): D707FreshPricingReadV1["contentType"] {
	if (value === "application/json" || value === "application/json; charset=utf-8") return value;
	throw new TypeError("D707 official pricing response content type is not exact JSON");
}

function officialPricingGetRequest(): D707OfficialPricingGetRequestV1 {
	return Object.freeze({
		schemaVersion: D707_OFFICIAL_PRICING_GET_REQUEST_SCHEMA,
		requestRef: D707_OFFICIAL_PRICING_GET_REF,
		method: "GET" as const,
		url: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		redirect: "error" as const,
		accept: "application/json" as const,
	});
}

async function executeD707FreshPricingRead(input: {
	readonly transport: D707InjectedOfficialPricingTransportV1;
	readonly routePricing: OpenRouterRouteQualificationV1["pricing"];
	readonly signal: AbortSignal;
	readonly historicalPreflight: D707HistoricalPreflightV1 | null;
}): Promise<D707FreshPricingReadV1> {
	const signal = input.signal;
	const transport = input.transport;
	if (!(signal instanceof AbortSignal)) {
		throw new TypeError("D707 pricing read requires AbortSignal");
	}
	if (transport === null || typeof transport !== "object" || !injectedTransports.has(transport)) {
		throw new TypeError("D707 pre-live pricing read requires its constructed injected transport");
	}
	const routePricing = strictSnapshot(
		record(input.routePricing, "d707.routePricing"),
	) as unknown as OpenRouterRouteQualificationV1["pricing"];
	const request = officialPricingGetRequest();
	const responseValue = await (transport as D707InjectedOfficialPricingTransportV1).request({
		request,
		signal,
	});
	signal.throwIfAborted();
	const response = record(responseValue, "d707.officialPricingResponse");
	exactKeys(
		response,
		["bodyBytes", "contentType", "finalUrl", "redirectCount", "status"],
		"d707.officialPricingResponse",
	);
	literal(safeInteger(response.status, "d707.response.status", { max: 599 }), 200, "d707.status");
	literal(response.finalUrl, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d707.finalUrl");
	literal(
		safeInteger(response.redirectCount, "d707.response.redirectCount", { max: 16 }),
		0,
		"d707.redirectCount",
	);
	const exactContentType = contentType(response.contentType);
	const bodyBytes = copiedBytes(response.bodyBytes, "d707.officialPricingResponse.bodyBytes");
	const observation = createD706FreshPricingObservation({
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		responseBytes: bodyBytes,
	});
	const match = bindD706FreshPricingObservationToRoute({ observation, routePricing });
	const material = strictSnapshot({
		schemaVersion: D707_OFFICIAL_PRICING_READ_SCHEMA,
		decisionRef: "decision.D707" as const,
		decisionRevision: D707_OFFICIAL_PRICING_GET_REVISION,
		executionClass: "simulated-contract" as const,
		requestDigest: empiricalStrictJsonDigest(request),
		historicalPreflightDigest: input.historicalPreflight?.historicalPreflightDigest ?? null,
		status: 200 as const,
		finalUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		redirectCount: 0 as const,
		contentType: exactContentType,
		bodyByteLength: bodyBytes.byteLength,
		responseDigest: observation.responseDigest,
		observationRef: observation.observationRef,
		observationRevision: observation.observationRevision,
		observationDigest: observation.observationDigest,
		frozenScheduleRevision: match.frozenScheduleRevision,
		routeSchemaChanged: false as const,
		networkCalls: 0 as const,
		providerCalls: 0 as const,
	});
	const read = strictSnapshot({
		...material,
		readDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D707FreshPricingReadV1;
	if (input.historicalPreflight !== null) {
		constructedReads.set(read, {
			observation,
			match,
			historicalPreflight: input.historicalPreflight,
		});
	}
	return read;
}

export async function readD707FreshPricingWithInjectedTransport(input: {
	readonly transport: D707InjectedOfficialPricingTransportV1;
	readonly routePricing: OpenRouterRouteQualificationV1["pricing"];
	readonly signal: AbortSignal;
}): Promise<D707FreshPricingReadV1> {
	const candidate = record(input, "d707.pricingReadInput");
	exactKeys(candidate, ["routePricing", "signal", "transport"], "d707.pricingReadInput");
	return executeD707FreshPricingRead({
		transport: candidate.transport as D707InjectedOfficialPricingTransportV1,
		routePricing: candidate.routePricing as OpenRouterRouteQualificationV1["pricing"],
		signal: candidate.signal as AbortSignal,
		historicalPreflight: null,
	});
}

export async function readD707HistoricallyQualifiedFreshPricingWithInjectedTransport(input: {
	readonly historicalPreflight: D707HistoricalPreflightV1;
	readonly transport: D707InjectedOfficialPricingTransportV1;
	readonly routePricing: OpenRouterRouteQualificationV1["pricing"];
	readonly signal: AbortSignal;
}): Promise<D707FreshPricingReadV1> {
	const candidate = record(input, "d707.qualifiedPricingReadInput");
	exactKeys(
		candidate,
		["historicalPreflight", "routePricing", "signal", "transport"],
		"d707.qualifiedPricingReadInput",
	);
	const historicalPreflight = candidate.historicalPreflight;
	if (
		historicalPreflight === null ||
		typeof historicalPreflight !== "object" ||
		!constructedHistoricalPreflights.delete(historicalPreflight)
	) {
		throw new TypeError("D707 pricing read requires its fresh historical preflight");
	}
	return executeD707FreshPricingRead({
		transport: candidate.transport as D707InjectedOfficialPricingTransportV1,
		routePricing: candidate.routePricing as OpenRouterRouteQualificationV1["pricing"],
		signal: candidate.signal as AbortSignal,
		historicalPreflight: historicalPreflight as D707HistoricalPreflightV1,
	});
}

export function validateD707FreshPricingRead(value: unknown): D707FreshPricingReadV1 {
	const candidate = record(value, "d707.pricingRead");
	exactKeys(
		candidate,
		[
			"bodyByteLength",
			"contentType",
			"decisionRef",
			"decisionRevision",
			"executionClass",
			"finalUrl",
			"frozenScheduleRevision",
			"historicalPreflightDigest",
			"networkCalls",
			"observationDigest",
			"observationRef",
			"observationRevision",
			"providerCalls",
			"readDigest",
			"redirectCount",
			"requestDigest",
			"responseDigest",
			"routeSchemaChanged",
			"schemaVersion",
			"status",
		],
		"d707.pricingRead",
	);
	literal(candidate.schemaVersion, D707_OFFICIAL_PRICING_READ_SCHEMA, "d707.pricingRead.schema");
	literal(candidate.decisionRef, "decision.D707", "d707.pricingRead.decisionRef");
	literal(
		candidate.decisionRevision,
		D707_OFFICIAL_PRICING_GET_REVISION,
		"d707.pricingRead.decisionRevision",
	);
	literal(candidate.executionClass, "simulated-contract", "d707.pricingRead.executionClass");
	literal(
		digest(candidate.requestDigest, "d707.pricingRead.requestDigest"),
		empiricalStrictJsonDigest(officialPricingGetRequest()),
		"d707.pricingRead.requestDigest",
	);
	if (candidate.historicalPreflightDigest !== null) {
		digest(candidate.historicalPreflightDigest, "d707.pricingRead.historicalPreflightDigest");
	}
	literal(candidate.status, 200, "d707.pricingRead.status");
	literal(
		candidate.finalUrl,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		"d707.pricingRead.finalUrl",
	);
	literal(candidate.redirectCount, 0, "d707.pricingRead.redirectCount");
	contentType(candidate.contentType);
	safeInteger(candidate.bodyByteLength, "d707.pricingRead.bodyByteLength", {
		min: 1,
		max: 1_048_576,
	});
	digest(candidate.responseDigest, "d707.pricingRead.responseDigest");
	literal(
		candidate.observationRef,
		D706_PRICING_OBSERVATION_REF,
		"d707.pricingRead.observationRef",
	);
	literal(
		candidate.observationRevision,
		D706_PRICING_OBSERVATION_REVISION,
		"d707.pricingRead.observationRevision",
	);
	digest(candidate.observationDigest, "d707.pricingRead.observationDigest");
	literal(
		candidate.frozenScheduleRevision,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d707.pricingRead.frozenScheduleRevision",
	);
	literal(candidate.routeSchemaChanged, false, "d707.pricingRead.routeSchemaChanged");
	literal(candidate.networkCalls, 0, "d707.pricingRead.networkCalls");
	literal(candidate.providerCalls, 0, "d707.pricingRead.providerCalls");
	const readDigest = digest(candidate.readDigest, "d707.pricingRead.readDigest");
	const { readDigest: _ignored, ...material } = candidate;
	literal(readDigest, empiricalStrictJsonDigest(material), "d707.pricingRead.readDigest");
	return strictSnapshot(candidate) as unknown as D707FreshPricingReadV1;
}

export function consumeD707FreshPricingReadForPreflight(value: unknown): {
	readonly read: D707FreshPricingReadV1;
	readonly observation: OpenRouterFreshPricingObservationV1;
	readonly match: OpenRouterFreshPricingScheduleMatchV1;
	readonly historicalPreflight: D707HistoricalPreflightV1;
} {
	if (value === null || typeof value !== "object") {
		throw new TypeError("D707 preflight requires its same-process pricing read");
	}
	const state = constructedReads.get(value);
	if (state === undefined) throw new TypeError("D707 preflight requires a fresh pricing read");
	constructedReads.delete(value);
	return Object.freeze({
		read: validateD707FreshPricingRead(value),
		observation: state.observation,
		match: state.match,
		historicalPreflight: state.historicalPreflight,
	});
}
