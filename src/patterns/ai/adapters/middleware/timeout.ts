/**
 * `withTimeout` — cancel `invoke()` / `stream()` after `ms` elapse.
 *
 * Wires a child AbortSignal so provider adapters can honor the cancellation
 * (all shipped adapters forward `signal` through to their fetch / SDK call).
 *
 * Uses `ResettableTimer` rather than raw `setTimeout` — same pattern as
 * `extra/resilience.ts` (spec §5.10 escape hatch documented on the class).
 */

import { ResettableTimer } from "../../../../extra/timer.js";
import type { LLMAdapter, LLMResponse, StreamDelta } from "../core/types.js";

export class LLMTimeoutError extends Error {
	override name = "LLMTimeoutError";
	constructor(public readonly ms: number) {
		super(`LLM call timed out after ${ms}ms`);
	}
}

export function withTimeout(inner: LLMAdapter, ms: number): LLMAdapter {
	if (ms <= 0) throw new RangeError("withTimeout: ms must be > 0");

	const linkedSignal = (parent?: AbortSignal): { signal: AbortSignal; cancel: () => void } => {
		const ac = new AbortController();
		let onParentAbort: (() => void) | undefined;
		if (parent) {
			if (parent.aborted) ac.abort(parent.reason);
			else {
				onParentAbort = () => ac.abort(parent.reason);
				parent.addEventListener("abort", onParentAbort, { once: true });
			}
		}
		const timer = new ResettableTimer();
		timer.start(ms, () => ac.abort(new LLMTimeoutError(ms)));
		return {
			signal: ac.signal,
			cancel: () => {
				timer.cancel();
				if (parent && onParentAbort) parent.removeEventListener("abort", onParentAbort);
			},
		};
	};

	return {
		provider: inner.provider,
		model: inner.model,
		capabilities: inner.capabilities?.bind(inner),

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const { signal, cancel } = linkedSignal(invokeOpts?.signal);
			try {
				const resp = (await Promise.resolve(
					inner.invoke(messages, { ...invokeOpts, signal }),
				)) as LLMResponse;
				return resp;
			} finally {
				cancel();
			}
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const { signal, cancel } = linkedSignal(invokeOpts?.signal);
			try {
				for await (const d of inner.stream(messages, { ...invokeOpts, signal })) yield d;
			} finally {
				cancel();
			}
		},
	};
}
