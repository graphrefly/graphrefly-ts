/**
 * DryRunAdapter — zero-cost mock provider.
 *
 * Returns a deterministic fake response (plus a configurable hook for
 * customization). Useful for: pipeline smoke tests, CI without API keys,
 * local development, and as the leaf of a `cascadingLlmAdapter` when every
 * real tier fails.
 *
 * The library ships a minimal implementation only — richer scenario-
 * scripted mocks (per-stage responses, call recording) belong at the test
 * harness layer, not in the shipped library.
 *
 * Uses `ResettableTimer` for simulated latency (spec §5.10 escape hatch
 * documented on the class), and throws an `AbortError`-named Error on
 * abort so retry/timeout middleware can classify it.
 */

import { ResettableTimer } from "@graphrefly/pure-ts/core";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
} from "../core/types.js";

export interface DryRunAdapterOptions {
	provider?: string;
	model?: string;
	/** Generate the fake response. Defaults to echoing the last user message. */
	respond?: (messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => string;
	/**
	 * Generate a fake usage object. Defaults to a simple character-count
	 * heuristic (`input = sum(messages) / 4`, `output = content / 4`).
	 */
	usage?: (messages: readonly ChatMessage[], content: string) => TokenUsage;
	/** Simulated latency in milliseconds (applied to both invoke and stream). */
	latencyMs?: number;
	/** Stream chunk size in characters. Default 16. */
	streamChunkSize?: number;
}

function makeAbortError(): Error {
	const err = new Error("aborted") as Error & { name: string };
	err.name = "AbortError";
	return err;
}

/**
 * Abort-aware sleep using `ResettableTimer`. Spec §5.10 escape hatch.
 * No-op if `ms <= 0`; rejects with `AbortError` if the signal aborts.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted) return Promise.reject(makeAbortError());
	return new Promise((resolve, reject) => {
		const timer = new ResettableTimer();
		let onAbort: (() => void) | undefined;
		const cleanup = (): void => {
			timer.cancel();
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
		};
		timer.start(ms, () => {
			cleanup();
			resolve();
		});
		if (signal) {
			onAbort = (): void => {
				cleanup();
				reject(makeAbortError());
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

/**
 * Create a DryRun adapter.
 *
 * @example
 * ```ts
 * const adapter = dryRunAdapter({ respond: (msgs) => "hello from dry-run" });
 * const resp = await Promise.resolve(adapter.invoke([{ role: "user", content: "hi" }]));
 * ```
 */
export function dryRunAdapter(opts: DryRunAdapterOptions = {}): LLMAdapter {
	const provider = opts.provider ?? "dry-run";
	const model = opts.model ?? "dry-run-v1";
	const latencyMs = opts.latencyMs ?? 0;
	const streamChunkSize = Math.max(1, opts.streamChunkSize ?? 16);

	const respondFn =
		opts.respond ??
		((msgs: readonly ChatMessage[]): string => {
			const lastUser = [...msgs].reverse().find((m) => m.role === "user");
			return lastUser ? `echo: ${lastUser.content}` : "dry-run: no user message";
		});

	const usageFn =
		opts.usage ??
		((msgs: readonly ChatMessage[], content: string): TokenUsage => {
			const totalInput = msgs.reduce((s, m) => s + m.content.length, 0);
			return {
				input: { regular: Math.ceil(totalInput / 4) },
				output: { regular: Math.ceil(content.length / 4) },
			};
		});

	return {
		provider,
		model,
		// QA D3 (Phase 13.6.B): adapter honors `invokeOpts.signal` —
		// `sleep(latencyMs, signal)` aborts mid-latency, the post-sleep
		// guard rejects with `makeAbortError()`. Suppresses the
		// budget-gate wire-time warning.
		abortCapable: true,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			await sleep(latencyMs, invokeOpts?.signal);
			if (invokeOpts?.signal?.aborted) throw makeAbortError();
			const content = respondFn(messages, invokeOpts);
			const usage = usageFn(messages, content);
			return {
				content,
				usage,
				finishReason: "stop",
				model: invokeOpts?.model ?? model,
				provider,
				tier: invokeOpts?.tier,
				metadata: { dryRun: true },
			};
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const content = respondFn(messages, invokeOpts);
			const usage = usageFn(messages, content);
			const chunkCount = Math.ceil(content.length / streamChunkSize) || 1;
			const perChunkMs = latencyMs > 0 ? latencyMs / chunkCount : 0;
			for (let i = 0; i < content.length; i += streamChunkSize) {
				if (invokeOpts?.signal?.aborted) throw makeAbortError();
				await sleep(perChunkMs, invokeOpts?.signal);
				yield { type: "token", delta: content.slice(i, i + streamChunkSize) };
			}
			yield { type: "usage", usage };
			yield { type: "finish", reason: "stop" };
		},
	};
}
