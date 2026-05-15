/**
 * Browser-only barrel for the extra substrate surface.
 *
 * Consumers that need DOM-bound storage (`indexedDbKv`) import
 * from `@graphrefly/pure-ts/extra/browser`. The universal
 * `@graphrefly/pure-ts/extra` entry stays DOM-free.
 *
 * Presentation-layer browser sources (fromEvent, fromRaf, fromIDBRequest,
 * fromIDBTransaction) are in `@graphrefly/graphrefly/extra/browser`
 * (root shim), not here.
 *
 * @module
 */

export {
	type IndexedDbBackendSpec,
	indexedDbAppendLog,
	indexedDbBackend,
	indexedDbKv,
	indexedDbSnapshot,
} from "./storage/tiers-browser.js";
