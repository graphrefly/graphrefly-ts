import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { RetryPolicy } from "../graph/resilience.js";
import { nextRetryDelayMs, shouldRetry } from "../graph/resilience.js";
import type { Node } from "../node/node.js";
import { requestToolProviderAdapterRun } from "./agent-runtime-adapter-run.js";
import {
	dataIssue,
	forEachDepBatch,
	isRecord,
	projectRuntimeFact,
	ref,
	sanitizeAdapterInputIssue,
	sanitizeAdapterInputSourceRefs,
	sanitizeProviderGraphVisibleRecord,
	uniqueSourceRefs,
} from "./agent-runtime-common.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { ExecutorOutcome, SourceRef } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderRunRetryBundle,
	ToolProviderRunRetryPolicy,
	ToolProviderRunRetryProposal,
	ToolProviderRunRetryScheduled,
	ToolProviderRunRetryStatus,
	ToolProviderRunRetryStatusState,
	ToolProviderRunRetryViews,
} from "./agent-runtime-types-tool.js";

export function toolProviderRunRetryProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly inputs: Node<ToolProviderAdapterInput>;
		readonly outcomes: Node<ExecutorOutcome>;
		readonly policies?: readonly Node<ToolProviderRunRetryPolicy>[];
		readonly nowMs?: Node<number>;
	},
): ToolProviderRunRetryBundle {
	const name = opts.name ?? "toolProviderRunRetry";
	const policyDeps = opts.policies ?? [];
	const nowDeps = opts.nowMs === undefined ? [] : [opts.nowMs];
	const outcomeDepIndex = 1 + policyDeps.length;
	const nowDepIndex = outcomeDepIndex + 1;
	const runtime = graph.node<ToolProviderRunRetryFact>(
		[opts.inputs, ...policyDeps, opts.outcomes, ...nowDeps],
		(ctx) => {
			const state = ctx.state.get<ToolProviderRunRetryProjectorState>() ?? initialRetryState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const input = raw as ToolProviderAdapterInput;
				state.inputsById.set(input.adapterInputId, input);
				let inputIds = state.inputIdsByRequest.get(input.requestId);
				if (inputIds === undefined) {
					inputIds = new Set();
					state.inputIdsByRequest.set(input.requestId, inputIds);
				}
				inputIds.add(input.adapterInputId);
			}
			forEachDepBatch(ctx, 1, policyDeps.length, (raw) => {
				const policy = sanitizeToolProviderRunRetryPolicy(raw as ToolProviderRunRetryPolicy);
				state.policies.set(policy.policyId, policy);
			});
			for (const rawNow of depBatch(ctx, nowDepIndex) ?? []) {
				if (typeof rawNow === "number" && Number.isFinite(rawNow)) state.nowMs = rawNow;
			}
			for (const raw of depBatch(ctx, outcomeDepIndex) ?? []) {
				retainOutcome(state, raw as ExecutorOutcome);
			}
			evaluateOutcomes(ctx, state);
			processDueRetries(ctx, state);
			ctx.down([["DATA", { kind: "views", views: buildRetryViews(state) }]]);
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "toolProviderRunRetryProjector", partial: true },
	);
	return {
		proposals: projectRuntimeFact(
			graph,
			runtime,
			`${name}/proposals`,
			"toolProviderRunRetryProposals",
			(fact) => (fact.kind === "proposal" ? fact.proposal : undefined),
		),
		scheduled: projectRuntimeFact(
			graph,
			runtime,
			`${name}/scheduled`,
			"toolProviderRunRetryScheduled",
			(fact) => (fact.kind === "scheduled" ? fact.scheduled : undefined),
		),
		runRequests: projectRuntimeFact(
			graph,
			runtime,
			`${name}/runRequests`,
			"toolProviderRunRetryRunRequests",
			(fact) => (fact.kind === "run-request" ? fact.request : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"toolProviderRunRetryStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"toolProviderRunRetryIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"toolProviderRunRetryAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: projectRuntimeFact(
			graph,
			runtime,
			`${name}/views`,
			"toolProviderRunRetryViews",
			(fact) => (fact.kind === "views" ? fact.views : undefined),
		),
	};
}

