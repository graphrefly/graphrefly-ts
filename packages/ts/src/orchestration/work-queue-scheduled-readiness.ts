import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey, parseCanonicalTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	WorkQueueCommand,
	WorkQueueDerivedState,
	WorkQueueRecord,
} from "../work-queue/index.js";
import {
	canonicalPublicSourceRefs,
	dataIssue,
	isRecord,
	projectRuntimeFact,
	ref,
	sanitizeGraphVisibleRecord,
	stableJsonStringify,
	stableStringHash,
	uniqueSourceRefs,
} from "./agent-runtime-common.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { SourceRef } from "./agent-runtime-types-core.js";
import type {
	ScheduledReadinessOverdue,
	ScheduledReadinessReady,
	ScheduledReadinessRequested,
} from "./scheduled-readiness.js";

export type WorkQueueScheduledReadinessScheduleKind =
	| "work-admitted"
	| "work-scheduled"
	| "retry-scheduled"
	| "lease-expiration";

export type WorkQueueScheduledReadinessStatusState = "translated" | "issue";

export interface WorkQueueScheduledReadinessStatus {
	readonly kind: "work-queue-scheduled-readiness-status";
	readonly statusId: string;
	readonly queueId?: string;
	readonly workId?: string;
	readonly recordSeq?: number;
	readonly state: WorkQueueScheduledReadinessStatusState;
	readonly scheduleKind?: WorkQueueScheduledReadinessScheduleKind;
	readonly scheduleId?: string;
	readonly readyAtMs?: number;
	readonly deadlineMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issueCodes?: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkQueueScheduledReadinessViews {
	readonly schedulesById: ReadonlyMap<string, ScheduledReadinessRequested>;
	readonly statusById: ReadonlyMap<string, WorkQueueScheduledReadinessStatus>;
}

export interface WorkQueueScheduledReadinessBundle {
	readonly readinessSchedules: Node<ScheduledReadinessRequested>;
	readonly status: Node<WorkQueueScheduledReadinessStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkQueueScheduledReadinessViews>;
}

export type WorkQueueReadinessCandidateKind = "claim-eligible" | "lease-expiration-eligible";

export interface WorkQueueReadinessCandidate {
	readonly kind: "work-queue-readiness-candidate";
	readonly candidateId: string;
	readonly candidateKind: WorkQueueReadinessCandidateKind;
	readonly queueId: string;
	readonly workId: string;
	readonly scheduleId: string;
	readonly readyAtMs: number;
	readonly nowMs: number;
	readonly originRecordSeq?: number;
	readonly originRecordKind?: string;
	readonly leaseId?: string;
	readonly attempt?: number;
	readonly workerId?: string;
	readonly leaseExpiresAtMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type WorkQueueReadinessHandoffStatusState =
	| "candidate"
	| "ignored-stale"
	| "ignored-superseded"
	| "ignored-terminal"
	| "overdue"
	| "pending-origin"
	| "issue";

export interface WorkQueueReadinessHandoffStatus {
	readonly kind: "work-queue-readiness-handoff-status";
	readonly statusId: string;
	readonly state: WorkQueueReadinessHandoffStatusState;
	readonly queueId?: string;
	readonly workId?: string;
	readonly scheduleId?: string;
	readonly candidateId?: string;
	readonly candidateKind?: WorkQueueReadinessCandidateKind;
	readonly readyAtMs?: number;
	readonly nowMs?: number;
	readonly currentState?: WorkQueueDerivedState;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issueCodes?: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

export interface WorkQueueReadinessHandoffViews {
	readonly candidatesById: ReadonlyMap<string, WorkQueueReadinessCandidate>;
	readonly statusById: ReadonlyMap<string, WorkQueueReadinessHandoffStatus>;
}

export interface WorkQueueReadinessHandoffBundle {
	readonly candidates: Node<WorkQueueReadinessCandidate>;
	readonly status: Node<WorkQueueReadinessHandoffStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<WorkQueueReadinessHandoffViews>;
}

export interface WorkQueueLeaseExpirationCommandBundle<T = unknown> {
	readonly commands: Node<WorkQueueCommand<T>>;
	readonly status: Node<WorkQueueReadinessHandoffStatus>;
	readonly views: Node<WorkQueueReadinessHandoffViews>;
}

const MAX_PUBLIC_COORDINATE_ID_CHARS = 160;
const MAX_COPIED_PUBLIC_REFS = 16;
const PRIVATE_COORDINATE_PATTERN =
	/(api[_-]?key|authorization|bearer|credential|oauth|password|private[_-]?key|secret|session[_-]?cookie|token)/i;

/**
 * Translate workQueue-local delayed eligibility records into D432 shared readiness schedules.
 *
 * The projector is intentionally visibility-only: it never claims work, expires leases, cancels,
 * completes, fails, mutates queue records, or starts timers. D433 consumption/materialization stays
 * owned by later workQueue domain projectors.
 */
export function workQueueScheduledReadinessProjector<T = unknown>(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly records: Node<WorkQueueRecord<T>>;
	},
): WorkQueueScheduledReadinessBundle {
	const name = opts.name ?? "workQueueScheduledReadiness";
	const runtime = graph.node<WorkQueueScheduledReadinessFact>(
		[opts.records],
		(ctx) => {
			const state = ctx.state.get<WorkQueueScheduledReadinessProjectorState>() ?? initialState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const translated = translateRecord(raw);
				if (translated.kind === "none") continue;
				if (translated.kind === "issue") {
					emitIssue(ctx, state, translated.issue);
					emitStatus(ctx, state, translated.status);
					continue;
				}
				const identity = scheduleIdentity(translated.schedule);
				const recordKey = canonicalTupleKey([
					translated.record.queueId,
					String(translated.record.recordSeq),
				]);
				const existingRecordIdentity = state.recordScheduleIdentityByKey.get(recordKey);
				if (existingRecordIdentity !== undefined) {
					if (existingRecordIdentity !== identity) emitScheduleConflict(ctx, state, translated);
					continue;
				}
				state.recordScheduleIdentityByKey.set(recordKey, identity);
				const existing = state.schedulesById.get(translated.schedule.scheduleId);
				if (existing !== undefined) {
					if (scheduleIdentity(existing) !== identity) {
						emitScheduleConflict(ctx, state, translated, existing);
					}
					continue;
				}
				state.schedulesById.set(translated.schedule.scheduleId, translated.schedule);
				emitSchedule(ctx, state, translated.schedule);
				emitStatus(ctx, state, translated.status);
				emitAudit(ctx, state, "work-queue-scheduled-readiness-translated", {
					subjectId: translated.schedule.scheduleId,
					sourceRefs: translated.schedule.sourceRefs,
					metadata: {
						queueId: publicCoordinateId(translated.record.queueId),
						workId: publicCoordinateId(translated.record.workId),
						recordSeq: translated.record.recordSeq,
						recordKind: translated.record.kind,
						readyAtMs: translated.schedule.readyAtMs,
					},
				});
			}
			ctx.down([["DATA", { kind: "views", views: buildViews(state) }]]);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workQueueScheduledReadinessProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		readinessSchedules: projectRuntimeFact(
			graph,
			runtime,
			`${name}/readinessSchedules`,
			"workQueueScheduledReadinessSchedules",
			(fact) => (fact.kind === "readiness-schedule" ? fact.schedule : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workQueueScheduledReadinessStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workQueueScheduledReadinessIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"workQueueScheduledReadinessAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: projectRuntimeFact(
			graph,
			runtime,
			`${name}/views`,
			"workQueueScheduledReadinessViews",
			(fact) => (fact.kind === "views" ? fact.views : undefined),
		),
	};
}

/**
 * Consume D433 shared readiness through workQueue-owned handoff material.
 *
 * Ready facts only produce queue-domain candidates/status. They do not claim work, expire leases,
 * cancel, complete, fail, or append workQueue records. Lease expiration candidates can be lowered
 * separately into the existing mutation-bearing expire-leases command path.
 */
export function workQueueReadinessHandoffProjector<T = unknown>(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly records: Node<WorkQueueRecord<T>>;
		readonly ready: Node<ScheduledReadinessReady>;
		readonly overdue?: Node<ScheduledReadinessOverdue>;
	},
): WorkQueueReadinessHandoffBundle {
	const name = opts.name ?? "workQueueReadinessHandoff";
	const deps =
		opts.overdue === undefined
			? ([opts.records, opts.ready] as const)
			: ([opts.records, opts.ready, opts.overdue] as const);
	const runtime = graph.node<WorkQueueReadinessHandoffFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<WorkQueueReadinessHandoffProjectorState>() ?? handoffState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const record = raw as WorkQueueRecord<T>;
				ingestWorkQueueRecord(state, record);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const ready = raw as ScheduledReadinessReady;
				state.readyByScheduleId.set(ready.scheduleId, ready);
			}
			if (opts.overdue !== undefined) {
				for (const raw of depBatch(ctx, 2) ?? []) {
					emitOverdueHandoffStatus(ctx, state, raw as ScheduledReadinessOverdue);
				}
			}
			evaluateReadyHandoffs(ctx, state);
			ctx.down([["DATA", { kind: "views", views: buildHandoffViews(state) }]]);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workQueueReadinessHandoffProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		candidates: projectRuntimeFact(
			graph,
			runtime,
			`${name}/candidates`,
			"workQueueReadinessHandoffCandidates",
			(fact) => (fact.kind === "candidate" ? fact.candidate : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workQueueReadinessHandoffStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"workQueueReadinessHandoffIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(
			graph,
			runtime,
			`${name}/audit`,
			"workQueueReadinessHandoffAudit",
			(fact) => (fact.kind === "audit" ? fact.audit : undefined),
		),
		views: projectRuntimeFact(
			graph,
			runtime,
			`${name}/views`,
			"workQueueReadinessHandoffViews",
			(fact) => (fact.kind === "views" ? fact.views : undefined),
		),
	};
}

/**
 * Lower only lease-expiration readiness candidates into existing workQueue expire-leases commands.
 */
export function workQueueLeaseExpirationCommandProjector<T = unknown>(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly candidates: Node<WorkQueueReadinessCandidate>;
	},
): WorkQueueLeaseExpirationCommandBundle<T> {
	const name = opts.name ?? "workQueueLeaseExpirationCommands";
	const runtime = graph.node<WorkQueueLeaseExpirationCommandFact<T>>(
		[opts.candidates],
		(ctx) => {
			const state =
				ctx.state.get<WorkQueueLeaseExpirationCommandProjectorState<T>>() ??
				leaseExpirationCommandState<T>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const candidate = raw as WorkQueueReadinessCandidate;
				if (candidate.candidateKind !== "lease-expiration-eligible") continue;
				if (state.commandByCandidateId.has(candidate.candidateId)) continue;
				const command = Object.freeze({
					kind: "expire-leases",
					commandId: compoundTupleKey("work-queue-expire-leases", [candidate.candidateId]),
					queueId: candidate.queueId,
					workIds: [candidate.workId],
					limit: 1,
					nowMs: candidate.nowMs,
					causationId: candidate.scheduleId,
					...(sourceRefStrings(candidate.sourceRefs) === undefined
						? {}
						: { sourceRefs: sourceRefStrings(candidate.sourceRefs) }),
				} satisfies WorkQueueCommand<T>);
				state.commandByCandidateId.set(candidate.candidateId, command);
				ctx.down([["DATA", { kind: "command", command }]]);
				emitLeaseCommandStatus(ctx, state, command, candidate);
			}
			ctx.down([["DATA", { kind: "views", views: buildLeaseCommandViews(state) }]]);
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workQueueLeaseExpirationCommandProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		commands: projectRuntimeFact(
			graph,
			runtime,
			`${name}/commands`,
			"workQueueLeaseExpirationCommands",
			(fact) => (fact.kind === "command" ? fact.command : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"workQueueLeaseExpirationCommandStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		views: projectRuntimeFact(
			graph,
			runtime,
			`${name}/views`,
			"workQueueLeaseExpirationCommandViews",
			(fact) => (fact.kind === "views" ? fact.views : undefined),
		),
	};
}

type WorkQueueScheduledReadinessFact =
	| { readonly kind: "readiness-schedule"; readonly schedule: ScheduledReadinessRequested }
	| { readonly kind: "status"; readonly status: WorkQueueScheduledReadinessStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord }
	| { readonly kind: "views"; readonly views: WorkQueueScheduledReadinessViews };

interface WorkQueueScheduledReadinessProjectorState {
	recordScheduleIdentityByKey: Map<string, string>;
	schedulesById: Map<string, ScheduledReadinessRequested>;
	statusById: Map<string, WorkQueueScheduledReadinessStatus>;
	emittedKeys: Set<string>;
	issueKeys: Set<string>;
	auditSeq: number;
}

type WorkQueueRecordWithWorkId = WorkQueueRecord<unknown> & { readonly workId: string };

type TranslatedRecord =
	| { readonly kind: "none" }
	| {
			readonly kind: "translated";
			readonly record: WorkQueueRecordWithWorkId;
			readonly schedule: ScheduledReadinessRequested;
			readonly status: WorkQueueScheduledReadinessStatus;
	  }
	| {
			readonly kind: "issue";
			readonly issue: DataIssue;
			readonly status: WorkQueueScheduledReadinessStatus;
	  };

type WorkQueueReadinessHandoffFact =
	| { readonly kind: "candidate"; readonly candidate: WorkQueueReadinessCandidate }
	| { readonly kind: "status"; readonly status: WorkQueueReadinessHandoffStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord }
	| { readonly kind: "views"; readonly views: WorkQueueReadinessHandoffViews };

interface WorkQueueReadinessOrigin {
	readonly record: WorkQueueRecordWithWorkId;
	readonly schedule: ScheduledReadinessRequested;
	readonly scheduleKind: WorkQueueScheduledReadinessScheduleKind;
}

interface WorkQueueReadinessWorkState {
	readonly queueId: string;
	readonly workId: string;
	state: WorkQueueDerivedState;
	notBeforeMs?: number;
	retryAtMs?: number;
	deadlineMs?: number;
	leaseId?: string;
	attempt?: number;
	workerId?: string;
	leaseExpiresAtMs?: number;
	latestRecordSeq: number;
}

interface WorkQueueReadinessHandoffProjectorState {
	originsByScheduleId: Map<string, WorkQueueReadinessOrigin>;
	worksById: Map<string, WorkQueueReadinessWorkState>;
	readyByScheduleId: Map<string, ScheduledReadinessReady>;
	candidatesById: Map<string, WorkQueueReadinessCandidate>;
	statusById: Map<string, WorkQueueReadinessHandoffStatus>;
	emittedKeys: Set<string>;
	issueKeys: Set<string>;
	auditSeq: number;
}

type WorkQueueLeaseExpirationCommandFact<T> =
	| { readonly kind: "command"; readonly command: WorkQueueCommand<T> }
	| { readonly kind: "status"; readonly status: WorkQueueReadinessHandoffStatus }
	| { readonly kind: "views"; readonly views: WorkQueueReadinessHandoffViews };

interface WorkQueueLeaseExpirationCommandProjectorState<T> {
	commandByCandidateId: Map<string, WorkQueueCommand<T>>;
	statusById: Map<string, WorkQueueReadinessHandoffStatus>;
	emittedKeys: Set<string>;
}

function initialState(): WorkQueueScheduledReadinessProjectorState {
	return {
		recordScheduleIdentityByKey: new Map(),
		schedulesById: new Map(),
		statusById: new Map(),
		emittedKeys: new Set(),
		issueKeys: new Set(),
		auditSeq: 0,
	};
}

function handoffState(): WorkQueueReadinessHandoffProjectorState {
	return {
		originsByScheduleId: new Map(),
		worksById: new Map(),
		readyByScheduleId: new Map(),
		candidatesById: new Map(),
		statusById: new Map(),
		emittedKeys: new Set(),
		issueKeys: new Set(),
		auditSeq: 0,
	};
}

function leaseExpirationCommandState<T>(): WorkQueueLeaseExpirationCommandProjectorState<T> {
	return {
		commandByCandidateId: new Map(),
		statusById: new Map(),
		emittedKeys: new Set(),
	};
}

function ingestWorkQueueRecord<T>(
	state: WorkQueueReadinessHandoffProjectorState,
	record: WorkQueueRecord<T>,
): void {
	const translated = translateRecord(record);
	if (translated.kind === "translated") {
		state.originsByScheduleId.set(translated.schedule.scheduleId, {
			record: translated.record,
			schedule: translated.schedule,
			scheduleKind: translated.status.scheduleKind as WorkQueueScheduledReadinessScheduleKind,
		});
	}
	if (record.workId === undefined) return;
	const recordWithWorkId = record as WorkQueueRecordWithWorkId;
	const existing = state.worksById.get(
		handoffWorkKey(recordWithWorkId.queueId, recordWithWorkId.workId),
	);
	if (existing !== undefined && recordWithWorkId.recordSeq < existing.latestRecordSeq) return;
	const work = ensureHandoffWorkState(state, recordWithWorkId);
	work.latestRecordSeq = Math.max(work.latestRecordSeq, recordWithWorkId.recordSeq);
	switch (recordWithWorkId.kind) {
		case "work-admitted":
			work.state = recordWithWorkId.notBeforeMs === undefined ? "ready" : "scheduled";
			work.notBeforeMs = recordWithWorkId.notBeforeMs;
			work.retryAtMs = undefined;
			work.deadlineMs = recordWithWorkId.deadlineMs;
			clearHandoffLease(work);
			break;
		case "work-scheduled":
			work.state = "scheduled";
			work.notBeforeMs = recordWithWorkId.notBeforeMs;
			work.deadlineMs = recordWithWorkId.deadlineMs;
			break;
		case "retry-scheduled":
			work.state =
				recordWithWorkId.retryAtMs <= recordWithWorkId.recordedAtMs ? "ready" : "retry-wait";
			work.retryAtMs = recordWithWorkId.retryAtMs;
			work.notBeforeMs = undefined;
			break;
		case "work-claimed":
			work.state = "leased";
			work.leaseId = recordWithWorkId.leaseId;
			work.attempt = recordWithWorkId.attempt;
			work.workerId = recordWithWorkId.workerId;
			work.leaseExpiresAtMs = recordWithWorkId.leaseExpiresAtMs;
			break;
		case "lease-renewed":
			work.state = "leased";
			work.leaseId = recordWithWorkId.leaseId;
			work.attempt = recordWithWorkId.attempt;
			work.workerId = recordWithWorkId.workerId;
			work.leaseExpiresAtMs = recordWithWorkId.leaseExpiresAtMs;
			break;
		case "work-released":
		case "lease-expired":
			work.state = "ready";
			clearHandoffLease(work);
			break;
		case "work-completed":
			work.state = "completed";
			clearHandoffLease(work);
			break;
		case "work-canceled":
			work.state = "canceled";
			clearHandoffLease(work);
			break;
		case "work-dead-lettered":
			work.state = "dead-lettered";
			clearHandoffLease(work);
			break;
	}
}

function ensureHandoffWorkState(
	state: WorkQueueReadinessHandoffProjectorState,
	record: WorkQueueRecordWithWorkId,
): WorkQueueReadinessWorkState {
	const key = handoffWorkKey(record.queueId, record.workId);
	const existing = state.worksById.get(key);
	if (existing !== undefined) return existing;
	const next: WorkQueueReadinessWorkState = {
		queueId: record.queueId,
		workId: record.workId,
		state: "ready",
		latestRecordSeq: record.recordSeq,
	};
	state.worksById.set(key, next);
	return next;
}

function handoffWorkKey(queueId: string, workId: string): string {
	return stableJsonStringify([queueId, workId]);
}

function clearHandoffLease(work: WorkQueueReadinessWorkState): void {
	work.leaseId = undefined;
	work.attempt = undefined;
	work.workerId = undefined;
	work.leaseExpiresAtMs = undefined;
}

function evaluateReadyHandoffs(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
): void {
	for (const ready of state.readyByScheduleId.values()) {
		const origin = state.originsByScheduleId.get(ready.scheduleId);
		if (origin === undefined) {
			emitHandoffStatus(
				ctx,
				state,
				handoffStatus("pending-origin", {
					scheduleId: ready.scheduleId,
					readyAtMs: ready.readyAtMs,
					nowMs: ready.nowMs,
					sourceRefs: ready.sourceRefs,
				}),
			);
			continue;
		}
		const work = state.worksById.get(handoffWorkKey(origin.record.queueId, origin.record.workId));
		if (work === undefined) {
			emitHandoffStatus(
				ctx,
				state,
				handoffStatus("pending-origin", {
					queueId: origin.record.queueId,
					workId: origin.record.workId,
					scheduleId: ready.scheduleId,
					readyAtMs: ready.readyAtMs,
					nowMs: ready.nowMs,
					sourceRefs: ready.sourceRefs,
				}),
			);
			continue;
		}
		if (origin.record.recordSeq < work.latestRecordSeq) {
			emitSuperseded(ctx, state, origin, work, ready, {
				latestRecordSeq: work.latestRecordSeq,
			});
			continue;
		}
		const terminal = terminalHandoffState(work.state);
		if (terminal) {
			emitHandoffStatus(
				ctx,
				state,
				handoffStatus("ignored-terminal", {
					queueId: work.queueId,
					workId: work.workId,
					scheduleId: ready.scheduleId,
					readyAtMs: ready.readyAtMs,
					nowMs: ready.nowMs,
					currentState: work.state,
					sourceRefs: ready.sourceRefs,
				}),
			);
			continue;
		}
		if (origin.scheduleKind === "lease-expiration") {
			evaluateLeaseExpirationReady(ctx, state, origin, work, ready);
			continue;
		}
		evaluateClaimEligibilityReady(ctx, state, origin, work, ready);
	}
}

function evaluateClaimEligibilityReady(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	origin: WorkQueueReadinessOrigin,
	work: WorkQueueReadinessWorkState,
	ready: ScheduledReadinessReady,
): void {
	if (work.state === "leased") {
		emitHandoffStatus(
			ctx,
			state,
			handoffStatus("ignored-stale", {
				queueId: work.queueId,
				workId: work.workId,
				scheduleId: ready.scheduleId,
				readyAtMs: ready.readyAtMs,
				nowMs: ready.nowMs,
				currentState: work.state,
				sourceRefs: ready.sourceRefs,
			}),
		);
		return;
	}
	if (work.notBeforeMs !== undefined && work.notBeforeMs > ready.nowMs) {
		emitSuperseded(ctx, state, origin, work, ready, { notBeforeMs: work.notBeforeMs });
		return;
	}
	if (work.retryAtMs !== undefined && work.retryAtMs > ready.nowMs) {
		emitSuperseded(ctx, state, origin, work, ready, { retryAtMs: work.retryAtMs });
		return;
	}
	emitCandidate(ctx, state, candidateFor(origin, ready, "claim-eligible"));
}

function evaluateLeaseExpirationReady(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	origin: WorkQueueReadinessOrigin,
	work: WorkQueueReadinessWorkState,
	ready: ScheduledReadinessReady,
): void {
	if (origin.record.kind !== "work-claimed" && origin.record.kind !== "lease-renewed") {
		emitHandoffIssue(
			ctx,
			state,
			dataIssue(
				"work-queue-readiness-handoff-malformed-origin",
				"Lease-expiration readiness must originate from a lease-bearing workQueue record.",
				{ subjectId: ready.scheduleId, refs: ready.sourceRefs },
			),
		);
		return;
	}
	if (
		work.state !== "leased" ||
		work.leaseId !== origin.record.leaseId ||
		work.attempt !== origin.record.attempt ||
		work.workerId !== origin.record.workerId
	) {
		emitHandoffStatus(
			ctx,
			state,
			handoffStatus("ignored-stale", {
				queueId: work.queueId,
				workId: work.workId,
				scheduleId: ready.scheduleId,
				readyAtMs: ready.readyAtMs,
				nowMs: ready.nowMs,
				currentState: work.state,
				sourceRefs: ready.sourceRefs,
			}),
		);
		return;
	}
	if (work.leaseExpiresAtMs !== origin.record.leaseExpiresAtMs) {
		emitSuperseded(ctx, state, origin, work, ready, {
			leaseExpiresAtMs: work.leaseExpiresAtMs,
		});
		return;
	}
	if (work.leaseExpiresAtMs !== undefined && work.leaseExpiresAtMs > ready.nowMs) {
		emitSuperseded(ctx, state, origin, work, ready, {
			leaseExpiresAtMs: work.leaseExpiresAtMs,
		});
		return;
	}
	emitCandidate(ctx, state, candidateFor(origin, ready, "lease-expiration-eligible"));
}

function emitSuperseded(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	origin: WorkQueueReadinessOrigin,
	work: WorkQueueReadinessWorkState,
	ready: ScheduledReadinessReady,
	metadata: Record<string, unknown>,
): void {
	emitHandoffStatus(
		ctx,
		state,
		handoffStatus("ignored-superseded", {
			queueId: work.queueId,
			workId: work.workId,
			scheduleId: ready.scheduleId,
			readyAtMs: ready.readyAtMs,
			nowMs: ready.nowMs,
			currentState: work.state,
			sourceRefs: ready.sourceRefs,
			metadata: {
				originRecordSeq: origin.record.recordSeq,
				originRecordKind: origin.record.kind,
				...metadata,
			},
		}),
	);
}

function candidateFor(
	origin: WorkQueueReadinessOrigin,
	ready: ScheduledReadinessReady,
	candidateKind: WorkQueueReadinessCandidateKind,
): WorkQueueReadinessCandidate {
	const lease =
		origin.record.kind === "work-claimed" || origin.record.kind === "lease-renewed"
			? {
					leaseId: origin.record.leaseId,
					attempt: origin.record.attempt,
					workerId: origin.record.workerId,
					leaseExpiresAtMs: origin.record.leaseExpiresAtMs,
				}
			: {};
	const metadata = sanitizeGraphVisibleRecord({
		originRecordSeq: origin.record.recordSeq,
		originRecordKind: origin.record.kind,
		scheduleKind: origin.scheduleKind,
	});
	return Object.freeze({
		kind: "work-queue-readiness-candidate",
		candidateId: compoundTupleKey("work-queue-readiness-candidate", [
			ready.scheduleId,
			candidateKind,
		]),
		candidateKind,
		queueId: origin.record.queueId,
		workId: origin.record.workId,
		scheduleId: ready.scheduleId,
		readyAtMs: ready.readyAtMs,
		nowMs: ready.nowMs,
		originRecordSeq: origin.record.recordSeq,
		originRecordKind: origin.record.kind,
		...lease,
		sourceRefs: canonicalPublicSourceRefs(
			uniqueSourceRefs([
				...(ready.sourceRefs ?? []),
				ref("work-queue-record", String(origin.record.recordSeq)),
				ref("scheduled-readiness-ready", ready.scheduleId),
			]),
		),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies WorkQueueReadinessCandidate);
}

function emitCandidate(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	candidate: WorkQueueReadinessCandidate,
): void {
	const key = `candidate:${candidate.candidateId}`;
	if (!state.emittedKeys.has(key)) {
		state.emittedKeys.add(key);
		state.candidatesById.set(candidate.candidateId, candidate);
		ctx.down([["DATA", { kind: "candidate", candidate }]]);
		emitHandoffAudit(ctx, state, "work-queue-readiness-candidate", {
			subjectId: candidate.candidateId,
			sourceRefs: candidate.sourceRefs,
			metadata: {
				candidateKind: candidate.candidateKind,
				queueId: candidate.queueId,
				workId: candidate.workId,
				readyAtMs: candidate.readyAtMs,
				nowMs: candidate.nowMs,
			},
		});
	} else {
		state.candidatesById.set(candidate.candidateId, candidate);
	}
	emitHandoffStatus(
		ctx,
		state,
		handoffStatus("candidate", {
			queueId: candidate.queueId,
			workId: candidate.workId,
			scheduleId: candidate.scheduleId,
			candidateId: candidate.candidateId,
			candidateKind: candidate.candidateKind,
			readyAtMs: candidate.readyAtMs,
			nowMs: candidate.nowMs,
			sourceRefs: candidate.sourceRefs,
		}),
	);
}

function emitOverdueHandoffStatus(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	overdue: ScheduledReadinessOverdue,
): void {
	const origin = state.originsByScheduleId.get(overdue.scheduleId);
	emitHandoffStatus(
		ctx,
		state,
		handoffStatus("overdue", {
			queueId: origin?.record.queueId,
			workId: origin?.record.workId,
			scheduleId: overdue.scheduleId,
			readyAtMs: overdue.readyAtMs,
			nowMs: overdue.nowMs,
			sourceRefs: overdue.sourceRefs,
			metadata: {
				deadlineMs: overdue.deadlineMs,
				...(origin === undefined
					? {}
					: { originRecordSeq: origin.record.recordSeq, originRecordKind: origin.record.kind }),
			},
		}),
	);
}

function handoffStatus(
	state: WorkQueueReadinessHandoffStatusState,
	opts: {
		readonly queueId?: string;
		readonly workId?: string;
		readonly scheduleId?: string;
		readonly candidateId?: string;
		readonly candidateKind?: WorkQueueReadinessCandidateKind;
		readonly readyAtMs?: number;
		readonly nowMs?: number;
		readonly currentState?: WorkQueueDerivedState;
		readonly sourceRefs?: readonly SourceRef[];
		readonly issueCodes?: readonly string[];
		readonly metadata?: Record<string, unknown>;
	},
): WorkQueueReadinessHandoffStatus {
	const subject = opts.candidateId ?? opts.scheduleId ?? "unknown-work-queue-readiness";
	const metadata = sanitizeGraphVisibleRecord(opts.metadata);
	return Object.freeze({
		kind: "work-queue-readiness-handoff-status",
		statusId: compoundTupleKey("work-queue-readiness-handoff-status", [subject, state]),
		state,
		...(opts.queueId === undefined ? {} : { queueId: opts.queueId }),
		...(opts.workId === undefined ? {} : { workId: opts.workId }),
		...(opts.scheduleId === undefined ? {} : { scheduleId: opts.scheduleId }),
		...(opts.candidateId === undefined ? {} : { candidateId: opts.candidateId }),
		...(opts.candidateKind === undefined ? {} : { candidateKind: opts.candidateKind }),
		...(opts.readyAtMs === undefined ? {} : { readyAtMs: opts.readyAtMs }),
		...(opts.nowMs === undefined ? {} : { nowMs: opts.nowMs }),
		...(opts.currentState === undefined ? {} : { currentState: opts.currentState }),
		...(opts.sourceRefs === undefined
			? {}
			: { sourceRefs: canonicalPublicSourceRefs(opts.sourceRefs) }),
		...(opts.issueCodes === undefined ? {} : { issueCodes: opts.issueCodes }),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies WorkQueueReadinessHandoffStatus);
}

function emitHandoffStatus(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	status: WorkQueueReadinessHandoffStatus,
): void {
	state.statusById.set(status.statusId, status);
	const key = compoundTupleKey("handoff-status", [status.statusId, stableJsonStringify(status)]);
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "status", status }]]);
}

