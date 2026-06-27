import type { DataIssue } from "../data/index.js";
import type { MessageBus } from "../messaging/index.js";
import type { Node } from "../node/node.js";
import type { LockId } from "../protocol/messages.js";

export interface WorkQueueOptions<_T = unknown> {
	readonly queueId: string;
	readonly bus: MessageBus;
	readonly topic: string;
	readonly subscriptionId: string;
	readonly from?: "earliest" | "latest" | number;
	readonly name?: string;
	readonly now?: () => number;
	readonly leaseDurationMs?: number;
	readonly retry?: WorkQueueRetryPolicy;
}

export interface WorkQueueRetryPolicy {
	readonly maxAttempts?: number;
	readonly delayMs?: number;
}

interface WorkQueueCommandBase {
	readonly commandId: string;
	readonly queueId?: string;
	readonly idempotencyKey?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly sourceRefs?: readonly string[];
	readonly policyRefs?: readonly string[];
	readonly actorRefs?: readonly string[];
	readonly auditRefs?: readonly string[];
	readonly nowMs?: number;
}

export type WorkQueueCommand<T = unknown> =
	| (WorkQueueCommandBase & {
			readonly kind: "submit";
			readonly payload: T;
			readonly workId?: string;
			readonly priority?: number;
			readonly tags?: readonly string[];
			readonly requirements?: readonly string[];
			readonly notBeforeMs?: number;
			readonly deadlineMs?: number;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "claim";
			readonly workerId: string;
			readonly requestedWorkIds?: readonly string[];
			readonly limit?: number;
			readonly leaseDurationMs?: number;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "renew-lease";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly leaseDurationMs?: number;
			readonly leaseExpiresAtMs?: number;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "release";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly reason?: string;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "complete";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly result?: unknown;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "fail";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly error?: unknown;
			readonly retryable?: boolean;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "cancel";
			readonly workId: string;
			readonly reason?: string;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "schedule";
			readonly workId: string;
			readonly scheduleId?: string;
			readonly scheduleAtMs?: number;
			readonly runAtMs?: number;
			readonly notBeforeMs: number;
			readonly deadlineMs?: number;
			readonly reason?: string;
	  })
	| (WorkQueueCommandBase & {
			readonly kind: "expire-leases";
			readonly workIds?: readonly string[];
			readonly limit?: number;
	  });

interface WorkQueueRecordBase {
	readonly kind: string;
	readonly recordSeq: number;
	readonly queueId: string;
	readonly workId?: string;
	readonly commandId?: string;
	readonly idempotencyKey?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly sourceRefs?: readonly string[];
	readonly policyRefs?: readonly string[];
	readonly actorRefs?: readonly string[];
	readonly auditRefs?: readonly string[];
	readonly issueRefs?: readonly string[];
	readonly recordedAtMs: number;
}

export type WorkQueueRecord<T = unknown> =
	| (WorkQueueRecordBase & {
			readonly kind: "work-admitted";
			readonly workId: string;
			readonly payload: T;
			readonly messageBus: {
				readonly topic: string;
				readonly seq: number;
				readonly subscriptionId: string;
			};
			readonly priority?: number;
			readonly tags?: readonly string[];
			readonly requirements?: readonly string[];
			readonly notBeforeMs?: number;
			readonly deadlineMs?: number;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "work-rejected" | "admission-rejected";
			readonly workId?: string;
			readonly messageBus?: {
				readonly topic: string;
				readonly seq: number;
				readonly subscriptionId: string;
			};
			readonly reason: string;
			readonly existingWorkId?: string;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "work-scheduled";
			readonly workId: string;
			readonly scheduleId?: string;
			readonly scheduleAtMs?: number;
			readonly runAtMs?: number;
			readonly notBeforeMs: number;
			readonly deadlineMs?: number;
			readonly reason?: string;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "work-claimed";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly claimedAtMs: number;
			readonly leaseExpiresAtMs: number;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "lease-renewed";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly previousLeaseExpiresAtMs: number;
			readonly leaseExpiresAtMs: number;
			readonly renewedAtMs: number;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "work-released";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly releasedAtMs: number;
			readonly reason?: string;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "lease-expired";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly leaseExpiresAtMs: number;
			readonly expiredAtMs: number;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "attempt-completed" | "work-completed";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly result?: unknown;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "attempt-failed";
			readonly workId: string;
			readonly leaseId: string;
			readonly attempt: number;
			readonly workerId: string;
			readonly error?: unknown;
			readonly retryable?: boolean;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "retry-scheduled";
			readonly workId: string;
			readonly retryAtMs: number;
			readonly delayMs: number;
			readonly reason?: string;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "work-dead-lettered";
			readonly workId: string;
			readonly reason: string;
			readonly exhaustedAttempts?: number;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "work-canceled";
			readonly workId: string;
			readonly reason?: string;
			readonly canceledAtMs: number;
			readonly canceledLeaseId?: string;
			readonly attempt?: number;
	  })
	| (WorkQueueRecordBase & {
			readonly kind: "lifecycle-rejected" | "admission-deduped";
			readonly workId?: string;
			readonly messageBus?: {
				readonly topic: string;
				readonly seq: number;
				readonly subscriptionId: string;
			};
			readonly reason: string;
			readonly existingWorkId?: string;
	  });

