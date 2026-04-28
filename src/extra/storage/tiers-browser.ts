/**
 * Browser-only storage tier backends — `indexedDbKv`, etc.
 *
 * Re-exports from `../storage-tiers-browser.js` (deferred physical move per
 * the consolidation plan §2).
 *
 * **Browser-only** — relies on DOM globals. Consume from
 * `@graphrefly/graphrefly/extra/browser`.
 */

export * from "../storage-tiers-browser.js";
