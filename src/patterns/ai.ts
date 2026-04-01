/**
 * AI surface patterns (roadmap §4.4).
 *
 * Domain-layer factories for LLM-backed agents, chat, tool registries, and
 * agentic memory. Composed from core + extra + Phase 3–4.3 primitives.
 */

import { batch } from "../core/batch.js";
import { COMPLETE, DATA, ERROR } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, producer, state } from "../core/sugar.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../extra/composite.js";
import { switchMap } from "../extra/operators.js";
import {
	type ReactiveLogBundle,
	type ReactiveLogSnapshot,
	reactiveLog,
} from "../extra/reactive-log.js";
import { fromAny, type NodeInput } from "../extra/sources.js";
import { Graph, type GraphOptions } from "../graph/graph.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single chat message in a conversation. */
export type ChatMessage = {
	readonly role: "system" | "user" | "assistant" | "tool";
	readonly content: string;
	readonly name?: string;
	readonly toolCallId?: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly metadata?: Record<string, unknown>;
};

/** A tool invocation request from an LLM. */
export type ToolCall = {
	readonly id: string;
	readonly name: string;
	readonly arguments: Record<string, unknown>;
};

/** The response from an LLM invocation. */
export type LLMResponse = {
	readonly content: string;
	readonly toolCalls?: readonly ToolCall[];
	readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
	readonly finishReason?: string;
	readonly metadata?: Record<string, unknown>;
};

/** Provider-agnostic LLM client adapter protocol. */
export type LLMAdapter = {
	invoke(messages: readonly ChatMessage[], opts?: LLMInvokeOptions): NodeInput<LLMResponse>;
};

export type LLMInvokeOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	tools?: readonly ToolDefinition[];
	systemPrompt?: string;
	signal?: AbortSignal;
};

/** A tool definition for LLM consumption. */
export type ToolDefinition = {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>; // JSON Schema
	readonly handler: (args: Record<string, unknown>) => NodeInput<unknown>;
};

export type AgentLoopStatus = "idle" | "thinking" | "acting" | "done" | "error";

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

type AIMeta = {
	ai?: true;
	ai_type?: string;
};

function aiMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return {
		ai: true,
		ai_type: kind,
		...(extra ?? {}),
	} satisfies AIMeta;
}

function keepalive(n: Node<unknown>): () => void {
	return n.subscribe(() => undefined);
}

