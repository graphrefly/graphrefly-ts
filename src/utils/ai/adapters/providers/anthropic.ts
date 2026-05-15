/**
 * AnthropicAdapter — default fetch-backed, optional SDK-backed.
 *
 * - `anthropicAdapter({ apiKey })` uses native `fetch` + SSE parsing.
 * - `anthropicAdapter({ sdk })` delegates to a user-provided `@anthropic-ai/sdk` instance.
 *
 * Token usage mapping:
 * - `input_tokens`                                → `input.regular`
 * - `cache_read_input_tokens`                     → `input.cacheRead`
 * - `cache_creation.ephemeral_5m_input_tokens`    → `input.cacheWrite5m`
 * - `cache_creation.ephemeral_1h_input_tokens`    → `input.cacheWrite1h`
 * - `cache_creation_input_tokens` (legacy)        → `input.cacheWrite5m` (default TTL)
 * - `output_tokens`                               → `output.regular`
 * - `server_tool_use.web_search_requests`         → `auxiliary.webSearchRequests`
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

export interface AnthropicAdapterOptions {
	/** API key. Falls back to `process.env.ANTHROPIC_API_KEY` on Node. */
	apiKey?: string;
	/** Default model (overridable per-call via `LLMInvokeOptions.model`). */
	model?: string;
	/** Override the base URL. Default `https://api.anthropic.com`. */
	baseURL?: string;
	/** API version header. Default `"2023-06-01"`. */
	anthropicVersion?: string;
	/** Additional headers to send on every request (overridden by per-call). */
	headers?: Record<string, string>;
	/**
	 * User-provided SDK instance. When present, the adapter delegates to it
	 * (uses `.messages.create`) instead of native fetch.
	 * Shape matches `@anthropic-ai/sdk` `.messages` API; any object with a
	 * compatible `create`/`stream` contract works.
	 */
	sdk?: AnthropicSdkLike;
	/** Custom fetch (useful for tests). Default `globalThis.fetch`. */
	fetchImpl?: typeof fetch;
}

/** Minimal SDK shape we interoperate with. */
export interface AnthropicSdkLike {
	messages: {
		create(
			params: Record<string, unknown>,
			opts?: { signal?: AbortSignal },
		): Promise<AnthropicMessageResponse>;
		stream?(
			params: Record<string, unknown>,
			opts?: { signal?: AbortSignal },
		): AsyncIterable<AnthropicStreamEvent>;
	};
}

interface AnthropicMessageResponse {
	id: string;
	content: ReadonlyArray<
		| { type: "text"; text: string }
		| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
		| { type: "thinking"; thinking: string }
		| { type: string; [key: string]: unknown }
	>;
	stop_reason?: string;
	usage: AnthropicUsage;
	model?: string;
}

interface AnthropicUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_creation?: {
		ephemeral_5m_input_tokens?: number;
		ephemeral_1h_input_tokens?: number;
	};
	server_tool_use?: {
		web_search_requests?: number;
	};
}

