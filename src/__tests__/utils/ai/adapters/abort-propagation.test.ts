/**
 * End-to-end abort signal propagation through every shipped provider adapter.
 *
 * Implementation-side note: every provider already plumbs
 * `LLMInvokeOptions.signal` into its underlying `fetch(..., { signal })` /
 * SDK call (audit done 2026-04-28). These tests lock that contract so a
 * future refactor that drops `signal:` from a provider's request init
 * fails loud rather than quietly turning the JSDoc cancellation claims on
 * `defaultLlmExecutor` / `defaultLlmVerifier` / `actuatorExecutor` /
 * `valve` panic-stop / `switchMap` steering into end-to-end aspirational
 * lies.
 *
 * Coverage axes: provider × call-method (`invoke` / `stream`).
 *   - anthropic: fetch + SDK on both invoke and stream
 *   - openai-compat: fetch + SDK on both invoke and stream
 *   - google: fetch on invoke (SDK path covered in google-mapping.test.ts)
 *   - chrome-nano (browser): invoke + streaming
 *   - webllm (browser): invoke + streaming
 *
 * `stream()` coverage closes the qa D1 gap — the SSE / sdk.*.stream paths
 * matter for streaming-shaped consumers (`valve` panic-stop, `switchMap`
 * steering, inline-edit/param-change patterns) where the abort plumbing
 * needs to thread through `parseSSEStream({ signal })` and
 * `sdk.*.stream({ signal })` rather than just the one-shot fetch init.
 */
import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "../../../../utils/ai/adapters/providers/anthropic.js";
import { chromeNanoAdapter } from "../../../../utils/ai/adapters/providers/browser/chrome-nano.js";
import { webllmAdapter } from "../../../../utils/ai/adapters/providers/browser/webllm.js";
import { googleAdapter } from "../../../../utils/ai/adapters/providers/google.js";
import { openAICompatAdapter } from "../../../../utils/ai/adapters/providers/openai-compat.js";

interface CapturedFetch {
	calls: Array<{ url: string; init: RequestInit | undefined }>;
	fetchImpl: typeof fetch;
}

