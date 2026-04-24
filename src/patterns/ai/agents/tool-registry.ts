import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import { reactiveMap } from "../../../extra/reactive-map.js";
import { fromAny } from "../../../extra/sources.js";
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

/**
 * `ToolRegistryGraph` — name-keyed registry of {@link ToolDefinition}s.
 *
 * **Wave A Unit 6 refactor:** internal storage migrated from `state<Map>`
 * (O(N) Map-copy per mutation) to `ReactiveMapBundle<string, ToolDefinition>`
 * (O(1) mutations + version counter). Public API unchanged for existing
 * consumers. Adds a new reactive `executeReactive(name, args): Node<unknown>`
 * alongside the imperative `execute(name, args): Promise<unknown>` so
 * composing factories (`toolExecution`, `agentLoop`) can consume the tool
 * handler as a reactive source without bridging through `firstDataFromNode`.
 */
export class ToolRegistryGraph extends Graph {
	readonly definitions: Node<ReadonlyMap<string, ToolDefinition>>;
	readonly schemas: Node<readonly ToolDefinition[]>;
	private readonly _bundle: ReturnType<typeof reactiveMap<string, ToolDefinition>>;

	constructor(name: string, opts: ToolRegistryOptions = {}) {
		super(name, opts.graph);

		this._bundle = reactiveMap<string, ToolDefinition>({
			name: "definitions",
		});
		this.definitions = this._bundle.entries;
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
		this._bundle.set(tool.name, tool);
	}

	unregister(name: string): void {
		this._bundle.delete(name);
	}

	/**
	 * Imperative boundary: await the handler result as a Promise. Safe for
	 * non-reactive callers; reactive consumers prefer {@link executeReactive}.
	 */
	async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
		const tool = this._bundle.get(name);
		if (!tool) throw new Error(`toolRegistry: unknown tool "${name}"`);
		const raw = tool.handler(args);
		return resolveToolHandlerResult(raw);
	}

	/**
	 * Reactive execution — returns a `Node<unknown>` that emits the handler
	 * result. Uses `fromAny` to bridge Promise / Node / AsyncIterable handler
	 * return shapes uniformly. Composes cleanly inside `switchMap` /
	 * `retrySource` / `rescue` chains where the legacy imperative `execute()`
	 * would force a `firstDataFromNode` round-trip.
	 *
	 * The returned node is a one-shot: it emits the first DATA from the
	 * handler result (or ERROR on handler throw) and then relies on the
	 * caller's switchMap / subscription chain for teardown. For repeated
	 * invocations, call `executeReactive` again — each call mints a fresh
	 * node tied to a fresh `handler(args)` invocation.
	 *
	 * @throws `Error` synchronously when `name` is not registered (no node is
	 *   constructed — the caller gets a pre-wiring failure rather than a
	 *   silent ERROR wave on an empty graph).
	 */
	executeReactive(name: string, args: Record<string, unknown>): Node<unknown> {
		const tool = this._bundle.get(name);
		if (!tool) throw new Error(`toolRegistry: unknown tool "${name}"`);
		return fromAny(tool.handler(args));
	}

	getDefinition(name: string): ToolDefinition | undefined {
		// Pure read via the snapshot cache — avoids the bundle's
		// `wrapMutation` path (which would run the version-bump check and
		// any configured retention eviction on every lookup). Safe because
		// `getDefinition` is a boundary API, not a reactive fn body.
		return this._bundle.entries.cache?.get(name);
	}
}

export function toolRegistry(name: string, opts?: ToolRegistryOptions): ToolRegistryGraph {
	return new ToolRegistryGraph(name, opts);
}