function emitHandoffIssue(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	issue: DataIssue,
): void {
	const key = canonicalTupleKey([
		issue.code,
		issue.subjectId ?? "",
		JSON.stringify(issue.details ?? {}),
	]);
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	ctx.down([["DATA", { kind: "issue", issue }]]);
	emitHandoffStatus(
		ctx,
		state,
		handoffStatus("issue", {
			scheduleId: issue.subjectId,
			sourceRefs: issue.refs?.map(sourceRefFromIssueRef),
			issueCodes: [issue.code],
		}),
	);
}

function emitHandoffAudit(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueReadinessHandoffFact][]) => void },
	state: WorkQueueReadinessHandoffProjectorState,
	kind: string,
	opts: {
		readonly subjectId: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	},
): void {
	state.auditSeq += 1;
	const metadata = sanitizeGraphVisibleRecord(opts.metadata);
	ctx.down([
		[
			"DATA",
			{
				kind: "audit",
				audit: Object.freeze({
					id: `work-queue-readiness-handoff-audit-${state.auditSeq}`,
					kind,
					subjectId: opts.subjectId,
					...(opts.sourceRefs === undefined
						? {}
						: { sourceRefs: canonicalPublicSourceRefs(opts.sourceRefs) }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRuntimeAuditRecord),
			},
		],
	]);
}

function buildHandoffViews(
	state: WorkQueueReadinessHandoffProjectorState,
): WorkQueueReadinessHandoffViews {
	return Object.freeze({
		candidatesById: new Map(state.candidatesById),
		statusById: new Map(state.statusById),
	});
}

function emitLeaseCommandStatus<T>(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueLeaseExpirationCommandFact<T>][]) => void },
	state: WorkQueueLeaseExpirationCommandProjectorState<T>,
	command: WorkQueueCommand<T>,
	candidate: WorkQueueReadinessCandidate,
): void {
	const status = handoffStatus("candidate", {
		queueId: candidate.queueId,
		workId: candidate.workId,
		scheduleId: candidate.scheduleId,
		candidateId: candidate.candidateId,
		candidateKind: candidate.candidateKind,
		readyAtMs: candidate.readyAtMs,
		nowMs: candidate.nowMs,
		sourceRefs: candidate.sourceRefs,
		metadata: {
			commandId: command.commandId,
			commandKind: command.kind,
		},
	});
	state.statusById.set(status.statusId, status);
	const key = `lease-command-status:${status.statusId}`;
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "status", status }]]);
}

