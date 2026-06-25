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
import { errorPayload } from "../protocol/messages.js";
import type {
	CanonicalWireBridgeDataBody,
	CanonicalWireBridgeEnvelope,
	CanonicalWireBridgeMetadata,
	CanonicalWireBridgePayload,
	CanonicalWireEdgeFrame,
} from "./bridge-protobuf.js";
import {
	CanonicalProtobufError,
	decodeCanonicalWireBridgeEnvelope,
	encodeCanonicalWireBridgeEnvelope,
} from "./bridge-protobuf.js";
import type {
	AttachedCommandSources,
	BridgeState,
	PendingEnvelope,
	RemoteCallRequest,
	RemoteCallResponse,
	RemoteResponderBundle,
	RemoteResponderHandler,
	RemoteResponderHandlerDefinition,
	RemoteResponderOptions,
	WireBridgeBundle,
	WireBridgeCommand,
	WireBridgeEnvelope,
	WireBridgeEnvelopeType,
	WireBridgeEvent,
	WireBridgeInvalidIngress,
	WireBridgeMetadata,
	WireBridgeOptions,
	WireBridgePayload,
	WireBridgeProtobufBundle,
	WireBridgeProtobufData,
	WireBridgeProtobufIssue,
	WireBridgeProtobufOptions,
	WireBridgeProtobufStatus,
} from "./bridge-types.js";

export type {
	CanonicalProtobufErrorCategory,
	CanonicalWireBridgeDataBody,
	CanonicalWireBridgeEnvelope,
	CanonicalWireBridgeMetadata,
	CanonicalWireBridgePayload,
	CanonicalWireEdgeFrame,
} from "./bridge-protobuf.js";
export {
	CanonicalProtobufError,
	decodeCanonicalWireBridgeEnvelope,
	decodeCanonicalWireEdgeFrame,
	encodeCanonicalWireBridgeEnvelope,
	encodeCanonicalWireEdgeFrame,
} from "./bridge-protobuf.js";
export { remoteCall } from "./bridge-remote-call.js";
export type {
	RemoteCallBundle,
	RemoteCallError,
	RemoteCallOptions,
	RemoteCallRequest,
	RemoteCallResponse,
	RemoteCallResult,
	RemoteCallStatus,
	RemoteCallStatusState,
	RemoteCallTimeout,
	RemoteResponderBundle,
	RemoteResponderEvent,
	RemoteResponderHandler,
	RemoteResponderHandlerDefinition,
	RemoteResponderOptions,
	RemoteResponderStatus,
	RemoteResponderStatusState,
	WireBridgeAck,
	WireBridgeAttempt,
	WireBridgeBundle,
	WireBridgeCommand,
	WireBridgeEnvelope,
	WireBridgeEnvelopeType,
	WireBridgeEvent,
	WireBridgeMetadata,
	WireBridgeNack,
	WireBridgeOptions,
	WireBridgePayload,
	WireBridgeProtobufBundle,
	WireBridgeProtobufData,
	WireBridgeProtobufIssue,
	WireBridgeProtobufOptions,
	WireBridgeProtobufStatus,
	WireBridgeStatus,
} from "./bridge-types.js";

import {
	guardedInboundNode,
	invalidIngress,
	isInvalidIngress,
	projectAcks,
	projectAttempts,
	projectCursor,
	projectErrors,
	projectNacks,
	projectOutbound,
	projectStatus,
} from "./bridge-projections.js";
import {
	normalizeRemoteHandlers,
	remoteResponderErrorsNode,
	remoteResponderEventsNode,
	remoteResponderRequestsNode,
	remoteResponderResponseCommandsNode,
	remoteResponderStatusNode,
} from "./bridge-remote-responder.js";
import {
	bridgePayloadError,
	envelopeTypes,
	isSafeNonNegativeInteger,
	isSafePositiveInteger,
	shouldTrackAck,
	validateCommand,
	validateInboundEnvelope,
	validatePayloadForType,
} from "./bridge-validation.js";

const defaultAckTimeoutMs = 30_000;
const bridgeCommandSources = new WeakMap<
	WireBridgeBundle<unknown, unknown>,
	AttachedCommandSources<unknown>
