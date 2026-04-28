/**
 * Circuit breaker — open/half-open/closed state machine + companion bundle.
 *
 * Re-exports from `./index.js` (the consolidated resilience source). Sub-file
 * exists for category-level discoverability per the consolidation plan §2;
 * physical code split deferred.
 */

export {
	type CircuitBreaker,
	type CircuitBreakerOptions,
	CircuitOpenError,
	type CircuitState,
	circuitBreaker,
	type WithBreakerBundle,
	withBreaker,
} from "./index.js";
