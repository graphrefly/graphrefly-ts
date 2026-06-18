import { afterEach, describe, expect, it } from "vitest";
import type { DataIssue } from "../data/index.js";
import { type Graph, graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import {
	type AgentRequestFact,
	type AgentRequestIssued,
	type AgentRequestStatus,
	type AgentRequestStatusChanged,
	type AgentRuntimeAuditRecord,
	type EffectRunResult,
	type ExecutorOutcome,
	type ExecutorRoute,
	effectRunCompletionProjector,
	localBuiltinToolProviderCatalog,
	requestToolProviderAdapterRun,
	resolveToolProviderExecutionPolicies,
	type SourceRef,
	type ToolProviderAdapterInput,
	type ToolProviderAdapterRunRequested,
	type ToolProviderAdapterRunResult,
	type ToolProviderAdapterRunStatus,
	toolProviderAdapterInputProjector,
} from "../orchestration/agent-runtime.js";
import { attachToolProviderAdapterRuntime } from "../orchestration/agent-runtime-adapter-runtime.js";
import type {
	ToolProviderAdapterBinding,
	ToolProviderAdapterRuntimeStatus,
} from "../orchestration/agent-runtime-types-tool.js";
import {
	type WorkItemEffectRequested,
	type WorkItemEvidenceRecorded,
	type WorkItemSeed,
	workItemEffectResultMapper,
	workItemEffectRunProjector,
} from "../orchestration/work-item-runtime.js";

const forbiddenProviderPayloadPattern =
	/rawResponse|stdout|stderr|stack|apiKey|password|token|credential|cookie|authorization|authHeader|bearer|privateKey|secret|providerClient|oauthState|subprocessHandle|transport|sdkObject|SECRET_RUNTIME/i;

const activeHarnessDisposers: (() => void)[] = [];

afterEach(() => {
	for (const dispose of activeHarnessDisposers.splice(0)) dispose();
});

function workItemSeed(workItemId = "wi-dogfood"): WorkItemSeed {
	return {
		kind: "work-item",
		workItemId,
		workItemKind: "issue",
		lifecycleStatus: "open",
		sourceRefs: [{ kind: "work-item", id: workItemId }],
	};
}

function workItemEffectRequest(
	opts: {
		readonly requestId?: string;
		readonly workItemId?: string;
		readonly effectRunId?: string;
	} = {},
): WorkItemEffectRequested {
	return {
		kind: "work-item-effect-requested",
		requestId: opts.requestId ?? "wi-effect-dogfood",
		workItemId: opts.workItemId ?? "wi-dogfood",
		effectRunId: opts.effectRunId ?? "effect-dogfood",
		effectKind: "tool-provider-dogfood",
		executionInputRevision: 1,
		planId: "plan-dogfood",
		planMemberId: "tool-member",
		sourceRefs: [{ kind: "acceptance-criteria", id: "csp-8-dogfood" }],
		goal: {
			kind: "tool-provider-dogfood",
			summary: "prove WorkItem evidence through explicit tool adapter runtime",
		},
		agentRunId: "agent-dogfood",
	};
}

function toolRequest(
	opts: {
		readonly requestId?: string;
		readonly operationId?: string;
		readonly effectRunId?: string;
		readonly providerId?: string;
		readonly toolName?: string;
		readonly operation?: string;
	} = {},
): AgentRequestIssued {
	const requestId = opts.requestId ?? "tool-request-dogfood";
	return {
		kind: "issued",
		requestId,
		operationId: opts.operationId ?? "tool-op-dogfood",
		effectRunId: opts.effectRunId ?? "effect-dogfood",
		agentRunId: "agent-dogfood",
		requestKind: "executor",
		required: true,
		input: {
			inputId: `${requestId}:input`,
			inputKind: "tool-call",
			dataMode: "inline",
			value: {
				kind: "tool-call",
				toolName: opts.toolName ?? "file.read",
				operation: opts.operation ?? "read",
				arguments: { path: "README.md" },
			},
			subjectRefs: [{ kind: "work-item", id: "wi-dogfood" }],
		},
		sourceRefs: [{ kind: "work-item", id: "wi-dogfood" }],
	};
}

function routeFor(
	request: AgentRequestIssued,
	profile: { executorId: string; profileId: string },
): ExecutorRoute {
	return {
		kind: "executor-route",
		routeId: `${request.requestId}:route`,
		requestId: request.requestId,
		operationId: request.operationId,
		inputId: request.input?.inputId,
		inputKind: "tool-call",
		executorId: profile.executorId,
		profileId: profile.profileId,
	};
}

function effectRunStatusForOutcome(outcome: ExecutorOutcome): EffectRunResult["status"] {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "blocked") return "blocked";
	return outcome.kind;
}

