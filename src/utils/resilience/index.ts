/**
 * Resilience utilities — roadmap §3.1 + §3.1c (retry, breaker, rate limit, status,
 * fallback, cache, timeout, budgetGate).
 *
 * This module is a thin barrel: every primitive lives in its own sub-file
 * (`retry.ts`, `breaker.ts`, `rate-limiter.ts`, `fallback.ts`, `status.ts`,
 * `timeout.ts`, plus the standalone `budget-gate.ts`, `resilient-pipeline.ts`,
 * and `backoff.ts` shim). Shared helpers + `NodeOrValue<T>` live in
 * `_internal.ts` and are re-surfaced here.
 */

// resilientPipeline preset — moved from patterns/resilient-pipeline/ per
// Tier 9.1 γ-form γ-R-2 (semantically belongs with the resilience family,
// not under ai/).
export {
	ResilientPipelineGraph,
	type ResilientPipelineOptions,
	resilientPipeline,
} from "../../presets/resilience/resilient-pipeline.js";
// `NodeOrValue<T>` — the reactive-option type alias used by every primitive
// in this folder. Sourced from `_internal.ts` so all sub-files share one
// definition.
export type { NodeOrValue } from "./_internal.js";
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
export * from "./retry.js";
export * from "./status.js";
export * from "./timeout.js";
