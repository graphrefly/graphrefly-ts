/**
 * Observable adapter wrapper — the "inverted statistics" surface.
 *
 * The library emits structured facts (token counts, latency, timestamps)
 * as reactive nodes. Users compose interpretation (pricing, dashboards,
 * telemetry, budget breakers) as derived layers on top. Rationale lives in
 * `archive/docs/SESSION-rigor-infrastructure-plan.md` §"v2: reactive LLM
 * statistics + pluggable pricing".
 */

import { monotonicNs, wallClockNs } from "../../../../core/clock.js";
import type { Node } from "../../../../core/node.js";
import { derived, state } from "../../../../core/sugar.js";
import { type ReactiveLogBundle, reactiveLog } from "../../../../extra/reactive-log.js";
import { fromAny } from "../../../../extra/sources.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
} from "./types.js";
import { sumInputTokens, sumOutputTokens } from "./types.js";

// ---------------------------------------------------------------------------
// CallStatsEvent
// ---------------------------------------------------------------------------

/** One call's structured statistics — emitted after `invoke()` / `stream()` settles. */
export interface CallStatsEvent {
	/** `monotonicNs()` at call completion — use for event ordering. */
	readonly timestamp: number;
	/** `wallClockNs()` at call start — use for human-readable attribution. */
	readonly wallClock: number;
	readonly provider: string;
	readonly model: string;
	readonly tier?: string;
	readonly usage: TokenUsage;
	readonly latencyMs: number;
	/** `"invoke"` or `"stream"`. */
	readonly method: "invoke" | "stream";
	/** Populated when the call errored — usage may be zero or partial. */
	readonly error?: { readonly type: string; readonly message: string };
}

// ---------------------------------------------------------------------------
// AdapterStats bundle
// ---------------------------------------------------------------------------

export interface AdapterStats {
	/**
	 * Reactive node for the most-recent call event. Emits `null` initially
	 * (no calls yet); emits a {@link CallStatsEvent} after each call. Subscribe
	 * and filter `!= null` if you want a `Node<CallStatsEvent>`.
	 */
	readonly lastCall: Node<CallStatsEvent | null>;
	/** Full event log (bounded by `opts.logMax`, default 1000). */
	readonly allCalls: ReactiveLogBundle<CallStatsEvent>;
	/** Total calls observed since last reset. */
	readonly totalCalls: Node<number>;
	/** Sum of every input-token class across observed calls. */
	readonly totalInputTokens: Node<number>;
	/** Sum of every output-token class across observed calls. */
	readonly totalOutputTokens: Node<number>;
	/** Reset all counters + clear the log. */
	reset(): void;
}

// ---------------------------------------------------------------------------
// observableAdapter
// ---------------------------------------------------------------------------

/**
 * Wrap any {@link LLMAdapter} with a reactive stats bundle.
 *
 * Implementation:
 * - `stats.lastCall` is a `state<CallStatsEvent | undefined>` exposed via a
 *   null-filtering derived so consumers see a typed `Node<CallStatsEvent>`.
 * - Counters (`totalCalls` / `totalInputTokens` / `totalOutputTokens`) are
 *   plain state nodes updated via `.emit()`.
 * - `stats.allCalls` is a `reactiveLog<CallStatsEvent>` — bounded, supports
 *   `tail(n)` / `slice(start, stop)` for dashboard views.
 * - The wrapped adapter passes DATA through via a `derived` tap that writes
 *   to the stats nodes as a side-effect. No pricing — users compose pricing
 *   as a derived on top of `stats.lastCall`.
 */