function terminalRequestStatusForOutcome(outcome: ExecutorOutcome): AgentRequestStatus {
	if (outcome.kind === "result") return "completed";
	if (outcome.kind === "failure") return "failed";
	if (outcome.kind === "blocked") return "blocked";
	return outcome.kind;
}

function visibleOutcomeResultCandidates(
	g: Graph,
	opts: {
		readonly outcomes: Node<ExecutorOutcome>;
		readonly requestStatus: Node<AgentRequestStatusChanged>;
		readonly issues: Node<DataIssue>;
		readonly audit: Node<AgentRuntimeAuditRecord>;
	},
): { readonly candidates: Node<EffectRunResult>; readonly dispose: () => void } {
	const candidates = g.node<EffectRunResult>([], null, {
		name: "dogfoodVisibleOutcomeResultCandidates",
	});
	const state = {
		outcomes: new Map<string, ExecutorOutcome>(),
		statusByRequest: new Map<string, AgentRequestStatusChanged>(),
		issuesByRequest: new Map<string, DataIssue[]>(),
		auditByRequest: new Map<string, string[]>(),
		auditByOutcome: new Map<string, string[]>(),
		emitted: new Set<string>(),
	};
	function tryEmit(): void {
		for (const outcome of state.outcomes.values()) {
			if (state.emitted.has(outcome.outcomeId)) continue;
			const status = state.statusByRequest.get(outcome.requestId);
			const outcomeAuditRefs = state.auditByOutcome.get(outcome.outcomeId);
			if (
				status === undefined ||
				outcomeAuditRefs === undefined ||
				status.operationId !== outcome.operationId ||
				status.status !== terminalRequestStatusForOutcome(outcome)
			) {
				continue;
			}
			const base = {
				kind: "effect-run-result",
				resultId: `${status.effectRunId}:${outcome.outcomeId}:result`,
				effectRunId: status.effectRunId,
				status: effectRunStatusForOutcome(outcome),
				operationId: outcome.operationId,
				subjectRefs: [{ kind: "work-item", id: "wi-dogfood" }],
				sourceRefs: uniqueRefs([
					{ kind: "executor-outcome", id: outcome.outcomeId },
					{ kind: "agent-request", id: outcome.requestId },
					{ kind: "tool-provider-adapter-run", id: runtimeRunId(outcome) },
					...(outcome.evidenceRefs ?? []),
					...(status.sourceRefs ?? []),
				]),
				issues: uniqueIssues([
					...(outcome.issues ?? []),
					...(status.issues ?? []),
					...(state.issuesByRequest.get(outcome.requestId) ?? []),
				]),
				auditRefs: uniqueStrings([
					...(state.auditByRequest.get(outcome.requestId) ?? []),
					...outcomeAuditRefs,
				]),
				completedAtMs: outcome.occurredAtMs,
				metadata: { outcomeId: outcome.outcomeId, requestStatus: status.status },
			} satisfies Omit<EffectRunResult, "output" | "error" | "needs" | "reason" | "timeoutMs">;
			const result =
				outcome.kind === "result"
					? ({ ...base, output: outcome.result } satisfies EffectRunResult)
					: outcome.kind === "failure"
						? ({ ...base, error: outcome.error } satisfies EffectRunResult)
						: outcome.kind === "blocked"
							? ({ ...base, needs: outcome.needs } satisfies EffectRunResult)
							: outcome.kind === "timeout"
								? ({ ...base, timeoutMs: outcome.timeoutMs } satisfies EffectRunResult)
								: ({ ...base, reason: outcome.reason } satisfies EffectRunResult);
			state.emitted.add(outcome.outcomeId);
			candidates.down([["DATA", result]]);
		}
	}
	const unsubscribes = [
		opts.outcomes.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const outcome = msg[1] as ExecutorOutcome;
			state.outcomes.set(outcome.outcomeId, outcome);
			tryEmit();
		}),
		opts.requestStatus.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const status = msg[1] as AgentRequestStatusChanged;
			state.statusByRequest.set(status.requestId, status);
			tryEmit();
		}),
		opts.issues.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const issue = msg[1] as DataIssue;
			if (issue.subjectId !== undefined) {
				const bucket = state.issuesByRequest.get(issue.subjectId) ?? [];
				bucket.push(issue);
				state.issuesByRequest.set(issue.subjectId, bucket);
			}
			tryEmit();
		}),
		opts.audit.subscribe((msg) => {
			if (msg[0] !== "DATA") return;
			const audit = msg[1] as AgentRuntimeAuditRecord;
			if (audit.subjectId !== undefined) {
				const bucket = state.auditByRequest.get(audit.subjectId) ?? [];
				bucket.push(audit.id);
				state.auditByRequest.set(audit.subjectId, bucket);
			}
			const outcomeId = audit.metadata?.outcomeId;
			if (typeof outcomeId === "string") {
				const bucket = state.auditByOutcome.get(outcomeId) ?? [];
				bucket.push(audit.id);
				state.auditByOutcome.set(outcomeId, bucket);
			}
			tryEmit();
		}),
	];
	return {
		candidates,
		dispose() {
			for (const unsubscribe of unsubscribes) unsubscribe();
		},
	};
}

