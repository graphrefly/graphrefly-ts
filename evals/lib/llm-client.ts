/**
 * Multi-provider LLM client (roadmap §9.1).
 *
 * Provider-agnostic adapter: Anthropic, OpenAI, Google, Local (Ollama).
 * Switch providers/models by config or env var, not code change.
 *
 * SDKs are dynamically imported — only the one you're using needs to be installed.
 *   - Anthropic: `@anthropic-ai/sdk`
 *   - OpenAI:    `openai`
 *   - Google:    `@google/generative-ai`
 *   - Local:     uses `openai` SDK with custom baseURL (Ollama-compatible)
 */

import type { EvalConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface LLMRequest {
	system: string;
	user: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface LLMResponse {
	content: string;
	inputTokens: number;
	outputTokens: number;
	latencyMs: number;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
	readonly name: string;
	generate(req: LLMRequest): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
	readonly name = "anthropic";
	private config: EvalConfig;

	constructor(config: EvalConfig) {
		this.config = config;
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { default: Anthropic } = await import("@anthropic-ai/sdk");
		const client = new Anthropic();

		const model = req.model ?? this.config.model;
		const start = performance.now();

		const response = await client.messages.create({
			model,
			max_tokens: req.maxTokens ?? 4096,
			temperature: req.temperature ?? this.config.temperature,
			system: req.system,
			messages: [{ role: "user", content: req.user }],
		});

		const latencyMs = performance.now() - start;
		const content = response.content[0]?.type === "text" ? response.content[0].text : "";

		return {
			content,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
			latencyMs,
		};
	}
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider {
	readonly name = "openai";
	private config: EvalConfig;

	constructor(config: EvalConfig) {
		this.config = config;
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { default: OpenAI } = await import("openai");
		const client = new OpenAI();

		const model = req.model ?? this.config.model;
		const start = performance.now();

		const response = await client.chat.completions.create({
			model,
			max_tokens: req.maxTokens ?? 4096,
			temperature: req.temperature ?? this.config.temperature,
			messages: [
				{ role: "system", content: req.system },
				{ role: "user", content: req.user },
			],
		});

		const latencyMs = performance.now() - start;
		const content = response.choices[0]?.message?.content ?? "";

		return {
			content,
			inputTokens: response.usage?.prompt_tokens ?? 0,
			outputTokens: response.usage?.completion_tokens ?? 0,
			latencyMs,
		};
	}
}

// ---------------------------------------------------------------------------
// Google (Gemini)
// ---------------------------------------------------------------------------

export class GoogleProvider implements LLMProvider {
	readonly name = "google";
	private config: EvalConfig;

	constructor(config: EvalConfig) {
		this.config = config;
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { GoogleGenAI } = await import("@google/genai");
		const apiKey = process.env.GOOGLE_API_KEY;
		if (!apiKey) throw new Error("GOOGLE_API_KEY env var required for Google provider");
		const client = new GoogleGenAI({ apiKey });

		const model = req.model ?? this.config.model;
		const start = performance.now();

		const response = await client.models.generateContent({
			model,
			config: {
				maxOutputTokens: req.maxTokens ?? 4096,
				temperature: req.temperature ?? this.config.temperature,
				systemInstruction: req.system,
			},
			contents: req.user,
		});

		const latencyMs = performance.now() - start;
		const content = response.text ?? "";

		return {
			content,
			inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
			outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			latencyMs,
		};
	}
}

// ---------------------------------------------------------------------------
// Local (Ollama — OpenAI-compatible API)
// ---------------------------------------------------------------------------

export class LocalProvider implements LLMProvider {
	readonly name = "local";
	private config: EvalConfig;
	private baseURL: string;

	constructor(config: EvalConfig) {
		this.config = config;
		this.baseURL = process.env.EVAL_LOCAL_BASE_URL ?? "http://localhost:11434/v1";
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { default: OpenAI } = await import("openai");
		const client = new OpenAI({
			baseURL: this.baseURL,
			apiKey: "ollama", // Ollama doesn't need a real key
		});

		const model = req.model ?? this.config.model;
		const start = performance.now();

		const response = await client.chat.completions.create({
			model,
			max_tokens: req.maxTokens ?? 4096,
			temperature: req.temperature ?? this.config.temperature,
			messages: [
				{ role: "system", content: req.system },
				{ role: "user", content: req.user },
			],
		});

		const latencyMs = performance.now() - start;
		const content = response.choices[0]?.message?.content ?? "";

		return {
			content,
			inputTokens: response.usage?.prompt_tokens ?? 0,
			outputTokens: response.usage?.completion_tokens ?? 0,
			latencyMs,
		};
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ProviderName = "anthropic" | "openai" | "google" | "local";

export function createProvider(config: EvalConfig): LLMProvider {
	const name = config.provider;
	switch (name) {
		case "anthropic":
			return new AnthropicProvider(config);
		case "openai":
			return new OpenAIProvider(config);
		case "google":
			return new GoogleProvider(config);
		case "local":
			return new LocalProvider(config);
		default:
			throw new Error(`Unknown provider "${name}". Valid: anthropic, openai, google, local`);
	}
}

// ---------------------------------------------------------------------------
// Convenience wrapper (backward-compatible)
// ---------------------------------------------------------------------------

/** Provider instances cached per config identity. */
let _cachedProvider: LLMProvider | undefined;
let _cachedProviderName: string | undefined;

export async function callLLM(req: LLMRequest, config: EvalConfig): Promise<LLMResponse> {
	if (!_cachedProvider || _cachedProviderName !== config.provider) {
		_cachedProvider = createProvider(config);
		_cachedProviderName = config.provider;
	}
	return _cachedProvider.generate(req);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract JSON from an LLM response that may contain markdown fences.
 */
export function extractJSON(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) return fenced[1].trim();
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) return jsonMatch[0];
	return text.trim();
}
