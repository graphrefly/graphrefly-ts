/**
 * Node-only barrel for the extra substrate surface.
 *
 * Consumers that need Node-only storage backends (`fileKv`, `sqliteKv`) import
 * from `@graphrefly/pure-ts/extra/node`. The universal `@graphrefly/pure-ts/extra`
 * entry stays browser-safe.
 *
 * Presentation-layer Node sources (fromGitHook, fromFSWatch, fromSpawn) are
 * in `@graphrefly/graphrefly/extra/node` (root shim), not here.
 *
 * @module
 */

export {
	fileAppendLog,
	fileBackend,
	fileKv,
	fileSnapshot,
	sqliteAppendLog,
	sqliteBackend,
	sqliteKv,
	sqliteSnapshot,
} from "./storage/tiers-node.js";
