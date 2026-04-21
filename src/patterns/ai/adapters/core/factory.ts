/**
 * `createAdapter` — provider-dispatching factory.
 *
 * One entry point, one config object. Picks the right concrete adapter by
 * `provider`, forwards everything else. Users who want finer control import
 * the concrete adapter directly (`anthropicAdapter`, `openAICompatAdapter`,
 * `googleAdapter`, `dryRunAdapter`, `webllmAdapter`, `chromeNanoAdapter`).
 */

import { type AnthropicAdapterOptions, anthropicAdapter } from "../providers/anthropic.js";
import { type DryRunAdapterOptions, dryRunAdapter } from "../providers/dry-run.js";
import { type GoogleAdapterOptions, googleAdapter } from "../providers/google.js";
import {
	type OpenAICompatAdapterOptions,
	type OpenAICompatPreset,
	openAICompatAdapter,
} from "../providers/openai-compat.js";
import type { LLMAdapter } from "./types.js";

export type AdapterProvider =
	| "anthropic"
	| OpenAICompatPreset // "openai" | "openrouter" | "groq" | "ollama" | "deepseek" | "xai"
	| "google"
	| "dry-run";

export interface CreateAdapterOptions {
	provider: AdapterProvider;
	apiKey?: string;
	model?: string;
	baseURL?: string;
	headers?: Record<string, string>;
	/** OpenAI-compat bodyExtras (OpenRouter routing, etc.). */
	bodyExtras?: Record<string, unknown>;
	/** Provider-specific SDK instance (any of AnthropicSdkLike / OpenAISdkLike / GoogleSdkLike). */
	sdk?: unknown;
	/** Custom fetch (for tests). */
	fetchImpl?: typeof fetch;
	/** Extra per-provider options forwarded verbatim. */
	extras?: Record<string, unknown>;
}

export function createAdapter(opts: CreateAdapterOptions): LLMAdapter {
	switch (opts.provider) {
		case "anthropic": {
			const a: AnthropicAdapterOptions = {
				apiKey: opts.apiKey,
				model: opts.model,
				baseURL: opts.baseURL,
				headers: opts.headers,
				sdk: opts.sdk as AnthropicAdapterOptions["sdk"],
				fetchImpl: opts.fetchImpl,
				...(opts.extras as AnthropicAdapterOptions | undefined),
			};
			return anthropicAdapter(a);
		}
		case "google": {
			const g: GoogleAdapterOptions = {
				apiKey: opts.apiKey,
				model: opts.model,
				baseURL: opts.baseURL,
				headers: opts.headers,
				sdk: opts.sdk as GoogleAdapterOptions["sdk"],
				fetchImpl: opts.fetchImpl,
				...(opts.extras as GoogleAdapterOptions | undefined),
			};
			return googleAdapter(g);
		}
		case "dry-run": {
			const d: DryRunAdapterOptions = {
				model: opts.model,
				...(opts.extras as DryRunAdapterOptions | undefined),
			};
			return dryRunAdapter(d);
		}
		// OpenAI-compat presets
		case "openai":
		case "openrouter":
		case "groq":
		case "ollama":
		case "deepseek":
		case "xai": {
			const c: OpenAICompatAdapterOptions = {
				preset: opts.provider,
				apiKey: opts.apiKey,
				model: opts.model,
				baseURL: opts.baseURL,
				headers: opts.headers,
				bodyExtras: opts.bodyExtras,
				sdk: opts.sdk as OpenAICompatAdapterOptions["sdk"],
				fetchImpl: opts.fetchImpl,
				...(opts.extras as OpenAICompatAdapterOptions | undefined),
			};
			return openAICompatAdapter(c);
		}
		default: {
			const never: never = opts.provider;
			throw new Error(`createAdapter: unknown provider: ${String(never)}`);
		}
	}
}