type AnthropicStreamEvent =
	| { type: "message_start"; message: { usage: AnthropicUsage } }
	| { type: "content_block_start"; index: number; content_block: Record<string, unknown> }
	| { type: "content_block_delta"; index: number; delta: Record<string, unknown> }
	| { type: "content_block_stop"; index: number }
	| { type: "message_delta"; delta: { stop_reason?: string; usage?: AnthropicUsage } }
	| { type: "message_stop" }
	| { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function anthropicAdapter(opts: AnthropicAdapterOptions = {}): LLMAdapter {
	if (opts.sdk) return sdkBackedAnthropic(opts);
	return fetchBackedAnthropic(opts);
}

// ---------------------------------------------------------------------------
// Request/response mapping
// ---------------------------------------------------------------------------

function toAnthropicRequest(
	messages: readonly ChatMessage[],
	invokeOpts: LLMInvokeOptions | undefined,
	defaultModel: string | undefined,
	stream: boolean,
): Record<string, unknown> {
	const model = invokeOpts?.model ?? defaultModel;
	if (!model)
		throw new Error("anthropicAdapter: model must be set via options.model or invokeOpts.model");

	const { system, chat } = partitionSystem(messages, invokeOpts?.systemPrompt);

	const body: Record<string, unknown> = {
		model,
		messages: chat.map(toAnthropicMessage),
		max_tokens: invokeOpts?.maxTokens ?? 4096,
	};
	if (system) body.system = system;
	if (invokeOpts?.temperature != null) body.temperature = invokeOpts.temperature;
	if (invokeOpts?.tools && invokeOpts.tools.length > 0)
		body.tools = invokeOpts.tools.map(toAnthropicTool);
	if (invokeOpts?.maxReasoningTokens != null) {
		body.thinking = { type: "enabled", budget_tokens: invokeOpts.maxReasoningTokens };
	}
	if (invokeOpts?.cacheHint) {
		// Cache-control injected per-message by the user (Anthropic cache is
		// block-level). We surface the hint via metadata, but the canonical
		// cacheHint API is informational — power users pass cache_control
		// directly on messages via providerExtras.
	}
	if (stream) body.stream = true;
	if (invokeOpts?.providerExtras) Object.assign(body, invokeOpts.providerExtras);
	return body;
}

function partitionSystem(
	messages: readonly ChatMessage[],
	systemPrompt: string | undefined,
): { system: string | undefined; chat: readonly ChatMessage[] } {
	const systemParts: string[] = [];
	if (systemPrompt) systemParts.push(systemPrompt);
	const chat: ChatMessage[] = [];
	for (const m of messages) {
		if (m.role === "system") systemParts.push(m.content);
		else chat.push(m);
	}
	return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, chat };
}

function toAnthropicMessage(m: ChatMessage): Record<string, unknown> {
	if (m.role === "tool") {
		return {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: m.toolCallId,
					content: m.content,
				},
			],
		};
	}
	if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
		const blocks: unknown[] = [];
		if (m.content) blocks.push({ type: "text", text: m.content });
		for (const tc of m.toolCalls) {
			blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
		}
		return { role: "assistant", content: blocks };
	}
	return { role: m.role, content: m.content };
}

function toAnthropicTool(t: ToolDefinition): Record<string, unknown> {
	return {
		name: t.name,
		description: t.description,
		input_schema: t.parameters,
	};
}

/**
 * Merge an incoming Anthropic usage update into the running snapshot. Unlike
 * a shallow spread, this preserves nested `cache_creation` fields when the
 * update omits them (or sends an empty object). Applied to both SSE and SDK
 * streaming paths.
 */
function mergeAnthropicUsage(
	prev: AnthropicUsage | undefined,
	next: AnthropicUsage,
): AnthropicUsage {
	if (!prev) return { ...next };
	const merged: AnthropicUsage = { ...prev };
	// Scalar fields: overwrite when present in `next`.
	if (next.input_tokens != null) merged.input_tokens = next.input_tokens;
	if (next.output_tokens != null) merged.output_tokens = next.output_tokens;
	if (next.cache_read_input_tokens != null)
		merged.cache_read_input_tokens = next.cache_read_input_tokens;
	if (next.cache_creation_input_tokens != null)
		merged.cache_creation_input_tokens = next.cache_creation_input_tokens;
	// Nested `cache_creation`: shallow-merge its own fields so a non-empty
	// update doesn't wipe a prior ephemeral_5m/1h value.
	if (next.cache_creation) {
		merged.cache_creation = {
			...(prev.cache_creation ?? {}),
			...next.cache_creation,
		};
	}
	if (next.server_tool_use) {
		merged.server_tool_use = {
			...(prev.server_tool_use ?? {}),
			...next.server_tool_use,
		};
	}
	return merged;
}

function mapUsage(u: AnthropicUsage | undefined): TokenUsage {
	const usage: TokenUsage = {
		input: { regular: u?.input_tokens ?? 0 },
		output: { regular: u?.output_tokens ?? 0 },
		raw: u,
	};
	if (u?.cache_read_input_tokens) usage.input.cacheRead = u.cache_read_input_tokens;
	if (u?.cache_creation) {
		if (u.cache_creation.ephemeral_5m_input_tokens)
			usage.input.cacheWrite5m = u.cache_creation.ephemeral_5m_input_tokens;
		if (u.cache_creation.ephemeral_1h_input_tokens)
			usage.input.cacheWrite1h = u.cache_creation.ephemeral_1h_input_tokens;
	} else if (u?.cache_creation_input_tokens) {
		// Legacy flat field — default to 5m TTL.
		usage.input.cacheWrite5m = u.cache_creation_input_tokens;
	}
	if (u?.server_tool_use?.web_search_requests) {
		usage.auxiliary = { webSearchRequests: u.server_tool_use.web_search_requests };
	}
	return usage;
}