function runtimeRunId(outcome: ExecutorOutcome): string {
	const runId = outcome.metadata?.runId;
	if (typeof runId !== "string") {
		throw new Error("expected explicit runId in ExecutorOutcome metadata");
	}
	return runId;
}

function uniqueStrings(values: readonly string[]): readonly string[] | undefined {
	const unique = Array.from(new Set(values));
	return unique.length === 0 ? undefined : unique;
}

function uniqueRefs(refs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const ref of refs) {
		const key = `${ref.kind}:${ref.id}:${JSON.stringify(ref.metadata ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return out;
}

function uniqueIssues(issues: readonly DataIssue[]): readonly DataIssue[] | undefined {
	const seen = new Set<string>();
	const out: DataIssue[] = [];
	for (const issue of issues) {
		const key = `${issue.code}:${issue.subjectId ?? ""}:${issue.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(issue);
	}
	return out.length === 0 ? undefined : out;
}

function createDogfoodHarness(
	binding: ToolProviderAdapterBinding,
	opts: {
		readonly retention?: Parameters<typeof attachToolProviderAdapterRuntime>[1]["retention"];
		readonly publicText?: Parameters<typeof attachToolProviderAdapterRuntime>[1]["publicText"];
	} = {},
) {
	const g = graph();
	const workItems = g.node<WorkItemSeed>([], null, { name: "dogfood-work-items" });
	const effectRequests = g.node<WorkItemEffectRequested>([], null, {
		name: "dogfood-effect-requests",
	});
	const requestFacts = g.node<AgentRequestFact>([], null, { name: "dogfood-request-facts" });
	const routes = g.node<ExecutorRoute>([], null, { name: "dogfood-routes" });
	const catalogs = g.node<ReturnType<typeof localBuiltinToolProviderCatalog>>([], null, {
		name: "dogfood-catalogs",
	});
	const resolutions = g.node<ReturnType<typeof resolveToolProviderExecutionPolicies>[number]>(
		[],
		null,
		{ name: "dogfood-resolutions" },
	);
	const runRequests = g.node<ToolProviderAdapterRunRequested>([], null, {
		name: "dogfood-run-requests",
	});
	const effectRuns = workItemEffectRunProjector(g, { workItems, effectRequests });
	const adapterInputs = toolProviderAdapterInputProjector(g, {
		requestFacts,
		executorRoutes: [routes],
		toolProviderCatalogs: [catalogs],
		policyResolutions: [resolutions],
	});
	const runtime = attachToolProviderAdapterRuntime(g, {
		inputs: adapterInputs.inputs,
		runRequests: [runRequests],
		autoRunReadyInputs: false,
		bindings: [binding],
		retention: opts.retention,
		publicText: opts.publicText,
		now: () => 1000,
	});
	const resultCandidates = visibleOutcomeResultCandidates(g, {
		outcomes: runtime.outcomes,
		requestStatus: runtime.status,
		issues: runtime.issues,
		audit: runtime.audit,
	});
	const completion = effectRunCompletionProjector(g, {
		effectRuns: effectRuns.effectRuns,
		requestFacts: [requestFacts],
		requestStatuses: [runtime.status],
		resultCandidates: [resultCandidates.candidates],
		now: () => 1001,
	});
	const evidenceMapper = workItemEffectResultMapper(g, {
		workItems,
		effectRuns: effectRuns.effectRuns,
		effectRunResults: completion.results,
		effectRequests,
		now: () => 1002,
	});
	const seen = {
		inputs: [] as ToolProviderAdapterInput[],
		outcomes: [] as ExecutorOutcome[],
		agentStatus: [] as AgentRequestStatusChanged[],
		runStatus: [] as ToolProviderAdapterRunStatus[],
		runtimeStatus: [] as ToolProviderAdapterRuntimeStatus[],
		issues: [] as DataIssue[],
		audit: [] as AgentRuntimeAuditRecord[],
		results: [] as EffectRunResult[],
		resultCandidates: [] as EffectRunResult[],
		evidence: [] as WorkItemEvidenceRecorded[],
	};
	const unsubscribes = [
		adapterInputs.inputs.subscribe((msg) => msg[0] === "DATA" && seen.inputs.push(msg[1])),
		runtime.outcomes.subscribe((msg) => msg[0] === "DATA" && seen.outcomes.push(msg[1])),
		runtime.status.subscribe((msg) => msg[0] === "DATA" && seen.agentStatus.push(msg[1])),
		runtime.runStatus.subscribe((msg) => msg[0] === "DATA" && seen.runStatus.push(msg[1])),
		runtime.runtimeStatus.subscribe((msg) => msg[0] === "DATA" && seen.runtimeStatus.push(msg[1])),
		runtime.issues.subscribe((msg) => msg[0] === "DATA" && seen.issues.push(msg[1])),
		runtime.audit.subscribe((msg) => msg[0] === "DATA" && seen.audit.push(msg[1])),
		resultCandidates.candidates.subscribe(
			(msg) => msg[0] === "DATA" && seen.resultCandidates.push(msg[1]),
		),
		completion.results.subscribe((msg) => msg[0] === "DATA" && seen.results.push(msg[1])),
		evidenceMapper.evidence.subscribe((msg) => msg[0] === "DATA" && seen.evidence.push(msg[1])),
		evidenceMapper.views.subscribe(() => {}),
	];
	let disposed = false;

	function publishBaseFacts(request: AgentRequestIssued): void {
		workItems.down([["DATA", workItemSeed()]]);
		effectRequests.down([["DATA", workItemEffectRequest({ effectRunId: request.effectRunId })]]);
		requestFacts.down([["DATA", request]]);
	}

	function seed(request: AgentRequestIssued = toolRequest()): ToolProviderAdapterInput {
		const catalog = localBuiltinToolProviderCatalog({ providerId: binding.providerId });
		const profile = catalog.profiles[0];
		if (profile === undefined) throw new Error("expected profile");
		const route = routeFor(request, profile);
		const [resolution] = resolveToolProviderExecutionPolicies({
			request,
			routes: [route],
			catalogs: [catalog],
		});
		if (resolution === undefined) throw new Error("expected policy resolution");
		publishBaseFacts(request);
		catalogs.down([["DATA", catalog]]);
		routes.down([["DATA", route]]);
		resolutions.down([["DATA", resolution]]);
		const input = seen.inputs.at(-1);
		if (input === undefined || input.status !== "ready") throw new Error("expected ready input");
		return input;
	}

	function seedPendingRoute(request: AgentRequestIssued): ToolProviderAdapterInput {
		const catalog = localBuiltinToolProviderCatalog({ providerId: binding.providerId });
		const [resolution] = resolveToolProviderExecutionPolicies({
			request,
			routes: [],
			catalogs: [catalog],
		});
		if (resolution === undefined) throw new Error("expected pending route resolution");
		publishBaseFacts(request);
		catalogs.down([["DATA", catalog]]);
		resolutions.down([["DATA", resolution]]);
		const input = seen.inputs.at(-1);
		if (input === undefined || input.status === "ready") {
			throw new Error("expected non-ready adapter input");
		}
		return input;
	}

	const harness = {
		g,
		runRequests,
		runtime,
		seen,
		seed,
		seedPendingRoute,
		request(
			input: ToolProviderAdapterInput,
			opts: Pick<ToolProviderAdapterRunRequested, "runId" | "attempt" | "reason"> & {
				readonly sourceRefs?: readonly SourceRef[];
				readonly metadata?: Record<string, unknown>;
			},
		) {
			const request = requestToolProviderAdapterRun(input, {
				runId: opts.runId,
				attempt: opts.attempt,
				reason: opts.reason,
				sourceRefs: opts.sourceRefs,
				metadata: opts.metadata,
			});
			runRequests.down([["DATA", request]]);
			return request;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			runtime.dispose();
			resultCandidates.dispose();
			for (const unsubscribe of unsubscribes) unsubscribe();
		},
	};
	activeHarnessDisposers.push(() => harness.dispose());
	return harness;
}

