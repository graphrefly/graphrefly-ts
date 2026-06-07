/**
 * @graphrefly/graphrefly — legacy presentation layer for the GraphReFly reactive graph protocol.
 *
 * Migration note (clean-slate D32/D40/D41): the current TypeScript implementation is
 * `@graphrefly/ts`. This root package still re-exports the frozen `@graphrefly/pure-ts`
 * reference because many presentation modules in `src/base`, `src/utils`, `src/presets`,
 * `src/solutions`, and `src/compat` still depend on old GraphSpec / Actor / factoryTag /
 * attachSnapshotStorage-era shapes. Keep those bindings explicit until each surface is
 * rebased onto `@graphrefly/ts`; do not add new substrate work here or in `pure-ts`.
 *
 * Clean-slate entrypoint: @graphrefly/ts
 * Legacy node-only subpath: @graphrefly/graphrefly/base/sources/node
 * Legacy browser-only subpath: @graphrefly/graphrefly/base/sources/browser
 * Legacy compat per-framework: @graphrefly/graphrefly/compat/<framework>
 *
 * @module
 */

// 1. Substrate — node, state, graph, extra (operators, data-structures, storage, sources)
export * from "@graphrefly/pure-ts";

// 2. Presentation layers (top-down per 4-layer model; CI-enforced by Biome layer-boundary rule)
export * from "./base/index.js";
export * from "./presets/index.js";
export * from "./solutions/index.js";
export * from "./utils/index.js";
// compat is namespaced; import from @graphrefly/graphrefly/compat/<framework>
