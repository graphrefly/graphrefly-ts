/**
 * AI surface patterns (roadmap §4.4).
 *
 * Domain-layer factories for LLM-backed agents, chat, tool registries, and
 * agentic memory. Composed from core + extra + Phase 3–4.3 primitives.
 */

import type { Actor } from "../../core/actor.js";
import { batch } from "../../core/batch.js";
import { monotonicNs } from "../../core/clock.js";
import { COMPLETE, DATA, ERROR, RESOLVED } from "../../core/messages.js";
import { type Node, node as nodeFactory } from "../../core/node.js";
import { derived, effect, producer, state } from "../../core/sugar.js";
import {
	type DistillBundle,
	type DistillOptions,
	distill,
	type Extraction,
} from "../../extra/composite.js";
import { rescue, switchMap } from "../../extra/operators.js";
import { type ReactiveLogBundle, reactiveLog } from "../../extra/reactive-log.js";
import { retrySource } from "../../extra/resilience.js";
import { awaitSettled, fromAny, fromTimer, type NodeInput } from "../../extra/sources.js";
import type { StorageHandle, StorageTier } from "../../extra/storage-core.js";
import { ResettableTimer } from "../../extra/timer.js";
import {
	Graph,
	type GraphAttachStorageOptions,
	type GraphOptions,
	type GraphPersistSnapshot,
} from "../../graph/graph.js";
import {
	decay,
	type KnowledgeGraphGraph,
	knowledgeGraph,
	type LightCollectionBundle,
	lightCollection,
	type VectorIndexBundle,
	type VectorSearchResult,
	vectorIndex,
} from "../memory/index.js";
import { type TopicGraph, topic } from "../messaging/index.js";
import { type GateController, type GateOptions, gate } from "../orchestration/index.js";

// ---------------------------------------------------------------------------
// Adapter layer (§9.3d) — providers, middleware, routing primitives
// re-exported so users reach `createAdapter`, `resilientAdapter`, etc. via
// `patterns.ai.<name>`. Browser-only adapters (WebLLM, ChromeNano) stay
// behind a subpath to keep Node bundles lean.
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
export * from "./adapters/routing/presets.js";

// ---------------------------------------------------------------------------
// Types — single source of truth lives in ./ai/adapters/core/types.ts
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

import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
	ToolCall,
	ToolDefinition,
} from "./adapters/core/types.js";

export type AgentLoopStatus = "idle" | "thinking" | "acting" | "done" | "error";

/**
 * A single chunk from any streaming source (LLM tokens, WebSocket, SSE, file tail).
 * Generic enough for any streaming source, not just LLM.
 */
export type StreamChunk = {
	/** Identifier for the stream source (adapter name, URL, etc.). */
	readonly source: string;
	/** This chunk's content. */
	readonly token: string;
	/** Full accumulated text so far. */
	readonly accumulated: string;
	/** 0-based chunk counter. */
	readonly index: number;
};

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

import { domainMeta, keepalive } from "../_internal.js";

function aiMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("ai", kind, extra);
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
		"cache" in x
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
		const immediate = resolved.cache;
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
// frozenContext — prefix-cache-friendly snapshot of upstream context
// ---------------------------------------------------------------------------

export type FrozenContextOptions = {
	/**
	 * Reactive signal that triggers re-materialization. Each `DATA` emission
	 * from this node re-reads the source and refreshes the frozen value.
	 * Typical shapes: `fromTimer(ms)` for periodic refresh, a stage-transition
	 * node for event-driven refresh, or a manual `state<number>` the caller
	 * increments via `setState(n + 1)`.
	 *
	 * When omitted, the frozen value is materialized exactly once (on first
	 * subscribe) and never refreshes — use this for session-start snapshots
	 * that must stay stable for the lifetime of the activation.
	 */
	refreshTrigger?: NodeInput<unknown>;
	name?: string;
};

/**
 * Freeze a reactive source into a stable snapshot that only re-materializes
 * on explicit trigger. Built for long-running harness loops where system
 * prompts include `agentMemory` / stage context — every reactive change to
 * the source invalidates the LLM provider's prefix cache, so re-rendering
 * the prompt every turn is expensive.
 *
 * `frozenContext(source)` reads the source once and caches the value;
 * downstream `promptNode` compositions see a stable reference until the
 * optional `refreshTrigger` fires.
 *
 * Trade-off: slightly stale context vs. prefix cache hit rate. For most
 * harness apps, the memory snapshot at session start is "good enough" —
 * refreshing on a coarse-grained trigger (`fromCron("*\/30min")`, stage
 * transition) preserves 90%+ prefix cache hits while keeping context useful.
 *
 * @example
 * ```ts
 * // Freeze agent memory for the duration of a stage.
 * const frozen = frozenContext(memory.context, {
 *   refreshTrigger: stage,  // re-materialize on stage change
 * });
 * const reply = promptNode({ context: frozen, ... });
 * ```
 *
 * @category patterns.ai
 */
export function frozenContext<T>(
	source: NodeInput<T>,
	opts?: FrozenContextOptions,
): Node<T | null> {
	const src = fromAny(source);
	const trigger = opts?.refreshTrigger != null ? fromAny(opts.refreshTrigger) : null;

	// Single-shot path: deps = [src] only. Emit the first src value and then
	// hold regardless of source drift.
	if (trigger == null) {
		return nodeFactory<T | null>(
			[src],
			(data, actions, ctx) => {
				const alreadyEmitted = ctx.store.emitted === true;
				if (alreadyEmitted) return;
				const srcBatch = data[0];
				const srcValue =
					srcBatch != null && srcBatch.length > 0 ? srcBatch.at(-1) : ctx.prevData[0];
				// Only emit once src has produced a settled value.
				if (srcValue === undefined) return;
				ctx.store.emitted = true;
				actions.emit(srcValue as T);
				// On INVALIDATE (graph-wide flush), reset the "already emitted"
				// latch so the next fn re-run captures a fresh snapshot.
				// Without this, INVALIDATE clears the cache but the latch stays
				// armed, so subscribers stay on the cleared (null) state forever.
				return {
					invalidate: () => {
						ctx.store.emitted = false;
					},
				};
			},
			{
				name: opts?.name ?? "frozenContext",
				describeKind: "derived",
				initial: null,
				meta: aiMeta("frozen_context"),
			},
		);
	}

	// Refresh-on-trigger path: deps = [src, trigger]. Emit the current src
	// value ONLY when the trigger dep is involved in the wave. Source-only
	// changes are silently held so downstream prompt composition sees the
	// same value between triggers, preserving the LLM provider's prefix cache.
	//
	// Uses raw `node()` to inspect per-dep wave involvement — `derived` fires
	// on any dep change and can't distinguish. The declaration-order semantic
	// gap in multi-dep push-on-subscribe (§2.7) works in our favor on
	// activation: src fires first (captured into ctx.prevData), trigger fires
	// in a second wave → emit via prevData[0] fallback.
	return nodeFactory<T | null>(
		[src, trigger],
		(data, actions, ctx) => {
			const triggerBatch = data[1];
			const triggered = triggerBatch != null && triggerBatch.length > 0;
			if (!triggered) return;
			const srcBatch = data[0];
			const srcValue = srcBatch != null && srcBatch.length > 0 ? srcBatch.at(-1) : ctx.prevData[0];
			actions.emit(srcValue as T);
		},
		{
			name: opts?.name ?? "frozenContext",
			describeKind: "derived",
			initial: null,
			meta: aiMeta("frozen_context"),
		},
	);
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
// streamingPromptNode
// ---------------------------------------------------------------------------

export type StreamingPromptNodeOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Output format — `"json"` attempts JSON.parse on the final accumulated text. Default: `"text"`. */
	format?: "text" | "json";
	systemPrompt?: string;
};

/**
 * Bundle returned by {@link streamingPromptNode}.
 */
export type StreamingPromptNodeHandle<T> = {
	/** Final parsed result (emits once per invocation, after stream completes). */
	output: Node<T | null>;
	/** Live stream topic — subscribe to `stream.latest` or `stream.events` for chunks. */
	stream: TopicGraph<StreamChunk>;
	/** Tear down the keepalive subscription and release resources. */
	dispose: () => void;
};

/**
 * Streaming LLM transform: wraps a prompt template + adapter into a reactive
 * streaming pipeline. Re-invokes the LLM whenever any dep changes; the
 * previous in-flight stream is canceled automatically via `switchMap`.
 *
 * Each token chunk is published to a {@link TopicGraph} as a {@link StreamChunk}.
 * Extractors can mount on the topic independently (see {@link streamExtractor}).
 * Zero overhead if nobody subscribes to the stream topic.
 *
 * The `output` node emits the final parsed result (like {@link promptNode}).
 * The async boundary is handled by `fromAny` (spec §5.10 compliant).
 */
export function streamingPromptNode<T = string>(
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: StreamingPromptNodeOptions,
): StreamingPromptNodeHandle<T> {
	const sourceName = opts?.name ?? "llm";
	const format = opts?.format ?? "text";
	const streamTopic = topic<StreamChunk>(`${sourceName}/stream`);

	const messagesNode = derived<readonly ChatMessage[]>(deps as Node<unknown>[], (values) => {
		if (values.some((v) => v == null)) return [];
		const text = typeof prompt === "string" ? prompt : prompt(...values);
		if (!text) return [];
		const msgs: ChatMessage[] = [];
		if (opts?.systemPrompt) msgs.push({ role: "system", content: opts.systemPrompt });
		msgs.push({ role: "user", content: text });
		return msgs;
	});

	const output = switchMap(messagesNode, (msgs) => {
		const chatMsgs = msgs as readonly ChatMessage[];
		if (!chatMsgs || chatMsgs.length === 0) {
			return state<T | null>(null) as NodeInput<T | null>;
		}

		const ac = new AbortController();

		async function* pumpAndCollect(): AsyncGenerator<T | null> {
			let accumulated = "";
			let index = 0;
			try {
				for await (const delta of adapter.stream(chatMsgs, {
					model: opts?.model,
					temperature: opts?.temperature,
					maxTokens: opts?.maxTokens,
					systemPrompt: opts?.systemPrompt,
					signal: ac.signal,
				})) {
					if (delta.type !== "token") continue;
					const token = delta.delta;
					accumulated += token;
					streamTopic.publish({
						source: sourceName,
						token,
						accumulated,
						index: index++,
					});
				}
				let result: T | null;
				if (format === "json") {
					try {
						result = JSON.parse(stripFences(accumulated)) as T;
					} catch {
						result = null;
					}
				} else {
					result = accumulated as unknown as T;
				}
				yield result;
			} finally {
				ac.abort();
			}
		}

		return fromAny(pumpAndCollect());
	});

	const unsub = keepalive(output);

	return {
		output,
		stream: streamTopic,
		dispose: () => {
			unsub();
			streamTopic.destroy();
		},
	};
}

