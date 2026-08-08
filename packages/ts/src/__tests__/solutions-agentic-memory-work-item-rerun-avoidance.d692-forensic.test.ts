import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { D691HistoricalTransferObservationV1 } from "../../evals/empirical-memory-rerun-avoidance/d691-historical-transfer-live.js";
import {
	createD692HistoricalTransferForensic,
	createD692ScriptedCounterfactual,
	D692_INSPECTION_ACTION_COUNTS,
	D692_PRIVATE_GENERATION_REF,
	D692_PRIVATE_PERSISTENCE_ROOT,
	persistD692PrivateGeneration,
	runD692ScriptedTerminal,
} from "../../evals/empirical-memory-rerun-avoidance/d692-historical-transfer-forensic.js";

describe("D692 historical-transfer forensic", () => {
	it("classifies the same premature final differently without provider or network work", () => {
		const first = createD692ScriptedCounterfactual(D692_INSPECTION_ACTION_COUNTS);
		const second = createD692ScriptedCounterfactual(D692_INSPECTION_ACTION_COUNTS);
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			contractModelOnly: true,
			sourceTerminalLifecycle: "inspection-only-structured-output",
			currentGenericHostDisposition: "accepted-then-hidden-verifier-failed",
			candidateProgressGateDisposition: "rejected-before-hidden-verifier",
			currentHiddenVerifierRuns: true,
			candidateHiddenVerifierRuns: false,
			providerCallCount: 0,
			networkCallCount: 0,
			chargedCostMicrousd: 0,
		});
		let currentVerifierCalls = 0;
		let candidateVerifierCalls = 0;
		const current = runD692ScriptedTerminal({
			policy: "current-generic-host",
			terminalLifecycle: "inspection-only-structured-output",
			actionCounts: D692_INSPECTION_ACTION_COUNTS,
			hiddenVerifier: () => {
				currentVerifierCalls += 1;
				return "failed";
			},
		});
		const candidate = runD692ScriptedTerminal({
			policy: "candidate-progress-gate",
			terminalLifecycle: "inspection-only-structured-output",
			actionCounts: D692_INSPECTION_ACTION_COUNTS,
			hiddenVerifier: () => {
				candidateVerifierCalls += 1;
				return "failed";
			},
		});
		expect(current.disposition).toBe("accepted-then-hidden-verifier-failed");
		expect(candidate.disposition).toBe("rejected-before-hidden-verifier");
		expect([currentVerifierCalls, candidateVerifierCalls]).toEqual([1, 0]);
	});

	it("fails closed on an unqualified observation without leaving private staging residue", async () => {
		const before = readdirSync(D692_PRIVATE_PERSISTENCE_ROOT).filter((entry) =>
			entry.startsWith(".d692-staging-"),
		);
		const unqualified = Object.freeze({
			schemaVersion: "not-d691",
		}) as unknown as D691HistoricalTransferObservationV1;
		expect(() =>
			createD692HistoricalTransferForensic({
				observation: unqualified,
				actorCapabilitySourceBytes: new TextEncoder().encode("not the reviewed private host"),
			}),
		).toThrow();
		await expect(
			persistD692PrivateGeneration({
				privateRoot: D692_PRIVATE_PERSISTENCE_ROOT,
				generationRef: D692_PRIVATE_GENERATION_REF,
				observation: unqualified,
				actorCapabilitySourceBytes: new TextEncoder().encode("not the reviewed private host"),
			}),
		).rejects.toThrow();
		expect(
			readdirSync(D692_PRIVATE_PERSISTENCE_ROOT).filter((entry) =>
				entry.startsWith(".d692-staging-"),
			),
		).toEqual(before);
	});
});
