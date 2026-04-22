/**
 * `withBudgetGate` — cap an adapter by calls / tokens / USD.
 *
 * Totals are an O(1)-per-event running accumulator (a `state<BudgetTotals>`
 * updated imperatively inside `record()`), not a derived reduce over the
 * full log — avoids the quadratic cost at sustained traffic while preserving
 * the reactive surface. The full log is still exposed via the bundle for
 * dashboards / auditors.
 *
 * Budgets are enforced imperatively at `invoke()` / `stream()` entry — the
 * running totals + `isOpen.cache` are read; if closed, the call rejects /
 * throws `BudgetExhaustedError` without hitting the wrapped adapter. On
 * success, the call's usage is appended to the log AND debits the running
 * totals in a single synchronous update.
 */

import { monotonicNs, wallClockNs } from "../../../../core/clock.js";
import { DATA } from "../../../../core/messages.js";
import type { Node } from "../../../../core/node.js";
import { derived, state } from "../../../../core/sugar.js";
import { type ReactiveLogBundle, reactiveLog } from "../../../../extra/reactive-log.js";
import { fromAny, keepalive } from "../../../../extra/sources.js";
import type { CallStatsEvent } from "../core/observable.js";
import type { PricingFn } from "../core/pricing.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
	TokenUsage,
} from "../core/types.js";
import { sumInputTokens, sumOutputTokens } from "../core/types.js";

export class BudgetExhaustedError extends Error {
	override name = "BudgetExhaustedError";
	constructor(
		public readonly which: string,
		public readonly limit: number,
		public readonly observed: number,
	) {
		super(`Budget exhausted: ${which} (limit=${limit}, observed=${observed})`);
	}
}

export interface BudgetCaps {
	calls?: number;
	inputTokens?: number;
	outputTokens?: number;
	usd?: number;
}

export interface BudgetTotals {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	usd: number;
}

export interface BudgetGateBundle {
	totals: Node<BudgetTotals>;
	isOpen: Node<boolean>;
	log: ReactiveLogBundle<CallStatsEvent>;
	reset(): void;
}

export interface WithBudgetGateOptions {
	caps: BudgetCaps;
	/**
	 * Optional pricing function for USD gating. If omitted, `caps.usd` is
	 * ignored (caps.calls / caps.inputTokens / caps.outputTokens still apply).
	 */
	pricingFn?: PricingFn;
	/**
	 * Edge-triggered: fires exactly once when the gate transitions from
	 * open to closed. Subsequent invoke/stream attempts against a closed
	 * gate do NOT re-fire `onExhausted` — use the reactive `isOpen` node
	 * if you need per-attempt notifications. Receives the cap key that
	 * triggered the transition.
	 */
	onExhausted?: (which: keyof BudgetCaps) => void;
	/** Name for logs / describe output. */
	name?: string;
	/** Max events retained in the log (default 1000). */
	logMax?: number;
}

// Frozen baseline shared for `totals.cache ?? EMPTY_TOTALS` reads. Consumers
// that mutate their snapshot in place would otherwise poison every budget-gate
// instance in the process. `reset()` emits a freshly-constructed object so
// downstream identity-equals checks on the frozen constant don't false-equal.
const EMPTY_TOTALS: Readonly<BudgetTotals> = Object.freeze({
	calls: 0,
	inputTokens: 0,
	outputTokens: 0,
	usd: 0,
});
const makeEmptyTotals = (): BudgetTotals => ({
	calls: 0,
	inputTokens: 0,
	outputTokens: 0,
	usd: 0,
});

/**
 * Wrap an adapter with budget enforcement. Returns `{adapter, budget}` so
 * callers can subscribe to the bundle for dashboards.
 */
