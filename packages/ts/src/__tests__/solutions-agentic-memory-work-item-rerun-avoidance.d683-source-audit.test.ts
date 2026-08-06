import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createD683SourceAuditEvidence,
	D683_DEPENDENCY_EXTENSION_SHARED_MARKER,
	D683_DEPENDENCY_EXTENSION_TEST_MARKER,
	D683_QA_CORRECTION_MARKER,
	D683_SOURCE_AUDIT_VERSION,
	type D683SourceAuditEvidenceV1,
	validateD683QualifiedEvidenceCoordinates,
} from "../../evals/empirical-memory-rerun-avoidance/orchestration-comparative-source-audit.js";

const SOURCE_PATH = "packages/ts/evals/d683-source.ts";
const PLAIN_PATH = "packages/ts/evals/d683-plain.ts";
const TEST_PATH = "packages/ts/src/__tests__/d683-source.test.ts";
const QUALIFIED_GRAPH_PATH =
	"packages/ts/evals/empirical-memory-rerun-avoidance/orchestration-comparative-evidence.ts";
const QUALIFIED_PLAIN_PATH =
	"packages/ts/evals/empirical-memory-rerun-avoidance/orchestration-comparative-plain-typescript.ts";
const QUALIFIED_TEST_PATH =
	"packages/ts/src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d683-comparison.test.ts";

function fixtureInput() {
	const graphSecretSentinel = "graph-source-private-sentinel";
	const plainSecretSentinel = "plain-source-private-sentinel";
	const patchSecretSentinel = "patch-private-sentinel";
	return {
		graphSecretSentinel,
		plainSecretSentinel,
		patchSecretSentinel,
		input: {
			graphrefly: {
				path: SOURCE_PATH,
				functionNames: ["graphPath"],
				source: `function graphPath() {
	const states = new Map<string, string>();
	if (states.size === 0) states.set("${graphSecretSentinel}", "pending");
}`,
			},
			plainTypescript: {
				path: PLAIN_PATH,
				functionNames: ["plainPath"],
				source: `function plainPath() {
	const queue: string[] = [];
	queue.push("${plainSecretSentinel}");
	return queue.length === 0 ? "empty" : "ready";
}`,
			},
			extensionPatch: {
				baselineCommit: "a".repeat(40),
				measuredTargetPaths: [SOURCE_PATH, PLAIN_PATH, TEST_PATH],
				patch: `diff --git a/${SOURCE_PATH} b/${SOURCE_PATH}
--- a/${SOURCE_PATH}
+++ b/${SOURCE_PATH}
@@ -1 +1,2 @@
+// ${D683_DEPENDENCY_EXTENSION_SHARED_MARKER} ${patchSecretSentinel}
+const audit = true;
diff --git a/${TEST_PATH} b/${TEST_PATH}
--- a/${TEST_PATH}
+++ b/${TEST_PATH}
@@ -1 +1,2 @@
+// ${D683_DEPENDENCY_EXTENSION_TEST_MARKER}
+it("verifies extension", () => {});`,
			},
		},
	};
}

