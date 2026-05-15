/**
 * GoogleAdapter — default fetch-backed, optional SDK-backed.
 *
 * The SDK-backed path targets the `@google/genai` SDK shape:
 * `client.models.generateContent({ model, contents, config })` — single
 * param, with generation params and `abortSignal` under `config`. The
 * legacy `@google/generative-ai` two-arg `(params, {signal})` shape is no
 * longer accepted; pass a `GoogleGenAI` instance via `opts.sdk`.
 *
 * Maps Gemini `usageMetadata`:
 * - `promptTokenCount` minus `cachedContentTokenCount` → `input.regular`
 * - `cachedContentTokenCount`                          → `input.cacheRead`
 * - `candidatesTokenCount`                             → `output.regular`
 * - `thoughtsTokenCount`                               → `output.reasoning`
 * - `toolUsePromptTokenCount`                          → `input.toolUse`
 * - `promptTokensDetails[]`                            → `input.{image,audio,video}` per modality
 */

import { monotonicNs } from "@graphrefly/pure-ts/core";
import { makeHttpError } from "../../../../base/io/http-error.js";
import { parseSSEStream } from "../../../../base/io/sse.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
	ToolDefinition,
} from "../core/types.js";

export interface GoogleAdapterOptions {
	/** API key. Falls back to `process.env.GOOGLE_API_KEY` / `GEMINI_API_KEY` on Node. */
	apiKey?: string;
	model?: string;
	baseURL?: string;
	/** Extra headers on every request. */
	headers?: Record<string, string>;
	/**
	 * Optional `@google/genai` SDK instance (e.g. `new GoogleGenAI({apiKey})`).
	 * When omitted, the adapter uses the fetch-backed path against the
	 * Generative Language REST API.
	 */
	sdk?: GoogleSdkLike;
	fetchImpl?: typeof fetch;
}

/**
 * Duck-type matching the `@google/genai` (`GoogleGenAI`) SDK shape:
 * single-param `generateContent({ model, contents, config })` where
 * generation parameters and `abortSignal` live under `config`.
 *
 * The `@google/generative-ai` predecessor's two-arg `(params, {signal})`
 * shape is no longer accepted.
 */
export interface GoogleSdkLike {
	models: {
		generateContent(params: GoogleSdkRequestParams): Promise<GeminiResponse>;
		generateContentStream?(
			params: GoogleSdkRequestParams,
		): Promise<AsyncIterable<GeminiResponse>> | AsyncIterable<GeminiResponse>;
	};
}

/** Single-param request shape consumed by `@google/genai`'s `models.generateContent`. */
export interface GoogleSdkRequestParams {
	model: string;
	contents: unknown;
	config?: GoogleSdkRequestConfig;
}

/**
 * Generation config under the new SDK. `abortSignal` is the cancellation
 * channel — there is no second-arg `{signal}`.
 */
export interface GoogleSdkRequestConfig {
	abortSignal?: AbortSignal;
	temperature?: number;
	maxOutputTokens?: number;
	systemInstruction?: unknown;
	tools?: unknown;
	thinkingConfig?: unknown;
	[extra: string]: unknown;
}

interface GeminiResponse {
	candidates?: ReadonlyArray<{
		content?: {
			role?: string;
			parts?: ReadonlyArray<{
				text?: string;
				thought?: boolean;
				functionCall?: { name: string; args: Record<string, unknown> };
			}>;
		};
		finishReason?: string;
	}>;
	usageMetadata?: GeminiUsage;
	modelVersion?: string;
}

interface GeminiUsage {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	totalTokenCount?: number;
	thoughtsTokenCount?: number;
	cachedContentTokenCount?: number;
	toolUsePromptTokenCount?: number;
	promptTokensDetails?: ReadonlyArray<{ modality: string; tokenCount: number }>;
	candidatesTokensDetails?: ReadonlyArray<{ modality: string; tokenCount: number }>;
	cacheTokensDetails?: ReadonlyArray<{ modality: string; tokenCount: number }>;
}

