/**
 * Harness wiring (roadmap §9.0).
 *
 * Reactive collaboration loop: static-topology, flowing data.
 * Composes orchestration (gate), AI (promptNode), reduction (scorer/stratify),
 * and messaging (TopicGraph/bridge) into a 7-stage loop.
 *
 * @module
 */

export * from "./actuator-executor.js";
export * from "./auto-solidify.js";
export * from "./bridge.js";
export * from "./defaults.js";
// `effectivenessTracker` was demoted to a harness preset per Tier 2.3 — its
// only consumer was `strategy.ts`, so building-block status was unwarranted.
export * from "./effectiveness-tracker.js";
export * from "./eval-verifier.js";
// Tier 9.1 γ-form γ-β: presets live under `presets/`. `harnessLoop` and
// `refineLoop` are presets composing the building blocks above.
export * from "./presets/harness-loop.js";
export * from "./presets/refine-loop.js";
export * from "./profile.js";
export * from "./refine-executor.js";
export * from "./strategy.js";
export * from "./trace.js";
export * from "./types.js";
