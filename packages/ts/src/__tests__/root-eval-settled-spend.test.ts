import { describe, expect, it } from "vitest";
import {
	EVAL_PROVIDER_OUTCOME_REASON_CODES,
	type EvalBudgetState,
} from "../../evals/graph-native-rerun-avoidance/eval-topology.js";
import { settledRootEvalSpend } from "../../evals/graph-native-rerun-avoidance/settled-spend.js";

const receipt = (patch: Partial<EvalBudgetState> = {}): EvalBudgetState =>
	({
		kind: "eval-budget-state",
		admittedAttempts: 2,
		activeEffects: 1,
		admittedRetryAttempts: 0,
		retryProposalCount: 0,
		pendingRetryProposalCount: 0,
		rejectedRetryProposalCount: 0,
		settledRetryAttemptCount: 0,
		pricingRoundingAllowanceMicrousd: 0,
		maxAttempts: 175,
		maxCostMicrousd: 1_000,
		stoppingReason: "none",
		providerCallCount: 1,
		providerReportedMicrousd: 10,
		unreportedSettledUpperBoundMicrousd: 0,
		activeReservedMicrousd: 100,
		accountedUpperBoundMicrousd: 110,
		providerOutcomeReasonCounts: Object.fromEntries(
			EVAL_PROVIDER_OUTCOME_REASON_CODES.map((code) => [code, code === "tool-proposed" ? 1 : 0]),
		),
		...patch,
	}) as EvalBudgetState;

describe("D153 independent Graph budget receipts", () => {
	it("keeps an active reservation without consulting conclusion or observation material", () => {
		expect(
			settledRootEvalSpend({
				budget: receipt(),
				providerCalls: 2,
				authorizedMaximumMicrousd: 1_000,
			}),
		).toMatchObject({
			complete: true,
			providerReportedMicrousd: 10,
			unreportedSettledUpperBoundMicrousd: 100,
			accountedUpperBoundMicrousd: 110,
		});
	});
	it("retains the authorization for missing, malformed, or stale budget receipts", () => {
		for (const budget of [
			null,
			receipt({ activeReservedMicrousd: 0 }),
			receipt({ providerCallCount: 0 }),
		])
			expect(
				settledRootEvalSpend({ budget, providerCalls: 2, authorizedMaximumMicrousd: 1_000 }),
			).toMatchObject({
				complete: false,
				providerReportedMicrousd: 0,
				unreportedSettledUpperBoundMicrousd: 1_000,
			});
	});
	it("does not invoke getters in rejected receipt material", () => {
		let called = false;
		const budget = receipt();
		Object.defineProperty(budget, "providerReportedMicrousd", {
			enumerable: true,
			get() {
				called = true;
				return 0;
			},
		});
		expect(
			settledRootEvalSpend({ budget, providerCalls: 2, authorizedMaximumMicrousd: 1_000 }).complete,
		).toBe(false);
		expect(called).toBe(false);
	});
});
