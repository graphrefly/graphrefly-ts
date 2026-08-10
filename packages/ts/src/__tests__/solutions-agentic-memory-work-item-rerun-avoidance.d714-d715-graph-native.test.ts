import { chmod, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createD714D715Scorecard,
	D714_D715_ARM_ORDER,
	D714_D715_QUALIFIED_EVIDENCE_DIGEST,
	D714_D715_QUALIFIED_SCORECARD_DIGEST,
	persistD714D715PrivateGeneration,
	runD714D715GraphNativeQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d714-d715-graph-native-qualification.js";

describe("D714/D715 Graph-native offline qualification", () => {
	it("admits all six arms independently and preserves D713 partial progress", () => {
		const qualification = runD714D715GraphNativeQualification();
		expect(qualification.measurement.admittedArms).toEqual(D714_D715_ARM_ORDER);
		expect(qualification.measurement.issuedRequestCount).toBe(6);
		expect(qualification.measurement.topology).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ factory: "d714IndependentArmAdmission" }),
				expect.objectContaining({ factory: "d714OrderedPhaseProjection" }),
				expect.objectContaining({ factory: "workItemExecutionRequestFacts" }),
			]),
		);
		expect(qualification.measurement.warmArmsIndependentOfCold).toBe(true);
		expect(qualification.measurement.coldPhase).toBe("workspace-diff");
		expect(qualification.measurement.coldEvaluable).toBe(true);
		expect(qualification.gates.workItemRecipeUsed).toBe(true);
		expect(qualification.gates.noNetwork).toBe(true);
		expect(qualification.gates.providerCallCount).toBe(0);
		expect(qualification.gates.chargedCostMicrousd).toBe(0);
	});

	it("derives phase-directed recovery for D713 plus two generic fixtures", () => {
		const qualification = runD714D715GraphNativeQualification();
		expect(qualification.recovery.d713NextRequiredPhase).toBe("correction-first");
		expect(qualification.recovery.genericCaseCount).toBe(2);
		expect(qualification.recovery.issuedRequestCount).toBe(3);
		expect(qualification.recovery.duplicateEffectRunSuppressionPassed).toBe(true);
		expect(qualification.recovery.rejectedBatchZeroSideEffects).toBe(true);
		expect(qualification.recovery.decisions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					caseId: "generic-mutation-missing",
					nextRequiredPhase: "exact-mutation",
				}),
				expect.objectContaining({
					caseId: "generic-diff-missing",
					nextRequiredPhase: "workspace-diff",
				}),
				expect.objectContaining({
					caseId: "stale-provenance",
					admitted: false,
					issueCode: "stale-workspace-provenance",
				}),
			]),
		);
	});

	it("keeps the scorecard claim boundary non-causal and non-efficacy", () => {
		const qualification = runD714D715GraphNativeQualification();
		const scorecard = createD714D715Scorecard(qualification);
		expect(scorecard).toMatchObject({
			qualified: true,
			admittedArmCount: 6,
			recoveryCaseCount: 3,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(qualification.evidenceDigest).toBe(D714_D715_QUALIFIED_EVIDENCE_DIGEST);
		expect(scorecard.scorecardDigest).toBe(D714_D715_QUALIFIED_SCORECARD_DIGEST);
		expect(qualification.gates.accessorRejectedBeforeRead).toBe(true);
	});

	it("persists one atomic 0700/0600 material-free generation", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d714-d715-"));
		await chmod(root, 0o700);
		try {
			const qualification = runD714D715GraphNativeQualification();
			const scorecard = createD714D715Scorecard(qualification);
			const receipt = await persistD714D715PrivateGeneration({
				privateRoot: root,
				generationRef: "d714-d715-offline-v1",
				qualification,
				scorecard,
			});
			for (const file of ["qualification.v1.json", "scorecard.v1.json", "generation.v1.json"]) {
				const path = join(receipt.generationPath, file);
				const status = await lstat(path);
				expect(status.mode & 0o777).toBe(0o600);
				const text = await readFile(path, "utf8");
				expect(text).not.toMatch(/sk-or-|credential|expectedPatch|rawBody|rawHeader/);
			}
			await expect(
				persistD714D715PrivateGeneration({
					privateRoot: root,
					generationRef: "d714-d715-offline-v1",
					qualification: JSON.parse(JSON.stringify(qualification)),
					scorecard: JSON.parse(JSON.stringify(scorecard)),
				}),
			).rejects.toThrow(/same-process/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	it("fails duplicate persistence without staging residue", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d714-d715-failure-"));
		await chmod(root, 0o700);
		try {
			const firstQualification = runD714D715GraphNativeQualification();
			const firstScorecard = createD714D715Scorecard(firstQualification);
			await persistD714D715PrivateGeneration({
				privateRoot: root,
				generationRef: "d714-d715-offline-failure-v1",
				qualification: firstQualification,
				scorecard: firstScorecard,
			});
			const qualification = runD714D715GraphNativeQualification();
			const scorecard = createD714D715Scorecard(qualification);
			await expect(
				persistD714D715PrivateGeneration({
					privateRoot: root,
					generationRef: "d714-d715-offline-failure-v1",
					qualification,
					scorecard,
				}),
			).rejects.toThrow(/already exists/);
			expect(
				(await readdir(root)).filter((item) => item.startsWith(".d714-d715-staging-")),
			).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