describe("D683 package-private source and change-surface audit", () => {
	it("derives bounded AST and marked-diff evidence without retaining source material", () => {
		const fixture = fixtureInput();
		const evidence = createD683SourceAuditEvidence(fixture.input);
		const serialized = JSON.stringify(evidence);

		expect(evidence.graphrefly).toMatchObject({
			mutatedLocalCollectionBindingCount: 1,
			conditionalSyntaxNodeCount: 1,
		});
		expect(evidence.plainTypescript).toMatchObject({
			mutatedLocalCollectionBindingCount: 1,
			conditionalSyntaxNodeCount: 1,
		});
		expect(evidence.extensionChangeSurface).toMatchObject({
			preregisteredCoordinatorExpectationMet: true,
			total: { fileCount: 2, hunkCount: 2, testCount: 1 },
			sharedContractOrFixture: { fileCount: 1, hunkCount: 1, testCount: 0 },
			graphreflyCoordinator: { fileCount: 0, hunkCount: 0, testCount: 0 },
			plainTypescriptCoordinator: { fileCount: 0, hunkCount: 0, testCount: 0 },
			tests: { fileCount: 1, hunkCount: 1, testCount: 1 },
			excludedMeasurementInfrastructure: { fileCount: 0, hunkCount: 0, testCount: 0 },
			excludedQaCorrections: { fileCount: 0, hunkCount: 0, testCount: 0 },
		});
		expect(serialized).not.toContain(fixture.graphSecretSentinel);
		expect(serialized).not.toContain(fixture.plainSecretSentinel);
		expect(serialized).not.toContain(fixture.patchSecretSentinel);
	});

	it("fails closed on unmatched function or extension target coordinates", () => {
		const fixture = fixtureInput();
		expect(() =>
			createD683SourceAuditEvidence({
				...fixture.input,
				graphrefly: { ...fixture.input.graphrefly, functionNames: ["missingFunction"] },
			}),
		).toThrow(/exactly one function/);
		expect(() =>
			createD683SourceAuditEvidence({
				...fixture.input,
				extensionPatch: {
					...fixture.input.extensionPatch,
					measuredTargetPaths: fixture.input.extensionPatch.measuredTargetPaths.filter(
						(path) => path !== PLAIN_PATH,
					),
				},
			}),
		).toThrow(/include both coordinator paths/);
	});

	it("rejects removed markers, marker-class swaps, and shadowed collection bindings", () => {
		const fixture = fixtureInput();
		expect(() =>
			createD683SourceAuditEvidence({
				...fixture.input,
				extensionPatch: {
					...fixture.input.extensionPatch,
					patch: fixture.input.extensionPatch.patch.replace(
						`+// ${D683_DEPENDENCY_EXTENSION_SHARED_MARKER}`,
						`-// ${D683_DEPENDENCY_EXTENSION_SHARED_MARKER}`,
					),
				},
			}),
		).toThrow(/separately marked source and test evidence/);
		expect(() =>
			createD683SourceAuditEvidence({
				...fixture.input,
				extensionPatch: {
					...fixture.input.extensionPatch,
					patch: fixture.input.extensionPatch.patch.replace(
						D683_DEPENDENCY_EXTENSION_SHARED_MARKER,
						D683_DEPENDENCY_EXTENSION_TEST_MARKER,
					),
				},
			}),
		).toThrow(/test marker must be in a test file/);
		expect(() =>
			createD683SourceAuditEvidence({
				...fixture.input,
				graphrefly: {
					...fixture.input.graphrefly,
					source: `function graphPath() {
	const states = new Map();
	if (states.size === 0) { const states = new Set(); states.add(1); }
}`,
				},
			}),
		).toThrow(/shadowed mutable collection names/);
	});

	it("binds complete evidence to the exact committed qualification coordinates", () => {
		const coordinates = JSON.parse(
			readFileSync(
				new URL(
					"../../evals/empirical-memory-rerun-avoidance/d683-qualified-evidence-coordinates.json",
					import.meta.url,
				),
				"utf8",
			),
		) as {
			readonly parserRevision: string;
			readonly coordinationPolicy: D683SourceAuditEvidenceV1["coordinationPolicy"];
			readonly metricKind: D683SourceAuditEvidenceV1["metricKind"];
			readonly sourceAuditEvidenceDigest: string;
			readonly graphrefly: D683SourceAuditEvidenceV1["graphrefly"];
			readonly plainTypescript: D683SourceAuditEvidenceV1["plainTypescript"];
			readonly extensionPatchDigest: string;
		};
		const evidence: D683SourceAuditEvidenceV1 = {
			version: D683_SOURCE_AUDIT_VERSION,
			parserRevision: coordinates.parserRevision,
			coordinationPolicy: coordinates.coordinationPolicy,
			metricKind: coordinates.metricKind,
			graphrefly: coordinates.graphrefly,
			plainTypescript: coordinates.plainTypescript,
			extensionChangeSurface: {
				measurementStatus: "collected",
				preregisteredCoordinatorExpectationMet: true,
				baselineCommit: "2a488bcc8867d4e400573fb93dcaf7f3b483eef4",
				patchDigest: coordinates.extensionPatchDigest,
				commandRevision: "git-diff-no-ext-no-textconv-unified0-myers-no-renames.v1",
				markers: {
					sharedContract: D683_DEPENDENCY_EXTENSION_SHARED_MARKER,
					test: D683_DEPENDENCY_EXTENSION_TEST_MARKER,
					qaCorrection: D683_QA_CORRECTION_MARKER,
				},
				total: {
					fileCount: 2,
					hunkCount: 2,
					testCount: 1,
					changedPaths: [QUALIFIED_GRAPH_PATH, QUALIFIED_TEST_PATH],
				},
				sharedContractOrFixture: {
					fileCount: 1,
					hunkCount: 1,
					testCount: 0,
					changedPaths: [QUALIFIED_GRAPH_PATH],
				},
				graphreflyCoordinator: { fileCount: 0, hunkCount: 0, testCount: 0, changedPaths: [] },
				plainTypescriptCoordinator: {
					fileCount: 0,
					hunkCount: 0,
					testCount: 0,
					changedPaths: [],
				},
				tests: {
					fileCount: 1,
					hunkCount: 1,
					testCount: 1,
					changedPaths: [QUALIFIED_TEST_PATH],
				},
				excludedMeasurementInfrastructure: {
					fileCount: 2,
					hunkCount: 13,
					testCount: 0,
					changedPaths: [QUALIFIED_GRAPH_PATH, QUALIFIED_TEST_PATH],
				},
				excludedQaCorrections: {
					fileCount: 1,
					hunkCount: 3,
					testCount: 0,
					changedPaths: [QUALIFIED_PLAIN_PATH],
				},
			},
			evidenceDigest: coordinates.sourceAuditEvidenceDigest,
		};

		expect(validateD683QualifiedEvidenceCoordinates(coordinates, evidence)).toMatch(
			/^sha256:[0-9a-f]{64}$/,
		);
		expect(() =>
			validateD683QualifiedEvidenceCoordinates(
				{ ...coordinates, parserRevision: "typescript@tampered" },
				evidence,
			),
		).toThrow(/coordinates digest mismatch/);
	});
});
