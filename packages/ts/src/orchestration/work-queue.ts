/**
 * Optional orchestration-over-workQueue recipe (D349/D353).
 *
 * Queue lifecycle remains disposition evidence. This module maps visible
 * ProcessEffectRequest facts to queue commands and maps terminal queue records
 * back to graph-visible orchestration evidence/status/issue facts.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { ProcessEffectRequest } from "../orchestration/index.js";
import type { WorkQueueCommand, WorkQueueRecord } from "../work-queue/index.js";

export type {
	WorkQueueLeaseExpirationCommandBundle,
	WorkQueueReadinessCandidate,
	WorkQueueReadinessCandidateKind,
	WorkQueueReadinessHandoffBundle,
	WorkQueueReadinessHandoffStatus,
	WorkQueueReadinessHandoffStatusState,
	WorkQueueReadinessHandoffViews,
	WorkQueueScheduledReadinessBundle,
	WorkQueueScheduledReadinessScheduleKind,
	WorkQueueScheduledReadinessStatus,
	WorkQueueScheduledReadinessStatusState,
	WorkQueueScheduledReadinessViews,
} from "./work-queue-scheduled-readiness.js";
export {
	workQueueLeaseExpirationCommandProjector,
	workQueueReadinessHandoffProjector,
	workQueueScheduledReadinessProjector,
} from "./work-queue-scheduled-readiness.js";

export interface OrchestrationQueuedEffectPayload<TEffect = unknown> {
	readonly kind: "orchestration-queued-effect";
	readonly effect: ProcessEffectRequest<TEffect>;
	readonly idempotencyKey?: string;
	readonly sourceRefs?: readonly string[];
	readonly policyRefs?: readonly string[];
	readonly metadata?: Record<string, unknown>;
}

export interface OrchestrationQueueEvidence {
	readonly kind: "orchestration-queue-evidence";
	readonly evidenceId: string;
	readonly effectId: string;
	readonly effectType: string;
	readonly workId: string;
	readonly queueRecordKind: WorkQueueRecord["kind"];
	readonly result?: unknown;
	readonly error?: unknown;
	readonly recordedAtMs: number;
}

export interface OrchestrationQueueStatus {
	readonly kind: "orchestration-queue-status";
	readonly state: "evidence-recorded" | "mapping-issue";
	readonly effectId?: string;
	readonly effectType?: string;
	readonly workId?: string;
	readonly queueRecordKind?: WorkQueueRecord["kind"];
	readonly evidenceId?: string;
	readonly issues?: readonly DataIssue[];
}

export interface OrchestrationQueueAuditRecord {
	readonly kind: "orchestration-queue-audit";
	readonly seq: number;
	readonly outcome: "mapped" | "issue";
	readonly effectId?: string;
	readonly effectType?: string;
	readonly workId?: string;
	readonly queueRecordKind?: WorkQueueRecord["kind"];
	readonly evidenceId?: string;
}

export interface OrchestrationWorkQueueRecipeOptions<TEffect = unknown> {
	readonly name?: string;
	readonly effectRequests?: Node<ProcessEffectRequest<TEffect>>;
	readonly records: Node<WorkQueueRecord<OrchestrationQueuedEffectPayload<TEffect>>>;
}

export interface OrchestrationWorkQueueRecipeBundle<TEffect = unknown> {
	readonly submitCommands?: Node<WorkQueueCommand<OrchestrationQueuedEffectPayload<TEffect>>>;
	readonly evidence: Node<OrchestrationQueueEvidence>;
	readonly status: Node<OrchestrationQueueStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<OrchestrationQueueAuditRecord>;
}

type OrchestrationQueueFact =
	| { readonly kind: "evidence"; readonly evidence: OrchestrationQueueEvidence }
	| { readonly kind: "status"; readonly status: OrchestrationQueueStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: OrchestrationQueueAuditRecord };

interface QueueState<TEffect> {
	readonly payloads: Map<string, OrchestrationQueuedEffectPayload<TEffect>>;
	readonly terminalRecords: Set<string>;
	auditSeq: number;
}

/** Build the optional D349 orchestration workQueue recipe.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category orchestration
 * @example
 * ```ts
 * import { orchestrationWorkQueueRecipe } from "@graphrefly/ts/orchestration/work-queue";
 * ```
 */