function buildLeaseCommandViews<T>(
	state: WorkQueueLeaseExpirationCommandProjectorState<T>,
): WorkQueueReadinessHandoffViews {
	return Object.freeze({
		candidatesById: new Map(),
		statusById: new Map(state.statusById),
	});
}

function sourceRefStrings(
	sourceRefs: readonly SourceRef[] | undefined,
): readonly string[] | undefined {
	if (sourceRefs === undefined || sourceRefs.length === 0) return undefined;
	return sourceRefs.map((sourceRef) => canonicalTupleKey([sourceRef.kind, sourceRef.id]));
}

function sourceRefFromIssueRef(issueRef: string): SourceRef {
	const tuple = parseCanonicalTupleKey(issueRef);
	if (tuple?.length === 2) return ref(tuple[0]!, tuple[1]!);
	const [kind, ...rest] = issueRef.split(":");
	return ref(kind || "issue-ref", rest.join(":") || issueRef);
}

function terminalHandoffState(state: WorkQueueDerivedState): boolean {
	return state === "completed" || state === "canceled" || state === "dead-lettered";
}

function hasWorkRecordCoordinates(record: Record<string, unknown>): boolean {
	return (
		typeof record.queueId === "string" &&
		typeof record.workId === "string" &&
		typeof record.recordSeq === "number" &&
		Number.isFinite(record.recordSeq)
	);
}

