/**
 * Graph-visible outbound environment adapters (D130/D132).
 *
 * Async transport work is confined to graph-local EnvironmentDrivers. Each
 * helper returns declared nodes for events/status/attempts/errors instead of a
 * hidden sink side channel.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type {
	DriverCancel,
	HttpRequest,
	HttpResponse,
	ProcessCommand,
	ProcessResult,
	WebSocketRequest,
	WebSocketSend,
	WebSocketSendResult,
	WebSocketSessionHandle,
} from "../graph/environment.js";
import type { Graph } from "../graph/graph.js";
import {
	nextRetryDelayMs,
	type RetryPolicy,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
import type { Node } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";

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
	readonly status: Node<WebSocketSessionStatus>;
	readonly errors: Node<unknown>;
	readonly attempts: Node<number>;
	start(): void;
	send(message: WebSocketSend | string | Uint8Array): void;
	close(code?: number, reason?: string): void;
}

/** Options for the D133 WebSocket SessionBundle; retry is bounded unless configured otherwise. */
export interface WebSocketSessionOptions {
	readonly name?: string;
	readonly retry?: RetryPolicy;
}

type WebSocketSessionEvent =
	| { readonly kind: "attempt"; readonly attempt: number; readonly maxAttempts: number }
	| { readonly kind: "open"; readonly attempt: number }
	| { readonly kind: "message"; readonly message: WebSocketSessionInbound }
	| { readonly kind: "sent"; readonly message: WebSocketSend }
	| { readonly kind: "closing"; readonly code?: number; readonly reason?: string }
	| { readonly kind: "closed"; readonly code?: number; readonly reason?: string }
	| {
			readonly kind: "retry";
			readonly attempt: number;
			readonly nextAttempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| { readonly kind: "error"; readonly error: unknown; readonly attempt?: number }
	| { readonly kind: "exhausted"; readonly attempt: number; readonly error: unknown };

interface SendState {
	seq: number;
	cancels: Map<number, DriverCancel>;
	timers: Map<number, ReturnType<typeof setTimeout>>;
	active: boolean;
	cleanupInstalled: boolean;
}

function assertSourceLocal<T>(source: Node<T>): Node<T> {
	return source;
}

function initSendState(ctx: Ctx): SendState {
	let state = ctx.state.get<SendState>();
	if (state === undefined) {
		state = {
			seq: 0,
			cancels: new Map(),
			timers: new Map(),
			active: true,
			cleanupInstalled: false,
		};
		ctx.state.set(state);
	}
	state.active = true;
	if (!state.cleanupInstalled) {
		state.cleanupInstalled = true;
		ctx.onDeactivation(() => {
			state.active = false;
			state.cleanupInstalled = false;
			for (const cancel of state.cancels.values()) runCancel(cancel);
			for (const timer of state.timers.values()) clearTimeout(timer);
			state.cancels.clear();
			state.timers.clear();
		});
	}
	return state;
}

function runCancel(cancel: DriverCancel): void {
	try {
		cancel();
	} catch {
		// Driver cancellation is best-effort and must not hide graph-visible outcomes.
	}
}

function outboundNodes<TValue, TResult>(
	graph: Graph,
	events: Node<OutboundEvent<TValue, TResult>>,
	name: string,
): OutboundBundle<TValue, TResult> {
	const status = graph.node<OutboundStatus>(
		[events],
		(ctx) => {
			const current =
				ctx.state.get<OutboundStatus>() ??
				({ state: "idle", inFlight: 0, attempt: 0, sent: 0, failed: 0 } satisfies OutboundStatus);
			let next = current;
			for (const event of depBatch(ctx, 0) ?? []) {
				next = reduceStatus(next, event as OutboundEvent<TValue, TResult>);
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "outboundStatus" },
	);
	const attempts = graph.node<number>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as OutboundEvent<TValue, TResult>;
				if ("attempt" in typed) ctx.down([["DATA", typed.attempt]]);
			}
		},
		{ name: `${name}/attempts`, factory: "outboundAttempts" },
	);
	const errors = graph.node<unknown>(
		[events],
		(ctx) => {
			for (const event of depBatch(ctx, 0) ?? []) {
				const typed = event as OutboundEvent<TValue, TResult>;
				if ("error" in typed) ctx.down([["DATA", typed.error]]);
			}
		},
		{ name: `${name}/errors`, factory: "outboundErrors" },
	);
	return { events, status, attempts, errors };
}

