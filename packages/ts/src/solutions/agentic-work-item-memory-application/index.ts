/**
 * Cross-family WorkItem-to-AgenticMemory application composition recipes (D587).
 *
 * This namespace composes the mapper-only WorkItem-memory bridge with
 * AgenticMemory-owned admission and application helpers. It is intentionally
 * separate from `agentic-work-item-memory`, whose bridge remains mapper-only
 * under D581/D582, and from AgenticMemory core, which stays independent of
 * WorkItem types.
 */

export * from "./recipe.js";
export * from "./types.js";
