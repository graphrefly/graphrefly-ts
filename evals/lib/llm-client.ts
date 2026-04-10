/**
 * Multi-provider LLM client (roadmap §9.1).
 *
 * Provider-agnostic adapter: Anthropic, Google, and OpenAI-compatible providers.
 * Switch providers/models by config or env var, not code change.
 *
 * SDKs are dynamically imported — only the one you're using needs to be installed.
 *   - Anthropic: `@anthropic-ai/sdk`
 *   - OpenAI-compatible: `openai`
 *   - Google:    `@google/generative-ai`
 *   - Presets: OpenAI, Ollama, OpenRouter, Groq
 */

import type { EvalConfig, ProviderName } from "./types.js";

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
// OpenAI-compatible providers (OpenAI, Ollama, OpenRouter, Groq)
// ---------------------------------------------------------------------------

interface OpenAICompatiblePreset {
	name: ProviderName;
	baseURL?: string;
	apiKey?: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
	readonly name: ProviderName;
	private config: EvalConfig;
	private preset: OpenAICompatiblePreset;

	constructor(config: EvalConfig, preset: OpenAICompatiblePreset) {
		this.config = config;
		this.preset = preset;
		this.name = preset.name;
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { default: OpenAI } = await import("openai");
		const client = new OpenAI({
			baseURL: this.preset.baseURL,
			apiKey: this.preset.apiKey,
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

function resolveOpenAICompatiblePreset(config: EvalConfig): OpenAICompatiblePreset {
	switch (config.provider) {
		case "openai":
			return {
				name: "openai",
			};
		case "ollama":
			return {
				name: "ollama",
				baseURL:
					process.env.EVAL_OLLAMA_BASE_URL ??
					process.env.EVAL_LOCAL_BASE_URL ??
					"http://localhost:11434/v1",
				apiKey: process.env.EVAL_OLLAMA_API_KEY ?? process.env.EVAL_LOCAL_API_KEY ?? "ollama",
			};
		case "openrouter": {
			const apiKey = process.env.OPENROUTER_API_KEY;
			if (!apiKey) throw new Error("OPENROUTER_API_KEY env var required for OpenRouter provider");
			return {
				name: "openrouter",
				baseURL: process.env.EVAL_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
				apiKey,
			};
		}
		case "groq": {
			const apiKey = process.env.GROQ_API_KEY;
			if (!apiKey) throw new Error("GROQ_API_KEY env var required for Groq provider");
			return {
				name: "groq",
				baseURL: process.env.EVAL_GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
				apiKey,
			};
		}
		default:
			throw new Error(
				`Provider "${config.provider}" is not OpenAI-compatible. Expected one of: openai, ollama, openrouter, groq`,
			);
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
// Factory
// ---------------------------------------------------------------------------

// re-export for backward compat
export type { ProviderName } from "./types.js";

export function createProvider(config: EvalConfig): LLMProvider {
	const name = config.provider;
	switch (name) {
		case "anthropic":
			return new AnthropicProvider(config);
		case "openai":
		case "ollama":
		case "openrouter":
		case "groq":
			return new OpenAICompatibleProvider(config, resolveOpenAICompatiblePreset(config));
		case "google":
			return new GoogleProvider(config);
		default:
			throw new Error(
				`Unknown provider "${name}". Valid: anthropic, openai, google, ollama, openrouter, groq`,
			);
	}
}

// ---------------------------------------------------------------------------
// Convenience wrapper (backward-compatible)
// ---------------------------------------------------------------------------

/** Provider instances cached by provider name. */
const _providerCache = new Map<string, LLMProvider>();

function getProvider(config: EvalConfig, providerName?: ProviderName): LLMProvider {
	const name = providerName ?? config.provider;
	let provider = _providerCache.get(name);
	if (!provider) {
		const overrideConfig = name === config.provider ? config : { ...config, provider: name };
		provider = createProvider(overrideConfig);
		_providerCache.set(name, provider);
	}
	return provider;
}

export async function callLLM(
	req: LLMRequest,
	config: EvalConfig,
	providerOverride?: ProviderName,
): Promise<LLMResponse> {
	return getProvider(config, providerOverride).generate(req);
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
