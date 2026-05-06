/**
 * Browser-only barrel for the extra surface.
 *
 * Consumers that need DOM-bound storage (`indexedDbKv`) or IDB helpers
 * import from `@graphrefly/graphrefly/extra/browser`. The universal
 * `@graphrefly/graphrefly/extra` entry stays DOM-free.
 *
 * @module
 */

export { fromIDBRequest, fromIDBTransaction } from "./storage-browser.js";
export {
	type IndexedDbBackendSpec,
	indexedDbAppendLog,
	indexedDbBackend,
	indexedDbKv,
	indexedDbSnapshot,
} from "./storage-tiers-browser.js";