export function withBudgetGate(
	inner: LLMAdapter,
	opts: WithBudgetGateOptions,
): { adapter: LLMAdapter; budget: BudgetGateBundle } {
	const log = reactiveLog<CallStatsEvent>(undefined, {
		name: opts.name ? `${opts.name}/log` : "budgetGate/log",
		maxSize: opts.logMax ?? 1000,
	});

	// O(1) running totals — incremented per `record()` rather than reduced over
	// the full log. Reactive surface preserved via `state<BudgetTotals>`.
	const totals = state<BudgetTotals>(makeEmptyTotals(), {
		name: opts.name ? `${opts.name}/totals` : "budgetGate/totals",
	});

	const isOpen = derived<boolean>(
		[totals],
		([t]) => {
			const tt = t as BudgetTotals;
			if (opts.caps.calls != null && tt.calls >= opts.caps.calls) return false;
			if (opts.caps.inputTokens != null && tt.inputTokens >= opts.caps.inputTokens) return false;
			if (opts.caps.outputTokens != null && tt.outputTokens >= opts.caps.outputTokens) return false;
			if (opts.caps.usd != null && tt.usd >= opts.caps.usd) return false;
			return true;
		},
		{ name: opts.name ? `${opts.name}/isOpen` : "budgetGate/isOpen", initial: true },
	);
	// Keep the isOpen derived live so `.cache` stays current without an external subscriber.
	keepalive(isOpen);

	// Edge-trigger `onExhausted` on the open→closed transition. Subscribing
	// here (instead of firing from `buildClosedError`) ensures the callback
	// fires exactly once per transition, regardless of how many invoke/stream
	// attempts hit the closed gate afterward. Callers that want per-attempt
	// notifications should subscribe to `isOpen` directly.
	if (opts.onExhausted != null) {
		const handler = opts.onExhausted;
		let wasOpen = true;
		isOpen.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const v = m[1] as boolean;
					if (wasOpen && v === false) {
						const which = pickExhaustedKey(totals.cache ?? EMPTY_TOTALS, opts.caps);
						if (which) handler(which);
					}
					wasOpen = v;
				}
			}
		});
	}

	const buildClosedError = (): BudgetExhaustedError | undefined => {
		if (isOpen.cache === false) {
			const t = totals.cache ?? EMPTY_TOTALS;
			const which = pickExhaustedKey(t, opts.caps);
			return new BudgetExhaustedError(
				which ?? "budget",
				opts.caps[which ?? "calls"] ?? 0,
				whichValue(t, which ?? "calls"),
			);
		}
		return undefined;
	};

	const record = (
		usage: TokenUsage,
		meta: {
			model: string;
			tier?: string;
			latencyMs: number;
			method: "invoke" | "stream";
			error?: { type: string; message: string };
		},
	): void => {
		const provider = inner.provider;
		const event: CallStatsEvent = {
			timestamp: monotonicNs(),
			wallClock: wallClockNs(),
			provider,
			model: meta.model,
			tier: meta.tier,
			usage,
			latencyMs: meta.latencyMs,
			method: meta.method,
			...(meta.error ? { error: meta.error } : {}),
		};
		log.append(event);
		const prev = totals.cache ?? EMPTY_TOTALS;
		const usd = opts.pricingFn
			? prev.usd + opts.pricingFn(usage, { model: meta.model, provider, tier: meta.tier }).total
			: prev.usd;
		totals.emit({
			calls: prev.calls + 1,
			inputTokens: prev.inputTokens + sumInputTokens(usage),
			outputTokens: prev.outputTokens + sumOutputTokens(usage),
			usd,
		});
	};

	const reset = (): void => {
		log.clear();
		totals.emit(makeEmptyTotals());
	};

	const emptyUsage = (): TokenUsage => ({ input: { regular: 0 }, output: { regular: 0 } });

	const wrap: LLMAdapter = {
		provider: inner.provider,
		model: inner.model,
		capabilities: inner.capabilities?.bind(inner),

		invoke(messages, invokeOpts) {
			const closedErr = buildClosedError();
			if (closedErr) return Promise.reject(closedErr);
			const start = monotonicNs();
			const result = inner.invoke(messages, invokeOpts);

			const recordResp = (resp: LLMResponse): LLMResponse => {
				const latencyMs = Math.max(0, (monotonicNs() - start) / 1e6);
				record(resp.usage ?? emptyUsage(), {
					model: inner.model ?? invokeOpts?.model ?? resp.model ?? "",
					tier: invokeOpts?.tier ?? resp.tier,
					latencyMs,
					method: "invoke",
				});
				return resp;
			};

			if (result != null && typeof (result as PromiseLike<LLMResponse>).then === "function") {
				return (result as Promise<LLMResponse>).then(recordResp);
			}
			if (result != null && typeof result === "object" && "content" in (result as object)) {
				return recordResp(result as LLMResponse);
			}
			// Reactive path — guard against double-record on resubscribe.
			let recordedOnce = false;
			return derived<LLMResponse>(
				[fromAny(result)],
				([v]) => {
					if (v == null) return v as null;
					if (recordedOnce) return v as LLMResponse;
					recordedOnce = true;
					return recordResp(v as LLMResponse);
				},
				{ name: "budgetGate/invokeTap" },
			);
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			const closedErr = buildClosedError();
			if (closedErr) throw closedErr;
			const start = monotonicNs();
			let finalUsage: TokenUsage | undefined;
			try {
				for await (const delta of inner.stream(messages, invokeOpts)) {
					if (delta.type === "usage") finalUsage = delta.usage;
					yield delta;
				}
				record(finalUsage ?? emptyUsage(), {
					model: inner.model ?? invokeOpts?.model ?? "",
					tier: invokeOpts?.tier,
					latencyMs: Math.max(0, (monotonicNs() - start) / 1e6),
					method: "stream",
				});
			} catch (err) {
				const error = err as Error;
				record(finalUsage ?? emptyUsage(), {
					model: inner.model ?? invokeOpts?.model ?? "",
					tier: invokeOpts?.tier,
					latencyMs: Math.max(0, (monotonicNs() - start) / 1e6),
					method: "stream",
					error: { type: error?.name ?? "Error", message: error?.message ?? String(err) },
				});
				throw err;
			}
		},
	};

	return { adapter: wrap, budget: { totals, isOpen, log, reset } };
}

function pickExhaustedKey(t: BudgetTotals, caps: BudgetCaps): keyof BudgetCaps | undefined {
	if (caps.calls != null && t.calls >= caps.calls) return "calls";
	if (caps.inputTokens != null && t.inputTokens >= caps.inputTokens) return "inputTokens";
	if (caps.outputTokens != null && t.outputTokens >= caps.outputTokens) return "outputTokens";
	if (caps.usd != null && t.usd >= caps.usd) return "usd";
	return undefined;
}

function whichValue(t: BudgetTotals, which: keyof BudgetCaps): number {
	switch (which) {
		case "calls":
			return t.calls;
		case "inputTokens":
			return t.inputTokens;
		case "outputTokens":
			return t.outputTokens;
		case "usd":
			return t.usd;
	}
}

export type { ChatMessage, LLMInvokeOptions };
