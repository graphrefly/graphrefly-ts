import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestIssued,
	buildToolProviderAdapterInputs,
	type ExecutorRoute,
	localBuiltinToolProviderCatalog,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
} from "../orchestration/agent-runtime.js";
import {
	type WorkItemDomainActionAdmission,
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionAdmissionPolicy,
	type WorkItemDomainActionProposal,
	type WorkItemSeed,
	workItemDomainActionAdmissionProjector,
} from "../orchestration/work-item-runtime.js";

function _issued(
	requestId: string,
	operationId: string,
	requestKind: AgentRequestIssued["requestKind"],
	inputKind?: string,
): AgentRequestIssued {
	return {
		kind: "issued",
		requestId,
		operationId,
		effectRunId: "run-1",
		requestKind,
		required: true,
		input:
			inputKind === undefined
				? undefined
				: { inputId: `${requestId}:input`, inputKind, dataMode: "summary", summary: inputKind },
	};
}

function toolRequest(
	requestId: string,
	operationId: string,
	toolName: string,
	operation?: string,
): AgentRequestIssued {
	return {
		kind: "issued",
		requestId,
		operationId,
		effectRunId: "run-1",
		requestKind: "executor",
		required: true,
		input: {
			inputId: `${requestId}:input`,
			inputKind: "tool-call",
			dataMode: "inline",
			value: {
				kind: "tool-call",
				toolName,
				operation,
				arguments: { path: "README.md" },
			},
		},
	};
}

const forbiddenRetentionPayloadPattern =
	/SCORER_SECRET|SCORER_RAW|rawResponse|stdout|stderr|stack|apiKey|password|arguments|providerClient|oauthState|subprocessHandle|transport|sdkObject/i;

const retentionScorerEntryKeys: Record<string, readonly string[]> = {
	adapterInputs: [
		"adapterInputId",
		"executorId",
		"insertedAtMs",
		"key",
		"operationId",
		"profileId",
		"providerId",
		"requestId",
		"routeId",
		"sequence",
		"status",
	],
	runRequests: [
		"adapterInputId",
		"attempt",
		"executorId",
		"key",
		"operationId",
		"profileId",
		"providerId",
		"reason",
		"requestId",
		"requestedAtMs",
		"routeId",
		"runId",
		"sequence",
	],
	executions: [
		"adapterInputId",
		"attempt",
		"executorId",
		"key",
		"occurredAtMs",
		"operationId",
		"outcomeId",
		"profileId",
		"providerId",
		"reason",
		"requestId",
		"routeId",
		"runId",
		"sequence",
		"status",
	],
	runStatuses: [
		"adapterInputId",
		"attempt",
		"issueCode",
		"key",
		"occurredAtMs",
		"operationId",
		"outcomeId",
		"requestId",
		"runId",
		"sequence",
		"status",
	],
	runIssues: [
		"adapterInputId",
		"attempt",
		"issueCode",
		"key",
		"occurredAtMs",
		"operationId",
		"requestId",
		"runId",
		"sequence",
		"severity",
		"subjectId",
	],
	retentionEvidence: [
		"adapterInputId",
		"attemptHighWater",
		"evidenceKind",
		"key",
		"occurredAtMs",
		"reason",
		"sequence",
	],
};

function _expectRetentionScorerEntryPayloadSafe(index: string, entry: unknown): void {
	expect(entry).toBeTypeOf("object");
	expect(Array.isArray(entry)).toBe(false);
	const record = entry as Record<string, unknown>;
	const allowed = retentionScorerEntryKeys[index];
	expect(allowed, `unknown retention scorer index ${index}`).toBeDefined();
	for (const [key, value] of Object.entries(record)) {
		expect(allowed).toContain(key);
		expect(value === undefined || typeof value === "string" || typeof value === "number").toBe(
			true,
		);
		if (key === "key") expect(value).toEqual(expect.stringMatching(/^key:[a-z0-9]+:\d+$/));
	}
	expectNoForbiddenRetentionPayload(record);
}

