import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD26PhaseSpecificRealProviderExecutor } from "../../evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-composition.js";
import {
	D26_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD26Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-implementation-manifest.js";
import {
	createD26InjectedBaselineForTest,
	D26_INJECTED_GENERATION_REF,
	type D26QualificationBundleV1,
	persistD26InjectedQualificationForTest,
	runD26InjectedNoNetworkQualification,
	validateD26QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-qualification.js";

describe("D26 phase-specific real-provider-capable composition", () => {
	let bundle: D26QualificationBundleV1;
	let privateRoot: string;
	const repositoryRoot = resolve(import.meta.dirname, "../../../..");

	beforeAll(async () => {
		bundle = await runD26InjectedNoNetworkQualification({
			baseline: createD26InjectedBaselineForTest(),
			implementationManifestDigest: D26_IMPLEMENTATION_MANIFEST_DIGEST,
			repositoryRoot,
		});
		privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d26-test-")));
		await chmod(privateRoot, 0o700);
	}, 300_000);

	afterAll(async () => {
		if (privateRoot !== undefined) await rm(privateRoot, { recursive: true, force: true });
	});

	it("qualifies all six real workspaces with exact named final wire and Graph successors", () => {
		const validated = validateD26QualificationBundle(bundle);
		expect(validated.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			realWorkspaceLifecyclePassed: true,
			exactNamedFinalWirePassed: true,
			singleProviderMutationPassed: true,
			graphDeterministicSuccessorsPassed: true,
			semanticCorrectionCount: 6,
			nearMissIsolationPassed: true,
			retryIdentityPassed: true,
			retryDelayCoverageMs: [1_000, 7_000, 60_000],
			providerNetworkCalls: 0,
			maxActiveEffects: 1,
			workspaceResidueCount: 0,
			liveGateEvaluated: false,
			efficacyClaim: "none",
			qualified: true,
		});
		expect(
			validated.mainEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs,
		).toHaveLength(6);
		expect(
			validated.nearMissEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs,
		).toHaveLength(6);
	});

	it("rejects self-consistent claim substitution and accessor input", () => {
		const forged = structuredClone(bundle) as unknown as Record<string, unknown>;
		const qualification = forged.qualification as Record<string, unknown>;
		qualification.exactNamedFinalWirePassed = false;
		const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
		qualification.qualificationDigest = empiricalStrictJsonDigest(qualificationMaterial);
		const generation = forged.generation as Record<string, unknown>;
		generation.qualificationDigest = qualification.qualificationDigest;
		const { generationDigest: _generationDigest, ...generationMaterial } = generation;
		generation.generationDigest = empiricalStrictJsonDigest(generationMaterial);
		const { bundleDigest: _bundleDigest, ...bundleMaterial } = forged;
		forged.bundleDigest = empiricalStrictJsonDigest(bundleMaterial);
		expect(() => validateD26QualificationBundle(forged)).toThrow(/coordinates drifted/iu);

		const accessor = Object.create(null) as Record<string, unknown>;
		let reads = 0;
		Object.defineProperty(accessor, "schemaVersion", {
			enumerable: true,
			get() {
				reads += 1;
				return bundle.schemaVersion;
			},
		});
		expect(() => validateD26QualificationBundle(accessor)).toThrow(
			/own data property|unexpected keys/iu,
		);
		expect(reads).toBe(0);
		expect(JSON.stringify(bundle)).not.toMatch(
			/raw(?:Body|Header|Response|Arguments)|stack|Bearer|sk-or-/u,
		);
	});

	it("requires a real D25 Graph authority before any transport", async () => {
		let transportCalls = 0;
		const executor = createD26PhaseSpecificRealProviderExecutor({
			authority: Object.freeze({}) as never,
			repositoryRoot,
			materializationRoot: join(privateRoot, "forged-authority-workspaces"),
			credential: Object.freeze({
				bearerToken: "injected-only-never-sent",
				credentialBindingRef: "openrouter.local-eval-2",
				credentialBindingRevision: "2026-08-14.v1",
			}),
			fetchImpl: async () => {
				transportCalls += 1;
				return new Response("{}");
			},
		});
		await expect(executor.executeNext()).rejects.toThrow(/authority|unknown/iu);
		expect(transportCalls).toBe(0);
		await executor.dispose();
	});

	it("atomically persists private injected evidence and consumes construction once", async () => {
		const receipt = await persistD26InjectedQualificationForTest({ privateRoot, bundle });
		const artifact = join(privateRoot, D26_INJECTED_GENERATION_REF, "artifacts", "bundle.v1.json");
		expect((await stat(artifact)).mode & 0o777).toBe(0o600);
		expect(receipt.artifactDigests["bundle.v1.json"]).toMatch(/^sha256:[0-9a-f]{64}$/u);
		await expect(persistD26InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
			/not same-process constructed|replayed/iu,
		);
	});

	it("binds qualification to the frozen D26 implementation", async () => {
		expect(await measureD26Implementation(repositoryRoot)).toBe(D26_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
