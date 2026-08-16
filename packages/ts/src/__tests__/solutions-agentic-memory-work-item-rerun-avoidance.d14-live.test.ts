import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	D14_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD14Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d14-current-implementation-manifest.js";
import { D14_CURRENT_GRAPH_LIVE_LIMITS } from "../../evals/empirical-memory-rerun-avoidance/d14-current-live-coordinates.js";
import {
	createD14InjectedD13BaselineForTest,
	D14_INJECTED_TEST_GENERATION_REF,
	persistD14InjectedQualificationForTest,
	runD14InjectedNoNetworkQualification,
	validateD14QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d14-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("graphrefly-ts:D14 D13-qualified live composition", () => {
	let qualifiedBundle: Awaited<ReturnType<typeof runD14InjectedNoNetworkQualification>>;

	beforeAll(async () => {
		qualifiedBundle = await runD14InjectedNoNetworkQualification({
			repositoryRoot,
			baseline: createD14InjectedD13BaselineForTest(),
			implementationManifestDigest: D14_IMPLEMENTATION_MANIFEST_DIGEST,
		});
	}, 180_000);

	it("qualifies six serial arms under the exact 120 second Graph provider reservation", () => {
		const validated = validateD14QualificationBundle(qualifiedBundle);
		expect(D14_CURRENT_GRAPH_LIVE_LIMITS.providerMaxElapsedMs).toBe(120_000);
		expect(validated.qualification.transportFailureCount).toBe(1);
		expect(validated.qualification.retryWaits).toBe(1);
		expect(validated.qualification.maxActiveTransport).toBe(1);
		expect(validated.qualification.providerNetworkCalls).toBe(0);
		expect(validated.graphBundle.graphEvidence?.d9Evidence.providerEvidence.runStatus).toBe(
			"complete",
		);
	});

	it("rejects a re-digested transport projection substitution", () => {
		const forged = structuredClone(qualifiedBundle) as Record<string, unknown>;
		const graphBundle = forged.graphBundle as Record<string, unknown>;
		const evidence = graphBundle.graphEvidence as Record<string, unknown>;
		const facts = evidence.transportFacts as Array<Record<string, unknown>>;
		facts[0] = { ...facts[0], causeCode: "headers-timeout" };
		expect(() => validateD14QualificationBundle(forged)).toThrow();
	});

	it("persists injected qualification atomically and rejects replay", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d14-persist-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD14InjectedQualificationForTest({
				privateRoot,
				bundle: qualifiedBundle,
			});
			const generationRoot = join(privateRoot, D14_INJECTED_TEST_GENERATION_REF);
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
			expect(validateD14QualificationBundle(persisted).bundleDigest).toBe(
				qualifiedBundle.bundleDigest,
			);
			expect(receipt.generationRef).toBe(D14_INJECTED_TEST_GENERATION_REF);
			await expect(
				persistD14InjectedQualificationForTest({ privateRoot, bundle: qualifiedBundle }),
			).rejects.toThrow(/fresh constructed bundle/u);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("freezes the complete D12/D13 and D14 decision-bearing source closure", async () => {
		expect(await measureD14Implementation(repositoryRoot)).toBe(D14_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
