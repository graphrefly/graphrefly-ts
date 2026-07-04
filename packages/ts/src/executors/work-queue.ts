/**
 * Durable executor dispatch recipe over workQueue (D328/D331).
 *
 * Claim records become graph-visible dispatch-attempt facts. Executor outcomes become queue
 * lifecycle commands. The recipe never calls ExecutorBinding or treats a queue claim as dispatch.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	AgentRequestIssued,
	ExecutorOutcome,
	SourceRef,
} from "../orchestration/agent-runtime.js";
import type { WorkQueueCommand, WorkQueueRecord } from "../work-queue/index.js";

export interface ExecutorQueuedDispatchPayload {
	readonly kind: "executor-queued-dispatch";
	readonly requestId: string;
	readonly operationId: string;
	readonly parentRequestId?: string;
	readonly sourceDecisionId?: string;
	readonly intentId?: string;
	readonly inputId?: string;
	readonly toolCallSeriesId?: string;
	readonly routeId?: string;
	readonly profileId?: string;
	readonly executorId?: string;
	readonly effectRunId?: string;
	readonly promptBundleRefs?: readonly SourceRef[];
	readonly toolDefinitionRefs?: readonly SourceRef[];
	readonly policyRefs?: readonly SourceRef[];
	readonly budgetRefs?: readonly SourceRef[];
	readonly permissionRefs?: readonly SourceRef[];
	readonly sandboxRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly artifactRefs?: readonly SourceRef[];
	readonly idempotencyKey?: string;
	readonly requirements?: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

export type ExecutorQueuedDispatchPayloadExtra = Partial<
	Omit<ExecutorQueuedDispatchPayload, "kind" | "requestId" | "operationId">
>;

export interface ExecutorQueuedDispatchAttempt {
	readonly kind: "executor-queued-dispatch-attempt";
	readonly workId: string;
	readonly leaseId: string;
	readonly queueAttempt: number;
	readonly workerId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly routeId?: string;
	readonly executorId?: string;
	readonly profileId?: string;
	readonly payload: ExecutorQueuedDispatchPayload;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface ExecutorWorkQueueSubmitOptions {
	readonly workId?: string;
	readonly priority?: number;
	readonly tags?: readonly string[];
	readonly requirements?: readonly string[];
	readonly notBeforeMs?: number;
	readonly deadlineMs?: number;
}

export interface ExecutorWorkQueuePolicy {
	readonly submit?: (request: AgentRequestIssued) => ExecutorWorkQueueSubmitOptions;
	readonly payload?: (request: AgentRequestIssued) => ExecutorQueuedDispatchPayloadExtra;
	readonly retryableBlocked?: boolean;
	readonly retryableTimeout?: boolean;
}

export interface ExecutorWorkQueueRecipeOptions {
	readonly name?: string;
	readonly requests?: Node<AgentRequestIssued>;
	readonly records: Node<WorkQueueRecord<ExecutorQueuedDispatchPayload>>;
	readonly outcomes: Node<ExecutorOutcome>;
	readonly workerId?: string;
	readonly policy?: ExecutorWorkQueuePolicy;
}

export interface ExecutorWorkQueueRecipeBundle {
	readonly submitCommands?: Node<WorkQueueCommand<ExecutorQueuedDispatchPayload>>;
	readonly attempts: Node<ExecutorQueuedDispatchAttempt>;
	readonly commands: Node<WorkQueueCommand<ExecutorQueuedDispatchPayload>>;
	readonly issues: Node<DataIssue>;
}

type ExecutorQueueFact =
	| { readonly kind: "attempt"; readonly attempt: ExecutorQueuedDispatchAttempt }
	| { readonly kind: "command"; readonly command: WorkQueueCommand<ExecutorQueuedDispatchPayload> }
	| { readonly kind: "issue"; readonly issue: DataIssue };

interface ExecutorQueueState {
	readonly payloads: Map<string, ExecutorQueuedDispatchPayload>;
	readonly activeClaims: Map<string, ExecutorQueuedDispatchAttempt>;
	readonly pendingOutcomes: Map<string, ExecutorOutcome[]>;
	readonly terminalClaims: Set<string>;
	readonly seenOutcomes: Set<string>;
}

/**
 * Creates an executor work queue recipe.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category executors
 * @example
 * ```ts
 * import { executorWorkQueueRecipe } from "@graphrefly/ts/executors/work-queue";
 * ```
 */
