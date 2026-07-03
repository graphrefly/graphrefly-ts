import type { DataIssue } from "../data/index.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import {
	boundedPublicText,
	dataIssue,
	publicMaterialForbiddenKeys,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
	sanitizeAgentNeed,
	sanitizeAgentOutputEnvelope,
	sanitizeGraphVisibleRecord,
	sanitizeRuntimeMetadata,
} from "./agent-runtime-common.js";
import type { AgentRequestStatus, ExecutorOutcome, SourceRef } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderAdapterRunResult,
	ToolProviderPublicTextPolicy,
} from "./agent-runtime-types-tool.js";

export function adapterRuntimeIdentity(input: ToolProviderAdapterInput): {
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
} {
	if (input.status !== "ready") {
		throw new RangeError("buildToolProviderExecutorOutcome: adapter input must be ready");
	}
	if (
		input.routeId === undefined ||
		input.executorId === undefined ||
		input.profileId === undefined
	) {
		throw new RangeError(
			"buildToolProviderExecutorOutcome: ready adapter input is missing route/executor/profile identity",
		);
	}
	return {
		routeId: input.routeId,
		executorId: input.executorId,
		profileId: input.profileId,
	};
}

export function defaultToolProviderAdapterEvidenceRefs(
	input: ToolProviderAdapterInput,
): readonly SourceRef[] {
	return sanitizeAdapterInputSourceRefs([
		ref("tool-provider-adapter-input", input.adapterInputId),
		...(input.sourceRefs ?? []),
	]);
}

export function buildToolProviderExecutorOutcome<T = unknown>(
	input: ToolProviderAdapterInput,
	result: ToolProviderAdapterRunResult<T>,
	opts: {
		readonly attempt?: number;
		readonly outcomeId?: string;
		readonly occurredAtMs?: number;
		readonly runId?: string;
		readonly publicText?: ToolProviderPublicTextPolicy;
	} = {},
): ExecutorOutcome<T> {
	const ids = adapterRuntimeIdentity(input);
	const attempt = opts.attempt ?? 1;
	const occurredAtMs = result.occurredAtMs ?? opts.occurredAtMs;
	const evidenceRefs =
		result.evidenceRefs === undefined
			? defaultToolProviderAdapterEvidenceRefs(input)
			: sanitizeAdapterInputSourceRefs(result.evidenceRefs);
	const issues =
		result.issues === undefined
			? undefined
			: Object.freeze(
					result.issues.map((issue) => sanitizeAdapterInputIssue(issue, opts.publicText)),
				);
	const textIssues: DataIssue[] = [];
	const metadata = sanitizeRuntimeMetadata(
		{
			...(result.metadata ?? {}),
			adapterInputId: input.adapterInputId,
			...(opts.runId === undefined ? {} : { runId: opts.runId }),
			providerId: input.providerId,
			toolName: input.toolName,
			operation: input.operation,
		},
		input,
		opts.publicText,
		textIssues,
	);
	if (metadata === undefined && result.metadata !== undefined) {
		textIssues.push(
			dataIssue(
				"tool-provider-adapter-runtime-metadata-redacted",
				"Tool provider adapter runtime metadata was omitted because it contained runtime-private material.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					severity: "warning",
				},
			),
		);
	}
	const base = {
		outcomeId:
			opts.outcomeId ??
			compoundTupleKey("tool-provider-executor-outcome", [
				input.adapterInputId,
				toolProviderOutcomeRunSegment(opts.runId, attempt),
				result.kind,
			]),
		requestId: input.requestId,
		operationId: input.operationId,
		routeId: ids.routeId,
		executorId: ids.executorId,
		profileId: ids.profileId,
		attempt,
		evidenceRefs,
		...(input.input?.inputId === undefined ? {} : { inputId: input.input.inputId }),
		...(input.input?.inputKind === undefined ? {} : { inputKind: input.input.inputKind }),
		...(occurredAtMs === undefined ? {} : { occurredAtMs }),
		...(issues === undefined ? {} : { issues }),
		...(result.usage === undefined ? {} : { usage: result.usage }),
		...(metadata === undefined ? {} : { metadata }),
	};
	const candidate = (() => {
		switch (result.kind) {
			case "result":
				return {
					...base,
					kind: "result",
					result: sanitizeAgentOutputEnvelope(result.result, input, opts.publicText, textIssues),
				} satisfies ExecutorOutcome<T>;
			case "failure":
				return {
					...base,
					kind: "failure",
					error: sanitizeAdapterInputIssue(result.error, opts.publicText),
					...(result.retryable === undefined ? {} : { retryable: result.retryable }),
				} satisfies ExecutorOutcome<T>;
			case "canceled":
				return {
					...base,
					kind: "canceled",
					...(result.reason === undefined
						? {}
						: {
								reason: boundedPublicText(
									result.reason,
									"reason",
									input,
									opts.publicText,
									textIssues,
								),
							}),
				} satisfies ExecutorOutcome<T>;
			case "timeout":
				return {
					...base,
					kind: "timeout",
					...(result.timeoutMs === undefined ? {} : { timeoutMs: result.timeoutMs }),
					...(result.retryable === undefined ? {} : { retryable: result.retryable }),
				} satisfies ExecutorOutcome<T>;
			case "blocked":
				return {
					...base,
					kind: "blocked",
					needs: Object.freeze(
						result.needs.map((need) => sanitizeAgentNeed(need, input, opts.publicText, textIssues)),
					),
				} satisfies ExecutorOutcome<T>;
		}
	})();
	const boundedCandidate =
		textIssues.length === 0
			? candidate
			: ({
					...candidate,
					issues: Object.freeze([...(candidate.issues ?? []), ...textIssues]),
				} satisfies ExecutorOutcome<T>);
	const materialIssues = (boundedCandidate.issues ?? []).filter(
		(issue) => issue.code === "tool-provider-adapter-runtime-forbidden-runtime-material",
	);
	const leakIssues = forbiddenAdapterRuntimeMaterialIssues(
		boundedCandidate,
		ref("executor-outcome", boundedCandidate.outcomeId),
		"executor-outcome",
	);
	if (leakIssues.length === 0 && materialIssues.length === 0)
		return Object.freeze(boundedCandidate);
	const allLeakIssues = Object.freeze([...materialIssues, ...leakIssues]);
	const issue = allLeakIssues[0] ?? dataIssue("tool-provider-adapter-runtime-invalid", "invalid");
	const failureMetadata = sanitizeGraphVisibleRecord({
		adapterInputId: input.adapterInputId,
		...(opts.runId === undefined ? {} : { runId: opts.runId }),
		providerId: input.providerId,
		toolName: input.toolName,
		operation: input.operation,
	});
	return Object.freeze({
		kind: "failure",
		outcomeId: compoundTupleKey("tool-provider-executor-outcome", [
			input.adapterInputId,
			toolProviderOutcomeRunSegment(opts.runId, attempt),
			"failure",
		]),
		requestId: input.requestId,
		operationId: input.operationId,
		routeId: ids.routeId,
		executorId: ids.executorId,
		profileId: ids.profileId,
		attempt,
		evidenceRefs,
		...(input.input?.inputId === undefined ? {} : { inputId: input.input.inputId }),
		...(input.input?.inputKind === undefined ? {} : { inputKind: input.input.inputKind }),
		...(occurredAtMs === undefined ? {} : { occurredAtMs }),
		...(failureMetadata === undefined ? {} : { metadata: failureMetadata }),
		error: issue,
		retryable: false,
		issues: allLeakIssues,
	} as ExecutorOutcome<T>);
}

