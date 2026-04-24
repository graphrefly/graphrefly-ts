/**
 * `streamingPromptNode` + `gatedStream` — streaming LLM transforms.
 *
 * **Wave A Unit 2 rewrite:**
 * - `StreamChunk` retired. The live stream surface is now `deltaTopic:
 *   TopicGraph<StreamDelta & {seq, ts}>` — every adapter delta (token,
 *   thinking, tool-call, usage, finish) is published in order. The previous
 *   shape retained the accumulated text per-chunk, producing O(N²) memory;
 *   the new shape stores only per-delta payloads (O(N)).
 * - New `accumulatedText: Node<string>` on the bundle — lazy-built via
 *   `ctx.store` over token-type deltas. Text-only extractors (`streamExtractor`,
 *   `keywordFlagExtractor`, `toolCallExtractor`) consume this node.
 * - `retainedLimit?: number` option exposed for the delta topic (no default —
 *   session scale is domain-specific per Unit 2 Q2).
 * - Unconditional `keepalive(output)` removed — callers subscribe as needed.
 * - System-prompt double-send fixed (matches promptNode Unit 1 fix).
 * - `format: "json"` throws on parse error with a content-preview diagnostic
 *   (parity with `promptNode`).
 * - Shared body between `streamingPromptNode` and `gatedStream` extracted
 *   into `streamingInvoke` per Unit 2 locked scope.
 *
 * @module
 */

import { batch } from "../../../core/batch.js";
import { wallClockNs } from "../../../core/clock.js";
import type { Node } from "../../../core/node.js";
import { derived, state } from "../../../core/sugar.js";
import { switchMap } from "../../../extra/operators.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
import type { Graph } from "../../../graph/graph.js";
import { keepalive } from "../../_internal.js";
import { type TopicGraph, topic } from "../../messaging/index.js";
import { type GateController, type GateOptions, gate } from "../../orchestration/index.js";
import { aiMeta, stripFences } from "../_internal.js";
import type { ChatMessage, LLMAdapter, StreamDelta } from "../adapters/core/types.js";

/**
 * A single delta published to the `deltaTopic`. Every adapter emission is
 * forwarded — not just token deltas — so consumers see the full event log
 * (thinking, tool-call-delta, usage, finish).
 */
export type StampedDelta = StreamDelta & {
	/** Monotonic per-stream counter starting at 0. */
	readonly seq: number;
	/** Wall-clock nanoseconds at publish time (spec §5.11 central timer). */
	readonly ts: number;
};

export type StreamingPromptNodeOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Output format — `"json"` attempts JSON.parse on accumulated text. Throws on parse failure. Default: `"text"`. */
	format?: "text" | "json";
	systemPrompt?: string;
	meta?: Record<string, unknown>;
	/**
	 * Optional retention cap on the delta topic. Omit for unbounded retention
	 * (the topic grows until `dispose()`). Recommended values: `8_192` for
	 * single-shot 8K-token responses, `1_000_000` for persistent session
	 * topics, or explicit `dispose()` for worker-pool patterns.
	 */
	retainedLimit?: number;
};

/**
 * Bundle returned by {@link streamingPromptNode}.
 */
export type StreamingPromptNodeHandle<T> = {
	/** Final parsed result (emits once per invocation, after stream completes). */
	output: Node<T | null>;
	/** Live delta topic — every adapter delta in order, stamped with `seq` + `ts`. */
	deltaTopic: TopicGraph<StampedDelta>;
	/**
	 * Reactive accumulated-text view — lazy-built over `deltaTopic.latest`
	 * filtered on `type === "token"`. Text-only extractors compose on this.
	 * Emits the empty string before any token arrives.
	 */
	accumulatedText: Node<string>;
	/** Tear down the delta topic and release resources. */
	dispose: () => void;
};

/**
 * Internal pump: open a stream against `adapter`, stamp each delta, publish
 * to `deltaTopic`, and return the final accumulated text. Extracted so
 * `gatedStream` can reuse the body (Unit 2 locked scope).
 */
async function streamingInvoke(
	adapter: LLMAdapter,
	msgs: readonly ChatMessage[],
	invokeOpts: {
		model?: string;
		temperature?: number;
		maxTokens?: number;
		systemPrompt?: string;
		signal: AbortSignal;
	},
	deltaTopic: TopicGraph<StampedDelta>,
): Promise<string> {
	let accumulated = "";
	let seq = 0;
	for await (const delta of adapter.stream(msgs, invokeOpts)) {
		deltaTopic.publish({ ...delta, seq: seq++, ts: wallClockNs() } as StampedDelta);
		if (delta.type === "token") accumulated += delta.delta;
	}
	return accumulated;
}

