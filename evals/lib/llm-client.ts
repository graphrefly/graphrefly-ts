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
 *
 * OpenAI-compatible extras (OpenRouter `provider` routing, etc.): `EVAL_COMPAT_CHAT_EXTRA_JSON`
 * → `EvalConfig.compatChatExtra`, merged into each chat completion.
 */

import { type BudgetGateOptions, withBudgetGate } from "./budget-gate.js";
import { createDryRunProvider } from "./dry-run-provider.js";
import type { ResolvedLimits } from "./limits.js";
import { resolveLimits } from "./limits.js";
import { AdaptiveRateLimiter, withRateLimiter } from "./rate-limiter.js";
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

		const baseBody = {
			model,
			max_tokens: maxTokens,
			temperature: req.temperature ?? this.config.temperature,
			messages: [
				{ role: "system", content: req.system },
				{ role: "user", content: req.user },
			],
		};
		const extra = this.config.compatChatExtra;
		// Vendor extensions (e.g. OpenRouter `provider`) are not in OpenAI's typings.
		const response = await client.chat.completions.create({
			...baseBody,
			...(extra ?? {}),
		} as never);

		const latencyMs = performance.now() - start;
		const content = response.choices[0]?.message?.content ?? "";

		// Reasoning-token handling — load-bearing for cost accuracy on models
		// like GLM-5.1, Claude with thinking, GPT-o1, etc. that emit hidden
		// chain-of-thought tokens billed at the output rate.
		//
		// OpenRouter's convention: `usage.completion_tokens` excludes reasoning,
		// `usage.completion_tokens_details.reasoning_tokens` is reported
		// separately. So we add them. (OpenAI's direct API includes reasoning
		// in completion_tokens for o1 — that path would double-count, but
		// `EVAL_PROVIDER=openai` users typically run non-o1 models where
		// reasoning_tokens is 0 or absent, so the impact is bounded.)
		const completionTokens = response.usage?.completion_tokens ?? 0;
		const reasoningTokens =
			(response.usage as { completion_tokens_details?: { reasoning_tokens?: number } })
				?.completion_tokens_details?.reasoning_tokens ?? 0;

		return {
			content,
			inputTokens: response.usage?.prompt_tokens ?? 0,
			outputTokens: completionTokens + reasoningTokens,
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

/** Stable string for cache keys when `compatChatExtra` affects routing/output. */
function compatChatExtraCacheSalt(config: EvalConfig): string | undefined {
	const ex = config.compatChatExtra;
	if (!ex || Object.keys(ex).length === 0) return undefined;
	return JSON.stringify(ex);
}

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
 * - `EVAL_RATE_LIMIT=false` — disable adaptive rate-limit pacing.
 *
 * **Wrapping order is load-bearing:**
 *
 *   `cache → budget → rateLimiter → base`
 *
 * - **Cache outside budget**: cache hits short-circuit before any spend is
 *   charged — reruns stay free.
 * - **Cache outside rate limiter**: cache hits short-circuit before any pacing
 *   — fully cached reruns aren't slowed by the per-minute window. Flip these
 *   and a 30-task cached corpus takes minutes instead of seconds.
 *
 * Returns both the wrapped provider and the underlying limiter so callers can
 * read `limiter.stats()` for end-of-run reporting.
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
): { provider: LLMProvider; limiter: AdaptiveRateLimiter } {
	const mode = process.env.EVAL_MODE ?? "real";
	const base =
		mode === "dry-run"
			? createDryRunProvider({
					onCall: (req, n) =>
						console.error(`[dry-run #${n}] ${req.user.slice(0, 80).replace(/\n/g, " ")}`),
				})
			: createProvider(config);

	const limiter = new AdaptiveRateLimiter(base.limits);
	const limited = withRateLimiter(base, limiter, { enabled: config.rateLimitEnabled });

	const gated = withBudgetGate(limited, {
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

	// Bake the registry-resolved maxOutputTokens into the cache key salt.
	// Without this, bumping the registry's `maxOutputTokens` doesn't change
	// the key (req.maxTokens is undefined → cached as null), so the next run
	// returns yesterday's truncated/empty responses regardless of the new cap.
	// The salt also captures vendor-specific chat extras already.
	const baseSalt = compatChatExtraCacheSalt(config);
	const limitsSalt = `maxOutput=${base.limits.maxOutputTokens}`;
	const keyMaterialExtra = baseSalt ? `${baseSalt}|${limitsSalt}` : limitsSalt;

	const cached = withReplayCache(gated, {
		cacheDir: opts.cacheDir ?? "evals/results/replay-cache",
		mode: (process.env.EVAL_REPLAY as ReplayMode) ?? "read-write",
		keyMaterialExtra,
		// Stable identity — decouples cache key from wrapper-chain naming.
		// Adding/reordering inner wrappers (budget, rate limiter, future ones)
		// will not silently invalidate previously-cached entries.
		// Mode is part of the key so dry-run canned responses ("[DRY RUN] ...")
		// don't poison the real-run cache.
		providerKey: mode === "dry-run" ? `${config.provider}+dryrun` : config.provider,
	});

	return { provider: cached, limiter };
}

// ---------------------------------------------------------------------------
// Convenience wrapper (backward-compatible)
// ---------------------------------------------------------------------------

/** Provider + rate limiter instances cached by provider name + compat extras. */
const _providerCache = new Map<string, { provider: LLMProvider; limiter: AdaptiveRateLimiter }>();

function providerInstanceCacheKey(config: EvalConfig, providerName?: ProviderName): string {
	const name = providerName ?? config.provider;
	const salt = compatChatExtraCacheSalt(config);
	return salt !== undefined ? `${name}::${salt}` : name;
}

function getProviderWithLimiter(
	config: EvalConfig,
	providerName?: ProviderName,
): { provider: LLMProvider; limiter: AdaptiveRateLimiter } {
	const cacheKey = providerInstanceCacheKey(config, providerName);
	let entry = _providerCache.get(cacheKey);
	if (!entry) {
		const name = providerName ?? config.provider;
		const overrideConfig = name === config.provider ? config : { ...config, provider: name };
		// Cost-safe stack: replay cache + budget gate + rate limiter + dry-run.
		// Env vars EVAL_MODE / EVAL_MAX_CALLS / EVAL_MAX_PRICE_USD / EVAL_REPLAY
		// / EVAL_RATE_LIMIT control it.
		entry = createSafeProvider(overrideConfig);
		_providerCache.set(cacheKey, entry);
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
	const { provider } = getProviderWithLimiter(config, providerOverride);
	// Rate limiting + token pacing happen inside the provider stack
	// (`withRateLimiter` is the innermost wrapper, so cache hits skip pacing).
	return provider.generate(req);
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
