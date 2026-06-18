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

function expectRetentionScorerEntryPayloadSafe(index: string, entry: unknown): void {
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 5", () => {
	it("keeps retention scorer entries bounded and payload-free across every runtime index", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-all-score-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-all-score-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-all-score-provider",
			"runtime-retention-all-score-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-all-score-provider",
			"runtime-retention-all-score-req-b",
		);
		const oversizedRunId = `all-score-oversized-${"x".repeat(500)}`;
		const firstWithPayload = {
			...first,
			toolCall: {
				...first.toolCall,
				arguments: {
					path: "README.md",
					password: "SCORER_SECRET_ARGUMENT",
					rawResponse: "SCORER_RAW_ARGUMENT",
				},
			},
			metadata: { apiKey: "SCORER_SECRET_INPUT_METADATA" },
			sourceRefs: [
				...(first.sourceRefs ?? []),
				{
					kind: "provider-raw",
					id: "raw-input-ref",
					metadata: { stdout: "SCORER_RAW_SOURCE_REF" },
				},
			],
		} satisfies ToolProviderAdapterInput;
		const entries = {
			adapterInputs: [] as unknown[],
			runRequests: [] as unknown[],
			executions: [] as unknown[],
			runStatuses: [] as unknown[],
			runIssues: [] as unknown[],
			retentionEvidence: [] as unknown[],
		};
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				adapterInputs: {
					maxSize: 1,
					score(entry) {
						entries.adapterInputs.push(entry);
						return entry.adapterInputId === second.adapterInputId ? 10 : 0;
					},
				},
				runRequests: {
					maxSize: 1,
					score(entry) {
						entries.runRequests.push(entry);
						return entry.runId.startsWith("all-score-b") ? 10 : 0;
					},
				},
				executions: {
					maxSize: 1,
					score(entry) {
						entries.executions.push(entry);
						return entry.adapterInputId === second.adapterInputId ? 10 : 0;
					},
				},
				runStatuses: {
					maxSize: 1,
					score(entry) {
						entries.runStatuses.push(entry);
						return entry.runId === undefined || entry.runId.startsWith("all-score-b") ? 10 : 0;
					},
				},
				runIssues: {
					maxSize: 1,
					score(entry) {
						entries.runIssues.push(entry);
						return entry.subjectId === second.requestId ? 10 : 0;
					},
				},
				retentionEvidence: {
					maxSize: 1,
					score(entry) {
						entries.retentionEvidence.push(entry);
						return entry.adapterInputId === second.adapterInputId ? 10 : 0;
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-all-score-provider",
					run() {
						return {
							kind: "result",
							result: {
								kind: "tool-output",
								value: { stdout: "SCORER_RAW_STDOUT_VALUE" },
							},
							metadata: { rawResponse: "SCORER_RAW_PROVIDER_RESPONSE" },
						};
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", firstWithPayload]]);
		runRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(firstWithPayload, {
					runId: oversizedRunId,
					attempt: 1,
				}),
			],
		]);
		inputs.down([["DATA", second]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(second, { runId: "all-score-b", attempt: 1 })],
		]);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "adapterInputs" }),
				expect.objectContaining({ status: "retention-trimmed", index: "runRequests" }),
				expect.objectContaining({ status: "retention-trimmed", index: "executions" }),
				expect.objectContaining({ status: "retention-trimmed", index: "runStatuses" }),
				expect.objectContaining({ status: "retention-trimmed", index: "runIssues" }),
				expect.objectContaining({ status: "retention-trimmed", index: "retentionEvidence" }),
			]),
		);
		for (const [index, captured] of Object.entries(entries)) {
			expect(captured.length, `${index} scorer should run`).toBeGreaterThan(0);
			for (const entry of captured) expectRetentionScorerEntryPayloadSafe(index, entry);
		}
		expect(
			(entries.runRequests as { readonly runId?: string }[]).some(
				(entry) =>
					typeof entry.runId === "string" &&
					entry.runId.startsWith("bounded:") &&
					entry.runId.endsWith(`:${oversizedRunId.length}`),
			),
		).toBe(true);
		expectNoForbiddenRetentionPayload({ entries, runtimeStatus, issues, audit });
	});

	it("makes Node-valued retention maxSize describe-visible and downsizing trims", () => {
		const g = graph();
		const maxSize = g.state(2, { name: "retentionMax" });
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-node-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-node-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-node-provider",
			"runtime-retention-node-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			name: "runtimeRetentionNode",
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { executions: { maxSize } },
			bindings: [
				{
					providerId: "runtime-retention-node-provider",
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
		const described = g.describe();
		expect(
			described.nodes.find((node) => node.id === "runtimeRetentionNode/retentionPolicy")?.factory,
		).toBe("toolProviderAdapterRuntimeRetentionPolicy");
		expect(described.edges).toContainEqual({
			from: "retentionMax",
			to: "runtimeRetentionNode/retentionPolicy",
		});

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "node-run", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "node-run", attempt: 2 })],
		]);
		maxSize.set(1);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "executions" }),
			]),
		);
	});

	it("keeps last-known-good retention policy for invalid maxSize/order/scorer without leaking throws", () => {
		const g = graph();
		const maxSize = g.state(2, { name: "invalidRetentionMax" });
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-invalid-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-invalid-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-invalid-provider",
			"runtime-retention-invalid-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				executions: { maxSize },
				runStatuses: { maxSize: 1 },
				runRequests: {
					maxSize: 1,
					score() {
						throw new Error("secret-score-throw");
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-invalid-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const issues: DataIssue[] = [];
		const audit: unknown[] = [];
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", ready]]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "invalid-run", attempt: 1 })],
			["DATA", requestToolProviderAdapterRun(ready, { runId: "invalid-run", attempt: 2 })],
		]);
		maxSize.set(0);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(ready, { runId: "invalid-run", attempt: 3 })],
		]);

		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "invalid-retention-policy" }),
				expect.objectContaining({ status: "retention-trimmed", index: "runStatuses" }),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-invalid-retention-policy",
				}),
				expect.objectContaining({
					code: "tool-provider-adapter-retention-score-invalid",
				}),
			]),
		);
		expect(JSON.stringify({ runtimeStatus, issues, audit })).not.toContain("secret-score-throw");

		const orderGraph = graph();
		const orderInputs = orderGraph.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-order-inputs",
		});
		const orderRuntime = attachToolProviderAdapterRuntime(orderGraph, {
			inputs: orderInputs,
			autoRunReadyInputs: false,
			retention: { runStatuses: { maxSize: 1, order: "lifo" as "fifo" } },
			bindings: [],
		});
		const orderIssues: DataIssue[] = [];
		orderRuntime.issues.subscribe(
			(msg) => msg[0] === "DATA" && orderIssues.push(msg[1] as DataIssue),
		);
		expect(orderIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-invalid-retention-policy",
				}),
			]),
		);

		const evidenceGraph = graph();
		const evidenceInputs = evidenceGraph.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-evidence-score-inputs",
		});
		const evidenceRunRequests = evidenceGraph.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-evidence-score-runs",
		});
		const evidenceFirst = readyToolProviderAdapterInput(
			"runtime-retention-evidence-score-provider",
			"runtime-retention-evidence-score-req-a",
		);
		const evidenceSecond = readyToolProviderAdapterInput(
			"runtime-retention-evidence-score-provider",
			"runtime-retention-evidence-score-req-b",
		);
		const evidenceScorerEntries: unknown[] = [];
		const evidenceRuntime = attachToolProviderAdapterRuntime(evidenceGraph, {
			inputs: evidenceInputs,
			runRequests: [evidenceRunRequests],
			autoRunReadyInputs: false,
			retention: {
				executions: { maxSize: 1 },
				retentionEvidence: {
					maxSize: 1,
					score(entry) {
						evidenceScorerEntries.push(entry);
						throw new Error("secret-evidence-score-throw");
					},
				},
			},
			bindings: [
				{
					providerId: "runtime-retention-evidence-score-provider",
					run() {
						return { kind: "result", result: { kind: "tool-output", value: "hidden" } };
					},
				},
			],
		});
		const evidenceRuntimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const evidenceIssues: DataIssue[] = [];
		const evidenceAudit: unknown[] = [];
		evidenceRuntime.runtimeStatus.subscribe(
			(msg) =>
				msg[0] === "DATA" && evidenceRuntimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		evidenceRuntime.issues.subscribe(
			(msg) => msg[0] === "DATA" && evidenceIssues.push(msg[1] as DataIssue),
		);
		evidenceRuntime.audit.subscribe((msg) => msg[0] === "DATA" && evidenceAudit.push(msg[1]));

		evidenceInputs.down([
			["DATA", evidenceFirst],
			["DATA", evidenceSecond],
		]);
		evidenceRunRequests.down([
			[
				"DATA",
				requestToolProviderAdapterRun(evidenceFirst, {
					runId: "evidence-score-a-1",
					attempt: 1,
				}),
			],
			[
				"DATA",
				requestToolProviderAdapterRun(evidenceFirst, {
					runId: "evidence-score-a-2",
					attempt: 2,
				}),
			],
			[
				"DATA",
				requestToolProviderAdapterRun(evidenceSecond, {
					runId: "evidence-score-b-1",
					attempt: 1,
				}),
			],
			[
				"DATA",
				requestToolProviderAdapterRun(evidenceSecond, {
					runId: "evidence-score-b-2",
					attempt: 2,
				}),
			],
		]);

		expect(evidenceRuntimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "invalid-retention-policy",
					index: "retentionEvidence",
					issueCode: "tool-provider-adapter-retention-score-invalid",
				}),
			]),
		);
		expect(evidenceIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-retention-score-invalid",
				}),
			]),
		);
		expect(JSON.stringify({ evidenceRuntimeStatus, evidenceIssues, evidenceAudit })).not.toContain(
			"secret-evidence-score-throw",
		);
		expect(JSON.stringify(evidenceScorerEntries)).not.toMatch(/tool-output|arguments|raw/i);
	});

	it("does not recursively feed runIssues when its retention scorer is invalid", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-run-issues-score-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-run-issues-score-runs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-retention-run-issues-score-provider",
			"runtime-retention-run-issues-score-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: {
				runIssues: {
					maxSize: 1,
					score() {
						throw new Error("recursive-score-secret");
					},
				},
			},
			bindings: [],
		});
		const issues: DataIssue[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);

		inputs.down([["DATA", ready]]);
		expect(() =>
			runRequests.down([
				[
					"DATA",
					{
						...requestToolProviderAdapterRun(ready, { runId: "run-issues-score-invalid" }),
						requestId: "stale-request",
					},
				],
			]),
		).not.toThrow();

		expect(
			issues.filter((issue) => issue.code === "tool-provider-adapter-retention-score-invalid"),
		).toHaveLength(1);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "invalid-retention-policy",
					index: "runIssues",
					issueCode: "tool-provider-adapter-retention-score-invalid",
				}),
			]),
		);
		expect(JSON.stringify({ issues, runtimeStatus })).not.toContain("recursive-score-secret");
	});

	it("gaps explicit run requests after adapterInputs retention trims the input cache", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-input-cache-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-input-cache-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-input-cache-provider",
			"runtime-retention-input-cache-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-input-cache-provider",
			"runtime-retention-input-cache-req-b",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { adapterInputs: { maxSize: 1 } },
			bindings: [
				{
					providerId: "runtime-retention-input-cache-provider",
					run(input) {
						calls.push(input.adapterInputId);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		const runtimeStatus: ToolProviderAdapterRuntimeStatus[] = [];
		const emittedRequests: ToolProviderAdapterRunRequested[] = [];
		const audit: unknown[] = [];
		runtime.runRequests.subscribe(
			(msg) => msg[0] === "DATA" && emittedRequests.push(msg[1] as ToolProviderAdapterRunRequested),
		);
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);
		runtime.runtimeStatus.subscribe(
			(msg) => msg[0] === "DATA" && runtimeStatus.push(msg[1] as ToolProviderAdapterRuntimeStatus),
		);
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([
			["DATA", first],
			["DATA", second],
		]);
		runRequests.down([
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(first, { runId: "trimmed-input" }),
					metadata: { rawResponse: "RAW_RETAINED_REQUEST_METADATA" },
					sourceRefs: [
						{
							kind: "provider-raw",
							id: "raw-retained-request",
							metadata: { stdout: "RAW_RETAINED_REQUEST_SOURCE_REF" },
						},
					],
					rawResponse: "RAW_RETAINED_REQUEST_TOP_LEVEL",
				} as unknown as ToolProviderAdapterRunRequested,
			],
		]);

		expect(calls).toEqual([]);
		expect(emittedRequests).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					runId: "trimmed-input",
					adapterInputId: first.adapterInputId,
					requestId: first.requestId,
				}),
			]),
		);
		expect(runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "retention-trimmed", index: "adapterInputs" }),
				expect.objectContaining({
					status: "retention-gap",
					index: "adapterInputs",
					issueCode: "tool-provider-adapter-runtime-retention-gap",
					metadata: expect.objectContaining({
						gapKind: "adapter-input-trimmed",
						evidenceKind: "adapter-input-trimmed",
					}),
				}),
			]),
		);
		expect(runStatus).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-gap" })]),
		);
		expect(runStatus.filter((status) => status.runId === "trimmed-input")).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "retention-gap" })]),
		);
		expect(runStatus.filter((status) => status.runId === "trimmed-input")).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "missing-input" })]),
		);
		expect(JSON.stringify({ emittedRequests, audit, runStatus, runtimeStatus })).not.toMatch(
			/RAW_RETAINED_REQUEST|rawResponse|stdout/,
		);
	});

	it("refreshes FIFO retention order when an adapter input is re-emitted", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-retention-refresh-inputs",
		});
		const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
			name: "runtime-retention-refresh-runs",
		});
		const first = readyToolProviderAdapterInput(
			"runtime-retention-refresh-provider",
			"runtime-retention-refresh-req-a",
		);
		const second = readyToolProviderAdapterInput(
			"runtime-retention-refresh-provider",
			"runtime-retention-refresh-req-b",
		);
		const calls: string[] = [];
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			runRequests: [runRequests],
			autoRunReadyInputs: false,
			retention: { adapterInputs: { maxSize: 1 } },
			bindings: [
				{
					providerId: "runtime-retention-refresh-provider",
					run(input) {
						calls.push(input.adapterInputId);
						return { kind: "result", result: { kind: "tool-output" } };
					},
				},
			],
		});
		const runStatus: ToolProviderAdapterRunStatus[] = [];
		runtime.runStatus.subscribe(
			(msg) => msg[0] === "DATA" && runStatus.push(msg[1] as ToolProviderAdapterRunStatus),
		);

		inputs.down([
			["DATA", first],
			["DATA", second],
			["DATA", first],
		]);
		runRequests.down([
			["DATA", requestToolProviderAdapterRun(first, { runId: "refreshed-first" })],
			["DATA", requestToolProviderAdapterRun(second, { runId: "trimmed-second" })],
		]);

		expect(calls).toEqual([first.adapterInputId]);
		expect(runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "refreshed-first", status: "started" }),
				expect.objectContaining({ runId: "trimmed-second", status: "retention-gap" }),
			]),
		);
	});
});
