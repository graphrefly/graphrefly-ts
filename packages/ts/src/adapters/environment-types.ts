import type { HttpRequest, ProcessCommand, WebSocketSend } from "../graph/environment.js";
import type { RetryPolicy } from "../graph/resilience.js";
import type { Node } from "../node/node.js";

export type OutboundEvent<TValue, TResult> =
	| { readonly kind: "attempt"; readonly value: TValue; readonly attempt: number }
	| {
			readonly kind: "retry";
			readonly value: TValue;
			readonly attempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| {
			readonly kind: "sent";
			readonly value: TValue;
			readonly attempt: number;
			readonly result: TResult;
	  }
	| {
			readonly kind: "failed";
			readonly value: TValue;
			readonly attempt: number;
			readonly error: unknown;
	  }
	| {
			readonly kind: "exhausted";
			readonly value: TValue;
			readonly attempt: number;
			readonly error: unknown;
	  }
	| { readonly kind: "upstream-complete" }
	| { readonly kind: "upstream-error"; readonly error: unknown };

export interface OutboundStatus {
	readonly state:
		| "idle"
		| "running"
		| "waiting"
		| "succeeded"
		| "failed"
		| "exhausted"
		| "completed";
	readonly inFlight: number;
	readonly attempt: number;
	readonly sent: number;
	readonly failed: number;
	readonly lastDelayMs?: number;
}

export interface OutboundBundle<TValue, TResult> {
	readonly events: Node<OutboundEvent<TValue, TResult>>;
	readonly status: Node<OutboundStatus>;
	readonly attempts: Node<number>;
	readonly errors: Node<unknown>;
}

export interface OutboundAdapterOptions {
	readonly name?: string;
	readonly retry?: RetryPolicy;
}

export type HttpRequestOf<T> = (value: T) => HttpRequest;
export type ProcessCommandOf<T> = (value: T) => ProcessCommand;
export type WebSocketSendOf<T> = (value: T) => WebSocketSend;

/** D133 command facts for a graph-visible WebSocket SessionBundle. */
export type WebSocketSessionCommand =
	| { readonly kind: "start" }
	| { readonly kind: "send"; readonly message: WebSocketSend }
	| { readonly kind: "close"; readonly code?: number; readonly reason?: string };

/** Inbound facts emitted by the live WebSocket session connection. */
export type WebSocketSessionInbound =
	| { readonly kind: "text"; readonly data: string }
	| { readonly kind: "binary"; readonly data: Uint8Array };

/** Observable lifecycle facts for bounded D133 reconnect/session progress. */
export type WebSocketSessionLifecycle =
	| { readonly kind: "starting"; readonly attempt: number; readonly maxAttempts: number }
	| { readonly kind: "open"; readonly attempt: number }
	| { readonly kind: "sent"; readonly message: WebSocketSend }
	| { readonly kind: "closing"; readonly code?: number; readonly reason?: string }
	| { readonly kind: "closed"; readonly code?: number; readonly reason?: string }
	| {
			readonly kind: "retrying";
			readonly attempt: number;
			readonly nextAttempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| { readonly kind: "exhausted"; readonly attempt: number; readonly error: unknown };

/** D175 graph-visible outbound disposition for a WebSocket SessionBundle send. */
export type WebSocketSessionOutbound =
	| { readonly kind: "queued"; readonly seq: number; readonly message: WebSocketSend }
	| { readonly kind: "sending"; readonly seq: number; readonly message: WebSocketSend }
	| { readonly kind: "sent"; readonly seq: number; readonly message: WebSocketSend }
	| {
			readonly kind: "rejected";
			readonly seq: number;
			readonly message: WebSocketSend;
			readonly error: unknown;
	  }
	| {
			readonly kind: "canceled";
			readonly seq: number;
			readonly message: WebSocketSend;
			readonly reason: unknown;
	  };

/** Current graph-visible WebSocket session status projection. */
export interface WebSocketSessionStatus {
	readonly state:
		| "idle"
		| "connecting"
		| "open"
		| "closing"
		| "closed"
		| "waiting"
		| "exhausted"
		| "errored";
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly sent: number;
	readonly received: number;
	readonly errors: number;
	readonly lastDelayMs?: number;
}

/** D133 SessionBundle: all session commands, inbound data, attempts, status, and errors are nodes. */
export interface WebSocketSessionBundle {
	readonly command: Node<WebSocketSessionCommand>;
	readonly inbound: Node<WebSocketSessionInbound>;
	readonly lifecycle: Node<WebSocketSessionLifecycle>;
	readonly outbound: Node<WebSocketSessionOutbound>;
	readonly status: Node<WebSocketSessionStatus>;
	readonly errors: Node<unknown>;
	readonly attempts: Node<number>;
	start(): void;
	send(message: WebSocketSend | string | Uint8Array): void;
	close(code?: number, reason?: string): void;
}

export type WebSocketSessionSendPolicy =
	| { readonly kind?: "reject" }
	| { readonly kind: "buffer"; readonly maxPending: number };

/** Options for the D133 WebSocket SessionBundle; retry is bounded unless configured otherwise. */
export interface WebSocketSessionOptions {
	readonly name?: string;
	readonly retry?: RetryPolicy;
	readonly sendPolicy?: WebSocketSessionSendPolicy;
}
