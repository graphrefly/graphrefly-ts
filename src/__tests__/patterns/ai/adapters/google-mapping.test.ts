import { describe, expect, it } from "vitest";
import { googleAdapter } from "../../../../patterns/ai/adapters/providers/google.js";

function mockFetch(body: unknown, opts?: { status?: number }): typeof fetch {
	return (async () =>
		new Response(JSON.stringify(body), {
			status: opts?.status ?? 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

describe("GoogleAdapter usage mapping", () => {
	it("maps cachedContent / thoughts / tool-use / per-modality", async () => {
		const adapter = googleAdapter({
			apiKey: "test",
			model: "gemini-3.1-pro",
			fetchImpl: mockFetch({
				candidates: [
					{
						content: { parts: [{ text: "hello" }] },
						finishReason: "STOP",
					},
				],
				usageMetadata: {
					promptTokenCount: 2000,
					candidatesTokenCount: 500,
					cachedContentTokenCount: 1500,
					thoughtsTokenCount: 300,
					toolUsePromptTokenCount: 50,
					promptTokensDetails: [
						{ modality: "TEXT", tokenCount: 1400 },
						{ modality: "IMAGE", tokenCount: 600 },
					],
				},
				modelVersion: "gemini-3.1-pro",
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.usage.input.cacheRead).toBe(1500);
		expect(resp.usage.input.regular).toBe(500); // 2000 - 1500
		expect(resp.usage.input.toolUse).toBe(50);
		expect(resp.usage.input.image).toBe(600);
		expect(resp.usage.output.regular).toBe(500);
		expect(resp.usage.output.reasoning).toBe(300);
	});

	it("maps functionCall parts to toolCalls", async () => {
		const adapter = googleAdapter({
			apiKey: "test",
			model: "gemini-3.1-pro",
			fetchImpl: mockFetch({
				candidates: [
					{
						content: {
							parts: [
								{ text: "thinking..." },
								{ functionCall: { name: "lookup", args: { q: "pi" } } },
							],
						},
						finishReason: "STOP",
					},
				],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
			}),
		});
		const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
		expect(resp.toolCalls).toHaveLength(1);
		expect(resp.toolCalls?.[0].name).toBe("lookup");
		expect(resp.toolCalls?.[0].arguments).toEqual({ q: "pi" });
	});
});
