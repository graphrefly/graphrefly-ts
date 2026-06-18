import type { DataIssue } from "../data/index.js";
import type {
	ReplayEvidenceClassification,
	RuntimeRetentionIndex,
} from "./agent-runtime-adapter-retention.js";
import { runRequestIdentityIssues } from "./agent-runtime-adapter-run.js";
import { dataIssue, ref } from "./agent-runtime-common.js";
import { readThenable } from "./agent-runtime-executor-outcome.js";
import type { AgentRequestStatus } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterBinding,
	ToolProviderAdapterExecutionRetentionEntry,
	ToolProviderAdapterInput,
	ToolProviderAdapterInputRetentionEntry,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunResult,
	ToolProviderAdapterRunStatus,
} from "./agent-runtime-types-tool.js";

export interface AdapterRuntimeRunRequestContext<TArguments = unknown, TResult = unknown> {
	isDisposed(): boolean;
	adapterInputs: RuntimeRetentionIndex<
		ToolProviderAdapterInputRetentionEntry,
		ToolProviderAdapterInput<TArguments>
	>;
	executions: RuntimeRetentionIndex<
		ToolProviderAdapterExecutionRetentionEntry,
		ToolProviderAdapterRunRequested
	>;
	bindings: ReadonlyMap<string, ToolProviderAdapterBinding<TArguments, TResult>>;
	now?: () => number;
	classifyRunRequestReplayEvidence(
		request: ToolProviderAdapterRunRequested,
		input?: ToolProviderAdapterInput<TArguments>,
	): ReplayEvidenceClassification;
	publishReplayClassification(
		request: ToolProviderAdapterRunRequested,
		classification: ReplayEvidenceClassification,
	): boolean;
	startExecutionProof(request: ToolProviderAdapterRunRequested): boolean;
	executionCoordinate(request: ToolProviderAdapterRunRequested): string;
	publishIssue(issue: DataIssue, track?: boolean): void;
	publishRunStatus(
		request: ToolProviderAdapterRunRequested,
		statusValue: ToolProviderAdapterRunStatus["status"],
		issueList?: readonly DataIssue[],
	): void;
	publishStatus(
		input: ToolProviderAdapterInput<TArguments>,
		statusValue: AgentRequestStatus,
		issueList?: readonly DataIssue[],
	): void;
	publishAudit(
		input: ToolProviderAdapterInput<TArguments>,
		kind: string,
		metadata?: Record<string, unknown>,
	): void;
	publishOutcome(
		input: ToolProviderAdapterInput<TArguments>,
		result: ToolProviderAdapterRunResult<TResult>,
		request: ToolProviderAdapterRunRequested,
	): void;
	publishRuntimeFailure(
		input: ToolProviderAdapterInput<TArguments>,
		request: ToolProviderAdapterRunRequested,
		code: string,
		error: unknown,
	): void;
}

export function runAdapterRuntimeRequest<TArguments = unknown, TResult = unknown>(
	ctx: AdapterRuntimeRunRequestContext<TArguments, TResult>,
	request: ToolProviderAdapterRunRequested,
): void {
	if (ctx.isDisposed()) return;
	const input = ctx.adapterInputs.get(request.adapterInputId)?.value;
	if (input === undefined) {
		const missingInputClassification = ctx.classifyRunRequestReplayEvidence(request);
		ctx.publishReplayClassification(request, missingInputClassification);
		return;
	}
	if (input.status !== "ready") {
		const issue = dataIssue(
			"tool-provider-adapter-runtime-input-not-ready",
			"Tool provider adapter runtime requires a ready adapter input.",
			{
				subjectId: input.requestId,
				refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
				details: { status: input.status },
			},
		);
		ctx.publishIssue(issue);
		ctx.publishRunStatus(request, "stale-request", [issue]);
		ctx.publishStatus(input, "blocked", [issue]);
		return;
	}
	const requestIssues = runRequestIdentityIssues(request, input);
	if (requestIssues.length > 0) {
		for (const issue of requestIssues) ctx.publishIssue(issue);
		ctx.publishRunStatus(request, "mismatched-request", requestIssues);
		ctx.publishStatus(input, "blocked", requestIssues);
		ctx.publishAudit(input, "tool-provider-adapter-runtime-run-request-rejected", {
			runId: request.runId,
			attempt: request.attempt,
			issueCodes: requestIssues.map((issue) => issue.code),
		});
		return;
	}
	if (ctx.executions.has(ctx.executionCoordinate(request))) {
		ctx.startExecutionProof(request);
		return;
	}
	const classification = ctx.classifyRunRequestReplayEvidence(request, input);
	if (ctx.publishReplayClassification(request, classification)) return;
	if (!ctx.startExecutionProof(request)) return;
	const binding = input.providerId === undefined ? undefined : ctx.bindings.get(input.providerId);
	if (binding === undefined) {
		const issue = dataIssue(
			"tool-provider-adapter-runtime-missing-binding",
			"Tool provider adapter runtime requires a matching runtime-private binding.",
			{
				subjectId: input.requestId,
				refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
				details: { providerId: input.providerId },
			},
		);
		ctx.publishOutcome(
			input,
			{
				kind: "blocked",
				needs: [
					{
						kind: "tool-provider-binding",
						message: "Matching runtime-private tool provider binding is unavailable.",
						...(input.providerId === undefined
							? {}
							: { refs: [ref("tool-provider", input.providerId)] }),
					},
				],
				issues: [issue],
			},
			request,
		);
		return;
	}
	ctx.publishRunStatus(request, "started");
	ctx.publishStatus(input, "in-flight");
	ctx.publishAudit(input, "tool-provider-adapter-runtime-started", {
		providerId: binding.providerId,
		runId: request.runId,
		attempt: request.attempt,
		reason: request.reason,
	});
	let result:
		| ToolProviderAdapterRunResult<TResult>
		| PromiseLike<ToolProviderAdapterRunResult<TResult>>;
	try {
		result = binding.run(input, {
			runId: request.runId,
			attempt: request.attempt,
			reason: request.reason,
			sourceRefs: request.sourceRefs ?? input.sourceRefs ?? [],
			now: ctx.now,
		});
	} catch (error) {
		ctx.publishRuntimeFailure(input, request, "tool-provider-adapter-runtime-threw", error);
		return;
	}
	const thenable = readThenable(result);
	if (thenable.error !== undefined) {
		ctx.publishRuntimeFailure(
			input,
			request,
			"tool-provider-adapter-runtime-rejected",
			thenable.error,
		);
		return;
	}
	if (thenable.subscribe !== undefined) {
		let settled = false;
		try {
			thenable.subscribe(
				(value) => {
					if (settled) return;
					settled = true;
					ctx.publishOutcome(input, value, request);
				},
				(error) => {
					if (settled) return;
					settled = true;
					ctx.publishRuntimeFailure(
						input,
						request,
						"tool-provider-adapter-runtime-rejected",
						error,
					);
				},
			);
		} catch (error) {
			if (!settled)
				ctx.publishRuntimeFailure(input, request, "tool-provider-adapter-runtime-rejected", error);
		}
		return;
	}
	ctx.publishOutcome(input, result as ToolProviderAdapterRunResult<TResult>, request);
}
