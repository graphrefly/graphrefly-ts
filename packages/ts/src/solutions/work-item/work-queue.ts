/**
 * WorkItem-over-workQueue recipe facts (D327/D331).
 *
 * This solution-layer recipe maps WorkItem effect facts to queue submit command facts and maps
 * terminal queue records back to WorkItem evidence/status. It does not mutate WorkItems or bypass
 * the generic workQueue admission path.
 */

import { type Ctx, depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import type { Node } from "../../node/node.js";
import type {
	AgentOutputEnvelope,
	AgentRuntimeAuditRecord,
	EffectRunResultStatus,
	SourceRef,
} from "../../orchestration/agent-runtime.js";
import type {
	WorkItemEffectRequested,
	WorkItemEvidenceRecorded,
	WorkItemStatusRecord,
} from "../../orchestration/work-item-runtime.js";
import type { WorkQueueCommand, WorkQueueRecord } from "../../work-queue/index.js";

export interface WorkItemQueuedWorkPayload {
	readonly kind: "work-item-queued-work";
	readonly workItemId: string;
	readonly effectRunId: string;
	readonly requestId: string;
	readonly effectKind: string;
	readonly requestedActionKind?: string;
	readonly sourceEventId?: string;
	readonly sourceDecisionId?: string;
	readonly policyRefs?: readonly SourceRef[];
	readonly sourceRefs?: readonly SourceRef[];
	readonly contextRefs?: readonly SourceRef[];
	readonly artifactRefs?: readonly SourceRef[];
	readonly idempotencyKey?: string;
	readonly metadata?: Record<string, unknown>;
}

export type WorkItemQueuedWorkPayloadExtra = Partial<
	Omit<
		WorkItemQueuedWorkPayload,
		"kind" | "workItemId" | "effectRunId" | "requestId" | "effectKind"
	>
>;

export interface WorkItemWorkQueueSubmitOptions {
	readonly workId?: string;
	readonly priority?: number;
	readonly tags?: readonly string[];
	readonly requirements?: readonly string[];
	readonly notBeforeMs?: number;
	readonly deadlineMs?: number;
}

export interface WorkItemWorkQueuePolicy {
	readonly policyId?: string;
	readonly submit?: (request: WorkItemEffectRequested) => WorkItemWorkQueueSubmitOptions;
	readonly payload?: (request: WorkItemEffectRequested) => WorkItemQueuedWorkPayloadExtra;
	readonly evidenceStatuses?: readonly WorkQueueRecord["kind"][];
}

export interface WorkItemWorkQueueRecipeOptions {
	readonly name?: string;
	readonly effectRequests: Node<WorkItemEffectRequested>;
	readonly records: Node<WorkQueueRecord<WorkItemQueuedWorkPayload>>;
	readonly policy?: WorkItemWorkQueuePolicy;
}

export interface WorkItemWorkQueueRecipeBundle {
	readonly submitCommands: Node<WorkQueueCommand<WorkItemQueuedWorkPayload>>;
	readonly evidence: Node<WorkItemEvidenceRecorded>;
	readonly status: Node<WorkItemStatusRecord>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
}

type WorkItemQueueFact =
	| { readonly kind: "evidence"; readonly evidence: WorkItemEvidenceRecorded }
	| { readonly kind: "status"; readonly status: WorkItemStatusRecord }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: AgentRuntimeAuditRecord };

interface WorkItemQueueState {
	readonly payloads: Map<string, WorkItemQueuedWorkPayload>;
	readonly terminalRecords: Set<string>;
	statusSeq: number;
	auditSeq: number;
}

const DEFAULT_EVIDENCE_RECORDS: readonly WorkQueueRecord["kind"][] = [
	"work-completed",
	"work-canceled",
	"work-dead-lettered",
];

