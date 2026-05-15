/**
 * `cascadingLlmAdapter` — N-tier fallback over any mix of LLM adapters.
 *
 * Same structural pattern as `cascadingCache` and `Graph.attachSnapshotStorage`:
 * ordered list, first-success wins, per-tier breaker optional, filter gates
 * per request. Semantics:
 *
 * - `invoke()`: try tier 0 first. On error (or breaker-open), fall through
 *   to tier 1, 2, ... until one succeeds or all fail.
 * - `stream()`: tries to start the stream on tier 0; once tokens begin, it
 *   commits — failures in mid-stream surface rather than re-starting on the
 *   next tier (would double-bill and confuse consumers). **State-machine
 *   consumers (usage accounting, UI accumulators) must handle errors in a
 *   catch block — no synthetic `{type: "finish"}` is emitted after a thrown
 *   stream error.**
 * - `filter`: skips a tier for requests that use features it doesn't
 *   support (e.g., Chrome Nano can't do tool use).
 * - `breaker`: per-tier circuit; when open, cascade treats the tier as
 *   unavailable and moves on immediately.
 *
 * On exhaustion, throws `AllTiersExhaustedError` with separate `skipped` and
 * `failed` collections so consumers can distinguish "no tier applicable"
 * from "all tiers failed".
 */

import { fromAny } from "@graphrefly/pure-ts/extra";
import { firstValueFrom } from "../../../../base/sources/settled.js";
import {
	type CircuitBreaker,
	type CircuitBreakerOptions,
	circuitBreaker,
} from "../../../../utils/resilience/index.js";
import { withLayer } from "../_internal/wrappers.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
} from "../core/types.js";

