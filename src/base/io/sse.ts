/**
 * Server-Sent Events IO — `toSSE` / `toSSEBytes` (encode any node into the
 * `text/event-stream` wire format), `toReadableStream` (web-stream sink),
 * `parseSSEStream` (async-iterator parser), `fromSSE` (line-delimited parser
 * source).
 */

import {
	COMPLETE,
	DATA,
	DIRTY,
	defaultConfig,
	ERROR,
	type Node,
	node,
	RESOLVED,
} from "@graphrefly/pure-ts/core";
import { type ExtraOpts, sourceOpts } from "./_internal.js";

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
					if (defaultConfig.isLocalOnly(t)) {
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

/**
 * Composable variant of {@link toSSE} — emits encoded SSE frames as
 * `Uint8Array` through a reactive `Node`. Use this when you want to pipe SSE
 * bytes through the reactive graph (persist to file, tee to multiple streams,
 * etc.). Wrap with {@link toReadableStream} to expose a `ReadableStream` for
 * `new Response(...)` use cases.
 *
 * @category extra
 */
export function toSSEBytes<T>(source: Node<T>, opts?: ToSSEOptions): Node<Uint8Array> {
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
	return node<Uint8Array>([], (_data, a) => {
		let active = true;
		let keepAlive: ReturnType<typeof setInterval> | undefined;
		const emitFrame = (event: string, data?: string) => {
			if (!active) return;
			a.emit(encoder.encode(sseFrame(event, data)));
		};
		const onAbort = () => {
			if (!active) return;
			active = false;
			a.down([[COMPLETE]]);
		};
		const unsub = source.subscribe((msgs) => {
			if (!active) return;
			for (const msg of msgs) {
				const t = msg[0];
				if (defaultConfig.isLocalOnly(t)) {
					if (t === DIRTY && includeDirty) {
						/* fall through */
					} else continue;
				}
				if (t === DATA) {
					emitFrame(dataEvent, serializeSseData(msg[1], serialize));
					continue;
				}
				if (t === ERROR) {
					emitFrame(errorEvent, serializeSseData(msg[1], serialize));
					active = false;
					a.down([[COMPLETE]]);
					return;
				}
				if (t === COMPLETE) {
					emitFrame(completeEvent);
					active = false;
					a.down([[COMPLETE]]);
					return;
				}
				if (!includeResolved && t === RESOLVED) continue;
				emitFrame(
					eventNameResolver(t),
					msg.length > 1 ? serializeSseData(msg[1], serialize) : undefined,
				);
			}
		});
		if (keepAliveMs !== undefined && keepAliveMs > 0) {
			keepAlive = setInterval(() => {
				if (!active) return;
				a.emit(encoder.encode(": keepalive\n\n"));
			}, keepAliveMs);
		}
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
		return () => {
			active = false;
			if (keepAlive !== undefined) clearInterval(keepAlive);
			signal?.removeEventListener("abort", onAbort);
			unsub();
		};
	});
}

/**
 * Converts a `Node<Uint8Array>` into a WHATWG `ReadableStream<Uint8Array>`.
 * Useful for composing with `new Response(...)` / `fetch` bodies.
 *
 * @category extra
 */
export function toReadableStream(bytes: Node<Uint8Array>): ReadableStream<Uint8Array> {
	let unsub: (() => void) | undefined;
	let closed = false;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			unsub = bytes.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					if (closed) return;
					if (t === DATA) {
						try {
							controller.enqueue(m[1] as Uint8Array);
						} catch {
							/* controller closed mid-batch — upstream unsub will follow */
							closed = true;
							unsub?.();
						}
					} else if (t === ERROR) {
						closed = true;
						try {
							controller.error(m[1]);
						} catch {
							/* controller already closed */
						}
						return;
					} else if (t === COMPLETE) {
						closed = true;
						try {
							controller.close();
						} catch {
							/* controller already closed */
						}
						return;
					}
				}
			});
		},
		cancel() {
			closed = true;
			unsub?.();
		},
	});
}

