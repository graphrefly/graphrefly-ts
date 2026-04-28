/**
 * Higher-order operators — operators whose project fn returns a Node.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	concatMap,
	exhaustMap,
	flatMap,
	type MergeMapOptions,
	mergeMap,
	switchMap,
} from "./index.js";
