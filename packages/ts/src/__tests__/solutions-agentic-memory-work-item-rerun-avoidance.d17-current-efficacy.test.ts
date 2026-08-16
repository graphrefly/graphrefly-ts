import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitD17EffectResult,
	createD17Authority,
	D17_ARMS,
	D17_COMPLETE_TASK_STATEMENT,
	D17_DEFAULT_PROVIDER_DEADLINE_MS,
	D17_MUTATION_PROVIDER_DEADLINE_MS,
	D17_QUALIFICATION_LIMITS,
	nextD17Effect,
} from "../../evals/empirical-memory-rerun-avoidance/d17-current-efficacy-authority.js";
import {
	D17_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD17Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d17-current-implementation-manifest.js";
import { executeD17InjectedProviderEffect } from "../../evals/empirical-memory-rerun-avoidance/d17-current-injected-adapter.js";
import {
	createD17InjectedD16BaselineForTest,
	D17_INJECTED_TEST_GENERATION_REF,
	persistD17InjectedQualificationForTest,
	runD17InjectedNoNetworkQualification,
	validateD17QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d17-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("graphrefly-ts:D17 current Graph-native efficacy pre-live", () => {
	let bundle: Awaited<ReturnType<typeof runD17InjectedNoNetworkQualification>>;

	beforeAll(async () => {
		bundle = await runD17InjectedNoNetworkQualification({
			baseline: createD17InjectedD16BaselineForTest(),
			implementationManifestDigest: D17_IMPLEMENTATION_MANIFEST_DIGEST,
		});
	}, 120_000);

	it("qualifies six exact Graph-admitted exposures and deterministic validation phases", () => {
		const validated = validateD17QualificationBundle(bundle);
		expect(validated.graphEvidence.runs.map((run) => run.arm)).toEqual(D17_ARMS);
		expect(validated.graphEvidence.runs.every((run) => run.evaluable)).toBe(true);
		expect(validated.graphEvidence.runs.every((run) => run.cleanupCompleted)).toBe(true);
		expect(validated.graphEvidence.effectFacts).toHaveLength(78);
		const provider = validated.graphEvidence.effectFacts.filter(
			(fact) => fact.request.effectKind === "provider-request",
		);
		expect(provider).toHaveLength(12);
		expect(
			provider
				.filter((fact) => fact.request.phase === "mutation")
				.every(
					(fact) =>
						fact.request.requiredFirstToolRef === "replace-exact" &&
						fact.request.reservation.maxElapsedMs === D17_MUTATION_PROVIDER_DEADLINE_MS,
				),
		).toBe(true);
		expect(
			provider
				.filter((fact) => fact.request.phase === "inspection")
				.every(
					(fact) => fact.request.reservation.maxElapsedMs === D17_DEFAULT_PROVIDER_DEADLINE_MS,
				),
		).toBe(true);
		expect(validated.qualification.liveGateEvaluated).toBe(false);
		expect(validated.qualification.efficacyClaim).toBe("none");
		expect(validated.graphEvidence.gate.failureCodes).toEqual([]);
	});

	it("persists only material-free exposure coordinates", () => {
		const serialized = JSON.stringify(bundle);
		expect(serialized).not.toContain("producer-owned canonical proposal, preserve");
		expect(serialized).not.toContain("managed untrusted compute");
		expect(serialized).not.toContain("Public producer contract fixture");
		expect(bundle.graphEvidence.exposureFacts.map((fact) => fact.disposition)).toEqual([
			"none",
			"admitted-applied",
			"proposal-unadmitted",
			"admission-rejected",
			"admitted-applied",
			"admitted-applied",
		]);
	});

	it("rejects re-digested exposure substitution and canonical state drift", () => {
		const forged = structuredClone(bundle) as Record<string, unknown>;
		const graph = forged.graphEvidence as Record<string, unknown>;
		const exposures = graph.exposureFacts as Array<Record<string, unknown>>;
		exposures[1] = {
			...exposures[1],
			insightDigest: empiricalStrictJsonDigest({ insight: "substituted" }),
		};
		const graphBase = { ...graph };
		delete graphBase.evidenceDigest;
		graph.evidenceDigest = empiricalStrictJsonDigest(graphBase);
		const qualification = forged.qualification as Record<string, unknown>;
		qualification.graphEvidenceDigest = graph.evidenceDigest;
		const qualificationBase = { ...qualification };
		delete qualificationBase.qualificationDigest;
		qualification.qualificationDigest = empiricalStrictJsonDigest(qualificationBase);
		const generation = forged.generation as Record<string, unknown>;
		generation.graphEvidenceDigest = graph.evidenceDigest;
		generation.qualificationDigest = qualification.qualificationDigest;
		const generationBase = { ...generation };
		delete generationBase.generationDigest;
		generation.generationDigest = empiricalStrictJsonDigest(generationBase);
		const bundleBase = { ...forged };
		delete bundleBase.bundleDigest;
		forged.bundleDigest = empiricalStrictJsonDigest(bundleBase);
		expect(() => validateD17QualificationBundle(forged)).toThrow(/exact exposure/u);
	});

	it("rejects replayed effects and forged provider admission before transport", async () => {
		const authority = createD17Authority({ taskStatement: D17_COMPLETE_TASK_STATEMENT });
		const materialization = nextD17Effect(authority)!;
		const workspace = empiricalStrictJsonDigest({ workspace: "replay-test" });
		const materializationResult = {
			effectKind: "materialization" as const,
			status: "completed" as const,
			workspaceStateDigest: workspace,
			evidenceDigest: empiricalStrictJsonDigest({ materialized: true }),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		};
		admitD17EffectResult(authority, materialization, materializationResult);
		expect(() => admitD17EffectResult(authority, materialization, materializationResult)).toThrow(
			/replayed/u,
		);
		const provider = nextD17Effect(authority)!;
		let calls = 0;
		const forged = structuredClone(provider);
		await expect(
			executeD17InjectedProviderEffect({
				authority,
				effect: forged,
				transport: async () => {
					calls += 1;
					throw new Error("must not run");
				},
			}),
		).rejects.toThrow(/forged or stale/u);
		expect(calls).toBe(0);
	});

	it("denies provider headroom before any wire effect", () => {
		const authority = createD17Authority({
			taskStatement: D17_COMPLETE_TASK_STATEMENT,
			limits: { ...D17_QUALIFICATION_LIMITS, maxProviderRequests: 0 },
		});
		const materialization = nextD17Effect(authority)!;
		const workspace = empiricalStrictJsonDigest({ workspace: "headroom-test" });
		admitD17EffectResult(authority, materialization, {
			effectKind: "materialization",
			status: "completed",
			workspaceStateDigest: workspace,
			evidenceDigest: empiricalStrictJsonDigest({ materialized: true }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		expect(nextD17Effect(authority)?.request.effectKind).toBe("cleanup");
	});

	it("persists qualification atomically and consumes the constructed bundle once", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d17-persist-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD17InjectedQualificationForTest({ privateRoot, bundle });
			const generationRoot = join(privateRoot, D17_INJECTED_TEST_GENERATION_REF);
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
			expect(validateD17QualificationBundle(persisted).bundleDigest).toBe(bundle.bundleDigest);
			expect(receipt.generationRef).toBe(D17_INJECTED_TEST_GENERATION_REF);
			await expect(persistD17InjectedQualificationForTest({ privateRoot, bundle })).rejects.toThrow(
				/fresh constructed bundle/u,
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("freezes the complete D17 decision-bearing source set", async () => {
		expect(await measureD17Implementation(repositoryRoot)).toBe(D17_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