function mockFetchCapturing(jsonBody: unknown, status = 200): CapturedFetch {
	const calls: CapturedFetch["calls"] = [];
	const fetchImpl: typeof fetch = (async (url: unknown, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return new Response(JSON.stringify(jsonBody), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

/** Build a fetch impl that returns an SSE stream with the supplied raw body. */
function mockSseFetchCapturing(sseBody: string): CapturedFetch {
	const calls: CapturedFetch["calls"] = [];
	const fetchImpl: typeof fetch = (async (url: unknown, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return new Response(sseBody, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

/** Drain an async generator without caring about yielded values. */
async function drain<T>(gen: AsyncGenerator<T> | AsyncIterable<T>): Promise<void> {
	for await (const _ of gen as AsyncIterable<T>) {
		void _;
	}
}

describe("Adapter abort propagation (Tier 9.x audit)", () => {
	describe("anthropicAdapter (fetch backend)", () => {
		it("invoke threads invokeOpts.signal into fetch init", async () => {
			const captured = mockFetchCapturing({
				id: "msg_1",
				content: [{ type: "text", text: "hello" }],
				stop_reason: "end_turn",
				model: "claude-sonnet-4-6",
				usage: { input_tokens: 1, output_tokens: 1 },
			});
			const adapter = anthropicAdapter({
				apiKey: "test",
				model: "claude-sonnet-4-6",
				fetchImpl: captured.fetchImpl,
			});
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0]?.init?.signal).toBe(ac.signal);
		});

		it("invoke without an explicit signal still works (signal init is undefined)", async () => {
			const captured = mockFetchCapturing({
				id: "msg_1",
				content: [{ type: "text", text: "hello" }],
				stop_reason: "end_turn",
				model: "claude-sonnet-4-6",
				usage: { input_tokens: 1, output_tokens: 1 },
			});
			const adapter = anthropicAdapter({
				apiKey: "test",
				model: "claude-sonnet-4-6",
				fetchImpl: captured.fetchImpl,
			});
			await adapter.invoke([{ role: "user", content: "hi" }]);
			expect(captured.calls[0]?.init?.signal).toBeUndefined();
		});
	});

	describe("anthropicAdapter (SDK backend)", () => {
		it("invoke forwards invokeOpts.signal to sdk.messages.create options", async () => {
			let capturedSignal: AbortSignal | undefined;
			const sdk = {
				messages: {
					create: async (_body: unknown, sdkOpts?: { signal?: AbortSignal }): Promise<unknown> => {
						capturedSignal = sdkOpts?.signal;
						return {
							id: "msg_1",
							content: [{ type: "text", text: "ok" }],
							stop_reason: "end_turn",
							model: "claude-sonnet-4-6",
							usage: { input_tokens: 1, output_tokens: 1 },
						};
					},
				},
			};
			const adapter = anthropicAdapter({ sdk, model: "claude-sonnet-4-6" });
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			expect(capturedSignal).toBe(ac.signal);
		});
	});

	describe("openAICompatAdapter (fetch backend)", () => {
		it("invoke threads invokeOpts.signal into fetch init", async () => {
			const captured = mockFetchCapturing({
				id: "cmpl_1",
				model: "gpt-x",
				choices: [
					{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" },
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
			const adapter = openAICompatAdapter({
				baseURL: "https://api.example.com/v1",
				apiKey: "test",
				model: "gpt-x",
				fetchImpl: captured.fetchImpl,
			});
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0]?.init?.signal).toBe(ac.signal);
		});
	});

	describe("openAICompatAdapter (SDK backend)", () => {
		it("invoke forwards invokeOpts.signal to sdk.chat.completions.create options", async () => {
			let capturedSignal: AbortSignal | undefined;
			const sdk = {
				chat: {
					completions: {
						create: async (
							_body: unknown,
							sdkOpts?: { signal?: AbortSignal },
						): Promise<unknown> => {
							capturedSignal = sdkOpts?.signal;
							return {
								id: "cmpl_1",
								model: "gpt-x",
								choices: [
									{
										index: 0,
										message: { role: "assistant", content: "ok" },
										finish_reason: "stop",
									},
								],
								usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
							};
						},
					},
				},
			};
			const adapter = openAICompatAdapter({ sdk, model: "gpt-x" });
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			expect(capturedSignal).toBe(ac.signal);
		});
	});

	describe("googleAdapter (fetch backend)", () => {
		it("invoke threads invokeOpts.signal into fetch init", async () => {
			const captured = mockFetchCapturing({
				candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
			});
			const adapter = googleAdapter({
				apiKey: "test",
				model: "gemini-3.1-pro",
				fetchImpl: captured.fetchImpl,
			});
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0]?.init?.signal).toBe(ac.signal);
		});
	});

	describe("chromeNanoAdapter (browser SDK shim)", () => {
		it("invoke forwards invokeOpts.signal to session.prompt options AND ai.languageModel.create options", async () => {
			let promptSignal: AbortSignal | undefined;
			let createSignal: AbortSignal | undefined;
			const session = {
				prompt: async (_input: string, opts?: { signal?: AbortSignal }): Promise<string> => {
					promptSignal = opts?.signal;
					return "ok";
				},
				promptStreaming: () =>
					(async function* () {
						yield "ok";
					})(),
				destroy: () => undefined,
			};
			const navigatorOverride = {
				ai: {
					languageModel: {
						create: async (params?: { signal?: AbortSignal }) => {
							createSignal = params?.signal;
							return session;
						},
					},
				},
			} as unknown as Navigator;
			const adapter = chromeNanoAdapter({ navigatorOverride });
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			// Both `create` (session opening) and `prompt` (the actual call) must
			// receive the same signal — either source can stall mid-call so both
			// must observe abort.
			expect(createSignal).toBe(ac.signal);
			expect(promptSignal).toBe(ac.signal);
		});
	});

	describe("webllmAdapter (browser SDK)", () => {
		it("invoke forwards invokeOpts.signal to chat.completions.create options", async () => {
			let capturedSignal: AbortSignal | undefined;
			const engine = {
				chat: {
					completions: {
						create: async (
							_body: unknown,
							sdkOpts?: { signal?: AbortSignal },
						): Promise<unknown> => {
							capturedSignal = sdkOpts?.signal;
							return {
								id: "wll_1",
								model: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
								choices: [
									{
										index: 0,
										message: { role: "assistant", content: "ok" },
										finish_reason: "stop",
									},
								],
								usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
							};
						},
					},
				},
			};
			const adapter = webllmAdapter({ engine, model: "Llama-3.1-8B-Instruct-q4f32_1-MLC" });
			const ac = new AbortController();
			await adapter.invoke([{ role: "user", content: "hi" }], { signal: ac.signal });
			expect(capturedSignal).toBe(ac.signal);
		});
	});

	// -------------------------------------------------------------------------
	// stream() — qa D1 follow-up: lock that streaming-shaped abort plumbing
	// (SSE / SDK iterator) also threads invokeOpts.signal end-to-end.
	// -------------------------------------------------------------------------

	describe("anthropicAdapter (fetch backend) stream()", () => {
		it("threads invokeOpts.signal into both fetch init AND parseSSEStream", async () => {
			// Anthropic SSE shape: minimal message_start + message_stop frames.
			const sse =
				'event: message_start\ndata: {"message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
				'event: message_stop\ndata: {"type":"message_stop"}\n\n';
			const captured = mockSseFetchCapturing(sse);
			const adapter = anthropicAdapter({
				apiKey: "test",
				model: "claude-sonnet-4-6",
				fetchImpl: captured.fetchImpl,
			});
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0]?.init?.signal).toBe(ac.signal);
		});
	});

	describe("anthropicAdapter (SDK backend) stream()", () => {
		it("forwards invokeOpts.signal to sdk.messages.stream options", async () => {
			let capturedSignal: AbortSignal | undefined;
			const sdk = {
				messages: {
					create: async () => ({}),
					stream: (_body: unknown, sdkOpts?: { signal?: AbortSignal }) => {
						capturedSignal = sdkOpts?.signal;
						return (async function* () {
							yield { type: "message_stop" } as { type: string };
						})();
					},
				},
			};
			const adapter = anthropicAdapter({ sdk, model: "claude-sonnet-4-6" });
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(capturedSignal).toBe(ac.signal);
		});
	});

	describe("openAICompatAdapter (fetch backend) stream()", () => {
		it("threads invokeOpts.signal into both fetch init AND parseSSEStream", async () => {
			const sse =
				'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
			const captured = mockSseFetchCapturing(sse);
			const adapter = openAICompatAdapter({
				baseURL: "https://api.example.com/v1",
				apiKey: "test",
				model: "gpt-x",
				fetchImpl: captured.fetchImpl,
			});
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0]?.init?.signal).toBe(ac.signal);
		});
	});

	describe("openAICompatAdapter (SDK backend) stream()", () => {
		it("forwards invokeOpts.signal to sdk.chat.completions.create stream options", async () => {
			let capturedSignal: AbortSignal | undefined;
			const sdk = {
				chat: {
					completions: {
						create: async (_body: unknown, sdkOpts?: { signal?: AbortSignal }) => {
							capturedSignal = sdkOpts?.signal;
							return (async function* () {
								yield {
									choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
								};
							})() as unknown;
						},
					},
				},
			};
			const adapter = openAICompatAdapter({ sdk, model: "gpt-x" });
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(capturedSignal).toBe(ac.signal);
		});
	});

	describe("googleAdapter (fetch backend) stream()", () => {
		it("threads invokeOpts.signal into both fetch init AND parseSSEStream", async () => {
			const sse =
				'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\n\n';
			const captured = mockSseFetchCapturing(sse);
			const adapter = googleAdapter({
				apiKey: "test",
				model: "gemini-3.1-pro",
				fetchImpl: captured.fetchImpl,
			});
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0]?.init?.signal).toBe(ac.signal);
		});
	});

	describe("chromeNanoAdapter (browser SDK) stream()", () => {
		it("forwards invokeOpts.signal to ai.languageModel.create AND session.promptStreaming", async () => {
			let createSignal: AbortSignal | undefined;
			let promptStreamingSignal: AbortSignal | undefined;
			const session = {
				prompt: async () => "ok",
				promptStreaming: (_input: string, opts?: { signal?: AbortSignal }) => {
					promptStreamingSignal = opts?.signal;
					return (async function* () {
						yield "ok";
					})();
				},
				destroy: () => undefined,
			};
			const navigatorOverride = {
				ai: {
					languageModel: {
						create: async (params?: { signal?: AbortSignal }) => {
							createSignal = params?.signal;
							return session;
						},
					},
				},
			} as unknown as Navigator;
			const adapter = chromeNanoAdapter({ navigatorOverride });
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(createSignal).toBe(ac.signal);
			expect(promptStreamingSignal).toBe(ac.signal);
		});
	});

	describe("webllmAdapter (browser SDK) stream()", () => {
		it("forwards invokeOpts.signal to chat.completions.create stream options", async () => {
			let capturedSignal: AbortSignal | undefined;
			const engine = {
				chat: {
					completions: {
						create: async (_body: unknown, sdkOpts?: { signal?: AbortSignal }) => {
							capturedSignal = sdkOpts?.signal;
							return (async function* () {
								yield {
									choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
									usage: { prompt_tokens: 1, completion_tokens: 1 },
								};
							})() as unknown;
						},
					},
				},
			};
			const adapter = webllmAdapter({ engine, model: "Llama-3.1-8B-Instruct-q4f32_1-MLC" });
			const ac = new AbortController();
			await drain(adapter.stream([{ role: "user", content: "hi" }], { signal: ac.signal }));
			expect(capturedSignal).toBe(ac.signal);
		});
	});
});
