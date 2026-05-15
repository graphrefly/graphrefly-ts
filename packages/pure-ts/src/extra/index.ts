/**
 * Extra layer — substrate-only universal barrel (cleave A2, 2026-05-14).
 *
 * After the cleave, @graphrefly/pure-ts/extra exports substrate-only APIs
 * that are browser + Node safe (no `node:*` builtins, no DOM globals):
 * - operators (protocol-level transforms)
 * - data-structures (reactiveMap, reactiveList, reactiveLog, reactiveIndex)
 * - storage/core (StorageHandle, jsonCodec, etc.)
 * - storage/tiers (memoryBackend, memorySnapshot, memoryKv, memoryAppendLog)
 * - storage/wal (walFrameChecksum, etc.)
 * - storage/cascading-cache (cascadingCache)
 * - storage/content-addressed (contentAddressedStorage, canonicalJson)
 * - composition/stratify (reactive branch routing)
 * - composition/topology-diff (topologyDiff, DescribeChangeset)
 * - composition/pubsub (pubsub, PubSubHandle)
 * - sources/sync (fromIter, of, empty, never, throwError)
 * - sources/event/timer (fromTimer)
 * - sources/async (fromPromise, fromAsyncIter, fromAny)
 * - sources/_keepalive (keepalive)
 * - sources/_internal types (NodeInput, AsyncSourceOpts)
 *
 * Node-only APIs: @graphrefly/pure-ts/extra/node (file/sqlite storage tiers)
 * Browser-only APIs: @graphrefly/pure-ts/extra/browser (IndexedDB storage tiers)
 * Presentation APIs: @graphrefly/graphrefly (root src/)
 */

// Composition — substrate only (stratify + topology-diff + pubsub)
export * from "./composition/pubsub.js";
export * from "./composition/stratify.js";
export * from "./composition/topology-diff.js";
// Data structures — substrate
export * from "./data-structures/index.js";
// Operators — substrate
export * from "./operators/index.js";
export {
	type AsyncSourceOpts,
	escapeRegexChar,
	globToRegExp,
	matchesAnyPattern,
	type NodeInput,
} from "./sources/_internal.js";
export * from "./sources/_keepalive.js";
export * from "./sources/async.js";
export * from "./sources/event/timer.js";
// Sources — substrate (sync + async + timer + keepalive)
export * from "./sources/sync/iter.js";
export * from "./storage/cascading-cache.js";
export * from "./storage/content-addressed.js";
// Storage — substrate (universal: core + memory tiers + WAL + cascading + content-addressed)
// NOTE: tiers-node.js and tiers-browser.js are NOT included here (use /extra/node and /extra/browser)
export * from "./storage/core.js";
export * from "./storage/tiers.js";
export * from "./storage/wal.js";
