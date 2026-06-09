/**
 * Graph-visible wire bridge envelope helpers (D134).
 *
 * This first slice is transport-free: commands become outbound envelope facts,
 * remote receipts enter only through the inbound fact node, and retry/ack timeout
 * state is surfaced through graph-visible attempts/status/errors nodes.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import {
	nextRetryDelayMs,
	type RetryPolicy,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
import type { Node } from "../node/node.js";
import { errorPayload, type Wave } from "../protocol/messages.js";

export type WireBridgeEnvelopeType =
	| "start"
	| "data"
	| "ack"
	| "nack"
	| "status"
	| "error"
	| "close";

export interface WireBridgeMetadata {
	/** Monotonic envelope sequence within the bridge session. */
	readonly seq: number;
	/** Monotonic accepted inbound cursor observed by the sending side. */
	readonly cursor: number;
	/** D151: correlation/idempotency metadata, not an authoritative duplicate lookup key. */
	readonly idempotencyKey: string;
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly timestampMs?: number;
	/** D151 ack/nack correlation target; receipt duplicate recognition still uses seq/cursor. */
	readonly ackForSeq?: number;
	readonly requestId?: string;
}

export type WireBridgePayload<TData = unknown> =
	| { readonly kind: "data"; readonly value: TData }
	| { readonly kind: "error"; readonly error: unknown }
	| { readonly kind: "status"; readonly status: unknown }
	| { readonly kind: "close"; readonly reason?: unknown };

export interface WireBridgeEnvelope<TData = unknown> {
	readonly sessionId: string;
	readonly type: WireBridgeEnvelopeType;
	readonly payload?: WireBridgePayload<TData>;
	readonly metadata: WireBridgeMetadata;
}

export type WireBridgeCommand<TData = unknown> =
	| { readonly kind: "start"; readonly idempotencyKey?: string; readonly requestId?: string }
	| {
			readonly kind: "send";
			readonly payload: TData;
			readonly idempotencyKey?: string;
			readonly requestId?: string;
	  }
	| {
			readonly kind: "ack";
			readonly ackForSeq: number;
			readonly idempotencyKey?: string;
			readonly requestId?: string;
	  }
	| {
			readonly kind: "nack";
			readonly ackForSeq: number;
			readonly error: unknown;
			readonly idempotencyKey?: string;
			readonly requestId?: string;
	  }
	| { readonly kind: "close"; readonly reason?: unknown; readonly idempotencyKey?: string };

export type WireBridgeEvent<TOutbound = unknown, TInbound = unknown> =
	| {
			readonly kind: "outbound";
			readonly envelope: WireBridgeEnvelope<TOutbound>;
	  }
	| {
			readonly kind: "inbound";
			readonly envelope: WireBridgeEnvelope<TInbound>;
	  }
	| {
			readonly kind: "ack";
			readonly ackForSeq: number;
			readonly envelope: WireBridgeEnvelope<TInbound>;
			readonly outbound: WireBridgeEnvelope<TOutbound>;
	  }
	| {
			readonly kind: "nack";
			readonly ackForSeq: number;
			readonly envelope: WireBridgeEnvelope<TInbound>;
			readonly outbound: WireBridgeEnvelope<TOutbound>;
			readonly error: unknown;
	  }
	| { readonly kind: "timeout"; readonly seq: number; readonly attempt: number }
	| {
			readonly kind: "retry";
			readonly seq: number;
			readonly attempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| {
			readonly kind: "exhausted";
			readonly seq: number;
			readonly attempt: number;
			readonly error: unknown;
	  }
	| { readonly kind: "cursor"; readonly cursor: number }
	| { readonly kind: "duplicate"; readonly seq: number; readonly cursor: number }
	| { readonly kind: "out-of-order"; readonly seq: number; readonly expected: number }
	| { readonly kind: "session-mismatch"; readonly expected: string; readonly actual: string }
	| { readonly kind: "late-receipt"; readonly receipt: "ack" | "nack"; readonly ackForSeq: number }
	| { readonly kind: "invalid"; readonly error: string };

export interface WireBridgeAck {
	readonly ackForSeq: number;
	readonly envelope: WireBridgeEnvelope;
}

export interface WireBridgeNack {
	readonly ackForSeq: number;
	readonly envelope: WireBridgeEnvelope;
	readonly error: unknown;
}

export interface WireBridgeAttempt {
	readonly seq: number;
	readonly attempt: number;
	readonly maxAttempts: number;
}

export interface WireBridgeStatus {
	readonly sessionId: string;
	readonly state: "idle" | "started" | "open" | "waiting" | "closed" | "errored" | "exhausted";
	readonly cursor: number;
	readonly nextSeq: number;
	readonly pending: number;
	readonly attempts: number;
	readonly acked: number;
	readonly nacked: number;
	readonly errors: number;
	readonly lastSeq?: number;
	readonly lastDelayMs?: number;
}

export interface WireBridgeOptions {
	readonly name?: string;
	readonly sessionId: string;
	readonly retry?: RetryPolicy;
	/** Finite D134 ack timeout. Defaults to 30s so pending ack tracking is bounded. */
	readonly ackTimeoutMs?: number;
	readonly now?: () => number;
}

export interface WireBridgeBundle<TOutbound = unknown, TInbound = unknown> {
	readonly sessionId: string;
	readonly command: Node<WireBridgeCommand<TOutbound>>;
	readonly outbound: Node<WireBridgeEnvelope<TOutbound>>;
	readonly inbound: Node<WireBridgeEnvelope<TInbound>>;
	readonly events: Node<WireBridgeEvent<TOutbound, TInbound>>;
	readonly acks: Node<WireBridgeAck>;
	readonly nacks: Node<WireBridgeNack>;
	readonly status: Node<WireBridgeStatus>;
	readonly errors: Node<unknown>;
	readonly cursor: Node<number>;
	readonly attempts: Node<WireBridgeAttempt>;
	start(): void;
	send(payload: TOutbound, opts?: { idempotencyKey?: string; requestId?: string }): void;
	ack(ackForSeq: number, opts?: { idempotencyKey?: string; requestId?: string }): void;
	nack(
		ackForSeq: number,
		error: unknown,
		opts?: { idempotencyKey?: string; requestId?: string },
	): void;
	close(reason?: unknown, opts?: { idempotencyKey?: string }): void;
}

export interface RemoteCallRequest<T = unknown> {
	readonly operation: string;
	readonly requestId: string;
	readonly payload: T;
}

export type RemoteCallResponse<T = unknown> =
	| {
			readonly kind: "result";
			readonly operation: string;
			readonly requestId: string;
			readonly payload: T;
	  }
	| {
			readonly kind: "error";
			readonly operation: string;
			readonly requestId: string;
			readonly error: string;
	  }
	| {
			readonly kind: "status";
			readonly operation: string;
			readonly requestId: string;
			readonly status: string;
	  };

export interface RemoteCallResult<T = unknown> {
	readonly operation: string;
	readonly requestId: string;
	readonly payload: T;
}

export type RemoteCallStatusState =
	| "idle"
	| "requested"
	| "responded"
	| "errored"
	| "timed-out"
	| "bridge-errored";

export interface RemoteCallStatus {
	readonly state: RemoteCallStatusState;
	readonly operation?: string;
	readonly requestId?: string;
	readonly pending: number;
	readonly completed: number;
	readonly errors: number;
	readonly timeouts: number;
}

export interface RemoteCallError {
	readonly operation?: string;
	readonly requestId?: string;
	readonly error: string;
}

export interface RemoteCallTimeout {
	readonly operation?: string;
	readonly requestId: string;
	readonly error: string;
}

export interface RemoteCallOptions {
	readonly name?: string;
}

export interface RemoteCallBundle<TRequest = unknown, TResponse = unknown> {
	readonly responses: Node<RemoteCallResponse<TResponse>>;
	readonly results: Node<RemoteCallResult<TResponse>>;
	readonly status: Node<RemoteCallStatus>;
	readonly errors: Node<RemoteCallError>;
	readonly timeouts: Node<RemoteCallTimeout>;
	call(
		operation: string,
		requestId: string,
		payload: TRequest,
		opts?: { readonly idempotencyKey?: string },
	): RemoteCallRequest<TRequest>;
	timeout(requestId: string, operation: string | undefined, error: string): RemoteCallTimeout;
}

export type RemoteResponderHandler<TRequest = unknown, TResponse = unknown> = (
	request: RemoteCallRequest<TRequest>,
) => TResponse;

export interface RemoteResponderHandlerDefinition<TRequest = unknown, TResponse = unknown> {
	readonly operation: string;
	readonly handle: RemoteResponderHandler<TRequest, TResponse>;
}

export type RemoteResponderEvent<TRequest = unknown, TResponse = unknown> =
	| {
			readonly kind: "request";
			readonly request: RemoteCallRequest<TRequest>;
			readonly seq: number;
	  }
	| {
			readonly kind: "response";
			readonly requestId: string;
			readonly operation: string;
			readonly command: WireBridgeCommand<RemoteCallResponse<TResponse>>;
	  }
	| {
			readonly kind: "rejected";
			readonly requestId?: string;
			readonly operation?: string;
			readonly error: string;
			readonly command?: WireBridgeCommand<RemoteCallResponse<TResponse>>;
	  }
	| { readonly kind: "invalid"; readonly error: string };

export type RemoteResponderStatusState = "idle" | "responded" | "rejected" | "errored";

export interface RemoteResponderStatus {
	readonly state: RemoteResponderStatusState;
	readonly operation?: string;
	readonly requestId?: string;
	readonly handled: number;
	readonly rejected: number;
	readonly errors: number;
}

export interface RemoteResponderOptions<TRequest = unknown, TResponse = unknown> {
	readonly name?: string;
	readonly handlers?: readonly RemoteResponderHandlerDefinition<TRequest, TResponse>[];
	/** Default false: non-owned operations are ignored so multiple responders may share one bridge. */
	readonly rejectUnknown?: boolean;
}

export interface RemoteResponderBundle<TRequest = unknown, TResponse = unknown> {
	readonly events: Node<RemoteResponderEvent<TRequest, TResponse>>;
	readonly responseCommands: Node<WireBridgeCommand<RemoteCallResponse<TResponse>>>;
	readonly requests: Node<RemoteCallRequest<TRequest>>;
	readonly status: Node<RemoteResponderStatus>;
	readonly errors: Node<RemoteCallError>;
	release(): void;
}

interface PendingEnvelope<TData> {
	envelope: WireBridgeEnvelope<TData>;
	timer?: ReturnType<typeof setTimeout>;
}

interface BridgeState<TData> {
	active: boolean;
	cleanupInstalled: boolean;
	nextSeq: number;
	cursor: number;
	remoteCursor: number;
	terminalReported: boolean;
	pending: Map<number, PendingEnvelope<TData>>;
}

interface AttachedCommandSources<TOutbound> {
	sources: Node<WireBridgeCommand<TOutbound>>[];
}

interface WireBridgeInvalidIngress {
	readonly __wireBridgeInvalidIngress: true;
	readonly error: string;
}

const envelopeTypes = new Set<WireBridgeEnvelopeType>([
	"start",
	"data",
	"ack",
	"nack",
	"status",
	"error",
	"close",
]);

const defaultAckTimeoutMs = 30_000;
const bridgeCommandSources = new WeakMap<
	WireBridgeBundle<unknown, unknown>,
	AttachedCommandSources<unknown>
>();
const bridgeInboundTargets = new WeakMap<
	WireBridgeBundle<unknown, unknown>,
	Node<WireBridgeEnvelope<unknown> | WireBridgeInvalidIngress>
>();

/** Stable D134 idempotency key helper scoped to one bridge session and sequence. */
export function wireBridgeIdempotencyKey(sessionId: string, seq: number): string {
	return `${sessionId}:${seq}`;
}

/** Create a D134 wire bridge envelope with ordered metadata. */
export function wireBridgeEnvelope<TData = unknown>(input: {
	readonly sessionId: string;
	readonly type: WireBridgeEnvelopeType;
	readonly seq: number;
	readonly cursor?: number;
	readonly payload?: WireBridgePayload<TData>;
	readonly idempotencyKey?: string;
	readonly attempt?: number;
	readonly maxAttempts?: number;
	readonly timestampMs?: number;
	readonly ackForSeq?: number;
	readonly requestId?: string;
}): WireBridgeEnvelope<TData> {
	if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
		throw new RangeError("wireBridgeEnvelope: sessionId must be a non-empty string");
	}
	if (!envelopeTypes.has(input.type)) {
		throw new RangeError("wireBridgeEnvelope: type is not recognized");
	}
	if (!isSafePositiveInteger(input.seq)) {
		throw new RangeError("wireBridgeEnvelope: seq must be a positive integer");
	}
	const cursor = input.cursor ?? 0;
	if (!isSafeNonNegativeInteger(cursor)) {
		throw new RangeError("wireBridgeEnvelope: cursor must be a non-negative integer");
	}
	const attempt = input.attempt ?? 1;
	if (!isSafePositiveInteger(attempt)) {
		throw new RangeError("wireBridgeEnvelope: attempt must be a positive integer");
	}
	const maxAttempts = input.maxAttempts ?? attempt;
	if (!isSafePositiveInteger(maxAttempts) || maxAttempts < attempt) {
		throw new RangeError("wireBridgeEnvelope: maxAttempts must be >= attempt");
	}
	if (input.ackForSeq !== undefined && !isSafePositiveInteger(input.ackForSeq)) {
		throw new RangeError("wireBridgeEnvelope: ackForSeq must be a positive integer");
	}
	if ((input.type === "ack" || input.type === "nack") && input.ackForSeq === undefined) {
		throw new RangeError(`wireBridgeEnvelope: ${input.type} envelope requires ackForSeq`);
	}
	if (input.idempotencyKey !== undefined && input.idempotencyKey.length === 0) {
		throw new RangeError("wireBridgeEnvelope: idempotencyKey must be a non-empty string");
	}
	const payloadError = validatePayloadForType(input.type, input.payload, "wireBridgeEnvelope");
	if (payloadError !== undefined) {
		throw new RangeError(payloadError);
	}
	return {
		sessionId: input.sessionId,
		type: input.type,
		payload: input.payload,
		metadata: {
			seq: input.seq,
			cursor,
			idempotencyKey: input.idempotencyKey ?? wireBridgeIdempotencyKey(input.sessionId, input.seq),
			attempt,
			maxAttempts,
			timestampMs: input.timestampMs,
			ackForSeq: input.ackForSeq,
			requestId: input.requestId,
		},
	};
}

