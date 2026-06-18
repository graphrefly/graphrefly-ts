import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestIssued,
	attachToolProviderAdapterRuntime,
	buildToolProviderAdapterInputs,
	type ExecutorRoute,
	localBuiltinToolProviderCatalog,
	requestToolProviderAdapterRun,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunStatus,
	type ToolProviderAdapterRuntimeStatus,
} from "../orchestration/agent-runtime.js";
import type {
	WorkItemDomainActionAdmissionDecision,
	WorkItemDomainActionProposal,
	WorkItemSeed,
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

function readyToolProviderAdapterInput(
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 4", () => {
	it("rejects same adapterInputId and attempt under a different runId without executing twice", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-coordinate-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-coordinate-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-coordinate-provider",
			"runtime-retention-coordinate-req",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { executions: { maxSize: 2 } },
			bindings: [
				{
					providerId: "runtime-retention-coordinate-provider",
					run(_input, ctx) {
						calls.push(ctx.runId ?? "");
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "run-once", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "run-twice", attempt: 1 })],
		]);

		expect(calls).toEqual(["run-once"]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-twice", status: "mismatched-request" }),
			]),
		);
		expect(runtimeStatus).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-gap",
					issueCode: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
					metadata: expect.objectContaining({
						adapterInputId: ready.adapterInputId,
						attempt: 1,
						key: expect.stringMatching(/^key:[a-z0-9]+:\d+$/),
					}),
				}),
			]),
		);
		expect(JSON.stringify({ audit, runtimeStatus, issues })).not.toContain(
			`${ready.adapterInputId}:1`,
		);
	});

	it("keeps retained duplicate coordinates ahead of execution high-water gaps", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-coordinate-high-water-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-coordinate-high-water-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-coordinate-high-water-provider",
			"runtime-retention-coordinate-high-water-req",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				executions: {
					maxSize: 2,
					score(entry) {
						return entry.attempt === 1 || entry.attempt === 3 ? 10 : 0;
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-coordinate-high-water-provider",
					run(_input, ctx) {
						calls.push(`${ctx.runId}:${ctx.attempt}`);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "coord-keep-1", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "coord-trim-2", attempt: 2 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "coord-keep-3", attempt: 3 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "coord-duplicate-1", attempt: 1 })],
		]);

		expect(calls).toEqual(["coord-keep-1:1", "coord-trim-2:2", "coord-keep-3:3"]);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "executions" }),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "coord-duplicate-1", status: "mismatched-request" }),
			]),
		);
		expect(runStatus.filter((status) => status.runId === "coord-duplicate-1")).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-gap" })]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
	});

	it("bounds retention evidence horizon and fails closed after high-water proof is evicted", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-evidence-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-evidence-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-evidence-provider",
			"runtime-retention-evidence-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-evidence-provider",
			"runtime-retention-evidence-req-b",
		);
		const calls: string[] = [];
		const evidenceScorerEntries: unknown[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				executions: { maxSize: 1 },
				retentionEvidence: {
					maxSize: 1,
					score(entry) {
						evidenceScorerEntries.push(entry);
						return entry.adapterInputId === second.adapterInputId ? 10 : 0;
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-evidence-provider",
					run(input, ctx) {
						calls.push(`${input.adapterInputId}:${ctx.attempt}`);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([
			["DATA", first],
			["DATA", second],
		]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(first, { runId: "evidence-first", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(first, { runId: "evidence-first", attempt: 2 })],
			["DATA", requestToolProviderAdapterRun(second, { runId: "evidence-second", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(second, { runId: "evidence-second", attempt: 2 })],
			["DATA", requestToolProviderAdapterRun(first, { runId: "evidence-replay", attempt: 1 })],
		]);
		inputs.down([["DATA", first]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(first, {
					runId: "evidence-replay-after-input-reemit",
					attempt: 1,
				}),
			],
		]);

		expect(calls).toEqual([
			`${first.adapterInputId}:1`,
			`${first.adapterInputId}:2`,
			`${second.adapterInputId}:1`,
			`${second.adapterInputId}:2`,
		]);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-trimmed",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					issueCode: "tool-provider-adapter-runtime-retention-evidence-trimmed",
					metadata: expect.objectContaining({ evidenceKind: "execution-high-water" }),
				}),
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					runId: "evidence-replay",
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					metadata: expect.objectContaining({ gapKind: "evidence-horizon-closed" }),
				}),
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					runId: "evidence-replay-after-input-reemit",
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					metadata: expect.objectContaining({ gapKind: "evidence-horizon-closed" }),
				}),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "evidence-replay", status: "retention-gap" }),
				expect.objectContaining({
					runId: "evidence-replay-after-input-reemit",
					status: "retention-gap",
				}),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					subjectId: first.adapterInputId,
					details: expect.objectContaining({ gapKind: "evidence-horizon-closed" }),
				}),
			]),
		);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
				}),
			]),
		);
		expect(JSON.stringify(evidenceScorerEntries)).not.toMatch(/tool-output|arguments|raw/i);
		expect(evidenceScorerEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: expect.any(String),
					sequence: expect.any(Number),
					adapterInputId: first.adapterInputId,
					evidenceKind: "execution-high-water",
					attemptHighWater: expect.any(Number),
					reason: "execution-proof-retention",
				}),
			]),
		);
	});

	it("emits visible global fail-closed diagnostics after closed retentionEvidence marker overflow", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-evidence-global-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-evidence-global-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-evidence-global-provider",
			"runtime-retention-evidence-global-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-evidence-global-provider",
			"runtime-retention-evidence-global-req-b",
		);
		const third = readyToolProviderAdapterInput(
			"runtime-retention-evidence-global-provider",
			"runtime-retention-evidence-global-req-c",
		);
		const freshAfterGlobal = readyToolProviderAdapterInput(
			"runtime-retention-evidence-global-provider",
			"runtime-retention-evidence-global-req-d",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: true,
			retention: {
				executions: { maxSize: 1 },
				retentionEvidence: { maxSize: 1 },
			},
			bindings: [
				{
					providerId: "runtime-retention-evidence-global-provider",
					run(input, ctx) {
						calls.push(`${input.adapterInputId}:${ctx.attempt}`);
						return { kind: "result", result: { kind: "tool-output", value: "hidden-result" } };
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", first]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(first, { runId: "global-a-2", attempt: 2 })],
		]);
		inputs.down([["DATA", second]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(second, { runId: "global-b-2", attempt: 2 })],
		]);
		inputs.down([["DATA", third]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(third, { runId: "global-c-2", attempt: 2 })],
		]);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					metadata: expect.objectContaining({
						gapKind: "evidence-horizon-closed",
					}),
				}),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
				}),
			]),
		);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
				}),
			]),
		);

		inputs.down([["DATA", freshAfterGlobal]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(first, { runId: "global-a-3", attempt: 3 })],
		]);

		expect(calls).toEqual([
			`${first.adapterInputId}:1`,
			`${first.adapterInputId}:2`,
			`${second.adapterInputId}:1`,
			`${second.adapterInputId}:2`,
			`${third.adapterInputId}:1`,
		]);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					adapterInputId: first.adapterInputId,
					status: "result",
					attempt: 1,
				}),
				expect.objectContaining({
					adapterInputId: second.adapterInputId,
					status: "result",
					attempt: 1,
				}),
				expect.objectContaining({
					runId: "global-c-2",
					status: "retention-gap",
					attempt: 2,
				}),
				expect.objectContaining({
					adapterInputId: freshAfterGlobal.adapterInputId,
					status: "retention-gap",
				}),
				expect.objectContaining({
					runId: "global-a-3",
					status: "retention-gap",
					attempt: 3,
				}),
			]),
		);
		expect(
			runStatus.filter((status) => status.adapterInputId === freshAfterGlobal.adapterInputId),
		).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: "missing-input" })]));
		expect(runStatus.filter((status) => status.runId === "global-a-3")).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "missing-input" })]),
		);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					adapterInputId: freshAfterGlobal.adapterInputId,
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					metadata: expect.objectContaining({ gapKind: "evidence-horizon-closed" }),
				}),
				expect.objectContaining({
					status: "retention-gap",
					index: "retentionEvidence",
					adapterInputId: first.adapterInputId,
					runId: "global-a-3",
					attempt: 3,
					issueCode: "tool-provider-adapter-runtime-retention-evidence-horizon-closed",
					metadata: expect.objectContaining({ gapKind: "evidence-horizon-closed" }),
				}),
			]),
		);
		expect(JSON.stringify({ runtimeStatus, issues, audit })).not.toMatch(
			/hidden-result|arguments|rawResponse|stdout|stderr|stack/i,
		);
	});

	it("uses score-based retention over bounded public run request entries", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-score-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-score-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-score-provider",
			"runtime-retention-score-req",
		);
		const scorerEntries: unknown[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				runRequests: {
					maxSize: 1,
					score(entry) {
						scorerEntries.push(entry);
						return entry.runId === "keep-run" ? 10 : 0;
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-score-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([["DATA", ready]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(ready, {
					runId: "drop-run",
					attempt: 1,
					metadata: { rawResponse: "RAW_SHOULD_NOT_REACH_SCORER" },
				}),
			],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "keep-run", attempt: 2 })],
		]);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "runRequests" }),
			]),
		);
		expect(JSON.stringify(scorerEntries)).not.toMatch(/rawResponse|RAW_SHOULD_NOT_REACH_SCORER/);
		expect(scorerEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: expect.any(String),
					sequence: expect.any(Number),
					runId: "drop-run",
					adapterInputId: ready.adapterInputId,
					attempt: 1,
					requestId: ready.requestId,
					operationId: ready.operationId,
				}),
			]),
		);
	});
});
