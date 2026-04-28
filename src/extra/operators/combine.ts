/**
 * Combine operators — multi-source combinators.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	combine,
	combineLatest,
	concat,
	merge,
	race,
	withLatestFrom,
	zip,
} from "./index.js";
