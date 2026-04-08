/**
 * Harness wiring (roadmap §9.0).
 *
 * Reactive collaboration loop: static-topology, flowing data.
 * Composes orchestration (gate), AI (promptNode), reduction (scorer/stratify),
 * and messaging (TopicGraph/bridge) into a 7-stage loop.
 *
 * @module
 */

export * from "./bridge.js";
export * from "./loop.js";
export * from "./profile.js";
export * from "./strategy.js";
export * from "./types.js";
