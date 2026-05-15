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
 * Peer dependency: @graphrefly/pure-ts.
 *
 * NOTE (2026-05-15): the install-time `@graphrefly/native` drop-in via
 * `overrides` (Q28 = option (c), D198) is NOT functional today and is
 * design-pending. `@graphrefly/native`'s napi surface is irreducibly
 * async (Core on a tokio blocking pool; sync calls deadlock — D070/D077),
 * while this presentation package consumes pure-ts's SYNC public API
 * (sync `node()/state()/map()`, sync `.cache` at construction, sync
 * `.subscribe/.emit/.down`). A `@graphrefly/pure-ts`→`@graphrefly/native`
 * override would therefore break every substrate call. The only
 * documented coherent path is D080 (async-everywhere public API across
 * all siblings), which is itself deferred to near-1.0 and was never
 * reconciled with the Q28/D198 overrides framing. Until that design
 * session lands, `@graphrefly/pure-ts` is the only working substrate
 * provider; `@graphrefly/native` is a parity-test arm, not a consumable
 * drop-in. See `docs/optimizations.md` "Native substrate contract
 * (D080 ↔ Q28/D198 unreconciled)".
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
