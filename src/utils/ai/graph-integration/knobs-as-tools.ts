// ---------------------------------------------------------------------------
// 5.4 — LLM tool integration
// ---------------------------------------------------------------------------

import type { Actor } from "@graphrefly/pure-ts/core/actor.js";
import type { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import type { ToolDefinition } from "../adapters/core/types.js";

/** OpenAI function-calling tool schema. */
export type OpenAIToolSchema = {
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: Record<string, unknown>;
	};
};

/** MCP (Model Context Protocol) tool schema. */
export type McpToolSchema = {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
};

/** Result of {@link knobsAsTools}. */
export type KnobsAsToolsResult = {
	/** OpenAI function-calling tool schemas. */
	readonly openai: readonly OpenAIToolSchema[];
	/** MCP tool schemas. */
	readonly mcp: readonly McpToolSchema[];
	/** GraphReFly ToolDefinitions with handlers that call `graph.set()`. */
	readonly definitions: readonly ToolDefinition[];
};

/**
 * Build a JSON Schema `properties.value` descriptor from a node's meta fields.
 *
 * Maps `meta.type`, `meta.range`, `meta.values`, `meta.format`, and `meta.unit`
 * to a JSON Schema property definition.
 */
function metaToJsonSchema(meta: Record<string, unknown>): Record<string, unknown> {
	const schema: Record<string, unknown> = {};

	const metaType = meta.type as string | undefined;
	if (metaType === "enum" && Array.isArray(meta.values)) {
		schema.type = "string";
		schema.enum = meta.values;
	} else if (metaType === "integer") {
		schema.type = "integer";
	} else if (metaType === "number") {
		schema.type = "number";
	} else if (metaType === "boolean") {
		schema.type = "boolean";
	} else if (metaType === "string") {
		schema.type = "string";
	} else {
		// Unknown or unspecified — accept anything
		schema.type = ["string", "number", "boolean"];
	}

	if (Array.isArray(meta.range) && meta.range.length === 2) {
		schema.minimum = meta.range[0];
		schema.maximum = meta.range[1];
	}

	if (typeof meta.format === "string") {
		schema.description = `Format: ${meta.format}`;
	}

	if (typeof meta.unit === "string") {
		if (schema.description) {
			schema.description += ` (${meta.unit})`;
		} else {
			schema.description = `Unit: ${meta.unit}`;
		}
	}

	return schema;
}

/**
 * Derive tool schemas from a graph's writable (knob) nodes.
 *
 * Knobs are state nodes whose `meta.access` is `"llm"`, `"both"`, or absent
 * (default: writable). Each knob becomes a tool that calls `graph.set()`.
 *
 * Speaks **domain language** (spec §5.4): the returned schemas use node names
 * and meta descriptions — no protocol internals exposed.
 *
 * @param graph - The graph to introspect.
 * @param actor - Optional actor for guard-scoped describe.
 * @returns OpenAI, MCP, and GraphReFly tool schemas.
 */
export function knobsAsTools(graph: Graph, actor?: Actor): KnobsAsToolsResult {
	const described = graph.describe({ actor, detail: "full" });
	const openai: OpenAIToolSchema[] = [];
	const mcp: McpToolSchema[] = [];
	const definitions: ToolDefinition[] = [];

	for (const [path, node] of Object.entries(described.nodes)) {
		// Only state nodes are writable knobs
		if (node.type !== "state") continue;

		// Skip meta companion nodes (§2.3)
		if (path.includes("::__meta__::")) continue;

		// Skip terminal-state nodes (§1.3.4 — no further messages after COMPLETE/ERROR)
		if (node.status === "completed" || node.status === "errored") continue;

		// Skip if access explicitly excludes LLM
		const meta = node.meta ?? {};
		const access = meta.access as string | undefined;
		if (access === "human" || access === "system") continue;

		const description = (meta.description as string) ?? `Set the value of ${path}`;
		const valueSchema = metaToJsonSchema(meta);

		const parameterSchema: Record<string, unknown> = {
			type: "object",
			required: ["value"],
			properties: {
				value: valueSchema,
			},
			additionalProperties: false,
		};

		// OpenAI requires [a-zA-Z0-9_-] in function names; sanitize :: separators
		const sanitizedName = path.replace(/::/g, "__");

		openai.push({
			type: "function",
			function: {
				name: sanitizedName,
				description,
				parameters: parameterSchema,
			},
		});

		mcp.push({
			name: path,
			description,
			inputSchema: parameterSchema,
		});

		const graphRef = graph;
		const actorRef = actor;
		const nv = node.v;
		definitions.push({
			name: path,
			description,
			parameters: parameterSchema,
			handler(args: Record<string, unknown>) {
				graphRef.set(path, args.value, actorRef ? { actor: actorRef } : undefined);
				return args.value;
			},
			...(nv != null ? { version: { id: nv.id, version: nv.version } } : {}),
		});
	}

	return { openai, mcp, definitions };
}
