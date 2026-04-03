// ---------------------------------------------------------------------------
// NestJS Gateway helpers — reactive bridges from graph.observe() to transports.
// ---------------------------------------------------------------------------
// All helpers are push-based: they subscribe to `graph.observe()` with actor
// context and forward DATA messages to the transport. No polling.
//
// Actor-scoped observation respects node guards (Phase 1.5). Clients only
// see DATA values from nodes their Actor is allowed to observe.
// ---------------------------------------------------------------------------

import type { Actor } from "../../core/actor.js";
import { COMPLETE, DATA, ERROR, type Messages, TEARDOWN } from "../../core/messages.js";
import type { Graph, GraphObserveOne } from "../../graph/graph.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Client-to-server commands for the WebSocket observe protocol.
 */
export type ObserveWsCommand =
	| { type: "subscribe"; path: string }
	| { type: "unsubscribe"; path: string };

/**
 * Server-to-client messages for the WebSocket observe protocol.
 */
export type ObserveWsMessage<T = unknown> =
	| { type: "data"; path: string; value: T }
	| { type: "error"; path: string; error: string }
	| { type: "complete"; path: string }
	| { type: "subscribed"; path: string }
	| { type: "unsubscribed"; path: string }
	| { type: "err"; message: string };

// ---------------------------------------------------------------------------
// observeSSE — graph.observe() → SSE ReadableStream
// ---------------------------------------------------------------------------

export type ObserveSSEOptions = {
	actor?: Actor;
	serialize?: (value: unknown) => string;
	keepAliveMs?: number;
	signal?: AbortSignal;
};

/**
 * Creates an SSE `ReadableStream` that streams DATA values from a graph node.
 *
 * Routes through `graph.observe(path, { actor })` so node guards are respected.
 * The stream emits `event: data` for DATA, `event: error` for ERROR, and
 * `event: complete` for COMPLETE (then closes). TEARDOWN also closes the stream.
 *
 * @param graph - The graph to observe.
 * @param path - Qualified node path to observe.
 * @param opts - Actor context, serialization, keep-alive.
 * @returns A `ReadableStream<Uint8Array>` suitable for NestJS SSE endpoints.
 *
 * @example
 * ```ts
 * @Sse("events/:path")
 * streamEvents(@Param("path") path: string, @Req() req: Request) {
 *   return observeSSE(this.graph, path, { actor: getActor(req) });
 * }
 * ```
 */
export function observeSSE(
	graph: Graph,
	path: string,
	opts?: ObserveSSEOptions,
): ReadableStream<Uint8Array> {
	const { actor, serialize = defaultSerialize, keepAliveMs, signal } = opts ?? {};
	const encoder = new TextEncoder();
	let stop: (() => void) | undefined;

	return new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			let keepAlive: ReturnType<typeof setInterval> | undefined;
			let unsub: () => void = () => {};
			const close = () => {
				if (closed) return;
				closed = true;
				if (keepAlive !== undefined) clearInterval(keepAlive);
				signal?.removeEventListener("abort", onAbort);
				unsub();
				controller.close();
			};
			stop = close;
			const write = (event: string, data?: string) => {
				if (closed) return;
				controller.enqueue(encoder.encode(sseFrame(event, data)));
			};
			const onAbort = () => close();

			const handle = graph.observe(path, { actor }) as unknown as GraphObserveOne;
			unsub = handle.subscribe((msgs: Messages) => {
				for (const msg of msgs) {
					const t = msg[0];
					if (t === DATA) {
						write("data", serialize(msg[1]));
					} else if (t === ERROR) {
						write("error", serialize(msg[1]));
						close();
						return;
					} else if (t === COMPLETE || t === TEARDOWN) {
						if (t === COMPLETE) write("complete");
						close();
						return;
					}
					// DIRTY, RESOLVED, and other protocol internals are not exposed to SSE clients
				}
			});

			if (keepAliveMs !== undefined && keepAliveMs > 0) {
				keepAlive = setInterval(() => {
					if (closed) return;
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				}, keepAliveMs);
			}
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
		},
		cancel() {
			// Guard against double-close (cancel may fire after COMPLETE/ERROR already closed).
			try {
				stop?.();
			} catch {
				/* already closed */
			}
		},
	});
}

// ---------------------------------------------------------------------------
// observeSubscription — graph.observe() → AsyncIterableIterator (GraphQL)
// ---------------------------------------------------------------------------

export type ObserveSubscriptionOptions<T = unknown> = {
	actor?: Actor;
	filter?: (value: T) => boolean;
};

