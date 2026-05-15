/**
 * GraphRefly pure-TS substrate — public API surface (cleave A2, 2026-05-14).
 *
 * Exports only the substrate layers:
 * - core/ (message protocol, node primitive, batch, sugar constructors)
 * - graph/ (Graph container, describe/observe, snapshot)
 * - extra/ (operators, data-structures, storage, stratify, sync sources, fromTimer, keepalive)
 *
 * Presentation APIs (patterns/, compat/, extra/io, extra/render, extra/mutation,
 * extra/resilience, extra/sources/async, extra/sources/settled, etc.) moved to
 * @graphrefly/graphrefly (root src/).
 */
export const version = "0.0.0";

// Named re-exports enable finer-grained tree-shaking for consumers.
export * from "./core/index.js";
// Keep namespace exports for ergonomic grouped imports.
export * as core from "./core/index.js";
export * from "./extra/index.js";
export * as extra from "./extra/index.js";
export * from "./graph/index.js";
export * as graph from "./graph/index.js";
