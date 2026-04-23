import type { Node } from "../../../core/node.js";
import { derived, state } from "../../../core/sugar.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import { keepalive } from "../../_internal.js";
import { aiMeta, resolveToolHandlerResult } from "../_internal.js";
import type { ToolDefinition } from "../adapters/core/types.js";

// ---------------------------------------------------------------------------
// toolRegistry
// ---------------------------------------------------------------------------

export type ToolRegistryOptions = {
	graph?: GraphOptions;
};

export class ToolRegistryGraph extends Graph {
	readonly definitions: Node<ReadonlyMap<string, ToolDefinition>>;
	readonly schemas: Node<readonly ToolDefinition[]>;

	constructor(name: string, opts: ToolRegistryOptions = {}) {
		super(name, opts.graph);

		this.definitions = state<ReadonlyMap<string, ToolDefinition>>(new Map(), {
			name: "definitions",
			describeKind: "state",
			meta: aiMeta("tool_definitions"),
		});
		this.add(this.definitions, { name: "definitions" });

		this.schemas = derived<readonly ToolDefinition[]>(
			[this.definitions],
			([defs]) => [...((defs ?? new Map()) as ReadonlyMap<string, ToolDefinition>).values()],
			{
				name: "schemas",
				describeKind: "derived",
				meta: aiMeta("tool_schemas"),
				initial: [],
			},
		);
		this.add(this.schemas, { name: "schemas" });
		this.addDisposer(keepalive(this.schemas));
	}

	register(tool: ToolDefinition): void {
		const current = this.definitions.cache as ReadonlyMap<string, ToolDefinition>;
		const next = new Map(current);
		next.set(tool.name, tool);
		this.definitions.emit(next);
	}

	unregister(name: string): void {
		const current = this.definitions.cache as ReadonlyMap<string, ToolDefinition>;
		if (!current.has(name)) return;
		const next = new Map(current);
		next.delete(name);
		this.definitions.emit(next);
	}

	async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
		const defs = this.definitions.cache as ReadonlyMap<string, ToolDefinition>;
		const tool = defs.get(name);
		if (!tool) throw new Error(`toolRegistry: unknown tool "${name}"`);
		const raw = tool.handler(args);
		return resolveToolHandlerResult(raw);
	}

	getDefinition(name: string): ToolDefinition | undefined {
		return (this.definitions.cache as ReadonlyMap<string, ToolDefinition>)?.get(name);
	}
}

export function toolRegistry(name: string, opts?: ToolRegistryOptions): ToolRegistryGraph {
	return new ToolRegistryGraph(name, opts);
}
