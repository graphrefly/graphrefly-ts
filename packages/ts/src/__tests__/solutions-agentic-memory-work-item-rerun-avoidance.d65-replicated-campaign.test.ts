import { describe, expect, it } from "vitest";
import {
	D65_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD65Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d65-implementation-manifest.js";
import {
	D65_CONTINUATION_HARD_CAP_MICROUSD,
	D65_REPLICATE_COUNT,
} from "../../evals/empirical-memory-rerun-avoidance/d65-replicated-campaign-authority.js";
import { runD65InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d65-replicated-campaign-qualification.js";

describe("graphrefly-ts:D65 replicated Graph campaign", () => {
	it("admits exactly five serial six-arm replicates and freezes the replicated efficacy gate", async () => {
		expect(await measureD65Implementation()).toBe(D65_IMPLEMENTATION_MANIFEST_DIGEST);
		const bundle = await runD65InjectedNoNetworkQualification();

		expect(bundle.qualification).toMatchObject({
			decisionRef: "graphrefly-ts:D65",
			exactReplicates: D65_REPLICATE_COUNT,
			exactThirtyArmsEvaluable: true,
			exactSerialReplicateAdmission: true,
			noEarlySnapshot: true,
			activeReplicateReplayRejected: true,
			doubleExecutionRejected: true,
			crossReplicateSubstitutionRejected: true,
			completeNonEvaluableRetained: true,
			impossibleGateDidNotStopCampaign: true,
			retryWaitReconciled: true,
			cleanupFailureCanonicalized: true,
			canonicalReplayQualified: true,
			partialCampaignEvidenceQualified: true,
			aggregateBudgetTerminalQualified: true,
			frozenPositiveGateQualified: true,
			wrongScopeOneOfFiveBoundaryQualified: true,
			wrongScopeTwoOfFiveRejected: true,
			relevantFourOfFiveRejected: true,
			continuationHardCapMicrousd: D65_CONTINUATION_HARD_CAP_MICROUSD,
			aggregateHeadroomMonotonic: true,
			replicatePolicyBudgetLoweringQualified: true,
			optionalStoppingAllowed: false,
			selectiveDiscardAllowed: false,
			providerNetworkCalls: 0,
			credentialReads: 0,
			dispatchClaims: 0,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(bundle.campaignEvidence).toMatchObject({
			exactFiveReplicatesCompleted: true,
			exactThirtyArmsEvaluable: true,
			relevantPassCount: 5,
			frozenGatePassed: true,
			efficacyClaim: "none",
		});
		expect(bundle.campaignEvidence.replicates).toHaveLength(5);
		expect(bundle.campaignEvidence.facts).toHaveLength(13);
	}, 30_000);
});
