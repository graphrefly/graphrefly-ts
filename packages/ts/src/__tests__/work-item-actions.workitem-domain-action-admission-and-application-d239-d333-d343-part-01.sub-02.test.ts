import { describe, expect, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { BoundaryCapabilityKind } from "../inspection/boundary.js";
import type {
	CapabilityAdmission,
	CapabilityAdmissionStatus,
} from "../solutions/capability-admission.js";
import {
	type WorkItemDomainActionAdmission,
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionApplyPolicy,
	type WorkItemDomainActionCapabilityGuardPolicy,
	type WorkItemDomainActionProposal,
	type WorkItemDomainActionProposalInput,
	workItemDomainActionAdmissionProjector,
	workItemDomainActionApplicationProjector,
	workItemDomainActionApplyPolicy,
	workItemDomainActionCapabilityGuardProjector,
	workItemDomainActionProposal,
	workItemDomainActionProposalIntake,
	workItemDomainActionProposalIntakeProjector,
} from "../solutions/work-item/actions.js";
import {
	type VerificationPlan,
	type WorkItemAuthoringFact,
	type WorkItemAuthoringInput,
	type WorkItemProjection,
	workItemAuthoringProjector,
	workItemCreatedFromDraft,
} from "../solutions/work-item/scheduling.js";

function setupActions() {
	const g = graph();
	const seed = g.node<WorkItemAuthoringInput>([], null, { name: "authoringFacts" });
	const proposals = g.node<WorkItemDomainActionProposalInput>([], null, { name: "proposals" });
	const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
		name: "admissionDecisions",
	});
	const directAdmissions = g.node<WorkItemDomainActionAdmission>([], null, {
		name: "directAdmissions",
	});
	const applyPolicies = g.node<WorkItemDomainActionApplyPolicy>([], null, {
		name: "applyPolicies",
	});
	const authoring = workItemAuthoringProjector(g, { facts: seed });
	const intake = workItemDomainActionProposalIntakeProjector(g, { proposals });
	const admissions = workItemDomainActionAdmissionProjector(g, {
		proposals: intake.proposals,
		decisions,
	});
	const admissionUnion = g.node<WorkItemDomainActionAdmission>(
		[admissions.admissions, directAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw]]);
			for (const raw of depBatch(ctx, 1) ?? []) ctx.down([["DATA", raw]]);
		},
		{ name: "admissionUnion", partial: true },
	);
	const application = workItemDomainActionApplicationProjector(g, {
		proposals: intake.proposals,
		admissions: admissionUnion,
		workItems: authoring.workItems,
		applyPolicies,
	});
	return {
		seed,
		proposals,
		decisions,
		directAdmissions,
		applyPolicies,
		workItems: collectData<WorkItemProjection>(authoring.workItems),
		appliedFacts: collectData<WorkItemAuthoringFact>(application.authoringFacts),
		applications: collectData(application.applications),
		applicationStatus: collectData(application.status),
		applicationIssues: collectData(application.issues),
		intakeStatus: collectData(intake.status),
		intakeIssues: collectData(intake.issues),
		admissionIssues: collectData(admissions.issues),
	};
}

function applyPatch(
	setup: ReturnType<typeof setupActions>,
	proposalId: string,
	admissionId: string,
	opts: {
		readonly patch?: Record<string, unknown>;
		readonly payload?: unknown;
		readonly metadata?: Record<string, unknown>;
	},
): void {
	setup.proposals.down([
		[
			"DATA",
			workItemDomainActionProposalIntake(proposalId, "wi-1", "patch", {
				payload: opts.payload ?? { patch: opts.patch },
				metadata: opts.metadata,
			}),
		],
	]);
	setup.decisions.down([
		["DATA", admissionDecision(`${admissionId}:decision`, admissionId, proposalId)],
	]);
}

