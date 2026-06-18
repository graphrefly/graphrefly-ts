import type { Node } from "../node/node.js";
import type { PullDemand } from "../protocol/messages.js";
import type { QueueEvent, RuntimeState, WorkQueueRecordDraft, WorkState } from "./runtime-types.js";
import type {
	WorkQueueCommand,
	WorkQueueDerivedState,
	WorkQueueRecord,
	WorkQueueStatus,
} from "./types.js";

export function appendRecord<T>(
	state: RuntimeState<T>,
	queueId: string,
	record: WorkQueueRecordDraft,
): WorkQueueRecord<T> {
	const full = { ...record, queueId, recordSeq: ++state.recordSeq } as WorkQueueRecord<T>;
	state.records.push(full);
	return full;
}

export function recordEvent<T>(record: WorkQueueRecord<T>): QueueEvent<T> {
	return { kind: "record", record };
}

export function statusEvent<T>(
	queueId: string,
	kind: WorkQueueStatus["kind"],
	timestampMs: number,
	fields: Partial<WorkQueueStatus> = {},
): QueueEvent<T> {
	return {
		kind: "status",
		status: {
			kind,
			queueId,
			timestampMs,
			...(fields.workId === undefined ? {} : { workId: fields.workId }),
			...(fields.commandId === undefined ? {} : { commandId: fields.commandId }),
			...(fields.recordSeq === undefined ? {} : { recordSeq: fields.recordSeq }),
			...(fields.asOfRecordSeq === undefined ? {} : { asOfRecordSeq: fields.asOfRecordSeq }),
			...(fields.issueCode === undefined ? {} : { issueCode: fields.issueCode }),
			...(fields.details === undefined ? {} : { details: fields.details }),
		},
	};
}

export function issueEvent<T>(
	queueId: string,
	code: string,
	message: string,
	timestampMs: number,
	details: unknown,
): QueueEvent<T> {
	return {
		kind: "issue",
		issue: {
			kind: "issue",
			code,
			message,
			severity: "error",
			source: "workQueue",
			details,
			metadata: { queueId, timestampMs },
		},
	};
}

export function rejectQueueCommand<T>(
	queueId: string,
	command: unknown,
	code: string,
	message: string,
	nowMs: number,
	commandId = commandIdFrom(command),
): QueueEvent<T>[] {
	return [
		issueEvent(queueId, code, message, nowMs, command),
		statusEvent(queueId, "command-rejected", nowMs, {
			...(commandId === undefined ? {} : { commandId }),
			issueCode: code,
		}),
	];
}

export function validateQueueCommand(
	queueId: string,
	command: unknown,
): { readonly code: string; readonly message: string } | undefined {
	if (!isObjectRecord(command))
		return { code: "malformed-command", message: "command must be an object" };
	if (typeof command.kind !== "string")
		return { code: "malformed-command", message: "command kind is required" };
	if (!isWorkQueueCommandKind(command.kind))
		return { code: "malformed-command", message: `unknown command kind '${command.kind}'` };
	if (typeof command.commandId !== "string" || command.commandId.length === 0)
		return { code: "malformed-command", message: "commandId must be a non-empty string" };
	if (command.queueId !== undefined && command.queueId !== queueId)
		return { code: "queue-mismatch", message: "command queueId does not match this queue" };
	switch (command.kind) {
		case "submit":
			return command.payload === undefined
				? { code: "malformed-command", message: "submit payload is required" }
				: undefined;
		case "claim":
			if (typeof command.workerId !== "string" || command.workerId.length === 0)
				return { code: "malformed-command", message: "claim workerId is required" };
			if (command.limit !== undefined && !isPositiveInteger(command.limit))
				return { code: "malformed-command", message: "claim limit must be a positive integer" };
			if (
				command.requestedWorkIds !== undefined &&
				(!Array.isArray(command.requestedWorkIds) ||
					!command.requestedWorkIds.every((id) => typeof id === "string" && id.length > 0))
			) {
				return { code: "malformed-command", message: "requestedWorkIds must be strings" };
			}
			if (command.leaseDurationMs !== undefined && !isPositiveInteger(command.leaseDurationMs))
				return {
					code: "malformed-command",
					message: "leaseDurationMs must be a positive integer",
				};
			return undefined;
		case "renew-lease":
			if (command.leaseDurationMs !== undefined && !isPositiveInteger(command.leaseDurationMs))
				return {
					code: "malformed-command",
					message: "leaseDurationMs must be a positive integer",
				};
			if (command.leaseExpiresAtMs !== undefined && !isFiniteNumber(command.leaseExpiresAtMs))
				return { code: "malformed-command", message: "leaseExpiresAtMs must be finite" };
			return validateLeaseCommand(command);
		case "release":
		case "complete":
		case "fail":
			return validateLeaseCommand(command);
		case "cancel":
			return requiredString(command.workId, "workId");
		case "schedule": {
			const workIdError = requiredString(command.workId, "workId");
			if (workIdError !== undefined) return workIdError;
			if (!isFiniteNumber(command.notBeforeMs))
				return { code: "malformed-command", message: "notBeforeMs must be finite" };
			if (command.deadlineMs !== undefined && !isFiniteNumber(command.deadlineMs))
				return { code: "malformed-command", message: "deadlineMs must be finite" };
			return undefined;
		}
		case "expire-leases":
			if (command.limit !== undefined && !isPositiveInteger(command.limit))
				return {
					code: "malformed-command",
					message: "expire-leases limit must be a positive integer",
				};
			if (
				command.workIds !== undefined &&
				(!Array.isArray(command.workIds) ||
					!command.workIds.every((id) => typeof id === "string" && id.length > 0))
			) {
				return { code: "malformed-command", message: "workIds must be strings" };
			}
			return undefined;
	}
}

