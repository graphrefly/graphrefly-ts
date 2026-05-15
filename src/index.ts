/**
 * @graphrefly/graphrefly — presentation layer for the GraphReFly reactive graph protocol.
 *
 * This package composes:
 * 1. Substrate re-export from @graphrefly/pure-ts (ergonomic single-import: node,
 *    state, graph, derived, effect, produce, batch, operators, data-structures,
 *    storage, stratify, fromTimer, fromPromise, fromAsyncIter, fromAny, etc.)
 * 2. Presentation layers (base → utils → presets → solutions) — patterns, IO
 *    adapters, composition helpers, mutation wrappers, render, compat adapters.
 *
 * Peer dependency: @graphrefly/pure-ts (or @graphrefly/native via npm/pnpm overrides).
 * Q28 = option (c): users wanting @graphrefly/native install both and add:
 *   { "pnpm": { "overrides": { "@graphrefly/pure-ts": "npm:@graphrefly/native@^1" } } }
 *
 * Node-only subpath: @graphrefly/graphrefly/base/sources/node
 * Browser-only subpath: @graphrefly/graphrefly/base/sources/browser
 * Compat per-framework: @graphrefly/graphrefly/compat/<framework>
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
