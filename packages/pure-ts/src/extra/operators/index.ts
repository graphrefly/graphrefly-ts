/**
 * Tier 1 sync operators (roadmap §2.1) and Tier 2 async/dynamic operators
 * (roadmap §2.2).
 *
 * Thin barrel — every operator lives in a category sub-file:
 * - `transform.ts` — `map`, `filter`, `scan`, `reduce`,
 *   `distinctUntilChanged`, `pairwise`
 * - `take.ts` — `take`, `skip`, `takeWhile`, `takeUntil`, `first`, `last`,
 *   `find`, `elementAt`
 * - `combine.ts` — `combine` / `combineLatest`, `withLatestFrom`, `merge`,
 *   `zip`, `concat`, `race`
 * - `higher-order.ts` — `switchMap`, `exhaustMap`, `concatMap`,
 *   `mergeMap` / `flatMap`
 * - `time.ts` — `delay`, `debounce` / `debounceTime`, `throttle` /
 *   `throttleTime`, `sample`, `audit`, `interval`
 * - `buffer.ts` — `buffer`, `bufferCount`, `bufferTime`, `window`,
 *   `windowCount`, `windowTime`
 * - `control.ts` — `valve`, `rescue` / `catchError`, `pausable`, `repeat`,
 *   `tap`, `onFirstData` / `tapFirst`, `timeout`
 * - `_internal.ts` — shared `operatorOpts` / `partialOperatorOpts` /
 *   `gatedOperatorOpts` helpers and `ExtraOpts` alias.
 */

export * from "./buffer.js";
export * from "./combine.js";
export * from "./control.js";
export * from "./higher-order.js";
export * from "./take.js";
export * from "./time.js";
export * from "./transform.js";
