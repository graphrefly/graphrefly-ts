import { describe, expect, it } from "vitest";
import {
	decideWorkspaceProposalAdmission,
	projectWorkspaceProposalDomainActionApplicationStatus,
	projectWorkspaceProposalRequiredInputResponseApplication,
	projectWorkspaceProposalWorkItemLinkApplication,
	projectWorkspaceProposalWorkItemSpawnApplication,
	type RequiredInputGate,
	type RequiredInputResponseProposed,
	recordWorkspaceProposal,
	validateWorkspaceProposalApplicationEnvelope,
	type WorkItemDraft,
	type WorkItemLinked,
	type WorkItemLinkProjection,
	type WorkItemProjection,
	type WorkItemSpawnProposed,
	type WorkspaceProposalAdmissionDecision,
	type WorkspaceProposalAdmissionMaterial,
	type WorkspaceProposalFamily,
	type WorkspaceProposalReadyRequest,
	type WorkspaceProposalRecorded,
	workspaceProposalApplicationFamilyRef,
} from "../solutions/work-item/scheduling.js";

const actorRef = { kind: "actor", id: "actor-1" } as const;
const capabilityRef = { kind: "capability", id: "work-item-write" } as const;
const policyRef = { kind: "workspace-proposal-policy", id: "policy-1" } as const;
const projectionRef = { kind: "workspace-projection-bundle", id: "bundle-1" } as const;
const sourceRef = { kind: "side-panel-preview", id: "preview-1" } as const;

