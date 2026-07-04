/**
 * Graph-visible ProcessBundle orchestration helpers (D136/D156).
 */

import { depBatch, type NodeFn } from "../ctx/types.js";
import type { Graph, TopologyGroup } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	ProcessAuditRecord,
	ProcessBundle,
	ProcessBundleOptions,
	ProcessCommand,
	ProcessCursor,
	ProcessEffectCommandPayload,
	ProcessEffectCommandType,
	ProcessEffectOutcome,
	ProcessEffectRequest,
	ProcessEffectRequestDraft,
	ProcessEffectRunnerBundle,
	ProcessEffectRunnerError,
	ProcessEffectRunnerOptions,
	ProcessEffectRunnerStatus,
	ProcessError,
	ProcessErrorCode,
	ProcessEvent,
	ProcessEventDraft,
	ProcessReducer,
	ProcessReduction,
	ProcessStatus,
} from "./process-types.js";
import {
	cloneProcessState,
	errorMessage,
	isObjectRecord,
	readTimestampMs,
	rethrowGraphRuntimeInvariant,
} from "./process-utils.js";

export type {
	ProcessAuditRecord,
	ProcessBundle,
	ProcessBundleOptions,
	ProcessCommand,
	ProcessCursor,
	ProcessEffectCommandPayload,
	ProcessEffectCommandType,
	ProcessEffectOutcome,
	ProcessEffectRequest,
	ProcessEffectRequestDraft,
	ProcessEffectRunnerBundle,
	ProcessEffectRunnerError,
	ProcessEffectRunnerOptions,
	ProcessEffectRunnerStatus,
	ProcessError,
	ProcessErrorCode,
	ProcessEvent,
	ProcessEventDraft,
	ProcessReducer,
	ProcessReduction,
	ProcessStatus,
} from "./process-types.js";

type ProcessRuntimeFact<TState = unknown, TEvent = unknown, TEffect = unknown> =
	| { readonly kind: "state"; readonly state: TState; readonly cursor: ProcessCursor }
	| { readonly kind: "event"; readonly event: ProcessEvent<TEvent> }
	| { readonly kind: "effect-request"; readonly effect: ProcessEffectRequest<TEffect> }
	| { readonly kind: "status"; readonly status: ProcessStatus }
	| { readonly kind: "error"; readonly error: ProcessError }
	| { readonly kind: "audit"; readonly audit: ProcessAuditRecord }
	| { readonly kind: "cursor"; readonly cursor: ProcessCursor };

type ProcessEffectRunnerFact<TResult = unknown> =
	| { readonly kind: "outcome"; readonly outcome: ProcessEffectOutcome<TResult> }
	| {
			readonly kind: "command";
			readonly command: ProcessCommand<ProcessEffectCommandPayload<TResult>>;
	  }
	| { readonly kind: "error"; readonly error: ProcessEffectRunnerError };

interface AttachedProcessCommandSources<TCommand> {
	sources: Node<ProcessCommand<TCommand>>[];
}

const processCommandSources = new WeakMap<
	ProcessBundle<unknown, unknown, unknown, unknown>,
	AttachedProcessCommandSources<unknown>
>();

/**
 * Build a D136 ProcessBundle from graph-visible command facts and a reducer.
 *
 * The bundle retains its runtime/projection nodes until `release()` is called.
 * Reducer and validation failures are emitted as DATA error/status/audit facts;
 * they do not mint protocol ERROR messages or own restore/hydration behavior.
 * @param graph - Graph that owns the created nodes or projector.
 * @param opts - Options that configure the helper.
 * @returns A bundle of graph-visible nodes for the recipe.
 * @category orchestration
 * @example
 * ```ts
 * import { processBundle } from "@graphrefly/ts/orchestration";
 * ```
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
	const bundle: ProcessBundle<TCommand, TState, TEvent, TEffect> = {
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
				processCommandSources.delete(
					bundle as unknown as ProcessBundle<unknown, unknown, unknown, unknown>,
				);
			} catch (error) {
				releaseRetains = retainProcessNodes();
				throw error;
			}
		},
	};
	processCommandSources.set(
		bundle as unknown as ProcessBundle<unknown, unknown, unknown, unknown>,
		{ sources: [] },
	);
	return bundle;
}

/**
 * Build a D156 graph-visible effect runner adapter over a ProcessBundle.
 *
 * The runner consumes visible effect-request and outcome facts, then publishes
 * ordinary ProcessCommand DATA facts back through process.command via a declared
 * graph edge. Async handlers, timers, and process state ownership stay outside
 * this helper.
 * @param graph - Graph that owns the created nodes or projector.
 * @param process - process value used by the helper.
 * @param opts - Options that configure the helper.
 * @returns A `ProcessEffectRunnerBundle<TEffect, TResult>` value.
 * @category orchestration
 * @example
 * ```ts
 * import { processEffectRunner } from "@graphrefly/ts/orchestration";
 * ```
 */
