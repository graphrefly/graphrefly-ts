import type { DataIssue } from "../data/index.js";
import type { WorkQueueDerivedState, WorkQueueRecord, WorkQueueStatus } from "./types.js";

export type QueueEvent<T> =
	| { readonly kind: "record"; readonly record: WorkQueueRecord<T> }
	| { readonly kind: "status"; readonly status: WorkQueueStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue };

export type WorkQueueRecordDraft = {
	readonly kind: string;
	readonly recordedAtMs: number;
	readonly [key: string]: unknown;
};

export interface WorkState<T> {
	workId: string;
	payload: T;
	state: WorkQueueDerivedState;
	admissionSeq: number;
	priority?: number;
	tags?: readonly string[];
	requirements?: readonly string[];
	notBeforeMs?: number;
	retryAtMs?: number;
	deadlineMs?: number;
	attempt: number;
	leaseId?: string;
	workerId?: string;
	leaseExpiresAtMs?: number;
	terminalRecordSeq?: number;
}

export interface RuntimeState<T> {
	recordSeq: number;
	leaseSeq: number;
	works: Map<string, WorkState<T>>;
	sourceSeqs: Set<string>;
	commandIds: Set<string>;
	idempotencyKeys: Set<string>;
	records: WorkQueueRecord<T>[];
	deadLetters: WorkQueueRecord<T>[];
}
