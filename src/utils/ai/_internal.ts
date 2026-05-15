/**
 * @internal — shared helpers for the AI pattern modules.
 *
 * NOT part of the public API. Consumers reach public symbols through
 * `@graphrefly/graphrefly/patterns/ai` (the barrel).
 *
 * @module
 */

import {
	COMPLETE,
	DATA,
	ERROR,
	type Messages,
	type Node,
	node,
	ResettableTimer,
} from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import { domainMeta } from "../../base/meta/domain-meta.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
} from "./adapters/core/types.js";

export function aiMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("ai", kind, extra);
}

export function isPromiseLike(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

export function isNodeLike(x: unknown): x is Node<unknown> {
	return (
		typeof x === "object" &&
		x !== null &&
		"subscribe" in x &&
		typeof (x as Node<unknown>).subscribe === "function" &&
		"cache" in x
	);
}

export function isAsyncIterableLike(x: unknown): x is AsyncIterable<unknown> {
	return (
		x != null &&
		typeof x === "object" &&
		Symbol.asyncIterator in x &&
		typeof (x as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
	);
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** First settled `DATA` from a `Node` (do not pass plain strings — `fromAny` would iterate chars). */
export function firstDataFromNode(
	resolved: Node<unknown>,
	opts?: { timeoutMs?: number },
): Promise<unknown> {
	if ((resolved as { status?: string }).status === "settled") {
		const immediate = resolved.cache;
		if (immediate !== undefined) {
			return Promise.resolve(immediate);
		}
	}
	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		const timer = new ResettableTimer();
		const unsub = resolved.subscribe((messages) => {
			for (const msg of messages) {
				if (msg[0] === DATA) {
					timer.cancel();
					unsub();
					resolve(msg[1]);
					return;
				}
				if (msg[0] === ERROR) {
					timer.cancel();
					unsub();
					reject(msg[1]);
					return;
				}
				if (msg[0] === COMPLETE) {
					timer.cancel();
					unsub();
					reject(new Error("firstDataFromNode: completed without producing a value"));
					return;
				}
			}
		});
		timer.start(timeoutMs, () => {
			unsub();
			reject(new Error(`firstDataFromNode: timed out after ${timeoutMs}ms`));
		});
	});
}

/** Await Promise-likes, then resolve `Node` / async-iterable inputs via `fromAny` + first `DATA`. */
export async function resolveToolHandlerResult(value: unknown): Promise<unknown> {
	if (isPromiseLike(value)) {
		return resolveToolHandlerResult(await value);
	}
	if (isNodeLike(value)) {
		return firstDataFromNode(value);
	}
	if (isAsyncIterableLike(value)) {
		return firstDataFromNode(fromAny(value as NodeInput<unknown>));
	}
	return value;
}

/** Strip markdown code fences, handling trailing commentary after closing fence. */
export function stripFences(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```[\s\S]*$/);
	return match ? match[1]! : text;
}

/**
 * Bridge-layer failure kind reported to {@link OneShotLlmCallConfig.onFailure}.
 *
 * - `"throw"` — synchronous throw from `adapter.invoke()`.
 * - `"error"` — `[ERROR, value]` message on the bridged Node.
 * - `"complete"` — the bridged Node closed without emitting DATA.
 * - `"onSuccess-threw"` — `onSuccess(resp)` itself threw (uncaught parse /
 *   builder error). Caller's `onFailure` decides the failure-payload shape.
 */
export type OneShotLlmFailureKind = "throw" | "error" | "complete" | "onSuccess-threw";

/** Configuration for {@link _oneShotLlmCall}. */
export interface OneShotLlmCallConfig<T> {
	/**
	 * Build the success payload from the adapter's first DATA message.
	 * MAY throw — the helper catches and routes through `onFailure(kind:
	 * "onSuccess-threw", err)` so callers don't need their own try/catch.
	 */
	onSuccess: (resp: LLMResponse) => T;
	/**
	 * Build a failure payload when the bridge layer reports any of the
	 * {@link OneShotLlmFailureKind} categories. Caller chooses the detail
	 * string format and any error-class metadata.
	 */
	onFailure: (kind: OneShotLlmFailureKind, err: unknown) => T;
	/**
	 * Forwarded to `adapter.invoke(messages, opts)` — `signal` is set
	 * by the helper from the producer's AbortController and CANNOT be
	 * overridden here (cancellation is a hard contract of this helper).
	 */
	invokeOpts?: Omit<LLMInvokeOptions, "signal">;
	/**
	 * Optional parent abort signal (e.g. JobFlow pump's per-claim signal).
	 * When the parent aborts, the helper aborts its inner AbortController —
	 * so `adapter.invoke({ signal })` and `fromAny({ signal })` see the
	 * cascade and cancel in-flight work. Pump-driven harness teardown
	 * (`harness.destroy()`) propagates through this hook (Tier 6.5 2.5b).
	 */
	parentSignal?: AbortSignal;
}

/**
 * Internal — one-shot bridge from `adapter.invoke()` (a `NodeInput<LLMResponse>`)
 * into a producer that emits exactly one DATA + COMPLETE.
 *
 * **Why this exists.** The harness's `defaultLlmExecutor` and
 * `defaultLlmVerifier` (Tier 6.5 C2) both call `adapter.invoke()` once
 * per claimed JobFlow job and need to:
 *  1. Subscribe to the bridged Node, capture the first DATA, parse, emit
 *     a domain payload.
 *  2. Map adapter throws / ERROR / COMPLETE-without-DATA to a domain
 *     failure payload (rather than nack the JobFlow claim).
 *  3. Thread `signal: ac.signal` into BOTH `adapter.invoke()` (via
 *     `LLMInvokeOptions.signal`) and `fromAny()` (covers Node-shaped
 *     invokeResults) so teardown actually aborts in-flight HTTP work.
 *  4. Tear down the inner subscription cleanly when DATA captures or
 *     when the producer is unsubscribed.
 *
 * Pre-extraction this body was duplicated ~80 LOC across the two default
 * bridges; symmetric fixes had to land twice (qa F1 / F2 / F5). This
 * helper centralizes the producer body so future bridge-layer fixes apply
 * once.
 *
 * **Not part of the public API.** Callers in `patterns/ai/_internal.ts`'s
 * import surface (the harness defaults today) use this; user code should
 * use `promptNode` for cross-wave reactive transforms or call
 * `adapter.invoke()` directly.
 */
export function _oneShotLlmCall<T>(
	adapter: LLMAdapter,
	messages: readonly ChatMessage[],
	config: OneShotLlmCallConfig<T>,
): NodeInput<T> {
	return node<T>(
		(_data, actions) => {
			const ac = new AbortController();
			// Link parent signal (e.g. pump per-claim signal) so cascading
			// teardown propagates: parent abort → inner ac.abort → adapter +
			// fromAny cancel.
			const parentSignal = config.parentSignal;
			let unlinkParent: () => void = () => undefined;
			if (parentSignal) {
				if (parentSignal.aborted) {
					ac.abort();
				} else {
					const onParentAbort = (): void => ac.abort();
					parentSignal.addEventListener("abort", onParentAbort, { once: true });
					unlinkParent = () => parentSignal.removeEventListener("abort", onParentAbort);
				}
			}
			let captured = false;
			let unsub: (() => void) | null = null;
			const emitOnce = (value: T): void => {
				if (captured) return;
				captured = true;
				actions.down([[DATA, value], [COMPLETE]] satisfies Messages);
				unsub?.();
				unsub = null;
			};
			let invokeResult: NodeInput<LLMResponse>;
			try {
				invokeResult = adapter.invoke(messages, { ...config.invokeOpts, signal: ac.signal });
			} catch (err) {
				emitOnce(config.onFailure("throw", err));
				return () => {
					unlinkParent();
					ac.abort();
				};
			}
			const callNode = fromAny<LLMResponse>(invokeResult, { signal: ac.signal });
			unsub = callNode.subscribe((batch) => {
				for (const m of batch) {
					if (captured) return;
					if (m[0] === DATA) {
						try {
							emitOnce(config.onSuccess(m[1] as LLMResponse));
						} catch (err) {
							emitOnce(config.onFailure("onSuccess-threw", err));
						}
						return;
					}
					if (m[0] === ERROR) {
						emitOnce(config.onFailure("error", m[1]));
						return;
					}
					if (m[0] === COMPLETE) {
						// COMPLETE without prior DATA — without this arm the JobFlow
						// pump's claim would stall (qa F1 regression). Helper handles
						// for ALL callers; defaults can't regress.
						emitOnce(config.onFailure("complete", undefined));
						return;
					}
				}
			});
			// Sync DATA delivery (cached state / `fromAny` over a sync value):
			// the callback ran reentrantly before `unsub` was assigned, so the
			// `unsub?.()` call inside `emitOnce` was a no-op. Drop the upstream
			// subscription now that we have the handle.
			if (captured && unsub) {
				unsub();
				unsub = null;
			}
			return () => {
				unlinkParent();
				ac.abort();
				unsub?.();
				unsub = null;
			};
		},
		{ describeKind: "producer" },
	);
}
