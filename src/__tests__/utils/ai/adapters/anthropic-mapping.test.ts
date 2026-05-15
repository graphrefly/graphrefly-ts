import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "../../../../utils/ai/adapters/providers/anthropic.js";

/** Build a mock fetch returning a fixed JSON body. */
function mockFetch(body: unknown, opts?: { status?: number; contentType?: string }): typeof fetch {
	return (async () =>
		new Response(JSON.stringify(body), {
			status: opts?.status ?? 200,
			headers: { "content-type": opts?.contentType ?? "application/json" },
		})) as unknown as typeof fetch;
}

describe("AnthropicAdapter usage mapping (fetch backend)", () => {
	it("maps cache_creation.ephemeral_5m/1h and cache_read to TokenUsage classes", async () => {
		const adapter = anthropicAdapter({
			apiKey: "test",
			model: "claude-sonnet-4-6",
			fetchImpl: mockFetch({
				id: "msg_1",
				content: [{ type: "text", text: "hello" }],
				stop_reason: "end_turn",
				model: "claude-sonnet-4-6",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 200,
					cache_creation: {
						ephemeral_5m_input_tokens: 300,
						ephemeral_1h_input_tokens: 400,
					},
				},
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.content).toBe("hello");
		expect(resp.usage.input.regular).toBe(100);
		expect(resp.usage.output.regular).toBe(50);
		expect(resp.usage.input.cacheRead).toBe(200);
		expect(resp.usage.input.cacheWrite5m).toBe(300);
		expect(resp.usage.input.cacheWrite1h).toBe(400);
		expect(resp.usage.raw).toBeDefined();
	});

	it("falls back to cache_creation_input_tokens legacy field → cacheWrite5m", async () => {
		const adapter = anthropicAdapter({
			apiKey: "test",
			model: "claude-sonnet-4-6",
			fetchImpl: mockFetch({
				id: "msg_1",
				content: [{ type: "text", text: "x" }],
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_creation_input_tokens: 500,
				},
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.usage.input.cacheWrite5m).toBe(500);
		expect(resp.usage.input.cacheWrite1h).toBeUndefined();
	});

	it("maps server_tool_use.web_search_requests to auxiliary", async () => {
		const adapter = anthropicAdapter({
			apiKey: "test",
			model: "claude-sonnet-4-6",
			fetchImpl: mockFetch({
				content: [{ type: "text", text: "x" }],
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					server_tool_use: { web_search_requests: 3 },
				},
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.usage.auxiliary?.webSearchRequests).toBe(3);
	});

	it("extracts tool_use blocks into toolCalls", async () => {
		const adapter = anthropicAdapter({
			apiKey: "test",
			model: "claude-sonnet-4-6",
			fetchImpl: mockFetch({
				content: [
					{ type: "text", text: "let me check" },
					{ type: "tool_use", id: "tool_1", name: "get_weather", input: { city: "SF" } },
				],
				usage: { input_tokens: 10, output_tokens: 5 },
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.toolCalls).toHaveLength(1);
		expect(resp.toolCalls?.[0].name).toBe("get_weather");
		expect(resp.toolCalls?.[0].arguments).toEqual({ city: "SF" });
	});

	it("throws HTTP error with status + headers", async () => {
		const adapter = anthropicAdapter({
			apiKey: "test",
			model: "claude-sonnet-4-6",
			fetchImpl: mockFetch({ error: "quota" }, { status: 429 }),
		});
		try {
			await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
			throw new Error("expected throw");
		} catch (err) {
			const e = err as { status?: number; headers?: Headers };
			expect(e.status).toBe(429);
			expect(e.headers).toBeInstanceOf(Headers);
		}
	});
});
