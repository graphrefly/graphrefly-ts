/**
 * Provider and model limits registry.
 *
 * Known context windows, rate limits, and output caps per provider/model.
 * Used by the rate limiter and contrastive runner to stay within bounds.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderLimits {
	/** Max context window (input + output tokens). */
	contextWindow: number;
	/** Max output tokens the model can generate. */
	maxOutputTokens: number;
	/** Requests per minute. */
	rpm: number;
	/** Requests per day (Infinity if unlimited). */
	rpd: number;
	/**
	 * Tokens per minute — aggregate fallback. Used when provider doesn't
	 * publish split ITPM/OTPM (e.g. Google, Ollama, some OpenRouter routes).
	 * When `itpm`/`otpm` are set, they take precedence.
	 */
	tpm: number;
	/**
	 * Input tokens per minute — Anthropic, OpenAI, and others publish this
	 * separately from OTPM. Leave undefined when the provider uses a single
	 * combined TPM.
	 */
	itpm?: number;
	/**
	 * Output tokens per minute — published alongside ITPM by Anthropic, OpenAI,
	 * and others. Leave undefined when the provider uses a single combined TPM.
	 */
	otpm?: number;
}

/**
 * Resolved limits for a specific run — merges registry defaults with
 * env-var or config overrides.
 */
export type ResolvedLimits = ProviderLimits;

// ---------------------------------------------------------------------------
// Known limits registry
// ---------------------------------------------------------------------------

/**
 * Key format: `provider/model` for exact match, `provider/*` for provider default.
 * Values are conservative defaults (free-tier where applicable).
 */
