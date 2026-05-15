/**
 * `withRateLimiter` — adapter middleware bridging to the reactive
 * `adaptiveRateLimiter` primitive.
 *
 * - Consumes live `rpm`/`tpm` caps as reactive `NodeInput<number>` so
 *   callers can retune at runtime (e.g. from a `ModelLimits.rpm` node).
 * - Adapts to provider 429 responses via `http429Parser` fed into the
 *   limiter's `adaptation` signal.
 * - `costFn` estimates token cost pre-call (e.g. char-based approximation);
 *   the post-call actual usage is fed back via `limiter.recordUsage()`.
 */

import { emptyUsage, sumInputTokens, sumOutputTokens } from "@graphrefly/pure-ts/core/types.js";
import type { NodeInput } from "@graphrefly/pure-ts/extra";
import { firstValueFrom, fromAny } from "@graphrefly/pure-ts/extra";
import {
	type AdaptiveRateLimiterBundle,
	adaptiveRateLimiter,
	type RateLimitSignal,
} from "../../../../extra/adaptive-rate-limiter.js";
import { adapterWrapper, withLayer } from "../_internal/wrappers.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
} from "../core/types.js";
import { parseRateLimitFromError } from "./http429-parser.js";

export interface WithRateLimiterOptions {
	/** Live rpm cap (defaults to `Infinity`). */
	rpm?: NodeInput<number>;
	/** Live tpm cap (defaults to `Infinity`). */
	tpm?: NodeInput<number>;
	/**
	 * Pre-call token-cost estimate. Default: 0 (only rpm gates). Override with
	 * e.g. a char-based heuristic:
	 * `(msgs) => Math.ceil(msgs.reduce((s, m) => s + m.content.length, 0) / 4)`.
	 */
	costFn?: (messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => number;
	/**
	 * Manual adaptation signal source. Defaults to a signal derived from
	 * provider errors via `parseRateLimitFromError` — users can supply a
	 * custom signal chain if they route errors elsewhere.
	 */
	adaptation?: NodeInput<RateLimitSignal>;
	burstMultiplier?: number;
	name?: string;
	/**
	 * Share an existing {@link AdaptiveRateLimiterBundle} across multiple
	 * adapter wraps. When provided, `withRateLimiter` reuses this bundle
	 * instead of constructing a new one — useful when the RPM/TPM cap is
	 * logically per-provider but the caller wants to harden multiple adapters
	 * (e.g. primary + fallback of the same vendor) against the shared cap.
	 *
	 * When `limiter` is set, `rpm` / `tpm` / `adaptation` / `burstMultiplier`
	 * / `name` are ignored (the supplied bundle owns those). `costFn` is still
	 * used per-wrap — each wrap supplies its own cost estimator.
	 */
	limiter?: AdaptiveRateLimiterBundle;
}

/**
 * Wrap an adapter with adaptive rate limiting. Returns `{adapter, limiter}`
 * so callers can subscribe to limiter internals (rpmAvailable, pending, etc.)
 * for dashboards.
 */
export function withRateLimiter(
	inner: LLMAdapter,
	opts: WithRateLimiterOptions = {},
): { adapter: LLMAdapter; limiter: AdaptiveRateLimiterBundle } {
	const limiter =
		opts.limiter ??
		adaptiveRateLimiter({
			name: opts.name ?? "rateLimiter",
			rpm: opts.rpm,
			tpm: opts.tpm,
			adaptation: opts.adaptation,
			burstMultiplier: opts.burstMultiplier,
		});

	const estimateCost = (
		messages: readonly ChatMessage[],
		invokeOpts: LLMInvokeOptions | undefined,
	): number => {
		if (opts.costFn) return opts.costFn(messages, invokeOpts);
		return 0;
	};

	const handleError = (err: unknown): void => {
		const sig = parseRateLimitFromError(err);
		if (sig) limiter.recordSignal(sig);
	};

	const wrap: LLMAdapter = adapterWrapper(inner, {
		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const tokenCost = estimateCost(messages, invokeOpts);
			await limiter.acquire({ requestCost: 1, tokenCost, signal: invokeOpts?.signal });
			try {
				const resp = await firstValueFrom(fromAny(inner.invoke(messages, invokeOpts)));
				const usage = resp.usage ?? emptyUsage();
				const actual = sumInputTokens(usage) + sumOutputTokens(usage);
				const delta = actual - tokenCost;
				if (delta > 0) limiter.recordUsage(delta);
				return resp;
			} catch (err) {
				handleError(err);
				throw err;
			}
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const tokenCost = estimateCost(messages, invokeOpts);
			await limiter.acquire({ requestCost: 1, tokenCost, signal: invokeOpts?.signal });
			try {
				let finalTokens = 0;
				for await (const delta of inner.stream(messages, invokeOpts)) {
					if (delta.type === "usage") {
						finalTokens = sumInputTokens(delta.usage) + sumOutputTokens(delta.usage);
					}
					yield delta;
				}
				const d = finalTokens - tokenCost;
				if (d > 0) limiter.recordUsage(d);
			} catch (err) {
				handleError(err);
				throw err;
			}
		},
	});
	withLayer(wrap, "withRateLimiter", inner);

	return { adapter: wrap, limiter };
}
