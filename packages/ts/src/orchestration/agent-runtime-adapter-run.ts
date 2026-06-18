import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { ToolProviderAdapterRunProjectorPrivateRetentionHooks } from "./agent-runtime-adapter-retention.js";
import {
	boundPublicText,
	dataIssue,
	forbiddenDataKeys,
	forbiddenProviderRawMaterialKeys,
	forEachDepBatch,
	isRecord,
	maxPublicReasonChars,
	projectRuntimeFact,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
	sanitizeProviderGraphVisibleRecord,
	stableJsonStringify,
	stableStringHash,
} from "./agent-runtime-common.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { SourceRef } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterBinding,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunBundle,
	ToolProviderAdapterRunReason,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
	ToolProviderPublicTextPolicy,
} from "./agent-runtime-types-tool.js";

export function normalizeToolProviderAdapterBindings<TArguments, TResult>(
	bindings:
		| readonly ToolProviderAdapterBinding<TArguments, TResult>[]
		| ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>>,
): ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>> {
	const result = new Map<string, ToolProviderAdapterBinding<TArguments, TResult>>();
	const bindingList = Array.isArray(bindings)
		? (bindings as readonly ToolProviderAdapterBinding<TArguments, TResult>[])
		: undefined;
	if (bindingList === undefined) {
		const bindingMap = bindings as ReadonlyMap<
			string,
			ToolProviderAdapterBinding<TArguments, TResult>
		>;
		for (const [providerId, binding] of bindingMap.entries()) {
			if (providerId !== binding.providerId) {
				throw new RangeError(
					`attachToolProviderAdapterRuntime: binding key '${providerId}' must match provider '${binding.providerId}'`,
				);
			}
			result.set(providerId, binding);
		}
		return result;
	}
	for (const binding of bindingList) {
		if (result.has(binding.providerId)) {
			throw new RangeError(
				`attachToolProviderAdapterRuntime: duplicate binding for provider '${binding.providerId}'`,
			);
		}
		result.set(binding.providerId, binding);
	}
	return result;
}

export function requestToolProviderAdapterRun(
	input: ToolProviderAdapterInput,
	opts: {
		readonly runId?: string;
		readonly attempt?: number;
		readonly reason?: ToolProviderAdapterRunReason;
		readonly retryOfOutcomeId?: string;
		readonly policyRefs?: readonly SourceRef[];
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
		readonly requestedAtMs?: number;
	} = {},
): ToolProviderAdapterRunRequested {
	const attempt = opts.attempt ?? 1;
	return Object.freeze({
		kind: "tool-provider-adapter-run-requested",
		runId: opts.runId ?? defaultToolProviderAdapterRunId(input.adapterInputId, attempt, input),
		adapterInputId: input.adapterInputId,
		requestId: input.requestId,
		operationId: input.operationId,
		routeId: input.routeId,
		providerId: input.providerId,
		executorId: input.executorId,
		profileId: input.profileId,
		attempt,
		reason: sanitizeToolProviderAdapterRunReason(opts.reason, attempt),
		retryOfOutcomeId: opts.retryOfOutcomeId,
		policyRefs: sanitizeAdapterInputSourceRefs(opts.policyRefs ?? input.policyRefs ?? []),
		sourceRefs: sanitizeAdapterInputSourceRefs([
			ref("tool-provider-adapter-input", input.adapterInputId),
			...(input.sourceRefs ?? []),
			...(opts.sourceRefs ?? []),
		]),
		metadata: sanitizeProviderGraphVisibleRecord(opts.metadata),
		requestedAtMs: opts.requestedAtMs,
	} satisfies ToolProviderAdapterRunRequested);
}

export function toolProviderAdapterRunProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly inputs: Node<ToolProviderAdapterInput>;
		readonly runRequests?: readonly Node<ToolProviderAdapterRunRequested>[];
		readonly autoRunReadyInputs?: boolean;
		readonly now?: () => number;
	},
): ToolProviderAdapterRunBundle {
	return toolProviderAdapterRunProjectorInternal(graph, opts);
}

