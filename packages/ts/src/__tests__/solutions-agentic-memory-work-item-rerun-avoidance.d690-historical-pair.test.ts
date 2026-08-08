import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import * as d690Module from "../../evals/empirical-memory-rerun-avoidance/d690-historical-pair-qualification.js";
import {
	createD690HistoricalTransferMemory,
	D690_CLAIM_BOUNDARY,
	D690_FAILURE_MECHANISM_REF,
	D690_SOURCE,
	D690_TARGET_TASK_REF,
	runD690HistoricalPairOfflineQualification,
} from "../../evals/empirical-memory-rerun-avoidance/d690-historical-pair-qualification.js";
import { strictJsonCodec } from "../json/codec.js";

function sourceEvidence(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: "graphrefly.private-solution-eval.d690-source-success-evidence.v1",
		observationDigest: D690_SOURCE.observationDigest,
		taskRef: D690_SOURCE.taskRef,
		runDigest: D690_SOURCE.runDigest,
		actionTraceDigest: D690_SOURCE.actionTraceDigest,
		mutationEvidenceDigest: D690_SOURCE.mutationEvidenceDigest,
		verifierRef: D690_SOURCE.verifierRef,
		verifierRevision: D690_SOURCE.verifierRevision,
		verifierEvidenceDigest: D690_SOURCE.verifierEvidenceDigest,
		classification: "complete",
		verifierStatus: "passed",
		workspaceChanged: true,
		historicalEvidenceRewritten: false,
		...overrides,
	};
}

function qualificationInput(overrides: Record<string, unknown> = {}) {
	return {
		sourceEvidence: sourceEvidence(),
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("D690 real historical pair offline qualification", () => {
	it("materializes and verifies the exact pair twice with deterministic no-network evidence", async () => {
		const first = await runD690HistoricalPairOfflineQualification(qualificationInput());
		const second = await runD690HistoricalPairOfflineQualification(qualificationInput());

		expect(first).toEqual(second);
		expect(strictJsonCodec.encode(first)).toEqual(strictJsonCodec.encode(second));
		expect(first).toMatchObject({
			claimBoundary: D690_CLAIM_BOUNDARY,
			efficacyClaim: "none",
			sourceTaskRef: D690_SOURCE.taskRef,
			targetTaskRef: D690_TARGET_TASK_REF,
			failureMechanismRef: D690_FAILURE_MECHANISM_REF,
			protectedLeakageClassCount: 5,
			historyFreeTargetQualified: true,
			hiddenVerifierQualified: true,
			preProviderQualityGatePassed: true,
			providerCallCount: 0,
			networkCallCount: 0,
			chargedCostMicrousd: 0,
			verifierRuntimeClosurePackageCount: 149,
			historicalEvidenceRewritten: false,
			naturalChronologyClaimed: false,
			targetExpectedMaterialPersisted: false,
			publicExportDelta: false,
		});
		expect(first.d689OfflineCaseCount).toBe(9);
		const { evidenceDigest, ...material } = first;
		expect(evidenceDigest).toBe(empiricalStrictJsonDigest(material));
	}, 90_000);

	it("rejects caller-authored evidence, verifier, and protection substitutions before materialization", async () => {
		let fakeSignalGetterHits = 0;
		const fakeSignal = Object.defineProperties(
			{},
			{
				aborted: {
					get: () => {
						fakeSignalGetterHits += 1;
						return false;
					},
				},
				addEventListener: {
					get: () => {
						fakeSignalGetterHits += 1;
						return () => undefined;
					},
				},
			},
		);
		await expect(
			runD690HistoricalPairOfflineQualification({
				sourceEvidence: sourceEvidence(),
				signal: fakeSignal,
			} as Parameters<typeof runD690HistoricalPairOfflineQualification>[0]),
		).rejects.toThrow(/expected AbortSignal/);
		expect(fakeSignalGetterHits).toBe(0);

		const accessorInput = Object.defineProperty({}, "sourceEvidence", {
			enumerable: true,
			get: () => sourceEvidence(),
		});
		await expect(
			runD690HistoricalPairOfflineQualification(
				accessorInput as Parameters<typeof runD690HistoricalPairOfflineQualification>[0],
			),
		).rejects.toThrow(/own data property/);

		await expect(
			runD690HistoricalPairOfflineQualification(
				qualificationInput({
					sourceEvidence: sourceEvidence({
						runDigest: empiricalStrictJsonDigest({ substituted: "run" }),
					}),
				}),
			),
		).rejects.toThrow(/frozen v14 source success/);

		await expect(
			runD690HistoricalPairOfflineQualification({
				...qualificationInput(),
				sourceRepositoryRoot: "/tmp/substituted-d690-repository",
				verifierCapability: { claimed: true },
				privateMaterialProtection: { claimed: true },
				leakageNegativeMemories: [],
			} as Parameters<typeof runD690HistoricalPairOfflineQualification>[0]),
		).rejects.toThrow(/unexpected keys/);
	});

	it("rejects cancellation before materialization or hidden verification", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			runD690HistoricalPairOfflineQualification(qualificationInput({ signal: controller.signal })),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("keeps fixed target coordinates and caller-mintable verifier seams out of module exports", () => {
		expect(d690Module).not.toHaveProperty("D690_TARGET");
		expect(d690Module).not.toHaveProperty("D690_TARGET_VERIFIER");
		expect(d690Module).not.toHaveProperty("createD690HistoricalTargetVerifierCapability");
		expect(d690Module).not.toHaveProperty("createD690PrivateLeakageProbeBundle");
		const source = readFileSync(
			resolve(
				import.meta.dirname,
				"../../evals/empirical-memory-rerun-avoidance/d690-historical-pair-qualification.ts",
			),
			"utf8",
		);
		expect(source).not.toMatch(/export const D690_TARGET\b/);
		expect(source).not.toMatch(/export const D690_TARGET_VERIFIER\b/);
		expect(empiricalStrictJsonDigest(createD690HistoricalTransferMemory())).toMatch(/^sha256:/);
	});
});
