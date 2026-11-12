import { describe, expect, it } from "vitest";
import {
	auditProviderReportedCost,
	parseOpenRouterUsage,
	providerReportedCost,
	readBoundedResponseBytes,
	requestOpenRouter,
} from "../../evals/graph-native-rerun-avoidance/openrouter-transport.mjs";

const endpoint = "https://openrouter.ai/api/v1/chat/completions";
function response(body: string | ReadableStream<Uint8Array>, status = 200, headers = {}) {
	const result = new Response(body, { status, headers });
	Object.defineProperty(result, "url", { value: endpoint });
	return result;
}
const prices = {
	inputMicrousdPerMillionTokens: 150_000,
	cacheReadMicrousdPerMillionTokens: 16_000,
	outputMicrousdPerMillionTokens: 470_000,
};
describe("shared OpenRouter transport", () => {
	it("makes one exact request and retains provider bytes and metadata", async () => {
		let calls = 0;
		const body = '{"id":"receipt-1","usage":{"cost":0.01}}';
		const controller = new AbortController();
		const receipt = await requestOpenRouter({
			endpoint,
			apiKey: "fixture-only",
			body: { model: "fixture", stream: false },
			signal: controller.signal,
			maxResponseBytes: 1024,
			fetchImpl: (async (url, options) => {
				calls++;
				expect(url).toBe(endpoint);
				expect(options?.redirect).toBe("error");
				expect(options?.signal).toBe(controller.signal);
				expect(JSON.parse(options?.body as string)).toEqual({ model: "fixture", stream: false });
				return response(body, 200, { "x-request-id": "fixture-request" });
			}) as typeof fetch,
		});
		expect(calls).toBe(1);
		expect(receipt.bodyText).toBe(body);
		expect(receipt.headers["x-request-id"]).toBe("fixture-request");
	});
	it.each([429, 500])("retains error receipt without retry (%s)", async (status) => {
		let calls = 0;
		await expect(
			requestOpenRouter({
				endpoint,
				apiKey: "fixture",
				body: {},
				maxResponseBytes: 1024,
				fetchImpl: (async () => {
					calls++;
					return response('{"usage":{"cost":0.1},"error":"fixture"}', status);
				}) as typeof fetch,
			}),
		).rejects.toMatchObject({ receipt: { status, json: { usage: { cost: 0.1 } } } });
		expect(calls).toBe(1);
	});
	it("retains malformed JSON receipt", async () => {
		await expect(
			requestOpenRouter({
				endpoint,
				apiKey: "fixture",
				body: {},
				maxResponseBytes: 1024,
				fetchImpl: (async () => response('{"usage":')) as typeof fetch,
			}),
		).rejects.toMatchObject({ receipt: { status: 200, bodyText: '{"usage":', json: null } });
	});
	it("rejects overlong declared and streamed bodies, retaining bounded prefix", async () => {
		await expect(
			readBoundedResponseBytes(response("12345", 200, { "content-length": "5" }), 4, "fixture"),
		).rejects.toThrow("content-length");
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new TextEncoder().encode("123"));
				c.enqueue(new TextEncoder().encode("456"));
				c.close();
			},
		});
		await expect(
			requestOpenRouter({
				endpoint,
				apiKey: "fixture",
				body: {},
				maxResponseBytes: 4,
				fetchImpl: (async () => response(stream)) as typeof fetch,
			}),
		).rejects.toMatchObject({ receipt: { bodyText: "123" } });
	});
	it("aborts a stalled body even when injected transport ignores the signal", async () => {
		const controller = new AbortController();
		const pending = requestOpenRouter({
			endpoint,
			apiKey: "fixture",
			body: {},
			maxResponseBytes: 1024,
			signal: controller.signal,
			fetchImpl: (async () =>
				response(
					new ReadableStream({
						start(c) {
							c.enqueue(new TextEncoder().encode("{"));
						},
					}),
				)) as typeof fetch,
		});
		setTimeout(() => controller.abort(), 5);
		await expect(pending).rejects.toMatchObject({ receipt: { status: 200, bodyText: "{" } });
	});
	it("does not dispatch pre-aborted requests", async () => {
		let calls = 0;
		await expect(
			requestOpenRouter({
				endpoint,
				apiKey: "fixture",
				body: {},
				maxResponseBytes: 10,
				signal: AbortSignal.abort(),
				fetchImpl: (async () => {
					calls++;
					return response("{}");
				}) as typeof fetch,
			}),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
	it("rejects route drift and never retries", async () => {
		const drifted = response("{}");
		Object.defineProperty(drifted, "redirected", { value: true });
		await expect(
			requestOpenRouter({
				endpoint,
				apiKey: "fixture",
				body: {},
				maxResponseBytes: 10,
				fetchImpl: (async () => drifted) as typeof fetch,
			}),
		).rejects.toMatchObject({ receipt: { status: 200 } });
	});
});
describe("shared OpenRouter usage audit", () => {
	it("audits cached usage and provider sub-microusd rounding", () => {
		const root = {
			usage: {
				prompt_tokens: 10,
				completion_tokens: 2,
				total_tokens: 12,
				prompt_tokens_details: { cached_tokens: 4 },
				cost: 0.000001904,
			},
		};
		expect(parseOpenRouterUsage(root)).toEqual({ input: 10, output: 2, total: 12, cached: 4 });
		expect(providerReportedCost(root)).toEqual({
			exactProviderCostMicrousd: 1.904,
			costMicrousd: 2,
			pricingRoundingAllowanceMicrousd: 1,
		});
		expect(auditProviderReportedCost(root, prices).tokenPricingAuditMicrousd).toBe(1.904);
	});
	it.each([
		{ prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 },
		{
			prompt_tokens: 1,
			completion_tokens: 1,
			total_tokens: 2,
			prompt_tokens_details: { cached_tokens: 2 },
		},
	])("rejects inconsistent usage", (usage) =>
		expect(() => parseOpenRouterUsage({ usage })).toThrow());
	it("rejects missing cost and valid tokens with mismatching billed cost", () => {
		expect(() => providerReportedCost({ usage: {} })).toThrow();
		expect(() =>
			auditProviderReportedCost(
				{ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.001 } },
				prices,
			),
		).toThrow("disagreed");
	});
});