>();
const bridgeInboundTargets = new WeakMap<
	WireBridgeBundle<unknown, unknown>,
	Node<WireBridgeEnvelope<unknown> | WireBridgeInvalidIngress>
>();
const bridgeInboundSources = new WeakMap<
	WireBridgeBundle<unknown, unknown>,
	{ sources: Node<WireBridgeEnvelope<unknown> | WireBridgeInvalidIngress>[] }
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
	bridgeInboundSources.set(bundle as WireBridgeBundle<unknown, unknown>, { sources: [] });
	return bundle;
}

type WireBridgeProtobufInboundResult =
	| { readonly kind: "decoded"; readonly envelope: WireBridgeEnvelope<WireBridgeProtobufData> }
	| {
			readonly kind: "issue";
			readonly issue: WireBridgeProtobufIssue;
			readonly invalid: WireBridgeInvalidIngress;
	  };

type WireBridgeProtobufOutboundResult =
	| { readonly kind: "encoded"; readonly bytes: Uint8Array }
	| { readonly kind: "issue"; readonly issue: WireBridgeProtobufIssue };

/**
 * D498 focused canonical protobuf byte adapter over an existing semantic wireBridge bundle.
 *
 * This helper owns no transport/session/retry policy and does not add wireBridge core options.
 * Malformed bytes become graph-visible issue/invalid facts, never local protocol terminals.
 */
