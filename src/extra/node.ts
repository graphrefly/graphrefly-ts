/**
 * Node-only barrel for the extra surface.
 *
 * Consumers that need filesystem sources (`fromFileChange`, `fromGlob`) or
 * Node-only storage backends (`fileStorage`, `sqliteStorage`) import from
 * `@graphrefly/graphrefly/extra/node`. The universal `@graphrefly/graphrefly/extra`
 * entry stays browser-safe.
 *
 * @module
 */

export type { FromGitHookOptions, GitEvent, GitHookType } from "./git-hook.js";
export { fromGitHook } from "./git-hook.js";
export * from "./sources-fs.js";
export { fileStorage, sqliteStorage } from "./storage-node.js";