export interface WorkQueueStatus {
	readonly kind:
		| "command-accepted"
		| "command-rejected"
		| "admission-accepted"
		| "admission-rejected"
		| "admission-retryable"
		| "projection-ready"
		| "projection-partial"
		| "projection-stale"
		| "maintenance-applied"
		| "maintenance-noop"
		| "policy-warning";
	readonly queueId: string;
	readonly workId?: string;
	readonly commandId?: string;
	readonly recordSeq?: number;
	readonly asOfRecordSeq?: number;
	readonly issueCode?: string;
	readonly timestampMs: number;
	readonly details?: unknown;
}

export interface WorkQueueAvailableItem<T = unknown> {
	readonly workId: string;
	readonly state: WorkQueueDerivedState;
	readonly payload: T;
	readonly admissionSeq: number;
	readonly priority?: number;
	readonly tags?: readonly string[];
	readonly requirements?: readonly string[];
	readonly notBeforeMs?: number;
	readonly retryAtMs?: number;
	readonly deadlineMs?: number;
}

export interface WorkQueueAvailablePage<T = unknown> {
	readonly items: readonly WorkQueueAvailableItem<T>[];
	readonly nextAfterWorkId?: string;
	readonly nextAfterAdmissionSeq?: number;
	readonly hasMore: boolean;
	readonly asOfRecordSeq: number;
}

export interface WorkQueueWorkSnapshot<T = unknown> {
	readonly workId: string;
	readonly state?: WorkQueueDerivedState;
	readonly payload?: T;
	readonly activeLease?: {
		readonly leaseId: string;
		readonly attempt: number;
		readonly workerId: string;
		readonly leaseExpiresAtMs: number;
	};
	readonly records: readonly WorkQueueRecord<T>[];
	readonly asOfRecordSeq: number;
}

export interface WorkQueueDeadLetterPage<T = unknown> {
	readonly entries: readonly WorkQueueRecord<T>[];
	readonly nextAfterDeadLetterSeq?: number;
	readonly hasMore: boolean;
	readonly asOfRecordSeq: number;
}

export interface WorkQueueAvailableParams {
	readonly limit?: number;
	readonly afterWorkId?: string;
	readonly afterAdmissionSeq?: number;
	readonly nowMs?: number;
	readonly includeIssues?: boolean;
}

export interface WorkQueueDeadLetterParams {
	readonly limit?: number;
	readonly afterDeadLetterSeq?: number;
	readonly afterWorkId?: string;
}

export type WorkQueueDerivedState =
	| "scheduled"
	| "ready"
	| "leased"
	| "retry-wait"
	| "completed"
	| "canceled"
	| "dead-lettered";

export interface WorkQueueProjection<TPage> {
	readonly snapshot: Node<TPage>;
	readonly snapshotPullId: LockId;
	readonly status: Node<WorkQueueStatus>;
	readonly issues: Node<DataIssue>;
}

export interface WorkQueueAvailableProjection<T = unknown> {
	readonly available: Node<WorkQueueAvailablePage<T>>;
	readonly availablePullId: LockId;
	readonly status: Node<WorkQueueStatus>;
	readonly issues: Node<DataIssue>;
}

export interface WorkQueue<T = unknown> {
	readonly commands: Node<WorkQueueCommand<T>>;
	readonly records: Node<WorkQueueRecord<T>>;
	readonly status: Node<WorkQueueStatus>;
	readonly issues: Node<DataIssue>;
	submit(
		payload: T,
		opts?: Omit<
			Partial<Extract<WorkQueueCommand<T>, { kind: "submit" }>>,
			"kind" | "payload" | "commandId"
		> & { commandId?: string },
	): unknown;
	claim(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "claim" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	renewLease(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "renew-lease" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	release(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "release" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	complete(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "complete" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	fail(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "fail" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	cancel(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "cancel" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	schedule(
		opts: Omit<Extract<WorkQueueCommand<T>, { kind: "schedule" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	expireLeases(
		opts?: Omit<Extract<WorkQueueCommand<T>, { kind: "expire-leases" }>, "kind" | "commandId"> & {
			commandId?: string;
		},
	): WorkQueueCommand<T>;
	available(opts?: { name?: string }): WorkQueueAvailableProjection<T>;
	work(workId: string, opts?: { name?: string }): WorkQueueProjection<WorkQueueWorkSnapshot<T>>;
	deadLetter(opts?: { name?: string }): WorkQueueProjection<WorkQueueDeadLetterPage<T>>;
}