function hasLeaseRecordCoordinates(record: Record<string, unknown>): boolean {
	return (
		hasWorkRecordCoordinates(record) &&
		typeof record.leaseId === "string" &&
		typeof record.attempt === "number" &&
		Number.isFinite(record.attempt) &&
		typeof record.workerId === "string"
	);
}

function malformedRecord(record: Record<string, unknown>, message: string): TranslatedRecord {
	const subjectId =
		typeof record.kind === "string"
			? `work-queue-record:${publicCoordinateId(record.kind)}`
			: "unknown-work-queue-record";
	const issue = dataIssue("work-queue-scheduled-readiness-malformed-record", message, {
		subjectId,
		refs: [],
		details: sanitizeGraphVisibleRecord({
			recordKind: typeof record.kind === "string" ? record.kind : undefined,
			queueId: typeof record.queueId === "string" ? publicCoordinateId(record.queueId) : undefined,
			workId: typeof record.workId === "string" ? publicCoordinateId(record.workId) : undefined,
			recordSeq:
				typeof record.recordSeq === "number" && Number.isFinite(record.recordSeq)
					? record.recordSeq
					: undefined,
		}),
	});
	return {
		kind: "issue",
		issue,
		status: issueStatus(subjectId, [issue]),
	};
}

function translateRecord(raw: unknown): TranslatedRecord {
	if (!isRecord(raw)) {
		const issue = dataIssue(
			"work-queue-scheduled-readiness-malformed-record",
			"WorkQueue scheduled readiness requires a graph-visible workQueue record.",
			{ subjectId: "unknown-work-queue-record", refs: [] },
		);
		return {
			kind: "issue",
			issue,
			status: issueStatus("unknown-work-queue-record", [issue]),
		};
	}
	const unknownRecord: unknown = raw;
	const rawRecord = unknownRecord as Record<string, unknown>;
	switch (rawRecord.kind) {
		case "work-admitted": {
			const notBeforeMs = rawRecord.notBeforeMs;
			if (notBeforeMs === undefined) return { kind: "none" };
			if (typeof notBeforeMs !== "number") {
				return malformedRecord(rawRecord, "Delayed work-admitted notBeforeMs must be a number.");
			}
			if (!hasWorkRecordCoordinates(rawRecord)) {
				return malformedRecord(
					rawRecord,
					"Delayed work-admitted records require queueId, workId, and recordSeq.",
				);
			}
			const admitted = rawRecord as unknown as Extract<
				WorkQueueRecord<unknown>,
				{ readonly kind: "work-admitted" }
			>;
			return scheduleFromRecord(admitted, {
				scheduleKind: "work-admitted",
				scheduleId: workQueueScheduleId(admitted, "admission", admitted.recordSeq),
				readyAtMs: notBeforeMs,
				deadlineMs: admitted.deadlineMs,
				reason: "work-queue-delayed-admission",
			});
		}
		case "work-scheduled": {
			if (!hasWorkRecordCoordinates(rawRecord)) {
				return malformedRecord(
					rawRecord,
					"work-scheduled records require queueId, workId, and recordSeq.",
				);
			}
			const scheduled = rawRecord as unknown as Extract<
				WorkQueueRecord<unknown>,
				{ readonly kind: "work-scheduled" }
			>;
			return scheduleFromRecord(scheduled, {
				scheduleKind: "work-scheduled",
				scheduleId: workQueueScheduleId(
					scheduled,
					"schedule",
					scheduled.scheduleId ?? scheduled.commandId ?? scheduled.recordSeq,
				),
				readyAtMs: scheduled.notBeforeMs,
				deadlineMs: scheduled.deadlineMs,
				reason: scheduled.reason ?? "work-queue-schedule",
			});
		}
		case "retry-scheduled": {
			if (!hasWorkRecordCoordinates(rawRecord)) {
				return malformedRecord(
					rawRecord,
					"retry-scheduled records require queueId, workId, and recordSeq.",
				);
			}
			const retry = rawRecord as unknown as Extract<
				WorkQueueRecord<unknown>,
				{ readonly kind: "retry-scheduled" }
			>;
			return scheduleFromRecord(retry, {
				scheduleKind: "retry-scheduled",
				scheduleId: workQueueScheduleId(retry, "retry", retry.commandId ?? retry.recordSeq),
				readyAtMs: retry.retryAtMs,
				reason: retry.reason ?? "work-queue-retry",
				metadata: { delayMs: retry.delayMs },
			});
		}
		case "work-claimed": {
			if (!hasLeaseRecordCoordinates(rawRecord)) {
				return malformedRecord(
					rawRecord,
					"work-claimed records require queueId, workId, recordSeq, leaseId, attempt, and workerId.",
				);
			}
			const claimed = rawRecord as unknown as Extract<
				WorkQueueRecord<unknown>,
				{ readonly kind: "work-claimed" }
			>;
			return scheduleFromRecord(claimed, {
				scheduleKind: "lease-expiration",
				scheduleId: workQueueLeaseScheduleId(claimed),
				readyAtMs: claimed.leaseExpiresAtMs,
				reason: "work-queue-lease-expiration",
				leaseId: claimed.leaseId,
				metadata: { attempt: claimed.attempt },
			});
		}
		case "lease-renewed": {
			if (!hasLeaseRecordCoordinates(rawRecord)) {
				return malformedRecord(
					rawRecord,
					"lease-renewed records require queueId, workId, recordSeq, leaseId, attempt, and workerId.",
				);
			}
			const renewed = rawRecord as unknown as Extract<
				WorkQueueRecord<unknown>,
				{ readonly kind: "lease-renewed" }
			>;
			return scheduleFromRecord(renewed, {
				scheduleKind: "lease-expiration",
				scheduleId: workQueueLeaseScheduleId(renewed),
				readyAtMs: renewed.leaseExpiresAtMs,
				reason: "work-queue-lease-expiration",
				leaseId: renewed.leaseId,
				metadata: {
					attempt: renewed.attempt,
					previousLeaseExpiresAtMs: renewed.previousLeaseExpiresAtMs,
				},
			});
		}
		default:
			return { kind: "none" };
	}
}

