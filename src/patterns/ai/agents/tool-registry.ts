import { ERROR, type Messages } from "../../../core/messages.js";
import { type Node, node } from "../../../core/node.js";
import { reactiveMap } from "../../../extra/reactive-map.js";
import { fromAsyncIter, fromPromise, keepalive } from "../../../extra/sources.js";
import { Graph, type GraphOptions } from "../../../graph/graph.js";
import { aiMeta, isNodeLike } from "../_internal.js";
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
 * **Reactive-only execution.** The only execution path is
 * {@link executeReactive}, which returns a `Node<unknown>` for the handler
 * result. Composing factories (`toolExecution`, `agentLoop`) consume it
 * directly inside `retrySource` / `switchMap` chains. There is intentionally
 * no imperative `execute()` Promise method — the registry was originally a
 * dual-boundary class (imperative + reactive) and the imperative path was
 * the only thing in the codebase bridging through `Promise.resolve().then()`
 * to feed `fromAny`. Removing it left every consumer on a single
 * reactive-all-the-way path with real abort propagation.
 *
 * For non-reactive callers (debug scripts, one-shot tests), bridge with
 * `awaitSettled(toolRegistry.executeReactive(name, args))`.
 *
 * **Wave A Unit 6 refactor:** internal storage migrated from `state<Map>`
 * (O(N) Map-copy per mutation) to `ReactiveMapBundle<string, ToolDefinition>`
 * (O(1) mutations + version counter).
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

		this.schemas = node<readonly ToolDefinition[]>(
			[this.definitions],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const defs = data[0];
				actions.emit([...((defs ?? new Map()) as ReadonlyMap<string, ToolDefinition>).values()]);
			},
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
	 * Reactive execution — returns a `Node<unknown>` that emits the handler
	 * result. The returned node is a `producer` that:
	 *
	 * 1. Mints a per-call `AbortController` whose `signal` is threaded into
	 *    the handler call AND into `fromAny` (so a `fromPromise` /
	 *    `fromAsyncIter` inner abandons cleanly when the consumer
	 *    unsubscribes).
	 * 2. Runs `tool.handler(args, {signal})` inside a try/catch — a
	 *    synchronous throw surfaces as `[[ERROR, err]]` downstream instead
	 *    of escaping the producer.
	 * 3. Forwards every message from the inner `fromAny` chain to the
	 *    producer's outputs.
	 * 4. On teardown (subscriber count drops to zero, e.g. `switchMap`
	 *    supersede) calls `ac.abort()` and unsubscribes the inner.
	 *    Signal-aware handlers (e.g. `fetch(url, {signal})`) actually stop.
	 *
	 * Each call mints a fresh node tied to a fresh `handler(args, ...)`
	 * invocation — call `executeReactive` again for repeated invocations.
	 *
	 * @throws `Error` synchronously when `name` is not registered (no node is
	 *   constructed — the caller gets a pre-wiring failure rather than a
	 *   silent ERROR wave on an empty graph).
	 */
	executeReactive(name: string, args: Record<string, unknown>): Node<unknown> {
		const tool = this._bundle.get(name);
		if (!tool) throw new Error(`toolRegistry: unknown tool "${name}"`);
		return node<unknown>(
			[],
			(_data, actions) => {
				const ac = new AbortController();
				let inner: Node<unknown>;
				try {
					const raw = tool.handler(args, { signal: ac.signal });
					inner = handlerResultToNode(raw, ac.signal);
				} catch (err) {
					// Synchronous throw from handler → ERROR. Producer cleanup
					// still aborts the controller for symmetry (no-op if no
					// signal listeners attached).
					actions.down([[ERROR, err]] satisfies Messages);
					return () => {
						ac.abort();
					};
				}
				const unsub = inner.subscribe((batch) => {
					actions.down(batch as Messages);
				});
				return () => {
					ac.abort();
					unsub();
				};
			},
			{
				name: `executeReactive::${name}`,
				describeKind: "producer",
				meta: aiMeta("tool_execute_reactive"),
			},
		);
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

/**
 * Coerce a tool handler return value into a `Node<unknown>`.
 *
 * Differs from `fromAny` by treating **strings, arrays, plain iterables, and
 * scalar objects as single DATA values** rather than iterating them. A tool
 * handler that returns `"hello world"` should surface as one `DATA("hello
 * world")`, not 11 `DATA` events of single characters; an array `[1, 2, 3]`
 * should surface as `DATA([1, 2, 3])`, not three separate emissions.
 *
 * Reactive shapes (Node, Promise, AsyncIterable) are unwrapped as expected.
 *
 * @internal
 */
function handlerResultToNode(raw: unknown, signal: AbortSignal): Node<unknown> {
	if (isNodeLike(raw)) {
		return raw as Node<unknown>;
	}
	if (raw != null && typeof (raw as PromiseLike<unknown>).then === "function") {
		return fromPromise(raw as PromiseLike<unknown>, { signal });
	}
	if (raw != null && typeof raw === "object" && Symbol.asyncIterator in (raw as object)) {
		return fromAsyncIter(raw as AsyncIterable<unknown>, { signal });
	}
	// String, number, boolean, null, undefined, plain object, array,
	// sync iterable — treat as a single DATA value via a resolved Promise so
	// `fromPromise`'s scalar-DATA-emit + COMPLETE semantics match the
	// pre-refactor `tools.execute` behavior (which always wrapped via async).
	return fromPromise(Promise.resolve(raw), { signal });
}
