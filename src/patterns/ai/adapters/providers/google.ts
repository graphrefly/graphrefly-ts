/**
 * GoogleAdapter — default fetch-backed, optional SDK-backed.
 *
 * Maps Gemini `usageMetadata`:
 * - `promptTokenCount` minus `cachedContentTokenCount` → `input.regular`
 * - `cachedContentTokenCount`                          → `input.cacheRead`
 * - `candidatesTokenCount`                             → `output.regular`
 * - `thoughtsTokenCount`                               → `output.reasoning`
 * - `toolUsePromptTokenCount`                          → `input.toolUse`
 * - `promptTokensDetails[]`                            → `input.{image,audio,video}` per modality
 */

import { monotonicNs } from "../../../../core/clock.js";
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
	/** Optional SDK instance (`@google/genai` or `@google/generative-ai` shape). */
	sdk?: GoogleSdkLike;
	fetchImpl?: typeof fetch;
}

export interface GoogleSdkLike {
	models: {
		generateContent(
			params: Record<string, unknown>,
			opts?: { signal?: AbortSignal },
		): Promise<GeminiResponse>;
		generateContentStream?(
			params: Record<string, unknown>,
			opts?: { signal?: AbortSignal },
		): AsyncIterable<GeminiResponse>;
	};
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
			if (!resp.ok) throw await makeHttpError(resp);
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
			if (!resp.ok) throw await makeHttpError(resp);
			if (!resp.body) throw new Error("googleAdapter: streaming response has no body");

			let finalUsage: GeminiUsage | undefined;
			let finishReason: string | undefined;

			for await (const event of parseSSE(resp.body)) {
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

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const body = toGeminiRequest(messages, invokeOpts);
			const model = invokeOpts?.model ?? opts.model;
			if (!model) throw new Error("googleAdapter: model required");
			const start = monotonicNs();
			const resp = await sdk.models.generateContent(
				{ ...body, model },
				{ signal: invokeOpts?.signal },
			);
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
			let finalUsage: GeminiUsage | undefined;
			let finishReason: string | undefined;
			for await (const chunk of sdk.models.generateContentStream(
				{ ...body, model },
				{ signal: invokeOpts?.signal },
			)) {
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

// Shared SSE parsing (same impl as other providers; small enough to duplicate)
interface SSEEvent {
	event?: string;
	data?: string;
	id?: string;
}

async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buf.length > 0) yield parseSSEBlock(buf);
				return;
			}
			buf += decoder.decode(value, { stream: true });
			let next = findSSEBoundary(buf);
			while (next !== null) {
				const block = buf.slice(0, next.index);
				buf = buf.slice(next.index + next.length);
				const ev = parseSSEBlock(block);
				if (ev.data || ev.event) yield ev;
				next = findSSEBoundary(buf);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSSEBlock(block: string): SSEEvent {
	const ev: SSEEvent = {};
	const dataLines: string[] = [];
	// Strip trailing CR from each line per W3C SSE spec (handles CRLF streams).
	for (const rawLine of block.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (!line || line.startsWith(":")) continue;
		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
		if (field === "data") dataLines.push(value);
		else if (field === "event") ev.event = value;
		else if (field === "id") ev.id = value;
	}
	if (dataLines.length > 0) ev.data = dataLines.join("\n");
	return ev;
}

function findSSEBoundary(buf: string): { index: number; length: number } | null {
	const idxCrLf = buf.indexOf("\r\n\r\n");
	const idxLf = buf.indexOf("\n\n");
	let best: { index: number; length: number } | null = null;
	if (idxCrLf !== -1) best = { index: idxCrLf, length: 4 };
	if (idxLf !== -1 && (best === null || idxLf < best.index)) {
		best = { index: idxLf, length: 2 };
	}
	return best;
}

async function makeHttpError(resp: Response): Promise<Error> {
	let body: string;
	try {
		body = await resp.text();
	} catch {
		body = "";
	}
	const err = new Error(
		`Google API ${resp.status}: ${resp.statusText}${body ? ` — ${body}` : ""}`,
	) as Error & {
		status: number;
		headers: Headers;
	};
	err.status = resp.status;
	err.headers = resp.headers;
	return err;
}