export function toolProviderAdapterRunProjectorInternal(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly inputs: Node<ToolProviderAdapterInput>;
		readonly runRequests?: readonly Node<ToolProviderAdapterRunRequested>[];
		readonly autoRunReadyInputs?: boolean;
		readonly now?: () => number;
		readonly publicText?: ToolProviderPublicTextPolicy;
		readonly privateRetentionHooks?: ToolProviderAdapterRunProjectorPrivateRetentionHooks;
	},
): ToolProviderAdapterRunBundle {
	const name = opts.name ?? "toolProviderAdapterRun";
	const explicitRunDeps = opts.runRequests ?? [];
	const autoRunReadyInputs = opts.autoRunReadyInputs ?? true;
	const runtime = graph.node<ToolProviderAdapterRunFact>(
		[opts.inputs, ...explicitRunDeps],
		(ctx) => {
			const state = ctx.state.get<ToolProviderAdapterRunProjectorState>() ?? {
				inputs: new Map<string, ToolProviderAdapterInput>(),
				emittedKeys: new Set<string>(),
				statusKeys: new Set<string>(),
				issueKeys: new Set<string>(),
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				const input = raw as ToolProviderAdapterInput;
				state.inputs.set(input.adapterInputId, input);
				opts.privateRetentionHooks?.onAdapterInputKey?.({
					adapterInputId: input.adapterInputId,
					dropInput: () => {
						state.inputs.delete(input.adapterInputId);
					},
				});
				if (input.status !== "ready") continue;
				if (autoRunReadyInputs) {
					emitRunRequested(
						ctx,
						state,
						requestToolProviderAdapterRun(input, {
							requestedAtMs: opts.now?.(),
						}),
						opts.privateRetentionHooks,
					);
				} else if (explicitRunDeps.length === 0) {
					emitRunIssue(
						ctx,
						state,
						"tool-provider-adapter-run-request-missing",
						"Ready tool provider adapter input has no visible run request.",
						input.adapterInputId,
						[ref("tool-provider-adapter-input", input.adapterInputId)],
						opts.privateRetentionHooks,
					);
					emitRunStatus(
						ctx,
						state,
						{
							kind: "tool-provider-adapter-run-status",
							runId: defaultToolProviderAdapterRunId(input.adapterInputId, 1, input),
							adapterInputId: input.adapterInputId,
							requestId: input.requestId,
							operationId: input.operationId,
							status: "missing-request",
							attempt: 1,
							sourceRefs: [ref("tool-provider-adapter-input", input.adapterInputId)],
						},
						opts.privateRetentionHooks,
					);
				}
			}
			forEachDepBatch(ctx, 1, explicitRunDeps.length, (raw) => {
				if (!isToolProviderAdapterRunRequestedLike(raw)) {
					const request = fallbackToolProviderAdapterRunRequest(raw, opts.publicText);
					const issue = dataIssue(
						"tool-provider-adapter-run-request-invalid-shape",
						"Tool provider adapter run request must be a data object with runId, adapterInputId, requestId, operationId, and attempt.",
						{
							subjectId: request.adapterInputId,
							refs: [ref("tool-provider-adapter-run", request.runId)],
						},
					);
					emitRunIssueFact(ctx, state, issue, opts.privateRetentionHooks);
					emitRunStatus(
						ctx,
						state,
						{
							kind: "tool-provider-adapter-run-status",
							runId: request.runId,
							adapterInputId: request.adapterInputId,
							requestId: request.requestId,
							operationId: request.operationId,
							status: "mismatched-request",
							attempt: request.attempt,
							issues: [issue],
							sourceRefs: request.sourceRefs,
						},
						opts.privateRetentionHooks,
					);
					emitRunAudit(ctx, state, "tool-provider-adapter-run-request-invalid-shape", request, {
						issueCode: issue.code,
					});
					return;
				}
				const request = raw;
				const input = state.inputs.get(request.adapterInputId);
				if (input === undefined) {
					const replayClassification =
						opts.privateRetentionHooks?.classifyRetainedRunRequestReplayEvidence?.(request);
					if (replayClassification?.kind === "retention-gap") {
						emitRunRequested(
							ctx,
							state,
							sanitizeRetainedToolProviderAdapterRunRequest(request, opts.publicText),
							opts.privateRetentionHooks,
						);
						return;
					}
					const issue = dataIssue(
						"tool-provider-adapter-run-request-missing-input",
						"Tool provider adapter run request references an unknown adapter input.",
						{
							subjectId: request.adapterInputId,
							refs: sanitizeAdapterInputSourceRefs([
								ref("tool-provider-adapter-run", request.runId),
								...(request.sourceRefs ?? []),
							]),
						},
					);
					emitRunIssueFact(ctx, state, issue, opts.privateRetentionHooks);
					emitRunStatus(
						ctx,
						state,
						{
							kind: "tool-provider-adapter-run-status",
							runId: request.runId,
							adapterInputId: request.adapterInputId,
							requestId: request.requestId,
							operationId: request.operationId,
							status: "missing-input",
							attempt: request.attempt,
							issues: [issue],
							sourceRefs: sanitizeAdapterInputSourceRefs(request.sourceRefs ?? []),
						},
						opts.privateRetentionHooks,
					);
					return;
				}
				const issues = runRequestIdentityIssues(request, input);
				if (input.status !== "ready") {
					issues.push(
						dataIssue(
							"tool-provider-adapter-run-request-input-not-ready",
							"Tool provider adapter run request requires a ready adapter input.",
							{
								subjectId: input.requestId,
								refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
								details: { status: input.status },
							},
						),
					);
				}
				if (issues.length > 0) {
					for (const issue of issues)
						emitRunIssueFact(ctx, state, issue, opts.privateRetentionHooks);
					emitRunStatus(
						ctx,
						state,
						{
							kind: "tool-provider-adapter-run-status",
							runId: request.runId,
							adapterInputId: request.adapterInputId,
							requestId: request.requestId,
							operationId: request.operationId,
							status: "mismatched-request",
							attempt: request.attempt,
							issues: Object.freeze(issues),
							sourceRefs: sanitizeAdapterInputSourceRefs(request.sourceRefs ?? []),
						},
						opts.privateRetentionHooks,
					);
					emitRunAudit(ctx, state, "tool-provider-adapter-run-request-rejected", request, {
						issueCodes: issues.map((issue) => issue.code),
					});
					return;
				}
				emitRunRequested(
					ctx,
					state,
					sanitizeToolProviderAdapterRunRequest(request, input, opts.publicText),
					opts.privateRetentionHooks,
				);
			});
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderAdapterRunProjector", partial: true },
	);
	return {
		requests: projectRuntimeFact(
			graph,
			runtime,
			`${name}/requests`,
			"toolProviderAdapterRunRequests",
			(fact) => (fact.kind === "request" ? fact.request : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"toolProviderAdapterRunStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"toolProviderAdapterRunIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"toolProviderAdapterRunAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
	};
}

export type ToolProviderAdapterRunFact =
	| { readonly kind: "request"; readonly request: ToolProviderAdapterRunRequested }
	| { readonly kind: "status"; readonly status: ToolProviderAdapterRunStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

export interface ToolProviderAdapterRunProjectorState {
	inputs: Map<string, ToolProviderAdapterInput>;
	emittedKeys: Set<string>;
	statusKeys: Set<string>;
	issueKeys: Set<string>;
	auditSeq: number;
}

export function defaultToolProviderAdapterRunId(
	adapterInputId: string,
	attempt: number,
	input?: ToolProviderAdapterInput,
): string {
	const suffix = input === undefined ? "" : `:${stableStringHash(stableJsonStringify(input))}`;
	return `${adapterInputId}:run-${attempt}${suffix}`;
}

export function sanitizeToolProviderAdapterRunReason(
	reason: ToolProviderAdapterRunReason | undefined,
	attempt: number,
	policy?: ToolProviderPublicTextPolicy,
): ToolProviderAdapterRunReason {
	const value = reason ?? (attempt === 1 ? "initial" : "retry");
	return boundPublicText(value, maxPublicReasonChars(policy)).text as ToolProviderAdapterRunReason;
}

export function sanitizeToolProviderAdapterRunRequest(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput,
	policy?: ToolProviderPublicTextPolicy,
): ToolProviderAdapterRunRequested {
	return Object.freeze({
		...request,
		reason: sanitizeToolProviderAdapterRunReason(request.reason, request.attempt, policy),
		policyRefs: sanitizeAdapterInputSourceRefs(request.policyRefs ?? input.policyRefs ?? []),
		sourceRefs: sanitizeAdapterInputSourceRefs([
			ref("tool-provider-adapter-input", input.adapterInputId),
			...(input.sourceRefs ?? []),
			...(request.sourceRefs ?? []),
		]),
		metadata: sanitizeProviderGraphVisibleRecord(request.metadata),
	} satisfies ToolProviderAdapterRunRequested);
}

export function sanitizeRetainedToolProviderAdapterRunRequest(
	request: ToolProviderAdapterRunRequested,
	policy?: ToolProviderPublicTextPolicy,
): ToolProviderAdapterRunRequested {
	const policyRefs = sanitizeAdapterInputSourceRefs(request.policyRefs ?? []);
	const sourceRefs = sanitizeAdapterInputSourceRefs(request.sourceRefs ?? []);
	const metadata = sanitizeProviderGraphVisibleRecord(request.metadata);
	return Object.freeze({
		kind: "tool-provider-adapter-run-requested",
		runId: request.runId,
		adapterInputId: request.adapterInputId,
		requestId: request.requestId,
		operationId: request.operationId,
		...(request.routeId === undefined ? {} : { routeId: request.routeId }),
		...(request.providerId === undefined ? {} : { providerId: request.providerId }),
		...(request.executorId === undefined ? {} : { executorId: request.executorId }),
		...(request.profileId === undefined ? {} : { profileId: request.profileId }),
		attempt: request.attempt,
		reason: sanitizeToolProviderAdapterRunReason(request.reason, request.attempt, policy),
		...(request.retryOfOutcomeId === undefined
			? {}
			: { retryOfOutcomeId: request.retryOfOutcomeId }),
		...(policyRefs.length === 0 ? {} : { policyRefs }),
		...(sourceRefs.length === 0 ? {} : { sourceRefs }),
		...(metadata === undefined ? {} : { metadata }),
		...(request.requestedAtMs === undefined ? {} : { requestedAtMs: request.requestedAtMs }),
	} satisfies ToolProviderAdapterRunRequested);
}

export function isToolProviderAdapterRunRequestedLike(
	value: unknown,
): value is ToolProviderAdapterRunRequested {
	const attempt = isRecord(value) ? value.attempt : undefined;
	return (
		isRecord(value) &&
		value.kind === "tool-provider-adapter-run-requested" &&
		typeof value.runId === "string" &&
		value.runId.length > 0 &&
		typeof value.adapterInputId === "string" &&
		value.adapterInputId.length > 0 &&
		typeof value.requestId === "string" &&
		value.requestId.length > 0 &&
		typeof value.operationId === "string" &&
		value.operationId.length > 0 &&
		typeof attempt === "number" &&
		Number.isInteger(attempt) &&
		attempt > 0 &&
		typeof value.reason === "string" &&
		value.reason.length > 0
	);
}

export function fallbackToolProviderAdapterRunRequest(
	raw: unknown,
	policy?: ToolProviderPublicTextPolicy,
): ToolProviderAdapterRunRequested {
	const record = isRecord(raw) ? raw : {};
	const adapterInputId =
		typeof record.adapterInputId === "string" && record.adapterInputId.length > 0
			? record.adapterInputId
			: "<invalid-adapter-input>";
	const runId =
		typeof record.runId === "string" && record.runId.length > 0
			? record.runId
			: `${adapterInputId}:invalid-run`;
	const attempt =
		typeof record.attempt === "number" && Number.isInteger(record.attempt) && record.attempt > 0
			? record.attempt
			: 1;
	const metadata = isRecord(record.metadata)
		? sanitizeProviderGraphVisibleRecord(record.metadata, policy)
		: undefined;
	return Object.freeze({
		kind: "tool-provider-adapter-run-requested",
		runId,
		adapterInputId,
		requestId:
			typeof record.requestId === "string" && record.requestId.length > 0
				? record.requestId
				: "<invalid-request>",
		operationId:
			typeof record.operationId === "string" && record.operationId.length > 0
				? record.operationId
				: "<invalid-operation>",
		attempt,
		reason: sanitizeToolProviderAdapterRunReason(
			typeof record.reason === "string" && record.reason.length > 0 ? record.reason : "manual",
			attempt,
			policy,
		),
		sourceRefs: sanitizeAdapterInputSourceRefs([
			ref("tool-provider-adapter-run", runId),
			...sanitizeUntrustedSourceRefs(record.sourceRefs),
		]),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies ToolProviderAdapterRunRequested);
}

export function sanitizeUntrustedSourceRefs(value: unknown): readonly SourceRef[] {
	if (!Array.isArray(value)) return [];
	return Object.freeze(
		value
			.filter(
				(sourceRef): sourceRef is SourceRef =>
					isRecord(sourceRef) &&
					typeof sourceRef.kind === "string" &&
					sourceRef.kind.length > 0 &&
					typeof sourceRef.id === "string" &&
					sourceRef.id.length > 0,
			)
			.map((sourceRef) => ({
				kind: sourceRef.kind,
				id: sourceRef.id,
				...(isRecord(sourceRef.metadata) ? { metadata: sourceRef.metadata } : {}),
			})),
	);
}

export function runRequestIdentityIssues(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput,
): DataIssue[] {
	const refs = sanitizeAdapterInputSourceRefs([
		ref("tool-provider-adapter-run", request.runId),
		ref("tool-provider-adapter-input", input.adapterInputId),
		...(request.sourceRefs ?? []),
	]);
	const issues: DataIssue[] = [];
	if (request.kind !== "tool-provider-adapter-run-requested") {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-invalid-kind",
				"Tool provider adapter run request kind must be tool-provider-adapter-run-requested.",
				{ subjectId: request.adapterInputId, refs },
			),
		);
	}
	if (request.runId.length === 0) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-missing-run-id",
				"Tool provider adapter run request requires runId.",
				{
					subjectId: request.adapterInputId,
					refs,
				},
			),
		);
	}
	if (!Number.isInteger(request.attempt) || request.attempt < 1) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-invalid-attempt",
				"Tool provider adapter run request attempt must be a positive integer.",
				{ subjectId: request.adapterInputId, refs },
			),
		);
	}
	if (request.requestId !== input.requestId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-stale-request",
				"Tool provider adapter run request requestId does not match the adapter input.",
				{ subjectId: input.requestId, refs },
			),
		);
	}
	if (request.operationId !== input.operationId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-stale-operation",
				"Tool provider adapter run request operationId does not match the adapter input.",
				{ subjectId: input.requestId, refs },
			),
		);
	}
	if (request.routeId !== undefined && request.routeId !== input.routeId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-stale-route",
				"Tool provider adapter run request routeId does not match the adapter input.",
				{ subjectId: input.requestId, refs },
			),
		);
	}
	if (request.providerId !== undefined && request.providerId !== input.providerId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-stale-provider",
				"Tool provider adapter run request providerId does not match the adapter input.",
				{ subjectId: input.requestId, refs },
			),
		);
	}
	if (request.executorId !== undefined && request.executorId !== input.executorId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-stale-executor",
				"Tool provider adapter run request executorId does not match the adapter input.",
				{ subjectId: input.requestId, refs },
			),
		);
	}
	if (request.profileId !== undefined && request.profileId !== input.profileId) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-stale-profile",
				"Tool provider adapter run request profileId does not match the adapter input.",
				{ subjectId: input.requestId, refs },
			),
		);
	}
	for (const forbidden of [
		...forbiddenDataKeys(request),
		...forbiddenProviderRawMaterialKeys(request),
	]) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-run-request-forbidden-runtime-material",
				"Tool provider adapter run request must not contain runtime-private adapter material.",
				{ subjectId: input.requestId, refs, details: { reason: forbidden.reason } },
			),
		);
	}
	return issues;
}

