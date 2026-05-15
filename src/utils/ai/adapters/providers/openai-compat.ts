/**
 * OpenAICompatAdapter — default fetch-backed, optional SDK-backed.
 *
 * Covers any provider that speaks OpenAI chat/completions. Preset base URLs
 * for OpenAI, OpenRouter, Groq, Ollama, DeepSeek, xAI Grok (all expose the
 * same `/v1/chat/completions` shape).
 *
 * Token usage mapping:
 * - `prompt_tokens`                                     → `input.regular` (minus cached_tokens)
 * - `prompt_tokens_details.cached_tokens`               → `input.cacheRead`
 * - `prompt_tokens_details.audio_tokens`                → `input.audio`
 * - `completion_tokens`                                 → `output.regular` (minus reasoning)
 * - `completion_tokens_details.reasoning_tokens`        → `output.reasoning`
 * - `completion_tokens_details.audio_tokens`            → `output.audio`
 * - `completion_tokens_details.accepted_prediction_tokens` → `output.predictionAccepted`
 * - `completion_tokens_details.rejected_prediction_tokens` → `output.predictionRejected`
 *
 * DeepSeek compatibility: `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 * are surfaced in the `raw` field of `TokenUsage`; when present we prefer
 * them over the OpenAI-style `cached_tokens` for cache-read attribution.
 */

import { monotonicNs } from "@graphrefly/pure-ts/core/clock.js";
import { makeHttpError, parseSSEStream } from "@graphrefly/pure-ts/extra";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
	ToolDefinition,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type OpenAICompatPreset = "openai" | "openrouter" | "groq" | "ollama" | "deepseek" | "xai";

const PRESETS: Record<
	OpenAICompatPreset,
	{ baseURL: string; apiKeyEnv?: string; provider: string }
> = {
	openai: { baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", provider: "openai" },
	openrouter: {
		baseURL: "https://openrouter.ai/api/v1",
		apiKeyEnv: "OPENROUTER_API_KEY",
		provider: "openrouter",
	},
	groq: { baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", provider: "groq" },
	ollama: { baseURL: "http://localhost:11434/v1", provider: "ollama" },
	deepseek: {
		baseURL: "https://api.deepseek.com/v1",
		apiKeyEnv: "DEEPSEEK_API_KEY",
		provider: "deepseek",
	},
	xai: { baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", provider: "xai" },
};

export interface OpenAICompatAdapterOptions {
	preset?: OpenAICompatPreset;
	/** Explicit provider label (defaults to preset's provider). */
	provider?: string;
	/** API key. Falls back to the preset's default env var on Node. */
	apiKey?: string;
	model?: string;
	/** Override base URL (wins over `preset`). */
	baseURL?: string;
	/** Extra request headers. */
	headers?: Record<string, string>;
	/** Extra request-body fields merged on every request (OpenRouter routing etc.). */
	bodyExtras?: Record<string, unknown>;
	/** User-provided SDK instance (OpenAI-family shape). */
	sdk?: OpenAISdkLike;
	/** Custom fetch (for tests). */
	fetchImpl?: typeof fetch;
}

export interface OpenAISdkLike {
	chat: {
		completions: {
			create(
				params: Record<string, unknown>,
				opts?: { signal?: AbortSignal },
			): Promise<OpenAIChatResponse>;
		};
	};
}

interface OpenAIChatResponse {
	id: string;
	choices: ReadonlyArray<{
		message: {
			role: string;
			content?: string | null;
			tool_calls?: ReadonlyArray<{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}>;
			reasoning_content?: string;
		};
		finish_reason?: string;
	}>;
	usage?: OpenAIUsage;
	model?: string;
}

interface OpenAIUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
		audio_tokens?: number;
	};
	completion_tokens_details?: {
		reasoning_tokens?: number;
		audio_tokens?: number;
		accepted_prediction_tokens?: number;
		rejected_prediction_tokens?: number;
	};
	// DeepSeek
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function openAICompatAdapter(opts: OpenAICompatAdapterOptions = {}): LLMAdapter {
	if (opts.sdk) return sdkBackedOpenAI(opts);
	return fetchBackedOpenAI(opts);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toOpenAIRequest(
	messages: readonly ChatMessage[],
	invokeOpts: LLMInvokeOptions | undefined,
	defaultModel: string | undefined,
	stream: boolean,
	bodyExtras: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const model = invokeOpts?.model ?? defaultModel;
	if (!model)
		throw new Error("openAICompatAdapter: model must be set via options.model or invokeOpts.model");
	const mapped = messages.map(toOpenAIMessage);
	if (invokeOpts?.systemPrompt && !messages.some((m) => m.role === "system")) {
		mapped.unshift({ role: "system", content: invokeOpts.systemPrompt });
	}
	const body: Record<string, unknown> = { model, messages: mapped };
	if (invokeOpts?.maxTokens != null) body.max_tokens = invokeOpts.maxTokens;
	if (invokeOpts?.temperature != null) body.temperature = invokeOpts.temperature;
	if (invokeOpts?.tools && invokeOpts.tools.length > 0) {
		body.tools = invokeOpts.tools.map(toOpenAITool);
	}
	if (invokeOpts?.maxReasoningTokens != null) {
		body.reasoning = { max_tokens: invokeOpts.maxReasoningTokens };
	}
	if (stream) {
		body.stream = true;
		body.stream_options = { include_usage: true };
	}
	if (bodyExtras) Object.assign(body, bodyExtras);
	if (invokeOpts?.providerExtras) Object.assign(body, invokeOpts.providerExtras);
	return body;
}

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
	if (m.role === "tool") {
		return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
	}
	if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
		return {
			role: "assistant",
			content: m.content || null,
			tool_calls: m.toolCalls.map((tc) => ({
				id: tc.id,
				type: "function",
				function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
			})),
		};
	}
	return { role: m.role, content: m.content };
}

function toOpenAITool(t: ToolDefinition): Record<string, unknown> {
	return {
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	};
}

function mapUsage(u: OpenAIUsage | undefined): TokenUsage {
	const usage: TokenUsage = {
		input: { regular: 0 },
		output: { regular: 0 },
		raw: u,
	};
	if (!u) return usage;
	const inputTotal = u.prompt_tokens ?? 0;
	let cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0;
	if (u.prompt_cache_hit_tokens != null) {
		// DeepSeek: prefer explicit hit/miss split when present
		cacheRead = u.prompt_cache_hit_tokens;
		usage.input.regular = u.prompt_cache_miss_tokens ?? Math.max(0, inputTotal - cacheRead);
	} else {
		usage.input.regular = Math.max(0, inputTotal - cacheRead);
	}
	if (cacheRead > 0) usage.input.cacheRead = cacheRead;
	if (u.prompt_tokens_details?.audio_tokens)
		usage.input.audio = u.prompt_tokens_details.audio_tokens;

	const outputTotal = u.completion_tokens ?? 0;
	const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
	usage.output.regular = Math.max(0, outputTotal - reasoning);
	if (reasoning > 0) usage.output.reasoning = reasoning;
	if (u.completion_tokens_details?.audio_tokens)
		usage.output.audio = u.completion_tokens_details.audio_tokens;
	if (u.completion_tokens_details?.accepted_prediction_tokens) {
		usage.output.predictionAccepted = u.completion_tokens_details.accepted_prediction_tokens;
	}
	if (u.completion_tokens_details?.rejected_prediction_tokens) {
		usage.output.predictionRejected = u.completion_tokens_details.rejected_prediction_tokens;
	}
	return usage;
}

function toLLMResponse(json: OpenAIChatResponse, latencyMs: number, provider: string): LLMResponse {
	const choice = json.choices[0];
	const msg = choice?.message;
	const content = msg?.content ?? "";
	const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({
		id: tc.id,
		name: tc.function.name,
		arguments: safeJsonParse(tc.function.arguments),
	}));
	return {
		content,
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		usage: mapUsage(json.usage),
		finishReason: choice?.finish_reason,
		latencyMs,
		model: json.model,
		provider,
	};
}