/**
 * Creates an `AsyncIterableIterator` that yields DATA values from a graph node.
 *
 * Designed for GraphQL subscription resolvers (Apollo, Mercurius, etc.).
 * Routes through `graph.observe(path, { actor })` for guard-scoped access.
 *
 * The iterator completes on COMPLETE/TEARDOWN and throws on ERROR.
 *
 * @param graph - The graph to observe.
 * @param path - Qualified node path to observe.
 * @param opts - Actor context, optional value filter.
 * @returns An async iterable that yields DATA payloads.
 *
 * @example
 * ```ts
 * // Apollo-style resolver
 * Subscription: {
 *   orderStatus: {
 *     subscribe: (_parent, args, ctx) =>
 *       observeSubscription(ctx.graph, `orders::${args.id}::status`, {
 *         actor: ctx.actor,
 *       }),
 *   },
 * }
 * ```
 */
export function observeSubscription<T = unknown>(
	graph: Graph,
	path: string,
	opts?: ObserveSubscriptionOptions<T>,
): AsyncIterableIterator<T> {
	const { actor, filter } = opts ?? {};

	type QueueItem = { done: false; value: T } | { done: true; value?: undefined; error?: Error };

	const queue: QueueItem[] = [];
	const waiters: Array<{
		resolve: (result: IteratorResult<T>) => void;
		reject: (err: unknown) => void;
	}> = [];
	let disposed = false;

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		unsub();
	};

	const push = (item: QueueItem) => {
		if (disposed) return;
		if (waiters.length > 0) {
			const w = waiters.shift()!;
			if (item.done && item.error) w.reject(item.error);
			else if (item.done) w.resolve({ done: true, value: undefined });
			else w.resolve({ done: false, value: item.value as T });
		} else {
			queue.push(item);
		}
	};

	const handle = graph.observe(path, { actor }) as unknown as GraphObserveOne;
	const unsub = handle.subscribe((msgs: Messages) => {
		for (const msg of msgs) {
			const t = msg[0];
			if (t === DATA) {
				const value = msg[1] as T;
				if (filter && !filter(value)) continue;
				push({ done: false, value });
			} else if (t === ERROR) {
				const err = msg[1] instanceof Error ? msg[1] : new Error(String(msg[1]));
				push({ done: true, error: err });
				dispose();
				return;
			} else if (t === COMPLETE || t === TEARDOWN) {
				push({ done: true });
				dispose();
				return;
			}
		}
	});

	const iterator: AsyncIterableIterator<T> = {
		next(): Promise<IteratorResult<T>> {
			if (queue.length > 0) {
				const item = queue.shift()!;
				if (item.done && item.error) return Promise.reject(item.error);
				return Promise.resolve(
					item.done ? { done: true, value: undefined } : { done: false, value: item.value as T },
				);
			}
			if (disposed) return Promise.resolve({ done: true, value: undefined });
			return new Promise<IteratorResult<T>>((resolve, reject) => {
				waiters.push({ resolve, reject });
			});
		},
		return(): Promise<IteratorReturnResult<undefined>> {
			dispose();
			// Resolve any pending waiters
			for (const w of waiters) w.resolve({ done: true, value: undefined });
			waiters.length = 0;
			return Promise.resolve({ done: true, value: undefined });
		},
		throw(err: unknown): Promise<IteratorResult<T>> {
			dispose();
			return Promise.reject(err);
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};

	return iterator;
}

// ---------------------------------------------------------------------------
// ObserveGateway — graph.observe() → WebSocket (multi-path subscription)
// ---------------------------------------------------------------------------

export type ObserveGatewayOptions = {
	extractActor?: (client: unknown) => Actor | undefined;
	parse?: (data: string) => ObserveWsCommand;
};

/**
 * Manages per-client WebSocket subscriptions to graph nodes via `observe()`.
 *
 * Not a NestJS decorator or base class — a standalone helper that can be
 * wired into any WebSocket gateway. Each client can subscribe/unsubscribe
 * to individual node paths. Actor-scoped observation respects node guards.
 *
 * @example
 * ```ts
 * @WebSocketGateway()
 * export class GraphGateway {
 *   private gw = new ObserveGateway(this.graph);
 *
 *   constructor(@InjectGraph() private graph: Graph) {}
 *
 *   handleConnection(client: WebSocket) {
 *     this.gw.handleConnection(client);
 *   }
 *
 *   handleDisconnect(client: WebSocket) {
 *     this.gw.handleDisconnect(client);
 *   }
 *
 *   @SubscribeMessage("observe")
 *   onObserve(client: WebSocket, data: unknown) {
 *     this.gw.handleMessage(client, data);
 *   }
 * }
 * ```
 */
export class ObserveGateway {
	private readonly clients = new Map<unknown, Map<string, () => void>>();
	private readonly extractActor: (client: unknown) => Actor | undefined;
	private readonly parse: (data: string) => ObserveWsCommand;