function toLLMResponse(msg: AnthropicMessageResponse, latencyMs: number): LLMResponse {
	const textParts: string[] = [];
	const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
	for (const block of msg.content) {
		if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
			textParts.push((block as { text: string }).text);
		} else if (block.type === "tool_use") {
			const tb = block as { id: string; name: string; input: Record<string, unknown> };
			toolCalls.push({ id: tb.id, name: tb.name, arguments: tb.input ?? {} });
		}
	}
	return {
		content: textParts.join(""),
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		usage: mapUsage(msg.usage),
		finishReason: msg.stop_reason,
		latencyMs,
		model: msg.model,
		provider: "anthropic",
	};
}

// ---------------------------------------------------------------------------
// Fetch-backed impl
// ---------------------------------------------------------------------------

function fetchBackedAnthropic(opts: AnthropicAdapterOptions): LLMAdapter {
	const apiKey =
		opts.apiKey ??
		(globalThis as { process?: { env?: Record<string, string> } }).process?.env?.ANTHROPIC_API_KEY;
	if (!apiKey) {
		// Don't throw at construction — allow test harnesses / dry-run setups
		// that never call invoke. Throw at first use instead.
	}
	const baseURL = opts.baseURL ?? "https://api.anthropic.com";
	const anthropicVersion = opts.anthropicVersion ?? "2023-06-01";
	const fetchImpl = opts.fetchImpl ?? fetch;

	const commonHeaders = (): Record<string, string> => {
		if (!apiKey)
			throw new Error("anthropicAdapter: apiKey required for invoke/stream (or provide opts.sdk)");
		return {
			"x-api-key": apiKey,
			"anthropic-version": anthropicVersion,
			"content-type": "application/json",
			...(opts.headers ?? {}),
		};
	};

	return {
		provider: "anthropic",
		model: opts.model,
		// QA D3 (Phase 13.6.B): adapter threads `invokeOpts.signal` into
		// every fetch / SDK call, so `withBudgetGate`'s auto-abort lands
		// end-to-end. Suppresses the wire-time warning.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const body = toAnthropicRequest(messages, invokeOpts, opts.model, false);
			const start = monotonicNs();
			const resp = await fetchImpl(`${baseURL}/v1/messages`, {
				method: "POST",
				headers: commonHeaders(),
				body: JSON.stringify(body),
				signal: invokeOpts?.signal,
			});
			if (!resp.ok) throw await makeHttpError(resp, "Anthropic");
			const json = (await resp.json()) as AnthropicMessageResponse;
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			return toLLMResponse(json, latencyMs);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const body = toAnthropicRequest(messages, invokeOpts, opts.model, true);
			const resp = await fetchImpl(`${baseURL}/v1/messages`, {
				method: "POST",
				headers: { ...commonHeaders(), accept: "text/event-stream" },
				body: JSON.stringify(body),
				signal: invokeOpts?.signal,
			});
			if (!resp.ok) throw await makeHttpError(resp, "Anthropic");
			if (!resp.body) throw new Error("anthropicAdapter: streaming response has no body");

			let finalUsage: AnthropicUsage | undefined;
			let finishReason: string | undefined;
			const toolCallsByIndex: Map<number, { id: string; name: string; argBuf: string }> = new Map();

			for await (const event of parseSSEStream(resp.body, { signal: invokeOpts?.signal })) {
				const data = event.data;
				if (!data) continue;
				let parsed: AnthropicStreamEvent;
				try {
					parsed = JSON.parse(data) as AnthropicStreamEvent;
				} catch {
					continue;
				}
				switch (parsed.type) {
					case "message_start": {
						const ms = parsed as { message: { usage: AnthropicUsage } };
						finalUsage = mergeAnthropicUsage(finalUsage, ms.message.usage);
						break;
					}
					case "content_block_start": {
						const cb = parsed as { index: number; content_block: Record<string, unknown> };
						const b = cb.content_block;
						if (b.type === "tool_use") {
							toolCallsByIndex.set(cb.index, {
								id: String(b.id ?? ""),
								name: String(b.name ?? ""),
								argBuf: "",
							});
							yield {
								type: "tool-call-delta",
								delta: { id: String(b.id ?? ""), name: String(b.name ?? "") },
							};
						}
						break;
					}
					case "content_block_delta": {
						const cbd = parsed as { index: number; delta: Record<string, unknown> };
						const d = cbd.delta;
						if (d.type === "text_delta" && typeof d.text === "string") {
							yield { type: "token", delta: d.text };
						} else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
							const existing = toolCallsByIndex.get(cbd.index);
							if (existing) existing.argBuf += d.partial_json;
							yield {
								type: "tool-call-delta",
								delta: { argumentsDelta: d.partial_json },
							};
						} else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
							yield { type: "thinking", delta: d.thinking };
						}
						break;
					}
					case "message_delta": {
						const md = parsed as { delta: { stop_reason?: string; usage?: AnthropicUsage } };
						if (md.delta.stop_reason) finishReason = md.delta.stop_reason;
						if (md.delta.usage) {
							finalUsage = mergeAnthropicUsage(finalUsage, md.delta.usage);
						}
						break;
					}
					case "message_stop":
						// Fall through to finalize after the loop.
						break;
				}
			}
			if (finalUsage) yield { type: "usage", usage: mapUsage(finalUsage) };
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}

