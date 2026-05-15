/**
 * Filesystem sources (Node-only). Re-exports from `../sources-fs.js`.
 *
 * Importing this sub-file pulls a Node builtin transitively; only consume from
 * `@graphrefly/graphrefly/extra/node` (which re-exports the underlying file)
 * and not from the browser-safe `@graphrefly/graphrefly/extra` barrel.
 */

export * from "../sources-fs.js";