export function wireBridgeProtobuf(
	graph: Graph,
	bridge: WireBridgeBundle<WireBridgeProtobufData, WireBridgeProtobufData>,
	opts: WireBridgeProtobufOptions = {},
): WireBridgeProtobufBundle {
	const name = opts.name ?? "wireBridgeProtobuf";
	const topology = graph.topologyGroup({ name: `${name}.wireBridgeProtobuf` });
	const inboundBytes = topology.node<Uint8Array>([], null, {
		name: `${name}/inboundBytes`,
		factory: "wireBridgeProtobufInboundBytes",
	});
	const issues = topology.node<WireBridgeProtobufIssue>([], null, {
		name: `${name}/issues`,
		factory: "wireBridgeProtobufIssues",
	});
	const status = topology.node<WireBridgeProtobufStatus>([], null, {
		name: `${name}/status`,
		factory: "wireBridgeProtobufStatus",
	});
	let currentStatus: WireBridgeProtobufStatus = {
		decoded: 0,
		encoded: 0,
		issues: 0,
		state: "idle",
	};
	const recordStatus = (event: "decoded" | "encoded" | WireBridgeProtobufIssue) => {
		currentStatus =
			event === "decoded"
				? {
						...currentStatus,
						decoded: currentStatus.decoded + 1,
						state: currentStatus.issues > 0 ? "issues" : "active",
					}
				: event === "encoded"
					? {
							...currentStatus,
							encoded: currentStatus.encoded + 1,
							state: currentStatus.issues > 0 ? "issues" : "active",
						}
					: {
							...currentStatus,
							issues: currentStatus.issues + 1,
							state: "issues",
							lastIssue: event,
						};
		status.down([["DATA", currentStatus]]);
	};
	const inboundResults = topology.node<WireBridgeProtobufInboundResult>(
		[inboundBytes],
		(ctx) => {
			for (const bytes of depBatch(ctx, 0) ?? []) {
				const result = wireBridgeProtobufInboundResult(bytes as Uint8Array, bridge.sessionId);
				if (result.kind === "issue") {
					issues.down([["DATA", result.issue]]);
					recordStatus(result.issue);
				} else {
					recordStatus("decoded");
				}
				ctx.down([["DATA", result]]);
			}
		},
		{
			name: `${name}/inboundResults`,
			factory: "wireBridgeProtobufInboundResults",
		},
	);
	const inboundDecoded = topology.node<
		WireBridgeEnvelope<WireBridgeProtobufData> | WireBridgeInvalidIngress
	>(
		[inboundResults],
		(ctx) => {
			for (const result of depBatch(ctx, 0) ?? []) {
				const typed = result as WireBridgeProtobufInboundResult;
				ctx.down([["DATA", typed.kind === "decoded" ? typed.envelope : typed.invalid]]);
			}
		},
		{
			name: `${name}/inboundDecoded`,
			factory: "wireBridgeProtobufInboundDecoded",
		},
	);
	const outboundResults = topology.node<WireBridgeProtobufOutboundResult>(
		[bridge.outbound],
		(ctx) => {
			for (const envelope of depBatch(ctx, 0) ?? []) {
				let result: WireBridgeProtobufOutboundResult;
				try {
					const canonical = canonicalEnvelopeFromSemantic(
						envelope as WireBridgeEnvelope<WireBridgeProtobufData>,
					);
					result = { kind: "encoded", bytes: encodeCanonicalWireBridgeEnvelope(canonical) };
				} catch (error) {
					const issue = protobufIssue("outbound", "encode", error);
					result = { kind: "issue", issue };
				}
				if (result.kind === "issue") {
					issues.down([["DATA", result.issue]]);
					recordStatus(result.issue);
				} else {
					recordStatus("encoded");
				}
				ctx.down([["DATA", result]]);
			}
		},
		{
			name: `${name}/outboundResults`,
			factory: "wireBridgeProtobufOutboundResults",
		},
	);
	const outboundBytes = topology.node<Uint8Array>(
		[outboundResults],
		(ctx) => {
			for (const result of depBatch(ctx, 0) ?? []) {
				const typed = result as WireBridgeProtobufOutboundResult;
				if (typed.kind === "encoded") ctx.down([["DATA", typed.bytes]]);
			}
		},
		{ name: `${name}/outboundBytes`, factory: "wireBridgeProtobufOutboundBytes" },
	);
	try {
		attachWireBridgeInboundSource(bridge, inboundDecoded);
	} catch (error) {
		topology.release({ reason: `${name}.wireBridgeProtobuf.failedAttach` });
		throw error;
	}
	let released = false;
	return {
		inboundBytes,
		outboundBytes,
		issues,
		status,
		release() {
			if (released) return;
			detachWireBridgeInboundSource(bridge, inboundDecoded);
			try {
				topology.release({ reason: `${name}.wireBridgeProtobuf.release` });
				released = true;
			} catch (error) {
				attachWireBridgeInboundSource(bridge, inboundDecoded);
				throw error;
			}
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

function attachWireBridgeInboundSource<TOutbound, TInbound>(
	bridge: WireBridgeBundle<TOutbound, TInbound>,
	source: Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>,
): void {
	const attached = bridgeInboundSources.get(bridge as WireBridgeBundle<unknown, unknown>);
	if (attached === undefined) {
		throw new Error("wireBridgeProtobuf: bridge inbound source registry missing");
	}
	const sources = attached.sources as Node<
		WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress
	>[];
	const previousSources = [...sources];
	if (!sources.includes(source)) sources.push(source);
	try {
		wireBridgeInboundTarget(bridge).replaceDeps(
			[...sources],
			wireBridgeInboundSourceFn(sources.length),
		);
	} catch (error) {
		sources.splice(0, sources.length, ...previousSources);
		wireBridgeInboundTarget(bridge).replaceDeps(
			[...previousSources],
			wireBridgeInboundSourceFn(previousSources.length),
		);
		throw error;
	}
}

function detachWireBridgeInboundSource<TOutbound, TInbound>(
	bridge: WireBridgeBundle<TOutbound, TInbound>,
	source: Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>,
): void {
	const attached = bridgeInboundSources.get(bridge as WireBridgeBundle<unknown, unknown>);
	if (attached === undefined) {
		throw new Error("wireBridgeProtobuf: bridge inbound source registry missing");
	}
	const sources = attached.sources as Node<
		WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress
	>[];
	if (!sources.includes(source)) return;
	const previousSources = [...sources];
	const nextSources = sources.filter((candidate) => candidate !== source);
	sources.splice(0, sources.length, ...nextSources);
	try {
		wireBridgeInboundTarget(bridge).replaceDeps(
			[...nextSources],
			wireBridgeInboundSourceFn(nextSources.length),
		);
	} catch (error) {
		sources.splice(0, sources.length, ...previousSources);
		wireBridgeInboundTarget(bridge).replaceDeps(
			[...previousSources],
			wireBridgeInboundSourceFn(previousSources.length),
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

function wireBridgeInboundSourceFn<TInbound>(sourceCount: number): (ctx: Ctx) => void {
	return (ctx) => {
		for (let i = 0; i < sourceCount; i += 1) {
			for (const envelope of depBatch(ctx, i) ?? []) {
				ctx.down([["DATA", envelope as WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress]]);
			}
		}
	};
}

function wireBridgeProtobufInboundResult(
	bytes: Uint8Array,
	sessionId: string,
): WireBridgeProtobufInboundResult {
	try {
		const envelope = semanticEnvelopeFromCanonical(decodeCanonicalWireBridgeEnvelope(bytes));
		return { kind: "decoded", envelope };
	} catch (error) {
		const issue = protobufIssue("inbound", "decode", error);
		return {
			kind: "issue",
			issue,
			invalid: invalidIngress(`${sessionId}: ${issue.message}`),
		};
	}
}

function semanticEnvelopeFromCanonical(
	envelope: CanonicalWireBridgeEnvelope,
): WireBridgeEnvelope<WireBridgeProtobufData> {
	const metadata = semanticMetadataFromCanonical(envelope.metadata);
	switch (envelope.payload.kind) {
		case "start":
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "start",
				seq: metadata.seq,
				cursor: metadata.cursor,
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				requestId: metadata.requestId,
			});
		case "ack":
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "ack",
				seq: metadata.seq,
				cursor: metadata.cursor,
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				ackForSeq: metadata.ackForSeq,
				requestId: metadata.requestId,
			});
		case "data":
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "data",
				seq: metadata.seq,
				cursor: metadata.cursor,
				payload: { kind: "data", value: envelope.payload.body },
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				requestId: metadata.requestId,
			});
		case "nack":
			if (envelope.payload.error === undefined) {
				throw new CanonicalProtobufError(
					"missing_required",
					"semantic wireBridge nack requires error bytes",
				);
			}
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "nack",
				seq: metadata.seq,
				cursor: metadata.cursor,
				payload: { kind: "error", error: envelope.payload.error },
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				ackForSeq: metadata.ackForSeq,
				requestId: metadata.requestId,
			});
		case "status":
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "status",
				seq: metadata.seq,
				cursor: metadata.cursor,
				payload: { kind: "status", status: envelope.payload.status },
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				requestId: metadata.requestId,
			});
		case "error":
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "error",
				seq: metadata.seq,
				cursor: metadata.cursor,
				payload: { kind: "error", error: envelope.payload.error },
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				requestId: metadata.requestId,
			});
		case "close":
			return wireBridgeEnvelope({
				sessionId: envelope.sessionId,
				type: "close",
				seq: metadata.seq,
				cursor: metadata.cursor,
				payload: { kind: "close", reason: envelope.payload.reason },
				idempotencyKey: metadata.idempotencyKey,
				attempt: metadata.attempt,
				maxAttempts: metadata.maxAttempts,
				timestampMs: metadata.timestampMs,
				requestId: metadata.requestId,
			});
	}
}

