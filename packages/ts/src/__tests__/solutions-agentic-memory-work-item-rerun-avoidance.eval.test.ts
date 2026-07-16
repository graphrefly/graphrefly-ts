import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strictJsonCodec } from "../json/codec.js";
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

const GOLDEN_URL = new URL(
	"./eval-support/memory-rerun-avoidance/memory-rerun-avoidance.scorecard.v1.json",
	import.meta.url,
);

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

	it("emits the same strict-JSON v1 scorecard bytes on consecutive runs and matches golden", () => {
		const first = scorecardBytes(runMemoryRerunAvoidanceFamily());
		const second = scorecardBytes(runMemoryRerunAvoidanceFamily());
		const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as unknown;
		const goldenCanonicalBytes = strictJsonCodec.encode(golden);
		expect(first).toEqual(second);
		expect(first).toEqual(goldenCanonicalBytes);
		expect(strictJsonCodec.decode(goldenCanonicalBytes)).toEqual(runMemoryRerunAvoidanceFamily());
		expect(strictJsonCodec.decode(first)).toEqual(runMemoryRerunAvoidanceFamily());
		expect(() => JSON.stringify(strictJsonCodec.decode(first))).not.toThrow();
	});
});
