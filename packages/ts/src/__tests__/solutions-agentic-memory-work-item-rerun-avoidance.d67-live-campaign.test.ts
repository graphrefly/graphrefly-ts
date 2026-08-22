import { describe, expect, it } from "vitest";
import { D66_QUALIFICATION_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d66-implementation-manifest.js";
import { runD67LiveInjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d67-live-campaign-qualification.js";
import {
	D67_LIVE_EXECUTION_MANIFEST_DIGEST,
	measureD67LiveExecution,
} from "../../evals/empirical-memory-rerun-avoidance/d67-live-execution-manifest.js";

describe("graphrefly-ts:D67 D66-qualified replacement campaign", () => {
	it("keeps the fresh D67 claim behind D66 retry identity and canonical Graph replay", async () => {
		expect(await measureD67LiveExecution()).toBe(D67_LIVE_EXECUTION_MANIFEST_DIGEST);
		const qualification = await runD67LiveInjectedNoNetworkQualification();
		expect(qualification).toMatchObject({
			schemaVersion: "graphrefly-ts.d67.live-campaign-qualification.v1",
			d66QualificationDigest: D66_QUALIFICATION_DIGEST,
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
