/**
 * `promptNode` — universal LLM transform as a reactive derived node.
 *
 * The shape: `deps → messagesNode (derived) → switchMap → call (producer) → output`.
 * Each upstream wave is one LLM call; superseding waves cancel the in-flight
 * call via the abort signal threaded through `nodeSignal(opts.abort)`.
 *
 * The producer-shape on the inner is load-bearing: it emits exactly one DATA
 * + COMPLETE per wave, so the outer switchMap sees one DATA per wave (matches
 * the `HarnessExecutor` contract). A `derived([call], parse)` would have its
 * own first-run / push-on-subscribe semantics that can leak a transient null
 * before the real response arrives — observed and reverted in an earlier
 * attempt; see SESSION-ai-harness-module-review.md line 3654 for context.
 * Locked as path (b) producer-based by Session C (2026-04-27).
 *
 * **Retry / replay-cache.** Stack middleware on the adapter:
 *
 * ```ts
 * import { withRetry, withReplayCache } from "@graphrefly/graphrefly/patterns/ai";
 *
 * const adapter = withRetry(
 *   withReplayCache(baseAdapter, { keyFn: (ctx) => ctx.messages[0].content }),
 *   { count: 3, backoff: 200 },
 * );
 * const result = promptNode(adapter, [input], (q) => q);
 * ```
 *
 * `promptNode` no longer ships `retries` / `cache` options — they duplicated
 * middleware already at the adapter layer.
 *
 * **Cross-wave cache (COMPOSITION-GUIDE §32).** The switchMap output cache
 * survives across new outer DATAs — `promptNode`'s cached value persists
 * until the next wave fully resolves. Consumers that need to distinguish
 * "fresh value for THIS session" from "stale cache from a prior session"
 * (e.g. `agentLoop` resetting on new `run()`) must add a `state()` mirror
 * at their session boundary and depend on the mirror, not the `promptNode`
 * output directly. `promptNode` itself stays primitive — it does not
 * embed a state-mirror.
 *
 * @module
 */

import { COMPLETE, DATA, ERROR } from "../../../core/messages.js";
import type { Node } from "../../../core/node.js";
import { derived, producer, state } from "../../../core/sugar.js";
import { switchMap } from "../../../extra/operators.js";
import { fromAny, type NodeInput, nodeSignal } from "../../../extra/sources.js";
import { aiMeta, stripFences } from "../_internal.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
} from "../adapters/core/types.js";

export type PromptNodeOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Output format — `"json"` attempts JSON.parse on the response. Default: `"text"`. */
	format?: "text" | "json";
	/**
	 * Optional system prompt. Forwarded via `opts.systemPrompt` to the adapter
	 * only — never pushed as a `{role:"system"}` message (avoiding the
	 * double-send class of bug where adapters that normalize both shapes end
	 * up with two system entries).
	 */
	systemPrompt?: string;
	/**
	 * Optional reactive abort signal. When the node emits `true`, the in-flight
	 * `adapter.invoke()` call is cancelled via `AbortController.abort()`.
	 * Threaded through `nodeSignal(abort)` — a one-shot bridge. Useful inside
	 * agent state machines where a separate `aborted` state should cancel the
	 * current LLM call without superseding via switchMap.
	 */
	abort?: Node<boolean>;
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

