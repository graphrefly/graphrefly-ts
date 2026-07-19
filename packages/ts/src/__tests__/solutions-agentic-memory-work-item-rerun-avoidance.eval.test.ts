import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEMORY_RERUN_AVOIDANCE_PUBLICATION } from "../../evals/memory-rerun-avoidance/constants.js";
import { projectMemoryRerunAvoidancePresentation } from "../../evals/memory-rerun-avoidance/presentation.js";
import type { MemoryRerunAvoidancePublicationManifestV1 } from "../../evals/memory-rerun-avoidance/publication.js";
import {
	createMemoryRerunAvoidancePublicationManifest,
	publicationSha256,
	validateMemoryRerunAvoidancePublication,
	validateMemoryRerunAvoidanceScorecardBytes,
} from "../../evals/memory-rerun-avoidance/publication.js";
import { strictJsonCodec } from "../json/codec.js";
import type { EvalFamilyScorecardV1 } from "./eval-support/memory-rerun-avoidance/contracts.js";
import {
	buildEvalScope,
	buildWorkItem,
	canonicalGate,
	evalId,
	hasExactTraceAttribution,
	runMemoryRerunAvoidanceFamily,
	scorecardBytes,
	workItemDigest,
} from "./eval-support/memory-rerun-avoidance/family.js";
import {
	buildWorld,
	executeRoute,
	planRoute,
	reflectFailure,
	verifyOutcome,
} from "./eval-support/memory-rerun-avoidance/stages.js";

const SCORECARD_ARTIFACT_URL = new URL(
	"../../evals/artifacts/memory-rerun-avoidance/v1/scorecard.v1.json",
	import.meta.url,
);

const PUBLICATION_MANIFEST_URL = new URL(
	"../../evals/artifacts/memory-rerun-avoidance/v1/publication-manifest.v1.json",
	import.meta.url,
);

const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);
const TSUP_CONFIG_URL = new URL("../../tsup.config.ts", import.meta.url);
const PUBLIC_BARREL_URLS = [
	new URL("../index.ts", import.meta.url),
	new URL("../solutions/index.ts", import.meta.url),
	new URL("../testing/index.ts", import.meta.url),
];

function matchingManifestBytes(scorecard: Uint8Array): Uint8Array {
	const current = strictJsonCodec.decode(
		readFileSync(PUBLICATION_MANIFEST_URL),
	) as MemoryRerunAvoidancePublicationManifestV1;
	return strictJsonCodec.encode({
		...current,
		scorecardSha256: publicationSha256(scorecard),
		canonicalByteLength: scorecard.byteLength,
	});
}