function scheduleFromRecord(
	record: WorkQueueRecordWithWorkId,
	opts: {
		readonly scheduleKind: WorkQueueScheduledReadinessScheduleKind;
		readonly scheduleId: string;
		readonly readyAtMs: number;
		readonly deadlineMs?: number;
		readonly reason: string;
		readonly leaseId?: string;
		readonly metadata?: Record<string, unknown>;
	},
): TranslatedRecord {
	if (!Number.isFinite(opts.readyAtMs) || !finiteOrUndefined(opts.deadlineMs)) {
		const refs = recordSourceRefs(record, opts.leaseId);
		const issue = dataIssue(
			"work-queue-scheduled-readiness-malformed-record",
			"WorkQueue delayed eligibility record must carry finite readiness and deadline coordinates.",
			{
				subjectId: workQueueRecordSubjectId(record),
				refs,
				details: {
					recordKind: record.kind,
					readyAtMs: opts.readyAtMs,
					deadlineMs: opts.deadlineMs,
				},
			},
		);
		return {
			kind: "issue",
			issue,
			status: issueStatus(opts.scheduleId, [issue], record, refs),
		};
	}
	const subjectRefs = recordSubjectRefs(record, opts.leaseId);
	const sourceRefs = recordSourceRefs(record, opts.leaseId);
	const recordPolicyRefs = policyRefs(record);
	const metadata = sanitizeGraphVisibleRecord({
		queueId: publicCoordinateId(record.queueId),
		workId: publicCoordinateId(record.workId),
		recordSeq: record.recordSeq,
		recordKind: record.kind,
		scheduleKind: opts.scheduleKind,
		...(record.commandId === undefined ? {} : { commandId: publicCoordinateId(record.commandId) }),
		...(opts.leaseId === undefined ? {} : { leaseId: publicCoordinateId(opts.leaseId) }),
		...(opts.metadata ?? {}),
	});
	const schedule = Object.freeze({
		kind: "scheduled-readiness-requested",
		scheduleId: opts.scheduleId,
		subjectRefs,
		readyAtMs: opts.readyAtMs,
		...(opts.deadlineMs === undefined ? {} : { deadlineMs: opts.deadlineMs }),
		reason: opts.reason,
		...(recordPolicyRefs === undefined ? {} : { policyRefs: recordPolicyRefs }),
		sourceRefs,
		...(metadata === undefined ? {} : { metadata }),
	} satisfies ScheduledReadinessRequested);
	return {
		kind: "translated",
		record,
		schedule,
		status: Object.freeze({
			kind: "work-queue-scheduled-readiness-status",
			statusId: compoundTupleKey("work-queue-scheduled-readiness-status", [
				opts.scheduleId,
				"translated",
			]),
			queueId: publicCoordinateId(record.queueId),
			workId: publicCoordinateId(record.workId),
			recordSeq: record.recordSeq,
			state: "translated",
			scheduleKind: opts.scheduleKind,
			scheduleId: opts.scheduleId,
			readyAtMs: opts.readyAtMs,
			...(opts.deadlineMs === undefined ? {} : { deadlineMs: opts.deadlineMs }),
			sourceRefs,
			...(metadata === undefined ? {} : { metadata }),
		} satisfies WorkQueueScheduledReadinessStatus),
	};
}

