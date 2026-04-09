/**
 * Protocol, system, and ingest adapters (roadmap §5.2, §5.2c).
 *
 * Each adapter wraps an external protocol or system as a reactive {@link Node}
 * built on {@link producer} / {@link node} — no second protocol.
 *
 * **Moved from sources.ts:** fromHTTP, fromWebSocket/toWebSocket, fromWebhook,
 * toSSE, fromMCP, fromGitHook.
 *
 * **New (5.2c):** fromOTel, fromSyslog, fromStatsD, fromPrometheus,
 * fromKafka/toKafka, fromRedisStream/toRedisStream, fromCSV, fromNDJSON,
 * fromClickHouseWatch, fromPulsar/toPulsar, fromNATS/toNATS,
 * fromRabbitMQ/toRabbitMQ.
 */

import { batch } from "../core/batch.js";
import { wallClockNs } from "../core/clock.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	isLocalOnly,
	type Message,
	messageTier,
	RESOLVED,
	TEARDOWN,
} from "../core/messages.js";
import { type Node, type NodeActions, type NodeOptions, node } from "../core/node.js";
import { producer, state } from "../core/sugar.js";
import { NS_PER_MS, NS_PER_SEC } from "./backoff.js";
import { type WithStatusBundle, withStatus } from "./resilience.js";
import type { AsyncSourceOpts } from "./sources.js";
import { globToRegExp, matchesAnyPattern } from "./sources.js";

/** Structured callback for sink transport failures (Kafka, Redis, etc.). */
export type SinkTransportError = {
	stage: "serialize" | "send" | "routing_key";
	error: Error;
	value: unknown;
};

/** Handle returned by per-record and buffered sinks. */
export type SinkHandle = {
	/** Stop the sink (unsubscribe from source). */
	dispose: () => void;
	/** Reactive node that emits the latest transport error (or `null`). */
	errors: Node<SinkTransportError | null>;
	/** Manually drain the internal buffer (buffered sinks only). */
	flush?: () => Promise<void>;
};

/**
 * Internal helper — creates a `state` node for transport errors and a handler
 * that writes to it.  If the user supplied their own `onTransportError`, it is
 * called first; the error is always forwarded to the companion node.
 */
function createSinkErrorHandler(userHandler?: (err: SinkTransportError) => void): {
	errorsNode: Node<SinkTransportError | null>;
	handler: (err: SinkTransportError) => void;
} {
	const errorsNode = state<SinkTransportError | null>(null);
	const handler = (err: SinkTransportError): void => {
		userHandler?.(err);
		try {
			errorsNode.down([[DATA, err]]);
		} catch {
			/* emitting error state during batch drain may re-enter; swallow */
		}
	};
	return { errorsNode, handler };
}

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function sourceOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "producer", ...opts };
}

// ——————————————————————————————————————————————————————————————
//  WebSocket adapter (from sources.ts)
// ——————————————————————————————————————————————————————————————

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
	return producer<T>((_d, a) => {
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
	}, sourceOpts(rest));
}

// ——————————————————————————————————————————————————————————————
//  Webhook adapter (from sources.ts)
// ——————————————————————————————————————————————————————————————

/** Registration callback for {@link fromWebhook}. */
export type WebhookRegister<T> = (handlers: {
	/** Push one webhook payload downstream as `[[DATA, payload]]`. */
	emit: (payload: T) => void;
	/** Push terminal error as `[[ERROR, err]]`. */
	error: (err: unknown) => void;
	/** Push terminal completion as `[[COMPLETE]]`. */
	complete: () => void;
}) => (() => void) | undefined;

/**
 * Bridges HTTP webhook callbacks into a GraphReFly source.
 *
 * The `register` callback wires your runtime/framework callback to GraphReFly and may return a
 * cleanup function. This keeps the adapter runtime-agnostic while following the same producer
 * pattern as {@link fromEvent}.
 *
 * @param register - Registers webhook handlers (`emit`, `error`, `complete`) and optionally returns cleanup.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — webhook payloads as `DATA`; teardown runs returned cleanup.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { fromWebhook } from "@graphrefly/graphrefly-ts";
 *
 * type HookPayload = { event: string; data: unknown };
 * const app = express();
 * app.use(express.json());
 *
 * const hook$ = fromWebhook<HookPayload>(({ emit, error }) => {
 *   const handler = (req: express.Request, res: express.Response) => {
 *     try {
 *       emit(req.body as HookPayload);
 *       res.status(200).send("ok");
 *     } catch (e) {
 *       error(e);
 *       res.status(500).send("error");
 *     }
 *   };
 *   app.post("/webhook", handler);
 *   return () => {
 *     // Express has no direct route-removal API in common use.
 *   };
 * });
 * ```
 *
 * @example Fastify
 * ```ts
 * import Fastify from "fastify";
 * import { fromWebhook } from "@graphrefly/graphrefly-ts";
 *
 * const fastify = Fastify();
 * const hook$ = fromWebhook<any>(({ emit, error }) => {
 *   const handler = async (req: any, reply: any) => {
 *     try {
 *       emit(req.body);
 *       reply.code(200).send({ ok: true });
 *     } catch (e) {
 *       error(e);
 *       reply.code(500).send({ ok: false });
 *     }
 *   };
 *   fastify.post("/webhook", handler);
 *   return () => {};
 * });
 * ```
 *
 * @category extra
 */
export function fromWebhook<T = unknown>(register: WebhookRegister<T>, opts?: ExtraOpts): Node<T> {
	return producer<T>((_d, a) => {
		let active = true;
		const emit = (payload: T) => {
			if (!active) return;
			a.emit(payload);
		};
		const error = (err: unknown) => {
			if (!active) return;
			active = false;
			a.down([[ERROR, err]]);
		};
		const complete = () => {
			if (!active) return;
			active = false;
			a.down([[COMPLETE]]);
		};

		try {
			const cleanup = register({ emit, error, complete });
			return () => {
				active = false;
				cleanup?.();
			};
		} catch (err) {
			error(err);
			return () => {
				active = false;
			};
		}
	}, sourceOpts(opts));
}

// ——————————————————————————————————————————————————————————————
//  HTTP adapter (from sources.ts)
// ——————————————————————————————————————————————————————————————

/**
 * Options for {@link fromHTTP}.
 *
 * @category extra
 */
export interface FromHTTPOptions extends AsyncSourceOpts {
	/** HTTP method. Default: `"GET"`. */
	method?: string;
	/** Request headers. */
	headers?: Record<string, string>;
	/** Request body (for POST/PUT/PATCH). */
	body?: any;
	/** Transform the Response before emitting. Default: `response.json()`. */
	transform?: (response: Response) => any | Promise<any>;
	/** Request timeout in **nanoseconds**. Default: `30s` (30 * NS_PER_SEC). */
	timeoutNs?: number;
}

/**
 * Result of {@link fromHTTP}: main source plus status, error, and fetch count companions.
 *
 * @category extra
 */
export type HTTPBundle<T> = WithStatusBundle<T> & {
	/** Number of successful fetches. */
	fetchCount: Node<number>;
	/** Nanosecond wall-clock timestamp of the last successful fetch. */
	lastUpdated: Node<number>;
};

/**
 * Creates a one-shot fetch-based HTTP source with lifecycle tracking.
 *
 * @category extra
 */
export function fromHTTP<T = any>(url: string, opts?: FromHTTPOptions): HTTPBundle<T> {
	const {
		method = "GET",
		headers,
		body: bodyOpt,
		transform = (r: Response) => r.json(),
		timeoutNs = 30 * NS_PER_SEC,
		signal: externalSignal,
		...rest
	} = opts ?? {};

	const fetchCount = state(0, { name: `${rest.name ?? "http"}/fetchCount` });
	const lastUpdated = state(0, { name: `${rest.name ?? "http"}/lastUpdated` });

	const sourceNode = producer<T>((_d, a) => {
		let active = true;
		const abort = new AbortController();

		if (externalSignal?.aborted) {
			a.down([[ERROR, externalSignal.reason ?? new Error("Aborted")]]);
			return () => {};
		}
		externalSignal?.addEventListener("abort", () => abort.abort(externalSignal.reason), {
			once: true,
		});

		const timeoutId = setTimeout(
			() => abort.abort(new Error("Request timeout")),
			Math.ceil(timeoutNs / NS_PER_MS),
		);

		const body =
			bodyOpt !== undefined
				? typeof bodyOpt === "string"
					? bodyOpt
					: JSON.stringify(bodyOpt)
				: undefined;

		fetch(url, { method, headers, body, signal: abort.signal })
			.then(async (res) => {
				clearTimeout(timeoutId);
				if (!active) return;

				if (!res.ok) {
					throw new Error(`HTTP ${res.status}: ${res.statusText}`);
				}

				const data = await transform(res);
				if (!active) return;

				batch(() => {
					fetchCount.down([[DATA, (fetchCount.get() ?? 0) + 1]]);
					lastUpdated.down([[DATA, wallClockNs()]]);
					a.emit(data as T);
				});
				a.down([[COMPLETE]]);
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				if (!active) return;
				if (err.name === "AbortError") return;
				a.down([[ERROR, err]]);
			});

		return () => {
			active = false;
			abort.abort();
		};
	}, sourceOpts(rest));

	const tracked = withStatus(sourceNode);

	return {
		...tracked,
		fetchCount,
		lastUpdated,
	};
}

// ——————————————————————————————————————————————————————————————
//  SSE sink (from sources.ts)
// ——————————————————————————————————————————————————————————————

/** Options for {@link toSSE}. */
export type ToSSEOptions = {
	/** Custom payload serializer for non-string payloads. Default: `JSON.stringify` fallback to `String(value)`. */
	serialize?: (value: unknown) => string;
	/** Event name for DATA tuples. Default: `"data"`. */
	dataEvent?: string;
	/** Event name for ERROR tuples. Default: `"error"`. */
	errorEvent?: string;
	/** Event name for COMPLETE tuples. Default: `"complete"`. */
	completeEvent?: string;
	/** Emit `event: resolved` when RESOLVED arrives. Default: `false`. */
	includeResolved?: boolean;
	/** Emit `event: dirty` when DIRTY arrives. Default: `false`. */
	includeDirty?: boolean;
	/** Add SSE comment keepalive frames (`: keepalive`) on an interval. Disabled when unset. */
	keepAliveMs?: number;
	/** Optional abort signal to terminate the stream early. */
	signal?: AbortSignal;
	/** Maps custom message types to SSE event names. */
	eventNameResolver?: (type: symbol) => string;
};

function messageTypeLabel(t: symbol): string {
	return Symbol.keyFor(t) ?? t.description ?? "message";
}

function serializeSseData(value: unknown, serialize: (value: unknown) => string): string {
	if (typeof value === "string") return value;
	return serialize(value);
}

function sseFrame(event: string, data?: string): string {
	let out = `event: ${event}\n`;
	if (data !== undefined) {
		const lines = data.split(/\r?\n/);
		for (const line of lines) {
			out += `data: ${line}\n`;
		}
	}
	return `${out}\n`;
}

/**
 * Creates a standard Server-Sent Events stream from node messages.
 *
 * @category extra
 */
export function toSSE<T>(source: Node<T>, opts?: ToSSEOptions): ReadableStream<Uint8Array> {
	const {
		serialize = (value: unknown) => {
			if (value instanceof Error) return value.message;
			try {
				return JSON.stringify(value);
			} catch {
				return String(value);
			}
		},
		dataEvent = "data",
		errorEvent = "error",
		completeEvent = "complete",
		includeResolved = false,
		includeDirty = false,
		keepAliveMs,
		signal,
		eventNameResolver = messageTypeLabel,
	} = opts ?? {};
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
			const onAbort = () => {
				if (closed) return;
				close();
			};
			unsub = source.subscribe((msgs) => {
				for (const msg of msgs) {
					const t = msg[0];
					// Skip graph-local signals (tier < 3: START, DIRTY, INVALIDATE,
					// PAUSE, RESUME). DIRTY is opt-in for observability.
					if (isLocalOnly(t)) {
						if (t === DIRTY && includeDirty) {
							/* fall through to write */
						} else continue;
					}
					if (t === DATA) {
						write(dataEvent, serializeSseData(msg[1], serialize));
						continue;
					}
					if (t === ERROR) {
						write(errorEvent, serializeSseData(msg[1], serialize));
						close();
						return;
					}
					if (t === COMPLETE) {
						write(completeEvent);
						close();
						return;
					}
					// RESOLVED (tier 3) is opt-in for observability.
					if (!includeResolved && t === RESOLVED) continue;
					write(
						eventNameResolver(t),
						msg.length > 1 ? serializeSseData(msg[1], serialize) : undefined,
					);
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
			stop?.();
		},
	});
}

// ——————————————————————————————————————————————————————————————
//  WebSocket sink (from sources.ts)
// ——————————————————————————————————————————————————————————————

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
	/** Structured callback for serialize/send/close transport failures. */
	onTransportError?: (event: ToWebSocketTransportError) => void;
};

