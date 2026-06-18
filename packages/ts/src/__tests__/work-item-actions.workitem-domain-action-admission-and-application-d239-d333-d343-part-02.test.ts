import { describe, expect, it } from "vitest";
import { depBatch } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { BoundaryCapabilityKind } from "../inspection/boundary.js";
import type { CapabilityAdmission } from "../solutions/capability-admission.js";
import {
	type WorkItemDomainActionAdmission,
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionApplyPolicy,
	type WorkItemDomainActionProposalInput,
	workItemDomainActionAdmissionProjector,
	workItemDomainActionApplicationProjector,
	workItemDomainActionApplyPolicy,
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

function _capabilityAdmission(
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

function _collectMessages(node: {
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
describe("WorkItem domain action admission and application (D239/D333-D343) — part 2", () => {
	it("records admitted verification actions visibly without closing lifecycle magically", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-verify", { actionKinds: ["mark-verified"] })],
		]);

		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-verify", "wi-1", "mark-verified", {
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-verify" },
				}),
			],
		]);
		setup.decisions.down([
			["DATA", admissionDecision("decision-verify", "admission-verify", "proposal-verify")],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applications.at(-1)).toMatchObject({
			state: "proposal-only",
			actionKind: "mark-verified",
			producedFactIds: [],
		});
		expect(setup.applicationStatus.at(-1)).toMatchObject({
			state: "proposal-only",
			actionKind: "mark-verified",
		});
		expect(setup.workItems.at(-1)).toMatchObject({ authoringRevision: 1 });
	});

	it("emits stale issues for admitted actions targeting old revision coordinates", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.seed.down([
			[
				"DATA",
				{
					kind: "work-item-patched",
					eventId: "wi-1:detail",
					workItemId: "wi-1",
					patch: { detail: "Changed before admission" },
				},
			],
		]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		applyPatch(setup, "proposal-stale", "admission-stale", {
			patch: { summary: "Too old" },
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applicationIssues.at(-1)).toMatchObject({ code: "stale-execution-input" });
		expect(setup.applicationStatus.at(-1)).toMatchObject({
			state: "rejected",
			code: "stale-execution-input",
		});
	});

	it("rejects conflicting proposal and admission revision metadata visibly", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);
		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("proposal-conflict", "wi-1", "patch", {
					payload: { patch: { summary: "Conflicting refs" } },
					metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
				}),
			],
		]);
		setup.decisions.down([
			[
				"DATA",
				admissionDecision("decision-conflict", "admission-conflict", "proposal-conflict", "admit", {
					metadata: { executionInputRevision: 2 },
				}),
			],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applicationIssues.at(-1)).toMatchObject({ code: "stale-execution-input" });
		expect(setup.applicationStatus.at(-1)).toMatchObject({ state: "rejected" });
	});

	it("suppresses duplicate proposal and admission application visibly", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);
		const proposal = workItemDomainActionProposalIntake("proposal-dup", "wi-1", "patch", {
			payload: { patch: { summary: "Once" } },
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});

		setup.proposals.down([
			["DATA", proposal],
			["DATA", proposal],
		]);
		setup.decisions.down([
			["DATA", admissionDecision("decision-dup", "admission-dup", "proposal-dup")],
			["DATA", admissionDecision("decision-dup", "admission-dup", "proposal-dup")],
		]);

		expect(setup.appliedFacts).toHaveLength(1);
		expect(setup.intakeStatus.map((status) => status.state)).toContain("duplicate");
		expect(setup.admissionIssues.at(-1)).toMatchObject({
			code: "duplicate-work-item-domain-action-admission-decision",
		});
	});

	it("emits missing or invalid apply policy as visible status without lowering facts", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);

		applyPatch(setup, "proposal-no-policy", "admission-no-policy", {
			patch: { summary: "No policy" },
			metadata: { executionInputRevision: 1 },
		});

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applicationIssues.at(-1)).toMatchObject({ code: "missing-policy" });
		expect(setup.applicationStatus.at(-1)).toMatchObject({ state: "missing-policy" });
	});

	it("makes invalid patch validation terminal instead of re-emitting on later waves", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		applyPatch(setup, "proposal-bad-ac", "admission-bad-ac", {
			payload: { acceptanceCriteria: [{ statement: "missing id" }] },
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});
		const issueCount = setup.applicationIssues.length;
		const statusCount = setup.applicationStatus.length;

		setup.applyPolicies.down([
			[
				"DATA",
				workItemDomainActionApplyPolicy("apply-patch-extra", { actionKinds: ["require-review"] }),
			],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applicationIssues).toHaveLength(issueCount);
		expect(setup.applicationStatus).toHaveLength(statusCount);
	});

	it("rejects multi-fact patch actions atomically when any event id was already emitted", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		applyPatch(setup, "proposal-first-event", "admission-first-event", {
			payload: { patch: { summary: "First" }, eventId: "shared-event" },
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});
		applyPatch(setup, "proposal-colliding-event", "admission-colliding-event", {
			payload: {
				patch: {
					summary: "Second",
					acceptanceCriteria: [
						{ criterionId: "ac-collision", statement: "Must not partially apply", required: true },
					],
				},
				eventId: "shared-event",
			},
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});

		expect(setup.appliedFacts).toHaveLength(1);
		expect(setup.appliedFacts[0]).toMatchObject({ eventId: "shared-event" });
		expect(setup.applicationIssues.at(-1)).toMatchObject({ code: "duplicate-suppressed" });
		expect(setup.applicationStatus.at(-1)).toMatchObject({ state: "duplicate" });
	});

	it("keeps spawn actions proposal/admission-only unless explicit create policy is present", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-parent", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("spawn-review", { actionKinds: ["spawn-child"] })],
		]);
		setup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("spawn-1", "wi-parent", "spawn-child", {
					payload: { childWorkItemId: "wi-child", draft: draft({ summary: "Child" }) },
					metadata: { executionInputRevision: 1, applyPolicyId: "spawn-review" },
				}),
			],
		]);
		setup.decisions.down([
			["DATA", admissionDecision("spawn-decision", "spawn-admission", "spawn-1")],
		]);

		expect(setup.appliedFacts).toEqual([]);
		expect(setup.applications.at(-1)).toMatchObject({ state: "proposal-only" });

		const createSetup = setupActions();
		createSetup.seed.down([["DATA", workItemCreatedFromDraft("wi-parent", draft())]]);
		createSetup.applyPolicies.down([
			[
				"DATA",
				workItemDomainActionApplyPolicy("spawn-create", {
					actionKinds: ["spawn-child"],
					spawn: { create: true },
				}),
			],
		]);
		createSetup.proposals.down([
			[
				"DATA",
				workItemDomainActionProposalIntake("spawn-create", "wi-parent", "spawn-child", {
					payload: { childWorkItemId: "wi-child", draft: draft({ summary: "Child" }) },
					metadata: { executionInputRevision: 1, applyPolicyId: "spawn-create" },
				}),
			],
		]);
		createSetup.decisions.down([
			[
				"DATA",
				admissionDecision("spawn-create-decision", "spawn-create-admission", "spawn-create"),
			],
		]);

		expect(createSetup.appliedFacts).toEqual([]);
		expect(createSetup.applicationIssues.at(-1)).toMatchObject({ code: "policy-mismatch" });
		expect(createSetup.applications.at(-1)).toMatchObject({ state: "proposal-only" });
	});

	it("turns malformed runtime action payloads into DataIssue/status instead of protocol ERROR", () => {
		const setup = setupActions();
		setup.seed.down([["DATA", workItemCreatedFromDraft("wi-1", draft())]]);
		setup.applyPolicies.down([
			["DATA", workItemDomainActionApplyPolicy("apply-patch", { actionKinds: ["patch"] })],
		]);

		setup.proposals.down([
			["DATA", { kind: "work-item-domain-action-proposal-intake", proposalId: "" }],
		]);
		applyPatch(setup, "proposal-bad-payload", "admission-bad-payload", {
			payload: "not-a-patch",
			metadata: { executionInputRevision: 1, applyPolicyId: "apply-patch" },
		});

		expect(setup.intakeIssues.at(-1)).toMatchObject({
			code: "malformed-domain-action-proposal",
		});
		expect(setup.applicationIssues.at(-1)).toMatchObject({ code: "invalid-patch" });
		expect(setup.appliedFacts).toEqual([]);
	});
});
