/**
 * Async sources — Promise / AsyncIterable / NodeInput → Node bridges.
 *
 * Re-exports from `./index.js` (the consolidated sources source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

// singleFromAny family lives in extra/single-from-any.ts (kept independent).
export { singleFromAny, singleNodeFromAny } from "../single-from-any.js";
export {
	type AsyncSourceOpts,
	awaitSettled,
	cached,
	defer,
	firstValueFrom,
	firstWhere,
	forEach,
	fromAny,
	fromAsyncIter,
	fromPromise,
	type NodeInput,
	replay,
	share,
	shareReplay,
	throwError,
	toArray,
} from "./index.js";
