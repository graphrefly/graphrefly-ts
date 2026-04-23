/**
 * Browser-only surface for the AI patterns package.
 *
 * Re-exports browser-native adapters (`webllmAdapter`, `chromeNanoAdapter`)
 * and curated cascade presets that compose them (`cloudFirstPreset`,
 * `localFirstPreset`, `offlinePreset`). Import from
 * `@graphrefly/graphrefly/patterns/ai/browser` in a browser bundle to opt
 * into these; the universal `@graphrefly/graphrefly/patterns/ai` entry does
 * not pull them, so Node bundles stay lean.
 *
 * @module
 */

export * from "./adapters/providers/browser/index.js";
export * from "./adapters/routing/browser-presets.js";
