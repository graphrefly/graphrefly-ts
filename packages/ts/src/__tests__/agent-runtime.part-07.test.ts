import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	buildToolProviderAdapterInputs,
	type ExecutorRoute,
	localBuiltinToolProviderCatalog,
	resolveToolProviderExecutionPolicies,
	type ToolProviderAdapterInput,
	type ToolProviderCatalog,
	type ToolProviderPolicyResolution,
	toolProviderAdapterInputProjector,
	toolProviderPolicyResolutionProjector,
	validateToolProviderExecutionPolicy,
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

describe("CSP-8 experimental agent runtime kernel (D236) — part 7", () => {
	it("projects adapter inputs, issues, and audit without executing real tool providers", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requests" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const catalogs = g.node<ToolProviderCatalog>([], null, { name: "catalogs" });
		const resolutions = toolProviderPolicyResolutionProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
		});
		const adapterInputs = toolProviderAdapterInputProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
			policyResolutions: [resolutions.resolutions],
		});
		const inputs: ToolProviderAdapterInput[] = [];
		const issues: unknown[] = [];
		const audit: unknown[] = [];
		const protocolErrors: unknown[] = [];
		adapterInputs.inputs.subscribe((msg) => {
			if (msg[0] === "DATA") inputs.push(msg[1] as ToolProviderAdapterInput);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		adapterInputs.issues.subscribe((msg) => {
			if (msg[0] === "DATA") issues.push(msg[1]);
			if (msg[0] === "ERROR") protocolErrors.push(msg[1]);
		});
		adapterInputs.audit.subscribe((msg) => msg[0] === "DATA" && audit.push(msg[1]));
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter-projector" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-proj-req", "adapter-proj-op", "file.read", "read");

		requestFacts.down([["DATA", request]]);
		catalogs.down([["DATA", catalog]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "adapter-proj-route",
					requestId: "adapter-proj-req",
					operationId: "adapter-proj-op",
					executorId: profile.executorId,
					profileId: profile.profileId,
					inputKind: "tool-call",
				},
			],
		]);

		expect(inputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "ready",
					requestId: "adapter-proj-req",
					routeId: "adapter-proj-route",
					providerId: "adapter-projector",
					toolName: "file.read",
					policies: catalog.policies,
				}),
			]),
		);
		expect(audit.at(-1)).toMatchObject({
			kind: "tool-provider-adapter-input",
			subjectId: "adapter-proj-req",
		});
		expect(protocolErrors).toEqual([]);
		expect(JSON.stringify({ inputs, issues, audit })).not.toMatch(
			/apiKey|secret|client|transport|subprocess|sdk|oauth|credential/i,
		);

		const bareCatalog: ToolProviderCatalog = {
			kind: "tool-provider-catalog",
			providerId: "adapter-bare",
			providerKind: "local-builtin",
			status: "ready",
			profiles: [
				{
					profileId: "adapter-bare-profile",
					executorId: "adapter-bare-exec",
					kind: "tool",
					acceptedInputKinds: ["tool-call"],
				},
			],
			tools: [
				{
					kind: "tool-catalog-entry",
					providerId: "adapter-bare",
					toolName: "file.read",
					operation: "read",
					inputKind: "tool-call",
					profileId: "adapter-bare-profile",
					executorId: "adapter-bare-exec",
				},
			],
			policies: [],
			policyRefs: [],
		};
		const missingPolicyRequest = toolRequest(
			"adapter-issue-req",
			"adapter-issue-op",
			"file.read",
			"read",
		);
		requestFacts.down([["DATA", missingPolicyRequest]]);
		catalogs.down([["DATA", bareCatalog]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "adapter-issue-route",
					requestId: "adapter-issue-req",
					operationId: "adapter-issue-op",
					executorId: "adapter-bare-exec",
					profileId: "adapter-bare-profile",
					inputKind: "tool-call",
				},
			],
		]);

		expect(inputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "missing-policy",
					requestId: "adapter-issue-req",
					routeId: "adapter-issue-route",
					input: undefined,
					toolCall: undefined,
					policies: undefined,
				}),
			]),
		);
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-missing-policy-ref" }),
			]),
		);
		expect(protocolErrors).toEqual([]);
	});

	it("blocks runtime-private keys from adapter inputs as DataIssue material", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter-scan" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request: AgentRequestIssued = {
			...toolRequest("adapter-scan-req", "adapter-scan-op", "file.read", "read"),
			input: {
				inputId: "adapter-scan-input",
				inputKind: "tool-call",
				dataMode: "inline",
				value: {
					kind: "tool-call",
					toolName: "file.read",
					operation: "read",
					arguments: {
						path: "README.md",
						accessToken: "do-not-project",
						rawResponse: "RAW_REQUEST_ARGUMENTS",
					},
				},
			},
		};
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-scan-route",
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
		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions,
		});

		expect(inputs[0]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			toolCall: undefined,
			route: undefined,
			tool: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-forbidden-runtime-material",
					details: expect.objectContaining({ area: "request-input" }),
				}),
			]),
		});
		expect(JSON.stringify(inputs)).not.toMatch(/do-not-project|RAW_REQUEST_ARGUMENTS|rawResponse/);

		const routeOnlyRequest = toolRequest(
			"adapter-route-scan-req",
			"adapter-route-scan-op",
			"file.read",
			"read",
		);
		const routeOnlyRoute: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-route-scan-route",
			requestId: routeOnlyRequest.requestId,
			operationId: routeOnlyRequest.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
			metadata: { stdout: "RAW_ROUTE_METADATA" },
		};
		const routeOnlyResolutions = resolveToolProviderExecutionPolicies({
			request: routeOnlyRequest,
			routes: [routeOnlyRoute],
			catalogs: [catalog],
		});
		const routeOnlyInputs = buildToolProviderAdapterInputs({
			requests: [routeOnlyRequest],
			routes: [routeOnlyRoute],
			catalogs: [catalog],
			resolutions: routeOnlyResolutions,
		});
		expect(routeOnlyInputs[0]).toMatchObject({
			status: "invalid-policy",
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-forbidden-runtime-material",
					details: expect.objectContaining({ area: "route-metadata" }),
				}),
			]),
		});
		expect(JSON.stringify(routeOnlyInputs)).not.toMatch(/RAW_ROUTE_METADATA|stdout/);
	});

	it("rejects stale adapter-input route identities and unavailable catalogs", () => {
		const readyCatalog = localBuiltinToolProviderCatalog({ providerId: "adapter-stale" });
		const profile = readyCatalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-stale-req", "adapter-stale-op", "file.read", "read");
		const staleRoute: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-stale-route",
			requestId: request.requestId,
			operationId: "other-op",
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
		};
		const forgedResolution: ToolProviderPolicyResolution = {
			kind: "tool-provider-policy-resolution",
			resolutionId: "adapter-stale-resolution",
			status: "resolved",
			requestId: request.requestId,
			operationId: request.operationId,
			routeId: staleRoute.routeId,
			providerId: readyCatalog.providerId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			toolName: "file.read",
			operation: "read",
			policyRefs: readyCatalog.tools.find((tool) => tool.toolName === "file.read")?.policyRefs,
		};
		const staleInputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [staleRoute],
			catalogs: [readyCatalog],
			resolutions: [forgedResolution],
		});

		expect(staleInputs[0]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			route: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-stale-route-operation",
				}),
			]),
		});

		const unavailableCatalog: ToolProviderCatalog = {
			...readyCatalog,
			status: "unavailable",
			issues: [
				{
					kind: "issue",
					code: "provider-down",
					message: "Provider is unavailable",
					severity: "error",
					details: { password: "do-not-project" },
				},
			],
		};
		const route: ExecutorRoute = {
			...staleRoute,
			operationId: request.operationId,
		};
		const unavailableInputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [unavailableCatalog],
			resolutions: [{ ...forgedResolution, resolutionId: "adapter-unavailable-resolution" }],
		});

		expect(unavailableInputs[0]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-catalog-unavailable",
				}),
				expect.objectContaining({
					code: "provider-down",
					details: { redacted: true, reason: "forbidden-runtime-material" },
				}),
			]),
		});
		expect(JSON.stringify(unavailableInputs)).not.toMatch(/do-not-project/);
	});

	it("does not trust resolved adapter-input resolutions without D360 policy material", () => {
		const request = toolRequest("adapter-forged-req", "adapter-forged-op", "file.read", "read");
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-forged-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: "adapter-forged-exec",
			profileId: "adapter-forged-profile",
			inputKind: "tool-call",
		};
		const catalog: ToolProviderCatalog = {
			kind: "tool-provider-catalog",
			providerId: "adapter-forged",
			providerKind: "local-builtin",
			status: "ready",
			profiles: [
				{
					profileId: "adapter-forged-profile",
					executorId: "adapter-forged-exec",
					kind: "tool",
					acceptedInputKinds: ["tool-call"],
				},
			],
			tools: [
				{
					kind: "tool-catalog-entry",
					providerId: "adapter-forged",
					toolName: "file.read",
					operation: "read",
					inputKind: "tool-call",
					profileId: "adapter-forged-profile",
					executorId: "adapter-forged-exec",
				},
			],
			policies: [],
		};
		const forgedResolved: ToolProviderPolicyResolution = {
			kind: "tool-provider-policy-resolution",
			resolutionId: "adapter-forged-resolution",
			status: "resolved",
			requestId: request.requestId,
			operationId: request.operationId,
			routeId: route.routeId,
			providerId: catalog.providerId,
			executorId: route.executorId,
			profileId: route.profileId,
			toolName: "file.read",
			operation: "read",
			policyRefs: [],
		};
		const missingMaterial: ToolProviderPolicyResolution = {
			...forgedResolved,
			resolutionId: "adapter-forged-missing-material",
			policyRefs: [{ kind: "tool-provider-execution-policy", id: "missing" }],
		};

		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions: [forgedResolved, missingMaterial],
		});

		expect(inputs[0]).toMatchObject({
			status: "missing-policy",
			input: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-input-missing-policy-ref" }),
			]),
		});
		expect(inputs[1]).toMatchObject({
			status: "invalid-policy",
			input: undefined,
			policies: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-policy-ref-missing-material",
				}),
			]),
		});
	});

	it("sanitizes incoming resolution issues before adapter-input projection", () => {
		const request = toolRequest(
			"adapter-issue-sanitize-req",
			"adapter-issue-sanitize-op",
			"file.read",
			"read",
		);
		const resolution: ToolProviderPolicyResolution = {
			kind: "tool-provider-policy-resolution",
			resolutionId: "adapter-issue-sanitize-resolution",
			status: "invalid-policy",
			requestId: request.requestId,
			operationId: request.operationId,
			issues: [
				{
					kind: "issue",
					code: "raw-provider-issue",
					message: "Provider issue",
					severity: "error",
					details: { authorization: "do-not-project" },
				},
			],
		};

		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			resolutions: [resolution],
		});

		expect(inputs[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "raw-provider-issue",
					details: { redacted: true, reason: "forbidden-runtime-material" },
				}),
			]),
		);
		expect(JSON.stringify(inputs)).not.toMatch(/do-not-project/);
	});

	it("emits updated adapter input material when same policy refs change", () => {
		const g = graph();
		const requestFacts = g.node<AgentRequestFact>([], null, { name: "requests" });
		const routes = g.node<ExecutorRoute>([], null, { name: "routes" });
		const catalogs = g.node<ToolProviderCatalog>([], null, { name: "catalogs" });
		const resolutions = toolProviderPolicyResolutionProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
		});
		const adapterInputs = toolProviderAdapterInputProjector(g, {
			requestFacts,
			executorRoutes: [routes],
			toolProviderCatalogs: [catalogs],
			policyResolutions: [resolutions.resolutions],
		});
		const inputs: ToolProviderAdapterInput[] = [];
		adapterInputs.inputs.subscribe(
			(msg) => msg[0] === "DATA" && inputs.push(msg[1] as ToolProviderAdapterInput),
		);
		const catalogV1 = localBuiltinToolProviderCatalog({
			providerId: "adapter-revision",
			policyOverrides: { timeout: { timeoutMs: 1000 } },
		});
		const profile = catalogV1.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest("adapter-revision-req", "adapter-revision-op", "file.read", "read");

		requestFacts.down([["DATA", request]]);
		catalogs.down([["DATA", catalogV1]]);
		routes.down([
			[
				"DATA",
				{
					kind: "executor-route",
					routeId: "adapter-revision-route",
					requestId: request.requestId,
					operationId: request.operationId,
					executorId: profile.executorId,
					profileId: profile.profileId,
					inputKind: "tool-call",
				},
			],
		]);
		const catalogV2 = localBuiltinToolProviderCatalog({
			providerId: "adapter-revision",
			policyOverrides: { timeout: { timeoutMs: 2000 } },
		});
		catalogs.down([["DATA", catalogV2]]);

		expect(
			inputs
				.filter((input) => input.status === "ready" && input.requestId === "adapter-revision-req")
				.map((input) => input.policies?.[0]?.timeout?.timeoutMs),
		).toEqual([1000, 2000]);
	});

	it("scrubs returned refs before marking adapter input ready", () => {
		const catalog = localBuiltinToolProviderCatalog({ providerId: "adapter-route-scan" });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const request = toolRequest(
			"adapter-route-scan-req",
			"adapter-route-scan-op",
			"file.read",
			"read",
		);
		const route: ExecutorRoute = {
			kind: "executor-route",
			routeId: "adapter-route-scan-route",
			requestId: request.requestId,
			operationId: request.operationId,
			executorId: profile.executorId,
			profileId: profile.profileId,
			inputKind: "tool-call",
			evidenceRefs: [{ kind: "runtime", id: "route", metadata: { client: "do-not-project" } }],
		};
		const resolutions = resolveToolProviderExecutionPolicies({
			request,
			routes: [route],
			catalogs: [catalog],
		}).map((resolution) => ({
			...resolution,
			sourceRefs: [
				...(resolution.sourceRefs ?? []),
				{ kind: "runtime", id: "resolution", metadata: { oauth: "do-not-project" } },
			],
			policyRefs: (resolution.policyRefs ?? []).map((policyRef) => ({
				...policyRef,
				metadata: { secret: "do-not-project" },
			})),
		}));
		const inputs = buildToolProviderAdapterInputs({
			requests: [request],
			routes: [route],
			catalogs: [catalog],
			resolutions,
		});

		expect(inputs[0]).toMatchObject({
			status: "invalid-policy",
			route: undefined,
			input: undefined,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-input-forbidden-runtime-material",
				}),
			]),
		});
		expect(JSON.stringify(inputs)).not.toMatch(/do-not-project/);
	});

	it("validates malformed D360 tool provider policies as DataIssue facts", () => {
		const issues = validateToolProviderExecutionPolicy({
			kind: "tool-provider-execution-policy",
			policyId: "",
			providerId: "",
			sizeCapacity: {
				limits: [{ unit: "bytes", softLimit: 20, hardLimit: 10 }, { softLimit: Number.NaN }],
			},
			timeout: { timeoutMs: -1, idleTimeoutMs: Number.POSITIVE_INFINITY },
			metadata: { apiKey: "do-not-store", rawResponse: "RAW_POLICY_VALIDATION" },
		});
		expect(issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-policy-id",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-provider-id",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-invalid-size-limit",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-invalid-timeout",
				}),
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-forbidden-runtime-material",
				}),
			]),
		);
		expect(issues.every((issue) => issue.kind === "issue")).toBe(true);
		expect(JSON.stringify(issues)).not.toMatch(/do-not-store|RAW_POLICY_VALIDATION|rawResponse/);

		expect(
			validateToolProviderExecutionPolicy({
				kind: "tool-provider-execution-policy",
				policyId: "policy-empty",
				providerId: "local",
			}),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "issue",
					code: "tool-provider-policy-missing-material",
				}),
			]),
		);
		expect(validateToolProviderExecutionPolicy({ sizeCapacity: {} })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-invalid-kind" }),
				expect.objectContaining({ code: "tool-provider-policy-missing-policy-id" }),
				expect.objectContaining({ code: "tool-provider-policy-missing-provider-id" }),
				expect.objectContaining({ code: "tool-provider-policy-invalid-size-capacity" }),
			]),
		);
		expect(
			validateToolProviderExecutionPolicy({
				kind: "tool-provider-execution-policy",
				policyId: "bad-timeout",
				providerId: "local",
				timeout: { timeoutMs: "fast" },
			}),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-policy-invalid-timeout" }),
			]),
		);
		expect(validateToolProviderExecutionPolicy(null)).toEqual([
			expect.objectContaining({
				kind: "issue",
				code: "tool-provider-policy-invalid-shape",
			}),
		]);
	});
});
