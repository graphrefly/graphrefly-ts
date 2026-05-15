/**
 * Inspect — graph observability primitives + presets (Tier 9.1 γ-form γ-ii merge).
 *
 * Merges the former `patterns/audit/`, `patterns/lens/`, and
 * `patterns/guarded-execution/` folders into a single domain. Sub-files
 * preserve the legacy folder boundaries for clarity, then export through this
 * barrel.
 *
 * Building blocks (this barrel + sub-files):
 *  - `auditTrail` / `policyGate` / `complianceSnapshot` / `explainPath` —
 *    audit + policy + causal explainability primitives.
 *  - `graphLens` / `computeHealthReport` / `healthReportEqual` /
 *    `watchTopologyTree` — topology-driven health and flow views.
 *  - `guardedExecution` / `GuardedExecutionGraph` — actor-scoped wrapper
 *    that enforces / audits guards on a target graph.
 *
 * Presets (`./presets/inspect.ts`):
 *  - `inspect()` — `lens + auditTrail + explain (facade) + complianceSnapshot()`
 *    composition (Tier 9.1 γ-form Q5-6 medium scope). Mounts `graphLens`
 *    internally rather than rebuilding `health` / `flow`.
 *
 * @module
 */

export * from "../../presets/inspect/composite.js";
export * from "../../presets/inspect/guarded-execution.js";
export * from "./audit.js";
export * from "./lens.js";
