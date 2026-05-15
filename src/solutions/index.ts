/**
 * Solutions — curated headline-product barrel.
 *
 * The front door for "I want a recipe." Re-exports headline factories from
 * presets so consumers can import from one place without knowing which preset
 * sub-domain each factory lives in.
 *
 * Verticals (solutions/<vertical>/) are deferred per D202 — added when
 * consumer pressure justifies a bundled vertical starter kit.
 *
 * @module
 */

export { agentLoop } from "../presets/ai/agent-loop.js";
export { agentMemory } from "../presets/ai/agent-memory.js";
export { harnessLoop } from "../presets/harness/harness-loop.js";
export { refineLoop } from "../presets/harness/refine-loop.js";
export { spawnable } from "../presets/harness/spawnable.js";
export { guardedExecution } from "../presets/inspect/guarded-execution.js";
export { resilientPipeline } from "../presets/resilience/resilient-pipeline.js";
