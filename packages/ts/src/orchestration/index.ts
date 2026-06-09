/**
 * Reusable application-infrastructure orchestration namespace.
 *
 * Retained root orchestration helpers land here only after B63 re-derives them
 * onto clean-slate graph surfaces.
 */

import { depBatch } from "../ctx/types.js";
import type { Graph, TopologyGroup } from "../graph/graph.js";
import {
	type BackoffPolicy,
	backoffDelayMs,
	nextRetryDelayMs,
	noBackoff,
	type RetryPolicy,
	type RetryStatus,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
import { timeout as timeoutOperator } from "../graph/time.js";
import type { Node } from "../node/node.js";

export {
	type BackoffPolicy,
	backoffDelayMs,
	noBackoff,
	nextRetryDelayMs,
	retryPolicy,
	type RetryPolicy,
	type RetryStatus,
	shouldRetry,
};

export type ResilienceEvent =
	| { readonly kind: "attempt"; readonly attempt: number }
	| {
			readonly kind: "retry";
			readonly attempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| { readonly kind: "success"; readonly attempt?: number }
	| { readonly kind: "failure"; readonly attempt?: number; readonly error: unknown }
	| { readonly kind: "exhausted"; readonly attempt: number; readonly error: unknown };

export interface RetryStatusBundle {
	readonly status: Node<RetryStatus>;
	readonly errors: Node<unknown>;
}

export interface BreakerOptions {
	readonly failureThreshold: number;
	readonly resetAfterMs?: number;
	readonly now?: () => number;
	readonly name?: string;
}

export interface BreakerStatus {
	readonly state: "closed" | "open" | "half-open";
	readonly failures: number;
	readonly openedAtMs?: number;
}

export interface BreakerBundle {
	readonly status: Node<BreakerStatus>;
	readonly allowed: Node<boolean>;
}

export interface RateLimitOptions {
	readonly max: number;
	readonly windowMs: number;
	readonly now?: () => number;
	readonly name?: string;
}

export interface RateLimitStatus {
	readonly allowed: number;
	readonly dropped: number;
	readonly remaining: number;
	readonly resetAtMs: number;
}

export interface RateLimitBundle<T> {
	readonly allowed: Node<T>;
	readonly dropped: Node<T>;
	readonly status: Node<RateLimitStatus>;
}

type RateLimitEvent<T> =
	| { readonly kind: "allowed"; readonly value: T; readonly status: RateLimitStatus }
	| { readonly kind: "dropped"; readonly value: T; readonly status: RateLimitStatus };

export interface TimeoutBundle<T> {
	readonly node: Node<T>;
	readonly status: Node<"running" | "completed" | "errored">;
	readonly errors: Node<unknown>;
}

/** D136 graph-visible process command fact. */
export interface ProcessCommand<T = unknown> {
	readonly id: string;
	readonly type: string;
	readonly payload: T;
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

/** Event draft returned by a ProcessBundle reducer before runtime ordering. */
export interface ProcessEventDraft<T = unknown> {
	readonly id?: string;
	readonly type: string;
	readonly payload: T;
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

/** Ordered process event fact. These are DATA facts, not protocol messages. */
export interface ProcessEvent<T = unknown> {
	readonly id: string;
	readonly type: string;
	readonly seq: number;
	readonly cursor: number;
	readonly commandId: string;
	readonly commandType: string;
	readonly payload: T;
	readonly timestampMs: number;
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

/** Effect-request draft emitted by a ProcessBundle reducer for visible effect runners. */
export interface ProcessEffectRequestDraft<T = unknown> {
	readonly id?: string;
	readonly type: string;
	readonly payload: T;
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

/** Ordered effect-request fact. Effect runners consume this node in later slices. */
export interface ProcessEffectRequest<T = unknown> {
	readonly id: string;
	readonly type: string;
	readonly seq: number;
	readonly cursor: number;
	readonly commandId: string;
	readonly commandType: string;
	readonly payload: T;
	readonly timestampMs: number;
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
}

export type ProcessErrorCode =
	| "malformed-command"
	| "reducer-threw"
	| "clock-threw"
	| "malformed-state"
	| "malformed-event"
	| "malformed-effect";

/** Graph-visible ProcessBundle error fact. These are DATA facts, not protocol ERROR. */
export interface ProcessError {
	readonly code: ProcessErrorCode;
	readonly message: string;
	readonly command?: unknown;
	readonly commandId?: string;
	readonly commandType?: string;
	readonly cursor: ProcessCursor;
}

/** Accepted/rejected command outcome projected from the ProcessBundle runtime. */
export interface ProcessStatus {
	readonly state: "accepted" | "rejected";
	readonly commandId?: string;
	readonly commandType?: string;
	readonly eventCount: number;
	readonly effectCount: number;
	readonly errorCode?: ProcessErrorCode;
	readonly cursor: ProcessCursor;
}

/** Ordered audit fact for one attempted command reduction. */
export interface ProcessAuditRecord {
	readonly seq: number;
	readonly commandId?: string;
	readonly commandType?: string;
	readonly outcome: "success" | "failure";
	readonly eventIds: readonly string[];
	readonly eventTypes: readonly string[];
	readonly effectIds: readonly string[];
	readonly effectTypes: readonly string[];
	readonly errorCode?: ProcessErrorCode;
	readonly errorMessage?: string;
	readonly cursor: ProcessCursor;
}

/** Monotonic graph-visible ProcessBundle cursor counters. */
export interface ProcessCursor {
	readonly eventSeq: number;
	readonly effectSeq: number;
	readonly commandCount: number;
	readonly errorCount: number;
	readonly auditSeq: number;
}

/** Internal runtime stream fact exposed through ProcessBundle projection nodes. */
type ProcessRuntimeFact<TState = unknown, TEvent = unknown, TEffect = unknown> =
	| { readonly kind: "state"; readonly state: TState; readonly cursor: ProcessCursor }
	| { readonly kind: "event"; readonly event: ProcessEvent<TEvent> }
	| { readonly kind: "effect-request"; readonly effect: ProcessEffectRequest<TEffect> }
	| { readonly kind: "status"; readonly status: ProcessStatus }
	| { readonly kind: "error"; readonly error: ProcessError }
	| { readonly kind: "audit"; readonly audit: ProcessAuditRecord }
	| { readonly kind: "cursor"; readonly cursor: ProcessCursor };

/** Reducer result: next process state plus optional event/effect-request drafts. */
export interface ProcessReduction<TState = unknown, TEvent = unknown, TEffect = unknown> {
	readonly state: TState;
	readonly events?: readonly ProcessEventDraft<TEvent>[];
	readonly effects?: readonly ProcessEffectRequestDraft<TEffect>[];
}

/** Sync ProcessBundle reducer. Async effects belong in graph-visible adapters, not here. */
export type ProcessReducer<
	TCommand = unknown,
	TState = unknown,
	TEvent = unknown,
	TEffect = unknown,
> = (command: ProcessCommand<TCommand>, state: TState) => ProcessReduction<TState, TEvent, TEffect>;

/** Options for a D136 facts-plus-reducer ProcessBundle. */
export interface ProcessBundleOptions<
	TCommand = unknown,
	TState = unknown,
	TEvent = unknown,
	TEffect = unknown,
> {
	readonly name?: string;
	readonly initialState: TState;
	readonly reduce: ProcessReducer<TCommand, TState, TEvent, TEffect>;
	readonly now?: () => number;
}

/** D136 facts-plus-reducer process bundle. It is not a workflow engine or hidden runtime owner. */
export interface ProcessBundle<
	TCommand = unknown,
	TState = unknown,
	TEvent = unknown,
	TEffect = unknown,
> {
	readonly command: Node<ProcessCommand<TCommand>>;
	readonly events: Node<ProcessEvent<TEvent>>;
	readonly state: Node<TState>;
	readonly audit: Node<ProcessAuditRecord>;
	readonly effectRequests: Node<ProcessEffectRequest<TEffect>>;
	readonly status: Node<ProcessStatus>;
	readonly errors: Node<ProcessError>;
	readonly cursor: Node<ProcessCursor>;
	dispatch(command: ProcessCommand<TCommand>): ProcessCommand<TCommand>;
	/** Release only graph-owned retain roots; process facts/topology/cache/state remain ordinary graph data. */
	release(): void;
}

export function retryStatusBundle(
	graph: Graph,
	events: Node<ResilienceEvent>,
	opts: { name?: string; policy?: RetryPolicy } = {},
): RetryStatusBundle {
	const policy = opts.policy ?? retryPolicy();
	const name = opts.name ?? "retry";
	const status = graph.node<RetryStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<RetryStatus>() ??
				({ state: "idle", attempt: 0, maxAttempts: policy.maxAttempts } satisfies RetryStatus);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as ResilienceEvent;
				if (event.kind === "attempt") {
					next = { state: "running", attempt: event.attempt, maxAttempts: policy.maxAttempts };
				} else if (event.kind === "retry") {
					next = {
						state: "waiting",
						attempt: event.attempt,
						maxAttempts: policy.maxAttempts,
						delayMs: event.delayMs,
					};
				} else if (event.kind === "success") {
					next = {
						state: "succeeded",
						attempt: event.attempt ?? next.attempt,
						maxAttempts: policy.maxAttempts,
					};
				} else if (event.kind === "failure") {
					const attempt = event.attempt ?? next.attempt;
					next = {
						state: shouldRetry(policy, attempt) ? "failed" : "exhausted",
						attempt,
						maxAttempts: policy.maxAttempts,
						delayMs: shouldRetry(policy, attempt)
							? nextRetryDelayMs(policy, attempt + 1)
							: undefined,
					};
				} else {
					next = {
						state: "exhausted",
						attempt: event.attempt,
						maxAttempts: policy.maxAttempts,
					};
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "retryStatus" },
	);
	const errors = graph.node<unknown>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as ResilienceEvent;
				if ("error" in event) ctx.down([["DATA", event.error]]);
			}
		},
		{ name: `${name}/errors`, factory: "retryErrors" },
	);
	return { status, errors };
}

export function breakerBundle(
	graph: Graph,
	events: Node<ResilienceEvent>,
	opts: BreakerOptions,
): BreakerBundle {
	if (!Number.isInteger(opts.failureThreshold) || opts.failureThreshold <= 0) {
		throw new RangeError("breakerBundle: failureThreshold must be a positive integer");
	}
	const name = opts.name ?? "breaker";
	const now = opts.now ?? Date.now;
	const status = graph.node<BreakerStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<BreakerStatus>() ??
				({ state: "closed", failures: 0 } satisfies BreakerStatus);
			if (
				next.state === "open" &&
				opts.resetAfterMs !== undefined &&
				next.openedAtMs !== undefined &&
				now() - next.openedAtMs >= opts.resetAfterMs
			) {
				next = { ...next, state: "half-open" };
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as ResilienceEvent;
				if (event.kind === "success") {
					next = { state: "closed", failures: 0 };
				} else if (event.kind === "failure" || event.kind === "exhausted") {
					const failures = next.failures + 1;
					next =
						failures >= opts.failureThreshold
							? { state: "open", failures, openedAtMs: now() }
							: { ...next, failures };
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "breakerStatus" },
	);
	const allowed = graph.node<boolean>(
		[status],
		(ctx) => {
			const statusBatch = depBatch(ctx, 0) ?? [];
			for (const value of statusBatch) {
				ctx.down([["DATA", (value as BreakerStatus).state !== "open"]]);
			}
		},
		{ name: `${name}/allowed`, factory: "breakerAllowed" },
	);
	return { status, allowed };
}

export function rateLimitBundle<T>(
	graph: Graph,
	source: Node<T>,
	opts: RateLimitOptions,
): RateLimitBundle<T> {
	if (!Number.isInteger(opts.max) || opts.max <= 0) {
		throw new RangeError("rateLimitBundle: max must be a positive integer");
	}
	if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
		throw new RangeError("rateLimitBundle: windowMs must be positive");
	}
	const now = opts.now ?? Date.now;
	const name = opts.name ?? "rateLimit";
	const events = graph.node<RateLimitEvent<T>>(
		[source],
		(ctx) => {
			type State = { count: number; resetAtMs: number; allowed: number; dropped: number };
			const current = now();
			let state =
				ctx.state.get<State>() ??
				({ count: 0, resetAtMs: current + opts.windowMs, allowed: 0, dropped: 0 } satisfies State);
			if (current >= state.resetAtMs) {
				state = { ...state, count: 0, resetAtMs: current + opts.windowMs };
			}
			for (const value of depBatch(ctx, 0) ?? []) {
				const allowed = state.count < opts.max;
				state = allowed
					? { ...state, count: state.count + 1, allowed: state.allowed + 1 }
					: { ...state, dropped: state.dropped + 1 };
				const status = {
					allowed: state.allowed,
					dropped: state.dropped,
					remaining: Math.max(0, opts.max - state.count),
					resetAtMs: state.resetAtMs,
				} satisfies RateLimitStatus;
				ctx.down([
					[
						"DATA",
						allowed
							? ({ kind: "allowed", value: value as T, status } satisfies RateLimitEvent<T>)
							: ({ kind: "dropped", value: value as T, status } satisfies RateLimitEvent<T>),
					],
				]);
			}
			ctx.state.set(state);
		},
		{ name: `${name}/events`, factory: "rateLimitEvents" },
	);
	const allowed = graph.node<T>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RateLimitEvent<T>;
				if (typed.kind === "allowed") ctx.down([["DATA", typed.value]]);
			}
		},
		{ name: `${name}/allowed`, factory: "rateLimitAllowed" },
	);
	const dropped = graph.node<T>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as RateLimitEvent<T>;
				if (typed.kind === "dropped") ctx.down([["DATA", typed.value]]);
			}
		},
		{ name: `${name}/dropped`, factory: "rateLimitDropped" },
	);
	const status = graph.node<RateLimitStatus>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", (event as RateLimitEvent<T>).status]]);
			}
		},
		{ name: `${name}/status`, factory: "rateLimitStatus" },
	);
	return { allowed, dropped, status };
}

