/**
 * Optional CQRS-over-workQueue recipe (D350/D352/D353).
 *
 * The CQRS core remains synchronous graph-visible command/event truth. This
 * recipe only maps queue claims to CQRS command facts and maps visible CQRS
 * outcomes back to generic workQueue disposition commands.
 */

import type { CqrsCommand, CqrsError, CqrsErrorCode, CqrsStatus } from "../cqrs/index.js";
import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { WorkQueueCommand, WorkQueueRecord } from "../work-queue/index.js";

export interface CqrsQueuedCommandPayload<TCommand = unknown> {
	readonly kind: "cqrs-queued-command";
	readonly command: CqrsCommand<TCommand>;
	readonly idempotencyKey?: string;
	readonly sourceRefs?: readonly string[];
	readonly policyRefs?: readonly string[];
	readonly actorRefs?: readonly string[];
	readonly auditRefs?: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

export interface CqrsWorkQueueAttempt<TCommand = unknown> {
	readonly kind: "cqrs-work-queue-attempt";
	readonly workId: string;
	readonly leaseId: string;
	readonly queueAttempt: number;
	readonly workerId: string;
	readonly command: CqrsCommand<TCommand>;
	readonly payload: CqrsQueuedCommandPayload<TCommand>;
	readonly sourceRefs?: readonly string[];
}

export type CqrsWorkQueueAcceptedOutcome = {
	readonly kind: "accepted";
	readonly status: CqrsStatus;
};

export type CqrsWorkQueueRejectedOutcome = {
	readonly kind: "rejected";
	readonly status: CqrsStatus;
	readonly error?: CqrsError;
};

export type CqrsWorkQueueReleaseOutcome = {
	readonly kind: "release";
	readonly reason?: string;
};

export type CqrsWorkQueueOutcome =
	| CqrsWorkQueueAcceptedOutcome
	| CqrsWorkQueueRejectedOutcome
	| CqrsWorkQueueReleaseOutcome;

export interface CqrsWorkQueuePolicy {
	/**
	 * D352: handler-threw and clock-threw fail retryable:true by default. A
	 * policy may classify a known deterministic handler failure as nonretryable.
	 */
	readonly retryableFailure?: (
		errorCode: CqrsErrorCode,
		outcome: CqrsWorkQueueRejectedOutcome,
	) => boolean;
	readonly releaseReason?: (attempt: CqrsWorkQueueAttempt) => string | undefined;
}

export interface CqrsWorkQueueRecipeOptions<TCommand = unknown> {
	readonly name?: string;
	readonly records: Node<WorkQueueRecord<CqrsQueuedCommandPayload<TCommand>>>;
	readonly status: Node<CqrsStatus>;
	readonly errors?: Node<CqrsError>;
	readonly workerId?: string;
	readonly policy?: CqrsWorkQueuePolicy;
}

export interface CqrsWorkQueueRecipeBundle<TCommand = unknown> {
	readonly attempts: Node<CqrsWorkQueueAttempt<TCommand>>;
	readonly dispatches: Node<CqrsCommand<TCommand>>;
	readonly commands: Node<WorkQueueCommand<CqrsQueuedCommandPayload<TCommand>>>;
	readonly issues: Node<DataIssue>;
}

type CqrsQueueFact<TCommand> =
	| { readonly kind: "attempt"; readonly attempt: CqrsWorkQueueAttempt<TCommand> }
	| { readonly kind: "dispatch"; readonly command: CqrsCommand<TCommand> }
	| {
			readonly kind: "command";
			readonly command: WorkQueueCommand<CqrsQueuedCommandPayload<TCommand>>;
	  }
	| { readonly kind: "issue"; readonly issue: DataIssue };

interface CqrsQueueState<TCommand> {
	readonly payloads: Map<string, CqrsQueuedCommandPayload<TCommand>>;
	readonly activeClaims: Map<string, CqrsWorkQueueAttempt<TCommand>[]>;
	readonly errors: Map<string, CqrsError>;
	readonly terminalClaims: Set<string>;
}

/** Build the optional D350/D352 CQRS workQueue recipe.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsWorkQueueRecipe } from "@graphrefly/ts/cqrs/work-queue";
 * ```
 */
export function cqrsWorkQueueRecipe<TCommand = unknown>(
	graph: Graph,
	opts: CqrsWorkQueueRecipeOptions<TCommand>,
): CqrsWorkQueueRecipeBundle<TCommand> {
	const name = opts.name ?? "cqrsWorkQueue";
	const deps =
		opts.errors === undefined
			? [opts.records, opts.status]
			: [opts.records, opts.status, opts.errors];
	const runtime = graph.node<CqrsQueueFact<TCommand>>(
		deps,
		(ctx) => {
			const state = ctx.state.get<CqrsQueueState<TCommand>>() ?? emptyState<TCommand>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				reduceRecord(ctx, state, raw as WorkQueueRecord<CqrsQueuedCommandPayload<TCommand>>, opts);
			}
			if (opts.errors !== undefined) {
				for (const raw of depBatch(ctx, 2) ?? []) {
					const error = raw as CqrsError;
					if (error.commandId !== undefined) state.errors.set(error.commandId, error);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				reduceStatus(ctx, state, raw as CqrsStatus, opts);
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "cqrsWorkQueueRuntime",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		attempts: project(graph, runtime, `${name}/attempts`, "cqrsWorkQueueAttempts", (fact) =>
			fact.kind === "attempt" ? fact.attempt : undefined,
		),
		dispatches: project(graph, runtime, `${name}/dispatches`, "cqrsWorkQueueDispatches", (fact) =>
			fact.kind === "dispatch" ? fact.command : undefined,
		),
		commands: project(graph, runtime, `${name}/commands`, "cqrsWorkQueueCommands", (fact) =>
			fact.kind === "command" ? fact.command : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "cqrsWorkQueueIssues", (fact) =>
			fact.kind === "issue" ? fact.issue : undefined,
		),
	};
}

/**
 * Creates a CQRS submit command.
 *
 * @param command - command value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The CQRS submit command result.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsSubmitCommand } from "@graphrefly/ts/cqrs/work-queue";
 * ```
 */
export function cqrsSubmitCommand<TCommand>(
	command: CqrsCommand<TCommand>,
	opts: {
		readonly workId?: string;
		readonly commandId?: string;
		readonly idempotencyKey?: string;
		readonly sourceRefs?: readonly string[];
		readonly policyRefs?: readonly string[];
		readonly actorRefs?: readonly string[];
		readonly auditRefs?: readonly string[];
		readonly metadata?: Record<string, unknown>;
	} = {},
): WorkQueueCommand<CqrsQueuedCommandPayload<TCommand>> {
	const payload: CqrsQueuedCommandPayload<TCommand> = {
		kind: "cqrs-queued-command",
		command,
		idempotencyKey: opts.idempotencyKey ?? command.id,
		sourceRefs: opts.sourceRefs,
		policyRefs: opts.policyRefs,
		actorRefs: opts.actorRefs,
		auditRefs: opts.auditRefs,
		metadata: opts.metadata,
	};
	return {
		kind: "submit",
		commandId: opts.commandId ?? `${command.id}:cqrs-work-queue-submit`,
		workId: opts.workId ?? `cqrs:${command.id}`,
		payload,
		idempotencyKey: opts.idempotencyKey ?? command.id,
		sourceRefs: opts.sourceRefs,
		policyRefs: opts.policyRefs,
		actorRefs: opts.actorRefs,
		auditRefs: opts.auditRefs,
	};
}

/**
 * Creates a CQRS work queue disposition command.
 *
 * @param attempt - attempt value used by the helper.
 * @param outcome - Outcome value to record or index.
 * @param policy - Policy object used to admit, retry, or route work.
 * @returns The CQRS work queue disposition command result.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsWorkQueueDispositionCommand } from "@graphrefly/ts/cqrs/work-queue";
 * ```
 */
export function cqrsWorkQueueDispositionCommand<TCommand>(
	attempt: CqrsWorkQueueAttempt<TCommand>,
	outcome: CqrsWorkQueueOutcome,
	policy?: CqrsWorkQueuePolicy,
): WorkQueueCommand<CqrsQueuedCommandPayload<TCommand>> {
	if (outcome.kind === "release") {
		return {
			kind: "release",
			commandId: dispositionCommandId(attempt, "release"),
			workId: attempt.workId,
			leaseId: attempt.leaseId,
			attempt: attempt.queueAttempt,
			workerId: attempt.workerId,
			reason: outcome.reason ?? policy?.releaseReason?.(attempt),
		};
	}
	if (outcome.kind === "accepted") {
		return completeCommand(attempt, {
			kind: "cqrs-accepted-result",
			commandId: outcome.status.commandId,
			commandType: outcome.status.commandType,
			eventCount: outcome.status.eventCount,
			cursor: outcome.status.cursor,
		});
	}
	const code = outcome.status.errorCode;
	if (code === "handler-threw" || code === "clock-threw" || code === undefined) {
		return {
			kind: "fail",
			commandId: dispositionCommandId(attempt, "fail"),
			workId: attempt.workId,
			leaseId: attempt.leaseId,
			attempt: attempt.queueAttempt,
			workerId: attempt.workerId,
			error: outcome.error ?? {
				kind: "issue",
				code: code ?? "cqrs-outcome-ambiguous",
				message: "CQRS rejected without deterministic rejection evidence",
			},
			retryable: code === undefined ? true : (policy?.retryableFailure?.(code, outcome) ?? true),
		};
	}
	return completeCommand(attempt, {
		kind: "cqrs-rejected-result",
		commandId: outcome.status.commandId,
		commandType: outcome.status.commandType,
		errorCode: code,
		error: outcome.error,
		eventCount: outcome.status.eventCount,
		cursor: outcome.status.cursor,
	});
}

function completeCommand<TCommand>(
	attempt: CqrsWorkQueueAttempt<TCommand>,
	result: unknown,
): WorkQueueCommand<CqrsQueuedCommandPayload<TCommand>> {
	return {
		kind: "complete",
		commandId: dispositionCommandId(attempt, "complete"),
		workId: attempt.workId,
		leaseId: attempt.leaseId,
		attempt: attempt.queueAttempt,
		workerId: attempt.workerId,
		result,
	};
}

function reduceRecord<TCommand>(
	ctx: Ctx,
	state: CqrsQueueState<TCommand>,
	record: WorkQueueRecord<CqrsQueuedCommandPayload<TCommand>>,
	opts: CqrsWorkQueueRecipeOptions<TCommand>,
): void {
	if (record.kind === "work-admitted") {
		if (isQueuedPayload(record.payload)) state.payloads.set(record.workId, record.payload);
		else emit(ctx, { kind: "issue", issue: queueIssue(record, "cqrs-queue-malformed-payload") });
		return;
	}
	if (record.kind !== "work-claimed") return;
	if (opts.workerId !== undefined && record.workerId !== opts.workerId) return;
	const payload = state.payloads.get(record.workId);
	if (payload === undefined) {
		emit(ctx, { kind: "issue", issue: queueIssue(record, "cqrs-claim-without-payload") });
		emit(ctx, {
			kind: "command",
			command: {
				kind: "release",
				commandId: `cqrs:${record.workId}:${record.leaseId}:${record.attempt}:release-no-payload`,
				workId: record.workId,
				leaseId: record.leaseId,
				attempt: record.attempt,
				workerId: record.workerId,
				reason: "cqrs-claim-without-payload",
			},
		});
		return;
	}
	const attempt: CqrsWorkQueueAttempt<TCommand> = {
		kind: "cqrs-work-queue-attempt",
		workId: record.workId,
		leaseId: record.leaseId,
		queueAttempt: record.attempt,
		workerId: record.workerId,
		command: payload.command,
		payload,
		sourceRefs: [...(payload.sourceRefs ?? []), `work-queue-record:${record.recordSeq}`],
	};
	pushActiveClaim(state, payload.command.id, attempt);
	emit(ctx, { kind: "attempt", attempt });
	emit(ctx, { kind: "dispatch", command: payload.command });
}

function reduceStatus<TCommand>(
	ctx: Ctx,
	state: CqrsQueueState<TCommand>,
	status: CqrsStatus,
	opts: CqrsWorkQueueRecipeOptions<TCommand>,
): void {
	if (status.commandId === undefined) return;
	const attempt = shiftActiveClaim(state, status.commandId);
	if (attempt === undefined) {
		emit(ctx, {
			kind: "issue",
			issue: {
				kind: "issue",
				code: "cqrs-status-without-active-queue-claim",
				message:
					"CQRS workQueue recipe observed a CQRS status without an active queue claim; no queue disposition was emitted",
				severity: "error",
				source: "cqrs.workQueue",
				refs: [`cqrs-command:${status.commandId}`],
				details: status,
			},
		});
		return;
	}
	const claimKey = queueClaimKey(attempt);
	if (state.terminalClaims.has(claimKey)) {
		emit(ctx, {
			kind: "issue",
			issue: {
				kind: "issue",
				code: "cqrs-duplicate-terminal-outcome-for-queue-claim",
				message: `CQRS queue claim '${claimKey}' already produced a terminal queue disposition`,
				refs: [`cqrs-command:${status.commandId}`, `work-queue-work:${attempt.workId}`],
			},
		});
		return;
	}
	state.terminalClaims.add(claimKey);
	const command = cqrsWorkQueueDispositionCommand(
		attempt,
		status.state === "accepted"
			? { kind: "accepted", status }
			: { kind: "rejected", status, error: state.errors.get(status.commandId) },
		opts.policy,
	);
	emit(ctx, { kind: "command", command });
}

function emptyState<TCommand>(): CqrsQueueState<TCommand> {
	return {
		payloads: new Map(),
		activeClaims: new Map(),
		errors: new Map(),
		terminalClaims: new Set(),
	};
}

function pushActiveClaim<TCommand>(
	state: CqrsQueueState<TCommand>,
	commandId: string,
	attempt: CqrsWorkQueueAttempt<TCommand>,
): void {
	const claims = state.activeClaims.get(commandId) ?? [];
	state.activeClaims.set(commandId, [...claims, attempt]);
}

function shiftActiveClaim<TCommand>(
	state: CqrsQueueState<TCommand>,
	commandId: string,
): CqrsWorkQueueAttempt<TCommand> | undefined {
	const claims = state.activeClaims.get(commandId);
	if (claims === undefined || claims.length === 0) return undefined;
	const [first, ...rest] = claims;
	if (rest.length === 0) state.activeClaims.delete(commandId);
	else state.activeClaims.set(commandId, rest);
	return first;
}

function queueClaimKey(attempt: CqrsWorkQueueAttempt): string {
	return `${attempt.workId}:${attempt.leaseId}:${attempt.queueAttempt}`;
}

function dispositionCommandId(attempt: CqrsWorkQueueAttempt, kind: string): string {
	return `${attempt.command.id}:${attempt.workId}:${attempt.leaseId}:${attempt.queueAttempt}:cqrs-queue-${kind}`;
}

function project<T, TCommand>(
	graph: Graph,
	runtime: Node<CqrsQueueFact<TCommand>>,
	name: string,
	factory: string,
	pick: (fact: CqrsQueueFact<TCommand>) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const value = pick(fact as CqrsQueueFact<TCommand>);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function emit<TCommand>(ctx: Ctx, fact: CqrsQueueFact<TCommand>): void {
	ctx.down([["DATA", fact]]);
}

function isQueuedPayload<TCommand>(value: unknown): value is CqrsQueuedCommandPayload<TCommand> {
	if (!isObjectRecord(value) || value.kind !== "cqrs-queued-command") return false;
	return isObjectRecord(value.command) && typeof value.command.id === "string";
}

function queueIssue(record: WorkQueueRecord<unknown>, code: string): DataIssue {
	return {
		kind: "issue",
		code,
		message: `CQRS workQueue recipe could not map record '${record.kind}'`,
		severity: "error",
		source: "cqrs.workQueue",
		refs: record.workId === undefined ? undefined : [`work-queue-work:${record.workId}`],
		details: record,
	};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
