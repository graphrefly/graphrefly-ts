/**
 * ChromeNanoAdapter — Chrome Built-in AI Prompt API.
 *
 * Uses `navigator.ai.languageModel` (Chrome 131+, origin trial / flag gated).
 * Zero download, instant startup — but limited capability (no tool use on
 * most versions, no rich system prompts on some).
 *
 * **Stream mode:** Chrome AI has historically switched between emitting
 * accumulated (each chunk is the full text so far) and delta (each chunk is
 * only the new tokens) streams across versions. Default `streamMode: "accumulated"`
 * matches current behavior; pass `"delta"` if you've verified your browser
 * emits pure deltas.
 */

import { monotonicNs } from "@graphrefly/pure-ts/core/clock.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
} from "../../core/types.js";

export interface ChromeNanoAdapterOptions {
	/** Override the navigator object (for tests). */
	navigatorOverride?: Navigator;
	/** Initial system prompt for the session (Chrome AI supports it in 131+). */
	systemPrompt?: string;
	/** Temperature (0..1). */
	temperature?: number;
	/** Top-K sampling (Chrome AI only). */
	topK?: number;
	/**
	 * Stream chunk shape. `"accumulated"` (default) — each chunk contains the
	 * full cumulative text; adapter computes deltas by string diffing.
	 * `"delta"` — each chunk already contains only the new tokens; adapter
	 * forwards directly.
	 */
	streamMode?: "accumulated" | "delta";
}

interface ChromeAiSession {
	prompt(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
	promptStreaming(input: string, opts?: { signal?: AbortSignal }): AsyncIterable<string>;
	destroy?(): void;
}

interface ChromeAi {
	languageModel?: {
		create(params?: {
			systemPrompt?: string;
			temperature?: number;
			topK?: number;
			signal?: AbortSignal;
		}): Promise<ChromeAiSession>;
		capabilities?(): Promise<{ available?: "readily" | "after-download" | "no" }>;
	};
}

function makeAbortError(): Error {
	const err = new Error("aborted") as Error & { name: string };
	err.name = "AbortError";
	return err;
}

export function chromeNanoAdapter(opts: ChromeNanoAdapterOptions = {}): LLMAdapter {
	const streamMode = opts.streamMode ?? "accumulated";
	const nav = opts.navigatorOverride ?? (globalThis as { navigator?: Navigator }).navigator;
	const getAi = (): ChromeAi => {
		const ai = (nav as unknown as { ai?: ChromeAi })?.ai;
		if (!ai?.languageModel)
			throw new Error(
				"chromeNanoAdapter: Chrome AI languageModel not available (requires Chrome 131+ with flag/OT).",
			);
		return ai;
	};

	const session = async (invokeOpts: LLMInvokeOptions | undefined): Promise<ChromeAiSession> => {
		const ai = getAi();
		return ai.languageModel!.create({
			systemPrompt: invokeOpts?.systemPrompt ?? opts.systemPrompt,
			temperature: invokeOpts?.temperature ?? opts.temperature,
			topK: opts.topK,
			signal: invokeOpts?.signal,
		});
	};

	const flatten = (messages: readonly ChatMessage[]): string => {
		// Chrome AI has no multi-message chat API; flatten to a single prompt
		// with role-tagged sections. Assistant history is preserved as context.
		const parts: string[] = [];
		for (const m of messages) {
			if (m.role === "system") continue; // already passed via systemPrompt
			parts.push(`${m.role}: ${m.content}`);
		}
		return parts.join("\n\n");
	};

	// Chrome AI exposes no token count; we leave usage zeroed.
	const zeroUsage = (): TokenUsage => ({ input: { regular: 0 }, output: { regular: 0 } });

	return {
		provider: "chrome-nano",
		model: "chrome-nano",

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const sess = await session(invokeOpts);
			try {
				const prompt = flatten(messages);
				const start = monotonicNs();
				const content = await sess.prompt(prompt, { signal: invokeOpts?.signal });
				const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
				return {
					content,
					usage: zeroUsage(),
					finishReason: "stop",
					latencyMs,
					model: "chrome-nano",
					provider: "chrome-nano",
				};
			} finally {
				sess.destroy?.();
			}
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const sess = await session(invokeOpts);
			try {
				const prompt = flatten(messages);
				if (streamMode === "delta") {
					for await (const chunk of sess.promptStreaming(prompt, {
						signal: invokeOpts?.signal,
					})) {
						if (invokeOpts?.signal?.aborted) throw makeAbortError();
						if (chunk) yield { type: "token", delta: chunk };
					}
				} else {
					let last = "";
					for await (const chunk of sess.promptStreaming(prompt, {
						signal: invokeOpts?.signal,
					})) {
						if (invokeOpts?.signal?.aborted) throw makeAbortError();
						// Accumulated mode: compute the delta against the last cumulative value.
						const delta = chunk.startsWith(last) ? chunk.slice(last.length) : chunk;
						last = chunk;
						if (delta) yield { type: "token", delta };
					}
				}
				yield { type: "usage", usage: zeroUsage() };
				yield { type: "finish", reason: "stop" };
			} finally {
				sess.destroy?.();
			}
		},
	};
}
