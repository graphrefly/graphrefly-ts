/**
 * Graph-visible wire bridge envelope helpers (D134).
 *
 * This first slice is transport-free: commands become outbound envelope facts,
 * remote receipts enter only through the inbound fact node, and retry/ack timeout
 * state is surfaced through graph-visible attempts/status/errors nodes.
 */

import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type {
	RemoteCallError,
	RemoteCallRequest,
	RemoteCallResponse,
	RemoteResponderEvent,
	RemoteResponderHandler,
	RemoteResponderHandlerDefinition,
	RemoteResponderStatus,
	WireBridgeCommand,
	WireBridgeEnvelope,
	WireBridgeInvalidIngress,
} from "./bridge-types.js";
import {
	errorMessage,
	isThenable,
	rethrowGraphRuntimeInvariant,
	validateInboundEnvelope,
	validateRemoteCallRequest,
} from "./bridge-validation.js";

export function normalizeRemoteHandlers<TRequest, TResponse>(
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

export function remoteResponderEventsNode<TRequest, TResponse>(
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

export function remoteResponderResponseCommandsNode<TRequest, TResponse>(
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

export function remoteResponderRequestsNode<TRequest, TResponse>(
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

export function remoteResponderStatusNode<TRequest, TResponse>(
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

export function remoteResponderErrorsNode<TRequest, TResponse>(
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