export function googleAdapter(opts: GoogleAdapterOptions = {}): LLMAdapter {
	if (opts.sdk) return sdkBackedGoogle(opts);
	return fetchBackedGoogle(opts);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toGeminiRequest(
	messages: readonly ChatMessage[],
	invokeOpts: LLMInvokeOptions | undefined,
): Record<string, unknown> {
	const systemParts: string[] = [];
	const contents: Array<{
		role: string;
		parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }>;
	}> = [];
	if (invokeOpts?.systemPrompt) systemParts.push(invokeOpts.systemPrompt);

	for (const m of messages) {
		if (m.role === "system") {
			systemParts.push(m.content);
			continue;
		}
		if (m.role === "tool") {
			contents.push({
				role: "user",
				parts: [
					{
						functionResponse: {
							name: m.name ?? m.toolCallId ?? "tool",
							response: { result: m.content },
						},
					},
				],
			});
			continue;
		}
		if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
			const parts: Array<{ text?: string; functionCall?: unknown }> = [];
			if (m.content) parts.push({ text: m.content });
			for (const tc of m.toolCalls) {
				parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
			}
			contents.push({ role: "model", parts });
			continue;
		}
		contents.push({
			role: m.role === "assistant" ? "model" : "user",
			parts: [{ text: m.content }],
		});
	}

	const body: Record<string, unknown> = { contents };
	if (systemParts.length > 0) {
		body.systemInstruction = { role: "system", parts: [{ text: systemParts.join("\n\n") }] };
	}
	const genConfig: Record<string, unknown> = {};
	if (invokeOpts?.maxTokens != null) genConfig.maxOutputTokens = invokeOpts.maxTokens;
	if (invokeOpts?.temperature != null) genConfig.temperature = invokeOpts.temperature;
	if (invokeOpts?.maxReasoningTokens != null) {
		genConfig.thinkingConfig = { thinkingBudget: invokeOpts.maxReasoningTokens };
	}
	if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;
	if (invokeOpts?.tools && invokeOpts.tools.length > 0) {
		body.tools = [{ functionDeclarations: invokeOpts.tools.map(toGeminiTool) }];
	}
	if (invokeOpts?.providerExtras) Object.assign(body, invokeOpts.providerExtras);
	return body;
}

function toGeminiTool(t: ToolDefinition): Record<string, unknown> {
	return {
		name: t.name,
		description: t.description,
		parameters: t.parameters,
	};
}

/**
 * Reshape the fetch-API request body into the SDK's `{ model, contents,
 * config }` form. Generation params (`temperature`, `maxOutputTokens`,
 * `thinkingConfig`) move from `body.generationConfig.*` to `config.*`;
 * `systemInstruction` and `tools` move from top-level body keys into
 * `config`; `abortSignal` is threaded into `config`. `providerExtras` keys
 * spread into `config` so escape-hatch usage remains identical.
 */
function toSdkParams(
	body: Record<string, unknown>,
	model: string,
	signal: AbortSignal | undefined,
): GoogleSdkRequestParams {
	const config: GoogleSdkRequestConfig = {};
	const gen = body.generationConfig as Record<string, unknown> | undefined;
	if (gen) {
		if (typeof gen.maxOutputTokens === "number") config.maxOutputTokens = gen.maxOutputTokens;
		if (typeof gen.temperature === "number") config.temperature = gen.temperature;
		if (gen.thinkingConfig) config.thinkingConfig = gen.thinkingConfig;
	}
	if (body.systemInstruction) config.systemInstruction = body.systemInstruction;
	if (body.tools) config.tools = body.tools;
	for (const [k, v] of Object.entries(body)) {
		if (
			k === "contents" ||
			k === "generationConfig" ||
			k === "systemInstruction" ||
			k === "tools" ||
			// Skip `abortSignal` so a caller-supplied entry in `providerExtras`
			// can't briefly land in `config.abortSignal` before being
			// overwritten — the canonical signal channel is the second
			// `signal` argument (set on `config.abortSignal` below).
			k === "abortSignal" ||
			// Skip `model` so a stray `body.model` (not produced by
			// `toGeminiRequest` today, but defensively guarded) doesn't
			// duplicate the top-level `model` field on the SDK request.
			k === "model"
		) {
			continue;
		}
		config[k] = v;
	}
	if (signal) config.abortSignal = signal;
	return {
		model,
		contents: body.contents,
		config: Object.keys(config).length > 0 ? config : undefined,
	};
}

