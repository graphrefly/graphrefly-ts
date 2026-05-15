/**
 * `toolExecution` — reactive per-tool-call executor with retry + rescue.
 *
 * Lifted from the inlined `executeToolReactively` helper inside `agent-loop.ts`
 * so it can be consumed standalone by any caller with a reactive `toolCalls`
 * batch — not just `agentLoop`. The shape is: one input `Node<readonly
 * ToolCall[]>` + a `ToolRegistryGraph` → one output `Node<readonly
 * ToolResult[]>`. Each call maps to a per-call `retrySource(executeReactive)`
 * → optional `rescue` chain that emits the handler result on success, or a
 * JSON-wrapped `{ error }` payload on terminal failure so the LLM can see the
 * error as tool output and decide whether to try again via another tool call.
 *
 * **Cancellation.** `executeReactive` mints a per-call `AbortController` and
 * threads its signal into the handler call. When `switchMap` supersedes the
 * inner (a fresh `toolCalls` batch arrives) or the outer graph tears down,
 * the per-call node unsubscribes and `ac.abort()` fires. Signal-aware
 * handlers (`fetch(url, {signal})`, child-process kill, DB cancel) actually
 * stop in-flight work; handlers that ignore the signal still complete to
 * their original termination, but their result is discarded.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { rescue, retry, switchMap } from "@graphrefly/pure-ts/extra";
import type { ToolCall } from "../adapters/core/types.js";
import type { ToolRegistryGraph } from "./tool-registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single tool execution outcome: `{id, content}` where content is a JSON string. */
export interface ToolResult {
	readonly id: string;
	readonly content: string;
}

export type ToolExecutionOptions = {
	/**
	 * Reactive tool-call batch. Each non-empty emission triggers a fresh
	 * per-call execution fan-out; superseding emissions cancel the prior fan.
	 */
	toolCalls: Node<readonly ToolCall[]>;
	/** Registry that resolves tool name → handler. */
	tools: ToolRegistryGraph;
	/**
	 * Retry count per individual tool call. `retrySource({count: N})` retries
	 * up to N times on error (N retries = N+1 total attempts). Default: 1.
	 */
	retryCount?: number;
	/**
	 * How to surface a terminal error after retries are exhausted.
	 * - `"rescue"` (default): emit `{id, content: JSON.stringify({error})}`
	 *   so the LLM sees the failure as structured tool output and can decide
	 *   how to react. Sibling calls in the same batch continue to their own
	 *   completion; one call's failure does not affect the others.
	 * - `"propagate"`: let the ERROR propagate downstream. **Blast radius:**
	 *   the per-batch `derived` join auto-errors when any per-call node
	 *   terminates with ERROR, so one call's failure discards every sibling's
	 *   DATA (even ones that already settled with a valid ToolResult). Use
	 *   `"propagate"` only when a single tool failure should be fatal for the
	 *   whole batch; prefer `"rescue"` when you want the LLM to see partial
	 *   results plus per-call error markers.
	 */
	onError?: "rescue" | "propagate";
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reactive executor for a batch of LLM tool calls.
 *
 * Each DATA emission on `toolCalls` dispatches a fresh per-call fan-out: for
 * every call in the batch, construct a `retrySource(fromAny(tools.execute(
 * name, args)))` node, optionally `rescue` it into a JSON error shape, and
 * join the results via a `derived` whose first-run gate waits for every call
 * to settle before emitting the batch. Empty batches (`calls.length === 0`)
 * are a caller-side invariant violation (the upstream gate should emit
 * RESOLVED for empty batches, not DATA) and trigger a loud error — callers
 * that want to accept empty batches should upstream-filter them first.
 *
 * Reference-equality + content-equality dedup is applied to the output batch
 * so duplicate re-emissions from a completing retrySource don't propagate.
 *
 * @param opts - `{ toolCalls, tools, retryCount?, onError? }`.
 * @returns `Node<readonly ToolResult[]>` — one ToolResult per input ToolCall.
 */
export function toolExecution(opts: ToolExecutionOptions): Node<readonly ToolResult[]> {
	const { toolCalls, tools } = opts;
	const retryCount = opts.retryCount ?? 1;
	const onError = opts.onError ?? "rescue";

	const batchEquals = (a: readonly ToolResult[], b: readonly ToolResult[]): boolean => {
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

	return switchMap<readonly ToolCall[], readonly ToolResult[]>(toolCalls, (calls) => {
		if (calls == null || calls.length === 0) {
			throw new Error(
				"toolExecution: received an empty tool-call batch as DATA — callers must upstream-filter empty batches (emit RESOLVED) so switchMap is only dispatched for non-empty batches.",
			);
		}
		const perCall = calls.map((call) => executeOne(call, tools, retryCount, onError));
		// `executeOne` returns `Node<ToolResult>` in both "rescue" and
		// "propagate" modes (the rescue handler builds a `ToolResult`
		// shape; the success `derived` builds one directly). The join
		// just forwards the per-call values — no shape coercion needed.
		return node(
			perCall,
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data as readonly ToolResult[]);
			},
			{ describeKind: "derived", name: "toolExecution::batch", equals: batchEquals },
		);
	});
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Per-call reactive executor. `retrySource` re-invokes the factory on ERROR
 * (each attempt mints a fresh `executeReactive` node, which in turn mints a
 * fresh `AbortController` and handler invocation). `executeReactive` itself
 * handles synchronous handler throws — they surface as `[[ERROR, err]]`
 * inside the producer, so `retrySource`'s reactive ERROR path fires
 * consistently regardless of handler shape. No `Promise.resolve().then(...)`
 * thunk needed — the reactive path is end-to-end.
 *
 * Handlers that return a plain string are surfaced as-is; anything else is
 * `JSON.stringify`'d so LLMs that parse tool results can roundtrip
 * structured data without surprise quoting.
 */
function executeOne(
	call: ToolCall,
	tools: ToolRegistryGraph,
	retryCount: number,
	onError: "rescue" | "propagate",
): Node<ToolResult> {
	const attempted: Node<unknown> = retry(() => tools.executeReactive(call.name, call.arguments), {
		count: retryCount,
	}).node;
	const onSuccess = node<ToolResult>(
		[attempted],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const val = data[0];
			actions.emit({
				id: call.id,
				content: typeof val === "string" ? val : JSON.stringify(val),
			});
		},
		{ describeKind: "derived" },
	);
	if (onError === "propagate") return onSuccess;
	return rescue(onSuccess, (err) => ({
		id: call.id,
		content: JSON.stringify({ error: String(err) }),
	}));
}