export function wireBridge<TOutbound = unknown, TInbound = unknown>(
	graph: Graph,
	opts: WireBridgeOptions,
): WireBridgeBundle<TOutbound, TInbound> {
	const name = opts.name ?? "wireBridge";
	const policy = opts.retry ?? retryPolicy();
	const command = graph.node<WireBridgeCommand<TOutbound>>([], null, {
		name: `${name}/command`,
		factory: "wireBridgeCommand",
	});
	const inboundCore = graph.node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>(
		[],
		null,
		{
			name: `${name}/inbound`,
			factory: "wireBridgeInbound",
		},
	);
	const inbound = guardedInboundNode(inboundCore, opts.sessionId);
	const events = wireBridgeEventsNode<TOutbound, TInbound>(
		graph,
		command,
		inboundCore,
		name,
		opts,
		policy,
	);
	const outbound = projectOutbound(graph, events, name);
	const acks = projectAcks(graph, events, name);
	const nacks = projectNacks(graph, events, name);
	const status = projectStatus(graph, events, name, opts.sessionId);
	const errors = projectErrors(graph, events, name);
	const cursor = projectCursor(graph, events, name);
	const attempts = projectAttempts(graph, events, name);
	const bundle: WireBridgeBundle<TOutbound, TInbound> = {
		sessionId: opts.sessionId,
		command,
		outbound,
		inbound,
		events,
		acks,
		nacks,
		status,
		errors,
		cursor,
		attempts,
		start: () => command.down([["DATA", { kind: "start" }]]),
		send: (payload, sendOpts) =>
			command.down([
				[
					"DATA",
					{
						kind: "send",
						payload,
						idempotencyKey: sendOpts?.idempotencyKey,
						requestId: sendOpts?.requestId,
					},
				],
			]),
		ack: (ackForSeq, ackOpts) =>
			command.down([
				[
					"DATA",
					{
						kind: "ack",
						ackForSeq,
						idempotencyKey: ackOpts?.idempotencyKey,
						requestId: ackOpts?.requestId,
					},
				],
			]),
		nack: (ackForSeq, error, nackOpts) =>
			command.down([
				[
					"DATA",
					{
						kind: "nack",
						ackForSeq,
						error,
						idempotencyKey: nackOpts?.idempotencyKey,
						requestId: nackOpts?.requestId,
					},
				],
			]),
		close: (reason, closeOpts) =>
			command.down([
				["DATA", { kind: "close", reason, idempotencyKey: closeOpts?.idempotencyKey }],
			]),
	};
	bridgeCommandSources.set(bundle as WireBridgeBundle<unknown, unknown>, { sources: [] });
	bridgeInboundTargets.set(bundle as WireBridgeBundle<unknown, unknown>, inboundCore);
	return bundle;
}

