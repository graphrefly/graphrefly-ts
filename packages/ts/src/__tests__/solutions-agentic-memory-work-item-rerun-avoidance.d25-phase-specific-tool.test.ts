import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD25InjectedBaselineForTest,
	validateD25PhaseEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.js";
import {
	D25_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD25Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-implementation-manifest.js";
import {
	D25_INJECTED_GENERATION_REF,
	type D25QualificationBundleV1,
	persistD25InjectedQualificationForTest,
	runD25InjectedNoNetworkQualification,
	validateD25QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-qualification.js";

describe("D25 Graph-owned phase-specific tool admission", () => {
	let bundle: D25QualificationBundleV1;
	let privateRoot: string;

	beforeAll(async () => {
		bundle = await runD25InjectedNoNetworkQualification({
			baseline: createD25InjectedBaselineForTest(),
			basis: "injected-test",
			implementationManifestDigest: D25_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d25-test-")));
		await chmod(privateRoot, 0o700);
	}, 300_000);

	afterAll(async () => {
		if (privateRoot !== undefined) await rm(privateRoot, { recursive: true, force: true });
	});

	it("qualifies six serial arms, exact mutation lowering, retries, and D24 near misses", () => {
		const validated = validateD25QualificationBundle(bundle);
		expect(validated.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			graphOwnedNamedInspectionPassed: true,
			graphOwnedNamedMutationPassed: true,
			singleMutationProposalPassed: true,
			graphSerialDiffAndFocusedValidationPassed: true,
			semanticCorrectionPassed: true,
			d24NearMissMatrixPassed: true,
			retryDelayCoverageMs: [1_000, 7_000, 60_000],
			providerNetworkCalls: 0,
			maxActiveEffects: 1,
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

	it("binds canonical evidence and rejects projection/accessor substitution", () => {
		const forged = structuredClone(bundle);
		(forged.mainEvidence.phaseFacts[0] as unknown as Record<string, unknown>).disposition =
			"accepted-mutation";
		expect(() => validateD25QualificationBundle(forged)).toThrow(/digest|canonical|lifecycle/iu);

		const accessor = Object.create(null) as Record<string, unknown>;
		let reads = 0;
		Object.defineProperty(accessor, "schemaVersion", {
			enumerable: true,
			get() {
				reads += 1;
				return bundle.schemaVersion;
			},
		});
		expect(() => validateD25QualificationBundle(accessor)).toThrow(
			/own data property|unexpected keys/iu,
		);
		expect(reads).toBe(0);
		expect(JSON.stringify(bundle)).not.toMatch(
			/raw(?:Body|Header|Response|Arguments)|stack|Bearer|sk-or-/u,
		);

		const redigested = structuredClone(bundle.mainEvidence);
		const phaseFact = redigested.phaseFacts.find(
			(fact) => fact.disposition === "accepted-mutation",
		) as unknown as Record<string, unknown>;
		phaseFact.phaseBefore = "none";
		const { factDigest: _factDigest, ...factBase } = phaseFact;
		phaseFact.factDigest = empiricalStrictJsonDigest(factBase);
		const { evidenceDigest: _evidenceDigest, ...evidenceBase } = redigested;
		(redigested as unknown as Record<string, unknown>).evidenceDigest =
			empiricalStrictJsonDigest(evidenceBase);
		expect(() => validateD25PhaseEvidence(redigested)).toThrow(/directive|binding/iu);
	});

	it("atomically persists private injected evidence and consumes construction once", async () => {
		const receipt = await persistD25InjectedQualificationForTest({ privateRoot, bundle });
		const artifact = join(privateRoot, D25_INJECTED_GENERATION_REF, "artifacts", "bundle.v1.json");
		expect((await stat(artifact)).mode & 0o777).toBe(0o600);
		expect(receipt.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
		await expect(persistD25InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
			/not constructed|replayed/iu,
		);
	});

	it("binds qualification to the frozen D25 implementation", async () => {
		expect(await measureD25Implementation(resolve(import.meta.dirname, "../../../.."))).toBe(
			D25_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});
});