function reduceStatus<TValue, TResult>(
	current: OutboundStatus,
	event: OutboundEvent<TValue, TResult>,
): OutboundStatus {
	switch (event.kind) {
		case "attempt":
			return {
				...current,
				state: "running",
				inFlight: current.inFlight + 1,
				attempt: event.attempt,
			};
		case "retry":
			return {
				...current,
				state: "waiting",
				inFlight: Math.max(0, current.inFlight - 1),
				attempt: event.attempt,
				lastDelayMs: event.delayMs,
			};
		case "sent":
			return {
				...current,
				state: "succeeded",
				inFlight: Math.max(0, current.inFlight - 1),
				attempt: event.attempt,
				sent: current.sent + 1,
				lastDelayMs: undefined,
			};
		case "failed":
			return {
				...current,
				state: "failed",
				inFlight: Math.max(0, current.inFlight - 1),
				attempt: event.attempt,
				failed: current.failed + 1,
			};
		case "exhausted":
			return {
				...current,
				state: "exhausted",
				inFlight: Math.max(0, current.inFlight - 1),
				attempt: event.attempt,
				failed: current.failed + 1,
			};
		case "upstream-complete":
			return { ...current, state: "completed" };
		case "upstream-error":
			return { ...current, state: "failed", failed: current.failed + 1 };
	}
}

interface WebSocketSessionState {
	active: boolean;
	connected: boolean;
	cleanupInstalled: boolean;
	currentAttempt: number;
	currentSession: WebSocketSessionHandle | undefined;
	sendCancels: Map<number, DriverCancel>;
	liveSends: Set<number>;
	timers: Map<number, ReturnType<typeof setTimeout>>;
	seq: number;
}

function initWebSocketSessionState(ctx: Ctx): WebSocketSessionState {
	let state = ctx.state.get<WebSocketSessionState>();
	if (state === undefined) {
		state = {
			active: true,
			connected: false,
			cleanupInstalled: false,
			currentAttempt: 0,
			currentSession: undefined,
			sendCancels: new Map(),
			liveSends: new Set(),
			timers: new Map(),
			seq: 0,
		};
		ctx.state.set(state);
	}
	state.active = true;
	if (!state.cleanupInstalled) {
		state.cleanupInstalled = true;
		ctx.onDeactivation(() => {
			state.active = false;
			state.cleanupInstalled = false;
			state.connected = false;
			state.currentAttempt = 0;
			state.currentSession?.cancel();
			state.currentSession = undefined;
			for (const cancel of state.sendCancels.values()) runCancel(cancel);
			for (const timer of state.timers.values()) clearTimeout(timer);
			state.sendCancels.clear();
			state.liveSends.clear();
			state.timers.clear();
		});
	}
	return state;
}

function closeWebSocketSessionState(state: WebSocketSessionState): void {
	state.connected = false;
	state.currentAttempt = 0;
	state.currentSession?.cancel();
	state.currentSession = undefined;
	for (const timer of state.timers.values()) clearTimeout(timer);
	state.timers.clear();
	for (const cancelSend of state.sendCancels.values()) runCancel(cancelSend);
	state.sendCancels.clear();
	state.liveSends.clear();
}

function cancelRetryTimers(state: WebSocketSessionState): void {
	for (const timer of state.timers.values()) clearTimeout(timer);
	state.timers.clear();
}

function cleanupWebSocketConnection(state: WebSocketSessionState): void {
	state.connected = false;
	state.currentAttempt = 0;
	state.currentSession?.cancel();
	state.currentSession = undefined;
}