type ToolProviderRunRetryFact =
	| { readonly kind: "proposal"; readonly proposal: ToolProviderRunRetryProposal }
	| { readonly kind: "scheduled"; readonly scheduled: ToolProviderRunRetryScheduled }
	| { readonly kind: "run-request"; readonly request: ToolProviderAdapterRunRequested }
	| { readonly kind: "status"; readonly status: ToolProviderRunRetryStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord }
	| { readonly kind: "views"; readonly views: ToolProviderRunRetryViews };

interface ToolProviderRunRetryProjectorState {
	inputIdsByRequest: Map<string, Set<string>>;
	inputsById: Map<string, ToolProviderAdapterInput>;
	policies: Map<string, ToolProviderRunRetryPolicy>;
	outcomesById: Map<string, ExecutorOutcome>;
	proposalsByOutcome: Map<string, ToolProviderRunRetryProposal>;
	scheduledByOutcome: Map<string, ToolProviderRunRetryScheduled>;
	nextRequestsByOutcome: Map<string, ToolProviderAdapterRunRequested>;
	statusByOutcome: Map<string, ToolProviderRunRetryStatus>;
	proposalKeys: Set<string>;
	scheduledKeys: Set<string>;
	requestKeys: Set<string>;
	statusKeys: Set<string>;
	issueKeys: Set<string>;
	auditSeq: number;
	nowMs: number | undefined;
}

interface RetryPolicyChoice {
	readonly policy: ToolProviderRunRetryPolicy;
	readonly score: number;
}

function initialRetryState(): ToolProviderRunRetryProjectorState {
	return {
		inputIdsByRequest: new Map(),
		inputsById: new Map(),
		policies: new Map(),
		outcomesById: new Map(),
		proposalsByOutcome: new Map(),
		scheduledByOutcome: new Map(),
		nextRequestsByOutcome: new Map(),
		statusByOutcome: new Map(),
		proposalKeys: new Set(),
		scheduledKeys: new Set(),
		requestKeys: new Set(),
		statusKeys: new Set(),
		issueKeys: new Set(),
		auditSeq: 0,
		nowMs: undefined,
	};
}

function retainOutcome(state: ToolProviderRunRetryProjectorState, outcome: ExecutorOutcome): void {
	if (!state.outcomesById.has(outcome.outcomeId))
		state.outcomesById.set(outcome.outcomeId, outcome);
}

function inputForOutcome(
	state: ToolProviderRunRetryProjectorState,
	outcome: ExecutorOutcome,
):
	| { readonly ok: true; readonly input: ToolProviderAdapterInput }
	| { readonly ok: false; readonly issue: DataIssue } {
	if (typeof outcome.inputId === "string" && outcome.inputId.length > 0) {
		const exactInput = state.inputsById.get(outcome.inputId);
		if (exactInput !== undefined) return { ok: true, input: exactInput };
		return {
			ok: false,
			issue: dataIssue(
				"tool-provider-run-retry-missing-input",
				"Tool provider run retry requires the retained adapter input identified by the outcome.",
				{
					subjectId: outcome.inputId,
					refs: [ref("executor-outcome", outcome.outcomeId)],
				},
			),
		};
	}
	const inputIds = state.inputIdsByRequest.get(outcome.requestId);
	if (inputIds === undefined || inputIds.size === 0) {
		return {
			ok: false,
			issue: dataIssue(
				"tool-provider-run-retry-missing-input",
				"Tool provider run retry requires a retained adapter input for the outcome request.",
				{ subjectId: outcome.requestId, refs: [ref("executor-outcome", outcome.outcomeId)] },
			),
		};
	}
	if (inputIds.size > 1) {
		return {
			ok: false,
			issue: dataIssue(
				"tool-provider-run-retry-ambiguous-input",
				"Tool provider run retry requires an exact outcome inputId when multiple adapter inputs share a request.",
				{
					subjectId: outcome.requestId,
					refs: [ref("executor-outcome", outcome.outcomeId)],
					details: { inputIds: [...inputIds].sort() },
				},
			),
		};
	}
	const [inputId] = inputIds;
	const input = inputId === undefined ? undefined : state.inputsById.get(inputId);
	if (input !== undefined) return { ok: true, input };
	return {
		ok: false,
		issue: dataIssue(
			"tool-provider-run-retry-missing-input",
			"Tool provider run retry requires a retained adapter input for the outcome request.",
			{ subjectId: outcome.requestId, refs: [ref("executor-outcome", outcome.outcomeId)] },
		),
	};
}

