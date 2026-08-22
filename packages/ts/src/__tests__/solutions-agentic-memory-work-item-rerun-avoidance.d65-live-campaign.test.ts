import { describe, expect, it } from "vitest";
import { runD65LiveInjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d65-live-campaign-qualification.js";
import {
	D65_LIVE_EXECUTION_MANIFEST_DIGEST,
	measureD65LiveExecution,
} from "../../evals/empirical-memory-rerun-avoidance/d65-live-execution-manifest.js";

describe("graphrefly-ts:D65 claim-gated live replicated campaign", () => {
	it("keeps live efficacy behind one durable claim and canonical Graph replay", async () => {
		expect(await measureD65LiveExecution()).toBe(D65_LIVE_EXECUTION_MANIFEST_DIGEST);
		const qualification = await runD65LiveInjectedNoNetworkQualification();
		expect(qualification).toMatchObject({
			schemaVersion: "graphrefly-ts.d65.live-campaign-qualification.v1",
			currentKeyCalls: 1,
			providerNetworkCalls: 0,
			liveCapabilityReplayRejected: true,
			forgedLiveCapabilityRejected: true,
			partialCampaignEvidenceQualified: true,
			efficacyClaim: "replicated-frozen-task-positive-differential",
		});
		expect(qualification.providerCalls).toBeGreaterThan(0);
	}, 30_000);
});
