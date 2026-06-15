/**
 * MessageBus-backed generic work queue (D299-D324).
 *
 * The queue core is graph-visible facts: commands, records, status, issues. It is intentionally
 * independent from orchestration/WorkItem/executor registries.
 */

import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type {
	MessageBus,
	MessageBusAvailablePage,
	MessageBusCommand,
	MessageBusMessage,
	MessageBusStatus,
} from "../messaging/index.js";
import { attachMessageBusDeferredCommandSink } from "../messaging/internal.js";
import type { Node } from "../node/node.js";
import type { LockId, PullDemand } from "../protocol/messages.js";

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

type QueueEvent<T> =
	| { readonly kind: "record"; readonly record: WorkQueueRecord<T> }
	| { readonly kind: "status"; readonly status: WorkQueueStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue };

type WorkQueueRecordDraft = {
	readonly kind: string;
	readonly recordedAtMs: number;
	readonly [key: string]: unknown;
};

interface WorkState<T> {
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

interface RuntimeState<T> {
	recordSeq: number;
	leaseSeq: number;
	works: Map<string, WorkState<T>>;
	sourceSeqs: Set<string>;
	commandIds: Set<string>;
	idempotencyKeys: Set<string>;
	records: WorkQueueRecord<T>[];
	deadLetters: WorkQueueRecord<T>[];
}

export function workQueue<T = unknown>(graph: Graph, opts: WorkQueueOptions<T>): WorkQueue<T> {
	assertNonEmpty(opts.queueId, "workQueue.queueId");
	assertNonEmpty(opts.topic, "workQueue.topic");
	assertNonEmpty(opts.subscriptionId, "workQueue.subscriptionId");
	const name = opts.name ?? `workQueue/${opts.queueId}`;
	const now = opts.now ?? Date.now;
	const leaseDurationMs = opts.leaseDurationMs ?? 30_000;
	const retry = opts.retry ?? { maxAttempts: 3, delayMs: 0 };
	const admission = opts.bus.subscription<T>({
		topic: opts.topic,
		subscriptionId: opts.subscriptionId,
		from: opts.from ?? "earliest",
		name: `${name}/admission`,
	});
	const commands = graph.node<WorkQueueCommand<T>>(
		[],
		(ctx) => {
			for (const command of depBatch(ctx, 0) ?? []) ctx.down([["DATA", command]]);
		},
		{
			name: `${name}/commands`,
			factory: "workQueueCommands",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const state: RuntimeState<T> = {
		recordSeq: 0,
		leaseSeq: 0,
		works: new Map(),
		sourceSeqs: new Set(),
		commandIds: new Set(),
		idempotencyKeys: new Set(),
		records: [],
		deadLetters: [],
	};
	const admissionKick = graph.node<"poll">([], null, {
		name: `${name}/admissionKick`,
		factory: "workQueueAdmissionKick",
		initial: "poll",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const admissionPages = graph.node<MessageBusAvailablePage<T>>(
		[admission.available, admissionKick, opts.bus.messages, opts.bus.status],
		(ctx) => {
			for (const page of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", page as MessageBusAvailablePage<T>]]);
			}
			let shouldPull = (depBatch(ctx, 1)?.length ?? 0) > 0;
			for (const message of depBatch(ctx, 2) ?? []) {
				if ((message as MessageBusMessage<T>).topic === opts.topic) shouldPull = true;
			}
			for (const status of depBatch(ctx, 3) ?? []) {
				if (shouldPollAdmission(status as MessageBusStatus, opts.topic, opts.subscriptionId)) {
					shouldPull = true;
				}
			}
			if (shouldPull) {
				ctx.upNext([["PULL", { pullId: admission.availablePullId, params: { limit: 100 } }]], 0);
			}
		},
		{
			name: `${name}/admissionPages`,
			factory: "workQueueAdmissionPages",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const runtime = graph.node<QueueEvent<T>>(
		[commands, admissionPages],
		(ctx) => {
			for (const page of depBatch(ctx, 1) ?? []) {
				for (const msg of (page as MessageBusAvailablePage<T>).messages) {
					for (const event of admitMessage(opts, state, msg, now())) ctx.down([["DATA", event]]);
				}
			}
			for (const command of depBatch(ctx, 0) ?? []) {
				const commandTime = commandNowMs(command as WorkQueueCommand<T>, now());
				for (const event of reduceQueueCommand(
					opts,
					state,
					command as WorkQueueCommand<T>,
					commandTime,
					leaseDurationMs,
					retry,
				)) {
					ctx.down([["DATA", event]]);
				}
			}
		},
		{
			name: `${name}/runtime`,
			factory: "workQueueRuntime",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const records = graph.node<WorkQueueRecord<T>>(
		[runtime],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as QueueEvent<T>;
				if (typed.kind === "record") ctx.down([["DATA", typed.record]]);
			}
		},
		{
			name: `${name}/records`,
			factory: "workQueueRecords",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const status = graph.node<WorkQueueStatus>(
		[runtime],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as QueueEvent<T>;
				if (typed.kind === "status") ctx.down([["DATA", typed.status]]);
			}
		},
		{
			name: `${name}/status`,
			factory: "workQueueStatus",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const issues = graph.node<DataIssue>(
		[runtime],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as QueueEvent<T>;
				if (typed.kind === "issue") ctx.down([["DATA", typed.issue]]);
			}
		},
		{
			name: `${name}/issues`,
			factory: "workQueueIssues",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const admissionAckCommands = graph.node<MessageBusCommand>(
		[records],
		(ctx) => {
			for (const record of depBatch(ctx, 0) ?? []) {
				const command = admissionAckCommand(record as WorkQueueRecord<T>);
				if (command !== undefined) ctx.down([["DATA", command]]);
			}
		},
		{
			name: `${name}/admissionAckCommands`,
			factory: "workQueueAdmissionAckCommands",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	attachMessageBusDeferredCommandSink(graph, opts.bus, admissionAckCommands);
	graph.retain(runtime, { reason: `${name}.workQueue.runtime` });
	const queue: WorkQueue<T> = {
		commands,
		records,
		status,
		issues,
		submit(payload, submitOpts = {}) {
			const command = opts.bus.publish(
				opts.topic,
				submitPayload(payload, {
					...(submitOpts.workId === undefined ? {} : { workId: submitOpts.workId }),
					...(submitOpts.priority === undefined ? {} : { priority: submitOpts.priority }),
					...(submitOpts.tags === undefined ? {} : { tags: submitOpts.tags }),
					...(submitOpts.requirements === undefined
						? {}
						: { requirements: submitOpts.requirements }),
					...(submitOpts.notBeforeMs === undefined ? {} : { notBeforeMs: submitOpts.notBeforeMs }),
					...(submitOpts.deadlineMs === undefined ? {} : { deadlineMs: submitOpts.deadlineMs }),
				}),
				{
					commandId: submitOpts.commandId ?? nextCommandId(opts.queueId, "submit"),
					idempotencyKey: submitOpts.idempotencyKey,
				},
			);
			return command;
		},
		claim(claimOpts) {
			return publishQueueCommand(commands, {
				...claimOpts,
				kind: "claim",
				commandId: claimOpts.commandId ?? nextCommandId(opts.queueId, "claim"),
			} as WorkQueueCommand<T>);
		},
		renewLease(renewOpts) {
			return publishQueueCommand(commands, {
				...renewOpts,
				kind: "renew-lease",
				commandId: renewOpts.commandId ?? nextCommandId(opts.queueId, "renew"),
			} as WorkQueueCommand<T>);
		},
		release(releaseOpts) {
			return publishQueueCommand(commands, {
				...releaseOpts,
				kind: "release",
				commandId: releaseOpts.commandId ?? nextCommandId(opts.queueId, "release"),
			} as WorkQueueCommand<T>);
		},
		complete(completeOpts) {
			return publishQueueCommand(commands, {
				...completeOpts,
				kind: "complete",
				commandId: completeOpts.commandId ?? nextCommandId(opts.queueId, "complete"),
			} as WorkQueueCommand<T>);
		},
		fail(failOpts) {
			return publishQueueCommand(commands, {
				...failOpts,
				kind: "fail",
				commandId: failOpts.commandId ?? nextCommandId(opts.queueId, "fail"),
			} as WorkQueueCommand<T>);
		},
		cancel(cancelOpts) {
			return publishQueueCommand(commands, {
				...cancelOpts,
				kind: "cancel",
				commandId: cancelOpts.commandId ?? nextCommandId(opts.queueId, "cancel"),
			} as WorkQueueCommand<T>);
		},
		schedule(scheduleOpts) {
			return publishQueueCommand(commands, {
				...scheduleOpts,
				kind: "schedule",
				commandId: scheduleOpts.commandId ?? nextCommandId(opts.queueId, "schedule"),
			} as WorkQueueCommand<T>);
		},
		expireLeases(expireOpts = {}) {
			return publishQueueCommand(commands, {
				...expireOpts,
				kind: "expire-leases",
				commandId: expireOpts.commandId ?? nextCommandId(opts.queueId, "expire"),
			} as WorkQueueCommand<T>);
		},
		available(projectionOpts = {}) {
			const availablePullId = Symbol(`${name}/available`);
			const available = graph.node<WorkQueueAvailablePage<T>>(
				[records],
				(ctx) => {
					const params = pullParams<WorkQueueAvailableParams>(ctx.pull);
					ctx.down([["DATA", availablePage(state, params)]]);
				},
				{
					name: projectionOpts.name ?? `${name}/available`,
					factory: "workQueueAvailable",
					pullId: availablePullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return { available, availablePullId, status, issues };
		},
		work(workId, projectionOpts = {}) {
			const snapshotPullId = Symbol(`${name}/${workId}/snapshot`);
			const snapshot = graph.node<WorkQueueWorkSnapshot<T>>(
				[records],
				(ctx) => {
					ctx.down([["DATA", workSnapshot(state, workId)]]);
				},
				{
					name: projectionOpts.name ?? `${name}/${workId}`,
					factory: "workQueueWorkSnapshot",
					pullId: snapshotPullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return { snapshot, snapshotPullId, status, issues };
		},
		deadLetter(projectionOpts = {}) {
			const snapshotPullId = Symbol(`${name}/deadLetter`);
			const snapshot = graph.node<WorkQueueDeadLetterPage<T>>(
				[records],
				(ctx) => {
					const params = pullParams<WorkQueueDeadLetterParams>(ctx.pull);
					ctx.down([["DATA", deadLetterPage(state, params)]]);
				},
				{
					name: projectionOpts.name ?? `${name}/deadLetter`,
					factory: "workQueueDeadLetter",
					pullId: snapshotPullId,
					partial: true,
					completeWhenDepsComplete: false,
					errorWhenDepsError: false,
				},
			);
			return { snapshot, snapshotPullId, status, issues };
		},
	};
	return queue;
}

function shouldPollAdmission(
	status: MessageBusStatus,
	topic: string,
	subscriptionId: string,
): boolean {
	if (status.topic !== topic) return false;
	if (status.kind === "message-published" || status.kind === "retention-trimmed") return true;
	return (
		status.subscriptionId === subscriptionId &&
		(status.kind === "subscription-acked" || status.kind === "subscription-sought")
	);
}

function admissionAckCommand<T>(record: WorkQueueRecord<T>): MessageBusCommand | undefined {
	const messageBus = admissionMessageBus(record);
	if (messageBus === undefined) return undefined;
	return {
		kind: "ack",
		topic: messageBus.topic,
		subscriptionId: messageBus.subscriptionId,
		seq: messageBus.seq,
		commandId: `${record.queueId}:admission-ack:${messageBus.topic}:${messageBus.subscriptionId}:${messageBus.seq}`,
	};
}

function admissionMessageBus<T>(
	record: WorkQueueRecord<T>,
): { readonly topic: string; readonly seq: number; readonly subscriptionId: string } | undefined {
	return "messageBus" in record ? record.messageBus : undefined;
}

function admitMessage<T>(
	opts: WorkQueueOptions<T>,
	state: RuntimeState<T>,
	message: MessageBusMessage<T>,
	nowMs: number,
): QueueEvent<T>[] {
	const source = `${message.topic}:${message.seq}`;
	if (state.sourceSeqs.has(source)) return [];
	state.sourceSeqs.add(source);
	const submitted = decodeSubmittedPayload(message.payload);
	const payload = submitted.payload as T;
	const payloadRecord = payloadAsRecord(submitted.meta);
	const workId =
		typeof payloadRecord.workId === "string"
			? payloadRecord.workId
			: `${opts.queueId}:${message.topic}:${message.seq}`;
	if (state.works.has(workId)) {
		const record = appendRecord(state, opts.queueId, {
			kind: "admission-deduped",
			workId,
			messageBus: { topic: message.topic, seq: message.seq, subscriptionId: opts.subscriptionId },
			reason: "duplicate-work",
			existingWorkId: workId,
			recordedAtMs: nowMs,
		});
		return [
			recordEvent(record),
			statusEvent(opts.queueId, "admission-rejected", nowMs, {
				workId,
				recordSeq: record.recordSeq,
				issueCode: "duplicate-work",
			}),
		];
	}
	const work: WorkState<T> = {
		workId,
		payload,
		state:
			typeof payloadRecord.notBeforeMs === "number" && payloadRecord.notBeforeMs > nowMs
				? "scheduled"
				: "ready",
		admissionSeq: message.seq,
		priority: numberOrUndefined(payloadRecord.priority),
		tags: stringArrayOrUndefined(payloadRecord.tags),
		requirements: stringArrayOrUndefined(payloadRecord.requirements),
		notBeforeMs: numberOrUndefined(payloadRecord.notBeforeMs),
		deadlineMs: numberOrUndefined(payloadRecord.deadlineMs),
		attempt: 0,
	};
	state.works.set(workId, work);
	const record = appendRecord<T>(state, opts.queueId, {
		kind: "work-admitted",
		workId,
		payload,
		messageBus: { topic: message.topic, seq: message.seq, subscriptionId: opts.subscriptionId },
		priority: work.priority,
		tags: work.tags,
		requirements: work.requirements,
		notBeforeMs: work.notBeforeMs,
		deadlineMs: work.deadlineMs,
		recordedAtMs: nowMs,
	});
	return [
		recordEvent(record),
		statusEvent(opts.queueId, "admission-accepted", nowMs, { workId, recordSeq: record.recordSeq }),
	];
}

function reduceQueueCommand<T>(
	opts: WorkQueueOptions<T>,
	state: RuntimeState<T>,
	command: WorkQueueCommand<T>,
	nowMs: number,
	leaseDurationMs: number,
	retry: WorkQueueRetryPolicy,
): QueueEvent<T>[] {
	const invalid = validateQueueCommand(opts.queueId, command);
	if (invalid !== undefined)
		return rejectQueueCommand<T>(opts.queueId, command, invalid.code, invalid.message, nowMs);
	if (state.commandIds.has(command.commandId)) {
		return rejectQueueCommand<T>(
			opts.queueId,
			command,
			"duplicate-command",
			"duplicate commandId",
			nowMs,
		);
	}
	if (command.idempotencyKey !== undefined && state.idempotencyKeys.has(command.idempotencyKey)) {
		return rejectQueueCommand<T>(
			opts.queueId,
			command,
			"duplicate-command",
			"duplicate idempotencyKey",
			nowMs,
		);
	}
	state.commandIds.add(command.commandId);
	if (command.idempotencyKey !== undefined) state.idempotencyKeys.add(command.idempotencyKey);
	switch (command.kind) {
		case "claim":
			return claimWork(opts.queueId, state, command, nowMs, leaseDurationMs);
		case "renew-lease":
			return renewLease(opts.queueId, state, command, nowMs, leaseDurationMs);
		case "release":
			return releaseWork(opts.queueId, state, command, nowMs);
		case "complete":
			return completeWork(opts.queueId, state, command, nowMs);
		case "fail":
			return failWork(opts.queueId, state, command, nowMs, retry);
		case "cancel":
			return cancelWork(opts.queueId, state, command, nowMs);
		case "schedule":
			return scheduleWork(opts.queueId, state, command, nowMs);
		case "expire-leases":
			return expireLeases(opts.queueId, state, command, nowMs);
		case "submit":
			return [
				statusEvent(opts.queueId, "command-accepted", nowMs, {
					commandId: command.commandId,
					details: { submitUsesMessageBus: true },
				}),
			];
	}
}

function claimWork<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "claim" }>,
	nowMs: number,
	defaultLeaseDurationMs: number,
): QueueEvent<T>[] {
	const limit = positiveLimit(command.limit ?? command.requestedWorkIds?.length ?? 1);
	const requested = new Set(command.requestedWorkIds ?? []);
	const events: QueueEvent<T>[] = [];
	for (const work of [...state.works.values()]
		.filter((entry) => (requested.size === 0 ? true : requested.has(entry.workId)))
		.filter((entry) => isExpiredLease(entry, nowMs))) {
		events.push(...materializeLeaseExpired(queueId, state, work, command.commandId, nowMs));
	}
	const candidates = [...state.works.values()]
		.filter((work) => (requested.size === 0 ? true : requested.has(work.workId)))
		.filter((work) => isReady(work, nowMs))
		.sort((a, b) => a.admissionSeq - b.admissionSeq)
		.slice(0, limit);
	if (candidates.length === 0)
		return [
			...events,
			...(requested.size === 0
				? rejectQueueCommand<T>(queueId, command, "not-ready", "no ready work", nowMs)
				: claimMissEvents(queueId, state, command, requested, new Set(), nowMs)),
		];
	const claimed = new Set<string>();
	for (const work of candidates) {
		claimed.add(work.workId);
		work.state = "leased";
		work.attempt += 1;
		work.leaseId = `${work.workId}:lease:${++state.leaseSeq}`;
		work.workerId = command.workerId;
		work.leaseExpiresAtMs = nowMs + (command.leaseDurationMs ?? defaultLeaseDurationMs);
		const record = appendRecord(state, queueId, {
			kind: "work-claimed",
			workId: work.workId,
			commandId: command.commandId,
			leaseId: work.leaseId,
			attempt: work.attempt,
			workerId: command.workerId,
			claimedAtMs: nowMs,
			leaseExpiresAtMs: work.leaseExpiresAtMs,
			recordedAtMs: nowMs,
		});
		events.push(
			recordEvent(record),
			statusEvent(queueId, "command-accepted", nowMs, {
				workId: work.workId,
				commandId: command.commandId,
				recordSeq: record.recordSeq,
			}),
		);
	}
	if (requested.size > 0) {
		events.push(...claimMissEvents(queueId, state, command, requested, claimed, nowMs));
	}
	return events;
}

function claimMissEvents<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "claim" }>,
	requested: ReadonlySet<string>,
	claimed: ReadonlySet<string>,
	nowMs: number,
): QueueEvent<T>[] {
	const events: QueueEvent<T>[] = [];
	for (const workId of requested) {
		if (claimed.has(workId)) continue;
		const work = state.works.get(workId);
		if (work === undefined) {
			events.push(
				...rejectQueueCommand<T>(
					queueId,
					command,
					"unknown-work",
					`unknown work '${workId}'`,
					nowMs,
				),
			);
			continue;
		}
		if (isReady(work, nowMs)) continue;
		const code = isTerminal(work.state)
			? "terminal-work"
			: work.state === "leased"
				? "already-leased"
				: "not-ready";
		events.push(
			...rejectQueueCommand<T>(
				queueId,
				command,
				code,
				`requested work '${workId}' is not claimable`,
				nowMs,
			),
		);
	}
	return events;
}

function renewLease<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "renew-lease" }>,
	nowMs: number,
	defaultLeaseDurationMs: number,
): QueueEvent<T>[] {
	const checked = currentLease(queueId, state, command, nowMs);
	if ("issue" in checked) return [checked.issue];
	if ("events" in checked) return checked.events;
	const work = checked.work;
	const previous = work.leaseExpiresAtMs as number;
	work.leaseExpiresAtMs =
		command.leaseExpiresAtMs ?? nowMs + (command.leaseDurationMs ?? defaultLeaseDurationMs);
	const record = appendRecord(state, queueId, {
		kind: "lease-renewed",
		workId: work.workId,
		commandId: command.commandId,
		leaseId: command.leaseId,
		attempt: command.attempt,
		workerId: command.workerId,
		previousLeaseExpiresAtMs: previous,
		leaseExpiresAtMs: work.leaseExpiresAtMs,
		renewedAtMs: nowMs,
		recordedAtMs: nowMs,
	});
	return [
		recordEvent(record),
		statusEvent(queueId, "command-accepted", nowMs, {
			workId: work.workId,
			commandId: command.commandId,
			recordSeq: record.recordSeq,
		}),
	];
}

function releaseWork<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "release" }>,
	nowMs: number,
): QueueEvent<T>[] {
	const checked = currentLease(queueId, state, command, nowMs);
	if ("issue" in checked) return [checked.issue];
	if ("events" in checked) return checked.events;
	const work = checked.work;
	work.state = "ready";
	work.leaseId = undefined;
	work.workerId = undefined;
	work.leaseExpiresAtMs = undefined;
	const record = appendRecord(state, queueId, {
		kind: "work-released",
		workId: work.workId,
		commandId: command.commandId,
		leaseId: command.leaseId,
		attempt: command.attempt,
		workerId: command.workerId,
		releasedAtMs: nowMs,
		reason: command.reason,
		recordedAtMs: nowMs,
	});
	return [
		recordEvent(record),
		statusEvent(queueId, "command-accepted", nowMs, {
			workId: work.workId,
			commandId: command.commandId,
			recordSeq: record.recordSeq,
		}),
	];
}

function completeWork<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "complete" }>,
	nowMs: number,
): QueueEvent<T>[] {
	const checked = currentLease(queueId, state, command, nowMs);
	if ("issue" in checked) return [checked.issue];
	if ("events" in checked) return checked.events;
	const work = checked.work;
	work.state = "completed";
	clearLease(work);
	work.terminalRecordSeq = state.recordSeq + 2;
	const attempt = appendRecord(state, queueId, {
		kind: "attempt-completed",
		workId: work.workId,
		commandId: command.commandId,
		leaseId: command.leaseId,
		attempt: command.attempt,
		workerId: command.workerId,
		result: command.result,
		recordedAtMs: nowMs,
	});
	const done = appendRecord(state, queueId, {
		kind: "work-completed",
		workId: work.workId,
		commandId: command.commandId,
		leaseId: command.leaseId,
		attempt: command.attempt,
		workerId: command.workerId,
		result: command.result,
		recordedAtMs: nowMs,
	});
	return [
		recordEvent(attempt),
		recordEvent(done),
		statusEvent(queueId, "command-accepted", nowMs, {
			workId: work.workId,
			commandId: command.commandId,
			recordSeq: done.recordSeq,
		}),
	];
}

function failWork<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "fail" }>,
	nowMs: number,
	retry: WorkQueueRetryPolicy,
): QueueEvent<T>[] {
	const checked = currentLease(queueId, state, command, nowMs);
	if ("issue" in checked) return [checked.issue];
	if ("events" in checked) return checked.events;
	const work = checked.work;
	const failed = appendRecord(state, queueId, {
		kind: "attempt-failed",
		workId: work.workId,
		commandId: command.commandId,
		leaseId: command.leaseId,
		attempt: command.attempt,
		workerId: command.workerId,
		error: command.error,
		retryable: command.retryable,
		recordedAtMs: nowMs,
	});
	const maxAttempts = retry.maxAttempts ?? 3;
	if (command.retryable === false || work.attempt >= maxAttempts) {
		work.state = "dead-lettered";
		clearLease(work);
		work.retryAtMs = undefined;
		const dead = appendRecord(state, queueId, {
			kind: "work-dead-lettered",
			workId: work.workId,
			commandId: command.commandId,
			reason: command.retryable === false ? "non-retryable" : "attempts-exhausted",
			exhaustedAttempts: work.attempt,
			recordedAtMs: nowMs,
		});
		state.deadLetters.push(dead);
		return [
			recordEvent(failed),
			recordEvent(dead),
			statusEvent(queueId, "command-accepted", nowMs, {
				workId: work.workId,
				commandId: command.commandId,
				recordSeq: dead.recordSeq,
			}),
		];
	}
	const delayMs = retry.delayMs ?? 0;
	work.state = delayMs > 0 ? "retry-wait" : "ready";
	work.retryAtMs = nowMs + delayMs;
	clearLease(work);
	const retryRecord = appendRecord(state, queueId, {
		kind: "retry-scheduled",
		workId: work.workId,
		commandId: command.commandId,
		retryAtMs: work.retryAtMs,
		delayMs,
		reason: "retry-policy",
		recordedAtMs: nowMs,
	});
	return [
		recordEvent(failed),
		recordEvent(retryRecord),
		statusEvent(queueId, "command-accepted", nowMs, {
			workId: work.workId,
			commandId: command.commandId,
			recordSeq: retryRecord.recordSeq,
		}),
	];
}

function cancelWork<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "cancel" }>,
	nowMs: number,
): QueueEvent<T>[] {
	const work = state.works.get(command.workId);
	if (work === undefined)
		return [issueEvent(queueId, "unknown-work", "unknown work", nowMs, command)];
	if (isTerminal(work.state))
		return [issueEvent(queueId, "terminal-work", "work is terminal", nowMs, command)];
	work.state = "canceled";
	const canceledLeaseId = work.leaseId;
	const attempt = work.attempt || undefined;
	const record = appendRecord(state, queueId, {
		kind: "work-canceled",
		workId: work.workId,
		commandId: command.commandId,
		reason: command.reason,
		canceledAtMs: nowMs,
		canceledLeaseId,
		attempt,
		recordedAtMs: nowMs,
	});
	clearLease(work);
	return [
		recordEvent(record),
		statusEvent(queueId, "command-accepted", nowMs, {
			workId: work.workId,
			commandId: command.commandId,
			recordSeq: record.recordSeq,
		}),
	];
}

function scheduleWork<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "schedule" }>,
	nowMs: number,
): QueueEvent<T>[] {
	const work = state.works.get(command.workId);
	if (work === undefined)
		return [issueEvent(queueId, "unknown-work", "unknown work", nowMs, command)];
	if (isTerminal(work.state))
		return [issueEvent(queueId, "terminal-work", "work is terminal", nowMs, command)];
	work.state = "scheduled";
	work.notBeforeMs = command.notBeforeMs;
	work.deadlineMs = command.deadlineMs;
	const record = appendRecord(state, queueId, {
		kind: "work-scheduled",
		workId: work.workId,
		commandId: command.commandId,
		scheduleId: command.scheduleId,
		scheduleAtMs: command.scheduleAtMs,
		runAtMs: command.runAtMs,
		notBeforeMs: command.notBeforeMs,
		deadlineMs: command.deadlineMs,
		reason: command.reason,
		recordedAtMs: nowMs,
	});
	return [
		recordEvent(record),
		statusEvent(queueId, "command-accepted", nowMs, {
			workId: work.workId,
			commandId: command.commandId,
			recordSeq: record.recordSeq,
		}),
	];
}