function evaluateOutcomes(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
): void {
	for (const outcome of state.outcomesById.values()) evaluateOutcome(ctx, state, outcome);
}

function evaluateOutcome(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	outcome: ExecutorOutcome,
): void {
	const inputResolution = inputForOutcome(state, outcome);
	if (!inputResolution.ok) {
		emitIssue(ctx, state, inputResolution.issue);
		emitStatus(ctx, state, statusForMissingInput(outcome, "blocked", [inputResolution.issue]));
		return;
	}
	const input = inputResolution.input;
	if (input.status !== "ready") {
		const issue = dataIssue(
			"tool-provider-run-retry-input-not-ready",
			"Tool provider run retry requires a ready adapter input.",
			{
				subjectId: input.adapterInputId,
				refs: [
					ref("executor-outcome", outcome.outcomeId),
					ref("tool-provider-adapter-input", input.adapterInputId),
				],
				details: { status: input.status },
			},
		);
		emitIssue(ctx, state, issue);
		emitStatus(ctx, state, statusForOutcome(outcome, input, "blocked", { issues: [issue] }));
		return;
	}
	if (!isRetryableOutcome(outcome)) {
		emitStatus(ctx, state, statusForOutcome(outcome, input, "not-retryable"));
		return;
	}
	if (
		state.scheduledByOutcome.has(outcome.outcomeId) ||
		state.nextRequestsByOutcome.has(outcome.outcomeId)
	) {
		return;
	}
	const choice = chooseRetryPolicy(state, input, outcome);
	if (choice === undefined) {
		const issue = dataIssue(
			"tool-provider-run-retry-policy-missing",
			"Tool provider run retry requires an explicit retry policy fact.",
			{
				subjectId: input.adapterInputId,
				refs: [
					ref("executor-outcome", outcome.outcomeId),
					ref("tool-provider-adapter-input", input.adapterInputId),
				],
			},
		);
		emitIssue(ctx, state, issue);
		emitStatus(ctx, state, statusForOutcome(outcome, input, "not-retryable", { issues: [issue] }));
		return;
	}
	if (!shouldRetry(choice.policy.retryPolicy, outcome.attempt)) {
		const issue = dataIssue(
			"tool-provider-run-retry-exhausted",
			"Tool provider run retry policy exhausted available attempts.",
			{
				subjectId: input.adapterInputId,
				refs: retrySourceRefs(input, outcome, choice.policy),
				severity: "warning",
				details: {
					attempt: outcome.attempt,
					maxAttempts: choice.policy.retryPolicy.maxAttempts,
				},
			},
		);
		emitIssue(ctx, state, issue);
		emitStatus(
			ctx,
			state,
			statusForOutcome(outcome, input, "exhausted", { choice, issues: [issue] }),
		);
		return;
	}
	const nextAttempt = outcome.attempt + 1;
	const delayMs = nextRetryDelayMs(choice.policy.retryPolicy, nextAttempt);
	if (delayMs === undefined) {
		const issue = dataIssue(
			"tool-provider-run-retry-delay-unavailable",
			"Tool provider run retry could not compute a delay for the next attempt.",
			{
				subjectId: input.adapterInputId,
				refs: retrySourceRefs(input, outcome, choice.policy),
			},
		);
		emitIssue(ctx, state, issue);
		emitStatus(
			ctx,
			state,
			statusForOutcome(outcome, input, "blocked", { choice, issues: [issue] }),
		);
		return;
	}
	const proposal = retryProposal(input, outcome, choice, delayMs);
	state.proposalsByOutcome.set(outcome.outcomeId, proposal);
	emitProposal(ctx, state, proposal);
	if (delayMs <= 0) {
		emitRunRequest(ctx, state, input, proposal, "immediate");
		return;
	}
	if (state.nowMs === undefined) {
		const issue = dataIssue(
			"tool-provider-run-retry-now-missing",
			"Tool provider delayed retry requires a graph-visible nowMs input.",
			{
				subjectId: input.adapterInputId,
				refs: retrySourceRefs(input, outcome, choice.policy),
			},
		);
		emitIssue(ctx, state, issue);
		emitStatus(
			ctx,
			state,
			statusForOutcome(outcome, input, "blocked", { choice, proposal, issues: [issue], delayMs }),
		);
		return;
	}
	const scheduled = retryScheduled(input, outcome, proposal, state.nowMs + delayMs, delayMs);
	state.scheduledByOutcome.set(outcome.outcomeId, scheduled);
	emitScheduled(ctx, state, scheduled);
	emitStatus(
		ctx,
		state,
		statusForOutcome(outcome, input, "scheduled", {
			choice,
			proposal,
			delayMs,
			retryAtMs: scheduled.retryAtMs,
		}),
	);
}

