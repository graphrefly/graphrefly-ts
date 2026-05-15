/**
 * Inspect — graph observability primitives (Tier 9.1 γ-form γ-ii merge).
 *
 * Merges the former `patterns/audit/` and `patterns/lens/` folders into a
 * single domain. Sub-files preserve the legacy folder boundaries for clarity,
 * then export through this barrel.
 *
 * Building blocks (this barrel + sub-files):
 *  - `auditTrail` / `policyGate` / `complianceSnapshot` / `explainPath` —
 *    audit + policy + causal explainability primitives.
 *  - `graphLens` / `computeHealthReport` / `healthReportEqual` /
 *    `watchTopologyTree` — topology-driven health and flow views.
 *
 * The `inspect()` and `guardedExecution()` presets that compose these
 * primitives live in `presets/inspect/` (exported via `presets/index.js`).
 *
 * @module
 */

export * from "./audit.js";
export * from "./lens.js";