	constructor(
		private readonly graph: Graph,
		opts?: ObserveGatewayOptions,
	) {
		this.extractActor = opts?.extractActor ?? (() => undefined);
		this.parse = opts?.parse ?? defaultParseCommand;
	}

	/**
	 * Register a new client. Call from `handleConnection`.
	 */
	handleConnection(client: unknown): void {
		if (!this.clients.has(client)) {
			this.clients.set(client, new Map());
		}
	}

	/**
	 * Unregister a client and dispose all its subscriptions. Call from `handleDisconnect`.
	 */
	handleDisconnect(client: unknown): void {
		const subs = this.clients.get(client);
		if (!subs) return;
		for (const unsub of subs.values()) unsub();
		this.clients.delete(client);
	}

	/**
	 * Handle an incoming client message (subscribe/unsubscribe command).
	 *
	 * @param client - The WebSocket client reference.
	 * @param raw - Raw message data (string or parsed object).
	 * @param send - Function to send a message back to the client.
	 *   Defaults to `client.send(JSON.stringify(msg))`.
	 */
	handleMessage(client: unknown, raw: unknown, send?: (msg: ObserveWsMessage) => void): void {
		const sender = send ?? defaultSend.bind(null, client);
		let cmd: ObserveWsCommand;
		try {
			cmd = typeof raw === "string" ? this.parse(raw) : (raw as ObserveWsCommand);
		} catch {
			sender({ type: "err", message: "invalid command" });
			return;
		}

		if (cmd.type === "subscribe") {
			this.subscribe(client, cmd.path, sender);
		} else if (cmd.type === "unsubscribe") {
			this.unsubscribe(client, cmd.path, sender);
		} else {
			sender({ type: "err", message: `unknown command type: ${(cmd as { type: string }).type}` });
		}
	}

	/**
	 * Number of active subscriptions for a client. Useful for tests.
	 */
	subscriptionCount(client: unknown): number {
		return this.clients.get(client)?.size ?? 0;
	}

	/**
	 * Dispose all clients and subscriptions.
	 */
	destroy(): void {
		for (const [client] of this.clients) {
			this.handleDisconnect(client);
		}
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private subscribe(client: unknown, path: string, send: (msg: ObserveWsMessage) => void): void {
		let subs = this.clients.get(client);
		if (!subs) {
			subs = new Map();
			this.clients.set(client, subs);
		}
		if (subs.has(path)) {
			send({ type: "subscribed", path });
			return;
		}

		const actor = this.extractActor(client);
		let handle: GraphObserveOne;
		try {
			handle = this.graph.observe(path, { actor }) as unknown as GraphObserveOne;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			send({ type: "err", message });
			return;
		}

		const cleanup = () => {
			unsub();
			subs!.delete(path);
		};

		const unsub = handle.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				const t = msg[0];
				if (t === DATA) {
					trySend(send, { type: "data", path, value: msg[1] });
				} else if (t === ERROR) {
					const errMsg = msg[1] instanceof Error ? msg[1].message : String(msg[1]);
					trySend(send, { type: "error", path, error: errMsg });
					cleanup();
					return;
				} else if (t === COMPLETE || t === TEARDOWN) {
					trySend(send, { type: "complete", path });
					cleanup();
					return;
				}
				// DIRTY, RESOLVED not exposed to WS clients
			}
		});

		subs.set(path, unsub);
		send({ type: "subscribed", path });
	}

	private unsubscribe(client: unknown, path: string, send: (msg: ObserveWsMessage) => void): void {
		const subs = this.clients.get(client);
		const unsub = subs?.get(path);
		if (unsub) {
			unsub();
			subs!.delete(path);
		}
		send({ type: "unsubscribed", path });
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSerialize(value: unknown): string {
	if (value instanceof Error) return value.message;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function sseFrame(event: string, data?: string): string {
	let frame = `event: ${event}\n`;
	if (data !== undefined) {
		for (const line of data.split("\n")) {
			frame += `data: ${line}\n`;
		}
	}
	frame += "\n";
	return frame;
}

function defaultParseCommand(data: string): ObserveWsCommand {
	return JSON.parse(data) as ObserveWsCommand;
}

function defaultSend(client: unknown, msg: ObserveWsMessage): void {
	try {
		(client as { send: (data: string) => void }).send(JSON.stringify(msg));
	} catch {
		/* client may have disconnected — swallow transport errors */
	}
}

function trySend(send: (msg: ObserveWsMessage) => void, msg: ObserveWsMessage): void {
	try {
		send(msg);
	} catch {
		/* transport error — client may have disconnected */
	}
}
