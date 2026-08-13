import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD761InjectedBaselineForTest,
	createD761PersistenceFaultForTest,
	D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D761_TEST_GENERATION_REF,
	evaluateD761PublicAcceptanceProjection,
	persistD761QualificationBundle,
	runD761InjectedNoNetworkQualification,
	validateD761QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d761-public-semantic-validation-qualification.js";

async function runQualification() {
	return runD761InjectedNoNetworkQualification(createD761InjectedBaselineForTest());
}

describe("D761 Graph public semantic validation", () => {
	it("qualifies six serial arms with one criterion correction and independent hidden verification", async () => {
		const bundle = await runQualification();
		const replay = validateD761QualificationBundle(bundle);
		expect(replay.graphEvidence.runStatus).toBe("complete");
		expect(replay.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(replay.qualification).toMatchObject({
			semanticValidationCount: 12,
			criterionFailureContinuationCount: 6,
			maxActiveArms: 1,
			maxActiveEffects: 1,
			workspaceResidueCount: 0,
			positiveDifferentialGateDefinitionDigest: D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
			liveGateEvaluated: false,
			publicCriteriaOnly: true,
			hiddenVerifierIndependent: true,
			hiddenMaterialReferenced: false,
			providerNetworkCalls: 0,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		const forged = structuredClone(bundle) as Record<string, unknown>;
		const qualification = forged.qualification as Record<string, unknown>;
		qualification.semanticValidationCount = 11;
		expect(() => validateD761QualificationBundle(forged)).toThrow();
		const stateDrift = structuredClone(bundle) as Record<string, unknown>;
		const graph = stateDrift.graphEvidence as Record<string, unknown>;
		const runs = graph.effectRuns as Array<Record<string, unknown>>;
		const facts = runs[0]!.facts as Array<Record<string, unknown>>;
		const semantic = facts.find(
			(fact) =>
				(fact.result as Record<string, unknown>)?.effectKind === "public-semantic-validation",
		)!;
		(semantic.result as Record<string, unknown>).workspaceStateDigest = empiricalStrictJsonDigest({
			forged: "state-drift",
		});
		expect(() => validateD761QualificationBundle(stateDrift)).toThrow();
		const accessor = { ...bundle } as Record<string, unknown>;
		Object.defineProperty(accessor, "qualification", {
			enumerable: true,
			get: () => bundle.qualification,
		});
		expect(() => validateD761QualificationBundle(accessor)).toThrow(/own data property/);
		expect(JSON.stringify(bundle)).not.toMatch(
			/canonicalTupleKey|parseCanonicalTupleKey|expected patch/i,
		);
	}, 30_000);

	it("freezes the future Graph-derived gate and evaluates only public acceptance projections", () => {
		expect(D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST).toMatch(/^sha256:/);
		expect(
			evaluateD761PublicAcceptanceProjection({
				canonicalProvenanceAdmitted: false,
				malformedProvenanceRejected: false,
				localReconstructionRejected: false,
				authorizationInvariantPreserved: false,
			}),
		).toEqual([
			"canonical-provenance-not-admitted",
			"malformed-provenance-not-rejected",
			"local-reconstruction-not-rejected",
			"authorization-invariant-regressed",
		]);
		expect(
			evaluateD761PublicAcceptanceProjection({
				canonicalProvenanceAdmitted: true,
				malformedProvenanceRejected: true,
				localReconstructionRejected: true,
				authorizationInvariantPreserved: true,
			}),
		).toEqual([]);
	});

	it("persists a same-process qualification privately and rejects duplicate publication", async () => {
		const parent = await mkdtemp(join(tmpdir(), "graphrefly-d761-"));
		try {
			const requestedRoot = join(parent, "private");
			await mkdir(requestedRoot, { mode: 0o700 });
			await chmod(requestedRoot, 0o700);
			const root = await realpath(requestedRoot);
			for (const stage of ["after-write", "after-claim", "after-commit"] as const) {
				await expect(
					persistD761QualificationBundle({
						privateRoot: root,
						bundle: await runQualification(),
						fault: createD761PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow();
				expect(await readdir(root)).toEqual([]);
			}
			const bundle = await runQualification();
			const receipt = await persistD761QualificationBundle({ privateRoot: root, bundle });
			expect(receipt).toMatchObject({
				generationRef: D761_TEST_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
			});
			expect((await lstat(join(root, D761_TEST_GENERATION_REF))).mode & 0o777).toBe(0o700);
			expect(
				(await lstat(join(root, D761_TEST_GENERATION_REF, "artifacts", "bundle.v1.json"))).mode &
					0o777,
			).toBe(0o600);
			expect(
				(await lstat(join(root, D761_TEST_GENERATION_REF, "commit.v1.json"))).mode & 0o777,
			).toBe(0o600);
			await expect(
				persistD761QualificationBundle({
					privateRoot: root,
					bundle: await runQualification(),
				}),
			).rejects.toThrow();
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	}, 60_000);
});
