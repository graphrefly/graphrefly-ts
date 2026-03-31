/**
 * Sources and sinks (roadmap §2.3). Each API returns a {@link Node} built with
 * {@link node}, {@link producer}, {@link derived}, or {@link effect} — no second protocol.
 */
import { wallClockNs } from "../core/clock.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, type Message } from "../core/messages.js";
import { type Node, type NodeOptions, type NodeSink, node } from "../core/node.js";
import { producer, state } from "../core/sugar.js";
import { type WithStatusBundle, withStatus } from "./resilience.js";
import { type CronSchedule, matchesCron, parseCron } from "./cron.js";
import { batch } from "../core/batch.js";
import { NS_PER_MS, NS_PER_SEC } from "./backoff.js";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function sourceOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "producer", ...opts };
}

/** @internal kept for toArray which is an operator, not a producer */
function operatorOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "operator", ...opts };
}

/** Options for {@link fromTimer} / {@link fromPromise} / {@link fromAsyncIter}. */
export type AsyncSourceOpts = ExtraOpts & { signal?: AbortSignal };

/**
 * Values accepted by {@link fromAny}.
 *
 * @category extra
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

/** Options for {@link fromCron}. */
export type FromCronOptions = ExtraOpts & {
	/** Polling interval in ms. Default `60_000`. */
	tickMs?: number;
	/** Output format: `"timestamp_ns"` (default) emits wall-clock nanoseconds; `"date"` emits a `Date` object. */
	output?: "timestamp_ns" | "date";
};

/** DOM-style event target (browser or `node:events`). */
export type EventTargetLike = {
	addEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
	removeEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
};

/** Registration callback for {@link fromWebhook}. */
export type WebhookRegister<T> = (handlers: {
	/** Push one webhook payload downstream as `[[DATA, payload]]`. */
	emit: (payload: T) => void;
	/** Push terminal error as `[[ERROR, err]]`. */
	error: (err: unknown) => void;
	/** Push terminal completion as `[[COMPLETE]]`. */
	complete: () => void;
}) => (() => void) | undefined;

function wrapSubscribeHook<T>(inner: Node<T>, before: (sink: NodeSink) => void): Node<T> {
	// Create a real NodeImpl (via `node()`) so the wrapper works with Graph.add()
	// and Graph.connect() which require `instanceof NodeImpl`.
	const wrapper = node<T>([inner], ([val]) => val as T, {
		describeKind: "operator",
		initial: inner.get(),
	});
	const origSubscribe = wrapper.subscribe.bind(wrapper);
	(wrapper as { subscribe: typeof wrapper.subscribe }).subscribe = (sink, hints) => {
		before(sink);
		return origSubscribe(sink, hints);
	};
	return wrapper;
}

/**
 * Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …).
 *
 * @param ms - Milliseconds before the first emission.
 * @param opts - Producer options plus optional `period` for repeating ticks and optional `signal` (`AbortSignal`) to cancel with `ERROR`.
 * @returns `Node<number>` — tick counter from `0`; teardown clears timers.
 *
 * @example
 * ```ts
 * import { fromTimer } from "@graphrefly/graphrefly-ts";
 *
 * fromTimer(250, { period: 1_000 });
 * ```
 *
 * @category extra
 */
