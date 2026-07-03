import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import {
	type AgentRequestIssued,
	buildToolProviderAdapterInputs,
	type EffectRun,
	type EffectRunResult,
	type ExecutorRoute,
	effectRun,
	localBuiltinToolProviderCatalog,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
} from "../orchestration/agent-runtime.js";
import {
	type WorkItemDomainActionAdmissionDecision,
	type WorkItemDomainActionProposal,
	type WorkItemEffectMappingPolicy,
	type WorkItemEffectRequested,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemDomainActionProposalProjector,
	workItemEffectResultMapper,
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

function _workItemActionProposal(
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

function _workItemAdmissionDecision(
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 10", () => {
	it("emits DataIssue and audit for duplicate WorkItem evidence mapping", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
			],
		]);
		const result: EffectRunResult = {
			kind: "effect-run-result",
			resultId: "run-1:result",
			status: "completed",
			effectRunId: "run-1",
			output: { kind: "ok" },
		};
		results.down([["DATA", result]]);
		results.down([["DATA", result]]);

		expect(evidence).toHaveLength(1);
		expect(issues.at(-1)).toMatchObject({ code: "duplicate-work-item-evidence" });
		expect(audit.at(-1)).toMatchObject({ kind: "work-item-evidence-mapping-issue" });
	});

	it("records evidence when WorkItemEffectRequested explicitly references a record mapping policy", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
			now: () => 950,
		});
		const evidence: WorkItemEvidenceRecorded[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe(
			(msg) => msg[0] === "DATA" && evidence.push(msg[1] as WorkItemEvidenceRecorded),
		);
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-record-verification",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
				},
			],
		]);
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
					policyRefs: [
						{ kind: "work-item-effect-mapping-policy", id: "policy-record-verification" },
					],
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
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
					output: { kind: "ok" },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(evidence.at(-1)).toMatchObject({
			workItemId: "wi-1",
			effectRunId: "run-1",
			status: "completed",
			recordedAtMs: 950,
		});
	});

	it("rejects a missing referenced WorkItemEffectMappingPolicy and clears pending effect request", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "other-policy",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
				},
			],
		]);
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
					policyRefs: [{ kind: "work-item-effect-mapping-policy", id: "missing-policy" }],
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
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
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "missing-work-item-effect-mapping-policy" });
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("rejects unsupported WorkItemEffectMappingPolicy behavior without lifecycle side effects", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-close",
					effectKinds: ["verification"],
					evidence: { behavior: "close" },
				} as unknown as WorkItemEffectMappingPolicy,
			],
		]);
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
					policyRefs: [{ kind: "work-item-effect-mapping-policy", id: "policy-close" }],
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
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
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "unsupported-work-item-evidence-behavior" });
		expect(statuses.at(-1)).toMatchObject({ state: "mapping-issue" });
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
	});

	it("validates EffectRun policyRefs when raw WorkItemEffectRequested facts are not supplied", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "other-policy",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					sourceRefs: [{ kind: "work-item-effect-request", id: "wi-effect-1" }],
					goal: { kind: "verify" },
					policyRefs: [{ kind: "work-item-effect-mapping-policy", id: "missing-policy" }],
					metadata: { effectKind: "verification" },
				}),
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
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues.at(-1)).toMatchObject({ code: "missing-work-item-effect-mapping-policy" });
	});

	it("rejects ambiguous WorkItemEffectRequested policy joins for duplicate EffectRun ids", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		mapper.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
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
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
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
					output: { kind: "ok" },
				},
			],
		]);

		expect(evidence).toEqual([]);
		expect(issues).toContainEqual(
			expect.objectContaining({ code: "duplicate-work-item-effect-request" }),
		);
		expect(
			(views.at(-1) as { pendingEffectRequests: readonly WorkItemEffectRequested[] })
				.pendingEffectRequests,
		).toEqual([]);
	});

	it("keeps evidence-only default mapping when a WorkItemEffectRequested has no policyRefs", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const effectRequests = g.node<WorkItemEffectRequested>([], null, {
			name: "workItemEffectRequests",
		});
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			effectRequests,
			mappingPolicies: [policies],
		});
		const evidence: unknown[] = [];
		const issues: unknown[] = [];
		mapper.evidence.subscribe((msg) => msg[0] === "DATA" && evidence.push(msg[1]));
		mapper.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "unreferenced-policy",
					effectKinds: ["different-kind"],
					evidence: { behavior: "record" },
				},
			],
		]);
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
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
				}),
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
					output: { kind: "ok" },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(evidence).toHaveLength(1);
	});

	it("proposes WorkItem domain actions only from explicit mapping-policy evidence", () => {
		const g = graph();
		const workItems = g.node<WorkItemSeed>([], null, { name: "workItems" });
		const effectRuns = g.node<EffectRun>([], null, { name: "effectRuns" });
		const results = g.node<EffectRunResult>([], null, { name: "results" });
		const policies = g.node<WorkItemEffectMappingPolicy>([], null, { name: "policies" });
		const mapper = workItemEffectResultMapper(g, {
			workItems,
			effectRuns,
			effectRunResults: results,
			mappingPolicies: [policies],
			now: () => 1000,
		});
		const proposals = workItemDomainActionProposalProjector(g, {
			workItems,
			evidence: mapper.evidence,
			effectRunResults: results,
			mappingPolicies: [policies],
			now: () => 1100,
		});
		const emitted: WorkItemDomainActionProposal[] = [];
		const statuses: unknown[] = [];
		const issues: unknown[] = [];
		const views: unknown[] = [];
		mapper.evidence.subscribe(() => {});
		proposals.proposals.subscribe(
			(msg) => msg[0] === "DATA" && emitted.push(msg[1] as WorkItemDomainActionProposal),
		);
		proposals.status.subscribe((msg) => msg[0] === "DATA" && statuses.push(msg[1]));
		proposals.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		proposals.views.subscribe((msg) => msg[0] === "DATA" && views.push(msg[1]));
		workItems.down([["DATA", workItemSeed("wi-1")]]);
		policies.down([
			[
				"DATA",
				{
					kind: "work-item-effect-mapping-policy",
					policyId: "policy-propose-verification",
					effectKinds: ["verification"],
					evidence: { behavior: "record" },
					actionProposals: [
						{
							actionKind: "mark-verification-ready",
							statuses: ["completed"],
							outputKinds: ["verified"],
							payloadFrom: "output",
							reason: "verified output may justify an explicit domain action",
						},
					],
				},
			],
		]);
		effectRuns.down([
			[
				"DATA",
				effectRun({
					effectRunId: "run-1",
					subjectRefs: [{ kind: "work-item", id: "wi-1" }],
					goal: { kind: "verify" },
					policyRefs: [
						{ kind: "work-item-effect-mapping-policy", id: "policy-propose-verification" },
					],
					metadata: { effectKind: "verification" },
				}),
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
					metadata: { effectKind: "verification" },
				},
			],
		]);

		expect(issues).toEqual([]);
		expect(emitted.at(-1)).toMatchObject({
			kind: "work-item-domain-action-proposal",
			workItemId: "wi-1",
			actionKind: "mark-verification-ready",
			effectRunId: "run-1",
			effectRunResultId: "run-1:result",
			policyId: "policy-propose-verification",
			payload: { kind: "verified", value: { ok: true } },
			proposedAtMs: 1100,
		});
		expect(emitted.at(-1)?.proposalId).toBe(
			compoundTupleKey("work-item-domain-action-proposal", [
				"wi-1",
				"run-1",
				"run-1:result",
				"policy-propose-verification",
				"0",
				"mark-verification-ready",
			]),
		);
		expect(emitted.at(-1)?.sourceRefs).toEqual(
			expect.arrayContaining([
				{ kind: "work-item", id: "wi-1" },
				{ kind: "effect-run", id: "run-1" },
				{ kind: "effect-run-result", id: "run-1:result" },
				{ kind: "work-item-effect-mapping-policy", id: "policy-propose-verification" },
			]),
		);
		expect(statuses.at(-1)).toMatchObject({
			state: "domain-action-proposed",
			proposalId: emitted.at(-1)?.proposalId,
		});
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "closed" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "resolved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "approved" }));
		expect(statuses).not.toContainEqual(expect.objectContaining({ state: "verified" }));
		const latestView = views.at(-1) as {
			proposalsByWorkItem: Map<string, readonly WorkItemDomainActionProposal[]>;
			proposalsByEvidence: Map<string, readonly WorkItemDomainActionProposal[]>;
		};
		expect(latestView.proposalsByWorkItem.get("wi-1")).toHaveLength(1);
		expect(
			latestView.proposalsByEvidence.get(
				compoundTupleKey("work-item-evidence-recorded", ["wi-1", "run-1", "run-1:result"]),
			)?.[0].actionKind,
		).toBe("mark-verification-ready");
	});
});