export function validateLeaseCommand(
	command: Record<string, unknown>,
): { readonly code: string; readonly message: string } | undefined {
	for (const key of ["workId", "leaseId", "workerId"]) {
		const err = requiredString(command[key], key);
		if (err !== undefined) return err;
	}
	if (!isPositiveInteger(command.attempt))
		return { code: "malformed-command", message: "attempt must be a positive integer" };
	return undefined;
}

export function requiredString(
	value: unknown,
	name: string,
): { readonly code: string; readonly message: string } | undefined {
	return typeof value === "string" && value.length > 0
		? undefined
		: { code: "malformed-command", message: `${name} must be a non-empty string` };
}

export function commandIdFrom(command: unknown): string | undefined {
	return isObjectRecord(command) && typeof command.commandId === "string"
		? command.commandId
		: undefined;
}

export function isWorkQueueCommandKind(kind: string): kind is WorkQueueCommand["kind"] {
	return (
		kind === "submit" ||
		kind === "claim" ||
		kind === "renew-lease" ||
		kind === "release" ||
		kind === "complete" ||
		kind === "fail" ||
		kind === "cancel" ||
		kind === "schedule" ||
		kind === "expire-leases"
	);
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function publishQueueCommand<T>(
	node: Node<WorkQueueCommand<T>>,
	command: WorkQueueCommand<T>,
): WorkQueueCommand<T> {
	node.down([["DATA", command]]);
	return command;
}

let commandSeq = 0;
export function nextCommandId(queueId: string, kind: string): string {
	commandSeq += 1;
	return `${queueId}:${kind}:${commandSeq}`;
}

export function isReady<T>(work: WorkState<T>, nowMs: number): boolean {
	if (work.state === "scheduled")
		return work.notBeforeMs !== undefined && work.notBeforeMs <= nowMs;
	if (work.state === "retry-wait") return work.retryAtMs !== undefined && work.retryAtMs <= nowMs;
	return work.state === "ready";
}

export function isReadyForProjection<T>(work: WorkState<T>, nowMs: number | undefined): boolean {
	if (work.state === "scheduled" || work.state === "retry-wait") {
		return nowMs === undefined ? false : isReady(work, nowMs);
	}
	return isReady(work, 0);
}

export function isTerminal(state: WorkQueueDerivedState): boolean {
	return state === "completed" || state === "canceled" || state === "dead-lettered";
}

export function payloadAsRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringArrayOrUndefined(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string")
		? value
		: undefined;
}

export function pullParams<T>(pull: PullDemand | undefined): T {
	return (
		typeof pull?.params === "object" && pull.params !== null && !Array.isArray(pull.params)
			? pull.params
			: {}
	) as T;
}

const SUBMIT_ENVELOPE = "__graphreflyWorkQueueSubmit";

export function submitPayload<T>(
	payload: T,
	meta: Record<string, unknown>,
): T | (Record<string, unknown> & { readonly [SUBMIT_ENVELOPE]: true; readonly payload: T }) {
	if (Object.keys(meta).length === 0) return payload;
	return { [SUBMIT_ENVELOPE]: true, payload, ...meta };
}

export function decodeSubmittedPayload<T>(payload: T): {
	payload: T;
	meta: Record<string, unknown>;
} {
	if (
		isObjectRecord(payload) &&
		payload[SUBMIT_ENVELOPE] === true &&
		Object.hasOwn(payload, "payload")
	) {
		const { payload: inner, [SUBMIT_ENVELOPE]: _tag, ...meta } = payload as Record<string, unknown>;
		return { payload: inner as T, meta };
	}
	return { payload, meta: payloadAsRecord(payload) };
}

export function commandNowMs<T>(command: WorkQueueCommand<T>, fallback: number): number {
	return typeof command.nowMs === "number" && Number.isFinite(command.nowMs)
		? command.nowMs
		: fallback;
}

export function positiveLimit(limit: number): number {
	if (!Number.isInteger(limit) || limit < 1)
		throw new Error("workQueue: limit must be a positive integer");
	return limit;
}

export function assertNonEmpty(value: string, owner: string): void {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${owner} must be a non-empty string`);
}

export function materializeLeaseExpired<T>(
	queueId: string,
	state: RuntimeState<T>,
	work: WorkState<T>,
	commandId: string | undefined,
	nowMs: number,
	rejection?: { readonly command: unknown; readonly code: string; readonly message: string },
): QueueEvent<T>[] {
	const record = appendRecord(state, queueId, {
		kind: "lease-expired",
		workId: work.workId,
		...(commandId === undefined ? {} : { commandId }),
		leaseId: work.leaseId as string,
		attempt: work.attempt,
		workerId: work.workerId as string,
		leaseExpiresAtMs: work.leaseExpiresAtMs as number,
		expiredAtMs: nowMs,
		recordedAtMs: nowMs,
	});
	work.state = "ready";
	clearLease(work);
	const events: QueueEvent<T>[] = [recordEvent(record)];
	if (rejection !== undefined) {
		events.push(
			...rejectQueueCommand<T>(
				queueId,
				rejection.command,
				rejection.code,
				rejection.message,
				nowMs,
				commandId,
			),
		);
	}
	return events;
}

export function isExpiredLease<T>(work: WorkState<T>, nowMs: number): boolean {
	return (
		work.state === "leased" && work.leaseExpiresAtMs !== undefined && work.leaseExpiresAtMs <= nowMs
	);
}

export function clearLease<T>(work: WorkState<T>): void {
	work.leaseId = undefined;
	work.workerId = undefined;
	work.leaseExpiresAtMs = undefined;
}