function webSocketSessionEventNode(
	graph: Graph,
	command: Node<WebSocketSessionCommand>,
	request: WebSocketRequest,
	name: string,
	policy: RetryPolicy,
): Node<WebSocketSessionEvent> {
	return graph.node<WebSocketSessionEvent>(
		[command],
		(ctx) => {
			const state = initWebSocketSessionState(ctx);

			const retryOrExhaust = (attempt: number, error: unknown) => {
				const payload = errorPayload(error);
				cleanupWebSocketConnection(state);
				if (shouldRetry(policy, attempt)) {
					const nextAttempt = attempt + 1;
					const delayMs = nextRetryDelayMs(policy, nextAttempt) ?? 0;
					ctx.down([
						[
							"DATA",
							{
								kind: "retry",
								attempt,
								nextAttempt,
								delayMs,
								error: payload,
							} satisfies WebSocketSessionEvent,
						],
					]);
					const timerId = state.seq++;
					const timer = setTimeout(() => {
						state.timers.delete(timerId);
						if (!state.active) return;
						start(nextAttempt);
					}, delayMs);
					state.timers.set(timerId, timer);
				} else {
					ctx.down([
						[
							"DATA",
							{ kind: "exhausted", attempt, error: payload } satisfies WebSocketSessionEvent,
						],
					]);
				}
			};

			const start = (attempt: number) => {
				if (
					!state.active ||
					state.connected ||
					state.currentAttempt !== 0 ||
					state.timers.size > 0
				) {
					return;
				}
				const driver = ctx.environment().webSocketDriver();
				state.currentAttempt = attempt;
				ctx.down([
					[
						"DATA",
						{
							kind: "attempt",
							attempt,
							maxAttempts: policy.maxAttempts,
						} satisfies WebSocketSessionEvent,
					],
				]);
				const connectSession = driver?.connectSession;
				if (connectSession === undefined) {
					retryOrExhaust(attempt, `${name}: missing WebSocket session capability`);
					return;
				}
				let session: WebSocketSessionHandle | undefined;
				try {
					session = connectSession.call(driver, request, (event) => {
						if (!state.active || state.currentAttempt !== attempt) return;
						if (event.kind === "event") {
							const ws = event.event;
							if (ws.kind === "open") {
								state.connected = true;
								ctx.down([["DATA", { kind: "open", attempt } satisfies WebSocketSessionEvent]]);
							} else if (ws.kind === "text" || ws.kind === "binary") {
								ctx.down([
									[
										"DATA",
										{
											kind: "message",
											message: ws satisfies WebSocketSessionInbound,
										} satisfies WebSocketSessionEvent,
									],
								]);
							} else if (ws.kind === "close") {
								const normalClose = ws.code === 1000;
								cleanupWebSocketConnection(state);
								ctx.down([
									[
										"DATA",
										{
											kind: "closed",
											code: ws.code,
											reason: ws.reason,
										} satisfies WebSocketSessionEvent,
									],
								]);
								if (!normalClose) {
									retryOrExhaust(attempt, {
										kind: "close",
										code: ws.code,
										reason: ws.reason,
									});
								}
							}
						} else if (event.kind === "error") {
							retryOrExhaust(attempt, event.error);
						} else if (event.kind === "complete") {
							retryOrExhaust(attempt, `${name}: connection completed`);
						}
					});
				} catch (error) {
					retryOrExhaust(attempt, error);
					return;
				}
				if (session === undefined) {
					retryOrExhaust(attempt, `${name}: missing WebSocket session capability`);
					return;
				}
				if (state.active && state.currentAttempt === attempt) {
					state.currentSession = session;
				} else {
					session.cancel();
				}
			};

			const send = (message: WebSocketSend) => {
				if (!state.connected) {
					ctx.down([
						[
							"DATA",
							{
								kind: "error",
								error: `${name}: session is not open`,
							} satisfies WebSocketSessionEvent,
						],
					]);
					return;
				}
				const session = state.currentSession;
				if (session === undefined) {
					ctx.down([
						[
							"DATA",
							{
								kind: "error",
								error: `${name}: missing WebSocket session capability`,
							} satisfies WebSocketSessionEvent,
						],
					]);
					return;
				}
				const sendId = state.seq++;
				state.liveSends.add(sendId);
				let done = false;
				let cancel: DriverCancel | undefined;
				try {
					cancel = session.send(message, (result) => {
						if (done || !state.active || !state.liveSends.has(sendId)) return;
						done = true;
						state.liveSends.delete(sendId);
						state.sendCancels.delete(sendId);
						if (result.ok) {
							ctx.down([["DATA", { kind: "sent", message } satisfies WebSocketSessionEvent]]);
						} else {
							ctx.down([
								[
									"DATA",
									{
										kind: "error",
										error: errorPayload(result.error),
									} satisfies WebSocketSessionEvent,
								],
							]);
						}
					});
				} catch (error) {
					state.liveSends.delete(sendId);
					ctx.down([
						["DATA", { kind: "error", error: errorPayload(error) } satisfies WebSocketSessionEvent],
					]);
					return;
				}
				if (cancel !== undefined && !done && state.active && state.liveSends.has(sendId)) {
					state.sendCancels.set(sendId, cancel);
				} else if (cancel !== undefined && !state.active) runCancel(cancel);
			};

			for (const raw of depBatch(ctx, 0) ?? []) {
				const commandValue = raw as WebSocketSessionCommand;
				if (commandValue.kind === "start") start(1);
				else if (commandValue.kind === "send") send(commandValue.message);
				else {
					cancelRetryTimers(state);
					ctx.down([
						[
							"DATA",
							{
								kind: "closing",
								code: commandValue.code,
								reason: commandValue.reason,
							} satisfies WebSocketSessionEvent,
						],
					]);
					state.currentSession?.close(commandValue.code, commandValue.reason);
					closeWebSocketSessionState(state);
					ctx.down([
						[
							"DATA",
							{
								kind: "closed",
								code: commandValue.code,
								reason: commandValue.reason,
							} satisfies WebSocketSessionEvent,
						],
					]);
				}
			}
		},
		{ name: `${name}/events`, factory: "webSocketSessionEvents" },
	);
}

