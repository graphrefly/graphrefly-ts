/**
 * Core reactive sources, sinks, and utilities (roadmap §2.3).
 *
 * Thin barrel — every API lives in a category sub-file:
 * - `iter.ts` — sync sources (`fromIter`, `of`, `empty`, `never`, `throwError`)
 * - `event.ts` — `fromTimer`, `fromRaf`, `fromCron`, `fromEvent`
 * - `async.ts` — Promise / AsyncIter / NodeInput bridges, `defer`, `forEach`,
 *   `share` / `replay` / `cached`, `singleFromAny` (re-export)
 * - `settled.ts` — `firstValueFrom`, `firstWhere`, `awaitSettled`, `nodeSignal`,
 *   `keepalive`, `reactiveCounter`
 * - `_internal.ts` — shared types (`AsyncSourceOpts`, `NodeInput`,
 *   `ExtraOpts`) and helpers (`escapeRegexChar`, `globToRegExp`,
 *   `matchesAnyPattern`, `wrapSubscribeHook`).
 *
 * Protocol/system/ingest adapters (fromHTTP, fromWebSocket, fromKafka, etc.)
 * live in {@link ../adapters.ts}.
 */

// `singleFromAny` / `singleNodeFromAny` live in extra/single-from-any.ts (kept
// independent because it imports `firstValueFrom` and would form a cycle if
// we re-exported via async.ts during eager-eval init).
export { singleFromAny, singleNodeFromAny } from "../single-from-any.js";
// Public type aliases sourced from `_internal.ts`. Keep `escapeRegexChar` /
// `globToRegExp` / `matchesAnyPattern` re-exported because `extra/adapters.ts`
// and `extra/sources-fs.ts` import them via this barrel.
export {
	type AsyncSourceOpts,
	escapeRegexChar,
	globToRegExp,
	matchesAnyPattern,
	type NodeInput,
} from "./_internal.js";
export * from "./async.js";
export * from "./event.js";
export * from "./iter.js";
export * from "./settled.js";
