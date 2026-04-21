/**
 * Curated `cascadingLlmAdapter` presets.
 *
 * Thin compositions over `cascadingLlmAdapter` + `createAdapter`. No new
 * logic — just convenient defaults for common deployment patterns.
 * Users needing finer control call `cascadingLlmAdapter` directly.
 */

import { createAdapter } from "../core/factory.js";
import type { LLMAdapter } from "../core/types.js";
import { chromeNanoAdapter } from "../providers/browser/chrome-nano.js";
import { webllmAdapter } from "../providers/browser/webllm.js";
import { dryRunAdapter } from "../providers/dry-run.js";
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

// ---------------------------------------------------------------------------
// Dry-run-only preset — zero wire calls, deterministic responses
// ---------------------------------------------------------------------------

export function dryRunPreset(): LLMAdapter {
	return dryRunAdapter();
}