function expectNoForbiddenRetentionPayload(value: unknown): void {
	expect(JSON.stringify(value)).not.toMatch(forbiddenRetentionPayloadPattern);
}

function _readyToolProviderAdapterInput(
	providerId: string,
	requestId: string,
): ToolProviderAdapterInput {
	const catalog = localBuiltinToolProviderCatalog({ providerId });
	const profile = catalog.profiles[0];
	if (profile === undefined) throw new Error("expected profile");
	const request = toolRequest(requestId, `${requestId}-op`, "file.read", "read");
	const route: ExecutorRoute = {
		kind: "executor-route",
		routeId: `${requestId}-route`,
		requestId: request.requestId,
		operationId: request.operationId,
		executorId: profile.executorId,
		profileId: profile.profileId,
		inputKind: "tool-call",
	};
	const resolutions = resolveToolProviderExecutionPolicies({
		request,
		routes: [route],
		catalogs: [catalog],
	});
	const input = buildToolProviderAdapterInputs({
		requests: [request],
		routes: [route],
		catalogs: [catalog],
		resolutions,
	})[0];
	if (input === undefined || input.status !== "ready") throw new Error("expected ready input");
	return input;
}

function _workItemSeed(workItemId: string): WorkItemSeed {
	return {
		kind: "work-item",
		workItemId,
		sourceRefs: [{ kind: "work-item", id: workItemId }],
		workItemKind: "issue",
		lifecycleStatus: "open",
	};
}

function workItemActionProposal(
	proposalId: string,
	actionKind: string,
	opts: Partial<WorkItemDomainActionProposal> = {},
): WorkItemDomainActionProposal {
	return {
		kind: "work-item-domain-action-proposal",
		proposalId,
		workItemId: opts.workItemId ?? "wi-1",
		actionKind,
		effectRunId: opts.effectRunId ?? "run-1",
		effectRunResultId: opts.effectRunResultId ?? "run-1:result",
		evidenceId: opts.evidenceId ?? "wi-1:run-1:run-1:result",
		policyId: opts.policyId ?? "policy-propose",
		sourceRefs: opts.sourceRefs,
		metadata: opts.metadata,
	};
}

function workItemAdmissionDecision(
	decisionId: string,
	admissionId: string,
	proposalId: string,
	outcome: WorkItemDomainActionAdmissionDecision["outcome"],
	opts: Partial<WorkItemDomainActionAdmissionDecision> = {},
): WorkItemDomainActionAdmissionDecision {
	return {
		kind: "work-item-domain-action-admission-decision",
		decisionId,
		admissionId,
		proposalId,
		outcome,
		policyId: opts.policyId,
		reason: opts.reason,
		targetProposalId: opts.targetProposalId,
		targetAdmissionId: opts.targetAdmissionId,
		sourceRefs: opts.sourceRefs,
		decidedAtMs: opts.decidedAtMs,
		metadata: opts.metadata,
	};
}

