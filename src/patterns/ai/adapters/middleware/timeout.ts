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

	const linkedSignal = (
		parent?: AbortSignal,
	): {
		signal: AbortSignal;
		cancel: () => void;
		/** `true` once our timer fired — distinguishes our-timeout vs external abort. */
		timedOut: () => boolean;
	} => {
		const ac = new AbortController();
		let timerFired = false;
		let onParentAbort: (() => void) | undefined;
		if (parent) {
			if (parent.aborted) ac.abort(parent.reason);
			else {
				onParentAbort = () => ac.abort(parent.reason);
				parent.addEventListener("abort", onParentAbort, { once: true });
			}
		}
		const timer = new ResettableTimer();
		timer.start(ms, () => {
			timerFired = true;
			ac.abort(new LLMTimeoutError(ms));
		});
		return {
			signal: ac.signal,
			cancel: () => {
				timer.cancel();
				if (parent && onParentAbort) parent.removeEventListener("abort", onParentAbort);
			},
			timedOut: () => timerFired,
		};
	};

	/**
	 * When our own timer fired, real `fetch`/SDK adapters reject with
	 * `AbortError`/DOMException regardless of `signal.reason`. We convert
	 * that rejection into {@link LLMTimeoutError} so downstream predicates
	 * (notably {@link defaultShouldRetry}) can distinguish "we hit the
	 * deadline" from "caller aborted us" without relying on the adapter
	 * preserving `signal.reason`.
	 *
	 * External aborts bubble through unchanged so caller-supplied
	 * `invokeOpts.signal` still propagates as an abort.
	 */
	const convertAbortToTimeout = (err: unknown, timedOut: boolean): never => {
		if (!timedOut) throw err;
		if (err instanceof LLMTimeoutError) throw err;
		const e = err as { name?: string; code?: string | number };
		const isAbort =
			e?.name === "AbortError" ||
			(e?.name === "DOMException" && Number(e.code) === 20) /* ABORT_ERR */ ||
			(err as Error)?.message === "aborted";
		if (isAbort) {
			const timeout = new LLMTimeoutError(ms);
			(timeout as Error & { cause?: unknown }).cause = err;
			throw timeout;
		}
		throw err;
	};

	return {
		provider: inner.provider,
		model: inner.model,
		capabilities: inner.capabilities?.bind(inner),

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const { signal, cancel, timedOut } = linkedSignal(invokeOpts?.signal);
			try {
				const resp = (await Promise.resolve(
					inner.invoke(messages, { ...invokeOpts, signal }),
				)) as LLMResponse;
				return resp;
			} catch (err) {
				return convertAbortToTimeout(err, timedOut());
			} finally {
				cancel();
			}
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const { signal, cancel, timedOut } = linkedSignal(invokeOpts?.signal);
			try {
				for await (const d of inner.stream(messages, { ...invokeOpts, signal })) yield d;
			} catch (err) {
				convertAbortToTimeout(err, timedOut());
			} finally {
				cancel();
			}
		},
	};
}