export function workItemWorkQueueRecipe(
	graph: Graph,
	opts: WorkItemWorkQueueRecipeOptions,
): WorkItemWorkQueueRecipeBundle {
	const name = opts.name ?? "workItemWorkQueue";
	const submitCommands = graph.node<WorkQueueCommand<WorkItemQueuedWorkPayload>>(
		[opts.effectRequests],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const request = raw as WorkItemEffectRequested;
				ctx.down([["DATA", workItemSubmitCommand(request, opts.policy)]]);
			}
		},
		{ name: `${name}/submitCommands`, factory: "workItemWorkQueueSubmitCommands" },
	);
	const runtime = graph.node<WorkItemQueueFact>(
		[opts.records],
		(ctx) => {
			const state = ctx.state.get<WorkItemQueueState>() ?? emptyState();
			const evidenceKinds = new Set(opts.policy?.evidenceStatuses ?? DEFAULT_EVIDENCE_RECORDS);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const record = raw as WorkQueueRecord<WorkItemQueuedWorkPayload>;
				if (record.kind === "work-admitted") {
					state.payloads.set(record.workId, record.payload);
					continue;
				}
				if (!evidenceKinds.has(record.kind)) continue;
				const key = `${record.kind}:${record.recordSeq}`;
				if (state.terminalRecords.has(key)) continue;
				state.terminalRecords.add(key);
				const payload = "workId" in record ? state.payloads.get(record.workId ?? "") : undefined;
				if (payload === undefined) {
					emitIssue(ctx, state, record, "work-item-queue-record-without-payload");
					continue;
				}
				const evidence = evidenceFromRecord(record, payload);
				emitFact(ctx, { kind: "evidence", evidence });
				emitStatus(ctx, state, payload, record, evidence.evidenceId, "evidence-recorded");
				emitAudit(ctx, state, record, payload, "mapped");
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "workItemWorkQueueEvidenceProjector",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		submitCommands,
		evidence: project(graph, runtime, `${name}/evidence`, "workItemWorkQueueEvidence", (fact) =>
			fact.kind === "evidence" ? fact.evidence : undefined,
		),
		status: project(graph, runtime, `${name}/status`, "workItemWorkQueueStatus", (fact) =>
			fact.kind === "status" ? fact.status : undefined,
		),
		issues: project(graph, runtime, `${name}/issues`, "workItemWorkQueueIssues", (fact) =>
			fact.kind === "issue" ? fact.issue : undefined,
		),
		audit: project(graph, runtime, `${name}/audit`, "workItemWorkQueueAudit", (fact) =>
			fact.kind === "audit" ? fact.audit : undefined,
		),
	};
}

export function workItemSubmitCommand(
	request: WorkItemEffectRequested,
	policy?: WorkItemWorkQueuePolicy,
): WorkQueueCommand<WorkItemQueuedWorkPayload> {
	const payloadExtra = policy?.payload?.(request) ?? {};
	const submit = policy?.submit?.(request) ?? {};
	const payload: WorkItemQueuedWorkPayload = {
		...payloadExtra,
		kind: "work-item-queued-work",
		workItemId: request.workItemId,
		effectRunId: request.effectRunId,
		requestId: request.requestId,
		effectKind: request.effectKind,
		policyRefs: request.policyRefs,
		sourceRefs: request.sourceRefs,
		idempotencyKey: request.idempotencyKey,
		metadata: request.metadata,
	};
	return {
		kind: "submit",
		commandId: `${request.requestId}:work-queue-submit`,
		payload,
		workId: submit.workId ?? `${request.workItemId}:${request.effectRunId}`,
		priority: submit.priority,
		tags: submit.tags ?? ["work-item", request.effectKind],
		requirements: submit.requirements,
		notBeforeMs: submit.notBeforeMs,
		deadlineMs: submit.deadlineMs,
		idempotencyKey: request.idempotencyKey ?? request.requestId,
		sourceRefs: stringRefs(request.sourceRefs),
		policyRefs: stringRefs(request.policyRefs),
	};
}

function evidenceFromRecord(
	record: WorkQueueRecord<WorkItemQueuedWorkPayload>,
	payload: WorkItemQueuedWorkPayload,
): WorkItemEvidenceRecorded {
	const status = evidenceStatus(record);
	const base = {
		kind: "work-item-evidence-recorded" as const,
		evidenceId: `work-queue:${record.recordSeq}`,
		workItemId: payload.workItemId,
		effectRunId: payload.effectRunId,
		effectRunResultId: `work-queue:${record.workId ?? payload.effectRunId}:${record.recordSeq}`,
		status,
		sourceRefs: [...(payload.sourceRefs ?? []), ref("work-queue-record", String(record.recordSeq))],
		recordedAtMs: record.recordedAtMs,
		metadata: { ...(payload.metadata ?? {}), queueRecordKind: record.kind, workId: record.workId },
	};
	if (record.kind === "work-completed" || record.kind === "attempt-completed") {
		return {
			...base,
			output: {
				kind: "work-queue-completion",
				value: record.result,
				refs: [ref("work-queue-record", String(record.recordSeq))],
			} satisfies AgentOutputEnvelope,
		};
	}
	return {
		...base,
		error: queueIssue(record, `WorkQueue record '${record.kind}' mapped to WorkItem evidence`),
		reason: "reason" in record ? record.reason : undefined,
	};
}

