/**
 * Fallback — replace upstream ERROR with a static or computed source.
 *
 * Re-exports from `./index.js` (the consolidated resilience source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export { type FallbackInput, fallback } from "./index.js";