export type ToWebSocketTransportError = {
	stage: "serialize" | "send" | "close";
	error: Error;
	message: Message | undefined;
};

/**
 * Forwards upstream `DATA` payloads to a WebSocket via `send`.
 *
 * @category extra
 */
export function toWebSocket<T>(
	source: Node<T>,
	socket: WebSocketLike,
	opts?: ToWebSocketOptions<T>,
): () => void {
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
	} = opts ?? {};
	let closed = false;
	const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));
	const reportTransportError = (
		stage: "serialize" | "send" | "close",
		error: unknown,
		message: Message | undefined,
	) => {
		if (!onTransportError) return;
		try {
			onTransportError({ stage, error: toError(error), message });
		} catch {
			/* user-provided hook should not throw into graph path */
		}
	};
	const closeSocket = (message: Message) => {
		if (closed) return;
		closed = true;
		try {
			socket.close(closeCode, closeReason);
		} catch (err) {
			reportTransportError("close", err, message);
		}
	};

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				let serialized: string | ArrayBufferLike | Blob | ArrayBufferView;
				try {
					serialized = serialize(msg[1] as T);
				} catch (err) {
					reportTransportError("serialize", err, msg);
					return true;
				}
				try {
					socket.send(serialized === undefined ? String(msg[1] as T) : serialized);
				} catch (err) {
					reportTransportError("send", err, msg);
					return true;
				}
				return true;
			}
			if (msg[0] === COMPLETE && closeOnComplete) {
				closeSocket(msg);
				return true;
			}
			if (msg[0] === ERROR && closeOnError) {
				closeSocket(msg);
				return true;
			}
			return false;
		},
	});
	return inner.subscribe(() => {});
}

// ——————————————————————————————————————————————————————————————
//  MCP adapter (from sources.ts)
// ——————————————————————————————————————————————————————————————

/**
 * Duck-typed MCP (Model Context Protocol) client — only the notification
 * registration surface is required so callers are not coupled to a specific SDK.
 */
export type MCPClientLike = {
	setNotificationHandler(method: string, handler: (notification: unknown) => void): void;
};

/** Options for {@link fromMCP}. */
export type FromMCPOptions = ExtraOpts & {
	/** MCP notification method to subscribe to. Default `"notifications/message"`. */
	method?: string;
	onDisconnect?: (cb: (err?: unknown) => void) => void;
};

/**
 * Wraps an MCP client's server-push notifications as a reactive source.
 *
 * @category extra
 */
export function fromMCP<T = unknown>(client: MCPClientLike, opts?: FromMCPOptions): Node<T> {
	const { method = "notifications/message", onDisconnect, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		let active = true;
		client.setNotificationHandler(method, (notification) => {
			if (!active) return;
			a.emit(notification as T);
		});
		if (onDisconnect) {
			onDisconnect((err?: unknown) => {
				if (!active) return;
				active = false;
				a.down([[ERROR, err ?? new Error("MCP client disconnected")]]);
			});
		}
		return () => {
			active = false;
			client.setNotificationHandler(method, () => {});
		};
	}, sourceOpts(rest));
}

// ——————————————————————————————————————————————————————————————
//  Git adapter (from sources.ts)
// ——————————————————————————————————————————————————————————————

/** Git hook type for {@link fromGitHook}. */
export type GitHookType = "post-commit" | "post-merge" | "post-checkout" | "post-rewrite";

/** Structured git event emitted by {@link fromGitHook}. */
export type GitEvent = {
	hook: GitHookType;
	commit: string;
	files: string[];
	message: string;
	author: string;
	timestamp_ns: number;
};

/** Options for {@link fromGitHook}. */
export type FromGitHookOptions = ExtraOpts & {
	pollMs?: number;
	include?: string[];
	exclude?: string[];
};

// globToRegExp, matchesAnyPattern imported from ./sources.js

/**
 * Git change detection as a reactive source.
 *
 * @category extra
 */
export function fromGitHook(repoPath: string, opts?: FromGitHookOptions): Node<GitEvent> {
	const { pollMs = 5000, include, exclude, ...rest } = opts ?? {};
	const includePatterns = include?.map(globToRegExp) ?? [];
	const excludePatterns = exclude?.map(globToRegExp) ?? [];

	return producer<GitEvent>((_d, a) => {
		let active = true;
		let lastSeen: string;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const { execFileSync } = require("node:child_process") as typeof import("node:child_process");

		const git = (...args: string[]): string => {
			try {
				return execFileSync("git", args, { cwd: repoPath, encoding: "utf-8" }).trim();
			} catch (err) {
				if (!active) return "";
				a.down([[ERROR, err]]);
				cleanup();
				return "";
			}
		};

		const cleanup = () => {
			active = false;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};

		lastSeen = git("rev-parse", "HEAD");
		if (!active) return () => {};

		const schedule = () => {
			if (!active) return;
			timer = setTimeout(check, pollMs);
		};

		const check = () => {
			if (!active) return;
			const head = git("rev-parse", "HEAD");
			if (!active || !head || head === lastSeen) {
				schedule();
				return;
			}

			let files = git("diff", "--name-only", `${lastSeen}..${head}`).split("\n").filter(Boolean);
			if (!active) {
				schedule();
				return;
			}

			if (includePatterns.length > 0) {
				files = files.filter((f) => matchesAnyPattern(f, includePatterns));
			}
			if (excludePatterns.length > 0) {
				files = files.filter((f) => !matchesAnyPattern(f, excludePatterns));
			}

			const message = git("log", "-1", "--format=%s", head);
			if (!active) {
				schedule();
				return;
			}
			const author = git("log", "-1", "--format=%an", head);
			if (!active) {
				schedule();
				return;
			}

			a.emit({
				hook: "post-commit" as GitHookType,
				commit: head,
				files,
				message,
				author,
				timestamp_ns: wallClockNs(),
			});
			lastSeen = head;
			schedule();
		};

		schedule();
		return cleanup;
	}, sourceOpts(rest));
}

// ——————————————————————————————————————————————————————————————
//  5.2c — Ingest adapters (universal source layer)
// ——————————————————————————————————————————————————————————————

// ——— Shared helpers ———

/** Standard handler triple for adapters that accept injected registrations. */
export type AdapterHandlers<T> = {
	emit: (payload: T) => void;
	error: (err: unknown) => void;
	complete: () => void;
};

// ——— OpenTelemetry (OTLP/HTTP) ———

/** Structured OTel span. */
export type OTelSpan = {
	traceId: string;
	spanId: string;
	operationName: string;
	serviceName: string;
	startTimeNs: number;
	endTimeNs: number;
	status: "OK" | "ERROR" | "UNSET";
	attributes: Record<string, unknown>;
	events: Array<{ name: string; timestampNs: number; attributes?: Record<string, unknown> }>;
};

/** Structured OTel metric data point. */
export type OTelMetric = {
	name: string;
	description?: string;
	unit?: string;
	type: "gauge" | "sum" | "histogram" | "summary";
	value: number;
	attributes: Record<string, unknown>;
	timestampNs: number;
};

/** Structured OTel log record. */
export type OTelLog = {
	timestampNs: number;
	severityNumber?: number;
	severityText?: string;
	body: unknown;
	attributes: Record<string, unknown>;
	traceId?: string;
	spanId?: string;
};

/** Registration callback for the OTLP/HTTP receiver. */
export type OTelRegister = (handlers: {
	onTraces: (spans: OTelSpan[]) => void;
	onMetrics: (metrics: OTelMetric[]) => void;
	onLogs: (logs: OTelLog[]) => void;
	onError: (err: unknown) => void;
}) => (() => void) | undefined;

/** Options for {@link fromOTel}. */
export type FromOTelOptions = ExtraOpts & {};

/** Bundle returned by {@link fromOTel}. */
export type OTelBundle = {
	traces: Node<OTelSpan>;
	metrics: Node<OTelMetric>;
	logs: Node<OTelLog>;
};

/**
 * OTLP/HTTP receiver — accepts traces, metrics, and logs as separate reactive nodes.
 *
 * The caller owns the HTTP server. `fromOTel` receives a `register` callback that
 * wires OTLP POST endpoints to the three signal handlers. Each signal type gets
 * its own `Node` so downstream can subscribe selectively.
 *
 * @param register - Wires OTLP HTTP routes to `onTraces`, `onMetrics`, `onLogs` handlers.
 * @param opts - Optional producer options.
 * @returns {@link OTelBundle} — `{ traces, metrics, logs }` nodes.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { fromOTel } from "@graphrefly/graphrefly-ts";
 *
 * const app = express();
 * app.use(express.json());
 *
 * const otel = fromOTel(({ onTraces, onMetrics, onLogs }) => {
 *   app.post("/v1/traces", (req, res) => { onTraces(req.body.resourceSpans ?? []); res.sendStatus(200); });
 *   app.post("/v1/metrics", (req, res) => { onMetrics(req.body.resourceMetrics ?? []); res.sendStatus(200); });
 *   app.post("/v1/logs", (req, res) => { onLogs(req.body.resourceLogs ?? []); res.sendStatus(200); });
 *   return () => {};
 * });
 * ```
 *
 * @category extra
 */
export function fromOTel(register: OTelRegister, opts?: FromOTelOptions): OTelBundle {
	let registerCleanup: (() => void) | undefined;
	let active = true;
	let teardownCount = 0;

	const teardownOne = () => {
		teardownCount++;
		if (teardownCount >= 3 && registerCleanup) {
			registerCleanup();
			registerCleanup = undefined;
		}
	};

	const traces = producer<OTelSpan>(
		(_d, _a) => () => {
			active = false;
			teardownOne();
		},
		sourceOpts(opts),
	);
	const metrics = producer<OTelMetric>(
		(_d, _a) => () => {
			active = false;
			teardownOne();
		},
		sourceOpts(opts),
	);
	const logs = producer<OTelLog>(
		(_d, _a) => () => {
			active = false;
			teardownOne();
		},
		sourceOpts(opts),
	);

	// Wire registration — each handler batch-emits into the corresponding node.
	registerCleanup =
		register({
			onTraces: (spans) => {
				if (!active) return;
				batch(() => {
					for (const span of spans) traces.down([[DATA, span]]);
				});
			},
			onMetrics: (ms) => {
				if (!active) return;
				batch(() => {
					for (const m of ms) metrics.down([[DATA, m]]);
				});
			},
			onLogs: (ls) => {
				if (!active) return;
				batch(() => {
					for (const l of ls) logs.down([[DATA, l]]);
				});
			},
			onError: (err) => {
				if (!active) return;
				active = false;
				traces.down([[ERROR, err]]);
				metrics.down([[ERROR, err]]);
				logs.down([[ERROR, err]]);
			},
		}) ?? undefined;

	return { traces, metrics, logs };
}

// ——— Syslog (RFC 5424) ———

/** Parsed syslog message (RFC 5424). */
export type SyslogMessage = {
	facility: number;
	severity: number;
	timestamp: string;
	hostname: string;
	appName: string;
	procId: string;
	msgId: string;
	message: string;
	timestampNs: number;
};

/** Registration callback for syslog receiver. */
export type SyslogRegister = (handlers: AdapterHandlers<SyslogMessage>) => (() => void) | undefined;

/** Options for {@link fromSyslog}. */
export type FromSyslogOptions = ExtraOpts & {};

/**
 * RFC 5424 syslog receiver as a reactive source.
 *
 * The caller owns the UDP/TCP socket. `fromSyslog` receives a `register` callback
 * that wires socket data events to the `emit` handler with parsed syslog messages.
 *
 * @param register - Wires socket to emit/error/complete handlers.
 * @param opts - Optional producer options.
 * @returns `Node<SyslogMessage>` — one `DATA` per syslog message.
 *
 * @example
 * ```ts
 * import dgram from "node:dgram";
 * import { fromSyslog, parseSyslog } from "@graphrefly/graphrefly-ts";
 *
 * const server = dgram.createSocket("udp4");
 * const syslog$ = fromSyslog(({ emit, error }) => {
 *   server.on("message", (buf) => {
 *     try { emit(parseSyslog(buf.toString())); }
 *     catch (e) { error(e); }
 *   });
 *   server.bind(514);
 *   return () => server.close();
 * });
 * ```
 *
 * @category extra
 */
export function fromSyslog(
	register: SyslogRegister,
	opts?: FromSyslogOptions,
): Node<SyslogMessage> {
	return fromWebhook<SyslogMessage>(register as WebhookRegister<SyslogMessage>, opts);
}

/**
 * Parses a raw RFC 5424 syslog line into a structured {@link SyslogMessage}.
 *
 * Format: `<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID MSG`
 *
 * @category extra
 */
