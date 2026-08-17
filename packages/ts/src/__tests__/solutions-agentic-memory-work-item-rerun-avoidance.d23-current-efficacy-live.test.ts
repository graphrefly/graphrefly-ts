import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { D23_GENERATION_REF } from "../../evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-coordinates.js";
import {
	D23_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD23Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-implementation-manifest.js";
import {
	createD23QualificationInjectedBaselineForTest,
	type D23QualificationBundleV1,
	persistD23InjectedQualificationForTest,
	runD23InjectedNoNetworkQualification,
	validateD23QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-qualification.js";

describe("D23 current Graph-native efficacy live composition", () => {
	let bundle: D23QualificationBundleV1;
	let privateRoot: string;

	beforeAll(async () => {
		bundle = await runD23InjectedNoNetworkQualification({
			baseline: createD23QualificationInjectedBaselineForTest(),
			implementationManifestDigest: D23_IMPLEMENTATION_MANIFEST_DIGEST,
			repositoryRoot: resolve(import.meta.dirname, "../../../.."),
		});
		privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d23-test-")));
		await chmod(privateRoot, 0o700);
	}, 300_000);

	afterAll(async () => {
		if (privateRoot !== undefined) await rm(privateRoot, { recursive: true, force: true });
	});

	it("qualifies the exact six-arm live composition without network or efficacy claims", () => {
		const validated = validateD23QualificationBundle(bundle);
		expect(validated.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			semanticRecoveryCount: 6,
			retryDelayCoverageMs: [1_000, 7_000, 60_000],
			ordinaryProviderDeadlineMs: 120_000,
			semanticCorrectionProviderDeadlineMs: 240_000,
			providerAttempts: 21,
			providerNetworkCalls: 0,
			workspaceResidueCount: 0,
			liveGateEvaluated: false,
			efficacyClaim: "none",
			qualified: true,
		});
		expect(validated.mainBundle.graphEvidence?.providerEvidence.workflowEvidence.runs).toHaveLength(
			6,
		);
		expect(validated.partialBundle).toMatchObject({
			disposition: "partial-failure",
			generation: null,
			efficacyClaim: "none",
		});
	});

	it("binds qualification to the exact measured D23 implementation", async () => {
		expect(await measureD23Implementation(resolve(import.meta.dirname, "../../../.."))).toBe(
			D23_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});

	it("rejects projection substitution, accessor input, and raw credential persistence", () => {
		const forged = structuredClone(bundle);
		(forged.mainBundle.terminalReceipt as Record<string, unknown>).providerAttempts = 20;
		expect(() => validateD23QualificationBundle(forged)).toThrow(/terminal receipt drifted/iu);

		const accessor = Object.create(null) as Record<string, unknown>;
		let reads = 0;
		Object.defineProperty(accessor, "schemaVersion", {
			enumerable: true,
			get() {
				reads += 1;
				return bundle.schemaVersion;
			},
		});
		expect(() => validateD23QualificationBundle(accessor)).toThrow(
			/own data property|unexpected keys/iu,
		);
		expect(reads).toBe(0);

		const encoded = JSON.stringify(bundle);
		expect(encoded).not.toContain("sk-or-v1-test-current-graph-efficacy-d23");
		expect(encoded).not.toMatch(/raw(?:Body|Header|Response|Arguments)|stack|bearerToken/u);
	});

	it("atomically persists success and partial evidence and consumes construction once", async () => {
		const receipt = await persistD23InjectedQualificationForTest({ privateRoot, bundle });
		for (const directory of ["live-success", "live-partial"] as const) {
			const artifact = join(
				privateRoot,
				directory,
				D23_GENERATION_REF,
				"artifacts",
				"bundle.v1.json",
			);
			expect((await stat(artifact)).mode & 0o777).toBe(0o600);
		}
		expect(receipt.successPersistenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
		expect(receipt.partialPersistenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
		await expect(persistD23InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
			/not constructed/iu,
		);
	});
});
