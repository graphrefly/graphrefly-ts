import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD776InjectedBaselineForTest,
	runD776InjectedNoNetworkQualification,
	validateD776QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d776-pre-live-qualification.js";
import {
	D777_BASELINE_COMMIT,
	D777_BUDGET_LIMITS,
	D777_DECISION_REF,
	D777_HISTORICAL_ARTIFACT_SHA256,
	D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d777-coordinates.js";
import {
	D777_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD777Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d777-implementation-manifest.js";
import { acquireD777SingleUseDispatchClaimAtRootForTest } from "../../evals/empirical-memory-rerun-avoidance/d777-single-use-dispatch-claim.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

describe("D777 D776-qualified Graph-native live boundary", () => {
	it("freezes the approved D776 baseline and live numeric boundary", () => {
		expect(D777_DECISION_REF).toBe("decision.D777");
		expect(D777_BASELINE_COMMIT).toBe("2583cb55");
		expect(D777_HISTORICAL_ARTIFACT_SHA256).toBe(
			"sha256:a9dd575c9773fa9ecaae77ba3b2de6c278b8f5946290f5b846cb0a8433a2657c",
		);
		expect(D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:0dabb4f2bc5ebde179a718e0b893e64fbeeab9051c13f2aceaed5861ba4f940f",
		);
		expect(D777_BUDGET_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	it("replays the complete injected six-arm D776 provider-envelope qualification", async () => {
		const bundle = validateD776QualificationBundle(
			await runD776InjectedNoNetworkQualification(createD776InjectedBaselineForTest()),
		);
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.graphEvidence.ledger.maxActiveArms).toBe(1);
		expect(bundle.routeEvidence.coverageComplete).toBe(true);
		expect(bundle.routeEvidence.facts).toHaveLength(bundle.qualification.providerCalls as number);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.qualification.credentialReads).toBe(0);
		expect(bundle.qualification.workspaceResidueCount).toBe(0);
	}, 30_000);

	it("binds the current implementation and makes the durable claim exclusive", async () => {
		expect(await measureD777Implementation()).toBe(D777_IMPLEMENTATION_MANIFEST_DIGEST);
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d777-claim-"));
		await chmod(root, 0o700);
		try {
			const input = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: D777_IMPLEMENTATION_MANIFEST_DIGEST,
			};
			await acquireD777SingleUseDispatchClaimAtRootForTest(await realpath(root), input);
			await expect(
				acquireD777SingleUseDispatchClaimAtRootForTest(await realpath(root), input),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
