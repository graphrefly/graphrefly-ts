/**
 * Central gate-state vocabulary for resilience primitives.
 *
 * **DS-13.5.B follow-on (locked 2026-05-01).** Two-state base enum
 * (`"open" | "closed"`) used as the literal vocabulary inside
 * gate-shaped `<Primitive>State` companions on `budgetGate`. Other
 * primitives extend this base with primitive-specific values:
 *
 * - `rateLimiter` → `GateState | "throttled"`.
 * - `circuitBreaker` → `GateState | "half-open"`.
 *
 * Keeping the base as a separate exported type lets callers narrow
 * generic gate-state consumers without coupling to any one primitive's
 * extension axis.
 *
 * @category extra/resilience
 */
export type GateState = "open" | "closed";
