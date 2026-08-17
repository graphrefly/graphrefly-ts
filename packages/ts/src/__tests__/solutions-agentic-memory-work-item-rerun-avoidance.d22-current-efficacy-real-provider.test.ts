import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	D22_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD22Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d22-current-efficacy-real-provider-implementation-manifest.js";
import {
	createD22InjectedBaselineForTest,
	type D22QualificationBundleV1,
	persistD22InjectedQualificationForTest,
	runD22GraphComposition,
	runD22InjectedNoNetworkQualification,
	validateD22QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d22-current-efficacy-real-provider-qualification.js";

describe("D22 current Graph-native efficacy real-provider composition", () => {
	let bundle: D22QualificationBundleV1;
	let privateRoot: string;

	beforeAll(async () => {
		bundle = await runD22InjectedNoNetworkQualification({
			baseline: createD22InjectedBaselineForTest(),
			implementationManifestDigest: D22_IMPLEMENTATION_MANIFEST_DIGEST,
			repositoryRoot: resolve(import.meta.dirname, "../../../.."),
		});
		privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d22-test-")));
		await chmod(privateRoot, 0o700);
	}, 300_000);

	afterAll(async () => {
		if (privateRoot !== undefined) await rm(privateRoot, { recursive: true, force: true });
	});

	it("qualifies six real workspace arms with one Graph correction each", () => {
		const validated = validateD22QualificationBundle(bundle);
		expect(validated.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			semanticRecoveryCount: 6,
			semanticCorrectionContextCount: 6,
			retryWaits: 1,
			providerNetworkCalls: 0,
			workspaceResidueCount: 0,
			liveGateEvaluated: false,
			efficacyClaim: "none",
		});
		expect(
			validated.recoveryEvidence.providerEvidence.workflowEvidence.runs.every(
				(run) =>
					run.status === "completed" &&
					run.semanticRecoveryUsed &&
					run.publicSemanticValidationPassed &&
					run.hiddenVerifierPassed &&
					run.cleanupStatus === "completed",
			),
		).toBe(true);
	});

	it("binds the qualification to the exact measured implementation", async () => {
		expect(await measureD22Implementation(resolve(import.meta.dirname, "../../../.."))).toBe(
			D22_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});

	it("admits malformed provider output once with conservative accounting and continues", () => {
		const rejection = bundle.rejectionEvidence.rejectionFacts[0];
		expect(rejection?.causeCode).toBe("provider-result-schema-invalid");
		expect(rejection?.reconciliation.actualCostMicrousd).toBe(
			rejection?.request.reservation.maxCostMicrousd,
		);
		expect(rejection?.reconciliation.actualElapsedMs).toBe(
			rejection?.request.reservation.maxElapsedMs,
		);
		expect(bundle.rejectionEvidence.providerEvidence.workflowEvidence.runs).toHaveLength(6);
		expect(bundle.rejectionEvidence.providerEvidence.workflowEvidence.runs[1]?.arm).toBe(
			"relevant-applied",
		);
	});

	it("rejects canonical claim substitution", () => {
		const forged = structuredClone(bundle);
		(forged.qualification as { semanticRecoveryCount: number }).semanticRecoveryCount = 5;
		expect(() => validateD22QualificationBundle(forged)).toThrow(/claims drifted|digest drifted/iu);
		const extra = structuredClone(bundle) as unknown as Record<string, unknown>;
		extra.extra = true;
		expect(() => validateD22QualificationBundle(extra)).toThrow(/unexpected keys/iu);
	});

	it("rejects an accessor-backed executor before any effect", async () => {
		let calls = 0;
		const executor = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(executor, "execute", {
			enumerable: true,
			get() {
				calls += 1;
				return async () => undefined;
			},
		});
		executor.dispose = async () => undefined;
		await expect(runD22GraphComposition({ executor: executor as never })).rejects.toThrow(
			/own data property/iu,
		);
		expect(calls).toBe(0);
	});

	it("persists a private atomic injected generation and consumes construction once", async () => {
		const receipt = await persistD22InjectedQualificationForTest({ privateRoot, bundle });
		const artifact = join(privateRoot, receipt.generationRef, "artifacts", "bundle.v1.json");
		expect((await stat(artifact)).mode & 0o777).toBe(0o600);
		await expect(persistD22InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
			/not constructed/iu,
		);
	});
});
