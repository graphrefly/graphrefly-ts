/**
 * Control operators — pausable, valve, rescue/catchError, repeat, tap, onFirstData/tapFirst.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	catchError,
	onFirstData,
	pausable,
	repeat,
	rescue,
	type TapObserver,
	tap,
	tapFirst,
	valve,
} from "./index.js";
