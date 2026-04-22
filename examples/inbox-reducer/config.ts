/**
 * Inbox-reducer runtime configuration.
 *
 * Edit this file to point the example at the LLM provider + model you want
 * to examine. Every field below maps 1-to-1 onto a shipped library type —
 * no bespoke schema, no new library surface:
 *
 * - `kind`              → `CreateAdapterOptions.provider` (src/patterns/ai/adapters/core/factory.ts)
 * - `capabilities`      → `ModelCapabilities`              (src/patterns/ai/adapters/core/capabilities.ts)
 * - `capabilities.pricing` → `ModelPricing`                 (src/patterns/ai/adapters/core/pricing.ts)
 * - `budget`            → `WithBudgetGateOptions.caps`    (src/patterns/ai/adapters/middleware/budget-gate.ts)
 * - `resilience`        → `resilientAdapter` options       (src/patterns/ai/adapters/middleware/resilient-adapter.ts)
 *
 * The `capabilities.pricing` block is OPTIONAL. When present, the pre-flight
 * dry run multiplies counted tokens by your configured rates. When absent,
 * the dry run reports token counts only — no invented USD figures. The
 * example ships with pricing commented out; fill in the numbers from your
 * provider's current pricing page if you want the USD estimate.
 *
 * Active config is picked by `INBOX_CONFIG=openrouter|anthropic|google|ollama`
 * (default: `openrouter`). `INBOX_MODEL=...` overrides the preset's model id
 * without editing this file.
 */

import type { AdapterProvider, ModelCapabilities } from "@graphrefly/graphrefly/patterns/ai";

export interface InboxProviderConfig {
	/** Dispatches to the shipped provider constructor via `createAdapter`. */
	kind: AdapterProvider;
	/** Model id passed to the adapter and used as part of the replay-cache key. */
	model: string;
	/** Env var holding the API key. `process.env[apiKeyEnv]` is read at startup. */
	apiKeyEnv?: string;
	/** Base URL override (OpenRouter, self-host, etc.). */
	baseURL?: string;
	/** Extra request body fields (e.g. OpenRouter routing hints). */
	bodyExtras?: Record<string, unknown>;
	/** Static facts about this model. `pricing` is optional — see module docs. */
	capabilities?: ModelCapabilities;
}

export interface InboxConfig {
	primary: InboxProviderConfig;
	/** Optional second-tier adapter engaged when primary exhausts retries. */
	fallback?: InboxProviderConfig;
	/** Budget caps applied via `resilientAdapter({ budget: { caps } })`. */
	budget?: { calls?: number; inputTokens?: number; outputTokens?: number; usd?: number };
	/** Rate-limit + timeout + retry wired into `resilientAdapter`. */
	resilience?: {
		rpm?: number;
		tpm?: number;
		timeoutMs?: number;
		retryAttempts?: number;
	};
}

// ----------------------------------------------------------------------------
// Example 1 — OpenAI-compat preset (OpenRouter here; `kind` also supports
// "openai" | "deepseek" | "groq" | "xai" | "ollama" — all go through the
// same shipped OpenAI-compat provider with different defaults).
// ----------------------------------------------------------------------------
const openrouterExample: InboxConfig = {
	primary: {
		kind: "openrouter",
		model: "deepseek/deepseek-chat",
		apiKeyEnv: "OPENROUTER_API_KEY",
		capabilities: {
			id: "deepseek/deepseek-chat",
			provider: "openrouter",
			limits: { contextWindow: 64_000, rpm: 60 },
			// Uncomment + fill in from https://openrouter.ai/models to enable
			// USD estimates in the dry-run summary. Numbers are $/1M tokens.
			// pricing: {
			//   currency: "USD",
			//   input:  { regular: /* $ / 1M input tokens  */ 0 },
			//   output: { regular: /* $ / 1M output tokens */ 0 },
			// },
		},
	},
	budget: { calls: 20 },
	resilience: { rpm: 60, timeoutMs: 30_000, retryAttempts: 3 },
};

// ----------------------------------------------------------------------------
// Example 2 — Anthropic direct (requires `@anthropic-ai/sdk` installed in the
// surrounding app OR a provider-side HTTP shim; our `anthropicAdapter` also
// supports a fetch-only path, see src/patterns/ai/adapters/providers/anthropic.ts).
// ----------------------------------------------------------------------------
const anthropicExample: InboxConfig = {
	primary: {
		kind: "anthropic",
		model: "claude-haiku-4-5",
		apiKeyEnv: "ANTHROPIC_API_KEY",
		capabilities: {
			id: "claude-haiku-4-5",
			provider: "anthropic",
			limits: { contextWindow: 200_000, rpm: 50 },
			// pricing: {
			//   currency: "USD",
			//   input:  { regular: 0 /* $/1M input */  },
			//   output: { regular: 0 /* $/1M output */ },
			// },
		},
	},
	budget: { calls: 20 },
	resilience: { rpm: 50, timeoutMs: 60_000, retryAttempts: 3 },
};

