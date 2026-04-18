/**
 * Dry-run LLM provider — returns canned content, charges zero tokens,
 * records every call that would have been made.
 *
 * Motivation: `archive/docs/SESSION-rigor-infrastructure-plan.md`
 * § "LLM EVAL COST SAFETY" Layer 4. Flip `EVAL_MODE=dry-run` to validate
 * a pipeline's call structure (counts, call ordering, request shapes)
 * at zero cost before a real run. If the pipeline makes unexpected call
 * counts or spawns runaway subscriptions, dry-run catches it instantly.
 */

import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";

export interface DryRunOptions {
	/** Content the provider returns on every call. Default: a plain marker string. */
	readonly cannedContent?: string;
	/**
	 * Observer fired on every call with the request and the 1-based call
	 * number. Useful for counting or logging the call sequence.
	 */
	readonly onCall?: (req: LLMRequest, callNumber: number) => void;
}

export function createDryRunProvider(opts: DryRunOptions = {}): LLMProvider {
	const content = opts.cannedContent ?? "[DRY RUN] No LLM call was made.";
	let calls = 0;
	return {
		name: "dry-run",
		limits: {
			contextWindow: 1_000_000,
			maxOutputTokens: 1_000_000,
			rpm: Number.POSITIVE_INFINITY,
			rpd: Number.POSITIVE_INFINITY,
			tpm: Number.POSITIVE_INFINITY,
		},
		async generate(req: LLMRequest): Promise<LLMResponse> {
			calls += 1;
			opts.onCall?.(req, calls);
			return { content, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
		},
	};
}
