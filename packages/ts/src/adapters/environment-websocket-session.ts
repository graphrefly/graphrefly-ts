import { moduleName } from "../graph/module-naming.js";
/**
 * Graph-visible outbound environment adapters (D130/D132).
 *
 * Async transport work is confined to graph-local EnvironmentDrivers. Each
 * helper returns declared nodes for events/status/attempts/errors instead of a
 * hidden sink side channel.
 */

import type { Ctx } from "../ctx/types.js";
import type {
	DriverCancel,
	WebSocketRequest,
	WebSocketSend,
	WebSocketSessionHandle,
} from "../graph/environment.js";
import type { Graph } from "../graph/graph.js";
import {
	nextRetryDelayMs,
	type RetryPolicy,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
import type { Node, StateNode } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import { runCancel } from "./environment-outbound.js";
import type {
	WebSocketSessionBundle,
	WebSocketSessionCommand,
	WebSocketSessionInbound,
	WebSocketSessionLifecycle,
	WebSocketSessionOptions,
	WebSocketSessionOutbound,
	WebSocketSessionSendPolicy,
	WebSocketSessionStatus,
} from "./environment-types.js";

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
	| { readonly kind: "outbound"; readonly fact: WebSocketSessionOutbound }
	| { readonly kind: "error"; readonly error: unknown; readonly attempt?: number }
	| { readonly kind: "exhausted"; readonly attempt: number; readonly error: unknown };

interface WebSocketSessionState {
	active: boolean;
	connected: boolean;
	cleanupInstalled: boolean;
	currentAttempt: number;
	currentSession: WebSocketSessionHandle | undefined;
	sendCancels: Map<number, DriverCancel>;
	liveSends: Map<number, PendingWebSocketOutbound>;
	pendingOutbound: PendingWebSocketOutbound[];
	timers: Map<number, ReturnType<typeof setTimeout>>;
	seq: number;
	outboundSeq: number;
}

interface PendingWebSocketOutbound {
	readonly seq: number;
	readonly message: WebSocketSend;
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
			liveSends: new Map(),
			pendingOutbound: [],
			timers: new Map(),
			seq: 0,
			outboundSeq: 0,
		};
		ctx.state.set(state);
	}
	state.active = true;
	if (!state.cleanupInstalled) {
		state.cleanupInstalled = true;
		ctx.signal.addEventListener(
			"abort",
			() => {
				const sendCancels = [...state.sendCancels.values()];
				const timers = [...state.timers.values()];
				const session = state.currentSession;
				state.active = false;
				state.cleanupInstalled = false;
				state.connected = false;
				state.currentAttempt = 0;
				state.currentSession = undefined;
				state.sendCancels.clear();
				state.liveSends.clear();
				state.pendingOutbound = [];
				state.timers.clear();
				for (const cancel of sendCancels) runCancel(cancel);
				for (const timer of timers) clearTimeout(timer);
				session?.cancel();
			},
			{ once: true },
		);
	}
	return state;
}

function closeWebSocketSessionState(
	state: WebSocketSessionState,
	driverAction: "cancel" | "none" = "cancel",
): {
	readonly canceled: PendingWebSocketOutbound[];
	readonly session: WebSocketSessionHandle | undefined;
} {
	const session = state.currentSession;
	const timers = [...state.timers.values()];
	const sendCancels = [...state.sendCancels.values()];
	const canceled = [...state.pendingOutbound, ...state.liveSends.values()];
	state.connected = false;
	state.currentAttempt = 0;
	state.currentSession = undefined;
	state.timers.clear();
	state.sendCancels.clear();
	state.pendingOutbound = [];
	state.liveSends.clear();
	for (const timer of timers) clearTimeout(timer);
	for (const cancelSend of sendCancels) runCancel(cancelSend);
	if (driverAction === "cancel") session?.cancel();
	return { canceled, session };
}

function cancelRetryTimers(state: WebSocketSessionState): void {
	for (const timer of state.timers.values()) clearTimeout(timer);
	state.timers.clear();
}

