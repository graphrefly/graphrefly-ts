/**
 * Event-shaped sources — DOM events, timers, raf, cron.
 *
 * Re-exports from `./index.js` (the consolidated sources source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	type EventTargetLike,
	type FromCronOptions,
	fromCron,
	fromEvent,
	fromRaf,
	fromTimer,
} from "./index.js";
