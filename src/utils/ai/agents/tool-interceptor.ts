import { factoryTag, type Node, node, RESOLVED } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import { aiMeta } from "../_internal.js";
import type { ToolCall } from "../adapters/core/types.js";

// ---------------------------------------------------------------------------
// toolInterceptor — reactive tool-call enforcement (D9 / COMPOSITION-GUIDE §31)
// ---------------------------------------------------------------------------

/**
 * Options for {@link toolInterceptor}.
 */
export interface ToolInterceptorOptions {
	readonly name?: string;
	/**
	 * Kill-switch. When this reactive Node emits `false`, **every** tool call
	 * in the wave is denied and the turn collapses to a clean no-op (RESOLVED,
	 * not an empty-array execution). An explicit `null` / `undefined` DATA
	 * value is pass-through ("deny when explicitly `false`"). Like
	 * {@link ToolInterceptorOptions.allow}, a switch node that has never
	 * emitted has **unspecified** gating — **always seed it**
	 * (`node([], { initial: true })`). Modelled as a reactive deny-signal, NOT
	 * a buffering `valve`: a security kill-switch must DROP denied calls,
	 * never buffer-and-replay them after re-enable — a re-enable with no fresh
	 * `calls` wave is a no-op (see {@link ToolInterceptorOptions.allow}).
	 */
	readonly enabled?: NodeInput<boolean>;
	/**
	 * Per-call allow predicates. A tool call is forwarded iff **every**
	 * predicate returns `true`. A predicate that has emitted an explicit
	 * `null` / `undefined` DATA value is pass-through (the policy author's
	 * "not-ready, allow" signal). **Always seed each predicate node with an
	 * `initial`** (e.g. `node([], { initial: null })` for pass-through-while-
	 * loading, or an initial predicate fn): a predicate node that has *never*
	 * emitted DATA has **unspecified** gating — depending on activation order
	 * the non-partial first-run gate may hold the tool turn or pass through,
	 * so a never-seeded policy must not be relied on either way. A predicate
	 * that **throws** is treated as **deny** for that call (a security gate
	 * must never fail open on a buggy policy).
	 *
	 * **Re-filtering is calls-driven, not predicate-driven.** A predicate (or
	 * {@link enabled}) change *alone* never re-emits an in-flight batch — that
	 * would replay a previously-denied batch with no LLM in the loop
	 * (confused-deputy). The post-intercept stream only re-evaluates on a
	 * *fresh* `calls` wave; predicate/switch updates take effect on the next
	 * tool-call batch.
	 */
	readonly allow?: readonly NodeInput<(call: ToolCall) => boolean>[];
}

/**
 * Reactive tool-call **enforcement** (COMPOSITION-GUIDE §31, Composition C).
 * The post-generation security counterpart to `toolSelector`'s
 * pre-generation UX: `toolSelector` controls what's *offered* to the LLM;
 * `toolInterceptor` gates what's *executed* after the LLM chooses.
 *
 * Returns a transform `(calls) => Node<readonly ToolCall[]>` shaped to slot
 * directly into `agentLoop`'s `interceptToolCalls` splice
 * (`agent-loop.ts` D9). The returned node is `derived`-kind: it sees the raw
 * tool-call batch, applies the kill-switch then the per-call predicates, and
 *
 * - emits the surviving subset when ≥1 call passes,
 * - emits `[RESOLVED]` when the switch is off OR every call is denied — a
 *   clean no-op turn, structurally identical to `toolCallsRaw`'s own
 *   empty-batch gate, so `toolExecution`'s non-empty contract is preserved.
 *
 * Because the splice replaces the public `agent.toolCalls` view with this
 * node, audit / telemetry observe the post-intercept reality.
 *
 * @example
 * ```ts
 * const killSwitch = node<boolean>([], { name: "tools-enabled", initial: true });
 * const loop = agentLoop("agent", {
 *   adapter,
 *   tools: [searchTool, deleteTool],
 *   interceptToolCalls: toolInterceptor({
 *     enabled: killSwitch,
 *     allow: [
 *       // deny destructive tools unless an external policy node says ok
 *       node([policyNode], (b, a, c) => {
 *         const d = b.map((x, i) => x != null && x.length > 0 ? x.at(-1) : c.prevData[i]);
 *         a.emit((call: ToolCall) => call.name !== "delete" || d[0] === true);
 *       }, { describeKind: "derived" }),
 *     ],
 *   }),
 * });
 * ```
 *
 * @param opts - {@link ToolInterceptorOptions}.
 * @returns A `(calls) => Node` transform for `agentLoop.interceptToolCalls`.
 *
 * @category ai
 */
