import { expect, it } from "vitest";
import { runD55InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d55-provider-boundary-qualification.js";

it("contains an invalid post-wire response header as a Graph executor failure", async () => {
	await expect(runD55InjectedNoNetworkQualification()).resolves.toMatchObject({
		schemaVersion: "graphrefly-ts.d55.provider-boundary-qualification.v3",
		decisionRef: "graphrefly-ts:D55",
		exactSixArmsCompleted: true,
		postWireExecutorFailureScenarios: 5,
		transportFailureScenarios: 4,
		schemaRejectionScenarios: 2,
		d675RetryScenarios: 1,
		conservativeCostMicrousd: 100_000,
		conservativeElapsedMs: 600_000,
		armLocalCleanupAndContinuation: true,
		transportClassificationPreserved: true,
		d675RetryPreserved: true,
		canonicalReplayQualified: true,
		providerNetworkCalls: 0,
		credentialReads: 0,
		dispatchClaims: 0,
		rawMaterialPersisted: false,
		causalAttribution: "undetermined",
		efficacyClaim: "none",
	});
}, 300_000);