/** D147 remote dispatcher call helper over explicit wireBridge request/response facts. */
export function remoteCall<TRequest = unknown, TResponse = unknown>(
	graph: Graph,
	bridge: WireBridgeBundle<RemoteCallRequest<TRequest>, RemoteCallResponse<TResponse>>,
	opts: RemoteCallOptions = {},
): RemoteCallBundle<TRequest, TResponse> {
	const name = opts.name ?? "remoteCall";
	const timeouts = graph.node<RemoteCallTimeout>([], null, {
		name: `${name}/timeouts`,
		factory: "remoteCallTimeouts",
		completeWhenDepsComplete: false,
		errorWhenDepsError: false,
	});
	const responses = remoteCallResponsesNode(graph, bridge.events, timeouts, name);
	const results = remoteCallResultsNode(graph, responses, name);
	const status = remoteCallStatusNode(graph, bridge.events, responses, timeouts, name);
	const errors = remoteCallErrorsNode(graph, responses, timeouts, bridge.events, name);
	return {
		responses,
		results,
		status,
		errors,
		timeouts,
		call(operation, requestId, payload, callOpts) {
			const request = remoteCallRequest(operation, requestId, payload);
			bridge.command.down([
				[
					"DATA",
					{
						kind: "send",
						payload: request,
						idempotencyKey: callOpts?.idempotencyKey,
						requestId,
					},
				],
			]);
			return request;
		},
		timeout(requestId, operation, error) {
			const timeout = remoteCallTimeout(requestId, operation, error);
			timeouts.down([["DATA", timeout]]);
			return timeout;
		},
	};
}

export function remoteResponderHandler<TRequest = unknown, TResponse = unknown>(
	operation: string,
	handle: RemoteResponderHandler<TRequest, TResponse>,
): RemoteResponderHandlerDefinition<TRequest, TResponse> {
	if (operation.length === 0) {
		throw new RangeError("remoteResponderHandler: operation must be non-empty");
	}
	if (typeof handle !== "function") {
		throw new TypeError("remoteResponderHandler: handle must be a function");
	}
	return { operation, handle };
}

/** D147 remote responder over inbound wireBridge request facts and outbound command facts. */
export function remoteResponder<TRequest = unknown, TResponse = unknown>(
	graph: Graph,
	bridge: WireBridgeBundle<RemoteCallResponse<TResponse>, RemoteCallRequest<TRequest>>,
	opts: RemoteResponderOptions<TRequest, TResponse> = {},
): RemoteResponderBundle<TRequest, TResponse> {
	const name = opts.name ?? "remoteResponder";
	const handlers = normalizeRemoteHandlers(opts.handlers ?? []);
	const topology = graph.topologyGroup({ name: `${name}.remoteResponder` });
	const events = topology.add(
		remoteResponderEventsNode(
			graph,
			wireBridgeInboundTarget(bridge),
			name,
			bridge.sessionId,
			handlers,
			opts.rejectUnknown === true,
		),
	);
	const responseCommands = topology.add(remoteResponderResponseCommandsNode(graph, events, name));
	const requests = topology.add(remoteResponderRequestsNode(graph, events, name));
	const status = topology.add(remoteResponderStatusNode(graph, events, name));
	const errors = topology.add(remoteResponderErrorsNode(graph, events, name));
	try {
		attachWireBridgeCommandSource(bridge, responseCommands);
	} catch (error) {
		topology.release({ reason: `${name}.remoteResponder.failedAttach` });
		throw error;
	}
	let released = false;
	return {
		events,
		responseCommands,
		requests,
		status,
		errors,
		release() {
			if (released) return;
			detachWireBridgeCommandSource(bridge, responseCommands);
			try {
				topology.release({ reason: `${name}.remoteResponder.release` });
				released = true;
			} catch (error) {
				attachWireBridgeCommandSource(bridge, responseCommands);
				throw error;
			}
		},
	};
}

function wireBridgeEventsNode<TOutbound, TInbound>(
	graph: Graph,
	command: Node<WireBridgeCommand<TOutbound>>,
	inbound: Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>,
	name: string,
	opts: WireBridgeOptions,
	policy: RetryPolicy,
): Node<WireBridgeEvent<TOutbound, TInbound>> {
	const now = opts.now ?? Date.now;
	return graph.node<WireBridgeEvent<TOutbound, TInbound>>(
		[command, inbound],
		(ctx) => {
			const state = initBridgeState<TOutbound>(ctx);

			const emitOutbound = (
				type: WireBridgeEnvelopeType,
				payload: WireBridgePayload<TOutbound> | undefined,
				commandOpts: { idempotencyKey?: string; requestId?: string; ackForSeq?: number } = {},
				beforeEmit?: () => void,
			) => {
				if (!isSafePositiveInteger(state.nextSeq)) {
					ctx.down([
						[
							"DATA",
							{
								kind: "invalid",
								error: `${opts.sessionId}: next outbound seq exceeded Number.MAX_SAFE_INTEGER`,
							},
						],
					]);
					return;
				}
				const seq = state.nextSeq;
				let envelope: WireBridgeEnvelope<TOutbound>;
				try {
					envelope = wireBridgeEnvelope<TOutbound>({
						sessionId: opts.sessionId,
						type,
						seq,
						cursor: state.cursor,
						payload,
						idempotencyKey: commandOpts.idempotencyKey,
						attempt: 1,
						maxAttempts: policy.maxAttempts,
						timestampMs: now(),
						ackForSeq: commandOpts.ackForSeq,
						requestId: commandOpts.requestId,
					});
				} catch (error) {
					ctx.down([
						[
							"DATA",
							{
								kind: "invalid",
								error: error instanceof Error ? error.message : String(error),
							},
						],
					]);
					return;
				}
				state.nextSeq++;
				beforeEmit?.();
				ctx.down([["DATA", { kind: "outbound", envelope }]]);
				if (shouldTrackAck(type)) armAckTimeout(ctx, state, envelope, opts, policy, now);
			};

			for (const raw of depBatch(ctx, 1) ?? []) {
				processInbound(ctx, state, raw, opts.sessionId);
			}
			const inboundTerminal = ctx.terminal[1];
			if (inboundTerminal !== false && inboundTerminal !== undefined && !state.terminalReported) {
				state.terminalReported = true;
				const error =
					inboundTerminal === true
						? `${opts.sessionId}: inbound protocol COMPLETE is local misuse; remote completion must arrive as a DATA envelope fact`
						: `${opts.sessionId}: inbound protocol ERROR ${String(
								errorPayload(inboundTerminal),
							)} is local misuse; remote errors must arrive as DATA envelope facts`;
				ctx.down([["DATA", { kind: "invalid", error }]]);
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const invalid = validateCommand(raw);
				if (invalid !== undefined) {
					ctx.down([["DATA", { kind: "invalid", error: invalid }]]);
					continue;
				}
				const commandValue = raw as WireBridgeCommand<TOutbound>;
				switch (commandValue.kind) {
					case "start":
						emitOutbound("start", undefined, commandValue);
						break;
					case "send":
						emitOutbound("data", { kind: "data", value: commandValue.payload }, commandValue);
						break;
					case "ack":
						emitOutbound("ack", undefined, {
							idempotencyKey: commandValue.idempotencyKey,
							requestId: commandValue.requestId,
							ackForSeq: commandValue.ackForSeq,
						});
						break;
					case "nack":
						emitOutbound(
							"nack",
							{ kind: "error", error: errorPayload(commandValue.error) },
							{
								idempotencyKey: commandValue.idempotencyKey,
								requestId: commandValue.requestId,
								ackForSeq: commandValue.ackForSeq,
							},
						);
						break;
					case "close":
						emitOutbound(
							"close",
							{ kind: "close", reason: commandValue.reason },
							commandValue,
							() => {
								for (const pending of state.pending.values()) {
									if (pending.timer !== undefined) clearTimeout(pending.timer);
								}
								state.pending.clear();
							},
						);
						break;
				}
			}
		},
		{
			name: `${name}/events`,
			factory: "wireBridgeEvents",
			partial: true,
			errorWhenDepsError: false,
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		},
	);
}

function initBridgeState<TPayload>(ctx: Ctx): BridgeState<TPayload> {
	let state = ctx.state.get<BridgeState<TPayload>>();
	if (state === undefined) {
		state = {
			active: true,
			cleanupInstalled: false,
			nextSeq: 1,
			cursor: 0,
			remoteCursor: 0,
			terminalReported: false,
			pending: new Map(),
		};
		ctx.state.set(state);
	}
	state.active = true;
	if (!state.cleanupInstalled) {
		state.cleanupInstalled = true;
		ctx.onDeactivation(() => {
			state.active = false;
			state.cleanupInstalled = false;
			for (const pending of state.pending.values()) {
				if (pending.timer !== undefined) clearTimeout(pending.timer);
			}
			state.pending.clear();
		});
	}
	return state;
}

function attachWireBridgeCommandSource<TOutbound, TInbound>(
	bridge: WireBridgeBundle<TOutbound, TInbound>,
	source: Node<WireBridgeCommand<TOutbound>>,
): void {
	const attached = bridgeCommandSources.get(bridge as WireBridgeBundle<unknown, unknown>);
	if (attached === undefined) {
		throw new Error("remoteResponder: bridge command source registry missing");
	}
	const sources = attached.sources as Node<WireBridgeCommand<TOutbound>>[];
	const previousSources = [...sources];
	if (!sources.includes(source)) sources.push(source);
	try {
		bridge.command.replaceDeps([...sources], wireBridgeCommandSourceFn(sources.length));
	} catch (error) {
		sources.splice(0, sources.length, ...previousSources);
		bridge.command.replaceDeps(
			[...previousSources],
			wireBridgeCommandSourceFn(previousSources.length),
		);
		throw error;
	}
}