// ---------------------------------------------------------------------------
// SDK-backed impl
// ---------------------------------------------------------------------------

function sdkBackedAnthropic(opts: AnthropicAdapterOptions): LLMAdapter {
	const sdk = opts.sdk;
	if (!sdk) throw new Error("sdkBackedAnthropic: sdk instance required");
	return {
		provider: "anthropic",
		model: opts.model,
		// QA D3 (Phase 13.6.B): adapter threads `invokeOpts.signal` into
		// every fetch / SDK call, so `withBudgetGate`'s auto-abort lands
		// end-to-end. Suppresses the wire-time warning.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const body = toAnthropicRequest(messages, invokeOpts, opts.model, false);
			const start = monotonicNs();
			const resp = (await sdk.messages.create(body, {
				signal: invokeOpts?.signal,
			})) as AnthropicMessageResponse;
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			return toLLMResponse(resp, latencyMs);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			if (!sdk.messages.stream) {
				throw new Error("sdkBackedAnthropic: SDK instance does not expose .messages.stream");
			}
			const body = toAnthropicRequest(messages, invokeOpts, opts.model, true);
			let finalUsage: AnthropicUsage | undefined;
			let finishReason: string | undefined;
			for await (const event of sdk.messages.stream(body, { signal: invokeOpts?.signal })) {
				switch (event.type) {
					case "message_start":
						finalUsage = mergeAnthropicUsage(
							finalUsage,
							(event as { message: { usage: AnthropicUsage } }).message.usage,
						);
						break;
					case "content_block_delta": {
						const d = (event as { delta: Record<string, unknown> }).delta;
						if (d?.type === "text_delta" && typeof d.text === "string") {
							yield { type: "token", delta: d.text };
						} else if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
							yield { type: "tool-call-delta", delta: { argumentsDelta: d.partial_json } };
						} else if (d?.type === "thinking_delta" && typeof d.thinking === "string") {
							yield { type: "thinking", delta: d.thinking };
						}
						break;
					}
					case "message_delta": {
						const md = event as { delta: { stop_reason?: string; usage?: AnthropicUsage } };
						if (md.delta.stop_reason) finishReason = md.delta.stop_reason;
						if (md.delta.usage) finalUsage = mergeAnthropicUsage(finalUsage, md.delta.usage);
						break;
					}
				}
			}
			if (finalUsage) yield { type: "usage", usage: mapUsage(finalUsage) };
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}

// ---------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------
