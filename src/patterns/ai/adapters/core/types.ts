/**
 * Core types for LLM adapters (roadmap §9.3d).
 *
 * The library defines the shape of:
 *   - Token usage (raw, disaggregated; user decides how to combine)
 *   - Responses and streaming deltas
 *   - The `LLMAdapter` protocol (reactive-friendly via `NodeInput`)
 *   - Chat, tool, and invocation option shapes
 *
 * It ships **zero model data**. Pricing and capability registries are
 * user-populated (see `pricing.ts` and `capabilities.ts`).
 */

import type { Node } from "../../../../core/node.js";
import type { NodeInput } from "../../../../extra/sources.js";

// ---------------------------------------------------------------------------
// Token usage — raw, disaggregated, extensible
// ---------------------------------------------------------------------------

/**
 * Input token classes.
 *
 * Every provider's native usage object maps into this shape without loss.
 * All fields except `regular` are optional — providers that don't expose
 * the class simply leave it undefined.
 */
export interface InputTokens {
	/** Uncached regular input tokens (cache miss or never-cached). */
	regular: number;
	/** Read from prompt cache (all TTLs — providers don't split reads by TTL today). */
	cacheRead?: number;
	/** Written to cache with 5-min TTL (Anthropic `ephemeral_5m_input_tokens`). */
	cacheWrite5m?: number;
	/** Written to cache with 1-hour TTL (Anthropic `ephemeral_1h_input_tokens`). */
	cacheWrite1h?: number;
	/** Written to cache with other/unspecified TTL (Gemini explicit caches). */
	cacheWriteOther?: number;
	/** Audio input tokens (OpenAI realtime, Gemini audio). */
	audio?: number;
	/** Image input tokens (Gemini per-modality). */
	image?: number;
	/** Video input tokens (Gemini per-modality). */
	video?: number;
	/** Tool-use result tokens fed back to the model (Gemini `toolUsePromptTokenCount`). */
	toolUse?: number;
	/** Provider-specific classes not covered above. Open-ended by design. */
	extensions?: Record<string, number>;
}

/** Output token classes. */
export interface OutputTokens {
	/** Regular generated output (non-reasoning, non-audio). */
	regular: number;
	/** Reasoning / thinking tokens (OpenAI o-series, Gemini thoughts, Grok reasoning). */
	reasoning?: number;
	/** Audio output tokens. */
	audio?: number;
	/** Predicted-output tokens accepted (OpenAI predictions API). */
	predictionAccepted?: number;
	/** Predicted-output tokens rejected (still billed at output rate). */
	predictionRejected?: number;
	extensions?: Record<string, number>;
}

/** Per-call token usage in canonical shape. No pricing, no interpretation. */
export interface TokenUsage {
	input: InputTokens;
	output: OutputTokens;
	/**
	 * Per-call non-token costs (web-search requests, tool invocations, cache
	 * storage-hours, etc.). Units are domain-specific — pricing functions
	 * interpret them via `ModelPricing.auxiliary`.
	 */
	auxiliary?: Record<string, number>;
	/**
	 * Raw provider usage object, unmodified. Escape hatch for anything the
	 * canonical shape doesn't model.
	 */
	raw?: unknown;
}

/** Sum of every input-token class. Helper for pricing + budget gating. */
export function sumInputTokens(u: TokenUsage): number {
	const i = u.input;
	const base =
		i.regular +
		(i.cacheRead ?? 0) +
		(i.cacheWrite5m ?? 0) +
		(i.cacheWrite1h ?? 0) +
		(i.cacheWriteOther ?? 0) +
		(i.audio ?? 0) +
		(i.image ?? 0) +
		(i.video ?? 0) +
		(i.toolUse ?? 0);
	if (!i.extensions) return base;
	let ext = 0;
	for (const v of Object.values(i.extensions)) ext += v;
	return base + ext;
}

/** Sum of every output-token class. */
export function sumOutputTokens(u: TokenUsage): number {
	const o = u.output;
	const base =
		o.regular +
		(o.reasoning ?? 0) +
		(o.audio ?? 0) +
		(o.predictionAccepted ?? 0) +
		(o.predictionRejected ?? 0);
	if (!o.extensions) return base;
	let ext = 0;
	for (const v of Object.values(o.extensions)) ext += v;
	return base + ext;
}

/** Empty `TokenUsage` — useful as a default / starting point. */
export function emptyUsage(): TokenUsage {
	return { input: { regular: 0 }, output: { regular: 0 } };
}

// ---------------------------------------------------------------------------
// Chat message / tool types (single source of truth for the AI layer)
// ---------------------------------------------------------------------------

/** A single chat message in a conversation. */
export type ChatMessage = {
	readonly role: "system" | "user" | "assistant" | "tool";
	readonly content: string;
	readonly name?: string;
	readonly toolCallId?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly metadata?: Record<string, unknown>;
};

/** A tool invocation request from an LLM. */
export type ToolCall = {
	readonly id: string;
	readonly name: string;
	readonly arguments: Record<string, unknown>;
};

