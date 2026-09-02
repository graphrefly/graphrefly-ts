import {
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { EvalBudgetState } from "./eval-topology.js";
import { EVAL_PROVIDER_OUTCOME_REASON_CODES } from "./eval-topology.js";

export function rootEvalBudgetReceipt(value: EvalBudgetState): EvalBudgetState {
	const budget = strictSnapshot(value);
	const numeric = [
		"admittedAttempts",
		"admittedRetryAttempts",
		"retryProposalCount",
		"pendingRetryProposalCount",
		"rejectedRetryProposalCount",
		"settledRetryAttemptCount",
		"providerCallCount",
		"activeEffects",
		"activeReservedMicrousd",
		"providerReportedMicrousd",
		"pricingRoundingAllowanceMicrousd",
		"unreportedSettledUpperBoundMicrousd",
		"accountedUpperBoundMicrousd",
		"maxAttempts",
		"maxCostMicrousd",
	] as const;
	exactKeys(
		budget as unknown as Record<string, unknown>,
		["kind", ...numeric, "providerOutcomeReasonCounts", "stoppingReason"],
		"budget receipt",
	);
	for (const key of numeric) safeInteger(budget[key], `budget receipt.${key}`);
	oneOf(
		budget.stoppingReason,
		["none", "budget-exhausted", "elapsed-budget-exhausted"],
		"budget receipt.stoppingReason",
	);
	exactKeys(
		budget.providerOutcomeReasonCounts,
		EVAL_PROVIDER_OUTCOME_REASON_CODES,
		"budget receipt outcome counts",
	);
	for (const code of EVAL_PROVIDER_OUTCOME_REASON_CODES)
		safeInteger(budget.providerOutcomeReasonCounts[code], "budget receipt outcome count");
	if (budget.kind !== "eval-budget-state") throw new TypeError("budget receipt kind invalid");
	return budget;
}

/** Read-only receipt projection; conclusions and observation material confer no spend authority. */
export function settledRootEvalSpend(input: {
	readonly budget: EvalBudgetState | null;
	readonly providerCalls: number;
	readonly authorizedMaximumMicrousd: number;
}) {
	const maximum = safeInteger(input.authorizedMaximumMicrousd, "authorized spend maximum");
	const calls = safeInteger(input.providerCalls, "provider call count");
	try {
		if (input.budget === null) {
			if (calls > 0) throw new Error("missing budget receipt");
			return Object.freeze({
				complete: true,
				budgetDigest: null,
				providerReportedMicrousd: 0,
				unreportedSettledUpperBoundMicrousd: 0,
				accountedUpperBoundMicrousd: 0,
			});
		}
		const budget = rootEvalBudgetReceipt(input.budget);
		const reported = safeInteger(budget.providerReportedMicrousd, "reported spend");
		const unknown = safeInteger(
			budget.unreportedSettledUpperBoundMicrousd,
			"unknown settled spend",
		);
		const reserved = safeInteger(budget.activeReservedMicrousd, "active reservation");
		const active = safeInteger(budget.activeEffects, "active provider effects");
		const admitted = safeInteger(budget.admittedAttempts, "admitted attempts");
		const reportedCalls = safeInteger(budget.providerCallCount, "settled provider calls");
		const settled = EVAL_PROVIDER_OUTCOME_REASON_CODES.reduce(
			(sum, code) =>
				sum + safeInteger(budget.providerOutcomeReasonCounts[code], "provider outcome count"),
			0,
		);
		const total = reported + unknown + reserved;
		if (
			budget.kind !== "eval-budget-state" ||
			!Number.isSafeInteger(total) ||
			total !== budget.accountedUpperBoundMicrousd ||
			active !== admitted - settled ||
			calls < reportedCalls ||
			calls > reportedCalls + active ||
			(active > 0 && reserved === 0)
		)
			throw new Error("incomplete budget receipt");
		return Object.freeze({
			complete: true,
			budgetDigest: empiricalStrictJsonDigest(budget),
			providerReportedMicrousd: reported,
			unreportedSettledUpperBoundMicrousd: unknown + reserved,
			accountedUpperBoundMicrousd: total,
		});
	} catch {
		// A missing/invalid view must never free a possibly consumed authorization.
		// Exact settlement can be recovered later from independent admission receipts.
		return Object.freeze({
			complete: false,
			budgetDigest: null,
			providerReportedMicrousd: 0,
			unreportedSettledUpperBoundMicrousd: maximum,
			accountedUpperBoundMicrousd: maximum,
		});
	}
}