function mapUsage(u: GeminiUsage | undefined): TokenUsage {
	const usage: TokenUsage = {
		input: { regular: 0 },
		output: { regular: 0 },
		raw: u,
	};
	if (!u) return usage;
	const promptTotal = u.promptTokenCount ?? 0;
	const cached = u.cachedContentTokenCount ?? 0;
	usage.input.regular = Math.max(0, promptTotal - cached);
	if (cached > 0) usage.input.cacheRead = cached;
	if (u.toolUsePromptTokenCount) usage.input.toolUse = u.toolUsePromptTokenCount;
	if (u.promptTokensDetails) {
		for (const d of u.promptTokensDetails) {
			const modality = d.modality?.toLowerCase();
			if (modality === "image") usage.input.image = (usage.input.image ?? 0) + d.tokenCount;
			else if (modality === "audio") usage.input.audio = (usage.input.audio ?? 0) + d.tokenCount;
			else if (modality === "video") usage.input.video = (usage.input.video ?? 0) + d.tokenCount;
		}
	}
	usage.output.regular = u.candidatesTokenCount ?? 0;
	if (u.thoughtsTokenCount) usage.output.reasoning = u.thoughtsTokenCount;
	return usage;
}

function toLLMResponse(json: GeminiResponse, latencyMs: number): LLMResponse {
	const cand = json.candidates?.[0];
	const parts = cand?.content?.parts ?? [];
	const textParts: string[] = [];
	const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
	let i = 0;
	for (const p of parts) {
		if (typeof p.text === "string") textParts.push(p.text);
		if (p.functionCall) {
			toolCalls.push({
				id: `${p.functionCall.name}-${i++}`,
				name: p.functionCall.name,
				arguments: p.functionCall.args ?? {},
			});
		}
	}
	return {
		content: textParts.join(""),
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		usage: mapUsage(json.usageMetadata),
		finishReason: cand?.finishReason,
		latencyMs,
		model: json.modelVersion,
		provider: "google",
	};
}

// ---------------------------------------------------------------------------
// Fetch-backed
// ---------------------------------------------------------------------------

function resolveApiKey(opts: GoogleAdapterOptions): string | undefined {
	if (opts.apiKey) return opts.apiKey;
	const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
	return env?.GOOGLE_API_KEY ?? env?.GEMINI_API_KEY;
}