describe("CSP-8 dogfood evidence integration through explicit tool adapter runs (D359-D362/D371/D387/D389/D392-D394)", () => {
	it("maps a successful explicit tool run through ExecutorOutcome into WorkItem evidence", () => {
		const calls: ToolProviderAdapterInput[] = [];
		const harness = createDogfoodHarness({
			providerId: "dogfood-provider",
			run(input) {
				calls.push(input);
				return {
					kind: "result",
					result: {
						kind: "tool-output",
						value: { ok: true },
						refs: [{ kind: "artifact", id: "artifact-success" }],
						summary: "fake bounded provider-neutral result",
						metadata: { source: "fake-provider" },
					},
					metadata: { providerSummary: "bounded metadata" },
					usage: { latencyMs: 5 },
				};
			},
		});
		const input = harness.seed();
		harness.request(input, { runId: "run-success", attempt: 1, reason: "manual" });

		expect(calls).toEqual([input]);
		expect(harness.seen.outcomes).toEqual([
			expect.objectContaining({
				kind: "result",
				outcomeId: expect.stringContaining("run-success"),
			}),
		]);
		expect(harness.seen.agentStatus.map((status) => status.status)).toEqual([
			"in-flight",
			"completed",
		]);
		expect(harness.seen.results).toEqual([
			expect.objectContaining({ status: "completed", effectRunId: "effect-dogfood" }),
		]);
		expect(harness.seen.evidence).toEqual([
			expect.objectContaining({
				workItemId: "wi-dogfood",
				status: "completed",
				output: expect.objectContaining({ summary: "fake bounded provider-neutral result" }),
				sourceRefs: expect.arrayContaining([
					{ kind: "executor-outcome", id: harness.seen.outcomes[0]?.outcomeId },
					{ kind: "tool-provider-adapter-run", id: "run-success" },
					{ kind: "tool-provider-adapter-input", id: input.adapterInputId },
				]),
			}),
		]);
		expect(
			JSON.stringify({
				outcomes: harness.seen.outcomes,
				results: harness.seen.results,
				evidence: harness.seen.evidence,
				agentStatus: harness.seen.agentStatus,
				runStatus: harness.seen.runStatus,
				runtimeStatus: harness.seen.runtimeStatus,
				issues: harness.seen.issues,
				audit: harness.seen.audit,
			}),
		).not.toMatch(forbiddenProviderPayloadPattern);
		harness.dispose();
	});

	it.each([
		[
			"failure",
			{
				kind: "failure",
				error: {
					kind: "issue",
					code: "fake-provider-failure",
					message: "provider-declared public failure",
					severity: "error",
				},
				retryable: false,
			} satisfies ToolProviderAdapterRunResult,
			"failed",
		],
		[
			"blocked",
			{
				kind: "blocked",
				needs: [{ kind: "approval", message: "needs explicit approval" }],
			} satisfies ToolProviderAdapterRunResult,
			"blocked",
		],
		[
			"timeout",
			{ kind: "timeout", timeoutMs: 25, retryable: true } satisfies ToolProviderAdapterRunResult,
			"timeout",
		],
		[
			"canceled",
			{ kind: "canceled", reason: "user canceled" } satisfies ToolProviderAdapterRunResult,
			"canceled",
		],
	])("maps provider %s through visible outcome/status/issues/audit facts before WorkItem evidence", (_name, result, expectedEvidenceStatus) => {
		const calls: ToolProviderAdapterInput[] = [];
		const harness = createDogfoodHarness({
			providerId: "dogfood-provider",
			run(input) {
				calls.push(input);
				return result;
			},
		});
		const input = harness.seed(
			toolRequest({ requestId: `tool-request-${expectedEvidenceStatus}` }),
		);
		expect(harness.seen.evidence).toEqual([]);
		harness.request(input, {
			runId: `run-${expectedEvidenceStatus}`,
			attempt: 1,
			reason: "manual",
		});

		expect(calls).toHaveLength(1);
		expect(harness.seen.outcomes.at(-1)?.kind).toBe(result.kind);
		expect(harness.seen.agentStatus.at(-1)?.status).toBe(
			expectedEvidenceStatus === "failed" ? "failed" : expectedEvidenceStatus,
		);
		expect(harness.seen.audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "tool-provider-adapter-runtime-finished" }),
			]),
		);
		expect(harness.seen.evidence).toEqual([
			expect.objectContaining({ status: expectedEvidenceStatus }),
		]);
		harness.dispose();
	});

	it("keeps missing-input and stale/mismatched request outcomes out of WorkItem evidence", () => {
		const calls: ToolProviderAdapterInput[] = [];
		const harness = createDogfoodHarness({
			providerId: "dogfood-provider",
			run(input) {
				calls.push(input);
				return { kind: "result", result: { kind: "tool-output", summary: "should not run" } };
			},
		});
		const validInput = harness.seed(toolRequest({ requestId: "tool-request-valid" }));
		const notReadyInput = harness.seedPendingRoute(
			toolRequest({ requestId: "tool-request-not-ready" }),
		);

		harness.runRequests.down([
			[
				"DATA",
				{
					kind: "tool-provider-adapter-run-requested",
					runId: "run-missing-input",
					adapterInputId: "missing-adapter-input",
					requestId: validInput.requestId,
					operationId: validInput.operationId,
					attempt: 1,
					reason: "manual",
				},
			],
			[
				"DATA",
				requestToolProviderAdapterRun(validInput, {
					runId: "run-valid-control",
					attempt: 1,
					reason: "manual",
				}),
			],
			[
				"DATA",
				requestToolProviderAdapterRun(notReadyInput, {
					runId: "run-not-ready-request",
					attempt: 1,
					reason: "manual",
				}),
			],
			[
				"DATA",
				{
					...requestToolProviderAdapterRun(validInput, {
						runId: "run-stale-request",
						attempt: 2,
						reason: "manual",
					}),
					requestId: "different-request",
				},
			],
		]);

		expect(calls).toHaveLength(1);
		expect(harness.seen.runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-missing-input", status: "missing-input" }),
				expect.objectContaining({ runId: "run-not-ready-request", status: "mismatched-request" }),
				expect.objectContaining({ runId: "run-stale-request", status: "mismatched-request" }),
			]),
		);
		for (const invalidRunId of ["run-not-ready-request", "run-stale-request"]) {
			expect(harness.seen.runStatus).not.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ runId: invalidRunId, status: "retention-gap" }),
				]),
			);
		}
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "tool-provider-adapter-run-request-missing-input" }),
				expect.objectContaining({ code: "tool-provider-adapter-run-request-input-not-ready" }),
				expect.objectContaining({ code: "tool-provider-adapter-run-request-stale-request" }),
			]),
		);
		expect(harness.seen.evidence).toHaveLength(1);
		const evidenceRefs = harness.seen.evidence[0]?.sourceRefs ?? [];
		expect(evidenceRefs).toEqual(
			expect.arrayContaining([{ kind: "tool-provider-adapter-run", id: "run-valid-control" }]),
		);
		for (const invalidRunId of [
			"run-missing-input",
			"run-not-ready-request",
			"run-stale-request",
		]) {
			expect(evidenceRefs).not.toEqual(
				expect.arrayContaining([{ kind: "tool-provider-adapter-run", id: invalidRunId }]),
			);
		}
		harness.dispose();
	});

	it("reports retention-gap without executing binding or recording WorkItem evidence", () => {
		const calls: ToolProviderAdapterInput[] = [];
		const harness = createDogfoodHarness(
			{
				providerId: "dogfood-provider",
				run(input) {
					calls.push(input);
					return { kind: "result", result: { kind: "tool-output", summary: "should not run" } };
				},
			},
			{ retention: { adapterInputs: { order: "fifo", maxSize: 1 } } },
		);
		const first = harness.seed(toolRequest({ requestId: "tool-request-retained-1" }));
		harness.seed(toolRequest({ requestId: "tool-request-retained-2" }));

		harness.request(first, { runId: "run-retention-gap", attempt: 1, reason: "manual" });

		expect(calls).toEqual([]);
		expect(harness.seen.outcomes).toEqual([]);
		expect(harness.seen.evidence).toEqual([]);
		expect(harness.seen.runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: "run-retention-gap", status: "retention-gap" }),
			]),
		);
		expect(harness.seen.runtimeStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "retention-gap",
					adapterInputId: first.adapterInputId,
				}),
			]),
		);
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-retention-gap",
				}),
			]),
		);
		harness.dispose();
	});

	it("rejects repeated same adapterInputId/attempt with different runId without a second execution", () => {
		const calls: ToolProviderAdapterInput[] = [];
		const harness = createDogfoodHarness({
			providerId: "dogfood-provider",
			run(input) {
				calls.push(input);
				return { kind: "result", result: { kind: "tool-output", summary: "first run only" } };
			},
		});
		const input = harness.seed();
		harness.request(input, { runId: "run-coordinate-1", attempt: 1, reason: "manual" });
		harness.request(input, { runId: "run-coordinate-2", attempt: 1, reason: "manual" });

		expect(calls).toHaveLength(1);
		expect(harness.seen.evidence).toHaveLength(1);
		expect(harness.seen.runStatus).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					runId: "run-coordinate-2",
					status: "mismatched-request",
				}),
			]),
		);
		const duplicateStatuses = harness.seen.runStatus.filter(
			(status) => status.runId === "run-coordinate-2",
		);
		expect(duplicateStatuses).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "mismatched-request" })]),
		);
		for (const forbiddenStatus of [
			"retention-gap",
			"result",
			"failure",
			"blocked",
			"timeout",
			"canceled",
		]) {
			expect(duplicateStatuses.map((status) => status.status)).not.toContain(forbiddenStatus);
		}
		expect(harness.seen.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-duplicate-execution-coordinate",
				}),
			]),
		);
		harness.dispose();
	});

	it("bounds fake provider public material and keeps runtime-private keys out of evidence", () => {
		const harness = createDogfoodHarness(
			{
				providerId: "dogfood-provider",
				run() {
					return {
						kind: "result",
						result: {
							kind: "tool-output",
							value: { ok: true },
							refs: [
								{
									kind: "artifact",
									id: "artifact-safe",
									metadata: { rawResponse: "SECRET_RUNTIME_REF" },
								},
							],
							summary: "summary text that should be truncated",
							metadata: { note: "metadata text that should be truncated" },
						},
						evidenceRefs: [
							{
								kind: "artifact",
								id: "evidence-safe",
								metadata: { stdout: "SECRET_RUNTIME_EVIDENCE" },
							},
						],
						metadata: { providerSummary: "metadata text that should be truncated" },
					};
				},
			},
			{ publicText: { maxSummaryChars: 12, maxMetadataStringChars: 10 } },
		);
		const input = harness.seed();
		harness.request(input, { runId: "run-sanitized", attempt: 1, reason: "manual" });

		const outcome = harness.seen.outcomes[0];
		if (outcome?.kind !== "result") throw new Error("expected result outcome");
		expect(outcome.result.summary).toBe("summary t...");
		expect(outcome.result.metadata).toEqual({ note: "metadat..." });
		expect(outcome.result.refs).toEqual([{ kind: "artifact", id: "artifact-safe" }]);
		expect(outcome.evidenceRefs).toEqual([{ kind: "artifact", id: "evidence-safe" }]);
		expect(harness.seen.evidence[0]?.output).toEqual(outcome.result);
		expect(harness.seen.evidence[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "tool-provider-adapter-runtime-public-text-truncated",
				}),
			]),
		);
		expect(
			JSON.stringify({
				outcome,
				evidence: harness.seen.evidence,
				results: harness.seen.results,
				resultCandidates: harness.seen.resultCandidates,
				agentStatus: harness.seen.agentStatus,
				runStatus: harness.seen.runStatus,
				runtimeStatus: harness.seen.runtimeStatus,
				issues: harness.seen.issues,
				audit: harness.seen.audit,
			}),
		).not.toMatch(forbiddenProviderPayloadPattern);
		harness.dispose();
	});
});
