/**
 * Cost estimation from token counts.
 *
 * Per-model pricing (USD per 1M tokens). Update as prices change.
 * These are approximate — actual billing may differ.
 */

const PRICING: Record<string, { input: number; output: number }> = {
	// Anthropic (verified 2026-04-20 from docs.anthropic.com/pricing)
	"claude-opus-4-6": { input: 5, output: 25 }, // 4.6 dropped from 4.1's $15/$75
	"claude-sonnet-4-6": { input: 3, output: 15 },
	"claude-haiku-4-5-20251001": { input: 1, output: 5 },
	// OpenAI
	"gpt-4o": { input: 2.5, output: 10 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
	"gpt-4.1": { input: 2, output: 8 },
	"gpt-4.1-mini": { input: 0.4, output: 1.6 },
	"gpt-4.1-nano": { input: 0.1, output: 0.4 },
	// Google
	"gemini-2.5-pro": { input: 1.25, output: 10 },
	"gemini-2.5-flash": { input: 0.15, output: 0.6 },
	"gemini-2.0-flash": { input: 0.1, output: 0.4 },
	"gemini-3-flash-preview": { input: 0.1, output: 0.4 }, // verify on Google AI Studio console
	// OpenRouter / Chutes — recommended cheap-tier (see evals/CHEAP-AND-SAFE.md)
	"z-ai/glm-5.1": { input: 0.95, output: 3.15 },
	"z-ai/glm-4.7": { input: 0.39, output: 1.75 },
	"deepseek/deepseek-v3.2": { input: 0.28, output: 0.42 },
	"deepseek/deepseek-chat-v3.1": { input: 0.27, output: 1.0 },
	"moonshotai/kimi-k2.5": { input: 0.38, output: 1.72 },
	"minimax/minimax-m2.5": { input: 0.118, output: 0.99 },
	"xiaomi/mimo-v2-flash": { input: 0.09, output: 0.29 },
	"qwen/qwen3-32b": { input: 0.08, output: 0.24 },
	// Ollama (local) — free
	"gemma3:12b": { input: 0, output: 0 },
	"gemma3:27b": { input: 0, output: 0 },
	"gemma4:27b": { input: 0, output: 0 },
	"qwen3:32b": { input: 0, output: 0 },
};

/**
 * Estimate cost in USD for a given token count and model.
 * Returns 0 for unknown models (ollama, etc.).
 */
export function estimateTokenCost(
	inputTokens: number,
	outputTokens: number,
	model?: string,
): number {
	if (!model) return 0;
	// Try exact match, then prefix match (e.g. "claude-sonnet-4-6-20260401" → "claude-sonnet-4-6")
	const pricing = PRICING[model] ?? Object.entries(PRICING).find(([k]) => model.startsWith(k))?.[1];
	if (!pricing) return 0;
	return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Sum costs across task results.
 */
export function totalCost(costs: (number | undefined)[]): number {
	return costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
}
