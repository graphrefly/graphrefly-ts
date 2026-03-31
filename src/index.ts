/**
 * GraphRefly — public API surface.
 */
export const version = "0.0.0";

export * from "./compat/index.js";
export * as compat from "./compat/index.js";
// Named re-exports enable finer-grained tree-shaking for consumers.
export * from "./core/index.js";
// Keep namespace exports for ergonomic grouped imports.
export * as core from "./core/index.js";
export * from "./extra/index.js";
export * as extra from "./extra/index.js";
export * from "./graph/index.js";
export * as graph from "./graph/index.js";
export * from "./patterns/index.js";
export * as patterns from "./patterns/index.js";
