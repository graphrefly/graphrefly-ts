import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	D12_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD12Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d12-current-implementation-manifest.js";
import {
	createD12InjectedD11BaselineForTest,
	D12_INJECTED_TEST_GENERATION_REF,
	persistD12InjectedQualificationForTest,
	runD12InjectedNoNetworkQualification,
	validateD12QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d12-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("graphrefly-ts:D12 D11-qualified live composition", () => {
	let qualifiedBundle: Awaited<ReturnType<typeof runD12InjectedNoNetworkQualification>>;

	beforeAll(async () => {
		qualifiedBundle = await runD12InjectedNoNetworkQualification({
			repositoryRoot,
			baseline: createD12InjectedD11BaselineForTest(),
			implementationManifestDigest: D12_IMPLEMENTATION_MANIFEST_DIGEST,
		});
	}, 180_000);

	it("qualifies six serial arms with one Graph-admitted transport failure and unchanged retry", async () => {
		const validated = validateD12QualificationBundle(qualifiedBundle);
		expect(validated.qualification.transportFailureCount).toBe(1);
		expect(validated.qualification.transportPhaseCause).toBe("request:dns-failure");
		expect(validated.qualification.retryWaits).toBe(1);
		expect(validated.qualification.maxActiveTransport).toBe(1);
		expect(validated.qualification.providerNetworkCalls).toBe(0);
		expect(validated.graphBundle.graphEvidence?.transportFailureCount).toBe(1);
		expect(validated.graphBundle.graphEvidence?.d9Evidence.providerEvidence.runStatus).toBe(
			"complete",
		);
	}, 20_000);

	it("rejects a re-digested transport projection substitution", async () => {
		const forged = structuredClone(qualifiedBundle) as Record<string, unknown>;
		const graphBundle = forged.graphBundle as Record<string, unknown>;
		const evidence = graphBundle.graphEvidence as Record<string, unknown>;
		const facts = evidence.transportFacts as Array<Record<string, unknown>>;
		facts[0] = { ...facts[0], causeCode: "headers-timeout" };
		expect(() => validateD12QualificationBundle(forged)).toThrow();
	}, 20_000);

	it("persists injected qualification atomically and rejects replay", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d12-persist-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD12InjectedQualificationForTest({
				privateRoot,
				bundle: qualifiedBundle,
			});
			const generationRoot = join(privateRoot, D12_INJECTED_TEST_GENERATION_REF);
			expect((await stat(generationRoot)).mode & 0o777).toBe(0o700);
			for (const file of [
				"artifacts/bundle.v1.json",
				"artifacts/qualification.v1.json",
				"artifacts/generation.v1.json",
				"commit.v1.json",
			])
				expect((await stat(join(generationRoot, file))).mode & 0o777).toBe(0o600);
			const persisted = JSON.parse(
				await readFile(join(generationRoot, "artifacts/bundle.v1.json"), "utf8"),
			);
			expect(validateD12QualificationBundle(persisted).bundleDigest).toBe(
				qualifiedBundle.bundleDigest,
			);
			expect(receipt.generationRef).toBe(D12_INJECTED_TEST_GENERATION_REF);
			await expect(
				persistD12InjectedQualificationForTest({
					privateRoot,
					bundle: qualifiedBundle,
				}),
			).rejects.toThrow(/fresh constructed bundle/u);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 20_000);

	it("freezes the complete D12 decision-bearing source closure", async () => {
		expect(await measureD12Implementation(repositoryRoot)).toBe(D12_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
