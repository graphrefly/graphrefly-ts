import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measureD757Implementation } from "../../evals/empirical-memory-rerun-avoidance/d757-implementation-manifest.js";
import {
	createD757PersistenceFaultForTest,
	D757_GENERATION_REF,
	persistD757NamedToolPreLiveBundle,
	runD757InjectedNoNetworkQualification,
	validateD757NamedToolPreLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d757-named-tool-pre-live.js";

async function privateRoot(): Promise<string> {
	const parent = await mkdtemp(join(tmpdir(), "graphrefly-d757-"));
	const root = join(parent, "private");
	await mkdir(root, { mode: 0o700 });
	await chmod(root, 0o700);
	return realpath(root);
}

describe("D757 named-tool provider-capable pre-live qualification", () => {
	it("binds the exact implementation and completes both six-arm Graph runs", async () => {
		expect(await measureD757Implementation()).toMatch(/^sha256:[a-f0-9]{64}$/);
		const bundle = await runD757InjectedNoNetworkQualification();
		expect(validateD757NamedToolPreLiveBundle(bundle).bundleDigest).toBe(bundle.bundleDigest);
		expect(bundle.graphEvidence.runStatus).toBe("complete");
		expect(bundle.retryGraphEvidence.runStatus).toBe("complete");
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.retryGraphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.qualification).toMatchObject({
			mainProviderCalls: 30,
			retryProviderCalls: 31,
			retryWaitCount: 1,
			retryWireIdentity: true,
			providerNetworkCalls: 0,
			workspaceResidueCount: 0,
		});
	}, 30_000);

	it("rejects coordinated evidence drift during canonical replay", async () => {
		const bundle = await runD757InjectedNoNetworkQualification();
		const forged = structuredClone(bundle) as Record<string, unknown>;
		const qualification = forged.qualification as Record<string, unknown>;
		qualification.retryWireIdentity = false;
		expect(() => validateD757NamedToolPreLiveBundle(forged)).toThrow();
		let getterHits = 0;
		expect(() =>
			validateD757NamedToolPreLiveBundle({
				...bundle,
				get qualification() {
					getterHits += 1;
					return bundle.qualification;
				},
			}),
		).toThrow(/own data/);
		expect(getterHits).toBe(0);
	}, 30_000);

	it("persists one exclusive 0700/0600 generation", async () => {
		const root = await privateRoot();
		try {
			const bundle = await runD757InjectedNoNetworkQualification();
			const receipt = await persistD757NamedToolPreLiveBundle({ privateRoot: root, bundle });
			expect(receipt.generationRef).toBe(D757_GENERATION_REF);
			await expect(
				persistD757NamedToolPreLiveBundle({ privateRoot: root, bundle }),
			).rejects.toThrow(/same-process constructed/);
			const finalStat = await lstat(join(root, D757_GENERATION_REF));
			expect(finalStat.mode & 0o777).toBe(0o700);
			const bundleStat = await lstat(
				join(root, D757_GENERATION_REF, "artifacts", "bundle.v1.json"),
			);
			expect(bundleStat.mode & 0o777).toBe(0o600);
			await expect(
				persistD757NamedToolPreLiveBundle({
					privateRoot: root,
					bundle: await runD757InjectedNoNetworkQualification(),
				}),
			).rejects.toThrow();
		} finally {
			await rm(join(root, ".."), { recursive: true, force: true });
		}
	}, 30_000);

	it("removes its exact claimed generation after injected persistence faults", async () => {
		for (const stage of ["after-write", "after-rename"] as const) {
			const root = await privateRoot();
			try {
				await expect(
					persistD757NamedToolPreLiveBundle({
						privateRoot: root,
						bundle: await runD757InjectedNoNetworkQualification(),
						fault: createD757PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow();
				await expect(lstat(join(root, D757_GENERATION_REF))).rejects.toMatchObject({
					code: "ENOENT",
				});
			} finally {
				await rm(join(root, ".."), { recursive: true, force: true });
			}
		}
	}, 60_000);
});
