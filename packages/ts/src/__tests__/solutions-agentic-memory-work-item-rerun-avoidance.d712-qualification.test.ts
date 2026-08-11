import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { D703_PRIVATE_PERSISTENCE_ROOT } from "../../evals/empirical-memory-rerun-avoidance/d703-mutation-first-recovery-live.js";
import {
	D712_PRIVATE_GENERATION_REF,
	validateD712QualifiedArtifactBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d712-pricing-qualification.js";
import {
	bindD712FreshPricingObservationToRoute,
	createD712FreshPricingObservation,
	D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	D712_MAX_OFFICIAL_RESPONSE_BYTES,
	validateD712FreshPricingObservation,
} from "../../evals/empirical-memory-rerun-avoidance/d712-pricing-schedule.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";

const encoder = new TextEncoder();
const artifactRoot = join(D703_PRIVATE_PERSISTENCE_ROOT, D712_PRIVATE_GENERATION_REF);
const hasQualification = existsSync(join(artifactRoot, "generation.v1.json"));

function artifacts() {
	return {
		pricingObservationBytes: new Uint8Array(
			readFileSync(join(artifactRoot, "v4-pricing-observation.v1.json")),
		),
		qualificationBytes: new Uint8Array(
			readFileSync(join(artifactRoot, "v4-pricing-qualification.v1.json")),
		),
		generationBytes: new Uint8Array(readFileSync(join(artifactRoot, "generation.v1.json"))),
	};
}

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

function observe(responseBytes = officialResponse()) {
	return createD712FreshPricingObservation({
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		responseBytes,
	});
}

describe("D712 v4 pricing schedule", () => {
	it("binds the current DeepInfra fp4 schedule as the only active schedule", () => {
		const observation = observe();
		expect(validateD712FreshPricingObservation(structuredClone(observation))).toEqual(observation);
		expect(observation).toMatchObject({
			frozenScheduleRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
			inputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
			outputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
			cacheReadMicrousdPerMillionTokens: D712_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
			matchesFrozenSchedule: true,
		});
		const match = bindD712FreshPricingObservationToRoute({
			observation,
			routePricing: {
				sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
				pricingRevision: D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
				currency: "USD",
				inputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
				outputMicrousdPerMillionTokens: D712_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
			},
		});
		expect(match.observationDigest).toBe(observation.observationDigest);
		expect(OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION).toBe(
			D712_DEEPSEEK_V4_FLASH_PRICING_REVISION,
		);
		expect(OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS).toBe(90_000);
		expect(OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS).toBe(180_000);
	});

	it("fails closed on rate, provider, accessor, and byte-bound drift", () => {
		for (const response of [
			officialResponse({
				pricing: {
					prompt: "0.00000008",
					completion: "0.00000018",
					input_cache_read: "0.000000018",
				},
			}),
			officialResponse({
				pricing: {
					prompt: "0.00000009",
					completion: "0.00000018",
					input_cache_read: "0.000000016",
				},
			}),
			officialResponse({ provider_name: "Another Provider" }),
			officialResponse({ tag: "deepinfra/fp8" }),
		]) {
			expect(() => observe(response)).toThrow();
		}
		let getterHits = 0;
		const forged = Object.defineProperty({ responseBytes: officialResponse() }, "sourceUrl", {
			enumerable: true,
			get() {
				getterHits += 1;
				return OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE;
			},
		});
		expect(() => createD712FreshPricingObservation(forged as never)).toThrow(/data property/);
		expect(getterHits).toBe(0);
		expect(() => observe(new Uint8Array(D712_MAX_OFFICIAL_RESPONSE_BYTES + 1))).toThrow(/bound/);
	});
});

describe.skipIf(!hasQualification)("retired D712 no-network artifacts", () => {
	it("keeps retired files private while the current validator rejects their stale route", () => {
		expect(() => validateD712QualifiedArtifactBytes(artifacts())).toThrow();
		expect(statSync(artifactRoot).mode & 0o777).toBe(0o700);
		for (const file of [
			"v4-pricing-observation.v1.json",
			"v4-pricing-qualification.v1.json",
			"generation.v1.json",
		]) {
			expect(statSync(join(artifactRoot, file)).mode & 0o777).toBe(0o600);
			expect(readFileSync(join(artifactRoot, file), "utf8")).not.toMatch(
				/bearer|credential|raw body|raw header|private path/i,
			);
		}
	});

	it("rejects byte tamper and outer accessors before evidence decoding", () => {
		const tampered = artifacts();
		tampered.qualificationBytes = tampered.qualificationBytes.slice();
		tampered.qualificationBytes[0] ^= 1;
		expect(() => validateD712QualifiedArtifactBytes(tampered)).toThrow();
		let getterHits = 0;
		const accessor = Object.defineProperty({}, "pricingObservationBytes", {
			enumerable: true,
			get() {
				getterHits += 1;
				return artifacts().pricingObservationBytes;
			},
		});
		expect(() => validateD712QualifiedArtifactBytes(accessor)).toThrow();
		expect(getterHits).toBe(0);
	});
});