function processDueRetries(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
): void {
	if (state.nowMs === undefined) return;
	for (const [outcomeId, scheduled] of state.scheduledByOutcome) {
		if (scheduled.retryAtMs > state.nowMs) continue;
		if (state.nextRequestsByOutcome.has(outcomeId)) continue;
		const proposal = state.proposalsByOutcome.get(outcomeId);
		if (proposal === undefined) continue;
		const input = state.inputsById.get(proposal.adapterInputId);
		if (input === undefined) continue;
		emitRunRequest(ctx, state, input, proposal, "scheduled");
	}
}

function sanitizeToolProviderRunRetryPolicy(
	raw: ToolProviderRunRetryPolicy,
): ToolProviderRunRetryPolicy {
	const metadata = sanitizeProviderGraphVisibleRecord(raw.metadata);
	return Object.freeze({
		kind: "tool-provider-run-retry-policy",
		policyId: raw.policyId,
		retryPolicy: sanitizeRetryPolicy(raw.retryPolicy),
		...(raw.runId === undefined ? {} : { runId: raw.runId }),
		...(raw.requestId === undefined ? {} : { requestId: raw.requestId }),
		...(raw.adapterInputId === undefined ? {} : { adapterInputId: raw.adapterInputId }),
		sourceRefs: sanitizeAdapterInputSourceRefs(raw.sourceRefs ?? []),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies ToolProviderRunRetryPolicy);
}

function sanitizeRetryPolicy(policy: RetryPolicy): RetryPolicy {
	if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts <= 0) {
		return Object.freeze({ maxAttempts: 1, backoff: { kind: "none" as const } });
	}
	return Object.freeze(policy);
}

function chooseRetryPolicy(
	state: ToolProviderRunRetryProjectorState,
	input: ToolProviderAdapterInput,
	outcome: ExecutorOutcome,
): RetryPolicyChoice | undefined {
	let best: RetryPolicyChoice | undefined;
	for (const policy of state.policies.values()) {
		const score = retryPolicyScore(policy, input, outcome);
		if (score === undefined) continue;
		if (best === undefined || score > best.score) best = { policy, score };
	}
	return best;
}

function retryPolicyScore(
	policy: ToolProviderRunRetryPolicy,
	input: ToolProviderAdapterInput,
	outcome: ExecutorOutcome,
): number | undefined {
	let score = 0;
	if (policy.adapterInputId !== undefined) {
		if (policy.adapterInputId !== input.adapterInputId) return undefined;
		score += 8;
	}
	if (policy.requestId !== undefined) {
		if (policy.requestId !== outcome.requestId) return undefined;
		score += 4;
	}
	if (policy.runId !== undefined) {
		if (policy.runId !== outcomeRunId(outcome)) return undefined;
		score += 2;
	}
	return score;
}

