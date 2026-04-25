/**
 * AI surface patterns (roadmap §4.4).
 *
 * Domain-layer factories for LLM-backed agents, chat, tool registries, and
 * agentic memory. Composed from core + extra + Phase 3–4.3 primitives.
 *
 * This file is the public barrel — it re-exports symbols from the sibling
 * folders (`prompts/`, `extractors/`, `safety/`, `agents/`, `memory/`,
 * `graph-integration/`, and the existing `adapters/` tree). No implementation
 * code lives here; see each sibling folder for the actual primitives.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Adapter layer (§9.3d) — providers, middleware, routing primitives.
// Browser-only adapters (WebLLM, ChromeNano) stay behind the `patterns/ai/browser`
// subpath to keep Node bundles lean.
// ---------------------------------------------------------------------------

export * from "./adapters/core/capabilities.js";
export * from "./adapters/core/factory.js";
export * from "./adapters/core/observable.js";
export * from "./adapters/core/pricing.js";
export * from "./adapters/middleware/breaker.js";
export * from "./adapters/middleware/budget-gate.js";
export * from "./adapters/middleware/dry-run.js";
export * from "./adapters/middleware/http429-parser.js";
export * from "./adapters/middleware/rate-limiter.js";
export * from "./adapters/middleware/replay-cache.js";
export * from "./adapters/middleware/resilient-adapter.js";
export * from "./adapters/middleware/retry.js";
export * from "./adapters/middleware/timeout.js";
export * from "./adapters/providers/anthropic.js";
export * from "./adapters/providers/dry-run.js";
export * from "./adapters/providers/fallback.js";
export * from "./adapters/providers/google.js";
export * from "./adapters/providers/openai-compat.js";
export * from "./adapters/routing/cascading.js";

// ---------------------------------------------------------------------------
// Types — single source of truth lives in ./adapters/core/types.ts
// ---------------------------------------------------------------------------

export type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
	ToolCall,
	ToolDefinition,
} from "./adapters/core/types.js";

// ---------------------------------------------------------------------------
// Prompt primitives
// ---------------------------------------------------------------------------

export * from "./prompts/from-llm.js";
export * from "./prompts/frozen-context.js";
export * from "./prompts/prompt-node.js";
export * from "./prompts/streaming.js";
export * from "./prompts/system-prompt.js";

// ---------------------------------------------------------------------------
// Stream extractors (taps on streamingPromptNode.stream topics)
// ---------------------------------------------------------------------------

export * from "./extractors/cost-meter.js";
export * from "./extractors/keyword-flag.js";
export * from "./extractors/stream-extractor.js";
export * from "./extractors/tool-call.js";

// ---------------------------------------------------------------------------
// Content safety
// ---------------------------------------------------------------------------

export * from "./safety/content-gate.js";
export * from "./safety/redactor.js";

// ---------------------------------------------------------------------------
// Agents (chat, tools, multi-agent routing, main loop)
// ---------------------------------------------------------------------------

export * from "./agents/agent-loop.js";
export * from "./agents/chat-stream.js";
export * from "./agents/handoff.js";
export * from "./agents/tool-execution.js";
export * from "./agents/tool-registry.js";
export * from "./agents/tool-selector.js";

// ---------------------------------------------------------------------------
// Agentic memory (distill + vector + KG + tiers + retrieval)
// ---------------------------------------------------------------------------

export * from "./memory/admission.js";
export * from "./memory/agent-memory.js";
export * from "./memory/llm-memory.js";
export * from "./memory/memory-composers.js";
export * from "./memory/retrieval.js";
export * from "./memory/tiers.js";

// ---------------------------------------------------------------------------
// Graph ↔ LLM integration (knobs, gauges, spec round-trip)
// ---------------------------------------------------------------------------

export * from "./graph-integration/gauges-as-context.js";
export * from "./graph-integration/graph-from-spec.js";
export * from "./graph-integration/knobs-as-tools.js";
export * from "./graph-integration/suggest-strategy.js";
export * from "./graph-integration/validate-graph-def.js";
