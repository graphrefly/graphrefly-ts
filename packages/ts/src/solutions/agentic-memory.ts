/**
 * Thin agentic-memory solution surface.
 *
 * D125 places vertical application kits under solutions, while D158 keeps
 * semantic-memory retrieval/ranking in horizontal patterns. This v0 bundle
 * composes those lower layers into graph-visible facts only: no agent runtime,
 * hidden scheduler, storage restore/hydration, LLM loop, or protocol behavior.
 */

export type {
	KnowledgeAssertion,
	KnowledgeAssertionObject,
	KnowledgeAssertionSubject,
} from "../patterns/semantic-memory.js";
export * from "./agentic-memory-bundle.js";
export * from "./agentic-memory-consolidation.js";
export * from "./agentic-memory-context-packing.js";
export * from "./agentic-memory-frame.js";
export * from "./agentic-memory-kg.js";
export * from "./agentic-memory-retention.js";
export * from "./agentic-memory-types.js";
