/**
 * Transform operators — pure value-level mappings.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	distinctUntilChanged,
	filter,
	map,
	pairwise,
	reduce,
	scan,
} from "./index.js";
