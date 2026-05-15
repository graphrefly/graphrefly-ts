/**
 * `withBreaker` — circuit-breaker middleware for LLM adapters.
 *
 * Reuses the library's existing `circuitBreaker` primitive from
 * `extra/resilience.ts`. When the breaker is open, calls throw
 * `CircuitOpenError` instead of hitting the provider.
 */

import type { LLMAdapter, LLMResponse, StreamDelta } from "@graphrefly/pure-ts/core/types.js";
import { fromAny } from "@graphrefly/pure-ts/extra";
import { firstValueFrom } from "../../../../base/sources/settled.js";
import {
	type CircuitBreaker,
	type CircuitBreakerOptions,
	CircuitOpenError,
	circuitBreaker,
} from "../../../../utils/resilience/index.js";
import { adapterWrapper, withLayer } from "../_internal/wrappers.js";

export interface WithBreakerOptions extends CircuitBreakerOptions {
	/**
	 * Optional external breaker — pass a shared instance to wire the same
	 * breaker across multiple adapters (e.g. all tiers of a `cascadingLlmAdapter`).
	 */
	breaker?: CircuitBreaker;
}

export function withBreaker(
	inner: LLMAdapter,
	opts: WithBreakerOptions = {},
): { adapter: LLMAdapter; breaker: CircuitBreaker } {
	const breaker = opts.breaker ?? circuitBreaker(opts);

	const adapter: LLMAdapter = adapterWrapper(inner, {
		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			if (!breaker.canExecute()) throw new CircuitOpenError();
			try {
				const resp = await firstValueFrom(fromAny(inner.invoke(messages, invokeOpts)));
				breaker.recordSuccess();
				return resp;
			} catch (err) {
				breaker.recordFailure(err);
				throw err;
			}
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			if (!breaker.canExecute()) throw new CircuitOpenError();
			try {
				for await (const d of inner.stream(messages, invokeOpts)) yield d;
				breaker.recordSuccess();
			} catch (err) {
				breaker.recordFailure(err);
				throw err;
			}
		},
	});
	withLayer(adapter, "withBreaker", inner);

	return { adapter, breaker };
}

export { CircuitOpenError };