export function orchestrationWorkQueueRecipe<TEffect = unknown>(
	graph: Graph,
	opts: OrchestrationWorkQueueRecipeOptions<TEffect>,
): OrchestrationWorkQueueRecipeBundle<TEffect> {
	const name = opts.name ?? "orchestrationWorkQueue";
	const submitCommands =
		opts.effectRequests === undefined
			? undefined
			: graph.node<WorkQueueCommand<OrchestrationQueuedEffectPayload<TEffect>>>(
					[opts.effectRequests],
					(ctx) => {
						for (const raw of depBatch(ctx, 0) ?? []) {
							ctx.down([
								["DATA", processEffectSubmitCommand(raw as ProcessEffectRequest<TEffect>)],
							]);
						}
					},
					{
						name: `${name}/submitCommands`,
						factory: "orchestrationWorkQueueSubmitCommands",
						completeWhenDepsComplete: false,
						errorWhenDepsError: false,
					},
				);
	const runtime = graph.node<OrchestrationQueueFact>(
		[opts.records],
		(ctx) => {
			const state = ctx.state.get<QueueState<TEffect>>() ?? {
				payloads: new Map(),
				terminalRecords: new Set(),
				auditSeq: 0,
			};
			for (const raw of depBatch(ctx, 0) ?? []) {
				reduceRecord(ctx, state, raw as WorkQueueRecord<OrchestrationQueuedEffectPayload<TEffect>>);
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "orchestrationWorkQueueRuntime",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		...(submitCommands === undefined ? {} : { submitCommands }),
		evidence: project(
			graph,
			runtime,
			`${name}/evidence`,
			"orchestrationWorkQueueEvidence",
			(fact) => (fact.kind === "evidence" ? fact.evidence : undefined),
		),
		status: project(graph, runtime, `${name}/status`, "orchestrationWorkQueueStatus", (fact) =>
			fact.kind === "status" ? fact.status : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "orchestrationWorkQueueIssues", (fact) =>
			fact.kind === "issue" ? fact.issue : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "orchestrationWorkQueueAudit", (fact) =>
			fact.kind === "audit" ? fact.audit : undefined,
		),
	};
}

/**
 * Creates a process effect submit command.
 *
 * @param effect - effect value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns The process effect submit command result.
 * @category orchestration
 * @example
 * ```ts
 * import { processEffectSubmitCommand } from "@graphrefly/ts/orchestration/work-queue";
 * ```
 */
export function processEffectSubmitCommand<TEffect>(
	effect: ProcessEffectRequest<TEffect>,
	opts: {
		readonly workId?: string;
		readonly commandId?: string;
		readonly idempotencyKey?: string;
		readonly sourceRefs?: readonly string[];
		readonly policyRefs?: readonly string[];
		readonly metadata?: Record<string, unknown>;
	} = {},
): WorkQueueCommand<OrchestrationQueuedEffectPayload<TEffect>> {
	const payload: OrchestrationQueuedEffectPayload<TEffect> = {
		kind: "orchestration-queued-effect",
		effect,
		idempotencyKey: opts.idempotencyKey ?? effect.id,
		sourceRefs: opts.sourceRefs,
		policyRefs: opts.policyRefs,
		metadata: opts.metadata,
	};
	return {
		kind: "submit",
		commandId: opts.commandId ?? `${effect.id}:orchestration-work-queue-submit`,
		workId: opts.workId ?? `process-effect:${effect.id}`,
		payload,
		idempotencyKey: opts.idempotencyKey ?? effect.id,
		sourceRefs: opts.sourceRefs,
		policyRefs: opts.policyRefs,
	};
}

function reduceRecord<TEffect>(
	ctx: Ctx,
	state: QueueState<TEffect>,
	record: WorkQueueRecord<OrchestrationQueuedEffectPayload<TEffect>>,
): void {
	if (record.kind === "work-admitted") {
		if (isQueuedEffectPayload(record.payload)) {
			state.payloads.set(record.workId, record.payload);
		} else {
			emitIssue(ctx, state, record, "orchestration-queue-malformed-payload");
		}
		return;
	}
	if (!isTerminalEvidenceRecord(record)) return;
	const key = `${record.kind}:${record.recordSeq}`;
	if (state.terminalRecords.has(key)) return;
	state.terminalRecords.add(key);
	const payload = record.workId === undefined ? undefined : state.payloads.get(record.workId);
	if (payload === undefined) {
		emitIssue(ctx, state, record, "orchestration-queue-record-without-payload");
		return;
	}
	const evidence = evidenceFromRecord(record, payload);
	emit(ctx, { kind: "evidence", evidence });
	emit(ctx, { kind: "status", status: statusFromEvidence(evidence, payload) });
	state.auditSeq += 1;
	emit(ctx, { kind: "audit", audit: auditFromEvidence(state.auditSeq, evidence, payload) });
}

function isTerminalEvidenceRecord(record: WorkQueueRecord): boolean {
	return (
		record.kind === "work-completed" ||
		record.kind === "attempt-completed" ||
		record.kind === "work-canceled" ||
		record.kind === "work-dead-lettered" ||
		record.kind === "attempt-failed"
	);
}

function evidenceFromRecord<TEffect>(
	record: WorkQueueRecord<OrchestrationQueuedEffectPayload<TEffect>>,
	payload: OrchestrationQueuedEffectPayload<TEffect>,
): OrchestrationQueueEvidence {
	return {
		kind: "orchestration-queue-evidence",
		evidenceId: `work-queue:${record.recordSeq}`,
		effectId: payload.effect.id,
		effectType: payload.effect.type,
		workId: record.workId ?? `unknown:${record.recordSeq}`,
		queueRecordKind: record.kind,
		result: "result" in record ? record.result : undefined,
		error: "error" in record ? record.error : undefined,
		recordedAtMs: record.recordedAtMs,
	};
}

function statusFromEvidence<TEffect>(
	evidence: OrchestrationQueueEvidence,
	payload: OrchestrationQueuedEffectPayload<TEffect>,
): OrchestrationQueueStatus {
	return {
		kind: "orchestration-queue-status",
		state: "evidence-recorded",
		effectId: payload.effect.id,
		effectType: payload.effect.type,
		workId: evidence.workId,
		queueRecordKind: evidence.queueRecordKind,
		evidenceId: evidence.evidenceId,
	};
}

function auditFromEvidence<TEffect>(
	seq: number,
	evidence: OrchestrationQueueEvidence,
	payload: OrchestrationQueuedEffectPayload<TEffect>,
): OrchestrationQueueAuditRecord {
	return {
		kind: "orchestration-queue-audit",
		seq,
		outcome: "mapped",
		effectId: payload.effect.id,
		effectType: payload.effect.type,
		workId: evidence.workId,
		queueRecordKind: evidence.queueRecordKind,
		evidenceId: evidence.evidenceId,
	};
}

function auditFromIssue(
	seq: number,
	record: WorkQueueRecord<unknown>,
): OrchestrationQueueAuditRecord {
	return {
		kind: "orchestration-queue-audit",
		seq,
		outcome: "issue",
		workId: record.workId,
		queueRecordKind: record.kind,
	};
}

function project<T>(
	graph: Graph,
	runtime: Node<OrchestrationQueueFact>,
	name: string,
	factory: string,
	pick: (fact: OrchestrationQueueFact) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const value = pick(fact as OrchestrationQueueFact);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function emit(ctx: Ctx, fact: OrchestrationQueueFact): void {
	ctx.down([["DATA", fact]]);
}

function emitIssue(
	ctx: Ctx,
	state: QueueState<unknown>,
	record: WorkQueueRecord<unknown>,
	code: string,
): void {
	const issue = queueIssue(record, code);
	emit(ctx, { kind: "issue", issue });
	state.auditSeq += 1;
	emit(ctx, {
		kind: "status",
		status: {
			kind: "orchestration-queue-status",
			state: "mapping-issue",
			workId: record.workId,
			queueRecordKind: record.kind,
			issues: [issue],
		},
	});
	emit(ctx, {
		kind: "audit",
		audit: auditFromIssue(state.auditSeq, record),
	});
}

function queueIssue(record: WorkQueueRecord<unknown>, code: string): DataIssue {
	return {
		kind: "issue",
		code,
		message: `Orchestration workQueue recipe could not map record '${record.kind}'`,
		severity: "error",
		source: "orchestration.workQueue",
		details: record,
	};
}

function isQueuedEffectPayload<TEffect>(
	value: unknown,
): value is OrchestrationQueuedEffectPayload<TEffect> {
	if (!isObjectRecord(value) || value.kind !== "orchestration-queued-effect") return false;
	const effect = value.effect;
	return isObjectRecord(effect) && typeof effect.id === "string" && typeof effect.type === "string";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
