import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	ORCHESTRATION_COMPARISON_CLAIM_BOUNDARY,
	ORCHESTRATION_COMPARISON_VERSION,
	runD683OfflineComparativeEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/orchestration-comparative-evidence.js";

describe("D683 package-private orchestration comparative evidence", () => {
	it("runs the frozen favorable cases and simple negative control through both paths", () => {
		const evidence = runD683OfflineComparativeEvidence();

		expect(evidence).toMatchObject({
			version: ORCHESTRATION_COMPARISON_VERSION,
			claimBoundary: ORCHESTRATION_COMPARISON_CLAIM_BOUNDARY,
			networkCalls: 0,
			qualificationStatus: "partial-offline",
			missingEvidence: [
				"handwritten-coordination-source-audit",
				"preregistered-dependency-extension-change-surface",
			],
			favorableCaseCount: 2,
			negativeControlCount: 1,
			allBehaviorallyEquivalent: true,
		});
		expect(evidence.scenarios.map((scenario) => scenario.category)).toEqual([
			"dependency-rich-fan-out-fan-in",
			"provenance-and-fault",
			"simple-linear-negative-control",
		]);
		for (const scenario of evidence.scenarios) {
			expect(scenario.verifierPassed).toBe(true);
			expect(scenario.graphrefly.topology).toEqual(
				expect.objectContaining({ nodeCount: expect.any(Number), edgeCount: expect.any(Number) }),
			);
			expect(scenario.graphrefly.topology!.nodeCount).toBeGreaterThan(0);
			expect(scenario.graphrefly.topology!.edgeCount).toBeGreaterThan(0);
			expect(scenario.plainTypescript.topology).toBeNull();
		}
	});

	it("keeps the plain TypeScript baseline independent from GraphReFly source imports", () => {
		const source = readFileSync(
			new URL(
				"../../evals/empirical-memory-rerun-avoidance/orchestration-comparative-plain-typescript.ts",
				import.meta.url,
			),
			"utf8",
		);

		expect(source).not.toMatch(/(?:from|import)\s+["'][^"']*\.\.\/\.\.\/src\//);
		expect(source).not.toMatch(/@graphrefly\/ts/);
	});

	it("makes dependency readiness and fault provenance visible without changing behavior", () => {
		const evidence = runD683OfflineComparativeEvidence();
		const fanOut = evidence.scenarios[0]!;
		const fault = evidence.scenarios[1]!;

		expect(fanOut.graphrefly.issuedMemberIds).toEqual(["load", "left", "right", "join"]);
		expect(fanOut.graphrefly.terminalStatus).toBe("succeeded");
		expect(fault.graphrefly).toMatchObject({
			issuedMemberIds: ["root", "failing"],
			completedMemberIds: ["root"],
			failedMemberIds: ["failing"],
			blockedMemberIds: ["blocked"],
			terminalStatus: "failed",
			rejectedFaultCodes: ["duplicate-result", "stale-result", "wrong-operation"],
		});
		expect(fault.plainTypescript.rejectedFaultCodes).toEqual(fault.graphrefly.rejectedFaultCodes);
	});

	it("produces identical canonical evidence for the same frozen executions", () => {
		const first = runD683OfflineComparativeEvidence();
		const second = runD683OfflineComparativeEvidence();

		expect(second).toEqual(first);
		expect(first.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});
});
