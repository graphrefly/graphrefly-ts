/**
 * `systemPromptBuilder` — assembles a reactive system prompt from sections.
 *
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived, state } from "../../../core/sugar.js";
import { fromAny, keepalive, type NodeInput } from "../../../extra/sources.js";
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
