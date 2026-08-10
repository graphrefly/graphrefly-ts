import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	bindD706FreshPricingObservationToRoute,
	createD706FreshPricingObservation,
	D706_MAX_OFFICIAL_RESPONSE_BYTES,
	type OpenRouterFreshPricingObservationV1,
	type OpenRouterFreshPricingScheduleMatchV1,
} from "./openrouter-fresh-pricing-observation.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";

export const D711_OFFICIAL_PRICING_READ_SCHEMA =
	"graphrefly.private-solution-eval.d711-official-pricing-read.v1" as const;
export const D711_OFFICIAL_PRICING_GET_REF = "d711-openrouter-official-pricing-get" as const;
export const D711_OFFICIAL_PRICING_GET_REVISION = "decision.D711.2026-08-10.v1" as const;
export const D711_OFFICIAL_PRICING_MAX_PRECLAIM_AGE_MS = 120_000 as const;

export interface D711OfficialPricingReadV1 {
	readonly schemaVersion: typeof D711_OFFICIAL_PRICING_READ_SCHEMA;
	readonly decisionRef: "decision.D711";
	readonly decisionRevision: typeof D711_OFFICIAL_PRICING_GET_REVISION;
	readonly executionClass: "live-control-plane";
	readonly method: "GET";
	readonly sourceUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly redirect: "error";
	readonly status: 200;
	readonly finalUrl: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
	readonly redirected: false;
	readonly contentType: "application/json" | "application/json; charset=utf-8";
	readonly bodyByteLength: number;
	readonly responseDigest: string;
	readonly pricingObservationDigest: string;
	readonly frozenScheduleRevision: typeof OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION;
	readonly networkCalls: 1;
	readonly providerCalls: 0;
	readonly readDigest: string;
}

interface ConstructedReadState {
	readonly observation: OpenRouterFreshPricingObservationV1;
	readonly match: OpenRouterFreshPricingScheduleMatchV1;
	readonly completedMonotonicMs: number;
}

const constructedReads = new WeakMap<object, ConstructedReadState>();

