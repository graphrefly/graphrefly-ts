import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_GRAPH_ARMS } from "../../evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.js";
import { D9_PROVIDER_REJECTION_CAUSES } from "../../evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.js";
import {
	correctionDirectiveFromFact,
	createD21InjectedBaselineForTest,
	D21_EXPOSURE_MATRIX,
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D21_TASK_PROFILE,
	persistD21InjectedQualificationForTest,
	runD21InjectedNoNetworkQualification,
	validateD21QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.js";
import { D21_IMPLEMENTATION_MANIFEST_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-implementation-manifest.js";

describe("D21 current Graph-native efficacy recovery", () => {
	it("qualifies exact six-arm semantic correction and provider rejection evidence with no network", async () => {
		const bundle = validateD21QualificationBundle(
			await runD21InjectedNoNetworkQualification({
				baseline: createD21InjectedBaselineForTest(),
				implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
			}),
		);
		expect(bundle.qualification.liveGateEvaluated).toBe(false);
		expect(bundle.qualification.efficacyClaim).toBe("none");
		expect(bundle.qualification.semanticRecoveryCount).toBe(6);
		expect(bundle.qualification.semanticCorrectionContextCount).toBe(6);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.recoveryEvidence.providerEvidence.workflowEvidence.runs).toHaveLength(6);
		expect(
			bundle.recoveryEvidence.providerEvidence.workflowEvidence.runs.map((run) => run.arm),
		).toEqual(CURRENT_GRAPH_ARMS);
		expect(
			bundle.recoveryEvidence.providerEvidence.workflowEvidence.runs.every(
				(run) =>
					run.status === "completed" &&
					run.semanticRecoveryUsed &&
					run.publicSemanticValidationPassed &&
					run.hiddenVerifierPassed &&
					run.cleanupStatus === "completed",
			),
		).toBe(true);
		expect(bundle.rejectionEvidence.rejectionFacts.map((fact) => fact.causeCode)).toEqual(
			D9_PROVIDER_REJECTION_CAUSES,
		);
		expect(
			bundle.rejectionEvidence.rejectionFacts.every(
				(fact) =>
					fact.reconciliation.actualCostMicrousd === fact.request.reservation.maxCostMicrousd &&
					fact.reconciliation.actualElapsedMs === fact.request.reservation.maxElapsedMs,
			),
		).toBe(true);
	}, 15_000);

	it("binds one Graph-authored material-free criterion correction to every run", async () => {
		const bundle = await runD21InjectedNoNetworkQualification({
			baseline: createD21InjectedBaselineForTest(),
			implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		for (let runSequence = 0; runSequence < CURRENT_GRAPH_ARMS.length; runSequence += 1) {
			const directive = correctionDirectiveFromFact(bundle.recoveryEvidence, runSequence);
			expect(directive.reason).toBe("public-semantic-validation-failed");
			expect(directive.stage).toBe("semantic-correction");
			expect(directive.requiredFirstToolRef).toBe("replace-exact");
			expect(directive.criterionFailures).toEqual(["local-reconstruction-not-rejected"]);
			expect(directive.remainingProviderRequests).toBeGreaterThan(0);
			expect(directive.remainingEffectFacts).toBeGreaterThan(0);
		}
		expect(bundle.qualification.positiveDifferentialGateDefinitionDigest).toBe(
			D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		);
		expect(D21_TASK_PROFILE.armContexts).toHaveLength(6);
		expect(D21_TASK_PROFILE.armContexts[1]).toContain(
			D21_EXPOSURE_MATRIX["relevant-applied"].disposition,
		);
	}, 15_000);

	it("stops a second public-semantic failure arm-locally and never reaches hidden verification", async () => {
		const bundle = await runD21InjectedNoNetworkQualification({
			baseline: createD21InjectedBaselineForTest(),
			implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const evidence = bundle.secondFailureEvidence.providerEvidence.workflowEvidence;
		expect(evidence.runs).toHaveLength(6);
		expect(
			evidence.runs.every(
				(run) =>
					run.status === "incomplete" &&
					run.semanticRecoveryUsed &&
					!run.publicSemanticValidationPassed &&
					!run.hiddenVerifierAttempted &&
					run.cleanupStatus === "completed",
			),
		).toBe(true);
		expect(
			evidence.findings.filter((finding) => finding.code === "public-semantic-validation-failed"),
		).toHaveLength(12);
	}, 15_000);

	it("rejects baseline replay and qualification claim substitution", async () => {
		await expect(
			runD21InjectedNoNetworkQualification(
				Object.defineProperty(
					{ implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST },
					"baseline",
					{ enumerable: true, get: () => createD21InjectedBaselineForTest() },
				) as {
					baseline: ReturnType<typeof createD21InjectedBaselineForTest>;
					implementationManifestDigest: string;
				},
			),
		).rejects.toThrow(/own data property/iu);
		const manifestBaseline = createD21InjectedBaselineForTest();
		await expect(
			runD21InjectedNoNetworkQualification({
				baseline: manifestBaseline,
				implementationManifestDigest: `sha256:${"0".repeat(64)}`,
			}),
		).rejects.toThrow(/implementation manifest digest drifted/iu);
		await runD21InjectedNoNetworkQualification({
			baseline: manifestBaseline,
			implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const baseline = createD21InjectedBaselineForTest();
		await runD21InjectedNoNetworkQualification({
			baseline,
			implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		await expect(
			runD21InjectedNoNetworkQualification({
				baseline,
				implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
			}),
		).rejects.toThrow(/forged or replayed/iu);
		const bundle = await runD21InjectedNoNetworkQualification({
			baseline: createD21InjectedBaselineForTest(),
			implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const forged = structuredClone(bundle);
		(forged.qualification as { semanticRecoveryCount: number }).semanticRecoveryCount = 5;
		expect(() => validateD21QualificationBundle(forged)).toThrow(/claims drifted|digest drifted/iu);
	}, 15_000);

	it("persists one private atomic injected generation and rejects replay", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d21-")));
		await chmod(privateRoot, 0o700);
		try {
			const bundle = await runD21InjectedNoNetworkQualification({
				baseline: createD21InjectedBaselineForTest(),
				implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
			});
			await expect(
				persistD21InjectedQualificationForTest(
					Object.defineProperty({ bundle }, "privateRoot", {
						enumerable: true,
						get: () => privateRoot,
					}) as { privateRoot: string; bundle: typeof bundle },
				),
			).rejects.toThrow(/own data property/iu);
			const receipt = await persistD21InjectedQualificationForTest({ privateRoot, bundle });
			expect(receipt.artifactDigests["bundle.v1.json"]).toMatch(/^sha256:[0-9a-f]{64}$/u);
			await expect(persistD21InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
				/not constructed/iu,
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 15_000);
});
