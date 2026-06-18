import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type {
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../orchestration/work-item-runtime.js";
import {
	type VerificationPlan,
	validateWorkItemEffectPlan,
	type WorkItemAuthoringInput,
	type WorkItemEffectPlanProposed,
	type WorkItemEffectPlanResult,
	type WorkItemEffectPlanStatus,
	type WorkItemProjection,
	workItemAuthoringProjector,
	workItemCreatedFromDraft,
	workItemEffectPlanProjector,
} from "../solutions/work-item/scheduling.js";

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}

function draft(opts: Partial<ReturnType<typeof baseDraft>> = {}) {
	return { ...baseDraft(), ...opts };
}

function baseDraft() {
	return {
		summary: "Ship verification",
		detail: "Make the first WorkItem scheduling slice verifiable.",
		acceptanceCriteria: [{ criterionId: "ac-1", statement: "Focused tests pass", required: true }],
		verificationPlan: plan(),
		tags: ["work-item"],
		metadata: { color: "green" },
	};
}

function plan(): VerificationPlan {
	return {
		planId: "plan-1",
		steps: [
			{
				stepId: "step-1",
				mode: "auto",
				effectKind: "verification",
				verifiesCriteriaIds: ["ac-1"],
				goal: { kind: "verification", summary: "Run focused tests" },
			},
		],
	};
}

function evidenceFact(
	evidenceId: string,
	opts: Partial<WorkItemEvidenceRecorded> = {},
): WorkItemEvidenceRecorded {
	return {
		kind: "work-item-evidence-recorded",
		evidenceId,
		workItemId: "wi-1",
		effectRunId: "run-1",
		effectRunResultId: `result:${evidenceId}`,
		status: "completed",
		output: { kind: "verification-output", value: { ok: true } },
		metadata: {
			executionInputRevision: 1,
			verificationStepIds: ["step-1"],
			acceptanceCriterionIds: ["ac-1"],
		},
		...opts,
	};
}

function planSetup() {
	const g = graph();
	const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
	const proposals = g.node<WorkItemEffectPlanProposed>([], null, { name: "effectPlanProposals" });
	const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "effectPlanEvidence" });
	const authoring = workItemAuthoringProjector(g, { facts });
	const planBundle = workItemEffectPlanProjector(g, {
		workItems: authoring.workItems,
		proposals,
		evidence,
		policy: { allowedEffectKinds: ["verification"] },
		now: () => 123,
	});
	return {
		facts,
		proposals,
		evidence,
		workItems: collectData<WorkItemProjection>(authoring.workItems),
		admitted: collectData(planBundle.admitted),
		rejected: collectData(planBundle.rejected),
		requests: collectData<WorkItemEffectRequested>(planBundle.effectRequests),
		results: collectData<WorkItemEffectPlanResult>(planBundle.results),
		status: collectData<WorkItemEffectPlanStatus>(planBundle.status),
		issues: collectData(planBundle.issues),
	};
}

