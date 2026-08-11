import { describe, expect, it } from "vitest";
import { D705_PRICING_REVISION } from "../../evals/empirical-memory-rerun-avoidance/d705-mutation-first-live.js";
import {
	bindD706FreshPricingObservationToRoute,
	createD706FreshPricingObservation,
	createD706FreshPricingOfflineQualification,
	D706_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
	D706_MAX_OFFICIAL_RESPONSE_BYTES,
	D706_PRICING_OBSERVATION_REVISION,
	isConstructedD706FreshPricingQualification,
	isConstructedD706FreshPricingScheduleMatch,
	validateD706FreshPricingObservation,
	validateD706FreshPricingQualification,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-fresh-pricing-observation.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";

const encoder = new TextEncoder();

function officialResponse(overrides: Record<string, unknown> = {}): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			data: {
				id: "deepseek/deepseek-v4-flash",
				name: "DeepSeek: V4 Flash",
				endpoints: [
					{
						provider_name: "DeepInfra",
						tag: "deepinfra/fp4",
						quantization: "fp4",
						pricing: {
							prompt: "0.00000009",
							completion: "0.00000018",
							input_cache_read: "0.000000018",
						},
						...overrides,
					},
				],
			},
		}),
	);
}

function frozenRoutePricing() {
	return {
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		pricingRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		currency: "USD" as const,
		inputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		outputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	};
}

function observe(responseBytes = officialResponse()) {
	return createD706FreshPricingObservation({
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		responseBytes,
	});
}

describe("D706 fresh-pricing observation separation", () => {
	it("binds fresh exact-response evidence without replacing the frozen route schedule", () => {
		const observation = observe();
		expect(observation).toMatchObject({
			observationRevision: D706_PRICING_OBSERVATION_REVISION,
			frozenScheduleRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
			inputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
			outputMicrousdPerMillionTokens:
				OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
			cacheReadMicrousdPerMillionTokens: D706_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
			matchesFrozenSchedule: true,
		});
		const match = bindD706FreshPricingObservationToRoute({
			observation,
			routePricing: frozenRoutePricing(),
		});
		expect(isConstructedD706FreshPricingScheduleMatch(match)).toBe(true);
		expect(match.observationDigest).toBe(observation.observationDigest);
		const qualification = createD706FreshPricingOfflineQualification(match);
		expect(isConstructedD706FreshPricingQualification(qualification)).toBe(true);
		expect(validateD706FreshPricingQualification(structuredClone(qualification))).toMatchObject({
			executionClass: "simulated-contract",
			providerCalls: 0,
			networkCalls: 0,
			routeSchemaChanged: false,
			historicalEvidenceReinterpreted: false,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
			qualified: true,
		});
		expect(D705_PRICING_REVISION).not.toBe(OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION);
	});

	it("rejects provider, tag, quantization, price, duplicate, and decimal substitutions", () => {
		for (const overrides of [
			{ provider_name: "DeepSeek" },
			{ tag: "deepinfra/fp8" },
			{ quantization: "fp8" },
			{
				pricing: {
					prompt: "0.00000010",
					completion: "0.00000018",
					input_cache_read: "0.000000018",
				},
			},
			{
				pricing: {
					prompt: "9e-8",
					completion: "0.00000018",
					input_cache_read: "0.000000018",
				},
			},
		]) {
			expect(() => observe(officialResponse(overrides))).toThrow();
		}
		const endpoint = JSON.parse(new TextDecoder().decode(officialResponse())).data.endpoints[0];
		const duplicate = encoder.encode(
			JSON.stringify({
				data: {
					id: "deepseek/deepseek-v4-flash",
					endpoints: [endpoint, endpoint],
				},
			}),
		);
		expect(() => observe(duplicate)).toThrow(/exactly one/);
		expect(() =>
			observe(
				officialResponse({
					pricing: {
						prompt: "0.000000090",
						completion: "0.00000018",
						input_cache_read: "0.000000018",
					},
				}),
			),
		).toThrow(/promptAtomic/);
	});

	it("rejects accessor input before reading it and enforces exact response bounds", () => {
		let getterHits = 0;
		const forged = Object.defineProperty(
			{ sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE },
			"responseBytes",
			{
				enumerable: true,
				get() {
					getterHits += 1;
					return officialResponse();
				},
			},
		);
		expect(() => createD706FreshPricingObservation(forged as never)).toThrow(/data property/);
		expect(getterHits).toBe(0);
		expect(() =>
			createD706FreshPricingObservation({
				sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
				responseBytes: new Uint8Array(D706_MAX_OFFICIAL_RESPONSE_BYTES + 1),
			}),
		).toThrow(/byte bound/);
		expect(() =>
			createD706FreshPricingObservation({
				sourceUrl: "https://example.com/endpoints" as never,
				responseBytes: officialResponse(),
			}),
		).toThrow(/sourceUrl/);
		const proxiedBytes = new Proxy(officialResponse(), {});
		expect(() =>
			createD706FreshPricingObservation({
				sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
				responseBytes: proxiedBytes,
			}),
		).toThrow();
	});

	it("validates canonical persisted evidence but requires same-process provenance for route use", () => {
		const observation = observe();
		const clone = structuredClone(observation);
		expect(validateD706FreshPricingObservation(clone)).toEqual(observation);
		expect(() =>
			bindD706FreshPricingObservationToRoute({
				observation: clone,
				routePricing: frozenRoutePricing(),
			}),
		).toThrow(/same-process/);
		const tampered = { ...clone, inputMicrousdPerMillionTokens: 90_001 };
		expect(() => validateD706FreshPricingObservation(tampered)).toThrow();
	});

	it("fails closed when a fresh observation is paired with a non-frozen route revision", () => {
		const observation = observe();
		expect(() =>
			bindD706FreshPricingObservationToRoute({
				observation,
				routePricing: {
					...frozenRoutePricing(),
					pricingRevision: D706_PRICING_OBSERVATION_REVISION,
				},
			}),
		).toThrow(/routePricing.revision/);
	});
});
