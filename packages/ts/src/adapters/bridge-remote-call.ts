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
	RemoteCallBundle,
	RemoteCallError,
	RemoteCallOptions,
	RemoteCallRequest,
	RemoteCallResponse,
	RemoteCallResult,
	RemoteCallStatus,
	RemoteCallTimeout,
	WireBridgeBundle,
	WireBridgeEnvelope,
	WireBridgeEvent,
} from "./bridge-types.js";
import {
	remoteMalformedResponseOperation,
	remoteMalformedResponseRequestId,
	validateRemoteCallRequest,
	validateRemoteCallResponse,
} from "./bridge-validation.js";

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
	const status = remoteCallStatusNode(graph, bridge.events, timeouts, name);
	const errors = remoteCallErrorsNode(graph, timeouts, bridge.events, name);
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

function remotePendingPeekByRequestId(
	state: RemotePendingState,
	requestId: string,
): RemotePendingRequest | undefined {
	for (const request of state.bySeq.values()) {
		if (request.requestId === requestId) return request;
	}
	return undefined;
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

function remoteCallResponseRequestId<T>(response: RemoteCallResponse<T>): string {
	return response.requestId;
}

function remoteCallResponseIsTerminal<T>(response: RemoteCallResponse<T>): boolean {
	return response.kind === "result" || response.kind === "error";
}

function remoteCallResponseOperation<T>(response: RemoteCallResponse<T>): string {
	return response.operation;
}

function remoteCallResponseMatchesPending<T>(
	response: RemoteCallResponse<T>,
	request: RemotePendingRequest,
): boolean {
	return remoteCallResponseOperation(response) === request.operation;
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
						const operation = remoteMalformedResponseOperation(event.envelope.payload.value);
						const request =
							requestId === undefined
								? undefined
								: remotePendingPeekByRequestId(state.pending, requestId);
						if (
							request !== undefined &&
							operation !== undefined &&
							operation === request.operation
						) {
							remotePendingTakeByRequestId(state.pending, request.requestId);
						}
						continue;
					}
					const requestId = remoteCallResponseRequestId(response);
					const request = remotePendingPeekByRequestId(state.pending, requestId);
					if (request !== undefined && remoteCallResponseMatchesPending(response, request)) {
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
	timeouts: Node<RemoteCallTimeout>,
	name: string,
): Node<RemoteCallStatus> {
	return graph.node<RemoteCallStatus>(
		[events, timeouts],
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
						const operation = remoteMalformedResponseOperation(event.envelope.payload.value);
						const request =
							requestId === undefined || operation === undefined
								? undefined
								: remotePendingPeekByRequestId(state.pending, requestId);
							const matchedRequest =
								request !== undefined && request.operation === operation ? request : undefined;
							if (matchedRequest === undefined) continue;
							remotePendingTakeByRequestId(state.pending, matchedRequest.requestId);
							state.status = {
								...state.status,
								state: "errored",
								operation: matchedRequest.operation,
								requestId: matchedRequest.requestId,
								errors: state.status.errors + 1,
							};
							continue;
					}
					const request = remotePendingPeekByRequestId(state.pending, response.requestId);
					if (request === undefined) {
						state.status = {
							...state.status,
							state: "errored",
							operation: response.operation,
							requestId: response.requestId,
							errors: state.status.errors + 1,
						};
						continue;
					}
					if (!remoteCallResponseMatchesPending(response, request)) {
						state.status = {
							...state.status,
							state: "errored",
							operation: request.operation,
							requestId: request.requestId,
							errors: state.status.errors + 1,
						};
						continue;
					}
					if (response.kind === "result") {
						remotePendingTakeByRequestId(state.pending, request.requestId);
						state.status = {
							...state.status,
							state: "responded",
							operation: response.operation,
							requestId: response.requestId,
							completed: state.status.completed + 1,
						};
					} else if (response.kind === "error") {
						remotePendingTakeByRequestId(state.pending, request.requestId);
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
							state: "requested",
							operation: response.operation,
							requestId: response.requestId,
						};
					}
				}
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
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
	timeouts: Node<RemoteCallTimeout>,
	events: Node<WireBridgeEvent<RemoteCallRequest<TRequest>, RemoteCallResponse<TResponse>>>,
	name: string,
): Node<RemoteCallError> {
	return graph.node<RemoteCallError>(
		[timeouts, events],
		(ctx) => {
			const pending = ctx.state.get<RemotePendingState>() ?? remotePendingState();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const timeout = raw as RemoteCallTimeout;
				remotePendingTakeByRequestId(pending, timeout.requestId);
				ctx.down([
					[
						"DATA",
						{ operation: timeout.operation, requestId: timeout.requestId, error: timeout.error },
					],
				]);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
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
					continue;
				}
				if (event.kind === "inbound" && event.envelope.payload?.kind === "data") {
					const response = validateRemoteCallResponse<TResponse>(event.envelope.payload.value);
					if (response === undefined) {
						const requestId = remoteMalformedResponseRequestId(event.envelope.payload.value);
						const operation = remoteMalformedResponseOperation(event.envelope.payload.value);
							const request =
								requestId === undefined || operation === undefined
									? undefined
									: remotePendingPeekByRequestId(pending, requestId);
							if (request === undefined || request.operation !== operation) continue;
							remotePendingTakeByRequestId(pending, request.requestId);
							ctx.down([
								[
									"DATA",
								{
									...(operation === undefined ? {} : { operation }),
									...(requestId === undefined ? {} : { requestId }),
									error: "remoteCall: response payload is malformed",
								},
							],
						]);
					} else {
						const request = remotePendingPeekByRequestId(pending, response.requestId);
						if (request === undefined) {
							ctx.down([
								[
									"DATA",
									{
										operation: response.operation,
										requestId: response.requestId,
										error: "remoteCall: orphan response for unknown or completed request",
									},
								],
							]);
						} else if (!remoteCallResponseMatchesPending(response, request)) {
							ctx.down([
								[
									"DATA",
									{
										operation: request.operation,
										requestId: request.requestId,
										error: `remoteCall: response operation '${response.operation}' did not match pending operation '${request.operation}'`,
									},
								],
							]);
						} else if (response.kind === "error") {
							remotePendingTakeByRequestId(pending, request.requestId);
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
							remotePendingTakeByRequestId(pending, request.requestId);
						}
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
