/**
 * Retry — re-attempt a node on terminal failure.
 *
 * Re-exports from `./index.js` (the consolidated resilience source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export { type RetryFactoryOptions, type RetryOptions, retry } from "./index.js";
