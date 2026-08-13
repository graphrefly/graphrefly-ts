import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createD759PersistenceFaultForTest,
	D759_GENERATION_REF,
	persistD759QualificationBundle,
	runD759InjectedNoNetworkQualification,
	validateD759QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d759-hidden-verifier-correction-qualification.js";

describe("D759 Graph hidden-verifier correction", () => {
	it("qualifies six serial arms, one correction per run, exact named mutation, and retry identity", async () => {
		const bundle = await runD759InjectedNoNetworkQualification();
		const replay = validateD759QualificationBundle(bundle);
		expect(replay.graphEvidence.runStatus).toBe("complete");
		expect(replay.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(replay.graphEvidence.completionContexts).toHaveLength(48);
		expect(replay.qualification).toMatchObject({
			providerRequestCount: 55,
			retryWaitCount: 1,
			maxActiveArms: 1,
			maxActiveEffects: 1,
			workspaceResidueCount: 0,
			providerNetworkCalls: 0,
			materialFree: true,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		const forged = structuredClone(bundle) as Record<string, unknown>;
		const qualification = forged.qualification as Record<string, unknown>;
		qualification.providerRequestCount = 54;
		expect(() => validateD759QualificationBundle(forged)).toThrow();
	}, 30_000);

	it("persists atomically and cleans exact owned generations after injected failures", async () => {
		const parent = await mkdtemp(join(tmpdir(), "graphrefly-d759-"));
		try {
			const rootPath = join(parent, "private");
			await mkdir(rootPath, { mode: 0o700 });
			await chmod(rootPath, 0o700);
			const root = await realpath(rootPath);
			for (const stage of ["after-write", "after-rename"] as const) {
				const bundle = await runD759InjectedNoNetworkQualification();
				await expect(
					persistD759QualificationBundle({
						privateRoot: root,
						bundle,
						fault: createD759PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow();
				expect(await readdir(root)).toEqual([]);
			}
			const bundle = await runD759InjectedNoNetworkQualification();
			const receipt = await persistD759QualificationBundle({ privateRoot: root, bundle });
			expect(receipt).toMatchObject({
				generationRef: D759_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
			});
			const generationRoot = join(root, D759_GENERATION_REF);
			expect((await lstat(generationRoot)).mode & 0o777).toBe(0o700);
			expect((await lstat(join(generationRoot, "commit.v1.json"))).mode & 0o777).toBe(0o600);
			await expect(
				persistD759QualificationBundle({
					privateRoot: root,
					bundle: await runD759InjectedNoNetworkQualification(),
				}),
			).rejects.toThrow();
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	}, 60_000);
});
