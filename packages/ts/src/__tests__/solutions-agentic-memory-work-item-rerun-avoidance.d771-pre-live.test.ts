import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { evaluateD771ArmAwarePositiveGate } from "../../evals/empirical-memory-rerun-avoidance/d771-arm-aware-positive-gate.js";
import {
	createD771PersistenceFaultForTest,
	persistD771QualificationBundle,
	runD771InjectedNoNetworkQualification,
	validateD771QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d771-pre-live-qualification.js";

const digest = (value: unknown) => empiricalStrictJsonDigest(value);

function redigestBundle(value: Record<string, unknown>) {
	const qualification = value.qualification as Record<string, unknown>;
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	const nextQualification = {
		...qualification,
		qualificationDigest: digest(qualificationMaterial),
	};
	const generation = value.generation as Record<string, unknown>;
	const { generationDigest: _generationDigest, ...generationMaterial } = {
		...generation,
		qualificationDigest: nextQualification.qualificationDigest,
	};
	const nextGeneration = {
		...generationMaterial,
		generationDigest: digest(generationMaterial),
	};
	const { bundleDigest: _bundleDigest, ...material } = {
		...value,
		qualification: nextQualification,
		generation: nextGeneration,
	};
	return { ...material, bundleDigest: digest(material) };
}

describe("D771 criterion continuation lowering and arm-aware gate", () => {
	it("qualifies the full no-network primary and retry Graphs and rejects coordinated replay", async () => {
		const bundle = await runD771InjectedNoNetworkQualification();
		expect(validateD771QualificationBundle(bundle).bundleDigest).toBe(bundle.bundleDigest);
		expect(bundle.gate.passed).toBe(true);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		const cherryPicked = structuredClone(bundle.graphEvidence);
		const firstRun = cherryPicked.effectRuns[0]!;
		firstRun.facts.splice(7, 0, structuredClone(firstRun.facts[6]!));
		expect(
			evaluateD771ArmAwarePositiveGate(cherryPicked, bundle.loweringGraphEvidence).passed,
		).toBe(false);
		const providerFailed = structuredClone(bundle.graphEvidence);
		const firstProvider = providerFailed.effectRuns[0]!.facts.find(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request",
		);
		if (firstProvider?.kind !== "graph-effect-result-admitted")
			throw new TypeError("fixture drift");
		(firstProvider.result as { status: string }).status = "terminal-failure";
		expect(
			evaluateD771ArmAwarePositiveGate(providerFailed, bundle.loweringGraphEvidence).passed,
		).toBe(false);
		const twoQualifying = structuredClone(bundle.graphEvidence);
		const coldRecovery = twoQualifying.ledger.facts.find(
			(fact) => fact.arm === "cold" && fact.runKind === "recovery",
		);
		if (coldRecovery === undefined) throw new TypeError("D771 cold recovery fixture drifted");
		const secondQualifying = structuredClone(twoQualifying.effectRuns[0]!);
		secondQualifying.issuedRequestDigest = coldRecovery.issuedRequestDigest;
		twoQualifying.effectRuns[1] = secondQualifying;
		expect(
			evaluateD771ArmAwarePositiveGate(twoQualifying, bundle.loweringGraphEvidence).passed,
		).toBe(false);
		const mutatedRecovery = structuredClone(bundle.graphEvidence);
		const recoveryRun = mutatedRecovery.effectRuns[1]!;
		const qualifyingMutation = structuredClone(mutatedRecovery.effectRuns[0]!.facts[3]!);
		recoveryRun.facts.splice(2, 0, qualifyingMutation);
		expect(
			evaluateD771ArmAwarePositiveGate(mutatedRecovery, bundle.loweringGraphEvidence).passed,
		).toBe(false);
		const redigestLoweringBundle = (candidate: Record<string, unknown>) => {
			const evidence = candidate.loweringGraphEvidence as {
				facts: Record<string, unknown>[];
				evidenceDigest: string;
			};
			evidence.evidenceDigest = digest({
				schemaVersion: "graphrefly.b112.d771.lowering-graph-evidence.v1",
				facts: evidence.facts,
			});
			(candidate.qualification as Record<string, unknown>).loweringGraphEvidenceDigest =
				evidence.evidenceDigest;
			(candidate.generation as Record<string, unknown>).loweringGraphEvidenceDigest =
				evidence.evidenceDigest;
			return redigestBundle(candidate);
		};
		const coordinateForgery = structuredClone(bundle) as unknown as Record<string, unknown>;
		const coordinateFact = (
			coordinateForgery.loweringGraphEvidence as {
				facts: Record<string, unknown>[];
			}
		).facts[0]!;
		coordinateFact.runSequence = 11;
		const { factDigest: _coordinateFactDigest, ...coordinateMaterial } = coordinateFact;
		coordinateFact.factDigest = digest(coordinateMaterial);
		expect(() =>
			validateD771QualificationBundle(redigestLoweringBundle(coordinateForgery)),
		).toThrow(/coordinates/);
		const reordered = structuredClone(bundle) as unknown as Record<string, unknown>;
		const reorderedFacts = (
			reordered.loweringGraphEvidence as {
				facts: Record<string, unknown>[];
			}
		).facts;
		[reorderedFacts[0], reorderedFacts[1]] = [reorderedFacts[1]!, reorderedFacts[0]!];
		expect(() => validateD771QualificationBundle(redigestLoweringBundle(reordered))).toThrow(
			/exact Graph provider order/,
		);
		const contextForgery = structuredClone(bundle) as unknown as Record<string, unknown>;
		const contextFact = (
			contextForgery.loweringGraphEvidence as {
				facts: Record<string, unknown>[];
			}
		).facts.find((fact) => fact.attemptOrdinal === 2);
		if (contextFact === undefined) throw new TypeError("D771 retry lowering fixture drifted");
		contextFact.contextAdmissionDigest = digest({ substituted: "context-admission" });
		contextFact.graphDirectiveDigest = digest({
			revision: "graphrefly.b112.d771.graph-criterion-route-directive.v1",
			requestDigest: contextFact.requestDigest,
			admissionDigest: contextFact.admissionDigest,
			contextAdmissionDigest: contextFact.contextAdmissionDigest,
			contextDigest: contextFact.contextDigest,
			conversationDigest: contextFact.conversationDigest,
			modelVisibleMessagesDigest: contextFact.modelVisibleMessagesDigest,
			exposureEvidenceDigest: contextFact.exposureEvidenceDigest,
		});
		contextFact.proposalDigest = digest({
			revision: "graphrefly.b112.d771.criterion-lowering-proposal.v1",
			requestDigest: contextFact.requestDigest,
			logicalRequestDigest: contextFact.logicalRequestDigest,
			attemptOrdinal: contextFact.attemptOrdinal,
			contextDigest: contextFact.contextDigest,
			contextAdmissionDigest: contextFact.contextAdmissionDigest,
			graphDirectiveDigest: contextFact.graphDirectiveDigest,
			loweredBodyDigest: contextFact.loweredBodyDigest,
			requiredToolName: contextFact.requiredToolName,
			conversationDigest: contextFact.conversationDigest,
			modelVisibleMessagesDigest: contextFact.modelVisibleMessagesDigest,
			exposureEvidenceDigest: contextFact.exposureEvidenceDigest,
		});
		const { factDigest: _contextFactDigest, ...contextMaterial } = contextFact;
		contextFact.factDigest = digest(contextMaterial);
		expect(() => validateD771QualificationBundle(redigestLoweringBundle(contextForgery))).toThrow(
			/Graph coordinates|context admission|retry identity/,
		);
		const duplicateLowering = structuredClone(bundle) as unknown as Record<string, unknown>;
		const loweringEvidence = duplicateLowering.loweringGraphEvidence as {
			facts: Record<string, unknown>[];
			evidenceDigest: string;
		};
		loweringEvidence.facts[12] = structuredClone(loweringEvidence.facts[11]!);
		loweringEvidence.evidenceDigest = digest({
			schemaVersion: "graphrefly.b112.d771.lowering-graph-evidence.v1",
			facts: loweringEvidence.facts,
		});
		const duplicateQualification = duplicateLowering.qualification as Record<string, unknown>;
		duplicateQualification.loweringGraphEvidenceDigest = loweringEvidence.evidenceDigest;
		const duplicateGeneration = duplicateLowering.generation as Record<string, unknown>;
		duplicateGeneration.loweringGraphEvidenceDigest = loweringEvidence.evidenceDigest;
		expect(() => validateD771QualificationBundle(redigestBundle(duplicateLowering))).toThrow();
		const graphEvidence = {
			...structuredClone(bundle.graphEvidence),
			runStatus: "incomplete",
		};
		const forged = redigestBundle({
			...structuredClone(bundle),
			graphEvidence,
		});
		expect(() => validateD771QualificationBundle(forged)).toThrow();
	}, 30_000);

	it("persists private evidence once and cleans injected failures", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d771-persistence-")));
		const replayRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d771-replay-")));
		await chmod(root, 0o700);
		await chmod(replayRoot, 0o700);
		try {
			const bundle = await runD771InjectedNoNetworkQualification();
			await persistD771QualificationBundle({ privateRoot: root, bundle });
			await expect(
				persistD771QualificationBundle({ privateRoot: replayRoot, bundle }),
			).rejects.toThrow(/same-process constructed/);
			const final = join(root, "d771-criterion-lowering-arm-gate-no-network-v1");
			expect((await lstat(final)).mode & 0o777).toBe(0o700);
			expect((await readdir(join(final, "artifacts"))).sort()).toEqual([
				"bundle.v1.json",
				"generation.v1.json",
				"graph-evidence.v1.json",
				"lowering-graph-evidence.v1.json",
				"qualification.v1.json",
				"retry-graph-evidence.v1.json",
			]);
			await expect(
				persistD771QualificationBundle({
					privateRoot: root,
					bundle: await runD771InjectedNoNetworkQualification(),
				}),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(replayRoot, { recursive: true, force: true });
		}
		for (const stage of ["after-write", "after-rename"] as const) {
			const faultRoot = await realpath(await mkdtemp(join(tmpdir(), `graphrefly-d771-${stage}-`)));
			await chmod(faultRoot, 0o700);
			try {
				await expect(
					persistD771QualificationBundle({
						privateRoot: faultRoot,
						bundle: await runD771InjectedNoNetworkQualification(),
						fault: createD771PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow();
				expect(await readdir(faultRoot)).toEqual([]);
			} finally {
				await rm(faultRoot, { recursive: true, force: true });
			}
		}
	}, 60_000);
});