// ----------------------------------------------------------------------------
// Example 3 — Google direct (Gemini). Works via our `googleAdapter`.
//
// Default: Gemini 2.5 Flash-Lite on the free tier. Chosen because:
//   - Thinking mode OFF by default → fast, predictable, no reasoning-token
//     bloat that wrecks cost on other thinking models.
//   - Lowest price of the Flash family: $0.10 / $0.40 per 1M in/out.
//   - Free-tier 15 RPM / 250K TPM / 1,000 RPD — well above what this
//     example needs (3 calls per run, ~4K input tokens total).
//   - 1M-token context window.
//
// Free-tier rate limits as of April 2026 (source: ai.google.dev). Numbers
// below match the free-tier so the budget gate short-circuits correctly if
// you rerun the demo many times in a minute. Upgrade the `rpm` / `tpm` /
// `rpd` values to your paid-tier quota if applicable.
// ----------------------------------------------------------------------------
const googleExample: InboxConfig = {
	primary: {
		kind: "google",
		model: "gemini-2.5-flash-lite",
		apiKeyEnv: "GOOGLE_API_KEY",
		capabilities: {
			id: "gemini-2.5-flash-lite",
			provider: "google",
			limits: {
				contextWindow: 1_000_000,
				rpm: 15,
				tpm: 250_000,
				rpd: 1_000,
			},
			pricing: {
				currency: "USD",
				input: { regular: 0.1, cacheRead: 0.01 },
				output: { regular: 0.4 },
			},
		},
	},
	// Free tier is generous enough that $1 is unreachable in normal use.
	// Leaving the cap in place as a safety net for a runaway loop.
	budget: { usd: 1 },
	resilience: { rpm: 15, tpm: 250_000, timeoutMs: 60_000, retryAttempts: 2 },
};

// ----------------------------------------------------------------------------
// Example 3b — Google Gemini 2.5 Flash (full, not Lite). Thinking mode ON by
// default; slower and ~3-6× pricier than Flash-Lite. Uncomment this block +
// the `NAMED` entry below, and set `INBOX_CONFIG=googleFlash`, if you want
// the richer reasoning for comparison.
//
// To disable thinking for speed (recommended for this example), pass
// `bodyExtras: { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }`.
// ----------------------------------------------------------------------------
// const googleFlashExample: InboxConfig = {
// 	primary: {
// 		kind: "google",
// 		model: "gemini-2.5-flash",
// 		apiKeyEnv: "GOOGLE_API_KEY",
// 		bodyExtras: {
// 			generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
// 		},
// 		capabilities: {
// 			id: "gemini-2.5-flash",
// 			provider: "google",
// 			limits: { contextWindow: 1_000_000, rpm: 10, tpm: 250_000, rpd: 250 },
// 			pricing: {
// 				currency: "USD",
// 				input: { regular: 0.3, cacheRead: 0.03 },
// 				output: { regular: 2.5 },
// 			},
// 		},
// 	},
// 	budget: { usd: 2 },
// 	resilience: { rpm: 10, tpm: 250_000, timeoutMs: 60_000, retryAttempts: 2 },
// };

// ----------------------------------------------------------------------------
// Example 4 — Ollama (local). No API key needed, no budget needed (free).
// The shipped `openai-compat` preset for Ollama sets baseURL to
// `http://localhost:11434/v1` — no need to set it here. Pricing is omitted
// (it's free), so the dry-run reports token counts only.
//
// Default model is `gemma4:26b` — override via `INBOX_MODEL=...` if your
// local tag differs (e.g. `INBOX_MODEL=llama3.1:70b`).
//
// IMPORTANT: no per-call `timeoutMs` and no retries.
//   - Large local models on consumer hardware can take minutes to chew
//     through a 4K-token prompt. Aborting at, say, 120s mid-inference
//     returns a 500 and achieves nothing but wasted work.
//   - Retrying a timed-out local call with the exact same input is useless
//     — it'll take the same amount of time next attempt too. Retries are
//     for transient network failures (429, connection reset), which don't
//     apply to localhost.
//   - The outer `INBOX_TIMEOUT_MS` (default 120 000 ms, raise for big
//     models) is the one timeout that matters — set it generously.
// ----------------------------------------------------------------------------
const ollamaExample: InboxConfig = {
	primary: {
		kind: "ollama",
		model: "gemma4:26b",
		capabilities: {
			id: "gemma4:26b",
			provider: "ollama",
			limits: { contextWindow: 8192 }, // adjust for your model's window
		},
	},
	// No budget — Ollama is local. No per-call timeout or retries; the outer
	// INBOX_TIMEOUT_MS is the only bound on the pipeline.
	resilience: {},
};

const NAMED: Record<string, InboxConfig> = {
	openrouter: openrouterExample,
	anthropic: anthropicExample,
	google: googleExample,
	ollama: ollamaExample,
};

const active = process.env.INBOX_CONFIG ?? "openrouter";
if (!(active in NAMED)) {
	console.error(`Unknown INBOX_CONFIG=${active}. Pick one of: ${Object.keys(NAMED).join(", ")}`);
	process.exit(2);
}

// Apply INBOX_MODEL override without mutating the preset.
function withModelOverride(cfg: InboxConfig, override: string | undefined): InboxConfig {
	if (!override) return cfg;
	const primary: InboxProviderConfig = {
		...cfg.primary,
		model: override,
		capabilities: cfg.primary.capabilities
			? { ...cfg.primary.capabilities, id: override }
			: undefined,
	};
	return { ...cfg, primary };
}

export const config: InboxConfig = withModelOverride(
	NAMED[active] as InboxConfig,
	process.env.INBOX_MODEL,
);
