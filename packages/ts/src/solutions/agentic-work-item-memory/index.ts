/**
 * AgenticMemory x WorkItem mapper bridge recipe namespace (D581/D582).
 *
 * The bridge is DATA-only and mapper-only: it emits generic ScoreSignal and
 * AgenticMemoryRecordProposal facts plus bridge-local read models. It does not
 * admit/apply proposals, mutate WorkItems or AgenticMemoryRecord truth, own
 * scoring semantics, or carry provider/runtime/storage/hydration authority.
 */

export * from "./bridge.js";
export * from "./types.js";