function expireLeases<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: Extract<WorkQueueCommand<T>, { kind: "expire-leases" }>,
	nowMs: number,
): QueueEvent<T>[] {
	const workIds = new Set(command.workIds ?? []);
	const limit = positiveLimit(command.limit ?? Number.MAX_SAFE_INTEGER);
	const expired = [...state.works.values()]
		.filter(
			(work) =>
				work.state === "leased" &&
				work.leaseExpiresAtMs !== undefined &&
				work.leaseExpiresAtMs <= nowMs,
		)
		.filter((work) => workIds.size === 0 || workIds.has(work.workId))
		.slice(0, limit);
	if (expired.length === 0)
		return [statusEvent(queueId, "maintenance-noop", nowMs, { commandId: command.commandId })];
	const events: QueueEvent<T>[] = [];
	for (const work of expired) {
		events.push(...materializeLeaseExpired(queueId, state, work, command.commandId, nowMs));
	}
	events.push(
		statusEvent(queueId, "maintenance-applied", nowMs, {
			commandId: command.commandId,
			details: { expired: expired.length },
		}),
	);
	return events;
}

function currentLease<T>(
	queueId: string,
	state: RuntimeState<T>,
	command: {
		commandId?: string;
		workId: string;
		leaseId: string;
		attempt: number;
		workerId: string;
	},
	nowMs: number,
): { work: WorkState<T> } | { issue: QueueEvent<T> } | { events: QueueEvent<T>[] } {
	const work = state.works.get(command.workId);
	if (work === undefined)
		return { issue: issueEvent(queueId, "unknown-work", "unknown work", nowMs, command) };
	if (isTerminal(work.state))
		return { issue: issueEvent(queueId, "terminal-work", "work is terminal", nowMs, command) };
	if (work.state !== "leased")
		return {
			issue: issueEvent(queueId, "lease-not-current", "work is not leased", nowMs, command),
		};
	if (work.leaseId !== command.leaseId)
		return { issue: issueEvent(queueId, "stale-lease", "lease is not current", nowMs, command) };
	if (work.attempt !== command.attempt)
		return { issue: issueEvent(queueId, "attempt-mismatch", "attempt mismatch", nowMs, command) };
	if (work.workerId !== command.workerId)
		return { issue: issueEvent(queueId, "worker-mismatch", "worker mismatch", nowMs, command) };
	if (isExpiredLease(work, nowMs))
		return {
			events: materializeLeaseExpired(queueId, state, work, command.commandId, nowMs, {
				command,
				code: "lease-expired",
				message: "lease expired",
			}),
		};
	return { work };
}

