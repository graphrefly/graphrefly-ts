import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	ORCHESTRATION_COMPARISON_CLAIM_BOUNDARY,
	ORCHESTRATION_COMPARISON_VERSION,
	ORCHESTRATION_COMPARISON_VERSION_V2,
	runD683CompleteOfflineComparativeEvidence,
	runD683OfflineComparativeEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/orchestration-comparative-evidence.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const GRAPHREFLY_PATH =
	"packages/ts/evals/empirical-memory-rerun-avoidance/orchestration-comparative-evidence.ts";
const PLAIN_TYPESCRIPT_PATH =
	"packages/ts/evals/empirical-memory-rerun-avoidance/orchestration-comparative-plain-typescript.ts";
const TEST_PATH =
	"packages/ts/src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d683-comparison.test.ts";

function completeEvidence() {
	const dependencyPreregistration: unknown = JSON.parse(
		readFileSync(
			new URL(
				"../../evals/empirical-memory-rerun-avoidance/d683-dependency-extension-preregistration.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const sourceAuditPreregistration: unknown = JSON.parse(
		readFileSync(
			new URL(
				"../../evals/empirical-memory-rerun-avoidance/d683-source-audit-preregistration.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const sourceAuditCoordinates = sourceAuditPreregistration as {
		readonly extensionDiff: { readonly measuredTargetPaths: readonly string[] };
	};
	const qualificationCoordinates: unknown = JSON.parse(
		readFileSync(
			new URL(
				"../../evals/empirical-memory-rerun-avoidance/d683-qualified-evidence-coordinates.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const preregistrationCoordinates = dependencyPreregistration as {
		readonly baselineCommit: string;
		readonly extension: { readonly measuredTargetPaths: readonly string[] };
	};
	return runD683CompleteOfflineComparativeEvidence({
		dependencyPreregistration,
		sourceAuditPreregistration,
		qualificationCoordinates,
		graphreflySource: {
			path: GRAPHREFLY_PATH,
			functionNames: ["runGraphReFlyPath"],
			source: readFileSync(new URL(`../../../../${GRAPHREFLY_PATH}`, import.meta.url), "utf8"),
		},
		plainTypescriptSource: {
			path: PLAIN_TYPESCRIPT_PATH,
			functionNames: ["runD683PlainTypescriptPath"],
			source: readFileSync(
				new URL(`../../../../${PLAIN_TYPESCRIPT_PATH}`, import.meta.url),
				"utf8",
			),
		},
		extensionPatch: {
			baselineCommit: preregistrationCoordinates.baselineCommit,
			measuredTargetPaths: sourceAuditCoordinates.extensionDiff.measuredTargetPaths,
			patch: execFileSync(
				"git",
				[
					"diff",
					"--no-ext-diff",
					"--no-textconv",
					"--unified=0",
					"--diff-algorithm=myers",
					"--no-renames",
					preregistrationCoordinates.baselineCommit,
					"--",
					GRAPHREFLY_PATH,
					PLAIN_TYPESCRIPT_PATH,
					TEST_PATH,
				],
				{ cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 262_144 },
			),
		},
	});
}

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

	// D683_DEPENDENCY_EXTENSION:test exact source/test change surface is selected from the real diff.
	it("completes source coordination and preregistered dependency-extension evidence", () => {
		const evidence = completeEvidence();
		const extension = evidence.scenarios.find(
			(scenario) => scenario.scenarioId === "d683-fan-out-fan-in-extension",
		);

		expect(evidence).toMatchObject({
			version: ORCHESTRATION_COMPARISON_VERSION_V2,
			qualificationStatus: "complete-offline",
			missingEvidence: [],
			favorableCaseCount: 3,
			negativeControlCount: 1,
			allBehaviorallyEquivalent: true,
		});
		expect(evidence.sourceAudit).toMatchObject({
			coordinationPolicy: "ast-local-call-closure-syntactic-proxies.v2",
			metricKind: "auxiliary-syntactic-proxy",
			extensionChangeSurface: {
				measurementStatus: "collected",
				preregisteredCoordinatorExpectationMet: true,
				total: { fileCount: 2, hunkCount: 2, testCount: 1 },
				sharedContractOrFixture: { fileCount: 1, hunkCount: 1, testCount: 0 },
				graphreflyCoordinator: { fileCount: 0, hunkCount: 0, testCount: 0 },
				plainTypescriptCoordinator: { fileCount: 0, hunkCount: 0, testCount: 0 },
				tests: { fileCount: 1, hunkCount: 1, testCount: 1 },
				excludedMeasurementInfrastructure: { fileCount: 2, hunkCount: 13, testCount: 0 },
				excludedQaCorrections: { fileCount: 1, hunkCount: 3, testCount: 0 },
			},
		});
		expect(evidence.sourceAudit.graphrefly).toMatchObject({
			entryFunctionNames: ["runGraphReFlyPath"],
			functionNames: [
				"collectData",
				"portableCoordinate",
				"validateScenario",
				"issuedForRun",
				"resultFor",
				"blockedMembers",
				"runGraphReFlyPath",
			],
			sourceLineCount: 255,
			mutatedLocalCollectionBindingCount: 8,
			conditionalSyntaxNodeCount: 17,
		});
		expect(evidence.sourceAudit.plainTypescript).toMatchObject({
			entryFunctionNames: ["runD683PlainTypescriptPath"],
			functionNames: ["runD683PlainTypescriptPath"],
			sourceLineCount: 98,
			mutatedLocalCollectionBindingCount: 5,
			conditionalSyntaxNodeCount: 10,
		});
		expect(extension).toMatchObject({
			verifierPassed: true,
			graphrefly: {
				issuedMemberIds: ["load", "left", "right", "join", "audit"],
				terminalStatus: "succeeded",
			},
			plainTypescript: {
				issuedMemberIds: ["load", "left", "right", "join", "audit"],
				terminalStatus: "succeeded",
			},
			extensionChangeSurface: { measurementStatus: "collected" },
		});
		expect(evidence.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(evidence.qualificationCoordinatesDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});
});