// ---------------------------------------------------------------------------
// streamExtractor
// ---------------------------------------------------------------------------

/**
 * Mounts an extractor function on a streaming topic. Returns a derived node
 * that emits extracted values as chunks arrive.
 *
 * `extractFn` receives the accumulated text from the latest chunk and returns
 * the extracted value, or `null` if nothing detected yet. This is the building
 * block for keyword flags, tool call detection, cost metering, etc.
 *
 * @param streamTopic - The stream topic to extract from.
 * @param extractFn - `(accumulated: string) => T | null`.
 * @param opts - Optional name.
 * @returns Derived node emitting extracted values.
 */
export function streamExtractor<T>(
	streamTopic: TopicGraph<StreamChunk>,
	extractFn: (accumulated: string) => T | null,
	opts?: {
		name?: string;
		/**
		 * Optional structural equals for the extractor output. When two
		 * consecutive chunks produce structurally-equal outputs, the framework
		 * emits `RESOLVED` instead of `DATA`, saving downstream work. Default:
		 * reference equality (`Object.is`). The library cannot know your
		 * output shape — supply this when your `extractFn` returns structured
		 * objects or arrays.
		 */
		equals?: (a: T | null, b: T | null) => boolean;
	},
): Node<T | null> {
	return derived<T | null>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk]) => {
			if (chunk == null) return null;
			return extractFn((chunk as StreamChunk).accumulated);
		},
		{
			name: opts?.name ?? "extractor",
			describeKind: "derived",
			initial: null,
			meta: aiMeta("stream_extractor"),
			...(opts?.equals ? { equals: opts.equals } : {}),
		},
	);
}

// ---------------------------------------------------------------------------
// keywordFlagExtractor
// ---------------------------------------------------------------------------

/** A keyword match detected in the stream. */
export type KeywordFlag = {
	readonly label: string;
	readonly pattern: RegExp;
	readonly match: string;
	readonly position: number;
};

export type KeywordFlagExtractorOptions = {
	patterns: readonly { pattern: RegExp; label: string }[];
	name?: string;
	/**
	 * Maximum length of any pattern's literal text. Used as an overlap window
	 * when cursoring through the accumulated stream so matches that span
	 * chunk boundaries aren't missed. Default: 128.
	 */
	maxPatternLength?: number;
};

const keywordFlagsEqual = (
	a: readonly KeywordFlag[] | null,
	b: readonly KeywordFlag[] | null,
): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (
			x.label !== y.label ||
			x.pattern !== y.pattern ||
			x.match !== y.match ||
			x.position !== y.position
		) {
			return false;
		}
	}
	return true;
};

/**
 * Mounts a keyword-flag extractor on a streaming topic. Scans accumulated text
 * for all configured patterns and emits an array of matches.
 *
 * Use cases: design invariant violations (`setTimeout`, `EventEmitter`), PII
 * detection (SSN, email, phone), toxicity keywords, off-track reasoning.
 *
 * **Streaming optimization.** Maintains a cursor across chunks in `ctx.store`
 * so each chunk scans only the delta region `accumulated.slice(scannedTo -
 * maxPatternLength)` — not the full string. Default structural equals
 * suppresses DATA emission when no new flags were found this chunk.
 */
export function keywordFlagExtractor(
	streamTopic: TopicGraph<StreamChunk>,
	opts: KeywordFlagExtractorOptions,
): Node<readonly KeywordFlag[]> {
	const maxPatternLength = opts.maxPatternLength ?? 128;
	return derived<readonly KeywordFlag[]>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk], ctx) => {
			if (chunk == null) return [];
			const accumulated = (chunk as StreamChunk).accumulated;

			if (!("flags" in ctx.store)) {
				ctx.store.flags = [] as KeywordFlag[];
				ctx.store.scannedTo = 0;
			}
			const flags = ctx.store.flags as KeywordFlag[];
			const scannedTo = ctx.store.scannedTo as number;

			// Scan the delta plus an overlap window so matches that span
			// chunk boundaries (e.g. "EventE" + "mitter") are still found.
			const startOffset = Math.max(0, scannedTo - maxPatternLength);
			const region = accumulated.slice(startOffset);
			let added = false;
			for (const { pattern, label } of opts.patterns) {
				const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
				for (const m of region.matchAll(re)) {
					const pos = startOffset + m.index!;
					// Skip matches that end inside the already-scanned prefix.
					if (pos + m[0].length <= scannedTo) continue;
					flags.push({ label, pattern, match: m[0], position: pos });
					added = true;
				}
			}
			ctx.store.scannedTo = accumulated.length;

			// Always return a fresh copy so downstream never holds a live
			// reference to ctx.store.flags. Structural equals suppresses the
			// emission when no new flag was added this chunk.
			return added ? [...flags] : flags.slice();
		},
		{
			name: opts.name ?? "keyword-flag-extractor",
			describeKind: "derived",
			initial: [],
			meta: aiMeta("keyword_flag_extractor"),
			equals: keywordFlagsEqual,
		},
	);
}

// ---------------------------------------------------------------------------
// toolCallExtractor
// ---------------------------------------------------------------------------

/** A tool call detected in the stream. */
export type ExtractedToolCall = {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
	readonly raw: string;
	readonly startIndex: number;
};

const toolCallsEqual = (
	a: readonly ExtractedToolCall[] | null,
	b: readonly ExtractedToolCall[] | null,
): boolean => {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (x.startIndex !== y.startIndex || x.name !== y.name || x.raw !== y.raw) {
			return false;
		}
	}
	return true;
};

/**
 * Mounts a tool-call extractor on a streaming topic. Scans accumulated text
 * for complete JSON objects containing `"name"` and `"arguments"` keys (the
 * standard tool_call shape). Partial JSON is ignored until the closing brace.
 *
 * Feeds into the tool interception chain for reactive tool gating mid-stream.
 *
 * **Streaming optimization.** Maintains a cursor (`scanFrom`) in `ctx.store`
 * so each chunk resumes brace-scanning from the position after the last
 * complete parse (or the last incomplete open brace). Already-parsed objects
 * are not re-parsed. Default structural equals suppresses DATA emission when
 * no new tool call completed this chunk.
 */
export function toolCallExtractor(
	streamTopic: TopicGraph<StreamChunk>,
	opts?: { name?: string },
): Node<readonly ExtractedToolCall[]> {
	return derived<readonly ExtractedToolCall[]>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk], ctx) => {
			if (chunk == null) return [];
			const accumulated = (chunk as StreamChunk).accumulated;

			if (!("calls" in ctx.store)) {
				ctx.store.calls = [] as ExtractedToolCall[];
				ctx.store.scanFrom = 0;
			}
			const calls = ctx.store.calls as ExtractedToolCall[];
			let i = ctx.store.scanFrom as number;
			let added = false;

			while (i < accumulated.length) {
				const start = accumulated.indexOf("{", i);
				if (start === -1) {
					ctx.store.scanFrom = accumulated.length;
					break;
				}
				let depth = 0;
				let end = -1;
				let inString = false;
				for (let j = start; j < accumulated.length; j++) {
					const ch = accumulated[j];
					if (inString) {
						if (ch === "\\" && j + 1 < accumulated.length) {
							j++; // skip escaped character
						} else if (ch === '"') {
							inString = false;
						}
					} else if (ch === '"') {
						inString = true;
					} else if (ch === "{") {
						depth++;
					} else if (ch === "}") {
						depth--;
						if (depth === 0) {
							end = j;
							break;
						}
					}
				}
				if (end === -1) {
					// Incomplete — resume brace-scanning from this open brace
					// next chunk. Do NOT advance past it.
					ctx.store.scanFrom = start;
					break;
				}
				const raw = accumulated.slice(start, end + 1);
				try {
					const parsed = JSON.parse(raw) as Record<string, unknown>;
					if (
						typeof parsed.name === "string" &&
						parsed.arguments != null &&
						typeof parsed.arguments === "object"
					) {
						calls.push({
							name: parsed.name,
							arguments: parsed.arguments as Record<string, unknown>,
							raw,
							startIndex: start,
						});
						added = true;
					}
				} catch {
					// Not valid JSON — skip
				}
				i = end + 1;
				ctx.store.scanFrom = i;
			}

			// Always return a fresh copy so downstream never holds a live
			// reference to ctx.store.calls.
			return added ? [...calls] : calls.slice();
		},
		{
			name: opts?.name ?? "tool-call-extractor",
			describeKind: "derived",
			initial: [],
			meta: aiMeta("tool_call_extractor"),
			equals: toolCallsEqual,
		},
	);
}

// ---------------------------------------------------------------------------
// costMeterExtractor
// ---------------------------------------------------------------------------

/** A cost meter reading from the stream. */
export type CostMeterReading = {
	readonly chunkCount: number;
	readonly charCount: number;
	readonly estimatedTokens: number;
};

export type CostMeterOptions = {
	/** Characters per token approximation. Default: 4 (GPT-family). */
	charsPerToken?: number;
	name?: string;
};