function recordSubjectRefs<T>(
	record: WorkQueueRecord<T> & { readonly workId: string },
	leaseId?: string,
): readonly SourceRef[] {
	return canonicalPublicSourceRefs(
		uniqueSourceRefs([
			ref("work-queue", publicCoordinateId(record.queueId)),
			ref("work-queue-work", publicCoordinateId(record.workId)),
			ref("work-queue-record", String(record.recordSeq)),
			...(record.commandId === undefined
				? []
				: [ref("work-queue-command", publicCoordinateId(record.commandId))]),
			...(leaseId === undefined ? [] : [ref("work-queue-lease", publicCoordinateId(leaseId))]),
		]),
	);
}

function recordSourceRefs<T>(
	record: WorkQueueRecord<T> & { readonly workId?: string },
	leaseId?: string,
): readonly SourceRef[] {
	return canonicalPublicSourceRefs(
		uniqueSourceRefs([
			ref("work-queue", publicCoordinateId(record.queueId)),
			ref("work-queue-record", String(record.recordSeq)),
			...(record.workId === undefined
				? []
				: [ref("work-queue-work", publicCoordinateId(record.workId))]),
			...(record.commandId === undefined
				? []
				: [ref("work-queue-command", publicCoordinateId(record.commandId))]),
			...(leaseId === undefined ? [] : [ref("work-queue-lease", publicCoordinateId(leaseId))]),
			...copiedPublicRefs(record.sourceRefs, "work-queue-source-ref"),
		]),
	);
}

