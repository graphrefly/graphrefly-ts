import type { Node } from "../../../core/node.js";
import { derived } from "../../../core/sugar.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
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