export function parseSyslog(raw: string): SyslogMessage {
	const match = raw.match(/^<(\d{1,3})>\d?\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)/s);
	if (!match) {
		const nowNs = wallClockNs();
		return {
			facility: 1,
			severity: 6,
			timestamp: new Date(Math.floor(nowNs / 1_000_000)).toISOString(),
			hostname: "-",
			appName: "-",
			procId: "-",
			msgId: "-",
			message: raw.trim(),
			timestampNs: nowNs,
		};
	}
	const pri = Number(match[1]);
	return {
		facility: pri >> 3,
		severity: pri & 7,
		timestamp: match[2],
		hostname: match[3],
		appName: match[4],
		procId: match[5],
		msgId: match[6],
		message: (match[7] ?? "").trim(),
		timestampNs: wallClockNs(),
	};
}

// ——— StatsD / DogStatsD ———

/** Parsed StatsD metric. */
export type StatsDMetric = {
	name: string;
	value: number;
	type: "counter" | "gauge" | "timer" | "histogram" | "set" | "distribution";
	sampleRate?: number;
	tags: Record<string, string>;
	timestampNs: number;
};

/** Registration callback for StatsD receiver. */
export type StatsDRegister = (handlers: AdapterHandlers<StatsDMetric>) => (() => void) | undefined;

/** Options for {@link fromStatsD}. */
export type FromStatsDOptions = ExtraOpts & {};

/**
 * StatsD/DogStatsD UDP receiver as a reactive source.
 *
 * The caller owns the UDP socket. `fromStatsD` receives a `register` callback
 * that wires datagrams to the `emit` handler with parsed metrics.
 *
 * @param register - Wires socket to emit/error/complete handlers.
 * @param opts - Optional producer options.
 * @returns `Node<StatsDMetric>` — one `DATA` per metric line.
 *
 * @example
 * ```ts
 * import dgram from "node:dgram";
 * import { fromStatsD, parseStatsD } from "@graphrefly/graphrefly-ts";
 *
 * const server = dgram.createSocket("udp4");
 * const stats$ = fromStatsD(({ emit, error }) => {
 *   server.on("message", (buf) => {
 *     for (const line of buf.toString().split("\\n")) {
 *       if (line.trim()) {
 *         try { emit(parseStatsD(line)); }
 *         catch (e) { error(e); }
 *       }
 *     }
 *   });
 *   server.bind(8125);
 *   return () => server.close();
 * });
 * ```
 *
 * @category extra
 */
export function fromStatsD(register: StatsDRegister, opts?: FromStatsDOptions): Node<StatsDMetric> {
	return fromWebhook<StatsDMetric>(register as WebhookRegister<StatsDMetric>, opts);
}

const STATSD_TYPES: Record<string, StatsDMetric["type"]> = {
	c: "counter",
	g: "gauge",
	ms: "timer",
	h: "histogram",
	s: "set",
	d: "distribution",
};

/**
 * Parses a raw StatsD/DogStatsD line into a structured {@link StatsDMetric}.
 *
 * Format: `metric.name:value|type|@sampleRate|#tag1:val1,tag2:val2`
 *
 * @category extra
 */
export function parseStatsD(line: string): StatsDMetric {
	const parts = line.split("|");
	const [name, valueStr] = (parts[0] ?? "").split(":");
	if (!name || valueStr === undefined) {
		throw new Error(`Invalid StatsD line: ${line}`);
	}
	const typeCode = parts[1]?.trim() ?? "c";
	const type = STATSD_TYPES[typeCode] ?? "counter";
	// Set type uses string identifiers (e.g. unique user IDs), not numeric values.
	const value = type === "set" ? 0 : Number(valueStr);

	let sampleRate: number | undefined;
	const tags: Record<string, string> = {};

	for (let i = 2; i < parts.length; i++) {
		const part = parts[i].trim();
		if (part.startsWith("@")) {
			sampleRate = Number(part.slice(1));
		} else if (part.startsWith("#")) {
			for (const tag of part.slice(1).split(",")) {
				const [k, v] = tag.split(":");
				if (k) tags[k] = v ?? "";
			}
		}
	}

	return { name: name.trim(), value, type, sampleRate, tags, timestampNs: wallClockNs() };
}

// ——— Prometheus scrape ———

/** Parsed Prometheus metric. */
export type PrometheusMetric = {
	name: string;
	labels: Record<string, string>;
	value: number;
	timestampMs?: number;
	type?: "counter" | "gauge" | "histogram" | "summary" | "untyped";
	help?: string;
	timestampNs: number;
};

/** Options for {@link fromPrometheus}. */
export type FromPrometheusOptions = AsyncSourceOpts & {
	/** Scrape interval in nanoseconds. Default `15 * NS_PER_SEC` (15s). */
	intervalNs?: number;
	/** Request headers for the scrape. */
	headers?: Record<string, string>;
	/** Request timeout in nanoseconds. Default `10 * NS_PER_SEC` (10s). */
	timeoutNs?: number;
};

/**
 * Scrapes a Prometheus `/metrics` endpoint on a reactive timer interval.
 *
 * Each scrape parses the exposition format and emits one `DATA` per metric line.
 * Uses `fromTimer` semantics internally (reactive timer source, not polling).
 *
 * @param endpoint - URL of the Prometheus metrics endpoint.
 * @param opts - Scrape interval, headers, timeout.
 * @returns `Node<PrometheusMetric>` — one `DATA` per metric per scrape.
 *
 * @example
 * ```ts
 * import { fromPrometheus } from "@graphrefly/graphrefly-ts";
 *
 * const prom$ = fromPrometheus("http://localhost:9090/metrics", { intervalNs: 30 * NS_PER_SEC });
 * ```
 *
 * @category extra
 */
export function fromPrometheus(
	endpoint: string,
	opts?: FromPrometheusOptions,
): Node<PrometheusMetric> {
	const {
		intervalNs = 15 * NS_PER_SEC,
		headers,
		timeoutNs = 10 * NS_PER_SEC,
		signal: externalSignal,
		...rest
	} = opts ?? {};
	const intervalMs = Math.ceil(intervalNs / NS_PER_MS);

	return producer<PrometheusMetric>((_d, a) => {
		let active = true;
		let running = false;
		let timer: ReturnType<typeof setInterval> | undefined;

		const cleanup = () => {
			active = false;
			if (timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		};

		const scrape = async () => {
			if (!active || running) return;
			running = true;
			const abort = new AbortController();
			const timeoutId = setTimeout(
				() => abort.abort(new Error("Scrape timeout")),
				Math.ceil(timeoutNs / NS_PER_MS),
			);

			try {
				const res = await fetch(endpoint, {
					headers: { Accept: "text/plain", ...headers },
					signal: abort.signal,
				});
				clearTimeout(timeoutId);
				if (!active) return;
				if (!res.ok) throw new Error(`Prometheus scrape ${res.status}: ${res.statusText}`);

				const text = await res.text();
				if (!active) return;

				const metrics = parsePrometheusText(text);
				for (const m of metrics) a.emit(m);
			} catch (err) {
				clearTimeout(timeoutId);
				if (!active) return;
				if (err instanceof Error && err.name === "AbortError") return;
				cleanup();
				a.down([[ERROR, err]]);
			} finally {
				running = false;
			}
		};

		const onAbort = () => {
			if (!active) return;
			cleanup();
			a.down([[ERROR, externalSignal?.reason ?? new Error("Aborted")]]);
		};

		if (externalSignal?.aborted) {
			onAbort();
			return () => {};
		}
		externalSignal?.addEventListener("abort", onAbort, { once: true });

		// Initial scrape + periodic.
		void scrape();
		timer = setInterval(() => void scrape(), intervalMs);

		return () => {
			cleanup();
			externalSignal?.removeEventListener("abort", onAbort);
		};
	}, sourceOpts(rest));
}

/**
 * Parses Prometheus exposition format text into structured metrics.
 *
 * @category extra
 */
export function parsePrometheusText(text: string): PrometheusMetric[] {
	const results: PrometheusMetric[] = [];
	const types = new Map<string, string>();
	const helps = new Map<string, string>();

	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line.startsWith("# TYPE ")) {
			const rest = line.slice(7);
			const spaceIdx = rest.indexOf(" ");
			if (spaceIdx > 0) {
				types.set(rest.slice(0, spaceIdx), rest.slice(spaceIdx + 1).trim());
			}
			continue;
		}
		if (line.startsWith("# HELP ")) {
			const rest = line.slice(7);
			const spaceIdx = rest.indexOf(" ");
			if (spaceIdx > 0) {
				helps.set(rest.slice(0, spaceIdx), rest.slice(spaceIdx + 1).trim());
			}
			continue;
		}
		if (line.startsWith("#")) continue;

		// metric_name{label="value"} 123 timestamp?
		let name: string;
		let labels: Record<string, string> = {};
		let valueStr: string;
		let tsStr: string | undefined;

		const braceIdx = line.indexOf("{");
		if (braceIdx >= 0) {
			name = line.slice(0, braceIdx);
			const closeBrace = line.indexOf("}", braceIdx);
			if (closeBrace < 0) continue;
			const labelStr = line.slice(braceIdx + 1, closeBrace);
			labels = parsePrometheusLabels(labelStr);
			const after = line
				.slice(closeBrace + 1)
				.trim()
				.split(/\s+/);
			valueStr = after[0] ?? "";
			tsStr = after[1];
		} else {
			const parts = line.split(/\s+/);
			name = parts[0] ?? "";
			valueStr = parts[1] ?? "";
			tsStr = parts[2];
		}

		if (!name || !valueStr) continue;

		const baseName = name.replace(/(_total|_count|_sum|_bucket|_created|_info)$/, "");
		results.push({
			name,
			labels,
			value: Number(valueStr),
			timestampMs: tsStr ? Number(tsStr) : undefined,
			type: (types.get(baseName) ?? types.get(name)) as PrometheusMetric["type"],
			help: helps.get(baseName) ?? helps.get(name),
			timestampNs: wallClockNs(),
		});
	}

	return results;
}

function parsePrometheusLabels(str: string): Record<string, string> {
	const labels: Record<string, string> = {};
	const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
	let m: RegExpExecArray | null = re.exec(str);
	while (m !== null) {
		labels[m[1]] = m[2].replace(/\\(.)/g, "$1");
		m = re.exec(str);
	}
	return labels;
}

// ——— Kafka ———

/** Duck-typed Kafka consumer (compatible with kafkajs, confluent-kafka, Pulsar KoP). */
export type KafkaConsumerLike = {
	subscribe(opts: { topic: string; fromBeginning?: boolean }): Promise<void>;
	run(opts: {
		eachMessage: (payload: {
			topic: string;
			partition: number;
			message: {
				key: Buffer | null;
				value: Buffer | null;
				headers?: Record<string, Buffer | string | undefined>;
				offset: string;
				timestamp: string;
			};
		}) => Promise<void>;
	}): Promise<void>;
	disconnect(): Promise<void>;
};

/** Duck-typed Kafka producer. */
export type KafkaProducerLike = {
	send(record: {
		topic: string;
		messages: Array<{
			key?: string | Buffer | null;
			value: string | Buffer | null;
			headers?: Record<string, string | Buffer>;
		}>;
	}): Promise<void>;
	disconnect(): Promise<void>;
};

/** Structured Kafka message. */
export type KafkaMessage<T = unknown> = {
	topic: string;
	partition: number;
	key: string | null;
	value: T;
	headers: Record<string, string>;
	offset: string;
	timestamp: string;
	timestampNs: number;
};

/** Options for {@link fromKafka}. */
export type FromKafkaOptions = ExtraOpts & {
	/** Start from beginning of topic. Default: `false`. */
	fromBeginning?: boolean;
	/** Deserialize message value. Default: `JSON.parse(buffer.toString())`. */
	deserialize?: (value: Buffer | null) => unknown;
};

/**
 * Kafka consumer as a reactive source.
 *
 * Wraps a KafkaJS-compatible consumer. Each message becomes a `DATA` emission.
 * Compatible with Pulsar via KoP (Kafka-on-Pulsar).
 *
 * @param consumer - KafkaJS-compatible consumer instance (caller owns connect/disconnect lifecycle).
 * @param topic - Topic to consume from.
 * @param opts - Deserialization and source options.
 * @returns `Node<KafkaMessage<T>>` — one `DATA` per Kafka message.
 *
 * @example
 * ```ts
 * import { Kafka } from "kafkajs";
 * import { fromKafka } from "@graphrefly/graphrefly-ts";
 *
 * const kafka = new Kafka({ brokers: ["localhost:9092"] });
 * const consumer = kafka.consumer({ groupId: "my-group" });
 * await consumer.connect();
 *
 * const events$ = fromKafka(consumer, "events", { deserialize: (buf) => JSON.parse(buf!.toString()) });
 * ```
 *
 * @category extra
 */
