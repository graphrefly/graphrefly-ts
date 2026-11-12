/**
 * Graph-visible ProcessBundle orchestration helpers (D136/D156).
 */

import type { NodeFn } from "../ctx/types.js";
import { toCheckpointJson } from "../graph/checkpoint.js";
import type { Graph, TopologyGroup } from "../graph/graph.js";
import type { GraphRecipeContext, GraphRecipeFactory } from "../graph/restore.js";
import { compoundTupleKey } from "../identity.js";
import { type AttachableInput, attachableInput } from "../node/attachable-input.js";
import type { Node } from "../node/node.js";
import type { NodeOptions } from "../node/types.js";
import type { Message } from "../protocol/messages.js";
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

const processCommandSources = new WeakMap<
	ProcessBundle<unknown, unknown, unknown, unknown>,
	{
		readonly input: AttachableInput;
		readonly detaches: Map<Node<unknown>, () => void>;
		/** The command node's graph id, which a runner's commands recipe names. */
		readonly commandId: string;
	}
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
	if (opts.nowRef !== undefined && opts.now === undefined) {
		throw new TypeError("processBundle: nowRef names the clock given as now");
	}
	const name = opts.name ?? "process";
	const now = opts.now ?? Date.now;
	// R-checkpoint@1: the runtime's recipe names its reducer and clock; a user function with no
	// ref cannot be named, so the runtime is then local-only.
	const runtimeConfig: ProcessRuntimeConfig | undefined =
		opts.reduceRef !== undefined && (opts.now === undefined || opts.nowRef !== undefined)
			? {
					initialState: toCheckpointJson(opts.initialState, "processBundle.initialState"),
					reduceRef: opts.reduceRef,
					...(opts.nowRef === undefined ? {} : { nowRef: opts.nowRef }),
				}
			: undefined;
	const topology = graph.topologyGroup({ name: `${name}.process` });
	// The host's dispatches are a state input; the command node forwards it and every attached
	// command source, which it rewires itself to (no graph-level rewire, R-request-order).
	const dispatchInput = topology.node<ProcessCommand<TCommand>>([], null, {
		name: `${name}/dispatch`,
		factory: "processDispatch",
		complete: "manual",
		error: "manual",
	});
	const commandSources = attachableInput();
	const commandDetaches = new Map<Node<unknown>, () => void>();
	const command = topology.node<ProcessCommand<TCommand>>([dispatchInput], processCommandFn(), {
		name: `${name}/command`,
		factory: "processCommand",
		complete: "manual",
		error: "manual",
		setup: commandSources.setup,
		recipe: { ref: PROCESS_COMMAND_REF },
	});
	commandSources.bind(command as Node<unknown>);
	const runtime = topology.node<ProcessRuntimeFact<TState, TEvent, TEffect>>(
		[command],
		processRuntimeFn(
			opts.initialState,
			opts.reduce as ProcessReducer<unknown, TState, unknown, unknown>,
			now,
		),
		{
			name: `${name}/runtime`,
			factory: "processRuntime",
			meta: { process: "facts-plus-reducer", d: "D136" },
			complete: "manual",
			error: "manual",
			...(runtimeConfig === undefined
				? {}
				: { recipe: { ref: PROCESS_RUNTIME_REF, config: runtimeConfig } }),
		},
	);
	const project = <TOut>(kind: ProcessFactKind, suffix: string, factory: string): Node<TOut> =>
		processProjection<TOut>(topology, runtime, `${name}/${suffix}`, factory, kind);
	const events = project<ProcessEvent<TEvent>>("event", "events", "processEvents");
	const state = project<TState>("state", "state", "processState");
	const audit = project<ProcessAuditRecord>("audit", "audit", "processAudit");
	const effectRequests = project<ProcessEffectRequest<TEffect>>(
		"effect-request",
		"effectRequests",
		"processEffectRequests",
	);
	const status = project<ProcessStatus>("status", "status", "processStatus");
	const errors = project<ProcessError>("error", "errors", "processErrors");
	const cursor = project<ProcessCursor>("cursor", "cursor", "processCursor");
	const retainProcessNodes = () => [
		graph.retain(runtime),
		graph.retain(events),
		graph.retain(state),
		graph.retain(audit),
		graph.retain(effectRequests),
		graph.retain(status),
		graph.retain(errors),
		graph.retain(cursor),
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
			dispatchInput.set(next);
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
		{ input: commandSources, detaches: commandDetaches, commandId: `${name}/command` },
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
		processEffectRunnerRequestsFn(),
		{
			name: `${name}/requests`,
			factory: "processEffectRunnerRequests",
			complete: "manual",
			error: "manual",
			recipe: { ref: RUNNER_REQUESTS_REF },
		},
	);
	const runtime = topology.node<ProcessEffectRunnerFact<TResult>>(
		[...opts.outcomes],
		processEffectRunnerRuntimeFn(),
		{
			name: `${name}/runtime`,
			factory: "processEffectRunner",
			meta: { process: "effect-runner", d: "D156" },
			complete: "manual",
			error: "manual",
			recipe: { ref: RUNNER_RUNTIME_REF },
		},
	);
	const outcomes = processEffectRunnerProjection<ProcessEffectOutcome<TResult>, TResult>(
		topology,
		runtime,
		`${name}/outcomes`,
		"processEffectRunnerOutcomes",
		{ kind: "outcome" },
	);
	// The commands node is attached to the process's command input; its recipe names that input,
	// so a restored runner attaches to the restored process again (R-checkpoint@1).
	const processCommandId = processCommandSources.get(
		process as unknown as ProcessBundle<unknown, unknown, unknown, unknown>,
	)?.commandId;
	const commands = processEffectRunnerProjection<
		ProcessCommand<ProcessEffectCommandPayload<TResult>>,
		TResult
	>(topology, runtime, `${name}/commands`, "processEffectRunnerCommands", {
		kind: "command",
		...(processCommandId === undefined ? {} : { processCommand: processCommandId }),
	});
	const errors = processEffectRunnerProjection<ProcessEffectRunnerError, TResult>(
		topology,
		runtime,
		`${name}/errors`,
		"processEffectRunnerErrors",
		{ kind: "error" },
	);
	const status = topology.node<ProcessEffectRunnerStatus>(
		[requests, runtime],
		processEffectRunnerStatusFn(),
		{
			name: `${name}/status`,
			factory: "processEffectRunnerStatus",
			complete: "manual",
			error: "manual",
			recipe: { ref: RUNNER_STATUS_REF },
		},
	);
	const retainRunnerNodes = () => [
		graph.retain(requests),
		graph.retain(outcomes),
		graph.retain(commands),
		graph.retain(status),
		graph.retain(errors),
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

const PROCESS_COMMAND_REF = "process.command";
const PROCESS_RUNTIME_REF = "process.runtime";
const PROCESS_PROJECTION_REF = "process.projection";
const RUNNER_REQUESTS_REF = "processEffectRunner.requests";
const RUNNER_RUNTIME_REF = "processEffectRunner.runtime";
const RUNNER_PROJECTION_REF = "processEffectRunner.projection";
const RUNNER_STATUS_REF = "processEffectRunner.status";

/** The process runtime's recipe config: its initial state and the refs of its functions. */
interface ProcessRuntimeConfig {
	readonly initialState: unknown;
	readonly reduceRef: string;
	readonly nowRef?: string;
}

type ProcessFactKind = ProcessRuntimeFact["kind"];

const PROCESS_FACT_KINDS: readonly ProcessFactKind[] = [
	"state",
	"event",
	"effect-request",
	"status",
	"error",
	"audit",
	"cursor",
];

/** A runner projection's recipe config; the commands projection names the process input. */
interface RunnerProjectionConfig {
	readonly kind: ProcessEffectRunnerFact["kind"];
	readonly processCommand?: string;
}

/** The command node forwards every dependency's values: the dispatch input and attached sources. */
function processCommandFn(): NodeFn {
	return (ctx) => {
		const out: Message[] = [];
		for (let i = 0; i < ctx.deps.length; i += 1)
			for (const next of ctx.deps[i].waves.flat()) out.push(["DATA", next]);
		ctx.down(out);
	};
}

function processRuntimeFn<TState>(
	initialState: TState,
	reduce: ProcessReducer<unknown, TState, unknown, unknown>,
	now: () => number,
): NodeFn {
	return (ctx) => {
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
				state: initialState,
			} satisfies ProcessRuntimeState<TState>);
		for (const raw of ctx.deps[0].waves.flat()) {
			state = reduceProcessCommandFact(raw, state, reduce, now, (fact) =>
				ctx.down([["DATA", fact]]),
			);
			ctx.state.set(state);
		}
	};
}

