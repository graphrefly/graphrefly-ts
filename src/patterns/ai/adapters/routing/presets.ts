/**
 * Curated `cascadingLlmAdapter` presets — Node/browser-safe subset.
 *
 * Thin compositions over `cascadingLlmAdapter` + `createAdapter`. No new
 * logic — just convenient defaults. Users needing finer control call
 * `cascadingLlmAdapter` directly.
 *
 * Presets that depend on browser-only adapters (WebLLM, Chrome Nano) have
 * been split out to [`./browser-presets.ts`](./browser-presets.ts) and are
 * exported from the `@graphrefly/graphrefly/patterns/ai/browser-presets`
 * subpath so they don't leak into Node bundles.
 *
 * @module
 */

import type { LLMAdapter } from "../core/types.js";
import { dryRunAdapter } from "../providers/dry-run.js";

// ---------------------------------------------------------------------------
// Dry-run-only preset — zero wire calls, deterministic responses
// ---------------------------------------------------------------------------

export function dryRunPreset(): LLMAdapter {
	return dryRunAdapter();
}