const KNOWN_LIMITS: Record<string, ProviderLimits> = {
	// --- Anthropic — Tier 1 (verified docs.anthropic.com/api/rate-limits 2026-04-20) ---
	// Providers with split ITPM/OTPM. `tpm` below = ITPM for backward-compat
	// in code paths that read only tpm.
	"anthropic/claude-opus-4-6": {
		contextWindow: 200_000,
		maxOutputTokens: 32_000,
		rpm: 50,
		rpd: Infinity,
		tpm: 30_000,
		itpm: 30_000,
		otpm: 8_000,
	},
	"anthropic/claude-sonnet-4-6": {
		contextWindow: 200_000,
		maxOutputTokens: 64_000,
		rpm: 50,
		rpd: Infinity,
		tpm: 30_000,
		itpm: 30_000,
		otpm: 8_000,
	},
	"anthropic/claude-haiku-4-5-20251001": {
		contextWindow: 200_000,
		maxOutputTokens: 64_000,
		rpm: 50,
		rpd: Infinity,
		tpm: 50_000,
		itpm: 50_000,
		otpm: 10_000,
	},
	"anthropic/*": {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		rpm: 50,
		rpd: Infinity,
		tpm: 30_000,
		itpm: 30_000,
		otpm: 8_000,
	},

	// --- OpenAI direct (legacy, for api.openai.com). GPT-4.x is deprecated on
	// OpenRouter (see `openrouter/openai/gpt-5.x-*` below for routed variants).
	"openai/gpt-4o": {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},
	"openai/gpt-4o-mini": {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		rpm: 500,
		rpd: Infinity,
		tpm: 2_000_000,
	},
	"openai/gpt-4.1": {
		contextWindow: 1_047_576,
		maxOutputTokens: 32_768,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},
	"openai/gpt-4.1-mini": {
		contextWindow: 1_047_576,
		maxOutputTokens: 32_768,
		rpm: 500,
		rpd: Infinity,
		tpm: 2_000_000,
	},
	"openai/gpt-4.1-nano": {
		contextWindow: 1_047_576,
		maxOutputTokens: 32_768,
		rpm: 1_000,
		rpd: Infinity,
		tpm: 4_000_000,
	},
	// GPT-5.x family via direct API (same limits as OpenRouter-routed variants
	// below — OpenAI published the 400K context + 128K max output bump at 5.2+).
	"openai/gpt-5.4-nano": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},
	"openai/gpt-5.4-mini": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},
	"openai/gpt-5.4": {
		contextWindow: 1_050_000,
		maxOutputTokens: 128_000,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},
	"openai/gpt-5.3-codex": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},
	"openai/*": {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},

	// --- Google direct (AI Studio free tier — verified 2026-04-19) ---
	// Free-tier RPD is tight (~20/day on flash, 25 on pro). Override per run
	// with EVAL_RPM / EVAL_RPD / EVAL_TPM when your account is on a paid tier.
	// For routed access see `openrouter/google/*` further down.
	"google/gemini-2.5-pro": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 5,
		rpd: 25,
		tpm: 250_000,
	},
	"google/gemini-2.5-flash": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 5,
		rpd: 20,
		tpm: 250_000,
	},
	"google/gemini-2.0-flash": {
		contextWindow: 1_048_576,
		maxOutputTokens: 8_192,
		rpm: 15,
		rpd: 1_500,
		tpm: 1_000_000,
	},
	"google/gemini-3-flash-preview": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 5,
		rpd: 20,
		tpm: 250_000,
	},
	"google/gemini-3.1-flash-lite-preview": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 5,
		rpd: 20,
		tpm: 250_000,
	},
	"google/gemini-3.1-pro-preview": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 5,
		rpd: 25,
		tpm: 250_000,
	},
	"google/*": {
		contextWindow: 1_048_576,
		maxOutputTokens: 8_192,
		rpm: 5,
		rpd: 20,
		tpm: 250_000,
	},

	// --- Ollama (local — unlimited, but context window matters) ---
	"ollama/gemma4:26b": {
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		rpm: Infinity,
		rpd: Infinity,
		tpm: Infinity,
	},
	"ollama/gemma4:27b": {
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		rpm: Infinity,
		rpd: Infinity,
		tpm: Infinity,
	},
	"ollama/gemma3:12b": {
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		rpm: Infinity,
		rpd: Infinity,
		tpm: Infinity,
	},
	"ollama/gemma3:27b": {
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		rpm: Infinity,
		rpd: Infinity,
		tpm: Infinity,
	},
	"ollama/qwen3:32b": {
		contextWindow: 131_072,
		maxOutputTokens: 8_192,
		rpm: Infinity,
		rpd: Infinity,
		tpm: Infinity,
	},
	"ollama/*": {
		contextWindow: 131_072,
		maxOutputTokens: 4_096,
		rpm: Infinity,
		rpd: Infinity,
		tpm: Infinity,
	},

	// --- OpenRouter ---
	// Paid routes (default): no daily cap — your $-spending limit on OpenRouter's
	// side (set in their dashboard) is the real safety net. Combine with
	// EVAL_MAX_PRICE_USD locally for a belt + suspenders.
	//
	// `maxOutputTokens` set generously (32K) because most modern routed models
	// are reasoning models — their <think> phase eats output budget, so a low
	// cap (e.g. 4K) makes the model burn the whole budget on reasoning and
	// emit zero content. Override per-call via `req.maxTokens` if you want a
	// tighter ceiling.
	"openrouter/*": {
		contextWindow: 128_000,
		maxOutputTokens: 32_768,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	// Specific cheap-tier reasoning models with known higher budgets.
	"openrouter/z-ai/glm-4.7": {
		contextWindow: 200_000,
		maxOutputTokens: 65_536,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	"openrouter/z-ai/glm-5.1": {
		contextWindow: 203_000,
		maxOutputTokens: 65_536,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	"openrouter/deepseek/deepseek-v3.2": {
		contextWindow: 131_000,
		maxOutputTokens: 32_768,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	// OpenRouter publish-tier picks (verified 2026-04-20 from openrouter.ai/api).
	// OpenRouter doesn't publish per-model per-key RPM; 20 is conservative. Your
	// OpenRouter $-spending dashboard is the real safety net.
	// --- OpenAI routed via OpenRouter (GPT-5.x; GPT-4.x is deprecated) ---
	"openrouter/openai/gpt-5.4-nano": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 60,
		rpd: Infinity,
		tpm: 400_000,
	},
	"openrouter/openai/gpt-5.4-mini": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 60,
		rpd: Infinity,
		tpm: 400_000,
	},
	"openrouter/openai/gpt-5.4": {
		contextWindow: 1_050_000,
		maxOutputTokens: 128_000,
		rpm: 30,
		rpd: Infinity,
		tpm: 200_000,
	},
	"openrouter/openai/gpt-5.3-codex": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	"openrouter/openai/gpt-5.2-codex": {
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	// --- Google routed via OpenRouter (Gemini 3.x) ---
	"openrouter/google/gemini-3-flash-preview-20251217": {
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 60,
		rpd: Infinity,
		tpm: 400_000,
	},
	"openrouter/google/gemini-3-flash-preview": {
		// Non-stamped alias — OpenRouter routes to the latest preview snapshot.
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 60,
		rpd: Infinity,
		tpm: 400_000,
	},
	"openrouter/google/gemini-3.1-flash-lite-preview": {
		// Cheapest Gemini 3.x — $0.25/$1.50, reasoning at output rate.
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 60,
		rpd: Infinity,
		tpm: 400_000,
	},
	"openrouter/google/gemini-3.1-pro-preview": {
		// "Thinking Pro" preview. Reasoning tokens billed at output rate ($12/1M).
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	// `:free` routes — OpenRouter caps daily request volume (varies by route,
	// commonly ~50-1000/day depending on whether your account has $10+ topped up).
	// Use EVAL_RPD to pin to your account's actual cap when running :free routes.
	"openrouter/:free": {
		contextWindow: 128_000,
		maxOutputTokens: 8_192,
		rpm: 10,
		rpd: 50,
		tpm: 100_000,
	},

	// --- Groq (generous RPM, strict TPM) ---
	"groq/*": {
		contextWindow: 128_000,
		maxOutputTokens: 8_192,
		rpm: 30,
		rpd: 14_400,
		tpm: 20_000,
	},
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Look up limits for a provider/model pair.
 * Tries exact `provider/model`, then `provider/*` fallback.
 */
export function lookupLimits(provider: string, model: string): ProviderLimits | undefined {
	return KNOWN_LIMITS[`${provider}/${model}`] ?? KNOWN_LIMITS[`${provider}/*`];
}

/**
 * Resolve limits with env-var overrides.
 *
 * Env vars:
 *   EVAL_RPM, EVAL_RPD — request limits
 *   EVAL_TPM — combined tokens/minute fallback (used when provider doesn't
 *     publish split input/output)
 *   EVAL_ITPM — input tokens/minute (Anthropic, OpenAI style)
 *   EVAL_OTPM — output tokens/minute
 *   EVAL_MAX_OUTPUT_TOKENS, EVAL_CONTEXT_WINDOW — per-request caps
 */
export function resolveLimits(provider: string, model: string): ResolvedLimits {
	const base = lookupLimits(provider, model) ?? {
		contextWindow: 128_000,
		maxOutputTokens: 4_096,
		rpm: 20,
		rpd: Infinity,
		tpm: 500_000,
	};

	return {
		contextWindow: envInt("EVAL_CONTEXT_WINDOW") ?? base.contextWindow,
		maxOutputTokens: envInt("EVAL_MAX_OUTPUT_TOKENS") ?? base.maxOutputTokens,
		rpm: envInt("EVAL_RPM") ?? base.rpm,
		rpd: envInt("EVAL_RPD") ?? base.rpd,
		tpm: envInt("EVAL_TPM") ?? base.tpm,
		itpm: envInt("EVAL_ITPM") ?? base.itpm,
		otpm: envInt("EVAL_OTPM") ?? base.otpm,
	};
}

function envInt(name: string): number | undefined {
	const v = process.env[name];
	if (!v) return undefined;
	const n = Number.parseInt(v, 10);
	return Number.isNaN(n) ? undefined : n;
}
