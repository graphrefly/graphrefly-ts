/**
 * AI surface patterns (roadmap §4.4).
 *
 * Domain-layer factories for LLM-backed agents, chat, tool registries, and
 * agentic memory. Composed from core + extra + Phase 3–4.3 primitives.
 */

import type { Actor } from "../core/actor.js";
import { batch } from "../core/batch.js";
import { monotonicNs } from "../core/clock.js";
import { COMPLETE, DATA, ERROR, TEARDOWN } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, effect, producer, state } from "../core/sugar.js";
import { ResettableTimer } from "../core/timer.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../extra/composite.js";
import { switchMap } from "../extra/operators.js";
import { type ReactiveLogBundle, reactiveLog } from "../extra/reactive-log.js";
import { fromAny, fromTimer, type NodeInput } from "../extra/sources.js";
import {
	type AutoCheckpointAdapter,
	Graph,
	type GraphAutoCheckpointHandle,
	type GraphAutoCheckpointOptions,
	type GraphOptions,
	type GraphPersistSnapshot,
} from "../graph/graph.js";
import {
	decay,
	type KnowledgeGraphGraph,
	knowledgeGraph,
	type LightCollectionBundle,
	lightCollection,
	type VectorIndexBundle,
	type VectorSearchResult,
	vectorIndex,
} from "./memory.js";

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
	stream(messages: readonly ChatMessage[], opts?: LLMInvokeOptions): AsyncIterable<string>;
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
	/**
	 * V0 version of the backing node at `knobsAsTools()` call time (§6.0b).
	 * Snapshot — re-call `knobsAsTools()` to refresh.
	 */
	readonly version?: { id: string; version: number };
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
		const timer = new ResettableTimer();
		const unsub = resolved.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) {
					timer.cancel();
					unsub();
					resolve(msg[1]);
					return;
				}
				if (msg[0] === ERROR) {
					timer.cancel();
					unsub();
					reject(msg[1]);
					return;
				}
				if (msg[0] === COMPLETE) {
					timer.cancel();
					unsub();
					reject(new Error("firstDataFromNode: completed without producing a value"));
					return;
				}
			}
		});
		timer.start(timeoutMs, () => {
			unsub();
			reject(new Error(`firstDataFromNode: timed out after ${timeoutMs}ms`));
		});
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
// fromLLMStream
// ---------------------------------------------------------------------------

export type FromLLMStreamOptions = FromLLMOptions;

/**
 * Bundle returned by {@link fromLLMStream}. `node` is the reactive log of
 * token chunks; `dispose` tears down the internal effect and log.
 */
export type LLMStreamHandle = {
	/** Reactive log node accumulating token chunks. */
	node: Node<readonly string[]>;
	/** Tear down the internal effect, abort any in-flight stream, and release resources. */
	dispose: () => void;
};

/**
 * Streaming LLM invocation. Returns a `{ node, dispose }` bundle where
 * `node` is a `reactiveLog`-backed node that accumulates token chunks as
 * they arrive from `adapter.stream()`.
 *
 * An `effect` watches the messages input; new values abort the in-flight
 * stream and clear the log before starting a new one. Call `dispose()` to
 * tear down the effect and release resources.
 */
export function fromLLMStream(
	adapter: LLMAdapter,
	messages: NodeInput<readonly ChatMessage[]>,
	opts?: FromLLMStreamOptions,
): LLMStreamHandle {
	const msgsNode = fromAny(messages);
	let controller: AbortController | undefined;

	const log = reactiveLog<string>([], { name: opts?.name ?? "llmStream" });

	const eff = effect([msgsNode], ([msgs]) => {
		// Abort any in-flight stream
		controller?.abort();
		log.clear();

		const chatMsgs = msgs as readonly ChatMessage[];
		if (!chatMsgs || chatMsgs.length === 0) return;

		controller = new AbortController();
		const iter = adapter.stream(chatMsgs, {
			model: opts?.model,
			temperature: opts?.temperature,
			maxTokens: opts?.maxTokens,
			tools: opts?.tools,
			systemPrompt: opts?.systemPrompt,
			signal: controller.signal,
		});
		const ctrl = controller;
		(async () => {
			try {
				for await (const chunk of iter) {
					if (ctrl.signal.aborted) break;
					log.append(chunk);
				}
			} catch (_err) {
				// Stream errors are silently absorbed when aborted.
				// Non-abort errors are also absorbed — surfacing ERROR on
				// a state node (log.entries) would violate terminal semantics.
				// Callers needing error visibility should wrap with a meta node.
			}
		})();

		return () => {
			ctrl.abort();
		};
	});
	const unsub = keepalive(eff);

	return {
		node: log.entries,
		dispose() {
			controller?.abort();
			unsub();
			eff.down([[TEARDOWN]]);
		},
	};
}

// ---------------------------------------------------------------------------
// promptNode
// ---------------------------------------------------------------------------

export type PromptNodeOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Output format — `"json"` attempts JSON.parse on the response. Default: `"text"`. */
	format?: "text" | "json";
	/** Number of retries on transient errors. Default: 0. */
	retries?: number;
	/** Cache LLM responses for identical inputs. Default: false. */
	cache?: boolean;
	systemPrompt?: string;
	meta?: Record<string, unknown>;
};

/** Extract text content from an LLM response, handling various response shapes. */
function extractContent(resp: unknown): string {
	if (resp != null && typeof resp === "object" && "content" in resp) {
		return String((resp as LLMResponse).content);
	}
	if (typeof resp === "string") return resp;
	return String(resp);
}