/** Parse accumulated text per `format`. Throws on JSON parse failure. */
function parseAccumulated<T>(accumulated: string, format: "text" | "json"): T | null {
	if (format === "json") {
		try {
			return JSON.parse(stripFences(accumulated)) as T;
		} catch (err) {
			const preview = accumulated.slice(0, 160);
			throw new Error(
				`streamingPromptNode: format:"json" — failed to parse accumulated text as JSON: ${(err as Error).message}; content preview: ${preview}`,
			);
		}
	}
	return accumulated as unknown as T;
}

/**
 * Build the lazy `accumulatedText` derived that maintains a running string
 * over `deltaTopic.latest` filtered on token deltas. Uses `ctx.store` per
 * COMPOSITION-GUIDE §20 — accumulator clears on deactivation.
 */
function makeAccumulatedText(deltaTopic: TopicGraph<StampedDelta>, name: string): Node<string> {
	return derived<string>(
		[deltaTopic.latest],
		([d], ctx) => {
			const store = ctx.store as { acc?: string };
			if (d == null) return store.acc ?? "";
			const delta = d as StampedDelta;
			// `seq === 0` marks the first delta of a fresh invocation — reset
			// the accumulator so runs don't concatenate across switchMap
			// supersedes. Without this, invocation 2's text would be appended
			// to invocation 1's text (the `deltaTopic` outlives each switchMap
			// inner, so `ctx.store.acc` would otherwise persist).
			if (delta.seq === 0) store.acc = "";
			if (delta.type === "token") {
				store.acc = (store.acc ?? "") + delta.delta;
			}
			return store.acc ?? "";
		},
		{
			name,
			meta: aiMeta("accumulated_text"),
			initial: "",
		},
	);
}

/**
 * Streaming LLM transform: wraps a prompt template + adapter into a reactive
 * streaming pipeline. Re-invokes the LLM whenever any dep changes; the
 * previous in-flight stream is canceled automatically via `switchMap`.
 *
 * Every adapter delta is published to `deltaTopic` stamped with `seq` + `ts`.
 * Text consumers subscribe to `accumulatedText` (auto-maintained). Delta-
 * specific consumers (`costMeterExtractor` on `usage` deltas) subscribe to
 * `deltaTopic` directly and filter by `delta.type`.
 *
 * The async boundary is handled by `fromAny(asyncGenerator)` (spec §5.10).
 */