/** Parsed Server-Sent Event. */
export type SSEEvent<T = string> = {
	event: string;
	data: T;
	id?: string;
	retry?: number;
};

/** Options for {@link fromSSE}. */
export type FromSSEOptions<T = string> = ExtraOpts & {
	/** Parse the raw `data:` payload. Default: identity (string). */
	parse?: (raw: string) => T;
};

/** Options for {@link parseSSEStream}. */
export type ParseSSEStreamOptions<T = string> = {
	/** Parse the raw `data:` payload. Default: identity (string). */
	parse?: (raw: string) => T;
	/**
	 * External abort signal. If aborted, the generator returns early after
	 * cancelling the underlying reader / iterator. Does not emit an error —
	 * the generator simply ends.
	 */
	signal?: AbortSignal;
};

/**
 * Parses a Server-Sent Events byte stream into an async-iterator of structured
 * `{event, data, id, retry}` records. Pure async generator with no reactive
 * dependency — safe to consume anywhere an `AsyncIterable<SSEEvent>` is
 * expected (LLM provider adapters, tests, non-reactive transports).
 *
 * Handles:
 * - Arbitrary chunk boundaries (internal text buffer + `TextDecoder` streaming).
 * - `\n` and `\r\n` line endings.
 * - `event:` / `data:` (multi-line via repeated fields) / `id:` / `retry:`.
 * - Comments (`:` prefix).
 * - Cancels the underlying reader / iterator on external abort or consumer
 *   break, so a quiet stream doesn't leak pending `read()` calls.
 *
 * Used internally by {@link fromSSE} (reactive `Node<SSEEvent>`) — exposed as a
 * pure helper so LLM provider adapters (Anthropic, OpenAI, Google) can parse
 * their SSE streams without building a reactive node per call.
 *
 * @param source - SSE byte source (`ReadableStream`, `Response`, or `AsyncIterable<Uint8Array>`).
 * @param opts - `{ parse?, signal? }`.
 * @returns `AsyncGenerator<SSEEvent<T>>` — yields one event per SSE block; returns on stream end / abort.
 *
 * @category extra
 */
