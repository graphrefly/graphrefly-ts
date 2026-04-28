/**
 * Time-aware operators — debounce, throttle, sample, audit, delay, interval, timeout.
 *
 * Re-exports from `./index.js` (the consolidated operators source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	audit,
	debounce,
	debounceTime,
	delay,
	interval,
	sample,
	type ThrottleOptions,
	throttle,
	throttleTime,
	timeout,
} from "./index.js";