function detachWireBridgeCommandSource<TOutbound, TInbound>(
	bridge: WireBridgeBundle<TOutbound, TInbound>,
	source: Node<WireBridgeCommand<TOutbound>>,
): void {
	const attached = bridgeCommandSources.get(bridge as WireBridgeBundle<unknown, unknown>);
	if (attached === undefined) {
		throw new Error("remoteResponder: bridge command source registry missing");
	}
	const sources = attached.sources as Node<WireBridgeCommand<TOutbound>>[];
	if (!sources.includes(source)) return;
	const previousSources = [...sources];
	const nextSources = sources.filter((candidate) => candidate !== source);
	sources.splice(0, sources.length, ...nextSources);
	try {
		bridge.command.replaceDeps([...nextSources], wireBridgeCommandSourceFn(nextSources.length));
	} catch (error) {
		sources.splice(0, sources.length, ...previousSources);
		bridge.command.replaceDeps(
			[...previousSources],
			wireBridgeCommandSourceFn(previousSources.length),
		);
		throw error;
	}
}

function wireBridgeInboundTarget<TInbound>(
	bridge: WireBridgeBundle<unknown, TInbound>,
): Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress> {
	const target = bridgeInboundTargets.get(bridge as WireBridgeBundle<unknown, unknown>);
	if (target === undefined) {
		throw new Error("remoteResponder: bridge inbound target registry missing");
	}
	return target as Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>;
}

function wireBridgeCommandSourceFn<TOutbound>(sourceCount: number): (ctx: Ctx) => void {
	return (ctx) => {
		for (let i = 0; i < sourceCount; i += 1) {
			for (const command of depBatch(ctx, i) ?? []) {
				ctx.down([["DATA", command as WireBridgeCommand<TOutbound>]]);
			}
		}
	};
}

function remoteCallRequest<TRequest>(
	operation: string,
	requestId: string,
	payload: TRequest,
): RemoteCallRequest<TRequest> {
	if (operation.length === 0) throw new RangeError("remoteCall: operation must be non-empty");
	if (requestId.length === 0) throw new RangeError("remoteCall: requestId must be non-empty");
	return { operation, requestId, payload };
}

function remoteCallTimeout(
	requestId: string,
	operation: string | undefined,
	error: string,
): RemoteCallTimeout {
	if (requestId.length === 0)
		throw new RangeError("remoteCall: timeout requestId must be non-empty");
	if (error.length === 0) throw new RangeError("remoteCall: timeout error must be non-empty");
	return { ...(operation === undefined ? {} : { operation }), requestId, error };
}

interface RemotePendingRequest {
	operation: string;
	requestId: string;
	seq: number;
}

interface RemotePendingState {
	requestIds: Set<string>;
	bySeq: Map<number, RemotePendingRequest>;
}

function remotePendingState(): RemotePendingState {
	return { requestIds: new Set(), bySeq: new Map() };
}

function remotePendingContains(state: RemotePendingState, requestId: string): boolean {
	return state.requestIds.has(requestId);
}

function remotePendingDuplicate(state: RemotePendingState, request: RemotePendingRequest): boolean {
	const current = remotePendingTakeBySeqPreview(state, request.seq);
	return current?.requestId !== request.requestId && state.requestIds.has(request.requestId);
}

function remotePendingTakeBySeqPreview(
	state: RemotePendingState,
	seq: number,
): RemotePendingRequest | undefined {
	return state.bySeq.get(seq);
}

function remotePendingInsert(state: RemotePendingState, request: RemotePendingRequest): void {
	const existingBySeq = state.bySeq.get(request.seq);
	if (existingBySeq !== undefined) {
		state.requestIds.delete(existingBySeq.requestId);
	}
	for (const [seq, pending] of state.bySeq) {
		if (pending.requestId === request.requestId && seq !== request.seq) {
			state.bySeq.delete(seq);
			break;
		}
	}
	state.requestIds.add(request.requestId);
	state.bySeq.set(request.seq, request);
}

function remotePendingTakeByRequestId(
	state: RemotePendingState,
	requestId: string,
): RemotePendingRequest | undefined {
	if (!state.requestIds.delete(requestId)) return undefined;
	let seq: number | undefined;
	let found: RemotePendingRequest | undefined;
	for (const [candidateSeq, request] of state.bySeq) {
		if (request.requestId === requestId) {
			seq = candidateSeq;
			found = request;
			break;
		}
	}
	if (seq !== undefined) state.bySeq.delete(seq);
	return found;
}

function remotePendingTakeBySeq(
	state: RemotePendingState,
	seq: number,
): RemotePendingRequest | undefined {
	const request = state.bySeq.get(seq);
	if (request === undefined) return undefined;
	state.bySeq.delete(seq);
	state.requestIds.delete(request.requestId);
	return request;
}

function remotePendingFromReceipt<T>(
	state: RemotePendingState,
	envelope: WireBridgeEnvelope<RemoteCallRequest<T>>,
): RemotePendingRequest | undefined {
	const bySeq = remotePendingTakeBySeq(state, envelope.metadata.seq);
	if (bySeq !== undefined) return bySeq;
	const fallback = pendingRequestFromEnvelope(envelope);
	if (fallback === undefined || remotePendingContains(state, fallback.requestId)) {
		return undefined;
	}
	return fallback;
}

function pendingRequestFromEnvelope<T>(
	envelope: WireBridgeEnvelope<RemoteCallRequest<T>>,
): RemotePendingRequest | undefined {
	if (envelope.payload?.kind !== "data") return undefined;
	const request = validateRemoteCallRequest(envelope.payload.value);
	if (request === undefined) return undefined;
	return {
		operation: request.operation,
		requestId: request.requestId,
		seq: envelope.metadata.seq,
	};
}

function validateRemoteCallRequest<T>(value: unknown): RemoteCallRequest<T> | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.operation !== "string" || value.operation.length === 0) return undefined;
	if (typeof value.requestId !== "string" || value.requestId.length === 0) return undefined;
	if (!("payload" in value)) return undefined;
	return {
		operation: value.operation,
		requestId: value.requestId,
		payload: value.payload as T,
	};
}

function validateRemoteCallResponse<T>(value: unknown): RemoteCallResponse<T> | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.operation !== "string" || value.operation.length === 0) return undefined;
	if (typeof value.requestId !== "string" || value.requestId.length === 0) return undefined;
	if (value.kind === "result" && "payload" in value) {
		return {
			kind: "result",
			operation: value.operation,
			requestId: value.requestId,
			payload: value.payload as T,
		};
	}
	if (value.kind === "error" && typeof value.error === "string" && value.error.length > 0) {
		return {
			kind: "error",
			operation: value.operation,
			requestId: value.requestId,
			error: value.error,
		};
	}
	if (value.kind === "status" && typeof value.status === "string" && value.status.length > 0) {
		return {
			kind: "status",
			operation: value.operation,
			requestId: value.requestId,
			status: value.status,
		};
	}
	return undefined;
}

