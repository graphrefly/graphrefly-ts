/**
 * Reusable application-infrastructure CQRS helpers (B63 / D125 / D129).
 *
 * The bundle is graph-visible facts over ordinary nodes: command DATA facts
 * enter through a graph-owned command node, command handlers run inside the
 * dispatched runtime node, and events/status/errors/audit/cursor are derived
 * facts. It is not a Graph subclass, hidden EventEmitter, saga runtime, or
 * storage-owned restore surface.
 */

import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";

/** Command fact accepted by a CQRS bundle. */
export interface CqrsCommand<T = unknown> {
	readonly id: string;
	readonly type: string;
	readonly payload: T;
	readonly aggregateId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

/** Event draft returned by a command handler before the runtime orders it. */
export interface CqrsEventDraft<T = unknown> {
	readonly id?: string;
	readonly type: string;
	readonly payload: T;
	readonly aggregateId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

/** Ordered event fact emitted by the CQRS runtime node. */
export interface CqrsEvent<T = unknown> {
	readonly id: string;
	readonly type: string;
	readonly seq: number;
	readonly cursor: number;
	readonly runtimeCursor: CqrsCursor;
	readonly commandId: string;
	readonly commandType: string;
	readonly payload: T;
	readonly timestampMs: number;
	readonly aggregateId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

export type CqrsErrorCode =
	| "malformed-command"
	| "duplicate-command"
	| "unknown-command"
	| "handler-threw"
	| "clock-threw"
	| "malformed-event"
	| "unknown-event"
	| "duplicate-event";

/** Graph-visible CQRS error fact. These are DATA facts, not protocol ERROR. */
export interface CqrsError {
	readonly code: CqrsErrorCode;
	readonly message: string;
	readonly command?: unknown;
	readonly commandId?: string;
	readonly commandType?: string;
	readonly event?: unknown;
	readonly eventType?: string;
	readonly cursor: CqrsCursor;
}

export interface CqrsStatus {
	readonly state: "accepted" | "rejected";
	readonly commandId?: string;
	readonly commandType?: string;
	readonly eventCount: number;
	readonly errorCode?: CqrsErrorCode;
	readonly cursor: CqrsCursor;
}

export interface CqrsAuditRecord {
	readonly seq: number;
	readonly commandId?: string;
	readonly commandType?: string;
	readonly outcome: "success" | "failure";
	readonly eventIds: readonly string[];
	readonly eventTypes: readonly string[];
	readonly errorCode?: CqrsErrorCode;
	readonly errorMessage?: string;
	readonly cursor: CqrsCursor;
}

export interface CqrsDedupeSnapshot {
	readonly commandIdsRetained: number;
	readonly eventIdsRetained: number;
	readonly commandIdsEvicted: number;
	readonly eventIdsEvicted: number;
}

export interface CqrsCursor {
	readonly eventSeq: number;
	readonly commandCount: number;
	readonly errorCount: number;
	readonly auditSeq: number;
	readonly dedupe?: CqrsDedupeSnapshot;
}

export type CqrsRuntimeFact<T = unknown> =
	| { readonly kind: "event"; readonly event: CqrsEvent<T> }
	| { readonly kind: "status"; readonly status: CqrsStatus }
	| { readonly kind: "error"; readonly error: CqrsError }
	| { readonly kind: "audit"; readonly audit: CqrsAuditRecord }
	| { readonly kind: "cursor"; readonly cursor: CqrsCursor };

export type CqrsCommandHandler<TCommand = unknown, TEvent = unknown> = (
	command: CqrsCommand<TCommand>,
) => readonly CqrsEventDraft<TEvent>[];

export interface CqrsCommandHandlerDefinition<TCommand = unknown, TEvent = unknown> {
	readonly type: string;
	readonly handle: CqrsCommandHandler<TCommand, TEvent>;
}

export interface CqrsOptions<TCommand = unknown, TEvent = unknown> {
	readonly name?: string;
	readonly handlers?: readonly CqrsCommandHandlerDefinition<TCommand, TEvent>[];
	readonly events?: readonly string[];
	readonly now?: () => number;
	/**
	 * D142: static command/event duplicate-recognition windows. Omitted means
	 * exact unbounded dedupe; bounded windows evict oldest ids by insertion order.
	 */
	readonly dedupe?: CqrsDedupePolicy;
}

export type CqrsDedupeWindow = "unbounded" | { readonly maxEntries: number };

export interface CqrsDedupePolicy {
	readonly commands?: CqrsDedupeWindow;
	readonly events?: CqrsDedupeWindow;
}

export interface CqrsBundle<TCommand = unknown, TEvent = unknown> {
	readonly command: Node<CqrsCommand<TCommand>>;
	readonly runtime: Node<CqrsRuntimeFact<TEvent>>;
	readonly events: Node<CqrsEvent<TEvent>>;
	readonly status: Node<CqrsStatus>;
	readonly errors: Node<CqrsError>;
	readonly audit: Node<CqrsAuditRecord>;
	readonly cursor: Node<CqrsCursor>;
	dispatch(command: CqrsCommand<TCommand>): CqrsCommand<TCommand>;
}

interface CqrsRuntimeState {
	eventSeq: number;
	commandCount: number;
	errorCount: number;
	auditSeq: number;
	seenCommandIds: string[];
	seenEventIds: string[];
	commandDedupeEvicted?: number;
	eventDedupeEvicted?: number;
}

interface HandlerRecord {
	readonly type: string;
	readonly handle: CqrsCommandHandler<unknown, unknown>;
}

interface NormalizedCqrsDedupePolicy {
	readonly commandMaxEntries?: number;
	readonly eventMaxEntries?: number;
	readonly bounded: boolean;
}

/** Convenience helper for declaring typed command handlers in a CQRS bundle. */
export function cqrsCommandHandler<TCommand = unknown, TEvent = unknown>(
	type: string,
	handle: CqrsCommandHandler<TCommand, TEvent>,
): CqrsCommandHandlerDefinition<TCommand, TEvent> {
	if (type.length === 0) throw new Error("cqrsCommandHandler: type must be non-empty");
	return { type, handle };
}

/**
 * Create a graph-visible CQRS bundle. Command dispatch is only DATA on the
 * returned `command` node; all derived facts flow through declared graph deps.
 */
export function cqrs<TCommand = unknown, TEvent = unknown>(
	graph: Graph,
	opts: CqrsOptions<TCommand, TEvent> = {},
): CqrsBundle<TCommand, TEvent> {
	const name = opts.name ?? "cqrs";
	const handlers = normalizeHandlers(opts.handlers ?? []);
	const knownEvents =
		opts.events === undefined ? undefined : new Set(uniqueNames(opts.events, "cqrs.events"));
	const now = opts.now ?? Date.now;
	const dedupe = normalizeDedupePolicy(opts.dedupe);
	const command = graph.node<CqrsCommand<TCommand>>([], null, {
		name: `${name}/command`,
		factory: "cqrsCommand",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const runtime = graph.node<CqrsRuntimeFact<TEvent>>(
		[command],
		(ctx) => {
			const state =
				ctx.state.get<CqrsRuntimeState>() ??
				({
					eventSeq: 0,
					commandCount: 0,
					errorCount: 0,
					auditSeq: 0,
					seenCommandIds: [],
					seenEventIds: [],
				} satisfies CqrsRuntimeState);
			ctx.state.persist(true);
			for (const raw of depBatch(ctx, 0) ?? []) {
				reduceCommandFact(raw, state, handlers, knownEvents, now, dedupe, (fact) =>
					ctx.down([["DATA", fact as CqrsRuntimeFact<TEvent>]]),
				);
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/runtime`,
			factory: "cqrsRuntime",
			meta: {
				commandTypes: [...handlers.keys()],
				eventTypes: knownEvents ? [...knownEvents] : "open",
				dedupe: dedupeMeta(dedupe),
			},
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const events = runtimeProjection<CqrsEvent<TEvent>, TEvent>(
		graph,
		runtime,
		"event",
		`${name}/events`,
		"cqrsEvents",
		(fact) => (fact.kind === "event" ? fact.event : undefined),
	);
	const status = runtimeProjection<CqrsStatus, TEvent>(
		graph,
		runtime,
		"status",
		`${name}/status`,
		"cqrsStatus",
		(fact) => (fact.kind === "status" ? fact.status : undefined),
	);
	const errors = runtimeProjection<CqrsError, TEvent>(
		graph,
		runtime,
		"error",
		`${name}/errors`,
		"cqrsErrors",
		(fact) => (fact.kind === "error" ? fact.error : undefined),
	);
	const audit = runtimeProjection<CqrsAuditRecord, TEvent>(
		graph,
		runtime,
		"audit",
		`${name}/audit`,
		"cqrsAudit",
		(fact) => (fact.kind === "audit" ? fact.audit : undefined),
	);
	const cursor = runtimeProjection<CqrsCursor, TEvent>(
		graph,
		runtime,
		"cursor",
		`${name}/cursor`,
		"cqrsCursor",
		(fact) => (fact.kind === "cursor" ? fact.cursor : undefined),
	);
	graph.retain(runtime, { reason: `${name}.cqrs.runtime` });
	graph.retain(events, { reason: `${name}.cqrs.events` });
	graph.retain(status, { reason: `${name}.cqrs.status` });
	graph.retain(errors, { reason: `${name}.cqrs.errors` });
	graph.retain(audit, { reason: `${name}.cqrs.audit` });
	graph.retain(cursor, { reason: `${name}.cqrs.cursor` });
	return {
		command,
		runtime,
		events,
		status,
		errors,
		audit,
		cursor,
		dispatch(commandFact) {
			command.down([["DATA", commandFact]]);
			return commandFact;
		},
	};
}

export interface CqrsProjectionOptions<TState, TEvent = unknown> {
	readonly name?: string;
	readonly events?: readonly string[];
	readonly initial: TState;
	readonly reducer: (state: TState, event: CqrsEvent<TEvent>) => TState;
}

export type CqrsProjectionFrame<TState> =
	| {
			readonly kind: "value";
			readonly state: TState;
			readonly eventId: string;
			readonly cursor: CqrsCursor;
	  }
	| { readonly kind: "error"; readonly error: CqrsProjectionError };

export interface CqrsProjectionError {
	readonly code: "projection-threw";
	readonly message: string;
	readonly eventId: string;
	readonly eventType: string;
	readonly cursor: CqrsCursor;
}

export interface CqrsProjectionStatus {
	readonly state: "updated" | "errored";
	readonly eventId: string;
	readonly eventType?: string;
	readonly cursor: CqrsCursor;
}

export interface CqrsProjection<TState> {
	readonly frames: Node<CqrsProjectionFrame<TState>>;
	readonly value: Node<TState>;
	readonly status: Node<CqrsProjectionStatus>;
	readonly errors: Node<CqrsProjectionError>;
}

/**
 * Derive a projection from declared CQRS event deps. Reducer failures become
 * graph-visible error DATA facts on the returned `errors` node.
 */
export function cqrsProjection<TState, TEvent = unknown>(
	graph: Graph,
	source: Pick<CqrsBundle<unknown, TEvent>, "events">,
	opts: CqrsProjectionOptions<TState, TEvent>,
): CqrsProjection<TState> {
	const name = opts.name ?? "cqrsProjection";
	const eventFilter =
		opts.events === undefined
			? undefined
			: new Set(uniqueNames(opts.events, "cqrsProjection.events"));
	const frames = graph.node<CqrsProjectionFrame<TState>>(
		[source.events],
		(ctx) => {
			const state = ctx.state.get<{ value: TState }>() ?? { value: opts.initial };
			ctx.state.persist(true);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as CqrsEvent<TEvent>;
				if (eventFilter !== undefined && !eventFilter.has(event.type)) continue;
				try {
					state.value = opts.reducer(state.value, event);
					ctx.state.set(state);
					ctx.down([
						[
							"DATA",
							{
								kind: "value",
								state: state.value,
								eventId: event.id,
								cursor: event.runtimeCursor,
							} satisfies CqrsProjectionFrame<TState>,
						],
					]);
				} catch (error) {
					rethrowGraphRuntimeInvariant(error);
					ctx.down([
						[
							"DATA",
							{
								kind: "error",
								error: {
									code: "projection-threw",
									message: errorMessage(error),
									eventId: event.id,
									eventType: event.type,
									cursor: event.runtimeCursor,
								},
							} satisfies CqrsProjectionFrame<TState>,
						],
					]);
					return;
				}
			}
		},
		{
			name,
			factory: "cqrsProjection",
			meta: { eventTypes: eventFilter ? [...eventFilter] : "open" },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const value = graph.node<TState>(
		[frames],
		(ctx) => {
			for (const frame of depBatch(ctx, 0) ?? []) {
				const typed = frame as CqrsProjectionFrame<TState>;
				if (typed.kind === "value") ctx.down([["DATA", typed.state]]);
			}
		},
		{
			name: `${name}/value`,
			factory: "cqrsProjectionValue",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const errors = graph.node<CqrsProjectionError>(
		[frames],
		(ctx) => {
			for (const frame of depBatch(ctx, 0) ?? []) {
				const typed = frame as CqrsProjectionFrame<TState>;
				if (typed.kind === "error") ctx.down([["DATA", typed.error]]);
			}
		},
		{
			name: `${name}/errors`,
			factory: "cqrsProjectionErrors",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const status = graph.node<CqrsProjectionStatus>(
		[frames],
		(ctx) => {
			for (const frame of depBatch(ctx, 0) ?? []) {
				const typed = frame as CqrsProjectionFrame<TState>;
				if (typed.kind === "value") {
					ctx.down([
						[
							"DATA",
							{
								state: "updated",
								eventId: typed.eventId,
								cursor: typed.cursor,
							} satisfies CqrsProjectionStatus,
						],
					]);
				} else {
					ctx.down([
						[
							"DATA",
							{
								state: "errored",
								eventId: typed.error.eventId,
								eventType: typed.error.eventType,
								cursor: typed.error.cursor,
							} satisfies CqrsProjectionStatus,
						],
					]);
				}
			}
		},
		{
			name: `${name}/status`,
			factory: "cqrsProjectionStatus",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	graph.retain(frames, { reason: `${name}.cqrsProjection.frames` });
	graph.retain(value, { reason: `${name}.cqrsProjection.value` });
	graph.retain(status, { reason: `${name}.cqrsProjection.status` });
	graph.retain(errors, { reason: `${name}.cqrsProjection.errors` });
	return { frames, value, status, errors };
}

function normalizeHandlers<TCommand, TEvent>(
	definitions: readonly CqrsCommandHandlerDefinition<TCommand, TEvent>[],
): ReadonlyMap<string, HandlerRecord> {
	const handlers = new Map<string, HandlerRecord>();
	for (const definition of definitions) {
		if (definition.type.length === 0) throw new Error("cqrs: handler type must be non-empty");
		if (handlers.has(definition.type))
			throw new Error(`cqrs: duplicate handler '${definition.type}'`);
		handlers.set(definition.type, {
			type: definition.type,
			handle: definition.handle as CqrsCommandHandler<unknown, unknown>,
		});
	}
	return handlers;
}

function reduceCommandFact<TEvent>(
	raw: unknown,
	state: CqrsRuntimeState,
	handlers: ReadonlyMap<string, HandlerRecord>,
	knownEvents: ReadonlySet<string> | undefined,
	now: () => number,
	dedupe: NormalizedCqrsDedupePolicy,
	emit: (fact: CqrsRuntimeFact<TEvent>) => void,
): void {
	state.commandCount += 1;
	const parsed = parseCommand(raw);
	if (typeof parsed === "string") {
		emitFailure(state, emit, raw, undefined, "malformed-command", parsed, dedupe);
		return;
	}
	const command = parsed as CqrsCommand<unknown>;
	if (state.seenCommandIds.includes(command.id)) {
		emitFailure(
			state,
			emit,
			command,
			command,
			"duplicate-command",
			`cqrs: duplicate command '${command.id}'`,
			dedupe,
		);
		return;
	}
	state.seenCommandIds.push(command.id);
	trimDedupeWindow(state.seenCommandIds, dedupe.commandMaxEntries, (evicted) => {
		state.commandDedupeEvicted = (state.commandDedupeEvicted ?? 0) + evicted;
	});
	const handler = handlers.get(command.type);
	if (handler === undefined) {
		emitFailure(
			state,
			emit,
			command,
			command,
			"unknown-command",
			`cqrs: unknown command '${command.type}'`,
			dedupe,
		);
		return;
	}
	let drafts: readonly CqrsEventDraft<unknown>[];
	try {
		drafts = handler.handle(command);
	} catch (error) {
		rethrowGraphRuntimeInvariant(error);
		emitFailure(state, emit, command, command, "handler-threw", errorMessage(error), dedupe);
		return;
	}
	if (!Array.isArray(drafts)) {
		emitFailure(
			state,
			emit,
			command,
			command,
			"malformed-event",
			"cqrs: command handler must return an event draft array",
			dedupe,
		);
		return;
	}
	const prepared = prepareEvents(command, drafts, state, knownEvents);
	if (typeof prepared === "string") {
		emitFailure(state, emit, command, command, preparedCode(prepared), prepared, dedupe);
		return;
	}
	const timestampMs = readTimestampMs(now);
	if (typeof timestampMs === "string") {
		emitFailure(state, emit, command, command, "clock-threw", timestampMs, dedupe);
		return;
	}
	const events: CqrsEvent<unknown>[] = [];
	for (const draft of prepared) {
		state.eventSeq += 1;
		state.seenEventIds.push(draft.id);
		trimDedupeWindow(state.seenEventIds, dedupe.eventMaxEntries, (evicted) => {
			state.eventDedupeEvicted = (state.eventDedupeEvicted ?? 0) + evicted;
		});
		const runtimeCursor = cursorOf(state, dedupe);
		events.push({
			id: draft.id,
			type: draft.type,
			seq: state.eventSeq,
			cursor: state.eventSeq,
			runtimeCursor,
			commandId: command.id,
			commandType: command.type,
			payload: draft.payload,
			timestampMs,
			...(draft.aggregateId === undefined ? {} : { aggregateId: draft.aggregateId }),
			...(draft.correlationId === undefined ? {} : { correlationId: draft.correlationId }),
			...(draft.causationId === undefined ? {} : { causationId: draft.causationId }),
			...(draft.metadata === undefined ? {} : { metadata: draft.metadata }),
		});
	}
	for (const event of events) emit({ kind: "event", event: event as CqrsEvent<TEvent> });
	emitStatus(state, emit, command, "accepted", events.length, dedupe);
	emitAudit(state, emit, command, "success", events, undefined, undefined, dedupe);
	emit({ kind: "cursor", cursor: cursorOf(state, dedupe) });
}

function parseCommand(value: unknown): CqrsCommand<unknown> | string {
	if (!isObjectRecord(value)) return "cqrs: command fact must be an object";
	if (typeof value.id !== "string" || value.id.length === 0) {
		return "cqrs: command id must be a non-empty string";
	}
	if (typeof value.type !== "string" || value.type.length === 0) {
		return "cqrs: command type must be a non-empty string";
	}
	return {
		id: value.id,
		type: value.type,
		payload: value.payload,
		...(typeof value.aggregateId === "string" ? { aggregateId: value.aggregateId } : {}),
		...(typeof value.correlationId === "string" ? { correlationId: value.correlationId } : {}),
		...(typeof value.causationId === "string" ? { causationId: value.causationId } : {}),
		...(isObjectRecord(value.metadata) ? { metadata: value.metadata } : {}),
	};
}

function prepareEvents(
	command: CqrsCommand<unknown>,
	drafts: readonly CqrsEventDraft<unknown>[],
	state: CqrsRuntimeState,
	knownEvents: ReadonlySet<string> | undefined,
): Array<CqrsEventDraft<unknown> & { readonly id: string }> | string {
	const seenInCommand = new Set<string>();
	const prepared: Array<CqrsEventDraft<unknown> & { readonly id: string }> = [];
	for (let i = 0; i < drafts.length; i += 1) {
		const draft = drafts[i];
		if (!isObjectRecord(draft) || typeof draft.type !== "string" || draft.type.length === 0) {
			return "cqrs: event draft must have a non-empty type";
		}
		if (knownEvents !== undefined && !knownEvents.has(draft.type)) {
			return `cqrs: unknown event '${draft.type}'`;
		}
		const id =
			typeof draft.id === "string" && draft.id.length > 0 ? draft.id : `${command.id}:${i + 1}`;
		if (state.seenEventIds.includes(id) || seenInCommand.has(id)) {
			return `cqrs: duplicate event '${id}'`;
		}
		seenInCommand.add(id);
		prepared.push({
			id,
			type: draft.type,
			payload: draft.payload,
			...(typeof draft.aggregateId === "string" ? { aggregateId: draft.aggregateId } : {}),
			...(typeof draft.correlationId === "string" ? { correlationId: draft.correlationId } : {}),
			...(typeof draft.causationId === "string" ? { causationId: draft.causationId } : {}),
			...(isObjectRecord(draft.metadata) ? { metadata: draft.metadata } : {}),
		});
	}
	return prepared;
}

function preparedCode(message: string): CqrsErrorCode {
	if (message.includes("unknown event")) return "unknown-event";
	if (message.includes("duplicate event")) return "duplicate-event";
	return "malformed-event";
}

function rethrowGraphRuntimeInvariant(error: unknown): void {
	const message = errorMessage(error);
	if (
		message.includes("R-reentrancy") ||
		message.includes("R-rewire") ||
		message.includes("R-graph-domain") ||
		message.includes("D37") ||
		message.includes("D22") ||
		message.includes("different graph") ||
		message.includes("cross-graph") ||
		message.includes("wire bridge") ||
		message.includes("mid-fn topology mutation") ||
		message.includes("reentrant dep mutation") ||
		message.includes("feedback cycle")
	) {
		throw error;
	}
}

function emitFailure<TEvent>(
	state: CqrsRuntimeState,
	emit: (fact: CqrsRuntimeFact<TEvent>) => void,
	raw: unknown,
	command: CqrsCommand<unknown> | undefined,
	code: CqrsErrorCode,
	message: string,
	dedupe: NormalizedCqrsDedupePolicy,
): void {
	state.errorCount += 1;
	const cursor = cursorOf(state, dedupe);
	const error: CqrsError = {
		code,
		message,
		command: raw,
		...(command === undefined ? {} : { commandId: command.id, commandType: command.type }),
		cursor,
	};
	emit({ kind: "error", error });
	emit({
		kind: "status",
		status: {
			state: "rejected",
			...(command === undefined ? {} : { commandId: command.id, commandType: command.type }),
			eventCount: 0,
			errorCode: code,
			cursor,
		},
	});
	emitAudit(state, emit, command, "failure", [], code, message, dedupe);
	emit({ kind: "cursor", cursor: cursorOf(state, dedupe) });
}

function emitStatus<TEvent>(
	state: CqrsRuntimeState,
	emit: (fact: CqrsRuntimeFact<TEvent>) => void,
	command: CqrsCommand<unknown>,
	statusState: "accepted" | "rejected",
	eventCount: number,
	dedupe: NormalizedCqrsDedupePolicy,
): void {
	emit({
		kind: "status",
		status: {
			state: statusState,
			commandId: command.id,
			commandType: command.type,
			eventCount,
			cursor: cursorOf(state, dedupe),
		},
	});
}

function emitAudit<TEvent>(
	state: CqrsRuntimeState,
	emit: (fact: CqrsRuntimeFact<TEvent>) => void,
	command: CqrsCommand<unknown> | undefined,
	outcome: "success" | "failure",
	events: readonly CqrsEvent<unknown>[],
	errorCode: CqrsErrorCode | undefined,
	errorMessageValue: string | undefined,
	dedupe: NormalizedCqrsDedupePolicy,
): void {
	state.auditSeq += 1;
	emit({
		kind: "audit",
		audit: {
			seq: state.auditSeq,
			...(command === undefined ? {} : { commandId: command.id, commandType: command.type }),
			outcome,
			eventIds: Object.freeze(events.map((event) => event.id)),
			eventTypes: Object.freeze(events.map((event) => event.type)),
			...(errorCode === undefined ? {} : { errorCode }),
			...(errorMessageValue === undefined ? {} : { errorMessage: errorMessageValue }),
			cursor: cursorOf(state, dedupe),
		},
	});
}

function runtimeProjection<TOut, TEvent>(
	graph: Graph,
	runtime: Node<CqrsRuntimeFact<TEvent>>,
	kind: CqrsRuntimeFact<TEvent>["kind"],
	name: string,
	factory: string,
	select: (fact: CqrsRuntimeFact<TEvent>) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as CqrsRuntimeFact<TEvent>;
				if (typed.kind !== kind) continue;
				const selected = select(typed);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{
			name,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function cursorOf(state: CqrsRuntimeState, dedupe: NormalizedCqrsDedupePolicy): CqrsCursor {
	return {
		eventSeq: state.eventSeq,
		commandCount: state.commandCount,
		errorCount: state.errorCount,
		auditSeq: state.auditSeq,
		...(dedupe.bounded
			? {
					dedupe: {
						commandIdsRetained: state.seenCommandIds.length,
						eventIdsRetained: state.seenEventIds.length,
						commandIdsEvicted: state.commandDedupeEvicted ?? 0,
						eventIdsEvicted: state.eventDedupeEvicted ?? 0,
					},
				}
			: {}),
	};
}

function normalizeDedupePolicy(policy: CqrsDedupePolicy | undefined): NormalizedCqrsDedupePolicy {
	const commandMaxEntries = normalizeDedupeWindow(policy?.commands, "cqrs.dedupe.commands");
	const eventMaxEntries = normalizeDedupeWindow(policy?.events, "cqrs.dedupe.events");
	return {
		...(commandMaxEntries === undefined ? {} : { commandMaxEntries }),
		...(eventMaxEntries === undefined ? {} : { eventMaxEntries }),
		bounded: commandMaxEntries !== undefined || eventMaxEntries !== undefined,
	};
}

function normalizeDedupeWindow(
	window: CqrsDedupeWindow | undefined,
	owner: string,
): number | undefined {
	if (window === undefined || window === "unbounded") return undefined;
	if (!Number.isInteger(window.maxEntries) || window.maxEntries < 0) {
		throw new RangeError(`${owner}: maxEntries must be a non-negative integer`);
	}
	return window.maxEntries;
}

function dedupeMeta(dedupe: NormalizedCqrsDedupePolicy): unknown {
	if (!dedupe.bounded) return "unbounded";
	return {
		commands:
			dedupe.commandMaxEntries === undefined
				? "unbounded"
				: { maxEntries: dedupe.commandMaxEntries },
		events:
			dedupe.eventMaxEntries === undefined ? "unbounded" : { maxEntries: dedupe.eventMaxEntries },
	};
}

function trimDedupeWindow(
	ids: string[],
	maxEntries: number | undefined,
	onEvicted: (evicted: number) => void,
): void {
	if (maxEntries === undefined || ids.length <= maxEntries) return;
	const evicted = ids.length - maxEntries;
	ids.splice(0, evicted);
	onEvicted(evicted);
}

function readTimestampMs(now: () => number): number | string {
	try {
		const timestampMs = now();
		return Number.isFinite(timestampMs) ? timestampMs : "cqrs: now() must return a finite number";
	} catch (error) {
		return `cqrs: now() threw: ${errorMessage(error)}`;
	}
}

function uniqueNames(values: readonly string[], owner: string): readonly string[] {
	const unique = [...new Set(values)];
	if (unique.length !== values.length) throw new Error(`${owner}: duplicate value`);
	for (const value of unique) {
		if (value.length === 0) throw new Error(`${owner}: values must be non-empty`);
	}
	return Object.freeze(unique);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
