/**
 * `promptNode` — universal LLM transform as a reactive derived node.
 *
 * @module
 */

import type { Node } from "../../../core/node.js";
import { derived, state } from "../../../core/sugar.js";
import { switchMap } from "../../../extra/operators.js";
import type { NodeInput } from "../../../extra/sources.js";
import { aiMeta, stripFences } from "../_internal.js";
import type { ChatMessage, LLMAdapter, LLMResponse } from "../adapters/core/types.js";

export type PromptNodeOptions = {
	name?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Output format — `"json"` attempts JSON.parse on the response. Default: `"text"`. */
	format?: "text" | "json";
	/** Number of retries on transient errors. Default: 0. */
	retries?: number;
	/** Cache LLM responses for identical inputs. Default: false. */
	cache?: boolean;
	systemPrompt?: string;
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

/**
 * Universal LLM transform: wraps a prompt template + model adapter into a reactive derived node.
 * Re-invokes the LLM whenever any dep changes. Suitable for triage, QA, hypothesis, parity, etc.
 *
 * @param adapter - LLM adapter (provider-agnostic).
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
	const retries = opts?.retries ?? 0;
	const useCache = opts?.cache ?? false;
	const cache = useCache ? new Map<string, T>() : null;

	// Seed with `initial: []` so `switchMap` below fires with `[]` during the
	// initial activation pass and emits null (composition guide §8 — promptNode
	// gates on nullish deps). Dep-level null guarding is done inside the fn.
	const messagesNode = derived<readonly ChatMessage[]>(
		deps as Node<unknown>[],
		(values) => {
			// Dep-level null guard (composition guide §8): if any dep is
			// nullish, return empty messages → switchMap emits null.
			if (values.some((v) => v == null)) return [];
			const text = typeof prompt === "string" ? prompt : prompt(...values);
			if (!text) return [];
			const msgs: ChatMessage[] = [];
			if (opts?.systemPrompt) msgs.push({ role: "system", content: opts.systemPrompt });
			msgs.push({ role: "user", content: text });
			return msgs;
		},
		{
			name: opts?.name ? `${opts.name}::messages` : "prompt_node::messages",
			meta: aiMeta("prompt_node"),
			initial: [] as readonly ChatMessage[],
		},
	);

	const result = switchMap<readonly ChatMessage[], T | null>(messagesNode, (msgs) => {
		if (!msgs || msgs.length === 0) {
			return state<T | null>(null) as NodeInput<T | null>;
		}

		const cacheKey = useCache ? JSON.stringify(msgs.map((m) => [m.role, m.content])) : "";
		if (cache?.has(cacheKey)) {
			return state<T | null>(cache.get(cacheKey)!) as NodeInput<T | null>;
		}

		async function attempt(remaining: number): Promise<T | null> {
			try {
				const resp = await new Promise<LLMResponse>((resolve, reject) => {
					const input = adapter.invoke(msgs, {
						model: opts?.model,
						temperature: opts?.temperature,
						maxTokens: opts?.maxTokens,
						systemPrompt: opts?.systemPrompt,
					});
					// NodeInput may be a Node, Promise, or raw value
					if (input && typeof (input as PromiseLike<LLMResponse>).then === "function") {
						(input as PromiseLike<LLMResponse>).then(resolve, reject);
					} else if (input && typeof (input as Node<LLMResponse>).subscribe === "function") {
						resolve((input as Node<LLMResponse>).cache as LLMResponse);
					} else {
						resolve(input as LLMResponse);
					}
				});

				const content = extractContent(resp);
				let parsed: T;
				if (format === "json") {
					parsed = JSON.parse(stripFences(content)) as T;
				} else {
					parsed = content as unknown as T;
				}
				cache?.set(cacheKey, parsed);
				return parsed;
			} catch (err) {
				if (remaining > 0) return attempt(remaining - 1);
				throw err;
			}
		}

		return attempt(retries) as NodeInput<T | null>;
	});

	return result;
}
