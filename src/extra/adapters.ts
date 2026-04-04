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
 * fromClickHouseWatch.
 */

import { batch } from "../core/batch.js";
import { wallClockNs } from "../core/clock.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Message, RESOLVED } from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
import { producer, state } from "../core/sugar.js";
import { NS_PER_MS, NS_PER_SEC } from "./backoff.js";
import { type WithStatusBundle, withStatus } from "./resilience.js";
import type { AsyncSourceOpts } from "./sources.js";
import { globToRegExp, matchesAnyPattern } from "./sources.js";

/** Structured callback for sink transport failures (Kafka, Redis, etc.). */
export type SinkTransportError = {
	stage: "serialize" | "send";
	error: Error;
	value: unknown;
};

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
					if (!includeResolved && t === RESOLVED) continue;
					if (!includeDirty && t === DIRTY) continue;
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
		onMessage(msg: Message) {
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
): () => void {
	const {
		serialize = (v: T) => JSON.stringify(v),
		keyExtractor,
		onTransportError,
		...rest
	} = opts ?? {};

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				const key = keyExtractor?.(value) ?? null;
				let serialized: string | Buffer;
				try {
					serialized = serialize(value);
				} catch (err) {
					onTransportError?.({
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
						onTransportError?.({
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
	return inner.subscribe(() => {});
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
): () => void {
	const {
		serialize = (v: T) => ["data", JSON.stringify(v)],
		maxLen,
		onTransportError,
		...rest
	} = opts ?? {};

	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...rest,
		onMessage(msg: Message) {
			if (msg[0] === DATA) {
				const value = msg[1] as T;
				let fields: string[];
				try {
					fields = serialize(value);
				} catch (err) {
					onTransportError?.({
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
					onTransportError?.({
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
	return inner.subscribe(() => {});
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
