import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D37_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD37Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d37-premature-final-implementation-manifest.js";
import {
	createD37InjectedBaselineForTest,
	persistD37Qualification,
	runD37InjectedNoNetworkQualification,
	validateD37QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d37-premature-final-qualification.js";

describe("graphrefly-ts:D37 premature structured-final phase recovery", () => {
	it("binds the exact D37 decision-bearing implementation closure", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD37Implementation(repositoryRoot)).toBe(D37_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("qualifies six Graph-owned same-phase recoveries with no network", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d37-test-"));
		try {
			const constructed = await runD37InjectedNoNetworkQualification({
				baseline: createD37InjectedBaselineForTest(),
				repositoryRoot,
				materializationRoot: join(root, "workspaces"),
			});
			const bundle = validateD37QualificationBundle(constructed);
			expect(bundle.qualification.prematureFinalFactCount).toBe(6);
			expect(bundle.qualification.phaseRetryContextCount).toBe(6);
			expect(bundle.qualification.secondFailureStoppedLocally).toBe(true);
			expect(bundle.qualification.insufficientHeadroomStoppedBeforeContext).toBe(true);
			expect(bundle.qualification.providerTransportCalls).toBe(31);
			expect(bundle.qualification.providerNetworkCalls).toBe(0);
			expect(bundle.qualification.efficacyClaim).toBe("none");
			expect(JSON.stringify(bundle)).not.toContain("bounded injected final");
			await expect(
				persistD37Qualification({ privateRoot: join(root, "private"), bundle: constructed }),
			).rejects.toThrow("requires consumed D36 artifact bytes");
			await expect(lstat(join(root, "private"))).rejects.toMatchObject({ code: "ENOENT" });
			await expect(
				persistD37Qualification({ privateRoot: join(root, "private-2"), bundle: constructed }),
			).rejects.toThrow("was not constructed");
			const qualificationBase = {
				...bundle.qualification,
				secondFailureEvidenceDigest: bundle.evidence.evidenceDigest,
			};
			delete (qualificationBase as { qualificationDigest?: string }).qualificationDigest;
			const qualification = {
				...qualificationBase,
				qualificationDigest: empiricalStrictJsonDigest(qualificationBase),
			};
			const generationBase = {
				...bundle.generation,
				qualificationDigest: qualification.qualificationDigest,
			};
			delete (generationBase as { generationDigest?: string }).generationDigest;
			const generation = {
				...generationBase,
				generationDigest: empiricalStrictJsonDigest(generationBase),
			};
			const forgedMaterial = {
				schemaVersion: bundle.schemaVersion,
				baselineBasis: bundle.baselineBasis,
				evidence: bundle.evidence,
				headroomEvidence: bundle.headroomEvidence,
				secondFailureEvidence: bundle.evidence,
				qualification,
				generation,
			};
			expect(() =>
				validateD37QualificationBundle({
					...forgedMaterial,
					bundleDigest: empiricalStrictJsonDigest(forgedMaterial),
				}),
			).toThrow("second-failure");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);

	it("rejects baseline and bundle replay", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d37-replay-"));
		const baseline = createD37InjectedBaselineForTest();
		try {
			await runD37InjectedNoNetworkQualification({
				baseline,
				repositoryRoot,
				materializationRoot: join(root, "first"),
			});
			await expect(
				runD37InjectedNoNetworkQualification({
					baseline,
					repositoryRoot,
					materializationRoot: join(root, "second"),
				}),
			).rejects.toThrow("forged or replayed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);
});