function fetchBackedGoogle(opts: GoogleAdapterOptions): LLMAdapter {
	const baseURL = opts.baseURL ?? "https://generativelanguage.googleapis.com/v1beta";
	const fetchImpl = opts.fetchImpl ?? fetch;

	const pickModel = (invokeOpts: LLMInvokeOptions | undefined): string => {
		const model = invokeOpts?.model ?? opts.model;
		if (!model)
			throw new Error("googleAdapter: model must be set via options.model or invokeOpts.model");
		return model;
	};

	const keyParam = (): string => {
		const key = resolveApiKey(opts);
		if (!key) throw new Error("googleAdapter: apiKey required for invoke/stream");
		return `key=${encodeURIComponent(key)}`;
	};

	return {
		provider: "google",
		model: opts.model,
		// QA D3 (Phase 13.6.B): adapter threads `invokeOpts.signal` into
		// every fetch / SDK call, so `withBudgetGate`'s auto-abort lands
		// end-to-end.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const model = pickModel(invokeOpts);
			const body = toGeminiRequest(messages, invokeOpts);
			const start = monotonicNs();
			const url = `${baseURL}/models/${encodeURIComponent(model)}:generateContent?${keyParam()}`;
			const resp = await fetchImpl(url, {
				method: "POST",
				headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
				body: JSON.stringify(body),
				signal: invokeOpts?.signal,
			});
			if (!resp.ok) throw await makeHttpError(resp, "Google");
			const json = (await resp.json()) as GeminiResponse;
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			return toLLMResponse(json, latencyMs);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const model = pickModel(invokeOpts);
			const body = toGeminiRequest(messages, invokeOpts);
			const url = `${baseURL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&${keyParam()}`;
			const resp = await fetchImpl(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "text/event-stream",
					...(opts.headers ?? {}),
				},
				body: JSON.stringify(body),
				signal: invokeOpts?.signal,
			});
			if (!resp.ok) throw await makeHttpError(resp, "Google");
			if (!resp.body) throw new Error("googleAdapter: streaming response has no body");

			let finalUsage: GeminiUsage | undefined;
			let finishReason: string | undefined;

			for await (const event of parseSSEStream(resp.body, { signal: invokeOpts?.signal })) {
				if (!event.data) continue;
				let parsed: GeminiResponse;
				try {
					parsed = JSON.parse(event.data) as GeminiResponse;
				} catch {
					continue;
				}
				const cand = parsed.candidates?.[0];
				for (const p of cand?.content?.parts ?? []) {
					if (typeof p.text === "string") {
						if (p.thought) yield { type: "thinking", delta: p.text };
						else yield { type: "token", delta: p.text };
					}
					if (p.functionCall) {
						yield {
							type: "tool-call-delta",
							delta: {
								name: p.functionCall.name,
								argumentsDelta: JSON.stringify(p.functionCall.args ?? {}),
							},
						};
					}
				}
				if (cand?.finishReason) finishReason = cand.finishReason;
				if (parsed.usageMetadata) finalUsage = parsed.usageMetadata;
			}
			if (finalUsage) yield { type: "usage", usage: mapUsage(finalUsage) };
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}

function sdkBackedGoogle(opts: GoogleAdapterOptions): LLMAdapter {
	const sdk = opts.sdk;
	if (!sdk) throw new Error("sdkBackedGoogle: sdk instance required");

	return {
		provider: "google",
		model: opts.model,
		// QA D3 (Phase 13.6.B): adapter threads `invokeOpts.signal` into
		// every fetch / SDK call, so `withBudgetGate`'s auto-abort lands
		// end-to-end.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const body = toGeminiRequest(messages, invokeOpts);
			const model = invokeOpts?.model ?? opts.model;
			if (!model) throw new Error("googleAdapter: model required");
			const params = toSdkParams(body, model, invokeOpts?.signal);
			const start = monotonicNs();
			const resp = await sdk.models.generateContent(params);
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			return toLLMResponse(resp, latencyMs);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			if (!sdk.models.generateContentStream) {
				throw new Error("sdkBackedGoogle: SDK instance does not expose generateContentStream");
			}
			const body = toGeminiRequest(messages, invokeOpts);
			const model = invokeOpts?.model ?? opts.model;
			if (!model) throw new Error("googleAdapter: model required");
			const params = toSdkParams(body, model, invokeOpts?.signal);
			let finalUsage: GeminiUsage | undefined;
			let finishReason: string | undefined;
			// `@google/genai` returns `Promise<AsyncIterable<...>>`; older shapes
			// returned the iterable directly. Awaiting a non-thenable resolves
			// to itself, so this works for both.
			const stream = await sdk.models.generateContentStream(params);
			for await (const chunk of stream) {
				const cand = chunk.candidates?.[0];
				for (const p of cand?.content?.parts ?? []) {
					if (typeof p.text === "string") {
						if (p.thought) yield { type: "thinking", delta: p.text };
						else yield { type: "token", delta: p.text };
					}
					if (p.functionCall) {
						yield {
							type: "tool-call-delta",
							delta: {
								name: p.functionCall.name,
								argumentsDelta: JSON.stringify(p.functionCall.args ?? {}),
							},
						};
					}
				}
				if (cand?.finishReason) finishReason = cand.finishReason;
				if (chunk.usageMetadata) finalUsage = chunk.usageMetadata;
			}
			if (finalUsage) yield { type: "usage", usage: mapUsage(finalUsage) };
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}
