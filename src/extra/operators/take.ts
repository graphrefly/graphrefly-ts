/**
 * Take/skip operators — bounded subsets of a stream.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	elementAt,
	find,
	first,
	last,
	skip,
	take,
	takeUntil,
	takeWhile,
} from "./index.js";
