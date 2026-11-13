import { moduleName } from "../graph/module-naming.js";
/**
 * Reusable application-infrastructure CQRS helpers (B63 / D125 / D129).
 *
 * The bundle is graph-visible facts over ordinary nodes: command DATA facts
 * enter through a graph-owned command node, command handlers run inside the
 * dispatched runtime node, and events/status/errors/audit/cursor are derived
 * facts. It is not a Graph subclass, hidden EventEmitter, saga runtime, or
 * storage-owned restore surface.
 */

import type { NodeFn } from "../ctx/types.js";
import { toCheckpointJson } from "../graph/checkpoint.js";
import type { Graph } from "../graph/graph.js";
import type { GraphRecipeContext, GraphRecipeFactory } from "../graph/restore.js";
import { compoundTupleKey } from "../identity.js";
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
	/**
	 * R-checkpoint@1: the ref under which the restoring caller registers `handle` as a definition
	 * (`{ kind: "definition", ref, fn: handle }`). A bundle with a handler that has none keeps its
	 * runtime local-only.
	 */
	readonly ref?: string;
}

export interface CqrsOptions<TCommand = unknown, TEvent = unknown> {
	readonly name?: string;
	readonly handlers?: readonly CqrsCommandHandlerDefinition<TCommand, TEvent>[];
	readonly events?: readonly string[];
	readonly now?: () => number;
	/**
	 * R-checkpoint@1: the ref under which the restoring caller registers `now` as a definition. A
	 * custom `now` without it leaves the runtime local-only; the default clock needs none.
	 */
	readonly nowRef?: string;
	/**
	 * D142: static command/event duplicate-recognition windows. Omitted means
	 * exact unbounded dedupe; bounded windows evict oldest ids by insertion order.
	 */
	readonly dedupe?: CqrsDedupePolicy;
}

/**
 * D151 membership-based duplicate-recognition window for CQRS ids.
 *
 * This is passive CQRS vocabulary, not a shared idempotency reducer engine:
 * commands and events each own their own id membership window.
 */
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
	readonly ref?: string;
}

interface NormalizedCqrsDedupePolicy {
	readonly commandMaxEntries?: number;
	readonly eventMaxEntries?: number;
	readonly bounded: boolean;
}

/** Convenience helper for declaring typed command handlers in a CQRS bundle.
 * @param type - type value used by the helper.
 * @param handle - handle value used by the helper.
 * @param opts - `ref`: the definition ref that names `handle` in a checkpoint (R-checkpoint@1).
 * @returns A `CqrsCommandHandlerDefinition<TCommand, TEvent>` value.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsCommandHandler } from "@graphrefly/ts/cqrs";
 * ```
 */
export function cqrsCommandHandler<TCommand = unknown, TEvent = unknown>(
	type: string,
	handle: CqrsCommandHandler<TCommand, TEvent>,
	opts: { readonly ref?: string } = {},
): CqrsCommandHandlerDefinition<TCommand, TEvent> {
	if (type.length === 0) throw new Error("cqrsCommandHandler: type must be non-empty");
	if (opts.ref !== undefined && opts.ref.length === 0)
		throw new Error("cqrsCommandHandler: ref must be non-empty");
	return { type, handle, ...(opts.ref === undefined ? {} : { ref: opts.ref }) };
}

/**
 * Create a graph-visible CQRS bundle. Command dispatch is only DATA on the
 * returned `command` node; all derived facts flow through declared graph deps.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A `CqrsBundle<TCommand, TEvent>` value.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrs } from "@graphrefly/ts/cqrs";
 * ```
 */
