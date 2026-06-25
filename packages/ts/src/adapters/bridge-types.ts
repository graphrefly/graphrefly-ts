import type { RetryPolicy } from "../graph/resilience.js";
import type { Node } from "../node/node.js";
import type {
	CanonicalProtobufErrorCategory,
	CanonicalWireBridgeDataBody,
} from "./bridge-protobuf.js";

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

export type WireBridgeProtobufData = Uint8Array | CanonicalWireBridgeDataBody;

export interface WireBridgeProtobufIssue {
	readonly direction: "inbound" | "outbound";
	readonly operation: "decode" | "encode";
	readonly message: string;
	readonly category?: CanonicalProtobufErrorCategory;
}

export interface WireBridgeProtobufStatus {
	readonly decoded: number;
	readonly encoded: number;
	readonly issues: number;
	readonly state: "idle" | "active" | "issues";
	readonly lastIssue?: WireBridgeProtobufIssue;
}

export interface WireBridgeProtobufBundle {
	readonly inboundBytes: Node<Uint8Array>;
	readonly outboundBytes: Node<Uint8Array>;
	readonly issues: Node<WireBridgeProtobufIssue>;
	readonly status: Node<WireBridgeProtobufStatus>;
	release(): void;
}

export interface WireBridgeProtobufOptions {
	readonly name?: string;
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

export interface PendingEnvelope<TData> {
	envelope: WireBridgeEnvelope<TData>;
	timer?: ReturnType<typeof setTimeout>;
}

export interface BridgeState<TData> {
	active: boolean;
	cleanupInstalled: boolean;
	nextSeq: number;
	cursor: number;
	remoteCursor: number;
	terminalReported: boolean;
	pending: Map<number, PendingEnvelope<TData>>;
}

export interface AttachedCommandSources<TOutbound> {
	sources: Node<WireBridgeCommand<TOutbound>>[];
}

export interface WireBridgeInvalidIngress {
	readonly __wireBridgeInvalidIngress: true;
	readonly error: string;
}