function admissionDecision(
	decisionId: string,
	admissionId: string,
	proposalId: string,
	outcome: WorkItemDomainActionAdmissionDecision["outcome"] = "admit",
	opts: Partial<WorkItemDomainActionAdmissionDecision> = {},
): WorkItemDomainActionAdmissionDecision {
	return {
		kind: "work-item-domain-action-admission-decision",
		decisionId,
		admissionId,
		proposalId,
		outcome,
		...opts,
	};
}

function capabilityAdmission(
	capabilityId: string,
	state: CapabilityAdmission["state"],
	opts: {
		readonly kind?: BoundaryCapabilityKind;
		readonly subjectId?: string;
	} = {},
): CapabilityAdmission {
	return {
		kind: "capability-admission",
		admissionId: `capability-admission:${opts.kind ?? "auth"}:${capabilityId}:${opts.subjectId ?? `boundary:${capabilityId}`}:${state}`,
		proposalId: `capability-proposal:${capabilityId}`,
		subjectId: opts.subjectId ?? `boundary:${capabilityId}`,
		capability: capabilityRef(capabilityId, opts.kind),
		state,
		decisionId: `capability-decision:${capabilityId}:${state}`,
	};
}

function capabilityRef(capabilityId: string, kind: BoundaryCapabilityKind = "auth") {
	return { id: capabilityId, kind, required: true };
}

function collectData<T>(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}): T[] {
	const out: T[] = [];
	node.subscribe((msg) => {
		if (msg[0] === "DATA") out.push(msg[1] as T);
	});
	return out;
}

function collectMessages(node: {
	subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
}) {
	const out: (readonly [string, unknown?])[] = [];
	node.subscribe((msg) => out.push(msg));
	return out;
}

function draft(opts: Partial<ReturnType<typeof baseDraft>> = {}) {
	return { ...baseDraft(), ...opts };
}