function remoteMalformedResponseRequestId(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.requestId === "string" && value.requestId.length > 0
		? value.requestId
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isThenable(value: unknown): boolean {
	return isRecord(value) && typeof value.then === "function";
}

function remoteCallResponseRequestId<T>(response: RemoteCallResponse<T>): string {
	return response.requestId;
}

function remoteCallResponseIsTerminal<T>(response: RemoteCallResponse<T>): boolean {
	return response.kind === "result" || response.kind === "error";
}

function remoteCallResponsesNode<TRequest, TResponse>(
	graph: Graph,
	events: Node<WireBridgeEvent<RemoteCallRequest<TRequest>, RemoteCallResponse<TResponse>>>,
	timeouts: Node<RemoteCallTimeout>,
	name: string,
): Node<RemoteCallResponse<TResponse>> {
	return graph.node<RemoteCallResponse<TResponse>>(
		[events, timeouts],
		(ctx) => {
			type State = {
				pending: RemotePendingState;
			};
			const state = ctx.state.get<State>() ?? {
				pending: remotePendingState(),
			};
			const ready: RemoteCallResponse<TResponse>[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<
					RemoteCallRequest<TRequest>,
					RemoteCallResponse<TResponse>
				>;
				if (event.kind === "outbound") {
					const request = pendingRequestFromEnvelope(event.envelope);
					if (request === undefined) continue;
					if (remotePendingDuplicate(state.pending, request)) continue;
					remotePendingInsert(state.pending, request);
				} else if (event.kind === "inbound" && event.envelope.payload?.kind === "data") {
					const response = validateRemoteCallResponse<TResponse>(event.envelope.payload.value);
					if (response === undefined) {
						const requestId = remoteMalformedResponseRequestId(event.envelope.payload.value);
						if (requestId !== undefined && remotePendingContains(state.pending, requestId)) {
							remotePendingTakeByRequestId(state.pending, requestId);
						}
						continue;
					}
					const requestId = remoteCallResponseRequestId(response);
					if (remotePendingContains(state.pending, requestId)) {
						if (remoteCallResponseIsTerminal(response)) {
							remotePendingTakeByRequestId(state.pending, requestId);
						}
						ready.push(response);
					}
				} else if (event.kind === "nack") {
					remotePendingFromReceipt(state.pending, event.outbound);
				} else if (event.kind === "exhausted") {
					remotePendingTakeBySeq(state.pending, event.seq);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const timeout = raw as RemoteCallTimeout;
				remotePendingTakeByRequestId(state.pending, timeout.requestId);
			}
			ctx.state.set(state);
			for (const response of ready) ctx.down([["DATA", response]]);
		},
		{
			name: `${name}/responses`,
			factory: "remoteCallResponses",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function remoteCallResultsNode<TResponse>(
	graph: Graph,
	responses: Node<RemoteCallResponse<TResponse>>,
	name: string,
): Node<RemoteCallResult<TResponse>> {
	return graph.node<RemoteCallResult<TResponse>>(
		[responses],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const response = raw as RemoteCallResponse<TResponse>;
				if (response.kind === "result") {
					ctx.down([
						[
							"DATA",
							{
								operation: response.operation,
								requestId: response.requestId,
								payload: response.payload,
							},
						],
					]);
				}
			}
		},
		{ name: `${name}/results`, factory: "remoteCallResults", completeWhenDepsComplete: false },
	);
}

function remoteCallStatusNode<TRequest, TResponse>(
	graph: Graph,
	events: Node<WireBridgeEvent<RemoteCallRequest<TRequest>, RemoteCallResponse<TResponse>>>,
	responses: Node<RemoteCallResponse<TResponse>>,
	timeouts: Node<RemoteCallTimeout>,
	name: string,
): Node<RemoteCallStatus> {
	return graph.node<RemoteCallStatus>(
		[events, responses, timeouts],
		(ctx) => {
			type State = { status: RemoteCallStatus; pending: RemotePendingState };
			const state =
				ctx.state.get<State>() ??
				({
					status: { state: "idle", pending: 0, completed: 0, errors: 0, timeouts: 0 },
					pending: remotePendingState(),
				} satisfies State);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<
					RemoteCallRequest<TRequest>,
					RemoteCallResponse<TResponse>
				>;
				if (event.kind === "outbound") {
					const request = pendingRequestFromEnvelope(event.envelope);
					if (request !== undefined) {
						if (remotePendingDuplicate(state.pending, request)) {
							state.status = {
								...state.status,
								state: "errored",
								operation: request.operation,
								requestId: request.requestId,
								errors: state.status.errors + 1,
							};
							continue;
						}
						remotePendingInsert(state.pending, request);
						state.status = {
							...state.status,
							state: "requested",
							operation: request.operation,
							requestId: request.requestId,
						};
					}
				} else if (
					event.kind === "invalid" ||
					event.kind === "session-mismatch" ||
					event.kind === "out-of-order" ||
					event.kind === "late-receipt"
				) {
					state.status = {
						...state.status,
						state: "bridge-errored",
						errors: state.status.errors + 1,
					};
				} else if (event.kind === "nack") {
					const request = remotePendingFromReceipt(state.pending, event.outbound);
					state.status = {
						...state.status,
						state: "bridge-errored",
						...(request === undefined
							? {}
							: { operation: request.operation, requestId: request.requestId }),
						errors: state.status.errors + 1,
					};
				} else if (event.kind === "exhausted") {
					const request = remotePendingTakeBySeq(state.pending, event.seq);
					state.status = {
						...state.status,
						state: "bridge-errored",
						...(request === undefined
							? {}
							: { operation: request.operation, requestId: request.requestId }),
						errors: state.status.errors + 1,
					};
				} else if (event.kind === "inbound" && event.envelope.payload?.kind === "data") {
					const response = validateRemoteCallResponse<TResponse>(event.envelope.payload.value);
					if (response === undefined) {
						const requestId = remoteMalformedResponseRequestId(event.envelope.payload.value);
						if (requestId !== undefined) {
							const request = remotePendingTakeByRequestId(state.pending, requestId);
							if (request !== undefined) {
								state.status = {
									...state.status,
									state: "errored",
									operation: request.operation,
									requestId,
									errors: state.status.errors + 1,
								};
							}
						}
					}
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const response = raw as RemoteCallResponse<TResponse>;
				if (response.kind === "result") {
					remotePendingTakeByRequestId(state.pending, response.requestId);
					state.status = {
						...state.status,
						state: "responded",
						operation: response.operation,
						requestId: response.requestId,
						completed: state.status.completed + 1,
					};
				} else if (response.kind === "error") {
					remotePendingTakeByRequestId(state.pending, response.requestId);
					state.status = {
						...state.status,
						state: "errored",
						operation: response.operation,
						requestId: response.requestId,
						errors: state.status.errors + 1,
					};
				} else {
					state.status = {
						...state.status,
						operation: response.operation,
						requestId: response.requestId,
					};
				}
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const timeout = raw as RemoteCallTimeout;
				remotePendingTakeByRequestId(state.pending, timeout.requestId);
				state.status = {
					...state.status,
					state: "timed-out",
					operation: timeout.operation,
					requestId: timeout.requestId,
					errors: state.status.errors + 1,
					timeouts: state.status.timeouts + 1,
				};
			}
			state.status = { ...state.status, pending: state.pending.requestIds.size };
			ctx.state.set(state);
			ctx.down([["DATA", state.status]]);
		},
		{
			name: `${name}/status`,
			factory: "remoteCallStatus",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function remoteCallErrorsNode<TRequest, TResponse>(
	graph: Graph,
	responses: Node<RemoteCallResponse<TResponse>>,
	timeouts: Node<RemoteCallTimeout>,
	events: Node<WireBridgeEvent<RemoteCallRequest<TRequest>, RemoteCallResponse<TResponse>>>,
	name: string,
): Node<RemoteCallError> {
	return graph.node<RemoteCallError>(
		[responses, timeouts, events],
		(ctx) => {
			const pending = ctx.state.get<RemotePendingState>() ?? remotePendingState();
			for (const raw of depBatch(ctx, 2) ?? []) {
				const event = raw as WireBridgeEvent<
					RemoteCallRequest<TRequest>,
					RemoteCallResponse<TResponse>
				>;
				if (event.kind === "outbound") {
					const request = pendingRequestFromEnvelope(event.envelope);
					if (request !== undefined) {
						if (remotePendingDuplicate(pending, request)) {
							ctx.down([
								[
									"DATA",
									{
										operation: request.operation,
										requestId: request.requestId,
										error: `remoteCall: duplicate in-flight requestId '${request.requestId}'`,
									},
								],
							]);
							continue;
						}
						remotePendingInsert(pending, request);
					}
				}
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const response = raw as RemoteCallResponse<TResponse>;
				if (response.kind === "error") {
					remotePendingTakeByRequestId(pending, response.requestId);
					ctx.down([
						[
							"DATA",
							{
								operation: response.operation,
								requestId: response.requestId,
								error: response.error,
							},
						],
					]);
				} else if (response.kind === "result") {
					remotePendingTakeByRequestId(pending, response.requestId);
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const timeout = raw as RemoteCallTimeout;
				remotePendingTakeByRequestId(pending, timeout.requestId);
				ctx.down([
					[
						"DATA",
						{ operation: timeout.operation, requestId: timeout.requestId, error: timeout.error },
					],
				]);
			}
			for (const raw of depBatch(ctx, 2) ?? []) {
				const event = raw as WireBridgeEvent<
					RemoteCallRequest<TRequest>,
					RemoteCallResponse<TResponse>
				>;
				if (event.kind === "inbound" && event.envelope.payload?.kind === "data") {
					const response = validateRemoteCallResponse<TResponse>(event.envelope.payload.value);
					if (response === undefined) {
						const requestId = remoteMalformedResponseRequestId(event.envelope.payload.value);
						const request =
							requestId === undefined
								? undefined
								: remotePendingTakeByRequestId(pending, requestId);
						if (request === undefined) continue;
						ctx.down([
							[
								"DATA",
								{
									operation: request.operation,
									requestId: request.requestId,
									error: "remoteCall: response payload is malformed",
								},
							],
						]);
					}
					continue;
				}
				if (event.kind === "nack") {
					const request = remotePendingFromReceipt(pending, event.outbound);
					ctx.down([
						[
							"DATA",
							{
								operation: request?.operation,
								requestId: request?.requestId,
								error: String(event.error),
							},
						],
					]);
				} else if (event.kind === "exhausted") {
					const request = remotePendingTakeBySeq(pending, event.seq);
					ctx.down([
						[
							"DATA",
							{
								operation: request?.operation,
								requestId: request?.requestId,
								error: String(event.error),
							},
						],
					]);
				} else if (event.kind === "invalid") {
					ctx.down([["DATA", { error: event.error }]]);
				} else if (
					event.kind === "session-mismatch" ||
					event.kind === "out-of-order" ||
					event.kind === "late-receipt"
				) {
					ctx.down([["DATA", { error: remoteCallBridgeErrorMessage(event) }]]);
				}
			}
			ctx.state.set(pending);
		},
		{
			name: `${name}/errors`,
			factory: "remoteCallErrors",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function remoteCallBridgeErrorMessage<TRequest, TResponse>(
	event: WireBridgeEvent<RemoteCallRequest<TRequest>, RemoteCallResponse<TResponse>>,
): string {
	if (event.kind === "session-mismatch") {
		return `remoteCall: inbound session ${event.actual} did not match expected ${event.expected}`;
	}
	if (event.kind === "out-of-order") {
		return `remoteCall: inbound seq ${event.seq} arrived before expected seq ${event.expected}`;
	}
	if (event.kind === "late-receipt") {
		return `remoteCall: late ${event.receipt} for unknown or completed ackForSeq ${event.ackForSeq}`;
	}
	return "remoteCall: bridge error";
}

function normalizeRemoteHandlers<TRequest, TResponse>(
	handlers: readonly RemoteResponderHandlerDefinition<TRequest, TResponse>[],
): Map<string, RemoteResponderHandler<TRequest, TResponse>> {
	const out = new Map<string, RemoteResponderHandler<TRequest, TResponse>>();
	for (const handler of handlers) {
		if (handler.operation.length === 0) {
			throw new RangeError("remoteResponder: operation must be non-empty");
		}
		if (out.has(handler.operation)) {
			throw new RangeError(`remoteResponder: duplicate operation '${handler.operation}'`);
		}
		out.set(handler.operation, handler.handle);
	}
	return out;
}

interface RemoteResponderCursor {
	cursor: number;
	remoteCursor: number;
}

type RemoteResponderInbound<T> =
	| { readonly kind: "request"; readonly request: RemoteCallRequest<T>; readonly seq: number }
	| { readonly kind: "consumed" }
	| { readonly kind: "invalid"; readonly error: string };

function reduceRemoteResponderInbound<T>(
	cursor: RemoteResponderCursor,
	envelope: WireBridgeEnvelope<RemoteCallRequest<T>>,
	expectedSessionId: string,
): RemoteResponderInbound<T> {
	const envelopeError = validateInboundEnvelope(envelope);
	if (envelopeError !== undefined) {
		return { kind: "invalid", error: envelopeError };
	}
	if (envelope.sessionId !== expectedSessionId) {
		return {
			kind: "invalid",
			error: `remoteResponder: inbound session ${envelope.sessionId} did not match expected ${expectedSessionId}`,
		};
	}
	const seq = envelope.metadata.seq;
	const expected = cursor.cursor + 1;
	if (seq <= cursor.cursor) {
		return {
			kind: "invalid",
			error: `remoteResponder: duplicate request seq ${seq} at cursor ${cursor.cursor}`,
		};
	}
	if (seq > expected) {
		return {
			kind: "invalid",
			error: `remoteResponder: out-of-order request seq ${seq}, expected ${expected}`,
		};
	}
	if (envelope.metadata.cursor < cursor.remoteCursor) {
		return {
			kind: "invalid",
			error: `${envelope.sessionId}: remoteResponder inbound cursor ${envelope.metadata.cursor} regressed below ${cursor.remoteCursor}`,
		};
	}
	cursor.cursor = seq;
	cursor.remoteCursor = envelope.metadata.cursor;
	if (envelope.type !== "data") return { kind: "consumed" };
	if (envelope.payload?.kind !== "data") {
		return { kind: "invalid", error: "remoteResponder: request envelope must carry request DATA" };
	}
	const request = validateRemoteCallRequest<T>(envelope.payload.value);
	if (request === undefined) {
		return { kind: "invalid", error: "remoteResponder: request payload is malformed" };
	}
	return { kind: "request", request, seq };
}

function remoteResponderEventsNode<TRequest, TResponse>(
	graph: Graph,
	inbound: Node<WireBridgeEnvelope<RemoteCallRequest<TRequest>> | WireBridgeInvalidIngress>,
	name: string,
	expectedSessionId: string,
	handlers: Map<string, RemoteResponderHandler<TRequest, TResponse>>,
	rejectUnknown: boolean,
): Node<RemoteResponderEvent<TRequest, TResponse>> {
	return graph.node<RemoteResponderEvent<TRequest, TResponse>>(
		[inbound],
		(ctx) => {
			const cursor = ctx.state.get<RemoteResponderCursor>() ?? { cursor: 0, remoteCursor: 0 };
			for (const raw of depBatch(ctx, 0) ?? []) {
				const envelope = raw as WireBridgeEnvelope<RemoteCallRequest<TRequest>>;
				const received = reduceRemoteResponderInbound(cursor, envelope, expectedSessionId);
				if (received.kind === "consumed") continue;
				if (received.kind === "invalid") {
					ctx.down([["DATA", { kind: "invalid", error: received.error }]]);
					continue;
				}
				const { request, seq } = received;
				ctx.down([["DATA", { kind: "request", request, seq }]]);
				const handler = handlers.get(request.operation);
				if (handler === undefined) {
					if (!rejectUnknown) continue;
					const error = `remoteResponder: unknown operation '${request.operation}'`;
					const response = remoteCallErrorResponse(request, error);
					ctx.down([
						[
							"DATA",
							{
								kind: "rejected",
								requestId: request.requestId,
								operation: request.operation,
								error,
								command: { kind: "send", payload: response, requestId: request.requestId },
							},
						],
					]);
					continue;
				}
				try {
					const payload = handler(request);
					if (isThenable(payload)) {
						throw new Error("remoteResponder: async handler results require a later adapter shape");
					}
					const response = {
						kind: "result",
						operation: request.operation,
						requestId: request.requestId,
						payload,
					} satisfies RemoteCallResponse<TResponse>;
					ctx.down([
						[
							"DATA",
							{
								kind: "response",
								requestId: request.requestId,
								operation: request.operation,
								command: { kind: "send", payload: response, requestId: request.requestId },
							},
						],
					]);
				} catch (error) {
					rethrowGraphRuntimeInvariant(error);
					const message = errorMessage(error);
					const response = remoteCallErrorResponse(request, message);
					ctx.down([
						[
							"DATA",
							{
								kind: "rejected",
								requestId: request.requestId,
								operation: request.operation,
								error: message,
								command: { kind: "send", payload: response, requestId: request.requestId },
							},
						],
					]);
				}
			}
			ctx.state.set(cursor);
		},
		{
			name: `${name}/events`,
			factory: "remoteResponderEvents",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function remoteCallErrorResponse<TRequest, TResponse>(
	request: RemoteCallRequest<TRequest>,
	error: string,
): RemoteCallResponse<TResponse> {
	return {
		kind: "error",
		operation: request.operation,
		requestId: request.requestId,
		error,
	};
}

function remoteResponderResponseCommandsNode<TRequest, TResponse>(
	graph: Graph,
	events: Node<RemoteResponderEvent<TRequest, TResponse>>,
	name: string,
): Node<WireBridgeCommand<RemoteCallResponse<TResponse>>> {
	return graph.node<WireBridgeCommand<RemoteCallResponse<TResponse>>>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as RemoteResponderEvent<TRequest, TResponse>;
				if (
					(event.kind === "response" || event.kind === "rejected") &&
					event.command !== undefined
				) {
					ctx.down([["DATA", event.command]]);
				}
			}
		},
		{
			name: `${name}/responseCommands`,
			factory: "remoteResponderResponseCommands",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function remoteResponderRequestsNode<TRequest, TResponse>(
	graph: Graph,
	events: Node<RemoteResponderEvent<TRequest, TResponse>>,
	name: string,
): Node<RemoteCallRequest<TRequest>> {
	return graph.node<RemoteCallRequest<TRequest>>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as RemoteResponderEvent<TRequest, TResponse>;
				if (event.kind === "request") ctx.down([["DATA", event.request]]);
			}
		},
		{
			name: `${name}/requests`,
			factory: "remoteResponderRequests",
			completeWhenDepsComplete: false,
		},
	);
}

function remoteResponderStatusNode<TRequest, TResponse>(
	graph: Graph,
	events: Node<RemoteResponderEvent<TRequest, TResponse>>,
	name: string,
): Node<RemoteResponderStatus> {
	return graph.node<RemoteResponderStatus>(
		[events],
		(ctx) => {
			let status =
				ctx.state.get<RemoteResponderStatus>() ??
				({ state: "idle", handled: 0, rejected: 0, errors: 0 } satisfies RemoteResponderStatus);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as RemoteResponderEvent<TRequest, TResponse>;
				if (event.kind === "response") {
					status = {
						...status,
						state: "responded",
						operation: event.operation,
						requestId: event.requestId,
						handled: status.handled + 1,
					};
				} else if (event.kind === "rejected") {
					status = {
						...status,
						state: "rejected",
						operation: event.operation,
						requestId: event.requestId,
						rejected: status.rejected + 1,
						errors: status.errors + 1,
					};
				} else if (event.kind === "invalid") {
					status = { ...status, state: "errored", errors: status.errors + 1 };
				}
			}
			ctx.state.set(status);
			ctx.down([["DATA", status]]);
		},
		{
			name: `${name}/status`,
			factory: "remoteResponderStatus",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function remoteResponderErrorsNode<TRequest, TResponse>(
	graph: Graph,
	events: Node<RemoteResponderEvent<TRequest, TResponse>>,
	name: string,
): Node<RemoteCallError> {
	return graph.node<RemoteCallError>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as RemoteResponderEvent<TRequest, TResponse>;
				if (event.kind === "rejected") {
					ctx.down([
						[
							"DATA",
							{ operation: event.operation, requestId: event.requestId, error: event.error },
						],
					]);
				} else if (event.kind === "invalid") {
					ctx.down([["DATA", { error: event.error }]]);
				}
			}
		},
		{ name: `${name}/errors`, factory: "remoteResponderErrors", completeWhenDepsComplete: false },
	);
}

function armAckTimeout<TPayload>(
	ctx: Ctx,
	state: BridgeState<TPayload>,
	envelope: WireBridgeEnvelope<TPayload>,
	opts: WireBridgeOptions,
	policy: RetryPolicy,
	now: () => number,
): void {
	const timeoutMs = opts.ackTimeoutMs ?? defaultAckTimeoutMs;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new RangeError("wireBridge: ackTimeoutMs must be a non-negative finite number");
	}
	const pending: PendingEnvelope<TPayload> = { envelope };
	const schedule = (current: WireBridgeEnvelope<TPayload>) => {
		pending.timer = setTimeout(() => {
			pending.timer = undefined;
			if (!state.active || !state.pending.has(current.metadata.seq)) return;
			ctx.down([
				[
					"DATA",
					{
						kind: "timeout",
						seq: current.metadata.seq,
						attempt: current.metadata.attempt,
					} satisfies WireBridgeEvent<TPayload, unknown>,
				],
			]);
			if (!shouldRetry(policy, current.metadata.attempt)) {
				const error = `${opts.sessionId}: ack timeout for seq ${current.metadata.seq}`;
				state.pending.delete(current.metadata.seq);
				ctx.down([
					[
						"DATA",
						{
							kind: "exhausted",
							seq: current.metadata.seq,
							attempt: current.metadata.attempt,
							error,
						} satisfies WireBridgeEvent<TPayload, unknown>,
					],
				]);
				return;
			}
			const attempt = current.metadata.attempt + 1;
			const delayMs = nextRetryDelayMs(policy, attempt) ?? 0;
			ctx.down([
				[
					"DATA",
					{
						kind: "retry",
						seq: current.metadata.seq,
						attempt,
						delayMs,
						error: `${opts.sessionId}: ack timeout for seq ${current.metadata.seq}`,
					} satisfies WireBridgeEvent<TPayload, unknown>,
				],
			]);
			const retry = wireBridgeEnvelope<TPayload>({
				sessionId: current.sessionId,
				type: current.type,
				seq: current.metadata.seq,
				cursor: state.cursor,
				payload: current.payload,
				idempotencyKey: current.metadata.idempotencyKey,
				attempt,
				maxAttempts: policy.maxAttempts,
				timestampMs: now(),
				requestId: current.metadata.requestId,
			});
			pending.timer = setTimeout(() => {
				pending.timer = undefined;
				if (!state.active || !state.pending.has(current.metadata.seq)) return;
				pending.envelope = retry;
				ctx.down([["DATA", { kind: "outbound", envelope: retry }]]);
				schedule(retry);
			}, delayMs);
		}, timeoutMs);
	};
	state.pending.set(envelope.metadata.seq, pending);
	schedule(envelope);
}

function processInbound<TOutbound, TInbound>(
	ctx: Ctx,
	state: BridgeState<TOutbound>,
	input: unknown,
	sessionId: string,
): void {
	if (isInvalidIngress(input)) {
		ctx.down([["DATA", { kind: "invalid", error: input.error }]]);
		return;
	}
	const invalid = validateInboundEnvelope(input);
	if (invalid !== undefined) {
		ctx.down([["DATA", { kind: "invalid", error: invalid }]]);
		return;
	}
	const envelope = input as WireBridgeEnvelope<TInbound>;
	if (envelope.sessionId !== sessionId) {
		ctx.down([
			[
				"DATA",
				{
					kind: "session-mismatch",
					expected: sessionId,
					actual: envelope.sessionId,
				} satisfies WireBridgeEvent<TOutbound, TInbound>,
			],
		]);
		return;
	}
	const seq = envelope.metadata.seq;
	const expected = state.cursor + 1;
	if (seq <= state.cursor) {
		ctx.down([["DATA", { kind: "duplicate", seq, cursor: state.cursor }]]);
		return;
	}
	if (seq > expected) {
		ctx.down([["DATA", { kind: "out-of-order", seq, expected }]]);
		return;
	}
	if (envelope.metadata.cursor < state.remoteCursor) {
		ctx.down([
			[
				"DATA",
				{
					kind: "invalid",
					error: `${sessionId}: inbound cursor ${envelope.metadata.cursor} regressed below ${state.remoteCursor}`,
				},
			],
		]);
		return;
	}
	state.remoteCursor = envelope.metadata.cursor;
	state.cursor = seq;
	ctx.down([["DATA", { kind: "cursor", cursor: state.cursor }]]);
	ctx.down([["DATA", { kind: "inbound", envelope }]]);
	if (envelope.type === "ack" && envelope.metadata.ackForSeq !== undefined) {
		const pending = state.pending.get(envelope.metadata.ackForSeq);
		if (pending === undefined) {
			ctx.down([
				["DATA", { kind: "late-receipt", receipt: "ack", ackForSeq: envelope.metadata.ackForSeq }],
			]);
			return;
		}
		if (pending?.timer !== undefined) clearTimeout(pending.timer);
		state.pending.delete(envelope.metadata.ackForSeq);
		ctx.down([
			[
				"DATA",
				{
					kind: "ack",
					ackForSeq: envelope.metadata.ackForSeq,
					envelope,
					outbound: pending.envelope,
				} satisfies WireBridgeEvent<TOutbound, TInbound>,
			],
		]);
	} else if (envelope.type === "nack" && envelope.metadata.ackForSeq !== undefined) {
		const pending = state.pending.get(envelope.metadata.ackForSeq);
		if (pending === undefined) {
			ctx.down([
				["DATA", { kind: "late-receipt", receipt: "nack", ackForSeq: envelope.metadata.ackForSeq }],
			]);
			return;
		}
		if (pending?.timer !== undefined) clearTimeout(pending.timer);
		state.pending.delete(envelope.metadata.ackForSeq);
		ctx.down([
			[
				"DATA",
				{
					kind: "nack",
					ackForSeq: envelope.metadata.ackForSeq,
					envelope,
					outbound: pending.envelope,
					error: bridgePayloadError(envelope.payload, "remote nack"),
				} satisfies WireBridgeEvent<TOutbound, TInbound>,
			],
		]);
	}
}

function validateInboundEnvelope(envelope: unknown): string | undefined {
	if (typeof envelope !== "object" || envelope === null) {
		return "wireBridge: inbound envelope must be an object";
	}
	const candidate = envelope as Partial<WireBridgeEnvelope<unknown>>;
	if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) {
		return "wireBridge: inbound envelope sessionId must be a non-empty string";
	}
	if (
		typeof candidate.type !== "string" ||
		!envelopeTypes.has(candidate.type as WireBridgeEnvelopeType)
	) {
		return "wireBridge: inbound envelope type is not recognized";
	}
	const metadata = candidate.metadata as Partial<WireBridgeMetadata> | undefined;
	if (typeof metadata !== "object" || metadata === null) {
		return "wireBridge: inbound envelope metadata must be an object";
	}
	if (!isSafePositiveInteger(metadata.seq)) {
		return "wireBridge: inbound envelope seq must be a positive integer";
	}
	if (!isSafeNonNegativeInteger(metadata.cursor)) {
		return "wireBridge: inbound envelope cursor must be a non-negative integer";
	}
	if (
		typeof metadata.idempotencyKey !== "string" ||
		(metadata.idempotencyKey as string).length === 0
	) {
		return "wireBridge: inbound envelope idempotencyKey must be a non-empty string";
	}
	if (!isSafePositiveInteger(metadata.attempt)) {
		return "wireBridge: inbound envelope attempt must be a positive integer";
	}
	if (
		!isSafePositiveInteger(metadata.maxAttempts) ||
		(metadata.maxAttempts as number) < (metadata.attempt as number)
	) {
		return "wireBridge: inbound envelope maxAttempts must be >= attempt";
	}
	if (metadata.ackForSeq !== undefined && !isSafePositiveInteger(metadata.ackForSeq)) {
		return "wireBridge: inbound envelope ackForSeq must be a positive integer";
	}
	if ((candidate.type === "ack" || candidate.type === "nack") && metadata.ackForSeq === undefined) {
		return `wireBridge: inbound ${candidate.type} envelope requires ackForSeq`;
	}
	const payloadError = validatePayloadForType(
		candidate.type as WireBridgeEnvelopeType,
		candidate.payload,
		"wireBridge: inbound envelope",
	);
	if (payloadError !== undefined) return payloadError;
	return undefined;
}

function validateCommand(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return "wireBridge: command fact must be an object";
	}
	const kind = (value as { readonly kind?: unknown }).kind;
	if (
		kind !== "start" &&
		kind !== "send" &&
		kind !== "ack" &&
		kind !== "nack" &&
		kind !== "close"
	) {
		return "wireBridge: command kind is not recognized";
	}
	if (
		(kind === "ack" || kind === "nack") &&
		!isSafePositiveInteger((value as { readonly ackForSeq?: unknown }).ackForSeq)
	) {
		return `wireBridge: ${kind} command ackForSeq must be a positive integer`;
	}
	return undefined;
}

function projectOutbound<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeEnvelope<TOutbound>> {
	return graph.node<WireBridgeEnvelope<TOutbound>>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "outbound") ctx.down([["DATA", event.envelope]]);
			}
		},
		{ name: `${name}/outbound`, factory: "wireBridgeOutbound" },
	);
}

function projectAcks<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeAck> {
	return graph.node<WireBridgeAck>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "ack") {
					ctx.down([["DATA", { ackForSeq: event.ackForSeq, envelope: event.envelope }]]);
				}
			}
		},
		{ name: `${name}/acks`, factory: "wireBridgeAcks" },
	);
}

