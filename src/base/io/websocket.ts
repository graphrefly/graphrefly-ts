/**
 * WebSocket IO — `fromWebSocket` (DOM-style `WebSocketLike` source / register
 * variant), `toWebSocket` (sink with optional ack-tracking + retry),
 * `fromWebSocketReconnect` (`fromWebSocket` wrapped in retry-on-disconnect with
 * exponential backoff).
 */

import { COMPLETE, ERROR, type Message, type Node, node } from "@graphrefly/pure-ts/core";
import { retry } from "../../utils/resilience/index.js";
import { type ExtraOpts, sourceOpts } from "./_internal.js";
import { type ReactiveSinkHandle, reactiveSink, type SinkTransportError } from "./_sink.js";

/** WebSocket-like transport accepted by {@link fromWebSocket} / {@link toWebSocket}. */
export type WebSocketLike = {
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: "message" | "error" | "close", listener: (ev: unknown) => void): void;
	removeEventListener(type: "message" | "error" | "close", listener: (ev: unknown) => void): void;
};

export type WebSocketMessageEventLike = { data: unknown };
export type WebSocketRegister<T> = (
	emit: (payload: T) => void,
	error: (err: unknown) => void,
	complete: () => void,
) => () => void;

/**
 * Wraps a WebSocket as a GraphReFly producer source.
 *
 * Incoming socket messages are emitted as `DATA`; socket `error` emits `ERROR`; socket `close`
 * emits `COMPLETE`. Teardown detaches listeners and optionally closes the socket.
 *
 * @category extra
 */
export function fromWebSocket<T = unknown>(
	socket: WebSocketLike,
	opts?: ExtraOpts & {
		parse?: (payload: unknown, event: unknown) => T;
		closeOnTeardown?: boolean;
	},
): Node<T>;
export function fromWebSocket<T = unknown>(
	register: WebSocketRegister<T>,
	opts?: ExtraOpts & {
		parse?: (payload: unknown, event: unknown) => T;
		closeOnTeardown?: boolean;
	},
): Node<T>;
export function fromWebSocket<T = unknown>(
	socketOrRegister: WebSocketLike | WebSocketRegister<T>,
	opts?: ExtraOpts & {
		parse?: (payload: unknown, event: unknown) => T;
		closeOnTeardown?: boolean;
	},
): Node<T> {
	const { parse, closeOnTeardown = false, ...rest } = opts ?? {};
	return node<T>(
		[],
		(_data, a) => {
			let active = true;
			let cleanup: (() => void) | undefined;
			const runCleanup = () => {
				const fn = cleanup;
				cleanup = undefined;
				fn?.();
			};
			const terminate = (message: Message) => {
				if (!active) return;
				active = false;
				a.down([message]);
				runCleanup();
			};
			const emit = (raw: unknown, event: unknown = raw) => {
				if (!active) return;
				try {
					const payload =
						raw !== null && typeof raw === "object" && "data" in (raw as Record<string, unknown>)
							? (raw as WebSocketMessageEventLike).data
							: raw;
					const parsed = parse ? parse(payload, event) : (payload as T);
					a.emit(parsed);
				} catch (err) {
					terminate([ERROR, err]);
				}
			};
			const error = (err: unknown) => {
				terminate([ERROR, err]);
			};
			const complete = () => {
				terminate([COMPLETE]);
			};
			if (typeof socketOrRegister === "function") {
				try {
					cleanup = socketOrRegister(emit, error, complete);
					if (typeof cleanup !== "function") {
						throw new Error(
							"fromWebSocket register contract violation: register must return cleanup callable",
						);
					}
				} catch (err) {
					terminate([ERROR, err]);
				}
				return () => {
					active = false;
					runCleanup();
				};
			}

			const ws = socketOrRegister;
			const onMessage = (event: unknown) => emit(event, event);
			const onError = (event: unknown) => error(event);
			const onClose = () => complete();
			ws.addEventListener("message", onMessage);
			ws.addEventListener("error", onError);
			ws.addEventListener("close", onClose);
			cleanup = () => {
				ws.removeEventListener("message", onMessage);
				ws.removeEventListener("error", onError);
				ws.removeEventListener("close", onClose);
				if (closeOnTeardown) ws.close();
			};
			return () => {
				active = false;
				runCleanup();
			};
		},
		sourceOpts(rest),
	);
}

/** Options for {@link toWebSocket}. */
export type ToWebSocketOptions<T> = {
	/** Serialize DATA payloads before `socket.send(...)`. */
	serialize?: (value: T) => string | ArrayBufferLike | Blob | ArrayBufferView;
	/** Close socket when upstream emits COMPLETE. Default: `true`. */
	closeOnComplete?: boolean;
	/** Close socket when upstream emits ERROR. Default: `true`. */
	closeOnError?: boolean;
	/** Optional close code used when close is triggered by terminal tuples. */
	closeCode?: number;
	/** Optional close reason used when close is triggered by terminal tuples. */
	closeReason?: string;
	/** Structured callback — uses the unified {@link SinkTransportError} shape. */
	onTransportError?: (event: SinkTransportError) => void;
	/** Retry configuration — passed through to {@link reactiveSink}. */
	retry?: ReactiveSinkHandle<T> extends infer _
		? Parameters<typeof reactiveSink<T>>[1]["retry"]
		: never;
	/** Backpressure configuration — passed through to {@link reactiveSink}. */
	backpressure?: Parameters<typeof reactiveSink<T>>[1]["backpressure"];
	/** Reactive stop signal — when it emits any DATA / terminal, the sink tears down. */
	stopOn?: Node<unknown>;
};

