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
export * from "./strategy.js";
export * from "./types.js";
