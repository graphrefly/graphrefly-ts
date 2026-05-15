/**
 * Git hook source (Node-only). Re-exports from `../git-hook.js`.
 *
 * Importing this sub-file may pull a Node builtin transitively; only consume
 * from `@graphrefly/graphrefly/extra/node` and not from the browser-safe
 * `@graphrefly/graphrefly/extra` barrel.
 */

export type { FromGitHookOptions, GitEvent, GitHookType } from "./git-hook.js";
export { fromGitHook } from "./git-hook.js";
