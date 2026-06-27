/**
 * Budget gate — hard per-run caps on LLM spend.
 *
 * Wraps any `LLMProvider` to enforce `maxCalls`, `maxInputTokens`,
 * `maxOutputTokens`, and `maxPriceUsd` (USD, via `estimateTokenCost`).
 * When any cap is reached, the next `generate()` throws
 * `BudgetExceededError` and the pipeline terminates — no runaway.
 *
 * Motivation: `archive/docs/SESSION-rigor-infrastructure-plan.md`
 * § "LLM EVAL COST SAFETY" Layer 3. Canonical caps are the token/call
 * counts (always computable); price is best-effort via the pricing
 * table in `cost.ts` and trips early when the model is known.
 *
 * Typically layered INSIDE the replay cache so cache hits don't count
 * toward budget — `withReplayCache(withBudgetGate(realProvider, ...), ...)`.
 */

import { estimateTokenCost } from "./cost.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";

export interface BudgetCaps {
	readonly maxCalls?: number;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	/** Hard USD cap. Unknown models contribute 0 — rely on call/token caps. */
	readonly maxPriceUsd?: number;
}

export interface BudgetState {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	priceUsd: number;
}

export class BudgetExceededError extends Error {
	constructor(
		readonly cap: keyof BudgetCaps,
		readonly current: number,
		readonly limit: number,
	) {
		super(`Budget exceeded: ${cap} = ${current.toFixed(4)} >= ${limit}`);
		this.name = "BudgetExceededError";
	}
}

export interface BudgetGateOptions {
	readonly caps: BudgetCaps;
	/** Called after every successful `generate()` with the updated state. */
	readonly onUpdate?: (state: Readonly<BudgetState>) => void;
	/** Called when a cap is breached and an error is about to throw. */
	readonly onExceed?: (err: BudgetExceededError) => void;
}

export type GatedProvider = LLMProvider & {
	readonly state: Readonly<BudgetState>;
	reset(): void;
};

export function withBudgetGate(inner: LLMProvider, opts: BudgetGateOptions): GatedProvider {
	const state: BudgetState = { calls: 0, inputTokens: 0, outputTokens: 0, priceUsd: 0 };

	// Pre-call guard: if a previous call already exceeded a cap, refuse the
	// next call. `maxCalls` is perfectly predicted by this check alone, so it
	// has no post-call counterpart.
	function checkPreCall(): void {
		const { caps } = opts;
		if (caps.maxCalls !== undefined && state.calls >= caps.maxCalls) {
			throwExceeded("maxCalls", state.calls, caps.maxCalls);
		}
		if (caps.maxInputTokens !== undefined && state.inputTokens >= caps.maxInputTokens) {
			throwExceeded("maxInputTokens", state.inputTokens, caps.maxInputTokens);
		}
		if (caps.maxOutputTokens !== undefined && state.outputTokens >= caps.maxOutputTokens) {
			throwExceeded("maxOutputTokens", state.outputTokens, caps.maxOutputTokens);
		}
		if (caps.maxPriceUsd !== undefined && state.priceUsd >= caps.maxPriceUsd) {
			throwExceeded("maxPriceUsd", state.priceUsd, caps.maxPriceUsd);
		}
	}

	// Post-call guard: surface the breach on the exact call that pushed
	// tokens or price over the cap. `maxCalls` is excluded — it would fire
	// at call N instead of N+1, making "maxCalls=N" allow only N-1 calls.
	function checkPostCall(): void {
		const { caps } = opts;
		if (caps.maxInputTokens !== undefined && state.inputTokens >= caps.maxInputTokens) {
			throwExceeded("maxInputTokens", state.inputTokens, caps.maxInputTokens);
		}
		if (caps.maxOutputTokens !== undefined && state.outputTokens >= caps.maxOutputTokens) {
			throwExceeded("maxOutputTokens", state.outputTokens, caps.maxOutputTokens);
		}
		if (caps.maxPriceUsd !== undefined && state.priceUsd >= caps.maxPriceUsd) {
			throwExceeded("maxPriceUsd", state.priceUsd, caps.maxPriceUsd);
		}
	}

	function throwExceeded(cap: keyof BudgetCaps, current: number, limit: number): never {
		const err = new BudgetExceededError(cap, current, limit);
		opts.onExceed?.(err);
		throw err;
	}

	return {
		name: `${inner.name}+budget`,
		limits: inner.limits,
		get state(): Readonly<BudgetState> {
			return state;
		},
		reset(): void {
			state.calls = 0;
			state.inputTokens = 0;
			state.outputTokens = 0;
			state.priceUsd = 0;
		},
		async generate(req: LLMRequest): Promise<LLMResponse> {
			checkPreCall();
			const response = await inner.generate(req);
			state.calls += 1;
			state.inputTokens += response.inputTokens;
			state.outputTokens += response.outputTokens;
			state.priceUsd += estimateTokenCost(response.inputTokens, response.outputTokens, req.model);
			opts.onUpdate?.(state);
			checkPostCall();
			return response;
		},
	};
}
