/**
 * Status wrapper — surface lifecycle state alongside output.
 *
 * Re-exports from `./index.js` (the consolidated resilience source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export { type StatusValue, type WithStatusBundle, withStatus } from "./index.js";