function isPromiseLike(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

function isNodeLike(x: unknown): x is Node<unknown> {
	return (
		typeof x === "object" &&
		x !== null &&
		"subscribe" in x &&
		typeof (x as Node<unknown>).subscribe === "function" &&
		"get" in x &&
		typeof (x as Node<unknown>).get === "function"
	);
}

function isAsyncIterableLike(x: unknown): x is AsyncIterable<unknown> {
	return (
		x != null &&
		typeof x === "object" &&
		Symbol.asyncIterator in x &&
		typeof (x as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
	);
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** First settled `DATA` from a `Node` (do not pass plain strings — `fromAny` would iterate chars). */
function firstDataFromNode(
	resolved: Node<unknown>,
	opts?: { timeoutMs?: number },
): Promise<unknown> {
	// Only trust get() when node is in settled state
	if ((resolved as { status?: string }).status === "settled") {
		const immediate = resolved.get();
		if (immediate !== undefined) {
			return Promise.resolve(immediate);
		}
	}
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timer !== undefined) clearTimeout(timer);
		};
		const unsub = resolved.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) {
					cleanup();
					unsub();
					resolve(msg[1]);
					return;
				}
				if (msg[0] === ERROR) {
					cleanup();
					unsub();
					reject(msg[1]);
					return;
				}
				if (msg[0] === COMPLETE) {
					cleanup();
					unsub();
					reject(new Error("firstDataFromNode: completed without producing a value"));
					return;
				}
			}
		});
		timer = setTimeout(() => {
			unsub();
			reject(new Error(`firstDataFromNode: timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});
}

/** Await Promise-likes, then resolve `Node` / async-iterable inputs via `fromAny` + first `DATA`. */
async function resolveToolHandlerResult(value: unknown): Promise<unknown> {
	if (isPromiseLike(value)) {
		return resolveToolHandlerResult(await value);
	}
	if (isNodeLike(value)) {
		return firstDataFromNode(value);
	}
	if (isAsyncIterableLike(value)) {
		return firstDataFromNode(fromAny(value as NodeInput<unknown>));
	}
	return value;
}

// ---------------------------------------------------------------------------
// fromLLM
// ---------------------------------------------------------------------------

export type FromLLMOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	tools?: readonly ToolDefinition[];
	systemPrompt?: string;
};

/**
 * Reactive LLM invocation adapter. Returns a derived node that re-invokes
 * the LLM whenever the messages dep changes.
 *
 * Uses `switchMap` internally — new invocations cancel stale in-flight ones.
 */
export function fromLLM(
	adapter: LLMAdapter,
	messages: NodeInput<readonly ChatMessage[]>,
	opts?: FromLLMOptions,
): Node<LLMResponse | null> {
	const msgsNode = fromAny(messages);
	const result = switchMap(msgsNode, (msgs) => {
		if (!msgs || (msgs as readonly ChatMessage[]).length === 0) {
			return state<LLMResponse | null>(null) as NodeInput<LLMResponse | null>;
		}
		const tools = opts?.tools;
		return adapter.invoke(msgs as readonly ChatMessage[], {
			model: opts?.model,
			temperature: opts?.temperature,
			maxTokens: opts?.maxTokens,
			tools,
			systemPrompt: opts?.systemPrompt,
		}) as NodeInput<LLMResponse | null>;
	});

	return result;
}

// ---------------------------------------------------------------------------
// chatStream
// ---------------------------------------------------------------------------

export type ChatStreamOptions = {
	graph?: GraphOptions;
	maxMessages?: number;
};

export class ChatStreamGraph extends Graph {
	private readonly _log: ReactiveLogBundle<ChatMessage>;
	private readonly _keepaliveSubs: Array<() => void> = [];
	readonly messages: Node<ReactiveLogSnapshot<ChatMessage>>;
	readonly latest: Node<ChatMessage | undefined>;
	readonly messageCount: Node<number>;

	constructor(name: string, opts: ChatStreamOptions = {}) {
		super(name, opts.graph);

		this._log = reactiveLog<ChatMessage>([], {
			name: "messages",
			maxSize: opts.maxMessages,
		});
		this.messages = this._log.entries;
		this.add("messages", this.messages);

		this.latest = derived<ChatMessage | undefined>(
			[this.messages],
			([snapshot]) => {
				const entries = (snapshot as ReactiveLogSnapshot<ChatMessage>).value.entries;
				return entries.length === 0 ? undefined : entries[entries.length - 1];
			},
			{
				name: "latest",
				describeKind: "derived",
				meta: aiMeta("chat_latest"),
				initial: undefined,
			},
		);
		this.add("latest", this.latest);
		this.connect("messages", "latest");
		this._keepaliveSubs.push(keepalive(this.latest));

		this.messageCount = derived<number>(
			[this.messages],
			([snapshot]) => (snapshot as ReactiveLogSnapshot<ChatMessage>).value.entries.length,
			{
				name: "messageCount",
				describeKind: "derived",
				meta: aiMeta("chat_message_count"),
				initial: 0,
			},
		);
		this.add("messageCount", this.messageCount);
		this.connect("messages", "messageCount");
		this._keepaliveSubs.push(keepalive(this.messageCount));
	}

	append(role: ChatMessage["role"], content: string, extra?: Partial<ChatMessage>): void {
		this._log.append({ role, content, ...extra });
	}

	appendToolResult(callId: string, content: string): void {
		this._log.append({ role: "tool", content, toolCallId: callId });
	}

	clear(): void {
		this._log.clear();
	}

	allMessages(): readonly ChatMessage[] {
		return (this.messages.get() as ReactiveLogSnapshot<ChatMessage>).value.entries;
	}

	override destroy(): void {
		for (const unsub of this._keepaliveSubs) unsub();
		this._keepaliveSubs.length = 0;
		super.destroy();
	}
}

export function chatStream(name: string, opts?: ChatStreamOptions): ChatStreamGraph {
	return new ChatStreamGraph(name, opts);
}

// ---------------------------------------------------------------------------
// toolRegistry
// ---------------------------------------------------------------------------

export type ToolRegistryOptions = {
	graph?: GraphOptions;
};

export class ToolRegistryGraph extends Graph {
	readonly definitions: Node<ReadonlyMap<string, ToolDefinition>>;
	readonly schemas: Node<readonly ToolDefinition[]>;
	private readonly _keepaliveSubs: Array<() => void> = [];

	constructor(name: string, opts: ToolRegistryOptions = {}) {
		super(name, opts.graph);

		this.definitions = state<ReadonlyMap<string, ToolDefinition>>(new Map(), {
			name: "definitions",
			describeKind: "state",
			meta: aiMeta("tool_definitions"),
		});
		this.add("definitions", this.definitions);

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
		this.add("schemas", this.schemas);
		this.connect("definitions", "schemas");
		this._keepaliveSubs.push(keepalive(this.schemas));
	}

	register(tool: ToolDefinition): void {
		const current = this.definitions.get() as ReadonlyMap<string, ToolDefinition>;
		const next = new Map(current);
		next.set(tool.name, tool);
		this.definitions.down([[DATA, next]]);
	}

	unregister(name: string): void {
		const current = this.definitions.get() as ReadonlyMap<string, ToolDefinition>;
		if (!current.has(name)) return;
		const next = new Map(current);
		next.delete(name);
		this.definitions.down([[DATA, next]]);
	}

	async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
		const defs = this.definitions.get() as ReadonlyMap<string, ToolDefinition>;
		const tool = defs.get(name);
		if (!tool) throw new Error(`toolRegistry: unknown tool "${name}"`);
		const raw = tool.handler(args);
		return resolveToolHandlerResult(raw);
	}

	getDefinition(name: string): ToolDefinition | undefined {
		return (this.definitions.get() as ReadonlyMap<string, ToolDefinition>).get(name);
	}

	override destroy(): void {
		for (const unsub of this._keepaliveSubs) unsub();
		this._keepaliveSubs.length = 0;
		super.destroy();
	}
}

export function toolRegistry(name: string, opts?: ToolRegistryOptions): ToolRegistryGraph {
	return new ToolRegistryGraph(name, opts);
}

// ---------------------------------------------------------------------------
// systemPromptBuilder
// ---------------------------------------------------------------------------

/**
 * Assembles a system prompt from reactive sections. Each section is a
 * `NodeInput<string>` — the prompt updates when any section changes.
 */
export type SystemPromptHandle = Node<string> & { dispose: () => void };

export function systemPromptBuilder(
	sections: readonly NodeInput<string>[],
	opts?: { separator?: string; name?: string },
): SystemPromptHandle {
	const separator = opts?.separator ?? "\n\n";
	const sectionNodes = sections.map((s) => (typeof s === "string" ? state(s) : fromAny(s)));
	const prompt = derived(
		sectionNodes,
		(values) => (values as string[]).filter((v) => v != null && v !== "").join(separator),
		{
			name: opts?.name ?? "systemPrompt",
			describeKind: "derived",
			meta: aiMeta("system_prompt"),
			initial: "",
		},
	);
	const unsub = keepalive(prompt);
	return Object.assign(prompt, { dispose: unsub });
}

// ---------------------------------------------------------------------------
// llmExtractor / llmConsolidator
// ---------------------------------------------------------------------------

export type LLMExtractorOptions = {
	adapter: LLMAdapter;
	model?: string;
	temperature?: number;
	maxTokens?: number;
};

/**
 * Returns an `extractFn` callback for `distill()` that invokes an LLM to
 * extract structured memories from raw input.
 *
 * The system prompt should instruct the LLM to return JSON matching
 * `Extraction<TMem>` shape: `{ upsert: [{ key, value }], remove?: [key] }`.
 */
export function llmExtractor<TRaw, TMem>(
	systemPrompt: string,
	opts: LLMExtractorOptions,
): (raw: TRaw, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>> {
	return (raw: TRaw, existing: ReadonlyMap<string, TMem>) => {
		const existingKeys = [...existing.keys()].slice(0, 100); // sample for dedup
		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: JSON.stringify({
					input: raw,
					existingKeys,
				}),
			},
		];
		// Wrap the adapter call in a producer that parses the JSON response
		return producer<Extraction<TMem>>((_deps, actions) => {
			let active = true;
			const result = opts.adapter.invoke(messages, {
				model: opts.model,
				temperature: opts.temperature ?? 0,
				maxTokens: opts.maxTokens,
			});
			// result is NodeInput — could be a Promise, Node, etc.
			const resolved = fromAny(result);
			const unsub = resolved.subscribe((msgs) => {
				if (!active) return;
				let done = false;
				for (const msg of msgs) {
					if (done) break;
					if (msg[0] === DATA) {
						const response = msg[1] as LLMResponse;
						try {
							const parsed = JSON.parse(response.content) as Extraction<TMem>;
							actions.emit(parsed);
							actions.down([[COMPLETE]]);
						} catch {
							actions.down([
								[ERROR, new Error("llmExtractor: failed to parse LLM response as JSON")],
							]);
						}
						done = true;
					} else if (msg[0] === ERROR) {
						actions.down([[ERROR, msg[1]]]);
						done = true;
					} else if (msg[0] === COMPLETE) {
						actions.down([[COMPLETE]]);
						done = true;
					} else {
						// Forward unknown message types (spec §1.3.6)
						actions.down([[msg[0], msg[1]]]);
					}
				}
			});
			return () => {
				unsub();
				active = false;
			};
		});
	};
}

export type LLMConsolidatorOptions = LLMExtractorOptions;

/**
 * Returns a `consolidateFn` callback for `distill()` that invokes an LLM to
 * cluster and merge related memories.
 */
export function llmConsolidator<TMem>(
	systemPrompt: string,
	opts: LLMConsolidatorOptions,
): (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>> {
	return (entries: ReadonlyMap<string, TMem>) => {
		const entriesArray = [...entries.entries()].map(([key, value]) => ({ key, value }));
		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: JSON.stringify({ memories: entriesArray }) },
		];
		return producer<Extraction<TMem>>((_deps, actions) => {
			let active = true;
			const result = opts.adapter.invoke(messages, {
				model: opts.model,
				temperature: opts.temperature ?? 0,
				maxTokens: opts.maxTokens,
			});
			const resolved = fromAny(result);
			const unsub = resolved.subscribe((msgs) => {
				if (!active) return;
				let done = false;
				for (const msg of msgs) {
					if (done) break;
					if (msg[0] === DATA) {
						const response = msg[1] as LLMResponse;
						try {
							const parsed = JSON.parse(response.content) as Extraction<TMem>;
							actions.emit(parsed);
							actions.down([[COMPLETE]]);
						} catch {
							actions.down([
								[ERROR, new Error("llmConsolidator: failed to parse LLM response as JSON")],
							]);
						}
						done = true;
					} else if (msg[0] === ERROR) {
						actions.down([[ERROR, msg[1]]]);
						done = true;
					} else if (msg[0] === COMPLETE) {
						actions.down([[COMPLETE]]);
						done = true;
					} else {
						// Forward unknown message types (spec §1.3.6)
						actions.down([[msg[0], msg[1]]]);
					}
				}
			});
			return () => {
				unsub();
				active = false;
			};
		});
	};
}

// ---------------------------------------------------------------------------
// agentMemory
// ---------------------------------------------------------------------------

export type AgentMemoryOptions<TMem = unknown> = {
	graph?: GraphOptions;
	/** LLM adapter for extraction and consolidation. */
	adapter?: LLMAdapter;
	/** System prompt for the extractor LLM. */
	extractPrompt?: string;
	/** Custom extractFn (overrides adapter + extractPrompt). */
	extractFn?: (raw: unknown, existing: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>;
	/** System prompt for the consolidation LLM. */
	consolidatePrompt?: string;
	/** Custom consolidateFn (overrides adapter + consolidatePrompt). */
	consolidateFn?: (entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>;
	/** Reactive trigger for consolidation (caller supplies e.g. `fromTimer`). */
	consolidateTrigger?: NodeInput<unknown>;
	/** Score function for budget packing (required). */
	score: (mem: TMem, context: unknown) => number;
	/** Cost function for budget packing (required). */
	cost: (mem: TMem) => number;
	/** Token budget for compact view (default 2000). */
	budget?: number;
	/** Context node for scoring. */
	context?: NodeInput<unknown>;
	/** Admission filter (default: admit all). */
	admissionFilter?: (candidate: unknown) => boolean;
	/** Vector index dimensions for semantic search (0 disables). */
	vectorDimensions?: number;
};

export type AgentMemoryGraph<TMem = unknown> = Graph & {
	readonly distillBundle: DistillBundle<TMem>;
	readonly compact: Node<Array<{ key: string; value: TMem; score: number }>>;
	readonly size: Node<number>;
};

/**
 * Pre-wired agentic memory graph: `distill()` with `store` / `compact` / `size` nodes,
 * optional LLM-backed `llmExtractor` / `llmConsolidator`, and optional `admissionFilter`.
 * Composing `knowledgeGraph()`, `vectorIndex()`, `collection()`, `decay()`, and
 * `autoCheckpoint()` inside this factory is roadmap follow-up; compose them externally today.
 */
export function agentMemory<TMem = unknown>(
	name: string,
	source: NodeInput<unknown>,
	opts: AgentMemoryOptions<TMem>,
): AgentMemoryGraph<TMem> {
	const graph = new Graph(name, opts.graph);

	// Resolve extractFn — wrap with null guard so admission-filtered undefined skips extraction
	let rawExtractFn: (
		raw: unknown,
		existing: ReadonlyMap<string, TMem>,
	) => NodeInput<Extraction<TMem>>;
	if (opts.extractFn) {
		rawExtractFn = opts.extractFn;
	} else if (opts.adapter && opts.extractPrompt) {
		rawExtractFn = llmExtractor<unknown, TMem>(opts.extractPrompt, { adapter: opts.adapter });
	} else {
		throw new Error("agentMemory: provide either extractFn or adapter + extractPrompt");
	}
	const extractFn = (
		raw: unknown,
		existing: ReadonlyMap<string, TMem>,
	): NodeInput<Extraction<TMem>> => {
		if (raw == null) return { upsert: [] };
		return rawExtractFn(raw, existing);
	};

	// Optionally wrap source with admission filter
	let filteredSource = source;
	if (opts.admissionFilter) {
		const srcNode = fromAny(source);
		const filter = opts.admissionFilter;
		filteredSource = derived(
			[srcNode],
			([raw]) => {
				if (filter(raw)) return raw;
				return undefined;
			},
			{ name: "admissionFilter", describeKind: "derived" },
		);
	}

	// Resolve consolidateFn
	let consolidateFn:
		| ((entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>)
		| undefined;
	if (opts.consolidateFn) {
		consolidateFn = opts.consolidateFn;
	} else if (opts.adapter && opts.consolidatePrompt) {
		consolidateFn = llmConsolidator<TMem>(opts.consolidatePrompt, { adapter: opts.adapter });
	}

	const consolidateTrigger = opts.consolidateTrigger;

	// Build distill bundle
	const distillOpts: DistillOptions<TMem> = {
		score: opts.score,
		cost: opts.cost,
		budget: opts.budget ?? 2000,
		context: opts.context,
		consolidate: consolidateFn,
		consolidateTrigger,
	};

	const distillBundle = distill<unknown, TMem>(filteredSource, extractFn, distillOpts);

	// Register distill nodes in graph
	graph.add("store", distillBundle.store.node);
	graph.add("compact", distillBundle.compact);
	graph.add("size", distillBundle.size);
	graph.connect("store", "compact");
	graph.connect("store", "size");

	return Object.assign(graph, {
		distillBundle,
		compact: distillBundle.compact,
		size: distillBundle.size,
	}) as AgentMemoryGraph<TMem>;
}

// ---------------------------------------------------------------------------
// agentLoop
// ---------------------------------------------------------------------------

export type AgentLoopOptions = {
	graph?: GraphOptions;
	adapter: LLMAdapter;
	tools?: readonly ToolDefinition[];
	systemPrompt?: string;
	maxTurns?: number;
	stopWhen?: (response: LLMResponse) => boolean;
	onToolCall?: (call: ToolCall) => void;
	maxMessages?: number;
	model?: string;
	temperature?: number;
	maxTokens?: number;
};

export class AgentLoopGraph extends Graph {
	readonly chat: ChatStreamGraph;
	readonly tools: ToolRegistryGraph;
	readonly status: Node<AgentLoopStatus>;
	readonly turnCount: Node<number>;
	readonly lastResponse: Node<LLMResponse | null>;
	private readonly _statusState: Node<AgentLoopStatus>;
	private readonly _turnCountState: Node<number>;
	private readonly _adapter: LLMAdapter;
	private readonly _maxTurns: number;
	private readonly _stopWhen?: (response: LLMResponse) => boolean;
	private readonly _onToolCall?: (call: ToolCall) => void;
	private readonly _systemPrompt?: string;
	private readonly _model?: string;
	private readonly _temperature?: number;
	private readonly _maxTokens?: number;
	private _running = false;
	private _abortController: AbortController | null = null;

	constructor(name: string, opts: AgentLoopOptions) {
		super(name, opts.graph);

		this._adapter = opts.adapter;
		this._maxTurns = opts.maxTurns ?? 10;
		this._stopWhen = opts.stopWhen;
		this._onToolCall = opts.onToolCall;
		this._systemPrompt = opts.systemPrompt;
		this._model = opts.model;
		this._temperature = opts.temperature;
		this._maxTokens = opts.maxTokens;

		// Mount chat subgraph
		this.chat = chatStream(`${name}-chat`, { maxMessages: opts.maxMessages });
		this.mount("chat", this.chat);

		// Mount tool registry subgraph
		this.tools = toolRegistry(`${name}-tools`);
		this.mount("tools", this.tools);

		// Register initial tools
		if (opts.tools) {
			for (const tool of opts.tools) {
				this.tools.register(tool);
			}
		}

		// Status state
		this._statusState = state<AgentLoopStatus>("idle", {
			name: "status",
			describeKind: "state",
			meta: aiMeta("agent_status"),
		});
		this.status = this._statusState;
		this.add("status", this.status);

		// Turn count
		this._turnCountState = state<number>(0, {
			name: "turnCount",
			describeKind: "state",
			meta: aiMeta("agent_turn_count"),
		});
		this.turnCount = this._turnCountState;
		this.add("turnCount", this.turnCount);

		// Last LLM response
		this.lastResponse = state<LLMResponse | null>(null, {
			name: "lastResponse",
			describeKind: "state",
			meta: aiMeta("agent_last_response"),
		});
		this.add("lastResponse", this.lastResponse);
	}

	/**
	 * Start the agent loop with a user message. The loop runs reactively:
	 * think (LLM call) → act (tool execution) → repeat until done.
	 *
	 * Messages accumulate across calls. Call `chat.clear()` before `run()`
	 * to reset conversation history.
	 */
	async run(userMessage: string): Promise<LLMResponse | null> {
		if (this._running) throw new Error("agentLoop: already running");
		this._running = true;
		this._abortController = new AbortController();
		const { signal } = this._abortController;

		batch(() => {
			this._statusState.down([[DATA, "idle" as AgentLoopStatus]]);
			this._turnCountState.down([[DATA, 0]]);
		});
		this.chat.append("user", userMessage);

		try {
			let turns = 0;
			while (turns < this._maxTurns) {
				if (signal.aborted) throw new Error("agentLoop: aborted");
				turns++;
				batch(() => {
					this._turnCountState.down([[DATA, turns]]);
					this._statusState.down([[DATA, "thinking" as AgentLoopStatus]]);
				});

				// Invoke LLM
				const msgs = this.chat.allMessages();
				const toolSchemas = (this.tools.schemas.get() as readonly ToolDefinition[]) ?? [];
				const response = await this._invokeLLM(msgs, toolSchemas, signal);
				if (signal.aborted) throw new Error("agentLoop: aborted");

				(this.lastResponse as Node<LLMResponse | null>).down([[DATA, response]]);

				// Append assistant message
				this.chat.append("assistant", response.content, {
					toolCalls: response.toolCalls,
				});

				// Check stop conditions
				if (this._shouldStop(response)) {
					this._statusState.down([[DATA, "done" as AgentLoopStatus]]);
					this._running = false;
					this._abortController = null;
					return response;
				}

				// Execute tool calls if present
				if (response.toolCalls && response.toolCalls.length > 0) {
					this._statusState.down([[DATA, "acting" as AgentLoopStatus]]);
					for (const call of response.toolCalls) {
						if (signal.aborted) throw new Error("agentLoop: aborted");
						this._onToolCall?.(call);
						try {
							const result = await this.tools.execute(call.name, call.arguments);
							this.chat.appendToolResult(call.id, JSON.stringify(result));
						} catch (err) {
							this.chat.appendToolResult(call.id, JSON.stringify({ error: String(err) }));
						}
					}
				} else {
					// No tool calls and not explicitly stopped → done
					this._statusState.down([[DATA, "done" as AgentLoopStatus]]);
					this._running = false;
					this._abortController = null;
					return response;
				}
			}

			// Max turns reached
			this._statusState.down([[DATA, "done" as AgentLoopStatus]]);
			this._running = false;
			this._abortController = null;
			return this.lastResponse.get() as LLMResponse | null;
		} catch (err) {
			this._statusState.down([[DATA, "error" as AgentLoopStatus]]);
			this._running = false;
			this._abortController = null;
			throw err;
		}
	}

	private async _invokeLLM(
		msgs: readonly ChatMessage[],
		tools: readonly ToolDefinition[],
		signal?: AbortSignal,
	): Promise<LLMResponse> {
		const result = this._adapter.invoke(msgs, {
			tools: tools.length > 0 ? tools : undefined,
			systemPrompt: this._systemPrompt,
			model: this._model,
			temperature: this._temperature,
			maxTokens: this._maxTokens,
			signal,
		});
		// Null/undefined guard
		if (result == null) {
			throw new Error("_invokeLLM: adapter.invoke() returned null or undefined");
		}
		// String guard — fromAny would iterate characters
		if (typeof result === "string") {
			throw new Error("_invokeLLM: adapter.invoke() returned a string, expected LLMResponse");
		}
		// If result is already an LLMResponse (sync adapter), return directly
		if (
			typeof result === "object" &&
			"content" in result &&
			!("subscribe" in result) &&
			!("then" in result)
		) {
			return result as LLMResponse;
		}
		// If result is a Promise, await it then check for LLMResponse
		if (isPromiseLike(result)) {
			const awaited = await result;
			if (
				typeof awaited === "object" &&
				awaited !== null &&
				"content" in awaited &&
				!("subscribe" in awaited)
			) {
				return awaited as LLMResponse;
			}
			return firstDataFromNode(fromAny(awaited as NodeInput<LLMResponse>)) as Promise<LLMResponse>;
		}
		// If result is a Node or async iterable, resolve via fromAny + firstDataFromNode
		return firstDataFromNode(fromAny(result)) as Promise<LLMResponse>;
	}

	private _shouldStop(response: LLMResponse): boolean {
		if (
			response.finishReason === "end_turn" &&
			(!response.toolCalls || response.toolCalls.length === 0)
		)
			return true;
		if (this._stopWhen?.(response)) return true;
		return false;
	}

	override destroy(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = null;
		}
		this._running = false;
		super.destroy();
	}
}

export function agentLoop(name: string, opts: AgentLoopOptions): AgentLoopGraph {
	return new AgentLoopGraph(name, opts);
}