function webSocketSessionNodes(
	graph: Graph,
	command: Node<WebSocketSessionCommand>,
	events: Node<WebSocketSessionEvent>,
	name: string,
	policy: RetryPolicy,
): WebSocketSessionBundle {
	const inbound = graph.node<WebSocketSessionInbound>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "message") ctx.down([["DATA", event.message]]);
			}
		},
		{ name: `${name}/inbound`, factory: "webSocketSessionInbound" },
	);
	const lifecycle = graph.node<WebSocketSessionLifecycle>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "attempt") {
					ctx.down([
						[
							"DATA",
							{
								kind: "starting",
								attempt: event.attempt,
								maxAttempts: event.maxAttempts,
							} satisfies WebSocketSessionLifecycle,
						],
					]);
				} else if (event.kind === "open") {
					ctx.down([["DATA", { kind: "open", attempt: event.attempt }]]);
				} else if (event.kind === "sent") {
					ctx.down([["DATA", { kind: "sent", message: event.message }]]);
				} else if (event.kind === "closing" || event.kind === "closed") {
					ctx.down([["DATA", event]]);
				} else if (event.kind === "retry") {
					ctx.down([
						[
							"DATA",
							{
								kind: "retrying",
								attempt: event.attempt,
								nextAttempt: event.nextAttempt,
								delayMs: event.delayMs,
								error: event.error,
							} satisfies WebSocketSessionLifecycle,
						],
					]);
				} else if (event.kind === "exhausted") {
					ctx.down([["DATA", event]]);
				}
			}
		},
		{ name: `${name}/lifecycle`, factory: "webSocketSessionLifecycle" },
	);
	const status = graph.node<WebSocketSessionStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<WebSocketSessionStatus>() ??
				({
					state: "idle",
					attempt: 0,
					maxAttempts: policy.maxAttempts,
					sent: 0,
					received: 0,
					errors: 0,
				} satisfies WebSocketSessionStatus);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "attempt") {
					next = {
						...next,
						state: "connecting",
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						lastDelayMs: undefined,
					};
				} else if (event.kind === "open") {
					next = { ...next, state: "open", attempt: event.attempt, lastDelayMs: undefined };
				} else if (event.kind === "message") {
					next = { ...next, received: next.received + 1 };
				} else if (event.kind === "sent") {
					next = { ...next, sent: next.sent + 1 };
				} else if (event.kind === "closing") {
					next = { ...next, state: "closing" };
				} else if (event.kind === "closed") {
					next = { ...next, state: "closed" };
				} else if (event.kind === "retry") {
					next = {
						...next,
						state: "waiting",
						attempt: event.attempt,
						errors: next.errors + 1,
						lastDelayMs: event.delayMs,
					};
				} else if (event.kind === "error") {
					next = {
						...next,
						state: "errored",
						attempt: event.attempt ?? next.attempt,
						errors: next.errors + 1,
					};
				} else if (event.kind === "exhausted") {
					next = {
						...next,
						state: "exhausted",
						attempt: event.attempt,
						errors: next.errors + 1,
					};
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "webSocketSessionStatus" },
	);
	const errors = graph.node<unknown>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WebSocketSessionEvent;
				if ("error" in event) ctx.down([["DATA", event.error]]);
			}
		},
		{ name: `${name}/errors`, factory: "webSocketSessionErrors" },
	);
	const attempts = graph.node<number>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "attempt") ctx.down([["DATA", event.attempt]]);
			}
		},
		{ name: `${name}/attempts`, factory: "webSocketSessionAttempts" },
	);
	return {
		command,
		inbound,
		lifecycle,
		status,
		errors,
		attempts,
		start: () => command.down([["DATA", { kind: "start" }]]),
		send: (message) =>
			command.down([
				[
					"DATA",
					{
						kind: "send",
						message:
							typeof message === "string" || message instanceof Uint8Array
								? { data: message }
								: message,
					},
				],
			]),
		close: (code, reason) => command.down([["DATA", { kind: "close", code, reason }]]),
	};
}

