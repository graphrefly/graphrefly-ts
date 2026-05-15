/**
 * Node-only surface for the AI patterns package.
 *
 * Re-exports the Node-specific `fallbackAdapter` variant (with filesystem
 * convenience options like `fixturesDir` / `record.dir`). Import from
 * `@graphrefly/graphrefly/patterns/ai/node` in Node environments when you
 * want those ergonomics; otherwise the universal `@graphrefly/graphrefly/patterns/ai`
 * entry covers everything without `node:*` imports.
 *
 * @module
 */

export {
	type BaseFallbackAdapterOptions,
	type FallbackFixture,
	type FallbackMissError,
	type FallbackMissPolicy,
	fallbackAdapter,
	type NodeFallbackAdapterOptions,
} from "./adapters/providers/fallback-node.js";
