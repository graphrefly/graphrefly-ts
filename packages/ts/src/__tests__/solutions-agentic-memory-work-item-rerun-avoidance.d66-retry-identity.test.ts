import { describe, expect, it } from "vitest";
import {
	D66_IMPLEMENTATION_MANIFEST_DIGEST,
	D66_QUALIFICATION_ARTIFACT_DIGEST,
	D66_QUALIFICATION_DIGEST,
	measureD66Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d66-implementation-manifest.js";
import { runD66RetryIdentityQualification } from "../../evals/empirical-memory-rerun-avoidance/d66-retry-identity-qualification.js";

describe("graphrefly-ts:D66 same-request retry identity", () => {
	it("preserves non-initial Graph intent and rejects wire drift before dispatch", async () => {
		const qualification = runD66RetryIdentityQualification();
		expect(await measureD66Implementation()).toBe(D66_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(qualification.qualificationDigest).toBe(D66_QUALIFICATION_DIGEST);
		expect(qualification.artifactDigest).toBe(D66_QUALIFICATION_ARTIFACT_DIGEST);
		expect(qualification).toMatchObject({
			schemaVersion: "graphrefly-ts.d66.retry-identity-qualification.v1",
			decisionRef: "graphrefly-ts:D66",
			originalIntentPreserved: true,
			freshRequestAndAdmissionCoordinates: true,
			exactWireIdentity: true,
			preDispatchWireDriftRejected: true,
			boundedRetryCardinalityUnchanged: true,
			cleanupQualified: true,
			canonicalReplayQualified: true,
			rawMaterialPersisted: false,
			providerNetworkCalls: 0,
			credentialReads: 0,
			dispatchClaims: 0,
			efficacyClaim: "none",
		});
		expect(qualification.cases.map(({ intent }) => intent)).toEqual([
			"initial",
			"phase-correction",
			"fresh-mutation",
			"semantic-correction",
		]);
	});
});
