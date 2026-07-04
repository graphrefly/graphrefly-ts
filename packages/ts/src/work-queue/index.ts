/**
 * MessageBus-backed generic work queue (D299-D324).
 *
 * The queue core is graph-visible facts: commands, records, status, issues. It is intentionally
 * independent from orchestration/WorkItem/executor registries.
 */

import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type {
	MessageBusAvailablePage,
	MessageBusCommand,
	MessageBusMessage,
	MessageBusStatus,
} from "../messaging/index.js";
import { attachMessageBusDeferredCommandSink } from "../messaging/internal.js";
import { availablePage, deadLetterPage, workSnapshot } from "./projections.js";
import type { QueueEvent, RuntimeState, WorkState } from "./runtime-types.js";
import type {
	WorkQueue,
	WorkQueueAvailablePage,
	WorkQueueAvailableParams,
	WorkQueueCommand,
	WorkQueueDeadLetterPage,
	WorkQueueDeadLetterParams,
	WorkQueueOptions,
	WorkQueueRecord,
	WorkQueueRetryPolicy,
	WorkQueueStatus,
	WorkQueueWorkSnapshot,
} from "./types.js";
import {
	appendRecord,
	assertNonEmpty,
	clearLease,
	commandNowMs,
	decodeSubmittedPayload,
	isExpiredLease,
	isReady,
	issueEvent,
	isTerminal,
	materializeLeaseExpired,
	nextCommandId,
	numberOrUndefined,
	payloadAsRecord,
	positiveLimit,
	publishQueueCommand,
	pullParams,
	recordEvent,
	rejectQueueCommand,
	statusEvent,
	stringArrayOrUndefined,
	submitPayload,
	validateQueueCommand,
} from "./utils.js";

export type {
	WorkQueue,
	WorkQueueAvailableItem,
	WorkQueueAvailablePage,
	WorkQueueAvailableParams,
	WorkQueueAvailableProjection,
	WorkQueueCommand,
	WorkQueueDeadLetterPage,
	WorkQueueDeadLetterParams,
	WorkQueueDerivedState,
	WorkQueueOptions,
	WorkQueueProjection,
	WorkQueueRecord,
	WorkQueueRetryPolicy,
	WorkQueueStatus,
	WorkQueueWorkSnapshot,
} from "./types.js";

/**
 * Build a graph-visible work queue over a MessageBus subscription.
 *
 * @param graph - Graph that owns the queue nodes and command projections.
 * @param opts - Queue identity, source topic/subscription, bus, retry, lease, and clock options.
 * @returns A `WorkQueue` handle with graph nodes plus command helpers for submit, claim, complete, fail, cancel, schedule, and projections.
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 * import { messageBus } from "@graphrefly/ts/messaging";
 * import { workQueue } from "@graphrefly/ts/work-queue";
 *
 * const g = graph();
 * const bus = messageBus(g, { topics: ["jobs.submit"], name: "jobs" });
 * const queue = workQueue(g, {
 *   queueId: "jobs",
 *   topic: "jobs.submit",
 *   subscriptionId: "workers",
 *   bus,
 * });
 *
 * queue.submit({ task: "index" });
 * ```
 * @category work-queue
 */
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
		commandId: compoundTupleKey("work-queue-admission-ack", [
			record.queueId,
			messageBus.topic,
			messageBus.subscriptionId,
			String(messageBus.seq),
		]),
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
	const source = canonicalTupleKey([message.topic, String(message.seq)]);
	if (state.sourceSeqs.has(source)) return [];
	state.sourceSeqs.add(source);
	const submitted = decodeSubmittedPayload(message.payload);
	const payload = submitted.payload as T;
	const payloadRecord = payloadAsRecord(submitted.meta);
	const workId =
		typeof payloadRecord.workId === "string"
			? payloadRecord.workId
			: compoundTupleKey("work-queue-work", [opts.queueId, message.topic, String(message.seq)]);
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
		work.leaseId = compoundTupleKey("work-queue-lease", [work.workId, String(++state.leaseSeq)]);
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