describe("CSP-8 experimental agent runtime kernel (D236) — part 12", () => {
	it("emits DataIssue for duplicate and stale WorkItem admission inputs while preserving first facts", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const issues: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission-policy",
					policyId: "admit-ready",
					actionKinds: ["mark-ready"],
					allowedOutcomes: ["admit"],
				},
			],
		]);

		proposals.down([
			["DATA", workItemActionProposal("proposal-1", "mark-ready")],
			["DATA", workItemActionProposal("proposal-1", "mark-ready")],
			["DATA", workItemActionProposal("proposal-2", "mark-ready")],
			["DATA", workItemActionProposal("proposal-3", "mark-ready")],
			["DATA", workItemActionProposal("proposal-4", "other-action")],
			["DATA", workItemActionProposal("proposal-5", "mark-ready")],
		]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision("decision-ok", "admission-1", "proposal-1", "admit", {
					policyId: "admit-ready",
				}),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-duplicate-admission",
					"admission-1",
					"proposal-2",
					"admit",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-stale", "admission-stale", "proposal-3", "admit", {
					sourceRefs: [{ kind: "work-item-domain-action-proposal", id: "proposal-other" }],
				}),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-missing",
					"admission-missing",
					"proposal-missing",
					"admit",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-policy-mismatch",
					"admission-mismatch",
					"proposal-4",
					"admit",
					{
						policyId: "admit-ready",
					},
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-ok", "admission-5", "proposal-5", "admit", {
					policyId: "admit-ready",
				}),
			],
		]);

		expect(admissions).toHaveLength(1);
		expect(admissions.at(-1)).toMatchObject({
			admissionId: "admission-1",
			proposalId: "proposal-1",
		});
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual(
			expect.arrayContaining([
				"duplicate-work-item-domain-action-proposal",
				"duplicate-work-item-domain-action-admission",
				"duplicate-work-item-domain-action-admission-decision",
				"stale-work-item-domain-action-admission-proposal-ref",
				"missing-work-item-domain-action-admission-proposal",
				"work-item-domain-action-admission-policy-mismatch",
			]),
		);
	});

	it("rejects ambiguous WorkItem admission merge targets and unknown policy refs", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const issues: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		proposals.down([
			["DATA", workItemActionProposal("proposal-1", "mark-ready")],
			["DATA", workItemActionProposal("proposal-2", "mark-ready")],
			["DATA", workItemActionProposal("proposal-3", "mark-ready")],
		]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-missing-policy",
					"admission-missing-policy",
					"proposal-1",
					"admit",
					{
						policyId: "missing-policy",
					},
				),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-stale-policy",
					"admission-stale-policy",
					"proposal-2",
					"admit",
					{
						policyId: "missing-policy",
						sourceRefs: [{ kind: "work-item-domain-action-admission-policy", id: "other-policy" }],
					},
				),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-ambiguous-merge",
					"admission-ambiguous-merge",
					"proposal-3",
					"merge",
					{
						targetProposalId: "proposal-1",
						targetAdmissionId: "admission-1",
					},
				),
			],
		]);

		expect(admissions).toEqual([]);
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual([
			"missing-work-item-domain-action-admission-policy",
			"stale-work-item-domain-action-admission-policy-ref",
			"ambiguous-work-item-domain-action-admission-merge-target",
		]);
	});

	it("replays pending WorkItem admission decisions when proposal, policy, or target admission facts arrive later", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const policies = g.node<WorkItemDomainActionAdmissionPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionAdmissionProjector(g, {
			proposals,
			decisions,
			admissionPolicies: [policies],
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const issues: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision("decision-admit", "admission-admit", "proposal-admit", "admit", {
					policyId: "late-policy",
				}),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-merge", "admission-merge", "proposal-merge", "merge", {
					targetAdmissionId: "admission-admit",
				}),
			],
		]);
		expect(admissions).toEqual([]);
		expect(issues.map((issue) => (issue as { code: string }).code)).toEqual(
			expect.arrayContaining(["missing-work-item-domain-action-admission-proposal"]),
		);

		policies.down([
			[
				"DATA",
				{
					kind: "work-item-domain-action-admission-policy",
					policyId: "late-policy",
					actionKinds: ["mark-ready"],
					allowedOutcomes: ["admit"],
				},
			],
		]);
		proposals.down([
			["DATA", workItemActionProposal("proposal-merge", "mark-ready")],
			["DATA", workItemActionProposal("proposal-admit", "mark-ready")],
		]);

		expect(admissions.map((admission) => admission.admissionId)).toEqual([
			"admission-admit",
			"admission-merge",
		]);
		expect(admissions.at(-1)).toMatchObject({
			state: "merged",
			targetAdmissionId: "admission-admit",
		});
	});
});