export async function* parseSSEStream<T = string>(
	source: ReadableStream<Uint8Array> | Response | AsyncIterable<Uint8Array>,
	opts?: ParseSSEStreamOptions<T>,
): AsyncGenerator<SSEEvent<T>, void, unknown> {
	const parse = opts?.parse ?? ((raw: string) => raw as unknown as T);
	const externalSignal = opts?.signal;

	const decoder = new TextDecoder();
	let buffer = "";
	let currentEvent = "message";
	let currentData: string[] = [];
	let currentId: string | undefined;
	let currentRetry: number | undefined;
	const queue: SSEEvent<T>[] = [];

	const flushEvent = () => {
		if (currentData.length === 0 && currentEvent === "message" && currentId === undefined) {
			currentData = [];
			return;
		}
		const raw = currentData.join("\n");
		queue.push({
			event: currentEvent,
			data: parse(raw),
			id: currentId,
			retry: currentRetry,
		});
		currentEvent = "message";
		currentData = [];
		currentId = undefined;
		currentRetry = undefined;
	};

	const processLine = (line: string) => {
		if (line === "") {
			flushEvent();
			return;
		}
		if (line.startsWith(":")) return; // comment
		const colon = line.indexOf(":");
		const field = colon < 0 ? line : line.slice(0, colon);
		let value = colon < 0 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		switch (field) {
			case "event":
				currentEvent = value;
				break;
			case "data":
				currentData.push(value);
				break;
			case "id":
				if (!value.includes("\0")) currentId = value;
				break;
			case "retry": {
				const n = Number(value);
				if (Number.isFinite(n)) currentRetry = n;
				break;
			}
		}
	};

	const processChunk = (chunk: Uint8Array, done: boolean) => {
		buffer += decoder.decode(chunk, { stream: !done });
		const parts = buffer.split(/\r?\n/);
		buffer = parts.pop() ?? "";
		for (const line of parts) processLine(line);
	};

	// Resolve the underlying byte source into either a `ReadableStream` or an
	// `AsyncIterator<Uint8Array>` — identical dispatch as the legacy fromSSE.
	const resp = source as Response;
	const stream =
		source instanceof ReadableStream
			? source
			: resp && typeof resp === "object" && resp.body instanceof ReadableStream
				? resp.body
				: null;

	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let iter: AsyncIterator<Uint8Array> | undefined;
	// `cleanupDone` flips once we've invoked `reader.cancel()` / `iter.return()`
	// — guards against the `onAbort` listener + the `finally` path both
	// cancelling the same underlying resource (WHATWG streams allow double-
	// cancel but custom `AsyncIterator.return` implementations are not
	// required to be idempotent).
	let cleanupDone = false;
	const cleanupReader = (): void => {
		if (cleanupDone) return;
		cleanupDone = true;
		if (reader) {
			void reader.cancel().catch(() => undefined);
		}
		if (iter && typeof iter.return === "function") {
			void Promise.resolve(iter.return()).catch(() => undefined);
		}
	};

	// Wire the external abort signal to cancel the reader / iterator promptly
	// instead of waiting for the next chunk.
	const onAbort = (): void => {
		cleanupReader();
	};
	if (externalSignal) {
		if (externalSignal.aborted) return;
		externalSignal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		if (stream) {
			reader = stream.getReader();
			while (!externalSignal?.aborted) {
				const { value, done } = await reader.read();
				if (done) break;
				processChunk(value, false);
				while (queue.length > 0) {
					const ev = queue.shift() as SSEEvent<T>;
					yield ev;
				}
			}
			processChunk(new Uint8Array(), true);
		} else {
			const asyncIter = source as AsyncIterable<Uint8Array>;
			iter = asyncIter[Symbol.asyncIterator]();
			while (!externalSignal?.aborted) {
				const step = await iter.next();
				if (step.done) break;
				processChunk(step.value, false);
				while (queue.length > 0) {
					const ev = queue.shift() as SSEEvent<T>;
					yield ev;
				}
			}
			processChunk(new Uint8Array(), true);
		}
		if (buffer.trim()) {
			for (const line of buffer.split(/\r?\n/)) processLine(line);
			flushEvent();
		}
		while (queue.length > 0) {
			const ev = queue.shift() as SSEEvent<T>;
			yield ev;
		}
	} finally {
		if (externalSignal) {
			externalSignal.removeEventListener("abort", onAbort);
		}
		// Idempotent cleanup — if `onAbort` already ran the cancel, this is a
		// no-op. Covers the normal consumer-break path (generator exits → finally
		// runs → cancel underlying reader / iterator so a quiet upstream
		// doesn't leak its `read()` call).
		cleanupReader();
	}
}

/**
 * Parses a Server-Sent Events stream into structured `{event, data, id}` records.
 *
 * @param source - SSE byte source (`ReadableStream`, `Response`, or `AsyncIterable<Uint8Array>`).
 * @param opts - Parse function and node options.
 * @returns `Node<SSEEvent<T>>` — one `DATA` per SSE event; `COMPLETE` on stream end.
 *
 * @category extra
 */
export function fromSSE<T = string>(
	source: ReadableStream<Uint8Array> | Response | AsyncIterable<Uint8Array>,
	opts?: FromSSEOptions<T>,
): Node<SSEEvent<T>> {
	const { parse, ...rest } = opts ?? {};
	return node<SSEEvent<T>>(
		[],
		(_data, a) => {
			let active = true;
			const ctrl = new AbortController();
			const run = async () => {
				try {
					for await (const ev of parseSSEStream<T>(source, { parse, signal: ctrl.signal })) {
						if (!active) return;
						a.emit(ev);
					}
					if (active) a.down([[COMPLETE]]);
				} catch (err) {
					if (active) a.down([[ERROR, err]]);
				}
			};
			void run();
			return () => {
				active = false;
				ctrl.abort();
			};
		},
		sourceOpts(rest),
	);
}
