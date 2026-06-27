import type { Node } from "../node/node.js";

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

export type ProcessEffectCommandType =
	| "effect.result"
	| "effect.failure"
	| "effect.cancel"
	| "effect.timeout";

interface ProcessEffectOutcomeBase {
	readonly effectId: string;
	readonly effectType: string;
	readonly processId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
	readonly commandId?: string;
	readonly metadata?: Record<string, unknown>;
}

export type ProcessEffectOutcome<TResult = unknown> =
	| (ProcessEffectOutcomeBase & { readonly kind: "result"; readonly value: TResult })
	| (ProcessEffectOutcomeBase & { readonly kind: "failure"; readonly error: unknown })
	| (ProcessEffectOutcomeBase & { readonly kind: "cancel"; readonly reason?: string })
	| (ProcessEffectOutcomeBase & { readonly kind: "timeout"; readonly error: unknown });

export type ProcessEffectCommandPayload<TResult = unknown> =
	| (Omit<ProcessEffectOutcomeBase, "commandId"> & {
			readonly kind: "result";
			readonly value: TResult;
	  })
	| (Omit<ProcessEffectOutcomeBase, "commandId"> & {
			readonly kind: "failure";
			readonly error: unknown;
	  })
	| (Omit<ProcessEffectOutcomeBase, "commandId"> & {
			readonly kind: "cancel";
			readonly reason?: string;
	  })
	| (Omit<ProcessEffectOutcomeBase, "commandId"> & {
			readonly kind: "timeout";
			readonly error: unknown;
	  });

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

export interface ProcessEffectRunnerStatus {
	readonly state: "requested" | "commanded" | "rejected";
	readonly effectId?: string;
	readonly effectType?: string;
	readonly commandId?: string;
	readonly commandType?: ProcessEffectCommandType;
	readonly requested: number;
	readonly commanded: number;
	readonly rejected: number;
}

export interface ProcessEffectRunnerError {
	readonly code: "malformed-outcome";
	readonly message: string;
	readonly outcome?: unknown;
	readonly effectId?: string;
	readonly effectType?: string;
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

export interface ProcessEffectRunnerOptions<TResult = unknown> {
	readonly name?: string;
	readonly outcomes: readonly Node<ProcessEffectOutcome<TResult>>[];
}

export interface ProcessEffectRunnerBundle<TEffect = unknown, TResult = unknown> {
	readonly requests: Node<ProcessEffectRequest<TEffect>>;
	readonly outcomes: Node<ProcessEffectOutcome<TResult>>;
	readonly commands: Node<ProcessCommand<ProcessEffectCommandPayload<TResult>>>;
	readonly status: Node<ProcessEffectRunnerStatus>;
	readonly errors: Node<ProcessEffectRunnerError>;
	release(): void;
}