function canonicalEnvelopeFromSemantic(
	envelope: WireBridgeEnvelope<WireBridgeProtobufData>,
): CanonicalWireBridgeEnvelope {
	return {
		sessionId: envelope.sessionId,
		metadata: {
			seq: BigInt(envelope.metadata.seq),
			cursor: BigInt(envelope.metadata.cursor),
			idempotencyKey: envelope.metadata.idempotencyKey,
			attempt: envelope.metadata.attempt,
			maxAttempts: envelope.metadata.maxAttempts,
			timestampMs:
				envelope.metadata.timestampMs === undefined
					? undefined
					: BigInt(envelope.metadata.timestampMs),
			ackForSeq:
				envelope.metadata.ackForSeq === undefined ? undefined : BigInt(envelope.metadata.ackForSeq),
			requestId: envelope.metadata.requestId,
		},
		payload: canonicalPayloadFromSemantic(envelope),
	};
}

function canonicalPayloadFromSemantic(
	envelope: WireBridgeEnvelope<WireBridgeProtobufData>,
): CanonicalWireBridgePayload {
	const payload = envelope.payload;
	switch (envelope.type) {
		case "start":
			return { kind: "start" };
		case "ack":
			return { kind: "ack" };
		case "data":
			if (payload?.kind !== "data") {
				throw new CanonicalProtobufError("missing_required", "data envelope requires data payload");
			}
			return { kind: "data", body: canonicalDataBody(payload.value) };
		case "nack":
			if (payload?.kind !== "error") {
				throw new CanonicalProtobufError(
					"missing_required",
					"nack envelope requires error payload",
				);
			}
			return { kind: "nack", error: requiredBytes(payload.error, "nack error") };
		case "status":
			if (payload?.kind !== "status") {
				throw new CanonicalProtobufError(
					"missing_required",
					"status envelope requires status payload",
				);
			}
			return { kind: "status", status: requiredBytes(payload.status, "status") };
		case "error":
			if (payload?.kind !== "error") {
				throw new CanonicalProtobufError(
					"missing_required",
					"error envelope requires error payload",
				);
			}
			return { kind: "error", error: requiredBytes(payload.error, "error") };
		case "close":
			if (payload?.kind !== "close") {
				throw new CanonicalProtobufError(
					"missing_required",
					"close envelope requires close payload",
				);
			}
			return { kind: "close", reason: optionalBytes(payload.reason, "close reason") };
	}
}