export function agentRequestStatusForExecutorOutcome(outcome: ExecutorOutcome): AgentRequestStatus {
	switch (outcome.kind) {
		case "result":
			return "completed";
		case "failure":
			return "failed";
		case "canceled":
			return "canceled";
		case "timeout":
			return "timeout";
		case "blocked":
			return "blocked";
	}
}

export function toolProviderOutcomeRunSegment(runId: string | undefined, attempt: number): string {
	return runId === undefined
		? compoundTupleKey("attempt", [String(attempt)])
		: canonicalTupleKey([runId, compoundTupleKey("attempt", [String(attempt)])]);
}

export function adapterRuntimeIssue(
	input: ToolProviderAdapterInput,
	code: string,
	error: unknown,
): DataIssue {
	return dataIssue(code, "Tool provider adapter runtime failed.", {
		subjectId: input.requestId,
		refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
		details: { errorType: error instanceof Error ? error.name : typeof error },
	});
}

export function forbiddenAdapterRuntimeMaterialIssues(
	value: unknown,
	subjectRef: SourceRef,
	area: string,
): readonly DataIssue[] {
	if (value === undefined) return [];
	const forbidden = publicMaterialForbiddenKeys(value, "provider");
	if (forbidden.length === 0) return [];
	return Object.freeze(
		forbidden.map((entry) =>
			dataIssue(
				"tool-provider-adapter-runtime-forbidden-runtime-material",
				"Tool provider adapter runtime output must not contain runtime-private adapter material.",
				{ subjectId: subjectRef.id, refs: [subjectRef], details: { area, reason: entry.reason } },
			),
		),
	);
}

export function readThenable<T>(value: T | PromiseLike<T>): {
	readonly subscribe?: PromiseLike<T>["then"];
	readonly error?: unknown;
} {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) return {};
	try {
		const then = (value as { then?: unknown }).then;
		if (typeof then !== "function") return {};
		return { subscribe: then.bind(value) as PromiseLike<T>["then"] };
	} catch (error) {
		return { error };
	}
}

export function outcomeIssues(outcome: ExecutorOutcome): readonly DataIssue[] {
	if (outcome.kind === "failure") return Object.freeze([outcome.error, ...(outcome.issues ?? [])]);
	return outcome.issues ?? [];
}