function projectNacks<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeNack> {
	return graph.node<WireBridgeNack>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "nack") {
					ctx.down([
						["DATA", { ackForSeq: event.ackForSeq, envelope: event.envelope, error: event.error }],
					]);
				}
			}
		},
		{ name: `${name}/nacks`, factory: "wireBridgeNacks" },
	);
}

function projectStatus<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
	sessionId: string,
): Node<WireBridgeStatus> {
	return graph.node<WireBridgeStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<WireBridgeStatus>() ??
				({
					sessionId,
					state: "idle",
					cursor: 0,
					nextSeq: 1,
					pending: 0,
					attempts: 0,
					acked: 0,
					nacked: 0,
					errors: 0,
				} satisfies WireBridgeStatus);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "outbound") {
					const { seq, attempt } = event.envelope.metadata;
					const trackAck = shouldTrackAck(event.envelope.type);
					next = {
						...next,
						state:
							event.envelope.type === "start"
								? "started"
								: event.envelope.type === "close"
									? "closed"
									: "open",
						nextSeq: Math.max(next.nextSeq, seq + 1),
						pending:
							event.envelope.type === "close"
								? 1
								: trackAck && attempt === 1
									? next.pending + 1
									: next.pending,
						attempts: trackAck ? next.attempts + 1 : next.attempts,
						lastSeq: seq,
					};
				} else if (event.kind === "ack") {
					next = {
						...next,
						state: event.outbound.type === "close" ? "closed" : "open",
						pending: Math.max(0, next.pending - 1),
						acked: next.acked + 1,
						lastSeq: event.envelope.metadata.seq,
					};
				} else if (event.kind === "nack") {
					next = {
						...next,
						state: "errored",
						pending: Math.max(0, next.pending - 1),
						nacked: next.nacked + 1,
						errors: next.errors + 1,
						lastSeq: event.envelope.metadata.seq,
					};
				} else if (event.kind === "retry") {
					next = {
						...next,
						state: "waiting",
						lastSeq: event.seq,
						lastDelayMs: event.delayMs,
					};
				} else if (event.kind === "exhausted") {
					next = {
						...next,
						state: "exhausted",
						pending: Math.max(0, next.pending - 1),
						errors: next.errors + 1,
						lastSeq: event.seq,
					};
				} else if (event.kind === "cursor") {
					next = { ...next, cursor: event.cursor };
				} else if (event.kind === "out-of-order") {
					next = { ...next, state: "errored", errors: next.errors + 1, lastSeq: event.seq };
				} else if (event.kind === "session-mismatch") {
					next = { ...next, state: "errored", errors: next.errors + 1 };
				} else if (event.kind === "late-receipt" || event.kind === "invalid") {
					next = { ...next, state: "errored", errors: next.errors + 1 };
				} else if (event.kind === "inbound" && event.envelope.type === "error") {
					next = {
						...next,
						state: "errored",
						errors: next.errors + 1,
						lastSeq: event.envelope.metadata.seq,
					};
				} else if (event.kind === "inbound" && event.envelope.type === "close") {
					next = { ...next, state: "closed", lastSeq: event.envelope.metadata.seq };
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "wireBridgeStatus" },
	);
}