function planProposal(
	members: WorkItemEffectPlanProposed["members"],
	opts: Partial<
		Omit<WorkItemEffectPlanProposed, "kind" | "planId" | "workItemId" | "members">
	> = {},
): WorkItemEffectPlanProposed {
	return {
		kind: "work-item-effect-plan-proposed",
		planId: "effect-plan-1",
		workItemId: "wi-1",
		executionInputRevision: opts.executionInputRevision ?? 1,
		members,
		joinPolicy: opts.joinPolicy,
		limits: opts.limits,
		policyRefs: opts.policyRefs,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

function planMember(
	memberId: string,
	opts: Partial<WorkItemEffectPlanProposed["members"][number]> = {},
): WorkItemEffectPlanProposed["members"][number] {
	return {
		memberId,
		effectKind: opts.effectKind ?? "verification",
		goal: opts.goal ?? { kind: "verification", summary: `Run ${memberId}` },
		required: opts.required,
		dependsOnMemberIds: opts.dependsOnMemberIds,
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

function evidenceForPlanRequest(
	evidenceId: string,
	request: WorkItemEffectRequested,
	opts: Partial<WorkItemEvidenceRecorded> = {},
): WorkItemEvidenceRecorded {
	return {
		kind: "work-item-evidence-recorded",
		evidenceId,
		workItemId: request.workItemId,
		requestId: request.requestId,
		effectRunId: request.effectRunId,
		effectRunResultId: `result:${evidenceId}`,
		executionInputRevision: request.executionInputRevision,
		planId: request.planId,
		planMemberId: request.planMemberId,
		status: "completed",
		sourceRefs: request.sourceRefs,
		output: { kind: "verification-output", value: { ok: true } },
		metadata: {
			executionInputRevision: request.executionInputRevision,
			planId: request.planId,
			planMemberId: request.planMemberId,
			...(opts.metadata ?? {}),
		},
		...opts,
	};
}
describe("WorkItem authoring, verification, and scheduling surface (D333-D343) — part 2", () => {
	it("lowers WorkItemEffectPlan parallel members together", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			["DATA", planProposal([planMember("A"), planMember("B"), planMember("C")])],
		]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B", "C"]);
		expect(setup.requests).toEqual([
			expect.objectContaining({
				executionInputRevision: 1,
				planId: "effect-plan-1",
				planMemberId: "A",
			}),
			expect.objectContaining({ planId: "effect-plan-1", planMemberId: "B" }),
			expect.objectContaining({ planId: "effect-plan-1", planMemberId: "C" }),
		]);
		expect(setup.status.some((item) => item.state === "blocked")).toBe(false);
	});

	it("lowers WorkItemEffectPlan fan-out/fan-in only after all member deps pass", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			[
				"DATA",
				planProposal([
					planMember("A"),
					planMember("B", { dependsOnMemberIds: ["A"] }),
					planMember("C", { dependsOnMemberIds: ["A"] }),
					planMember("D", { dependsOnMemberIds: ["B", "C"] }),
				]),
			],
		]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);
		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-a", setup.requests.at(-1)!)]]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B", "C"]);

		const requestB = setup.requests.find((request) => request.planMemberId === "B")!;
		const requestC = setup.requests.find((request) => request.planMemberId === "C")!;
		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-b", requestB)]]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B", "C"]);

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-c", requestC)]]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B", "C", "D"]);
	});

	it("rejects stale and malformed WorkItemEffectPlan proposals visibly", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:detail",
					workItemId: "wi-1",
					patch: { detail: "new execution input" },
				},
			],
		]);
		setup.proposals.down([
			["DATA", planProposal([planMember("A")], { executionInputRevision: 1 })],
		]);

		expect(setup.rejected.at(-1)).toMatchObject({
			kind: "work-item-effect-plan-rejected",
			issues: [expect.objectContaining({ code: "stale-execution-input" })],
		});
		expect(setup.requests).toEqual([]);

		const workItem = setup.workItems.at(-1)!;
		const validationIssues = validateWorkItemEffectPlan(
			planProposal([
				planMember("dup"),
				planMember("dup"),
				planMember("dangling", { dependsOnMemberIds: ["missing"] }),
				planMember("cycle-a", { dependsOnMemberIds: ["cycle-b"] }),
				planMember("cycle-b", { dependsOnMemberIds: ["cycle-a"] }),
			]),
			workItem,
		);

		expect(validationIssues.map((item) => item.code)).toEqual(
			expect.arrayContaining(["duplicate-id", "dangling-ref", "cyclic-dependency"]),
		);
	});

	it("defers WorkItemEffectPlan proposals until their WorkItem projection exists", () => {
		const setup = planSetup();

		setup.proposals.down([["DATA", planProposal([planMember("A")])]]);
		expect(setup.rejected).toEqual([]);
		expect(setup.status.at(-1)).toMatchObject({
			state: "deferred",
			metadata: { reason: "missing-work-item" },
		});

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		expect(setup.admitted.at(-1)).toMatchObject({
			kind: "work-item-effect-plan-admitted",
			planId: "effect-plan-1",
		});
		expect(setup.requests.at(-1)).toMatchObject({ planMemberId: "A" });
	});

	it("suppresses duplicate WorkItemEffectPlan terminal evidence without rewriting results", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([["DATA", planProposal([planMember("A")])]]);
		const request = setup.requests.at(-1)!;

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-a", request)]]);
		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-a-late-fail", request, {
					status: "failed",
					error: { kind: "issue", code: "late-fail", message: "late fail" },
				}),
			],
		]);

		expect(setup.results).toHaveLength(1);
		expect(setup.results.at(-1)).toMatchObject({ status: "succeeded" });
		expect(setup.issues.at(-1)).toMatchObject({ code: "duplicate-suppressed" });
	});

	it("keeps optional independent failure from failing all-required WorkItemEffectPlan results", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			["DATA", planProposal([planMember("required"), planMember("optional", { required: false })])],
		]);

		const requiredRequest = setup.requests.find((request) => request.planMemberId === "required")!;
		const optionalRequest = setup.requests.find((request) => request.planMemberId === "optional")!;
		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-required", requiredRequest)]]);
		expect(setup.results).toEqual([expect.objectContaining({ status: "succeeded" })]);

		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-optional-failed", optionalRequest, {
					status: "failed",
					error: { kind: "issue", code: "optional-failed", message: "optional failed" },
				}),
			],
		]);

		expect(setup.results).toHaveLength(1);
		expect(setup.results.at(-1)).toMatchObject({ status: "succeeded" });
	});

	it("uses top-level plan coordinates rather than metadata as WorkItemEffectPlan join keys", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			[
				"DATA",
				planProposal([
					planMember("A", { metadata: { label: "same" } }),
					planMember("B", { dependsOnMemberIds: ["A"], metadata: { label: "same" } }),
				]),
			],
		]);

		const requestA = setup.requests.at(-1)!;
		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-a", requestA, {
					metadata: { planId: "wrong-plan", planMemberId: "B", label: "same" },
				}),
			],
		]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B"]);
		expect(setup.requests.map((request) => request.requestId)).toEqual([
			"work-item:wi-1:effect-plan:1:effect-plan-1:A",
			"work-item:wi-1:effect-plan:1:effect-plan-1:B",
		]);
	});

	it("rejects WorkItemEffectPlan evidence whose request/effectRun conflicts with plan coordinates", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			["DATA", planProposal([planMember("A"), planMember("B", { dependsOnMemberIds: ["A"] })])],
		]);

		const requestA = setup.requests.find((request) => request.planMemberId === "A")!;
		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-conflict", requestA, {
					planMemberId: "B",
					metadata: { planMemberId: "B" },
				}),
			],
		]);

		expect(setup.issues.at(-1)).toMatchObject({ code: "dangling-ref" });
		expect(setup.status.at(-1)).toMatchObject({
			state: "rejected",
			planMemberId: "B",
			requestId: requestA.requestId,
		});
		expect(setup.results).toEqual([]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);
	});

	it("rejects early WorkItemEffectPlan evidence once conflicting request coordinates are known", () => {
		const setup = planSetup();

		setup.evidence.down([
			[
				"DATA",
				evidenceFact("ev-early-conflict", {
					requestId: "work-item:wi-1:effect-plan:1:effect-plan-1:A",
					effectRunId: "effect-run:work-item:wi-1:effect-plan:1:effect-plan-1:A",
					executionInputRevision: 1,
					planId: "effect-plan-1",
					planMemberId: "B",
				}),
			],
		]);
		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			["DATA", planProposal([planMember("A"), planMember("B", { dependsOnMemberIds: ["A"] })])],
		]);

		expect(setup.issues.at(-1)).toMatchObject({ code: "dangling-ref" });
		expect(setup.status.at(-1)).toMatchObject({
			state: "rejected",
			planMemberId: "B",
			requestId: "work-item:wi-1:effect-plan:1:effect-plan-1:A",
		});
		expect(setup.results).toEqual([]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);
	});

	it("rejects WorkItemEffectPlan evidence with correct member coordinates but wrong execution identity", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([["DATA", planProposal([planMember("A")])]]);

		const requestA = setup.requests.find((request) => request.planMemberId === "A")!;
		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-wrong-effect", requestA, {
					effectRunId: "effect-run:wrong",
				}),
			],
		]);

		expect(setup.issues.at(-1)).toMatchObject({ code: "dangling-ref" });
		expect(setup.status.at(-1)).toMatchObject({
			state: "rejected",
			planMemberId: "A",
			effectRunId: "effect-run:wrong",
		});
		expect(setup.results).toEqual([]);
	});

	it("rejects WorkItemEffectPlan evidence whose requestId disagrees with known effectRun", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([["DATA", planProposal([planMember("A")])]]);

		const requestA = setup.requests.find((request) => request.planMemberId === "A")!;
		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-request-mismatch", requestA, {
					requestId: "unknown-request",
				}),
			],
		]);

		expect(setup.issues.at(-1)).toMatchObject({ code: "dangling-ref" });
		expect(setup.status.at(-1)).toMatchObject({
			state: "rejected",
			planMemberId: "A",
			requestId: "unknown-request",
			effectRunId: requestA.effectRunId,
		});
		expect(setup.results).toEqual([]);
	});

	it("accepts WorkItemEffectPlan evidence with member coordinates and effectRun but no requestId", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([["DATA", planProposal([planMember("A")])]]);

		const requestA = setup.requests.find((request) => request.planMemberId === "A")!;
		const { requestId: _requestId, ...evidenceWithoutRequestId } = evidenceForPlanRequest(
			"ev-no-request",
			requestA,
		);
		setup.evidence.down([["DATA", evidenceWithoutRequestId]]);

		expect(setup.issues.map((item) => item.code)).not.toContain("dangling-ref");
		expect(
			setup.status.find((status) => status.state === "completed" && status.planMemberId === "A"),
		).toMatchObject({
			state: "completed",
			planMemberId: "A",
			requestId: requestA.requestId,
			effectRunId: requestA.effectRunId,
		});
		expect(setup.results.at(-1)).toMatchObject({ status: "succeeded" });
	});

	it("replays early WorkItemEffectPlan evidence once the admitted plan is visible", () => {
		const setup = planSetup();

		setup.evidence.down([
			[
				"DATA",
				evidenceFact("ev-a-early", {
					effectRunId: "effect-run:work-item:wi-1:effect-plan:1:effect-plan-1:A",
					requestId: "work-item:wi-1:effect-plan:1:effect-plan-1:A",
					executionInputRevision: 1,
					planId: "effect-plan-1",
					planMemberId: "A",
					metadata: {
						requestId: "metadata-request-should-not-be-needed",
					},
				}),
			],
		]);
		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			["DATA", planProposal([planMember("A"), planMember("B", { dependsOnMemberIds: ["A"] })])],
		]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B"]);

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-b", setup.requests.at(-1)!)]]);
		expect(setup.results.at(-1)).toMatchObject({ status: "succeeded" });
		expect(setup.results.at(-1)?.memberResults).toContainEqual(
			expect.objectContaining({
				planMemberId: "A",
				requestId: "work-item:wi-1:effect-plan:1:effect-plan-1:A",
			}),
		);
	});

	it("rejects WorkItemEffectPlan evidence for unknown plan members", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([["DATA", planProposal([planMember("A")])]]);
		setup.evidence.down([
			[
				"DATA",
				evidenceFact("ev-ghost", {
					metadata: {
						executionInputRevision: 1,
						planId: "effect-plan-1",
						planMemberId: "ghost",
					},
				}),
			],
		]);

		expect(setup.issues.at(-1)).toMatchObject({ code: "dangling-ref" });
		expect(setup.status.at(-1)).toMatchObject({
			state: "rejected",
			planMemberId: "ghost",
		});
		expect(setup.results).toEqual([]);
	});

	it("does not release admitted WorkItemEffectPlan members after the WorkItem revision changes", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			["DATA", planProposal([planMember("A"), planMember("B", { dependsOnMemberIds: ["A"] })])],
		]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);

		setup.facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:detail-after-admit",
					workItemId: "wi-1",
					patch: { detail: "new execution input" },
				},
			],
		]);
		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-a", setup.requests.at(-1)!)]]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);
		expect(setup.status).toContainEqual(
			expect.objectContaining({
				state: "stale",
				issues: [expect.objectContaining({ code: "stale-execution-input" })],
			}),
		);
	});

	it("fails a WorkItemEffectPlan when a failed optional dependency blocks required work", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			[
				"DATA",
				planProposal([
					planMember("A", { required: false }),
					planMember("B", { dependsOnMemberIds: ["A"] }),
				]),
			],
		]);

		setup.evidence.down([
			[
				"DATA",
				evidenceForPlanRequest("ev-a", setup.requests.at(-1)!, {
					status: "failed",
					error: { kind: "issue", code: "optional-failed", message: "optional failed" },
				}),
			],
		]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);
		expect(setup.results.at(-1)).toMatchObject({ status: "failed" });
	});
});
