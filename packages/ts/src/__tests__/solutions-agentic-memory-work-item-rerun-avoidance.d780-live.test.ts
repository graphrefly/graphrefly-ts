import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD779InjectedBaselineForTest,
	runD779InjectedNoNetworkQualification,
	validateD779QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d779-pre-live-qualification.js";
import {
	D780_BASELINE_COMMIT,
	D780_BUDGET_LIMITS,
	D780_DECISION_REF,
	D780_HISTORICAL_ARTIFACT_SHA256,
	D780_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d780-coordinates.js";
import {
	isD780GraphSynthesizedToolFailureForTest,
	validateD780TaskToolFactsForTest,
	validateD780ToolRejectionFactsForTest,
} from "../../evals/empirical-memory-rerun-avoidance/d780-graph-native-live.js";
import {
	D780_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD780Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d780-implementation-manifest.js";
import { acquireD780SingleUseDispatchClaimAtRootForTest } from "../../evals/empirical-memory-rerun-avoidance/d780-single-use-dispatch-claim.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

describe("D780 D779-qualified Graph-native live boundary", () => {
	it("freezes the approved D779 baseline and live numeric boundary", () => {
		expect(D780_DECISION_REF).toBe("decision.D780");
		expect(D780_BASELINE_COMMIT).toBe("16545b14");
		expect(D780_HISTORICAL_ARTIFACT_SHA256).toBe(
			"sha256:f75987d6854ff8212020d0c9749b4de285ad4f48eecc6f1d97cd6a4ff081beec",
		);
		expect(D780_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:5900a0b65b488370e498f4ed953329522e4585e44070b09e014f6269e675a066",
		);
		expect(D780_BUDGET_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	it("replays the complete injected six-arm D779 provider-envelope qualification", async () => {
		const bundle = validateD779QualificationBundle(
			await runD779InjectedNoNetworkQualification(createD779InjectedBaselineForTest()),
		);
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.graphEvidence.ledger.maxActiveArms).toBe(1);
		expect(bundle.routeEvidence.coverageComplete).toBe(true);
		expect(bundle.routeEvidence.facts).toHaveLength(bundle.qualification.providerCalls as number);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.qualification.credentialReads).toBe(0);
		expect(bundle.qualification.workspaceResidueCount).toBe(0);
		validateD780TaskToolFactsForTest({
			taskExposureFacts: bundle.taskExposureFacts,
			toolRejectionFacts: bundle.toolRejectionFacts,
			graphEvidence: bundle.graphEvidence,
			routeEvidence: bundle.routeEvidence,
		});
		validateD780ToolRejectionFactsForTest({
			toolRejectionFacts: bundle.diagnosticToolRejectionFacts,
			graphEvidence: bundle.toolRejectionGraphEvidence,
		});
		validateD780ToolRejectionFactsForTest({
			toolRejectionFacts: [],
			graphEvidence: bundle.wrongToolGraphEvidence,
		});
	}, 30_000);

	it("binds the current implementation and makes the durable claim exclusive", async () => {
		expect(await measureD780Implementation()).toBe(D780_IMPLEMENTATION_MANIFEST_DIGEST);
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d780-claim-"));
		await chmod(root, 0o700);
		try {
			const input = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: D780_IMPLEMENTATION_MANIFEST_DIGEST,
			};
			await acquireD780SingleUseDispatchClaimAtRootForTest(await realpath(root), input);
			await expect(
				acquireD780SingleUseDispatchClaimAtRootForTest(await realpath(root), input),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps Graph-synthesized failed tool effects separate from sanitized tool rejections", () => {
		for (const cause of ["executor-threw", "graph-admission-denied"] as const) {
			const requestDigest = sha(`request-${cause}`);
			expect(
				isD780GraphSynthesizedToolFailureForTest({
					kind: "graph-effect-result-admitted",
					request: { effectKind: "tool-action", requestDigest },
					result: {
						effectKind: "tool-action",
						status: "failed",
						evidenceDigest: empiricalStrictJsonDigest({ requestDigest, cause }),
					},
				}),
			).toBe(true);
		}
		const requestDigest = sha("sanitized-rejection");
		expect(
			isD780GraphSynthesizedToolFailureForTest({
				kind: "graph-effect-result-admitted",
				request: { effectKind: "tool-action", requestDigest },
				result: {
					effectKind: "tool-action",
					status: "failed",
					evidenceDigest: sha("sanitized-rejection-evidence"),
				},
			}),
		).toBe(false);
	});
});
