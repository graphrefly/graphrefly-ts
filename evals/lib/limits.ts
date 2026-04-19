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
	/** Tokens per minute (input + output combined). */
	tpm: number;
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
	// --- Anthropic ---
	"anthropic/claude-opus-4-6": {
		contextWindow: 200_000,
		maxOutputTokens: 32_000,
		rpm: 50,
		rpd: Infinity,
		tpm: 40_000,
	},
	"anthropic/claude-sonnet-4-6": {
		contextWindow: 200_000,
		maxOutputTokens: 16_000,
		rpm: 50,
		rpd: Infinity,
		tpm: 80_000,
	},
	"anthropic/claude-haiku-4-5-20251001": {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		rpm: 50,
		rpd: Infinity,
		tpm: 100_000,
	},
	"anthropic/*": {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		rpm: 50,
		rpd: Infinity,
		tpm: 80_000,
	},

	// --- OpenAI ---
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
	"openai/*": {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		rpm: 500,
		rpd: Infinity,
		tpm: 800_000,
	},

	// --- Google (free tier — verified from AI Studio https://aistudio.google.com/rate-limit ) ---
	// Verified 2026-04-19 for Gemini 2.5 Flash and Gemini 3 Flash Preview.
	// Override per run with EVAL_RPM / EVAL_RPD / EVAL_TPM if your account is on a paid tier.
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
	"openrouter/*": {
		contextWindow: 128_000,
		maxOutputTokens: 4_096,
		rpm: 20,
		rpd: Infinity,
		tpm: 200_000,
	},
	// `:free` routes — OpenRouter caps daily request volume (varies by route,
	// commonly ~50-1000/day depending on whether your account has $10+ topped up).
	// Use EVAL_RPD to pin to your account's actual cap when running :free routes.
	"openrouter/:free": {
		contextWindow: 128_000,
		maxOutputTokens: 4_096,
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
 * Env vars: EVAL_RPM, EVAL_RPD, EVAL_TPM, EVAL_MAX_OUTPUT_TOKENS, EVAL_CONTEXT_WINDOW.
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
	};
}

function envInt(name: string): number | undefined {
	const v = process.env[name];
	if (!v) return undefined;
	const n = Number.parseInt(v, 10);
	return Number.isNaN(n) ? undefined : n;
}
