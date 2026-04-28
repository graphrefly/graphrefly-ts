/**
 * HTTP IO — `fromHTTP` / `toHTTP` and friends.
 *
 * Re-exports from `./index.js` (the consolidated io source). Sub-file exists
 * for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	type FromHTTPOptions,
	type FromHTTPPollOptions,
	type FromHTTPStreamOptions,
	fromHTTP,
	fromHTTPPoll,
	fromHTTPStream,
	type HTTPBundle,
	type ToHTTPOptions,
	toHTTP,
} from "./index.js";
