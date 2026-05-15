/**
 * `promptNode` — universal LLM transform as a reactive derived node.
 *
 * The shape: `deps → messagesNode (derived) → switchMap → response (producer) → output`.
 * Each upstream wave is one LLM call; superseding waves cancel the in-flight
 * call via the abort signal threaded through `nodeSignal(opts.abort)`.
 *
 * The producer-shape on the inner is load-bearing: it emits exactly one DATA
 * + COMPLETE per wave, so the outer switchMap sees one DATA per wave (matches
 * the `HarnessExecutor` contract). A `node([response], (batchData, actions, ctx) => {
 *   const data = ...; actions.emit(parse(data[0]));
 * }, { describeKind: "derived" })` would have its
 * own first-run / push-on-subscribe semantics that can leak a transient null
 * before the real response arrives — observed and reverted in an earlier
 * attempt; see SESSION-ai-harness-module-review.md line 3654 for context.
 * Locked as path (b) producer-based by Session C (2026-04-27); inner-node
 * naming aligned to `prompt_node::response` per the C+D widening (2026-04-30).
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
 * (e.g. `agentLoop` resetting on new `run()`) must add a `node([])` mirror
 * at their session boundary and depend on the mirror, not the `promptNode`
 * output directly. `promptNode` itself stays primitive — it does not
 * embed a state-mirror.
 *
 * @module
 */

import { COMPLETE, DATA, ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { fromAny, type NodeInput, nodeSignal, switchMap } from "@graphrefly/pure-ts/extra";
import { aiMeta, stripFences } from "../_internal.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	ToolDefinition,
} from "../adapters/core/types.js";