export function fromTimer(ms: number, opts?: AsyncSourceOpts & { period?: number }): Node<number> {
	const { signal, period, ...rest } = opts ?? {};
	return producer<number>((_d, a) => {
		let done = false;
		let count = 0;
		let t: ReturnType<typeof setTimeout> | undefined;
		let iv: ReturnType<typeof setInterval> | undefined;
		const cleanup = () => {
			done = true;
			if (t !== undefined) clearTimeout(t);
			if (iv !== undefined) clearInterval(iv);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = () => {
			if (done) return;
			a.emit(count++);
			if (period != null) {
				iv = setInterval(() => {
					if (done) return;
					a.emit(count++);
				}, period);
			} else {
				done = true;
				signal?.removeEventListener("abort", onAbort);
				queueMicrotask(() => a.down([[COMPLETE]]));
			}
		};
		const onAbort = () => {
			if (done) return;
			cleanup();
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		t = setTimeout(finish, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		return cleanup;
	}, sourceOpts(rest));
}

/**
 * Polls on an interval; when the current minute matches a 5-field cron expression, emits once (see {@link parseCron}).
 *
 * @param expr - Cron string (`min hour dom month dow`).
 * @param opts - Producer options plus `tickMs` (default `60_000`) and `output` (`timestamp_ns` default, or `date` for `Date` values).
 * @returns `Node<number>` (nanosecond timestamp) or `Node<Date>` when `output: "date"`.
 *
 * @example
 * ```ts
 * import { fromCron } from "@graphrefly/graphrefly-ts";
 *
 * fromCron("0 9 * * 1");
 * ```
 *
 * @category extra
 */
export function fromCron(expr: string, opts?: FromCronOptions & { output: "date" }): Node<Date>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number | Date> {
	const schedule: CronSchedule = parseCron(expr);
	const { tickMs: tickOpt, output, ...rest } = opts ?? {};
	const tickMs = tickOpt ?? 60_000;
	const emitDate = output === "date";
	return producer<number | Date>(
		(_d, a) => {
			let lastFiredKey = -1;
			const check = () => {
				const now = new Date();
				const key =
					now.getFullYear() * 100_000_000 +
					(now.getMonth() + 1) * 1_000_000 +
					now.getDate() * 10_000 +
					now.getHours() * 100 +
					now.getMinutes();
				if (key !== lastFiredKey && matchesCron(schedule, now)) {
					lastFiredKey = key;
					a.emit(emitDate ? now : wallClockNs());
				}
			};
			check();
			const id = setInterval(check, tickMs);
			return () => clearInterval(id);
		},
		{ ...sourceOpts(rest), name: rest.name ?? `cron:${expr}` },
	);
}

/**
 * Wraps a DOM-style `addEventListener` target; each event becomes a `DATA` emission.
 *
 * @param target - Object with `addEventListener` / `removeEventListener`.
 * @param type - Event name (e.g. `"click"`).
 * @param opts - Producer options plus listener options (`capture`, `passive`, `once`).
 * @returns `Node<T>` — event payloads; teardown removes the listener.
 *
 * @example
 * ```ts
 * import { fromEvent } from "@graphrefly/graphrefly-ts";
 *
 * fromEvent(document.body, "click");
 * ```
 *
 * @category extra
 */
export function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts?: ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean },
): Node<T> {
	const { capture, passive, once, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		const handler = (e: unknown) => {
			a.emit(e as T);
		};
		const options = { capture, passive, once };
		target.addEventListener(type, handler, options);
		return () => target.removeEventListener(type, handler, options);
	}, sourceOpts(rest));
}

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
 *     // Return a no-op cleanup unless your router abstraction supports unregister.
 *   };
 * });
 * ```
 *
 * @example
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
 *   return () => {
 *     // Fastify route removal is not dynamic by default; no-op cleanup.
 *   };
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
			a.down([[ERROR, err]]);
		};
		const complete = () => {
			if (!active) return;
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

/**
 * Drains a synchronous iterable; each item is `DATA`, then `COMPLETE`, or `ERROR` if iteration throws.
 *
 * @param iterable - Values to emit in order.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — one emission per element.
 *
 * @example
 * ```ts
 * import { fromIter } from "@graphrefly/graphrefly-ts";
 *
 * fromIter([1, 2, 3]);
 * ```
 *
 * @category extra
 */
export function fromIter<T>(iterable: Iterable<T>, opts?: ExtraOpts): Node<T> {
	return producer<T>((_d, a) => {
		let cancelled = false;
		try {
			for (const x of iterable) {
				if (cancelled) return;
				a.emit(x);
			}
			if (!cancelled) a.down([[COMPLETE]]);
		} catch (e) {
			if (!cancelled) a.down([[ERROR, e]]);
		}
		return () => {
			cancelled = true;
		};
	}, sourceOpts(opts));
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

/**
 * Lifts a Promise (or thenable) to a single-value stream: one `DATA` then `COMPLETE`, or `ERROR` on rejection.
 *
 * @param p - Promise to await.
 * @param opts - Producer options plus optional `signal` for abort → `ERROR` with reason.
 * @returns `Node<T>` — settles once.
 *
 * @example
 * ```ts
 * import { fromPromise } from "@graphrefly/graphrefly-ts";
 *
 * fromPromise(Promise.resolve(42));
 * ```
 *
 * @category extra
 */
export function fromPromise<T>(p: Promise<T> | PromiseLike<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		void Promise.resolve(p).then(
			(v) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				a.emit(v as T);
				a.down([[COMPLETE]]);
			},
			(e) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				a.down([[ERROR, e]]);
			},
		);
		return () => {
			settled = true;
			signal?.removeEventListener("abort", onAbort);
		};
	}, sourceOpts(rest));
}

/**
 * Reads an async iterable; each `next()` value becomes `DATA`; `COMPLETE` when done; `ERROR` on failure.
 *
 * @param iterable - Async source (`for await` shape).
 * @param opts - Producer options plus optional `signal` to abort the pump.
 * @returns `Node<T>` — async pull stream.
 *
 * @example
 * ```ts
 * import { fromAsyncIter } from "@graphrefly/graphrefly-ts";
 *
 * async function* gen() {
 *   yield 1;
 * }
 * fromAsyncIter(gen());
 * ```
 *
 * @category extra
 */
export function fromAsyncIter<T>(iterable: AsyncIterable<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal: outerSignal, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		const ac = new AbortController();
		const onOuterAbort = () => ac.abort(outerSignal?.reason);
		if (outerSignal?.aborted) {
			ac.abort(outerSignal.reason);
		} else {
			outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
		}
		const signal = outerSignal ?? ac.signal;
		let cancelled = false;
		const it = iterable[Symbol.asyncIterator]();
		const pump = (): void => {
			if (cancelled || signal.aborted) return;
			void Promise.resolve(it.next()).then(
				(step) => {
					if (cancelled || signal.aborted) return;
					if (step.done) {
						queueMicrotask(() => a.down([[COMPLETE]]));
						return;
					}
					a.emit(step.value as T);
					queueMicrotask(pump);
				},
				(e) => {
					if (!cancelled && !signal.aborted) a.down([[ERROR, e]]);
				},
			);
		};
		queueMicrotask(pump);
		return () => {
			cancelled = true;
			outerSignal?.removeEventListener("abort", onOuterAbort);
			ac.abort();
			void Promise.resolve(it.return?.()).catch(() => undefined);
		};
	}, sourceOpts(rest));
}

function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof (x as Node).subscribe === "function" &&
		typeof (x as Node).get === "function"
	);
}

/**
 * Coerces a value to a `Node` by shape: existing `Node` passthrough, thenable → {@link fromPromise},
 * async iterable → {@link fromAsyncIter}, sync iterable → {@link fromIter}, else scalar → {@link of}.
 *
 * @param input - Any value to wrap.
 * @param opts - Passed through when a Promise/async path is chosen.
 * @returns `Node` of the inferred element type.
 *
 * @example
 * ```ts
 * import { fromAny, state } from "@graphrefly/graphrefly-ts";
 *
 * fromAny(state(1));
 * fromAny(Promise.resolve(2));
 * ```
 *
 * @category extra
 */
export function fromAny<T>(input: NodeInput<T>, opts?: AsyncSourceOpts): Node<T> {
	if (isNode(input)) {
		return input as Node<T>;
	}
	if (isThenable(input)) {
		return fromPromise(input as PromiseLike<T>, opts);
	}
	if (input !== null && input !== undefined) {
		const candidate = input as { [Symbol.asyncIterator]?: unknown; [Symbol.iterator]?: unknown };
		if (typeof candidate[Symbol.asyncIterator] === "function") {
			return fromAsyncIter(input as AsyncIterable<T>, opts);
		}
		if (typeof candidate[Symbol.iterator] === "function") {
			return fromIter(input as Iterable<T>, opts);
		}
	}
	// scalar fallback
	return of(input as T);
}

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
 * Creates a one-shot fetch-based HTTP source with lifecycle tracking.
 *
 * Performs a single fetch when subscribed. For periodic fetching, compose
 * with `switchMap` and a time source — the source itself has no polling.
 *
 * @param url - The URL to fetch.
 * @param opts - Timeout and fetch configuration.
 * @returns {@link HTTPBundle} wrapping the primary node and its companion status nodes.
 *
 * @example
 * ```ts
 * import { fromHTTP, switchMap, fromTimer } from "@graphrefly/graphrefly-ts";
 *
 * // One-shot:
 * const api = fromHTTP("https://api.example.com/status");
 *
 * // Periodic polling via reactive composition:
 * const polled = switchMap(fromTimer(0, { periodMs: 5000 }), () => fromHTTP(url));
 * ```
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
		externalSignal?.addEventListener("abort", () => abort.abort(externalSignal.reason), { once: true });

		const timeoutId = setTimeout(() => abort.abort(new Error("Request timeout")), Math.ceil(timeoutNs / NS_PER_MS));

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

/**
 * Creates a standard Server-Sent Events stream from node messages.
 *
 * DATA/ERROR/COMPLETE tuples are serialized into SSE frames and written to the returned
 * `ReadableStream`. COMPLETE and ERROR both close the stream after their frame is written.
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
					write(eventNameResolver(t), msg.length > 1 ? serializeSseData(msg[1], serialize) : undefined);
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

/**
 * Emits each argument as `DATA` in order, then `COMPLETE` (implemented via {@link fromIter}).
 *
 * @param values - Values to emit.
 * @returns `Node<T>` — finite sequence.
 *
 * @example
 * ```ts
 * import { of } from "@graphrefly/graphrefly-ts";
 *
 * of(1, 2, 3);
 * ```
 *
 * @category extra
 */
export function of<T>(...values: T[]): Node<T> {
	return fromIter(values, undefined);
}

/**
 * Completes immediately with no `DATA` (cold `EMPTY` analogue).
 *
 * @param opts - Optional producer options.
 * @returns `Node<T>` — terminal `COMPLETE` only.
 *
 * @example
 * ```ts
 * import { empty } from "@graphrefly/graphrefly-ts";
 *
 * empty();
 * ```
 *
 * @category extra
 */
export function empty<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>((_d, a) => {
		a.down([[COMPLETE]]);
		return undefined;
	}, sourceOpts(opts));
}

/**
 * Never emits and never completes until teardown (cold `NEVER` analogue).
 *
 * @param opts - Optional producer options.
 * @returns `Node<T>` — silent until unsubscribed.
 *
 * @example
 * ```ts
 * import { never } from "@graphrefly/graphrefly-ts";
 *
 * never();
 * ```
 *
 * @category extra
 */
export function never<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>(() => undefined, sourceOpts(opts));
}

/**
 * Emits `ERROR` as soon as the producer starts (cold error source).
 *
 * @param err - Error payload forwarded as `ERROR` data.
 * @param opts - Optional producer options.
 * @returns `Node<never>` — terminates with `ERROR`.
 *
 * @example
 * ```ts
 * import { throwError } from "@graphrefly/graphrefly-ts";
 *
 * throwError(new Error("fail"));
 * ```
 *
 * @category extra
 */
export function throwError(err: unknown, opts?: ExtraOpts): Node<never> {
	return producer<never>((_d, a) => {
		a.down([[ERROR, err]]);
		return undefined;
	}, sourceOpts(opts));
}

/**
 * Subscribes immediately and runs `fn` for each upstream `DATA`; returns unsubscribe.
 *
 * @param source - Upstream node.
 * @param fn - Side effect per value.
 * @param opts - Effect node options.
 * @returns Unsubscribe function (idempotent).
 *
 * @example
 * ```ts
 * import { forEach, state } from "@graphrefly/graphrefly-ts";
 *
 * const u = forEach(state(1), (v) => console.log(v));
 * u();
 * ```
 *
 * @category extra
 */
export function forEach<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): () => void {
	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...opts,
		onMessage(msg: Message, _i, _a) {
			if (msg[0] === DATA) {
				fn(msg[1] as T);
				return true;
			}
			return false;
		},
	});
	// Auto-subscribe and return unsubscribe
	return inner.subscribe(() => {});
}

/**
 * Buffers every `DATA`; on upstream `COMPLETE` emits one `DATA` with the full array then `COMPLETE`.
 *
 * @param source - Upstream node.
 * @param opts - Optional node options (operator describe kind).
 * @returns `Node<T[]>` — single array emission before completion.
 *
 * @example
 * ```ts
 * import { of, toArray } from "@graphrefly/graphrefly-ts";
 *
 * toArray(of(1, 2, 3));
 * ```
 *
 * @category extra
 */
export function toArray<T>(source: Node<T>, opts?: ExtraOpts): Node<T[]> {
	const acc: T[] = [];
	return node<T[]>([source as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg: Message, _i, a) {
			if (msg[0] === DATA) {
				acc.push(msg[1] as T);
				return true;
			}
			if (msg[0] === COMPLETE) {
				a.emit([...acc]);
				a.down([[COMPLETE]]);
				return true;
			}
			return false;
		},
	});
}

/**
 * Multicasts upstream: one subscription to `source` while this wrapper has subscribers (via {@link producer}).
 *
 * @param source - Upstream node to share.
 * @param opts - Producer options; `initial` seeds from `source.get()` when set by factory.
 * @returns `Node<T>` — hot ref-counted bridge.
 *
 * @example
 * ```ts
 * import { share, state } from "@graphrefly/graphrefly-ts";
 *
 * share(state(0));
 * ```
 *
 * @category extra
 */
export function share<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return producer<T>(
		(_d, a) =>
			source.subscribe((msgs) => {
				a.down(msgs);
			}),
		{ ...sourceOpts(opts), initial: source.get() },
	);
}

/**
 * Like {@link share} with a bounded replay buffer: new subscribers receive the last `bufferSize`
 * `DATA` payloads (as separate batches) before live updates.
 *
 * @param source - Upstream node.
 * @param bufferSize - Maximum past values to replay (≥ 1).
 * @param opts - Producer options.
 * @returns `Node<T>` — multicast with replay on subscribe.
 *
 * @example
 * ```ts
 * import { replay, state } from "@graphrefly/graphrefly-ts";
 *
 * replay(state(0), 3);
 * ```
 *
 * @category extra
 */
export function replay<T>(source: Node<T>, bufferSize: number, opts?: ExtraOpts): Node<T> {
	if (bufferSize < 1) throw new RangeError("replay expects bufferSize >= 1");
	const buf: T[] = [];
	const inner = producer<T>(
		(_d, a) =>
			source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						buf.push(m[1] as T);
						if (buf.length > bufferSize) buf.shift();
					}
				}
				a.down(msgs);
			}),
		{ ...sourceOpts(opts), initial: source.get() },
	);
	return wrapSubscribeHook(inner, (sink) => {
		for (const v of buf) {
			sink([[DATA, v]]);
		}
	});
}

/**
 * {@link replay} with `bufferSize === 1` — replays the latest `DATA` to new subscribers.
 *
 * @param source - Upstream node.
 * @param opts - Producer options.
 * @returns `Node<T>` — share + last-value replay.
 *
 * @example
 * ```ts
 * import { cached, state } from "@graphrefly/graphrefly-ts";
 *
 * cached(state(0));
 * ```
 *
 * @category extra
 */
export function cached<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return replay(source, 1, opts);
}

/**
 * Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data.
 *
 * @param source - Node to read once.
 * @returns Promise of the first value.
 *
 * @example
 * ```ts
 * import { firstValueFrom, of } from "@graphrefly/graphrefly-ts";
 *
 * await firstValueFrom(of(42));
 * ```
 *
 * @category extra
 */
export function firstValueFrom<T>(source: Node<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const unsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (settled) return;
				if (m[0] === DATA) {
					settled = true;
					resolve(m[1] as T);
					queueMicrotask(() => unsub());
					return;
				}
				if (m[0] === ERROR) {
					settled = true;
					reject(m[1]);
					queueMicrotask(() => unsub());
					return;
				}
				if (m[0] === COMPLETE) {
					settled = true;
					reject(new Error("completed without DATA"));
					queueMicrotask(() => unsub());
					return;
				}
			}
		});
	});
}

// ——————————————————————————————————————————————————————————————
//  RxJS-compatible aliases
// ——————————————————————————————————————————————————————————————

/**
 * RxJS-named alias for {@link replay} — multicast with a replay buffer of size `bufferSize`.
 *
 * @param source - Upstream node.
 * @param bufferSize - Replay depth (≥ 1).
 * @param opts - Producer options.
 * @returns Same behavior as `replay`.
 *
 * @example
 * ```ts
 * import { shareReplay, state } from "@graphrefly/graphrefly-ts";
 *
 * shareReplay(state(0), 5);
 * ```
 *
 * @category extra
 */
export const shareReplay = replay;