export interface AdapterTier {
	name: string;
	adapter: LLMAdapter;
	/** Per-tier circuit breaker. If omitted, no breaker on this tier. */
	breaker?: CircuitBreakerOptions | CircuitBreaker;
	/** Skip this tier when the request doesn't fit (e.g. Chrome Nano + tools). */
	filter?: (messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => boolean;
}

export interface CascadeExhaustionReport {
	/** Tiers that never ran (filter returned false, or breaker was open). */
	readonly skipped: ReadonlyArray<{ name: string; reason: "filter" | "breaker" }>;
	/** Tiers that ran and threw. */
	readonly failed: ReadonlyMap<string, unknown>;
}

export interface CascadingLlmAdapterOptions {
	onFallback?: (from: string, to: string, error: unknown) => void;
	onExhausted?: (report: CascadeExhaustionReport) => void;
	/** Whether to attempt stream retry on subsequent tiers before first chunk. Default true. */
	streamRetryBeforeFirstChunk?: boolean;
}

interface ResolvedTier {
	name: string;
	adapter: LLMAdapter;
	breaker?: CircuitBreaker;
	filter?: (messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => boolean;
}

export class AllTiersExhaustedError extends Error {
	override name = "AllTiersExhaustedError";
	readonly skipped: ReadonlyArray<{ name: string; reason: "filter" | "breaker" }>;
	readonly failed: ReadonlyMap<string, unknown>;
	constructor(report: CascadeExhaustionReport) {
		const parts: string[] = [];
		if (report.failed.size > 0) parts.push(`failed=[${[...report.failed.keys()].join(",")}]`);
		if (report.skipped.length > 0) {
			parts.push(`skipped=[${report.skipped.map((s) => `${s.name}(${s.reason})`).join(",")}]`);
		}
		super(`All LLM adapter tiers exhausted: ${parts.join(" ")}`);
		this.skipped = report.skipped;
		this.failed = report.failed;
	}
}

export function cascadingLlmAdapter(
	tiers: readonly AdapterTier[],
	opts: CascadingLlmAdapterOptions = {},
): LLMAdapter {
	if (tiers.length === 0) throw new RangeError("cascadingLlmAdapter: tiers must be non-empty");

	const resolved: ResolvedTier[] = tiers.map((t) => ({
		name: t.name,
		adapter: t.adapter,
		filter: t.filter,
		breaker: t.breaker
			? "canExecute" in t.breaker
				? (t.breaker as CircuitBreaker)
				: circuitBreaker(t.breaker as CircuitBreakerOptions)
			: undefined,
	}));

	const streamRetryBeforeFirstChunk = opts.streamRetryBeforeFirstChunk ?? true;

	const cascade: LLMAdapter = {
		provider: "cascading",
		model: undefined,

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const skipped: Array<{ name: string; reason: "filter" | "breaker" }> = [];
			const failed = new Map<string, unknown>();
			for (let i = 0; i < resolved.length; i++) {
				const t = resolved[i];
				if (t.filter && !t.filter(messages, invokeOpts)) {
					skipped.push({ name: t.name, reason: "filter" });
					continue;
				}
				if (t.breaker && !t.breaker.canExecute()) {
					skipped.push({ name: t.name, reason: "breaker" });
					continue;
				}
				try {
					const resp = await firstValueFrom(fromAny(t.adapter.invoke(messages, invokeOpts)));
					t.breaker?.recordSuccess();
					return { ...resp, metadata: { ...(resp.metadata ?? {}), tier: t.name } };
				} catch (err) {
					failed.set(t.name, err);
					t.breaker?.recordFailure(err);
					const next = resolved[i + 1];
					if (next) opts.onFallback?.(t.name, next.name, err);
				}
			}
			const report: CascadeExhaustionReport = { skipped, failed };
			opts.onExhausted?.(report);
			throw new AllTiersExhaustedError(report);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const skipped: Array<{ name: string; reason: "filter" | "breaker" }> = [];
			const failed = new Map<string, unknown>();
			for (let i = 0; i < resolved.length; i++) {
				const t = resolved[i];
				if (t.filter && !t.filter(messages, invokeOpts)) {
					skipped.push({ name: t.name, reason: "filter" });
					continue;
				}
				if (t.breaker && !t.breaker.canExecute()) {
					skipped.push({ name: t.name, reason: "breaker" });
					continue;
				}
				let yieldedAny = false;
				try {
					for await (const delta of t.adapter.stream(messages, invokeOpts)) {
						yieldedAny = true;
						yield delta;
					}
					t.breaker?.recordSuccess();
					return;
				} catch (err) {
					failed.set(t.name, err);
					t.breaker?.recordFailure(err);
					if (yieldedAny || !streamRetryBeforeFirstChunk) {
						// Past first chunk — stream commitment. Propagate immediately.
						// Consumers handle the thrown error in their catch; no synthetic
						// finish delta is emitted (see JSDoc at top of file). We do NOT
						// call `onExhausted` here because other tiers were never tried —
						// the error is a single-tier commitment failure, not a
						// "no-tier-worked" condition.
						throw err;
					}
					const next = resolved[i + 1];
					if (next) opts.onFallback?.(t.name, next.name, err);
				}
			}
			const report: CascadeExhaustionReport = { skipped, failed };
			opts.onExhausted?.(report);
			throw new AllTiersExhaustedError(report);
		},
	};
	withLayer(cascade, `cascade[${resolved.map((t) => t.name).join(",")}]`);
	return cascade;
}

/**
 * Tiny type-safe constructor for an {@link AdapterTier}. Cleans up the
 * heterogeneous array-type cast users (and `browser-presets.ts`) had to write
 * by hand. Per Wave A Unit 13 decision.
 *
 * @example
 * ```ts
 * cascadingLlmAdapter([
 *   tier("local", webllmAdapter(...)),
 *   tier("cloud", anthropicAdapter(...), { breaker: { failureThreshold: 5 } }),
 * ]);
 * ```
 *
 * @category ai
 */
export function tier(
	name: string,
	adapter: LLMAdapter,
	opts?: { breaker?: CircuitBreakerOptions | CircuitBreaker; filter?: AdapterTier["filter"] },
): AdapterTier {
	const out: AdapterTier = { name, adapter };
	if (opts?.breaker) out.breaker = opts.breaker;
	if (opts?.filter) out.filter = opts.filter;
	return out;
}
