/**
 * Filesystem sources (Node-only). Re-exports from `./fs-root.js`.
 *
 * Importing this sub-file pulls a Node builtin transitively; only consume from
 * `@graphrefly/graphrefly/base/sources/node` and not from the browser-safe
 * `@graphrefly/graphrefly/base/sources` barrel.
 */

export * from "./fs-root.js";