describe("Workspace proposal family application helpers (D430)", () => {
	it("validates application envelopes and keeps family refs on append-only fact ids", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const decision = admittedDecision(record);

		expect(validateWorkspaceProposalApplicationEnvelope(record, decision)).toEqual([]);
		expect(
			validateWorkspaceProposalApplicationEnvelope(record, decision, {
				expectedFamily: "work-item-spawn",
			}).map((entry) => entry.code),
		).toContain("unexpected-proposal-family");
		expect(
			validateWorkspaceProposalApplicationEnvelope(record, {
				...decision,
				workspaceId: "other-workspace",
			}).map((entry) => entry.code),
		).toContain("proposal-envelope-mismatch");
		expect(
			validateWorkspaceProposalApplicationEnvelope(record, {
				...decision,
				status: "needs-review",
			}).map((entry) => entry.code),
		).toContain("proposal-not-admitted");

		const linked = {
			kind: "work-item-linked",
			eventId: "event-1",
			linkId: "link-1",
			fromWorkItemId: "wi-1",
			toWorkItemId: "wi-2",
			linkKind: "blocks",
		} satisfies WorkItemLinked;
		expect(workspaceProposalApplicationFamilyRef("work-item-link", linked)).toEqual({
			proposalFamily: "work-item-link",
			factKind: "work-item-linked",
			factId: "event-1",
			sourceRefs: [],
		});
		expect(() =>
			workspaceProposalApplicationFamilyRef("work-item-link", {
				kind: "work-item-linked",
				linkId: "link-1",
			} as unknown as Parameters<typeof workspaceProposalApplicationFamilyRef>[1]),
		).toThrow(/append-only fact id/);
	});

	it("applies Required Input response facts and blocks stale gates", () => {
		const draft = {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>;
		const record = proposalRecord("required-input-response", draft);
		const decision = admittedDecision(record);
		const gate = requiredInputGate();

		const applied = projectWorkspaceProposalRequiredInputResponseApplication(record, decision, {
			applicationId: "application-1",
			gate,
		});

		expect(applied.status.state).toBe("applied");
		expect(applied.applied?.kind).toBe("required-input-response-applied");
		expect(applied.status.emittedFactRefs).toEqual([
			expect.objectContaining({
				proposalFamily: "required-input-response",
				factKind: "required-input-response-applied",
				factId: "application-1",
			}),
		]);

		const stale = projectWorkspaceProposalRequiredInputResponseApplication(record, decision, {
			applicationId: "application-stale",
			gate: { ...gate, status: "stale" },
		});
		expect(stale.status.state).toBe("blocked");
		expect(stale.applied).toBeUndefined();
		expect(stale.status.issues.map((entry) => entry.code)).toContain("stale-target-ref");
	});

	it("applies WorkItem spawn facts with optional link refs and blocks duplicates", () => {
		const draft = {
			kind: "work-item-spawn-proposed",
			proposalId: "proposal-1",
			proposedWorkItemId: "child-1",
			parentWorkItemId: "parent-1",
			draft: workItemDraft("Child"),
			idempotencyKey: "spawn-idem",
		} satisfies WorkItemSpawnProposed;
		const record = proposalRecord("work-item-spawn", draft);
		const decision = admittedDecision(record);

		const applied = projectWorkspaceProposalWorkItemSpawnApplication(record, decision, {
			applicationId: "application-spawn",
			linkParent: true,
		});

		expect(applied.status.state).toBe("applied");
		expect(applied.created?.kind).toBe("work-item-created");
		expect(applied.linked?.kind).toBe("work-item-linked");
		expect(applied.created?.metadata).toMatchObject({
			applicationProposalId: "proposal-1",
			applicationDecisionId: "decision-1",
			applicationIntakeRequestId: "intake-1",
			applicationIdempotencyKey: "idem-1",
		});
		expect(applied.linked?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "workspace-proposal-recorded", id: "proposal-1" },
				{ kind: "workspace-proposal-admission-decision", id: "decision-1" },
				{ kind: "workspace-proposal-application-status", id: "application-spawn" },
			]),
		);
		expect(applied.status.emittedFactRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					factKind: "work-item-created",
					factId: "application-spawn:work-item-created:child-1",
				}),
				expect.objectContaining({
					factKind: "work-item-linked",
					factId: "application-spawn:work-item-linked:parent-1:child-1",
				}),
			]),
		);
		expect(
			applied.status.emittedFactRefs.find((ref) => ref.factKind === "work-item-linked")?.factId,
		).not.toBe(applied.linked?.linkId);

		const duplicate = projectWorkspaceProposalWorkItemSpawnApplication(record, decision, {
			applicationId: "application-duplicate",
			existingWorkItems: [workItem("child-1")],
		});
		expect(duplicate.status.state).toBe("blocked");
		expect(duplicate.created).toBeUndefined();
		expect(duplicate.status.issues.map((entry) => entry.code)).toContain("duplicate-id");
	});

	it("applies WorkItem link and unlink facts with event ids as emitted refs", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const decision = admittedDecision(record);

		const linked = projectWorkspaceProposalWorkItemLinkApplication(record, decision, {
			applicationId: "application-link",
			workItems: [workItem("wi-1"), workItem("wi-2")],
		});

		expect(linked.status.state).toBe("applied");
		expect(linked.linked?.kind).toBe("work-item-linked");
		expect(linked.status.emittedFactRefs[0]).toEqual(
			expect.objectContaining({
				factKind: "work-item-linked",
				factId: "application-link:work-item-linked:link-1",
			}),
		);

		const unlinkRecord = proposalRecord("work-item-link", {
			...linkDraft(),
			action: "unlink",
		});
		const unlinked = projectWorkspaceProposalWorkItemLinkApplication(
			unlinkRecord,
			admittedDecision(unlinkRecord),
			{
				applicationId: "application-unlink",
				links: [linkProjection("link-1")],
			},
		);
		expect(unlinked.status.state).toBe("applied");
		expect(unlinked.unlinked?.kind).toBe("work-item-unlinked");
		expect(unlinked.status.emittedFactRefs[0]).toEqual(
			expect.objectContaining({
				factKind: "work-item-unlinked",
				factId: "application-unlink:work-item-unlinked:link-1",
			}),
		);

		const unknown = projectWorkspaceProposalWorkItemLinkApplication(
			unlinkRecord,
			admittedDecision(unlinkRecord),
			{
				applicationId: "application-unknown-link",
				links: [],
			},
		);
		expect(unknown.status.state).toBe("blocked");
		expect(unknown.status.issues.map((entry) => entry.code)).toContain("unknown-target-ref");

		const malformedRecord = proposalRecord("work-item-link", {
			kind: "work-item-link-proposal",
		});
		const malformed = projectWorkspaceProposalWorkItemLinkApplication(
			malformedRecord,
			admittedDecision(malformedRecord),
			{ applicationId: "application-malformed-link" },
		);
		expect(malformed.status.state).toBe("blocked");
		expect(malformed.linked).toBeUndefined();
		expect(malformed.status.issues.map((entry) => entry.code)).toContain("missing-required-field");
	});

	it("indexes domain-action emitted authoring facts without emitting arbitrary facts", () => {
		const record = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});
		const decision = admittedDecision(record);
		const status = projectWorkspaceProposalDomainActionApplicationStatus(record, decision, {
			applicationId: "application-domain-action",
			emittedFacts: [
				{
					kind: "work-item-patched",
					eventId: "patch-event-1",
					workItemId: "wi-1",
					patch: { summary: "Updated" },
				},
			],
		});

		expect(status.status.state).toBe("applied");
		expect(status.status.emittedFactRefs).toEqual([
			expect.objectContaining({
				proposalFamily: "work-item-domain-action",
				factKind: "work-item-patched",
				factId: "patch-event-1",
			}),
		]);

		const blocked = projectWorkspaceProposalDomainActionApplicationStatus(
			record,
			{ ...decision, status: "needs-review" },
			{ applicationId: "application-domain-blocked", emittedFacts: [] },
		);
		expect(blocked.status.state).toBe("blocked");
		expect(blocked.status.emittedFactRefs).toEqual([]);
		expect(blocked.status.issues.map((entry) => entry.code)).toContain("proposal-not-admitted");
	});

	it("fails closed before emitting family facts when family context carries runtime material", () => {
		const requiredInputRecord = proposalRecord("required-input-response", {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>);
		const requiredInput = projectWorkspaceProposalRequiredInputResponseApplication(
			requiredInputRecord,
			admittedDecision(requiredInputRecord),
			{
				applicationId: "application-runtime-gate",
				gate: {
					...requiredInputGate(),
					metadata: { callback: "handleSubmit" },
				},
			},
		);
		expect(requiredInput.status.state).toBe("blocked");
		expect(requiredInput.applied).toBeUndefined();
		expect(requiredInput.status.issues.map((entry) => entry.code)).toContain(
			"forbidden-runtime-material",
		);

		const domainRecord = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});
		const domain = projectWorkspaceProposalDomainActionApplicationStatus(
			domainRecord,
			admittedDecision(domainRecord),
			{
				applicationId: "application-runtime-domain",
				emittedFacts: [
					{
						kind: "work-item-patched",
						eventId: "patch-event-runtime",
						workItemId: "wi-1",
						patch: { summary: "Updated" },
						metadata: { providerClient: "runtime-private" },
					},
				],
			},
		);
		expect(domain.status.state).toBe("blocked");
		expect(domain.status.emittedFactRefs).toEqual([]);
		expect(domain.status.issues.map((entry) => entry.code)).toContain("forbidden-runtime-material");
	});
});

