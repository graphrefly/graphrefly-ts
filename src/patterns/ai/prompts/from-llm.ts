/**
 * `fromLLM` — reactive LLM invocation sugar.
 *
 * @module
 */

import type { Node } from "../../../core/node.js";
import { state } from "../../../core/sugar.js";
import { switchMap } from "../../../extra/operators.js";
import { fromAny, type NodeInput } from "../../../extra/sources.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMResponse,
	ToolDefinition,
} from "../adapters/core/types.js";

export type FromLLMOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	tools?: readonly ToolDefinition[];
	systemPrompt?: string;
};

/**
 * Reactive LLM invocation adapter. Returns a derived node that re-invokes
 * the LLM whenever the messages dep changes.
 *
 * Uses `switchMap` internally — new invocations cancel stale in-flight ones.
 */
export function fromLLM(
	adapter: LLMAdapter,
	messages: NodeInput<readonly ChatMessage[]>,
	opts?: FromLLMOptions,
): Node<LLMResponse | null> {
	const msgsNode = fromAny(messages);
	const result = switchMap(msgsNode, (msgs) => {
		if (!msgs || (msgs as readonly ChatMessage[]).length === 0) {
			return state<LLMResponse | null>(null) as NodeInput<LLMResponse | null>;
		}
		const tools = opts?.tools;
		return adapter.invoke(msgs as readonly ChatMessage[], {
			model: opts?.model,
			temperature: opts?.temperature,
			maxTokens: opts?.maxTokens,
			tools,
			systemPrompt: opts?.systemPrompt,
		}) as NodeInput<LLMResponse | null>;
	});

	return result;
}