function policyRefs<T>(record: WorkQueueRecord<T>): readonly SourceRef[] | undefined {
	if (record.policyRefs === undefined || record.policyRefs.length === 0) return undefined;
	return canonicalPublicSourceRefs(copiedPublicRefs(record.policyRefs, "work-queue-policy-ref"));
}

function workQueueScheduleId<T>(
	record: WorkQueueRecord<T> & { readonly workId: string },
	part: "admission" | "retry" | "schedule",
	id: string | number,
): string {
	return compoundTupleKey("workQueue", [
		publicCoordinateId(record.queueId),
		publicCoordinateId(record.workId),
		part,
		publicCoordinateId(String(id)),
	]);
}

function workQueueLeaseScheduleId<T>(
	record: WorkQueueRecord<T> & {
		readonly workId: string;
		readonly leaseId: string;
		readonly recordSeq: number;
	},
): string {
	return compoundTupleKey("workQueue", [
		publicCoordinateId(record.queueId),
		publicCoordinateId(record.workId),
		"lease",
		publicCoordinateId(record.leaseId),
		"expires",
		String(record.recordSeq),
	]);
}

function workQueueRecordSubjectId<T>(
	record: WorkQueueRecord<T> & { readonly workId: string },
): string {
	return canonicalTupleKey([
		publicCoordinateId(record.queueId),
		publicCoordinateId(record.workId),
		String(record.recordSeq),
	]);
}

