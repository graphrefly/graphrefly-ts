import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalSha256 } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { validateD707PreLiveArtifactBytes } from "../../evals/empirical-memory-rerun-avoidance/d707-fresh-pricing-preflight.js";
import {
	consumeD707FreshPricingReadForPreflight,
	createD707InjectedOfficialPricingTransport,
	D707_D705_MODULE_SOURCE_DIGEST,
	readD707FreshPricingWithInjectedTransport,
	readD707HistoricallyQualifiedFreshPricingWithInjectedTransport,
	validateD707FreshPricingRead,
} from "../../evals/empirical-memory-rerun-avoidance/d707-official-pricing-read.js";
import {
	D706_MAX_OFFICIAL_RESPONSE_BYTES,
	D706_PRICING_OBSERVATION_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-fresh-pricing-observation.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-route-qualification.js";

const encoder = new TextEncoder();

function responseBytes(overrides: Record<string, unknown> = {}): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			data: {
				id: "deepseek/deepseek-v4-flash-0731",
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

function routePricing(pricingRevision = OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION) {
	return {
		sourceUrl: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		pricingRevision,
		currency: "USD" as const,
		inputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
		outputMicrousdPerMillionTokens: OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	};
}

function transport(
	bodyBytes = responseBytes(),
	overrides: Partial<{
		status: number;
		finalUrl: string;
		redirectCount: number;
		contentType: string;
	}> = {},
) {
	return createD707InjectedOfficialPricingTransport({
		status: overrides.status ?? 200,
		finalUrl: overrides.finalUrl ?? OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
		redirectCount: overrides.redirectCount ?? 0,
		contentType: overrides.contentType ?? "application/json",
		bodyBytes,
	});
}

async function read(
	pricingTransport = transport(),
	pricing = routePricing(),
	signal = new AbortController().signal,
) {
	return readD707FreshPricingWithInjectedTransport({
		transport: pricingTransport,
		routePricing: pricing,
		signal,
	});
}

describe("D707 fresh-pricing-separated pre-live boundary", () => {
	it("issues one exact injected GET and keeps observation freshness separate from route v3", async () => {
		const result = await read();
		expect(result).toMatchObject({
			executionClass: "simulated-contract",
			status: 200,
			redirectCount: 0,
			frozenScheduleRevision: OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
			observationRevision: D706_PRICING_OBSERVATION_REVISION,
			routeSchemaChanged: false,
			networkCalls: 0,
			providerCalls: 0,
		});
		expect(result.observationRevision).not.toBe(result.frozenScheduleRevision);
		expect(result.historicalPreflightDigest).toBeNull();
		expect(validateD707FreshPricingRead(structuredClone(result))).toEqual(result);
		expect(() => consumeD707FreshPricingReadForPreflight(structuredClone(result))).toThrow(
			/same-process|fresh pricing read/,
		);
		expect(() => consumeD707FreshPricingReadForPreflight(result)).toThrow(/fresh pricing read/);
	});

	it("rejects redirect, status, final URL, content type and route revision before qualification", async () => {
		await expect(read(transport(responseBytes(), { redirectCount: 1 }))).rejects.toThrow(
			/redirectCount/,
		);
		await expect(read(transport(responseBytes(), { status: 503 }))).rejects.toThrow(/status/);
		await expect(
			read(transport(responseBytes(), { finalUrl: "https://example.com/redirected" })),
		).rejects.toThrow(/finalUrl/);
		await expect(read(transport(responseBytes(), { contentType: "text/html" }))).rejects.toThrow(
			/content type/,
		);
		await expect(
			read(transport(), routePricing(D706_PRICING_OBSERVATION_REVISION)),
		).rejects.toThrow(/routePricing.revision/);
	});

	it("rejects provider, tag, quantization and rate drift through the D706 exact observation", async () => {
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
		]) {
			await expect(read(transport(responseBytes(overrides)))).rejects.toThrow();
		}
	});

	it("copies injected bytes once, rejects accessors and enforces the byte ceiling", async () => {
		const original = responseBytes();
		const copiedTransport = transport(original);
		original.fill(0);
		await expect(read(copiedTransport)).resolves.toMatchObject({ status: 200 });

		let getterHits = 0;
		const accessor = Object.defineProperty(
			{
				routePricing: routePricing(),
				signal: new AbortController().signal,
			},
			"transport",
			{
				enumerable: true,
				get() {
					getterHits += 1;
					return transport();
				},
			},
		);
		await expect(readD707FreshPricingWithInjectedTransport(accessor as never)).rejects.toThrow(
			/data property/,
		);
		expect(getterHits).toBe(0);
		expect(() => transport(new Uint8Array(D706_MAX_OFFICIAL_RESPONSE_BYTES + 1))).toThrow(
			/byte bound/,
		);
	});

	it("captures request capabilities once before the injected async boundary", async () => {
		const input: {
			transport: ReturnType<typeof transport> | { request(): Promise<never> };
			routePricing: ReturnType<typeof routePricing>;
			signal: AbortSignal;
		} = {
			transport: transport(),
			routePricing: routePricing(),
			signal: new AbortController().signal,
		};
		const pending = readD707FreshPricingWithInjectedTransport(input as never);
		input.transport = { request: async () => Promise.reject(new Error("substituted")) };
		const replacementController = new AbortController();
		replacementController.abort();
		input.signal = replacementController.signal;
		await expect(pending).resolves.toMatchObject({ status: 200, networkCalls: 0 });
	});

	it("keeps the injected transport single-use and rejects forged or cancelled dispatch", async () => {
		const once = transport();
		await read(once);
		await expect(read(once)).rejects.toThrow(/single-use/);
		await expect(read({ request: async () => ({}) } as never)).rejects.toThrow(/constructed/);
		const controller = new AbortController();
		controller.abort();
		await expect(read(transport(), routePricing(), controller.signal)).rejects.toThrow();
	});

	it("requires a same-process exact historical preflight before a qualified GET", async () => {
		const unusedTransport = transport();
		await expect(
			readD707HistoricallyQualifiedFreshPricingWithInjectedTransport({
				historicalPreflight: {
					capabilityRef: "d707-exact-historical-preflight",
					capabilityRevision: "decision.D707.2026-08-09.v1",
				} as never,
				transport: unusedTransport,
				routePricing: routePricing(),
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(/historical preflight/);
		await expect(read(unusedTransport)).resolves.toMatchObject({ status: 200 });
	});

	it("binds the unchanged D705 implementation bytes without changing that historical module", async () => {
		const source = new Uint8Array(
			await readFile(
				join(
					import.meta.dirname,
					"../../evals/empirical-memory-rerun-avoidance/d705-mutation-first-live.ts",
				),
			),
		);
		expect(empiricalSha256(source)).toBe(D707_D705_MODULE_SOURCE_DIGEST);
	});

	it("rejects malformed or accessor-supplied canonical artifact bytes", () => {
		expect(() =>
			validateD707PreLiveArtifactBytes({
				observationBytes: new Uint8Array([1]),
				scorecardBytes: new Uint8Array([2]),
				generationBytes: new Uint8Array([3]),
			}),
		).toThrow();
		let getterHits = 0;
		const accessor = Object.defineProperty(
			{
				observationBytes: new Uint8Array([1]),
				scorecardBytes: new Uint8Array([2]),
			},
			"generationBytes",
			{
				enumerable: true,
				get() {
					getterHits += 1;
					return new Uint8Array([3]);
				},
			},
		);
		expect(() => validateD707PreLiveArtifactBytes(accessor)).toThrow(/data property/);
		expect(getterHits).toBe(0);
	});
});
