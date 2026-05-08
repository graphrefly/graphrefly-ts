/**
 * LLM adapter layer (roadmap §9.3d).
 *
 * Layout:
 *   - `core/`       — types, pricing, capabilities, observable, factory
 *   - `providers/`  — Anthropic, OpenAI-compat, Google, DryRun
 *   - `providers/browser/` — WebLLM, ChromeNano (browser-only, import separately)
 *   - `middleware/` — budget-gate, rate-limiter, replay-cache, retry, timeout, breaker, dry-run
 *   - `routing/`    — cascadingLlmAdapter, presets
 *
 * The library ships zero pricing / capability data. Users populate registries
 * with their own data; the library provides the shape + composition primitives.
 */

export * from "./core/index.js";
export * from "./middleware/index.js";
export * from "./providers/index.js";
export * from "./routing/index.js";