function availablePage<T>(
	state: RuntimeState<T>,
	params: WorkQueueAvailableParams,
): WorkQueueAvailablePage<T> {
	const limit = positiveLimit(params.limit ?? 100);
	const orderByWorkId = params.afterWorkId !== undefined && params.afterAdmissionSeq === undefined;
	const all = [...state.works.values()]
		.filter((work) => isReadyForProjection(work, params.nowMs))
		.filter((work) => params.afterWorkId === undefined || work.workId > params.afterWorkId)
		.filter(
			(work) =>
				params.afterAdmissionSeq === undefined || work.admissionSeq > params.afterAdmissionSeq,
		)
		.sort((a, b) =>
			orderByWorkId
				? a.workId.localeCompare(b.workId)
				: a.admissionSeq - b.admissionSeq || a.workId.localeCompare(b.workId),
		);
	const items = all.map((work) => ({
		workId: work.workId,
		state: work.state,
		payload: work.payload,
		admissionSeq: work.admissionSeq,
		priority: work.priority,
		tags: work.tags,
		requirements: work.requirements,
		notBeforeMs: work.notBeforeMs,
		retryAtMs: work.retryAtMs,
		deadlineMs: work.deadlineMs,
	}));
	const page = items.slice(0, limit);
	return {
		items: page,
		...(items.length > limit && page.length > 0
			? { nextAfterWorkId: page[page.length - 1]?.workId }
			: {}),
		...(items.length > limit && page.length > 0
			? { nextAfterAdmissionSeq: page[page.length - 1]?.admissionSeq }
			: {}),
		hasMore: items.length > limit,
		asOfRecordSeq: state.recordSeq,
	};
}

