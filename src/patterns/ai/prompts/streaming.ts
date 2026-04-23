/**
 * `streamingPromptNode` + `gatedStream` — streaming LLM transforms, plus the
 * shared `StreamChunk` shape.
 *
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived, state } from "../../../core/sugar.js";
import { switchMap } from "../../../extra/operators.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
import type { Graph } from "../../../graph/graph.js";
import { keepalive } from "../../_internal.js";
import { type TopicGraph, topic } from "../../messaging/index.js";
import { type GateController, type GateOptions, gate } from "../../orchestration/index.js";
import { stripFences } from "../_internal.js";
import type { ChatMessage, LLMAdapter } from "../adapters/core/types.js";

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
 * Extractors can mount on the topic independently (see `streamExtractor`).
 * Zero overhead if nobody subscribes to the stream topic.
 *
 * The `output` node emits the final parsed result (like `promptNode`).
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
 * Composes {@link streamingPromptNode} with `gate` so that:
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
