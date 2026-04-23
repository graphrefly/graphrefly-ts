/**
 * Browser-only barrel for the extra surface.
 *
 * Consumers that need DOM-bound storage (`indexedDbStorage`) or IDB helpers
 * import from `@graphrefly/graphrefly/extra/browser`. The universal
 * `@graphrefly/graphrefly/extra` entry stays DOM-free.
 *
 * @module
 */

export {
	fromIDBRequest,
	fromIDBTransaction,
	type IndexedDbStorageSpec,
	indexedDbStorage,
} from "./storage-browser.js";