export function cqrs<TCommand = unknown, TEvent = unknown>(
	graph: Graph,
	opts: CqrsOptions<TCommand, TEvent> = {},
): CqrsBundle<TCommand, TEvent> {
	const name = moduleName(graph, opts.name, "cqrs");
	const handlers = normalizeHandlers(opts.handlers ?? []);
	const knownEvents =
		opts.events === undefined ? undefined : new Set(uniqueNames(opts.events, "cqrs.events"));
	if (opts.nowRef !== undefined && opts.now === undefined) {
		throw new TypeError("cqrs: nowRef names the clock given as now");
	}
	const now = opts.now ?? Date.now;
	const dedupe = normalizeDedupePolicy(opts.dedupe);
	const command = graph.node<CqrsCommand<TCommand>>([], null, {
		name: `${name}/command`,
		factory: "cqrsCommand",
		complete: "manual",
		error: "manual",
	});
	// R-checkpoint@1: the runtime's recipe names each handler and the clock by ref; a user
	// function with no ref cannot be named, so the runtime is then local-only.
	const handlerRefs = [...handlers.values()].map((h) => ({ type: h.type, ref: h.ref }));
	const runtimeConfig: CqrsRuntimeConfig | undefined =
		handlerRefs.every((h) => h.ref !== undefined) &&
		(opts.now === undefined || opts.nowRef !== undefined)
			? {
					handlers: handlerRefs as { type: string; ref: string }[],
					...(knownEvents === undefined ? {} : { events: [...knownEvents] }),
					dedupe: {
						...(dedupe.commandMaxEntries === undefined
							? {}
							: { commands: dedupe.commandMaxEntries }),
						...(dedupe.eventMaxEntries === undefined ? {} : { events: dedupe.eventMaxEntries }),
					},
					...(opts.nowRef === undefined ? {} : { nowRef: opts.nowRef }),
				}
			: undefined;
	const runtime = graph.node<CqrsRuntimeFact<TEvent>>(
		[command],
		cqrsRuntimeFn(handlers, knownEvents, now, dedupe),
		{
			name: `${name}/runtime`,
			factory: "cqrsRuntime",
			meta: {
				commandTypes: [...handlers.keys()],
				eventTypes: knownEvents ? [...knownEvents] : "open",
				dedupe: dedupeMeta(dedupe),
			},
			complete: "manual",
			error: "manual",
			...(runtimeConfig === undefined
				? {}
				: { recipe: { ref: CQRS_RUNTIME_REF, config: runtimeConfig } }),
		},
	);
	const project = <TOut>(kind: CqrsRuntimeFact["kind"], suffix: string, factory: string) =>
		runtimeProjection<TOut>(graph, runtime, kind, `${name}/${suffix}`, factory);
	const events = project<CqrsEvent<TEvent>>("event", "events", "cqrsEvents");
	const status = project<CqrsStatus>("status", "status", "cqrsStatus");
	const errors = project<CqrsError>("error", "errors", "cqrsErrors");
	const audit = project<CqrsAuditRecord>("audit", "audit", "cqrsAudit");
	const cursor = project<CqrsCursor>("cursor", "cursor", "cqrsCursor");
	graph.retain(runtime);
	graph.retain(events);
	graph.retain(status);
	graph.retain(errors);
	graph.retain(audit);
	graph.retain(cursor);
	return {
		command,
		runtime,
		events,
		status,
		errors,
		audit,
		cursor,
		dispatch(commandFact) {
			command.set(commandFact);
			return commandFact;
		},
	};
}