function cleanupWebSocketConnection(
	state: WebSocketSessionState,
	driverAction: "cancel" | "none" = "cancel",
): PendingWebSocketOutbound[] {
	const session = state.currentSession;
	const sendCancels = [...state.sendCancels.values()];
	const canceled = [...state.liveSends.values()];
	state.connected = false;
	state.currentAttempt = 0;
	state.currentSession = undefined;
	state.sendCancels.clear();
	state.liveSends.clear();
	for (const cancelSend of sendCancels) runCancel(cancelSend);
	if (driverAction === "cancel") session?.cancel();
	return canceled;
}

function normalizeWebSocketSessionSendPolicy(
	policy: WebSocketSessionSendPolicy | undefined,
): { readonly kind: "reject" } | { readonly kind: "buffer"; readonly maxPending: number } {
	if (policy?.kind !== "buffer") return { kind: "reject" };
	if (!Number.isFinite(policy.maxPending) || policy.maxPending < 1) {
		throw new Error("webSocketSession: buffer sendPolicy requires finite maxPending >= 1");
	}
	return { kind: "buffer", maxPending: Math.floor(policy.maxPending) };
}

function webSocketSessionEventNode(
	graph: Graph,
	command: Node<WebSocketSessionCommand>,
	request: WebSocketRequest,
	name: string,
	policy: RetryPolicy,
	sendPolicy: ReturnType<typeof normalizeWebSocketSessionSendPolicy>,
): Node<WebSocketSessionEvent> {
	return graph.node<WebSocketSessionEvent>(
		[command],
		(ctx) => {
			const state = initWebSocketSessionState(ctx);
			// The events of this run go out as one array when it returns; driver callbacks and retry
			// timers that fire after the run send theirs as they come.
			const events: WebSocketSessionEvent[] = [];
			let running = true;
			const emitEvent = (event: WebSocketSessionEvent) => {
				if (running) events.push(event);
				else ctx.emit(event);
			};

			const emitOutbound = (fact: WebSocketSessionOutbound) => {
				emitEvent({ kind: "outbound", fact });
			};

			const emitOutboundCanceled = (
				items: readonly PendingWebSocketOutbound[],
				reason: unknown,
			) => {
				for (const item of items) {
					emitOutbound({
						kind: "canceled",
						seq: item.seq,
						message: item.message,
						reason,
					});
				}
			};

			const emitOutboundRejected = (items: readonly PendingWebSocketOutbound[], error: unknown) => {
				const payload = errorPayload(error);
				for (const item of items) {
					emitOutbound({
						kind: "rejected",
						seq: item.seq,
						message: item.message,
						error: payload,
					});
				}
			};

			const retryOrExhaust = (attempt: number, error: unknown) => {
				const payload = errorPayload(error);
				const canceled = cleanupWebSocketConnection(state);
				emitOutboundCanceled(canceled, `${name}: connection cleanup`);
				if (shouldRetry(policy, attempt)) {
					const nextAttempt = attempt + 1;
					const delayMs = nextRetryDelayMs(policy, nextAttempt) ?? 0;
					emitEvent({
						kind: "retry",
						attempt,
						nextAttempt,
						delayMs,
						error: payload,
					});
					const timerId = state.seq++;
					const timer = setTimeout(() => {
						state.timers.delete(timerId);
						if (!state.active) return;
						start(nextAttempt);
					}, delayMs);
					state.timers.set(timerId, timer);
				} else {
					emitOutboundRejected(state.pendingOutbound, payload);
					state.pendingOutbound = [];
					emitEvent({ kind: "exhausted", attempt, error: payload });
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
				emitEvent({
					kind: "attempt",
					attempt,
					maxAttempts: policy.maxAttempts,
				});
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
								emitEvent({ kind: "open", attempt });
								flushPending();
							} else if (ws.kind === "text" || ws.kind === "binary") {
								emitEvent({
									kind: "message",
									message: ws satisfies WebSocketSessionInbound,
								});
							} else if (ws.kind === "close") {
								const normalClose = ws.code === 1000;
								const canceled = cleanupWebSocketConnection(state);
								emitOutboundCanceled(canceled, `${name}: session closed`);
								emitEvent({
									kind: "closed",
									code: ws.code,
									reason: ws.reason,
								});
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

			function sendNow(item: PendingWebSocketOutbound): void {
				if (!state.connected) {
					emitOutbound({
						kind: "rejected",
						seq: item.seq,
						message: item.message,
						error: `${name}: session is not open`,
					});
					emitEvent({
						kind: "error",
						error: `${name}: session is not open`,
					});
					return;
				}
				const session = state.currentSession;
				if (session === undefined) {
					emitOutbound({
						kind: "rejected",
						seq: item.seq,
						message: item.message,
						error: `${name}: missing WebSocket session capability`,
					});
					emitEvent({
						kind: "error",
						error: `${name}: missing WebSocket session capability`,
					});
					return;
				}
				const sendId = state.seq++;
				state.liveSends.set(sendId, item);
				emitOutbound({ kind: "sending", seq: item.seq, message: item.message });
				let done = false;
				let cancel: DriverCancel | undefined;
				try {
					cancel = session.send(item.message, (result) => {
						if (done || !state.active || !state.liveSends.has(sendId)) return;
						done = true;
						state.liveSends.delete(sendId);
						state.sendCancels.delete(sendId);
						if (result.ok) {
							emitOutbound({ kind: "sent", seq: item.seq, message: item.message });
							emitEvent({ kind: "sent", message: item.message });
						} else {
							const payload = errorPayload(result.error);
							emitOutbound({
								kind: "rejected",
								seq: item.seq,
								message: item.message,
								error: payload,
							});
							emitEvent({
								kind: "error",
								error: payload,
							});
						}
					});
				} catch (error) {
					state.liveSends.delete(sendId);
					const payload = errorPayload(error);
					emitOutbound({
						kind: "rejected",
						seq: item.seq,
						message: item.message,
						error: payload,
					});
					emitEvent({ kind: "error", error: payload });
					return;
				}
				if (cancel !== undefined && !done && state.active && state.liveSends.has(sendId)) {
					state.sendCancels.set(sendId, cancel);
				} else if (cancel !== undefined && !state.active) runCancel(cancel);
			}

			function flushPending(): void {
				const pending = state.pendingOutbound;
				state.pendingOutbound = [];
				for (let index = 0; index < pending.length; index++) {
					const item = pending[index];
					if (!state.connected || state.currentSession === undefined) {
						emitOutboundCanceled(pending.slice(index), `${name}: session closed`);
						return;
					}
					sendNow(item);
				}
			}

			const send = (message: WebSocketSend) => {
				const item = { seq: state.outboundSeq++, message } satisfies PendingWebSocketOutbound;
				if (state.connected) {
					sendNow(item);
					return;
				}
				if (sendPolicy.kind === "buffer") {
					if (state.pendingOutbound.length >= sendPolicy.maxPending) {
						emitOutbound({
							kind: "rejected",
							seq: item.seq,
							message,
							error: `${name}: outbound buffer full`,
						});
						emitEvent({
							kind: "error",
							error: `${name}: outbound buffer full`,
						});
						return;
					}
					state.pendingOutbound.push(item);
					emitOutbound({ kind: "queued", seq: item.seq, message });
					return;
				}
				emitOutbound({
					kind: "rejected",
					seq: item.seq,
					message,
					error: `${name}: session is not open`,
				});
				emitEvent({
					kind: "error",
					error: `${name}: session is not open`,
				});
			};

			try {
				for (const raw of ctx.deps[0].waves.flat()) {
					const commandValue = raw as WebSocketSessionCommand;
					if (commandValue.kind === "start") start(1);
					else if (commandValue.kind === "send") send(commandValue.message);
					else {
						cancelRetryTimers(state);
						emitEvent({
							kind: "closing",
							code: commandValue.code,
							reason: commandValue.reason,
						});
						const { canceled, session } = closeWebSocketSessionState(state, "none");
						emitOutboundCanceled(canceled, `${name}: session closed`);
						session?.close(commandValue.code, commandValue.reason);
						emitEvent({
							kind: "closed",
							code: commandValue.code,
							reason: commandValue.reason,
						});
					}
				}
			} finally {
				running = false;
			}
			ctx.down(events.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/events`, factory: "webSocketSessionEvents" },
	);
}

function webSocketSessionNodes(
	graph: Graph,
	command: StateNode<WebSocketSessionCommand>,
	events: Node<WebSocketSessionEvent>,
	name: string,
	policy: RetryPolicy,
): WebSocketSessionBundle {
	const inbound = graph.node<WebSocketSessionInbound>(
		[events],
		(ctx) => {
			const values: WebSocketSessionInbound[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "message") values.push(event.message);
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/inbound`, factory: "webSocketSessionInbound" },
	);
	const lifecycle = graph.node<WebSocketSessionLifecycle>(
		[events],
		(ctx) => {
			const values: WebSocketSessionLifecycle[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "attempt") {
					values.push({
						kind: "starting",
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
					});
				} else if (event.kind === "open") {
					values.push({ kind: "open", attempt: event.attempt });
				} else if (event.kind === "sent") {
					values.push({ kind: "sent", message: event.message });
				} else if (event.kind === "closing" || event.kind === "closed") {
					values.push(event);
				} else if (event.kind === "retry") {
					values.push({
						kind: "retrying",
						attempt: event.attempt,
						nextAttempt: event.nextAttempt,
						delayMs: event.delayMs,
						error: event.error,
					});
				} else if (event.kind === "exhausted") {
					values.push(event);
				}
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/lifecycle`, factory: "webSocketSessionLifecycle" },
	);
	const outbound = graph.node<WebSocketSessionOutbound>(
		[events],
		(ctx) => {
			const values: WebSocketSessionOutbound[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "outbound") values.push(event.fact);
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/outbound`, factory: "webSocketSessionOutbound" },
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
			for (const raw of ctx.deps[0].waves.flat()) {
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
			const values: unknown[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as WebSocketSessionEvent;
				if ("error" in event) values.push(event.error);
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/errors`, factory: "webSocketSessionErrors" },
	);
	const attempts = graph.node<number>(
		[events],
		(ctx) => {
			const values: number[] = [];
			for (const raw of ctx.deps[0].waves.flat()) {
				const event = raw as WebSocketSessionEvent;
				if (event.kind === "attempt") values.push(event.attempt);
			}
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		{ name: `${name}/attempts`, factory: "webSocketSessionAttempts" },
	);
	return {
		command,
		inbound,
		lifecycle,
		outbound,
		status,
		errors,
		attempts,
		start: () => command.set({ kind: "start" }),
		send: (message) =>
			command.set({
				kind: "send",
				message:
					typeof message === "string" || message instanceof Uint8Array
						? { data: message }
						: message,
			}),
		close: (code, reason) => command.set({ kind: "close", code, reason }),
	};
}

/**
 * Create a graph-visible D133 WebSocket SessionBundle.
 *
 * The convenience start/send/close methods publish command facts only; hidden
 * session state is driven by the command node and graph-local EnvironmentDrivers.
 * @param graph - Graph that owns the created nodes or projector.
 * @param request - Request value to lower, route, or record.
 * @param opts - Options that configure the helper.
 * @returns A `WebSocketSessionBundle` value.
 * @category adapters
 * @example
 * ```ts
 * import { webSocketSession } from "@graphrefly/ts/adapters";
 * ```
 */
export function webSocketSession(
	graph: Graph,
	request: WebSocketRequest,
	opts: WebSocketSessionOptions = {},
): WebSocketSessionBundle {
	const name = moduleName(graph, opts.name, "webSocketSession");
	const policy = opts.retry ?? retryPolicy();
	const sendPolicy = normalizeWebSocketSessionSendPolicy(opts.sendPolicy);
	const command = graph.node<WebSocketSessionCommand>([], null, {
		name: `${name}/command`,
		factory: "webSocketSessionCommand",
	});
	const events = webSocketSessionEventNode(graph, command, request, name, policy, sendPolicy);
	return webSocketSessionNodes(graph, command, events, name, policy);
}