function retryProposal(
	input: ToolProviderAdapterInput,
	outcome: ExecutorOutcome,
	choice: RetryPolicyChoice,
	delayMs: number,
): ToolProviderRunRetryProposal {
	const fromRunId = outcomeRunId(outcome);
	const nextAttempt = outcome.attempt + 1;
	const policyRefs = retryPolicyRefs(input, choice.policy);
	const sourceRefs = retrySourceRefs(input, outcome, choice.policy);
	return Object.freeze({
		kind: "tool-provider-run-retry-proposal",
		proposalId: `${outcome.outcomeId}:retry-proposal`,
		outcomeId: outcome.outcomeId,
		fromRunId,
		fromRequestId: outcome.requestId,
		fromAttempt: outcome.attempt,
		nextAttempt,
		nextRunId: `${fromRunId}:retry-${nextAttempt}`,
		adapterInputId: input.adapterInputId,
		requestId: input.requestId,
		operationId: input.operationId,
		policyId: choice.policy.policyId,
		policyRefs,
		maxAttempts: choice.policy.retryPolicy.maxAttempts,
		nextDelayMs: delayMs,
		sourceRefs,
		metadata: sanitizeProviderGraphVisibleRecord({ policyScore: choice.score }),
	} satisfies ToolProviderRunRetryProposal);
}

function retryScheduled(
	input: ToolProviderAdapterInput,
	outcome: ExecutorOutcome,
	proposal: ToolProviderRunRetryProposal,
	retryAtMs: number,
	delayMs: number,
): ToolProviderRunRetryScheduled {
	return Object.freeze({
		kind: "tool-provider-run-retry-scheduled",
		scheduleId: `${proposal.proposalId}:scheduled`,
		outcomeId: outcome.outcomeId,
		proposalId: proposal.proposalId,
		fromRunId: proposal.fromRunId,
		nextRunId: proposal.nextRunId,
		nextAttempt: proposal.nextAttempt,
		retryAtMs,
		retryAfterMs: delayMs,
		sourceRefs: sanitizeAdapterInputSourceRefs([
			ref("executor-outcome", outcome.outcomeId),
			ref("tool-provider-run-retry-proposal", proposal.proposalId),
			ref("tool-provider-adapter-input", input.adapterInputId),
		]),
	} satisfies ToolProviderRunRetryScheduled);
}

function emitRunRequest(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	input: ToolProviderAdapterInput,
	proposal: ToolProviderRunRetryProposal,
	mode: "immediate" | "scheduled",
): void {
	const key = `request:${proposal.outcomeId}:${proposal.nextRunId}`;
	if (state.requestKeys.has(key)) return;
	state.requestKeys.add(key);
	const request = requestToolProviderAdapterRun(input, {
		runId: proposal.nextRunId,
		attempt: proposal.nextAttempt,
		reason: "retry",
		retryOfOutcomeId: proposal.outcomeId,
		policyRefs: proposal.policyRefs,
		sourceRefs: uniqueSourceRefs([
			...(proposal.sourceRefs ?? []),
			ref("tool-provider-run-retry-proposal", proposal.proposalId),
			...(mode === "scheduled"
				? [ref("tool-provider-run-retry-scheduled", `${proposal.proposalId}:scheduled`)]
				: []),
		]),
		metadata: {
			retryMode: mode,
			retryProposalId: proposal.proposalId,
			retryOfOutcomeId: proposal.outcomeId,
		},
	});
	state.nextRequestsByOutcome.set(proposal.outcomeId, request);
	emitStatus(ctx, state, statusForProposal(input, proposal, "ready"));
	emitAudit(ctx, state, "tool-provider-run-retry-run-requested", {
		subjectId: request.requestId,
		sourceRefs: request.sourceRefs,
		metadata: {
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			attempt: request.attempt,
			retryOfOutcomeId: request.retryOfOutcomeId,
			retryMode: mode,
		},
	});
	ctx.down([["DATA", { kind: "run-request", request }]]);
}

function emitProposal(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	proposal: ToolProviderRunRetryProposal,
): void {
	const key = `proposal:${proposal.proposalId}`;
	if (state.proposalKeys.has(key)) return;
	state.proposalKeys.add(key);
	emitAudit(ctx, state, "tool-provider-run-retry-proposed", {
		subjectId: proposal.requestId,
		sourceRefs: proposal.sourceRefs,
		metadata: {
			proposalId: proposal.proposalId,
			outcomeId: proposal.outcomeId,
			nextAttempt: proposal.nextAttempt,
			nextDelayMs: proposal.nextDelayMs,
		},
	});
	ctx.down([["DATA", { kind: "proposal", proposal }]]);
}