function processFactValue(fact: ProcessRuntimeFact, kind: ProcessFactKind): unknown {
	if (fact.kind !== kind) return undefined;
	switch (fact.kind) {
		case "state":
			return fact.state;
		case "event":
			return fact.event;
		case "effect-request":
			return fact.effect;
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

function processProjectionFn(kind: ProcessFactKind): NodeFn {
	return (ctx) => {
		const values: unknown[] = [];
		for (const raw of ctx.deps[0].waves.flat()) {
			const selected = processFactValue(raw as ProcessRuntimeFact, kind);
			if (selected !== undefined) values.push(selected);
		}
		ctx.down(values.map((v) => ["DATA", v] as const));
	};
}

function processEffectRunnerRequestsFn(): NodeFn {
	return (ctx) => {
		const values = ctx.deps[0].waves.flat();
		ctx.down(values.map((v) => ["DATA", v] as const));
	};
}

/** The runner's runtime reads every outcome dependency, in dependency order. */
function processEffectRunnerRuntimeFn(): NodeFn {
	return (ctx) => {
		const facts: ProcessEffectRunnerFact[] = [];
		for (let i = 0; i < ctx.deps.length; i += 1) {
			for (const raw of ctx.deps[i].waves.flat()) {
				const parsed = parseProcessEffectOutcome<unknown>(raw);
				if (typeof parsed === "string") {
					const error = {
						code: "malformed-outcome",
						message: parsed,
						outcome: raw,
					} satisfies ProcessEffectRunnerError;
					facts.push({ kind: "error", error });
					continue;
				}
				const command = processEffectOutcomeCommand(parsed);
				facts.push({ kind: "outcome", outcome: parsed });
				facts.push({ kind: "command", command });
			}
		}
		ctx.down(facts.map((v) => ["DATA", v] as const));
	};
}

function processEffectRunnerProjectionFn(kind: ProcessEffectRunnerFact["kind"]): NodeFn {
	return (ctx) => {
		const values: unknown[] = [];
		for (const raw of ctx.deps[0].waves.flat()) {
			const fact = raw as ProcessEffectRunnerFact;
			if (fact.kind !== kind) continue;
			const value =
				fact.kind === "outcome"
					? fact.outcome
					: fact.kind === "command"
						? fact.command
						: fact.error;
			values.push(value);
		}
		ctx.down(values.map((v) => ["DATA", v] as const));
	};
}

function processEffectRunnerStatusFn(): NodeFn {
	return (ctx) => {
		const statuses: ProcessEffectRunnerStatus[] = [];
		let state =
			ctx.state.get<ProcessEffectRunnerState>() ??
			({ requested: 0, commanded: 0, rejected: 0 } satisfies ProcessEffectRunnerState);
		for (const request of ctx.deps[0].waves.flat()) {
			state = { ...state, requested: state.requested + 1 };
			const typedRequest = request as ProcessEffectRequest<unknown>;
			statuses.push({
				state: "requested",
				effectId: typedRequest.id,
				effectType: typedRequest.type,
				requested: state.requested,
				commanded: state.commanded,
				rejected: state.rejected,
			});
		}
		for (const fact of ctx.deps[1]?.waves.flat() ?? []) {
			const typedFact = fact as ProcessEffectRunnerFact;
			if (typedFact.kind === "command") {
				state = { ...state, commanded: state.commanded + 1 };
				statuses.push({
					state: "commanded",
					effectId: typedFact.command.payload.effectId,
					effectType: typedFact.command.payload.effectType,
					commandId: typedFact.command.id,
					commandType: typedFact.command.type as ProcessEffectCommandType,
					requested: state.requested,
					commanded: state.commanded,
					rejected: state.rejected,
				});
			}
			if (typedFact.kind === "error") {
				state = { ...state, rejected: state.rejected + 1 };
				const { effectId, effectType } = typedFact.error;
				statuses.push({
					state: "rejected",
					...(effectId === undefined ? {} : { effectId }),
					...(effectType === undefined ? {} : { effectType }),
					requested: state.requested,
					commanded: state.commanded,
					rejected: state.rejected,
				});
			}
		}
		ctx.state.set(state);
		ctx.down(statuses.map((v) => ["DATA", v] as const));
	};
}

/**
 * Restored runners' commands nodes by the restored process command node they attach to: a
 * runner's commands recipe registers here as it is built, and the restored command node's first
 * setup attaches them, so later lifetimes rewire to them again (R-checkpoint@1, R-lifetime).
 */
const restoredProcessAttachments = new WeakMap<Graph, Map<string, string[]>>();

function restoredAttachmentList(graph: Graph, commandId: string): string[] {
	let byCommand = restoredProcessAttachments.get(graph);
	if (byCommand === undefined) {
		byCommand = new Map();
		restoredProcessAttachments.set(graph, byCommand);
	}
	let list = byCommand.get(commandId);
	if (list === undefined) {
		list = [];
		byCommand.set(commandId, list);
	}
	return list;
}

function restoredProcessCommandSetup(ctx: GraphRecipeContext): NodeOptions["setup"] {
	const input = attachableInput();
	const { graph, id } = ctx;
	let attached = false;
	return (nodeCtx) => {
		if (!attached) {
			attached = true;
			const self = graph.find(id);
			if (self === undefined) throw new Error(`restoreGraph: '${id}' was not restored`);
			input.bind(self);
			// Attached before the input's setup, which rewires to every attached source.
			for (const sourceId of restoredProcessAttachments.get(graph)?.get(id) ?? []) {
				const source = graph.find(sourceId);
				if (source === undefined)
					throw new Error(`restoreGraph: '${id}' attaches '${sourceId}', which was not restored`);
				input.attach(source);
			}
		}
		return input.setup(nodeCtx);
	};
}

function recipeObject(config: unknown, ref: string): Record<string, unknown> {
	if (typeof config !== "object" || config === null || Array.isArray(config))
		throw new Error(`restoreGraph: '${ref}' recipe requires an object config`);
	return config as Record<string, unknown>;
}

function noRecipeConfig(config: unknown, ref: string): undefined {
	if (config !== undefined) throw new Error(`restoreGraph: '${ref}' takes no config`);
	return undefined;
}

function optionalRef(value: unknown, ref: string, key: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`restoreGraph: '${ref}' config.${key} must be a non-empty string`);
	return value;
}

/**
 * Restore entries for ProcessBundle and processEffectRunner nodes (R-checkpoint@1): add them to
 * the registry given to restoreGraph, with the process reducer registered as a definition under
 * the bundle's `reduceRef` (and its clock under `nowRef`, when it has one).
 * @category orchestration
 * @example
 * ```ts
 * import { defaultRestoreRegistry, restoreGraph } from "@graphrefly/ts/graph";
 * import { processRestoreRegistry } from "@graphrefly/ts/orchestration";
 *
 * const g = restoreGraph(checkpoint, {
 *   registry: {
 *     ...defaultRestoreRegistry,
 *     ...processRestoreRegistry,
 *     "orders.reduce": { kind: "definition", ref: "orders.reduce", fn: reduce },
 *   },
 * });
 * ```
 */
export const processRestoreRegistry: Readonly<Record<string, GraphRecipeFactory<any>>> = {
	[PROCESS_COMMAND_REF]: {
		ref: PROCESS_COMMAND_REF,
		validateConfig: (config) => noRecipeConfig(config, PROCESS_COMMAND_REF),
		build(_config, ctx) {
			return { fn: processCommandFn(), setup: restoredProcessCommandSetup(ctx) };
		},
	} satisfies GraphRecipeFactory<undefined>,
	[PROCESS_RUNTIME_REF]: {
		ref: PROCESS_RUNTIME_REF,
		validateConfig(config): ProcessRuntimeConfig {
			const c = recipeObject(config, PROCESS_RUNTIME_REF);
			const reduceRef = optionalRef(c.reduceRef, PROCESS_RUNTIME_REF, "reduceRef");
			if (reduceRef === undefined)
				throw new Error(`restoreGraph: '${PROCESS_RUNTIME_REF}' config.reduceRef is required`);
			if (c.initialState === undefined)
				throw new Error(`restoreGraph: '${PROCESS_RUNTIME_REF}' config.initialState is required`);
			const nowRef = optionalRef(c.nowRef, PROCESS_RUNTIME_REF, "nowRef");
			return {
				initialState: c.initialState,
				reduceRef,
				...(nowRef === undefined ? {} : { nowRef }),
			};
		},
		build(config: ProcessRuntimeConfig, ctx) {
			const reduce = ctx.definition(config.reduceRef).fn as unknown as ProcessReducer<
				unknown,
				unknown,
				unknown,
				unknown
			>;
			const clock =
				config.nowRef === undefined ? undefined : ctx.definition<undefined, number>(config.nowRef);
			const now = clock === undefined ? Date.now : () => clock.fn(undefined);
			return { fn: processRuntimeFn(config.initialState, reduce, now) };
		},
	} satisfies GraphRecipeFactory<ProcessRuntimeConfig>,
	[PROCESS_PROJECTION_REF]: {
		ref: PROCESS_PROJECTION_REF,
		validateConfig(config): { readonly kind: ProcessFactKind } {
			const kind = recipeObject(config, PROCESS_PROJECTION_REF).kind;
			if (!PROCESS_FACT_KINDS.includes(kind as ProcessFactKind))
				throw new Error(`restoreGraph: '${PROCESS_PROJECTION_REF}' config.kind is unknown`);
			return { kind: kind as ProcessFactKind };
		},
		build(config: { readonly kind: ProcessFactKind }) {
			return { fn: processProjectionFn(config.kind) };
		},
	} satisfies GraphRecipeFactory<{ readonly kind: ProcessFactKind }>,
	[RUNNER_REQUESTS_REF]: {
		ref: RUNNER_REQUESTS_REF,
		validateConfig: (config) => noRecipeConfig(config, RUNNER_REQUESTS_REF),
		build() {
			return { fn: processEffectRunnerRequestsFn() };
		},
	} satisfies GraphRecipeFactory<undefined>,
	[RUNNER_RUNTIME_REF]: {
		ref: RUNNER_RUNTIME_REF,
		validateConfig: (config) => noRecipeConfig(config, RUNNER_RUNTIME_REF),
		build() {
			return { fn: processEffectRunnerRuntimeFn() };
		},
	} satisfies GraphRecipeFactory<undefined>,
	[RUNNER_PROJECTION_REF]: {
		ref: RUNNER_PROJECTION_REF,
		validateConfig(config): RunnerProjectionConfig {
			const c = recipeObject(config, RUNNER_PROJECTION_REF);
			if (c.kind !== "outcome" && c.kind !== "command" && c.kind !== "error")
				throw new Error(
					`restoreGraph: '${RUNNER_PROJECTION_REF}' config.kind must be outcome, command or error`,
				);
			const processCommand = optionalRef(c.processCommand, RUNNER_PROJECTION_REF, "processCommand");
			if (processCommand !== undefined && c.kind !== "command")
				throw new Error(
					`restoreGraph: '${RUNNER_PROJECTION_REF}' only the commands projection names a process command`,
				);
			return { kind: c.kind, ...(processCommand === undefined ? {} : { processCommand }) };
		},
		build(config: RunnerProjectionConfig, ctx) {
			if (config.processCommand !== undefined)
				restoredAttachmentList(ctx.graph, config.processCommand).push(ctx.id);
			return { fn: processEffectRunnerProjectionFn(config.kind) };
		},
	} satisfies GraphRecipeFactory<RunnerProjectionConfig>,
	[RUNNER_STATUS_REF]: {
		ref: RUNNER_STATUS_REF,
		validateConfig: (config) => noRecipeConfig(config, RUNNER_STATUS_REF),
		build() {
			return { fn: processEffectRunnerStatusFn() };
		},
	} satisfies GraphRecipeFactory<undefined>,
};

function processEffectRunnerProjection<T, TResult>(
	topology: TopologyGroup,
	runtime: Node<ProcessEffectRunnerFact<TResult>>,
	name: string,
	factory: string,
	config: RunnerProjectionConfig,
): Node<T> {
	return topology.node<T>([runtime], processEffectRunnerProjectionFn(config.kind), {
		name,
		factory,
		complete: "manual",
		error: "manual",
		recipe: { ref: RUNNER_PROJECTION_REF, config },
	});
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
	// Absent optional fields are omitted, not set to undefined: a fact is strict JSON
	// (R-checkpoint@1).
	return {
		id:
			outcome.commandId ??
			compoundTupleKey("process-effect-command", [outcome.effectId, commandType]),
		type: commandType,
		payload: processEffectCommandPayload(outcome),
		...outcomeCorrelation(outcome),
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
		...outcomeCorrelation(outcome),
	};
	switch (outcome.kind) {
		case "result":
			return { ...base, kind: "result", value: outcome.value };
		case "failure":
			return { ...base, kind: "failure", error: outcome.error };
		case "cancel":
			return {
				...base,
				kind: "cancel",
				...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
			};
		case "timeout":
			return { ...base, kind: "timeout", error: outcome.error };
	}
}

function outcomeCorrelation(outcome: ProcessEffectOutcome<unknown>): {
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly metadata?: Record<string, unknown>;
} {
	return {
		...(outcome.processId === undefined ? {} : { processId: outcome.processId }),
		...(outcome.correlationId === undefined ? {} : { correlationId: outcome.correlationId }),
		...(outcome.causationId === undefined ? {} : { causationId: outcome.causationId }),
		...(outcome.metadata === undefined ? {} : { metadata: outcome.metadata }),
	};
}

function attachProcessCommandSource(
	process: ProcessBundle<unknown, unknown, unknown, unknown>,
	source: Node<ProcessCommand<unknown>>,
): void {
	const attached = processCommandSources.get(process);
	if (attached === undefined) {
		throw new Error("processEffectRunner: process command source registry missing");
	}
	if (attached.detaches.has(source as Node<unknown>)) return;
	attached.detaches.set(source as Node<unknown>, attached.input.attach(source as Node<unknown>));
}

function detachProcessCommandSource(
	process: ProcessBundle<unknown, unknown, unknown, unknown>,
	source: Node<ProcessCommand<unknown>>,
): void {
	const attached = processCommandSources.get(process);
	if (attached === undefined) {
		throw new Error("processEffectRunner: process command source registry missing");
	}
	const detach = attached.detaches.get(source as Node<unknown>);
	attached.detaches.delete(source as Node<unknown>);
	detach?.();
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

function processProjection<TOut>(
	graph: Graph | TopologyGroup,
	runtime: Node<unknown>,
	name: string,
	factory: string,
	kind: ProcessFactKind,
): Node<TOut> {
	return graph.node<TOut>([runtime], processProjectionFn(kind), {
		name,
		factory,
		complete: "manual",
		error: "manual",
		recipe: { ref: PROCESS_PROJECTION_REF, config: { kind } },
	});
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