export function fromKafka<T = unknown>(
	consumer: KafkaConsumerLike,
	topic: string,
	opts?: FromKafkaOptions,
): Node<KafkaMessage<T>> {
	const {
		fromBeginning = false,
		deserialize = (buf: Buffer | null) => {
			if (buf === null) return null;
			try {
				return JSON.parse(buf.toString());
			} catch {
				return buf.toString();
			}
		},
		...rest
	} = opts ?? {};

	return producer<KafkaMessage<T>>((_d, a) => {
		let active = true;

		const start = async () => {
			try {
				await consumer.subscribe({ topic, fromBeginning });
				await consumer.run({
					eachMessage: async ({ topic: t, partition, message: msg }) => {
						if (!active) return;
						const headers: Record<string, string> = {};
						if (msg.headers) {
							for (const [k, v] of Object.entries(msg.headers)) {
								if (v !== undefined) headers[k] = typeof v === "string" ? v : v.toString();
							}
						}
						a.emit({
							topic: t,
							partition,
							key: msg.key?.toString() ?? null,
							value: deserialize(msg.value) as T,
							headers,
							offset: msg.offset,
							timestamp: msg.timestamp,
							timestampNs: wallClockNs(),
						});
					},
				});
			} catch (err) {
				if (active) a.down([[ERROR, err]]);
			}
		};

		void start();

		return () => {
			active = false;
		};
	}, sourceOpts(rest));
}