function safeJsonParse(s: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(s);
		return typeof parsed === "object" && parsed != null
			? (parsed as Record<string, unknown>)
			: { _raw: s };
	} catch {
		return { _raw: s };
	}
}

// ---------------------------------------------------------------------------
// Fetch-backed
// ---------------------------------------------------------------------------

function resolveConfig(opts: OpenAICompatAdapterOptions): {
	provider: string;
	baseURL: string;
	apiKey: string | undefined;
} {
	const preset = opts.preset ?? "openai";
	const base = PRESETS[preset];
	const baseURL = opts.baseURL ?? base.baseURL;
	const provider = opts.provider ?? base.provider;
	const envKey = base.apiKeyEnv;
	const apiKey =
		opts.apiKey ??
		(envKey
			? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[envKey]
			: undefined);
	return { provider, baseURL, apiKey };
}

function fetchBackedOpenAI(opts: OpenAICompatAdapterOptions): LLMAdapter {
	const { provider, baseURL, apiKey } = resolveConfig(opts);
	const fetchImpl = opts.fetchImpl ?? fetch;
	const needsKey = provider !== "ollama"; // Ollama local default: no key required.

	const commonHeaders = (): Record<string, string> => {
		const h: Record<string, string> = {
			"content-type": "application/json",
			...(opts.headers ?? {}),
		};
		if (needsKey) {
			if (!apiKey)
				throw new Error(`openAICompatAdapter[${provider}]: apiKey required for invoke/stream`);
			h.authorization = `Bearer ${apiKey}`;
		}
		return h;
	};

	return {
		provider,
		model: opts.model,
		// QA D3 (Phase 13.6.B): adapter threads `invokeOpts.signal` into
		// every fetch / SDK call, so `withBudgetGate`'s auto-abort lands
		// end-to-end.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const body = toOpenAIRequest(messages, invokeOpts, opts.model, false, opts.bodyExtras);
			const start = monotonicNs();
			const resp = await fetchImpl(`${baseURL}/chat/completions`, {
				method: "POST",
				headers: commonHeaders(),
				body: JSON.stringify(body),
				signal: invokeOpts?.signal,
			});
			if (!resp.ok) throw await makeHttpError(resp, provider);
			const json = (await resp.json()) as OpenAIChatResponse;
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			return toLLMResponse(json, latencyMs, provider);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const body = toOpenAIRequest(messages, invokeOpts, opts.model, true, opts.bodyExtras);
			const resp = await fetchImpl(`${baseURL}/chat/completions`, {
				method: "POST",
				headers: { ...commonHeaders(), accept: "text/event-stream" },
				body: JSON.stringify(body),
				signal: invokeOpts?.signal,
			});
			if (!resp.ok) throw await makeHttpError(resp, provider);
			if (!resp.body)
				throw new Error(`openAICompatAdapter[${provider}]: streaming response has no body`);

			let finalUsage: OpenAIUsage | undefined;
			let finishReason: string | undefined;

			for await (const event of parseSSEStream(resp.body, { signal: invokeOpts?.signal })) {
				if (!event.data || event.data === "[DONE]") continue;
				let parsed: Record<string, unknown>;
				try {
					parsed = JSON.parse(event.data) as Record<string, unknown>;
				} catch {
					continue;
				}
				// Streaming shape: choices[0].delta.{content?, tool_calls?, reasoning_content?}
				const choices = parsed.choices as
					| ReadonlyArray<{
							delta?: {
								content?: string;
								tool_calls?: ReadonlyArray<{
									index: number;
									id?: string;
									function?: { name?: string; arguments?: string };
								}>;
								reasoning_content?: string;
							};
							finish_reason?: string;
					  }>
					| undefined;
				if (choices) {
					const c = choices[0];
					if (c?.delta?.content) yield { type: "token", delta: c.delta.content };
					if (c?.delta?.reasoning_content) {
						yield { type: "thinking", delta: c.delta.reasoning_content };
					}
					if (c?.delta?.tool_calls) {
						for (const tc of c.delta.tool_calls) {
							yield {
								type: "tool-call-delta",
								delta: {
									id: tc.id,
									name: tc.function?.name,
									argumentsDelta: tc.function?.arguments,
								},
							};
						}
					}
					if (c?.finish_reason) finishReason = c.finish_reason;
				}
				// Yield every usage delta the provider emits (Anthropic, Groq, and
				// some OpenAI-compat providers can emit mid-stream usage). Downstream
				// consumers treat the most-recent delta as authoritative. See D5b in
				// adapter QA session.
				if (parsed.usage) {
					finalUsage = parsed.usage as OpenAIUsage;
					yield { type: "usage", usage: mapUsage(finalUsage) };
				}
			}
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}

function sdkBackedOpenAI(opts: OpenAICompatAdapterOptions): LLMAdapter {
	const sdk = opts.sdk;
	if (!sdk) throw new Error("sdkBackedOpenAI: sdk instance required");
	const { provider } = resolveConfig(opts);
	return {
		provider,
		model: opts.model,
		// QA D3 (Phase 13.6.B): adapter threads `invokeOpts.signal` into
		// every fetch / SDK call, so `withBudgetGate`'s auto-abort lands
		// end-to-end.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const body = toOpenAIRequest(messages, invokeOpts, opts.model, false, opts.bodyExtras);
			const start = monotonicNs();
			const resp = await sdk.chat.completions.create(body, { signal: invokeOpts?.signal });
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			return toLLMResponse(resp, latencyMs, provider);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const body = toOpenAIRequest(messages, invokeOpts, opts.model, true, opts.bodyExtras);
			const stream = (await sdk.chat.completions.create(body, {
				signal: invokeOpts?.signal,
			})) as unknown as AsyncIterable<Record<string, unknown>>;
			let finalUsage: OpenAIUsage | undefined;
			let finishReason: string | undefined;
			for await (const chunk of stream) {
				const choices = (
					chunk as {
						choices?: ReadonlyArray<{
							delta?: {
								content?: string;
								tool_calls?: ReadonlyArray<{
									id?: string;
									function?: { name?: string; arguments?: string };
								}>;
								reasoning_content?: string;
							};
							finish_reason?: string;
						}>;
					}
				).choices;
				if (choices) {
					const c = choices[0];
					if (c?.delta?.content) yield { type: "token", delta: c.delta.content };
					if (c?.delta?.reasoning_content)
						yield { type: "thinking", delta: c.delta.reasoning_content };
					if (c?.delta?.tool_calls) {
						for (const tc of c.delta.tool_calls) {
							yield {
								type: "tool-call-delta",
								delta: {
									id: tc.id,
									name: tc.function?.name,
									argumentsDelta: tc.function?.arguments,
								},
							};
						}
					}
					if (c?.finish_reason) finishReason = c.finish_reason;
				}
				const u = (chunk as { usage?: OpenAIUsage }).usage;
				if (u) {
					finalUsage = u;
					yield { type: "usage", usage: mapUsage(u) };
				}
			}
			if (!finalUsage) {
				// No usage emitted — yield nothing; downstream consumers default
				// to empty usage via their own fallback.
			}
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}
