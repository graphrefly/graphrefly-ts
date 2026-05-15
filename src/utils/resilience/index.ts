/**
 * Resilience utilities — roadmap §3.1 + §3.1c (retry, breaker, rate limit, status,
 * fallback, cache, timeout, budgetGate).
 *
 * This module is a thin barrel: domain-level primitives live in their own
 * sub-file (`breaker.ts`, `rate-limiter.ts`, `fallback.ts`, plus the
 * standalone `budget-gate.ts`). The zero-domain reactive operators
 * (`retry`, `withStatus`, `withTimeout`, backoff strategies, `NodeOrValue<T>`)
 * are base-layer — they live in `base/resilience/` and are re-surfaced here
 * so the resilience family ships through one barrel. The `resilientPipeline`
 * preset that composes these lives in `presets/resilience/`.
 */

// Zero-domain reactive operators — base-layer, re-surfaced here so the
// resilience family ships through one barrel.
export type { NodeOrValue } from "../../base/resilience/_internal.js";
export * from "../../base/resilience/retry.js";
export * from "../../base/resilience/status.js";
export * from "../../base/resilience/timeout.js";
export * from "./breaker.js";
// budgetGate lives in its own file per Tier 2.2 (promoted from
// patterns/reduction/) — re-export here so it ships through the barrel.
export {
	type BudgetConstraint,
	type BudgetConstraintSnapshot,
	type BudgetGateBundle,
	type BudgetGateOptions,
	type BudgetGateState,
	budgetGate,
} from "./budget-gate.js";
export * from "./fallback.js";
export type { GateState } from "./gate-state.js";
export * from "./rate-limiter.js";