function copiedPublicRefs(ids: readonly string[] | undefined, kind: string): readonly SourceRef[] {
	if (ids === undefined || ids.length === 0) return [];
	const copied = ids
		.slice(0, MAX_COPIED_PUBLIC_REFS)
		.map((id) => ref(kind, publicCoordinateId(id)));
	if (ids.length <= MAX_COPIED_PUBLIC_REFS) return copied;
	return [
		...copied,
		ref(
			`${kind}-overflow`,
			compoundTupleKey("count", [
				String(ids.length),
				"hash",
				stableStringHash(stableJsonStringify(ids)),
			]),
		),
	];
}

function publicCoordinateId(id: string): string {
	if (id.length <= MAX_PUBLIC_COORDINATE_ID_CHARS && !PRIVATE_COORDINATE_PATTERN.test(id)) {
		return id;
	}
	return compoundTupleKey("bounded", [stableStringHash(id), String(id.length)]);
}

function issueStatus<T>(
	statusId: string,
	issues: readonly DataIssue[],
	record?: WorkQueueRecord<T>,
	sourceRefs?: readonly SourceRef[],
): WorkQueueScheduledReadinessStatus {
	return Object.freeze({
		kind: "work-queue-scheduled-readiness-status",
		statusId: compoundTupleKey("work-queue-scheduled-readiness-status", [statusId, "issue"]),
		...(record?.queueId === undefined ? {} : { queueId: publicCoordinateId(record.queueId) }),
		...(record?.workId === undefined ? {} : { workId: publicCoordinateId(record.workId) }),
		...(record?.recordSeq === undefined ? {} : { recordSeq: record.recordSeq }),
		state: "issue",
		...(sourceRefs === undefined ? {} : { sourceRefs }),
		issueCodes: issues.map((issue) => issue.code),
	} satisfies WorkQueueScheduledReadinessStatus);
}

function finiteOrUndefined(value: number | undefined): boolean {
	return value === undefined || Number.isFinite(value);
}

function scheduleIdentity(schedule: ScheduledReadinessRequested): string {
	return stableJsonStringify({
		scheduleId: schedule.scheduleId,
		subjectRefs: schedule.subjectRefs,
		readyAtMs: schedule.readyAtMs,
		deadlineMs: schedule.deadlineMs,
		reason: schedule.reason,
		policyRefs: schedule.policyRefs,
		sourceRefs: schedule.sourceRefs,
		metadata: schedule.metadata,
	});
}

function emitScheduleConflict(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueScheduledReadinessFact][]) => void },
	state: WorkQueueScheduledReadinessProjectorState,
	translated: Extract<TranslatedRecord, { readonly kind: "translated" }>,
	existing?: ScheduledReadinessRequested,
): void {
	const issue = dataIssue(
		"work-queue-scheduled-readiness-schedule-conflict",
		"WorkQueue delayed eligibility replayed with conflicting scheduled-readiness material; the first schedule was retained.",
		{
			subjectId: translated.schedule.scheduleId,
			refs: translated.schedule.sourceRefs,
			details: {
				existingReadyAtMs: existing?.readyAtMs,
				incomingReadyAtMs: translated.schedule.readyAtMs,
				existingDeadlineMs: existing?.deadlineMs,
				incomingDeadlineMs: translated.schedule.deadlineMs,
				recordSeq: translated.record.recordSeq,
				recordKind: translated.record.kind,
			},
		},
	);
	emitIssue(ctx, state, issue);
	emitStatus(
		ctx,
		state,
		issueStatus(
			compoundTupleKey("conflict", [
				translated.schedule.scheduleId,
				String(translated.record.recordSeq),
			]),
			[issue],
			translated.record,
			translated.schedule.sourceRefs,
		),
	);
}

function emitSchedule(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueScheduledReadinessFact][]) => void },
	state: WorkQueueScheduledReadinessProjectorState,
	schedule: ScheduledReadinessRequested,
): void {
	const key = compoundTupleKey("schedule", [schedule.scheduleId]);
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "readiness-schedule", schedule }]]);
}

function emitStatus(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueScheduledReadinessFact][]) => void },
	state: WorkQueueScheduledReadinessProjectorState,
	status: WorkQueueScheduledReadinessStatus,
): void {
	state.statusById.set(status.statusId, status);
	const key = compoundTupleKey("status", [status.statusId, ...(status.issueCodes ?? [])]);
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "status", status }]]);
}

function emitIssue(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueScheduledReadinessFact][]) => void },
	state: WorkQueueScheduledReadinessProjectorState,
	issue: DataIssue,
): void {
	const key = canonicalTupleKey([
		issue.code,
		issue.subjectId ?? "",
		JSON.stringify(issue.details ?? {}),
	]);
	if (state.issueKeys.has(key)) return;
	state.issueKeys.add(key);
	ctx.down([["DATA", { kind: "issue", issue }]]);
}

function emitAudit(
	ctx: { down: (msgs: readonly ["DATA", WorkQueueScheduledReadinessFact][]) => void },
	state: WorkQueueScheduledReadinessProjectorState,
	kind: string,
	opts: {
		readonly subjectId: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	},
): void {
	state.auditSeq += 1;
	const metadata = sanitizeGraphVisibleRecord(opts.metadata);
	ctx.down([
		[
			"DATA",
			{
				kind: "audit",
				audit: Object.freeze({
					id: `work-queue-scheduled-readiness-audit-${state.auditSeq}`,
					kind,
					subjectId: opts.subjectId,
					...(opts.sourceRefs === undefined
						? {}
						: { sourceRefs: canonicalPublicSourceRefs(opts.sourceRefs) }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRuntimeAuditRecord),
			},
		],
	]);
}

function buildViews(
	state: WorkQueueScheduledReadinessProjectorState,
): WorkQueueScheduledReadinessViews {
	return Object.freeze({
		schedulesById: new Map(state.schedulesById),
		statusById: new Map(state.statusById),
	});
}