/** A tool definition for LLM consumption. */
export type ToolDefinition = {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>; // JSON Schema
	readonly handler: (args: Record<string, unknown>) => NodeInput<unknown>;
	/**
	 * V0 version of the backing node at tool-definition-creation time.
	 * Snapshot — re-create the tool definition to refresh.
	 */
	readonly version?: { id: string; version: number };
};

// ---------------------------------------------------------------------------
// Response / streaming
// ---------------------------------------------------------------------------

/** The response from an LLM invocation. */
export interface LLMResponse {
	readonly content: string;
	readonly toolCalls?: readonly ToolCall[];
	/**
	 * Token usage. Optional — provider adapters should always populate it, but
	 * test mocks and adapter middlewares that synthesize responses can omit it.
	 * Downstream consumers that compute cost should default to {@link emptyUsage}.
	 */
	readonly usage?: TokenUsage;
	readonly finishReason?: string;
	readonly latencyMs?: number;
	readonly model?: string;
	readonly provider?: string;
	/** Service tier the call was served with (standard / batch / flex / priority). */
	readonly tier?: string;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Adapter-facing incremental stream event.
 *
 * Provider adapters emit these; higher-level surfaces (`streamingPromptNode`,
 * `agentLoop`) assemble them into consumer-facing `StreamChunk` with their own
 * `source`/`accumulated`/`index` context.
 *
 * **Shape rationale — why object tagged-union vs. the framework `[TYPE, data]`
 * tuple?** `StreamDelta` is an *application-layer event payload* that flows
 * inside a single framework `DATA` message, one abstraction level above the
 * reactive protocol. The framework's `[Type, Data?]` tuple (DIRTY / DATA /
 * RESOLVED / COMPLETE / ERROR) is the protocol message form delivered through
 * `subscribe`. Using the protocol form here would force us to invent new
 * framework-level symbols (`TOKEN`, `USAGE`, etc.) that leak into user code,
 * and TypeScript discriminated-union exhaustiveness works much better with
 * objects than tuples. Object-tagged unions match the idiomatic JS/TS
 * convention for discriminated events (Redux actions, DOM events).
 */
export type StreamDelta =
	| { readonly type: "token"; readonly delta: string }
	| {
			readonly type: "tool-call-delta";
			readonly delta: {
				readonly id?: string;
				readonly name?: string;
				readonly argumentsDelta?: string;
			};
	  }
	| { readonly type: "thinking"; readonly delta: string }
	| { readonly type: "usage"; readonly usage: TokenUsage }
	| { readonly type: "finish"; readonly reason: string };

// ---------------------------------------------------------------------------
// Invocation options
// ---------------------------------------------------------------------------

/** Options passed to `invoke()` / `stream()`. */
export interface LLMInvokeOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Budget for reasoning/thinking tokens, if the model supports it. */
	maxReasoningTokens?: number;
	tools?: readonly ToolDefinition[];
	systemPrompt?: string;
	/** Hint the adapter to cache the prompt. TTL values depend on provider. */
	cacheHint?: { ttl?: "5m" | "1h" | string; minTokens?: number };
	/** Service tier: "standard" | "batch" | "flex" | "priority" | provider-custom. */
	tier?: string;
	signal?: AbortSignal;
	/**
	 * Provider-specific passthrough — merged into the native request body.
	 * Escape hatch for features not yet in the canonical options.
	 */
	providerExtras?: Record<string, unknown>;
	/**
	 * Open-ended per-call context threaded to cache / fallback key functions.
	 * Callers who want to shard caches by tenant, session, feature flag, or
	 * any other dimension populate this and supply a custom `keyFn` that
	 * incorporates it. Not sent to providers — stripped from canonical key
	 * hashing when no custom `keyFn` is supplied. Type is `unknown` to avoid
	 * prescribing a shape; callers pick their own.
	 */
	keyContext?: unknown;
}

// ---------------------------------------------------------------------------
// LLMAdapter protocol
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic LLM adapter (spec §5.10 compliant).
 *
 * - `invoke()` returns a `NodeInput<LLMResponse>` — the caller bridges to
 *   reactive via `fromAny(...)`. Adapter implementations may return a
 *   Promise (simplest), a Node (reactive), or a plain value (testing).
 * - `stream()` returns `AsyncIterable<StreamDelta>` — the terminal delta of
 *   type `"usage"` carries the final `TokenUsage` for the streamed call.
 */
export interface LLMAdapter {
	readonly provider: string;
	readonly model?: string;
	invoke(messages: readonly ChatMessage[], opts?: LLMInvokeOptions): NodeInput<LLMResponse>;
	stream(messages: readonly ChatMessage[], opts?: LLMInvokeOptions): AsyncIterable<StreamDelta>;
	/** Optional capability lookup; typically delegates to a `CapabilitiesRegistry`. */
	capabilities?(model?: string): import("./capabilities.js").ModelCapabilities | undefined;
}

/** Discriminator for downstream type guards. */
export function isLLMAdapter(x: unknown): x is LLMAdapter {
	if (x == null || typeof x !== "object") return false;
	const a = x as Partial<LLMAdapter>;
	return (
		typeof a.provider === "string" &&
		typeof a.invoke === "function" &&
		typeof a.stream === "function"
	);
}

// ---------------------------------------------------------------------------
// Public re-export surface
// ---------------------------------------------------------------------------

export type { Node, NodeInput };