export function observableAdapter(
	inner: LLMAdapter,
	opts?: { logMax?: number; name?: string },
): { adapter: LLMAdapter; stats: AdapterStats } {
	const logMax = opts?.logMax ?? 1000;
	const allCalls = reactiveLog<CallStatsEvent>(undefined, {
		name: opts?.name ? `${opts.name}/stats` : "adapterStats",
		maxSize: logMax,
	});

	// `null` is the pre-first-call value (valid DATA per spec v5); exposed
	// directly as `lastCall`. Consumers who want a `Node<CallStatsEvent>`
	// (non-null) can filter the stream themselves.
	const lastCall = state<CallStatsEvent | null>(null, {
		name: "adapterStats/lastCall",
	});

	const totalCalls = state<number>(0, { name: "adapterStats/totalCalls" });
	const totalInputTokens = state<number>(0, { name: "adapterStats/totalInputTokens" });
	const totalOutputTokens = state<number>(0, { name: "adapterStats/totalOutputTokens" });

	const record = (ev: CallStatsEvent): void => {
		allCalls.append(ev);
		lastCall.emit(ev);
		totalCalls.emit((totalCalls.cache ?? 0) + 1);
		totalInputTokens.emit((totalInputTokens.cache ?? 0) + sumInputTokens(ev.usage));
		totalOutputTokens.emit((totalOutputTokens.cache ?? 0) + sumOutputTokens(ev.usage));
	};

	const reset = (): void => {
		allCalls.clear();
		lastCall.emit(null);
		totalCalls.emit(0);
		totalInputTokens.emit(0);
		totalOutputTokens.emit(0);
	};

	const wrap: LLMAdapter = {
		provider: inner.provider,
		model: inner.model,
		capabilities: inner.capabilities?.bind(inner),

		invoke(messages, invokeOpts) {
			const start = monotonicNs();
			const startWall = wallClockNs();
			const result = inner.invoke(messages, invokeOpts);

			const recordResp = (resp: LLMResponse): LLMResponse => {
				const end = monotonicNs();
				record({
					timestamp: end,
					wallClock: startWall,
					provider: inner.provider,
					model: inner.model ?? invokeOpts?.model ?? resp.model ?? "",
					tier: invokeOpts?.tier ?? resp.tier,
					usage: resp.usage ?? emptyUsageStub(),
					latencyMs: Math.max(0, (end - start) / 1e6),
					method: "invoke",
				});
				return resp;
			};

			// Preserve shape: Promise in → Promise out (the common case).
			if (result != null && typeof (result as PromiseLike<LLMResponse>).then === "function") {
				return (result as Promise<LLMResponse>).then(recordResp);
			}
			// Plain value.
			if (result != null && typeof result === "object" && "content" in (result as object)) {
				return recordResp(result as LLMResponse);
			}
			// Reactive / iterable path — use derived passthrough so the record fires
			// when the node emits DATA. Requires a subscriber to activate.
			//
			// Guard against double-recording: the derived's push-on-subscribe
			// replays the cached DATA to any late subscriber, re-invoking the fn.
			// We record once per call (tied to this `invoke` closure) and stamp
			// the response.metadata so re-subscription is a no-op for stats.
			let recordedOnce = false;
			return derived<LLMResponse>(
				[fromAny(result)],
				([v]) => {
					if (v == null) return v as null;
					if (recordedOnce) return v as LLMResponse;
					recordedOnce = true;
					return recordResp(v as LLMResponse);
				},
				{ name: "adapterStats/invokeTap" },
			);
		},

		async *stream(messages, invokeOpts) {
			const start = monotonicNs();
			const startWall = wallClockNs();
			let finalUsage: TokenUsage | undefined;
			try {
				for await (const delta of inner.stream(messages, invokeOpts)) {
					if (delta.type === "usage") finalUsage = delta.usage;
					yield delta;
				}
				const end = monotonicNs();
				record({
					timestamp: end,
					wallClock: startWall,
					provider: inner.provider,
					model: inner.model ?? invokeOpts?.model ?? "",
					tier: invokeOpts?.tier,
					usage: finalUsage ?? emptyUsageStub(),
					latencyMs: Math.max(0, (end - start) / 1e6),
					method: "stream",
				});
			} catch (err) {
				const end = monotonicNs();
				const error = err as Error | undefined;
				record({
					timestamp: end,
					wallClock: startWall,
					provider: inner.provider,
					model: inner.model ?? invokeOpts?.model ?? "",
					tier: invokeOpts?.tier,
					usage: finalUsage ?? emptyUsageStub(),
					latencyMs: Math.max(0, (end - start) / 1e6),
					method: "stream",
					error: {
						type: error?.name ?? "Error",
						message: error?.message ?? String(err),
					},
				});
				throw err;
			}
		},
	};

	const stats: AdapterStats = {
		lastCall,
		allCalls,
		totalCalls,
		totalInputTokens,
		totalOutputTokens,
		reset,
	};

	return { adapter: wrap, stats };
}

function emptyUsageStub(): TokenUsage {
	return { input: { regular: 0 }, output: { regular: 0 } };
}

export type { ChatMessage, LLMAdapter, LLMInvokeOptions, LLMResponse, StreamDelta, TokenUsage };
