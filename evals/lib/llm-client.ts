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

import { type BudgetGateOptions, withBudgetGate } from "./budget-gate.js";
import { createDryRunProvider } from "./dry-run-provider.js";
import type { ResolvedLimits } from "./limits.js";
import { resolveLimits } from "./limits.js";
import { AdaptiveRateLimiter } from "./rate-limiter.js";
import { type ReplayMode, withReplayCache } from "./replay-cache.js";
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
	readonly limits: ResolvedLimits;
	generate(req: LLMRequest): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
	readonly name = "anthropic";
	readonly limits: ResolvedLimits;
	private config: EvalConfig;

	constructor(config: EvalConfig) {
		this.config = config;
		this.limits = resolveLimits("anthropic", config.model);
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { default: Anthropic } = await import("@anthropic-ai/sdk");
		const client = new Anthropic();

		const model = req.model ?? this.config.model;
		const maxTokens = req.maxTokens ?? this.limits.maxOutputTokens;
		const start = performance.now();

		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
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
	readonly limits: ResolvedLimits;
	private config: EvalConfig;
	private preset: OpenAICompatiblePreset;

	constructor(config: EvalConfig, preset: OpenAICompatiblePreset) {
		this.config = config;
		this.preset = preset;
		this.name = preset.name;
		this.limits = resolveLimits(preset.name, config.model);
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { default: OpenAI } = await import("openai");
		const client = new OpenAI({
			baseURL: this.preset.baseURL,
			apiKey: this.preset.apiKey,
		});

		const model = req.model ?? this.config.model;
		const maxTokens = req.maxTokens ?? this.limits.maxOutputTokens;
		const start = performance.now();

		const response = await client.chat.completions.create({
			model,
			max_tokens: maxTokens,
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
	readonly limits: ResolvedLimits;
	private config: EvalConfig;

	constructor(config: EvalConfig) {
		this.config = config;
		this.limits = resolveLimits("google", config.model);
	}

	async generate(req: LLMRequest): Promise<LLMResponse> {
		const { GoogleGenAI } = await import("@google/genai");
		const apiKey = process.env.GOOGLE_API_KEY;
		if (!apiKey) throw new Error("GOOGLE_API_KEY env var required for Google provider");
		const client = new GoogleGenAI({ apiKey });

		const model = req.model ?? this.config.model;
		const maxTokens = req.maxTokens ?? this.limits.maxOutputTokens;
		const start = performance.now();

		const response = await client.models.generateContent({
			model,
			config: {
				maxOutputTokens: maxTokens,
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
// Cost-safe provider stack (replay cache + budget gate + dry-run toggle)
// ---------------------------------------------------------------------------

/**
 * Build a cost-safe provider stack controlled by env vars:
 *
 * - `EVAL_MODE=dry-run` — swaps in `createDryRunProvider`; zero tokens.
 * - `EVAL_MAX_CALLS` (default 100) — hard ceiling on call count.
 * - `EVAL_MAX_PRICE_USD` (default 2) — hard USD ceiling.
 * - `EVAL_MAX_INPUT_TOKENS` / `EVAL_MAX_OUTPUT_TOKENS` — optional token caps.
 * - `EVAL_REPLAY` (default `read-write`) — replay-cache mode.
 *
 * **Wrapping order is load-bearing**: cache OUTSIDE budget so cache hits
 * short-circuit before any spend is charged. Flip the order and reruns
 * stop being free.
 *
 * See `archive/docs/SESSION-rigor-infrastructure-plan.md`
 * § "LLM EVAL COST SAFETY" for the full rationale.
 */
export function createSafeProvider(
	config: EvalConfig,
	opts: {
		readonly cacheDir?: string;
		readonly budgetOverride?: Partial<BudgetGateOptions["caps"]>;
	} = {},
): LLMProvider {
	const mode = process.env.EVAL_MODE ?? "real";
	const base =
		mode === "dry-run"
			? createDryRunProvider({
					onCall: (req, n) =>
						console.error(`[dry-run #${n}] ${req.user.slice(0, 80).replace(/\n/g, " ")}`),
				})
			: createProvider(config);

	const gated = withBudgetGate(base, {
		caps: {
			maxCalls: opts.budgetOverride?.maxCalls ?? Number(process.env.EVAL_MAX_CALLS ?? 100),
			maxPriceUsd: opts.budgetOverride?.maxPriceUsd ?? Number(process.env.EVAL_MAX_PRICE_USD ?? 2),
			maxInputTokens:
				opts.budgetOverride?.maxInputTokens ??
				(process.env.EVAL_MAX_INPUT_TOKENS ? Number(process.env.EVAL_MAX_INPUT_TOKENS) : undefined),
			maxOutputTokens:
				opts.budgetOverride?.maxOutputTokens ??
				(process.env.EVAL_MAX_OUTPUT_TOKENS
					? Number(process.env.EVAL_MAX_OUTPUT_TOKENS)
					: undefined),
		},
		onUpdate: (s) =>
			process.stderr.write(`\r[budget] ${s.calls} calls | $${s.priceUsd.toFixed(4)}    `),
		onExceed: (err) => console.error(`\n❌ ${err.message}`),
	});

	const cached = withReplayCache(gated, {
		cacheDir: opts.cacheDir ?? "evals/results/replay-cache",
		mode: (process.env.EVAL_REPLAY as ReplayMode) ?? "read-write",
	});

	return cached;
}

// ---------------------------------------------------------------------------
// Convenience wrapper (backward-compatible)
// ---------------------------------------------------------------------------

/** Provider + rate limiter instances cached by provider name. */
const _providerCache = new Map<string, { provider: LLMProvider; limiter: AdaptiveRateLimiter }>();

function getProviderWithLimiter(
	config: EvalConfig,
	providerName?: ProviderName,
): { provider: LLMProvider; limiter: AdaptiveRateLimiter } {
	const name = providerName ?? config.provider;
	let entry = _providerCache.get(name);
	if (!entry) {
		const overrideConfig = name === config.provider ? config : { ...config, provider: name };
		const provider = createProvider(overrideConfig);
		const limiter = new AdaptiveRateLimiter(provider.limits);
		entry = { provider, limiter };
		_providerCache.set(name, entry);
	}
	return entry;
}

/** Get resolved limits for the configured provider/model. */
export function getProviderLimits(config: EvalConfig, providerName?: ProviderName): ResolvedLimits {
	return getProviderWithLimiter(config, providerName).provider.limits;
}

/** Get rate limiter stats for the configured provider. */
export function getRateLimiterStats(config: EvalConfig, providerName?: ProviderName) {
	return getProviderWithLimiter(config, providerName).limiter.stats();
}

export async function callLLM(
	req: LLMRequest,
	config: EvalConfig,
	providerOverride?: ProviderName,
): Promise<LLMResponse> {
	const { provider, limiter } = getProviderWithLimiter(config, providerOverride);

	// Estimate tokens for pacing: input prompt ~chars/4, output ~maxTokens/2
	const estimatedInput = Math.ceil((req.system.length + req.user.length) / 4);
	const estimatedOutput = Math.ceil((req.maxTokens ?? provider.limits.maxOutputTokens) / 2);
	const estimatedTotal = estimatedInput + estimatedOutput;

	if (!config.rateLimitEnabled) {
		const response = await provider.generate(req);
		limiter.recordUsage(response.inputTokens + response.outputTokens);
		return response;
	}

	const response = await limiter.call(() => provider.generate(req), estimatedTotal);
	// Update with actual usage for accurate TPM tracking
	limiter.recordUsage(response.inputTokens + response.outputTokens);
	return response;
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