export function processEffectRunner<TEffect = unknown, TResult = unknown>(
	graph: Graph,
	process: ProcessBundle<unknown, unknown, unknown, TEffect>,
	opts: ProcessEffectRunnerOptions<TResult>,
): ProcessEffectRunnerBundle<TEffect, TResult> {
	if (opts.outcomes.length === 0) {
		throw new RangeError("processEffectRunner: outcomes must contain at least one node");
	}
	const name = opts.name ?? "processEffectRunner";
	const topology = graph.topologyGroup({ name: `${name}.effectRunner` });
	const requests = topology.node<ProcessEffectRequest<TEffect>>(
		[process.effectRequests],
		(ctx) => {
			for (const request of depBatch(ctx, 0) ?? []) {
				ctx.down([["DATA", request as ProcessEffectRequest<TEffect>]]);
			}
		},
		{
			name: `${name}/requests`,
			factory: "processEffectRunnerRequests",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const runtime = topology.node<ProcessEffectRunnerFact<TResult>>(
		[...opts.outcomes],
		(ctx) => {
			for (let i = 0; i < opts.outcomes.length; i += 1) {
				for (const raw of depBatch(ctx, i) ?? []) {
					const parsed = parseProcessEffectOutcome<TResult>(raw);
					if (typeof parsed === "string") {
						const error = {
							code: "malformed-outcome",
							message: parsed,
							outcome: raw,
						} satisfies ProcessEffectRunnerError;
						ctx.down([["DATA", { kind: "error", error }]]);
						continue;
					}
					const outcome = parsed as ProcessEffectOutcome<TResult>;
					const command = processEffectOutcomeCommand(outcome);
					ctx.down([["DATA", { kind: "outcome", outcome }]]);
					ctx.down([["DATA", { kind: "command", command }]]);
				}
			}
		},
		{
			name: `${name}/runtime`,
			factory: "processEffectRunner",
			meta: { process: "effect-runner", d: "D156" },
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const outcomes = processEffectRunnerProjection<ProcessEffectOutcome<TResult>, TResult>(
		topology,
		runtime,
		`${name}/outcomes`,
		"processEffectRunnerOutcomes",
		(fact) => (fact.kind === "outcome" ? fact.outcome : undefined),
	);
	const commands = processEffectRunnerProjection<
		ProcessCommand<ProcessEffectCommandPayload<TResult>>,
		TResult
	>(topology, runtime, `${name}/commands`, "processEffectRunnerCommands", (fact) =>
		fact.kind === "command" ? fact.command : undefined,
	);
	const errors = processEffectRunnerProjection<ProcessEffectRunnerError, TResult>(
		topology,
		runtime,
		`${name}/errors`,
		"processEffectRunnerErrors",
		(fact) => (fact.kind === "error" ? fact.error : undefined),
	);
	const status = topology.node<ProcessEffectRunnerStatus>(
		[requests, runtime],
		(ctx) => {
			let state =
				ctx.state.get<ProcessEffectRunnerState>() ??
				({ requested: 0, commanded: 0, rejected: 0 } satisfies ProcessEffectRunnerState);
			for (const request of depBatch(ctx, 0) ?? []) {
				state = { ...state, requested: state.requested + 1 };
				const typedRequest = request as ProcessEffectRequest<TEffect>;
				ctx.down([
					[
						"DATA",
						{
							state: "requested",
							effectId: typedRequest.id,
							effectType: typedRequest.type,
							requested: state.requested,
							commanded: state.commanded,
							rejected: state.rejected,
						} satisfies ProcessEffectRunnerStatus,
					],
				]);
			}
			for (const fact of depBatch(ctx, 1) ?? []) {
				const typedFact = fact as ProcessEffectRunnerFact<TResult>;
				if (typedFact.kind === "command") {
					state = { ...state, commanded: state.commanded + 1 };
					ctx.down([
						[
							"DATA",
							{
								state: "commanded",
								effectId: typedFact.command.payload.effectId,
								effectType: typedFact.command.payload.effectType,
								commandId: typedFact.command.id,
								commandType: typedFact.command.type as ProcessEffectCommandType,
								requested: state.requested,
								commanded: state.commanded,
								rejected: state.rejected,
							} satisfies ProcessEffectRunnerStatus,
						],
					]);
				}
				if (typedFact.kind === "error") {
					state = { ...state, rejected: state.rejected + 1 };
					ctx.down([
						[
							"DATA",
							{
								state: "rejected",
								effectId: typedFact.error.effectId,
								effectType: typedFact.error.effectType,
								requested: state.requested,
								commanded: state.commanded,
								rejected: state.rejected,
							} satisfies ProcessEffectRunnerStatus,
						],
					]);
				}
			}
			ctx.state.set(state);
		},
		{
			name: `${name}/status`,
			factory: "processEffectRunnerStatus",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const retainRunnerNodes = () => [
		graph.retain(requests, { reason: `${name}.effectRunner.requests` }),
		graph.retain(outcomes, { reason: `${name}.effectRunner.outcomes` }),
		graph.retain(commands, { reason: `${name}.effectRunner.commands` }),
		graph.retain(status, { reason: `${name}.effectRunner.status` }),
		graph.retain(errors, { reason: `${name}.effectRunner.errors` }),
	];
	let releaseRetains = retainRunnerNodes();
	try {
		attachProcessCommandSource(process, commands);
	} catch (error) {
		for (const releaseRetain of releaseRetains) releaseRetain();
		releaseRetains = [];
		topology.release({ reason: `${name}.effectRunner.failedAttach` });
		throw error;
	}
	let released = false;
	return {
		requests,
		outcomes,
		commands,
		status,
		errors,
		release() {
			if (released) return;
			const activeRetains = releaseRetains;
			releaseRetains = [];
			for (const releaseRetain of activeRetains) releaseRetain();
			detachProcessCommandSource(process, commands);
			try {
				topology.release({ reason: `${name}.effectRunner.release` });
				released = true;
			} catch (error) {
				attachProcessCommandSource(process, commands);
				releaseRetains = retainRunnerNodes();
				throw error;
			}
		},
	};
}

interface ProcessEffectRunnerState {
	requested: number;
	commanded: number;
	rejected: number;
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

function processEffectRunnerProjection<T, TResult>(
	topology: TopologyGroup,
	runtime: Node<ProcessEffectRunnerFact<TResult>>,
	name: string,
	factory: string,
	pick: (fact: ProcessEffectRunnerFact<TResult>) => T | undefined,
): Node<T> {
	return topology.node<T>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const value = pick(fact as ProcessEffectRunnerFact<TResult>);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{
			name,
			factory,
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function parseProcessEffectOutcome<TResult>(raw: unknown): ProcessEffectOutcome<TResult> | string {
	if (!isObjectRecord(raw)) return "processEffectRunner: outcome must be an object";
	if (typeof raw.kind !== "string") {
		return "processEffectRunner: outcome kind must be a string";
	}
	if (
		raw.kind !== "result" &&
		raw.kind !== "failure" &&
		raw.kind !== "cancel" &&
		raw.kind !== "timeout"
	) {
		return "processEffectRunner: outcome kind must be result, failure, cancel, or timeout";
	}
	if (typeof raw.effectId !== "string" || raw.effectId.length === 0) {
		return "processEffectRunner: outcome effectId must be a non-empty string";
	}
	if (typeof raw.effectType !== "string" || raw.effectType.length === 0) {
		return "processEffectRunner: outcome effectType must be a non-empty string";
	}
	if ("commandId" in raw && raw.commandId !== undefined) {
		if (typeof raw.commandId !== "string" || raw.commandId.length === 0) {
			return "processEffectRunner: outcome commandId must be a non-empty string";
		}
	}
	for (const key of ["processId", "correlationId", "causationId"] as const) {
		if (key in raw && raw[key] !== undefined && typeof raw[key] !== "string") {
			return `processEffectRunner: outcome ${key} must be a string`;
		}
	}
	if ("metadata" in raw && raw.metadata !== undefined && !isObjectRecord(raw.metadata)) {
		return "processEffectRunner: outcome metadata must be a plain object";
	}
	if (raw.kind === "result" && !("value" in raw)) {
		return "processEffectRunner: result outcome must carry value";
	}
	if ((raw.kind === "failure" || raw.kind === "timeout") && !("error" in raw)) {
		return `processEffectRunner: ${raw.kind} outcome must carry error`;
	}
	if (
		raw.kind === "cancel" &&
		"reason" in raw &&
		raw.reason !== undefined &&
		typeof raw.reason !== "string"
	) {
		return "processEffectRunner: cancel outcome reason must be a string";
	}
	return raw as unknown as ProcessEffectOutcome<TResult>;
}

function processEffectOutcomeCommand<TResult>(
	outcome: ProcessEffectOutcome<TResult>,
): ProcessCommand<ProcessEffectCommandPayload<TResult>> {
	const commandType = processEffectCommandType(outcome.kind);
	return {
		id:
			outcome.commandId ??
			compoundTupleKey("process-effect-command", [outcome.effectId, commandType]),
		type: commandType,
		payload: processEffectCommandPayload(outcome),
		processId: outcome.processId,
		correlationId: outcome.correlationId,
		causationId: outcome.causationId,
		metadata: outcome.metadata,
	};
}

function processEffectCommandType(kind: ProcessEffectOutcome["kind"]): ProcessEffectCommandType {
	switch (kind) {
		case "result":
			return "effect.result";
		case "failure":
			return "effect.failure";
		case "cancel":
			return "effect.cancel";
		case "timeout":
			return "effect.timeout";
	}
}

function processEffectCommandPayload<TResult>(
	outcome: ProcessEffectOutcome<TResult>,
): ProcessEffectCommandPayload<TResult> {
	const base = {
		effectId: outcome.effectId,
		effectType: outcome.effectType,
		processId: outcome.processId,
		correlationId: outcome.correlationId,
		causationId: outcome.causationId,
		metadata: outcome.metadata,
	};
	switch (outcome.kind) {
		case "result":
			return { ...base, kind: "result", value: outcome.value };
		case "failure":
			return { ...base, kind: "failure", error: outcome.error };
		case "cancel":
			return { ...base, kind: "cancel", reason: outcome.reason };
		case "timeout":
			return { ...base, kind: "timeout", error: outcome.error };
	}
}

function attachProcessCommandSource(
	process: ProcessBundle<unknown, unknown, unknown, unknown>,
	source: Node<ProcessCommand<unknown>>,
): void {
	const attached = processCommandSources.get(process);
	if (attached === undefined) {
		throw new Error("processEffectRunner: process command source registry missing");
	}
	const sources = attached.sources as Node<ProcessCommand<unknown>>[];
	const previousSources = [...sources];
	if (!sources.includes(source)) sources.push(source);
	try {
		process.command.replaceDeps([...sources], processCommandSourceFn(sources.length));
	} catch (error) {
		sources.splice(0, sources.length, ...previousSources);
		process.command.replaceDeps(
			[...previousSources],
			processCommandSourceFn(previousSources.length),
		);
		throw error;
	}
}

function detachProcessCommandSource(
	process: ProcessBundle<unknown, unknown, unknown, unknown>,
	source: Node<ProcessCommand<unknown>>,
): void {
	const attached = processCommandSources.get(process);
	if (attached === undefined) {
		throw new Error("processEffectRunner: process command source registry missing");
	}
	const sources = attached.sources as Node<ProcessCommand<unknown>>[];
	if (!sources.includes(source)) return;
	const previousSources = [...sources];
	const nextSources = sources.filter((candidate) => candidate !== source);
	sources.splice(0, sources.length, ...nextSources);
	try {
		process.command.replaceDeps([...nextSources], processCommandSourceFn(nextSources.length));
	} catch (error) {
		sources.splice(0, sources.length, ...previousSources);
		process.command.replaceDeps(
			[...previousSources],
			processCommandSourceFn(previousSources.length),
		);
		throw error;
	}
}

function processCommandSourceFn(sourceCount: number) {
	return (ctx: Parameters<NodeFn>[0]) => {
		for (let i = 0; i < sourceCount; i += 1) {
			for (const command of depBatch(ctx, i) ?? []) {
				ctx.down([["DATA", command as ProcessCommand<unknown>]]);
			}
		}
	};
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
				: compoundTupleKey("process-event", [command.id, String(state.eventSeq + i + 1)]);
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
				: compoundTupleKey("process-effect", [command.id, String(state.effectSeq + i + 1)]);
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