export interface CqrsProjectionOptions<TState, TEvent = unknown> {
	readonly name?: string;
	readonly events?: readonly string[];
	readonly initial: TState;
	readonly reducer: (state: TState, event: CqrsEvent<TEvent>) => TState;
	/**
	 * R-checkpoint@1: the ref under which the restoring caller registers `reducer` as a definition
	 * (`{ kind: "definition", ref, fn: reducer }`). Without it the projection's frames node is
	 * local-only. With it `initial` must be strict JSON, since the frames recipe holds it.
	 */
	readonly reducerRef?: string;
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
 * @param graph - Graph that owns the created nodes or projector.
 * @param source - Source node that provides graph-visible input.
 * @param opts - Options that configure the helper.
 * @returns A `CqrsProjection<TState>` value.
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsProjection } from "@graphrefly/ts/cqrs";
 * ```
 */
export function cqrsProjection<TState, TEvent = unknown>(
	graph: Graph,
	source: Pick<CqrsBundle<unknown, TEvent>, "events">,
	opts: CqrsProjectionOptions<TState, TEvent>,
): CqrsProjection<TState> {
	const name = moduleName(graph, opts.name, "cqrsProjection");
	const eventFilter =
		opts.events === undefined
			? undefined
			: new Set(uniqueNames(opts.events, "cqrsProjection.events"));
	const framesConfig: CqrsProjectionFramesConfig | undefined =
		opts.reducerRef === undefined
			? undefined
			: {
					initial: toCheckpointJson(opts.initial, "cqrsProjection.initial"),
					reducerRef: opts.reducerRef,
					...(eventFilter === undefined ? {} : { events: [...eventFilter] }),
				};
	const frames = graph.node<CqrsProjectionFrame<TState>>(
		[source.events],
		cqrsProjectionFramesFn(
			opts.initial,
			opts.reducer as (state: unknown, event: CqrsEvent) => unknown,
			eventFilter,
		),
		{
			name,
			factory: "cqrsProjection",
			meta: { eventTypes: eventFilter ? [...eventFilter] : "open" },
			complete: "manual",
			error: "manual",
			...(framesConfig === undefined
				? {}
				: { recipe: { ref: CQRS_PROJECTION_FRAMES_REF, config: framesConfig } }),
		},
	);
	const view = <TOut>(kind: CqrsProjectionViewKind, factory: string): Node<TOut> =>
		graph.node<TOut>([frames], cqrsProjectionViewFn(kind), {
			name: `${name}/${kind}`,
			factory,
			complete: "manual",
			error: "manual",
			recipe: { ref: CQRS_PROJECTION_VIEW_REF, config: { kind } },
		});
	const value = view<TState>("value", "cqrsProjectionValue");
	const errors = view<CqrsProjectionError>("errors", "cqrsProjectionErrors");
	const status = view<CqrsProjectionStatus>("status", "cqrsProjectionStatus");
	graph.retain(frames);
	graph.retain(value);
	graph.retain(status);
	graph.retain(errors);
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
			...(definition.ref === undefined ? {} : { ref: definition.ref }),
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
			typeof draft.id === "string" && draft.id.length > 0
				? draft.id
				: compoundTupleKey("cqrs-event", [command.id, String(i + 1)]);
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
		message.includes("R-request-order") ||
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

function runtimeProjection<TOut>(
	graph: Graph,
	runtime: Node<unknown>,
	kind: CqrsRuntimeFact["kind"],
	name: string,
	factory: string,
): Node<TOut> {
	return graph.node<TOut>([runtime], runtimeProjectionFn(kind), {
		name,
		factory,
		complete: "manual",
		error: "manual",
		recipe: { ref: CQRS_PROJECTION_REF, config: { kind } },
	});
}

function runtimeProjectionValue(fact: CqrsRuntimeFact): unknown {
	switch (fact.kind) {
		case "event":
			return fact.event;
		case "status":
			return fact.status;
		case "error":
			return fact.error;
		case "audit":
			return fact.audit;
		case "cursor":
			return fact.cursor;
	}
}

function runtimeProjectionFn(kind: CqrsRuntimeFact["kind"]): NodeFn {
	return (ctx) => {
		const values: unknown[] = [];
		for (const fact of ctx.deps[0].waves.flat()) {
			const typed = fact as CqrsRuntimeFact;
			if (typed.kind !== kind) continue;
			const selected = runtimeProjectionValue(typed);
			if (selected !== undefined) values.push(selected);
		}
		ctx.down(values.map((v) => ["DATA", v] as const));
	};
}

const CQRS_RUNTIME_REF = "cqrs.runtime";
const CQRS_PROJECTION_REF = "cqrs.projection";
const CQRS_PROJECTION_FRAMES_REF = "cqrsProjection.frames";
const CQRS_PROJECTION_VIEW_REF = "cqrsProjection.view";

const CQRS_FACT_KINDS: readonly CqrsRuntimeFact["kind"][] = [
	"event",
	"status",
	"error",
	"audit",
	"cursor",
];

/** The runtime's recipe config: handler refs by command type, event names, dedupe bounds, clock. */
interface CqrsRuntimeConfig {
	readonly handlers: readonly { readonly type: string; readonly ref: string }[];
	readonly events?: readonly string[];
	readonly dedupe: { readonly commands?: number; readonly events?: number };
	readonly nowRef?: string;
}

/** The projection frames node's recipe config. */
interface CqrsProjectionFramesConfig {
	readonly initial: unknown;
	readonly reducerRef: string;
	readonly events?: readonly string[];
}

type CqrsProjectionViewKind = "value" | "errors" | "status";

function cqrsRuntimeFn(
	handlers: ReadonlyMap<string, HandlerRecord>,
	knownEvents: ReadonlySet<string> | undefined,
	now: () => number,
	dedupe: NormalizedCqrsDedupePolicy,
): NodeFn {
	return (ctx) => {
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
		for (const raw of ctx.deps[0].waves.flat()) {
			reduceCommandFact(raw, state, handlers, knownEvents, now, dedupe, (fact) =>
				ctx.down([["DATA", fact]]),
			);
		}
		ctx.state.set(state);
	};
}

function cqrsProjectionFramesFn(
	initial: unknown,
	reducer: (state: unknown, event: CqrsEvent) => unknown,
	eventFilter: ReadonlySet<string> | undefined,
): NodeFn {
	return (ctx) => {
		const state = ctx.state.get<{ value: unknown }>() ?? { value: initial };
		const frames: CqrsProjectionFrame<unknown>[] = [];
		for (const raw of ctx.deps[0].waves.flat()) {
			const event = raw as CqrsEvent;
			if (eventFilter !== undefined && !eventFilter.has(event.type)) continue;
			try {
				state.value = reducer(state.value, event);
				ctx.state.set(state);
				frames.push({
					kind: "value",
					state: state.value,
					eventId: event.id,
					cursor: event.runtimeCursor,
				});
			} catch (error) {
				rethrowGraphRuntimeInvariant(error);
				frames.push({
					kind: "error",
					error: {
						code: "projection-threw",
						message: errorMessage(error),
						eventId: event.id,
						eventType: event.type,
						cursor: event.runtimeCursor,
					},
				});
				break;
			}
		}
		ctx.down(frames.map((v) => ["DATA", v] as const));
	};
}

function cqrsProjectionViewFn(kind: CqrsProjectionViewKind): NodeFn {
	return (ctx) => {
		const values: unknown[] = [];
		for (const frame of ctx.deps[0].waves.flat()) {
			const typed = frame as CqrsProjectionFrame<unknown>;
			if (kind === "value") {
				if (typed.kind === "value") values.push(typed.state);
			} else if (kind === "errors") {
				if (typed.kind === "error") values.push(typed.error);
			} else if (typed.kind === "value") {
				values.push({
					state: "updated",
					eventId: typed.eventId,
					cursor: typed.cursor,
				} satisfies CqrsProjectionStatus);
			} else {
				values.push({
					state: "errored",
					eventId: typed.error.eventId,
					eventType: typed.error.eventType,
					cursor: typed.error.cursor,
				} satisfies CqrsProjectionStatus);
			}
		}
		ctx.down(values.map((v) => ["DATA", v] as const));
	};
}

function recipeObject(config: unknown, ref: string): Record<string, unknown> {
	if (typeof config !== "object" || config === null || Array.isArray(config))
		throw new Error(`restoreGraph: '${ref}' recipe requires an object config`);
	return config as Record<string, unknown>;
}

function recipeRef(value: unknown, ref: string, key: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`restoreGraph: '${ref}' config.${key} must be a non-empty string`);
	return value;
}

function recipeNames(value: unknown, ref: string, key: string): readonly string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
		throw new Error(`restoreGraph: '${ref}' config.${key} must be an array of strings`);
	return uniqueNames(value as string[], `restoreGraph: '${ref}' config.${key}`);
}

function recipeBound(value: unknown, ref: string, key: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new Error(`restoreGraph: '${ref}' config.${key} must be a non-negative integer`);
	return value as number;
}

function restoredCqrsClock(nowRef: string | undefined, ctx: GraphRecipeContext): () => number {
	if (nowRef === undefined) return Date.now;
	const clock = ctx.definition<undefined, number>(nowRef);
	return () => clock.fn(undefined);
}

/**
 * Restore entries for cqrs and cqrsProjection nodes (R-checkpoint@1): add them to the registry
 * given to restoreGraph, with each command handler registered as a definition under its `ref`
 * (and the projection reducer under `reducerRef`, the clock under `nowRef`).
 * @category cqrs
 * @example
 * ```ts
 * import { cqrsRestoreRegistry } from "@graphrefly/ts/cqrs";
 * import { defaultRestoreRegistry, restoreGraph } from "@graphrefly/ts/graph";
 *
 * const g = restoreGraph(checkpoint, {
 *   registry: {
 *     ...defaultRestoreRegistry,
 *     ...cqrsRestoreRegistry,
 *     "orders.place": { kind: "definition", ref: "orders.place", fn: placeOrder },
 *   },
 * });
 * ```
 */
export const cqrsRestoreRegistry: Readonly<Record<string, GraphRecipeFactory<any>>> = {
	[CQRS_RUNTIME_REF]: {
		ref: CQRS_RUNTIME_REF,
		validateConfig(config): CqrsRuntimeConfig {
			const c = recipeObject(config, CQRS_RUNTIME_REF);
			if (!Array.isArray(c.handlers))
				throw new Error(`restoreGraph: '${CQRS_RUNTIME_REF}' config.handlers must be an array`);
			const handlers = c.handlers.map((raw, i) => {
				const h = recipeObject(raw, CQRS_RUNTIME_REF);
				return {
					type: recipeRef(h.type, CQRS_RUNTIME_REF, `handlers[${i}].type`),
					ref: recipeRef(h.ref, CQRS_RUNTIME_REF, `handlers[${i}].ref`),
				};
			});
			const events = recipeNames(c.events, CQRS_RUNTIME_REF, "events");
			const d = recipeObject(c.dedupe, CQRS_RUNTIME_REF);
			const commands = recipeBound(d.commands, CQRS_RUNTIME_REF, "dedupe.commands");
			const eventBound = recipeBound(d.events, CQRS_RUNTIME_REF, "dedupe.events");
			const nowRef =
				c.nowRef === undefined ? undefined : recipeRef(c.nowRef, CQRS_RUNTIME_REF, "nowRef");
			return {
				handlers,
				...(events === undefined ? {} : { events }),
				dedupe: {
					...(commands === undefined ? {} : { commands }),
					...(eventBound === undefined ? {} : { events: eventBound }),
				},
				...(nowRef === undefined ? {} : { nowRef }),
			};
		},
		build(config: CqrsRuntimeConfig, ctx) {
			const handlers = normalizeHandlers(
				config.handlers.map((h) => ({
					type: h.type,
					handle: ctx.definition(h.ref).fn as CqrsCommandHandler<unknown, unknown>,
					ref: h.ref,
				})),
			);
			const dedupe = normalizeDedupePolicy({
				...(config.dedupe.commands === undefined
					? {}
					: { commands: { maxEntries: config.dedupe.commands } }),
				...(config.dedupe.events === undefined
					? {}
					: { events: { maxEntries: config.dedupe.events } }),
			});
			const knownEvents = config.events === undefined ? undefined : new Set(config.events);
			return {
				fn: cqrsRuntimeFn(handlers, knownEvents, restoredCqrsClock(config.nowRef, ctx), dedupe),
			};
		},
	} satisfies GraphRecipeFactory<CqrsRuntimeConfig>,
	[CQRS_PROJECTION_REF]: {
		ref: CQRS_PROJECTION_REF,
		validateConfig(config): { readonly kind: CqrsRuntimeFact["kind"] } {
			const kind = recipeObject(config, CQRS_PROJECTION_REF).kind;
			if (!CQRS_FACT_KINDS.includes(kind as CqrsRuntimeFact["kind"]))
				throw new Error(`restoreGraph: '${CQRS_PROJECTION_REF}' config.kind is unknown`);
			return { kind: kind as CqrsRuntimeFact["kind"] };
		},
		build(config: { readonly kind: CqrsRuntimeFact["kind"] }) {
			return { fn: runtimeProjectionFn(config.kind) };
		},
	} satisfies GraphRecipeFactory<{ readonly kind: CqrsRuntimeFact["kind"] }>,
	[CQRS_PROJECTION_FRAMES_REF]: {
		ref: CQRS_PROJECTION_FRAMES_REF,
		validateConfig(config): CqrsProjectionFramesConfig {
			const c = recipeObject(config, CQRS_PROJECTION_FRAMES_REF);
			if (c.initial === undefined)
				throw new Error(`restoreGraph: '${CQRS_PROJECTION_FRAMES_REF}' config.initial is required`);
			const events = recipeNames(c.events, CQRS_PROJECTION_FRAMES_REF, "events");
			return {
				initial: c.initial,
				reducerRef: recipeRef(c.reducerRef, CQRS_PROJECTION_FRAMES_REF, "reducerRef"),
				...(events === undefined ? {} : { events }),
			};
		},
		build(config: CqrsProjectionFramesConfig, ctx) {
			const reducer = ctx.definition(config.reducerRef).fn as unknown as (
				state: unknown,
				event: CqrsEvent,
			) => unknown;
			const filter = config.events === undefined ? undefined : new Set(config.events);
			return { fn: cqrsProjectionFramesFn(config.initial, reducer, filter) };
		},
	} satisfies GraphRecipeFactory<CqrsProjectionFramesConfig>,
	[CQRS_PROJECTION_VIEW_REF]: {
		ref: CQRS_PROJECTION_VIEW_REF,
		validateConfig(config): { readonly kind: CqrsProjectionViewKind } {
			const kind = recipeObject(config, CQRS_PROJECTION_VIEW_REF).kind;
			if (kind !== "value" && kind !== "errors" && kind !== "status")
				throw new Error(
					`restoreGraph: '${CQRS_PROJECTION_VIEW_REF}' config.kind must be value, errors or status`,
				);
			return { kind };
		},
		build(config: { readonly kind: CqrsProjectionViewKind }) {
			return { fn: cqrsProjectionViewFn(config.kind) };
		},
	} satisfies GraphRecipeFactory<{ readonly kind: CqrsProjectionViewKind }>,
};

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
