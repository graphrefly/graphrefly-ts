/**
 * Node-only storage tier backends — `fileKv`, `sqliteKv`, etc.
 *
 * Re-exports from `../storage-tiers-node.js` (deferred physical move per the
 * consolidation plan §2).
 *
 * **Node-only** — pulls Node builtins. Consume from
 * `@graphrefly/graphrefly/extra/node`.
 */

export * from "../storage-tiers-node.js";
