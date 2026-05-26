/**
 * GraphRefly pure-TS substrate — public API surface (cleave A2, 2026-05-14).
 *
 * Exports only the substrate layers:
 * - core/ (message protocol, node primitive, batch, sugar constructors)
 * - graph/ (Graph container, describe/observe, snapshot)
 * - extra/ (operators, data-structures, storage, stratify, sync sources, fromTimer, keepalive)
 *
 * Presentation APIs (base/, utils/, presets/, solutions/, compat/) live in
 * `@graphrefly/graphrefly` (repo root `src/`).
 */
/**
 * Package version. Build-time injected from `package.json` via the tsup
 * `define` for `process.env.GRAPHREFLY_PKG_VERSION` (D4) so there is one
 * source of truth. Unbuilt source consumers (parity-tests' src alias,
 * evals' tsx) see `"0.0.0-dev"` — an honest "running unbuilt source"
 * sentinel, not a misleading real-looking `"0.0.0"`.
 */
export const version: string = process.env.GRAPHREFLY_PKG_VERSION ?? "0.0.0-dev";

// Named re-exports enable finer-grained tree-shaking for consumers.
export * from "./core/index.js";
// Keep namespace exports for ergonomic grouped imports.
export * as core from "./core/index.js";
export * from "./extra/index.js";
export * as extra from "./extra/index.js";
export * from "./graph/index.js";
export * as graph from "./graph/index.js";