function emitScheduled(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	scheduled: ToolProviderRunRetryScheduled,
): void {
	const key = `scheduled:${scheduled.scheduleId}`;
	if (state.scheduledKeys.has(key)) return;
	state.scheduledKeys.add(key);
	emitAudit(ctx, state, "tool-provider-run-retry-scheduled", {
		sourceRefs: scheduled.sourceRefs,
		metadata: {
			scheduleId: scheduled.scheduleId,
			outcomeId: scheduled.outcomeId,
			nextAttempt: scheduled.nextAttempt,
			retryAtMs: scheduled.retryAtMs,
		},
	});
	ctx.down([["DATA", { kind: "scheduled", scheduled }]]);
}

function emitStatus(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	status: ToolProviderRunRetryStatus,
): void {
	const key = `${status.outcomeId}:${status.state}:${status.nextAttempt ?? ""}:${status.nextRetryAtMs ?? ""}:${(status.issueCodes ?? []).join(",")}`;
	if (state.statusKeys.has(key)) return;
	state.statusKeys.add(key);
	state.statusByOutcome.set(status.outcomeId, status);
	ctx.down([["DATA", { kind: "status", status }]]);
}

function emitIssue(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	issue: DataIssue,
): void {
	const sanitized = sanitizeAdapterInputIssue(issue);
	const key = `${sanitized.code}:${sanitized.subjectId ?? ""}:${JSON.stringify(sanitized.details ?? {})}`;
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	ctx.down([["DATA", { kind: "issue", issue: sanitized }]]);
}

