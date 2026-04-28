/**
 * Buffer/window operators — group emissions into batches.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	buffer,
	bufferCount,
	bufferTime,
	window,
	windowCount,
	windowTime,
} from "./index.js";
