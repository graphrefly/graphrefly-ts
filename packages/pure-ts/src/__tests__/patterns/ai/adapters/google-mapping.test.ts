import { describe, expect, it } from "vitest";
import {
	type GoogleSdkLike,
	type GoogleSdkRequestParams,
	googleAdapter,
} from "../../../../patterns/ai/adapters/providers/google.js";

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

describe("GoogleAdapter SDK-backed path (@google/genai shape)", () => {
	it("reshapes request into { model, contents, config } and threads abortSignal", async () => {
		const captured: GoogleSdkRequestParams[] = [];
		const sdk: GoogleSdkLike = {
			models: {
				async generateContent(params) {
					captured.push(params);
					return {
						candidates: [
							{
								content: { parts: [{ text: "ok" }] },
								finishReason: "STOP",
							},
						],
						usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
					};
				},
			},
		};
		const ac = new AbortController();
		const adapter = googleAdapter({ sdk, model: "gemini-3.1-pro" });
		await adapter.invoke([{ role: "user", content: "hi" }], {
			temperature: 0.4,
			maxTokens: 128,
			systemPrompt: "be concise",
			signal: ac.signal,
		});
		expect(captured).toHaveLength(1);
		const params = captured[0];
		expect(params.model).toBe("gemini-3.1-pro");
		// Generation params + abortSignal land under config, not generationConfig.
		expect(params.config?.temperature).toBe(0.4);
		expect(params.config?.maxOutputTokens).toBe(128);
		expect(params.config?.systemInstruction).toEqual({
			role: "system",
			parts: [{ text: "be concise" }],
		});
		expect(params.config?.abortSignal).toBe(ac.signal);
		// generationConfig should NOT leak through to the SDK params.
		expect((params as unknown as Record<string, unknown>).generationConfig).toBeUndefined();
		expect((params.config as unknown as Record<string, unknown>).generationConfig).toBeUndefined();
	});

	it("awaits stream iterable returned as a Promise", async () => {
		async function* chunks(): AsyncGenerator<{
			candidates: { content: { parts: { text?: string }[] }; finishReason?: string }[];
		}> {
			yield {
				candidates: [{ content: { parts: [{ text: "alpha" }] } }],
			};
			yield {
				candidates: [{ content: { parts: [{ text: "-beta" }] }, finishReason: "STOP" }],
			};
		}
		const sdk: GoogleSdkLike = {
			models: {
				async generateContent() {
					throw new Error("invoke not used in this test");
				},
				generateContentStream(_params) {
					// Match the new SDK shape: returns a Promise<AsyncIterable>.
					return Promise.resolve(chunks());
				},
			},
		};
		const adapter = googleAdapter({ sdk, model: "gemini-3.1-pro" });
		const tokens: string[] = [];
		let finishReason: string | undefined;
		for await (const delta of adapter.stream([{ role: "user", content: "go" }])) {
			if (delta.type === "token") tokens.push(delta.delta);
			else if (delta.type === "finish") finishReason = delta.reason;
		}
		expect(tokens).toEqual(["alpha", "-beta"]);
		expect(finishReason).toBe("STOP");
	});
});