function emitAudit(
	ctx: { down: (msgs: readonly ["DATA", ToolProviderRunRetryFact][]) => void },
	state: ToolProviderRunRetryProjectorState,
	kind: string,
	opts: {
		readonly subjectId?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	} = {},
): void {
	state.auditSeq += 1;
	const metadata = sanitizeProviderGraphVisibleRecord(opts.metadata);
	ctx.down([
		[
			"DATA",
			{
				kind: "audit",
				audit: Object.freeze({
					id: `tool-provider-run-retry-audit-${state.auditSeq}`,
					kind,
					...(opts.subjectId === undefined ? {} : { subjectId: opts.subjectId }),
					...(opts.sourceRefs === undefined
						? {}
						: { sourceRefs: sanitizeAdapterInputSourceRefs(opts.sourceRefs) }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRuntimeAuditRecord),
			},
		],
	]);
}

function statusForOutcome(
	outcome: ExecutorOutcome,
	input: ToolProviderAdapterInput,
	state: ToolProviderRunRetryStatusState,
	opts: {
		readonly choice?: RetryPolicyChoice;
		readonly proposal?: ToolProviderRunRetryProposal;
		readonly issues?: readonly DataIssue[];
		readonly delayMs?: number;
		readonly retryAtMs?: number;
	} = {},
): ToolProviderRunRetryStatus {
	const proposal = opts.proposal;
	const nextAttempt =
		proposal?.nextAttempt ?? (opts.choice === undefined ? undefined : outcome.attempt + 1);
	return Object.freeze({
		kind: "tool-provider-run-retry-status",
		statusId: `${outcome.outcomeId}:retry-status:${state}`,
		outcomeId: outcome.outcomeId,
		proposalId: proposal?.proposalId ?? `${outcome.outcomeId}:retry-proposal`,
		fromRunId: outcomeRunId(outcome),
		adapterInputId: input.adapterInputId,
		requestId: input.requestId,
		operationId: input.operationId,
		...(proposal?.nextRunId === undefined ? {} : { nextRunId: proposal.nextRunId }),
		...(nextAttempt === undefined ? {} : { nextAttempt }),
		...(opts.retryAtMs === undefined ? {} : { nextRetryAtMs: opts.retryAtMs }),
		state,
		sourceRefs: retrySourceRefs(input, outcome, opts.choice?.policy),
		...(opts.issues === undefined || opts.issues.length === 0
			? {}
			: { issueCodes: Object.freeze(opts.issues.map((issue) => issue.code)) }),
		...optionalMetadata({
			...(opts.delayMs === undefined ? {} : { delayMs: opts.delayMs }),
			...(opts.choice === undefined
				? {}
				: { maxAttempts: opts.choice.policy.retryPolicy.maxAttempts }),
		}),
	} satisfies ToolProviderRunRetryStatus);
}

function statusForProposal(
	input: ToolProviderAdapterInput,
	proposal: ToolProviderRunRetryProposal,
	state: ToolProviderRunRetryStatusState,
): ToolProviderRunRetryStatus {
	return Object.freeze({
		kind: "tool-provider-run-retry-status",
		statusId: `${proposal.outcomeId}:retry-status:${state}`,
		outcomeId: proposal.outcomeId,
		proposalId: proposal.proposalId,
		fromRunId: proposal.fromRunId,
		adapterInputId: input.adapterInputId,
		requestId: input.requestId,
		operationId: input.operationId,
		nextRunId: proposal.nextRunId,
		nextAttempt: proposal.nextAttempt,
		state,
		sourceRefs: proposal.sourceRefs,
		...optionalMetadata({ maxAttempts: proposal.maxAttempts }),
	} satisfies ToolProviderRunRetryStatus);
}

function statusForMissingInput(
	outcome: ExecutorOutcome,
	state: ToolProviderRunRetryStatusState,
	issues: readonly DataIssue[],
): ToolProviderRunRetryStatus {
	return Object.freeze({
		kind: "tool-provider-run-retry-status",
		statusId: `${outcome.outcomeId}:retry-status:${state}`,
		outcomeId: outcome.outcomeId,
		proposalId: `${outcome.outcomeId}:retry-proposal`,
		fromRunId: outcomeRunId(outcome),
		adapterInputId: outcome.inputId ?? outcome.requestId,
		requestId: outcome.requestId,
		operationId: outcome.operationId,
		state,
		sourceRefs: [ref("executor-outcome", outcome.outcomeId)],
		issueCodes: Object.freeze(issues.map((issue) => issue.code)),
	} satisfies ToolProviderRunRetryStatus);
}

function isRetryableOutcome(outcome: ExecutorOutcome): boolean {
	return (outcome.kind === "failure" || outcome.kind === "timeout") && outcome.retryable === true;
}

function retryPolicyRefs(
	input: ToolProviderAdapterInput,
	policy: ToolProviderRunRetryPolicy,
): readonly SourceRef[] {
	return sanitizeAdapterInputSourceRefs([
		ref("tool-provider-run-retry-policy", policy.policyId),
		...(policy.sourceRefs ?? []),
		...(input.policyRefs ?? []),
	]);
}

function retrySourceRefs(
	input: ToolProviderAdapterInput,
	outcome: ExecutorOutcome,
	policy?: ToolProviderRunRetryPolicy,
): readonly SourceRef[] {
	return sanitizeAdapterInputSourceRefs([
		ref("executor-outcome", outcome.outcomeId),
		ref("tool-provider-adapter-input", input.adapterInputId),
		...(outcome.evidenceRefs ?? []),
		...(input.sourceRefs ?? []),
		...(policy === undefined ? [] : retryPolicyRefs(input, policy)),
	]);
}

function outcomeRunId(outcome: ExecutorOutcome): string {
	const runId = isRecord(outcome.metadata) ? outcome.metadata.runId : undefined;
	if (typeof runId === "string" && runId.length > 0) return runId;
	return `${outcome.requestId}:attempt-${outcome.attempt}`;
}

function optionalMetadata(value: Record<string, unknown>): {
	readonly metadata?: Record<string, unknown>;
} {
	const metadata = sanitizeProviderGraphVisibleRecord(value);
	return metadata === undefined ? {} : { metadata };
}

function buildRetryViews(state: ToolProviderRunRetryProjectorState): ToolProviderRunRetryViews {
	return Object.freeze({
		proposalsByOutcome: new Map(state.proposalsByOutcome),
		scheduledByOutcome: new Map(state.scheduledByOutcome),
		nextRunRequestsByOutcome: new Map(state.nextRequestsByOutcome),
		statusByOutcome: new Map(state.statusByOutcome),
	});
}