/**
 * Create a graph-visible D133 WebSocket SessionBundle.
 *
 * The convenience start/send/close methods publish command facts only; hidden
 * session state is driven by the command node and graph-local EnvironmentDrivers.
 */
export function webSocketSession(
	graph: Graph,
	request: WebSocketRequest,
	opts: WebSocketSessionOptions = {},
): WebSocketSessionBundle {
	const name = opts.name ?? "webSocketSession";
	const policy = opts.retry ?? retryPolicy();
	const command = graph.node<WebSocketSessionCommand>([], null, {
		name: `${name}/command`,
		factory: "webSocketSessionCommand",
	});
	const events = webSocketSessionEventNode(graph, command, request, name, policy);
	return webSocketSessionNodes(graph, command, events, name, policy);
}

function outboundNode<TValue, TResult>(
	graph: Graph,
	source: Node<TValue>,
	name: string,
	send: (
		ctx: Ctx,
		value: TValue,
		callback: (result: { ok: true; value: TResult } | { ok: false; error: unknown }) => void,
	) => DriverCancel | undefined,
	opts: OutboundAdapterOptions,
): Node<OutboundEvent<TValue, TResult>> {
	const policy = opts.retry ?? retryPolicy();
	return graph.node<OutboundEvent<TValue, TResult>>(
		[assertSourceLocal(source)],
		(ctx) => {
			const state = initSendState(ctx);
			const start = (value: TValue, attempt: number) => {
				if (!state.active) return;
				const id = state.seq++;
				ctx.down([
					["DATA", { kind: "attempt", value, attempt } satisfies OutboundEvent<TValue, TResult>],
				]);
				const failTerminal = (error: unknown) => {
					const payload = errorPayload(error);
					ctx.down([
						[
							"DATA",
							{ kind: "exhausted", value, attempt, error: payload } satisfies OutboundEvent<
								TValue,
								TResult
							>,
						],
					]);
					ctx.down([["ERROR", payload]]);
				};
				let cancel: DriverCancel | undefined;
				let done = false;
				try {
					cancel = send(ctx, value, (result) => {
						if (done || !state.active) return;
						done = true;
						state.cancels.delete(id);
						if (result.ok) {
							ctx.down([
								[
									"DATA",
									{ kind: "sent", value, attempt, result: result.value } satisfies OutboundEvent<
										TValue,
										TResult
									>,
								],
							]);
							return;
						}
						if (shouldRetry(policy, attempt)) {
							const nextAttempt = attempt + 1;
							const delayMs = nextRetryDelayMs(policy, nextAttempt) ?? 0;
							ctx.down([
								[
									"DATA",
									{
										kind: "retry",
										value,
										attempt,
										delayMs,
										error: errorPayload(result.error),
									} satisfies OutboundEvent<TValue, TResult>,
								],
							]);
							const timer = setTimeout(() => {
								state.timers.delete(id);
								if (!state.active) return;
								start(value, nextAttempt);
							}, delayMs);
							state.timers.set(id, timer);
						} else {
							ctx.down([
								[
									"DATA",
									{
										kind: "exhausted",
										value,
										attempt,
										error: errorPayload(result.error),
									} satisfies OutboundEvent<TValue, TResult>,
								],
							]);
						}
					});
				} catch (error) {
					if (!done) {
						done = true;
						state.cancels.delete(id);
						failTerminal(error);
					}
					return;
				}
				if (cancel === undefined) {
					if (!done) {
						done = true;
						failTerminal(`${name}: missing environment driver capability`);
					}
					return;
				}
				if (!done && state.active) {
					state.cancels.set(id, cancel);
				} else if (!state.active) {
					runCancel(cancel);
				}
			};
			for (const value of depBatch(ctx, 0) ?? []) start(value as TValue, 1);
			const terminal = ctx.terminal[0];
			if (terminal === true) {
				ctx.down([
					["DATA", { kind: "upstream-complete" } satisfies OutboundEvent<TValue, TResult>],
				]);
			} else if (terminal !== false && terminal !== undefined) {
				ctx.down([
					[
						"DATA",
						{ kind: "upstream-error", error: terminal } satisfies OutboundEvent<TValue, TResult>,
					],
				]);
			}
		},
		{ name, factory: name },
	);
}