/** Options for {@link toKafka}. */
export type ToKafkaOptions<T> = ExtraOpts & {
	/** Serialize value for Kafka. Default: `JSON.stringify`. */
	serialize?: (value: T) => string | Buffer;
	/** Extract message key from value. Default: `null` (no key). */
	keyExtractor?: (value: T) => string | null;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Kafka producer sink — forwards upstream `DATA` to a Kafka topic.
 *
 * @param source - Upstream node to forward.
 * @param kafkaProducer - KafkaJS-compatible producer instance.
 * @param topic - Target topic.
 * @param opts - Serialization and key extraction options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toKafka<T>(
	source: Node<T>,
	kafkaProducer: KafkaProducerLike,
	topic: string,
	opts?: ToKafkaOptions<T>,
): SinkHandle {
	const {
		serialize = (v: T) => JSON.stringify(v),
		keyExtractor,
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				const key = keyExtractor?.(value) ?? null;
				let serialized: string | Buffer;
				try {
					serialized = serialize(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				void kafkaProducer
					.send({
						topic,
						messages: [{ key, value: Buffer.from(serialized as string) }],
					})
					.catch((err: unknown) => {
						handler({
							stage: "send",
							error: err instanceof Error ? err : new Error(String(err)),
							value,
						});
					});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— Redis Streams ———

/** Duck-typed Redis client (compatible with ioredis, redis). */
export type RedisClientLike = {
	xadd(key: string, id: string, ...fieldsAndValues: string[]): Promise<string>;
	xread(
		...args: Array<string | number>
	): Promise<Array<[string, Array<[string, string[]]>]> | null>;
	disconnect(): void;
};

/** Structured Redis Stream entry. */
export type RedisStreamEntry<T = unknown> = {
	id: string;
	key: string;
	data: T;
	timestampNs: number;
};

/** Options for {@link fromRedisStream}. */
export type FromRedisStreamOptions = ExtraOpts & {
	/** Block timeout in ms for XREAD. Default: `5000`. */
	blockMs?: number;
	/** Start ID. Default: `"$"` (new entries only). */
	startId?: string;
	/** Parse raw Redis hash fields to structured data. Default: parses `data` field as JSON. */
	parse?: (fields: string[]) => unknown;
};

/**
 * Redis Streams consumer as a reactive source.
 *
 * Uses XREAD with BLOCK to reactively consume stream entries.
 *
 * @param client - ioredis/redis-compatible client (caller owns connection).
 * @param key - Redis stream key.
 * @param opts - Block timeout, start ID, and parsing options.
 * @returns `Node<RedisStreamEntry<T>>` — one `DATA` per stream entry.
 *
 * @remarks
 * **COMPLETE:** This source never emits `COMPLETE` under normal operation — it
 * is a long-lived stream consumer that runs until teardown or error, same as
 * Kafka consumers. If you need a bounded read, wrap with `take()` or
 * `takeUntil()`.
 *
 * **Client lifecycle:** The caller owns the Redis client connection. The adapter
 * does not call `disconnect()` on teardown — the caller is responsible for
 * closing the connection (same contract as `fromKafka`).
 *
 * @category extra
 */
export function fromRedisStream<T = unknown>(
	client: RedisClientLike,
	key: string,
	opts?: FromRedisStreamOptions,
): Node<RedisStreamEntry<T>> {
	const {
		blockMs = 5000,
		startId = "$",
		parse = (fields: string[]) => {
			// Redis returns flat [field, value, field, value, ...] arrays.
			for (let i = 0; i < fields.length; i += 2) {
				if (fields[i] === "data") {
					try {
						return JSON.parse(fields[i + 1]);
					} catch {
						return fields[i + 1];
					}
				}
			}
			// Return as object if no "data" field.
			const obj: Record<string, string> = {};
			for (let i = 0; i < fields.length; i += 2) {
				obj[fields[i]] = fields[i + 1];
			}
			return obj;
		},
		...rest
	} = opts ?? {};

	return producer<RedisStreamEntry<T>>((_d, a) => {
		let active = true;
		let lastId = startId;

		const poll = async () => {
			while (active) {
				try {
					const result = await client.xread("BLOCK", blockMs, "STREAMS", key, lastId);
					if (!active) return;
					if (result) {
						for (const [_streamKey, entries] of result) {
							for (const [id, fields] of entries) {
								lastId = id;
								a.emit({
									id,
									key,
									data: parse(fields) as T,
									timestampNs: wallClockNs(),
								});
							}
						}
					}
				} catch (err) {
					if (!active) return;
					a.down([[ERROR, err]]);
					return;
				}
			}
		};

		void poll();

		return () => {
			active = false;
		};
	}, sourceOpts(rest));
}

/** Options for {@link toRedisStream}. */
export type ToRedisStreamOptions<T> = ExtraOpts & {
	/** Serialize value to Redis hash fields. Default: `["data", JSON.stringify(value)]`. */
	serialize?: (value: T) => string[];
	/** Max stream length (MAXLEN ~). Default: no trimming. */
	maxLen?: number;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Redis Streams producer sink — forwards upstream `DATA` to a Redis stream.
 *
 * @param source - Upstream node to forward.
 * @param client - ioredis/redis-compatible client.
 * @param key - Redis stream key.
 * @param opts - Serialization options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toRedisStream<T>(
	source: Node<T>,
	client: RedisClientLike,
	key: string,
	opts?: ToRedisStreamOptions<T>,
): SinkHandle {
	const {
		serialize = (v: T) => ["data", JSON.stringify(v)],
		maxLen,
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let fields: string[];
				try {
					fields = serialize(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				const send =
					maxLen !== undefined
						? client.xadd(key, "MAXLEN", "~", String(maxLen), "*", ...fields)
						: client.xadd(key, "*", ...fields);
				void send.catch((err: unknown) => {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
				});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— CSV ingest ———

/** Parsed CSV row. */
export type CSVRow = Record<string, string>;

/** Options for {@link fromCSV}. */
export type FromCSVOptions = ExtraOpts & {
	/** Column delimiter. Default: `","`. */
	delimiter?: string;
	/** Whether the first row is a header. Default: `true`. */
	hasHeader?: boolean;
	/** Explicit column names (overrides header row). */
	columns?: string[];
	/** Custom line parser (e.g. wrapping a library like `csv-parse`). Overrides built-in parser + delimiter. */
	parseLine?: (line: string) => string[];
};

/**
 * CSV file/stream ingest for batch replay.
 *
 * Reads a CSV from a `ReadableStream<string>` or an `AsyncIterable<string>` of lines,
 * emitting one `DATA` per row. `COMPLETE` after all rows are emitted.
 *
 * @param source - Async iterable of CSV text chunks (lines or multi-line chunks).
 * @param opts - Delimiter, header, and column options.
 * @returns `Node<CSVRow>` — one `DATA` per parsed row.
 *
 * @example
 * ```ts
 * import { createReadStream } from "node:fs";
 * import { fromCSV } from "@graphrefly/graphrefly-ts";
 *
 * const csv$ = fromCSV(createReadStream("data.csv", "utf-8"));
 * ```
 *
 * @category extra
 */
export function fromCSV(source: AsyncIterable<string>, opts?: FromCSVOptions): Node<CSVRow> {
	const {
		delimiter = ",",
		hasHeader = true,
		columns: explicitColumns,
		parseLine,
		...rest
	} = opts ?? {};
	const parse = parseLine ?? ((line: string) => parseCSVLine(line, delimiter));

	return producer<CSVRow>((_d, a) => {
		let cancelled = false;

		const run = async () => {
			try {
				let headers: string[] | undefined = explicitColumns;
				let buffer = "";

				for await (const chunk of source) {
					if (cancelled) return;
					buffer += chunk;

					const lines = buffer.split(/\r?\n/);
					// Keep last partial line in buffer.
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						if (cancelled) return;
						if (!line.trim()) continue;

						const values = parse(line);

						if (!headers && hasHeader) {
							headers = values;
							continue;
						}

						if (!headers) {
							headers = values.map((_, i) => `col${i}`);
						}

						const row: CSVRow = {};
						for (let i = 0; i < headers.length; i++) {
							row[headers[i]] = values[i] ?? "";
						}
						a.emit(row);
					}
				}

				// Process remaining buffer.
				if (!cancelled && buffer.trim()) {
					const values = parse(buffer);
					if (headers) {
						const row: CSVRow = {};
						for (let i = 0; i < headers.length; i++) {
							row[headers[i]] = values[i] ?? "";
						}
						a.emit(row);
					}
				}

				if (!cancelled) a.down([[COMPLETE]]);
			} catch (err) {
				if (!cancelled) a.down([[ERROR, err]]);
			}
		};

		void run();

		return () => {
			cancelled = true;
		};
	}, sourceOpts(rest));
}

function parseCSVLine(line: string, delimiter: string): string[] {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			values.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	values.push(current);
	return values;
}

// ——— NDJSON ingest ———

/** Options for {@link fromNDJSON}. */
export type FromNDJSONOptions = ExtraOpts & {};

/**
 * Newline-delimited JSON stream ingest for batch replay.
 *
 * Reads an async iterable of text chunks, splits by newline, parses each line
 * as JSON, and emits one `DATA` per parsed object. `COMPLETE` after stream ends.
 *
 * @param source - Async iterable of NDJSON text chunks.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — one `DATA` per JSON line.
 *
 * @example
 * ```ts
 * import { createReadStream } from "node:fs";
 * import { fromNDJSON } from "@graphrefly/graphrefly-ts";
 *
 * const logs$ = fromNDJSON(createReadStream("logs.ndjson", "utf-8"));
 * ```
 *
 * @category extra
 */
export function fromNDJSON<T = unknown>(
	source: AsyncIterable<string>,
	opts?: FromNDJSONOptions,
): Node<T> {
	return producer<T>((_d, a) => {
		let cancelled = false;

		const run = async () => {
			try {
				let buffer = "";

				for await (const chunk of source) {
					if (cancelled) return;
					buffer += chunk;

					const lines = buffer.split(/\r?\n/);
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						if (cancelled) return;
						const trimmed = line.trim();
						if (!trimmed) continue;
						a.emit(JSON.parse(trimmed) as T);
					}
				}

				// Process remaining buffer.
				if (!cancelled && buffer.trim()) {
					a.emit(JSON.parse(buffer.trim()) as T);
				}

				if (!cancelled) a.down([[COMPLETE]]);
			} catch (err) {
				if (!cancelled) a.down([[ERROR, err]]);
			}
		};

		void run();

		return () => {
			cancelled = true;
		};
	}, sourceOpts(opts));
}

// ——— ClickHouse live materialized view ———

/** Structured ClickHouse query result row. */
export type ClickHouseRow = Record<string, unknown>;

/** Duck-typed ClickHouse client. */
export type ClickHouseClientLike = {
	query(opts: { query: string; format?: string }): Promise<{
		json<T = unknown>(): Promise<T[]>;
	}>;
};

/** Options for {@link fromClickHouseWatch}. */
export type FromClickHouseWatchOptions = AsyncSourceOpts & {
	/** Polling interval in nanoseconds. Default: `5 * NS_PER_SEC` (5s). */
	intervalNs?: number;
	/** JSON format to request. Default: `"JSONEachRow"`. */
	format?: string;
};

/**
 * ClickHouse live materialized view as a reactive source.
 *
 * Polls a ClickHouse query on a reactive timer interval and emits new/changed rows.
 * Uses a timer-driven approach (not busy-wait polling).
 *
 * @param client - ClickHouse client instance (caller owns connection).
 * @param query - SQL query to execute on each interval.
 * @param opts - Polling interval and format options.
 * @returns `Node<ClickHouseRow>` — one `DATA` per result row per scrape.
 *
 * @example
 * ```ts
 * import { createClient } from "@clickhouse/client";
 * import { fromClickHouseWatch } from "@graphrefly/graphrefly-ts";
 *
 * const client = createClient({ url: "http://localhost:8123" });
 * const rows$ = fromClickHouseWatch(client, "SELECT * FROM errors_mv ORDER BY timestamp DESC LIMIT 100");
 * ```
 *
 * @category extra
 */
export function fromClickHouseWatch(
	client: ClickHouseClientLike,
	query: string,
	opts?: FromClickHouseWatchOptions,
): Node<ClickHouseRow> {
	const {
		intervalNs = 5 * NS_PER_SEC,
		format = "JSONEachRow",
		signal: externalSignal,
		...rest
	} = opts ?? {};
	const intervalMs = Math.ceil(intervalNs / NS_PER_MS);

	return producer<ClickHouseRow>((_d, a) => {
		let active = true;
		let running = false;
		let timer: ReturnType<typeof setInterval> | undefined;

		const cleanup = () => {
			active = false;
			if (timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		};

		const execute = async () => {
			if (!active || running) return;
			running = true;
			try {
				const result = await client.query({ query, format });
				if (!active) return;
				const rows = await result.json<ClickHouseRow>();
				if (!active) return;
				for (const row of rows) a.emit(row);
			} catch (err) {
				if (!active) return;
				cleanup();
				a.down([[ERROR, err]]);
			} finally {
				running = false;
			}
		};

		const onAbort = () => {
			if (!active) return;
			cleanup();
			a.down([[ERROR, externalSignal?.reason ?? new Error("Aborted")]]);
		};

		if (externalSignal?.aborted) {
			onAbort();
			return () => {};
		}
		externalSignal?.addEventListener("abort", onAbort, { once: true });

		void execute();
		timer = setInterval(() => void execute(), intervalMs);

		return () => {
			cleanup();
			externalSignal?.removeEventListener("abort", onAbort);
		};
	}, sourceOpts(rest));
}

// ——— Apache Pulsar (native client) ———

/** Duck-typed Pulsar consumer (compatible with pulsar-client). */
export type PulsarConsumerLike = {
	receive(): Promise<{
		getData(): Buffer;
		getMessageId(): { toString(): string };
		getPartitionKey(): string;
		getProperties(): Record<string, string>;
		getPublishTimestamp(): number;
		getEventTimestamp(): number;
		getTopicName(): string;
	}>;
	acknowledge(msg: unknown): Promise<void>;
	close(): Promise<void>;
};

/** Duck-typed Pulsar producer. */
export type PulsarProducerLike = {
	send(msg: {
		data: Buffer;
		partitionKey?: string;
		properties?: Record<string, string>;
	}): Promise<void>;
	close(): Promise<void>;
};

/** Structured Pulsar message. */
export type PulsarMessage<T = unknown> = {
	topic: string;
	messageId: string;
	key: string;
	value: T;
	properties: Record<string, string>;
	publishTime: number;
	eventTime: number;
	timestampNs: number;
};

/** Options for {@link fromPulsar}. */
export type FromPulsarOptions = ExtraOpts & {
	/** Deserialize message data. Default: `JSON.parse(buffer.toString())`. */
	deserialize?: (data: Buffer) => unknown;
	/** Acknowledge messages automatically. Default: `true`. */
	autoAck?: boolean;
};

/**
 * Apache Pulsar consumer as a reactive source (native client).
 *
 * Wraps a `pulsar-client`-compatible consumer. Each message becomes a `DATA` emission.
 * For Kafka-on-Pulsar (KoP), use {@link fromKafka} instead.
 *
 * @param consumer - Pulsar consumer instance (caller owns create/close lifecycle).
 * @param opts - Deserialization and source options.
 * @returns `Node<PulsarMessage<T>>` — one `DATA` per Pulsar message.
 *
 * @remarks
 * Teardown sets an internal flag but cannot interrupt a pending `consumer.receive()`.
 * The loop exits on the next message or when the consumer is closed externally.
 * Callers should call `consumer.close()` after unsubscribing for prompt cleanup.
 *
 * @example
 * ```ts
 * import Pulsar from "pulsar-client";
 * import { fromPulsar } from "@graphrefly/graphrefly-ts";
 *
 * const client = new Pulsar.Client({ serviceUrl: "pulsar://localhost:6650" });
 * const consumer = await client.subscribe({ topic: "events", subscription: "my-sub" });
 * const events$ = fromPulsar(consumer);
 * ```
 *
 * @category extra
 */
export function fromPulsar<T = unknown>(
	consumer: PulsarConsumerLike,
	opts?: FromPulsarOptions,
): Node<PulsarMessage<T>> {
	const {
		autoAck = true,
		deserialize = (buf: Buffer) => {
			try {
				return JSON.parse(buf.toString());
			} catch {
				return buf.toString();
			}
		},
		...rest
	} = opts ?? {};

	return producer<PulsarMessage<T>>((_d, a) => {
		let active = true;

		const loop = async () => {
			while (active) {
				try {
					const msg = await consumer.receive();
					if (!active) return;
					a.emit({
						topic: msg.getTopicName(),
						messageId: msg.getMessageId().toString(),
						key: msg.getPartitionKey(),
						value: deserialize(msg.getData()) as T,
						properties: msg.getProperties(),
						publishTime: msg.getPublishTimestamp(),
						eventTime: msg.getEventTimestamp(),
						timestampNs: wallClockNs(),
					});
					if (autoAck) await consumer.acknowledge(msg);
				} catch (err) {
					if (active) a.down([[ERROR, err]]);
					return;
				}
			}
		};

		void loop();

		return () => {
			active = false;
		};
	}, sourceOpts(rest));
}

/** Options for {@link toPulsar}. */
export type ToPulsarOptions<T> = ExtraOpts & {
	/** Serialize value for Pulsar. Default: `JSON.stringify` → Buffer. */
	serialize?: (value: T) => Buffer;
	/** Extract partition key from value. Default: none. */
	keyExtractor?: (value: T) => string | undefined;
	/** Extract properties from value. */
	propertiesExtractor?: (value: T) => Record<string, string> | undefined;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Pulsar producer sink — forwards upstream `DATA` to a Pulsar topic.
 *
 * @param source - Upstream node to forward.
 * @param pulsarProducer - Pulsar producer instance (caller owns lifecycle).
 * @param opts - Serialization options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toPulsar<T>(
	source: Node<T>,
	pulsarProducer: PulsarProducerLike,
	opts?: ToPulsarOptions<T>,
): SinkHandle {
	const {
		serialize = (v: T) => Buffer.from(JSON.stringify(v)),
		keyExtractor,
		propertiesExtractor,
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let data: Buffer;
				try {
					data = serialize(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				void pulsarProducer
					.send({
						data,
						partitionKey: keyExtractor?.(value),
						properties: propertiesExtractor?.(value),
					})
					.catch((err: unknown) => {
						handler({
							stage: "send",
							error: err instanceof Error ? err : new Error(String(err)),
							value,
						});
					});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— NATS ———

/** Duck-typed NATS subscription (compatible with nats.js). */
export type NATSSubscriptionLike = AsyncIterable<{
	subject: string;
	data: Uint8Array;
	headers?: { get(key: string): string; keys(): string[] };
	reply?: string;
	sid: number;
}>;

/** Duck-typed NATS client (compatible with nats.js). */
export type NATSClientLike = {
	subscribe(subject: string, opts?: { queue?: string }): NATSSubscriptionLike;
	publish(subject: string, data?: Uint8Array, opts?: { headers?: unknown; reply?: string }): void;
	drain(): Promise<void>;
};

/** Structured NATS message. */
export type NATSMessage<T = unknown> = {
	subject: string;
	data: T;
	headers: Record<string, string>;
	reply: string | undefined;
	sid: number;
	timestampNs: number;
};

/** Options for {@link fromNATS}. */
export type FromNATSOptions = ExtraOpts & {
	/** Queue group name for load balancing. */
	queue?: string;
	/** Deserialize message data. Default: `JSON.parse(textDecoder.decode(data))`. */
	deserialize?: (data: Uint8Array) => unknown;
};

/**
 * NATS consumer as a reactive source.
 *
 * Wraps a `nats.js`-compatible client subscription. Each message becomes a `DATA` emission.
 *
 * @param client - NATS client instance (caller owns connect/drain lifecycle).
 * @param subject - Subject to subscribe to (supports wildcards).
 * @param opts - Queue group, deserialization, and source options.
 * @returns `Node<NATSMessage<T>>` — one `DATA` per NATS message.
 *
 * @remarks
 * Teardown sets an internal flag but cannot break the async iterator. The loop
 * exits on the next message or when the subscription is drained/unsubscribed
 * externally. Call `client.drain()` after unsubscribing for prompt cleanup.
 *
 * @example
 * ```ts
 * import { connect } from "nats";
 * import { fromNATS } from "@graphrefly/graphrefly-ts";
 *
 * const nc = await connect({ servers: "localhost:4222" });
 * const events$ = fromNATS(nc, "events.>");
 * ```
 *
 * @category extra
 */
export function fromNATS<T = unknown>(
	client: NATSClientLike,
	subject: string,
	opts?: FromNATSOptions,
): Node<NATSMessage<T>> {
	const decoder = new TextDecoder();
	const {
		queue,
		deserialize = (data: Uint8Array) => {
			const text = decoder.decode(data);
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		},
		...rest
	} = opts ?? {};

	return producer<NATSMessage<T>>((_d, a) => {
		let active = true;
		const sub = client.subscribe(subject, queue ? { queue } : undefined);

		const loop = async () => {
			try {
				for await (const msg of sub) {
					if (!active) return;
					const headers: Record<string, string> = {};
					if (msg.headers) {
						for (const k of msg.headers.keys()) {
							headers[k] = msg.headers.get(k);
						}
					}
					a.emit({
						subject: msg.subject,
						data: deserialize(msg.data) as T,
						headers,
						reply: msg.reply,
						sid: msg.sid,
						timestampNs: wallClockNs(),
					});
				}
				// Subscription closed (drain or unsubscribe) — complete.
				if (active) a.down([[COMPLETE]]);
			} catch (err) {
				if (active) a.down([[ERROR, err]]);
			}
		};

		void loop();

		return () => {
			active = false;
		};
	}, sourceOpts(rest));
}

/** Options for {@link toNATS}. */
export type ToNATSOptions<T> = ExtraOpts & {
	/** Serialize value for NATS. Default: `JSON.stringify` → Uint8Array. */
	serialize?: (value: T) => Uint8Array;
	/** Called on serialization failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * NATS publisher sink — forwards upstream `DATA` to a NATS subject.
 *
 * @param source - Upstream node to forward.
 * @param client - NATS client instance.
 * @param subject - Target subject.
 * @param opts - Serialization options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toNATS<T>(
	source: Node<T>,
	client: NATSClientLike,
	subject: string,
	opts?: ToNATSOptions<T>,
): SinkHandle {
	const encoder = new TextEncoder();
	const {
		serialize = (v: T) => encoder.encode(JSON.stringify(v)),
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let data: Uint8Array;
				try {
					data = serialize(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				try {
					client.publish(subject, data);
				} catch (err) {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
				}
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— RabbitMQ ———

/** Duck-typed RabbitMQ channel (compatible with amqplib). */
export type RabbitMQChannelLike = {
	consume(
		queue: string,
		onMessage: (
			msg: {
				content: Buffer;
				fields: {
					routingKey: string;
					exchange: string;
					deliveryTag: number;
					redelivered: boolean;
				};
				properties: Record<string, unknown>;
			} | null,
		) => void,
		opts?: { noAck?: boolean },
	): Promise<{ consumerTag: string }>;
	cancel(consumerTag: string): Promise<void>;
	ack(msg: unknown): void;
	publish(
		exchange: string,
		routingKey: string,
		content: Buffer,
		opts?: Record<string, unknown>,
	): boolean;
	sendToQueue(queue: string, content: Buffer, opts?: Record<string, unknown>): boolean;
};

/** Structured RabbitMQ message. */
export type RabbitMQMessage<T = unknown> = {
	queue: string;
	routingKey: string;
	exchange: string;
	content: T;
	properties: Record<string, unknown>;
	deliveryTag: number;
	redelivered: boolean;
	timestampNs: number;
};

/** Options for {@link fromRabbitMQ}. */
export type FromRabbitMQOptions = ExtraOpts & {
	/** Deserialize message content. Default: `JSON.parse(buffer.toString())`. */
	deserialize?: (content: Buffer) => unknown;
	/** Auto-acknowledge messages. Default: `true`. */
	autoAck?: boolean;
};

/**
 * RabbitMQ consumer as a reactive source.
 *
 * Wraps an `amqplib`-compatible channel. Each message becomes a `DATA` emission.
 *
 * @param channel - AMQP channel instance (caller owns connection/channel lifecycle).
 * @param queue - Queue to consume from.
 * @param opts - Deserialization and acknowledgment options.
 * @returns `Node<RabbitMQMessage<T>>` — one `DATA` per RabbitMQ message.
 *
 * @remarks
 * When `autoAck` is `false`, the adapter opens the channel with `noAck: false`
 * (broker requires acks) but does not call `channel.ack()`. The caller must ack
 * messages externally using the `deliveryTag` from the emitted {@link RabbitMQMessage}:
 * ```ts
 * channel.ack({ fields: { deliveryTag: msg.deliveryTag } } as any);
 * ```
 *
 * @example
 * ```ts
 * import amqplib from "amqplib";
 * import { fromRabbitMQ } from "@graphrefly/graphrefly-ts";
 *
 * const conn = await amqplib.connect("amqp://localhost");
 * const ch = await conn.createChannel();
 * await ch.assertQueue("events");
 * const events$ = fromRabbitMQ(ch, "events");
 * ```
 *
 * @category extra
 */
export function fromRabbitMQ<T = unknown>(
	channel: RabbitMQChannelLike,
	queue: string,
	opts?: FromRabbitMQOptions,
): Node<RabbitMQMessage<T>> {
	const {
		autoAck = true,
		deserialize = (buf: Buffer) => {
			try {
				return JSON.parse(buf.toString());
			} catch {
				return buf.toString();
			}
		},
		...rest
	} = opts ?? {};

	return producer<RabbitMQMessage<T>>((_d, a) => {
		let active = true;
		let consumerTag: string | undefined;

		const start = async () => {
			try {
				const result = await channel.consume(
					queue,
					(msg) => {
						if (!active) return;
						if (msg === null) {
							// Broker cancelled the consumer (queue deleted, etc.).
							if (active) a.down([[ERROR, new Error("Consumer cancelled by broker")]]);
							return;
						}
						a.emit({
							queue,
							routingKey: msg.fields.routingKey,
							exchange: msg.fields.exchange,
							content: deserialize(msg.content) as T,
							properties: msg.properties,
							deliveryTag: msg.fields.deliveryTag,
							redelivered: msg.fields.redelivered,
							timestampNs: wallClockNs(),
						});
						if (autoAck) channel.ack(msg);
					},
					{ noAck: false },
				);
				consumerTag = result.consumerTag;
			} catch (err) {
				if (active) a.down([[ERROR, err]]);
			}
		};

		void start();

		return () => {
			active = false;
			if (consumerTag !== undefined) {
				void channel.cancel(consumerTag);
			}
		};
	}, sourceOpts(rest));
}

/** Options for {@link toRabbitMQ}. */
export type ToRabbitMQOptions<T> = ExtraOpts & {
	/** Serialize value for RabbitMQ. Default: `Buffer.from(JSON.stringify(value))`. */
	serialize?: (value: T) => Buffer;
	/** Extract routing key from value. Default: `""`. */
	routingKeyExtractor?: (value: T) => string;
	/** Called on serialization or send failures. */
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * RabbitMQ producer sink — forwards upstream `DATA` to a RabbitMQ exchange/queue.
 *
 * @param source - Upstream node to forward.
 * @param channel - AMQP channel instance.
 * @param exchange - Target exchange (use `""` for default exchange + queue routing).
 * @param opts - Serialization and routing options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toRabbitMQ<T>(
	source: Node<T>,
	channel: RabbitMQChannelLike,
	exchange: string,
	opts?: ToRabbitMQOptions<T>,
): SinkHandle {
	const {
		serialize = (v: T) => Buffer.from(JSON.stringify(v)),
		routingKeyExtractor = () => "",
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let routingKey: string;
				try {
					routingKey = routingKeyExtractor(value);
				} catch (err) {
					handler({
						stage: "routing_key",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				let content: Buffer;
				try {
					content = serialize(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				try {
					channel.publish(exchange, routingKey, content);
				} catch (err) {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
				}
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——————————————————————————————————————————————————————————————
//  Phase 5.2d — Storage & sink adapters
// ——————————————————————————————————————————————————————————————

/** Handle returned by buffered sinks. `flush()` drains remaining buffer. */
export type BufferedSinkHandle = SinkHandle & {
	/** Manually drain the internal buffer. */
	flush: () => Promise<void>;
};

// ——— toFile ———

/** Duck-typed writable file handle (compatible with `fs.createWriteStream`). */
export type FileWriterLike = {
	write(data: string | Uint8Array): boolean | undefined;
	end(): void;
};

/** Options for {@link toFile}. */
export type ToFileOptions<T> = ExtraOpts & {
	/** Serialize a value to a string line. Default: `JSON.stringify(v) + "\n"`. */
	serialize?: (value: T) => string;
	/** `"append"` (default) or `"overwrite"` — controls initial file behavior hint. */
	mode?: "append" | "overwrite";
	/** Flush interval in ms. `0` = write-through (no buffering). Default: `0`. */
	flushIntervalMs?: number;
	/** Buffer size (item count) before auto-flush. Default: `Infinity` (timer only). */
	batchSize?: number;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * File sink — writes upstream `DATA` values to a file-like writable.
 *
 * When `flushIntervalMs > 0` or `batchSize` is set, values are buffered and
 * flushed in batches. Otherwise, each value is written immediately.
 *
 * @param source - Upstream node.
 * @param writer - Writable file handle (e.g. `fs.createWriteStream(path, { flags: "a" })`).
 * @param opts - Serialization, buffering, and mode options.
 * @returns `BufferedSinkHandle` with `dispose()` and `flush()`.
 *
 * @category extra
 */
export function toFile<T>(
	source: Node<T>,
	writer: FileWriterLike,
	opts?: ToFileOptions<T>,
): BufferedSinkHandle {
	const {
		serialize = (v: T) => `${JSON.stringify(v)}\n`,
		flushIntervalMs = 0,
		batchSize = Number.POSITIVE_INFINITY,
		onTransportError,
		mode: _mode,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	let buffer: string[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const doFlush = () => {
		if (buffer.length === 0) return;
		const chunk = buffer.join("");
		buffer = [];
		try {
			writer.write(chunk);
		} catch (err) {
			handler({
				stage: "send",
				error: err instanceof Error ? err : new Error(String(err)),
				value: chunk,
			});
		}
	};

	const scheduleFlush = () => {
		if (flushIntervalMs > 0 && timer === undefined && !disposed) {
			timer = setTimeout(() => {
				/* I/O flush timer — not reactive scheduling (§5.10) */
				timer = undefined;
				doFlush();
			}, flushIntervalMs);
		}
	};

	const buffered = flushIntervalMs > 0 || batchSize < Number.POSITIVE_INFINITY;

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let line: string;
				try {
					line = serialize(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				if (buffered) {
					buffer.push(line);
					if (buffer.length >= batchSize) doFlush();
					else scheduleFlush();
				} else {
					try {
						writer.write(line);
					} catch (err) {
						handler({
							stage: "send",
							error: err instanceof Error ? err : new Error(String(err)),
							value,
						});
					}
				}
				return true;
			}
			if (messageTier(msg[0]) >= 3) {
				doFlush();
			}
			return false;
		},
	});

	const unsub = inner.subscribe(() => {});

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		doFlush();
		try {
			writer.end();
		} catch {
			/* writer may already be closed */
		}
		unsub();
		errorsNode.down([[TEARDOWN]]);
	};

	return {
		dispose,
		errors: errorsNode,
		flush: async () => {
			if (!disposed) doFlush();
		},
	};
}

// ——— toCSV ———

/** Options for {@link toCSV}. */
export type ToCSVOptions<T> = ExtraOpts & {
	/** Column names. Required — determines header row and field order. */
	columns: string[];
	/** Column delimiter. Default: `","`. */
	delimiter?: string;
	/** Whether to write a header row on first flush. Default: `true`. */
	writeHeader?: boolean;
	/** Extract a cell value from the row object. Default: `String(row[col] ?? "")`. */
	cellExtractor?: (row: T, column: string) => string;
	/** Flush interval in ms. Default: `0` (write-through). */
	flushIntervalMs?: number;
	/** Buffer size before auto-flush. Default: `Infinity`. */
	batchSize?: number;
	onTransportError?: (err: SinkTransportError) => void;
};

function escapeCSVField(value: string, delimiter: string): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * CSV file sink — writes upstream `DATA` as CSV rows.
 *
 * @param source - Upstream node.
 * @param writer - Writable file handle.
 * @param opts - Column definition, delimiter, and buffering options.
 * @returns `BufferedSinkHandle`.
 *
 * @category extra
 */
export function toCSV<T>(
	source: Node<T>,
	writer: FileWriterLike,
	opts: ToCSVOptions<T>,
): BufferedSinkHandle {
	const {
		columns,
		delimiter = ",",
		writeHeader = true,
		cellExtractor = (row: T, col: string) => String((row as Record<string, unknown>)[col] ?? ""),
		flushIntervalMs = 0,
		batchSize = Number.POSITIVE_INFINITY,
		onTransportError,
		...rest
	} = opts;

	let headerWritten = false;

	const serializeRow = (row: T): string => {
		if (!headerWritten && writeHeader) {
			headerWritten = true;
			const header = columns.map((c) => escapeCSVField(c, delimiter)).join(delimiter);
			const data = columns
				.map((c) => escapeCSVField(cellExtractor(row, c), delimiter))
				.join(delimiter);
			return `${header}\n${data}\n`;
		}
		return `${columns.map((c) => escapeCSVField(cellExtractor(row, c), delimiter)).join(delimiter)}\n`;
	};

	return toFile<T>(source, writer, {
		serialize: serializeRow,
		flushIntervalMs,
		batchSize,
		onTransportError,
		...rest,
	});
}

// ——— toClickHouse ———

/** Duck-typed ClickHouse client for batch inserts. */
export type ClickHouseInsertClientLike = {
	insert(params: { table: string; values: unknown[]; format?: string }): Promise<void>;
};

/** Options for {@link toClickHouse}. */
export type ToClickHouseOptions<T> = ExtraOpts & {
	/** Batch size before auto-flush. Default: `1000`. */
	batchSize?: number;
	/** Flush interval in ms. Default: `5000`. */
	flushIntervalMs?: number;
	/** Insert format. Default: `"JSONEachRow"`. */
	format?: string;
	/** Transform value before insert. Default: identity. */
	transform?: (value: T) => unknown;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * ClickHouse buffered batch insert sink.
 *
 * Accumulates upstream `DATA` values and inserts in batches.
 *
 * @param source - Upstream node.
 * @param client - ClickHouse client with `insert()`.
 * @param table - Target table name.
 * @param opts - Batch size, flush interval, and transform options.
 * @returns `BufferedSinkHandle`.
 *
 * @category extra
 */
export function toClickHouse<T>(
	source: Node<T>,
	client: ClickHouseInsertClientLike,
	table: string,
	opts?: ToClickHouseOptions<T>,
): BufferedSinkHandle {
	const {
		batchSize = 1000,
		flushIntervalMs = 5000,
		format = "JSONEachRow",
		transform = (v: T) => v,
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	let buffer: unknown[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	const inFlight = new Set<Promise<void>>();

	const doFlush = (): Promise<void> => {
		if (buffer.length === 0) return Promise.resolve();
		const batch = buffer;
		buffer = [];
		try {
			const p: Promise<void> = client
				.insert({ table, values: batch, format })
				.catch((err: unknown) => {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value: batch,
					});
				})
				.finally(() => {
					inFlight.delete(p);
				});
			inFlight.add(p);
			return p;
		} catch (err) {
			handler({
				stage: "send",
				error: err instanceof Error ? err : new Error(String(err)),
				value: batch,
			});
			return Promise.resolve();
		}
	};

	const scheduleFlush = () => {
		if (timer === undefined && !disposed) {
			timer = setTimeout(() => {
				/* I/O flush timer — not reactive scheduling (§5.10) */
				timer = undefined;
				doFlush();
			}, flushIntervalMs);
		}
	};

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				try {
					buffer.push(transform(value));
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				if (buffer.length >= batchSize) doFlush();
				else scheduleFlush();
				return true;
			}
			if (messageTier(msg[0]) >= 3) {
				doFlush();
			}
			return false;
		},
	});

	const unsub = inner.subscribe(() => {});

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		doFlush();
		unsub();
		errorsNode.down([[TEARDOWN]]);
	};

	return {
		dispose,
		errors: errorsNode,
		flush: () => {
			const p = disposed ? Promise.resolve() : doFlush();
			return p.then(() => Promise.all(inFlight)).then(() => {});
		},
	};
}

// ——— toS3 ———

/** Duck-typed S3 client (compatible with AWS SDK v3 `S3Client.send(PutObjectCommand(...))`). */
export type S3ClientLike = {
	putObject(params: {
		Bucket: string;
		Key: string;
		Body: string | Uint8Array;
		ContentType?: string;
	}): Promise<unknown>;
};

/** Options for {@link toS3}. */
export type ToS3Options<T> = ExtraOpts & {
	/** Output format. Default: `"ndjson"`. */
	format?: "ndjson" | "json";
	/** Generate the S3 key for each batch. Receives `(seq, wallClockNs)`. Default: ISO timestamp + sequence. */
	keyGenerator?: (seq: number, timestampNs: number) => string;
	/** Batch size before auto-flush. Default: `1000`. */
	batchSize?: number;
	/** Flush interval in ms. Default: `10000`. */
	flushIntervalMs?: number;
	/** Transform value before serialization. Default: identity. */
	transform?: (value: T) => unknown;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * S3 object storage sink — buffers values and uploads as NDJSON or JSON objects.
 *
 * @param source - Upstream node.
 * @param client - S3-compatible client with `putObject()`.
 * @param bucket - S3 bucket name.
 * @param opts - Format, key generation, batching options.
 * @returns `BufferedSinkHandle`.
 *
 * @category extra
 */
export function toS3<T>(
	source: Node<T>,
	client: S3ClientLike,
	bucket: string,
	opts?: ToS3Options<T>,
): BufferedSinkHandle {
	const {
		format = "ndjson",
		keyGenerator = (seq: number, timestampNs: number) => {
			const ms = Math.floor(timestampNs / 1_000_000);
			const ts = new Date(ms).toISOString().replace(/[:.]/g, "-");
			return `data/${ts}-${seq}.${format === "ndjson" ? "ndjson" : "json"}`;
		},
		batchSize = 1000,
		flushIntervalMs = 10000,
		transform = (v: T) => v,
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	let buffer: unknown[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;
	let disposed = false;
	const inFlight = new Set<Promise<void>>();

	const doFlush = (): Promise<void> => {
		if (buffer.length === 0) return Promise.resolve();
		const batch = buffer;
		buffer = [];
		seq += 1;
		const body =
			format === "ndjson"
				? `${batch.map((v) => JSON.stringify(v)).join("\n")}\n`
				: JSON.stringify(batch);
		const contentType = format === "ndjson" ? "application/x-ndjson" : "application/json";
		const key = keyGenerator(seq, wallClockNs());
		try {
			const p: Promise<void> = client
				.putObject({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
				.then(() => {})
				.catch((err: unknown) => {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value: batch,
					});
				})
				.finally(() => {
					inFlight.delete(p);
				});
			inFlight.add(p);
			return p;
		} catch (err) {
			handler({
				stage: "send",
				error: err instanceof Error ? err : new Error(String(err)),
				value: batch,
			});
			return Promise.resolve();
		}
	};

	const scheduleFlush = () => {
		if (timer === undefined && !disposed) {
			timer = setTimeout(() => {
				/* I/O flush timer — not reactive scheduling (§5.10) */
				timer = undefined;
				doFlush();
			}, flushIntervalMs);
		}
	};

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				try {
					buffer.push(transform(value));
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				if (buffer.length >= batchSize) doFlush();
				else scheduleFlush();
				return true;
			}
			if (messageTier(msg[0]) >= 3) {
				doFlush();
			}
			return false;
		},
	});

	const unsub = inner.subscribe(() => {});

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		doFlush();
		unsub();
		errorsNode.down([[TEARDOWN]]);
	};

	return {
		dispose,
		errors: errorsNode,
		flush: () => {
			const p = disposed ? Promise.resolve() : doFlush();
			return p.then(() => Promise.all(inFlight)).then(() => {});
		},
	};
}

// ——— toPostgres ———

/** Duck-typed Postgres client (compatible with `pg.Client` / `pg.Pool`). */
export type PostgresClientLike = {
	query(sql: string, params?: unknown[]): Promise<unknown>;
};

/** Options for {@link toPostgres}. */
export type ToPostgresOptions<T> = ExtraOpts & {
	/** Build the SQL + params for an insert. Default: JSON insert into `table`. */
	toSQL?: (value: T, table: string) => { sql: string; params: unknown[] };
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * PostgreSQL sink — inserts each upstream `DATA` value as a row.
 *
 * @param source - Upstream node.
 * @param client - Postgres client with `query()`.
 * @param table - Target table name.
 * @param opts - SQL builder and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toPostgres<T>(
	source: Node<T>,
	client: PostgresClientLike,
	table: string,
	opts?: ToPostgresOptions<T>,
): SinkHandle {
	const {
		toSQL = (v: T, t: string) => ({
			sql: `INSERT INTO "${t.replace(/"/g, '""')}" (data) VALUES ($1)`,
			params: [JSON.stringify(v)],
		}),
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let query: { sql: string; params: unknown[] };
				try {
					query = toSQL(value, table);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				void client.query(query.sql, query.params).catch((err: unknown) => {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
				});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— toMongo ———

/** Duck-typed MongoDB collection (compatible with `mongodb` driver). */
export type MongoCollectionLike = {
	insertOne(doc: unknown): Promise<unknown>;
};

/** Options for {@link toMongo}. */
export type ToMongoOptions<T> = ExtraOpts & {
	/** Transform value to a MongoDB document. Default: identity. */
	toDocument?: (value: T) => unknown;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * MongoDB sink — inserts each upstream `DATA` value as a document.
 *
 * @param source - Upstream node.
 * @param collection - MongoDB collection with `insertOne()`.
 * @param opts - Document transform and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toMongo<T>(
	source: Node<T>,
	collection: MongoCollectionLike,
	opts?: ToMongoOptions<T>,
): SinkHandle {
	const { toDocument = (v: T) => v, onTransportError, ...rest } = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let doc: unknown;
				try {
					doc = toDocument(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				void collection.insertOne(doc).catch((err: unknown) => {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
				});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— toLoki ———

/** Loki log stream entry. */
export type LokiStream = {
	stream: Record<string, string>;
	values: [string, string][];
};

/** Duck-typed Loki push client (HTTP push API). */
export type LokiClientLike = {
	push(streams: { streams: LokiStream[] }): Promise<unknown>;
};

/** Options for {@link toLoki}. */
export type ToLokiOptions<T> = ExtraOpts & {
	/** Static labels applied to every log entry. */
	labels?: Record<string, string>;
	/** Extract the log line from a value. Default: `JSON.stringify(v)`. */
	toLine?: (value: T) => string;
	/** Extract additional labels from a value. Default: none. */
	toLabels?: (value: T) => Record<string, string>;
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Grafana Loki sink — pushes upstream `DATA` values as log entries.
 *
 * @param source - Upstream node.
 * @param client - Loki-compatible client with `push()`.
 * @param opts - Label, serialization, and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toLoki<T>(
	source: Node<T>,
	client: LokiClientLike,
	opts?: ToLokiOptions<T>,
): SinkHandle {
	const {
		labels = {},
		toLine = (v: T) => JSON.stringify(v),
		toLabels,
		onTransportError,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let line: string;
				try {
					line = toLine(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				let streamLabels: Record<string, string>;
				try {
					streamLabels = toLabels ? { ...labels, ...toLabels(value) } : labels;
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				const ts = `${wallClockNs()}`;
				void client
					.push({ streams: [{ stream: streamLabels, values: [[ts, line]] }] })
					.catch((err: unknown) => {
						handler({
							stage: "send",
							error: err instanceof Error ? err : new Error(String(err)),
							value,
						});
					});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— toTempo ———

/** Duck-typed Tempo span push client (OTLP/HTTP shape). */
export type TempoClientLike = {
	push(payload: { resourceSpans: unknown[] }): Promise<unknown>;
};

/** Options for {@link toTempo}. */
export type ToTempoOptions<T> = ExtraOpts & {
	/** Transform a value into OTLP resourceSpans entries. */
	toResourceSpans?: (value: T) => unknown[];
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * Grafana Tempo sink — pushes upstream `DATA` values as trace spans.
 *
 * @param source - Upstream node.
 * @param client - Tempo-compatible client with `push()`.
 * @param opts - Span transform and error options.
 * @returns Unsubscribe function.
 *
 * @category extra
 */
export function toTempo<T>(
	source: Node<T>,
	client: TempoClientLike,
	opts?: ToTempoOptions<T>,
): SinkHandle {
	const { toResourceSpans = (v: T) => [v], onTransportError, ...rest } = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let spans: unknown[];
				try {
					spans = toResourceSpans(value);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				void client.push({ resourceSpans: spans }).catch((err: unknown) => {
					handler({
						stage: "send",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
				});
				return true;
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	return {
		dispose: () => {
			unsub();
			errorsNode.down([[TEARDOWN]]);
		},
		errors: errorsNode,
	};
}

// ——— checkpointToS3 ———

/** Options for {@link checkpointToS3}. */
export type CheckpointToS3Options = {
	/** S3 key prefix. Default: `"checkpoints/"`. */
	prefix?: string;
	/** Debounce ms for autoCheckpoint. Default: `500`. */
	debounceMs?: number;
	/** Full snapshot compaction interval. Default: `10`. */
	compactEvery?: number;
	onError?: (error: unknown) => void;
};

/**
 * Wires `graph.autoCheckpoint()` to persist snapshots to S3.
 *
 * @param graph - Graph instance to checkpoint.
 * @param client - S3-compatible client with `putObject()`.
 * @param bucket - S3 bucket name.
 * @param opts - Key prefix, debounce, and compaction options.
 * @returns Dispose handle.
 *
 * @category extra
 */
export function checkpointToS3(
	graph: {
		autoCheckpoint: (
			adapter: { save(key: string, data: unknown): void },
			opts?: unknown,
		) => { dispose(): void };
		name: string;
	},
	client: S3ClientLike,
	bucket: string,
	opts?: CheckpointToS3Options,
): { dispose(): void } {
	const { prefix = "checkpoints/", debounceMs, compactEvery, onError } = opts ?? {};
	const adapter = {
		save(_key: string, data: unknown) {
			const ms = Math.floor(wallClockNs() / 1_000_000);
			const s3Key = `${prefix}${graph.name}/checkpoint-${ms}.json`;
			let body: string;
			try {
				body = JSON.stringify(data);
			} catch (err) {
				onError?.(err);
				return;
			}
			void client
				.putObject({
					Bucket: bucket,
					Key: s3Key,
					Body: body,
					ContentType: "application/json",
				})
				.catch((err) => onError?.(err));
		},
	};
	return graph.autoCheckpoint(adapter, { debounceMs, compactEvery, onError });
}

// ——— checkpointToRedis ———

/** Duck-typed Redis client for checkpoint storage. */
export type RedisCheckpointClientLike = {
	set(key: string, value: string): Promise<unknown>;
	get(key: string): Promise<string | null>;
};

/** Options for {@link checkpointToRedis}. */
export type CheckpointToRedisOptions = {
	/** Key prefix. Default: `"graphrefly:checkpoint:"`. */
	prefix?: string;
	/** Debounce ms for autoCheckpoint. Default: `500`. */
	debounceMs?: number;
	/** Full snapshot compaction interval. Default: `10`. */
	compactEvery?: number;
	onError?: (error: unknown) => void;
};

/**
 * Wires `graph.autoCheckpoint()` to persist snapshots to Redis.
 *
 * @param graph - Graph instance to checkpoint.
 * @param client - Redis client with `set()`/`get()`.
 * @param opts - Key prefix, debounce, and compaction options.
 * @returns Dispose handle.
 *
 * @category extra
 */
export function checkpointToRedis(
	graph: {
		autoCheckpoint: (
			adapter: { save(key: string, data: unknown): void },
			opts?: unknown,
		) => { dispose(): void };
		name: string;
	},
	client: RedisCheckpointClientLike,
	opts?: CheckpointToRedisOptions,
): { dispose(): void } {
	const { prefix = "graphrefly:checkpoint:", debounceMs, compactEvery, onError } = opts ?? {};
	const redisKey = `${prefix}${graph.name}`;
	const adapter = {
		save(_key: string, data: unknown) {
			let body: string;
			try {
				body = JSON.stringify(data);
			} catch (err) {
				onError?.(err);
				return;
			}
			void client.set(redisKey, body).catch((err) => onError?.(err));
		},
	};
	return graph.autoCheckpoint(adapter, { debounceMs, compactEvery, onError });
}

// ——————————————————————————————————————————————————————————————
//  SQLite adapters (roadmap §5.2b)
// ——————————————————————————————————————————————————————————————

/**
 * Duck-typed synchronous SQLite database.
 *
 * Compatible with `better-sqlite3` (`.prepare().all()` / `.prepare().run()`)
 * and Node.js `node:sqlite` `DatabaseSync`. The user wraps their driver behind
 * this uniform contract — method name `query` matches the project-wide
 * convention (`PostgresClientLike.query`, `ClickHouseClientLike.query`).
 */
export type SqliteDbLike = {
	query(sql: string, params?: unknown[]): unknown[];
};

/** Options for {@link fromSqlite}. */
export type FromSqliteOptions<T> = ExtraOpts & {
	/** Map a raw row object to the desired type. Default: identity cast. */
	mapRow?: (row: unknown) => T;
	/** Bind parameters for the query. */
	params?: unknown[];
};

/**
 * One-shot SQLite query as a reactive source.
 *
 * Executes `query` synchronously via `db.query()`, emits one `DATA` per result
 * row, then `COMPLETE`. Compose with `switchMap` + `fromTimer` / `fromFSWatch`
 * for periodic or change-driven re-query.
 *
 * @param db - SQLite database (caller owns connection).
 * @param query - SQL string to execute.
 * @param opts - Row mapper, params, and node options.
 * @returns `Node<T>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * import { fromSqlite } from "@graphrefly/graphrefly-ts";
 *
 * const raw = new Database("app.db");
 * const db = { query: (sql, params) => raw.prepare(sql).all(...(params ?? [])) };
 * const rows$ = fromSqlite(db, "SELECT * FROM users WHERE active = ?", { params: [1] });
 * ```
 *
 * @category extra
 */
export function fromSqlite<T = unknown>(
	db: SqliteDbLike,
	query: string,
	opts?: FromSqliteOptions<T>,
): Node<T> {
	const { mapRow = (r: unknown) => r as T, params, ...rest } = opts ?? {};

	return producer<T>(
		(_d, a) => {
			let mapped: T[];
			try {
				const rows = db.query(query, params);
				mapped = rows.map(mapRow);
			} catch (err) {
				a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
				return undefined;
			}
			batch(() => {
				for (const item of mapped) {
					a.down([[DATA, item]]);
				}
				a.down([[COMPLETE]]);
			});
			return undefined;
		},
		{ describeKind: "producer", completeWhenDepsComplete: false, ...rest },
	);
}

/** Options for {@link toSqlite}. */
export type ToSqliteOptions<T> = ExtraOpts & {
	/** Build SQL + params for an insert. Default: JSON insert into `(data)` column. */
	toSQL?: (value: T, table: string) => { sql: string; params: unknown[] };
	onTransportError?: (err: SinkTransportError) => void;
	/**
	 * When `true`, buffer DATA values and execute all inserts inside a single
	 * `BEGIN`/`COMMIT` transaction when the batch drains.  This avoids per-row
	 * fsync overhead and dramatically reduces event-loop blocking for
	 * high-throughput sources.  The first insert error stops the batch and
	 * triggers a `ROLLBACK`; the error is reported via `onTransportError`.
	 */
	batchInsert?: boolean;
	/** Auto-flush when buffer reaches this size. Default: `1000`. Only applies when `batchInsert` is `true`. */
	maxBatchSize?: number;
	/** Periodic flush interval in ms. `0` = no timer (flush on terminal messages only). Default: `0`. Only applies when `batchInsert` is `true`. */
	flushIntervalMs?: number;
};

/**
 * SQLite sink — inserts each upstream `DATA` value as a row.
 *
 * Follows the same pattern as {@link toPostgres} / {@link toMongo}. Since SQLite
 * is synchronous, errors propagate immediately (no `void promise.catch`).
 *
 * @param source - Upstream node.
 * @param db - SQLite database (caller owns connection).
 * @param table - Target table name.
 * @param opts - SQL builder and error options.
 * @returns Unsubscribe function.
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * import { toSqlite, state } from "@graphrefly/graphrefly-ts";
 *
 * const raw = new Database("app.db");
 * const db = { query: (sql, params) => (raw.prepare(sql).run(...(params ?? [])), []) };
 * const source = state({ name: "Alice", score: 42 });
 * const unsub = toSqlite(source, db, "events");
 * ```
 *
 * @category extra
 */
export function toSqlite<T>(
	source: Node<T>,
	db: SqliteDbLike,
	table: string,
	opts?: ToSqliteOptions<T>,
): SinkHandle {
	if (table.includes("\0") || table.length === 0) {
		throw new Error(`toSqlite: invalid table name: ${JSON.stringify(table)}`);
	}
	const {
		toSQL = (v: T, t: string) => ({
			sql: `INSERT INTO "${t.replace(/"/g, '""')}" (data) VALUES (?)`,
			params: [JSON.stringify(v)],
		}),
		onTransportError,
		batchInsert = false,
		maxBatchSize = 1000,
		flushIntervalMs = 0,
		...rest
	} = opts ?? {};
	const { errorsNode, handler } = createSinkErrorHandler(onTransportError);

	const pendingInserts: { sql: string; params: unknown[] }[] = [];
	let flushing = false;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function flushTransaction(): void {
		if (pendingInserts.length === 0 || flushing) return;
		flushing = true;
		try {
			db.query("BEGIN", []);
		} catch (err) {
			flushing = false;
			handler({
				stage: "send",
				error: err instanceof Error ? err : new Error(String(err)),
				value: undefined,
			});
			return;
		}
		const batch = pendingInserts.splice(0);
		let firstError: Error | undefined;
		for (const q of batch) {
			try {
				db.query(q.sql, q.params);
			} catch (err) {
				firstError = err instanceof Error ? err : new Error(String(err));
				break;
			}
		}
		if (firstError) {
			try {
				db.query("ROLLBACK", []);
			} catch {
				/* ROLLBACK failure — firstError already captured */
			}
			handler({ stage: "send", error: firstError, value: undefined });
		} else {
			try {
				db.query("COMMIT", []);
			} catch (err) {
				handler({
					stage: "send",
					error: err instanceof Error ? err : new Error(String(err)),
					value: undefined,
				});
			}
		}
		flushing = false;
	}

	const scheduleFlush = () => {
		if (batchInsert && flushIntervalMs > 0 && timer === undefined && !disposed) {
			timer = setTimeout(() => {
				/* I/O flush timer — not reactive scheduling (§5.10) */
				timer = undefined;
				flushTransaction();
			}, flushIntervalMs);
		}
	};

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let query: { sql: string; params: unknown[] };
				try {
					query = toSQL(value, table);
				} catch (err) {
					handler({
						stage: "serialize",
						error: err instanceof Error ? err : new Error(String(err)),
						value,
					});
					return true;
				}
				if (batchInsert) {
					pendingInserts.push(query);
					if (pendingInserts.length >= maxBatchSize) flushTransaction();
					else scheduleFlush();
				} else {
					try {
						db.query(query.sql, query.params);
					} catch (err) {
						handler({
							stage: "send",
							error: err instanceof Error ? err : new Error(String(err)),
							value,
						});
					}
				}
				return true;
			}
			if (batchInsert && messageTier(msg[0]) >= 3) {
				flushTransaction();
			}
			return false;
		},
	});
	const unsub = inner.subscribe(() => {});
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (batchInsert) flushTransaction();
		unsub();
		errorsNode.down([[TEARDOWN]]);
	};
	return {
		dispose,
		errors: errorsNode,
		flush: batchInsert
			? async () => {
					if (!disposed) flushTransaction();
				}
			: undefined,
	};
}

// ——————————————————————————————————————————————————————————————
//  Prisma adapter (5.2b)
// ——————————————————————————————————————————————————————————————

/**
 * Duck-typed Prisma model delegate.
 *
 * Compatible with any Prisma model's `findMany` method (e.g. `prisma.user`).
 * The consumer passes the model delegate directly — no dependency on `@prisma/client`.
 */
export type PrismaModelLike<T = unknown> = {
	findMany(args?: unknown): Promise<T[]>;
};

/** Options for {@link fromPrisma}. */
export type FromPrismaOptions<T, U = T> = ExtraOpts & {
	/** Prisma `findMany` args (where, orderBy, select, include, take, skip, etc.). */
	args?: unknown;
	/** Map each row to the desired shape. Default: identity cast. */
	mapRow?: (row: T) => U;
};

/**
 * One-shot Prisma query as a reactive source.
 *
 * Calls `model.findMany(args)`, emits one `DATA` per result row, then `COMPLETE`.
 * Compose with `switchMap` + `fromTimer` for periodic re-query.
 *
 * @param model - Prisma model delegate (e.g. `prisma.user`).
 * @param opts - `findMany` args, row mapper, and node options.
 * @returns `Node<U>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { fromPrisma } from "@graphrefly/graphrefly-ts";
 *
 * const prisma = new PrismaClient();
 * const activeUsers = fromPrisma(prisma.user, {
 *   args: { where: { active: true } },
 * });
 * ```
 *
 * @category extra
 */
export function fromPrisma<T = unknown, U = T>(
	model: PrismaModelLike<T>,
	opts?: FromPrismaOptions<T, U>,
): Node<U> {
	const { args, mapRow = (r: T) => r as unknown as U, ...rest } = opts ?? {};

	return producer<U>(
		(_d, a) => {
			let active = true;

			void model
				.findMany(args)
				.then((rows) => {
					if (!active) return;
					const mapped = rows.map(mapRow);
					batch(() => {
						for (const item of mapped) {
							a.emit(item);
						}
					});
					a.down([[COMPLETE]]);
				})
				.catch((err) => {
					if (!active) return;
					try {
						a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
					} catch {
						/* node already torn down — swallow */
					}
				});

			return () => {
				active = false;
			};
		},
		{ ...rest, describeKind: "producer", completeWhenDepsComplete: false },
	);
}

// ——————————————————————————————————————————————————————————————
//  Drizzle adapter (5.2b)
// ——————————————————————————————————————————————————————————————

/**
 * Duck-typed Drizzle query builder result.
 *
 * Drizzle query builders (e.g. `db.select().from(users)`) expose `.execute()`
 * which returns `Promise<T[]>`. This interface captures that contract without
 * depending on `drizzle-orm`.
 */
export type DrizzleQueryLike<T = unknown> = {
	execute(): Promise<T[]>;
};

/** Options for {@link fromDrizzle}. */
export type FromDrizzleOptions<T, U = T> = ExtraOpts & {
	/** Map each row to the desired shape. Default: identity cast. */
	mapRow?: (row: T) => U;
};

/**
 * One-shot Drizzle query as a reactive source.
 *
 * Calls `query.execute()`, emits one `DATA` per result row, then `COMPLETE`.
 * Compose with `switchMap` + `fromTimer` for periodic re-query.
 *
 * @param query - Drizzle query builder (e.g. `db.select().from(users).where(...)`).
 * @param opts - Row mapper and node options.
 * @returns `Node<U>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { fromDrizzle } from "@graphrefly/graphrefly-ts";
 *
 * const db = drizzle(pool);
 * const rows$ = fromDrizzle(db.select().from(users).where(eq(users.active, true)));
 * ```
 *
 * @category extra
 */
export function fromDrizzle<T = unknown, U = T>(
	query: DrizzleQueryLike<T>,
	opts?: FromDrizzleOptions<T, U>,
): Node<U> {
	const { mapRow = (r: T) => r as unknown as U, ...rest } = opts ?? {};

	return producer<U>(
		(_d, a) => {
			let active = true;

			void query
				.execute()
				.then((rows) => {
					if (!active) return;
					const mapped = rows.map(mapRow);
					batch(() => {
						for (const item of mapped) {
							a.emit(item);
						}
					});
					a.down([[COMPLETE]]);
				})
				.catch((err) => {
					if (!active) return;
					try {
						a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
					} catch {
						/* node already torn down — swallow */
					}
				});

			return () => {
				active = false;
			};
		},
		{ ...rest, describeKind: "producer", completeWhenDepsComplete: false },
	);
}

// ——————————————————————————————————————————————————————————————
//  Kysely adapter (5.2b)
// ——————————————————————————————————————————————————————————————

/**
 * Duck-typed Kysely query builder result.
 *
 * Kysely query builders expose `.execute()` which returns `Promise<T[]>`.
 * This interface captures that contract without depending on `kysely`.
 */
export type KyselyQueryLike<T = unknown> = {
	execute(): Promise<T[]>;
};

/** Options for {@link fromKysely}. */
export type FromKyselyOptions<T, U = T> = ExtraOpts & {
	/** Map each row to the desired shape. Default: identity cast. */
	mapRow?: (row: T) => U;
};

/**
 * One-shot Kysely query as a reactive source.
 *
 * Calls `query.execute()`, emits one `DATA` per result row, then `COMPLETE`.
 * Compose with `switchMap` + `fromTimer` for periodic re-query.
 *
 * @param query - Kysely query builder (e.g. `db.selectFrom("users").selectAll()`).
 * @param opts - Row mapper and node options.
 * @returns `Node<U>` — one `DATA` per row, then `COMPLETE`.
 *
 * @example
 * ```ts
 * import { Kysely, PostgresDialect } from "kysely";
 * import { fromKysely } from "@graphrefly/graphrefly-ts";
 *
 * const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
 * const rows$ = fromKysely(db.selectFrom("users").selectAll().where("active", "=", true));
 * ```
 *
 * @category extra
 */
export function fromKysely<T = unknown, U = T>(
	query: KyselyQueryLike<T>,
	opts?: FromKyselyOptions<T, U>,
): Node<U> {
	const { mapRow = (r: T) => r as unknown as U, ...rest } = opts ?? {};

	return producer<U>(
		(_d, a) => {
			let active = true;

			void query
				.execute()
				.then((rows) => {
					if (!active) return;
					const mapped = rows.map(mapRow);
					batch(() => {
						for (const item of mapped) {
							a.emit(item);
						}
					});
					a.down([[COMPLETE]]);
				})
				.catch((err) => {
					if (!active) return;
					try {
						a.down([[ERROR, err instanceof Error ? err : new Error(String(err))]]);
					} catch {
						/* node already torn down — swallow */
					}
				});

			return () => {
				active = false;
			};
		},
		{ ...rest, describeKind: "producer", completeWhenDepsComplete: false },
	);
}