export function timeoutBundle<T>(
	graph: Graph,
	source: Node<T>,
	ms: number,
	opts: { name?: string } = {},
): TimeoutBundle<T> {
	const name = opts.name ?? "timeout";
	const node = timeoutOperator(source, ms);
	const status = graph.node<"running" | "completed" | "errored">(
		[node],
		(ctx) => {
			const terminal = ctx.terminal[0];
			if (terminal === true) ctx.down([["DATA", "completed"]]);
			else if (terminal !== false && terminal !== undefined) ctx.down([["DATA", "errored"]]);
			else if ((depBatch(ctx, 0) ?? []).length > 0) ctx.down([["DATA", "running"]]);
		},
		{ name: `${name}/status`, factory: "timeoutStatus" },
	);
	const errors = graph.node<unknown>(
		[node],
		(ctx) => {
			const terminal = ctx.terminal[0];
			if (terminal !== true && terminal !== false && terminal !== undefined) {
				ctx.down([["DATA", terminal]]);
			}
		},
		{ name: `${name}/errors`, factory: "timeoutErrors" },
	);
	return { node, status, errors };
}

/**
 * Build a D136 ProcessBundle from graph-visible command facts and a reducer.
 *
 * The bundle retains its runtime/projection nodes until `release()` is called.
 * Reducer and validation failures are emitted as DATA error/status/audit facts;
 * they do not mint protocol ERROR messages or own restore/hydration behavior.
 */
