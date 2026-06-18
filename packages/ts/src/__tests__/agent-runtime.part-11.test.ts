import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestIssued,
	buildToolProviderAdapterInputs,
	type EffectRunResult,
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
	type WorkItemEffectMappingPolicy,
	type WorkItemEffectRequested,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemDomainActionAdmissionProjector,
	workItemDomainActionProposalProjector,
	workItemEffectRunProjector,
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

function workItemSeed(workItemId: string): WorkItemSeed {
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 11", () => {
	it("keeps WorkItem domain action proposals disabled without a referenced policy", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "unreferenced-action-policy",
					actionProposals: [{ actionKind: "close-work-item", statuses: ["completed"] }],
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					sourceRefs: [
						{ kind: "work-item-effect-mapping-policy", id: "unreferenced-action-policy" },
					],
					output: { kind: "verified" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "evidence-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					output: { kind: "verified" },
				},
			],
		]);

		expect(proposals).toEqual([]);
		expect(issues).toEqual([]);
	});

	it("emits DataIssue for stale or missing WorkItem action proposal policy inputs", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "missing-result-evidence",
					workItemId: "wi-1",
					effectRunId: "missing-run",
					effectRunResultId: "missing-run:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose-missing" }],
					output: { kind: "verified" },
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "failed",
					effectRunId: "run-1",
					error: { kind: "issue", code: "failed", message: "failed" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "stale-evidence",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose-missing" }],
					output: { kind: "verified" },
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-2:result",
					status: "completed",
					effectRunId: "run-2",
					output: { kind: "verified" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "missing-policy-evidence",
					workItemId: "wi-1",
					effectRunId: "run-2",
					effectRunResultId: "run-2:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose-missing" }],
					output: { kind: "verified" },
				},
			],
		]);

		expect(proposals).toEqual([]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "missing-work-item-action-proposal-result" }),
				expect.objectContaining({ code: "stale-work-item-action-proposal-result" }),
				expect.objectContaining({ code: "missing-work-item-action-proposal-policy" }),
			]),
		);
	});

	it("emits DataIssue for duplicate WorkItem action proposal evidence ids", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose",
					actionProposals: [{ actionKind: "mark-ready", statuses: ["completed"] }],
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "verified" },
				},
			],
		]);
		const firstEvidence: WorkItemEvidenceRecorded = {
			kind: "work-item-evidence-recorded",
			evidenceId: "evidence-1",
			workItemId: "wi-1",
			effectRunId: "run-1",
			effectRunResultId: "run-1:result",
			status: "completed",
			sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose" }],
			output: { kind: "verified" },
		};
		evidence.down([["DATA", firstEvidence]]);
		evidence.down([
			[
				"DATA",
				{
					...firstEvidence,
					output: { kind: "verified", value: { replacement: true } },
				},
			],
		]);

		expect(proposals).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({
			code: "duplicate-work-item-action-proposal-evidence",
		});
	});

	it("emits DataIssue for duplicate WorkItem action proposal result ids", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: unknown[] = [];
		const issues: unknown[] = [];
		projector.proposals.subscribe((msg) => msg[0] === "DATA" && proposals.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose",
					actionProposals: [{ actionKind: "mark-ready", statuses: ["completed"] }],
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "verified" },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "evidence-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose" }],
					output: { kind: "verified" },
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "failed",
					effectRunId: "run-1",
					error: { kind: "issue", code: "failed", message: "replacement" },
				},
			],
		]);

		expect(proposals).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({
			code: "duplicate-work-item-action-proposal-result",
		});
	});

	it("keeps WorkItem action proposal payloads compact and explicit", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const evidence = g.node<WorkItemEvidenceRecorded>([], null, { name: "evidence" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const projector = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const proposals: WorkItemDomainActionProposal[] = [];
		projector.proposals.subscribe(
			(msg) => msg[0] === "DATA" && proposals.push(msg[1] as WorkItemDomainActionProposal),
		);
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose",
					actionProposals: [
						{ actionKind: "default-payload" },
						{ actionKind: "result-ref", payloadFrom: "effect-run-result" },
						{ actionKind: "static-payload", payload: { approvedByPolicy: true } },
					],
				},
			],
		]);
		results.down([
			[
				"DATA",
				{
					kind: "effect-run-result",
					resultId: "run-1:result",
					status: "completed",
					effectRunId: "run-1",
					output: { kind: "verified", value: { ok: true } },
				},
			],
		]);
		evidence.down([
			[
				"DATA",
				{
					kind: "work-item-evidence-recorded",
					evidenceId: "evidence-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectRunResultId: "run-1:result",
					status: "completed",
					sourceRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-propose" }],
					output: { kind: "verified", value: { ok: true } },
				},
			],
		]);

		expect(proposals.find((proposal) => proposal.actionKind === "default-payload")?.payload).toBe(
			undefined,
		);
		expect(proposals.find((proposal) => proposal.actionKind === "result-ref")?.payload).toEqual({
			kind: "effect-run-result-ref",
			resultId: "run-1:result",
		});
		expect(proposals.find((proposal) => proposal.actionKind === "static-payload")?.payload).toEqual(
			{
				approvedByPolicy: true,
			},
		);
	});

	it("does not seed EffectRun for WorkItemEffectRequested targeting unknown WorkItem", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const workItemRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
		const seededRuns: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		workItemRuns.effectRuns.subscribe((msg) => msg[0] === "DATA" && seededRuns.push(msg[1]));
		workItemRuns.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItemRuns.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-other")]]);

		effectRequests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-1",
					workItemId: "wi-missing",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify" },
				},
			],
		]);

		expect(seededRuns).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "unknown-work-item-effect-request" });
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);

		workItems.down([["DATA", workItemSeed("wi-missing")]]);
		expect(seededRuns).toEqual([]);
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("rejects duplicate WorkItemEffectRequested facts that reuse an EffectRun id", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const workItemRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
		const seededRuns: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		workItemRuns.effectRuns.subscribe((msg) => msg[0] === "DATA" && seededRuns.push(msg[1]));
		workItemRuns.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItemRuns.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);

		effectRequests.down([
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-1",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify" },
				},
			],
			[
				"DATA",
				{
					kind: "work-item-effect-requested",
					requestId: "wi-effect-2",
					workItemId: "wi-1",
					effectRunId: "run-1",
					effectKind: "verification",
					goal: { kind: "verify-again" },
				},
			],
		]);

		expect(seededRuns).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({ code: "duplicate-work-item-effect-run" });
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("admits WorkItem domain action proposals as a no-op visible ledger", () => {
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
			now: () => 1200,
		});
		const admissions: WorkItemDomainActionAdmission[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		const views: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		projector.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		projector.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		projector.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));

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
		proposals.down([["DATA", workItemActionProposal("proposal-1", "mark-ready")]]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision("decision-1", "admission-1", "proposal-1", "admit", {
					policyId: "admit-ready",
					decidedAtMs: 1199,
					sourceRefs: [
						{ kind: "work-item-domain-action-proposal", id: "proposal-1" },
						{ kind: "work-item-domain-action-admission-policy", id: "admit-ready" },
					],
				}),
			],
		]);

		expect(issues).toEqual([]);
		expect(admissions).toEqual([
			expect.objectContaining({
				kind: "work-item-domain-action-admission",
				admissionId: "admission-1",
				proposalId: "proposal-1",
				workItemId: "wi-1",
				actionKind: "mark-ready",
				state: "admitted",
				decisionId: "decision-1",
				policyId: "admit-ready",
				admittedAtMs: 1199,
			}),
		]);
		expect(admissions.at(-1)?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-item-domain-action-proposal", id: "proposal-1" },
				{ kind: "work-item-domain-action-admission-policy", id: "admit-ready" },
				{ kind: "work-item-domain-action-admission-decision", id: "decision-1" },
			]),
		);
		expect(statuses.at(-1)).toMatchObject({
			state: "domain-action-admitted",
			proposalId: "proposal-1",
		});
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "approved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "verified" }));
		expect(Object.keys(projector)).toEqual(["admissions", "status", "issues", "audit", "views"]);
		expect(audit.at(-1)).toMatchObject({ kind: "work-item-domain-action-admitted" });
		const latestView = views.at(-1) as {
			admissionsByProposal: Map<string, WorkItemDomainActionAdmission>;
			admissionsByWorkItem: Map<string, readonly WorkItemDomainActionAdmission[]>;
		};
		expect(latestView.admissionsByProposal.get("proposal-1")?.state).toBe("admitted");
		expect(latestView.admissionsByWorkItem.get("wi-1")?.[0].admissionId).toBe("admission-1");
	});

	it("records rejected, deferred, and merged WorkItem domain action admissions without applying them", () => {
		const g = graph();
		const proposals = g.node<WorkItemDomainActionProposal>([], null, { name: "proposals" });
		const decisions = g.node<WorkItemDomainActionAdmissionDecision>([], null, {
			name: "decisions",
		});
		const projector = workItemDomainActionAdmissionProjector(g, { proposals, decisions });
		const admissions: WorkItemDomainActionAdmission[] = [];
		const statuses: unknown[] = [];
		projector.admissions.subscribe(
			(msg) => msg[0] === "DATA" && admissions.push(msg[1] as WorkItemDomainActionAdmission),
		);
		projector.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));

		proposals.down([
			["DATA", workItemActionProposal("proposal-reject", "mark-ready")],
			["DATA", workItemActionProposal("proposal-defer", "mark-ready")],
			["DATA", workItemActionProposal("proposal-merge-target", "mark-ready")],
			["DATA", workItemActionProposal("proposal-merge", "mark-ready")],
		]);
		decisions.down([
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-reject",
					"admission-reject",
					"proposal-reject",
					"reject",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-defer", "admission-defer", "proposal-defer", "defer"),
			],
			[
				"DATA",
				workItemAdmissionDecision(
					"decision-merge-target",
					"admission-merge-target",
					"proposal-merge-target",
					"admit",
				),
			],
			[
				"DATA",
				workItemAdmissionDecision("decision-merge", "admission-merge", "proposal-merge", "merge", {
					targetProposalId: "proposal-merge-target",
					sourceRefs: [
						{ kind: "work-item-domain-action-proposal", id: "proposal-merge" },
						{ kind: "work-item-domain-action-proposal", id: "proposal-merge-target" },
					],
				}),
			],
		]);

		expect(admissions.map((admission) => admission.state)).toEqual([
			"rejected",
			"deferred",
			"admitted",
			"merged",
		]);
		expect(admissions.at(-1)).toMatchObject({
			state: "merged",
			targetProposalId: "proposal-merge-target",
		});
		expect(statuses.map((status) => (status as { state: string }).state)).toEqual([
			"domain-action-rejected",
			"domain-action-deferred",
			"domain-action-admitted",
			"domain-action-merged",
		]);
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "approved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "verified" }));
	});
});
