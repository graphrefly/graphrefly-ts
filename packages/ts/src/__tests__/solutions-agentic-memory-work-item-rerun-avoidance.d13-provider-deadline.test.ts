import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	D12_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD12Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d12-current-implementation-manifest.js";
import {
	D13_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD13Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d13-current-implementation-manifest.js";
import {
	createD13InjectedD12BaselineForTest,
	D13_INJECTED_TEST_GENERATION_REF,
	D13_PROVIDER_MAX_ELAPSED_MS,
	persistD13InjectedQualificationForTest,
	runD13InjectedNoNetworkQualification,
	validateD13QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d13-current-provider-deadline-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const CURRENT_SECRET_SENTINEL = "Bearer sk-or-v1";

describe("graphrefly-ts:D13 Graph-owned provider deadline alignment", () => {
	let qualifiedBundle: Awaited<ReturnType<typeof runD13InjectedNoNetworkQualification>>;

	beforeAll(async () => {
		qualifiedBundle = await runD13InjectedNoNetworkQualification({
			repositoryRoot,
			baseline: createD13InjectedD12BaselineForTest(),
			implementationManifestDigest: D13_IMPLEMENTATION_MANIFEST_DIGEST,
		});
	}, 240_000);

	it("qualifies all six serial arms beyond 60 seconds under one 120-second Graph deadline", () => {
		const validated = validateD13QualificationBundle(qualifiedBundle);
		const providerEvidence = validated.graphEvidence.d9Evidence.providerEvidence;
		expect(providerEvidence.runStatus).toBe("complete");
		expect(providerEvidence.workflowEvidence.runs).toHaveLength(6);
		expect(providerEvidence.workflowEvidence.runs.every((run) => run.status === "completed")).toBe(
			true,
		);
		expect(validated.qualification.retryWaits).toBe(1);
		expect(validated.qualification.maxActiveTransport).toBe(1);
		expect(validated.qualification.providerNetworkCalls).toBe(0);
		expect(validated.deadlineEvidence.providerReservationMs).toBe(D13_PROVIDER_MAX_ELAPSED_MS);
		expect(validated.deadlineEvidence.completedAfterLegacyDeadlineMs).toBe(60_001);
		expect(validated.deadlineEvidence.ownedDeadlineAtMs).toBe(120_000);
		expect(
			providerEvidence.facts
				.filter((fact) => fact.request.effectKind === "provider-request")
				.every((fact) => fact.request.reservation.maxElapsedMs === 120_000),
		).toBe(true);
	});

	it("rejects deadline, Graph-reservation, and canonical digest substitutions", () => {
		const deadlineForgery = structuredClone(qualifiedBundle) as Record<string, unknown>;
		(deadlineForgery.deadlineEvidence as Record<string, unknown>).ownedDeadlineAtMs = 60_000;
		expect(() => validateD13QualificationBundle(deadlineForgery)).toThrow();

		const graphForgery = structuredClone(qualifiedBundle) as Record<string, unknown>;
		const graphEvidence = graphForgery.graphEvidence as Record<string, unknown>;
		const d9Evidence = graphEvidence.d9Evidence as Record<string, unknown>;
		const providerEvidence = d9Evidence.providerEvidence as Record<string, unknown>;
		const facts = providerEvidence.facts as Array<Record<string, unknown>>;
		const providerFact = facts.find(
			(fact) => (fact.request as Record<string, unknown>).effectKind === "provider-request",
		);
		expect(providerFact).toBeDefined();
		const request = providerFact?.request as Record<string, unknown>;
		request.reservation = {
			...(request.reservation as Record<string, unknown>),
			maxElapsedMs: 60_000,
		};
		expect(() => validateD13QualificationBundle(graphForgery)).toThrow();
	});

	it("consumes baseline admission once and persists only material-free evidence", async () => {
		const baseline = createD13InjectedD12BaselineForTest();
		await expect(
			runD13InjectedNoNetworkQualification({
				repositoryRoot,
				baseline,
				implementationManifestDigest: `sha256:${"0".repeat(64)}`,
			}),
		).rejects.toThrow(/implementation manifest drifted/u);
		await expect(
			runD13InjectedNoNetworkQualification({
				repositoryRoot,
				baseline,
				implementationManifestDigest: D13_IMPLEMENTATION_MANIFEST_DIGEST,
			}),
		).rejects.toThrow(/forged or replayed/u);
		const serialized = JSON.stringify(qualifiedBundle);
		expect(serialized).not.toContain("sk-or-v1-test-current-graph-live-key-d13");
		expect(serialized).not.toContain(CURRENT_SECRET_SENTINEL);
		expect(serialized).not.toContain("authorization");
		expect(serialized.length).toBeLessThan(4_194_304);
	});

	it("persists injected qualification atomically and consumes its construction authority once", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d13-persist-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD13InjectedQualificationForTest({
				privateRoot,
				bundle: qualifiedBundle,
			});
			const generationRoot = join(privateRoot, D13_INJECTED_TEST_GENERATION_REF);
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
			expect(validateD13QualificationBundle(persisted).bundleDigest).toBe(
				qualifiedBundle.bundleDigest,
			);
			expect(receipt.generationRef).toBe(D13_INJECTED_TEST_GENERATION_REF);
			await expect(
				persistD13InjectedQualificationForTest({ privateRoot, bundle: qualifiedBundle }),
			).rejects.toThrow(/fresh constructed bundle/u);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 30_000);

	it("keeps the exact D12 baseline closure frozen and binds the D13 implementation", async () => {
		expect(await measureD12Implementation(repositoryRoot)).toBe(D12_IMPLEMENTATION_MANIFEST_DIGEST);
		expect(await measureD13Implementation(repositoryRoot)).toBe(D13_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