const costMeterEqual = (a: CostMeterReading, b: CostMeterReading): boolean => {
	if (a === b) return true;
	return (
		a.chunkCount === b.chunkCount &&
		a.charCount === b.charCount &&
		a.estimatedTokens === b.estimatedTokens
	);
};

/**
 * Mounts a cost meter on a streaming topic. Counts chunks, characters, and
 * estimates token count. Compose with `budgetGate` for hard-stop when LLM
 * output exceeds budget mid-generation.
 *
 * Default structural equals suppresses DATA emission when two consecutive
 * readings are identical (same chunk count + char count + token estimate).
 */
export function costMeterExtractor(
	streamTopic: TopicGraph<StreamChunk>,
	opts?: CostMeterOptions,
): Node<CostMeterReading> {
	const charsPerToken = opts?.charsPerToken ?? 4;
	return derived<CostMeterReading>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk]) => {
			if (chunk == null) return { chunkCount: 0, charCount: 0, estimatedTokens: 0 };
			const c = chunk as StreamChunk;
			const charCount = c.accumulated.length;
			return {
				chunkCount: c.index + 1,
				charCount,
				estimatedTokens: Math.ceil(charCount / charsPerToken),
			};
		},
		{
			name: opts?.name ?? "cost-meter",
			describeKind: "derived",
			initial: { chunkCount: 0, charCount: 0, estimatedTokens: 0 },
			meta: aiMeta("cost_meter_extractor"),
			equals: costMeterEqual,
		},
	);
}

// ---------------------------------------------------------------------------
// Composition B: Content safety pipeline
// ---------------------------------------------------------------------------

/** Options for {@link redactor}. */
export type RedactorOptions = {
	name?: string;
};

/**
 * Stream extractor that replaces matched patterns in the accumulated text.
 *
 * Returns a derived node emitting a sanitized `StreamChunk` on every chunk:
 * `accumulated` and `token` have matched substrings replaced by `replaceFn`.
 * The default `replaceFn` replaces with `"[REDACTED]"`.
 *
 * Compose with `contentGate` for in-flight safety pipelines.
 *
 * @param streamTopic - Streaming topic to monitor.
 * @param patterns    - Array of RegExps to match against accumulated text.
 * @param replaceFn   - Replacement producer (default: always `"[REDACTED]"`).
 */
export function redactor(
	streamTopic: TopicGraph<StreamChunk>,
	patterns: RegExp[],
	replaceFn?: (match: string, pattern: RegExp) => string,
	opts?: RedactorOptions,
): Node<StreamChunk> {
	const replace = replaceFn ?? (() => "[REDACTED]");

	function sanitize(text: string): string {
		let result = text;
		for (const pat of patterns) {
			const global = pat.global ? pat : new RegExp(pat.source, `${pat.flags}g`);
			result = result.replace(global, (m) => replace(m, pat));
		}
		return result;
	}

	return derived<StreamChunk>(
		[streamTopic.latest as Node<StreamChunk | null>],
		([chunk]) => {
			if (chunk == null) {
				return { source: "", token: "", accumulated: "", index: -1 };
			}
			const c = chunk as StreamChunk;
			const sanitizedAccumulated = sanitize(c.accumulated);
			const sanitizedToken = sanitize(c.token);
			return {
				source: c.source,
				token: sanitizedToken,
				accumulated: sanitizedAccumulated,
				index: c.index,
			};
		},
		{ name: opts?.name ?? "redactor" },
	);
}

// ---------------------------------------------------------------------------

/** Content safety decision. */
export type ContentDecision = "allow" | "block" | "review";

/** Options for {@link contentGate}. */
export type ContentGateOptions = {
	/**
	 * Hard-block threshold multiplier (default 1.5).
	 * Scores above `threshold * hardMultiplier` emit `"block"`.
	 * Scores between `threshold` and that emit `"review"`.
	 */
	hardMultiplier?: number;
	name?: string;
};

/**
 * Derived node that classifies accumulated stream text as `"allow"`,
 * `"review"`, or `"block"` based on a classifier score.
 *
 * Emits a three-way decision on every new chunk:
 * - `"allow"` — score below `threshold`
 * - `"review"` — score in `[threshold, threshold × hardMultiplier)`
 * - `"block"` — score at or above `threshold × hardMultiplier`
 *
 * Wire the output into a `valve` (automatic) or `gate` (human approval).
 * This node does not itself control flow — it just classifies.
 *
 * @param streamTopic - Streaming topic to classify.
 * @param classifier  - `(accumulated: string) => number` scoring function, or
 *                      a `Node<number>` for live scores.
 * @param threshold   - Score at which output becomes "review" or "block".
 */
export function contentGate(
	streamTopic: TopicGraph<StreamChunk>,
	classifier: ((accumulated: string) => number) | Node<number>,
	threshold: number,
	opts?: ContentGateOptions,
): Node<ContentDecision> {
	const hardThreshold = threshold * (opts?.hardMultiplier ?? 1.5);
	const isNodeClassifier = typeof classifier !== "function";

	const deps: Node<unknown>[] = [streamTopic.latest as Node<StreamChunk | null>];
	if (isNodeClassifier) deps.push(classifier as Node<unknown>);

	return derived<ContentDecision>(
		deps,
		(values) => {
			const chunk = values[0] as StreamChunk | undefined;
			if (chunk == null) return "allow";

			const score = isNodeClassifier
				? ((values[1] as number | undefined) ?? 0)
				: (classifier as (text: string) => number)(chunk.accumulated);

			if (score >= hardThreshold) return "block";
			if (score >= threshold) return "review";
			return "allow";
		},
		{ name: opts?.name ?? "content-gate", initial: "allow" },
	);
}

// ---------------------------------------------------------------------------
// gatedStream
// ---------------------------------------------------------------------------

export type GatedStreamOptions = StreamingPromptNodeOptions & {
	/** Gate options (maxPending, startOpen). */
	gate?: Omit<GateOptions, "meta">;
};

/**
 * Bundle returned by {@link gatedStream}.
 */
export type GatedStreamHandle<T> = {
	/** Final parsed result (after gate approval). */
	output: Node<T | null>;
	/** Live stream topic — subscribe to `stream.latest` for chunks. */
	stream: TopicGraph<StreamChunk>;
	/** Gate controller — approve, reject (aborts in-flight stream), modify. */
	gate: GateController<T | null>;
	/** Tear down everything. */
	dispose: () => void;
};

/**
 * Streaming LLM transform with human-in-the-loop gate integration.
 *
 * Composes {@link streamingPromptNode} with {@link gate} so that:
 * - `gate.reject()` discards the pending value **and** aborts the in-flight
 *   stream (cancels the `AbortController`).
 * - `gate.modify()` transforms the pending value before forwarding downstream.
 * - `gate.approve()` forwards the final result as normal.
 *
 * The abort-on-reject works by toggling an internal cancel signal that causes
 * the `switchMap` inside `streamingPromptNode` to restart with an empty message
 * list, which triggers the `AbortController.abort()` in the async generator's
 * `finally` block.
 */
