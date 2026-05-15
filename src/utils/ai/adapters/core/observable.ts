/**
 * Observable adapter wrapper — the "inverted statistics" surface.
 *
 * The library emits structured facts (token counts, latency, timestamps)
 * as reactive nodes. Users compose interpretation (pricing, dashboards,
 * telemetry, budget breakers) as derived layers on top.
 */

import { monotonicNs, wallClockNs } from "@graphrefly/pure-ts/core/clock.js";
import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { keepalive, type ReactiveLogBundle, reactiveLog } from "@graphrefly/pure-ts/extra";
import {
	adapterWrapper,
	adaptInvokeResult,
	buildCallStats,
	emptyUsageStub,
	withLayer,
} from "../_internal/wrappers.js";
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
	/**
	 * Release the internal keepalive subscriptions on the three counter
	 * derives (`totalCalls` / `totalInputTokens` / `totalOutputTokens`) so the
	 * bundle can be GC'd when the caller discards it. Idempotent. Long-lived
	 * adapter bundles (module-level singletons) can ignore; transient bundles
	 * (per-request / per-user) should call on teardown.
	 */
	dispose(): void;
}

// ---------------------------------------------------------------------------
// observableAdapter
// ---------------------------------------------------------------------------

/**
 * Wrap any {@link LLMAdapter} with a reactive stats bundle.
 *
 * Implementation (Unit 10 B):
 * - `stats.lastCall` is a `state<CallStatsEvent | null>`.
 * - Counters (`totalCalls` / `totalInputTokens` / `totalOutputTokens`) are
 *   **derived views** over `allCalls.entries` — self-maintaining, no manual
 *   `.cache + 1 + emit` pattern, visible topology in `describe()`.
 * - `stats.allCalls` is a `reactiveLog<CallStatsEvent>` — bounded, supports
 *   `tail(n)` / `slice(start, stop)` for dashboard views.
 * - The wrapped adapter passes DATA through via `adaptInvokeResult`, which
 *   uses `onFirstData` internally to guard against re-subscription double-fire
 *   and wires `.catch` for Promise-path error recording (Unit 10 A).
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

	const lastCall = node<CallStatsEvent | null>([], {
		name: "adapterStats/lastCall",
		initial: null,
	});

	// Counters as derived views over the log — self-maintaining (Unit 10 B).
	// `initial` seeds them so late subscribers see 0 before any call lands.
	const totalCalls = node<number>(
		[allCalls.entries],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const entries = data[0] as readonly CallStatsEvent[];
			actions.emit(entries.length);
		},
		{ describeKind: "derived", name: "adapterStats/totalCalls", initial: 0 },
	);
	const totalInputTokens = node<number>(
		[allCalls.entries],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const entries = data[0] as readonly CallStatsEvent[];
			actions.emit(entries.reduce((acc, ev) => acc + sumInputTokens(ev.usage), 0));
		},
		{ describeKind: "derived", name: "adapterStats/totalInputTokens", initial: 0 },
	);
	const totalOutputTokens = node<number>(
		[allCalls.entries],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const entries = data[0] as readonly CallStatsEvent[];
			actions.emit(entries.reduce((acc, ev) => acc + sumOutputTokens(ev.usage), 0));
		},
		{ describeKind: "derived", name: "adapterStats/totalOutputTokens", initial: 0 },
	);
	// Keepalive — counters track the log whether or not an external subscriber
	// is attached, so `.cache` on the counters stays current. Captured as an
	// array so `AdapterStats.dispose()` can release them all.
	const unsubKeepalives: Array<() => void> = [
		keepalive(totalCalls),
		keepalive(totalInputTokens),
		keepalive(totalOutputTokens),
	];

	const record = (ev: CallStatsEvent): void => {
		allCalls.append(ev);
		lastCall.emit(ev);
	};

	const reset = (): void => {
		allCalls.clear();
		lastCall.emit(null);
	};

	const wrap = adapterWrapper(inner, {
		invoke(messages, invokeOpts) {
			const startNs = monotonicNs();
			const startWallClockNs = wallClockNs();
			const model = inner.model ?? invokeOpts?.model ?? "";
			const recordResp = (resp: LLMResponse): LLMResponse => {
				record(
					buildCallStats({
						provider: inner.provider,
						model: inner.model ?? invokeOpts?.model ?? resp.model ?? "",
						tier: invokeOpts?.tier ?? resp.tier,
						usage: resp.usage ?? emptyUsageStub(),
						startNs,
						startWallClockNs,
						method: "invoke",
					}),
				);
				return resp;
			};
			const recordErr = (err: unknown): void => {
				const e = err as Error | undefined;
				record(
					buildCallStats({
						provider: inner.provider,
						model,
						tier: invokeOpts?.tier,
						usage: emptyUsageStub(),
						startNs,
						startWallClockNs,
						method: "invoke",
						error: {
							type: e?.name ?? "Error",
							message: e?.message ?? String(err),
						},
					}),
				);
			};
			return adaptInvokeResult(inner.invoke(messages, invokeOpts), {
				onResp: recordResp,
				onError: recordErr,
				name: "adapterStats/invokeTap",
			});
		},

		async *stream(messages, invokeOpts) {
			const startNs = monotonicNs();
			const startWallClockNs = wallClockNs();
			const model = inner.model ?? invokeOpts?.model ?? "";
			let finalUsage: TokenUsage | undefined;
			try {
				for await (const delta of inner.stream(messages, invokeOpts)) {
					if (delta.type === "usage") finalUsage = delta.usage;
					yield delta;
				}
				record(
					buildCallStats({
						provider: inner.provider,
						model,
						tier: invokeOpts?.tier,
						usage: finalUsage ?? emptyUsageStub(),
						startNs,
						startWallClockNs,
						method: "stream",
					}),
				);
			} catch (err) {
				const e = err as Error | undefined;
				record(
					buildCallStats({
						provider: inner.provider,
						model,
						tier: invokeOpts?.tier,
						usage: finalUsage ?? emptyUsageStub(),
						startNs,
						startWallClockNs,
						method: "stream",
						error: {
							type: e?.name ?? "Error",
							message: e?.message ?? String(err),
						},
					}),
				);
				throw err;
			}
		},
	});

	withLayer(wrap, "observableAdapter", inner);

	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		for (const fn of unsubKeepalives) fn();
		unsubKeepalives.length = 0;
	};

	const stats: AdapterStats = {
		lastCall,
		allCalls,
		totalCalls,
		totalInputTokens,
		totalOutputTokens,
		reset,
		dispose,
	};

	return { adapter: wrap, stats };
}

export type { ChatMessage, LLMAdapter, LLMInvokeOptions, LLMResponse, StreamDelta, TokenUsage };