export function processBundle<
	TCommand = unknown,
	TState = unknown,
	TEvent = unknown,
	TEffect = unknown,
>(
	graph: Graph,
	opts: ProcessBundleOptions<TCommand, TState, TEvent, TEffect>,
): ProcessBundle<TCommand, TState, TEvent, TEffect> {
	if (typeof opts.reduce !== "function") {
		throw new TypeError("processBundle: reduce must be a function");
	}
	if (opts.initialState === undefined) {
		throw new TypeError("processBundle: initialState must not be undefined");
	}
	const name = opts.name ?? "process";
	const now = opts.now ?? Date.now;
	const topology = graph.topologyGroup({ name: `${name}.process` });
	const command = topology.node<ProcessCommand<TCommand>>([], null, {
		name: `${name}/command`,
		factory: "processCommand",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const runtime = topology.node<ProcessRuntimeFact<TState, TEvent, TEffect>>(
		[command],
		(ctx) => {
			let state =
				ctx.state.get<ProcessRuntimeState<TState>>() ??
				({
					eventSeq: 0,
					effectSeq: 0,
					commandCount: 0,
					errorCount: 0,
					auditSeq: 0,
					seenEventIds: [],
					seenEffectIds: [],
					state: opts.initialState,
				} satisfies ProcessRuntimeState<TState>);
			ctx.state.persist(true);
			for (const raw of depBatch(ctx, 0) ?? []) {
				state = reduceProcessCommandFact(
					raw,
					state,
					opts.reduce as ProcessReducer<unknown, TState, unknown, unknown>,
					now,
					(fact) => ctx.down([["DATA", fact as ProcessRuntimeFact<TState, TEvent, TEffect>]]),
				);
				ctx.state.set(state);
			}
		},
		{
			name: `${name}/runtime`,
			factory: "processRuntime",
			meta: { process: "facts-plus-reducer", d: "D136" },
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const events = processProjection<ProcessEvent<TEvent>, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/events`,
		"processEvents",
		(fact) => (fact.kind === "event" ? fact.event : undefined),
	);
	const state = processProjection<TState, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/state`,
		"processState",
		(fact) => (fact.kind === "state" ? fact.state : undefined),
	);
	const audit = processProjection<ProcessAuditRecord, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/audit`,
		"processAudit",
		(fact) => (fact.kind === "audit" ? fact.audit : undefined),
	);
	const effectRequests = processProjection<ProcessEffectRequest<TEffect>, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/effectRequests`,
		"processEffectRequests",
		(fact) => (fact.kind === "effect-request" ? fact.effect : undefined),
	);
	const status = processProjection<ProcessStatus, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/status`,
		"processStatus",
		(fact) => (fact.kind === "status" ? fact.status : undefined),
	);
	const errors = processProjection<ProcessError, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/errors`,
		"processErrors",
		(fact) => (fact.kind === "error" ? fact.error : undefined),
	);
	const cursor = processProjection<ProcessCursor, TState, TEvent, TEffect>(
		topology,
		runtime,
		`${name}/cursor`,
		"processCursor",
		(fact) => (fact.kind === "cursor" ? fact.cursor : undefined),
	);
	const retainProcessNodes = () => [
		graph.retain(runtime, { reason: `${name}.process.runtime` }),
		graph.retain(events, { reason: `${name}.process.events` }),
		graph.retain(state, { reason: `${name}.process.state` }),
		graph.retain(audit, { reason: `${name}.process.audit` }),
		graph.retain(effectRequests, { reason: `${name}.process.effectRequests` }),
		graph.retain(status, { reason: `${name}.process.status` }),
		graph.retain(errors, { reason: `${name}.process.errors` }),
		graph.retain(cursor, { reason: `${name}.process.cursor` }),
	];
	let releaseRetains = retainProcessNodes();
	let released = false;
	return {
		command,
		events,
		state,
		audit,
		effectRequests,
		status,
		errors,
		cursor,
		dispatch(next) {
			command.down([["DATA", next]]);
			return next;
		},
		release() {
			if (released) return;
			const activeRetains = releaseRetains;
			releaseRetains = [];
			for (const releaseRetain of activeRetains) releaseRetain();
			try {
				topology.release({ reason: `${name}.process.release` });
				released = true;
			} catch (error) {
				releaseRetains = retainProcessNodes();
				throw error;
			}
		},
	};
}

export function constantBackoff(delayMs: number): BackoffPolicy {
	return { kind: "constant", delayMs };
}

interface ProcessRuntimeState<TState> {
	eventSeq: number;
	effectSeq: number;
	commandCount: number;
	errorCount: number;
	auditSeq: number;
	seenEventIds: string[];
	seenEffectIds: string[];
	state: TState;
}

function processRuntimeDraft<TState>(
	state: ProcessRuntimeState<TState>,
): ProcessRuntimeState<TState> {
	return {
		eventSeq: state.eventSeq,
		effectSeq: state.effectSeq,
		commandCount: state.commandCount,
		errorCount: state.errorCount,
		auditSeq: state.auditSeq,
		seenEventIds: [...state.seenEventIds],
		seenEffectIds: [...state.seenEffectIds],
		state: state.state,
	};
}

function reduceProcessCommandFact<TState>(
	raw: unknown,
	state: ProcessRuntimeState<TState>,
	reduce: ProcessReducer<unknown, TState, unknown, unknown>,
	now: () => number,
	emit: (fact: ProcessRuntimeFact<TState, unknown, unknown>) => void,
): ProcessRuntimeState<TState> {
	const draft = processRuntimeDraft(state);
	draft.commandCount += 1;
	const parsed = parseProcessCommand(raw);
	if (typeof parsed === "string") {
		emitProcessFailure(draft, emit, raw, undefined, "malformed-command", parsed);
		return draft;
	}
	const command = parsed as ProcessCommand<unknown>;
	let reduction: ProcessReduction<TState, unknown, unknown>;
	const reducerState = cloneProcessState(state.state);
	if (!reducerState.ok) {
		emitProcessFailure(draft, emit, command, command, "malformed-state", reducerState.message);
		return draft;
	}
	try {
		reduction = reduce(command, reducerState.value);
	} catch (error) {
		rethrowGraphRuntimeInvariant(error);
		emitProcessFailure(draft, emit, command, command, "reducer-threw", errorMessage(error));
		return draft;
	}
	if (!isObjectRecord(reduction) || !("state" in reduction)) {
		emitProcessFailure(
			draft,
			emit,
			command,
			command,
			"malformed-state",
			"processBundle: reducer must return { state, events?, effects? }",
		);
		return draft;
	}
	if (reduction.state === undefined) {
		emitProcessFailure(
			draft,
			emit,
			command,
			command,
			"malformed-state",
			"processBundle: reducer state must not be undefined",
		);
		return draft;
	}
	const privateState = cloneProcessState(reduction.state);
	if (!privateState.ok) {
		emitProcessFailure(draft, emit, command, command, "malformed-state", privateState.message);
		return draft;
	}
	const visibleState = cloneProcessState(privateState.value);
	if (!visibleState.ok) {
		emitProcessFailure(draft, emit, command, command, "malformed-state", visibleState.message);
		return draft;
	}
	const preparedEvents = prepareProcessEvents(command, draft, reduction.events ?? []);
	if (typeof preparedEvents === "string") {
		emitProcessFailure(draft, emit, command, command, "malformed-event", preparedEvents);
		return draft;
	}
	const preparedEffects = prepareProcessEffects(command, draft, reduction.effects ?? []);
	if (typeof preparedEffects === "string") {
		emitProcessFailure(draft, emit, command, command, "malformed-effect", preparedEffects);
		return draft;
	}
	const timestampMs = readTimestampMs(now);
	if (typeof timestampMs === "string") {
		emitProcessFailure(draft, emit, command, command, "clock-threw", timestampMs);
		return draft;
	}
	draft.state = privateState.value;
	emit({ kind: "state", state: visibleState.value, cursor: processCursorOf(draft) });
	const events: ProcessEvent<unknown>[] = [];
	for (const eventDraft of preparedEvents) {
		draft.eventSeq += 1;
		draft.seenEventIds.push(eventDraft.id);
		const event: ProcessEvent<unknown> = {
			id: eventDraft.id,
			type: eventDraft.type,
			seq: draft.eventSeq,
			cursor: draft.eventSeq,
			commandId: command.id,
			commandType: command.type,
			payload: eventDraft.payload,
			timestampMs,
			...(eventDraft.processId === undefined ? {} : { processId: eventDraft.processId }),
			...(eventDraft.correlationId === undefined
				? {}
				: { correlationId: eventDraft.correlationId }),
			...(eventDraft.causationId === undefined ? {} : { causationId: eventDraft.causationId }),
			...(eventDraft.metadata === undefined ? {} : { metadata: eventDraft.metadata }),
		};
		events.push(event);
		emit({ kind: "event", event });
	}
	const effects: ProcessEffectRequest<unknown>[] = [];
	for (const effectDraft of preparedEffects) {
		draft.effectSeq += 1;
		draft.seenEffectIds.push(effectDraft.id);
		const effect: ProcessEffectRequest<unknown> = {
			id: effectDraft.id,
			type: effectDraft.type,
			seq: draft.effectSeq,
			cursor: draft.effectSeq,
			commandId: command.id,
			commandType: command.type,
			payload: effectDraft.payload,
			timestampMs,
			...(effectDraft.processId === undefined ? {} : { processId: effectDraft.processId }),
			...(effectDraft.correlationId === undefined
				? {}
				: { correlationId: effectDraft.correlationId }),
			...(effectDraft.causationId === undefined ? {} : { causationId: effectDraft.causationId }),
			...(effectDraft.metadata === undefined ? {} : { metadata: effectDraft.metadata }),
		};
		effects.push(effect);
		emit({ kind: "effect-request", effect });
	}
	emitProcessStatus(draft, emit, command, "accepted", events.length, effects.length);
	emitProcessAudit(draft, emit, command, "success", events, effects, undefined, undefined);
	emit({ kind: "cursor", cursor: processCursorOf(draft) });
	return draft;
}

function processProjection<TOut, TState, TEvent, TEffect>(
	graph: Graph | TopologyGroup,
	runtime: Node<ProcessRuntimeFact<TState, TEvent, TEffect>>,
	name: string,
	factory: string,
	select: (fact: ProcessRuntimeFact<TState, TEvent, TEffect>) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as ProcessRuntimeFact<TState, TEvent, TEffect>);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

function parseProcessCommand(value: unknown): ProcessCommand<unknown> | string {
	if (!isObjectRecord(value)) return "processBundle: command fact must be an object";
	if (typeof value.id !== "string" || value.id.length === 0) {
		return "processBundle: command id must be a non-empty string";
	}
	if (typeof value.type !== "string" || value.type.length === 0) {
		return "processBundle: command type must be a non-empty string";
	}
	return {
		id: value.id,
		type: value.type,
		payload: value.payload,
		...(typeof value.processId === "string" ? { processId: value.processId } : {}),
		...(typeof value.correlationId === "string" ? { correlationId: value.correlationId } : {}),
		...(typeof value.causationId === "string" ? { causationId: value.causationId } : {}),
		...(isObjectRecord(value.metadata) ? { metadata: value.metadata } : {}),
	};
}

function prepareProcessEvents(
	command: ProcessCommand<unknown>,
	state: ProcessRuntimeState<unknown>,
	drafts: readonly ProcessEventDraft<unknown>[],
): Array<ProcessEventDraft<unknown> & { readonly id: string }> | string {
	if (!Array.isArray(drafts)) return "processBundle: events must be an array";
	const seen = new Set<string>();
	const out: Array<ProcessEventDraft<unknown> & { readonly id: string }> = [];
	for (let i = 0; i < drafts.length; i += 1) {
		const draft = drafts[i];
		if (!isObjectRecord(draft) || typeof draft.type !== "string" || draft.type.length === 0) {
			return "processBundle: event draft must have a non-empty type";
		}
		const id =
			typeof draft.id === "string" && draft.id.length > 0
				? draft.id
				: `${command.id}:event:${state.eventSeq + i + 1}`;
		if (seen.has(id)) return `processBundle: duplicate event '${id}'`;
		if (state.seenEventIds.includes(id)) return `processBundle: duplicate event '${id}'`;
		seen.add(id);
		out.push({
			id,
			type: draft.type,
			payload: draft.payload,
			...(typeof draft.processId === "string" ? { processId: draft.processId } : {}),
			...(typeof draft.correlationId === "string" ? { correlationId: draft.correlationId } : {}),
			...(typeof draft.causationId === "string" ? { causationId: draft.causationId } : {}),
			...(isObjectRecord(draft.metadata) ? { metadata: draft.metadata } : {}),
		});
	}
	return out;
}

function prepareProcessEffects(
	command: ProcessCommand<unknown>,
	state: ProcessRuntimeState<unknown>,
	drafts: readonly ProcessEffectRequestDraft<unknown>[],
): Array<ProcessEffectRequestDraft<unknown> & { readonly id: string }> | string {
	if (!Array.isArray(drafts)) return "processBundle: effects must be an array";
	const seen = new Set<string>();
	const out: Array<ProcessEffectRequestDraft<unknown> & { readonly id: string }> = [];
	for (let i = 0; i < drafts.length; i += 1) {
		const draft = drafts[i];
		if (!isObjectRecord(draft) || typeof draft.type !== "string" || draft.type.length === 0) {
			return "processBundle: effect draft must have a non-empty type";
		}
		const id =
			typeof draft.id === "string" && draft.id.length > 0
				? draft.id
				: `${command.id}:effect:${state.effectSeq + i + 1}`;
		if (seen.has(id)) return `processBundle: duplicate effect '${id}'`;
		if (state.seenEffectIds.includes(id)) return `processBundle: duplicate effect '${id}'`;
		seen.add(id);
		out.push({
			id,
			type: draft.type,
			payload: draft.payload,
			...(typeof draft.processId === "string" ? { processId: draft.processId } : {}),
			...(typeof draft.correlationId === "string" ? { correlationId: draft.correlationId } : {}),
			...(typeof draft.causationId === "string" ? { causationId: draft.causationId } : {}),
			...(isObjectRecord(draft.metadata) ? { metadata: draft.metadata } : {}),
		});
	}
	return out;
}

function emitProcessFailure<TState>(
	state: ProcessRuntimeState<TState>,
	emit: (fact: ProcessRuntimeFact<TState, unknown, unknown>) => void,
	raw: unknown,
	command: ProcessCommand<unknown> | undefined,
	code: ProcessErrorCode,
	message: string,
): void {
	state.errorCount += 1;
	const cursor = processCursorOf(state);
	const error: ProcessError = {
		code,
		message,
		command: raw,
		...(command === undefined ? {} : { commandId: command.id, commandType: command.type }),
		cursor,
	};
	emit({ kind: "error", error });
	emitProcessStatus(state, emit, command, "rejected", 0, 0, code);
	emitProcessAudit(state, emit, command, "failure", [], [], code, message);
	emit({ kind: "cursor", cursor: processCursorOf(state) });
}

function emitProcessStatus<TState>(
	state: ProcessRuntimeState<TState>,
	emit: (fact: ProcessRuntimeFact<TState, unknown, unknown>) => void,
	command: ProcessCommand<unknown> | undefined,
	statusState: ProcessStatus["state"],
	eventCount: number,
	effectCount: number,
	errorCode?: ProcessErrorCode,
): void {
	emit({
		kind: "status",
		status: {
			state: statusState,
			...(command === undefined ? {} : { commandId: command.id, commandType: command.type }),
			eventCount,
			effectCount,
			...(errorCode === undefined ? {} : { errorCode }),
			cursor: processCursorOf(state),
		},
	});
}

function emitProcessAudit<TState>(
	state: ProcessRuntimeState<TState>,
	emit: (fact: ProcessRuntimeFact<TState, unknown, unknown>) => void,
	command: ProcessCommand<unknown> | undefined,
	outcome: ProcessAuditRecord["outcome"],
	events: readonly ProcessEvent<unknown>[],
	effects: readonly ProcessEffectRequest<unknown>[],
	errorCode: ProcessErrorCode | undefined,
	errorMessage: string | undefined,
): void {
	state.auditSeq += 1;
	emit({
		kind: "audit",
		audit: {
			seq: state.auditSeq,
			...(command === undefined ? {} : { commandId: command.id, commandType: command.type }),
			outcome,
			eventIds: events.map((event) => event.id),
			eventTypes: events.map((event) => event.type),
			effectIds: effects.map((effect) => effect.id),
			effectTypes: effects.map((effect) => effect.type),
			...(errorCode === undefined ? {} : { errorCode }),
			...(errorMessage === undefined ? {} : { errorMessage }),
			cursor: processCursorOf(state),
		},
	});
}

function processCursorOf(state: ProcessRuntimeState<unknown>): ProcessCursor {
	return {
		eventSeq: state.eventSeq,
		effectSeq: state.effectSeq,
		commandCount: state.commandCount,
		errorCount: state.errorCount,
		auditSeq: state.auditSeq,
	};
}

type CloneProcessStateResult<TState> =
	| { readonly ok: true; readonly value: TState }
	| { readonly ok: false; readonly message: string };

function cloneProcessState<TState>(state: TState): CloneProcessStateResult<TState> {
	if (typeof state !== "object" || state === null) return { ok: true, value: state };
	try {
		if (typeof globalThis.structuredClone === "function") {
			return { ok: true, value: globalThis.structuredClone(state) as TState };
		}
		return { ok: true, value: JSON.parse(JSON.stringify(state)) as TState };
	} catch (error) {
		return {
			ok: false,
			message: `processBundle: state must be cloneable before reducer execution (${errorMessage(error)})`,
		};
	}
}

function readTimestampMs(now: () => number): number | string {
	try {
		const timestampMs = now();
		if (!Number.isFinite(timestampMs)) return "processBundle: now() must return a finite number";
		return timestampMs;
	} catch (error) {
		return errorMessage(error);
	}
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
