/**
 * Thin LLM client wrapper.
 *
 * Supports Anthropic (primary). Extend with OpenAI/Google as needed.
 * Uses the Anthropic SDK — install: `pnpm add -D @anthropic-ai/sdk`
 */

import type { EvalConfig } from "./types.js";

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

export async function callLLM(req: LLMRequest, config: EvalConfig): Promise<LLMResponse> {
	const { default: Anthropic } = await import("@anthropic-ai/sdk");
	const client = new Anthropic();

	const model = req.model ?? config.model;
	const start = performance.now();

	const response = await client.messages.create({
		model,
		max_tokens: req.maxTokens ?? 4096,
		temperature: req.temperature ?? config.temperature,
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

/**
 * Extract JSON from an LLM response that may contain markdown fences.
 */
export function extractJSON(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) return fenced[1].trim();
	// Try raw JSON
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) return jsonMatch[0];
	return text.trim();
}
