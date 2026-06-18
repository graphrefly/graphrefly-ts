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
	HttpResponse,
	ProcessResult,
	WebSocketRequest,
	WebSocketSendResult,
} from "../graph/environment.js";
import type { Graph } from "../graph/graph.js";
import { nextRetryDelayMs, retryPolicy, shouldRetry } from "../graph/resilience.js";
import type { Node } from "../node/node.js";
import { errorPayload } from "../protocol/messages.js";
import type {
	HttpRequestOf,
	OutboundAdapterOptions,
	OutboundBundle,
	OutboundEvent,
	OutboundStatus,
	ProcessCommandOf,
	WebSocketSendOf,
} from "./environment-types.js";

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

export function runCancel(cancel: DriverCancel): void {
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
