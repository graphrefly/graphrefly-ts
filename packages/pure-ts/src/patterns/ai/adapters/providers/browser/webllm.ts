/**
 * WebLLMAdapter — browser-only, WebGPU-based inference via `@mlc-ai/web-llm`.
 *
 * Dynamic import + WebGPU feature detection. No server dependency. Typical
 * use: fallback tier in `cascadingLlmAdapter` after a BYOK cloud adapter.
 */

import { monotonicNs } from "../../../../../core/clock.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
} from "../../core/types.js";

export interface WebLLMAdapterOptions {
	model: string;
	/**
	 * User-provided engine instance (from `CreateMLCEngine(...)`). If omitted,
	 * the adapter lazy-creates one on first call via dynamic import.
	 */
	engine?: WebLLMEngineLike;
	/** Pass-through to `CreateMLCEngine`. */
	initProgressCallback?: (progress: unknown) => void;
	/** Navigator override (for tests). */
	navigatorOverride?: Navigator;
}

export interface WebLLMEngineLike {
	chat: {
		completions: {
			create(
				params: Record<string, unknown>,
				opts?: { signal?: AbortSignal },
			): Promise<{
				choices: ReadonlyArray<{ message?: { content?: string }; finish_reason?: string }>;
				usage?: { prompt_tokens?: number; completion_tokens?: number };
			}>;
		};
	};
}

function makeAbortError(): Error {
	const err = new Error("aborted") as Error & { name: string };
	err.name = "AbortError";
	return err;
}

export function webllmAdapter(opts: WebLLMAdapterOptions): LLMAdapter {
	let engine = opts.engine;

	const ensureEngine = async (): Promise<WebLLMEngineLike> => {
		if (engine) return engine;
		if (!isWebGpuAvailable(opts.navigatorOverride))
			throw new Error("webllmAdapter: WebGPU not available in this environment");
		const mod = await import("@mlc-ai/web-llm" as string).catch(() => {
			throw new Error(
				"webllmAdapter: @mlc-ai/web-llm not installed. Add it as a peer dependency or pass opts.engine.",
			);
		});
		const factory = (
			mod as { CreateMLCEngine?: (m: string, o?: unknown) => Promise<WebLLMEngineLike> }
		).CreateMLCEngine;
		if (!factory) throw new Error("webllmAdapter: @mlc-ai/web-llm missing CreateMLCEngine export");
		engine = await factory(opts.model, { initProgressCallback: opts.initProgressCallback });
		return engine;
	};

	const flatten = (
		messages: readonly ChatMessage[],
		invokeOpts: LLMInvokeOptions | undefined,
	): Array<{ role: string; content: string }> => {
		const flat: Array<{ role: string; content: string }> = [];
		if (invokeOpts?.systemPrompt) flat.push({ role: "system", content: invokeOpts.systemPrompt });
		for (const m of messages)
			flat.push({ role: m.role === "tool" ? "user" : m.role, content: m.content });
		return flat;
	};

	const mapUsage = (
		u: { prompt_tokens?: number; completion_tokens?: number } | undefined,
	): TokenUsage => ({
		input: { regular: u?.prompt_tokens ?? 0 },
		output: { regular: u?.completion_tokens ?? 0 },
		raw: u,
	});

	return {
		provider: "webllm",
		model: opts.model,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const eng = await ensureEngine();
			const start = monotonicNs();
			const resp = await eng.chat.completions.create(
				{
					model: invokeOpts?.model ?? opts.model,
					messages: flatten(messages, invokeOpts),
					max_tokens: invokeOpts?.maxTokens,
					temperature: invokeOpts?.temperature,
				},
				{ signal: invokeOpts?.signal },
			);
			const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
			const choice = resp.choices?.[0];
			return {
				content: choice?.message?.content ?? "",
				usage: mapUsage(resp.usage),
				finishReason: choice?.finish_reason,
				latencyMs,
				model: opts.model,
				provider: "webllm",
			};
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const eng = await ensureEngine();
			const asyncIter = (await eng.chat.completions.create(
				{
					model: invokeOpts?.model ?? opts.model,
					messages: flatten(messages, invokeOpts),
					max_tokens: invokeOpts?.maxTokens,
					temperature: invokeOpts?.temperature,
					stream: true,
				},
				{ signal: invokeOpts?.signal },
			)) as unknown as AsyncIterable<{
				choices?: ReadonlyArray<{ delta?: { content?: string }; finish_reason?: string }>;
				usage?: { prompt_tokens?: number; completion_tokens?: number };
			}>;

			let finalUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
			let finishReason: string | undefined;
			for await (const chunk of asyncIter) {
				if (invokeOpts?.signal?.aborted) throw makeAbortError();
				const c = chunk.choices?.[0];
				if (c?.delta?.content) yield { type: "token", delta: c.delta.content };
				if (c?.finish_reason) finishReason = c.finish_reason;
				if (chunk.usage) finalUsage = chunk.usage;
			}
			if (finalUsage) yield { type: "usage", usage: mapUsage(finalUsage) };
			yield { type: "finish", reason: finishReason ?? "stop" };
		},
	};
}

function isWebGpuAvailable(navOverride?: Navigator): boolean {
	const nav = navOverride ?? (globalThis as { navigator?: Navigator }).navigator;
	return !!(nav && "gpu" in nav && (nav as unknown as { gpu?: unknown }).gpu);
}