function proposalRecord<TDraft>(
	family: WorkspaceProposalFamily,
	draft: TDraft,
): WorkspaceProposalRecorded<TDraft> {
	const result = recordWorkspaceProposal(readyRequest(family, draft));
	expect(result.issues).toEqual([]);
	expect(result.record).toBeDefined();
	return result.record as WorkspaceProposalRecorded<TDraft>;
}

function admittedDecision(record: WorkspaceProposalRecorded): WorkspaceProposalAdmissionDecision {
	const result = decideWorkspaceProposalAdmission(record, admissionMaterial(record.proposalFamily));
	expect(result.issues).toEqual([]);
	expect(result.decision.status).toBe("admitted");
	return result.decision;
}

function readyRequest<TDraft>(
	family: WorkspaceProposalFamily,
	draft: TDraft,
): WorkspaceProposalReadyRequest<TDraft> {
	return {
		kind: "workspace-proposal-ready-request",
		proposalId: "proposal-1",
		intakeRequestId: "intake-1",
		idempotencyKey: "idem-1",
		workspaceId: "workspace-1",
		proposalFamily: family,
		loweringKind: `side-panel-${family}`,
		draft,
		targetRefs: [{ kind: "work-item", id: "wi-1", revision: 1 }],
		actorRef,
		capabilityRefs: [capabilityRef],
		policyRefs: [policyRef],
		projectionBundleRefs: [projectionRef],
		sourceRefs: [sourceRef],
	};
}

function admissionMaterial(family: WorkspaceProposalFamily): WorkspaceProposalAdmissionMaterial {
	return {
		decisionId: "decision-1",
		policies: [
			{
				kind: "workspace-proposal-admission-policy",
				policyId: "policy-1",
				proposalFamilies: [family],
				outcome: "admitted",
			},
		],
		idempotencyEvidence: {
			kind: "workspace-proposal-idempotency-evidence",
			idempotencyKey: "idem-1",
			state: "unique",
		},
		freshnessEvidence: [
			{
				kind: "workspace-proposal-freshness-evidence",
				targetRef: { kind: "work-item", id: "wi-1", revision: 1 },
				state: "fresh",
			},
		],
		projectionFreshnessEvidence: [
			{
				kind: "workspace-proposal-projection-freshness-evidence",
				projectionBundleRef: projectionRef,
				state: "fresh",
			},
		],
		capabilityEvidence: [
			{
				kind: "workspace-proposal-capability-evidence",
				capabilityRef,
				state: "present",
			},
		],
		sourceRefs: [sourceRef],
	};
}

function requiredInputGate(): RequiredInputGate {
	return {
		kind: "required-input-gate",
		gateId: "gate-1",
		requestId: "request-1",
		workItemId: "wi-1",
		status: "requested",
		prompt: "Answer",
	};
}

function workItem(id: string): WorkItemProjection {
	return {
		...workItemDraft(`Item ${id}`),
		workItemId: id,
		authoringRevision: 1,
		executionInputRevision: 1,
		lastEventId: `${id}:created`,
	};
}

function workItemDraft(summary: string): WorkItemDraft {
	return {
		title: summary,
		summary,
		workKind: "task",
		status: "open",
	};
}

function linkDraft() {
	return {
		kind: "work-item-link-proposal",
		linkId: "link-1",
		fromWorkItemId: "wi-1",
		toWorkItemId: "wi-2",
		linkKind: "blocks",
		direction: "directed",
	} as const;
}

function linkProjection(linkId: string): WorkItemLinkProjection {
	return {
		linkId,
		fromWorkItemId: "wi-1",
		toWorkItemId: "wi-2",
		linkKind: "blocks",
		direction: "directed",
		active: true,
		lastEventId: `${linkId}:linked`,
	};
}
