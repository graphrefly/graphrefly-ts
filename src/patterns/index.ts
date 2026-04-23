/**
 * Patterns layer: domain/solution helpers (Phase 4+).
 */

export * as ai from "./ai.js";
export * as accountability from "./audit.js";
export * as cqrs from "./cqrs.js";
export * as demoShell from "./demo-shell.js";
export * as domainTemplates from "./domain-templates.js";
export * as graphspec from "./graphspec.js";
export * as guarded from "./guarded-execution.js";
export * as harness from "./harness/index.js";
export * as lens from "./lens.js";
export * as memory from "./memory.js";
export * as messaging from "./messaging.js";
export * as orchestration from "./orchestration.js";
export * as layout from "./reactive-layout/index.js";
export * as reduction from "./reduction.js";
export * as refine from "./refine-loop.js";
export * as resilientPipeline from "./resilient-pipeline.js";
// Surface layer (§9.3-core): top-level + namespaced. The surface is the
// entry point for @graphrefly/mcp-server and @graphrefly/cli, so named
// exports live at the root alongside `core`/`graph`/`extra` style.
export * from "./surface/index.js";
export * as surface from "./surface/index.js";