function exactContentType(value: string | null): D711OfficialPricingReadV1["contentType"] {
	if (value === "application/json" || value === "application/json; charset=utf-8") return value;
	throw new TypeError("D711 official pricing response content type is not exact JSON");
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
	const declared = response.headers.get("content-length");
	if (declared !== null) {
		const length = Number(declared);
		if (!Number.isSafeInteger(length) || length < 1 || length > D706_MAX_OFFICIAL_RESPONSE_BYTES) {
			throw new TypeError("D711 official pricing content length is outside the bound");
		}
	}
	if (response.body === null) throw new TypeError("D711 official pricing response body is absent");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const result = await reader.read();
			if (result.done) break;
			const chunk = new Uint8Array(result.value);
			total += chunk.byteLength;
			if (total > D706_MAX_OFFICIAL_RESPONSE_BYTES) {
				await reader.cancel("D711 official pricing response byte bound exceeded");
				throw new TypeError("D711 official pricing response byte bound exceeded");
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}
	if (total === 0) throw new TypeError("D711 official pricing response is empty");
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function readD711OfficialPricing(input: {
	readonly fetch: typeof globalThis.fetch;
	readonly monotonicNowMs: () => number;
	readonly routePricing: OpenRouterRouteQualificationV1["pricing"];
	readonly signal: AbortSignal;
}): Promise<D711OfficialPricingReadV1> {
	const candidate = record(input, "d711.officialPricingInput");
	exactKeys(
		candidate,
		["fetch", "monotonicNowMs", "routePricing", "signal"],
		"d711.officialPricingInput",
	);
	const fetchCapability = candidate.fetch;
	if (typeof fetchCapability !== "function") {
		throw new TypeError("D711 official pricing requires a fetch function");
	}
	const monotonicNowMs = candidate.monotonicNowMs;
	if (typeof monotonicNowMs !== "function") {
		throw new TypeError("D711 official pricing requires a monotonic clock");
	}
	if (!(candidate.signal instanceof AbortSignal)) {
		throw new TypeError("D711 official pricing requires AbortSignal");
	}
	const signal = candidate.signal;
	signal.throwIfAborted();
	const routePricing = strictSnapshot(
		record(candidate.routePricing, "d711.officialPricing.routePricing"),
	) as unknown as OpenRouterRouteQualificationV1["pricing"];
	const response = await (fetchCapability as typeof globalThis.fetch)(
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
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
			signal,
		},
	);
	signal.throwIfAborted();
	literal(response.status, 200, "d711.officialPricing.status");
	literal(response.url, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d711.officialPricing.url");
	literal(response.redirected, false, "d711.officialPricing.redirected");
	const contentType = exactContentType(response.headers.get("content-type"));
	const bodyBytes = await boundedResponseBytes(response);
	const observation = createD706FreshPricingObservation({
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		responseBytes: bodyBytes,
	});
	const match = bindD706FreshPricingObservationToRoute({ observation, routePricing });
	const material = strictSnapshot({
		schemaVersion: D711_OFFICIAL_PRICING_READ_SCHEMA,
		decisionRef: "decision.D711" as const,
		decisionRevision: D711_OFFICIAL_PRICING_GET_REVISION,
		executionClass: "live-control-plane" as const,
		method: "GET" as const,
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		redirect: "error" as const,
		status: 200 as const,
		finalUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		redirected: false as const,
		contentType,
		bodyByteLength: bodyBytes.byteLength,
		responseDigest: observation.responseDigest,
		pricingObservationDigest: observation.observationDigest,
		frozenScheduleRevision: match.frozenScheduleRevision,
		networkCalls: 1 as const,
		providerCalls: 0 as const,
	});
	const read = strictSnapshot({
		...material,
		readDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D711OfficialPricingReadV1;
	const completedMonotonicMs = Number((monotonicNowMs as () => number)());
	if (!Number.isFinite(completedMonotonicMs) || completedMonotonicMs < 0) {
		throw new TypeError("D711 official pricing monotonic completion time is invalid");
	}
	constructedReads.set(read, { observation, match, completedMonotonicMs });
	return read;
}

export function validateD711OfficialPricingRead(value: unknown): D711OfficialPricingReadV1 {
	const candidate = record(value, "d711.officialPricingRead");
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
			"method",
			"networkCalls",
			"pricingObservationDigest",
			"providerCalls",
			"readDigest",
			"redirect",
			"redirected",
			"responseDigest",
			"schemaVersion",
			"sourceUrl",
			"status",
		],
		"d711.officialPricingRead",
	);
	literal(candidate.schemaVersion, D711_OFFICIAL_PRICING_READ_SCHEMA, "d711.pricing.schema");
	literal(candidate.decisionRef, "decision.D711", "d711.pricing.decisionRef");
	literal(candidate.decisionRevision, D711_OFFICIAL_PRICING_GET_REVISION, "d711.pricing.revision");
	literal(candidate.executionClass, "live-control-plane", "d711.pricing.executionClass");
	literal(candidate.method, "GET", "d711.pricing.method");
	literal(candidate.sourceUrl, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d711.pricing.source");
	literal(candidate.redirect, "error", "d711.pricing.redirect");
	literal(candidate.status, 200, "d711.pricing.status");
	literal(candidate.finalUrl, OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE, "d711.pricing.finalUrl");
	literal(candidate.redirected, false, "d711.pricing.redirected");
	exactContentType(candidate.contentType as string);
	safeInteger(candidate.bodyByteLength, "d711.pricing.bodyByteLength", {
		min: 1,
		max: D706_MAX_OFFICIAL_RESPONSE_BYTES,
	});
	digest(candidate.responseDigest, "d711.pricing.responseDigest");
	digest(candidate.pricingObservationDigest, "d711.pricing.observationDigest");
	literal(
		candidate.frozenScheduleRevision,
		OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		"d711.pricing.schedule",
	);
	literal(candidate.networkCalls, 1, "d711.pricing.networkCalls");
	literal(candidate.providerCalls, 0, "d711.pricing.providerCalls");
	const readDigest = digest(candidate.readDigest, "d711.pricing.readDigest");
	const { readDigest: _ignored, ...material } = candidate;
	literal(readDigest, empiricalStrictJsonDigest(material), "d711.pricing.readDigest");
	return strictSnapshot(candidate) as unknown as D711OfficialPricingReadV1;
}

export function consumeD711OfficialPricingRead(value: unknown): {
	readonly read: D711OfficialPricingReadV1;
	readonly observation: OpenRouterFreshPricingObservationV1;
	readonly match: OpenRouterFreshPricingScheduleMatchV1;
	readonly completedMonotonicMs: number;
} {
	if (value === null || typeof value !== "object") {
		throw new TypeError("D711 preflight requires a same-process pricing read");
	}
	const state = constructedReads.get(value);
	if (state === undefined)
		throw new TypeError("D711 pricing read was not constructed or was reused");
	constructedReads.delete(value);
	return Object.freeze({ read: validateD711OfficialPricingRead(value), ...state });
}
