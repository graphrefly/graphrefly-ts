/**
 * GraphRefly — public API surface.
 */
export const version = "0.0.0";

export * from "./compat/index.js";
export * as compat from "./compat/index.js";
// Named re-exports enable finer-grained tree-shaking for consumers.
export * from "./core/index.js";
// Keep namespace exports for ergonomic grouped imports.
export * as core from "./core/index.js";
export * from "./extra/index.js";
export * as extra from "./extra/index.js";
export * from "./graph/index.js";
export * as graph from "./graph/index.js";
// Top-level convenience re-exports of the AI adapter types so downstream
// packages (MCP server, CLI, userland) can `import type { LLMAdapter }`
// without reaching into the `patterns.ai` namespace.
export type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
	ToolCall,
	ToolDefinition,
} from "./patterns/ai/adapters/core/types.js";
export * from "./patterns/index.js";
export * as patterns from "./patterns/index.js";
