import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	decideWorkspaceProposalAdmission,
	prepareWorkspaceProposalRepairReviewDecisionRecordingInput,
	previewWorkspaceProposalRepairSuccessorProposalIntake,
	projectWorkspaceProposalApplicationStatus,
	projectWorkspaceProposalDomainActionApplicationStatus,
	projectWorkspaceProposalFamilyApplicationDiagnostics,
	projectWorkspaceProposalFamilyApplicationReadModel,
	projectWorkspaceProposalFamilyApplicationReadModels,
	projectWorkspaceProposalFamilyOutcomeIndex,
	projectWorkspaceProposalRepairActionDescriptors,
	projectWorkspaceProposalRepairReviewDecisionRecordings,
	projectWorkspaceProposalRepairReviewRequests,
	projectWorkspaceProposalRepairReviewStatuses,
	projectWorkspaceProposalRepairSuccessorProposalIntakePreview,
	projectWorkspaceProposalRequiredInputResponseApplication,
	projectWorkspaceProposalWorkItemLinkApplication,
	projectWorkspaceProposalWorkItemSpawnApplication,
	type RequiredInputGate,
	type RequiredInputResponseProposed,
	recordWorkspaceProposal,
	recordWorkspaceProposalDomainActionOutcome,
	recordWorkspaceProposalRepairReviewDecision,
	recordWorkspaceProposalRequiredInputResponseOutcome,
	recordWorkspaceProposalWorkItemLinkOutcome,
	recordWorkspaceProposalWorkItemSpawnOutcome,
	validateWorkspaceProposalApplicationEnvelope,
	validateWorkspaceProposalRepairActionIntent,
	type WorkItemAuthoringFact,
	type WorkItemDraft,
	type WorkItemLinked,
	type WorkItemLinkProjection,
	type WorkItemProjection,
	type WorkItemSpawnProposed,
	type WorkspaceProposalAdmissionDecision,
	type WorkspaceProposalAdmissionMaterial,
	type WorkspaceProposalApplicationStatus,
	type WorkspaceProposalDomainActionApplicationContext,
	type WorkspaceProposalFamily,
	type WorkspaceProposalFamilyApplicationReadModelQuery,
	type WorkspaceProposalReadyRequest,
	type WorkspaceProposalRecorded,
	type WorkspaceProposalRepairActionDescriptor,
	type WorkspaceProposalRepairActionIntent,
	type WorkspaceProposalRepairActionIntentValidationResult,
	type WorkspaceProposalRepairReviewDecision,
	type WorkspaceProposalRepairReviewDecisionRecordingInput,
	type WorkspaceProposalRepairReviewRequest,
	type WorkspaceProposalRepairSuccessorProposalIntakePreview,
	type WorkspaceProposalRequiredInputResponseApplicationContext,
	type WorkspaceProposalWorkItemLinkApplicationContext,
	type WorkspaceProposalWorkItemSpawnApplicationContext,
	workspaceProposalApplicationFamilyRef,
	workspaceProposalDomainActionApplicationProjector,
	workspaceProposalFamilyApplicationDiagnosticProjector,
	workspaceProposalFamilyApplicationReadModelProjector,
	workspaceProposalFamilyApplicationReadModelsProjector,
	workspaceProposalRepairActionDescriptorProjector,
	workspaceProposalRepairActionIntentProjector,
	workspaceProposalRepairReviewDecisionRecordingProjector,
	workspaceProposalRepairReviewProjector,
	workspaceProposalRepairReviewStatusProjector,
	workspaceProposalRepairSuccessorProposalIntakePreviewProjector,
	workspaceProposalRequiredInputResponseApplicationProjector,
	workspaceProposalWorkItemLinkApplicationProjector,
	workspaceProposalWorkItemSpawnApplicationProjector,
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

	it("clamps generic applied overrides when validation has issues or missing family refs", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const decision = admittedDecision(record);
		const ref = workspaceProposalApplicationFamilyRef("work-item-link", {
			kind: "work-item-linked",
			eventId: "event-override",
			linkId: "link-1",
			fromWorkItemId: "wi-1",
			toWorkItemId: "wi-2",
			linkKind: "blocks",
		} satisfies WorkItemLinked);

		const issueful = projectWorkspaceProposalApplicationStatus(
			record,
			{
				...decision,
				status: "needs-review",
			},
			{
				applicationId: "application-override-issueful",
				emittedFactRefs: [ref],
				state: "applied",
			},
		);
		expect(issueful.status.state).toBe("blocked");
		expect(issueful.status.emittedFactRefs).toEqual([]);
		expect(issueful.recorded).toBeUndefined();

		const missingRefs = projectWorkspaceProposalApplicationStatus(record, decision, {
			applicationId: "application-override-missing-refs",
			state: "applied",
		});
		expect(missingRefs.status.state).toBe("pending");
		expect(missingRefs.status.emittedFactRefs).toEqual([]);
		expect(missingRefs.recorded).toBeUndefined();

		const recorded = projectWorkspaceProposalApplicationStatus(record, decision, {
			applicationId: "application-override-recorded",
			emittedFactRefs: [ref],
			state: "recorded",
		});
		expect(recorded.status.state).toBe("recorded");
		expect(recorded.status.emittedFactRefs).toEqual([ref]);
		expect(recorded.recorded).toEqual(
			expect.objectContaining({
				applicationId: "application-override-recorded",
				emittedFactRefs: [ref],
			}),
		);
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
					sourceRefs: d430ApplicationRefs(record, decision, "application-domain-action"),
					metadata: { applicationIdempotencyKey: record.idempotencyKey },
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

	it("exposes graph-visible DATA projector topology and output nodes per family", () => {
		const g = graph();
		const requiredRecords = g.node<WorkspaceProposalRecorded<RequiredInputResponseProposed>>(
			[],
			null,
			{ name: "requiredRecords" },
		);
		const spawnRecords = g.node<WorkspaceProposalRecorded<WorkItemSpawnProposed>>([], null, {
			name: "spawnRecords",
		});
		const linkRecords = g.node<WorkspaceProposalRecorded<ReturnType<typeof linkDraft>>>([], null, {
			name: "linkRecords",
		});
		const domainRecords = g.node<WorkspaceProposalRecorded>([], null, { name: "domainRecords" });
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const requiredInputContexts = g.node<WorkspaceProposalRequiredInputResponseApplicationContext>(
			[],
			null,
			{
				name: "requiredContexts",
			},
		);
		const spawnContexts = g.node<WorkspaceProposalWorkItemSpawnApplicationContext>([], null, {
			name: "spawnContexts",
		});
		const linkContexts = g.node<WorkspaceProposalWorkItemLinkApplicationContext>([], null, {
			name: "linkContexts",
		});
		const domainContexts = g.node<WorkspaceProposalDomainActionApplicationContext>([], null, {
			name: "domainContexts",
		});
		const gates = g.node<RequiredInputGate>([], null, { name: "gates" });
		const workItems = g.node<WorkItemProjection>([], null, { name: "workItems" });
		const links = g.node<WorkItemLinkProjection>([], null, { name: "links" });
		const domainFacts = g.node<never>([], null, { name: "domainFacts" });

		const required = workspaceProposalRequiredInputResponseApplicationProjector(g, {
			name: "requiredProjector",
			records: requiredRecords,
			decisions,
			contexts: requiredInputContexts,
			gates,
		});
		const spawn = workspaceProposalWorkItemSpawnApplicationProjector(g, {
			name: "spawnProjector",
			records: spawnRecords,
			decisions,
			contexts: spawnContexts,
			workItems,
		});
		const link = workspaceProposalWorkItemLinkApplicationProjector(g, {
			name: "linkProjector",
			records: linkRecords,
			decisions,
			contexts: linkContexts,
			workItems,
			links,
		});
		const domain = workspaceProposalDomainActionApplicationProjector(g, {
			name: "domainProjector",
			records: domainRecords,
			decisions,
			contexts: domainContexts,
			emittedFacts: domainFacts,
		});

		expect(Object.keys(required).sort()).toEqual([
			"applied",
			"audit",
			"issues",
			"recorded",
			"status",
		]);
		expect(Object.keys(spawn).sort()).toEqual([
			"audit",
			"created",
			"issues",
			"linked",
			"recorded",
			"status",
		]);
		expect(Object.keys(link).sort()).toEqual([
			"audit",
			"issues",
			"linked",
			"recorded",
			"status",
			"unlinked",
		]);
		expect(Object.keys(domain).sort()).toEqual(["audit", "issues", "recorded", "status"]);
		expect(
			g
				.describe()
				.nodes.filter((node) => node.factory.includes("workspaceProposal"))
				.map((node) => node.factory)
				.sort(),
		).toEqual(
			expect.arrayContaining([
				"workspaceProposalRequiredInputResponseApplicationProjector",
				"workspaceProposalWorkItemSpawnApplicationProjector",
				"workspaceProposalWorkItemLinkApplicationProjector",
				"workspaceProposalDomainActionApplicationProjector",
			]),
		);
	});

	it("diagnoses missing durable handoff material per family without status or family truth", () => {
		const required = requiredInputProjectorHarness();
		const spawn = spawnProjectorHarness();
		const link = linkProjectorHarness();
		const domain = domainActionProjectorHarness();

		required.contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-required-missing",
					proposalId: "proposal-required-missing",
				},
			],
		]);
		spawn.contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-work-item-spawn-application-context",
					applicationId: "application-spawn-missing",
					proposalId: "proposal-spawn-missing",
				},
			],
		]);
		link.contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-work-item-link-application-context",
					applicationId: "application-link-missing",
					proposalId: "proposal-link-missing",
				},
			],
		]);
		domain.contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-domain-action-application-context",
					applicationId: "application-domain-missing-durable",
					proposalId: "proposal-domain-missing",
				},
			],
		]);

		for (const harness of [required, spawn, link, domain]) {
			expect(harness.status).toEqual([]);
			expect(harness.recorded).toEqual([]);
			expect(harness.familyTruth).toEqual([]);
			expect(harness.repairRequests).toEqual([]);
			expect(harness.issues.map((entry) => entry.code)).toEqual([
				"missing-workspace-proposal-recorded",
				"missing-workspace-proposal-admission-decision",
			]);
			expect(harness.diagnostics.map((entry) => entry.code)).toEqual([
				"missing-workspace-proposal-recorded",
				"missing-workspace-proposal-admission-decision",
				"missing-durable-handoff",
			]);
			expect(harness.diagnostics.map((entry) => entry.classification)).toEqual([
				"missing-durable-handoff",
				"missing-durable-handoff",
				"missing-durable-handoff",
			]);
			expect(harness.audit).toEqual([
				expect.objectContaining({
					state: "pending",
					code: "missing-durable-handoff",
					emittedFactRefs: [],
					metadata: expect.objectContaining({
						diagnostic: "missing-durable-handoff",
						missingRecord: true,
						missingDecision: true,
					}),
				}),
			]);
		}
	});

	it("dedupes missing durable handoff diagnostics and recovers when record and decision arrive", () => {
		const harness = requiredInputProjectorHarness();
		const context = {
			kind: "workspace-proposal-required-input-response-application-context",
			applicationId: "application-required-late",
			proposalId: "proposal-1",
		} satisfies WorkspaceProposalRequiredInputResponseApplicationContext;
		const record = proposalRecord("required-input-response", {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>);

		harness.contexts.down([["DATA", context]]);
		harness.contexts.down([["DATA", context]]);

		expect(harness.issues.map((entry) => entry.code)).toEqual([
			"missing-workspace-proposal-recorded",
			"missing-workspace-proposal-admission-decision",
		]);
		expect(harness.audit).toHaveLength(1);
		expect(harness.status).toEqual([]);
		expect(harness.familyTruth).toEqual([]);
		expect(harness.diagnostics.map((entry) => entry.code)).toEqual([
			"missing-workspace-proposal-recorded",
			"missing-workspace-proposal-admission-decision",
			"missing-durable-handoff",
		]);
		expect(harness.repairRequests).toEqual([]);

		harness.gates.down([["DATA", requiredInputGate()]]);
		harness.records.down([["DATA", record]]);
		harness.decisions.down([["DATA", admittedDecision(record)]]);

		expect(harness.diagnostics.map((entry) => entry.code)).toContain(
			"missing-workspace-proposal-recorded",
		);
		expect(harness.familyTruth).toHaveLength(1);
		expect(harness.status.at(-1)).toMatchObject({
			applicationId: "application-required-late",
			state: "applied",
			emittedFactRefs: [
				expect.objectContaining({
					factKind: "required-input-response-applied",
					factId: "application-required-late",
				}),
			],
		});
		expect(harness.recorded.at(-1)).toMatchObject({
			applicationId: "application-required-late",
		});
		expect(harness.repairRequests).toEqual([]);
	});

	it("diagnoses an explicit missing decisionId without falling back to another proposal decision", () => {
		const harness = spawnProjectorHarness();
		const record = proposalRecord("work-item-spawn", {
			kind: "work-item-spawn-proposed",
			proposalId: "proposal-1",
			proposedWorkItemId: "child-1",
			draft: workItemDraft("Child"),
		} satisfies WorkItemSpawnProposed);
		const decision = admittedDecision(record);

		harness.records.down([["DATA", record]]);
		harness.decisions.down([["DATA", decision]]);
		harness.contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-work-item-spawn-application-context",
					applicationId: "application-spawn-wrong-decision",
					proposalId: record.proposalId,
					decisionId: "decision-missing",
				},
			],
		]);

		expect(harness.familyTruth).toEqual([]);
		expect(harness.status).toEqual([]);
		expect(harness.recorded).toEqual([]);
		expect(harness.issues.map((entry) => entry.code)).toEqual([
			"missing-workspace-proposal-admission-decision",
		]);
		expect(harness.issues[0]?.refs).toContain(
			"workspace-proposal-admission-decision:decision-missing",
		);

		harness.decisions.down([["DATA", admittedDecisionWithId(record, "decision-missing")]]);

		expect(harness.familyTruth).toHaveLength(1);
		expect(harness.status.at(-1)).toMatchObject({
			applicationId: "application-spawn-wrong-decision",
			decisionId: "decision-missing",
			state: "applied",
		});
	});

	it("graph required-input projector applies once and re-references on replay", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded<RequiredInputResponseProposed<string>>>(
			[],
			null,
			{ name: "records" },
		);
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalRequiredInputResponseApplicationContext>([], null, {
			name: "contexts",
		});
		const gates = g.node<RequiredInputGate>([], null, { name: "gates" });
		const bundle = workspaceProposalRequiredInputResponseApplicationProjector(g, {
			records,
			decisions,
			contexts,
			gates,
		});
		const applied = collectData(bundle.applied);
		const status = collectData(bundle.status);

		const record = proposalRecord("required-input-response", {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>);
		const decision = admittedDecision(record);
		records.down([["DATA", record]]);
		decisions.down([["DATA", decision]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-graph-required",
					proposalId: record.proposalId,
				},
			],
		]);
		gates.down([["DATA", requiredInputGate()]]);
		decisions.down([["DATA", decision]]);

		expect(applied).toHaveLength(1);
		expect(status.at(-1)).toMatchObject({
			state: "applied",
			emittedFactRefs: [
				expect.objectContaining({
					factKind: "required-input-response-applied",
					factId: "application-graph-required",
				}),
			],
		});

		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-graph-required",
					proposalId: record.proposalId,
					sourceRefs: [{ kind: "manual-review", id: "changed-provenance" }],
				},
			],
		]);

		expect(applied).toHaveLength(1);
		expect(status.at(-1)).toMatchObject({
			applicationId: "application-graph-required",
			state: "idempotency-conflict",
			code: "idempotency-conflict",
			emittedFactRefs: [],
		});
	});

	it("graph required-input projector preserves distinct application attempts for one proposal", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded<RequiredInputResponseProposed<string>>>(
			[],
			null,
			{ name: "records" },
		);
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalRequiredInputResponseApplicationContext>([], null, {
			name: "contexts",
		});
		const gates = g.node<RequiredInputGate>([], null, { name: "gates" });
		const bundle = workspaceProposalRequiredInputResponseApplicationProjector(g, {
			records,
			decisions,
			contexts,
			gates,
		});
		const applied = collectData(bundle.applied);
		const status = collectData(bundle.status);
		const record = proposalRecord("required-input-response", {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>);

		records.down([["DATA", record]]);
		decisions.down([["DATA", admittedDecision(record)]]);
		gates.down([["DATA", requiredInputGate()]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-graph-required-a",
					proposalId: record.proposalId,
				},
			],
		]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-graph-required-b",
					proposalId: record.proposalId,
				},
			],
		]);

		expect(applied.map((entry) => entry.applicationId)).toEqual([
			"application-graph-required-a",
			"application-graph-required-b",
		]);
		expect(status.at(-1)).toMatchObject({
			applicationId: "application-graph-required-b",
			state: "applied",
		});
	});

	it("graph required-input projector blocks reused applicationId across proposal provenance", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded<RequiredInputResponseProposed<string>>>(
			[],
			null,
			{ name: "records" },
		);
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalRequiredInputResponseApplicationContext>([], null, {
			name: "contexts",
		});
		const gates = g.node<RequiredInputGate>([], null, { name: "gates" });
		const bundle = workspaceProposalRequiredInputResponseApplicationProjector(g, {
			records,
			decisions,
			contexts,
			gates,
		});
		const applied = collectData(bundle.applied);
		const status = collectData(bundle.status);
		const first = proposalRecord("required-input-response", {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>);
		const second = proposalRecordWithProposalId(
			"required-input-response",
			{
				kind: "required-input-response-proposed",
				proposalId: "proposal-2",
				requestId: "request-1",
				workItemId: "wi-1",
				value: "answer",
			} satisfies RequiredInputResponseProposed<string>,
			"proposal-2",
		);

		gates.down([["DATA", requiredInputGate()]]);
		records.down([["DATA", first]]);
		decisions.down([["DATA", admittedDecision(first)]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-reused",
					proposalId: first.proposalId,
				},
			],
		]);
		records.down([["DATA", second]]);
		decisions.down([["DATA", admittedDecision(second)]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-reused",
					proposalId: second.proposalId,
				},
			],
		]);

		expect(applied).toHaveLength(1);
		expect(status.at(-1)).toMatchObject({
			applicationId: "application-reused",
			proposalId: "proposal-2",
			state: "idempotency-conflict",
			code: "idempotency-conflict",
			emittedFactRefs: [],
		});
	});

	it("graph required-input projector reports malformed draft before missing gate repair", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded<RequiredInputResponseProposed<string>>>(
			[],
			null,
			{ name: "records" },
		);
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalRequiredInputResponseApplicationContext>([], null, {
			name: "contexts",
		});
		const gates = g.node<RequiredInputGate>([], null, { name: "gates" });
		const bundle = workspaceProposalRequiredInputResponseApplicationProjector(g, {
			records,
			decisions,
			contexts,
			gates,
		});
		const status = collectData(bundle.status);
		const record = proposalRecord("required-input-response", {
			kind: "wrong-required-input-draft",
			proposalId: "proposal-1",
		});

		records.down([["DATA", record]]);
		decisions.down([["DATA", admittedDecision(record)]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-required-input-response-application-context",
					applicationId: "application-malformed-required",
					proposalId: record.proposalId,
				},
			],
		]);

		expect(status.at(-1)).toMatchObject({
			applicationId: "application-malformed-required",
			state: "blocked",
			emittedFactRefs: [],
		});
		expect(status.at(-1)?.issues.map((entry) => entry.code)).toEqual(["malformed-family-draft"]);
	});

	it("graph link projector blocks conflicting replay instead of re-emitting duplicate truth", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded<ReturnType<typeof linkDraft>>>([], null, {
			name: "records",
		});
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalWorkItemLinkApplicationContext>([], null, {
			name: "contexts",
		});
		const workItems = g.node<WorkItemProjection>([], null, { name: "workItems" });
		const bundle = workspaceProposalWorkItemLinkApplicationProjector(g, {
			records,
			decisions,
			contexts,
			workItems,
		});
		const linked = collectData(bundle.linked);
		const status = collectData(bundle.status);
		const first = proposalRecord("work-item-link", {
			...linkDraft(),
			eventId: "link-event-1",
		});
		const second = proposalRecordWithProposalId(
			"work-item-link",
			{
				...linkDraft(),
				proposalId: "proposal-2",
				eventId: "link-event-1",
			},
			"proposal-2",
		);
		const secondDecision = admittedDecision(second);

		workItems.down([["DATA", workItem("wi-1")]]);
		workItems.down([["DATA", workItem("wi-2")]]);
		records.down([["DATA", first]]);
		decisions.down([["DATA", admittedDecision(first)]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-work-item-link-application-context",
					applicationId: "application-link-1",
					proposalId: first.proposalId,
				},
			],
		]);
		records.down([["DATA", second]]);
		decisions.down([["DATA", secondDecision]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-work-item-link-application-context",
					applicationId: "application-link-2",
					proposalId: second.proposalId,
				},
			],
		]);

		expect(linked).toHaveLength(1);
		expect(status.at(-1)).toMatchObject({
			applicationId: "application-link-2",
			state: "idempotency-conflict",
			code: "idempotency-conflict",
			emittedFactRefs: [],
		});

		const diagnostics = workspaceProposalFamilyApplicationDiagnosticProjector(g, {
			applicationStatuses: bundle.status,
		});
		const repair = workspaceProposalRepairReviewProjector(g, {
			applicationStatuses: bundle.status,
		});
		const diagnosticView = collectData(diagnostics.diagnostics);
		const repairRequests = collectData(repair.requests);

		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-work-item-link-application-context",
					applicationId: "application-link-2",
					proposalId: second.proposalId,
				},
			],
		]);

		expect(linked).toHaveLength(1);
		expect(diagnosticView.map((entry) => entry.code)).toContain("idempotency-conflict");
		expect(repairRequests).toEqual([
			expect.objectContaining({
				kind: "workspace-proposal-repair-review-request",
				applicationId: "application-link-2",
				proposalId: "proposal-2",
				decisionId: secondDecision.decisionId,
				idempotencyKey: second.idempotencyKey,
				proposalFamily: "work-item-link",
				code: "idempotency-conflict",
			}),
		]);
	});

	it("graph domain-action adapter stays repair-needed until D430-provenance facts arrive", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded>([], null, { name: "records" });
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalDomainActionApplicationContext>([], null, {
			name: "contexts",
		});
		const domainFacts = g.node<never>([], null, { name: "domainFacts" });
		const bundle = workspaceProposalDomainActionApplicationProjector(g, {
			records,
			decisions,
			contexts,
			emittedFacts: domainFacts,
		});
		const status = collectData(bundle.status);
		const record = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});

		records.down([["DATA", record]]);
		decisions.down([["DATA", admittedDecision(record)]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-domain-action-application-context",
					applicationId: "application-domain-missing",
					proposalId: record.proposalId,
				},
			],
		]);

		expect(status.at(-1)).toMatchObject({
			state: "repair-needed",
			code: "missing-domain-action-facts",
			emittedFactRefs: [],
		});
		expect(
			projectWorkspaceProposalRepairReviewRequests({
				applicationStatuses: status,
			}),
		).toEqual([
			expect.objectContaining({
				kind: "workspace-proposal-repair-review-request",
				applicationId: "application-domain-missing",
				proposalId: record.proposalId,
				decisionId: "decision-1",
				idempotencyKey: record.idempotencyKey,
				proposalFamily: "work-item-domain-action",
				code: "missing-domain-action-facts",
			}),
		]);
	});

	it("graph domain-action adapter waits for every explicitly requested emitted fact id", () => {
		const g = graph();
		const records = g.node<WorkspaceProposalRecorded>([], null, { name: "records" });
		const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
		const contexts = g.node<WorkspaceProposalDomainActionApplicationContext>([], null, {
			name: "contexts",
		});
		const domainFacts = g.node<WorkItemAuthoringFact>([], null, { name: "domainFacts" });
		const bundle = workspaceProposalDomainActionApplicationProjector(g, {
			records,
			decisions,
			contexts,
			emittedFacts: domainFacts,
		});
		const status = collectData(bundle.status);
		const record = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});
		const decision = admittedDecision(record);
		const applicationId = "application-domain-partial";
		const fact = (eventId: string): WorkItemAuthoringFact => ({
			kind: "work-item-patched",
			eventId,
			workItemId: "wi-1",
			patch: { summary: eventId },
			sourceRefs: d430ApplicationRefs(record, decision, applicationId),
			metadata: { applicationIdempotencyKey: record.idempotencyKey },
		});

		records.down([["DATA", record]]);
		decisions.down([["DATA", decision]]);
		contexts.down([
			[
				"DATA",
				{
					kind: "workspace-proposal-domain-action-application-context",
					applicationId,
					proposalId: record.proposalId,
					emittedFactIds: ["patch-event-1", "patch-event-2"],
				},
			],
		]);
		domainFacts.down([["DATA", fact("patch-event-1")]]);

		expect(status.at(-1)).toMatchObject({
			applicationId,
			state: "repair-needed",
			code: "missing-domain-action-facts",
			emittedFactRefs: [],
		});

		domainFacts.down([["DATA", fact("patch-event-2")]]);

		expect(status.at(-1)).toMatchObject({
			applicationId,
			state: "applied",
			emittedFactRefs: [
				expect.objectContaining({ factId: "patch-event-1" }),
				expect.objectContaining({ factId: "patch-event-2" }),
			],
		});
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

	it("records D437 family-owned outcome refs without exposing a generic recorder", () => {
		const requiredRecord = proposalRecord("required-input-response", {
			kind: "required-input-response-proposed",
			proposalId: "proposal-1",
			requestId: "request-1",
			workItemId: "wi-1",
			value: "answer",
		} satisfies RequiredInputResponseProposed<string>);
		const required = projectWorkspaceProposalRequiredInputResponseApplication(
			requiredRecord,
			admittedDecision(requiredRecord),
			{ applicationId: "application-required-outcome", gate: requiredInputGate() },
		);
		const requiredOutcome = recordWorkspaceProposalRequiredInputResponseOutcome(required.status, {
			outcomeId: "required-outcome-1",
			requiredInputRequestId: "request-1",
			responseRef: { kind: "required-input-response-applied", id: "application-required-outcome" },
		});
		expect(requiredOutcome.status.state).toBe("recorded");
		expect(requiredOutcome.outcome).toMatchObject({
			kind: "workspace-proposal-required-input-response-outcome-recorded",
			requiredInputRequestId: "request-1",
		});

		const spawnRecord = proposalRecord("work-item-spawn", {
			kind: "work-item-spawn-proposed",
			proposalId: "proposal-1",
			proposedWorkItemId: "child-1",
			draft: workItemDraft("Child"),
		} satisfies WorkItemSpawnProposed);
		const spawn = projectWorkspaceProposalWorkItemSpawnApplication(
			spawnRecord,
			admittedDecision(spawnRecord),
			{ applicationId: "application-spawn-outcome" },
		);
		const spawnOutcome = recordWorkspaceProposalWorkItemSpawnOutcome(spawn.status, {
			outcomeId: "spawn-outcome-1",
			workItemRef: { kind: "work-item", id: "child-1" },
		});
		expect(spawnOutcome.status.state).toBe("recorded");
		expect(spawnOutcome.outcome).toMatchObject({
			kind: "workspace-proposal-work-item-spawn-outcome-recorded",
			workItemRef: { kind: "work-item", id: "child-1" },
		});

		const linkRecord = proposalRecord("work-item-link", linkDraft());
		const link = projectWorkspaceProposalWorkItemLinkApplication(
			linkRecord,
			admittedDecision(linkRecord),
			{
				applicationId: "application-link-outcome",
				workItems: [workItem("wi-1"), workItem("wi-2")],
			},
		);
		const linkOutcome = recordWorkspaceProposalWorkItemLinkOutcome(link.status, {
			outcomeId: "link-outcome-1",
			linkRef: { kind: "work-item-link", id: "link-1" },
		});
		expect(linkOutcome.status.state).toBe("recorded");
		expect(linkOutcome.outcome).toMatchObject({
			kind: "workspace-proposal-work-item-link-outcome-recorded",
			linkRef: { kind: "work-item-link", id: "link-1" },
		});

		const domainRecord = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});
		const domainDecision = admittedDecision(domainRecord);
		const domain = projectWorkspaceProposalDomainActionApplicationStatus(
			domainRecord,
			domainDecision,
			{
				applicationId: "application-domain-outcome",
				emittedFacts: [
					{
						kind: "work-item-patched",
						eventId: "patch-event-outcome",
						workItemId: "wi-1",
						patch: { summary: "Updated" },
						sourceRefs: d430ApplicationRefs(
							domainRecord,
							domainDecision,
							"application-domain-outcome",
						),
						metadata: { applicationIdempotencyKey: domainRecord.idempotencyKey },
					},
				],
			},
		);
		const domainOutcome = recordWorkspaceProposalDomainActionOutcome(domain.status, {
			outcomeId: "domain-outcome-1",
			actionRef: { kind: "work-item-domain-action", id: "patch-event-outcome" },
		});
		expect(domainOutcome.status.state).toBe("recorded");
		expect(domainOutcome.outcome).toMatchObject({
			kind: "workspace-proposal-domain-action-outcome-recorded",
			actionRef: { kind: "work-item-domain-action", id: "patch-event-outcome" },
		});
	});

	it("keeps D437 outcome recording data-only and horizon-driven", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const status = projectWorkspaceProposalWorkItemLinkApplication(
			record,
			admittedDecision(record),
			{
				applicationId: "application-link-outcome-guard",
				workItems: [workItem("wi-1"), workItem("wi-2")],
			},
		).status;

		const runtimeMaterial = recordWorkspaceProposalWorkItemLinkOutcome(status, {
			outcomeId: "link-runtime-outcome",
			linkRef: { kind: "work-item-link", id: "link-1" },
			metadata: { callback: "recordOutcome" },
		});
		expect(runtimeMaterial.status.state).toBe("not-recorded");
		expect(runtimeMaterial.outcome).toBeUndefined();
		expect(runtimeMaterial.issues.map((entry) => entry.code)).toContain(
			"forbidden-runtime-material",
		);

		const openHorizon = recordWorkspaceProposalWorkItemLinkOutcome(status, {
			outcomeId: "link-open-horizon",
			horizon: {
				kind: "workspace-proposal-family-evidence-horizon",
				horizonId: "horizon-open",
				applicationId: status.applicationId,
				state: "open",
			},
		});
		expect(openHorizon.status.state).toBe("pending");
		expect(openHorizon.outcome).toBeUndefined();

		const closedHorizon = recordWorkspaceProposalWorkItemLinkOutcome(status, {
			outcomeId: "link-closed-horizon",
			horizon: {
				kind: "workspace-proposal-family-evidence-horizon",
				horizonId: "horizon-closed",
				applicationId: status.applicationId,
				state: "closed",
			},
		});
		expect(closedHorizon.status.state).toBe("repair-needed");
		expect(closedHorizon.outcome).toBeUndefined();

		const domainRecord = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});
		const decision = admittedDecision(domainRecord);
		const domain = projectWorkspaceProposalDomainActionApplicationStatus(domainRecord, decision, {
			applicationId: "application-domain-partial-outcome",
			emittedFacts: [
				{
					kind: "work-item-patched",
					eventId: "patch-event-partial",
					workItemId: "wi-1",
					patch: { summary: "Updated" },
					sourceRefs: d430ApplicationRefs(
						domainRecord,
						decision,
						"application-domain-partial-outcome",
					),
					metadata: { applicationIdempotencyKey: domainRecord.idempotencyKey },
				},
			],
		});
		const partial = recordWorkspaceProposalDomainActionOutcome(domain.status, {
			outcomeId: "domain-partial-outcome",
			policy: {
				kind: "workspace-proposal-family-completion-policy",
				policyId: "domain-multi-step",
				proposalFamily: "work-item-domain-action",
				domainActionCompletion: "multi-step-partial",
			},
		});
		expect(partial.status.state).toBe("partial");
		expect(partial.issues).toEqual([]);

		const malformedRef = recordWorkspaceProposalDomainActionOutcome(domain.status, {
			outcomeId: "domain-malformed-ref-outcome",
			actionRef: { kind: "work-item-domain-action" } as Parameters<
				typeof recordWorkspaceProposalDomainActionOutcome
			>[1]["actionRef"],
			policy: {
				kind: "workspace-proposal-family-completion-policy",
				policyId: "domain-multi-step",
				proposalFamily: "work-item-domain-action",
				domainActionCompletion: "multi-step-partial",
			},
		});
		expect(malformedRef.status.state).toBe("pending");
		expect(malformedRef.outcome).toBeUndefined();
		expect(malformedRef.issues.map((entry) => entry.code)).toEqual(["missing-required-field"]);
	});

	it("projects D437 family outcome thin-ref index exact replay and conflicts", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const status = projectWorkspaceProposalWorkItemLinkApplication(
			record,
			admittedDecision(record),
			{
				applicationId: "application-link-index",
				workItems: [workItem("wi-1"), workItem("wi-2")],
			},
		).status;
		const first = recordWorkspaceProposalWorkItemLinkOutcome(status, {
			outcomeId: "link-index-outcome",
			linkRef: { kind: "work-item-link", id: "link-1" },
		}).outcome;
		expect(first).toBeDefined();
		if (first === undefined) throw new Error("expected first D437 outcome");
		const replay = projectWorkspaceProposalFamilyOutcomeIndex([first, first]);
		expect(replay).toEqual([
			expect.objectContaining({
				state: "recorded",
				outcomeRefs: [
					expect.objectContaining({
						kind: "workspace-proposal-family-outcome-ref",
						outcomeId: "link-index-outcome",
					}),
				],
				issues: [],
			}),
		]);

		const second = recordWorkspaceProposalWorkItemLinkOutcome(status, {
			outcomeId: "link-index-outcome",
			linkRef: { kind: "work-item-link", id: "link-2" },
		}).outcome;
		expect(second).toBeDefined();
		if (second === undefined) throw new Error("expected second D437 outcome");
		const conflict = projectWorkspaceProposalFamilyOutcomeIndex([first, second]);
		expect(conflict).toEqual([
			expect.objectContaining({
				state: "idempotency-conflict",
				outcomeRefs: [],
			}),
		]);
		expect(conflict[0]?.issues.map((entry) => entry.code)).toEqual(["idempotency-conflict"]);

		const provenanceConflict = recordWorkspaceProposalWorkItemLinkOutcome(status, {
			outcomeId: "link-index-outcome",
			linkRef: { kind: "work-item-link", id: "link-1" },
			sourceRefs: [{ kind: "manual-review", id: "changed-provenance" }],
		}).outcome;
		expect(provenanceConflict).toBeDefined();
		if (provenanceConflict === undefined) throw new Error("expected provenance D437 outcome");
		expect(projectWorkspaceProposalFamilyOutcomeIndex([first, provenanceConflict])).toEqual([
			expect.objectContaining({
				state: "idempotency-conflict",
				outcomeRefs: [],
			}),
		]);
	});

	it("projects diagnostic view and repair review from existing durable material only", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const application = projectWorkspaceProposalWorkItemLinkApplication(
			record,
			admittedDecision(record),
			{
				applicationId: "application-link-diagnostics",
				workItems: [workItem("wi-1"), workItem("wi-2")],
			},
		);
		const outcomeStatus = recordWorkspaceProposalWorkItemLinkOutcome(application.status, {
			outcomeId: "link-diagnostic-outcome",
			horizon: {
				kind: "workspace-proposal-family-evidence-horizon",
				horizonId: "horizon-closed-diagnostic",
				applicationId: application.status.applicationId,
				state: "closed",
			},
		}).status;
		const duplicateDiagnostics = projectWorkspaceProposalFamilyApplicationDiagnostics({
			applicationStatuses: [application.status, application.status],
			outcomeStatuses: [outcomeStatus, outcomeStatus],
		});

		expect(duplicateDiagnostics.map((entry) => entry.classification)).toEqual([
			"missing-family-material",
		]);
		expect(duplicateDiagnostics[0]).toMatchObject({
			kind: "workspace-proposal-family-application-diagnostic",
			applicationId: "application-link-diagnostics",
			proposalId: record.proposalId,
			decisionId: "decision-1",
			proposalFamily: "work-item-link",
			code: "missing-required-field",
		});

		expect(
			projectWorkspaceProposalRepairReviewRequests({
				outcomeStatuses: [outcomeStatus],
			}),
		).toEqual([]);
		expect(
			projectWorkspaceProposalRepairReviewRequests({
				applicationStatuses: [application.status],
				outcomeStatuses: [{ ...outcomeStatus, proposalId: "other-proposal" }],
			}),
		).toEqual([]);
		expect(
			projectWorkspaceProposalRepairReviewRequests({
				applicationStatuses: [application.status],
				outcomeStatuses: [outcomeStatus, outcomeStatus],
			}),
		).toEqual([
			expect.objectContaining({
				applicationId: "application-link-diagnostics",
				code: "missing-required-field",
				proposalFamily: "work-item-link",
			}),
		]);
	});

	it("dedupes graph-visible diagnostic and repair review projection on replay", () => {
		const g = graph();
		const statuses = g.node<WorkspaceProposalApplicationStatus>([], null, { name: "statuses" });
		const diagnostics = workspaceProposalFamilyApplicationDiagnosticProjector(g, {
			applicationStatuses: statuses,
		});
		const repair = workspaceProposalRepairReviewProjector(g, {
			applicationStatuses: statuses,
		});
		const diagnosticView = collectData(diagnostics.diagnostics);
		const repairRequests = collectData(repair.requests);
		const record = proposalRecord("work-item-domain-action", {
			kind: "work-item-domain-action-proposal-intake",
			proposalId: "proposal-1",
			workItemId: "wi-1",
			actionKind: "patch",
			payload: { patch: { summary: "Updated" } },
		});
		const pending = projectWorkspaceProposalDomainActionApplicationStatus(
			record,
			admittedDecision(record),
			{
				applicationId: "application-domain-replay-repair",
				emittedFacts: [],
			},
		).status;
		const repairNeeded = {
			...pending,
			state: "repair-needed",
			code: "missing-domain-action-facts",
			issues: [
				{
					kind: "issue",
					source: "workspace-proposal",
					severity: "error",
					code: "missing-domain-action-facts",
					message: "Workspace proposal family application material is missing",
					subjectId: pending.proposalId,
					refs: pending.sourceRefs.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
				},
			],
		} satisfies typeof pending;

		statuses.down([["DATA", repairNeeded]]);
		statuses.down([["DATA", repairNeeded]]);

		expect(diagnosticView).toHaveLength(1);
		expect(diagnosticView[0]).toMatchObject({
			classification: "missing-family-material",
			code: "missing-domain-action-facts",
		});
		expect(repairRequests).toHaveLength(1);
		expect(repairRequests[0]?.repairRequestId).toContain("workspace-proposal-repair-review:");

		const repairIssue = repairNeeded.issues[0];
		if (repairIssue === undefined) throw new Error("expected repair issue");
		const updatedRepairNeeded = {
			...repairNeeded,
			issues: [
				{
					...repairIssue,
					message: "Workspace proposal family application material is still missing",
				},
			],
			sourceRefs: [
				...repairNeeded.sourceRefs,
				{ kind: "manual-review", id: "repair-context-updated" },
			],
		} satisfies typeof repairNeeded;

		statuses.down([["DATA", updatedRepairNeeded]]);

		expect(diagnosticView).toHaveLength(2);
		expect(diagnosticView.at(-1)?.issues[0]?.message).toBe(
			"Workspace proposal family application material is still missing",
		);
		expect(repairRequests).toHaveLength(2);
		expect(repairRequests.at(-1)?.repairRequestId).toBe(repairRequests[0]?.repairRequestId);

		const oldDelimitedCollisionA = {
			...repairNeeded,
			applicationId: "a:b",
			proposalId: "proposal-a",
			decisionId: "decision-a",
			idempotencyKey: "c",
		} satisfies typeof repairNeeded;
		const oldDelimitedCollisionB = {
			...repairNeeded,
			applicationId: "a",
			proposalId: "proposal-b",
			decisionId: "decision-b",
			idempotencyKey: "b:c",
		} satisfies typeof repairNeeded;
		const collisionIds = projectWorkspaceProposalRepairReviewRequests({
			applicationStatuses: [oldDelimitedCollisionA, oldDelimitedCollisionB],
		}).map((entry) => entry.repairRequestId);
		expect(collisionIds).toHaveLength(2);
		expect(new Set(collisionIds).size).toBe(2);
	});

	it("classifies malformed repair-needed material before missing-family fallback", () => {
		const record = proposalRecord("work-item-link", linkDraft());
		const pending = projectWorkspaceProposalWorkItemLinkApplication(
			record,
			admittedDecision(record),
			{
				applicationId: "application-malformed-repair",
				workItems: [workItem("wi-1"), workItem("wi-2")],
			},
		).status;
		const malformedRepair = {
			...pending,
			state: "repair-needed",
			code: "malformed-family-draft",
			issues: [
				{
					kind: "issue",
					source: "workspace-proposal",
					severity: "error",
					code: "malformed-family-draft",
					message: "WorkItem link draft is malformed",
					subjectId: pending.proposalId,
					refs: pending.sourceRefs.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`),
				},
			],
		} satisfies typeof pending;

		expect(
			projectWorkspaceProposalFamilyApplicationDiagnostics({
				applicationStatuses: [malformedRepair],
			}),
		).toEqual([
			expect.objectContaining({
				classification: "malformed-family-material",
				code: "malformed-family-draft",
			}),
		]);
		expect(
			projectWorkspaceProposalRepairReviewRequests({
				applicationStatuses: [malformedRepair],
			}),
		).toEqual([]);
	});

	it("keeps D438 missing durable diagnostics out of repair review lowering", () => {
		const missingIssue = {
			kind: "issue",
			source: "workspace-proposal",
			severity: "error",
			code: "missing-workspace-proposal-recorded",
			message: "Workspace family application context references a missing durable proposal record",
			subjectId: "proposal-missing",
			refs: [
				"workspace-proposal-application-context:application-missing",
				"workspace-proposal-recorded:proposal-missing",
			],
			metadata: {
				applicationId: "application-missing",
				proposalId: "proposal-missing",
			},
		} satisfies WorkspaceProposalRecordedIssue;
		const diagnostics = projectWorkspaceProposalFamilyApplicationDiagnostics({
			issues: [missingIssue, missingIssue],
		});

		expect(diagnostics).toEqual([
			expect.objectContaining({
				classification: "missing-durable-handoff",
				code: "missing-workspace-proposal-recorded",
				applicationId: "application-missing",
				proposalId: "proposal-missing",
			}),
		]);
		expect(projectWorkspaceProposalRepairReviewRequests({})).toEqual([]);
	});

	it("projects D444 repair-review requests as open until explicit lifecycle material arrives", () => {
		const { request, repairNeededStatus } = repairReviewFixture();

		expect(projectWorkspaceProposalRepairReviewStatuses({ requests: [request] })).toEqual([
			expect.objectContaining({
				kind: "workspace-proposal-repair-review-status",
				repairRequestId: request.repairRequestId,
				applicationId: request.applicationId,
				state: "open",
				proofRefs: [],
				issues: [],
			}),
		]);

		const absenceDoesNotResolve = projectWorkspaceProposalRepairReviewStatuses({
			requests: [request],
			applicationStatuses: [
				{
					...repairNeededStatus,
					state: "applied",
					code: undefined,
					issues: [],
					emittedFactRefs: [],
				},
			],
		});
		expect(absenceDoesNotResolve[0]?.state).toBe("open");
	});

	it("projects D444 acknowledged and terminal human decisions without remutation outputs", () => {
		const { request, appliedStatus } = repairReviewFixture();
		const acknowledged = repairReviewDecision(request, "acknowledged", "review-ack");
		const withdrawn = repairReviewDecision(request, "withdrawn", "review-withdrawn");
		const resolved = repairReviewDecision(request, "resolved", "review-resolved");
		const superseded = repairReviewDecision(request, "superseded", "review-superseded");

		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				decisions: [acknowledged],
			})[0],
		).toMatchObject({
			state: "acknowledged",
			proofKind: "human-decision",
			decisions: [acknowledged],
		});

		for (const decision of [withdrawn, resolved, superseded]) {
			expect(
				projectWorkspaceProposalRepairReviewStatuses({
					requests: [request],
					decisions: [acknowledged, decision],
					applicationStatuses: [appliedStatus],
				})[0],
			).toMatchObject({
				state: decision.intent,
				proofKind: "human-decision",
				proofRefs: [
					{
						kind: "workspace-proposal-repair-review-decision",
						id: decision.reviewDecisionId,
					},
				],
			});
		}
	});

	it("records D450 repair-review decisions from request coordinates only", () => {
		const { request } = repairReviewFixture();
		const requestBefore = structuredClone(request);
		const options = {
			reviewDecisionId: "review-decision:d450-ack",
			intent: "acknowledged",
			reviewerRef: { kind: "actor", id: "reviewer:d450" },
			actorRef: { kind: "actor", id: "actor:d450" },
			capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
			policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
			sourceRefs: [{ kind: "manual-review", id: "source:d450" }],
			audit: {
				auditId: "audit:d450",
				actorId: "actor:d450",
				sourceRefs: [{ kind: "manual-review", id: "audit-source:d450" }],
			},
			reason: "human acknowledged the review request",
			code: "acknowledged-by-reviewer",
			decidedAtMs: 450,
			metadata: { queue: "repair-review" },
		} as const;
		const optionsBefore = structuredClone(options);
		const result = recordWorkspaceProposalRepairReviewDecision(request, options);

		expect(result).toMatchObject({
			kind: "workspace-proposal-repair-review-decision-recording-result",
			status: "recorded",
			issues: [],
			decision: {
				kind: "workspace-proposal-repair-review-decision",
				reviewDecisionId: "review-decision:d450-ack",
				repairRequestId: request.repairRequestId,
				applicationId: request.applicationId,
				proposalId: request.proposalId,
				decisionId: request.decisionId,
				idempotencyKey: request.idempotencyKey,
				proposalFamily: request.proposalFamily,
				intent: "acknowledged",
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
				actorRef: { kind: "actor", id: "actor:d450" },
			},
		});
		expect(structuredClone(result)).toEqual(result);
		expect(request).toEqual(requestBefore);
		expect(options).toEqual(optionsBefore);
		(options.sourceRefs[0] as { id: string }).id = "source:d450-mutated";
		expect(result.sourceRefs).toContainEqual({ kind: "manual-review", id: "source:d450" });
		expect(result.decision?.sourceRefs).toContainEqual({
			kind: "manual-review",
			id: "source:d450",
		});
		expect(JSON.stringify(result)).not.toContain("WorkItemCreated");
		expect(JSON.stringify(result)).not.toContain("RequiredInputSatisfied");
		expect(JSON.stringify(result)).not.toContain("WorkItemLinked");
		expect(JSON.stringify(result)).not.toContain("domain-mutation");
		expect(JSON.stringify(result)).not.toContain("runtime-private");

		for (const intent of ["resolved", "withdrawn", "superseded"] as const) {
			const recorded = recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: `review-decision:d450-${intent}`,
				intent,
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
				capabilityRefs: [{ kind: "capability", id: `repair-review:${intent}` }],
				policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
				sourceRefs: [{ kind: "manual-review", id: `source:d450-${intent}` }],
				audit: {
					auditId: `audit:d450-${intent}`,
					actorId: "actor:d450",
					sourceRefs: [{ kind: "manual-review", id: `audit-source:d450-${intent}` }],
				},
				code: `review-${intent}`,
				resolvesRefs:
					intent === "resolved"
						? [{ kind: "workspace-proposal-family-outcome-index-entry", id: "outcome-index:1" }]
						: undefined,
				supersedesRefs:
					intent === "superseded"
						? [{ kind: "workspace-proposal-repair-review-decision", id: "prior-review" }]
						: undefined,
			});
			expect(recorded.status).toBe("recorded");
			expect(recorded.decision).toMatchObject({
				applicationId: request.applicationId,
				proposalId: request.proposalId,
				decisionId: request.decisionId,
				idempotencyKey: request.idempotencyKey,
				proposalFamily: request.proposalFamily,
				intent,
			});
		}
	});

	it("fails D450 repair-review decision intake closed for overrides, stale guards, and forbidden material", () => {
		const { request } = repairReviewFixture();
		const openStatus = projectWorkspaceProposalRepairReviewStatuses({ requests: [request] })[0]!;
		const acknowledged = recordWorkspaceProposalRepairReviewDecision(request, {
			reviewDecisionId: "review-decision:d450-status",
			intent: "acknowledged",
			reviewerRef: { kind: "actor", id: "reviewer:d450" },
			capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
			policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
			sourceRefs: [{ kind: "manual-review", id: "source:d450-status" }],
			audit: {
				auditId: "audit:d450-status",
				actorId: "actor:d450",
				sourceRefs: [{ kind: "manual-review", id: "audit-source:d450-status" }],
			},
			code: "acknowledged-by-reviewer",
			currentStatus: openStatus,
			expectedCurrentState: { state: "open", code: "open" },
		});
		expect(acknowledged.status).toBe("recorded");

		const status = projectWorkspaceProposalRepairReviewStatuses({
			requests: [request],
			decisions: [acknowledged.decision!],
		})[0]!;
		expect(status).toMatchObject({
			state: "acknowledged",
			proofKind: "human-decision",
			decisions: [acknowledged.decision],
		});

		const invalid = [
			recordWorkspaceProposalRepairReviewDecision(request, {
				intent: "acknowledged",
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
			}),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-bad-intent",
				intent: "retry-now" as never,
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
			}),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-override",
				intent: "acknowledged",
				applicationId: "application:override",
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
			} as never),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-stale",
				intent: "resolved",
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
				capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
				policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
				sourceRefs: [{ kind: "manual-review", id: "source:d450-stale" }],
				audit: {
					auditId: "audit:d450-stale",
					actorId: "actor:d450",
					sourceRefs: [{ kind: "manual-review", id: "audit-source:d450-stale" }],
				},
				code: "resolved-by-reviewer",
				currentStatus: status,
				expectedCurrentState: { state: "open" },
			}),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-unverifiable",
				intent: "resolved",
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
				capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
				policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
				sourceRefs: [{ kind: "manual-review", id: "source:d450-unverifiable" }],
				audit: {
					auditId: "audit:d450-unverifiable",
					actorId: "actor:d450",
					sourceRefs: [{ kind: "manual-review", id: "audit-source:d450-unverifiable" }],
				},
				code: "resolved-by-reviewer",
				expectedCurrentState: { state: "open" },
			}),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-unaudited",
				intent: "acknowledged",
			}),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-forbidden",
				intent: "acknowledged",
				reviewerRef: { kind: "actor", id: "credential:leak" },
				capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
				policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
				sourceRefs: [{ kind: "manual-review", id: "source:d450-forbidden" }],
				audit: {
					auditId: "audit:d450-forbidden",
					actorId: "actor:d450",
					sourceRefs: [{ kind: "manual-review", id: "audit-source:d450-forbidden" }],
				},
				code: "acknowledged-by-reviewer",
			}),
			recordWorkspaceProposalRepairReviewDecision(request, {
				reviewDecisionId: "review-decision:d450-callback",
				intent: "acknowledged",
				reviewerRef: { kind: "actor", id: "reviewer:d450" },
				capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
				policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
				sourceRefs: [{ kind: "manual-review", id: "source:d450-callback" }],
				audit: {
					auditId: "audit:d450-callback",
					actorId: "actor:d450",
					sourceRefs: [{ kind: "manual-review", id: "audit-source:d450-callback" }],
				},
				code: "acknowledged-by-reviewer",
				metadata: { callback: () => undefined },
			} as never),
		];
		expect(invalid.every((entry) => entry.status === "blocked")).toBe(true);
		expect(invalid.every((entry) => entry.sourceRefs.length === 0)).toBe(true);
		expect(JSON.stringify(invalid)).not.toContain("credential:leak");
		expect(invalid.flatMap((entry) => entry.issues.map((issue) => issue.code))).toEqual(
			expect.arrayContaining([
				"missing-review-decision-id",
				"unsupported-repair-review-intent",
				"coordinate-override-forbidden",
				"stale-repair-review-state",
				"missing-review-authority-material",
				"missing-review-audit-material",
				"forbidden-runtime-material",
				"non-data-material",
			]),
		);
		expect(JSON.stringify(invalid)).not.toContain("WorkItemCreated");
		expect(JSON.stringify(invalid)).not.toContain("RequiredInputSatisfied");
		expect(JSON.stringify(invalid)).not.toContain("workspace-proposal-family-outcome-recorded");

		const accessorOptions = {
			reviewDecisionId: "review-decision:d450-accessor",
			intent: "acknowledged",
			reviewerRef: { kind: "actor", id: "reviewer:d450" },
			capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
			policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
			audit: {
				auditId: "audit:d450-accessor",
				actorId: "actor:d450",
			},
			code: "acknowledged-by-reviewer",
		};
		Object.defineProperty(accessorOptions, "sourceRefs", {
			enumerable: true,
			get() {
				throw new Error("sourceRefs getter must not run");
			},
		});
		expect(() =>
			recordWorkspaceProposalRepairReviewDecision(request, accessorOptions as never),
		).not.toThrow();
		expect(
			recordWorkspaceProposalRepairReviewDecision(request, accessorOptions as never),
		).toMatchObject({
			status: "blocked",
			sourceRefs: [],
			issues: expect.arrayContaining([expect.objectContaining({ code: "non-data-material" })]),
		});
	});

	it("projects graph-visible D456 repair-review decision recordings without status authority", () => {
		const { request } = repairReviewFixture();
		const openStatus = projectWorkspaceProposalRepairReviewStatuses({ requests: [request] })[0];
		if (openStatus === undefined) throw new Error("expected D456 open status");
		const recordingInput = repairReviewRecordingInput(request, "review-decision:d456");
		const duplicate = structuredClone(recordingInput);
		const conflict = {
			...recordingInput,
			intent: "withdrawn",
			code: "conflicting-withdrawn",
		} satisfies WorkspaceProposalRepairReviewDecisionRecordingInput;
		const unsafeAuditConflict = {
			...recordingInput,
			audit: {
				auditId: "audit:unsafe-conflict",
				metadata: { providerHandle: "secret-provider" },
			},
		} satisfies WorkspaceProposalRepairReviewDecisionRecordingInput;

		expect(
			projectWorkspaceProposalRepairReviewDecisionRecordings({
				requests: [request],
				recordingInputs: [recordingInput, duplicate],
				statuses: [openStatus],
			}),
		).toEqual([
			expect.objectContaining({
				status: "recorded",
				decision: expect.objectContaining({
					reviewDecisionId: "review-decision:d456",
					applicationId: request.applicationId,
					intent: "acknowledged",
				}),
				issues: [],
			}),
		]);
		expect(
			projectWorkspaceProposalRepairReviewDecisionRecordings({
				requests: [request],
				recordingInputs: [recordingInput, conflict],
				statuses: [openStatus],
			})[0],
		).toMatchObject({
			status: "blocked",
			issues: [
				expect.objectContaining({
					code: "conflicting-repair-review-decision-recording-input",
				}),
			],
		});
		const unsafeConflictResult = projectWorkspaceProposalRepairReviewDecisionRecordings({
			requests: [request],
			recordingInputs: [unsafeAuditConflict, conflict],
			statuses: [openStatus],
		})[0];
		expect(unsafeConflictResult?.status).toBe("blocked");
		expect(unsafeConflictResult?.audit).toBeUndefined();
		expect(JSON.stringify(unsafeConflictResult)).not.toContain("secret-provider");

		const g = graph();
		const requests = g.node<WorkspaceProposalRepairReviewRequest>([], null, { name: "requests" });
		const inputs = g.node<WorkspaceProposalRepairReviewDecisionRecordingInput>([], null, {
			name: "recordingInputs",
		});
		const statuses = g.node<typeof openStatus>([], null, { name: "statuses" });
		const bundle = workspaceProposalRepairReviewDecisionRecordingProjector(g, {
			requests,
			recordingInputs: inputs,
			statuses,
		});
		const results = collectData(bundle.results);
		const decisions = collectData(bundle.decisions);
		const issues = collectData(bundle.issues);

		requests.down([["DATA", request]]);
		statuses.down([["DATA", openStatus]]);
		inputs.down([["DATA", recordingInput]]);
		inputs.down([["DATA", duplicate]]);
		inputs.down([["DATA", conflict]]);

		expect(results.map((entry) => entry.status)).toEqual(["recorded", "blocked"]);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			reviewDecisionId: "review-decision:d456",
			repairRequestId: request.repairRequestId,
		});
		expect(issues.map((entry) => entry.code)).toEqual([
			"conflicting-repair-review-decision-recording-input",
		]);
		expect(Object.keys(bundle).sort()).toEqual(["decisions", "issues", "results"]);
		expect(JSON.stringify(results)).not.toContain("workspace-proposal-application-status");
		expect(JSON.stringify(results)).not.toContain("WorkItemCreated");
		expect(JSON.stringify(results)).not.toContain("RequiredInputSatisfied");
		expect(JSON.stringify(results)).not.toContain("runtime");
	});

	it("validates D459 repair action intents and lowers review-only actions to D456 input", () => {
		const fixture = repairReviewFixture();
		const status = projectWorkspaceProposalRepairReviewStatuses({ requests: [fixture.request] })[0];
		if (status === undefined) throw new Error("expected D459 status");
		const descriptor = projectWorkspaceProposalRepairActionDescriptors({
			requests: [fixture.request],
			statuses: [status],
		}).find((entry) => entry.actionKind === "mark-human-resolved");
		if (descriptor === undefined) throw new Error("expected D459 descriptor");
		const intent = repairActionIntent(fixture.request, descriptor, {
			actionKind: "mark-human-resolved",
			expectedCurrentState: { state: "open", code: "open" },
		});

		expect(
			validateWorkspaceProposalRepairActionIntent(intent, {
				descriptor,
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
			}),
		).toMatchObject({
			status: "accepted",
			issues: [],
			intent,
		});
		const prepared = prepareWorkspaceProposalRepairReviewDecisionRecordingInput(intent, {
			descriptor,
			request: fixture.request,
			currentStatus: status,
			reviewDecisionId: "review-decision:d459",
			code: "resolved-from-intent",
			reason: "human resolved from repair action",
			capabilityRefs: intent.capabilityRefs,
			policyRefs: intent.policyRefs,
			sourceRefs: intent.sourceRefs,
			audit: intent.audit,
		});
		expect(prepared).toMatchObject({
			status: "prepared",
			recordingInput: {
				kind: "workspace-proposal-repair-review-decision-recording-input",
				repairRequestId: fixture.request.repairRequestId,
				reviewDecisionId: "review-decision:d459",
				intent: "resolved",
			},
			issues: [],
		});
		expect(Object.keys(prepared.recordingInput ?? {}).sort()).not.toEqual(
			expect.arrayContaining(["applicationId", "proposalId", "decisionId", "idempotencyKey"]),
		);

		const mismatched = validateWorkspaceProposalRepairActionIntent(
			{ ...intent, proposalId: "other-proposal" },
			{
				descriptor,
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
			},
		);
		expect(mismatched).toMatchObject({
			status: "blocked",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "repair-action-intent-coordinate-mismatch" }),
				expect.objectContaining({ code: "repair-action-intent-descriptor-mismatch" }),
			]),
		});
		const stale = validateWorkspaceProposalRepairActionIntent(
			{ ...intent, expectedCurrentState: { state: "resolved" } },
			{
				descriptor,
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
			},
		);
		expect(stale).toMatchObject({
			status: "blocked",
			issues: [expect.objectContaining({ code: "stale-repair-review-state" })],
		});
		expect(JSON.stringify(prepared)).not.toContain("workspace-proposal-application-recorded");
		expect(JSON.stringify(prepared)).not.toContain("WorkItemCreated");
	});

	it("previews D460 successor proposal intake context without proposal truth or ids", () => {
		const fixture = repairReviewFixture();
		const status = projectWorkspaceProposalRepairReviewStatuses({ requests: [fixture.request] })[0];
		if (status === undefined) throw new Error("expected D460 status");
		const descriptor = projectWorkspaceProposalRepairActionDescriptors({
			requests: [fixture.request],
			statuses: [status],
		}).find((entry) => entry.actionKind === "open-successor-proposal-flow");
		if (descriptor === undefined) throw new Error("expected D460 descriptor");
		const unsupportedDescriptor = projectWorkspaceProposalRepairActionDescriptors({
			requests: [fixture.request],
			statuses: [status],
		}).find((entry) => entry.actionKind === "mark-human-resolved");
		if (unsupportedDescriptor === undefined) {
			throw new Error("expected D460 unsupported descriptor");
		}
		const intent = repairActionIntent(fixture.request, descriptor, {
			actionKind: "open-successor-proposal-flow",
		});
		const unsupportedIntent = repairActionIntent(fixture.request, unsupportedDescriptor, {
			actionKind: "mark-human-resolved",
		});
		const preview = projectWorkspaceProposalRepairSuccessorProposalIntakePreview(intent, {
			descriptor,
			request: fixture.request,
			currentStatus: status,
			capabilityRefs: intent.capabilityRefs,
			policyRefs: intent.policyRefs,
			policyStatus: "allowed",
			code: "open-successor",
			reason: "prepare a follow-up proposal",
			contextRefs: [{ kind: "workspace-proposal-family-outcome-index-entry", id: "index:1" }],
			suggestedDraftPatch: { summary: "Follow-up proposal context" },
			sourceRefs: [{ kind: "manual-review", id: "successor-source" }],
		});

		expect(preview).toMatchObject({
			status: "proposal-context-ready",
			repairRequestId: fixture.request.repairRequestId,
			intentId: intent.intentId,
			suggestedFamily: fixture.request.proposalFamily,
			code: "open-successor",
			diagnostics: [],
			suggestedDraftPatch: { summary: "Follow-up proposal context" },
		});
		expect(
			previewWorkspaceProposalRepairSuccessorProposalIntake(
				fixture.request,
				{
					descriptor,
					currentStatus: status,
					capabilityRefs: intent.capabilityRefs,
					policyRefs: intent.policyRefs,
					policyStatus: "allowed",
					code: "open-successor-wrapper",
				},
				intent,
			),
		).toMatchObject({
			status: "proposal-context-ready",
			diagnostics: [],
			code: "open-successor-wrapper",
		});
		expect(preview.targetRefs).toEqual(
			expect.arrayContaining([
				{ kind: "workspace-proposal-repair-review-request", id: fixture.request.repairRequestId },
			]),
		);
		const text = JSON.stringify(preview);
		expect(text).not.toContain("successorProposalId");
		expect(text).not.toContain("admissionId");
		expect(text).not.toContain("WorkItemCreated");
		expect(text).not.toContain("provider");
		expect(text).not.toContain("runtime");

		expect(
			projectWorkspaceProposalRepairSuccessorProposalIntakePreview(unsupportedIntent, {
				descriptor: unsupportedDescriptor,
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: unsupportedIntent.capabilityRefs,
				policyRefs: unsupportedIntent.policyRefs,
				policyStatus: "allowed",
			}),
		).toMatchObject({
			status: "blocked",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "unsupported-repair-action-intent" }),
			]),
		});
	});

	it("fails D463 repair action policy and non-data intake material closed without descriptor permission truth", () => {
		const fixture = repairReviewFixture();
		const status = projectWorkspaceProposalRepairReviewStatuses({ requests: [fixture.request] })[0];
		if (status === undefined) throw new Error("expected D463 status");
		const descriptor = projectWorkspaceProposalRepairActionDescriptors({
			requests: [fixture.request],
			statuses: [status],
		}).find((entry) => entry.actionKind === "mark-human-resolved");
		if (descriptor === undefined) throw new Error("expected D463 descriptor");
		const intent = repairActionIntent(fixture.request, descriptor, {
			actionKind: "mark-human-resolved",
		});

		const blocked = validateWorkspaceProposalRepairActionIntent(intent, {
			descriptor,
			request: fixture.request,
			currentStatus: status,
			policyStatus: "blocked",
			policyRefs: [{ kind: "policy", id: "repair-action:intake-policy" }],
		});
		expect(blocked).toMatchObject({
			status: "blocked",
			issues: [expect.objectContaining({ code: "blocked-repair-action-policy" })],
		});
		expect(
			validateWorkspaceProposalRepairActionIntent(intent, {
				descriptor,
				request: fixture.request,
				currentStatus: status,
				policyStatus: "allowed",
			}),
		).toMatchObject({
			status: "blocked",
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "missing-repair-action-policy-material" }),
			]),
		});
		expect(JSON.stringify(descriptor)).not.toMatch(
			/permission|policyOutcome|capabilityEvidence|runtime|provider/i,
		);

		const malformed = validateWorkspaceProposalRepairActionIntent(
			{
				...intent,
				metadata: { callback: "run-me" },
				sourceRefs: [{ kind: "source", id: "bad", metadata: { runtimeHandle: "x" } }],
			},
			{ descriptor, request: fixture.request, currentStatus: status, policyStatus: "allowed" },
		);
		expect(malformed.status).toBe("blocked");
		expect(malformed.issues.map((entry) => entry.code)).toContain("forbidden-runtime-material");
		expect(malformed.intent).toBeUndefined();
		expect(JSON.stringify(malformed)).not.toContain("run-me");
		const unsafeAuditIntent = validateWorkspaceProposalRepairActionIntent(
			{
				...intent,
				audit: {
					auditId: "audit:unsafe-intent",
					metadata: { providerHandle: "secret-audit" },
				},
			},
			{ descriptor, request: fixture.request, currentStatus: status, policyStatus: "allowed" },
		);
		expect(unsafeAuditIntent.status).toBe("blocked");
		expect(unsafeAuditIntent.audit).toBeUndefined();
		expect(JSON.stringify(unsafeAuditIntent)).not.toContain("secret-audit");

		const cyclicIntent = { ...intent } as Record<string, unknown>;
		cyclicIntent.self = cyclicIntent;
		const cyclicValidation = validateWorkspaceProposalRepairActionIntent(cyclicIntent, {
			descriptor,
			request: fixture.request,
			currentStatus: status,
			policyStatus: "allowed",
		});
		expect(cyclicValidation).toMatchObject({
			status: "blocked",
			issues: expect.arrayContaining([expect.objectContaining({ code: "cyclic-data-material" })]),
		});

		const unsafePreview = projectWorkspaceProposalRepairSuccessorProposalIntakePreview(
			{ ...intent, actionKind: "open-successor-proposal-flow" },
			{
				descriptor: { ...descriptor, actionKind: "open-successor-proposal-flow" },
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
				suggestedDraftPatch: { successorProposalId: "canonical-successor" },
			},
		);
		expect(unsafePreview).toMatchObject({
			status: "blocked",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "forbidden-successor-truth-material" }),
			]),
		});
		expect(unsafePreview.suggestedDraftPatch).toBeUndefined();
		expect(unsafePreview.metadata).toBeUndefined();
		expect(JSON.stringify(unsafePreview)).not.toContain("canonical-successor");
		const nestedTruthPreview = projectWorkspaceProposalRepairSuccessorProposalIntakePreview(
			{ ...intent, actionKind: "open-successor-proposal-flow" },
			{
				descriptor: { ...descriptor, actionKind: "open-successor-proposal-flow" },
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
				suggestedDraftPatch: { draft: { proposalRecordRef: "canonical-successor" } },
			},
		);
		expect(nestedTruthPreview).toMatchObject({
			status: "blocked",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "forbidden-successor-truth-material" }),
			]),
		});
		expect(JSON.stringify(nestedTruthPreview)).not.toContain("canonical-successor");

		const unsafeMetadataPreview = projectWorkspaceProposalRepairSuccessorProposalIntakePreview(
			{ ...intent, actionKind: "open-successor-proposal-flow" },
			{
				descriptor: { ...descriptor, actionKind: "open-successor-proposal-flow" },
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
				metadata: { providerAction: "call-network" },
			},
		);
		expect(unsafeMetadataPreview).toMatchObject({
			status: "blocked",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "forbidden-runtime-material" }),
			]),
		});
		expect(unsafeMetadataPreview.metadata).toBeUndefined();
		expect(JSON.stringify(unsafeMetadataPreview)).not.toContain("call-network");

		const cyclicPatch: Record<string, unknown> = { summary: "cyclic draft patch" };
		cyclicPatch.self = cyclicPatch;
		const cyclicPreview = projectWorkspaceProposalRepairSuccessorProposalIntakePreview(
			{ ...intent, actionKind: "open-successor-proposal-flow" },
			{
				descriptor: { ...descriptor, actionKind: "open-successor-proposal-flow" },
				request: fixture.request,
				currentStatus: status,
				capabilityRefs: intent.capabilityRefs,
				policyRefs: intent.policyRefs,
				policyStatus: "allowed",
				suggestedDraftPatch: cyclicPatch,
			},
		);
		expect(cyclicPreview).toMatchObject({
			status: "blocked",
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "cyclic-data-material" }),
			]),
		});
		expect(cyclicPreview.suggestedDraftPatch).toBeUndefined();
	});

	it("dedupes graph-visible D459 intent validation and D460 successor previews by stable identity", () => {
		const fixture = repairReviewFixture();
		const status = projectWorkspaceProposalRepairReviewStatuses({ requests: [fixture.request] })[0];
		if (status === undefined) throw new Error("expected graph D459/D460 status");
		const descriptor = projectWorkspaceProposalRepairActionDescriptors({
			requests: [fixture.request],
			statuses: [status],
		}).find((entry) => entry.actionKind === "open-successor-proposal-flow");
		if (descriptor === undefined) throw new Error("expected graph D459/D460 descriptor");
		const intentA = repairActionIntent(fixture.request, descriptor, {
			actionKind: "open-successor-proposal-flow",
		});
		const intentB = { ...intentA, intentId: "repair-action-intent:successor-b" };
		const conflictingIntentA = { ...intentA, proposalId: "conflicting-proposal" };

		const g = graph();
		const intents = g.node<WorkspaceProposalRepairActionIntent>([], null, { name: "intents" });
		const descriptors = g.node<WorkspaceProposalRepairActionDescriptor>([], null, {
			name: "descriptors",
		});
		const requests = g.node<WorkspaceProposalRepairReviewRequest>([], null, { name: "requests" });
		const statuses = g.node<typeof status>([], null, { name: "statuses" });
		const validation = workspaceProposalRepairActionIntentProjector(g, {
			intents,
			descriptors,
			requests,
			statuses,
			capabilityRefs: intentA.capabilityRefs,
			policyRefs: intentA.policyRefs,
			policyStatus: "allowed",
		});
		const previews = workspaceProposalRepairSuccessorProposalIntakePreviewProjector(g, {
			intents,
			descriptors,
			requests,
			statuses,
			capabilityRefs: intentA.capabilityRefs,
			policyRefs: intentA.policyRefs,
			policyStatus: "allowed",
		});
		const results = collectData<WorkspaceProposalRepairActionIntentValidationResult>(
			validation.results,
		);
		const previewData = collectData<WorkspaceProposalRepairSuccessorProposalIntakePreview>(
			previews.previews,
		);

		requests.down([["DATA", fixture.request]]);
		statuses.down([["DATA", status]]);
		descriptors.down([["DATA", descriptor]]);
		intents.down([["DATA", intentA]]);
		intents.down([["DATA", structuredClone(intentA)]]);
		intents.down([["DATA", intentB]]);

		expect(results.map((entry) => entry.intentId)).toEqual([intentA.intentId, intentB.intentId]);
		expect(previewData.map((entry) => entry.intentId)).toEqual([
			intentA.intentId,
			intentB.intentId,
		]);
		expect(previewData.every((entry) => entry.status === "proposal-context-ready")).toBe(true);

		intents.down([["DATA", conflictingIntentA]]);

		expect(results.at(-1)).toMatchObject({
			intentId: intentA.intentId,
			status: "blocked",
			issues: [expect.objectContaining({ code: "conflicting-repair-action-intent" })],
		});
		expect(previewData.at(-1)).toMatchObject({
			intentId: intentA.intentId,
			status: "blocked",
			diagnostics: [expect.objectContaining({ code: "conflicting-repair-action-intent" })],
		});

		const cyclicIntent = { ...intentA, intentId: "repair-action-intent:cyclic" } as Record<
			string,
			unknown
		>;
		cyclicIntent.self = cyclicIntent;
		expect(() => intents.down([["DATA", cyclicIntent]])).not.toThrow();
		expect(results.at(-1)).toMatchObject({
			intentId: "repair-action-intent:cyclic",
			status: "blocked",
			issues: [expect.objectContaining({ code: "cyclic-data-material" })],
		});
	});

	it("resolves D444 lifecycle only from matching durable proof coordinates", () => {
		const { request, appliedStatus, outcome, outcomeStatus, outcomeIndex } = repairReviewFixture();

		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				outcomeStatuses: [outcomeStatus],
			})[0],
		).toMatchObject({ state: "resolved", proofKind: "family-outcome-status" });
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				outcomeStatuses: [{ ...outcomeStatus, proposalId: "other-proposal" }],
			})[0]?.state,
		).toBe("open");
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				outcomeStatuses: [{ ...outcomeStatus, outcomeRefs: [] }],
			})[0]?.state,
		).toBe("open");

		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				outcomeIndex,
			})[0],
		).toMatchObject({ state: "resolved", proofKind: "family-outcome-index" });
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				outcomeIndex: [{ ...outcomeIndex[0], idempotencyKey: "other-idem" }],
			})[0]?.state,
		).toBe("open");

		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				applicationStatuses: [appliedStatus],
			})[0],
		).toMatchObject({ state: "resolved", proofKind: "application-status" });
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				applicationStatuses: [{ ...appliedStatus, proposalId: "other-proposal" }, appliedStatus],
			})[0],
		).toMatchObject({ state: "resolved", proofKind: "application-status" });
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				applicationStatuses: [{ ...appliedStatus, emittedFactRefs: [] }],
			})[0]?.state,
		).toBe("open");

		expect(outcome).toBeDefined();
	});

	it("does not resolve outcome-specific D444 repair requests from sibling outcomes", () => {
		const { request, appliedStatus, outcomeStatus } = repairReviewFixture();
		const repairOutcomeStatus = {
			...outcomeStatus,
			outcomeId: "repair-review-outcome-a",
			state: "repair-needed",
			outcomeRefs: [],
			issues: [
				{
					kind: "issue",
					source: "workspace-proposal",
					severity: "error",
					code: "missing-required-field",
					message: "Outcome A missing material",
					subjectId: outcomeStatus.proposalId,
					refs: [],
				},
			],
		} satisfies typeof outcomeStatus;
		const outcomeRequest = projectWorkspaceProposalRepairReviewRequests({
			applicationStatuses: [appliedStatus],
			outcomeStatuses: [repairOutcomeStatus],
		})[0];
		expect(outcomeRequest).toBeDefined();
		if (outcomeRequest === undefined) throw new Error("expected outcome repair request");

		expect(outcomeRequest.repairRequestId).not.toBe(request.repairRequestId);
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [outcomeRequest],
				applicationStatuses: [appliedStatus],
			})[0]?.state,
		).toBe("open");
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [outcomeRequest],
				outcomeStatuses: [outcomeStatus],
			})[0]?.state,
		).toBe("open");
	});

	it("joins WorkspaceProposalApplicationRecorded to matching status before D444 resolution", () => {
		const { request, appliedStatus, applicationRecorded } = repairReviewFixture();
		expect(applicationRecorded).toBeDefined();
		if (applicationRecorded === undefined) throw new Error("expected application recorded proof");

		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				applicationRecorded: [applicationRecorded],
			})[0]?.state,
		).toBe("open");
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				applicationStatuses: [appliedStatus],
				applicationRecorded: [applicationRecorded],
			})[0],
		).toMatchObject({
			state: "resolved",
			proofKind: "application-recorded",
		});
	});

	it("fails closed on incomparable D444 human terminal decision conflicts", () => {
		const { request } = repairReviewFixture();
		const resolved = repairReviewDecision(request, "resolved", "review-resolved");
		const withdrawn = repairReviewDecision(request, "withdrawn", "review-withdrawn");
		const secondResolved = repairReviewDecision(request, "resolved", "review-resolved-2");
		const supersedingWithdrawn = {
			...withdrawn,
			supersedesRefs: [
				{ kind: "workspace-proposal-repair-review-decision", id: resolved.reviewDecisionId },
			],
		} satisfies WorkspaceProposalRepairReviewDecision;

		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				decisions: [resolved, withdrawn],
			})[0],
		).toMatchObject({
			state: "conflict",
			code: "conflicting-repair-review-decisions",
			conflicts: expect.arrayContaining([
				expect.objectContaining({ reviewDecisionId: "review-resolved" }),
				expect.objectContaining({ reviewDecisionId: "review-withdrawn" }),
			]),
		});
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				decisions: [resolved, supersedingWithdrawn],
			})[0],
		).toMatchObject({
			state: "withdrawn",
			conflicts: [],
		});
		expect(
			projectWorkspaceProposalRepairReviewStatuses({
				requests: [request],
				decisions: [resolved, secondResolved],
			})[0],
		).toMatchObject({
			state: "conflict",
			code: "conflicting-repair-review-decisions",
		});
	});

	it("preserves full-coordinate candidates in graph-visible D444 lifecycle proof state", () => {
		const applicationGraph = graph();
		const applicationRequests = applicationGraph.node<WorkspaceProposalRepairReviewRequest>(
			[],
			null,
			{ name: "applicationRequests" },
		);
		const applicationStatuses = applicationGraph.node<WorkspaceProposalApplicationStatus>(
			[],
			null,
			{
				name: "applicationStatuses",
			},
		);
		const applicationProjector = workspaceProposalRepairReviewStatusProjector(applicationGraph, {
			requests: applicationRequests,
			applicationStatuses,
		});
		const applicationResults = collectData(applicationProjector.statuses);
		const fixture = repairReviewFixture();

		applicationRequests.down([["DATA", fixture.request]]);
		applicationStatuses.down([["DATA", fixture.appliedStatus]]);
		applicationStatuses.down([
			["DATA", { ...fixture.appliedStatus, proposalId: "other-proposal" }],
		]);

		expect(applicationResults.map((status) => status.state)).toEqual(["open", "resolved"]);
		expect(applicationResults.at(-1)).toMatchObject({
			state: "resolved",
			proofKind: "application-status",
		});

		const outcomeGraph = graph();
		const outcomeRequests = outcomeGraph.node<WorkspaceProposalRepairReviewRequest>([], null, {
			name: "outcomeRequests",
		});
		const outcomeStatuses = outcomeGraph.node<typeof fixture.outcomeStatus>([], null, {
			name: "outcomeStatuses",
		});
		const outcomeProjector = workspaceProposalRepairReviewStatusProjector(outcomeGraph, {
			requests: outcomeRequests,
			outcomeStatuses,
		});
		const outcomeResults = collectData(outcomeProjector.statuses);

		outcomeRequests.down([["DATA", fixture.request]]);
		outcomeStatuses.down([["DATA", fixture.outcomeStatus]]);
		outcomeStatuses.down([["DATA", { ...fixture.outcomeStatus, proposalId: "other-proposal" }]]);

		expect(outcomeResults.map((status) => status.state)).toEqual(["open", "resolved"]);
		expect(outcomeResults.at(-1)).toMatchObject({
			state: "resolved",
			proofKind: "family-outcome-status",
		});
	});

	it("dedupes graph-visible D444 repair-review lifecycle emissions on replay", () => {
		const g = graph();
		const requests = g.node<WorkspaceProposalRepairReviewRequest>([], null, { name: "requests" });
		const decisions = g.node<WorkspaceProposalRepairReviewDecision>([], null, {
			name: "decisions",
		});
		const durableStatuses = g.node<ReturnType<typeof repairReviewFixture>["outcomeStatus"]>(
			[],
			null,
			{ name: "outcomeStatuses" },
		);
		const projector = workspaceProposalRepairReviewStatusProjector(g, {
			requests,
			decisions,
			outcomeStatuses: durableStatuses,
		});
		const statuses = collectData(projector.statuses);
		const fixture = repairReviewFixture();
		const acknowledged = repairReviewDecision(fixture.request, "acknowledged", "review-ack");
		const acknowledgedWithReason = {
			...acknowledged,
			reason: "looked-at-by-human",
		} satisfies WorkspaceProposalRepairReviewDecision;

		requests.down([["DATA", fixture.request]]);
		requests.down([["DATA", fixture.request]]);
		decisions.down([["DATA", acknowledged]]);
		decisions.down([["DATA", acknowledged]]);
		decisions.down([["DATA", acknowledgedWithReason]]);
		durableStatuses.down([["DATA", fixture.outcomeStatus]]);
		durableStatuses.down([["DATA", fixture.outcomeStatus]]);

		expect(statuses.map((status) => status.state)).toEqual([
			"open",
			"acknowledged",
			"acknowledged",
			"resolved",
		]);
		expect(statuses[2]?.decisions[0]?.reason).toBe("looked-at-by-human");
	});

	it("composes D445 Canvas read-model handoff from projected material only", () => {
		const { request, outcome, outcomeIndex, outcomeStatus } = repairReviewFixture();
		const readModelCoordinates = repairReviewReadModelCoordinates(request);
		expect(outcome).toBeDefined();
		if (outcome === undefined) throw new Error("expected outcome detail");
		const repairStatus = projectWorkspaceProposalRepairReviewStatuses({
			requests: [request],
			outcomeStatuses: [outcomeStatus],
		})[0];
		const rawIssueOnly = projectWorkspaceProposalFamilyApplicationReadModel({
			...({
				issues: [
					{
						kind: "issue",
						source: "workspace-proposal",
						severity: "error",
						code: "missing-domain-action-facts",
						message: "raw issue must not be classified by read-model",
						subjectId: request.proposalId,
					},
				],
			} as Record<string, unknown>),
			applicationId: request.applicationId,
		});
		expect(rawIssueOnly.diagnostics).toEqual([]);
		expect(rawIssueOnly.repairReviewStatuses).toEqual([]);

		const diagnostic = projectWorkspaceProposalFamilyApplicationDiagnostics({
			outcomeStatuses: [
				{
					...outcomeStatus,
					state: "repair-needed",
					outcomeRefs: [],
					issues: [
						{
							kind: "issue",
							source: "workspace-proposal",
							severity: "error",
							code: "missing-required-field",
							message: "Outcome detail missing",
							subjectId: request.proposalId,
							refs: [],
						},
					],
				},
			],
		})[0];
		const readModel = projectWorkspaceProposalFamilyApplicationReadModel({
			...readModelCoordinates,
			diagnostics: diagnostic === undefined ? [] : [diagnostic],
			repairReviewStatuses: repairStatus === undefined ? [] : [repairStatus],
			outcomeIndex,
			outcomeStatuses: [outcomeStatus],
			outcomes: [outcome],
			limit: 1,
		});

		expect(readModel).toMatchObject({
			kind: "workspace-proposal-family-application-read-model",
			applicationId: request.applicationId,
			diagnostics: diagnostic === undefined ? [] : [diagnostic],
			repairReviewStatuses: repairStatus === undefined ? [] : [repairStatus],
			page: { offset: 0, limit: 1, totalOutcomeRefs: 1, returnedOutcomeRefs: 1 },
			displayDiagnostics: [],
		});
		expect(readModel.outcomeIndexes[0]?.outcomeRefs[0]).toMatchObject({
			kind: "workspace-proposal-family-outcome-ref",
			outcomeId: outcome.outcomeId,
		});
		expect(readModel.outcomeDetails[0]).toMatchObject({
			outcomeRef: expect.objectContaining({ outcomeId: outcome.outcomeId }),
			outcome: expect.objectContaining({ outcomeId: outcome.outcomeId }),
			status: expect.objectContaining({ outcomeId: outcome.outcomeId }),
		});
		const collision = projectWorkspaceProposalFamilyApplicationReadModel({
			...readModelCoordinates,
			outcomeIndex,
			outcomes: [{ ...outcome, proposalId: "other-proposal" }, outcome],
			outcomeStatuses: [{ ...outcomeStatus, proposalId: "other-proposal" }, outcomeStatus],
		});
		expect(collision.displayDiagnostics).toEqual([]);
		expect(collision.outcomeDetails[0]).toMatchObject({
			outcome: expect.objectContaining({ proposalId: request.proposalId }),
			status: expect.objectContaining({ proposalId: request.proposalId }),
		});
		const wrongKindOutcomeIndex = [
			{
				...outcomeIndex[0]!,
				outcomeRefs: [
					{
						...outcomeIndex[0]!.outcomeRefs[0]!,
						outcomeKind: "workspace-proposal-work-item-spawn-outcome-recorded",
					},
				],
			},
		] satisfies typeof outcomeIndex;
		const wrongKind = projectWorkspaceProposalFamilyApplicationReadModel({
			...readModelCoordinates,
			outcomeIndex: wrongKindOutcomeIndex,
			outcomes: [outcome],
			outcomeStatuses: [outcomeStatus],
		});
		expect(wrongKind.displayDiagnostics.map((entry) => entry.code)).toEqual([
			"mismatched-outcome-detail",
			"mismatched-outcome-status",
		]);
		expect(wrongKind.outcomeDetails[0]?.outcome).toBeUndefined();
		expect(wrongKind.outcomeDetails[0]?.status).toBeUndefined();

		const mismatched = projectWorkspaceProposalFamilyApplicationReadModel({
			...readModelCoordinates,
			outcomeIndex,
			outcomes: [{ ...outcome, proposalId: "other-proposal" }],
		});
		expect(mismatched.displayDiagnostics.map((entry) => entry.code)).toEqual([
			"mismatched-outcome-detail",
		]);
		const missing = projectWorkspaceProposalFamilyApplicationReadModel({
			...readModelCoordinates,
			outcomeIndex,
		});
		expect(missing.displayDiagnostics.map((entry) => entry.code)).toEqual([
			"missing-outcome-detail",
		]);
		const secondPage = projectWorkspaceProposalFamilyApplicationReadModel({
			...readModelCoordinates,
			outcomeIndex,
			offset: 1,
			limit: 1,
		});
		expect(secondPage.readModelId).not.toBe(readModel.readModelId);
		const partialCoordinates = projectWorkspaceProposalFamilyApplicationReadModel({
			applicationId: request.applicationId,
			diagnostics: diagnostic === undefined ? [] : [diagnostic],
			repairReviewStatuses: repairStatus === undefined ? [] : [repairStatus],
			outcomeIndex,
			outcomeStatuses: [outcomeStatus],
			outcomes: [outcome],
		});
		expect(partialCoordinates).toMatchObject({
			diagnostics: [],
			repairReviewStatuses: [],
			outcomeIndexes: [],
			outcomeDetails: [],
		});
	});

	it("exposes graph-visible D445 read-model projection without raw classification", () => {
		const g = graph();
		const diagnostics = g.node<
			ReturnType<typeof projectWorkspaceProposalFamilyApplicationDiagnostics>[number]
		>([], null, { name: "diagnostics" });
		const repairStatuses = g.node<
			ReturnType<typeof projectWorkspaceProposalRepairReviewStatuses>[number]
		>([], null, { name: "repairStatuses" });
		const outcomeIndex = g.node<
			ReturnType<typeof projectWorkspaceProposalFamilyOutcomeIndex>[number]
		>([], null, { name: "outcomeIndex" });
		const outcomeStatuses = g.node<ReturnType<typeof repairReviewFixture>["outcomeStatus"]>(
			[],
			null,
			{ name: "outcomeStatuses" },
		);
		const outcomes = g.node<NonNullable<ReturnType<typeof repairReviewFixture>["outcome"]>>(
			[],
			null,
			{ name: "outcomes" },
		);
		const fixture = repairReviewFixture();
		const readModelCoordinates = repairReviewReadModelCoordinates(fixture.request);
		const repairStatus = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			outcomeStatuses: [fixture.outcomeStatus],
		})[0];
		const projector = workspaceProposalFamilyApplicationReadModelProjector(g, {
			diagnostics,
			repairReviewStatuses: repairStatuses,
			outcomeIndex,
			outcomeStatuses,
			outcomes,
			...readModelCoordinates,
			limit: 1,
		});
		const readModels = collectData(projector.readModels);

		if (repairStatus !== undefined) repairStatuses.down([["DATA", repairStatus]]);
		outcomeIndex.down([["DATA", fixture.outcomeIndex[0]]]);
		outcomeStatuses.down([["DATA", fixture.outcomeStatus]]);
		if (fixture.outcome !== undefined) {
			outcomes.down([["DATA", fixture.outcome]]);
			outcomeStatuses.down([["DATA", { ...fixture.outcomeStatus, proposalId: "other-proposal" }]]);
			outcomes.down([["DATA", { ...fixture.outcome, proposalId: "other-proposal" }]]);
		}

		expect(readModels.at(-1)).toMatchObject({
			applicationId: fixture.request.applicationId,
			repairReviewStatuses: repairStatus === undefined ? [] : [repairStatus],
			displayDiagnostics: [],
		});
		expect(readModels.at(-1)?.outcomeDetails[0]).toMatchObject({
			outcome: expect.objectContaining({ proposalId: fixture.request.proposalId }),
			status: expect.objectContaining({ proposalId: fixture.request.proposalId }),
		});
	});

	it("projects D448 query-driven read-model pages without query-side classification authority", () => {
		const fixture = repairReviewFixture();
		const coordinates = repairReviewReadModelCoordinates(fixture.request);
		const repairStatus = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			outcomeStatuses: [fixture.outcomeStatus],
		})[0];
		const diagnosticSourceStatus = {
			...fixture.outcomeStatus,
			state: "repair-needed",
			outcomeRefs: [],
			issues: [
				{
					kind: "issue",
					source: "workspace-proposal",
					severity: "error",
					code: "missing-required-field",
					message: "Outcome detail missing",
					subjectId: fixture.request.proposalId,
					refs: [],
				},
			],
		} satisfies typeof fixture.outcomeStatus;
		const diagnostic = projectWorkspaceProposalFamilyApplicationDiagnostics({
			outcomeStatuses: [diagnosticSourceStatus],
		})[0];
		if (diagnostic === undefined) throw new Error("expected D448 diagnostic fixture");
		if (repairStatus === undefined) throw new Error("expected D448 repair status fixture");
		const query = readModelQuery("query-complete", coordinates);
		const readModel = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [query],
			diagnostics: [diagnostic],
			repairReviewStatuses: [repairStatus],
			outcomeIndex: fixture.outcomeIndex,
			outcomeStatuses: [fixture.outcomeStatus],
			outcomes: [fixture.outcome],
		})[0];

		expect(readModel).toMatchObject({
			queryId: "query-complete",
			viewId: "view-query-complete",
			...coordinates,
			diagnostics: [diagnostic],
			repairReviewStatuses: [repairStatus],
			displayDiagnostics: [],
			page: { offset: 0, limit: 50, totalOutcomeRefs: 1, returnedOutcomeRefs: 1 },
		});
		expect(readModel?.outcomeDetails[0]).toMatchObject({
			outcome: expect.objectContaining({ outcomeId: fixture.outcome.outcomeId }),
			status: expect.objectContaining({ outcomeId: fixture.outcome.outcomeId }),
		});

		const incomplete = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [
				{
					kind: "workspace-proposal-family-application-read-model-query",
					queryId: "query-incomplete",
					viewId: "view-incomplete",
					applicationId: coordinates.applicationId,
					proposalId: coordinates.proposalId,
					idempotencyKey: coordinates.idempotencyKey,
					proposalFamily: coordinates.proposalFamily,
					page: { offset: -10, limit: 999 },
					sourceRefs: [sourceRef],
				} as WorkspaceProposalFamilyApplicationReadModelQuery,
			],
			diagnostics: [diagnostic],
			repairReviewStatuses: [repairStatus],
			outcomeIndex: fixture.outcomeIndex,
			outcomeStatuses: [fixture.outcomeStatus],
			outcomes: [fixture.outcome],
		})[0];
		expect(incomplete).toMatchObject({
			queryId: "query-incomplete",
			viewId: "view-incomplete",
			diagnostics: [],
			repairReviewStatuses: [],
			outcomeIndexes: [],
			outcomeDetails: [],
			page: { offset: 0, limit: 100, totalOutcomeRefs: 0, returnedOutcomeRefs: 0 },
		});
		expect(incomplete?.displayDiagnostics.map((entry) => entry.code)).toEqual([
			"incomplete-read-model-query",
		]);

		const rawIssueQuery = {
			...query,
			queryId: "query-raw-issue",
			rawIssues: [
				{
					code: "missing-domain-action-facts",
					message: "query descriptors must not classify this",
				},
			],
		} as WorkspaceProposalFamilyApplicationReadModelQuery;
		const rawIssueOnly = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [rawIssueQuery],
		})[0];
		expect(rawIssueOnly?.diagnostics).toEqual([]);
		expect(rawIssueOnly?.repairReviewStatuses).toEqual([]);

		const forbiddenMaterial = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [
				{
					...query,
					queryId: "query-forbidden-material",
					metadata: { callback: "doRepair" },
					sourceRefs: [
						{ kind: "source", id: "safe" },
						{ kind: "source", id: "bad", metadata: { providerClient: "x" } },
					],
				},
			],
			diagnostics: [diagnostic],
			repairReviewStatuses: [repairStatus],
			outcomeIndex: fixture.outcomeIndex,
			outcomeStatuses: [fixture.outcomeStatus],
			outcomes: [fixture.outcome],
		})[0];
		expect(forbiddenMaterial).toMatchObject({
			queryId: "query-forbidden-material",
			diagnostics: [],
			repairReviewStatuses: [],
			outcomeIndexes: [],
			outcomeDetails: [],
		});
		expect(forbiddenMaterial?.displayDiagnostics.map((entry) => entry.code)).toEqual([
			"malformed-read-model-query",
		]);
		expect(forbiddenMaterial?.displayDiagnostics[0]?.sourceRefs).toEqual([
			{ kind: "source", id: "safe" },
		]);
	});

	it("normalizes D448 page/filter identity and narrows only projected material", () => {
		const fixture = repairReviewFixture();
		const coordinates = repairReviewReadModelCoordinates(fixture.request);
		const secondOutcome = recordWorkspaceProposalWorkItemLinkOutcome(fixture.appliedStatus, {
			outcomeId: "repair-review-outcome-2",
			linkRef: { kind: "work-item-link", id: "link-2" },
		}).outcome;
		if (secondOutcome === undefined) throw new Error("expected second D448 outcome");
		const outcomeIndex = projectWorkspaceProposalFamilyOutcomeIndex([secondOutcome]);
		const diagnosticA = {
			kind: "workspace-proposal-family-application-diagnostic",
			diagnosticId: "diagnostic-a",
			classification: "missing-family-material",
			...coordinates,
			code: "diagnostic-a",
			issues: [],
			sourceRefs: [sourceRef],
		} as const;
		const diagnosticB = { ...diagnosticA, diagnosticId: "diagnostic-b", code: "diagnostic-b" };
		const openStatus = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
		})[0];
		const resolvedStatus = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			outcomeStatuses: [fixture.outcomeStatus],
		})[0];
		if (openStatus === undefined || resolvedStatus === undefined) {
			throw new Error("expected D448 repair statuses");
		}
		const filtered = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [
				readModelQuery("query-filtered", coordinates, {
					page: { offset: -1, limit: 999 },
					filters: {
						outcomeIds: [secondOutcome.outcomeId],
						outcomeKinds: [secondOutcome.kind],
						diagnosticCodes: ["diagnostic-b"],
						repairStates: ["open"],
					},
				}),
			],
			diagnostics: [diagnosticA, diagnosticB],
			repairReviewStatuses: [openStatus, resolvedStatus],
			outcomeIndex,
			outcomes: [fixture.outcome, secondOutcome],
		})[0];

		expect(filtered).toMatchObject({
			filters: {
				outcomeIds: [secondOutcome.outcomeId],
				outcomeKinds: [secondOutcome.kind],
				diagnosticCodes: ["diagnostic-b"],
				repairStates: ["open"],
			},
			page: { offset: 0, limit: 100, totalOutcomeRefs: 1, returnedOutcomeRefs: 1 },
		});
		expect(filtered?.diagnostics.map((entry) => entry.code)).toEqual(["diagnostic-b"]);
		expect(filtered?.repairReviewStatuses.map((entry) => entry.state)).toEqual(["open"]);
		expect(filtered?.outcomeDetails.map((entry) => entry.outcomeRef.outcomeId)).toEqual([
			secondOutcome.outcomeId,
		]);
		expect(filtered?.readModelId).not.toBe(
			projectWorkspaceProposalFamilyApplicationReadModels({
				queries: [readModelQuery("query-filtered", coordinates, { page: { offset: 1, limit: 1 } })],
				outcomeIndex,
			})[0]?.readModelId,
		);
		const invalidClosedFilters = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [
				readModelQuery("query-invalid-closed-filters", coordinates, {
					filters: {
						outcomeKinds: ["not-an-outcome-kind"] as readonly never[],
						repairStates: ["retry-now"] as readonly never[],
					},
				}),
			],
			diagnostics: [diagnosticA, diagnosticB],
			repairReviewStatuses: [openStatus, resolvedStatus],
			outcomeIndex,
			outcomes: [fixture.outcome, secondOutcome],
		})[0];
		expect(invalidClosedFilters).toMatchObject({
			queryId: "query-invalid-closed-filters",
			diagnostics: [],
			repairReviewStatuses: [],
			outcomeIndexes: [],
			outcomeDetails: [],
		});
		expect(invalidClosedFilters?.displayDiagnostics.map((entry) => entry.code)).toEqual([
			"malformed-read-model-query",
		]);
		const pureCurrentView = projectWorkspaceProposalFamilyApplicationReadModels({
			queries: [
				{
					...readModelQuery("query-pure-a", coordinates, { page: { offset: 0, limit: 1 } }),
					viewId: "shared-pure-view",
				},
				{
					...readModelQuery("query-pure-b", coordinates, { page: { offset: 1, limit: 1 } }),
					viewId: "shared-pure-view",
				},
			],
			outcomeIndex,
		});
		expect(pureCurrentView).toHaveLength(1);
		expect(pureCurrentView[0]).toMatchObject({
			queryId: "query-pure-b",
			page: { offset: 1, limit: 1 },
		});
	});

	it("preserves graph-visible D448 query/view pages and dedupes normalized replay", () => {
		const g = graph();
		const queries = g.node<WorkspaceProposalFamilyApplicationReadModelQuery>([], null, {
			name: "queries",
		});
		const outcomeIndex = g.node<
			ReturnType<typeof projectWorkspaceProposalFamilyOutcomeIndex>[number]
		>([], null, { name: "outcomeIndex" });
		const outcomes = g.node<NonNullable<ReturnType<typeof repairReviewFixture>["outcome"]>>(
			[],
			null,
			{ name: "outcomes" },
		);
		const projector = workspaceProposalFamilyApplicationReadModelsProjector(g, {
			queries,
			outcomeIndex,
			outcomes,
		});
		const readModels = collectData(projector.readModels);
		const fixture = repairReviewFixture();
		const coordinates = repairReviewReadModelCoordinates(fixture.request);
		const secondOutcome = recordWorkspaceProposalWorkItemLinkOutcome(fixture.appliedStatus, {
			outcomeId: "repair-review-outcome-graph-2",
			linkRef: { kind: "work-item-link", id: "link-2" },
		}).outcome;
		if (secondOutcome === undefined) throw new Error("expected graph D448 second outcome");
		const index = projectWorkspaceProposalFamilyOutcomeIndex([fixture.outcome, secondOutcome])[0];
		if (index === undefined) throw new Error("expected graph D448 outcome index");

		outcomeIndex.down([["DATA", index]]);
		outcomes.down([["DATA", fixture.outcome]]);
		outcomes.down([["DATA", secondOutcome]]);
		queries.down([
			["DATA", readModelQuery("query-page-a", coordinates, { page: { offset: -1, limit: 999 } })],
		]);
		queries.down([
			["DATA", readModelQuery("query-page-a", coordinates, { page: { offset: 0, limit: 100 } })],
		]);
		queries.down([
			["DATA", readModelQuery("query-page-b", coordinates, { page: { offset: 1, limit: 1 } })],
		]);

		expect(readModels.map((entry) => entry.queryId)).toEqual(["query-page-a", "query-page-b"]);
		expect(readModels[0]?.page).toMatchObject({ offset: 0, limit: 100 });
		expect(readModels[1]?.page).toMatchObject({ offset: 1, limit: 1 });
		expect(readModels[0]?.readModelId).not.toBe(readModels[1]?.readModelId);

		const sameViewA = {
			...readModelQuery("query-same-view-a", coordinates, { page: { offset: 0, limit: 1 } }),
			viewId: "shared-current-view",
		};
		const sameViewB = {
			...readModelQuery("query-same-view-b", coordinates, { page: { offset: 1, limit: 1 } }),
			viewId: "shared-current-view",
		};
		queries.down([["DATA", sameViewA]]);
		queries.down([["DATA", sameViewB]]);
		queries.down([["DATA", sameViewA]]);

		expect(readModels.slice(2).map((entry) => entry.queryId)).toEqual([
			"query-same-view-a",
			"query-same-view-b",
			"query-same-view-a",
		]);
	});

	it("projects D449 repair action descriptors as non-executable affordances", () => {
		const fixture = repairReviewFixture();
		const open = projectWorkspaceProposalRepairReviewStatuses({ requests: [fixture.request] })[0];
		const acknowledged = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			decisions: [repairReviewDecision(fixture.request, "acknowledged", "review-ack-d449")],
		})[0];
		const resolved = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			decisions: [repairReviewDecision(fixture.request, "resolved", "review-resolved-d449")],
		})[0];
		const withdrawn = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			decisions: [repairReviewDecision(fixture.request, "withdrawn", "review-withdrawn-d449")],
		})[0];
		const superseded = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			decisions: [repairReviewDecision(fixture.request, "superseded", "review-superseded-d449")],
		})[0];
		const conflict = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			decisions: [
				repairReviewDecision(fixture.request, "resolved", "review-conflict-resolved"),
				repairReviewDecision(fixture.request, "withdrawn", "review-conflict-withdrawn"),
			],
		})[0];

		for (const status of [open, acknowledged, conflict, resolved, withdrawn, superseded]) {
			if (status === undefined) throw new Error("expected D449 status fixture");
			const descriptors = projectWorkspaceProposalRepairActionDescriptors({
				requests: [fixture.request],
				statuses: [status],
			});
			expect(descriptors.map((entry) => entry.actionKind).sort()).toEqual([
				"acknowledge-review",
				"mark-human-resolved",
				"open-successor-proposal-flow",
				"supersede-review",
				"withdraw-review",
			]);
			for (const descriptor of descriptors) {
				expect(descriptor).toMatchObject({
					kind: "workspace-proposal-repair-action-descriptor",
					repairRequestId: fixture.request.repairRequestId,
					repairState: status.state,
					applicationId: fixture.request.applicationId,
					proposalId: fixture.request.proposalId,
					decisionId: fixture.request.decisionId,
					idempotencyKey: fixture.request.idempotencyKey,
					proposalFamily: fixture.request.proposalFamily,
				});
				expectForbiddenDescriptorKeys(descriptor);
			}
		}

		const acknowledgedDescriptors = projectWorkspaceProposalRepairActionDescriptors({
			requests: [fixture.request],
			statuses: [acknowledged!],
		});
		expect(
			acknowledgedDescriptors.find((entry) => entry.actionKind === "acknowledge-review"),
		).toMatchObject({
			enabled: false,
			disabledCode: "repair-review-already-acknowledged",
		});
		expect(
			acknowledgedDescriptors.find((entry) => entry.actionKind === "withdraw-review"),
		).toMatchObject({ enabled: true });
		for (const terminal of [resolved!, withdrawn!, superseded!]) {
			expect(
				projectWorkspaceProposalRepairActionDescriptors({
					requests: [fixture.request],
					statuses: [terminal],
				}).every(
					(descriptor) =>
						descriptor.enabled === false && descriptor.disabledCode === "repair-review-terminal",
				),
			).toBe(true);
		}
		expect(
			projectWorkspaceProposalRepairActionDescriptors({
				requests: [fixture.request],
				statuses: [conflict!],
			}).every(
				(descriptor) =>
					descriptor.enabled === false && descriptor.disabledCode === "repair-review-conflict",
			),
		).toBe(true);
		const mismatchedStatus = { ...resolved!, proposalId: "other-proposal" };
		expect(
			projectWorkspaceProposalRepairActionDescriptors({
				requests: [fixture.request],
				statuses: [mismatchedStatus],
			}).every((descriptor) => descriptor.repairState === "open" && descriptor.enabled),
		).toBe(true);
		expect(
			projectWorkspaceProposalRepairActionDescriptors({
				requests: [fixture.request],
				statuses: [resolved!, mismatchedStatus],
			}).every(
				(descriptor) =>
					descriptor.repairState === "resolved" &&
					descriptor.enabled === false &&
					descriptor.disabledCode === "repair-review-terminal",
			),
		).toBe(true);
		const toxicRequest = {
			...fixture.request,
			sourceRefs: [
				sourceRef,
				{ kind: "source", id: "bad-request-ref", metadata: { providerClient: "x" } },
			],
			audit: {
				auditId: "audit:d449-toxic-request",
				sourceRefs: [{ kind: "source", id: "bad-audit-ref", metadata: { callback: "x" } }],
				metadata: { callback: "x" },
			},
		};
		const toxicStatus = {
			...acknowledged!,
			sourceRefs: [
				{ kind: "manual-review", id: "safe-status-ref" },
				{ kind: "source", id: "bad-status-ref", metadata: { runtimeHandle: "x" } },
			],
			audit: {
				auditId: "audit:d449-toxic-status",
				sourceRefs: [{ kind: "manual-review", id: "safe-status-audit-ref" }],
				metadata: { providerClient: "x" },
			},
		};
		const toxicDescriptor = projectWorkspaceProposalRepairActionDescriptors({
			requests: [toxicRequest],
			statuses: [toxicStatus],
		})[0];
		expect(toxicDescriptor).toMatchObject({
			sourceRefs: expect.arrayContaining([
				sourceRef,
				{ kind: "manual-review", id: "safe-status-ref" },
				{ kind: "workspace-proposal-repair-review-status", id: fixture.request.repairRequestId },
			]),
		});
		expect(toxicDescriptor?.audit).toBeUndefined();
		expectForbiddenDescriptorKeys(toxicDescriptor);

		const reviewDescriptor = acknowledgedDescriptors.find(
			(entry) => entry.actionKind === "mark-human-resolved",
		);
		if (reviewDescriptor === undefined) throw new Error("expected D449 review descriptor");
		const recorded = recordWorkspaceProposalRepairReviewDecision(fixture.request, {
			reviewDecisionId: "review-from-descriptor",
			intent: "resolved",
			reviewerRef: { kind: "actor", id: "reviewer:d449" },
			policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
			sourceRefs: reviewDescriptor.sourceRefs,
			audit: {
				auditId: "audit:review-from-descriptor",
				actorId: "actor:d449",
				sourceRefs: reviewDescriptor.sourceRefs,
			},
			code: "resolved-from-review-descriptor",
			metadata: reviewDescriptor.metadata,
		});
		expect(recorded.status).toBe("recorded");
		expect(recorded.decision).toMatchObject({
			reviewDecisionId: "review-from-descriptor",
			repairRequestId: fixture.request.repairRequestId,
			intent: "resolved",
			sourceRefs: expect.arrayContaining(reviewDescriptor.sourceRefs),
			metadata: reviewDescriptor.metadata,
		});
	});

	it("exposes graph-visible D449 repair action descriptors without mutation payloads", () => {
		const g = graph();
		const requests = g.node<WorkspaceProposalRepairReviewRequest>([], null, { name: "requests" });
		const statuses = g.node<
			ReturnType<typeof projectWorkspaceProposalRepairReviewStatuses>[number]
		>([], null, { name: "statuses" });
		const projector = workspaceProposalRepairActionDescriptorProjector(g, {
			requests,
			statuses,
		});
		const descriptors = collectData<WorkspaceProposalRepairActionDescriptor>(projector.descriptors);
		const fixture = repairReviewFixture();
		const resolved = projectWorkspaceProposalRepairReviewStatuses({
			requests: [fixture.request],
			outcomeStatuses: [fixture.outcomeStatus],
		})[0];
		if (resolved === undefined) throw new Error("expected D449 resolved status");

		requests.down([["DATA", fixture.request]]);
		statuses.down([["DATA", resolved]]);
		statuses.down([["DATA", { ...resolved, proposalId: "other-proposal" }]]);

		expect(descriptors).toHaveLength(10);
		expect(descriptors.slice(0, 5).every((descriptor) => descriptor.repairState === "open")).toBe(
			true,
		);
		expect(
			descriptors
				.slice(5)
				.every(
					(descriptor) =>
						descriptor.repairState === "resolved" &&
						descriptor.enabled === false &&
						descriptor.disabledCode === "repair-review-terminal",
				),
		).toBe(true);
		for (const descriptor of descriptors) expectForbiddenDescriptorKeys(descriptor);
	});
});

function requiredInputProjectorHarness() {
	const g = graph();
	const records = g.node<WorkspaceProposalRecorded<RequiredInputResponseProposed<string>>>(
		[],
		null,
		{
			name: "records",
		},
	);
	const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
	const contexts = g.node<WorkspaceProposalRequiredInputResponseApplicationContext>([], null, {
		name: "contexts",
	});
	const gates = g.node<RequiredInputGate>([], null, { name: "gates" });
	const bundle = workspaceProposalRequiredInputResponseApplicationProjector(g, {
		records,
		decisions,
		contexts,
		gates,
	});
	const diagnostics = workspaceProposalFamilyApplicationDiagnosticProjector(g, {
		issues: bundle.issues,
		audit: bundle.audit,
		applicationStatuses: bundle.status,
	});
	const repair = workspaceProposalRepairReviewProjector(g, {
		applicationStatuses: bundle.status,
	});
	return {
		records,
		decisions,
		contexts,
		gates,
		status: collectData(bundle.status),
		recorded: collectData(bundle.recorded),
		issues: collectData(bundle.issues),
		audit: collectData(bundle.audit),
		diagnostics: collectData(diagnostics.diagnostics),
		repairRequests: collectData(repair.requests),
		familyTruth: collectData(bundle.applied),
	};
}

function spawnProjectorHarness() {
	const g = graph();
	const records = g.node<WorkspaceProposalRecorded<WorkItemSpawnProposed>>([], null, {
		name: "records",
	});
	const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
	const contexts = g.node<WorkspaceProposalWorkItemSpawnApplicationContext>([], null, {
		name: "contexts",
	});
	const bundle = workspaceProposalWorkItemSpawnApplicationProjector(g, {
		records,
		decisions,
		contexts,
	});
	const diagnostics = workspaceProposalFamilyApplicationDiagnosticProjector(g, {
		issues: bundle.issues,
		audit: bundle.audit,
		applicationStatuses: bundle.status,
	});
	const repair = workspaceProposalRepairReviewProjector(g, {
		applicationStatuses: bundle.status,
	});
	const familyTruth = collectDataFromNodes(bundle.created, bundle.linked);
	return {
		records,
		decisions,
		contexts,
		status: collectData(bundle.status),
		recorded: collectData(bundle.recorded),
		issues: collectData(bundle.issues),
		audit: collectData(bundle.audit),
		diagnostics: collectData(diagnostics.diagnostics),
		repairRequests: collectData(repair.requests),
		familyTruth,
	};
}

function linkProjectorHarness() {
	const g = graph();
	const records = g.node<WorkspaceProposalRecorded<ReturnType<typeof linkDraft>>>([], null, {
		name: "records",
	});
	const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
	const contexts = g.node<WorkspaceProposalWorkItemLinkApplicationContext>([], null, {
		name: "contexts",
	});
	const bundle = workspaceProposalWorkItemLinkApplicationProjector(g, {
		records,
		decisions,
		contexts,
	});
	const diagnostics = workspaceProposalFamilyApplicationDiagnosticProjector(g, {
		issues: bundle.issues,
		audit: bundle.audit,
		applicationStatuses: bundle.status,
	});
	const repair = workspaceProposalRepairReviewProjector(g, {
		applicationStatuses: bundle.status,
	});
	const familyTruth = collectDataFromNodes(bundle.linked, bundle.unlinked);
	return {
		records,
		decisions,
		contexts,
		status: collectData(bundle.status),
		recorded: collectData(bundle.recorded),
		issues: collectData(bundle.issues),
		audit: collectData(bundle.audit),
		diagnostics: collectData(diagnostics.diagnostics),
		repairRequests: collectData(repair.requests),
		familyTruth,
	};
}

function domainActionProjectorHarness() {
	const g = graph();
	const records = g.node<WorkspaceProposalRecorded>([], null, { name: "records" });
	const decisions = g.node<WorkspaceProposalAdmissionDecision>([], null, { name: "decisions" });
	const contexts = g.node<WorkspaceProposalDomainActionApplicationContext>([], null, {
		name: "contexts",
	});
	const emittedFacts = g.node<WorkItemAuthoringFact>([], null, { name: "domainFacts" });
	const bundle = workspaceProposalDomainActionApplicationProjector(g, {
		records,
		decisions,
		contexts,
		emittedFacts,
	});
	const diagnostics = workspaceProposalFamilyApplicationDiagnosticProjector(g, {
		issues: bundle.issues,
		audit: bundle.audit,
		applicationStatuses: bundle.status,
	});
	const repair = workspaceProposalRepairReviewProjector(g, {
		applicationStatuses: bundle.status,
	});
	return {
		records,
		decisions,
		contexts,
		emittedFacts,
		status: collectData(bundle.status),
		recorded: collectData(bundle.recorded),
		issues: collectData(bundle.issues),
		audit: collectData(bundle.audit),
		diagnostics: collectData(diagnostics.diagnostics),
		repairRequests: collectData(repair.requests),
		familyTruth: [] as unknown[],
	};
}

function proposalRecord<TDraft>(
	family: WorkspaceProposalFamily,
	draft: TDraft,
): WorkspaceProposalRecorded<TDraft> {
	const result = recordWorkspaceProposal(readyRequest(family, draft));
	expect(result.issues).toEqual([]);
	expect(result.record).toBeDefined();
	return result.record as WorkspaceProposalRecorded<TDraft>;
}

function proposalRecordWithProposalId<TDraft>(
	family: WorkspaceProposalFamily,
	draft: TDraft,
	proposalId: string,
): WorkspaceProposalRecorded<TDraft> {
	const result = recordWorkspaceProposal({
		...readyRequest(family, draft),
		proposalId,
		intakeRequestId: `${proposalId}:intake`,
	});
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

function admittedDecisionWithId(
	record: WorkspaceProposalRecorded,
	decisionId: string,
): WorkspaceProposalAdmissionDecision {
	const result = decideWorkspaceProposalAdmission(record, {
		...admissionMaterial(record.proposalFamily),
		decisionId,
	});
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

function repairReviewFixture() {
	const record = proposalRecord("work-item-link", linkDraft());
	const decision = admittedDecision(record);
	const application = projectWorkspaceProposalWorkItemLinkApplication(record, decision, {
		applicationId: "application-repair-review",
		workItems: [workItem("wi-1"), workItem("wi-2")],
	});
	const repairNeededStatus = {
		...application.status,
		state: "repair-needed",
		code: "missing-required-field",
		issues: [
			{
				kind: "issue",
				source: "workspace-proposal",
				severity: "error",
				code: "missing-required-field",
				message: "Workspace proposal family application material is missing",
				subjectId: application.status.proposalId,
				refs: application.status.sourceRefs.map((source) => `${source.kind}:${source.id}`),
			},
		],
		emittedFactRefs: [],
	} satisfies WorkspaceProposalApplicationStatus;
	const request = projectWorkspaceProposalRepairReviewRequests({
		applicationStatuses: [repairNeededStatus],
	})[0];
	if (request === undefined) throw new Error("expected D444 repair request fixture");
	const outcomeResult = recordWorkspaceProposalWorkItemLinkOutcome(application.status, {
		outcomeId: "repair-review-outcome",
		linkRef: { kind: "work-item-link", id: "link-1" },
	});
	const outcome = outcomeResult.outcome;
	if (outcome === undefined) throw new Error("expected D444 outcome fixture");
	const outcomeIndex = projectWorkspaceProposalFamilyOutcomeIndex([outcome]);
	return {
		record,
		decision,
		request,
		appliedStatus: application.status,
		applicationRecorded: application.recorded,
		repairNeededStatus,
		outcome,
		outcomeStatus: outcomeResult.status,
		outcomeIndex,
	};
}

function repairReviewReadModelCoordinates(request: WorkspaceProposalRepairReviewRequest) {
	return {
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
	} as const;
}

function repairReviewDecision(
	request: WorkspaceProposalRepairReviewRequest,
	intent: WorkspaceProposalRepairReviewDecision["intent"],
	reviewDecisionId: string,
): WorkspaceProposalRepairReviewDecision {
	return {
		kind: "workspace-proposal-repair-review-decision",
		reviewDecisionId,
		repairRequestId: request.repairRequestId,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		intent,
		reviewerRef: { kind: "actor", id: "reviewer-1" },
		sourceRefs: [{ kind: "manual-review", id: reviewDecisionId }],
	};
}

function repairReviewRecordingInput(
	request: WorkspaceProposalRepairReviewRequest,
	reviewDecisionId: string,
): WorkspaceProposalRepairReviewDecisionRecordingInput {
	return {
		kind: "workspace-proposal-repair-review-decision-recording-input",
		repairRequestId: request.repairRequestId,
		reviewDecisionId,
		intent: "acknowledged",
		reviewerRef: { kind: "actor", id: "reviewer:d456" },
		capabilityRefs: [{ kind: "capability", id: "repair-review:write" }],
		policyRefs: [{ kind: "policy", id: "repair-review:policy" }],
		sourceRefs: [{ kind: "manual-review", id: `source:${reviewDecisionId}` }],
		audit: {
			auditId: `audit:${reviewDecisionId}`,
			actorId: "reviewer:d456",
			sourceRefs: [{ kind: "manual-review", id: `audit-source:${reviewDecisionId}` }],
		},
		code: "acknowledged-by-reviewer",
		expectedCurrentState: { state: "open", code: "open" },
	};
}

function repairActionIntent(
	request: WorkspaceProposalRepairReviewRequest,
	descriptor: WorkspaceProposalRepairActionDescriptor,
	options: {
		readonly actionKind: WorkspaceProposalRepairActionIntent["actionKind"];
		readonly expectedCurrentState?: WorkspaceProposalRepairActionIntent["expectedCurrentState"];
	},
): WorkspaceProposalRepairActionIntent {
	return {
		kind: "workspace-proposal-repair-action-intent",
		intentId: `repair-action-intent:${options.actionKind}`,
		descriptorId: descriptor.descriptorId,
		repairRequestId: request.repairRequestId,
		actionKind: options.actionKind,
		applicationId: request.applicationId,
		proposalId: request.proposalId,
		decisionId: request.decisionId,
		idempotencyKey: request.idempotencyKey,
		proposalFamily: request.proposalFamily,
		reviewerRef: { kind: "actor", id: "reviewer:d459" },
		capabilityRefs: [{ kind: "capability", id: `repair-action:${options.actionKind}` }],
		policyRefs: [{ kind: "policy", id: "repair-action:intake-policy" }],
		sourceRefs: descriptor.sourceRefs,
		audit: {
			auditId: `audit:${options.actionKind}`,
			actorId: "reviewer:d459",
			sourceRefs: descriptor.sourceRefs,
		},
		metadata: { descriptorRoute: descriptor.metadata?.route },
		expectedCurrentState: options.expectedCurrentState,
	};
}

function readModelQuery(
	queryId: string,
	coordinates: ReturnType<typeof repairReviewReadModelCoordinates>,
	options: {
		readonly page?: WorkspaceProposalFamilyApplicationReadModelQuery["page"];
		readonly filters?: WorkspaceProposalFamilyApplicationReadModelQuery["filters"];
	} = {},
): WorkspaceProposalFamilyApplicationReadModelQuery {
	return {
		kind: "workspace-proposal-family-application-read-model-query",
		queryId,
		viewId: `view-${queryId}`,
		...coordinates,
		page: options.page,
		filters: options.filters,
		sourceRefs: [sourceRef],
	};
}

function expectForbiddenDescriptorKeys(value: unknown): void {
	const forbidden = new Set([
		"command",
		"commands",
		"callback",
		"callbacks",
		"handler",
		"onClick",
		"onSubmit",
		"draftFactory",
		"proposalDraft",
		"successorProposalId",
		"successorAdmissionId",
		"successorApplicationId",
		"mutationIntent",
		"providerClient",
		"runtimeHandle",
		"retryCommand",
		"familyFact",
		"applicationStatus",
	]);
	const visit = (item: unknown): void => {
		if (Array.isArray(item)) {
			for (const entry of item) visit(entry);
			return;
		}
		if (item === null || typeof item !== "object") return;
		for (const [key, child] of Object.entries(item)) {
			expect(forbidden.has(key), `forbidden descriptor key ${key}`).toBe(false);
			visit(child);
		}
	};
	visit(value);
}

function d430ApplicationRefs(
	record: WorkspaceProposalRecorded,
	decision: WorkspaceProposalAdmissionDecision,
	applicationId: string,
) {
	return [
		{ kind: "workspace-proposal-recorded", id: record.proposalId },
		{ kind: "workspace-proposal-admission-decision", id: decision.decisionId },
		{ kind: "workspace-proposal-application-status", id: applicationId },
	] as const;
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

function collectDataFromNodes<T>(
	...nodes: {
		subscribe(sink: (msg: readonly [string, unknown?]) => void): unknown;
	}[]
): T[] {
	const out: T[] = [];
	for (const node of nodes) {
		node.subscribe((msg) => {
			if (msg[0] === "DATA") out.push(msg[1] as T);
		});
	}
	return out;
}