function projectErrors<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<unknown> {
	return graph.node<unknown>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "nack") ctx.down([["DATA", event.error]]);
				else if (event.kind === "exhausted") ctx.down([["DATA", event.error]]);
				else if (event.kind === "out-of-order") {
					ctx.down([
						[
							"DATA",
							`${name}: inbound seq ${event.seq} arrived before expected seq ${event.expected}`,
						],
					]);
				} else if (event.kind === "inbound" && event.envelope.type === "error") {
					ctx.down([["DATA", bridgePayloadError(event.envelope.payload, "remote error envelope")]]);
				} else if (event.kind === "session-mismatch") {
					ctx.down([
						[
							"DATA",
							`${name}: inbound session ${event.actual} did not match expected ${event.expected}`,
						],
					]);
				} else if (event.kind === "late-receipt") {
					ctx.down([
						[
							"DATA",
							`${name}: late ${event.receipt} for unknown or completed ackForSeq ${event.ackForSeq}`,
						],
					]);
				} else if (event.kind === "invalid") {
					ctx.down([["DATA", event.error]]);
				}
			}
		},
		{ name: `${name}/errors`, factory: "wireBridgeErrors" },
	);
}

function projectCursor<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<number> {
	return graph.node<number>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "cursor") ctx.down([["DATA", event.cursor]]);
			}
		},
		{ name: `${name}/cursor`, factory: "wireBridgeCursor" },
	);
}

