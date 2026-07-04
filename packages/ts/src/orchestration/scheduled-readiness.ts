import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	canonicalPublicSourceRefs,
	dataIssue,
	forEachDepBatch,
	projectRuntimeFact,
	ref,
	sanitizeGraphVisibleRecord,
	stableJsonStringify,
	uniqueSourceRefs,
} from "./agent-runtime-common.js";
import type { AgentRuntimeAuditRecord } from "./agent-runtime-types-agent.js";
import type { SourceRef } from "./agent-runtime-types-core.js";

export interface ScheduledReadinessRequested {
	readonly kind: "scheduled-readiness-requested";
	readonly scheduleId: string;
	readonly subjectRefs: readonly SourceRef[];
	readonly readyAtMs: number;
	readonly deadlineMs?: number;
	readonly reason?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ScheduledReadinessClock {
	readonly kind: "scheduled-readiness-clock";
	readonly clockId: string;
	readonly nowMs: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ScheduledReadinessPending {
	readonly kind: "scheduled-readiness-pending";
	readonly scheduleId: string;
	readonly subjectRefs: readonly SourceRef[];
	readonly readyAtMs: number;
	readonly deadlineMs?: number;
	readonly nowMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ScheduledReadinessReady {
	readonly kind: "scheduled-readiness-ready";
	readonly scheduleId: string;
	readonly subjectRefs: readonly SourceRef[];
	readonly readyAtMs: number;
	readonly deadlineMs?: number;
	readonly nowMs: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export interface ScheduledReadinessOverdue {
	readonly kind: "scheduled-readiness-overdue";
	readonly scheduleId: string;
	readonly subjectRefs: readonly SourceRef[];
	readonly readyAtMs: number;
	readonly deadlineMs: number;
	readonly nowMs: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly metadata?: Record<string, unknown>;
}

export type ScheduledReadinessStatusState = "pending" | "ready" | "overdue" | "issue";

export interface ScheduledReadinessStatus {
	readonly kind: "scheduled-readiness-status";
	readonly statusId: string;
	readonly scheduleId: string;
	readonly state: ScheduledReadinessStatusState;
	readonly subjectRefs?: readonly SourceRef[];
	readonly readyAtMs?: number;
	readonly deadlineMs?: number;
	readonly nowMs?: number;
	readonly sourceRefs?: readonly SourceRef[];
	readonly issueCodes?: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

export interface ScheduledReadinessViews {
	readonly schedulesById: ReadonlyMap<string, ScheduledReadinessRequested>;
	readonly pendingById: ReadonlyMap<string, ScheduledReadinessPending>;
	readonly readyById: ReadonlyMap<string, ScheduledReadinessReady>;
	readonly overdueById: ReadonlyMap<string, ScheduledReadinessOverdue>;
	readonly statusById: ReadonlyMap<string, ScheduledReadinessStatus>;
	readonly nowMs?: number;
}

export interface ScheduledReadinessBundle {
	readonly pending: Node<ScheduledReadinessPending>;
	readonly ready: Node<ScheduledReadinessReady>;
	readonly overdue: Node<ScheduledReadinessOverdue>;
	readonly status: Node<ScheduledReadinessStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly views: Node<ScheduledReadinessViews>;
}

/**
 * Creates a scheduled readiness projector.
 *
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A node bundle that emits the projected records.
 * @category orchestration
 * @example
 * ```ts
 * import { scheduledReadinessProjector } from "@graphrefly/ts/orchestration";
 * ```
 */
export function scheduledReadinessProjector(
	graph: Graph,
	opts: {
		readonly name?: string;
		readonly schedules: readonly Node<ScheduledReadinessRequested>[];
		readonly clocks?: readonly Node<ScheduledReadinessClock>[];
	},
): ScheduledReadinessBundle {
	const name = opts.name ?? "scheduledReadiness";
	const clockDeps = opts.clocks ?? [];
	const runtime = graph.node<ScheduledReadinessFact>(
		[...opts.schedules, ...clockDeps],
		(ctx) => {
			const state = ctx.state.get<ScheduledReadinessProjectorState>() ?? initialState();
			forEachDepBatch(ctx, 0, opts.schedules.length, (raw) => {
				const retained = sanitizeSchedule(raw);
				if (retained.ok) {
					const existing = state.schedules.get(retained.schedule.scheduleId);
					if (existing === undefined) {
						state.schedules.set(retained.schedule.scheduleId, retained.schedule);
					} else if (scheduleIdentity(existing) !== scheduleIdentity(retained.schedule)) {
						const issue = dataIssue(
							"scheduled-readiness-schedule-conflict",
							"Scheduled readiness scheduleId was replayed with conflicting schedule material; the first valid schedule was retained.",
							{
								subjectId: retained.schedule.scheduleId,
								refs: scheduleSourceRefs(retained.schedule, state.clockSourceRefs),
								details: {
									existingReadyAtMs: readinessMs(existing),
									incomingReadyAtMs: readinessMs(retained.schedule),
									existingDeadlineMs: existing.deadlineMs,
									incomingDeadlineMs: retained.schedule.deadlineMs,
								},
							},
						);
						emitIssue(ctx, state, issue);
						emitStatus(ctx, state, {
							kind: "scheduled-readiness-status",
							statusId: compoundTupleKey("scheduled-readiness-status", [
								retained.schedule.scheduleId,
								"issue",
							]),
							scheduleId: retained.schedule.scheduleId,
							state: "issue",
							subjectRefs: scheduleSubjectRefs(existing),
							readyAtMs: readinessMs(existing),
							...(existing.deadlineMs === undefined ? {} : { deadlineMs: existing.deadlineMs }),
							nowMs: state.nowMs,
							sourceRefs: scheduleSourceRefs(existing, state.clockSourceRefs),
							issueCodes: [issue.code],
						});
					}
				} else {
					emitIssue(ctx, state, retained.issue);
					emitStatus(ctx, state, {
						kind: "scheduled-readiness-status",
						statusId: compoundTupleKey("scheduled-readiness-status", [
							retained.scheduleId,
							"issue",
						]),
						scheduleId: retained.scheduleId,
						state: "issue",
						sourceRefs: retained.sourceRefs,
						issueCodes: [retained.issue.code],
					});
				}
			});
			forEachDepBatch(ctx, opts.schedules.length, clockDeps.length, (raw) => {
				const clock = sanitizeClock(raw);
				if (clock.ok) {
					if (state.nowMs !== undefined && clock.clock.nowMs < state.nowMs) {
						emitIssue(
							ctx,
							state,
							dataIssue(
								"scheduled-readiness-clock-rollback",
								"Scheduled readiness clock facts must be monotonic; rollback was ignored.",
								{
									subjectId: clock.clock.clockId,
									refs: clock.clock.sourceRefs,
									severity: "warning",
									details: { nowMs: clock.clock.nowMs, previousNowMs: state.nowMs },
								},
							),
						);
						return;
					}
					state.nowMs = clock.clock.nowMs;
					state.clockSourceRefs = clock.clock.sourceRefs;
				} else {
					emitIssue(ctx, state, clock.issue);
				}
			});
			evaluateSchedules(ctx, state);
			ctx.down([["DATA", { kind: "views", views: buildViews(state) }]]);
			ctx.state.set(state);
		},
		{ name: `${name}/runtime`, factory: "scheduledReadinessProjector", partial: true },
	);
	return {
		pending: projectRuntimeFact(
			graph,
			runtime,
			`${name}/pending`,
			"scheduledReadinessPending",
			(fact) => (fact.kind === "pending" ? fact.pending : undefined),
		),
		ready: projectRuntimeFact(graph, runtime, `${name}/ready`, "scheduledReadinessReady", (fact) =>
			fact.kind === "ready" ? fact.ready : undefined,
		),
		overdue: projectRuntimeFact(
			graph,
			runtime,
			`${name}/overdue`,
			"scheduledReadinessOverdue",
			(fact) => (fact.kind === "overdue" ? fact.overdue : undefined),
		),
		status: projectRuntimeFact(
			graph,
			runtime,
			`${name}/status`,
			"scheduledReadinessStatus",
			(fact) => (fact.kind === "status" ? fact.status : undefined),
		),
		issues: projectRuntimeFact(
			graph,
			runtime,
			`${name}/issues`,
			"scheduledReadinessIssues",
			(fact) => (fact.kind === "issue" ? fact.issue : undefined),
		),
		audit: projectRuntimeFact(graph, runtime, `${name}/audit`, "scheduledReadinessAudit", (fact) =>
			fact.kind === "audit" ? fact.audit : undefined,
		),
		views: projectRuntimeFact(graph, runtime, `${name}/views`, "scheduledReadinessViews", (fact) =>
			fact.kind === "views" ? fact.views : undefined,
		),
	};
}

type ScheduledReadinessFact =
	| { readonly kind: "pending"; readonly pending: ScheduledReadinessPending }
	| { readonly kind: "ready"; readonly ready: ScheduledReadinessReady }
	| { readonly kind: "overdue"; readonly overdue: ScheduledReadinessOverdue }
	| { readonly kind: "status"; readonly status: ScheduledReadinessStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord }
	| { readonly kind: "views"; readonly views: ScheduledReadinessViews };

interface ScheduledReadinessProjectorState {
	schedules: Map<string, ScheduledReadinessRequested>;
	pendingById: Map<string, ScheduledReadinessPending>;
	readyById: Map<string, ScheduledReadinessReady>;
	overdueById: Map<string, ScheduledReadinessOverdue>;
	statusById: Map<string, ScheduledReadinessStatus>;
	emittedKeys: Set<string>;
	issueKeys: Set<string>;
	auditSeq: number;
	nowMs: number | undefined;
	clockSourceRefs: readonly SourceRef[] | undefined;
}

function initialState(): ScheduledReadinessProjectorState {
	return {
		schedules: new Map(),
		pendingById: new Map(),
		readyById: new Map(),
		overdueById: new Map(),
		statusById: new Map(),
		emittedKeys: new Set(),
		issueKeys: new Set(),
		auditSeq: 0,
		nowMs: undefined,
		clockSourceRefs: undefined,
	};
}

function evaluateSchedules(
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
): void {
	for (const schedule of state.schedules.values()) {
		const readyAtMs = readinessMs(schedule);
		const subjectRefs = scheduleSubjectRefs(schedule);
		const sourceRefs = scheduleSourceRefs(schedule, state.clockSourceRefs);
		const baseMetadata = sanitizeScheduledReadinessMetadata({
			...(schedule.reason === undefined ? {} : { reason: schedule.reason }),
			...(schedule.metadata ?? {}),
		});
		if (state.nowMs === undefined || state.nowMs < readyAtMs) {
			const pending = Object.freeze({
				kind: "scheduled-readiness-pending",
				scheduleId: schedule.scheduleId,
				subjectRefs,
				readyAtMs,
				...(schedule.deadlineMs === undefined ? {} : { deadlineMs: schedule.deadlineMs }),
				...(state.nowMs === undefined ? {} : { nowMs: state.nowMs }),
				sourceRefs,
				...(baseMetadata === undefined ? {} : { metadata: baseMetadata }),
			} satisfies ScheduledReadinessPending);
			emitPending(ctx, state, pending);
			emitStatus(
				ctx,
				state,
				statusFor(schedule, "pending", {
					subjectRefs,
					readyAtMs,
					sourceRefs,
					nowMs: state.nowMs,
				}),
			);
			continue;
		}
		const ready = Object.freeze({
			kind: "scheduled-readiness-ready",
			scheduleId: schedule.scheduleId,
			subjectRefs,
			readyAtMs,
			...(schedule.deadlineMs === undefined ? {} : { deadlineMs: schedule.deadlineMs }),
			nowMs: state.nowMs,
			sourceRefs,
			...(baseMetadata === undefined ? {} : { metadata: baseMetadata }),
		} satisfies ScheduledReadinessReady);
		emitReady(ctx, state, ready);
		emitStatus(
			ctx,
			state,
			statusFor(schedule, "ready", {
				subjectRefs,
				readyAtMs,
				sourceRefs,
				nowMs: state.nowMs,
			}),
		);
		if (schedule.deadlineMs !== undefined && state.nowMs > schedule.deadlineMs) {
			const overdue = Object.freeze({
				kind: "scheduled-readiness-overdue",
				scheduleId: schedule.scheduleId,
				subjectRefs,
				readyAtMs,
				deadlineMs: schedule.deadlineMs,
				nowMs: state.nowMs,
				sourceRefs,
				...(baseMetadata === undefined ? {} : { metadata: baseMetadata }),
			} satisfies ScheduledReadinessOverdue);
			emitOverdue(ctx, state, overdue);
			emitStatus(
				ctx,
				state,
				statusFor(schedule, "overdue", {
					subjectRefs,
					readyAtMs,
					sourceRefs,
					nowMs: state.nowMs,
				}),
			);
		}
	}
}

function sanitizeSchedule(raw: unknown):
	| { readonly ok: true; readonly schedule: ScheduledReadinessRequested }
	| {
			readonly ok: false;
			readonly scheduleId: string;
			readonly issue: DataIssue;
			readonly sourceRefs?: readonly SourceRef[];
	  } {
	if (!isPlainRecord(raw)) {
		return {
			ok: false,
			scheduleId: "unknown-scheduled-readiness",
			sourceRefs: [],
			issue: dataIssue(
				"scheduled-readiness-malformed-schedule",
				"Scheduled readiness requires a stable scheduleId, subjectRefs array, and finite readyAtMs.",
				{ subjectId: "unknown-scheduled-readiness", refs: [] },
			),
		};
	}
	const scheduleId =
		typeof raw.scheduleId === "string" && raw.scheduleId.length > 0
			? raw.scheduleId
			: "unknown-scheduled-readiness";
	const refs = sourceRefArray(raw.sourceRefs);
	const hasDeadlineMs = Object.hasOwn(raw, "deadlineMs");
	const readyAtMs = finiteNumberOrUndefined(raw.readyAtMs);
	const deadlineMs = finiteNumberOrUndefined(raw.deadlineMs);
	if (
		raw.kind !== "scheduled-readiness-requested" ||
		typeof raw.scheduleId !== "string" ||
		raw.scheduleId.length === 0 ||
		readyAtMs === undefined ||
		(hasDeadlineMs && deadlineMs === undefined) ||
		raw.subjectRef !== undefined ||
		!Array.isArray(raw.subjectRefs) ||
		raw.notBeforeMs !== undefined ||
		(raw.policyRefs !== undefined && !Array.isArray(raw.policyRefs)) ||
		(raw.sourceRefs !== undefined && !Array.isArray(raw.sourceRefs))
	) {
		return {
			ok: false,
			scheduleId,
			sourceRefs: refs,
			issue: dataIssue(
				"scheduled-readiness-malformed-schedule",
				"Scheduled readiness requires a stable scheduleId, subjectRefs array, and finite readyAtMs.",
				{ subjectId: scheduleId, refs },
			),
		};
	}
	const subjectRefs = sourceRefArray(raw.subjectRefs);
	const policyRefs = sourceRefArray(raw.policyRefs);
	const metadata = sanitizeScheduledReadinessMetadata(
		isPlainRecord(raw.metadata) ? raw.metadata : undefined,
	);
	return {
		ok: true,
		schedule: Object.freeze({
			kind: "scheduled-readiness-requested",
			scheduleId: raw.scheduleId,
			subjectRefs,
			readyAtMs,
			...(deadlineMs === undefined ? {} : { deadlineMs }),
			...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
			...(policyRefs.length === 0 ? {} : { policyRefs }),
			sourceRefs: refs,
			...(metadata === undefined ? {} : { metadata }),
		} satisfies ScheduledReadinessRequested),
	};
}

function sanitizeClock(
	raw: unknown,
):
	| { readonly ok: true; readonly clock: ScheduledReadinessClock }
	| { readonly ok: false; readonly issue: DataIssue } {
	if (!isPlainRecord(raw)) {
		return {
			ok: false,
			issue: dataIssue(
				"scheduled-readiness-malformed-clock",
				"Scheduled readiness clock facts require a stable clockId and finite nowMs.",
				{ subjectId: "unknown-scheduled-readiness-clock", refs: [] },
			),
		};
	}
	const refs = sourceRefArray(raw.sourceRefs);
	const nowMs = finiteNumberOrUndefined(raw.nowMs);
	if (
		raw.kind !== "scheduled-readiness-clock" ||
		typeof raw.clockId !== "string" ||
		raw.clockId.length === 0 ||
		nowMs === undefined ||
		(raw.sourceRefs !== undefined && !Array.isArray(raw.sourceRefs))
	) {
		const clockSubjectId =
			typeof raw.clockId === "string" && raw.clockId.length > 0
				? raw.clockId
				: "unknown-scheduled-readiness-clock";
		return {
			ok: false,
			issue: dataIssue(
				"scheduled-readiness-malformed-clock",
				"Scheduled readiness clock facts require a stable clockId and finite nowMs.",
				{ subjectId: clockSubjectId, refs },
			),
		};
	}
	const metadata = sanitizeScheduledReadinessMetadata(
		isPlainRecord(raw.metadata) ? raw.metadata : undefined,
	);
	return {
		ok: true,
		clock: Object.freeze({
			kind: "scheduled-readiness-clock",
			clockId: raw.clockId,
			nowMs,
			sourceRefs: refs,
			...(metadata === undefined ? {} : { metadata }),
		} satisfies ScheduledReadinessClock),
	};
}

function emitPending(
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
	pending: ScheduledReadinessPending,
): void {
	state.pendingById.set(pending.scheduleId, pending);
	const key = `pending:${pending.scheduleId}`;
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "pending", pending }]]);
}

function emitReady(
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
	ready: ScheduledReadinessReady,
): void {
	const key = `ready:${ready.scheduleId}`;
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	state.readyById.set(ready.scheduleId, ready);
	state.pendingById.delete(ready.scheduleId);
	emitAudit(ctx, state, "scheduled-readiness-ready", {
		subjectId: ready.scheduleId,
		sourceRefs: ready.sourceRefs,
		metadata: { nowMs: ready.nowMs, readyAtMs: ready.readyAtMs },
	});
	ctx.down([["DATA", { kind: "ready", ready }]]);
}

function emitOverdue(
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
	overdue: ScheduledReadinessOverdue,
): void {
	const key = `overdue:${overdue.scheduleId}`;
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	state.overdueById.set(overdue.scheduleId, overdue);
	emitAudit(ctx, state, "scheduled-readiness-overdue", {
		subjectId: overdue.scheduleId,
		sourceRefs: overdue.sourceRefs,
		metadata: {
			nowMs: overdue.nowMs,
			readyAtMs: overdue.readyAtMs,
			deadlineMs: overdue.deadlineMs,
		},
	});
	ctx.down([["DATA", { kind: "overdue", overdue }]]);
}

function emitStatus(
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
	status: ScheduledReadinessStatus,
): void {
	state.statusById.set(status.scheduleId, status);
	const key = compoundTupleKey("status", [stableJsonStringify(status)]);
	if (state.emittedKeys.has(key)) return;
	state.emittedKeys.add(key);
	ctx.down([["DATA", { kind: "status", status }]]);
}

function emitIssue(
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
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
	ctx: { down: (msgs: readonly ["DATA", ScheduledReadinessFact][]) => void },
	state: ScheduledReadinessProjectorState,
	kind: string,
	opts: {
		readonly subjectId?: string;
		readonly sourceRefs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	} = {},
): void {
	state.auditSeq += 1;
	const metadata = sanitizeGraphVisibleRecord(opts.metadata);
	ctx.down([
		[
			"DATA",
			{
				kind: "audit",
				audit: Object.freeze({
					id: compoundTupleKey("scheduled-readiness-audit", [String(state.auditSeq)]),
					kind,
					...(opts.subjectId === undefined ? {} : { subjectId: opts.subjectId }),
					...(opts.sourceRefs === undefined
						? {}
						: { sourceRefs: canonicalPublicSourceRefs(opts.sourceRefs) }),
					...(metadata === undefined ? {} : { metadata }),
				} satisfies AgentRuntimeAuditRecord),
			},
		],
	]);
}

function statusFor(
	schedule: ScheduledReadinessRequested,
	state: ScheduledReadinessStatusState,
	opts: {
		readonly subjectRefs: readonly SourceRef[];
		readonly readyAtMs: number;
		readonly sourceRefs: readonly SourceRef[];
		readonly nowMs?: number;
	},
): ScheduledReadinessStatus {
	const metadata = sanitizeGraphVisibleRecord({
		...(schedule.reason === undefined ? {} : { reason: schedule.reason }),
	});
	return Object.freeze({
		kind: "scheduled-readiness-status",
		statusId: compoundTupleKey("scheduled-readiness-status", [schedule.scheduleId, state]),
		scheduleId: schedule.scheduleId,
		state,
		subjectRefs: opts.subjectRefs,
		readyAtMs: opts.readyAtMs,
		...(schedule.deadlineMs === undefined ? {} : { deadlineMs: schedule.deadlineMs }),
		...(opts.nowMs === undefined ? {} : { nowMs: opts.nowMs }),
		sourceRefs: opts.sourceRefs,
		...(metadata === undefined ? {} : { metadata }),
	} satisfies ScheduledReadinessStatus);
}

function readinessMs(schedule: ScheduledReadinessRequested): number {
	return schedule.readyAtMs;
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

function scheduleSubjectRefs(schedule: ScheduledReadinessRequested): readonly SourceRef[] {
	return canonicalPublicSourceRefs(uniqueSourceRefs(schedule.subjectRefs));
}

function scheduleSourceRefs(
	schedule: ScheduledReadinessRequested,
	clockSourceRefs: readonly SourceRef[] | undefined,
): readonly SourceRef[] {
	return canonicalPublicSourceRefs(
		uniqueSourceRefs([
			ref("scheduled-readiness", schedule.scheduleId),
			...(schedule.sourceRefs ?? []),
			...(schedule.policyRefs ?? []),
			...(clockSourceRefs ?? []),
		]),
	);
}

function sanitizeScheduledReadinessMetadata(
	value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const filtered = omitRuntimeMetadata(value);
	return sanitizeGraphVisibleRecord(filtered);
}

function omitRuntimeMetadata(value: unknown): Record<string, unknown> | undefined {
	if (!isPlainRecord(value)) return undefined;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (isRuntimeMetadataKey(key)) continue;
		const filteredChild = Array.isArray(child)
			? child.map((entry) => (isPlainRecord(entry) ? omitRuntimeMetadata(entry) : entry))
			: isPlainRecord(child)
				? omitRuntimeMetadata(child)
				: child;
		if (filteredChild !== undefined) out[key] = filteredChild;
	}
	return Object.keys(out).length === 0 ? undefined : out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceRefArray(value: unknown): readonly SourceRef[] {
	if (!Array.isArray(value)) return [];
	return canonicalPublicSourceRefs(
		value.flatMap((entry) => {
			const sourceRef = sourceRefOrUndefined(entry);
			return sourceRef === undefined ? [] : [sourceRef];
		}),
	);
}

function sourceRefOrUndefined(value: unknown): SourceRef | undefined {
	if (!isPlainRecord(value)) return undefined;
	if (typeof value.kind !== "string" || value.kind.length === 0) return undefined;
	if (typeof value.id !== "string" || value.id.length === 0) return undefined;
	return isPlainRecord(value.metadata)
		? { kind: value.kind, id: value.id, metadata: value.metadata }
		: { kind: value.kind, id: value.id };
}

function isRuntimeMetadataKey(key: string): boolean {
	return /^(apiKey|api_key|secret|client|transport|subprocess|sdk|oauth|credential|credentials|accessToken|access_token|refreshToken|refresh_token|idToken|id_token|token|password|passphrase|authorization|authHeader|auth_header|bearer|privateKey|private_key|sessionCookie|session_cookie|cookie|stdout|stderr|stack|stackTrace|stack_trace|providerRaw|provider_raw|rawResponse|raw_response|rawResponseBody|raw_response_body|diff|patch|fileContents|file_contents|binary|media)$/i.test(
		key,
	);
}

function buildViews(state: ScheduledReadinessProjectorState): ScheduledReadinessViews {
	return Object.freeze({
		schedulesById: new Map(state.schedules),
		pendingById: new Map(state.pendingById),
		readyById: new Map(state.readyById),
		overdueById: new Map(state.overdueById),
		statusById: new Map(state.statusById),
		...(state.nowMs === undefined ? {} : { nowMs: state.nowMs }),
	});
}
