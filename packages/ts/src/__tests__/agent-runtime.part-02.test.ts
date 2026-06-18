import { describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { graph } from "../graph/graph.js";
import {
	type AgentDecisionContinue,
	type AgentRequestIssued,
	type AgentRequestStatusChanged,
	admitAgentRequestProposal,
	agentRequestProposalFromDecision,
	buildToolProviderAdapterInputs,
	type ExecutorOutcome,
	type ExecutorRoute,
	issueAgentRequest,
	localBuiltinToolProviderCatalog,
	resolveToolProviderExecutionPolicies,
	type SourceRef,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunResult,
	type ToolProviderCatalog,
	type ToolProviderExecutionPolicy,
} from "../orchestration/agent-runtime.js";
import { attachToolProviderAdapterRuntime } from "../orchestration/agent-runtime-adapter-runtime.js";
import type { ToolProviderAdapterBinding } from "../orchestration/agent-runtime-types-tool.js";
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 2", () => {
	it("scopes D360 tool policy refs and omits stale default policy sections", () => {
		const scopedCatalog = localBuiltinToolProviderCatalog({
			providerId: "scoped",
			tools: [
				{ toolName: "file.read", operation: "read" },
				{ toolName: "bash.run", operation: "run" },
			],
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "scoped:policy:file-read",
					providerId: "scoped",
					toolNames: ["file.read"],
					operations: ["read"],
					sizeCapacity: { limits: [{ unit: "chars", hardLimit: 100 }] },
				},
				{
					kind: "tool-provider-execution-policy",
					policyId: "scoped:policy:bash",
					providerId: "scoped",
					toolNames: ["bash.run"],
					operations: ["run"],
					timeout: { timeoutMs: 1000 },
				},
			],
		});
		expect(scopedCatalog.profiles[0]?.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:file-read" },
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:bash" },
		]);
		expect(scopedCatalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:file-read" },
		]);
		expect(scopedCatalog.tools.find((tool) => tool.toolName === "bash.run")?.policyRefs).toEqual([
			{ kind: "tool-provider-execution-policy", id: "scoped:policy:bash" },
		]);

		const dateOnlyCatalog = localBuiltinToolProviderCatalog({
			providerId: "date-only",
			tools: [{ toolName: "date.now", operation: "read" }],
		});
		expect(dateOnlyCatalog.policies?.[0]?.toolNames).toEqual(["date.now"]);
		expect(dateOnlyCatalog.policies?.[0]?.network).toBeUndefined();
		expect(dateOnlyCatalog.policies?.[0]?.filesystem).toBeUndefined();
		expect(dateOnlyCatalog.policies?.[0]?.approval).toMatchObject({ mode: "auto" });

		const invalidCatalog = localBuiltinToolProviderCatalog({
			providerId: "invalid",
			policyOverrides: {
				metadata: {
					apiKey: "do-not-publish",
					rawResponse: "RAW_POLICY_SHOULD_NOT_PROJECT",
				},
			},
		});
		expect(invalidCatalog.status).toBe("misconfigured");
		expect(invalidCatalog.policies).toEqual([]);
		expect(invalidCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-forbidden-runtime-material" }),
			]),
		);
		expect(JSON.stringify(invalidCatalog)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential|rawResponse|RAW_POLICY_SHOULD_NOT_PROJECT/i,
		);
		const malformedCatalog = localBuiltinToolProviderCatalog({
			providerId: "malformed",
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "malformed:policy",
					providerId: "malformed",
					sizeCapacity: { limits: [{ unit: "bytes", softLimit: 2, hardLimit: 1 }] },
				},
			],
		});
		expect(malformedCatalog.status).toBe("misconfigured");
		expect(malformedCatalog.policies).toEqual([]);
		expect(malformedCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-invalid-size-limit" }),
			]),
		);
	});

	it("sanitizes issued request material before it reaches graph-visible ledgers", () => {
		const decision: AgentDecisionContinue = {
			kind: "continue",
			decisionId: "decision-issue-sanitize",
			effectRunId: "run-issue-sanitize",
			agentRunId: "agent-issue-sanitize",
			source: { requestId: "seed", operationId: "seed-op", outcomeId: "seed-outcome" },
			next: [],
		};
		const proposal = agentRequestProposalFromDecision(decision, {
			proposalId: "proposal-issue-sanitize",
			requestKind: "executor",
			input: {
				inputId: "input-issue-sanitize",
				inputKind: "tool-call",
				dataMode: "inline",
				value: { rawResponse: "RAW_REQUEST_INPUT_SHOULD_NOT_PROJECT" },
				subjectRefs: [
					{
						kind: "provider-raw",
						id: "input-ref",
						metadata: { stdout: "RAW_REQUEST_INPUT_REF_SHOULD_NOT_PROJECT" },
						client: "RAW_REQUEST_INPUT_REF_EXTRA_SHOULD_NOT_PROJECT",
					} as unknown as SourceRef,
				],
				metadata: { apiKey: "REQUEST_INPUT_SECRET" },
			},
			payload: { providerRaw: "RAW_REQUEST_PAYLOAD_SHOULD_NOT_PROJECT" },
			metadata: { rawResponse: "RAW_REQUEST_METADATA_SHOULD_NOT_PROJECT" },
		});
		const admitted = admitAgentRequestProposal(proposal, {
			requestId: "request-issue-sanitize",
			operationId: "op-issue-sanitize",
			reason: `${"admit-reason-".repeat(80)}RAW_ADMISSION_REASON_SHOULD_NOT_PROJECT`,
			sourceRefs: [
				{
					kind: "provider-raw",
					id: "admission-ref",
					metadata: { stderr: "RAW_REQUEST_SOURCE_REF_SHOULD_NOT_PROJECT" },
					rawResponse: "RAW_REQUEST_SOURCE_REF_EXTRA_SHOULD_NOT_PROJECT",
				} as unknown as SourceRef,
			],
			metadata: { rawResponse: "RAW_ADMISSION_METADATA_SHOULD_NOT_PROJECT" },
		});

		const issuedRequest = issueAgentRequest(proposal, admitted);

		expect(admitted.reason?.length).toBeLessThanOrEqual(512);
		expect(admitted.sourceRefs).toEqual([{ kind: "provider-raw", id: "admission-ref" }]);
		expect(admitted).not.toHaveProperty("metadata");
		expect(issuedRequest.input).toMatchObject({
			inputId: "input-issue-sanitize",
			inputKind: "tool-call",
			dataMode: "inline",
		});
		expect(issuedRequest.input).not.toHaveProperty("value");
		expect(issuedRequest.input).not.toHaveProperty("metadata");
		expect(issuedRequest.input?.subjectRefs).toEqual([{ kind: "provider-raw", id: "input-ref" }]);
		expect(issuedRequest).not.toHaveProperty("payload");
		expect(issuedRequest).not.toHaveProperty("metadata");
		expect(issuedRequest.sourceRefs).toEqual([{ kind: "provider-raw", id: "admission-ref" }]);
		expect(JSON.stringify(issuedRequest)).not.toMatch(
			/RAW_REQUEST_|RAW_ADMISSION_|rawResponse|providerRaw|stdout|stderr|client|apiKey|REQUEST_INPUT_SECRET/,
		);
		expect(JSON.stringify(admitted)).not.toMatch(/RAW_ADMISSION_|rawResponse|stderr/);

		const mutablePayload = { nested: { public: "ok" } };
		const safeProposal = agentRequestProposalFromDecision(decision, {
			proposalId: "proposal-mutable-issue-sanitize",
			requestKind: "executor",
			payload: mutablePayload,
		});
		const mutableIssued = issueAgentRequest(safeProposal, {
			...admitted,
			proposalId: safeProposal.proposalId,
			requestId: "request-mutable-issue-sanitize",
		});
		mutablePayload.nested = {
			public: "ok",
			rawResponse: "RAW_MUTATED_REQUEST_PAYLOAD_SHOULD_NOT_PROJECT",
		} as typeof mutablePayload.nested;
		expect(JSON.stringify(mutableIssued)).not.toMatch(/RAW_MUTATED_REQUEST_PAYLOAD|rawResponse/);
		expect(mutableIssued.payload).toEqual({ nested: { public: "ok" } });
	});

	it("keeps local builtin catalog caller material data-only and provider-scoped", () => {
		const leakyCatalog = localBuiltinToolProviderCatalog({
			providerId: "leaky",
			metadata: { apiKey: "do-not-publish", rawResponse: "RAW_CATALOG_METADATA" },
			capabilities: { client: "do-not-publish", stdout: "RAW_CATALOG_CAPABILITY" },
			tools: [
				{
					toolName: "file.read",
					operation: "read",
					metadata: { secret: "do-not-publish", stderr: "RAW_TOOL_METADATA" },
					capabilities: { transport: "do-not-publish", rawResponse: "RAW_TOOL_CAPABILITY" },
					policyRefs: [{ kind: "foreign-policy", id: "stale" }],
				},
			],
			policyOverrides: {
				providerId: "foreign",
				policyId: "secret-policy-id",
			} as Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">>,
		});
		expect(leakyCatalog.status).toBe("misconfigured");
		expect(leakyCatalog.policies?.[0]).toMatchObject({
			policyId: "leaky:policy:default",
			providerId: "leaky",
		});
		expect(leakyCatalog.tools[0]?.policyRefs).toEqual(leakyCatalog.policyRefs);
		expect(leakyCatalog.metadata).toBeUndefined();
		expect(leakyCatalog.profiles[0]?.capabilities).toEqual({ toolNames: ["file.read"] });
		expect(leakyCatalog.tools[0]?.metadata).toBeUndefined();
		expect(leakyCatalog.tools[0]?.capabilities).toBeUndefined();
		expect(leakyCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-catalog-forbidden-runtime-material",
				}),
			]),
		);
		expect(JSON.stringify(leakyCatalog)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential|rawResponse|RAW_/i,
		);

		const foreignPolicyCatalog = localBuiltinToolProviderCatalog({
			providerId: "provider-a",
			policies: [
				{
					kind: "tool-provider-execution-policy",
					policyId: "foreign-policy",
					providerId: "provider-b",
					timeout: { timeoutMs: 1000 },
				},
			],
		});
		expect(foreignPolicyCatalog.status).toBe("misconfigured");
		expect(foreignPolicyCatalog.policies).toEqual([]);
		expect(foreignPolicyCatalog.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-provider-mismatch" }),
			]),
		);
	});

	it("resolves D360 policy material for routed tool-call requests without executing tools", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "resolver" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("tool-req", "tool-op", "file.read", "read");
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "tool-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
		};

		expect(resolveToolProviderExecutionPolicies({ request, catalogs: [catalog] })).toEqual([
			expect.objectContaining({
				kind: "tool-provider-policy-resolution",
				status: "pending-route",
				requestId: "tool-req",
				toolName: "file.read",
			}),
		]);
		expect(
			resolveToolProviderExecutionPolicies({ request, routes: [route], catalogs: [catalog] }),
		).toEqual([
			expect.objectContaining({
				kind: "tool-provider-policy-resolution",
				status: "resolved",
				routeId: "tool-route",
				providerId: "resolver",
				policyRefs: catalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs,
			}),
		]);

		const wrongKindCatalog: ToolProviderCatalog = {
			...catalog,
			tools: catalog.tools.map((tool) =>
				tool.toolName === "file.read"
					? {
							...tool,
							policyRefs: [{ kind: "other-policy", id: catalog.policies?.[0]?.policyId ?? "" }],
						}
					: tool,
			),
		};
		expect(
			resolveToolProviderExecutionPolicies({
				request,
				routes: [route],
				catalogs: [wrongKindCatalog],
			}),
		).toEqual([
			expect.objectContaining({
				status: "invalid-policy",
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "tool-provider-policy-invalid-ref-kind" }),
				]),
			}),
		]);
	});

	it("builds ready D360 adapter inputs from routed tool-call policy resolutions", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-req", "adapter-op", "file.read", "read");
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
			allowedParams: { cwd: ".", timeoutMs: 1000 },
		};
		const resolutions = resolveToolProviderExecutionPolicies({
			request,
			routes: [route],
			catalogs: [catalog],
		});

		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions,
		});

		expect(inputs).toEqual([
			expect.objectContaining({
				kind: "tool-provider-adapter-input",
				status: "ready",
				requestId: "adapter-req",
				operationId: "adapter-op",
				routeId: "adapter-route",
				providerId: "adapter",
				executorId: profile.executorId,
				profileId: profile.profileId,
				toolName: "file.read",
				operation: "read",
				toolCall: expect.objectContaining({ kind: "tool-call", toolName: "file.read" }),
				policies: catalog.policies,
				policyRefs: catalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs,
			}),
		]);
		expect(inputs[0]?.input).toBe(request.input);
		expect(inputs[0]?.route).toBe(route);
		expect(inputs[0]?.policies?.[0]).toBe(catalog.policies?.[0]);
		expect(JSON.stringify(inputs)).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);
	});

	it("attaches runtime-private tool provider bindings and publishes neutral outcomes", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-provider", "runtime-req");
		const calls: ToolProviderAdapterInput[] = [];
		const binding: ToolProviderAdapterBinding = {
			providerId: "runtime-provider",
			run(input) {
				calls.push(input);
				return {
					kind: "result",
					result: {
						kind: "tool-output",
						value: { ok: true },
						summary: "fake adapter result",
					},
					usage: { latencyMs: 7 },
				};
			},
		};
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [binding],
			now: () => 123,
		});
		const outcomes: ExecutorOutcome[] = [];
		const status: AgentRequestStatusChanged[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.status.subscribe(
			(msg) => msg[0] === "DATA" && status.push(msg[1] as AgentRequestStatusChanged),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));

		inputs.down([["DATA", { ...ready, status: "missing-policy" }]]);
		inputs.down([["DATA", ready]]);

		expect(calls).toEqual([ready]);
		expect(status.map((fact) => fact.status)).toEqual(["in-flight", "completed"]);
		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				requestId: "runtime-req",
				operationId: "runtime-req-op",
				routeId: "runtime-req-route",
				executorId: ready.executorId,
				profileId: ready.profileId,
				attempt: 1,
				occurredAtMs: 123,
				usage: { latencyMs: 7 },
				result: expect.objectContaining({ summary: "fake adapter result" }),
			}),
		]);
		expect(issues).toEqual([]);
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "tool-provider-adapter-runtime-started" }),
				expect.objectContaining({ kind: "tool-provider-adapter-runtime-finished" }),
			]),
		);
		runtime.dispose();
	});

	it("reports missing tool provider runtime bindings as blocked outcomes", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-missing-inputs" });
		const runtime = attachToolProviderAdapterRuntime(g, { inputs, bindings: [] });
		const ready = readyToolProviderAdapterInput("missing-runtime-provider", "missing-runtime-req");
		const outcomes: ExecutorOutcome[] = [];
		const status: AgentRequestStatusChanged[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.status.subscribe(
			(msg) => msg[0] === "DATA" && status.push(msg[1] as AgentRequestStatusChanged),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "blocked",
				requestId: "missing-runtime-req",
				needs: [expect.objectContaining({ kind: "tool-provider-binding" })],
			}),
		]);
		expect(status.at(-1)).toMatchObject({ status: "blocked" });
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-runtime-missing-binding" }),
			]),
		);
	});

	it("blocks runtime-private material returned by tool provider bindings", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-leak-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-leak-provider", "runtime-leak-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-leak-provider",
					run() {
						return {
							kind: "result",
							result: {
								kind: "tool-output",
								value: { accessToken: "secret-token" },
							},
						};
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "tool-provider-adapter-runtime-forbidden-runtime-material",
				}),
			}),
		]);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-forbidden-runtime-material",
				}),
			]),
		);
		expect(JSON.stringify({ outcomes, issues })).not.toMatch(/accessToken|secret-token/i);
	});

	it("blocks non-plain runtime objects returned by tool provider bindings", () => {
		class RuntimeClient {}
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-object-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-object-provider", "runtime-object-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-object-provider",
					run() {
						return {
							kind: "result",
							result: {
								kind: "tool-output",
								value: new RuntimeClient(),
							},
						};
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: DataIssue[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "tool-provider-adapter-runtime-forbidden-runtime-material",
				}),
			}),
		]);
		expect(issues.at(-1)).toMatchObject({
			code: "tool-provider-adapter-runtime-forbidden-runtime-material",
		});
	});

	it("does not expose thrown adapter error messages as graph material", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-throw-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-throw-provider", "runtime-throw-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-throw-provider",
					run() {
						throw new Error("secret-token should stay runtime-private");
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({ code: "tool-provider-adapter-runtime-threw" }),
			}),
		]);
		expect(issues).toEqual([
			expect.objectContaining({ code: "tool-provider-adapter-runtime-threw" }),
		]);
		expect(JSON.stringify({ outcomes, issues })).not.toContain("secret-token");
	});

	it("rejects async adapter results without subscribing to hidden runtime work", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, { name: "runtime-reject-inputs" });
		const ready = readyToolProviderAdapterInput("runtime-reject-provider", "runtime-reject-req");
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-reject-provider",
					run() {
						const thenKey = ["th", "en"].join("");
						return Object.defineProperty({}, thenKey, {
							value() {
								throw new Error("provider raw stack secret should not project");
							},
						}) as unknown as ToolProviderAdapterRunResult;
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: unknown[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1]));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "tool-provider-adapter-runtime-async-result-unsupported",
				}),
			}),
		]);
		expect(issues).toEqual([
			expect.objectContaining({
				code: "tool-provider-adapter-runtime-async-result-unsupported",
			}),
		]);
		expect(JSON.stringify({ outcomes, issues })).not.toMatch(/provider raw stack secret/i);
	});

	it("does not let a hostile thenable getter strand an execution proof", () => {
		const g = graph();
		const inputs = g.node<ToolProviderAdapterInput>([], null, {
			name: "runtime-hostile-thenable-inputs",
		});
		const ready = readyToolProviderAdapterInput(
			"runtime-hostile-thenable-provider",
			"runtime-hostile-thenable-req",
		);
		const runtime = attachToolProviderAdapterRuntime(g, {
			inputs,
			bindings: [
				{
					providerId: "runtime-hostile-thenable-provider",
					run() {
						const thenKey = ["th", "en"].join("");
						return Object.defineProperty({}, thenKey, {
							get() {
								throw new Error("raw then getter secret");
							},
						}) as unknown as ToolProviderAdapterRunResult;
					},
				},
			],
		});
		const outcomes: ExecutorOutcome[] = [];
		const issues: DataIssue[] = [];
		runtime.outcomes.subscribe(
			(msg) => msg[0] === "DATA" && outcomes.push(msg[1] as ExecutorOutcome),
		);
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && issues.push(msg[1] as DataIssue));

		inputs.down([["DATA", ready]]);

		expect(outcomes).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "tool-provider-adapter-runtime-async-result-unsupported",
				}),
			}),
		]);
		expect(issues).toEqual([
			expect.objectContaining({
				code: "tool-provider-adapter-runtime-async-result-unsupported",
			}),
		]);
		expect(JSON.stringify({ outcomes, issues })).not.toContain("raw then getter secret");
	});
});
