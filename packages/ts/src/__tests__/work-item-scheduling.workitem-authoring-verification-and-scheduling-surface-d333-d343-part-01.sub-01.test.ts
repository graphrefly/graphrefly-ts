import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type {
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
} from "../orchestration/work-item-runtime.js";
import {
	DEFAULT_WORK_ITEM_LINK_TYPE_CATALOG_SEED,
	DEFAULT_WORK_ITEM_TYPE_CATALOG_SEED,
	type RecommendedActionView,
	type RequiredInputGate,
	type RequiredInputResponseProposed,
	type SidePanelActionIntent,
	type VerificationPlan,
	verificationPlanChanged,
	type WorkItemAuthoringInput,
	type WorkItemDispatchIntent,
	type WorkItemEffectPlanProposed,
	type WorkItemEffectPlanResult,
	type WorkItemEffectPlanStatus,
	type WorkItemLinked,
	type WorkItemLinkProjection,
	type WorkItemProjection,
	type WorkItemSpawnAdmission,
	type WorkItemSpawnApplication,
	type WorkItemVerificationMappingPolicy,
	workItemAuthoringProjector,
	workItemCreatedFromDraft,
	workItemEffectPlanProjector,
	workItemSpawnProposed,
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

function _planSetup() {
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

function _planProposal(
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

function _planMember(
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

function _evidenceForPlanRequest(
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

describe("WorkItem authoring, verification, and scheduling surface (D333-D343) — sub 1", () => {
	it("lowers human/API WorkItemDraft facts to projections with revision coordinates", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const bundle = workItemAuthoringProjector(g, { facts });
		const workItems = collectData<WorkItemProjection>(bundle.workItems);
		const issues = collectData(bundle.issues);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);

		expect(issues).toEqual([]);
		expect(workItems.at(-1)).toMatchObject({
			workItemId: "wi-1",
			summary: "Ship verification",
			authoringRevision: 1,
			executionInputRevision: 1,
			verificationPlan: expect.objectContaining({ planId: "plan-1" }),
		});
	});

	it("lets LLM spawn proposals carry WorkItemDraft without applying them", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const bundle = workItemAuthoringProjector(g, { facts });
		const workItems = collectData(bundle.workItems);
		const status = collectData(bundle.status);

		facts.down([
			[
				"DATA",
				workItemSpawnProposed("spawn-1", draft({ summary: "Proposed child" }), {
					proposedWorkItemId: "wi-child",
					parentWorkItemId: "wi-parent",
					idempotencyKey: "spawn:wi-parent:wi-child",
				}),
			],
		]);

		expect(workItems).toEqual([]);
		expect(status.at(-1)).toMatchObject({
			state: "deferred",
			workItemId: "wi-child",
			metadata: {
				proposalId: "spawn-1",
				parentWorkItemId: "wi-parent",
				idempotencyKey: "spawn:wi-parent:wi-child",
			},
		});
	});

	it("publishes Workspace WorkItem model seeds and proposal-facing view shapes", () => {
		expect(DEFAULT_WORK_ITEM_TYPE_CATALOG_SEED.map((entry) => entry.kind)).toEqual([
			"task",
			"spike",
			"review",
		]);
		expect(DEFAULT_WORK_ITEM_LINK_TYPE_CATALOG_SEED.map((entry) => entry.linkKind)).toEqual([
			"parent-child",
			"blocks",
			"related",
			"duplicate",
			"spawned-from",
		]);

		const linkFact = {
			kind: "work-item-linked",
			eventId: "link:event:1",
			linkId: "link:1",
			fromWorkItemId: "wi-1",
			toWorkItemId: "wi-2",
			linkKind: "blocks",
		} satisfies WorkItemLinked;
		const linkProjection = {
			linkId: linkFact.linkId,
			fromWorkItemId: linkFact.fromWorkItemId,
			toWorkItemId: linkFact.toWorkItemId,
			linkKind: linkFact.linkKind,
			direction: "directed",
			active: true,
			lastEventId: linkFact.eventId,
		} satisfies WorkItemLinkProjection;
		const spawnAdmission = {
			kind: "work-item-spawn-admission",
			admissionId: "spawn-admission:1",
			proposalId: "spawn-1",
			state: "admitted",
			decisionId: "spawn-decision:1",
			proposedWorkItemId: "wi-child",
		} satisfies WorkItemSpawnAdmission;
		const spawnApplication = {
			kind: "work-item-spawn-application",
			applicationId: "spawn-application:1",
			admissionId: spawnAdmission.admissionId,
			proposalId: spawnAdmission.proposalId,
			state: "applied",
			linkFacts: [linkFact],
		} satisfies WorkItemSpawnApplication;
		const requiredInput = {
			kind: "required-input-gate",
			gateId: "gate:1",
			requestId: "required-input:1",
			workItemId: "wi-1",
			status: "requested",
			prompt: "Confirm metric definition",
		} satisfies RequiredInputGate;
		const response = {
			kind: "required-input-response-proposed",
			proposalId: "input-response:1",
			requestId: requiredInput.requestId,
			workItemId: requiredInput.workItemId,
			summary: "Use weekly activated accounts",
		} satisfies RequiredInputResponseProposed;
		const action = {
			kind: "recommended-action-view",
			actionId: "provide-input",
			label: "Provide input",
			tone: "attention",
			loweringKind: "required-input-response-proposed",
			draftSeed: response,
		} satisfies RecommendedActionView;
		const intent = {
			kind: "side-panel-action-intent",
			intentId: "intent:1",
			actionId: action.actionId,
			loweringKind: action.loweringKind,
			workItemId: requiredInput.workItemId,
			draft: response,
		} satisfies SidePanelActionIntent<RequiredInputResponseProposed>;

		expect(linkProjection.active).toBe(true);
		expect(spawnApplication.linkFacts).toEqual([linkFact]);
		expect(action.draftSeed).toBe(response);
		expect(intent.loweringKind).toBe("required-input-response-proposed");
	});

	it("turns malformed runtime drafts, duplicate creates, and invalid patches into visible issues", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const bundle = workItemAuthoringProjector(g, { facts });
		const workItems = collectData<WorkItemProjection>(bundle.workItems);
		const issues = collectData(bundle.issues);
		const status = collectData(bundle.status);

		facts.down([
			[
				"DATA",
				{
					kind: "work-item-created",
					eventId: "bad-create",
					workItemId: "bad",
					draft: { summary: 7 },
				} as unknown as WorkItemAuthoringInput,
			],
		]);
		facts.down([
			[
				"DATA",
				workItemSpawnProposed("bad-spawn", { summary: "" } as unknown as ReturnType<typeof draft>),
			],
		]);
		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft(), { eventId: "wi-1:again" })]]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:bad-patch",
					workItemId: "wi-1",
					patch: { workItemId: "evil" },
				} as unknown as WorkItemAuthoringInput,
			],
		]);

		expect(workItems.at(-1)).toMatchObject({ workItemId: "wi-1", authoringRevision: 1 });
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining(["missing-required-field", "duplicate-id", "invalid-patch"]),
		);
		expect(status.map((item) => item.state)).toEqual(
			expect.arrayContaining(["rejected", "duplicate"]),
		);
	});

	it("separates authoringRevision from executionInputRevision for metadata-only changes", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const bundle = workItemAuthoringProjector(g, {
			facts,
			policy: { executionRelevantFields: ["customFields.risk"] },
		});
		const workItems = collectData<WorkItemProjection>(bundle.workItems);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:metadata",
					workItemId: "wi-1",
					patch: { metadata: { color: "blue" } },
				},
			],
		]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:custom-field-other",
					workItemId: "wi-1",
					patch: { customFields: { other: true } },
				},
			],
		]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:custom-field-risk",
					workItemId: "wi-1",
					patch: { customFields: { risk: "high" } },
				},
			],
		]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:detail",
					workItemId: "wi-1",
					patch: { detail: "Updated execution detail" },
				},
			],
		]);

		expect(workItems.map((item) => [item.authoringRevision, item.executionInputRevision])).toEqual([
			[1, 1],
			[2, 1],
			[3, 1],
			[4, 2],
			[5, 3],
		]);
	});

	it("lets patch facts clear optional draft fields without clearing required summary", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const bundle = workItemAuthoringProjector(g, { facts });
		const workItems = collectData<WorkItemProjection>(bundle.workItems);
		const issues = collectData(bundle.issues);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:clear-detail",
					workItemId: "wi-1",
					patch: { detail: undefined },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(workItems.at(-1)).toMatchObject({
			workItemId: "wi-1",
			detail: undefined,
			authoringRevision: 2,
			executionInputRevision: 2,
		});
	});

	it("lowers VerificationPlanChanged to stable WorkItemEffectRequested refs", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			policy: { policyId: "verify-auto", autoRun: true },
		});
		const requests = collectData(lowerer.effectRequests);

		facts.down([
			["DATA", workItemCreatedFromDraft("wi-1", draft({ verificationPlan: undefined }))],
		]);
		facts.down([["DATA", verificationPlanChanged("wi-1", plan(), { eventId: "wi-1:plan-1" })]]);

		expect(requests.at(-1)).toMatchObject({
			kind: "work-item-effect-requested",
			requestId: "work-item:wi-1:verification:2:plan-1:step-1",
			workItemId: "wi-1",
			effectRunId: "effect-run:work-item:wi-1:verification:2:plan-1:step-1",
			effectKind: "verification",
			idempotencyKey: "wi-1:verification:2:plan-1:step-1",
			metadata: {
				executionInputRevision: 2,
				verificationStepIds: ["step-1"],
				acceptanceCriterionIds: ["ac-1"],
			},
		});
	});

	it("requires explicit event ids for repeated mutable change helpers", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const bundle = workItemAuthoringProjector(g, { facts });
		const workItems = collectData<WorkItemProjection>(bundle.workItems);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		facts.down([["DATA", verificationPlanChanged("wi-1", plan(), { eventId: "wi-1:plan-a" })]]);
		facts.down([
			[
				"DATA",
				verificationPlanChanged(
					"wi-1",
					{
						planId: "plan-2",
						steps: [{ stepId: "step-2", mode: "auto", verifiesCriteriaIds: ["ac-1"] }],
					},
					{ eventId: "wi-1:plan-b" },
				),
			],
		]);

		expect(workItems.at(-1)).toMatchObject({
			verificationPlan: expect.objectContaining({ planId: "plan-2" }),
			authoringRevision: 3,
			executionInputRevision: 3,
		});
	});

	it("preserves verification step input and scheduling hints on emitted requests", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput<{ target: string }>>([], null, {
			name: "facts",
		});
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			policy: { policyId: "verify-auto", autoRun: true },
		});
		const requests = collectData(lowerer.effectRequests);
		const contextRefs = [{ kind: "source-file", id: "src/work-item.ts" }];
		const capacityHints = { lane: "ci", expectedMs: 2500 };

		facts.down([
			[
				"DATA",
				workItemCreatedFromDraft(
					"wi-1",
					draft({
						verificationPlan: {
							planId: "plan-rich",
							steps: [
								{
									stepId: "step-rich",
									mode: "auto",
									effectKind: "verification",
									verifiesCriteriaIds: ["ac-1"],
									goal: { kind: "verification", summary: "Run rich verification" },
									input: { target: "release" },
									contextRefs,
									requirements: ["node-20", "pnpm"],
									capacityHints,
								},
							],
						},
					}),
				),
			],
		]);

		expect(requests.at(-1)).toMatchObject({
			goal: {
				input: {
					inputId: "verification-step:step-rich:input",
					inputKind: "verification",
					dataMode: "inline",
					value: { target: "release" },
					subjectRefs: contextRefs,
				},
			},
			metadata: {
				contextRefs,
				requirements: ["node-20", "pnpm"],
				capacityHints,
			},
		});
	});

	it("emits visible status when verification auto-run is disabled by policy", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			policy: { policyId: "manual-policy", autoRun: false },
		});
		const requests = collectData(lowerer.effectRequests);
		const status = collectData(lowerer.status);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);

		expect(requests).toEqual([]);
		expect(status.at(-1)).toMatchObject({
			state: "deferred",
			code: "policy-mismatch",
			metadata: { policyId: "manual-policy", reason: "auto-run-disabled" },
		});
	});

	it("preserves dispatch intent context, requirements, capacity hints, and limits", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const intents = g.node<WorkItemDispatchIntent>([], null, { name: "intents" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			dispatchIntents: intents,
		});
		const requests = collectData(lowerer.effectRequests);
		const contextRefs = [{ kind: "artifact", id: "build-log" }];
		const capacityHints = { lane: "review" };

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		intents.down([
			[
				"DATA",
				{
					kind: "work-item-dispatch-intent",
					intentId: "intent-current",
					workItemId: "wi-1",
					targetKind: "verification",
					executionInputRevision: 1,
					contextRefs,
					requirements: ["human-readable-summary"],
					capacityHints,
					limits: { timeoutMs: 120000, maxSteps: 4 },
				} satisfies WorkItemDispatchIntent,
			],
		]);

		expect(requests.at(-1)).toMatchObject({
			limits: { timeoutMs: 120000, maxSteps: 4 },
			metadata: {
				contextRefs,
				requirements: ["human-readable-summary"],
				capacityHints,
			},
		});
	});

	it("rejects dispatch intents outside the verification effect policy", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const intents = g.node<WorkItemDispatchIntent>([], null, { name: "intents" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			dispatchIntents: intents,
		});
		const requests = collectData(lowerer.effectRequests);
		const issues = collectData(lowerer.issues);
		const status = collectData(lowerer.status);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		const beforeIntentRequestCount = requests.length;
		intents.down([
			[
				"DATA",
				{
					kind: "work-item-dispatch-intent",
					intentId: "intent-executor",
					workItemId: "wi-1",
					targetKind: "executor",
					executionInputRevision: 1,
				} satisfies WorkItemDispatchIntent,
			],
		]);

		expect(requests).toHaveLength(beforeIntentRequestCount);
		expect(issues.at(-1)).toMatchObject({ code: "unsupported-effect-kind" });
		expect(status.at(-1)).toMatchObject({ state: "rejected", code: "unsupported-effect-kind" });
	});

	it("emits visible stale issues for dispatch intents targeting an old execution input", () => {
		const g = graph();
		const facts = g.node<WorkItemAuthoringInput>([], null, { name: "facts" });
		const intents = g.node<WorkItemDispatchIntent>([], null, { name: "intents" });
		const authoring = workItemAuthoringProjector(g, { facts });
		const lowerer = workItemVerificationRequestLowerer(g, {
			workItems: authoring.workItems,
			dispatchIntents: intents,
			policy: { stalePolicy: "review" },
		});
		const requests = collectData(lowerer.effectRequests);
		const issues = collectData(lowerer.issues);
		const status = collectData(lowerer.status);

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		facts.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:detail",
					workItemId: "wi-1",
					patch: { detail: "Changed before execution" },
				},
			],
		]);
		const beforeIntentRequestCount = requests.length;
		intents.down([
			[
				"DATA",
				{
					kind: "work-item-dispatch-intent",
					intentId: "intent-old",
					workItemId: "wi-1",
					targetKind: "verification",
					executionInputRevision: 1,
				} satisfies WorkItemDispatchIntent,
			],
		]);

		expect(requests).toHaveLength(beforeIntentRequestCount);
		expect(issues.at(-1)).toMatchObject({ code: "stale-execution-input" });
		expect(status.at(-1)).toMatchObject({ state: "stale", code: "stale-execution-input" });
	});

	it("maps verification evidence evidence-first and proposes actions only by explicit policy", () => {
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

		facts.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		evidence.down([["DATA", evidenceFact("ev-no-policy")]]);
		expect(results.at(-1)).toMatchObject({
			kind: "verification-result-recorded",
			status: "passed",
			executionInputRevision: 1,
		});
		expect(proposals).toEqual([]);

		policies.down([
			[
				"DATA",
				{
					kind: "work-item-verification-mapping-policy",
					policyId: "verify-policy",
					actionProposals: [{ actionKind: "mark-verified", statuses: ["completed"] }],
				} satisfies WorkItemVerificationMappingPolicy,
			],
		]);
		evidence.down([
			[
				"DATA",
				evidenceFact("ev-policy", {
					sourceRefs: [{ kind: "work-item-verification-mapping-policy", id: "verify-policy" }],
				}),
			],
		]);

		expect(proposals.at(-1)).toMatchObject({
			kind: "work-item-domain-action-proposal",
			actionKind: "mark-verified",
			workItemId: "wi-1",
			policyId: "verify-policy",
		});
	});
});