/**
 * Universal LLM transform: wraps a prompt template + model adapter into a reactive derived node.
 * Re-invokes the LLM whenever any dep changes. Suitable for triage, QA, hypothesis, parity, etc.
 *
 * @param adapter - LLM adapter (provider-agnostic).
 * @param deps - Input nodes whose values feed the prompt.
 * @param prompt - Static string or template function receiving dep values.
 * @param opts - Optional configuration.
 * @returns `Node` emitting LLM responses (string or parsed JSON).
 */
export function promptNode<T = string>(
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: PromptNodeOptions,
): Node<T | null> {
	const format = opts?.format ?? "text";
	const retries = opts?.retries ?? 0;
	const useCache = opts?.cache ?? false;
	const cache = useCache ? new Map<string, T>() : null;

	// Seed with `initial: []` so `switchMap` below fires with `[]` during the
	// initial activation pass and emits null (composition guide §8 — promptNode
	// gates on nullish deps). Dep-level null guarding is done inside the fn.
	const messagesNode = derived<readonly ChatMessage[]>(
		deps as Node<unknown>[],
		(values) => {
			// Dep-level null guard (composition guide §8): if any dep is
			// nullish, return empty messages → switchMap emits null.
			if (values.some((v) => v == null)) return [];
			const text = typeof prompt === "string" ? prompt : prompt(...values);
			if (!text) return [];
			const msgs: ChatMessage[] = [];
			if (opts?.systemPrompt) msgs.push({ role: "system", content: opts.systemPrompt });
			msgs.push({ role: "user", content: text });
			return msgs;
		},
		{
			name: opts?.name ? `${opts.name}::messages` : "prompt_node::messages",
			meta: aiMeta("prompt_node"),
			initial: [] as readonly ChatMessage[],
		},
	);

	const result = switchMap<readonly ChatMessage[], T | null>(messagesNode, (msgs) => {
		if (!msgs || msgs.length === 0) {
			return state<T | null>(null) as NodeInput<T | null>;
		}

		const cacheKey = useCache ? JSON.stringify(msgs.map((m) => [m.role, m.content])) : "";
		if (cache?.has(cacheKey)) {
			return state<T | null>(cache.get(cacheKey)!) as NodeInput<T | null>;
		}

		async function attempt(remaining: number): Promise<T | null> {
			try {
				const resp = await new Promise<LLMResponse>((resolve, reject) => {
					const input = adapter.invoke(msgs, {
						model: opts?.model,
						temperature: opts?.temperature,
						maxTokens: opts?.maxTokens,
						systemPrompt: opts?.systemPrompt,
					});
					// NodeInput may be a Node, Promise, or raw value
					if (input && typeof (input as PromiseLike<LLMResponse>).then === "function") {
						(input as PromiseLike<LLMResponse>).then(resolve, reject);
					} else if (input && typeof (input as Node<LLMResponse>).get === "function") {
						resolve((input as Node<LLMResponse>).get() as LLMResponse);
					} else {
						resolve(input as LLMResponse);
					}
				});

				const content = extractContent(resp);
				let parsed: T;
				if (format === "json") {
					parsed = JSON.parse(stripFences(content)) as T;
				} else {
					parsed = content as unknown as T;
				}
				cache?.set(cacheKey, parsed);
				return parsed;
			} catch (err) {
				if (remaining > 0) return attempt(remaining - 1);
				throw err;
			}
		}

		return attempt(retries) as NodeInput<T | null>;
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
	readonly messages: Node<readonly ChatMessage[]>;
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
				const entries = snapshot as readonly ChatMessage[];
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
		this.addDisposer(keepalive(this.latest));

		this.messageCount = derived<number>(
			[this.messages],
			([snapshot]) => (snapshot as readonly ChatMessage[]).length,
			{
				name: "messageCount",
				describeKind: "derived",
				meta: aiMeta("chat_message_count"),
				initial: 0,
			},
		);
		this.add("messageCount", this.messageCount);
		this.connect("messages", "messageCount");
		this.addDisposer(keepalive(this.messageCount));
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
		return this.messages.get() as readonly ChatMessage[];
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
		this.addDisposer(keepalive(this.schemas));
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
// 3D Admission Scoring
// ---------------------------------------------------------------------------

/** Scores for the three admission dimensions. Each 0–1. */
export type AdmissionScores = {
	readonly persistence: number;
	readonly structure: number;
	readonly personalValue: number;
};

export type AdmissionScore3DOptions = {
	/** Custom scoring function. Default: rule-based (all dimensions 0.5). */
	scoreFn?: (raw: unknown) => AdmissionScores;
	/** Minimum persistence score to admit (default 0.3). */
	persistenceThreshold?: number;
	/** Minimum personalValue score to admit (default 0.3). */
	personalValueThreshold?: number;
	/** Require structure score > 0 to admit (default false). */
	requireStructured?: boolean;
};

/**
 * Default 3D admission scorer. Returns middle scores for all dimensions.
 * Override with `scoreFn` for LLM-backed or domain-specific scoring.
 */
function defaultAdmissionScorer(_raw: unknown): AdmissionScores {
	return { persistence: 0.5, structure: 0.5, personalValue: 0.5 };
}

/**
 * Creates a 3D admission filter function compatible with `agentMemory`'s
 * `admissionFilter` option. Scores each candidate on persistence, structure,
 * and personalValue, then applies thresholds.
 */
export function admissionFilter3D(opts: AdmissionScore3DOptions = {}): (raw: unknown) => boolean {
	const scoreFn = opts.scoreFn ?? defaultAdmissionScorer;
	const pThresh = opts.persistenceThreshold ?? 0.3;
	const pvThresh = opts.personalValueThreshold ?? 0.3;
	const reqStructured = opts.requireStructured ?? false;
	return (raw: unknown): boolean => {
		const scores = scoreFn(raw);
		if (scores.persistence < pThresh) return false;
		if (scores.personalValue < pvThresh) return false;
		if (reqStructured && scores.structure <= 0) return false;
		return true;
	};
}

// ---------------------------------------------------------------------------
// Memory Tiers
// ---------------------------------------------------------------------------

export type MemoryTier = "permanent" | "active" | "archived";

export type MemoryTiersOptions<TMem> = {
	/** Exponential decay rate per second for active tier.
	 *  Default: 7-day half-life ≈ ln(2)/(7×86400) ≈ 0.00000114. */
	decayRate?: number;
	/** Max entries in the active tier before archiving lowest-scored (default 1000). */
	maxActive?: number;
	/** Score threshold below which active entries get archived (default 0.1). */
	archiveThreshold?: number;
	/** Predicate: true → entry belongs in permanent tier (default: never). */
	permanentFilter?: (key: string, mem: TMem) => boolean;
	/** Persistence adapter for the archive tier. Omit to disable archiving. */
	archiveAdapter?: AutoCheckpointAdapter;
	/** Auto-checkpoint options for archive adapter. */
	archiveCheckpointOptions?: GraphAutoCheckpointOptions;
};

const DEFAULT_DECAY_RATE = Math.LN2 / (7 * 86_400); // 7-day half-life

export type MemoryTiersBundle<TMem> = {
	/** Permanent tier: never evicted. */
	readonly permanent: LightCollectionBundle<TMem>;
	/** Active entries node (reactive, holds ReadonlyMap). */
	readonly activeEntries: Node<unknown>;
	/** Archive checkpoint handle (null if no adapter). */
	readonly archiveHandle: GraphAutoCheckpointHandle | null;
	/** Classify a key into its current tier. */
	tierOf: (key: string) => MemoryTier;
	/** Move a key to the permanent tier. */
	markPermanent: (key: string, value: TMem) => void;
};

// ---------------------------------------------------------------------------
// Retrieval Pipeline
// ---------------------------------------------------------------------------

export type RetrievalQuery = {
	readonly text?: string;
	readonly vector?: readonly number[];
	readonly entityIds?: readonly string[];
};

export type RetrievalPipelineOptions<TMem> = {
	/** Max candidates from vector search (default 20). */
	topK?: number;
	/** KG expansion depth in hops (default 1). */
	graphDepth?: number;
	/** Token budget for final packing (default 2000). */
	budget?: number;
	/** Cost function for budget packing. */
	cost: (mem: TMem) => number;
	/** Score function for ranking. */
	score: (mem: TMem, context: unknown) => number;
};

/** A single entry in the retrieval result, with causal trace metadata. */
export type RetrievalEntry<TMem> = {
	readonly key: string;
	readonly value: TMem;
	readonly score: number;
	readonly sources: ReadonlyArray<"vector" | "graph" | "store">;
};

/** Causal trace for a retrieval run. */
export type RetrievalTrace<TMem> = {
	readonly vectorCandidates: ReadonlyArray<VectorSearchResult<TMem>>;
	readonly graphExpanded: ReadonlyArray<string>;
	readonly ranked: ReadonlyArray<RetrievalEntry<TMem>>;
	readonly packed: ReadonlyArray<RetrievalEntry<TMem>>;
};

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
	/** Vector index dimensions (> 0 enables vector index for retrieval). */
	vectorDimensions?: number;

	// --- In-factory composition (new) ---

	/** Extract embedding vector from a memory entry (enables vector index). */
	embedFn?: (mem: TMem) => readonly number[] | undefined;
	/** Enable knowledge graph for entity/relation tracking. */
	enableKnowledgeGraph?: boolean;
	/** Extract entities and relations from a memory entry. */
	entityFn?: (
		key: string,
		mem: TMem,
	) =>
		| {
				entities?: Array<{ id: string; value: unknown }>;
				relations?: Array<{ from: string; to: string; relation: string; weight?: number }>;
		  }
		| undefined;

	/** 3-tier storage configuration. Omit to use single-tier (existing behavior). */
	tiers?: MemoryTiersOptions<TMem>;

	/** Retrieval pipeline configuration. Requires vector index or knowledge graph. */
	retrieval?: {
		/** Max candidates from vector search (default 20). */
		topK?: number;
		/** KG expansion depth in hops (default 1). */
		graphDepth?: number;
	};

	/** Periodic reflection/consolidation configuration. */
	reflection?: {
		/** Interval in ms between consolidation runs (default 300_000 = 5 min). */
		interval?: number;
		/** Enable/disable periodic reflection (default true when consolidateFn is available). */
		enabled?: boolean;
	};
};

export type AgentMemoryGraph<TMem = unknown> = Graph & {
	readonly distillBundle: DistillBundle<TMem>;
	readonly compact: Node<Array<{ key: string; value: TMem; score: number }>>;
	readonly size: Node<number>;
	/** Vector index bundle (null if not enabled). */
	readonly vectors: VectorIndexBundle<TMem> | null;
	/** Knowledge graph (null if not enabled). */
	readonly kg: KnowledgeGraphGraph<unknown, string> | null;
	/** Memory tiers bundle (null if not configured). */
	readonly memoryTiers: MemoryTiersBundle<TMem> | null;
	/** Retrieval result node (null if no retrieval pipeline configured). */
	readonly retrieval: Node<ReadonlyArray<RetrievalEntry<TMem>>> | null;
	/** Latest retrieval trace for observability (null if no retrieval pipeline). */
	readonly retrievalTrace: Node<RetrievalTrace<TMem> | null> | null;
	/** Execute a retrieval query (null if no retrieval pipeline). */
	readonly retrieve: ((query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>) | null;
};

/**
 * Pre-wired agentic memory graph. Composes `distill()` with optional
 * `knowledgeGraph()`, `vectorIndex()`, `lightCollection()` (permanent tier),
 * `decay()`, and `autoCheckpoint()` (archive tier). Supports 3D admission
 * scoring, a default retrieval pipeline, periodic reflection, and
 * retrieval observability traces.
 */

/** Extract the key→value map from a reactive_map snapshot. */
function extractStoreMap<TMem>(snapshot: unknown): ReadonlyMap<string, TMem> {
	if (snapshot instanceof Map) return snapshot as ReadonlyMap<string, TMem>;
	return new Map<string, TMem>();
}

export function agentMemory<TMem = unknown>(
	name: string,
	source: NodeInput<unknown>,
	opts: AgentMemoryOptions<TMem>,
): AgentMemoryGraph<TMem> {
	const graph = new Graph(name, opts.graph);
	const keepaliveSubs: Array<() => void> = [];

	// --- Extract function resolution ---
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

	// --- Admission filter ---
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

	// --- Consolidation ---
	let consolidateFn:
		| ((entries: ReadonlyMap<string, TMem>) => NodeInput<Extraction<TMem>>)
		| undefined;
	if (opts.consolidateFn) {
		consolidateFn = opts.consolidateFn;
	} else if (opts.adapter && opts.consolidatePrompt) {
		consolidateFn = llmConsolidator<TMem>(opts.consolidatePrompt, { adapter: opts.adapter });
	}

	// --- Reflection: default consolidateTrigger from fromTimer ---
	let consolidateTrigger = opts.consolidateTrigger;
	if (!consolidateTrigger && consolidateFn && opts.reflection?.enabled !== false) {
		const interval = opts.reflection?.interval ?? 300_000;
		consolidateTrigger = fromTimer(interval, { period: interval });
	}

	// --- Build distill bundle ---
	const distillOpts: DistillOptions<TMem> = {
		score: opts.score,
		cost: opts.cost,
		budget: opts.budget ?? 2000,
		context: opts.context,
		consolidate: consolidateFn,
		consolidateTrigger,
	};
	const distillBundle = distill<unknown, TMem>(filteredSource, extractFn, distillOpts);

	graph.add("store", distillBundle.store.entries);
	graph.add("compact", distillBundle.compact);
	graph.add("size", distillBundle.size);
	graph.connect("store", "compact");
	graph.connect("store", "size");

	// --- Vector index (optional) ---
	let vectors: VectorIndexBundle<TMem> | null = null;
	if (opts.vectorDimensions && opts.vectorDimensions > 0 && opts.embedFn) {
		vectors = vectorIndex<TMem>({ dimension: opts.vectorDimensions });
		graph.add("vectorIndex", vectors.entries);
	}

	// --- Knowledge graph (optional) ---
	let kg: KnowledgeGraphGraph<unknown, string> | null = null;
	if (opts.enableKnowledgeGraph) {
		kg = knowledgeGraph<unknown, string>(`${name}-kg`);
		graph.mount("kg", kg);
	}

	// --- 3-tier storage (optional) ---
	let memoryTiersBundle: MemoryTiersBundle<TMem> | null = null;
	if (opts.tiers) {
		const tiersOpts = opts.tiers;
		const decayRate = tiersOpts.decayRate ?? DEFAULT_DECAY_RATE;
		const maxActive = tiersOpts.maxActive ?? 1000;
		const archiveThreshold = tiersOpts.archiveThreshold ?? 0.1;
		const permanentFilter = tiersOpts.permanentFilter ?? (() => false);

		// Permanent tier
		const permanent = lightCollection<TMem>({ name: "permanent" });
		graph.add("permanent", permanent.entries);

		// Track which keys are permanent
		const permanentKeys = new Set<string>();

		const tierOf = (key: string): MemoryTier => {
			if (permanentKeys.has(key)) return "permanent";
			const storeMap = extractStoreMap<TMem>(distillBundle.store.entries.get());
			if (storeMap.has(key)) return "active";
			return "archived";
		};

		const markPermanent = (key: string, value: TMem): void => {
			permanentKeys.add(key);
			permanent.upsert(key, value);
		};

		// Track entry creation times for accurate decay age calculation
		const entryCreatedAtNs = new Map<string, number>();

		// Post-extraction hook: classify into tiers and archive low-scored entries
		const storeNode = distillBundle.store.entries;
		const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);
		const tierClassifier = effect([storeNode, contextNode], ([snapshot, ctx]) => {
			const storeMap = extractStoreMap<TMem>(snapshot);
			const nowNs = monotonicNs();
			const toArchive: string[] = [];
			const toPermanent: Array<{ key: string; value: TMem }> = [];

			for (const [key, mem] of storeMap) {
				// Track creation time for new entries
				if (!entryCreatedAtNs.has(key)) {
					entryCreatedAtNs.set(key, nowNs);
				}

				// Check permanent classification
				if (permanentFilter(key, mem)) {
					toPermanent.push({ key, value: mem });
					continue;
				}
				// Compute decayed score for active tier
				const baseScore = opts.score(mem, ctx);
				const createdNs = entryCreatedAtNs.get(key) ?? nowNs;
				const ageSeconds = Number(nowNs - createdNs) / 1e9;
				const decayed = decay(baseScore, ageSeconds, decayRate);
				if (decayed < archiveThreshold) {
					toArchive.push(key);
				}
			}

			// Clean up creation times for removed entries
			for (const key of entryCreatedAtNs.keys()) {
				if (!storeMap.has(key)) entryCreatedAtNs.delete(key);
			}

			// Move to permanent
			for (const { key, value } of toPermanent) {
				if (!permanentKeys.has(key)) {
					markPermanent(key, value);
				}
			}

			// Archive and evict from active (respect maxActive, excluding permanent keys)
			const activeCount = storeMap.size - permanentKeys.size;
			if (activeCount > maxActive) {
				const scored = [...storeMap.entries()]
					.filter(([k]) => !permanentKeys.has(k))
					.map(([k, m]) => ({ key: k, score: opts.score(m, ctx) }))
					.sort((a, b) => a.score - b.score);
				const excess = activeCount - maxActive;
				for (let i = 0; i < excess && i < scored.length; i++) {
					const sk = scored[i]!.key;
					if (!toArchive.includes(sk)) toArchive.push(sk);
				}
			}

			// Evict archived keys from active store
			if (toArchive.length > 0) {
				batch(() => {
					for (const key of toArchive) {
						distillBundle.store.delete(key);
					}
				});
			}
		});
		keepaliveSubs.push(tierClassifier.subscribe(() => undefined));

		// Archive checkpoint
		let archiveHandle: GraphAutoCheckpointHandle | null = null;
		if (tiersOpts.archiveAdapter) {
			archiveHandle = graph.autoCheckpoint(
				tiersOpts.archiveAdapter,
				tiersOpts.archiveCheckpointOptions,
			);
		}

		memoryTiersBundle = {
			permanent,
			activeEntries: storeNode,
			archiveHandle,
			tierOf,
			markPermanent,
		};
	}

	// --- Post-extraction hooks: vector + KG indexing ---
	if (vectors || kg) {
		const embedFn = opts.embedFn;
		const entityFn = opts.entityFn;
		const storeNode = distillBundle.store.entries;

		const indexer = effect([storeNode], ([snapshot]) => {
			const storeMap = extractStoreMap<TMem>(snapshot);
			for (const [key, mem] of storeMap) {
				// Vector indexing
				if (vectors && embedFn) {
					const vec = embedFn(mem);
					if (vec) vectors.upsert(key, vec, mem);
				}
				// Knowledge graph entity/relation extraction
				if (kg && entityFn) {
					const extracted = entityFn(key, mem);
					if (extracted) {
						for (const ent of extracted.entities ?? []) {
							kg.upsertEntity(ent.id, ent.value);
						}
						for (const rel of extracted.relations ?? []) {
							kg.link(rel.from, rel.to, rel.relation as string, rel.weight);
						}
					}
				}
			}
		});
		keepaliveSubs.push(indexer.subscribe(() => undefined));
	}

	// --- Retrieval pipeline (optional) ---
	let retrievalNode: Node<ReadonlyArray<RetrievalEntry<TMem>>> | null = null;
	let retrievalTraceNode: Node<RetrievalTrace<TMem> | null> | null = null;
	let retrieveFn: ((query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>) | null = null;

	if (vectors || kg) {
		const topK = opts.retrieval?.topK ?? 20;
		const graphDepth = opts.retrieval?.graphDepth ?? 1;
		const budget = opts.budget ?? 2000;
		const costFn = opts.cost;
		const scoreFn = opts.score;

		// Query input node — updated via retrieve()
		const queryInput = state<RetrievalQuery | null>(null, {
			name: "retrievalQuery",
			describeKind: "state",
		});
		graph.add("retrievalQuery", queryInput);

		const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);
		const traceState = state<RetrievalTrace<TMem> | null>(null, {
			name: "retrievalTrace",
			describeKind: "state",
			meta: aiMeta("retrieval_trace"),
		});
		graph.add("retrievalTrace", traceState);
		retrievalTraceNode = traceState;

		const storeNode = distillBundle.store.entries;

		// Last trace captured during retrieval (populated by retrieve())
		let lastTrace: RetrievalTrace<TMem> | null = null;

		const retrievalDerived = derived<ReadonlyArray<RetrievalEntry<TMem>>>(
			[queryInput, storeNode, contextNode],
			([query, snapshot, ctx]) => {
				if (!query) return [];
				const q = query as RetrievalQuery;
				const storeMap = extractStoreMap<TMem>(snapshot);

				const candidateMap = new Map<
					string,
					{ value: TMem; sources: Set<"vector" | "graph" | "store"> }
				>();

				// Stage 1: Vector search
				let vectorCandidates: VectorSearchResult<TMem>[] = [];
				if (vectors && q.vector) {
					vectorCandidates = vectors.search(q.vector, topK) as VectorSearchResult<TMem>[];
					for (const vc of vectorCandidates) {
						const mem = storeMap.get(vc.id);
						if (mem) {
							candidateMap.set(vc.id, { value: mem, sources: new Set(["vector"]) });
						}
					}
				}

				// Stage 2: KG expansion
				const graphExpanded: string[] = [];
				if (kg) {
					const seedIds = [...(q.entityIds ?? []), ...[...candidateMap.keys()]];
					const visited = new Set<string>();
					let frontier = seedIds;
					for (let depth = 0; depth < graphDepth; depth++) {
						const nextFrontier: string[] = [];
						for (const id of frontier) {
							if (visited.has(id)) continue;
							visited.add(id);
							const related = kg.related(id);
							for (const edge of related) {
								const targetId = edge.to;
								if (!visited.has(targetId)) {
									nextFrontier.push(targetId);
									const mem = storeMap.get(targetId);
									if (mem) {
										const existing = candidateMap.get(targetId);
										if (existing) {
											existing.sources.add("graph");
										} else {
											candidateMap.set(targetId, { value: mem, sources: new Set(["graph"]) });
										}
										graphExpanded.push(targetId);
									}
								}
							}
						}
						frontier = nextFrontier;
					}
				}

				// Also include direct store matches not yet in candidates
				for (const [key, mem] of storeMap) {
					if (!candidateMap.has(key)) {
						candidateMap.set(key, { value: mem, sources: new Set(["store"]) });
					}
				}

				// Stage 3: Score and rank
				const ranked: RetrievalEntry<TMem>[] = [];
				for (const [key, { value, sources }] of candidateMap) {
					const score = scoreFn(value, ctx);
					ranked.push({ key, value, score, sources: [...sources] });
				}
				ranked.sort((a, b) => b.score - a.score);

				// Stage 4: Budget packing
				const packed: RetrievalEntry<TMem>[] = [];
				let usedBudget = 0;
				for (const entry of ranked) {
					const c = costFn(entry.value);
					if (usedBudget + c > budget && packed.length > 0) break;
					packed.push(entry);
					usedBudget += c;
				}

				// Capture trace (no side-effect — stored for retrieval by retrieve())
				lastTrace = { vectorCandidates, graphExpanded, ranked, packed };

				return packed;
			},
			{
				name: "retrieval",
				describeKind: "derived",
				meta: aiMeta("retrieval_pipeline"),
				initial: [],
			},
		);
		graph.add("retrieval", retrievalDerived);
		graph.connect("retrievalQuery", "retrieval");
		graph.connect("store", "retrieval");
		keepaliveSubs.push(retrievalDerived.subscribe(() => undefined));
		retrievalNode = retrievalDerived;

		retrieveFn = (query: RetrievalQuery): ReadonlyArray<RetrievalEntry<TMem>> => {
			queryInput.down([[DATA, query]]);
			const result = retrievalDerived.get() as ReadonlyArray<RetrievalEntry<TMem>>;
			// Update trace node outside derived callback (avoids reactive glitch)
			if (lastTrace) {
				traceState.down([[DATA, lastTrace]]);
			}
			return result;
		};
	}

	// --- Cleanup ---
	graph.addDisposer(() => {
		for (const unsub of keepaliveSubs) unsub();
		keepaliveSubs.length = 0;
	});

	return Object.assign(graph, {
		distillBundle,
		compact: distillBundle.compact,
		size: distillBundle.size,
		vectors,
		kg,
		memoryTiers: memoryTiersBundle,
		retrieval: retrievalNode,
		retrievalTrace: retrievalTraceNode,
		retrieve: retrieveFn,
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

// ---------------------------------------------------------------------------
// 5.4 — LLM tool integration
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// gaugesAsContext
// ---------------------------------------------------------------------------

export type GaugesAsContextOptions = {
	/** Group gauges by `meta.tags` (default true). */
	groupByTags?: boolean;
	/** Separator between gauge lines (default "\n"). */
	separator?: string;
	/**
	 * V0 delta mode (§6.0b): only include nodes whose `v.version` exceeds
	 * the corresponding entry in this map. Nodes without V0 or not in the
	 * map are always included. Callers maintain this map across calls.
	 *
	 * The `id` field guards against node replacement: if a node is removed
	 * and re-added under the same name (new id), it is always included.
	 */
	sinceVersion?: ReadonlyMap<string, { id: string; version: number }>;
};

/**
 * Format a graph's readable (gauge) nodes as a context string for LLM
 * system prompts.
 *
 * Gauges are nodes with `meta.description` or `meta.format`. Values are
 * formatted using `meta.format` and `meta.unit` hints.
 *
 * @param graph - The graph to introspect.
 * @param actor - Optional actor for guard-scoped describe.
 * @param options - Formatting options.
 * @returns A formatted string ready for system prompt injection.
 */
export function gaugesAsContext(
	graph: Graph,
	actor?: Actor,
	options?: GaugesAsContextOptions,
): string {
	const described = graph.describe({ actor, detail: "full" });
	const groupByTags = options?.groupByTags ?? true;
	const separator = options?.separator ?? "\n";

	type GaugeEntry = { path: string; description: string; formatted: string };
	const entries: GaugeEntry[] = [];

	const sinceVersion = options?.sinceVersion;
	for (const [path, node] of Object.entries(described.nodes)) {
		const meta = node.meta ?? {};
		const desc = meta.description as string | undefined;
		const format = meta.format as string | undefined;
		// Must have description or format to be a gauge
		if (!desc && !format) continue;
		// V0 delta filter: skip nodes unchanged since last seen version (§6.0b).
		if (sinceVersion != null && node.v != null) {
			const lastSeen = sinceVersion.get(path);
			if (lastSeen != null && lastSeen.id === node.v.id && node.v.version <= lastSeen.version)
				continue;
		}

		const label = desc ?? path;
		const value = node.value;
		const unit = meta.unit as string | undefined;

		let formatted: string;
		if (format === "currency" && typeof value === "number") {
			formatted = `$${value.toFixed(2)}`;
		} else if (format === "percentage" && typeof value === "number") {
			formatted = `${(value * 100).toFixed(1)}%`;
		} else if (value === undefined || value === null) {
			formatted = "(no value)";
		} else {
			formatted = String(value);
		}

		if (unit && format !== "currency" && format !== "percentage") {
			formatted = `${formatted} ${unit}`;
		}

		entries.push({ path, description: label, formatted });
	}

	if (entries.length === 0) return "";

	if (groupByTags) {
		const tagGroups = new Map<string, GaugeEntry[]>();
		const ungrouped: GaugeEntry[] = [];

		for (const entry of entries) {
			const node = described.nodes[entry.path]!;
			const tags = node.meta?.tags as string[] | undefined;
			if (tags && tags.length > 0) {
				// Use first tag for grouping to avoid duplicating entries across groups
				const tag = tags[0]!;
				let group = tagGroups.get(tag);
				if (!group) {
					group = [];
					tagGroups.set(tag, group);
				}
				group.push(entry);
			} else {
				ungrouped.push(entry);
			}
		}

		if (tagGroups.size === 0) {
			return entries.map((e) => `- ${e.description}: ${e.formatted}`).join(separator);
		}

		const sections: string[] = [];
		for (const [tag, group] of [...tagGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			sections.push(
				`[${tag}]${separator}${group.map((e) => `- ${e.description}: ${e.formatted}`).join(separator)}`,
			);
		}
		if (ungrouped.length > 0) {
			sections.push(ungrouped.map((e) => `- ${e.description}: ${e.formatted}`).join(separator));
		}
		return sections.join(separator + separator);
	}

	return entries.map((e) => `- ${e.description}: ${e.formatted}`).join(separator);
}

// ---------------------------------------------------------------------------
// validateGraphDef
// ---------------------------------------------------------------------------

/** Validation result from {@link validateGraphDef}. */
export type GraphDefValidation = {
	readonly valid: boolean;
	readonly errors: readonly string[];
};

const VALID_NODE_TYPES = new Set(["state", "derived", "producer", "operator", "effect"]);

/**
 * Validate an LLM-generated graph definition before passing to
 * `Graph.fromSnapshot()`.
 *
 * Checks:
 * - Required fields: `name`, `nodes`, `edges`
 * - Node types are valid enum values
 * - Edge `from`/`to` reference existing nodes
 * - No duplicate edge entries
 *
 * @param def - The graph definition to validate (parsed JSON).
 * @returns Validation result with errors array.
 */
export function validateGraphDef(def: unknown): GraphDefValidation {
	const errors: string[] = [];

	if (def == null || typeof def !== "object") {
		return { valid: false, errors: ["Definition must be a non-null object"] };
	}

	const d = def as Record<string, unknown>;

	if (typeof d.name !== "string" || d.name.length === 0) {
		errors.push("Missing or empty 'name' field");
	}

	if (d.nodes == null || typeof d.nodes !== "object" || Array.isArray(d.nodes)) {
		errors.push("Missing or invalid 'nodes' field (must be an object)");
		return { valid: false, errors };
	}

	const nodeNames = new Set(Object.keys(d.nodes as object));

	for (const [name, raw] of Object.entries(d.nodes as Record<string, unknown>)) {
		if (raw == null || typeof raw !== "object") {
			errors.push(`Node "${name}": must be an object`);
			continue;
		}
		const node = raw as Record<string, unknown>;
		if (typeof node.type !== "string" || !VALID_NODE_TYPES.has(node.type)) {
			errors.push(
				`Node "${name}": invalid type "${String(node.type)}" (expected: ${[...VALID_NODE_TYPES].join(", ")})`,
			);
		}
		if (Array.isArray(node.deps)) {
			for (const dep of node.deps) {
				if (typeof dep === "string" && !nodeNames.has(dep)) {
					errors.push(`Node "${name}": dep "${dep}" does not reference an existing node`);
				}
			}
		}
	}

	if (!Array.isArray(d.edges)) {
		if (d.edges !== undefined) {
			errors.push("'edges' must be an array");
		}
		// edges are optional — no error if absent
	} else {
		const seen = new Set<string>();
		for (let i = 0; i < (d.edges as unknown[]).length; i++) {
			const edge = (d.edges as unknown[])[i];
			if (edge == null || typeof edge !== "object") {
				errors.push(`Edge [${i}]: must be an object`);
				continue;
			}
			const e = edge as Record<string, unknown>;
			if (typeof e.from !== "string" || !nodeNames.has(e.from)) {
				errors.push(`Edge [${i}]: 'from' "${String(e.from)}" does not reference an existing node`);
			}
			if (typeof e.to !== "string" || !nodeNames.has(e.to)) {
				errors.push(`Edge [${i}]: 'to' "${String(e.to)}" does not reference an existing node`);
			}
			const key = `${e.from}->${e.to}`;
			if (seen.has(key)) {
				errors.push(`Edge [${i}]: duplicate edge ${key}`);
			}
			seen.add(key);
		}
	}

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// graphFromSpec
// ---------------------------------------------------------------------------

export type GraphFromSpecOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Callback to construct topology before values are applied (passed to `Graph.fromSnapshot`). */
	build?: (g: Graph) => void;
	/** Extra instructions appended to the system prompt. */
	systemPromptExtra?: string;
};

/** Strip markdown code fences, handling trailing commentary after closing fence. */
function stripFences(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```[\s\S]*$/);
	return match ? match[1]! : text;
}

const GRAPH_FROM_SPEC_SYSTEM_PROMPT = `You are a graph architect for GraphReFly, a reactive graph protocol.

Given a natural-language description, produce a JSON graph definition with this structure:

{
  "name": "<graph_name>",
  "nodes": {
    "<node_name>": {
      "type": "state" | "derived" | "producer" | "operator" | "effect",
      "value": <initial_value_or_null>,
      "deps": ["<dep_node_name>", ...],
      "meta": {
        "description": "<human-readable purpose>",
        "type": "string" | "number" | "boolean" | "integer" | "enum",
        "range": [min, max],
        "values": ["a", "b"],
        "format": "currency" | "percentage" | "status",
        "access": "human" | "llm" | "both" | "system",
        "unit": "<unit>",
        "tags": ["<tag>"]
      }
    }
  },
  "edges": [
    { "from": "<source_node>", "to": "<target_node>" }
  ]
}

Rules:
- "state" nodes have no deps and hold user/LLM-writable values (knobs).
- "derived" nodes have deps and compute from them.
- "effect" nodes have deps but produce side effects (no return value).
- "producer" nodes have no deps but generate values asynchronously.
- Edges wire output of one node as input to another. They must match deps.
- meta.description is required for every node.
- Return ONLY valid JSON, no markdown fences or commentary.`;

/**
 * Ask an LLM to compose a Graph from a natural-language description.
 *
 * The LLM returns a JSON graph definition which is validated and then
 * constructed via `Graph.fromSnapshot()`.
 *
 * @param naturalLanguage - The problem/use-case description.
 * @param adapter - LLM adapter for the generation call.
 * @param opts - Model options and optional `build` callback for node factories.
 * @returns A constructed Graph.
 * @throws On invalid LLM output or validation failure.
 */
export async function graphFromSpec(
	naturalLanguage: string,
	adapter: LLMAdapter,
	opts?: GraphFromSpecOptions,
): Promise<Graph> {
	const systemPrompt = opts?.systemPromptExtra
		? `${GRAPH_FROM_SPEC_SYSTEM_PROMPT}\n\n${opts.systemPromptExtra}`
		: GRAPH_FROM_SPEC_SYSTEM_PROMPT;

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: naturalLanguage },
	];

	const rawResult = adapter.invoke(messages, {
		model: opts?.model,
		temperature: opts?.temperature ?? 0,
		maxTokens: opts?.maxTokens,
	});

	const response = (await resolveToolHandlerResult(rawResult)) as LLMResponse;
	let content = response.content.trim();

	// Strip markdown fences if present (handles trailing commentary after ```)
	if (content.startsWith("```")) {
		content = stripFences(content);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`graphFromSpec: LLM response is not valid JSON: ${content.slice(0, 200)}`);
	}

	const validation = validateGraphDef(parsed);
	if (!validation.valid) {
		throw new Error(`graphFromSpec: invalid graph definition:\n${validation.errors.join("\n")}`);
	}

	const def = parsed as Record<string, unknown>;
	// Ensure version field is present for fromSnapshot envelope check
	if (def.version === undefined) def.version = 1;
	if (!Array.isArray(def.subgraphs)) def.subgraphs = [];
	return Graph.fromSnapshot(def as GraphPersistSnapshot, opts?.build);
}

// ---------------------------------------------------------------------------
// suggestStrategy
// ---------------------------------------------------------------------------

/** A single operation in a strategy plan. */
export type StrategyOperation =
	| {
			readonly type: "add_node";
			readonly name: string;
			readonly nodeType: string;
			readonly meta?: Record<string, unknown>;
			readonly initial?: unknown;
	  }
	| { readonly type: "remove_node"; readonly name: string }
	| { readonly type: "connect"; readonly from: string; readonly to: string }
	| { readonly type: "disconnect"; readonly from: string; readonly to: string }
	| { readonly type: "set_value"; readonly name: string; readonly value: unknown }
	| {
			readonly type: "update_meta";
			readonly name: string;
			readonly key: string;
			readonly value: unknown;
	  };

/** Structured strategy plan returned by {@link suggestStrategy}. */
export type StrategyPlan = {
	readonly summary: string;
	readonly operations: readonly StrategyOperation[];
	readonly reasoning: string;
};

export type SuggestStrategyOptions = {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	actor?: Actor;
};

const SUGGEST_STRATEGY_SYSTEM_PROMPT = `You are a reactive graph optimizer for GraphReFly.

Given a graph's current structure (from describe()) and a problem statement, suggest topology and parameter changes to solve the problem.

Return ONLY valid JSON with this structure:
{
  "summary": "<one-line summary of the strategy>",
  "reasoning": "<explanation of why these changes help>",
  "operations": [
    { "type": "add_node", "name": "<name>", "nodeType": "state|derived|effect|producer|operator", "meta": {...}, "initial": <value> },
    { "type": "remove_node", "name": "<name>" },
    { "type": "connect", "from": "<source>", "to": "<target>" },
    { "type": "disconnect", "from": "<source>", "to": "<target>" },
    { "type": "set_value", "name": "<name>", "value": <new_value> },
    { "type": "update_meta", "name": "<name>", "key": "<meta_key>", "value": <new_value> }
  ]
}

Rules:
- Only suggest operations that reference existing nodes (for remove/disconnect/set_value/update_meta) or new nodes you define (for add_node).
- Keep changes minimal — prefer the smallest set of operations that solves the problem.
- Return ONLY valid JSON, no markdown fences or commentary.`;

/**
 * Ask an LLM to analyze a graph and suggest topology/parameter changes
 * to solve a stated problem.
 *
 * Returns a structured plan — does NOT auto-apply. The caller reviews
 * and selectively applies operations.
 *
 * @param graph - The graph to analyze.
 * @param problem - Natural-language problem statement.
 * @param adapter - LLM adapter for the analysis call.
 * @param opts - Model and actor options.
 * @returns A structured strategy plan.
 * @throws On invalid LLM output.
 */
export async function suggestStrategy(
	graph: Graph,
	problem: string,
	adapter: LLMAdapter,
	opts?: SuggestStrategyOptions,
): Promise<StrategyPlan> {
	const { expand: _, ...described } = graph.describe({ actor: opts?.actor, detail: "standard" });

	const messages: ChatMessage[] = [
		{ role: "system", content: SUGGEST_STRATEGY_SYSTEM_PROMPT },
		{
			role: "user",
			content: JSON.stringify({
				graph: described,
				problem,
			}),
		},
	];

	const rawResult = adapter.invoke(messages, {
		model: opts?.model,
		temperature: opts?.temperature ?? 0,
		maxTokens: opts?.maxTokens,
	});

	const response = (await resolveToolHandlerResult(rawResult)) as LLMResponse;
	let content = response.content.trim();

	if (content.startsWith("```")) {
		content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`suggestStrategy: LLM response is not valid JSON: ${content.slice(0, 200)}`);
	}

	const plan = parsed as Record<string, unknown>;

	if (typeof plan.summary !== "string") {
		throw new Error("suggestStrategy: missing 'summary' in response");
	}
	if (typeof plan.reasoning !== "string") {
		throw new Error("suggestStrategy: missing 'reasoning' in response");
	}
	if (!Array.isArray(plan.operations)) {
		throw new Error("suggestStrategy: missing 'operations' array in response");
	}

	return {
		summary: plan.summary,
		reasoning: plan.reasoning,
		operations: plan.operations as readonly StrategyOperation[],
	};
}