/**
 * Forwards upstream `DATA` payloads to a WebSocket via `send`.
 *
 * Returns a {@link ReactiveSinkHandle} — every transport outcome (including
 * socket `close` events) surfaces on the `errors` / `failed` / `sent` /
 * `inFlight` companions.
 *
 * @category extra
 */
export function toWebSocket<T>(
	source: Node<T>,
	socket: WebSocketLike,
	opts?: ToWebSocketOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		serialize = (value: T) => {
			if (
				typeof value === "string" ||
				value instanceof Blob ||
				value instanceof ArrayBuffer ||
				ArrayBuffer.isView(value)
			) {
				return value as string | ArrayBufferLike | Blob | ArrayBufferView;
			}
			try {
				return JSON.stringify(value);
			} catch {
				return String(value);
			}
		},
		closeOnComplete = true,
		closeOnError = true,
		closeCode,
		closeReason,
		onTransportError,
		retry: retryOpt,
		backpressure,
		stopOn,
	} = opts ?? {};

	let socketClosed = false;
	const closeSocket = (trigger?: Message) => {
		if (socketClosed) return;
		socketClosed = true;
		try {
			socket.close(closeCode, closeReason);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			try {
				onTransportError?.({ stage: "close", error, value: undefined, message: trigger });
			} catch {
				/* user hook must not escape */
			}
		}
	};

	// External close listener — installed before sink construction so we can
	// pass its cleanup via reactiveSink's `onDispose` hook. That hook fires on
	// any teardown path (user `.dispose()`, `stopOn` signal, upstream
	// terminal) — guaranteeing the listener is removed even when the reactive
	// sink's internal dispose fires without going through a wrapper.
	let externalCloseHandler: ((ev: unknown) => void) | null = null;
	const removeExternalCloseHandler = () => {
		if (externalCloseHandler) {
			try {
				socket.removeEventListener("close", externalCloseHandler);
			} catch {
				/* removeEventListener may throw on some environments when socket is dead */
			}
			externalCloseHandler = null;
		}
	};

	const handle = reactiveSink<T>(source, {
		onTransportError,
		serialize: (value) => {
			const s = serialize(value);
			if (s === undefined) {
				throw new Error("serialize returned undefined");
			}
			return s;
		},
		retry: retryOpt,
		backpressure,
		stopOn,
		onDispose: removeExternalCloseHandler,
		send: (payload) => {
			socket.send(payload as string | ArrayBufferLike | Blob | ArrayBufferView);
		},
		onUpstreamMessage: (msg) => {
			if (msg[0] === COMPLETE && closeOnComplete) closeSocket(msg);
			else if (msg[0] === ERROR && closeOnError) closeSocket(msg);
		},
	});

	// Listen for external socket `close` events to tear the sink down.
	externalCloseHandler = () => {
		socketClosed = true;
		handle.dispose();
	};
	socket.addEventListener("close", externalCloseHandler);
	return handle;
}

/** Options for {@link fromWebSocketReconnect}. */
export type FromWebSocketReconnectOptions<T> = ExtraOpts & {
	/** Optional parser applied to incoming messages. */
	parse?: (payload: unknown, event: unknown) => T;
	/** Max reconnect attempts. Default: `Infinity` (implied when `backoff` is set). */
	maxRetries?: number;
	/** Backoff strategy (ns) or preset name. Default: `"exponential"`. */
	backoff?: Parameters<typeof retry>[1] extends infer O
		? O extends { backoff?: infer B }
			? B
			: never
		: never;
	/** Close the socket on teardown. Default: `true`. */
	closeOnTeardown?: boolean;
};

/**
 * Reconnecting WebSocket source — each connection attempt calls `factory` to
 * obtain a fresh {@link WebSocketLike}; on `close` (treated as terminal
 * `COMPLETE`), {@link retry} rebuilds the inner source and reconnects.
 *
 * For transient errors, {@link retry} retries with the configured
 * backoff. On `maxRetries` exhaustion, terminal `ERROR` propagates.
 *
 * @param factory - Invoked per reconnect to create a fresh WebSocket.
 * @param opts - Parse, retry, and close options.
 *
 * @example
 * ```ts
 * import { fromWebSocketReconnect } from "@graphrefly/graphrefly-ts";
 * const ws$ = fromWebSocketReconnect(
 *   () => new WebSocket("wss://example/stream"),
 *   { backoff: "exponential", maxRetries: 10 },
 * );
 * ```
 *
 * @category extra
 */
export function fromWebSocketReconnect<T = unknown>(
	factory: () => WebSocketLike,
	opts?: FromWebSocketReconnectOptions<T>,
): Node<T> {
	const {
		parse,
		maxRetries,
		backoff = "exponential",
		closeOnTeardown = true,
		...rest
	} = opts ?? {};
	return retry<T>(
		() =>
			fromWebSocket<T>(factory(), {
				parse,
				closeOnTeardown,
				...rest,
			}),
		{ count: maxRetries, backoff },
	).node;
}
