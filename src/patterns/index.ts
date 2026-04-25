/**
 * Patterns layer: domain/solution helpers (Phase 4+).
 */

export * as ai from "./ai/index.js";
export * as accountability from "./audit/index.js";
export * as cqrs from "./cqrs/index.js";
export * as demoShell from "./demo-shell/index.js";
export * as domainTemplates from "./domain-templates/index.js";
export * as graphspec from "./graphspec/index.js";
export * as guarded from "./guarded-execution/index.js";
export * as harness from "./harness/index.js";
export * as jobQueue from "./job-queue/index.js";
export * as lens from "./lens/index.js";
export * as memory from "./memory/index.js";
export * as messaging from "./messaging/index.js";
export * as orchestration from "./orchestration/index.js";
export * as process from "./process/index.js";
export * as layout from "./reactive-layout/index.js";
export * as reduction from "./reduction/index.js";
export * as refine from "./refine-loop/index.js";
export * as resilientPipeline from "./resilient-pipeline/index.js";
// Surface layer (§9.3-core): top-level + namespaced. The surface is the
// entry point for @graphrefly/mcp-server and @graphrefly/cli, so named
// exports live at the root alongside `core`/`graph`/`extra` style.
export * from "./surface/index.js";
export * as surface from "./surface/index.js";