function baseDraft() {
	return {
		summary: "Ship verification",
		detail: "Make WorkItem actions explicit.",
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

describe("WorkItem domain action admission and application (D239/D333-D343) — sub 2", () => {
	it("rejects malformed capability guard optional refs and nested issues as DATA issues", () => {
		const g = graph();
		const proposalInputs = g.node<WorkItemDomainActionProposalInput>([], null, {
			name: "proposals",
		});
		const capabilityAdmissions = g.node<CapabilityAdmission>([], null, {
			name: "capabilityAdmissions",
		});
		const guardPolicies = g.node<WorkItemDomainActionCapabilityGuardPolicy>([], null, {
			name: "capabilityGuardPolicies",
		});
		const capabilityAdmissionStatus = g.node<CapabilityAdmissionStatus>([], null, {
			name: "capabilityAdmissionStatus",
		});
		const intake = workItemDomainActionProposalIntakeProjector(g, { proposals: proposalInputs });
		const guard = workItemDomainActionCapabilityGuardProjector(g, {
			proposals: intake.proposals,
			capabilityAdmissions,
			guardPolicies,
			capabilityAdmissionStatus,
			now: () => 123,
		});
		const decisions = collectData<WorkItemDomainActionAdmissionDecision>(guard.decisions);
		const issues = collectData(guard.issues);
		const statusMessages = collectMessages(guard.status);

		guardPolicies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-capability-guard-policy",
					policyId: "capability-ready",
					actionKinds: ["patch"],
					capabilityRefs: [capabilityRef("boundary-auth")],
					admissionSubjectIds: ["boundary:boundary-auth"],
				},
			],
		]);
		proposalInputs.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-1", "wi-1", "patch", {
					metadata: { capabilityGuardPolicyId: "capability-ready" },
				}),
			],
		]);
		capabilityAdmissions.down([
			[
				"DATA",
				{
					...capabilityAdmission("boundary-auth", "allowed"),
					sourceRefs: { kind: "not-an-array", id: "bad" },
				} as unknown as CapabilityAdmission,
			],
		]);
		capabilityAdmissionStatus.down([
			[
				"DATA",
				{
					kind: "capability-admission-status",
					statusId: "bad-status-issue",
					state: "capability-admission-issue",
					capabilityId: "boundary-auth",
					issues: [{}],
				} as unknown as CapabilityAdmissionStatus,
			],
			[
				"DATA",
				{
					kind: "capability-admission-status",
					statusId: "bad-status-kind-only",
					state: "capability-admission-issue",
					capabilityKind: "auth",
				} as unknown as CapabilityAdmissionStatus,
			],
		]);

		expect(decisions).toEqual([]);
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"malformed-capability-admission",
				"malformed-capability-admission-status",
			]),
		);
		expect(statusMessages.some((msg) => msg[0] === "ERROR")).toBe(false);
	});

	it("keeps admission alone from mutating WorkItem projections", () => {
		const setup = setupActions();

		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.directAdmissions.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission",
					admissionId: "admission-without-proposal",
					proposalId: "missing-proposal",
					workItemId: "wi-1",
					actionKind: "patch",
					state: "admitted",
					decisionId: "decision-1",
				} satisfies WorkItemDomainActionAdmission,
			],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applicationIssues.at(-1)).toMatchObject({
			code: "dangling-ref",
			subjectId: "wi-1",
		});
		expect(setup.workItems.at(-1)).toMatchObject({ authoringRevision: 1 });
	});

	it("rejects admissions whose action refs do not match their proposal", () => {
		const g = graph();
		const seed = g.node<WorkItemAuthoringInput>([], null, { name: "authoringFacts" });
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "rawProposals" });
		const admissions = g.node<WorkItemDomainActionAdmission>([], null, { name: "rawAdmissions" });
		const applyPolicies = g.node<WorkItemDomainActionApplyPolicy>([], null, {
			name: "applyPolicies",
		});
		const authoring = workItemAuthoringProjector(g, { facts: seed });
		const application = workItemDomainActionApplicationProjector(g, {
			proposals,
			admissions,
			workItems: authoring.workItems,
			applyPolicies,
		});
		const appliedFacts = collectData<WorkItemAuthoringFact>(application.authoringFacts);
		const applicationIssues = collectData(application.issues);
		const applicationStatus = collectData(application.status);

		seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		seed.down([["DATA", workItemCreatedFromDraft("wi-2", draft({ summary: "Other" }))]]);
		applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);
		proposals.down([
			[
				"DATA",
				workItemDomainActionProposal("proposal-mismatch", "wi-1", "patch", {
					payload: { patch: { summary: "Must not hit wi-2" } },
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
				}),
			],
		]);
		admissions.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission",
					admissionId: "admission-mismatch",
					proposalId: "proposal-mismatch",
					workItemId: "wi-2",
					actionKind: "patch",
					state: "admitted",
					decisionId: "decision-mismatch",
				} satisfies WorkItemDomainActionAdmission,
			],
		]);

		expect(appliedFacts).toEqual([]);
		expect(applicationIssues.at(-1)).toMatchObject({
			code: "dangling-ref",
			subjectId: "wi-2",
		});
		expect(applicationStatus.at(-1)).toMatchObject({ state: "rejected" });
	});

	it("lowers admitted patch actions to WorkItemPatched and advances revisions only after re-entry", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-1", "wi-1", "patch", {
					payload: { patch: { summary: "Patched summary" } },
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
				}),
			],
		]);
		setup.decisions.down([["DATA", admissionDecision("decision-1", "admission-1", "proposal-1")]]);

		expect(setup.appliedFacts.at(-1)).toMatchObject({
			kind: "work-item-patched",
			workItemId: "wi-1",
			patch: { summary: "Patched summary" },
		});
		expect(setup.workItems.at(-1)).toMatchObject({
			summary: "Ship verification",
			authoringRevision: 1,
		});

		setup.seed.down([["DATA", setup.appliedFacts.at(-1) as WorkItemAuthoringFact]]);

		expect(setup.workItems.at(-1)).toMatchObject({
			summary: "Patched summary",
			authoringRevision: 2,
			executionInputRevision: 1,
		});
	});

	it("splits acceptance criteria and verification plan out of generic patch actions", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-dedicated", "wi-1", "patch", {
					payload: {
						patch: {
							summary: "Split patch",
							acceptanceCriteria: [
								{ criterionId: "ac-2", statement: "Dedicated AC fact", required: true },
							],
							verificationPlan: {
								planId: "plan-2",
								steps: [
									{
										stepId: "step-2",
										mode: "auto",
										effectKind: "verification",
										verifiesCriteriaIds: ["ac-2"],
									},
								],
							},
						},
					},
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				admissionDecision("decision-dedicated", "admission-dedicated", "proposal-dedicated"),
			],
		]);

		expect(setup.appliedFacts.map((fact) => fact.kind)).toEqual([
			"work-item-patched",
			"acceptance-criteria-changed",
			"verification-plan-changed",
		]);
		expect(setup.appliedFacts[0]).toMatchObject({
			kind: "work-item-patched",
			patch: { summary: "Split patch" },
		});
	});

	it("keeps inline patch fields when action payload also carries dedicated authoring facts", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-inline-dedicated", "wi-1", "patch", {
					payload: {
						summary: "Inline split patch",
						acceptanceCriteria: [
							{ criterionId: "ac-inline", statement: "Inline AC fact", required: true },
						],
					},
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				admissionDecision(
					"decision-inline-dedicated",
					"admission-inline-dedicated",
					"proposal-inline-dedicated",
				),
			],
		]);

		expect(setup.appliedFacts.map((fact) => fact.kind)).toEqual([
			"work-item-patched",
			"acceptance-criteria-changed",
		]);
		expect(setup.appliedFacts[0]).toMatchObject({
			kind: "work-item-patched",
			patch: { summary: "Inline split patch" },
		});
	});

	it("rejects dedicated authoring fields that are outside a patch allowlist", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			[
				"DATA",
				workItemDomainActionApplyPolicy("apply-patch", {
					actionKinds: ["patch"],
					patch: { allowedFields: ["summary"] },
				}),
			],
		]);

		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-ac-blocked", "wi-1", "patch", {
					payload: {
						summary: "Allowed alone",
						acceptanceCriteria: [
							{ criterionId: "ac-blocked", statement: "Should be blocked", required: true },
						],
					},
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				admissionDecision("decision-ac-blocked", "admission-ac-blocked", "proposal-ac-blocked"),
			],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applicationIssues.at(-1)).toMatchObject({ code: "policy-mismatch" });
		expect(setup.applicationStatus.at(-1)).toMatchObject({ state: "rejected" });
	});

	it("preserves executionInputRevision for metadata-only patch unless policy marks it relevant", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		applyPatch(setup, "proposal-meta", "admission-meta", {
			patch: { metadata: { color: "blue" } },
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});
		setup.seed.down([["DATA", setup.appliedFacts.at(-1) as WorkItemAuthoringFact]]);
		expect(setup.workItems.at(-1)).toMatchObject({
			authoringRevision: 2,
			executionInputRevision: 1,
		});

		setup.applyPolicies.down([
			[
				"DATA",
				workItemDomainActionApplyPolicy("apply-patch", {
					actionKinds: ["patch"],
					patch: { executionRelevantFields: ["metadata.color"] },
				}),
			],
		]);
		applyPatch(setup, "proposal-relevant", "admission-relevant", {
			patch: { metadata: { color: "red" } },
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});
		setup.seed.down([["DATA", setup.appliedFacts.at(-1) as WorkItemAuthoringFact]]);

		expect(setup.workItems.at(-1)).toMatchObject({
			authoringRevision: 3,
			executionInputRevision: 2,
		});
	});
});
