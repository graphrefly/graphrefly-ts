import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	D41_INSPECTION_MAX_OUTPUT_TOKENS,
	D41_MUTATION_MAX_OUTPUT_TOKENS,
	validateD41InferenceEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d41-phase-specific-inference-authority.js";
import {
	D41_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD41Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d41-phase-specific-inference-implementation-manifest.js";
import {
	createD41InjectedBaselineForTest,
	runD41InjectedNoNetworkQualification,
	validateD41QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d41-phase-specific-inference-qualification.js";

describe("graphrefly-ts:D41 phase-specific inference qualification", () => {
	it("binds the exact D40 baseline closure and D41 implementation bytes", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD41Implementation(repositoryRoot)).toBe(D41_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("qualifies exact 65536/8192 lowering, length recovery, tool schema rejection, retry identity, and accounting", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d41-test-"));
		try {
			const bundle = await runD41InjectedNoNetworkQualification({
				baseline: createD41InjectedBaselineForTest(),
				baselineBasis: "injected-test",
				repositoryRoot,
				materializationRoot: join(root, "workspaces"),
			});
			const validated = validateD41QualificationBundle(bundle);
			expect(validated.qualification.inspectionMaxOutputTokens).toBe(65_536);
			expect(validated.qualification.mutationMaxOutputTokens).toBe(8_192);
			expect(validated.qualification.lengthRecoveryObserved).toBe(true);
			expect(validated.qualification.validToolCallObserved).toBe(true);
			expect(validated.qualification.malformedSchemaRejected).toBe(true);
			expect(validated.qualification.exactRetryWireIdentity).toBe(true);
			expect(validated.qualification.exactUsageReconciliation).toBe(true);
			expect(validated.qualification.providerNetworkCalls).toBe(0);
			expect(validated.qualification.mainProviderAttemptCount).toBeGreaterThan(12);
			expect(validated.qualification.schemaProviderAttemptCount).toBeGreaterThanOrEqual(12);
			expect(
				validated.mainEvidence.facts.every(
					(fact) =>
						fact.maxOutputTokens ===
						(fact.phase === "inspection"
							? D41_INSPECTION_MAX_OUTPUT_TOKENS
							: D41_MUTATION_MAX_OUTPUT_TOKENS),
				),
			).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);

	it("fails closed on ceiling substitution and baseline replay", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d41-replay-"));
		const baseline = createD41InjectedBaselineForTest();
		try {
			const bundle = await runD41InjectedNoNetworkQualification({
				baseline,
				baselineBasis: "injected-test",
				repositoryRoot,
				materializationRoot: join(root, "first"),
			});
			const first = bundle.mainEvidence.facts[0]!;
			expect(() =>
				validateD41InferenceEvidence({
					...bundle.mainEvidence,
					facts: [{ ...first, maxOutputTokens: 4_096 }, ...bundle.mainEvidence.facts.slice(1)],
				}),
			).toThrow();
			await expect(
				runD41InjectedNoNetworkQualification({
					baseline,
					baselineBasis: "injected-test",
					repositoryRoot,
					materializationRoot: join(root, "second"),
				}),
			).rejects.toThrow(/forged, replayed, or wrong-basis/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 180_000);
});