describe("B105 deterministic memory rerun avoidance eval family", () => {
	it("separates stage predicates, case conformance, and family verdict across five cases", () => {
		const scorecard = runMemoryRerunAvoidanceFamily();
		const matrix = Object.fromEntries(
			scorecard.cases.map((observation) => [
				observation.caseKind,
				{
					proposal: observation.memory.proposal.state,
					admission: observation.memory.admission.state,
					application: observation.memory.application.state,
					retrieval: observation.memory.retrieval.state,
					warmPassed: observation.stagePredicates.warm_run_passed,
					canonicalGate: observation.canonicalGatePassed,
					caseConforms: observation.caseConforms,
				},
			]),
		);

		expect(matrix).toEqual({
			"relevant-applied": {
				proposal: "emitted",
				admission: "admitted",
				application: "applied",
				retrieval: "retrieved",
				warmPassed: true,
				canonicalGate: true,
				caseConforms: true,
			},
			"proposal-only": {
				proposal: "emitted",
				admission: "not-run",
				application: "not-run",
				retrieval: "not-retrieved",
				warmPassed: false,
				canonicalGate: false,
				caseConforms: true,
			},
			"admission-rejected": {
				proposal: "emitted",
				admission: "rejected",
				application: "not-applied",
				retrieval: "not-retrieved",
				warmPassed: false,
				canonicalGate: false,
				caseConforms: true,
			},
			"irrelevant-applied": {
				proposal: "emitted",
				admission: "admitted",
				application: "applied",
				retrieval: "retrieved",
				warmPassed: false,
				canonicalGate: false,
				caseConforms: true,
			},
			"wrong-scope-applied": {
				proposal: "emitted",
				admission: "admitted",
				application: "applied",
				retrieval: "retrieved",
				warmPassed: false,
				canonicalGate: false,
				caseConforms: true,
			},
		});
		expect(scorecard.requiredCaseRefs).toHaveLength(5);
		expect(new Set(scorecard.requiredCaseRefs).size).toBe(5);
		expect(scorecard.cases.every((observation) => observation.required)).toBe(true);
		expect(scorecard.familyPassed).toBe(true);
		expect(scorecard.familyPassed).toBe(
			scorecard.cases.every((observation) => observation.caseConforms),
		);
		expect(
			scorecard.cases.every((observation) => observation.memory.mapperExplicitCandidates === 0),
		).toBe(true);
		expect(
			scorecard.cases.every(
				(observation) => canonicalGate(observation) === observation.canonicalGatePassed,
			),
		).toBe(true);
	});

	it("keeps planner verdict-free and attributes used, irrelevant, and wrong-scope memory exactly", () => {
		const scorecard = runMemoryRerunAvoidanceFamily();
		const plannerDecision = planRoute(buildWorkItem(), buildEvalScope());
		expect(plannerDecision).not.toHaveProperty("passed");
		expect(plannerDecision).not.toHaveProperty("success");
		expect(plannerDecision).not.toHaveProperty("satisfied");
		expect(plannerDecision).toEqual({
			route: "unsafe-direct-edit",
			trace: expect.any(Array),
		});
		expect(buildWorld()).toEqual({
			worldRevision: "b105-world.v1",
			projectId: "project-b105",
			requiresVerificationBeforeEdit: true,
		});
		for (const observation of scorecard.cases) {
			expect(observation.cold.decisionTrace).toBeDefined();
			expect(observation.warm.decisionTrace).toBeDefined();
			expect(observation.cold).not.toHaveProperty("plannerPassed");
			expect(observation.warm).not.toHaveProperty("plannerPassed");
			expect(observation.stagePredicates.same_work_item_input).toBe(true);
		}
		const relevant = scorecard.cases.find((entry) => entry.caseKind === "relevant-applied");
		const irrelevant = scorecard.cases.find((entry) => entry.caseKind === "irrelevant-applied");
		const wrongScope = scorecard.cases.find((entry) => entry.caseKind === "wrong-scope-applied");
		expect(relevant?.warm.decisionTrace).toEqual(
			expect.arrayContaining([expect.objectContaining({ event: "memory-used" })]),
		);
		expect(irrelevant?.warm.decisionTrace).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: "memory-rejected",
					reasonCode: "irrelevant-procedure",
				}),
			]),
		);
		expect(wrongScope?.warm.decisionTrace).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ event: "memory-rejected", reasonCode: "scope-mismatch" }),
			]),
		);

		const item = buildWorkItem();
		const scope = buildEvalScope();
		const world = buildWorld();
		const coldOutcome = executeRoute(
			item,
			world,
			planRoute(item, scope),
			"cross-work-item-check",
			"cold",
		);
		const mismatchedOutcome = Object.freeze({ ...coldOutcome, workItemId: "wi-other" });
		const mismatchVerification = verifyOutcome(item, mismatchedOutcome);
		expect(mismatchVerification.satisfied).toBe(false);
		expect(mismatchVerification.issueCodes).toContain("b105.verify.work-item-mismatch");
		expect(() => reflectFailure(verifyOutcome(item, coldOutcome), mismatchedOutcome)).toThrow(
			/cross-WorkItem/,
		);

		const failedAfterVerification = Object.freeze({
			...coldOutcome,
			status: "failed" as const,
			facts: Object.freeze({ verificationPerformedBeforeEdit: true, editPerformed: true }),
		});
		const failedVerification = verifyOutcome(item, failedAfterVerification);
		expect(failedVerification.satisfied).toBe(false);
		expect(failedVerification.issueCodes).toContain("b105.verify.execution-failed");

		const revisionTwoItem = buildWorkItem({ executionInputRevision: 2 });
		const revisionTwoOutcome = executeRoute(
			revisionTwoItem,
			world,
			planRoute(revisionTwoItem, scope),
			"revision-two-check",
			"cold",
		);
		expect(
			reflectFailure(verifyOutcome(revisionTwoItem, revisionTwoOutcome), revisionTwoOutcome)
				.evidence,
		).toHaveProperty("executionInputRevision", 2);
	});

	it("reports lift, negative-control false positives, trace attribution, and lifecycle stages", () => {
		const scorecard = runMemoryRerunAvoidanceFamily();
		expect(scorecard.metrics).toEqual({
			relevantMemoryLift: { coldPassRate: 0, warmPassRate: 1, lift: 1 },
			negativeControlFalsePositiveRate: { falsePositives: 0, controls: 4, rate: 0 },
			traceAttribution: { attributedRetrievedRecords: 3, retrievedRecords: 3, rate: 1 },
			stageCounts: {
				proposed: 5,
				admitted: 3,
				admissionRejected: 1,
				admissionNotRun: 1,
				applied: 3,
				applicationNotApplied: 1,
				applicationNotRun: 1,
				retrieved: 3,
			},
		});
		expect(
			scorecard.cases
				.filter((observation) => observation.caseKind !== "relevant-applied")
				.every((observation) => !observation.stagePredicates.prior_failure_route_avoided),
		).toBe(true);

		const recordRef = Object.freeze({ kind: "agentic-memory-record", id: "record-1" });
		const considered = Object.freeze({
			event: "memory-considered" as const,
			recordRef,
			reasonCode: "packed-context-entry",
		});
		const rejected = Object.freeze({
			event: "memory-rejected" as const,
			recordRef,
			reasonCode: "irrelevant-procedure",
		});
		expect(hasExactTraceAttribution([considered], recordRef)).toBe(false);
		expect(hasExactTraceAttribution([considered, rejected], recordRef)).toBe(true);
		expect(hasExactTraceAttribution([considered, rejected, rejected], recordRef)).toBe(false);
	});

	it("uses strict canonical WorkItem sha256 boundaries and D574 tuple identities", () => {
		const scope = buildEvalScope();
		const item = buildWorkItem();
		const digest = workItemDigest(item, scope);
		expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		for (const changed of [
			buildWorkItem({ workItemId: "wi-b105-changed" }),
			buildWorkItem({ authoringRevision: 2 }),
			buildWorkItem({ executionInputRevision: 2 }),
			buildWorkItem({
				sourceRefs: [{ kind: "changed-kind", id: "issue-b105", metadata: { revision: 1 } }],
			}),
			buildWorkItem({
				sourceRefs: [{ kind: "issue", id: "changed-id", metadata: { revision: 1 } }],
			}),
			buildWorkItem({
				sourceRefs: [{ kind: "issue", id: "issue-b105", metadata: { revision: 2 } }],
			}),
		]) {
			expect(workItemDigest(changed, scope)).not.toBe(digest);
		}
		expect(workItemDigest(buildWorkItem({ lastEventId: "excluded-run-event" }), scope)).toBe(
			digest,
		);
		expect(
			workItemDigest(
				buildWorkItem({
					createdAtMs: 1,
					updatedAtMs: 2,
					metadata: {
						runId: "excluded",
						memory: "excluded",
						evidence: "excluded",
						trace: "excluded",
					},
				}),
				scope,
			),
		).toBe(digest);
		const orderedSourceRefs = Object.freeze([
			Object.freeze({ kind: "issue", id: "issue-b", metadata: { revision: 2 } }),
			Object.freeze({ kind: "artifact", id: "artifact-a", metadata: { revision: 1 } }),
		]);
		expect(workItemDigest(buildWorkItem({ sourceRefs: orderedSourceRefs }), scope)).toBe(
			workItemDigest(buildWorkItem({ sourceRefs: [...orderedSourceRefs].reverse() }), scope),
		);
		expect(workItemDigest(buildWorkItem({ summary: `${item.summary}!` }), scope)).not.toBe(digest);
		expect(workItemDigest(item, buildEvalScope("another-project"))).not.toBe(digest);
		const orderedMetadataDigest = workItemDigest(
			buildWorkItem({
				sourceRefs: [{ kind: "issue", id: "issue-ordered", metadata: { a: 1, b: 2 } }],
			}),
			scope,
		);
		expect(
			workItemDigest(
				buildWorkItem({
					sourceRefs: [{ kind: "issue", id: "issue-ordered", metadata: { b: 2, a: 1 } }],
				}),
				scope,
			),
		).toBe(orderedMetadataDigest);
		expect(evalId("open:a", "b::c")).not.toBe(evalId("open", "a:b::c"));
	});

	it("publishes one deterministic strict-JSON scorecard and matching bounded manifest", () => {
		const first = scorecardBytes(runMemoryRerunAvoidanceFamily());
		const second = scorecardBytes(runMemoryRerunAvoidanceFamily());
		const artifactBytes = readFileSync(SCORECARD_ARTIFACT_URL);
		const manifestBytes = readFileSync(PUBLICATION_MANIFEST_URL);
		const expectedManifestBytes = strictJsonCodec.encode(
			createMemoryRerunAvoidancePublicationManifest(artifactBytes),
		);
		expect(first).toEqual(second);
		expect(Buffer.from(first)).toEqual(artifactBytes);
		expect(manifestBytes).toEqual(Buffer.from(expectedManifestBytes));
		expect(validateMemoryRerunAvoidanceScorecardBytes(artifactBytes)).toEqual(
			runMemoryRerunAvoidanceFamily(),
		);
		expect(strictJsonCodec.decode(first)).toEqual(runMemoryRerunAvoidanceFamily());
		expect(() => JSON.stringify(strictJsonCodec.decode(first))).not.toThrow();

		const publication = validateMemoryRerunAvoidancePublication(artifactBytes, manifestBytes);
		expect(publication.manifest).toEqual({
			schemaVersion: MEMORY_RERUN_AVOIDANCE_PUBLICATION.manifestSchemaVersion,
			artifactRef: MEMORY_RERUN_AVOIDANCE_PUBLICATION.artifactRef,
			familyRef: MEMORY_RERUN_AVOIDANCE_PUBLICATION.familyRef,
			lane: "deterministic",
			scorecardSchemaVersion: MEMORY_RERUN_AVOIDANCE_PUBLICATION.scorecardSchemaVersion,
			scorecardSha256: publicationSha256(artifactBytes),
			canonicalByteLength: artifactBytes.byteLength,
			generatorRevision: MEMORY_RERUN_AVOIDANCE_PUBLICATION.generatorRevision,
			sourceRefs: MEMORY_RERUN_AVOIDANCE_PUBLICATION.sourceRefs,
		});
	});

	it("projects a read-only presentation DTO without becoming a second verdict authority", () => {
		const artifactBytes = readFileSync(SCORECARD_ARTIFACT_URL);
		const manifestBytes = readFileSync(PUBLICATION_MANIFEST_URL);
		const publication = validateMemoryRerunAvoidancePublication(artifactBytes, manifestBytes);
		const presentation = projectMemoryRerunAvoidancePresentation(artifactBytes, manifestBytes);

		expect(presentation.familyPassed).toBe(true);
		expect(presentation.cases).toHaveLength(5);
		expect(presentation.metrics.negativeControlFalsePositiveRate.rate).toBe(0);
		expect(presentation.provenance.scorecardSha256).toBe(publicationSha256(artifactBytes));
		expect(presentation.familyPassed).toBe(publication.scorecard.familyPassed);
		expect(() => JSON.stringify(presentation)).not.toThrow();
		expect(JSON.stringify(presentation)).not.toContain("provider");
		expect(Object.isFrozen(presentation.metrics.relevantMemoryLift)).toBe(true);
		expect(Object.isFrozen(presentation.resultRefs)).toBe(true);
		expect(Object.isFrozen(publication.scorecard.cases[0]?.input)).toBe(true);
		expect(() =>
			projectMemoryRerunAvoidancePresentation(
				artifactBytes,
				strictJsonCodec.encode({
					...publication.manifest,
					scorecardSha256: `sha256:${"0".repeat(64)}`,
				}),
			),
		).toThrow(/scorecardSha256.*does not match/);
	});

	it("fails closed on stale, non-canonical, incomplete, revision-skewed, or expanded publication", () => {
		const artifactBytes = readFileSync(SCORECARD_ARTIFACT_URL);
		const manifestBytes = readFileSync(PUBLICATION_MANIFEST_URL);
		const scorecard = strictJsonCodec.decode(artifactBytes) as EvalFamilyScorecardV1;
		const manifest = strictJsonCodec.decode(
			manifestBytes,
		) as MemoryRerunAvoidancePublicationManifestV1;

		expect(() =>
			validateMemoryRerunAvoidancePublication(
				artifactBytes,
				strictJsonCodec.encode({ ...manifest, scorecardSha256: `sha256:${"0".repeat(64)}` }),
			),
		).toThrow(/scorecardSha256.*does not match/);
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				artifactBytes,
				strictJsonCodec.encode({
					...manifest,
					canonicalByteLength: artifactBytes.byteLength + 1,
				}),
			),
		).toThrow(/canonicalByteLength.*does not match/);
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				artifactBytes,
				strictJsonCodec.encode({ ...manifest, schemaVersion: "publication.v2" }),
			),
		).toThrow(/schemaVersion/);
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				artifactBytes,
				strictJsonCodec.encode({ ...manifest, generatorRevision: "generator.v2" }),
			),
		).toThrow(/generatorRevision/);
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				artifactBytes,
				strictJsonCodec.encode({ ...manifest, sourceRefs: manifest.sourceRefs.slice(0, -1) }),
			),
		).toThrow(/sourceRefs.*canonical publication sources/);
		expect(() =>
			validateMemoryRerunAvoidanceScorecardBytes(
				new TextEncoder().encode(`${new TextDecoder().decode(artifactBytes)}\n`),
			),
		).toThrow(/not canonical/);

		const incompleteBytes = strictJsonCodec.encode({
			...scorecard,
			requiredCaseRefs: scorecard.requiredCaseRefs.slice(0, -1),
		});
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				incompleteBytes,
				matchingManifestBytes(incompleteBytes),
			),
		).toThrow(/requiredCaseRefs/);

		const revisionSkewBytes = strictJsonCodec.encode({
			...scorecard,
			cases: scorecard.cases.map((observation, index) =>
				index === 0
					? {
							...observation,
							input: {
								...observation.input,
								cold: { ...observation.input.cold, plannerRevision: "b105-planner.v2" },
							},
						}
					: observation,
			),
		});
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				revisionSkewBytes,
				matchingManifestBytes(revisionSkewBytes),
			),
		).toThrow(/plannerRevision/);

		const expandedScorecardBytes = strictJsonCodec.encode({ ...scorecard, provider: {} });
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				expandedScorecardBytes,
				matchingManifestBytes(expandedScorecardBytes),
			),
		).toThrow(/unexpected keys/);
		const inconsistentVerdictBytes = strictJsonCodec.encode({ ...scorecard, familyPassed: false });
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				inconsistentVerdictBytes,
				matchingManifestBytes(inconsistentVerdictBytes),
			),
		).toThrow(/familyPassed.*every/);
		expect(() =>
			validateMemoryRerunAvoidancePublication(
				artifactBytes,
				strictJsonCodec.encode({ ...manifest, familyPassed: true }),
			),
		).toThrow(/manifest.*unexpected keys/);
	});

	it("keeps B106.1 artifacts and consumers outside package exports and build entries", () => {
		const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
			exports?: Record<string, unknown>;
			files?: string[];
		};
		const forbiddenSurface = /memory-rerun-avoidance|(?:^|\/)evals(?:\/|$)/;
		expect(Object.keys(packageJson.exports ?? {}).some((key) => forbiddenSurface.test(key))).toBe(
			false,
		);
		expect((packageJson.files ?? []).some((path) => forbiddenSurface.test(path))).toBe(false);
		expect(forbiddenSurface.test(readFileSync(TSUP_CONFIG_URL, "utf8"))).toBe(false);
		for (const barrelUrl of PUBLIC_BARREL_URLS) {
			expect(forbiddenSurface.test(readFileSync(barrelUrl, "utf8"))).toBe(false);
		}
	});
});
