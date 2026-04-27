/**
 * Node-only barrel for the extra surface.
 *
 * Consumers that need filesystem sources (`fromFileChange`, `fromGlob`) or
 * Node-only storage backends (`fileKv`, `sqliteKv`) import from
 * `@graphrefly/graphrefly/extra/node`. The universal `@graphrefly/graphrefly/extra`
 * entry stays browser-safe.
 *
 * @module
 */

export type { FromGitHookOptions, GitEvent, GitHookType } from "./git-hook.js";
export { fromGitHook } from "./git-hook.js";
export * from "./sources-fs.js";
export {
	type FromSpawnOptions,
	fromSpawn,
	runProcess,
	type SpawnEvent,
} from "./sources-process.js";
export {
	fileAppendLog,
	fileBackend,
	fileKv,
	fileSnapshot,
	sqliteAppendLog,
	sqliteBackend,
	sqliteKv,
	sqliteSnapshot,
} from "./storage-tiers-node.js";
