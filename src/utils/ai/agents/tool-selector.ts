import { factoryTag } from "@graphrefly/pure-ts/core/meta.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import { aiMeta } from "../_internal.js";
import type { ToolDefinition } from "../adapters/core/types.js";

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
 * const hasBudget = node([costMeter], (batchData, actions, ctx) => {
 *   const data = batchData.map((batch, i) => batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]);
 *   actions.emit((data[0] as CostMeter).total < BUDGET);
 * }, { describeKind: "derived" });
 * const canDestroy = state(false, { name: "destructive-allowed" });
 * const tools = toolSelector(registry.schemas, [
 *   node([hasBudget], (batchData, actions, ctx) => {
 *     const data = batchData.map((batch, i) => batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]);
 *     actions.emit((t) => !t.meta?.expensive || data[0] === true);
 *   }, { describeKind: "derived" }),
 *   node([canDestroy], (batchData, actions, ctx) => {
 *     const data = batchData.map((batch, i) => batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]);
 *     actions.emit((t) => !t.meta?.destructive || data[0] === true);
 *   }, { describeKind: "derived" }),
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
	return node<readonly ToolDefinition[]>(
		deps,
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const tools = (data[0] as readonly ToolDefinition[] | null | undefined) ?? [];
			const preds = data.slice(1) as ReadonlyArray<
				((t: ToolDefinition) => boolean) | null | undefined
			>;
			actions.emit(
				tools.filter((tool) => {
					for (const pred of preds) {
						// Pass-through when a predicate hasn't settled — callers with
						// async constraints should not have every tool silently dropped
						// on the first emit. Constraints are "deny when false", not
						// "deny when not yet ready".
						if (pred == null) continue;
						if (!pred(tool)) return false;
					}
					return true;
				}),
			);
		},
		{
			name: opts?.name ?? "tool-selector",
			describeKind: "derived",
			meta: { ...aiMeta("tool_selector"), ...factoryTag("toolSelector") },
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