function projectAttempts<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeAttempt> {
	return graph.node<WireBridgeAttempt>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "outbound" && shouldTrackAck(event.envelope.type)) {
					ctx.down([
						[
							"DATA",
							{
								seq: event.envelope.metadata.seq,
								attempt: event.envelope.metadata.attempt,
								maxAttempts: event.envelope.metadata.maxAttempts,
							},
						],
					]);
				}
			}
		},
		{ name: `${name}/attempts`, factory: "wireBridgeAttempts" },
	);
}

function guardedInboundNode<TInbound>(
	node: Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>,
	sessionId: string,
): Node<WireBridgeEnvelope<TInbound>> {
	return new Proxy(node, {
		get(target, property) {
			if (property === "down") {
				return (msgs: Wave) => target.down(guardInboundWave(msgs, sessionId));
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as Node<WireBridgeEnvelope<TInbound>>;
}

function guardInboundWave(msgs: Wave, sessionId: string): Wave {
	return msgs.map((msg) => {
		if (msg[0] === "DATA") return msg;
		if (msg[0] === "ERROR") {
			return [
				"DATA",
				invalidIngress(
					`${sessionId}: inbound protocol ERROR ${String(
						errorPayload(msg[1]),
					)} is local misuse; remote errors must arrive as DATA envelope facts`,
				),
			];
		}
		if (msg[0] === "COMPLETE") {
			return [
				"DATA",
				invalidIngress(
					`${sessionId}: inbound protocol COMPLETE is local misuse; remote completion must arrive as a DATA envelope fact`,
				),
			];
		}
		return [
			"DATA",
			invalidIngress(
				`${sessionId}: inbound port accepts DATA envelope facts only; ${msg[0]} is local protocol traffic`,
			),
		];
	});
}

function invalidIngress(error: string): WireBridgeInvalidIngress {
	return { __wireBridgeInvalidIngress: true, error };
}

function isInvalidIngress(value: unknown): value is WireBridgeInvalidIngress {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as WireBridgeInvalidIngress).__wireBridgeInvalidIngress === true &&
		typeof (value as WireBridgeInvalidIngress).error === "string"
	);
}

function shouldTrackAck(type: WireBridgeEnvelopeType): boolean {
	return type === "start" || type === "data" || type === "close";
}

function isSafePositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validatePayloadForType(
	type: WireBridgeEnvelopeType,
	payload: unknown,
	prefix: string,
): string | undefined {
	const kind =
		typeof payload === "object" && payload !== null
			? (payload as { readonly kind?: unknown }).kind
			: undefined;
	switch (type) {
		case "data":
			return kind === "data" && (payload as { readonly value?: unknown }).value !== undefined
				? undefined
				: `${prefix}: data envelope requires data payload`;
		case "nack":
		case "error":
			return kind === "error" && (payload as { readonly error?: unknown }).error !== undefined
				? undefined
				: `${prefix}: ${type} envelope requires error payload`;
		case "status":
			return kind === "status" && (payload as { readonly status?: unknown }).status !== undefined
				? undefined
				: `${prefix}: status envelope requires status payload`;
		case "close":
			return kind === "close" ? undefined : `${prefix}: close envelope requires close payload`;
		case "start":
		case "ack":
			return payload === undefined
				? undefined
				: `${prefix}: ${type} envelope must not carry a payload`;
	}
}

function bridgePayloadError(payload: unknown, fallback: unknown): unknown {
	if (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { readonly kind?: unknown }).kind === "error"
	) {
		return (payload as { readonly error?: unknown }).error;
	}
	return fallback;
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
