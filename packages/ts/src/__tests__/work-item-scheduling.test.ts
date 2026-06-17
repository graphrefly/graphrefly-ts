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
	validateWorkItemEffectPlan,
	verificationPlanChanged,
	type WorkItemAuthoringInput,
	type WorkItemDispatchIntent,
	type WorkItemEffectPlanProposed,
	type WorkItemEffectPlanResult,
	type WorkItemEffectPlanStatus,
	type WorkItemProjection,
	type WorkItemVerificationMappingPolicy,
	workItemAuthoringProjector,
	workItemCreatedFromDraft,
	workItemEffectPlanProjector,
	workItemSpawnProposed,
	workItemVerificationRequestLowerer,
	workItemVerificationResultMapper,
} from "../solutions/work-item/scheduling.js";

describe("WorkItem authoring, verification, and scheduling surface (D333-D343)", () => {
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
					parentWorkItemId: "wi-parent",
				}),
			],
		]);

		expect(workItems).toEqual([]);
		expect(status.at(-1)).toMatchObject({
			state: "deferred",
			workItemId: "wi-parent",
			metadata: { proposalId: "spawn-1" },
		});
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

	it("replays early WorkItemEffectPlan evidence once the admitted plan is visible", () => {
		const setup = planSetup();

		setup.evidence.down([
			[
				"DATA",
				evidenceFact("ev-a-early", {
					effectRunId: "effect-run:early",
					requestId: "request:early:A",
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

		expect(setup.requests.map((request) => request.planMemberId)).toEqual(["B"]);

		setup.evidence.down([["DATA", evidenceForPlanRequest("ev-b", setup.requests.at(-1)!)]]);
		expect(setup.results.at(-1)).toMatchObject({ status: "succeeded" });
		expect(setup.results.at(-1)?.memberResults).toContainEqual(
			expect.objectContaining({ planMemberId: "A", requestId: "request:early:A" }),
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
