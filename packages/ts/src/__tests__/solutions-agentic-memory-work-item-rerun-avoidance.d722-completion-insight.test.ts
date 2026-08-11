import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	createD721InjectedNoNetworkFixture,
	runD721ProviderCapableEffectAdapter,
} from "../../evals/empirical-memory-rerun-avoidance/d721-provider-capable-effect-adapter.js";
import {
	createD722PersistenceFaultForTest,
	D722_GENERATION_REF,
	persistD722PreLiveBundle,
	runD722PreLiveQualification,
	validateD722PreLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d722-graph-completion-memory-insight.js";
import { runD722InjectedProviderCapableAdapter } from "../../evals/empirical-memory-rerun-avoidance/d722-provider-capable-effect-adapter.js";
import { strictJsonCodec } from "../json/codec.js";

const sourceDigest = empiricalStrictJsonDigest({ fixture: "d722-completion-insight" });
const routeDigest = empiricalStrictJsonDigest({ route: "d722-injected-no-network" });
const budgetLimits = Object.freeze({
	maxRequests: 96,
	maxRetryWaits: 16,
	maxCostMicrousd: 100_000,
	maxElapsedMs: 3_000_000,
});
const effectCeilings = Object.freeze({
	routeDigest,
	providerMaxCostMicrousd: 1_000,
	providerMaxElapsedMs: 30_000,
	localEffectMaxElapsedMs: 120_000,
});

async function qualify() {
	return runD722PreLiveQualification({ sourceDigest, budgetLimits, effectCeilings });
}

describe("D722 Graph-authored completion context and admitted memory insight", () => {
	it("recovers every premature final through one Graph-authored context and admits only derived insights", async () => {
		const bundle = validateD722PreLiveBundle(await qualify());
		expect(bundle.graphEvidence.runStatus).toBe("complete");
		expect(bundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(bundle.graphEvidence.completionContexts).toHaveLength(6);
		expect(bundle.graphEvidence.memoryInsights).toHaveLength(6);
		expect(bundle.qualification.injectedProviderEffectCount).toBe(30);
		expect(bundle.qualification.graphAdmittedEffectCount).toBe(78);
		for (const [runSequence, context] of bundle.graphEvidence.completionContexts.entries()) {
			expect(context.runSequence).toBe(runSequence);
			expect(context.nextRequiredPhase).toBe("exact-mutation");
			expect(context.missingObjectivePhases).toEqual([
				"exact-mutation",
				"workspace-diff",
				"focused-validation",
			]);
			expect(context.requiredDisposition).toBe("tool-intents");
			expect(context.remainingCompletionContexts).toBe(0);
		}
		for (let index = 1; index < bundle.graphEvidence.completionContexts.length; index += 1) {
			expect(
				bundle.graphEvidence.completionContexts[index]?.remainingAdmittedBounds.requests,
			).toBeLessThan(
				bundle.graphEvidence.completionContexts[index - 1]!.remainingAdmittedBounds.requests,
			);
		}
		for (const insight of bundle.graphEvidence.memoryInsights) {
			expect(insight.kind).toBe("memory-insight-admitted");
			expect(insight.unknowns).toEqual([
				"causal-attribution-undetermined",
				"efficacy-undetermined",
			]);
			expect(insight.recommendedHarnessAdjustment).toBe("retain-graph-authored-completion-context");
		}
		for (const run of bundle.graphEvidence.effectRuns.slice(3)) {
			const contextRequests = run.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request" &&
				fact.request.completionContext !== undefined
					? [fact.request]
					: [],
			);
			expect(contextRequests).toHaveLength(2);
			expect(contextRequests[1]?.completionContext).toEqual(contextRequests[0]?.completionContext);
			expect(contextRequests[1]?.logicalRequestDigest).toBe(
				contextRequests[0]?.logicalRequestDigest,
			);
		}
		const encoded = new TextDecoder().decode(strictJsonCodec.encode(bundle));
		expect(encoded).not.toContain("skill");
		expect(encoded).not.toContain("rawBody");
		expect(encoded).not.toContain("credential");
		expect(encoded).not.toContain("expectedPatch");
		for (const providerFact of bundle.graphEvidence.effectRuns.flatMap((run) =>
			run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request",
			),
		)) {
			const requestBytes = new TextDecoder().decode(strictJsonCodec.encode(providerFact.request));
			expect(requestBytes).not.toContain("memory-insight");
			expect(requestBytes).not.toContain("recommendedHarnessAdjustment");
		}
	});

	it("keeps the exact D721/D720 path free of D722 context when the policy is absent", async () => {
		const fixture = createD721InjectedNoNetworkFixture();
		const run = await runD721ProviderCapableEffectAdapter({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			adapter: fixture.adapter,
		});
		expect(
			run.underlyingBundle.graphEvidence.effectRuns.flatMap((effectRun) =>
				effectRun.facts.flatMap((fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					Object.hasOwn(fact.request, "completionContext")
						? [fact]
						: [],
				),
			),
		).toEqual([]);
	});

	it("reports zero active adapter invocations when Graph admits pre-effect cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const run = await runD722InjectedProviderCapableAdapter({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			signal: controller.signal,
		});
		expect(run.maxActiveInvocations).toBe(0);
		expect(run.executedEffectCount).toBe(0);
		expect(run.core.ledger.runStatus).toBe("stopped");
	});

	it("never lowers a completion context whose global Graph budget admission is denied", async () => {
		const run = await runD722InjectedProviderCapableAdapter({
			sourceDigest,
			budgetLimits: { ...budgetLimits, maxRequests: 3 },
			effectCeilings,
		});
		const contextFact = run.core.effectRuns[0]?.facts.find(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.completionContext !== undefined,
		);
		expect(contextFact).toBeDefined();
		expect(
			run.core.ledger.effectAdmissions.find(
				(admission) => admission.decisionDigest === contextFact?.admissionDigest,
			)?.admitted,
		).toBe(false);
		expect(run.callsByEffectKind.get("provider-request")).toBe(3);
	});

	it("fails closed on context, insight, accessor, replay, and canonical substitution", async () => {
		const bundle = await qualify();
		const stale = structuredClone(bundle) as any;
		stale.graphEvidence.completionContexts[0].workspaceStateDigest = sourceDigest;
		expect(() => validateD722PreLiveBundle(stale)).toThrow();

		const insight = structuredClone(bundle) as any;
		insight.graphEvidence.memoryInsights[0].recommendedHarnessAdjustment = "execute-a-skill";
		expect(() => validateD722PreLiveBundle(insight)).toThrow();

		const qualificationCount = structuredClone(bundle) as any;
		qualificationCount.qualification.completedArmCount = 5;
		expect(() => validateD722PreLiveBundle(qualificationCount)).toThrow(/canonical/);

		const sourceSubstitution = structuredClone(bundle) as any;
		sourceSubstitution.qualification.graphRuntimeSourceDigest = sourceDigest;
		const { qualificationDigest: _oldQualificationDigest, ...qualificationMaterial } =
			sourceSubstitution.qualification;
		sourceSubstitution.qualification.qualificationDigest =
			empiricalStrictJsonDigest(qualificationMaterial);
		sourceSubstitution.generation.qualificationDigest =
			sourceSubstitution.qualification.qualificationDigest;
		const { generationDigest: _oldGenerationDigest, ...generationMaterial } =
			sourceSubstitution.generation;
		sourceSubstitution.generation.generationDigest = empiricalStrictJsonDigest(generationMaterial);
		const { bundleDigest: _oldBundleDigest, ...bundleMaterial } = sourceSubstitution;
		sourceSubstitution.bundleDigest = empiricalStrictJsonDigest(bundleMaterial);
		expect(() => validateD722PreLiveBundle(sourceSubstitution)).toThrow(
			/qualification digest mismatch/,
		);

		const oversizedProjection = structuredClone(bundle) as any;
		oversizedProjection.graphEvidence.completionContexts.push(
			structuredClone(oversizedProjection.graphEvidence.completionContexts[0]),
		);
		expect(() => validateD722PreLiveBundle(oversizedProjection)).toThrow(/bound exceeded/);

		let getterHits = 0;
		const accessor = structuredClone(bundle) as any;
		Object.defineProperty(accessor.graphEvidence.completionContexts[0], "contextDigest", {
			enumerable: true,
			get() {
				getterHits += 1;
				return bundle.graphEvidence.completionContexts[0]?.contextDigest;
			},
		});
		expect(() => validateD722PreLiveBundle(accessor)).toThrow();
		expect(getterHits).toBe(0);

		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d722-clone-")));
		await chmod(privateRoot, 0o700);
		try {
			await expect(
				persistD722PreLiveBundle({ privateRoot, bundle: structuredClone(bundle) }),
			).rejects.toThrow(/same-process/);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 30_000);

	it("persists one exclusive 0700/0600 canonical generation and replays it", async () => {
		const bundle = await qualify();
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d722-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD722PreLiveBundle({ privateRoot, bundle });
			expect(receipt.generationRef).toBe(D722_GENERATION_REF);
			const finalRoot = join(privateRoot, D722_GENERATION_REF);
			expect((await lstat(finalRoot)).mode & 0o777).toBe(0o700);
			const names = (await readdir(finalRoot)).sort();
			expect(names).toEqual(["artifacts", "commit.v2.json"]);
			const artifactsRoot = join(finalRoot, "artifacts");
			expect((await lstat(artifactsRoot)).mode & 0o777).toBe(0o700);
			const artifactNames = (await readdir(artifactsRoot)).sort();
			expect(artifactNames).toEqual([
				"bundle.v1.json",
				"generation.v1.json",
				"graph-evidence.v1.json",
				"qualification.v1.json",
			]);
			for (const name of [...artifactNames, "../commit.v2.json"])
				expect((await lstat(join(artifactsRoot, name))).mode & 0o777).toBe(0o600);
			const persisted = strictJsonCodec.decode(
				await readFile(join(artifactsRoot, "bundle.v1.json")),
			);
			expect(validateD722PreLiveBundle(persisted).bundleDigest).toBe(bundle.bundleDigest);
			await expect(persistD722PreLiveBundle({ privateRoot, bundle })).rejects.toThrow(
				/already exists/,
			);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 30_000);

	it("removes the exact staging/final generation after injected atomic failures", async () => {
		for (const stage of ["after-staging-sync", "after-rename"] as const) {
			const bundle = await qualify();
			const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d722-fault-")));
			await chmod(privateRoot, 0o700);
			try {
				await expect(
					persistD722PreLiveBundle({
						privateRoot,
						bundle,
						fault: createD722PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow(/injected/);
				expect(await readdir(privateRoot)).toEqual([]);
			} finally {
				await rm(privateRoot, { recursive: true, force: true });
			}
		}
	}, 30_000);
});