export function executorWorkQueueRecipe(
	graph: Graph,
	opts: ExecutorWorkQueueRecipeOptions,
): ExecutorWorkQueueRecipeBundle {
	const name = opts.name ?? "executorWorkQueue";
	const submitCommands =
		opts.requests === undefined
			? undefined
			: graph.node<WorkQueueCommand<ExecutorQueuedDispatchPayload>>(
					[opts.requests],
					(ctx) => {
						for (const raw of depBatch(ctx, 0) ?? []) {
							const request = raw as AgentRequestIssued;
							ctx.down([["DATA", executorSubmitCommand(request, opts.policy)]]);
						}
					},
					{ name: `${name}/submitCommands`, factory: "executorWorkQueueSubmitCommands" },
				);
	const runtime = graph.node<ExecutorQueueFact>(
		[opts.records, opts.outcomes],
		(ctx) => {
			const state = ctx.state.get<ExecutorQueueState>() ?? emptyState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				reduceRecord(ctx, state, raw as WorkQueueRecord<ExecutorQueuedDispatchPayload>, opts);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				reduceOutcome(ctx, state, raw as ExecutorOutcome, opts);
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "executorWorkQueueRuntime",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		...(submitCommands === undefined ? {} : { submitCommands }),
		attempts: project(graph, runtime, `${name}/attempts`, "executorWorkQueueAttempts", (fact) =>
			fact.kind === "attempt" ? fact.attempt : undefined,
		),
		commands: project(graph, runtime, `${name}/commands`, "executorWorkQueueCommands", (fact) =>
			fact.kind === "command" ? fact.command : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "executorWorkQueueIssues", (fact) =>
			fact.kind === "issue" ? fact.issue : undefined,
		),
	};
}

/**
 * Creates an executor submit command.
 *
 * @param request - Request value to lower, route, or record.
 * @param policy - Policy object used to admit, retry, or route work.
 * @returns The executor submit command result.
 * @category executors
 * @example
 * ```ts
 * import { executorSubmitCommand } from "@graphrefly/ts/executors/work-queue";
 * ```
 */
export function executorSubmitCommand(
	request: AgentRequestIssued,
	policy?: ExecutorWorkQueuePolicy,
): WorkQueueCommand<ExecutorQueuedDispatchPayload> {
	const payloadExtra = policy?.payload?.(request) ?? {};
	const submit = policy?.submit?.(request) ?? {};
	const payload: ExecutorQueuedDispatchPayload = {
		...payloadExtra,
		kind: "executor-queued-dispatch",
		requestId: request.requestId,
		operationId: request.operationId,
		parentRequestId: request.parentRequestId,
		inputId: request.input?.inputId,
		effectRunId: request.effectRunId,
		sourceRefs: request.sourceRefs,
		idempotencyKey: request.requestId,
		metadata: request.metadata,
	};
	return {
		kind: "submit",
		commandId: `${request.requestId}:executor-work-queue-submit`,
		payload,
		workId: submit.workId ?? `executor:${request.requestId}`,
		priority: submit.priority,
		tags: submit.tags ?? ["executor", request.requestKind],
		requirements: submit.requirements,
		notBeforeMs: submit.notBeforeMs,
		deadlineMs: submit.deadlineMs,
		idempotencyKey: request.requestId,
		sourceRefs: stringRefs(request.sourceRefs),
	};
}

function reduceRecord(
	ctx: Ctx,
	state: ExecutorQueueState,
	record: WorkQueueRecord<ExecutorQueuedDispatchPayload>,
	opts: ExecutorWorkQueueRecipeOptions,
): void {
	if (record.kind === "work-admitted") {
		state.payloads.set(record.workId, record.payload);
		return;
	}
	retireClaimForRecord(state, record);
	if (record.kind !== "work-claimed") return;
	if (opts.workerId !== undefined && record.workerId !== opts.workerId) return;
	const payload = state.payloads.get(record.workId);
	if (payload === undefined) {
		emit(ctx, { kind: "issue", issue: queueIssue(record, "executor-claim-without-payload") });
		return;
	}
	const attempt: ExecutorQueuedDispatchAttempt = {
		kind: "executor-queued-dispatch-attempt",
		workId: record.workId,
		leaseId: record.leaseId,
		queueAttempt: record.attempt,
		workerId: record.workerId,
		requestId: payload.requestId,
		operationId: payload.operationId,
		routeId: payload.routeId,
		executorId: payload.executorId,
		profileId: payload.profileId,
		payload,
		sourceRefs: [...(payload.sourceRefs ?? []), ref("work-queue-record", String(record.recordSeq))],
	};
	const key = outcomeKey(payload, record.attempt);
	state.activeClaims.set(key, attempt);
	emit(ctx, { kind: "attempt", attempt });
	const pending = state.pendingOutcomes.get(key);
	if (pending !== undefined) {
		state.pendingOutcomes.delete(key);
		for (const outcome of pending) {
			mapClaimedOutcome(ctx, state, key, attempt, outcome, opts);
		}
	}
}

function reduceOutcome(
	ctx: Ctx,
	state: ExecutorQueueState,
	outcome: ExecutorOutcome,
	opts: ExecutorWorkQueueRecipeOptions,
): void {
	if (state.seenOutcomes.has(outcome.outcomeId)) return;
	const key = outcomeKey(outcome, outcome.attempt);
	if (state.terminalClaims.has(key)) {
		state.seenOutcomes.add(outcome.outcomeId);
		emit(ctx, {
			kind: "issue",
			issue: {
				kind: "issue",
				code: "executor-duplicate-terminal-outcome-for-queue-claim",
				message: `ExecutorOutcome '${outcome.outcomeId}' arrived after the queue claim was already terminal`,
				refs: [`executor-outcome:${outcome.outcomeId}`],
			},
		});
		return;
	}
	const claim = state.activeClaims.get(key);
	if (claim === undefined) {
		bufferPendingOutcome(state, key, outcome);
		return;
	}
	mapClaimedOutcome(ctx, state, key, claim, outcome, opts);
}

function mapClaimedOutcome(
	ctx: Ctx,
	state: ExecutorQueueState,
	key: string,
	claim: ExecutorQueuedDispatchAttempt,
	outcome: ExecutorOutcome,
	opts: ExecutorWorkQueueRecipeOptions,
): void {
	if (state.seenOutcomes.has(outcome.outcomeId)) return;
	state.seenOutcomes.add(outcome.outcomeId);
	if (state.terminalClaims.has(key)) {
		emit(ctx, {
			kind: "issue",
			issue: {
				kind: "issue",
				code: "executor-duplicate-terminal-outcome-for-queue-claim",
				message: `ExecutorOutcome '${outcome.outcomeId}' arrived after the queue claim was already terminal`,
				refs: [`executor-outcome:${outcome.outcomeId}`, `work-queue-work:${claim.workId}`],
			},
		});
		return;
	}
	if (outcome.kind === "result") {
		terminalizeClaim(state, key);
		emit(ctx, {
			kind: "command",
			command: {
				kind: "complete",
				commandId: `${outcome.outcomeId}:queue-complete`,
				workId: claim.workId,
				leaseId: claim.leaseId,
				attempt: claim.queueAttempt,
				workerId: claim.workerId,
				result: outcome.result,
				sourceRefs: stringRefs(outcome.evidenceRefs),
			},
		});
		return;
	}
	if (outcome.kind === "canceled") {
		terminalizeClaim(state, key);
		emit(ctx, {
			kind: "command",
			command: {
				kind: "cancel",
				commandId: `${outcome.outcomeId}:queue-cancel`,
				workId: claim.workId,
				reason: outcome.reason,
				sourceRefs: stringRefs(outcome.evidenceRefs),
			},
		});
		return;
	}
	terminalizeClaim(state, key);
	emit(ctx, {
		kind: "command",
		command: {
			kind: "fail",
			commandId: `${outcome.outcomeId}:queue-fail`,
			workId: claim.workId,
			leaseId: claim.leaseId,
			attempt: claim.queueAttempt,
			workerId: claim.workerId,
			error: outcomeError(outcome),
			retryable: outcomeRetryable(outcome, opts.policy),
			sourceRefs: stringRefs(outcome.evidenceRefs),
		},
	});
}

function outcomeError(
	outcome: Extract<ExecutorOutcome, { kind: "failure" | "timeout" | "blocked" }>,
): unknown {
	if (outcome.kind === "failure") return outcome.error;
	if (outcome.kind === "timeout") {
		return {
			kind: "issue",
			code: "executor-timeout",
			message: `ExecutorOutcome '${outcome.outcomeId}' timed out`,
			metadata: { timeoutMs: outcome.timeoutMs },
		} satisfies DataIssue;
	}
	return {
		kind: "issue",
		code: "executor-blocked",
		message: `ExecutorOutcome '${outcome.outcomeId}' blocked`,
		metadata: { needs: outcome.needs },
	} satisfies DataIssue;
}

function outcomeRetryable(
	outcome: ExecutorOutcome,
	policy: ExecutorWorkQueuePolicy | undefined,
): boolean | undefined {
	if (outcome.kind === "failure") return outcome.retryable;
	if (outcome.kind === "timeout") return outcome.retryable ?? policy?.retryableTimeout;
	if (outcome.kind === "blocked") return policy?.retryableBlocked;
	return undefined;
}

function project<T>(
	graph: Graph,
	runtime: Node<ExecutorQueueFact>,
	name: string,
	factory: string,
	select: (fact: ExecutorQueueFact) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as ExecutorQueueFact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function emit(ctx: Ctx, fact: ExecutorQueueFact): void {
	ctx.down([["DATA", fact]]);
}

function emptyState(): ExecutorQueueState {
	return {
		payloads: new Map(),
		activeClaims: new Map(),
		pendingOutcomes: new Map(),
		terminalClaims: new Set(),
		seenOutcomes: new Set(),
	};
}

function terminalizeClaim(state: ExecutorQueueState, key: string): void {
	state.terminalClaims.add(key);
	state.activeClaims.delete(key);
}

function bufferPendingOutcome(
	state: ExecutorQueueState,
	key: string,
	outcome: ExecutorOutcome,
): void {
	const pending = state.pendingOutcomes.get(key) ?? [];
	if (!pending.some((candidate) => candidate.outcomeId === outcome.outcomeId)) {
		state.pendingOutcomes.set(key, [...pending, outcome]);
	}
}

function retireClaimForRecord(
	state: ExecutorQueueState,
	record: WorkQueueRecord<ExecutorQueuedDispatchPayload>,
): void {
	if (
		record.kind !== "attempt-completed" &&
		record.kind !== "work-completed" &&
		record.kind !== "work-canceled" &&
		record.kind !== "work-dead-lettered" &&
		record.kind !== "work-released" &&
		record.kind !== "lease-expired"
	) {
		return;
	}
	for (const [key, claim] of state.activeClaims) {
		if (claim.workId !== record.workId) continue;
		if ("attempt" in record && record.attempt !== claim.queueAttempt) continue;
		terminalizeClaim(state, key);
	}
}

function outcomeKey(
	value: Pick<ExecutorQueuedDispatchPayload | ExecutorOutcome, "requestId" | "operationId">,
	attempt: number,
): string {
	return canonicalTupleKey([value.requestId, value.operationId, String(attempt)]);
}

function queueIssue(record: WorkQueueRecord, code: string): DataIssue {
	return {
		kind: "issue",
		code,
		message: `WorkQueue record '${record.kind}' cannot be mapped to executor dispatch`,
		refs: [`work-queue-record:${record.recordSeq}`],
		metadata: { queueRecordKind: record.kind, workId: record.workId },
	};
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

function stringRefs(refs: readonly SourceRef[] | undefined): readonly string[] | undefined {
	return refs?.map((sourceRef) => canonicalTupleKey([sourceRef.kind, sourceRef.id]));
}