function workSnapshot<T>(state: RuntimeState<T>, workId: string): WorkQueueWorkSnapshot<T> {
	const work = state.works.get(workId);
	return {
		workId,
		state: work?.state,
		payload: work?.payload,
		...(work?.state !== "leased" || work.leaseId === undefined
			? {}
			: {
					activeLease: {
						leaseId: work.leaseId,
						attempt: work.attempt,
						workerId: work.workerId as string,
						leaseExpiresAtMs: work.leaseExpiresAtMs as number,
					},
				}),
		records: state.records.filter((record) => record.workId === workId),
		asOfRecordSeq: state.recordSeq,
	};
}

function materializeLeaseExpired<T>(
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

function isExpiredLease<T>(work: WorkState<T>, nowMs: number): boolean {
	return (
		work.state === "leased" && work.leaseExpiresAtMs !== undefined && work.leaseExpiresAtMs <= nowMs
	);
}

function clearLease<T>(work: WorkState<T>): void {
	work.leaseId = undefined;
	work.workerId = undefined;
	work.leaseExpiresAtMs = undefined;
}

function deadLetterPage<T>(
	state: RuntimeState<T>,
	params: WorkQueueDeadLetterParams,
): WorkQueueDeadLetterPage<T> {
	const limit = positiveLimit(params.limit ?? 100);
	const entries = state.deadLetters.filter((record) => {
		if (params.afterDeadLetterSeq !== undefined && record.recordSeq <= params.afterDeadLetterSeq)
			return false;
		if (params.afterWorkId !== undefined && (record.workId ?? "") <= params.afterWorkId)
			return false;
		return true;
	});
	const page = entries.slice(0, limit);
	return {
		entries: page,
		...(entries.length > limit && page.length > 0
			? { nextAfterDeadLetterSeq: page[page.length - 1]?.recordSeq }
			: {}),
		hasMore: entries.length > limit,
		asOfRecordSeq: state.recordSeq,
	};
}

function appendRecord<T>(
	state: RuntimeState<T>,
	queueId: string,
	record: WorkQueueRecordDraft,
): WorkQueueRecord<T> {
	const full = { ...record, queueId, recordSeq: ++state.recordSeq } as WorkQueueRecord<T>;
	state.records.push(full);
	return full;
}

function recordEvent<T>(record: WorkQueueRecord<T>): QueueEvent<T> {
	return { kind: "record", record };
}

function statusEvent<T>(
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

function issueEvent<T>(
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

function rejectQueueCommand<T>(
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

function validateQueueCommand(
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

function validateLeaseCommand(
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

function requiredString(
	value: unknown,
	name: string,
): { readonly code: string; readonly message: string } | undefined {
	return typeof value === "string" && value.length > 0
		? undefined
		: { code: "malformed-command", message: `${name} must be a non-empty string` };
}

function commandIdFrom(command: unknown): string | undefined {
	return isObjectRecord(command) && typeof command.commandId === "string"
		? command.commandId
		: undefined;
}

function isWorkQueueCommandKind(kind: string): kind is WorkQueueCommand["kind"] {
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function publishQueueCommand<T>(
	node: Node<WorkQueueCommand<T>>,
	command: WorkQueueCommand<T>,
): WorkQueueCommand<T> {
	node.down([["DATA", command]]);
	return command;
}

let commandSeq = 0;
function nextCommandId(queueId: string, kind: string): string {
	commandSeq += 1;
	return `${queueId}:${kind}:${commandSeq}`;
}

function isReady<T>(work: WorkState<T>, nowMs: number): boolean {
	if (work.state === "scheduled")
		return work.notBeforeMs !== undefined && work.notBeforeMs <= nowMs;
	if (work.state === "retry-wait") return work.retryAtMs !== undefined && work.retryAtMs <= nowMs;
	return work.state === "ready";
}

function isReadyForProjection<T>(work: WorkState<T>, nowMs: number | undefined): boolean {
	if (work.state === "scheduled" || work.state === "retry-wait") {
		return nowMs === undefined ? false : isReady(work, nowMs);
	}
	return isReady(work, 0);
}

function isTerminal(state: WorkQueueDerivedState): boolean {
	return state === "completed" || state === "canceled" || state === "dead-lettered";
}

function payloadAsRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string")
		? value
		: undefined;
}

function pullParams<T>(pull: PullDemand | undefined): T {
	return (
		typeof pull?.params === "object" && pull.params !== null && !Array.isArray(pull.params)
			? pull.params
			: {}
	) as T;
}

const SUBMIT_ENVELOPE = "__graphreflyWorkQueueSubmit";

function submitPayload<T>(
	payload: T,
	meta: Record<string, unknown>,
): T | (Record<string, unknown> & { readonly [SUBMIT_ENVELOPE]: true; readonly payload: T }) {
	if (Object.keys(meta).length === 0) return payload;
	return { [SUBMIT_ENVELOPE]: true, payload, ...meta };
}

function decodeSubmittedPayload<T>(payload: T): { payload: T; meta: Record<string, unknown> } {
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

function commandNowMs<T>(command: WorkQueueCommand<T>, fallback: number): number {
	return typeof command.nowMs === "number" && Number.isFinite(command.nowMs)
		? command.nowMs
		: fallback;
}

function positiveLimit(limit: number): number {
	if (!Number.isInteger(limit) || limit < 1)
		throw new Error("workQueue: limit must be a positive integer");
	return limit;
}

function assertNonEmpty(value: string, owner: string): void {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${owner} must be a non-empty string`);
}
