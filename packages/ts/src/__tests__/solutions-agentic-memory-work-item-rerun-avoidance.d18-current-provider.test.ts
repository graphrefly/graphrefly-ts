import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D18_LIMITS,
	D18_ROUTE,
	validateD18Evidence,
} from "../../evals/empirical-memory-rerun-avoidance/d18-current-provider-composition-authority.js";
import {
	D18_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD18Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d18-current-provider-composition-implementation-manifest.js";
import {
	createD18InjectedD17BaselineForTest,
	D18_INJECTED_TEST_GENERATION_REF,
	persistD18InjectedQualificationForTest,
	runD18InjectedNoNetworkQualification,
	validateD18QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d18-current-provider-composition-qualification.js";
import { strictJsonCodec } from "../json/codec.js";

const MANIFEST = `sha256:${"1".repeat(64)}`;

async function bundle() {
	return runD18InjectedNoNetworkQualification({
		baseline: createD18InjectedD17BaselineForTest(),
		implementationManifestDigest: MANIFEST,
		generationRef: D18_INJECTED_TEST_GENERATION_REF,
	});
}

describe("current Graph-native D18 provider composition", () => {
	test("qualifies six serial arms with exact D710 retry and Graph-only accounting", async () => {
		const value = validateD18QualificationBundle(await bundle());
		expect(value.graphEvidence.workflowEvidence.runs.map((run) => run.arm)).toEqual([
			"cold",
			"relevant-applied",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		]);
		expect(value.graphEvidence.budget.providerAttempts).toBe(13);
		expect(value.graphEvidence.budget.retryWaits).toBe(1);
		expect(value.graphEvidence.maxActiveEffects).toBe(1);
		expect(value.qualification.providerNetworkCalls).toBe(0);
		expect(value.qualification.liveGateEvaluated).toBe(false);
		expect(value.qualification.efficacyClaim).toBe("none");
		expect(value.qualification.headroomDeniedBeforeTransport).toBe(true);
		expect(value.qualification.terminalProviderFailureContinued).toBe(true);
	});

	test("rejects accessor evidence and re-digested extra provider material", async () => {
		const value = validateD18QualificationBundle(await bundle());
		const accessor = structuredClone(value.graphEvidence) as any;
		Object.defineProperty(accessor.providerFacts, "0", {
			enumerable: true,
			get: () => value.graphEvidence.providerFacts[0],
		});
		expect(() => validateD18Evidence(accessor)).toThrow();

		const extra = structuredClone(value.graphEvidence) as any;
		const fact = extra.providerFacts[0];
		fact.result.rawBody = "forbidden";
		const { factDigest: _factDigest, ...factBase } = fact;
		fact.factDigest = empiricalStrictJsonDigest(factBase);
		const { evidenceDigest: _evidenceDigest, ...evidenceBase } = extra;
		extra.evidenceDigest = empiricalStrictJsonDigest(evidenceBase);
		expect(() => validateD18Evidence(extra)).toThrow();
	});

	test("derives all three retry policies from canonical Graph evidence", async () => {
		const value = validateD18QualificationBundle(await bundle());
		for (const [policy, evidence] of [
			["D671", value.retryEvidence.D671],
			["D675", value.retryEvidence.D675],
			["D710", value.graphEvidence],
		] as const) {
			const wait = evidence.providerFacts.find((fact) =>
				fact.request.schemaVersion.includes("retry-wait"),
			);
			expect(wait?.request.retryPolicy).toBe(policy);
			const attempts = evidence.providerFacts.filter(
				(fact) =>
					fact.request.schemaVersion.includes("provider-attempt") &&
					fact.request.workflowRequestDigest === wait?.request.workflowRequestDigest,
			);
			expect(attempts).toHaveLength(2);
			expect(attempts[0]?.request.wireBodyDigest).toBe(attempts[1]?.request.wireBodyDigest);
		}
	});

	test("rejects canonical retry substitution and Graph evidence replay corruption", async () => {
		const value = validateD18QualificationBundle(await bundle());
		const changed = structuredClone(value) as any;
		const retryAttempt = changed.graphEvidence.providerFacts.find(
			(fact: any) => fact.request.attemptOrdinal === 2,
		);
		retryAttempt.request.wireBodyDigest = `sha256:${"2".repeat(64)}`;
		expect(() => validateD18Evidence(changed.graphEvidence)).toThrow();
		const replayed = structuredClone(value) as any;
		replayed.graphEvidence.providerFacts.push(replayed.graphEvidence.providerFacts[0]);
		expect(() => validateD18Evidence(replayed.graphEvidence)).toThrow();
	});

	test("durable evidence is material-free", async () => {
		const encoded = new TextDecoder().decode(strictJsonCodec.encode(await bundle()));
		expect(encoded).not.toContain("assertBoundedAuthorityId(admissionId)");
		expect(encoded).not.toContain("assertBoundedAuthorityId(admissionProposalId)");
		for (const path of [
			"packages/ts/src/executors/managed-cloud-postgresql.ts",
			"packages/ts/src/identity.ts",
		])
			expect(encoded).not.toContain(`"path":"${path}"`);
		expect(encoded).not.toContain("oldText");
		expect(encoded).not.toContain("newText");
	});

	test("freezes the approved route, pricing and budget", () => {
		expect(D18_ROUTE.providerTag).toBe("deepinfra/fp8");
		expect(D18_ROUTE.pricing).toEqual({
			inputMicrousdPerMillion: 80_000,
			outputMicrousdPerMillion: 180_000,
			cacheReadMicrousdPerMillion: 16_000,
			revision: "graphrefly-ts.current.deepinfra-fp8-pricing.v4",
		});
		expect(D18_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	test("binds the exact D18 implementation closure", async () => {
		const repositoryRoot = await realpath(join(process.cwd(), "../.."));
		expect(await measureD18Implementation(repositoryRoot)).toBe(D18_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	test("publishes one atomic private injected generation and consumes the bundle", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d18-"));
		try {
			await chmod(root, 0o700);
			const value = await bundle();
			const canonicalRoot = await realpath(root);
			const receipt = await persistD18InjectedQualificationForTest({
				privateRoot: canonicalRoot,
				bundle: value,
			});
			expect(receipt.generationRef).toBe(D18_INJECTED_TEST_GENERATION_REF);
			const bytes = await readFile(
				join(canonicalRoot, D18_INJECTED_TEST_GENERATION_REF, "artifacts", "bundle.v1.json"),
			);
			expect(validateD18QualificationBundle(strictJsonCodec.decode(bytes)).bundleDigest).toBe(
				value.bundleDigest,
			);
			await expect(
				persistD18InjectedQualificationForTest({ privateRoot: canonicalRoot, bundle: value }),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
