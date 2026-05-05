/**
 * Reactive data-structures barrel — keyed maps, positional lists, append-only
 * logs, and secondary indexes.
 *
 * Per the consolidation plan §2, this folder gathers the existing
 * `reactive-*` files for category-level discoverability. Physical files
 * remain at `src/extra/reactive-{map,list,log,index}.ts` (deferred move).
 *
 * `reactiveSink` is intentionally NOT included here — it is a network sink
 * primitive and lives in `extra/io/sink.ts`.
 */

export * from "./change.js";
export * from "./log-ops.js";
export * from "./reactive-index.js";
export * from "./reactive-list.js";
export * from "./reactive-log.js";
export * from "./reactive-map.js";