function previewContent(text: string, max = 200): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…`;
}

/**
 * Universal LLM transform: wraps a prompt template + model adapter into a reactive derived node.
 * Re-invokes the LLM whenever any dep changes. Suitable for triage, QA, hypothesis, parity, etc.
 *
 * **Topology** (visible in `describe()`):
 * ```
 * <deps...>          → <name>::messages   (derived, meta.ai = prompt_node)
 * <name>::messages   → <name>::output     (switchMap product, meta.ai = prompt_node::output)
 *   per-wave inner:  <name>::call         (producer, meta.ai = prompt_node::call)
 * ```
 *
 * **No-input semantics** (matches the codebase-wide SENTINEL convention):
 * - **Initial no-input** (no real input has ever arrived) — emits nothing.
 *   Outer cache stays `undefined`; `subscribe` consumers see no DATA event.
 *   Use this to keep downstream gating clean: a `withLatestFrom`-paired
 *   trigger won't fire until the LLM has actually produced something.
 * - **Mid-flow no-input** (input dropped to nullish after at least one
 *   real LLM call) — emits `null` as a domain "input went away" signal.
 *   Downstream consumers can distinguish "haven't started" from "input
 *   gone."
 *
 * **Retries / caching:** stack `withRetry` / `withReplayCache` middleware on the
 * `adapter` argument — `promptNode` no longer ships its own duplicated retry /
 * cache loops (pre-1.0 cleanup, see review session 1).
 *
 * @param adapter - LLM adapter (provider-agnostic). Wrap with `withRetry` /
 *                   `withReplayCache` middleware for transient-error tolerance
 *                   or replay caching.
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
	const baseName = opts?.name ?? "prompt_node";

	// SENTINEL semantics rely on the universal first-run gate + standard
	// prevData semantics (undefined = SENTINEL, any other value = DATA seen):
	//   - **Initial no-input** (no dep has ever DATA'd, so prevData is
	//     undefined across the board): the `derived`'s first-run gate blocks
	//     `messagesNode`'s fn entirely. It never emits, switchMap never
	//     fires, outer cache stays `undefined`.
	//   - **Mid-flow no-input** (deps previously DATA'd then went nullish):
	//     fn runs, returns `[]`, switchMap dispatches the `state(null)`
	//     branch → outer emits `null` as the domain "input went away" signal.
	// No `initial: []` and no closure flag — `prevData === undefined` is
	// already the sentinel marker, and the gate already enforces "don't fire
	// fn until every dep has DATA'd at least once."
	const messagesNode = derived<readonly ChatMessage[]>(
		deps as Node<unknown>[],
		(values) => {
			// Dep-level null guard (composition guide §8): if any dep is
			// nullish, return empty messages → switchMap emits null
			// (mid-flow drop-out).
			if (values.some((v) => v == null)) return [];
			const text = typeof prompt === "string" ? prompt : prompt(...values);
			if (!text) return [];
			// systemPrompt forwarded through invoke opts only (no double-send).
			return [{ role: "user" as const, content: text }];
		},
		{
			name: `${baseName}::messages`,
			meta: aiMeta("prompt_node"),
		},
	);

	const result = switchMap<readonly ChatMessage[], T | null>(
		messagesNode,
		(msgs) => {
			if (!msgs || msgs.length === 0) {
				return state<T | null>(null) as NodeInput<T | null>;
			}

			// Producer ensures exactly one DATA + COMPLETE per wave; switchMap
			// sees one DATA, the harness's "one emission per wave" contract is
			// honored. Earlier attempts using `derived([call], parse)` leaked
			// transient nulls via the derived's first-run gate.
			return producer<T | null>(
				(actions) => {
					let done = false;
					let cancelled = false;
					let abortDispose: (() => void) | undefined;

					const invokeOpts: LLMInvokeOptions = {
						model: opts?.model,
						temperature: opts?.temperature,
						maxTokens: opts?.maxTokens,
						systemPrompt: opts?.systemPrompt,
					};
					if (opts?.abort) {
						const sig = nodeSignal(opts.abort);
						invokeOpts.signal = sig.signal;
						abortDispose = sig.dispose;
					}

					let invokeResult: NodeInput<LLMResponse>;
					try {
						invokeResult = adapter.invoke(msgs, invokeOpts);
					} catch (err) {
						done = true;
						actions.down([[ERROR, err]]);
						return () => {
							abortDispose?.();
						};
					}

					const callNode = fromAny(invokeResult);

					const sub = callNode.subscribe((batch) => {
						if (cancelled || done) return;
						for (const msg of batch) {
							if (done) return;
							if (msg[0] === DATA) {
								const resp = msg[1] as LLMResponse;
								try {
									const content = extractContent(resp);
									const parsed: T =
										format === "json"
											? (JSON.parse(stripFences(content)) as T)
											: (content as unknown as T);
									actions.emit(parsed);
								} catch (err) {
									const raw = extractContent(resp);
									const wrapped = new Error(
										`promptNode: failed to parse LLM response as JSON: ${
											(err as Error).message
										}\n  Raw content (first 200 chars): ${previewContent(raw)}`,
									);
									done = true;
									actions.down([[ERROR, wrapped]]);
									return;
								}
							} else if (msg[0] === ERROR) {
								done = true;
								actions.down([[ERROR, msg[1]]]);
								return;
							} else if (msg[0] === COMPLETE) {
								// Adapter completed — propagate. emit() above already
								// queued the parsed value so the wave carries DATA + COMPLETE.
								done = true;
								actions.down([[COMPLETE]]);
								return;
							} else {
								// Spec §1.3.6 forward-unknown — DIRTY/RESOLVED/INVALIDATE/
								// PAUSE/RESUME etc. should propagate so downstream caches /
								// flow-control hooks aren't starved. Re-typed `as never`
								// because the call's NodeInput<LLMResponse> message tuple
								// is wider than the unbound `T` projection.
								actions.down([msg as never]);
							}
						}
					});

					return () => {
						cancelled = true;
						sub();
						abortDispose?.();
					};
				},
				{
					name: `${baseName}::call`,
					meta: aiMeta("prompt_node::call"),
				},
			) as NodeInput<T | null>;
		},
		{
			name: `${baseName}::output`,
			meta: opts?.meta
				? { ...aiMeta("prompt_node::output"), ...opts.meta }
				: aiMeta("prompt_node::output"),
		},
	);

	return result;
}
