/**
 * Event-flow projector helpers (D326/D329/D331).
 *
 * eventFlow consumes declared graph sources that emit EventMessage or
 * MessageEnvelope<EventMessage>. It records projection facts and high-water over
 * source coordinates; it does not own topics, subscriptions, cursors, retention,
 * ack/seek/close, queues, workers, or dead-letter policy.
 */

import { depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import type { EventMessage, MessageEnvelope } from "../messaging/index.js";
import { eventMessageIssue } from "../messaging/index.js";
import type { Node } from "../node/node.js";

export interface EventFlowSource<T = unknown> {
	readonly source: string;
	readonly node: Node<EventMessage<T> | MessageEnvelope<EventMessage<T>> | unknown>;
}

export type EventFlowSourceInput<T = unknown> =
	| Node<EventMessage<T> | MessageEnvelope<EventMessage<T>> | unknown>
	| EventFlowSource<T>;

export interface EventFlowSourceRef {
	readonly source: string;
	readonly topic?: string;
	readonly seq?: number;
	readonly messageId?: string;
	readonly idempotencyKey?: string;
}

export interface EventFlowRecord<T = unknown> {
	readonly recordSeq: number;
	readonly flowId: string;
	readonly event: EventMessage<T>;
	readonly source: EventFlowSourceRef;
	readonly observedAtMs: number;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface EventFlowStatus {
	readonly kind: "recorded" | "rejected" | "projection-ready" | "projection-stale";
	readonly flowId: string;
	readonly recordSeq?: number;
	readonly eventId?: string;
	readonly eventType?: string;
	readonly source?: EventFlowSourceRef;
	readonly issueCode?: string;
	readonly timestampMs: number;
}

export interface EventFlowAuditRecord {
	readonly seq: number;
	readonly flowId: string;
	readonly outcome: "recorded" | "rejected";
	readonly eventId?: string;
	readonly eventType?: string;
	readonly issueCode?: string;
	readonly source?: EventFlowSourceRef;
	readonly highWater: EventFlowHighWater;
	readonly timestampMs: number;
}

export interface EventFlowSourceHighWater {
	readonly source: string;
	readonly topic?: string;
	readonly seq?: number;
	readonly messageId?: string;
	readonly recordSeq: number;
}

export interface EventFlowHighWater {
	readonly flowId: string;
	readonly recordSeq: number;
	readonly auditSeq: number;
	readonly sources: readonly EventFlowSourceHighWater[];
}

export interface EventFlowOptions<T = unknown> {
	readonly flowId?: string;
	readonly name?: string;
	readonly sources: readonly EventFlowSourceInput<T>[];
	readonly now?: () => number;
}

export interface EventFlowBundle<T = unknown> {
	readonly records: Node<EventFlowRecord<T>>;
	readonly status: Node<EventFlowStatus>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<EventFlowAuditRecord>;
	readonly highWater: Node<EventFlowHighWater>;
}

export interface EventFlowProjectionFrame<TState> {
	readonly state: TState;
	readonly highWater: EventFlowHighWater;
}

export interface EventFlowProjectionStatus {
	readonly kind: "projected" | "rejected";
	readonly projectionId: string;
	readonly recordSeq?: number;
	readonly issueCode?: string;
	readonly timestampMs: number;
}

export interface EventFlowProjectionOptions<TState, TPayload = unknown> {
	readonly projectionId?: string;
	readonly name?: string;
	readonly initial: TState;
	readonly reduce: (state: TState, record: EventFlowRecord<TPayload>) => TState;
	readonly now?: () => number;
}

export interface EventFlowProjectionBundle<TState> {
	readonly snapshot: Node<TState>;
	readonly frames: Node<EventFlowProjectionFrame<TState>>;
	readonly status: Node<EventFlowProjectionStatus>;
	readonly issues: Node<DataIssue>;
	readonly highWater: Node<EventFlowHighWater>;
}

type EventFlowRuntimeFact<T = unknown> =
	| { readonly kind: "record"; readonly record: EventFlowRecord<T> }
	| { readonly kind: "status"; readonly status: EventFlowStatus }
	| { readonly kind: "issue"; readonly issue: DataIssue }
	| { readonly kind: "audit"; readonly audit: EventFlowAuditRecord }
	| { readonly kind: "high-water"; readonly highWater: EventFlowHighWater };

interface EventFlowRuntimeState {
	recordSeq: number;
	auditSeq: number;
	highWater: Map<string, EventFlowSourceHighWater>;
}

export function eventFlow<T = unknown>(
	graph: Graph,
	opts: EventFlowOptions<T>,
): EventFlowBundle<T> {
	const name = opts.name ?? opts.flowId ?? "eventFlow";
	const flowId = opts.flowId ?? name;
	const now = opts.now ?? Date.now;
	const sources = normalizeSources(opts.sources);
	const runtime = graph.node<EventFlowRuntimeFact<T>>(
		sources.map((source) => source.node),
		(ctx) => {
			const state =
				ctx.state.get<EventFlowRuntimeState>() ??
				({
					recordSeq: 0,
					auditSeq: 0,
					highWater: new Map(),
				} satisfies EventFlowRuntimeState);
			ctx.state.persist(true);
			for (let i = 0; i < sources.length; i++) {
				const source = sources[i];
				for (const raw of depBatch(ctx, i) ?? []) {
					reduceEventSource(raw, source.source, flowId, now(), state, (fact) =>
						ctx.down([["DATA", fact as EventFlowRuntimeFact<T>]]),
					);
				}
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "eventFlowRuntime",
			meta: { flowId, sources: sources.map((source) => source.source) },
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		records: runtimeProjection(graph, runtime, "record", `${name}/records`, "eventFlowRecords"),
		status: runtimeProjection(graph, runtime, "status", `${name}/status`, "eventFlowStatus"),
		issues: runtimeProjection(graph, runtime, "issue", `${name}/issues`, "eventFlowIssues"),
		audit: runtimeProjection(graph, runtime, "audit", `${name}/audit`, "eventFlowAudit"),
		highWater: runtimeProjection(
			graph,
			runtime,
			"high-water",
			`${name}/highWater`,
			"eventFlowHighWater",
		),
	};
}

export function eventFlowProjection<TState, TPayload = unknown>(
	graph: Graph,
	flowOrRecords: EventFlowBundle<TPayload> | Node<EventFlowRecord<TPayload>>,
	opts: EventFlowProjectionOptions<TState, TPayload>,
): EventFlowProjectionBundle<TState> {
	const records = isEventFlowBundle(flowOrRecords) ? flowOrRecords.records : flowOrRecords;
	const name = opts.name ?? opts.projectionId ?? "eventFlowProjection";
	const projectionId = opts.projectionId ?? name;
	const now = opts.now ?? Date.now;
	const runtime = graph.node<
		| { readonly kind: "frame"; readonly frame: EventFlowProjectionFrame<TState> }
		| { readonly kind: "status"; readonly status: EventFlowProjectionStatus }
		| { readonly kind: "issue"; readonly issue: DataIssue }
		| { readonly kind: "high-water"; readonly highWater: EventFlowHighWater }
	>(
		[records],
		(ctx) => {
			const state = ctx.state.get<{
				value: TState;
				highWater: EventFlowHighWater;
				sourceHighWater: Map<string, EventFlowSourceHighWater>;
			}>() ?? {
				value: opts.initial,
				highWater: emptyHighWater(projectionId),
				sourceHighWater: new Map(),
			};
			ctx.state.persist(true);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const record = raw as EventFlowRecord<TPayload>;
				try {
					state.value = opts.reduce(state.value, record);
					state.highWater = projectionHighWater(projectionId, record, state.sourceHighWater);
					ctx.down([
						["DATA", { kind: "frame", frame: { state: state.value, highWater: state.highWater } }],
						[
							"DATA",
							{
								kind: "status",
								status: {
									kind: "projected",
									projectionId,
									recordSeq: record.recordSeq,
									timestampMs: now(),
								},
							},
						],
						["DATA", { kind: "high-water", highWater: state.highWater }],
					]);
				} catch (error) {
					const issue = dataIssue(
						"event-flow-projection-threw",
						error instanceof Error ? error.message : "eventFlowProjection reducer threw",
						{ projectionId, record },
					);
					ctx.down([
						["DATA", { kind: "issue", issue }],
						[
							"DATA",
							{
								kind: "status",
								status: {
									kind: "rejected",
									projectionId,
									recordSeq: record.recordSeq,
									issueCode: issue.code,
									timestampMs: now(),
								},
							},
						],
					]);
				}
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "eventFlowProjectionRuntime",
			meta: { projectionId },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		frames: projectionRuntime(
			graph,
			runtime,
			"frame",
			`${name}/frames`,
			"eventFlowProjectionFrames",
		),
		snapshot: projectionRuntime(
			graph,
			runtime,
			"frame",
			`${name}/snapshot`,
			"eventFlowProjectionSnapshot",
			(fact) => (fact as { readonly frame: EventFlowProjectionFrame<TState> }).frame.state,
		),
		status: projectionRuntime(
			graph,
			runtime,
			"status",
			`${name}/status`,
			"eventFlowProjectionStatus",
		),
		issues: projectionRuntime(
			graph,
			runtime,
			"issue",
			`${name}/issues`,
			"eventFlowProjectionIssues",
		),
		highWater: projectionRuntime(
			graph,
			runtime,
			"high-water",
			`${name}/highWater`,
			"eventFlowProjectionHighWater",
		),
	};
}

function reduceEventSource<T>(
	raw: unknown,
	source: string,
	flowId: string,
	timestampMs: number,
	state: EventFlowRuntimeState,
	emit: (fact: EventFlowRuntimeFact<T>) => void,
): void {
	const normalized = normalizeInput(raw, source);
	if (normalized.issue !== undefined) {
		const status: EventFlowStatus = {
			kind: "rejected",
			flowId,
			source: normalized.source,
			issueCode: normalized.issue.code,
			timestampMs,
		};
		const audit = auditRecord(flowId, state, "rejected", timestampMs, {
			source: normalized.source,
			issueCode: normalized.issue.code,
		});
		emit({ kind: "issue", issue: normalized.issue });
		emit({ kind: "status", status });
		emit({ kind: "audit", audit });
		emit({ kind: "high-water", highWater: highWaterSnapshot(flowId, state) });
		return;
	}

	const recordSeq = ++state.recordSeq;
	const record: EventFlowRecord<T> = {
		recordSeq,
		flowId,
		event: normalized.event as EventMessage<T>,
		source: normalized.source,
		observedAtMs: timestampMs,
		...(normalized.event.correlationId === undefined
			? {}
			: { correlationId: normalized.event.correlationId }),
		...(normalized.event.causationId === undefined
			? {}
			: { causationId: normalized.event.causationId }),
	};
	state.highWater.set(sourceKey(normalized.source), {
		source: normalized.source.source,
		...(normalized.source.topic === undefined ? {} : { topic: normalized.source.topic }),
		...(normalized.source.seq === undefined ? {} : { seq: normalized.source.seq }),
		messageId: normalized.event.id,
		recordSeq,
	});
	const audit = auditRecord(flowId, state, "recorded", timestampMs, {
		source: normalized.source,
		eventId: normalized.event.id,
		eventType: normalized.event.type,
	});
	const highWater = highWaterSnapshot(flowId, state);
	const status: EventFlowStatus = {
		kind: "recorded",
		flowId,
		recordSeq,
		eventId: normalized.event.id,
		eventType: normalized.event.type,
		source: normalized.source,
		timestampMs,
	};
	emit({ kind: "record", record });
	emit({ kind: "status", status });
	emit({ kind: "audit", audit });
	emit({ kind: "high-water", highWater });
}

function normalizeInput(
	raw: unknown,
	source: string,
):
	| {
			readonly event: EventMessage;
			readonly source: EventFlowSourceRef;
			readonly issue?: undefined;
	  }
	| { readonly source: EventFlowSourceRef; readonly issue: DataIssue } {
	const envelope = messageEnvelopeOf(raw);
	const value = envelope?.payload ?? raw;
	const sourceRef: EventFlowSourceRef =
		envelope === undefined
			? { source, ...(eventIdOf(value) === undefined ? {} : { messageId: eventIdOf(value) }) }
			: {
					source,
					topic: envelope.topic,
					seq: envelope.seq,
					messageId: envelope.payload.id,
					...(envelope.idempotencyKey === undefined
						? {}
						: { idempotencyKey: envelope.idempotencyKey }),
				};
	const issue = eventMessageIssue(value);
	if (issue !== undefined) {
		return {
			source: sourceRef,
			issue: dataIssue(issue.code, issue.message, { source: sourceRef, value }),
		};
	}
	return { event: value as EventMessage, source: sourceRef };
}

function messageEnvelopeOf(value: unknown): MessageEnvelope<EventMessage> | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.topic !== "string" ||
		!Number.isInteger(value.seq) ||
		typeof value.timestampMs !== "number" ||
		!("payload" in value)
	) {
		return undefined;
	}
	const payloadIssue = eventMessageIssue(value.payload);
	return payloadIssue === undefined
		? (value as unknown as MessageEnvelope<EventMessage>)
		: undefined;
}

function normalizeSources<T>(
	sources: readonly EventFlowSourceInput<T>[],
): readonly EventFlowSource[] {
	if (sources.length === 0) throw new Error("eventFlow: sources must be non-empty");
	return sources.map((source, index) => {
		if (isRecord(source) && "node" in source) {
			if (typeof source.source !== "string" || source.source.length === 0) {
				throw new Error("eventFlow: source name must be non-empty");
			}
			return source as EventFlowSource;
		}
		return { source: `source-${index}`, node: source as EventFlowSource["node"] };
	});
}

function runtimeProjection<TOut, T>(
	graph: Graph,
	runtime: Node<EventFlowRuntimeFact<T>>,
	kind: EventFlowRuntimeFact<T>["kind"],
	name: string,
	factory: string,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as EventFlowRuntimeFact<T>;
				if (typed.kind === kind) ctx.down([["DATA", valueOfRuntimeFact(typed) as TOut]]);
			}
		},
		{ name, factory, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function projectionRuntime<TOut, TFact extends { readonly kind: string }>(
	graph: Graph,
	runtime: Node<TFact>,
	kind: TFact["kind"],
	name: string,
	factory: string,
	map: (fact: Extract<TFact, { readonly kind: typeof kind }>) => TOut = valueOfRuntimeFact as never,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as TFact;
				if (typed.kind === kind) ctx.down([["DATA", map(typed as never)]]);
			}
		},
		{ name, factory, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function valueOfRuntimeFact(fact: { readonly kind: string }): unknown {
	if ("record" in fact) return fact.record;
	if ("status" in fact) return fact.status;
	if ("issue" in fact) return fact.issue;
	if ("audit" in fact) return fact.audit;
	if ("highWater" in fact) return fact.highWater;
	if ("frame" in fact) return fact.frame;
	return undefined;
}

function auditRecord(
	flowId: string,
	state: EventFlowRuntimeState,
	outcome: "recorded" | "rejected",
	timestampMs: number,
	opts: {
		readonly source?: EventFlowSourceRef;
		readonly eventId?: string;
		readonly eventType?: string;
		readonly issueCode?: string;
	},
): EventFlowAuditRecord {
	return {
		seq: ++state.auditSeq,
		flowId,
		outcome,
		...(opts.eventId === undefined ? {} : { eventId: opts.eventId }),
		...(opts.eventType === undefined ? {} : { eventType: opts.eventType }),
		...(opts.issueCode === undefined ? {} : { issueCode: opts.issueCode }),
		...(opts.source === undefined ? {} : { source: opts.source }),
		highWater: highWaterSnapshot(flowId, state),
		timestampMs,
	};
}

function highWaterSnapshot(flowId: string, state: EventFlowRuntimeState): EventFlowHighWater {
	return {
		flowId,
		recordSeq: state.recordSeq,
		auditSeq: state.auditSeq,
		sources: [...state.highWater.values()].sort(
			(a, b) => a.source.localeCompare(b.source) || (a.topic ?? "").localeCompare(b.topic ?? ""),
		),
	};
}

function emptyHighWater(flowId: string): EventFlowHighWater {
	return { flowId, recordSeq: 0, auditSeq: 0, sources: [] };
}

function projectionHighWater(
	flowId: string,
	record: EventFlowRecord,
	sourceHighWater: Map<string, EventFlowSourceHighWater>,
): EventFlowHighWater {
	sourceHighWater.set(sourceKey(record.source), {
		source: record.source.source,
		...(record.source.topic === undefined ? {} : { topic: record.source.topic }),
		...(record.source.seq === undefined ? {} : { seq: record.source.seq }),
		messageId: record.event.id,
		recordSeq: record.recordSeq,
	});
	return {
		flowId,
		recordSeq: record.recordSeq,
		auditSeq: 0,
		sources: [...sourceHighWater.values()].sort(
			(a, b) => a.source.localeCompare(b.source) || (a.topic ?? "").localeCompare(b.topic ?? ""),
		),
	};
}

function sourceKey(source: EventFlowSourceRef): string {
	return canonicalTupleKey([source.source, source.topic ?? ""]);
}

function eventIdOf(value: unknown): string | undefined {
	return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

function dataIssue(code: string, message: string, details?: unknown): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: "error",
		source: "eventFlow",
		...(details === undefined ? {} : { details }),
	};
}

function isEventFlowBundle<T>(value: unknown): value is EventFlowBundle<T> {
	return isRecord(value) && "records" in value && "highWater" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