export function emitRunRequested(
	ctx: Ctx,
	state: ToolProviderAdapterRunProjectorState,
	request: ToolProviderAdapterRunRequested,
	privateRetentionHooks?: ToolProviderAdapterRunProjectorPrivateRetentionHooks,
): void {
	const key = `${request.runId}:${request.adapterInputId}:${request.attempt}`;
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "request", request } satisfies ToolProviderAdapterRunFact]]);
	privateRetentionHooks?.onRunRequestKey?.({
		key,
		request,
		dropKey: () => state.emittedKeys.delete(key),
	});
	emitRunStatus(
		ctx,
		state,
		{
			kind: "tool-provider-adapter-run-status",
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			status: "requested",
			attempt: request.attempt,
			sourceRefs: request.sourceRefs,
		},
		privateRetentionHooks,
	);
	emitRunAudit(ctx, state, "tool-provider-adapter-run-requested", request, {
		reason: request.reason,
		attempt: request.attempt,
	});
}

export function emitRunStatus(
	ctx: Ctx,
	state: ToolProviderAdapterRunProjectorState,
	status: ToolProviderAdapterRunStatus,
	privateRetentionHooks?: ToolProviderAdapterRunProjectorPrivateRetentionHooks,
): void {
	const cleanSourceRefs =
		status.sourceRefs === undefined ? undefined : sanitizeAdapterInputSourceRefs(status.sourceRefs);
	const cleanIssues =
		status.issues === undefined
			? undefined
			: Object.freeze(status.issues.map((issue) => sanitizeAdapterInputIssue(issue)));
	const cleanMetadata = sanitizeProviderGraphVisibleRecord(status.metadata);
	const cleanStatus = Object.freeze({
		kind: status.kind,
		runId: status.runId,
		adapterInputId: status.adapterInputId,
		...(status.requestId === undefined ? {} : { requestId: status.requestId }),
		...(status.operationId === undefined ? {} : { operationId: status.operationId }),
		status: status.status,
		...(status.attempt === undefined ? {} : { attempt: status.attempt }),
		...(status.outcomeId === undefined ? {} : { outcomeId: status.outcomeId }),
		...(cleanIssues === undefined || cleanIssues.length === 0 ? {} : { issues: cleanIssues }),
		...(cleanSourceRefs === undefined || cleanSourceRefs.length === 0
			? {}
			: { sourceRefs: cleanSourceRefs }),
		...(cleanMetadata === undefined ? {} : { metadata: cleanMetadata }),
	} satisfies ToolProviderAdapterRunStatus);
	const key = stableJsonStringify({
		runId: cleanStatus.runId,
		adapterInputId: cleanStatus.adapterInputId,
		requestId: cleanStatus.requestId,
		attempt: cleanStatus.attempt,
		status: cleanStatus.status,
		outcomeId: cleanStatus.outcomeId,
	});
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	ctx.down([
		["DATA", { kind: "status", status: cleanStatus } satisfies ToolProviderAdapterRunFact],
	]);
	privateRetentionHooks?.onRunStatusKey?.({
		key,
		status: cleanStatus,
		dropKey: () => state.statusKeys.delete(key),
	});
}

