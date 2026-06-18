import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type {
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../orchestration/work-item-runtime.js";
import {
	type AcceptanceCriterion,
	type VerificationPlan,
	type VerificationResultRecorded,
	validateVerificationPlan,
	type WorkItemAuthoringInput,
	type WorkItemEffectPlanProposed,
	type WorkItemEffectPlanResult,
	type WorkItemEffectPlanStatus,
	type WorkItemProjection,
	type WorkItemVerificationMappingPolicy,
	workItemAuthoringProjector,
	workItemCreatedFromDraft,
	workItemEffectPlanProjector,
	workItemVerificationRequestLowerer,
	workItemVerificationResultMapper,
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

describe("WorkItem authoring, verification, and scheduling surface (D333-D343) — sub 2", () => {
	it("unblocks dependent verification steps after prior results pass", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const results = g.node<VerificationResultRecorded>([], null, { name: "results" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			verificationResults: results,
		});
		const requests = collectData(lowerer.effectRequests);
		const status = collectData(lowerer.status);

		facts.down([
			[
				"DATA",
				workItemCreatedFromDraft(
					"wi-1",
					draft({
						verificationPlan: {
							planId: "plan-deps",
							steps: [
								{ stepId: "step-a", mode: "auto", verifiesCriteriaIds: ["ac-1"] },
								{
									stepId: "step-b",
									mode: "auto",
									verifiesCriteriaIds: ["ac-1"],
									dependsOnStepIds: ["step-a"],
								},
							],
						},
					}),
				),
			],
		]);
		expect(requests.map((request) => request.metadata?.verificationStepIds)).toEqual([["step-a"]]);
		expect(status.at(-1)).toMatchObject({ code: "blocked-prerequisite" });

		results.down([
			[
				"DATA",
				{
					kind: "verification-result-recorded",
					resultId: "result-a",
					workItemId: "wi-1",
					evidenceId: "ev-a",
					effectRunId: "run-a",
					effectRunResultId: "effect-result-a",
					executionInputRevision: 1,
					verificationStepIds: ["step-a"],
					acceptanceCriterionIds: ["ac-1"],
					status: "passed",
				},
			],
		]);

		expect(requests.map((request) => request.metadata?.verificationStepIds)).toEqual([
			["step-a"],
			["step-b"],
		]);
	});

	it("honors verification action proposal output gates and compact payload sources", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const policies = g.node<WorkItemVerificationMappingPolicy>([], null, { name: "policies" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const mapper = workItemVerificationResultMapper(g, {
			workItems: authoring.workItems,
			evidence,
			policies,
		});
		const proposals = collectData(mapper.proposals);
		const issues = collectData(mapper.issues);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-verification-mapping-policy",
					policyId: "verify-policy",
					actionProposals: [
						{ actionKind: "wrong-output", outputKinds: ["other"], payloadFrom: "output" },
						{
							actionKind: "payload-output",
							outputKinds: ["verification-output"],
							payloadFrom: "output",
						},
						{ actionKind: "payload-result", payloadFrom: "effect-run-result" },
						{ actionKind: "payload-evidence", payloadFrom: "evidence" },
						{ actionKind: "" },
					],
				} satisfies WorkItemVerificationMappingPolicy,
			],
		]);
		evidence.down([
			[
				"DATA",
				evidenceFact("ev-policy-payload", {
					sourceRefs: [{ kind: "work-item-verification-mapping-policy", id: "verify-policy" }],
				}),
			],
		]);

		expect(proposals.map((proposal) => proposal.actionKind)).toEqual([
			"payload-output",
			"payload-result",
			"payload-evidence",
		]);
		expect(proposals.find((proposal) => proposal.actionKind === "payload-output")?.payload).toEqual(
			{
				kind: "verification-output",
				value: { ok: true },
			},
		);
		expect(proposals.find((proposal) => proposal.actionKind === "payload-result")?.payload).toEqual(
			{
				kind: "effect-run-result-ref",
				resultId: "result:ev-policy-payload",
			},
		);
		expect(
			proposals.find((proposal) => proposal.actionKind === "payload-evidence")?.payload,
		).toEqual({
			kind: "work-item-evidence-ref",
			evidenceId: "ev-policy-payload",
		});
		expect(issues.at(-1)).toMatchObject({ code: "policy-mismatch" });
	});

	it("replays evidence when explicit mapping policy arrives later", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const policies = g.node<WorkItemVerificationMappingPolicy>([], null, { name: "policies" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const mapper = workItemVerificationResultMapper(g, {
			workItems: authoring.workItems,
			evidence,
			policies,
		});
		const results = collectData(mapper.results);
		const proposals = collectData(mapper.proposals);
		const issues = collectData(mapper.issues);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		evidence.down([
			[
				"DATA",
				evidenceFact("ev-late-policy", {
					sourceRefs: [{ kind: "work-item-verification-mapping-policy", id: "late-policy" }],
				}),
			],
		]);
		expect(results).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({ code: "missing-policy" });
		expect(proposals).toEqual([]);

		policies.down([
			[
				"DATA",
				{
					kind: "work-item-verification-mapping-policy",
					policyId: "late-policy",
					actionProposals: [{ actionKind: "mark-verified", statuses: ["completed"] }],
				} satisfies WorkItemVerificationMappingPolicy,
			],
		]);

		expect(results).toHaveLength(1);
		expect(proposals.at(-1)).toMatchObject({
			actionKind: "mark-verified",
			policyId: "late-policy",
		});
	});

	it("replays cached evidence when the WorkItem projection arrives or catches up", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const mapper = workItemVerificationResultMapper(g, {
			workItems: authoring.workItems,
			evidence,
		});
		const results = collectData(mapper.results);
		const issues = collectData(mapper.issues);

		evidence.down([["DATA", evidenceFact("ev-before-work-item")]]);
		expect(results).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "dangling-ref" });

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);

		expect(results.at(-1)).toMatchObject({
			resultId: "verification-result:ev-before-work-item",
			workItemId: "wi-1",
		});
	});

	it("validates malformed mapping policies and honors every referenced policy", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const policies = g.node<WorkItemVerificationMappingPolicy>([], null, { name: "policies" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const mapper = workItemVerificationResultMapper(g, {
			workItems: authoring.workItems,
			evidence,
			policies,
		});
		const proposals = collectData(mapper.proposals);
		const issues = collectData(mapper.issues);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-verification-mapping-policy",
					policyId: "bad-policy",
					actionProposals: [{ metadata: { missing: "actionKind" } }],
				} as unknown as WorkItemVerificationMappingPolicy,
			],
			[
				"DATA",
				{
					kind: "work-item-verification-mapping-policy",
					policyId: "policy-a",
					actionProposals: [{ actionKind: "mark-verified-a" }],
				} satisfies WorkItemVerificationMappingPolicy,
			],
			[
				"DATA",
				{
					kind: "work-item-verification-mapping-policy",
					policyId: "policy-b",
					actionProposals: [{ actionKind: "mark-verified-b" }],
				} satisfies WorkItemVerificationMappingPolicy,
			],
		]);
		evidence.down([
			[
				"DATA",
				evidenceFact("ev-multi-policy", {
					sourceRefs: [
						{ kind: "work-item-verification-mapping-policy", id: "policy-a" },
						{ kind: "work-item-verification-mapping-policy", id: "policy-b" },
					],
				}),
			],
		]);

		expect(issues.at(0)).toMatchObject({ code: "policy-mismatch" });
		expect(proposals.map((proposal) => proposal.actionKind)).toEqual([
			"mark-verified-a",
			"mark-verified-b",
		]);
	});

	it("rejects verification evidence with dangling coverage refs", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const mapper = workItemVerificationResultMapper(g, {
			workItems: authoring.workItems,
			evidence,
		});
		const results = collectData(mapper.results);
		const issues = collectData(mapper.issues);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		evidence.down([
			[
				"DATA",
				evidenceFact("ev-bad-coverage", {
					metadata: {
						executionInputRevision: 1,
						verificationStepIds: ["missing-step"],
						acceptanceCriterionIds: ["ac-1"],
					},
				}),
			],
		]);

		expect(results).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "dangling-ref" });
	});

	it("reports validation taxonomy issues for duplicate ids, refs, cycles, modes, and effect kinds", () => {
		const criteria: AcceptanceCriterion[] = [{ criterionId: "ac-1", statement: "Has tests" }];
		const issues = validateVerificationPlan(
			{
				planId: "bad",
				steps: [
					{
						stepId: "step-1",
						mode: "auto",
						verifiesCriteriaIds: ["missing-ac"],
						dependsOnStepIds: ["step-2"],
					},
					{
						stepId: "step-1",
						mode: "manual",
					},
					{
						stepId: "step-2",
						mode: "robot" as "auto",
						effectKind: "deploy",
						dependsOnStepIds: ["step-3"],
					},
					{
						stepId: "step-3",
						mode: "auto",
						dependsOnStepIds: ["step-2"],
					},
				],
			},
			criteria,
		);

		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"duplicate-id",
				"dangling-ref",
				"cyclic-dependency",
				"unsupported-mode",
				"unsupported-effect-kind",
			]),
		);
	});

	it("lowers WorkItemEffectPlan serial members one prerequisite at a time", () => {
		const setup = planSetup();

		setup.facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			[
				"DATA",
				planProposal([
					planMember("A"),
					planMember("B", { dependsOnMemberIds: ["A"] }),
					planMember("C", { dependsOnMemberIds: ["B"] }),
				]),
			],
		]);

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A"]);
		expect(
			setup.status.filter((item) => item.state === "blocked").map((item) => item.planMemberId),
		).toEqual(["B", "C"]);

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-a", setup.requests.at(-1)!)]]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B"]);

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-b", setup.requests.at(-1)!)]]);
		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["A", "B", "C"]);

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-c", setup.requests.at(-1)!)]]);
		expect(setup.results.at(-1)).toMatchObject({
			status: "succeeded",
			memberResults: [
				expect.objectContaining({ planMemberId: "A" }),
				expect.objectContaining({ planMemberId: "B" }),
				expect.objectContaining({ planMemberId: "C" }),
			],
		});
	});
});