export function toHttp<T>(
	graph: Graph,
	source: Node<T>,
	requestOf: HttpRequestOf<T>,
	opts: OutboundAdapterOptions = {},
): OutboundBundle<T, HttpResponse> {
	const name = opts.name ?? "toHttp";
	const events = outboundNode<T, HttpResponse>(
		graph,
		source,
		name,
		(ctx, value, callback) => {
			const request = requestOf(value);
			return ctx.environment().httpDriver()?.request(request, callback);
		},
		opts,
	);
	return outboundNodes(graph, events, name);
}

export function toProcess<T>(
	graph: Graph,
	source: Node<T>,
	commandOf: ProcessCommandOf<T>,
	opts: OutboundAdapterOptions = {},
): OutboundBundle<T, ProcessResult> {
	const name = opts.name ?? "toProcess";
	const events = outboundNode<T, ProcessResult>(
		graph,
		source,
		name,
		(ctx, value, callback) => {
			const command = commandOf(value);
			return ctx.environment().processDriver()?.run(command, callback);
		},
		opts,
	);
	return outboundNodes(graph, events, name);
}

export function toWebSocket<T>(
	graph: Graph,
	source: Node<T>,
	request: WebSocketRequest,
	sendOf: WebSocketSendOf<T>,
	opts: OutboundAdapterOptions = {},
): OutboundBundle<T, WebSocketSendResult> {
	const name = opts.name ?? "toWebSocket";
	const events = outboundNode<T, WebSocketSendResult>(
		graph,
		source,
		name,
		(ctx, value, callback) => {
			const driver = ctx.environment().webSocketDriver();
			return driver?.send?.(request, sendOf(value), callback);
		},
		opts,
	);
	return outboundNodes(graph, events, name);
}
