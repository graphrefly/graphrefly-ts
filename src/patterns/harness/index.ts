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
// `effectivenessTracker` was deleted per Class B audit Alt E (2026-04-30).
// The shared substrate now lives in `extra/composition/audited-success-tracker.ts`
// — re-exported via `@graphrefly/graphrefly-ts/extra` for general use. The
// (zero-consumer) `effectivenessTracker(opts?)` factory shape was not retained.
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
