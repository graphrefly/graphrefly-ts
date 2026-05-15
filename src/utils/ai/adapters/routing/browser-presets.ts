/**
 * Curated `cascadingLlmAdapter` presets that depend on browser-only adapters
 * (`webllmAdapter`, `chromeNanoAdapter`).
 *
 * Split out from `routing/presets.ts` so that importing `patterns/ai` in a
 * Node bundle doesn't transitively pull in `@mlc-ai/web-llm` / Chrome Nano
 * dynamic imports, and so browser-only consumers can opt in cleanly via
 * the `@graphrefly/graphrefly/patterns/ai/browser` subpath.
 *
 * @module
 */

import { createAdapter } from "@graphrefly/pure-ts/core/factory.js";
import type { LLMAdapter } from "@graphrefly/pure-ts/core/types.js";
import { chromeNanoAdapter } from "../providers/browser/chrome-nano.js";
import { webllmAdapter } from "../providers/browser/webllm.js";
import { type CascadingLlmAdapterOptions, cascadingLlmAdapter } from "./cascading.js";

// ---------------------------------------------------------------------------
// Cloud-first: BYOK → WebLLM → Chrome Nano
// ---------------------------------------------------------------------------

export interface CloudFirstPresetOptions {
	/** BYOK config — passed directly to `createAdapter`. */
	cloud: Parameters<typeof createAdapter>[0];
	/** WebLLM model name. Pass `null` to skip the WebLLM tier. */
	webllmModel?: string | null;
	/** Pass `null` to skip the Chrome Nano tier. */
	chromeNano?: boolean;
	/** Cascade options. */
	cascade?: CascadingLlmAdapterOptions;
}

/**
 * Cloud-first with local fallback: BYOK → WebLLM → Chrome Nano.
 */
export function cloudFirstPreset(opts: CloudFirstPresetOptions): LLMAdapter {
	const tiers = [{ name: "cloud", adapter: createAdapter(opts.cloud) }];
	if (opts.webllmModel) {
		tiers.push({ name: "webllm", adapter: webllmAdapter({ model: opts.webllmModel }) });
	}
	if (opts.chromeNano !== false) {
		tiers.push({
			name: "chrome-nano",
			adapter: chromeNanoAdapter(),
			filter: (_msgs, iOpts) => !iOpts?.tools || iOpts.tools.length === 0,
		} as Parameters<typeof cascadingLlmAdapter>[0][number]);
	}
	return cascadingLlmAdapter(tiers, opts.cascade);
}

// ---------------------------------------------------------------------------
// Local-first: Ollama → WebLLM → Chrome Nano
// ---------------------------------------------------------------------------

export interface LocalFirstPresetOptions {
	/** Ollama model. */
	ollamaModel: string;
	/** Ollama base URL. Default http://localhost:11434/v1. */
	ollamaBaseURL?: string;
	webllmModel?: string | null;
	chromeNano?: boolean;
	cascade?: CascadingLlmAdapterOptions;
}

/**
 * Local-first: nothing leaves the machine. Ollama → WebLLM → Chrome Nano.
 */
export function localFirstPreset(opts: LocalFirstPresetOptions): LLMAdapter {
	const tiers = [
		{
			name: "ollama",
			adapter: createAdapter({
				provider: "ollama",
				model: opts.ollamaModel,
				baseURL: opts.ollamaBaseURL,
			}),
		},
	];
	if (opts.webllmModel) {
		tiers.push({ name: "webllm", adapter: webllmAdapter({ model: opts.webllmModel }) });
	}
	if (opts.chromeNano !== false) {
		tiers.push({
			name: "chrome-nano",
			adapter: chromeNanoAdapter(),
			filter: (_msgs, iOpts) => !iOpts?.tools || iOpts.tools.length === 0,
		} as Parameters<typeof cascadingLlmAdapter>[0][number]);
	}
	return cascadingLlmAdapter(tiers, opts.cascade);
}

// ---------------------------------------------------------------------------
// Offline: WebLLM → Chrome Nano (no network)
// ---------------------------------------------------------------------------

export interface OfflinePresetOptions {
	webllmModel: string;
	chromeNano?: boolean;
	cascade?: CascadingLlmAdapterOptions;
}

export function offlinePreset(opts: OfflinePresetOptions): LLMAdapter {
	const tiers = [{ name: "webllm", adapter: webllmAdapter({ model: opts.webllmModel }) }];
	if (opts.chromeNano !== false) {
		tiers.push({
			name: "chrome-nano",
			adapter: chromeNanoAdapter(),
			filter: (_msgs, iOpts) => !iOpts?.tools || iOpts.tools.length === 0,
		} as Parameters<typeof cascadingLlmAdapter>[0][number]);
	}
	return cascadingLlmAdapter(tiers, opts.cascade);
}