export type PromptNodeOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/**
	 * Output format:
	 * - `"text"` (default) — emit the response content as a string.
	 * - `"json"` — `JSON.parse` the content (markdown fences stripped).
	 * - `"raw"` — emit the full {@link LLMResponse} object (subsumes the
	 *   pre-Tier-2.3 `fromLLM` shape; use this when you need `usage` /
	 *   `toolCalls` / `finishReason` alongside `content`).
	 */
	format?: "text" | "json" | "raw";
	/**
	 * Reactive tool definitions forwarded to the adapter. Pair with
	 * `format: "raw"` (or read `toolCalls` from a downstream parser) when
	 * tool-calling is in scope.
	 *
	 * **Reactive declared edge** (DF12, Tier 7): `tools` is a `Node` so the
	 * tools list participates in `describe()` topology and `explain()` causal
	 * chains. The tools Node is added to `messagesNode`'s declared deps —
	 * tools changes re-invoke the LLM (treated as a new call envelope).
	 * Wrap with `distinctUntilChanged` upstream if your tool selector emits
	 * noisy duplicates that would otherwise spam the adapter. See
	 * COMPOSITION-GUIDE §31 (Dynamic tool selection) for the canonical
	 * `toolSelector` pattern that produces this Node.
	 *
	 * **Activation note:** since `tools` is a real declared dep, `messagesNode`
	 * waits for the tools Node to DATA at least once before firing
	 * (push-on-subscribe SENTINEL gate). Pass a `node<ToolDefinition[]>([], { initial: [] })`
	 * if you want immediate activation with no tools, or the latest published
	 * `toolSelector.tools` Node.
	 */
	tools?: Node<readonly ToolDefinition[]>;
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
 * <deps...>, [tools?]  → <name>::messages   (derived, meta.ai = prompt_node::messages)
 * <name>::messages     → <name>::output     (switchMap product, meta.ai = prompt_node::output)
 *   per-wave inner:    <name>::response     (producer, meta.ai = prompt_node::response)
 * ```
 * When `opts.tools` is supplied, the tools `Node` is appended to
 * `messagesNode`'s declared deps so it appears as a real edge in `describe()`
 * / `explain()` (DF12, Tier 7).
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
// Overload 1: `format: "raw"` constrains the emit type to `LLMResponse | null`
// (the full adapter response, with `usage` / `toolCalls` / `finishReason`).
// Subsumes the pre-Tier-2.3 `fromLLM` shape.
export function promptNode(
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts: PromptNodeOptions & { format: "raw" },
): Node<LLMResponse | null>;
// Overload 2: `format: "text" | "json"` (default text) — emit-type is the
// caller's `T` (defaults to `string`). For `"json"` callers typically pass
// the parsed shape (e.g. `promptNode<MyShape>(...)`).
export function promptNode<T = string>(
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: Omit<PromptNodeOptions, "format"> & { format?: "text" | "json" },
): Node<T | null>;
export function promptNode<T = string>(
	adapter: LLMAdapter,
	deps: readonly Node<unknown>[],
	prompt: string | ((...depValues: unknown[]) => string),
	opts?: PromptNodeOptions,
): Node<T | null> {
	const format = opts?.format ?? "text";
	const baseName = opts?.name ?? "prompt_node";

	// qa A8: tools without `format: "raw"` is a footgun — adapter receives
	// the tool definitions and may produce `toolCalls`, but the emit path
	// only extracts `content`. Warn at construction; downstream parsers
	// reading `toolCalls` from a custom `format: "raw"` consumer pattern
	// can ignore by setting `format: "raw"` (intent now matches behavior).
	if (opts?.tools !== undefined && format !== "raw") {
		console.warn(
			"promptNode: `tools` is set but `format !== 'raw'`. " +
				"Tool calls in the response will be silently dropped — set " +
				"`format: 'raw'` to receive the full LLMResponse with `toolCalls`.",
		);
	}

	// SENTINEL semantics rely on the universal first-run gate + standard
	// prevData semantics (undefined = SENTINEL, any other value = DATA seen):
	//   - **Initial no-input** (no dep has ever DATA'd, so prevData is
	//     undefined across the board): the `derived`'s first-run gate blocks
	//     `messagesNode`'s fn entirely. It never emits, switchMap never
	//     fires, outer cache stays `undefined`.
	//   - **Mid-flow no-input** (deps previously DATA'd then went nullish):
	//     fn runs, returns `[]`, switchMap dispatches the `node([], { initial: null })`
	//     branch → outer emits `null` as the domain "input went away" signal.
	// No `initial: []` and no closure flag — `prevData === undefined` is
	// already the sentinel marker, and the gate already enforces "don't fire
	// fn until every dep has DATA'd at least once."
	//
	// DF12: when `opts.tools` is a Node, it's appended to `messagesNode`'s
	// declared deps. The fn slices values into user-deps + tools, and emits
	// an envelope `{ messages, tools }` so switchMap's per-wave inner can
	// read the latest tools via the reactive edge instead of a closure.
	type Envelope = {
		messages: readonly ChatMessage[];
		tools: readonly ToolDefinition[] | undefined;
	};
	const userDepsLength = deps.length;
	const allDeps: readonly Node<unknown>[] =
		opts?.tools !== undefined ? [...deps, opts.tools as Node<unknown>] : deps;
	const messagesNode = node<Envelope>(
		allDeps as Node<unknown>[],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const userValues = data.slice(0, userDepsLength);
			const toolsValue =
				opts?.tools !== undefined
					? (data[userDepsLength] as readonly ToolDefinition[] | undefined)
					: undefined;
			// Dep-level null guard (composition guide §8): if any USER dep is
			// nullish, emit empty messages → switchMap emits null (mid-flow
			// drop-out). The tools dep can legitimately be empty `[]`; only
			// user deps gate the call.
			if (userValues.some((v) => v == null)) {
				actions.emit({ messages: [], tools: toolsValue });
				return;
			}
			const text = typeof prompt === "string" ? prompt : prompt(...userValues);
			if (!text) {
				actions.emit({ messages: [], tools: toolsValue });
				return;
			}
			// systemPrompt forwarded through invoke opts only (no double-send).
			actions.emit({
				messages: [{ role: "user" as const, content: text }],
				tools: toolsValue,
			});
		},
		{
			name: `${baseName}::messages`,
			meta: aiMeta("prompt_node::messages"),
		},
	);

	const result = switchMap<Envelope, T | null>(
		messagesNode,
		(envelope) => {
			const { messages: msgs, tools } = envelope;
			if (!msgs || msgs.length === 0) {
				return node<T | null>([], { initial: null }) as NodeInput<T | null>;
			}

			// Producer ensures exactly one DATA + COMPLETE per wave; switchMap
			// sees one DATA, the harness's "one emission per wave" contract is
			// honored. Earlier attempts using a derived node leaked
			// transient nulls via the derived's first-run gate.
			return node<T | null>(
				(_data, actions) => {
					let done = false;
					let cancelled = false;
					let abortDispose: (() => void) | undefined;

					const invokeOpts: LLMInvokeOptions = {
						model: opts?.model,
						temperature: opts?.temperature,
						maxTokens: opts?.maxTokens,
						systemPrompt: opts?.systemPrompt,
						...(tools !== undefined ? { tools } : {}),
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
							// F-11: re-check `cancelled` (and `done`) at the top of
							// each per-message iteration so a teardown / abort that
							// fires synchronously between messages stops processing
							// further batched messages immediately.
							if (cancelled || done) return;
							if (msg[0] === DATA) {
								const resp = msg[1] as LLMResponse;
								// `format: "raw"` bypasses parsing — emit the full
								// LLMResponse object (subsumes the pre-Tier-2.3 `fromLLM`
								// output shape).
								if (format === "raw") {
									actions.emit(resp as unknown as T);
								} else {
									// F-12: cache the extracted content once on the
									// parse-failure path so we don't call
									// `extractContent(resp)` twice (once for parsing,
									// once for the error-message preview).
									let content: string;
									try {
										content = extractContent(resp);
									} catch (err) {
										// extractContent itself failed — propagate as
										// an ERROR with a generic raw-extraction message.
										const wrapped = new Error(
											`promptNode: failed to extract content from LLM response: ${
												(err as Error).message
											}`,
										);
										// F-7: dispose abort hook on terminal-error
										// branches so we don't retain the AbortController
										// after the wave terminates. Idempotent.
										abortDispose?.();
										abortDispose = undefined;
										done = true;
										actions.down([[ERROR, wrapped]]);
										return;
									}
									try {
										const parsed: T =
											format === "json"
												? (JSON.parse(stripFences(content)) as T)
												: (content as unknown as T);
										actions.emit(parsed);
									} catch (err) {
										const wrapped = new Error(
											`promptNode: failed to parse LLM response as JSON: ${
												(err as Error).message
											}\n  Raw content (first 200 chars): ${previewContent(content)}`,
										);
										// F-7: dispose abort hook on parse-error
										// terminal branch.
										abortDispose?.();
										abortDispose = undefined;
										done = true;
										actions.down([[ERROR, wrapped]]);
										return;
									}
								}
							} else if (msg[0] === ERROR) {
								// F-7: dispose abort hook on terminal ERROR branch.
								abortDispose?.();
								abortDispose = undefined;
								done = true;
								actions.down([[ERROR, msg[1]]]);
								return;
							} else if (msg[0] === COMPLETE) {
								// Adapter completed — propagate. emit() above already
								// queued the parsed value so the wave carries DATA + COMPLETE.
								// F-7: dispose abort hook on terminal COMPLETE branch.
								abortDispose?.();
								abortDispose = undefined;
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
						// F-7: cleanup callback's abortDispose call is idempotent —
						// the terminal-branch dispose above sets `abortDispose =
						// undefined` so this is a no-op when terminal-fired.
						abortDispose?.();
						abortDispose = undefined;
					};
				},
				{
					describeKind: "producer",
					name: `${baseName}::response`,
					meta: aiMeta("prompt_node::response"),
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