export function gatedStream<T = string>(
	graph: Graph,
	name: string,
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: GatedStreamOptions,
): GatedStreamHandle<T> {
	// Cancel signal: toggling this forces switchMap to restart (aborting stream).
	const cancelSignal = state<number>(0, { name: `${name}/cancel` });
	let cancelCounter = 0;

	// Build the streaming prompt node with cancelSignal as an extra dep.
	// The cancel dep is excluded from prompt template arguments.
	const allDeps = [...deps, cancelSignal] as readonly Node<unknown>[];

	const sourceName = opts?.name ?? name;
	const format = opts?.format ?? "text";
	const streamTopic = topic<StreamChunk>(`${sourceName}/stream`);

	const messagesNode = derived<readonly ChatMessage[]>(allDeps as Node<unknown>[], (values) => {
		// Last dep is the cancel signal — exclude from prompt args
		const depValues = values.slice(0, -1);
		if (depValues.some((v) => v == null)) return [];
		const text = typeof prompt === "string" ? prompt : prompt(...depValues);
		if (!text) return [];
		const msgs: ChatMessage[] = [];
		if (opts?.systemPrompt) msgs.push({ role: "system", content: opts.systemPrompt });
		msgs.push({ role: "user", content: text });
		return msgs;
	});

	const output = switchMap(messagesNode, (msgs) => {
		const chatMsgs = msgs as readonly ChatMessage[];
		if (!chatMsgs || chatMsgs.length === 0) {
			return state<T | null>(null) as NodeInput<T | null>;
		}

		const ac = new AbortController();

		async function* pumpAndCollect(): AsyncGenerator<T | null> {
			let accumulated = "";
			let index = 0;
			try {
				for await (const delta of adapter.stream(chatMsgs, {
					model: opts?.model,
					temperature: opts?.temperature,
					maxTokens: opts?.maxTokens,
					systemPrompt: opts?.systemPrompt,
					signal: ac.signal,
				})) {
					if (delta.type !== "token") continue;
					const token = delta.delta;
					accumulated += token;
					streamTopic.publish({
						source: sourceName,
						token,
						accumulated,
						index: index++,
					});
				}
				let result: T | null;
				if (format === "json") {
					try {
						result = JSON.parse(stripFences(accumulated)) as T;
					} catch {
						result = null;
					}
				} else {
					result = accumulated as unknown as T;
				}
				yield result;
			} finally {
				ac.abort();
			}
		}

		return fromAny(pumpAndCollect());
	});

	const unsub = keepalive(output);

	// Filter: only forward non-null results to the gate. Null is the switchMap
	// initial/cancel state — not a real LLM result worth gating. Returning
	// undefined from a derived fn means "no auto-emit" (spec §2.4), so null
	// values are silently suppressed.
	const nonNullOutput = derived<T>(
		[output],
		([v]) => {
			if (v == null) return undefined;
			return v as T;
		},
		{
			name: `${name}/filter`,
		},
	);

	// Register the filtered output so gate() can find it as a dep
	graph.add(nonNullOutput, { name: `${name}/raw` });

	// Wire gate on the output
	const gateCtrl = gate<T | null>(graph, `${name}/gate`, `${name}/raw`, opts?.gate);

	// Wrap reject to also abort the in-flight stream
	const originalReject = gateCtrl.reject.bind(gateCtrl);
	const gateWithAbort: GateController<T | null> = {
		...gateCtrl,
		reject(count = 1) {
			originalReject(count);
			// Toggle cancel signal to force switchMap restart → abort
			cancelSignal.emit(++cancelCounter);
		},
	};

	return {
		output: gateCtrl.node,
		stream: streamTopic,
		gate: gateWithAbort,
		dispose: () => {
			unsub();
			streamTopic.destroy();
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
					} else if (input && typeof (input as Node<LLMResponse>).subscribe === "function") {
						resolve((input as Node<LLMResponse>).cache as LLMResponse);
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
// handoff — multi-agent routing sugar (B10)
// ---------------------------------------------------------------------------

/**
 * Options for {@link handoff}.
 */
export type HandoffOptions = {
	/**
	 * Reactive gate: when this node's value is `true`, output flows from
	 * `from` to the `to` specialist; when `false`, `from`'s output flows
	 * through unchanged and `to` stays dormant. Omit to always hand off —
	 * useful when `from` is itself a router whose output shape already
	 * encodes routing intent.
	 */
	condition?: NodeInput<boolean>;
	name?: string;
};

/**
 * Multi-agent handoff recipe — route `from`'s output into a specialist
 * agent `toFactory` when `condition` is open. Thin composition over
 * `switchMap` + gate; not a new primitive, just a named shape.
 *
 * The "handoff" pattern (popularized by the OpenAI Agents SDK) covers two
 * idioms:
 *
 * 1. **Full handoff** — a triage agent routes the conversation to a
 *    specialist, and the specialist becomes the active agent for the rest
 *    of the turn. Accumulated context (memory, tool definitions) can travel
 *    along by threading the same `agentMemory` bundle into both.
 * 2. **Agents-as-tools** — the manager keeps control and calls the
 *    specialist like a tool for a bounded subtask. Build this by registering
 *    a `promptNode` instance as a `ToolDefinition` on the parent via
 *    `toolRegistry`.
 *
 * This sugar covers (1) — a reactive route from one agent's output into a
 * specialist factory. For (2) wire a tool registry manually; the pattern is
 * additive with this one.
 *
 * @example Full handoff on a triage signal.
 * ```ts
 * import { handoff, promptNode } from "@graphrefly/graphrefly/patterns/ai";
 *
 * const triage = promptNode(adapter, [userMessage], (msg) =>
 *   `Classify urgency of: ${msg}. Reply "high" or "normal".`);
 * const isUrgent = derived([triage], ([v]) => v === "high");
 *
 * const specialist = handoff(
 *   userMessage,
 *   (input) => promptNode(specialistAdapter, [input], (m) => `Respond urgently: ${m}`),
 *   { condition: isUrgent },
 * );
 * ```
 *
 * @param from - Source node whose value is threaded into the specialist.
 * @param toFactory - Factory that takes `from` (as a reactive source) and
 *   returns the specialist node. Called once, lazily, when the first
 *   subscriber activates.
 * @param opts - Optional reactive `condition` gate + name.
 * @returns Node emitting the specialist's output when the gate is open, or
 *   `from`'s value when the gate is closed. Null when `from` is null.
 *
 * @category patterns.ai
 */
export function handoff<T>(
	from: NodeInput<T | null>,
	toFactory: (input: Node<T>) => Node<T | null>,
	opts?: HandoffOptions,
): Node<T | null> {
	const src = fromAny(from);
	const cond = opts?.condition != null ? fromAny(opts.condition) : null;

	// Shared `null` state — reused across null source emissions so repeated
	// nulls don't allocate a fresh `state<T | null>(null)` per switchMap
	// project call. Minor allocation-churn win when the source oscillates.
	const nullState: Node<T | null> = state<T | null>(null, {
		name: opts?.name ? `${opts.name}::null` : "handoff::null",
	});

	// When no condition is supplied, always route through the specialist.
	if (cond == null) {
		return switchMap<T | null, T | null>(src, (v) => {
			if (v == null) return nullState as NodeInput<T | null>;
			const input = state<T>(v);
			return toFactory(input) as NodeInput<T | null>;
		});
	}

	// With a condition: pair src + cond into a router object, then switchMap
	// to either the specialist (when open) or a pass-through state (when
	// closed). Each router emission may re-instantiate the specialist — the
	// switchMap cancels the stale branch.
	const router = derived<{ v: T | null; open: boolean }>(
		[src, cond],
		([v, open]) => ({ v: v as T | null, open: open === true }),
		{ name: opts?.name ? `${opts.name}::router` : "handoff::router", describeKind: "derived" },
	);
	return switchMap<{ v: T | null; open: boolean }, T | null>(router, ({ v, open }) => {
		if (v == null) return nullState as NodeInput<T | null>;
		if (!open) return state<T | null>(v) as NodeInput<T | null>;
		const input = state<T>(v);
		return toFactory(input) as NodeInput<T | null>;
	});
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
	readonly latest: Node<ChatMessage | null>;
	readonly messageCount: Node<number>;

	constructor(name: string, opts: ChatStreamOptions = {}) {
		super(name, opts.graph);

		this._log = reactiveLog<ChatMessage>([], {
			name: "messages",
			maxSize: opts.maxMessages,
		});
		this.messages = this._log.entries;
		this.add(this.messages, { name: "messages" });

		this.latest = derived<ChatMessage | null>(
			[this.messages],
			([snapshot]) => {
				const entries = snapshot as readonly ChatMessage[];
				return entries.length === 0 ? null : (entries[entries.length - 1] as ChatMessage);
			},
			{
				name: "latest",
				describeKind: "derived",
				meta: aiMeta("chat_latest"),
			},
		);
		this.add(this.latest, { name: "latest" });
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
		this.add(this.messageCount, { name: "messageCount" });
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
		return this.messages.cache as readonly ChatMessage[];
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

// ---------------------------------------------------------------------------
// toolSelector — reactive tool availability (D8 / COMPOSITION-GUIDE §31)
// ---------------------------------------------------------------------------

/**
 * Options for {@link toolSelector}.
 */
export interface ToolSelectorOptions {
	readonly name?: string;
}

/**
 * Reactive tool availability (COMPOSITION-GUIDE §31). Given a base tool set
 * (reactive or static) and one or more reactive predicates, emit the filtered
 * subset of tools currently allowed. Feeds into `promptNode({ tools: Node<...> })`
 * so the LLM sees a reactive menu instead of a frozen config.
 *
 * Each predicate is a `NodeInput<(tool) => boolean>`. A tool is included iff
 * **every** predicate returns `true`. When any predicate value is `null` /
 * `undefined` (e.g. upstream not yet ready) that predicate is treated as a
 * pass-through — the tool isn't excluded on its basis. Predicate updates
 * recompute the selected set.
 *
 * Pairs with `toolInterceptor` (§D9 / §31): **selection** controls what's
 * offered to the LLM (pre-generation UX); **interception** gates what's
 * executed after the LLM chooses (post-generation security). Tool selection
 * is NOT a security boundary — an LLM can hallucinate tool calls outside
 * its offered set; always pair with `toolInterceptor` for enforcement.
 *
 * @example
 * ```ts
 * const hasBudget = derived([costMeter], (c) => c.total < BUDGET);
 * const canDestroy = state(false, { name: "destructive-allowed" });
 * const tools = toolSelector(registry.schemas, [
 *   derived([hasBudget], (b) => (t) => !t.meta?.expensive || b === true),
 *   derived([canDestroy], (c) => (t) => !t.meta?.destructive || c === true),
 * ]);
 * const agent = promptNode(graph, "agent", { ..., tools });
 * ```
 */
export function toolSelector(
	allTools: NodeInput<readonly ToolDefinition[]>,
	constraints: readonly NodeInput<(tool: ToolDefinition) => boolean>[],
	opts?: ToolSelectorOptions,
): Node<readonly ToolDefinition[]> {
	const allToolsNode = fromAny(allTools);
	const constraintNodes = constraints.map((c) => fromAny(c));
	const deps = [allToolsNode, ...constraintNodes] as const;
	return derived<readonly ToolDefinition[]>(
		deps,
		(values) => {
			const tools = (values[0] as readonly ToolDefinition[] | null | undefined) ?? [];
			const preds = values.slice(1) as ReadonlyArray<
				((t: ToolDefinition) => boolean) | null | undefined
			>;
			return tools.filter((tool) => {
				for (const pred of preds) {
					// Pass-through when a predicate hasn't settled — callers with
					// async constraints should not have every tool silently dropped
					// on the first emit. Constraints are "deny when false", not
					// "deny when not yet ready".
					if (pred == null) continue;
					if (!pred(tool)) return false;
				}
				return true;
			});
		},
		{
			name: opts?.name ?? "tool-selector",
			describeKind: "derived",
			meta: aiMeta("tool_selector"),
			equals: (a, b) => {
				const la = a as readonly ToolDefinition[];
				const lb = b as readonly ToolDefinition[];
				if (la.length !== lb.length) return false;
				for (let i = 0; i < la.length; i++) {
					if (la[i] !== lb[i]) return false;
				}
				return true;
			},
		},
	);
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
		return producer<Extraction<TMem>>((actions) => {
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
		return producer<Extraction<TMem>>((actions) => {
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
	/** Storage tier for the archive. Omit to disable archiving. */
	archiveTier?: StorageTier;
	/** Options forwarded to `graph.attachStorage` for the archive tier. */
	archiveStorageOptions?: GraphAttachStorageOptions;
};

const DEFAULT_DECAY_RATE = Math.LN2 / (7 * 86_400); // 7-day half-life

export type MemoryTiersBundle<TMem> = {
	/** Permanent tier: never evicted. */
	readonly permanent: LightCollectionBundle<TMem>;
	/** Active entries node (reactive, holds ReadonlyMap). */
	readonly activeEntries: Node<unknown>;
	/** Archive storage handle (null if no tier configured). */
	readonly archiveHandle: StorageHandle | null;
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
	/**
	 * Optional hierarchical context breadcrumb — e.g.
	 * `["projects", "auth", "tokens"]`. When both the query and a candidate
	 * entry supply a `context`, the retrieval pipeline applies a score boost
	 * proportional to `contextWeight` for entries whose context overlaps
	 * (shared prefix). Entries or queries without `context` are scored
	 * flatly (backward-compatible).
	 */
	readonly context?: readonly string[];
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
	/**
	 * Optional accessor: extracts the hierarchical context breadcrumb from a
	 * memory entry. Used with {@link RetrievalQuery.context} and
	 * `contextWeight` to boost entries whose context overlaps the query.
	 * Entries that don't expose context stay at flat behavior.
	 */
	contextOf?: (mem: TMem) => readonly string[] | undefined;
	/**
	 * Boost multiplier applied to a candidate's score when its `context`
	 * shares a prefix with the query's `context`. Score is multiplied by
	 * `(1 + contextWeight * sharedDepth / queryDepth)`. Default: 0 (no
	 * context boost).
	 */
	contextWeight?: number;
};

/** A single entry in the retrieval result, with causal trace metadata. */
export type RetrievalEntry<TMem> = {
	readonly key: string;
	readonly value: TMem;
	readonly score: number;
	readonly sources: ReadonlyArray<"vector" | "graph" | "store">;
	/**
	 * Hierarchical context breadcrumb for this entry, when
	 * `RetrievalPipelineOptions.contextOf` is supplied and returns a value.
	 */
	readonly context?: readonly string[];
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
	/**
	 * B12: optional accessor for an entry's hierarchical context breadcrumb
	 * (e.g. `["projects", "auth", "tokens"]`). When supplied alongside
	 * `contextWeight > 0`, retrieval applies a score boost for entries whose
	 * context shares a prefix with the query's `context`. Entries without
	 * a breadcrumb are scored flatly.
	 */
	contextOf?: (mem: TMem) => readonly string[] | undefined;
	/**
	 * B12: hierarchical context boost multiplier. Score is scaled by
	 * `(1 + contextWeight * sharedDepth / queryDepth)` when both the query
	 * and entry supply a `context`. Default: 0.
	 */
	contextWeight?: number;

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
	/**
	 * Execute a retrieval query (null if no retrieval pipeline).
	 *
	 * **Synchronous consumer API** — returns the result immediately and batch-writes
	 * `retrieval` and `retrievalTrace` state nodes for observers. Reads the store
	 * snapshot and context value **at call time** (external-boundary read).
	 *
	 * **Do not call from inside a reactive fn body** (derived fn, subscribe callback,
	 * effect body). The cache reads would become transitive protocol violations and
	 * may observe wave-progressive rather than wave-final state.
	 *
	 * **Caller-batch caveat:** if invoked inside a caller's `batch(() => ...)` alongside
	 * upstream store mutations, the store snapshot reflects what has been committed to
	 * `store.entries.cache` at call time. State-backed stores update cache synchronously
	 * so batched inserts are visible; derived-backed store transforms may defer. If you
	 * need fresh state after batched mutations, call `retrieve` after the batch returns.
	 */
	readonly retrieve: ((query: RetrievalQuery) => ReadonlyArray<RetrievalEntry<TMem>>) | null;
	/**
	 * Reactive sibling of {@link retrieve}. Given a reactive
	 * `RetrievalQuery | null` source, returns a `Node` emitting the packed
	 * retrieval results. Composable with graph topology — subscribe it,
	 * chain it into `promptNode`, or switchMap over a user-input node.
	 * Null when no retrieval pipeline is configured.
	 */
	readonly retrieveReactive:
		| ((queryInput: NodeInput<RetrievalQuery | null>) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
		| null;
};

/**
 * Pre-wired agentic memory graph. Composes `distill()` with optional
 * `knowledgeGraph()`, `vectorIndex()`, `lightCollection()` (permanent tier),
 * `decay()`, and `attachStorage()` (archive tier). Supports 3D admission
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

	graph.add(distillBundle.store.entries, { name: "store" });
	graph.add(distillBundle.compact, { name: "compact" });
	graph.add(distillBundle.size, { name: "size" });

	// --- Vector index (optional) ---
	let vectors: VectorIndexBundle<TMem> | null = null;
	if (opts.vectorDimensions && opts.vectorDimensions > 0 && opts.embedFn) {
		vectors = vectorIndex<TMem>({ dimension: opts.vectorDimensions });
		graph.add(vectors.entries, { name: "vectorIndex" });
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
		graph.add(permanent.entries, { name: "permanent" });

		// Track which keys are permanent
		const permanentKeys = new Set<string>();

		const tierOf = (key: string): MemoryTier => {
			if (permanentKeys.has(key)) return "permanent";
			const storeMap = extractStoreMap<TMem>(distillBundle.store.entries.cache);
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
		let archiveHandle: StorageHandle | null = null;
		if (tiersOpts.archiveTier) {
			archiveHandle = graph.attachStorage(
				[tiersOpts.archiveTier],
				tiersOpts.archiveStorageOptions ?? {},
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
	let retrieveReactive:
		| ((queryInput: NodeInput<RetrievalQuery | null>) => Node<ReadonlyArray<RetrievalEntry<TMem>>>)
		| null = null;

	if (vectors || kg) {
		const topK = opts.retrieval?.topK ?? 20;
		const graphDepth = opts.retrieval?.graphDepth ?? 1;
		const budget = opts.budget ?? 2000;
		const costFn = opts.cost;
		const scoreFn = opts.score;
		const contextOfFn = opts.contextOf;
		const contextWeight = opts.contextWeight ?? 0;

		const contextNode = opts.context ? fromAny(opts.context) : state<unknown>(null);

		// B12: shared prefix depth between a query context and an entry context.
		// Returns 0 when either side is missing or no prefix is shared.
		const sharedPrefixDepth = (
			q: readonly string[] | undefined,
			e: readonly string[] | undefined,
		): number => {
			if (!q || !e) return 0;
			const n = Math.min(q.length, e.length);
			let i = 0;
			while (i < n && q[i] === e[i]) i++;
			return i;
		};

		// Core retrieval pipeline, reused by both the imperative `retrieve()`
		// and the reactive `retrieveReactive()` sibling.
		const runRetrieval = (
			storeMap: ReadonlyMap<string, TMem>,
			ctx: unknown,
			query: RetrievalQuery,
		): { packed: RetrievalEntry<TMem>[]; trace: RetrievalTrace<TMem> } => {
			const candidateMap = new Map<
				string,
				{ value: TMem; sources: Set<"vector" | "graph" | "store"> }
			>();

			let vectorCandidates: VectorSearchResult<TMem>[] = [];
			if (vectors && query.vector) {
				vectorCandidates = vectors.search(query.vector, topK) as VectorSearchResult<TMem>[];
				for (const vc of vectorCandidates) {
					const mem = storeMap.get(vc.id);
					if (mem) candidateMap.set(vc.id, { value: mem, sources: new Set(["vector"]) });
				}
			}

			const graphExpanded: string[] = [];
			if (kg) {
				const seedIds = [...(query.entityIds ?? []), ...[...candidateMap.keys()]];
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
									if (existing) existing.sources.add("graph");
									else candidateMap.set(targetId, { value: mem, sources: new Set(["graph"]) });
									graphExpanded.push(targetId);
								}
							}
						}
					}
					frontier = nextFrontier;
				}
			}
			for (const [key, mem] of storeMap) {
				if (!candidateMap.has(key)) {
					candidateMap.set(key, { value: mem, sources: new Set(["store"]) });
				}
			}

			const qDepth = query.context?.length ?? 0;
			const ranked: RetrievalEntry<TMem>[] = [];
			for (const [key, { value, sources }] of candidateMap) {
				const entryContext = contextOfFn ? contextOfFn(value) : undefined;
				let score = scoreFn(value, ctx);
				// B12: hierarchical context boost.
				if (contextWeight > 0 && qDepth > 0) {
					const shared = sharedPrefixDepth(query.context, entryContext);
					if (shared > 0) score = score * (1 + (contextWeight * shared) / qDepth);
				}
				const entry: RetrievalEntry<TMem> = entryContext
					? { key, value, score, sources: [...sources], context: entryContext }
					: { key, value, score, sources: [...sources] };
				ranked.push(entry);
			}
			ranked.sort((a, b) => b.score - a.score);

			const packed: RetrievalEntry<TMem>[] = [];
			let usedBudget = 0;
			for (const entry of ranked) {
				const c = costFn(entry.value);
				if (usedBudget + c > budget && packed.length > 0) break;
				packed.push(entry);
				usedBudget += c;
			}

			const trace: RetrievalTrace<TMem> = {
				vectorCandidates,
				graphExpanded,
				ranked,
				packed,
			};
			return { packed, trace };
		};

		// Observer-facing state nodes. `retrieve()` writes both in a batch on every call.
		// (Option W from the 2026-04-12 P3 audit — retrieveFn is a sync consumer API that
		// reads store/context at call time, computes inline, and publishes results via
		// state writes. No derived, no queryInput, no closure side-channel.)
		const retrievalOutput = state<ReadonlyArray<RetrievalEntry<TMem>>>([], {
			name: "retrieval",
			describeKind: "state",
			meta: aiMeta("retrieval_pipeline"),
		});
		graph.add(retrievalOutput, { name: "retrieval" });
		retrievalNode = retrievalOutput;

		const traceState = state<RetrievalTrace<TMem> | null>(null, {
			name: "retrievalTrace",
			describeKind: "state",
			meta: aiMeta("retrieval_trace"),
		});
		graph.add(traceState, { name: "retrievalTrace" });
		retrievalTraceNode = traceState;

		// Sync consumer API. Reads `store.entries.cache` and `contextNode.cache` at
		// call time — these are external-boundary reads, allowed per the foundation
		// redesign. **Do not call from inside a reactive fn body**: the cache reads
		// would become transitive P3 violations. See `retrieveReactive()` for a
		// reactive sibling that's safe to subscribe to from graph topology.
		retrieveFn = (query: RetrievalQuery): ReadonlyArray<RetrievalEntry<TMem>> => {
			const storeMap = extractStoreMap<TMem>(distillBundle.store.entries.cache);
			const { packed, trace } = runRetrieval(storeMap, contextNode.cache, query);
			batch(() => {
				retrievalOutput.emit(packed);
				traceState.emit(trace);
			});
			return packed;
		};

		// B20: reactive sibling. Subscribe-driven retrieval — when `queryNode`
		// emits a new `RetrievalQuery`, the returned node emits the packed
		// results. Composable with graph topology (e.g. `switchMap` on a user
		// input node, or chaining into a `promptNode`). Unlike `retrieveFn`
		// which writes observer-facing state nodes and returns synchronously,
		// this sibling stays purely reactive — no imperative cache reads in
		// its fn body.
		const retrieveReactiveFn = (
			queryInput: NodeInput<RetrievalQuery | null>,
		): Node<ReadonlyArray<RetrievalEntry<TMem>>> => {
			const q = fromAny(queryInput);
			return derived<ReadonlyArray<RetrievalEntry<TMem>>>(
				[distillBundle.store.entries, contextNode, q],
				([snapshot, ctx, query]) => {
					if (query == null) return [];
					const storeMap = extractStoreMap<TMem>(snapshot);
					return runRetrieval(storeMap, ctx, query as RetrievalQuery).packed;
				},
				{
					name: "retrievalReactive",
					describeKind: "derived",
					meta: aiMeta("retrieval_reactive"),
					initial: [] as ReadonlyArray<RetrievalEntry<TMem>>,
				},
			);
		};
		retrieveReactive = retrieveReactiveFn;
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
		retrieveReactive,
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
	/**
	 * Reactive tool-call splice (COMPOSITION-GUIDE §31 "interception is security").
	 * When set, the raw `toolCalls` node is piped through this transform before
	 * reaching the executor. The transform is a pure reactive composition —
	 * `(calls: Node<readonly ToolCall[]>) => Node<readonly ToolCall[]>` — so the
	 * gate is visible in `describe()` / `explain()` as a real edge (no hidden
	 * imperative wraps; §24).
	 *
	 * Typical uses:
	 * - **Filter / block** — `derived([calls, policy], ([raw, p]) => raw.filter(p))`
	 * - **Throttle / debounce** — `throttle(calls, windowMs)`
	 * - **Human-in-the-loop approval** — pipe through a `gate` controller so
	 *   calls wait for human approval before reaching the executor.
	 *
	 * The public `agent.toolCalls` node surfaces the POST-intercept stream, so
	 * audit / telemetry consumers see what the executor actually runs. The raw
	 * pre-intercept stream is not exposed — tests that need it should run
	 * without `interceptToolCalls` set (the identity case).
	 */
	interceptToolCalls?: (calls: Node<readonly ToolCall[]>) => Node<readonly ToolCall[]>;
};

/** A single tool execution outcome: `{id, content}` where content is a JSON string. */
export interface ToolResult {
	readonly id: string;
	readonly content: string;
}

/**
 * Reactive agent loop.
 *
 * The loop is a reactive state machine wired entirely from graph primitives:
 * `chat.messages` + `tools.schemas` + gating state feed a `promptInput`
 * derived; `switchMap` turns non-null inputs into an LLM invocation via
 * `fromAny(adapter.invoke(...))`. The LLM response drives chat writes and
 * status transitions via effects. Tool calls flow through a reactive
 * executor (`retrySource` + `rescue`) that retries once on error and
 * surfaces terminal errors as JSON-shaped `ToolResult` payloads for the
 * LLM to react to.
 *
 * **No imperative control flow inside the reactive layer** (spec §5.8-5.12):
 * no `while` loops, no manual `await adapter.invoke`, no polling.
 * `agent.run()` is a thin `awaitSettled` bridge so callers can still `await`
 * the loop if they want a Promise.
 *
 * Public surface:
 * - `chat` / `tools` — subgraphs (imperative `append` / `execute` at boundary)
 * - `status` / `turn` / `aborted` — state nodes with explicit initials
 * - `lastResponse` / `toolCalls` / `toolResults` — reactive outputs (SENTINEL until first emission; callers use `awaitSettled` / `subscribe`)
 * - `run(userMessage?, signal?)` — optional user append + Promise bridge
 * - `abort()` — imperative abort shim; flips `aborted` state
 */
export class AgentLoopGraph extends Graph {
	readonly chat: ChatStreamGraph;
	readonly tools: ToolRegistryGraph;

	/** Current agent status. `initial: "idle"` — always has a real value. */
	readonly status: Node<AgentLoopStatus>;
	/** Turn count (completed LLM invocations this run). `initial: 0`. */
	readonly turn: Node<number>;
	/** Aborted flag; flipped by `abort()` or external `AbortSignal`. `initial: false`. */
	readonly aborted: Node<boolean>;

	/**
	 * Most recent LLM response. State-backed mirror driven by the response
	 * effect. `initial: null` — subscribers can read the cache synchronously;
	 * `awaitSettled(lastResponse)` or `firstWhere(lastResponse, v => v != null)`
	 * bridges to the first non-null value as a Promise.
	 */
	readonly lastResponse: Node<LLMResponse | null>;
	/** Tool-call batch emitted by the most recent LLM response. SENTINEL. */
	readonly toolCalls: Node<readonly ToolCall[]>;
	/** Tool-result batch (one entry per call) after reactive execution. SENTINEL. */
	readonly toolResults: Node<readonly ToolResult[]>;

	/** @deprecated Use `turn` instead. Pre-1.0 rename — this alias will be removed. */
	readonly turnCount: Node<number>;

	private readonly _terminalResult: Node<{ response: LLMResponse; runVersion: number }>;
	private readonly _disposeRunWiring: () => void;
	/**
	 * Per-agent monotonic run counter. Incremented at the start of every
	 * `run()` call; stamped onto `_terminalResult`'s DATA emissions so a
	 * caller's `awaitSettled` predicate resolves only on the matching run
	 * (prevents stale-resolution under re-entrant-ish composition).
	 */
	private _runVersion = 0;
	/** Guards against overlapping `run()` calls. */
	private _running = false;
	/**
	 * Abort controller for the currently-running `adapter.invoke`. Minted per
	 * switchMap project; aborted when the reactive `aborted` node flips true
	 * OR when the caller's external `AbortSignal` fires. Threaded into
	 * `adapter.invoke({ signal })` AND `fromAny(promise, { signal })`, so the
	 * reactive layer sees ERROR when the wire call is cancelled.
	 */
	private _currentAbortController: AbortController | null = null;

	constructor(name: string, opts: AgentLoopOptions) {
		super(name, opts.graph);

		// Mount chat subgraph
		this.chat = chatStream(`${name}-chat`, { maxMessages: opts.maxMessages });
		this.mount("chat", this.chat);

		// Mount tool registry subgraph
		this.tools = toolRegistry(`${name}-tools`);
		this.mount("tools", this.tools);

		if (opts.tools) {
			for (const tool of opts.tools) {
				this.tools.register(tool);
			}
		}

		// --- State nodes (always have a real value; explicit initials) ---
		this.status = state<AgentLoopStatus>("idle", {
			name: "status",
			describeKind: "state",
			meta: aiMeta("agent_status"),
		});
		this.add(this.status, { name: "status" });

		this.turn = state<number>(0, {
			name: "turn",
			describeKind: "state",
			meta: aiMeta("agent_turn_count"),
		});
		this.add(this.turn, { name: "turn" });
		this.turnCount = this.turn;

		this.aborted = state<boolean>(false, {
			name: "aborted",
			describeKind: "state",
			meta: aiMeta("agent_aborted"),
		});
		this.add(this.aborted, { name: "aborted" });

		// --- Reactive pipeline ---
		//
		// Factory-time seed for self-owned `turn` reads (COMPOSITION-GUIDE §28):
		// effects need `latestTurn` synchronously to enforce the maxTurns cap,
		// but can't read `turn.cache` from inside a callback (P3 rule). Subscribe
		// once at construction; keep a closure-held mirror updated by the handler.
		// Factory-time seed reads for closure-held mirrors (COMPOSITION-GUIDE §28).
		// These subscriptions keep `latestTurn` / `latestAborted` current so
		// effects can read them synchronously without hitting the "no .cache
		// reads inside reactive callbacks" rule (P3).
		//
		// **Pattern note on `latestTurn` staleness under in-batch reads.**
		// Effect 1 emits `turnNode.emit(next)` inside its batch; Effect 2
		// reads `latestTurn` on the following wave (after toolResults
		// settle). Because batch drain is FIFO, `turnSub`'s handler runs
		// before Effect 2's next wave fires, so `latestTurn` is up-to-date
		// by the time Effect 2 reads it. This invariant is stable as long
		// as `turnNode.emit` remains inside Effect 1's batch — a future
		// refactor that un-batches the emit would regress silently. Reading
		// `turnNode.cache` directly is an alternative but is a gray-zone
		// P3 pattern (self-owned counter read inside a reactive fn) — the
		// closure-mirror pattern is the explicitly-sanctioned shape.
		let latestTurn = 0;
		const turnSub = this.turn.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestTurn = m[1] as number;
		});
		let latestAborted = false;
		const abortedSub = this.aborted.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) latestAborted = m[1] as boolean;
		});

		// Mirror of chat.messages as a Node so `promptInput` can take it as a
		// dep. `chat.latest` exposes the last message; we want the full array,
		// so we build a derived over `chat.messageCount` that reads via closure.
		// ChatStreamGraph.allMessages() is the external-consumer API boundary
		// (documented P3 exception); reading it inside an effect OR inside a
		// derived fn that's triggered by messageCount is the sanctioned pattern.
		// The effect below writes to `chat` imperatively (sanctioned boundary),
		// which bumps `chat.messageCount`, which re-triggers the promptInput.

		const adapter = opts.adapter;
		const systemPrompt = opts.systemPrompt;
		const model = opts.model;
		const temperature = opts.temperature;
		const maxTokens = opts.maxTokens;
		const maxTurns = opts.maxTurns ?? 10;
		const stopWhen = opts.stopWhen;

		// Capture `this` for closures that don't bind `this`.
		const chat = this.chat;
		const tools = this.tools;
		const statusNode = this.status;
		const turnNode = this.turn;
		const abortedNode = this.aborted;

		// promptInput: STATUS is the only reactive trigger — chat.messageCount,
		// tools.schemas, turn, aborted are sampled imperatively via closure-
		// held mirrors (for turn / aborted) or external-consumer API reads
		// (for chat.allMessages / tools.schemas). This prevents the classic
		// feedback cycle (COMPOSITION-GUIDE §7): if chat.messageCount were a
		// reactive dep here, effect 1's `chat.append` would trigger a
		// promptInput wave, which under effect-1's batch would see status
		// STILL "thinking" (pre-drain) and fire a spurious LLM invocation.
		// By gating only on status, chat writes don't re-trigger — only
		// explicit status transitions do.
		const promptInput: Node<InvokeInput> = nodeFactory<InvokeInput>(
			[statusNode],
			(data, actions, ctx) => {
				const stat = readLatest<AgentLoopStatus>(data, ctx.prevData, 0, "idle");
				if (stat !== "thinking" || latestAborted || latestTurn >= maxTurns) {
					actions.down([[RESOLVED]]);
					return;
				}
				const messages = chat.allMessages();
				// Don't invoke with an empty conversation — most adapters reject
				// this or return degenerate responses. RESOLVED holds the loop
				// idle until the caller appends something to chat.
				if (messages.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				const schemas = (tools.schemas.cache as readonly ToolDefinition[]) ?? [];
				actions.emit({ messages, tools: schemas });
			},
			{
				name: "promptInput",
				describeKind: "derived",
				meta: aiMeta("agent_prompt_input"),
			},
		);

		const llmResponse: Node<LLMResponse> = switchMap(
			promptInput,
			(input) => {
				const controller = new AbortController();
				this._currentAbortController = controller;
				if (latestAborted) {
					controller.abort(new Error("agentLoop: aborted"));
				}
				return fromAny(
					Promise.resolve(
						adapter.invoke(input.messages, {
							tools: input.tools.length > 0 ? input.tools : undefined,
							systemPrompt,
							model,
							temperature,
							maxTokens,
							signal: controller.signal,
						}),
					) as NodeInput<LLMResponse>,
					{ signal: controller.signal },
				);
			},
			{ equals: () => false },
		);

		// State mirror for `lastResponse` (COMPOSITION-GUIDE §7 fix).
		// Consumer-facing surface AND terminalResult's dep.
		//
		// Why: `llmResponse` is a switchMap output. When its inner emits DATA,
		// the wave propagates to sinks IN ORDER. `effResponse` (subscribed
		// first via keepalive) runs `batch(() => statusNode.emit("done"))`
		// inside its fn. That batch DRAINS SYNCHRONOUSLY (nested, depth goes
		// 0→1→0). During drain, status=done wave fires `_terminalResult`'s
		// dep on status. But `_terminalResult`'s dep on `llmResponse` hasn't
		// fired yet (sink 4 still pending on the outer wave). So
		// `prevData[llmResponse]` holds the PREVIOUS response (e.g.
		// `toolCallResp`), not the one just emitted (`finalResp`).
		// terminalResult emits the stale response, awaitSettled resolves
		// wrong. Feedback-cycle-adjacent (COMPOSITION-GUIDE §7) — a sink
		// drain inside an outer sink callback sees stale peer state.
		//
		// Fix: `effResponse` writes the mirror BEFORE emitting status.
		// Emission order in the batch ensures the mirror drain runs first,
		// so `_terminalResult`'s dep on the mirror is current by the time
		// the status=done wave propagates.
		const lastResponseState = state<LLMResponse | null>(null, {
			name: "lastResponse",
			describeKind: "state",
			meta: aiMeta("agent_last_response"),
		});
		this.lastResponse = lastResponseState;

		// toolCalls: raw node that emits DATA only when status === "acting" and
		// the current response has tool calls. Otherwise emits RESOLVED. Using
		// DATA([]) for the idle case would cause switchMap(toolCalls) to
		// re-dispatch its inner (creating a fresh state([]) source whose
		// emissions re-trigger effects downstream). RESOLVED keeps the inner
		// alive and lets upstream waves pass through without re-dispatch.
		const toolCallsNode = nodeFactory<readonly ToolCall[]>(
			[lastResponseState, statusNode],
			(data, actions, ctx) => {
				const resp = readLatest<LLMResponse | null | undefined>(data, ctx.prevData, 0, null);
				const stat = readLatest<AgentLoopStatus>(data, ctx.prevData, 1, "idle");
				if (stat !== "acting") {
					actions.down([[RESOLVED]]);
					return;
				}
				const calls = resp?.toolCalls;
				if (calls == null || calls.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				actions.emit(calls);
			},
			{
				name: "toolCalls",
				describeKind: "derived",
				meta: aiMeta("agent_tool_calls"),
			},
		);
		// Reactive splice (D9 / COMPOSITION-GUIDE §31). When `interceptToolCalls`
		// is set, the raw tool-call stream is transformed in the graph — the
		// executor sees the gated stream, and `agent.toolCalls` surfaces the
		// post-intercept view so audit / telemetry match reality.
		const gatedToolCallsNode = opts.interceptToolCalls
			? opts.interceptToolCalls(toolCallsNode)
			: toolCallsNode;
		this.toolCalls = gatedToolCallsNode;

		// toolResults: switchMap turns each non-empty batch into a per-call
		// reactive pipeline with retry-once + rescue. `derived(perCall, …)`
		// first-run gate waits for every call to settle before emitting the
		// array. Content-equality on the batch array dedupes duplicate
		// re-emissions (e.g. when retrySource's source completes after DATA
		// and the derived re-runs with the same values).
		const toolResultsBatchEquals = (
			a: readonly ToolResult[],
			b: readonly ToolResult[],
		): boolean => {
			if (a === b) return true;
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				const ai = a[i];
				const bi = b[i];
				if (ai?.id !== bi?.id) return false;
				if (ai?.content !== bi?.content) return false;
			}
			return true;
		};
		const toolResultsNode: Node<readonly ToolResult[]> = switchMap(gatedToolCallsNode, (calls) => {
			if (calls == null || calls.length === 0) {
				// Invariant: `toolCallsNode` emits RESOLVED (not DATA([])) when
				// there are no tool calls to execute — see the raw `node()`
				// construction above. switchMap's project only runs on source
				// DATA, so this branch is unreachable under the current gate.
				// Asserting here catches future regressions where someone
				// mistakenly changes `toolCallsNode` to emit `DATA([])`.
				throw new Error(
					"agentLoop: toolResultsNode received an empty tool-call batch as DATA — toolCallsNode gating invariant broken (should emit RESOLVED for empty). Audit toolCallsNode.",
				);
			}
			const perCall = calls.map((call) => executeToolReactively(call, tools));
			return derived(
				perCall,
				(values) =>
					values.map((v, i) => {
						const tr = v as ToolResult | undefined;
						if (tr != null && typeof tr === "object" && "id" in tr && "content" in tr) {
							return tr;
						}
						return {
							id: calls[i]!.id,
							content: JSON.stringify(v ?? null),
						};
					}) as readonly ToolResult[],
				{ name: "toolResults_batch", equals: toolResultsBatchEquals },
			);
		});
		this.toolResults = toolResultsNode;

		// --- State-machine effects ---
		// Effect 1: LLM response landed → write lastResponse mirror + chat,
		// transition status, increment turn. Emission ORDER inside the batch
		// matters (drain is FIFO under any outer-batch depth):
		//   1. `lastResponseState.emit(response)` FIRST — so when the drain
		//      fires the status=done wave later in the queue, `_terminalResult`'s
		//      dep on `lastResponseState` has already been updated.
		//   2. `statusNode.emit(nextStatus)` — drives state machine.
		//   3. `turnNode.emit(next)` — counter.
		//   4. `chat.append(...)` LAST — chat.messageCount wave now sees the
		//      new status (so `promptInput` gates correctly).
		// Without (1) first, `_terminalResult` reads stale `prevData` for
		// lastResponse when status transitions synchronously during drain.
		//
		// **Invariant independence from outer batch depth.** `downWithBatch`
		// preserves FIFO drain order regardless of nesting — whether the
		// outer batch is at depth 0 (common: Promise microtask) or depth >0
		// (user-composed `batch()` scope around `agent.run()`), the emissions
		// above drain in the order they were enqueued. The state-mirror
		// pattern holds in both cases.
		//
		// **Abort guard (C2 defense-in-depth).** If the `aborted` state has
		// flipped true between `adapter.invoke`'s Promise resolution and this
		// effect firing (micro-race), bail out so we don't append to chat or
		// execute tool calls for an abandoned run. The controller.abort() in
		// effAbort also fires the signal, which causes `fromAny` to emit
		// ERROR — but that ERROR propagation arrives in a separate wave, so
		// this guard covers the "Promise already resolved before abort hit
		// the controller" case.
		const effResponse = effect([llmResponse], ([resp]) => {
			if (latestAborted) return;
			const response = resp as LLMResponse;
			const next = latestTurn + 1;
			const hasToolCalls = response.toolCalls != null && response.toolCalls.length > 0;
			const naturalStop =
				response.finishReason === "end_turn" &&
				(!response.toolCalls || response.toolCalls.length === 0);
			const customStop = stopWhen?.(response) === true;
			const capReached = next >= maxTurns;
			const nextStatus: AgentLoopStatus =
				customStop || naturalStop || !hasToolCalls || capReached ? "done" : "acting";
			batch(() => {
				lastResponseState.emit(response);
				statusNode.emit(nextStatus);
				turnNode.emit(next);
				chat.append("assistant", response.content, {
					toolCalls: response.toolCalls,
				});
			});
		});

		// Effect 2: Tool results landed → append to chat, transition to
		// thinking (or done if turn cap reached). Same ordering discipline —
		// status emits before chat mutations. Abort guard mirrors effResponse.
		const effResults = effect([toolResultsNode], ([results]) => {
			if (latestAborted) return;
			const arr = results as readonly ToolResult[];
			if (arr.length === 0) return;
			const nextStatus: AgentLoopStatus = latestTurn >= maxTurns ? "done" : "thinking";
			batch(() => {
				statusNode.emit(nextStatus);
				for (const r of arr) chat.appendToolResult(r.id, r.content);
			});
		});

		// Effect 3: external abort → cancel in-flight wire call + terminal status.
		// Aborting the controller causes the switchMap inner's `fromAny` to
		// emit ERROR (signal-bound), which tears down the subscription. The
		// `status="done"` emit drives `_terminalResult` to resolve `run()`'s
		// Promise (via AbortError when `resp == null`, see C3).
		const effAbort = effect([abortedNode], ([isAborted]) => {
			if (isAborted === true) {
				this._currentAbortController?.abort(new Error("agentLoop: aborted"));
				statusNode.emit("done");
			}
		});

		// Keepalive so the pipeline stays activated even without external
		// subscribers. Callers don't need to subscribe to `llmResponse` /
		// `toolResults` for the loop to run.
		const kaResponse = keepalive(effResponse);
		const kaResults = keepalive(effResults);
		const kaAbort = keepalive(effAbort);

		// terminalResult: stamps each "done" emission with the CURRENT
		// `_runVersion` so `run()`'s `awaitSettled` predicate can filter to
		// the run that started it. C1 fix: without the version tag, a new
		// subscriber (e.g. re-entrant `run()` call) could resolve with the
		// previous run's cached DATA. With the tag, the caller's predicate
		// compares `v.runVersion === myRunVersion` and ignores any stale
		// emission. Also implements C3: when `stat === "done"` but `resp ==
		// null` (abort-before-response), emit ERROR(AbortError) so the
		// awaiting Promise rejects instead of hanging on a RESOLVED.
		this._terminalResult = nodeFactory<{ response: LLMResponse; runVersion: number }>(
			[statusNode, lastResponseState],
			(data, actions, ctx) => {
				const stat = readLatest<AgentLoopStatus>(data, ctx.prevData, 0, "idle");
				const resp = readLatest<LLMResponse | null | undefined>(data, ctx.prevData, 1, null);
				if (stat === "done") {
					if (resp != null) {
						actions.emit({ response: resp, runVersion: this._runVersion });
						return;
					}
					// C3: abort-before-response. Reject rather than hang.
					const err = new Error("agentLoop: aborted") as Error & { name: string };
					err.name = "AbortError";
					actions.down([[ERROR, err]]);
					return;
				}
				if (stat === "error") {
					actions.down([[ERROR, new Error("agentLoop: errored")]]);
					return;
				}
				actions.down([[RESOLVED]]);
			},
			{
				name: "terminalResult",
				describeKind: "derived",
				meta: aiMeta("agent_terminal_result"),
			},
		);

		// Register subscriptions via `addDisposer` so they tear down on
		// subgraph unmount (not just explicit `destroy()`). A caller that
		// unmounts the AgentLoopGraph from its parent via `graph.remove(...)`
		// would otherwise keep `turnSub` / `abortedSub` live against dead state.
		this.addDisposer(turnSub);
		this.addDisposer(abortedSub);
		this.addDisposer(kaResponse);
		this.addDisposer(kaResults);
		this.addDisposer(kaAbort);
		this._disposeRunWiring = (): void => {
			// addDisposer takes care of teardown; this shim stays for the
			// `destroy()` override's idempotency contract (safe no-op if the
			// disposers already fired).
		};
	}

	/**
	 * Bridge to `Promise<LLMResponse>` over the reactive pipeline.
	 *
	 * - If `userMessage` is provided, appends it as a user message and
	 *   transitions status to `"thinking"` to kick the loop.
	 * - If `signal` is provided, binds it to the reactive `aborted` node
	 *   AND threads into `adapter.invoke({ signal })` so the wire call can
	 *   cancel mid-flight. The reactive `aborted` state + effect 3 guarantee
	 *   that even an adapter that ignores `signal` will stop emitting into
	 *   the agent graph.
	 * - Resolves when `status === "done"` with the final LLM response.
	 *   Rejects with `AbortError` when the abort signal fires pre-response.
	 *   Rejects with the stage error when `status === "error"`.
	 *
	 * **Concurrency:** `run()` refuses to overlap with a pending call on the
	 * same agent. Attempting to call `run()` while a previous `run()` is still
	 * in-flight throws a `RangeError` immediately. Each call increments an
	 * internal `_runVersion` and filters `_terminalResult` emissions by that
	 * version — belt-and-suspenders against stale resolution.
	 */
	async run(userMessage?: string, signal?: AbortSignal): Promise<LLMResponse | null> {
		if (this._running) {
			throw new RangeError(
				`agentLoop "${this.name}": run() called while a previous run() is still pending — await the previous run before starting another, or call abort() first`,
			);
		}
		this._running = true;
		const myRunVersion = ++this._runVersion;

		batch(() => {
			this.turn.emit(0);
			this.aborted.emit(false);
			this.status.emit("idle");
		});
		if (userMessage != null) this.chat.append("user", userMessage);
		// Kick — transition to thinking fires promptInput → llmResponse.
		this.status.emit("thinking");

		let offAbort: (() => void) | undefined;
		if (signal != null) {
			if (signal.aborted) {
				this.aborted.emit(true);
			} else {
				const listener = (): void => this.aborted.emit(true);
				signal.addEventListener("abort", listener, { once: true });
				offAbort = (): void => signal.removeEventListener("abort", listener);
			}
		}

		try {
			const tagged = await awaitSettled(this._terminalResult, {
				predicate: (v) => v != null && typeof v === "object" && v.runVersion === myRunVersion,
			});
			return tagged.response;
		} finally {
			offAbort?.();
			this._running = false;
			this._currentAbortController = null;
		}
	}

	/**
	 * Flip the reactive `aborted` state. Equivalent to setting an external
	 * `AbortSignal` — the pipeline observes and transitions to `"done"`.
	 */
	abort(): void {
		this.aborted.emit(true);
	}

	override destroy(): void {
		try {
			this._disposeRunWiring();
		} catch {
			/* best-effort: disposing keepalives shouldn't block destroy */
		}
		super.destroy();
	}
}

/**
 * Per-tool-call reactive executor with retry-once + rescue.
 *
 * `retrySource({count: 1})` re-invokes the factory on ERROR (1 retry after
 * first failure = 2 total attempts). `rescue` catches any terminal ERROR
 * after retries are exhausted and converts it into a JSON-wrapped
 * `ToolResult` — the LLM sees the error as tool output and decides whether
 * to retry via another tool call.
 *
 * @internal
 */
function executeToolReactively(call: ToolCall, tools: ToolRegistryGraph): Node<ToolResult> {
	// Retry once on error. Each attempt rebuilds the fromAny source so a
	// fresh Promise is awaited per attempt.
	//
	// `Promise.resolve().then(() => tools.execute(...))` ensures a synchronous
	// throw inside the handler surfaces as a rejected Promise (not an uncaught
	// sync throw at retrySource's factory-invocation), so retrySource's
	// reactive ERROR path fires consistently regardless of handler shape.
	const attempted: Node<unknown> = retrySource(
		() =>
			fromAny(
				Promise.resolve().then(() =>
					tools.execute(call.name, call.arguments),
				) as NodeInput<unknown>,
			),
		{ count: 1 },
	);
	// Don't double-JSON-stringify string handler returns — a handler returning
	// `"hello"` should surface as `hello` in the tool result, not `"\"hello\""`.
	// Only wrap non-string shapes so LLMs that parse tool results can roundtrip
	// structured data without surprise quoting.
	const onSuccess = derived<ToolResult>([attempted], ([val]) => ({
		id: call.id,
		content: typeof val === "string" ? val : JSON.stringify(val),
	}));
	return rescue(onSuccess, (err) => ({
		id: call.id,
		content: JSON.stringify({ error: String(err) }),
	}));
}

/**
 * Read the latest value for dep `i` inside a raw-`node()` fn body.
 *
 * Checks `batchData[i]` first (this-wave DATA from the dep), falls back to
 * `ctx.prevData[i]` (last DATA from prior waves), and finally to `fallback`
 * when the dep has never emitted (SENTINEL). Matches the unwrap semantics
 * `derived`'s sugar applies, so raw nodes can read deps uniformly.
 *
 * @internal
 */
function readLatest<T>(
	batchData: readonly (readonly unknown[] | undefined)[],
	prevData: readonly unknown[],
	index: number,
	fallback: T,
): T {
	const batch = batchData[index];
	if (batch != null && batch.length > 0) return batch[batch.length - 1] as T;
	const prev = prevData[index];
	return (prev !== undefined ? prev : fallback) as T;
}

/** @internal Shape of the LLM invocation input — constructed inside `promptInput`. */
interface InvokeInput {
	readonly messages: readonly ChatMessage[];
	readonly tools: readonly ToolDefinition[];
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