export function emitRunIssue(
	ctx: Ctx,
	state: ToolProviderAdapterRunProjectorState,
	code: string,
	message: string,
	subjectId: string,
	refs?: readonly SourceRef[],
	privateRetentionHooks?: ToolProviderAdapterRunProjectorPrivateRetentionHooks,
): void {
	emitRunIssueFact(
		ctx,
		state,
		dataIssue(code, message, { subjectId, refs }),
		privateRetentionHooks,
	);
}

export function emitRunIssueFact(
	ctx: Ctx,
	state: ToolProviderAdapterRunProjectorState,
	issue: DataIssue,
	privateRetentionHooks?: ToolProviderAdapterRunProjectorPrivateRetentionHooks,
): void {
	const key = stableJsonStringify({
		code: issue.code,
		subjectId: issue.subjectId,
		refs: issue.refs ?? [],
		details: issue.details,
	});
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	ctx.down([["DATA", { kind: "issue", issue } satisfies ToolProviderAdapterRunFact]]);
	privateRetentionHooks?.onRunIssueKey?.({
		key,
		issue,
		dropKey: () => state.issueKeys.delete(key),
	});
}

export function emitRunAudit(
	ctx: Ctx,
	state: ToolProviderAdapterRunProjectorState,
	kind: string,
	request: ToolProviderAdapterRunRequested,
	metadata?: Record<string, unknown>,
): void {
	state.auditSeq += 1;
	ctx.down([
		[
			"DATA",
			{
				kind: "audit",
				audit: {
					id: `${request.runId}:audit:${state.auditSeq}`,
					kind,
					subjectId: request.requestId,
					sourceRefs: sanitizeAdapterInputSourceRefs(request.sourceRefs ?? []),
					metadata: sanitizeProviderGraphVisibleRecord({
						runId: request.runId,
						adapterInputId: request.adapterInputId,
						...metadata,
					}),
				},
			} satisfies ToolProviderAdapterRunFact,
		],
	]);
}