export function toolInterceptor(
	opts: ToolInterceptorOptions = {},
): (calls: Node<readonly ToolCall[]>) => Node<readonly ToolCall[]> {
	return (calls) => {
		const enabledNode = opts.enabled != null ? fromAny(opts.enabled) : undefined;
		const predNodes = (opts.allow ?? []).map((p) => fromAny(p));
		const deps = [calls, ...(enabledNode ? [enabledNode] : []), ...predNodes] as const;
		return node<readonly ToolCall[]>(
			deps,
			(batchData, actions, ctx) => {
				// Security gate: only re-evaluate on a FRESH `calls` wave. A
				// re-run triggered by an `enabled`/predicate change with no new
				// tool-call batch must NOT re-filter the stale `prevData[0]`
				// batch — that would replay previously-denied calls into the
				// executor with no LLM in the loop (confused-deputy hole the
				// `enabled` JSDoc explicitly forbids). Settle no-op instead.
				const callsBatch = batchData[0];
				if (callsBatch == null || callsBatch.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}

				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const incoming = (data[0] as readonly ToolCall[] | null | undefined) ?? [];

				let cursor = 1;
				if (enabledNode) {
					const enabled = data[cursor++] as boolean | null | undefined;
					// Deny-when-explicitly-false; null/undefined = pass-through.
					if (enabled === false) {
						actions.down([[RESOLVED]]);
						return;
					}
				}

				const preds = data.slice(cursor) as ReadonlyArray<
					((call: ToolCall) => boolean) | null | undefined
				>;
				const kept = incoming.filter((call) => {
					for (const pred of preds) {
						// Not-yet-settled predicate ≠ deny (matches toolSelector).
						if (pred == null) continue;
						try {
							if (!pred(call)) return false;
						} catch {
							// A throwing policy predicate fails CLOSED — deny this
							// call rather than tearing down the whole tool stream
							// with a terminal ERROR. A security gate must never
							// fail open on a buggy predicate.
							return false;
						}
					}
					return true;
				});

				// Full-deny → clean no-op turn (Q-B). Mirrors `toolCallsRaw`'s
				// own empty-batch RESOLVED gate so `toolExecution`'s "non-empty
				// batch only" contract upstream-of-it stays satisfied.
				if (kept.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				actions.emit(kept);
			},
			{
				name: opts.name ?? "tool-interceptor",
				describeKind: "derived",
				// NON-partial (no `partial: true`) — deliberate. A seeded
				// `enabled`/predicate (with an `initial`) emits on activation,
				// so it is honoured before any tool call flows (the contract
				// callers must follow — see `allow` JSDoc). `partial: true`
				// was tried and REJECTED: it un-gates the node so `calls`
				// races ahead of a slower seeded policy dep on the activation
				// wave and leaks denied calls fail-OPEN. A *never-seeded*
				// (pure SENTINEL) policy has unspecified gating under either
				// setting — callers must seed an `initial`; not relied on.
				// Cross-ref `tool-selector.ts` (same non-partial shape).
				meta: { ...aiMeta("tool_interceptor"), ...factoryTag("toolInterceptor") },
				equals: (a, b) => {
					const la = a as readonly ToolCall[];
					const lb = b as readonly ToolCall[];
					if (la.length !== lb.length) return false;
					for (let i = 0; i < la.length; i++) {
						if (la[i] !== lb[i]) return false;
					}
					return true;
				},
			},
		);
	};
}