function evidenceStatus(record: WorkQueueRecord): EffectRunResultStatus {
	if (record.kind === "work-completed" || record.kind === "attempt-completed") return "completed";
	if (record.kind === "work-canceled") return "canceled";
	return "failed";
}

function emitStatus(
	ctx: Ctx,
	state: WorkItemQueueState,
	payload: WorkItemQueuedWorkPayload,
	record: WorkQueueRecord<WorkItemQueuedWorkPayload>,
	evidenceId: string,
	statusState: WorkItemStatusRecord["state"],
): void {
	state.statusSeq += 1;
	emitFact(ctx, {
		kind: "status",
		status: {
			kind: "work-item-status",
			statusId: `work-item-work-queue-status:${state.statusSeq}`,
			workItemId: payload.workItemId,
			state: statusState,
			effectRunId: payload.effectRunId,
			requestId: payload.requestId,
			evidenceId,
			sourceRefs: [
				ref("work-queue-record", String(record.recordSeq)),
				...(payload.sourceRefs ?? []),
			],
			metadata: { queueRecordKind: record.kind, workId: record.workId },
		},
	});
}

function emitIssue(
	ctx: Ctx,
	state: WorkItemQueueState,
	record: WorkQueueRecord<WorkItemQueuedWorkPayload>,
	code: string,
): void {
	const issue = queueIssue(
		record,
		`WorkQueue record '${record.kind}' has no admitted WorkItem payload`,
	);
	emitFact(ctx, { kind: "issue", issue: { ...issue, code } });
	state.statusSeq += 1;
	emitFact(ctx, {
		kind: "status",
		status: {
			kind: "work-item-status",
			statusId: `work-item-work-queue-status:${state.statusSeq}`,
			workItemId: record.workId ?? "unknown",
			state: "mapping-issue",
			issues: [{ ...issue, code }],
			sourceRefs: [ref("work-queue-record", String(record.recordSeq))],
		},
	});
}

function emitAudit(
	ctx: Ctx,
	state: WorkItemQueueState,
	record: WorkQueueRecord<WorkItemQueuedWorkPayload>,
	payload: WorkItemQueuedWorkPayload,
	outcome: "mapped" | "issue",
): void {
	state.auditSeq += 1;
	emitFact(ctx, {
		kind: "audit",
		audit: {
			id: `work-item-work-queue-audit:${state.auditSeq}`,
			kind: "work-item-work-queue-record",
			subjectId: payload.workItemId,
			message: `WorkQueue record '${record.kind}' ${outcome} as WorkItem evidence`,
			sourceRefs: [
				ref("work-item", payload.workItemId),
				ref("effect-run", payload.effectRunId),
				ref("work-queue-record", String(record.recordSeq)),
			],
			metadata: { queueRecordKind: record.kind, workId: record.workId },
		},
	});
}

function project<T>(
	graph: Graph,
	runtime: Node<WorkItemQueueFact>,
	name: string,
	factory: string,
	select: (fact: WorkItemQueueFact) => T | undefined,
): Node<T> {
	return graph.node<T>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as WorkItemQueueFact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function emitFact(ctx: Ctx, fact: WorkItemQueueFact): void {
	ctx.down([["DATA", fact]]);
}

function queueIssue(record: WorkQueueRecord, message: string): DataIssue {
	return {
		kind: "issue",
		code: `work-item-${record.kind}`,
		message,
		refs: [`work-queue-record:${record.recordSeq}`],
		metadata: { queueRecordKind: record.kind, workId: record.workId },
	};
}

function emptyState(): WorkItemQueueState {
	return {
		payloads: new Map(),
		terminalRecords: new Set(),
		statusSeq: 0,
		auditSeq: 0,
	};
}

function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

function stringRefs(refs: readonly SourceRef[] | undefined): readonly string[] | undefined {
	return refs?.map((sourceRef) => `${sourceRef.kind}:${sourceRef.id}`);
}
