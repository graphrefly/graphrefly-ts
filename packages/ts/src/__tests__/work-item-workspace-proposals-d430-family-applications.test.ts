import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	decideWorkspaceProposalAdmission,
	projectWorkspaceProposalApplicationStatus,
	projectWorkspaceProposalDomainActionApplicationStatus,
	projectWorkspaceProposalFamilyOutcomeIndex,
	projectWorkspaceProposalRequiredInputResponseApplication,
	projectWorkspaceProposalWorkItemLinkApplication,
	projectWorkspaceProposalWorkItemSpawnApplication,
	type RequiredInputGate,
	type RequiredInputResponseProposed,
	recordWorkspaceProposal,
	recordWorkspaceProposalDomainActionOutcome,
	recordWorkspaceProposalRequiredInputResponseOutcome,
	recordWorkspaceProposalWorkItemLinkOutcome,
	recordWorkspaceProposalWorkItemSpawnOutcome,
	validateWorkspaceProposalApplicationEnvelope,
	type WorkItemAuthoringFact,
	type WorkItemDraft,
	type WorkItemLinked,
	type WorkItemLinkProjection,
	type WorkItemProjection,
	type WorkItemSpawnProposed,
	type WorkspaceProposalAdmissionDecision,
	type WorkspaceProposalAdmissionMaterial,
	type WorkspaceProposalDomainActionApplicationContext,
	type WorkspaceProposalFamily,
	type WorkspaceProposalReadyRequest,
	type WorkspaceProposalRecorded,
	type WorkspaceProposalRequiredInputResponseApplicationContext,
	type WorkspaceProposalWorkItemLinkApplicationContext,
	type WorkspaceProposalWorkItemSpawnApplicationContext,
	workspaceProposalApplicationFamilyRef,
	workspaceProposalDomainActionApplicationProjector,
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
		const second = proposalRecord("work-item-link", {
			...linkDraft(),
			proposalId: "proposal-2",
			eventId: "link-event-1",
		});
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
