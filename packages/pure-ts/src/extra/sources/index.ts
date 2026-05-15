/**
 * Substrate sources barrel (cleave A2, 2026-05-14).
 *
 * Exports substrate-only sources after the cleave:
 * - sync/iter (fromIter, of, empty, never, throwError)
 * - event/timer (fromTimer)
 * - _internal (NodeInput, AsyncSourceOpts, etc.)
 *
 * Presentation sources (async, settled, fromCron, fromEvent, fromRaf,
 * singleFromAny, keepalive, reactiveCounter) moved to root src/base/sources/.
 */

// DO NOT re-export ./git.js or ./fs.js here — they are Node-only and were
// moved to root src/base/sources/node/ as presentation sources.

// Substrate shared types — stay in pure-ts
export {
	type AsyncSourceOpts,
	escapeRegexChar,
	globToRegExp,
	matchesAnyPattern,
	type NodeInput,
} from "./_internal.js";
// keepalive — substrate (graph.ts depends on this)
export * from "./_keepalive.js";
// Async sources — substrate (higher-order operators depend on fromAny)
export * from "./async.js";
// Timer source — substrate
export * from "./event/timer.js";
// Sync sources — substrate
export * from "./sync/iter.js";
