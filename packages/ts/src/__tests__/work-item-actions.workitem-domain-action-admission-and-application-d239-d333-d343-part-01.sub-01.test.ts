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
	type WorkItemDomainActionProposalInput,
	workItemDomainActionAdmissionProjector,
	workItemDomainActionApplicationProjector,
	workItemDomainActionApplyPolicy,
	workItemDomainActionCapabilityGuardProjector,
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

function _applyPatch(
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

describe("WorkItem domain action admission and application (D239/D333-D343) — sub 1", () => {
	it("keeps proposals without admission from mutating WorkItem projections", () => {
		const setup = setupActions();

		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-1", "wi-1", "patch", {
					payload: { patch: { summary: "Changed too early" } },
				}),
			],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.workItems.at(-1)).toMatchObject({
			workItemId: "wi-1",
			summary: "Ship verification",
			authoringRevision: 1,
		});
	});

	it("uses capability admission DATA facts to guard WorkItem domain-action admission", () => {
		const g = graph();
		const seed = g.node<WorkItemAuthoringInput>([], null, { name: "authoringFacts" });
		const proposalInputs = g.node<WorkItemDomainActionProposalInput>([], null, {
			name: "proposals",
		});
		const capabilityAdmissions = g.node<CapabilityAdmission>([], null, {
			name: "capabilityAdmissions",
		});
		const guardPolicies = g.node<WorkItemDomainActionCapabilityGuardPolicy>([], null, {
			name: "capabilityGuardPolicies",
		});
		const applyPolicies = g.node<WorkItemDomainActionApplyPolicy>([], null, {
			name: "applyPolicies",
		});
		const authoring = workItemAuthoringProjector(g, { facts: seed });
		const intake = workItemDomainActionProposalIntakeProjector(g, { proposals: proposalInputs });
		const guard = workItemDomainActionCapabilityGuardProjector(g, {
			proposals: intake.proposals,
			capabilityAdmissions,
			guardPolicies,
			now: () => 123,
		});
		const admissions = workItemDomainActionAdmissionProjector(g, {
			proposals: intake.proposals,
			decisions: guard.decisions,
		});
		const application = workItemDomainActionApplicationProjector(g, {
			proposals: intake.proposals,
			admissions: admissions.admissions,
			workItems: authoring.workItems,
			applyPolicies,
		});
		const decisions = collectData<WorkItemDomainActionAdmissionDecision>(guard.decisions);
		const guardStatus = collectData(guard.status);
		const appliedFacts = collectData<WorkItemAuthoringFact>(application.authoringFacts);

		seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);
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
					payload: { patch: { summary: "Patched after capability admission" } },
					metadata: {
						applyPolicyId: "apply-patch",
						capabilityGuardPolicyId: "capability-ready",
					},
				}),
			],
		]);

		expect(decisions).toEqual([]);
		expect(guardStatus.at(-1)).toMatchObject({ state: "deferred" });

		capabilityAdmissions.down([["DATA", capabilityAdmission("boundary-auth", "allowed")]]);

		expect(decisions).toEqual([expect.objectContaining({ outcome: "admit" })]);
		expect(decisions.at(-1)?.sourceRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "boundary-capability", id: "auth:boundary-auth" }),
			]),
		);
		expect(decisions.at(-1)?.sourceRefs).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "boundary-capability", id: "boundary-auth" }),
			]),
		);
		expect(appliedFacts.at(-1)).toMatchObject({
			kind: "work-item-patched",
			patch: { summary: "Patched after capability admission" },
		});
	});

	it("turns blocked capability admission into WorkItem rejection status, not protocol ERROR", () => {
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
		const intake = workItemDomainActionProposalIntakeProjector(g, { proposals: proposalInputs });
		const guard = workItemDomainActionCapabilityGuardProjector(g, {
			proposals: intake.proposals,
			capabilityAdmissions,
			guardPolicies,
			now: () => 123,
		});
		const decisions = collectData<WorkItemDomainActionAdmissionDecision>(guard.decisions);
		const messages = collectMessages(guard.status);

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
		capabilityAdmissions.down([["DATA", capabilityAdmission("boundary-auth", "blocked")]]);

		expect(decisions).toEqual([expect.objectContaining({ outcome: "reject" })]);
		expect(messages.filter((msg) => msg[0] === "DATA")).not.toHaveLength(0);
		expect(messages.some((msg) => msg[0] === "ERROR")).toBe(false);
	});

	it("keeps capability guard admission scoped by capability kind and subject", () => {
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
		const intake = workItemDomainActionProposalIntakeProjector(g, { proposals: proposalInputs });
		const guard = workItemDomainActionCapabilityGuardProjector(g, {
			proposals: intake.proposals,
			capabilityAdmissions,
			guardPolicies,
			now: () => 123,
		});
		const decisions = collectData<WorkItemDomainActionAdmissionDecision>(guard.decisions);
		const status = collectData(guard.status);

		guardPolicies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-capability-guard-policy",
					policyId: "capability-ready",
					actionKinds: ["patch"],
					capabilityRefs: [capabilityRef("shared-id", "auth")],
					admissionSubjectIds: ["boundary:expected"],
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
				capabilityAdmission("shared-id", "allowed", {
					kind: "resource",
					subjectId: "boundary:expected",
				}),
			],
			[
				"DATA",
				capabilityAdmission("shared-id", "allowed", {
					kind: "auth",
					subjectId: "boundary:other",
				}),
			],
		]);

		expect(decisions).toEqual([]);
		expect(status.at(-1)).toMatchObject({
			state: "deferred",
			metadata: { missingCapabilityRefs: ["auth:shared-id"] },
		});

		capabilityAdmissions.down([
			[
				"DATA",
				capabilityAdmission("shared-id", "allowed", {
					kind: "auth",
					subjectId: "boundary:expected",
				}),
			],
		]);

		expect(decisions).toEqual([expect.objectContaining({ outcome: "admit" })]);
	});

	it("replays capability admission issue statuses without capabilityId to guarded proposals", () => {
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
		const issues = collectData(guard.issues);
		const statusMessages = collectMessages(guard.status);

		capabilityAdmissionStatus.down([
			[
				"DATA",
				{
					kind: "capability-admission-status",
					statusId: "capability-source-unavailable",
					state: "capability-admission-issue",
					issues: [
						{
							kind: "issue",
							code: "capability-source-unavailable",
							message: "Capability admission source unavailable",
						},
					],
				},
			],
		]);
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

		expect(issues.at(-1)).toMatchObject({
			code: "capability-source-unavailable",
			metadata: { capabilityAdmissionStatusId: "capability-source-unavailable" },
		});
		expect(issues.at(-1)?.metadata).not.toHaveProperty("capabilityId");
		expect(statusMessages.some((msg) => msg[0] === "ERROR")).toBe(false);
	});

	it("keeps capability admission issue statuses scoped by admission subject", () => {
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
		const issues = collectData(guard.issues);

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

		capabilityAdmissionStatus.down([
			[
				"DATA",
				{
					kind: "capability-admission-status",
					statusId: "wrong-subject",
					state: "capability-admission-issue",
					subjectId: "boundary:other",
					capabilityId: "boundary-auth",
					capabilityKind: "auth",
					issues: [
						{
							kind: "issue",
							code: "wrong-subject-status",
							message: "Wrong subject should not apply",
						},
					],
				},
			],
		]);
		expect(issues.map((issue) => issue.code)).not.toContain("wrong-subject-status");

		capabilityAdmissionStatus.down([
			[
				"DATA",
				{
					kind: "capability-admission-status",
					statusId: "matching-subject",
					state: "capability-admission-issue",
					subjectId: "boundary:boundary-auth",
					capabilityId: "boundary-auth",
					capabilityKind: "auth",
					issues: [
						{
							kind: "issue",
							code: "matching-subject-status",
							message: "Matching subject should apply",
						},
					],
				},
			],
		]);
		expect(issues.at(-1)).toMatchObject({ code: "matching-subject-status" });
	});

	it("keeps malformed capability guard DATA as issues instead of implicit admission or ERROR", () => {
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
		const intake = workItemDomainActionProposalIntakeProjector(g, { proposals: proposalInputs });
		const guard = workItemDomainActionCapabilityGuardProjector(g, {
			proposals: intake.proposals,
			capabilityAdmissions,
			guardPolicies,
			now: () => 123,
		});
		const decisions = collectData<WorkItemDomainActionAdmissionDecision>(guard.decisions);
		const issues = collectData(guard.issues);
		const statusMessages = collectMessages(guard.status);

		guardPolicies.down([["DATA", null as unknown as WorkItemDomainActionCapabilityGuardPolicy]]);
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
					state: "surprise",
				} as unknown as CapabilityAdmission,
			],
		]);

		expect(decisions).toEqual([]);
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"malformed-work-item-domain-action-capability-guard-policy",
				"malformed-capability-admission",
			]),
		);
		expect(statusMessages.some((msg) => msg[0] === "ERROR")).toBe(false);
	});
});