export function streamingPromptNode<T = string>(
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: StreamingPromptNodeOptions,
): StreamingPromptNodeHandle<T> {
	const sourceName = opts?.name ?? "llm";
	const format = opts?.format ?? "text";
	const deltaTopic = topic<StampedDelta>(`${sourceName}/stream`, {
		...(opts?.retainedLimit != null ? { retainedLimit: opts.retainedLimit } : {}),
	});

	const messagesNode = derived<readonly ChatMessage[]>(
		deps as Node<unknown>[],
		(values) => {
			if (values.some((v) => v == null)) return [];
			const text = typeof prompt === "string" ? prompt : prompt(...values);
			if (!text) return [];
			return [{ role: "user", content: text }];
		},
		{
			name: `${sourceName}::messages`,
			meta: aiMeta("prompt_node::messages"),
			initial: [] as readonly ChatMessage[],
		},
	);

	const output = switchMap(messagesNode, (msgs) => {
		const chatMsgs = msgs as readonly ChatMessage[];
		if (!chatMsgs || chatMsgs.length === 0) {
			return state<T | null>(null) as NodeInput<T | null>;
		}
		const ac = new AbortController();
		async function* pumpAndCollect(): AsyncGenerator<T | null> {
			try {
				const accumulated = await streamingInvoke(
					adapter,
					chatMsgs,
					{
						model: opts?.model,
						temperature: opts?.temperature,
						maxTokens: opts?.maxTokens,
						systemPrompt: opts?.systemPrompt,
						signal: ac.signal,
					},
					deltaTopic,
				);
				yield parseAccumulated<T>(accumulated, format);
			} finally {
				ac.abort();
			}
		}
		return fromAny(pumpAndCollect());
	});

	const accumulatedText = makeAccumulatedText(deltaTopic, `${sourceName}::accumulatedText`);

	// Keepalive on `output` — a caller who subscribes ONLY to `deltaTopic` or
	// `accumulatedText` expects the stream to run (that's the bundle contract
	// — three reactive surfaces, any one of them activates the pipeline).
	// Without this, the lazy `switchMap` stays cold until someone subscribes
	// to `.output` directly, and deltas never flow. The original
	// `streamingPromptNode` carried this keepalive; the Unit 2 "zero overhead
	// if nobody subscribes" removal broke the bundle-activation contract.
	// Restored here with explicit dispose so the keepalive follows the bundle.
	const unsubOutput = keepalive(output);

	return {
		output,
		deltaTopic,
		accumulatedText,
		dispose: () => {
			unsubOutput();
			deltaTopic.destroy();
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
	/** Live delta topic — every adapter delta in order, stamped with `seq` + `ts`. */
	deltaTopic: TopicGraph<StampedDelta>;
	/** Reactive accumulated-text view. */
	accumulatedText: Node<string>;
	/** Gate controller — approve, reject (aborts in-flight stream), modify. */
	gate: GateController<T | null>;
	/** Tear down the delta topic + gate keepalive. */
	dispose: () => void;
};

/**
 * Streaming LLM transform with human-in-the-loop gate integration.
 *
 * Composes {@link streamingPromptNode} with `gate` so that:
 * - `gate.reject()` discards the pending value **and** aborts the in-flight
 *   stream (toggles an internal cancel signal → switchMap restart → abort).
 * - `gate.modify()` transforms the pending value before forwarding downstream.
 * - `gate.approve()` forwards the final result as normal.
 *
 * Wave A Unit 2 defers full `gatedStream` review to Wave B Unit 17 (the
 * `gate()` primitive itself is reviewed there). This implementation retains
 * the existing gate API while adopting the Unit 2 delta-topic shape.
 */
export function gatedStream<T = string>(
	graph: Graph,
	name: string,
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: GatedStreamOptions,
): GatedStreamHandle<T> {
	const cancelSignal = state<number>(0, { name: `${name}/cancel` });
	let cancelCounter = 0;

	const allDeps = [...deps, cancelSignal] as readonly Node<unknown>[];

	const sourceName = opts?.name ?? name;
	const format = opts?.format ?? "text";
	const deltaTopic = topic<StampedDelta>(`${sourceName}/stream`, {
		...(opts?.retainedLimit != null ? { retainedLimit: opts.retainedLimit } : {}),
	});

	const messagesNode = derived<readonly ChatMessage[]>(
		allDeps as Node<unknown>[],
		(values) => {
			// Last dep is the cancel signal — exclude from prompt args.
			const depValues = values.slice(0, -1);
			if (depValues.some((v) => v == null)) return [];
			const text = typeof prompt === "string" ? prompt : prompt(...depValues);
			if (!text) return [];
			return [{ role: "user", content: text }];
		},
		{
			name: `${sourceName}::messages`,
			meta: aiMeta("prompt_node::messages"),
			initial: [] as readonly ChatMessage[],
		},
	);

	const output = switchMap(messagesNode, (msgs) => {
		const chatMsgs = msgs as readonly ChatMessage[];
		if (!chatMsgs || chatMsgs.length === 0) {
			return state<T | null>(null) as NodeInput<T | null>;
		}
		const ac = new AbortController();
		async function* pumpAndCollect(): AsyncGenerator<T | null> {
			try {
				const accumulated = await streamingInvoke(
					adapter,
					chatMsgs,
					{
						model: opts?.model,
						temperature: opts?.temperature,
						maxTokens: opts?.maxTokens,
						systemPrompt: opts?.systemPrompt,
						signal: ac.signal,
					},
					deltaTopic,
				);
				yield parseAccumulated<T>(accumulated, format);
			} finally {
				ac.abort();
			}
		}
		return fromAny(pumpAndCollect());
	});

	const accumulatedText = makeAccumulatedText(deltaTopic, `${sourceName}::accumulatedText`);

	// Filter: only forward non-null results to the gate (spec §2.4 no-auto-emit).
	const nonNullOutput = derived<T>(
		[output],
		([v]) => {
			if (v == null) return undefined;
			return v as T;
		},
		{ name: `${name}/filter` },
	);
	graph.add(nonNullOutput, { name: `${name}/raw` });

	// Wire gate on the output.
	const gateCtrl = gate<T | null>(graph, `${name}/gate`, `${name}/raw`, opts?.gate);

	// Keepalive on the switchMap product so the upstream stream flows even
	// before the gate has a downstream subscriber — gate wiring is
	// activation-driven, and without this the gate never observes pending
	// values. Retained from the pre-Unit-2 implementation.
	const unsub = keepalive(output);

	// Wrap reject to also abort the in-flight stream. Both mutations happen
	// inside `batch()` so downstream subscribers never observe a torn state
	// where `gate.count` has decremented but `cancelSignal` hasn't yet
	// advanced (spec §2 two-phase DIRTY-before-DATA atomicity).
	const originalReject = gateCtrl.reject.bind(gateCtrl);
	const gateWithAbort: GateController<T | null> = {
		...gateCtrl,
		reject(count = 1) {
			batch(() => {
				originalReject(count);
				cancelSignal.emit(++cancelCounter);
			});
		},
	};

	return {
		output: gateCtrl.node,
		deltaTopic,
		accumulatedText,
		gate: gateWithAbort,
		dispose: () => {
			unsub();
			deltaTopic.destroy();
		},
	};
}
