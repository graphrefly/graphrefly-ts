/**
 * Patterns layer: domain/solution helpers (Phase 4+).
 */

export * as ai from "./ai/index.js";
export * as cqrs from "./cqrs/index.js";
export * as demoShell from "./demo-shell/index.js";
export * as domainTemplates from "./domain-templates/index.js";
export * as graphspec from "./graphspec/index.js";
export * as harness from "./harness/index.js";
// `inspect` (Tier 9.1 γ-form γ-ii): merged from `audit/` + `lens/` +
// `guarded-execution/`. The legacy `accountability` / `lens` / `guarded`
// namespaces were dropped pre-1.0; consumers reach the same primitives via
// `inspect.<thing>`.
export * as inspect from "./inspect/index.js";
export * as jobQueue from "./job-queue/index.js";
export * as memory from "./memory/index.js";
export * as messaging from "./messaging/index.js";
export * as orchestration from "./orchestration/index.js";
export * as process from "./process/index.js";
export * as layout from "./reactive-layout/index.js";
export * as reduction from "./reduction/index.js";
// `resilientPipeline` was moved to `extra/resilience/` per Tier 9.1 γ-R-2 —
// reach it via `import { resilientPipeline } from "@graphrefly/graphrefly/extra"`.
// `refine` (refineLoop) was moved to `harness/presets/refine-loop.ts` per
// Tier 9.1 γ-β; reach it via `harness.refineLoop`.
// Surface layer (§9.3-core): top-level + namespaced. The surface is the
// entry point for @graphrefly/mcp-server and @graphrefly/cli, so named
// exports live at the root alongside `core`/`graph`/`extra` style.
export * from "./surface/index.js";
export * as surface from "./surface/index.js";
export * as topologyView from "./topology-view/index.js";
