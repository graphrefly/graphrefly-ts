import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD774InjectedBaselineForTest,
	runD774InjectedNoNetworkQualification,
	validateD774QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d774-pre-live-qualification.js";
import {
	D775_BASELINE_COMMIT,
	D775_BUDGET_LIMITS,
	D775_DECISION_REF,
	D775_HISTORICAL_ARTIFACT_SHA256,
	D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d775-coordinates.js";
import {
	D775_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD775Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d775-implementation-manifest.js";
import { acquireD775SingleUseDispatchClaimAtRootForTest } from "../../evals/empirical-memory-rerun-avoidance/d775-single-use-dispatch-claim.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

describe("D775 D774-qualified Graph-native live boundary", () => {
	it("freezes the approved D774 baseline and live numeric boundary", () => {
		expect(D775_DECISION_REF).toBe("decision.D775");
		expect(D775_BASELINE_COMMIT).toBe("dee43fe1");
		expect(D775_HISTORICAL_ARTIFACT_SHA256).toBe(
			"sha256:8c3da09d69cd20c127252b65260cf72d81ba9acd313d9fed8ee3807b91b32cbc",
		);
		expect(D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:f411c3eb4fabe55e5b6828a7942cb9cdefefd8b609c3e25629ea4d4a0495c908",
		);
		expect(D775_BUDGET_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	it("replays the complete injected six-arm D774 provider-envelope qualification", async () => {
		const bundle = validateD774QualificationBundle(
			await runD774InjectedNoNetworkQualification(createD774InjectedBaselineForTest()),
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
		expect(await measureD775Implementation()).toBe(D775_IMPLEMENTATION_MANIFEST_DIGEST);
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d775-claim-"));
		await chmod(root, 0o700);
		try {
			const input = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: D775_IMPLEMENTATION_MANIFEST_DIGEST,
			};
			await acquireD775SingleUseDispatchClaimAtRootForTest(await realpath(root), input);
			await expect(
				acquireD775SingleUseDispatchClaimAtRootForTest(await realpath(root), input),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