function canonicalDataBody(value: unknown): CanonicalWireBridgeDataBody {
	if (value instanceof Uint8Array) return { kind: "value", value };
	if (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "value"
	) {
		const bytes = (value as { readonly value?: unknown }).value;
		if (bytes instanceof Uint8Array) return { kind: "value", value: bytes };
	}
	if (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "wire_edge"
	) {
		const frame = (value as { readonly frame?: unknown }).frame;
		return { kind: "wire_edge", frame: frame as CanonicalWireEdgeFrame };
	}
	throw new CanonicalProtobufError(
		"malformed",
		"wireBridgeProtobuf data payload must be Uint8Array or CanonicalWireBridgeDataBody",
	);
}

function semanticMetadataFromCanonical(metadata: CanonicalWireBridgeMetadata): WireBridgeMetadata {
	return {
		seq: safeSemanticNumber(metadata.seq, "seq"),
		cursor: safeSemanticNumber(metadata.cursor, "cursor"),
		idempotencyKey: metadata.idempotencyKey,
		attempt: metadata.attempt,
		maxAttempts: metadata.maxAttempts,
		timestampMs:
			metadata.timestampMs === undefined
				? undefined
				: safeSemanticNumber(metadata.timestampMs, "timestamp_ms"),
		ackForSeq:
			metadata.ackForSeq === undefined
				? undefined
				: safeSemanticNumber(metadata.ackForSeq, "ack_for_seq"),
		requestId: metadata.requestId,
	};
}

function safeSemanticNumber(value: bigint, field: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new CanonicalProtobufError(
			"malformed",
			`${field} exceeds semantic wireBridge Number.MAX_SAFE_INTEGER range`,
		);
	}
	return Number(value);
}

function requiredBytes(value: unknown, field: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	throw new CanonicalProtobufError("malformed", `wireBridgeProtobuf ${field} must be Uint8Array`);
}

function optionalBytes(value: unknown, field: string): Uint8Array | undefined {
	if (value === undefined) return undefined;
	if (value instanceof Uint8Array) return value;
	throw new CanonicalProtobufError("malformed", `wireBridgeProtobuf ${field} must be Uint8Array`);
}

function protobufIssue(
	direction: WireBridgeProtobufIssue["direction"],
	operation: WireBridgeProtobufIssue["operation"],
	error: unknown,
): WireBridgeProtobufIssue {
	return {
		direction,
		operation,
		message: error instanceof Error ? error.message : String(error),
		category: error instanceof CanonicalProtobufError ? error.category : undefined,
	};
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
