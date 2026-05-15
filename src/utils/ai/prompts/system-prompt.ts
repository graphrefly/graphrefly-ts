/**
 * `systemPromptBuilder` — assembles a reactive system prompt from sections.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core/node.js";

import { fromAny, keepalive, type NodeInput } from "@graphrefly/pure-ts/extra";
import { aiMeta } from "../_internal.js";

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
	const sectionNodes = sections.map((s) =>
		typeof s === "string" ? node([], { initial: s }) : fromAny(s),
	);
	const prompt = node(
		sectionNodes,
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			actions.emit((data as string[]).filter((v) => v != null && v !== "").join(separator));
		},
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
