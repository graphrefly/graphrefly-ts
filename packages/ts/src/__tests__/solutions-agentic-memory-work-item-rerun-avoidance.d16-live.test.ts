import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	D16_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD16Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d16-current-implementation-manifest.js";
import { isD16CompleteSixArmMeasurementForTest } from "../../evals/empirical-memory-rerun-avoidance/d16-current-live.js";
import { D16_CURRENT_GRAPH_LIVE_LIMITS } from "../../evals/empirical-memory-rerun-avoidance/d16-current-live-coordinates.js";
import {
	createD16InjectedD15BaselineForTest,
	D16_INJECTED_TEST_GENERATION_REF,
	persistD16InjectedQualificationForTest,
	runD16InjectedNoNetworkQualification,
	validateD16QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d16-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("graphrefly-ts:D16 D15-v4 repaired live composition", () => {
	let qualifiedBundle: Awaited<ReturnType<typeof runD16InjectedNoNetworkQualification>>;

	beforeAll(async () => {
		qualifiedBundle = await runD16InjectedNoNetworkQualification({
			repositoryRoot,
			baseline: createD16InjectedD15BaselineForTest(),
			implementationManifestDigest: D16_IMPLEMENTATION_MANIFEST_DIGEST,
		});
	}, 180_000);

	it("qualifies six serial arms under the exact 120 second Graph provider reservation", () => {
		const validated = validateD16QualificationBundle(qualifiedBundle);
		expect(D16_CURRENT_GRAPH_LIVE_LIMITS.providerMaxElapsedMs).toBe(120_000);
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
		expect(() => validateD16QualificationBundle(forged)).toThrow();
	});

	it("treats six cleaned Graph arms as orchestration-complete without claiming arm efficacy", () => {
		const graphEvidence = structuredClone(qualifiedBundle.graphBundle.graphEvidence);
		expect(graphEvidence).not.toBeNull();
		for (const run of graphEvidence!.d9Evidence.providerEvidence.workflowEvidence.runs)
			(run as { status: "incomplete" }).status = "incomplete";
		expect(
			isD16CompleteSixArmMeasurementForTest(
				graphEvidence as Parameters<typeof isD16CompleteSixArmMeasurementForTest>[0],
			),
		).toBe(true);
	});

	it("persists injected qualification atomically and rejects replay", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d16-persist-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD16InjectedQualificationForTest({
				privateRoot,
				bundle: qualifiedBundle,
			});
			const generationRoot = join(privateRoot, D16_INJECTED_TEST_GENERATION_REF);
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
			expect(validateD16QualificationBundle(persisted).bundleDigest).toBe(
				qualifiedBundle.bundleDigest,
			);
			expect(receipt.generationRef).toBe(D16_INJECTED_TEST_GENERATION_REF);
			await expect(
				persistD16InjectedQualificationForTest({ privateRoot, bundle: qualifiedBundle }),
			).rejects.toThrow(/fresh constructed bundle/u);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("freezes the current D6-v4 and D16 decision-bearing source closure", async () => {
		expect(await measureD16Implementation(repositoryRoot)).toBe(D16_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
