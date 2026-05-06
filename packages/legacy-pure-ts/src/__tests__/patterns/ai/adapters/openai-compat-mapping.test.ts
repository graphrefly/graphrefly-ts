import { describe, expect, it } from "vitest";
import { openAICompatAdapter } from "../../../../patterns/ai/adapters/providers/openai-compat.js";

function mockFetch(body: unknown, opts?: { status?: number }): typeof fetch {
	return (async () =>
		new Response(JSON.stringify(body), {
			status: opts?.status ?? 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

describe("OpenAICompatAdapter usage mapping", () => {
	it("OpenAI shape: cached_tokens → input.cacheRead, reasoning_tokens → output.reasoning", async () => {
		const adapter = openAICompatAdapter({
			preset: "openai",
			apiKey: "test",
			model: "gpt-5.2",
			fetchImpl: mockFetch({
				choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 1000,
					completion_tokens: 500,
					prompt_tokens_details: { cached_tokens: 800, audio_tokens: 0 },
					completion_tokens_details: {
						reasoning_tokens: 300,
						accepted_prediction_tokens: 50,
						rejected_prediction_tokens: 10,
					},
				},
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.usage.input.cacheRead).toBe(800);
		expect(resp.usage.input.regular).toBe(200); // 1000 - 800
		expect(resp.usage.output.reasoning).toBe(300);
		expect(resp.usage.output.regular).toBe(200); // 500 - 300
		expect(resp.usage.output.predictionAccepted).toBe(50);
		expect(resp.usage.output.predictionRejected).toBe(10);
	});

	it("DeepSeek shape: prompt_cache_hit_tokens + prompt_cache_miss_tokens", async () => {
		const adapter = openAICompatAdapter({
			preset: "deepseek",
			apiKey: "test",
			model: "deepseek-v3.2",
			fetchImpl: mockFetch({
				choices: [{ message: { content: "hi" } }],
				usage: {
					prompt_tokens: 1000,
					completion_tokens: 100,
					prompt_cache_hit_tokens: 900,
					prompt_cache_miss_tokens: 100,
				},
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.usage.input.cacheRead).toBe(900);
		expect(resp.usage.input.regular).toBe(100);
	});

	it("maps tool_calls and json-parses arguments", async () => {
		const adapter = openAICompatAdapter({
			preset: "openai",
			apiKey: "test",
			model: "gpt-5.2",
			fetchImpl: mockFetch({
				choices: [
					{
						message: {
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: { name: "get_weather", arguments: '{"city":"NYC"}' },
								},
							],
						},
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.toolCalls).toHaveLength(1);
		expect(resp.toolCalls?.[0].name).toBe("get_weather");
		expect(resp.toolCalls?.[0].arguments).toEqual({ city: "NYC" });
	});

	it("Ollama preset does not require apiKey", async () => {
		const adapter = openAICompatAdapter({
			preset: "ollama",
			model: "gemma3:12b",
			fetchImpl: mockFetch({
				choices: [{ message: { content: "local" } }],
				usage: { prompt_tokens: 5, completion_tokens: 3 },
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.content).toBe("local");
		expect(resp.provider).toBe("ollama");
	});
});
