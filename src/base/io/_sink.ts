/**
 * {@link reactiveSink} — canonical sink factory for Wave 5 adapters.
 *
 * Every `to*` adapter in {@link ./adapters.ts} can be expressed as a thin
 * config wrapper around this one factory. It centralizes:
 *
 * - **Transport boundary** — the sole place in the sink layer where a raw
 *   Promise / `.then` / `.catch` sits (§5.10 boundary documented here).
 * - **Retry** — delegates to {@link BackoffStrategy} from `backoff.ts`.
 * - **Buffering** — `batchSize` / `flushIntervalMs` with tier-3 flush-on-
 *   terminal per spec §5.11. Buffered mode activates when `sendBatch` is
 *   supplied or a batching knob is set.
 * - **Backpressure** — bounded internal queue with `drop-oldest` /
 *   `drop-newest` / `error` strategies. The `"wait"` strategy is deferred
 *   to external composition (`source | valve(...) | reactiveSink(...)`).
 * - **Companions** — `sent` / `failed` / `inFlight` / `errors` (+ `buffered`
 *   / `paused` when buffering or backpressure is active). These surface
 *   every transport outcome as reactive nodes so downstream operators can
 *   build retry fallbacks, dead-letter queues, or SLO gauges without
 *   touching callback soup.
 */

import {
	COMPLETE,
	DATA,
	defaultConfig,
	ERROR,
	type Message,
	type Node,
	node,
	RingBuffer,
	TEARDOWN,
} from "@graphrefly/pure-ts/core";
import {
	type BackoffPreset,
	type BackoffStrategy,
	NS_PER_MS,
	resolveBackoffPreset,
} from "../../utils/resilience/backoff.js";

/**
 * Dual-mode buffer for the sink's backpressure queue.
 * - Bounded (finite `maxBuf`): wraps {@link RingBuffer} so drop-oldest is O(1)
 *   instead of O(n) via `Array.prototype.shift`.
 * - Unbounded (`Infinity`): plain array — no drops, no need for ring semantics.
 * `drain()` always returns the current contents and resets to empty.
 */
class BackpressureBuffer<T> {
	private ring: RingBuffer<T> | null;
	private arr: T[] | null;
	constructor(cap: number) {
		if (cap === Number.POSITIVE_INFINITY || cap <= 0) {
			this.arr = [];
			this.ring = null;
		} else {
			this.ring = new RingBuffer<T>(cap);
			this.arr = null;
		}
	}
	get length(): number {
		return this.ring != null ? this.ring.size : this.arr!.length;
	}
	push(item: T): void {
		if (this.ring != null) this.ring.push(item);
		else this.arr!.push(item);
	}
	/** Drop-oldest — O(1) in bounded mode. Returns undefined when empty. */
	shift(): T | undefined {
		if (this.ring != null) return this.ring.shift();
		return this.arr!.shift();
	}
	/** Full drain — returns contents, resets to empty. */
	drain(): T[] {
		if (this.ring != null) {
			const out = this.ring.toArray();
			this.ring.clear();
			return out;
		}
		const out = this.arr!;
		this.arr = [];
		return out;
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured transport-failure record. Every sink routes both recoverable
 * (pre-retry) and terminal (post-exhaustion) failures through this shape.
 *
 * @category extra
 */
export type SinkTransportError = {
	/**
	 * Failure stage. Known values: `"serialize"`, `"send"`, `"close"`,
	 * `"routing_key"`, `"ack"`, `"retry_exhausted"`. Open to extension for
	 * protocol-specific stages.
	 */
	stage: string;
	/** The error. */
	error: Error;
	/** Unwrapped DATA value (present for per-record failures). */
	value: unknown;
	/** Full message tuple (present for non-DATA stages like `"close"`). */
	message?: Message;
	/** Attempt number when `retry` is active — `1` = initial send. */
	attempt?: number;
};

/**
 * Terminal failure record delivered on the `failed` companion after retries
 * are exhausted (or `shouldRetry` returned `false`).
 *
 * @category extra
 */
export type SinkFailure<T> = {
	value: T;
	error: Error;
	/** Total attempts made, including the initial send. */
	attempts: number;
};

/**
 * Handle returned by every Wave 5 sink.
 *
 * @category extra
 */
export type ReactiveSinkHandle<T> = {
	/** Unsubscribe from source, cancel timers, fire `TEARDOWN` on companions. */
	dispose(): void;
	/** Drain buffer + await in-flight sends (buffered mode only). */
	flush?(): Promise<void>;
	/** DATA values that successfully reached the transport. */
	sent: Node<T>;
	/** Values that permanently failed (after any retries). */
	failed: Node<SinkFailure<T> | null>;
	/** Number of pending transport operations. */
	inFlight: Node<number>;
	/** Every transient transport error (pre-retry). Latest-only. */
	errors: Node<SinkTransportError | null>;
	/** Items currently buffered (buffered mode / backpressure only). */
	buffered?: Node<number>;
	/** `true` when a backpressure strategy has dropped / rejected items. */
	paused?: Node<boolean>;
};

/**
 * Retry configuration for {@link reactiveSink}.
 *
 * @category extra
 */
export type ReactiveSinkRetryOptions = {
	/** Total attempts including the initial send. Default: `1` (no retry). */
	maxAttempts?: number;
	/** Backoff strategy (ns) or preset name. Default: `"exponential"` when `maxAttempts > 1`. */
	backoff?: BackoffStrategy | BackoffPreset;
	/** Predicate — return `false` to short-circuit retry for a given error. */
	shouldRetry?: (err: Error, attempt: number) => boolean;
};

/**
 * Backpressure configuration for {@link reactiveSink}. When omitted, the
 * sink has no internal buffer cap beyond the natural `batchSize` /
 * `flushIntervalMs` limits.
 *
 * @category extra
 */
export type ReactiveSinkBackpressureOptions = {
	/** Hard cap on buffered items; further items trigger `strategy`. Default: `Infinity`. */
	maxBuffer?: number;
	/** Policy when the buffer is full. Default: `"drop-oldest"`. */
	strategy?: "drop-oldest" | "drop-newest" | "error";
};

/**
 * Base options shared by every sink built on {@link reactiveSink}.
 *
 * @category extra
 */
export type ReactiveSinkOptions<T> = {
	/** Optional name used for companion node naming. */
	name?: string;
	/** Invoked synchronously for every transient transport error. */
	onTransportError?: (err: SinkTransportError) => void;
	/** Retry configuration. */
	retry?: ReactiveSinkRetryOptions;
	/** Backpressure configuration. */
	backpressure?: ReactiveSinkBackpressureOptions;
	/** Batch size before auto-flush (buffered mode). */
	batchSize?: number;
	/** Flush interval in ms; `0` = write-through (buffered mode). */
	flushIntervalMs?: number;
	/** Optional transform applied before `send` / `sendBatch`. */
	serialize?: (value: T) => unknown;
	/**
	 * Reactive stop signal — when this node emits any DATA or terminal, the
	 * sink tears down. Gives callers a reactive alternative to the imperative
	 * `handle.dispose()` call so teardown can be wired through the graph.
	 */
	stopOn?: Node<unknown>;
	/**
	 * Optional hook invoked for each upstream non-DATA message (COMPLETE /
	 * ERROR / etc.) observed by the sink. Used by adapters like
	 * {@link toWebSocket} to close the underlying resource when the source
	 * terminates, without the caller having to subscribe twice.
	 */
	onUpstreamMessage?: (msg: Message) => void;
	/**
	 * Invoked once during `dispose()` after the sink's own cleanup (unsub,
	 * final drain, TEARDOWN on companions). Adapters wrap external resources
	 * (socket listeners, file handles) by passing their cleanup here —
	 * avoids hand-rolling a wrapper around `handle.dispose`.
	 */
	onDispose?: () => void;
	/**
	 * Ignored — reserved for future parity with `source.pipe(...)` style.
	 *
	 * @internal
	 */
	_reserved?: never;
};

/**
 * Full config accepted by {@link reactiveSink}. One of `send` / `sendBatch`
 * is required.
 *
 * @category extra
 */
export type ReactiveSinkConfig<T, Ctx = unknown> = ReactiveSinkOptions<T> & {
	/** Per-record transport call. */
	send?: (value: T, ctx: Ctx) => Promise<void> | void;
	/** Batched transport call. When supplied, buffering activates automatically. */
	sendBatch?: (batch: T[], ctx: Ctx) => Promise<void> | void;
	/** Context object threaded into every `send` / `sendBatch` call. */
	ctx?: Ctx;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function coerceError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

function resolveBackoff(
	backoff: BackoffStrategy | BackoffPreset | undefined,
): BackoffStrategy | null {
	if (backoff === undefined) return null;
	if (typeof backoff === "string") return resolveBackoffPreset(backoff);
	return backoff;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a reactive sink with retry / buffering / backpressure / observability
 * companions. Every Wave 5 `to*` adapter is a thin config wrapper around
 * this factory.
 *
 * **Modes:**
 * - `send` only, no batching knobs → **per-record write-through**
 * - `send` + `batchSize` or `flushIntervalMs` → **per-record buffered**
 *   (buffer drains via repeated `send` calls — one-by-one in order)
 * - `sendBatch` → **batched** (whole chunks handed to the transport)
 *
 * @category extra
 */
export function reactiveSink<T, Ctx = unknown>(
	source: Node<T>,
	config: ReactiveSinkConfig<T, Ctx>,
): ReactiveSinkHandle<T> {
	const {
		name,
		onTransportError,
		retry,
		backpressure,
		batchSize = Number.POSITIVE_INFINITY,
		flushIntervalMs = 0,
		serialize,
		stopOn,
		onUpstreamMessage,
		onDispose,
		send,
		sendBatch,
		ctx: ctxValue,
	} = config;

	if (!send && !sendBatch) {
		throw new Error("reactiveSink: `send` or `sendBatch` must be provided");
	}

	const ctx = ctxValue as Ctx;
	const maxAttempts = Math.max(1, retry?.maxAttempts ?? 1);
	const backoffStrategy = resolveBackoff(
		retry?.backoff ?? (maxAttempts > 1 ? "exponential" : undefined),
	);
	const shouldRetry = retry?.shouldRetry ?? (() => true);

	const useBuffering =
		sendBatch !== undefined || batchSize < Number.POSITIVE_INFINITY || flushIntervalMs > 0;

	const nameFor = (suffix: string) => (name ? `${name}::${suffix}` : undefined);

	const sent = node<T | undefined>([], {
		initial: undefined,
		equals: () => false,
		name: nameFor("sent"),
	}) as unknown as Node<T>;
	const failed = node<SinkFailure<T> | null>([], { initial: null, name: nameFor("failed") });
	const inFlightCountNode = node([], { initial: 0, name: nameFor("inFlight") });
	const errorsNode = node<SinkTransportError | null>([], {
		initial: null,
		name: nameFor("errors"),
	});
	const bufferedNode = useBuffering
		? node([], { initial: 0, name: nameFor("buffered") })
		: undefined;
	const pausedNode = backpressure
		? node([], { initial: false, name: nameFor("paused") })
		: undefined;

	let inFlightCount = 0;
	const bumpInFlight = (delta: number) => {
		inFlightCount += delta;
		inFlightCountNode.down([[DATA, inFlightCount]]);
	};

	const reportError = (err: SinkTransportError) => {
		try {
			onTransportError?.(err);
		} catch {
			/* user hook must not escape */
		}
		try {
			errorsNode.down([[DATA, err]]);
		} catch {
			/* re-entrant drain — swallow */
		}
	};

	const inFlightPromises = new Set<Promise<void>>();

	const trackPromise = (p: Promise<void>) => {
		inFlightPromises.add(p);
		const done = () => inFlightPromises.delete(p);
		p.then(done, done);
	};

	// Retry scheduling shared by per-record + batched paths.
	const scheduleRetry = (runAgain: () => Promise<void>, attempt: number, error: Error) => {
		const raw = backoffStrategy ? backoffStrategy(attempt - 1, error, null) : 0;
		const delayNs =
			raw === null || raw === undefined ? 0 : typeof raw === "number" && raw > 0 ? raw : 0;
		// Clamp to >=1ms — sub-ms delays via integer division collapse to 0 and
		// create synchronous retry loops that starve the event loop.
		const delayMs = Math.max(1, Math.ceil(delayNs / NS_PER_MS));
		return new Promise<void>((resolve) => {
			// §5.10: retry delay at the transport boundary.
			setTimeout(() => resolve(runAgain()), delayMs);
		});
	};

	const isThenable = (v: unknown): v is Promise<void> =>
		v != null && typeof v === "object" && typeof (v as { then?: unknown }).then === "function";

	// -------------------------------------------------------------------
	// Per-record send path — handles retry for a single value.
	//
	// Sync throws in `serialize` → reported synchronously as stage:"serialize".
	// Sync throws in `send`      → reported synchronously as stage:"send".
	// Async rejections from send → reported as stage:"send" on the next tick.
	// -------------------------------------------------------------------
	const performSend = (value: T): Promise<void> => {
		let payload: unknown;
		try {
			payload = serialize ? serialize(value) : value;
		} catch (rawErr) {
			const error = coerceError(rawErr);
			reportError({ stage: "serialize", error, value });
			failed.down([[DATA, { value, error, attempts: 0 } satisfies SinkFailure<T>]]);
			return Promise.resolve();
		}

		let attempt = 0;

		const onError = (rawErr: unknown): Promise<void> | undefined => {
			bumpInFlight(-1);
			const error = coerceError(rawErr);
			reportError({ stage: "send", error, value, attempt });
			const more = attempt < maxAttempts && shouldRetry(error, attempt);
			if (!more) {
				failed.down([[DATA, { value, error, attempts: attempt } satisfies SinkFailure<T>]]);
				return undefined;
			}
			return scheduleRetry(run, attempt, error);
		};

		const onSuccess = () => {
			bumpInFlight(-1);
			sent.down([[DATA, value]]);
		};

		function run(): Promise<void> {
			attempt += 1;
			bumpInFlight(+1);
			let result: Promise<void> | void;
			try {
				result = (send as (v: unknown, c: Ctx) => Promise<void> | void)(payload, ctx);
			} catch (rawErr) {
				return onError(rawErr) ?? Promise.resolve();
			}
			if (isThenable(result)) {
				return result.then(onSuccess, (rawErr) => onError(rawErr));
			}
			onSuccess();
			return Promise.resolve();
		}

		return run();
	};

	// -------------------------------------------------------------------
	// Buffer management (buffered mode).
	//
	// Buffer entries keep the original value (for failure reporting) alongside
	// the post-serialize payload (for the transport call). Serializing at push
	// time guarantees sync `stage: "serialize"` error reporting — the old
	// hand-rolled sinks relied on this ordering.
	// -------------------------------------------------------------------
	type BufferEntry = { value: T; payload: unknown };
	const maxBuf = backpressure?.maxBuffer ?? Number.POSITIVE_INFINITY;
	const buffer = new BackpressureBuffer<BufferEntry>(maxBuf);
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const updateBuffered = () => {
		bufferedNode?.down([[DATA, buffer.length]]);
	};

	const markPaused = (paused: boolean) => {
		if (!pausedNode) return;
		pausedNode.down([[DATA, paused]]);
	};

	const bpStrategy = backpressure?.strategy ?? "drop-oldest";

	const pushWithBackpressure = (value: T, payload: unknown): boolean => {
		const entry: BufferEntry = { value, payload };
		if (buffer.length < maxBuf) {
			buffer.push(entry);
			updateBuffered();
			return true;
		}
		// At cap — apply strategy.
		if (bpStrategy === "drop-oldest") {
			const dropped = buffer.shift() as BufferEntry;
			buffer.push(entry);
			updateBuffered();
			markPaused(true);
			failed.down([
				[
					DATA,
					{
						value: dropped.value,
						error: new Error("backpressure: buffer overflow — dropped oldest"),
						attempts: 0,
					} satisfies SinkFailure<T>,
				],
			]);
			return true;
		}
		if (bpStrategy === "drop-newest") {
			markPaused(true);
			failed.down([
				[
					DATA,
					{
						value,
						error: new Error("backpressure: buffer overflow — dropped newest"),
						attempts: 0,
					} satisfies SinkFailure<T>,
				],
			]);
			return false;
		}
		// "error"
		const err = new Error("backpressure: buffer overflow");
		reportError({ stage: "send", error: err, value });
		failed.down([[DATA, { value, error: err, attempts: 0 } satisfies SinkFailure<T>]]);
		markPaused(true);
		return false;
	};

	// Buffered flush: chunk is already serialized at push time. Retry the whole
	// chunk on sendBatch failure (or per-record send failure).
	const performBufferedBatchFlush = (chunk: BufferEntry[]): Promise<void> => {
		let attempt = 0;
		const payloads = chunk.map((e) => e.payload);

		const onError = (rawErr: unknown): Promise<void> | undefined => {
			bumpInFlight(-1);
			const error = coerceError(rawErr);
			reportError({ stage: "send", error, value: chunk.map((e) => e.value), attempt });
			const more = attempt < maxAttempts && shouldRetry(error, attempt);
			if (!more) {
				for (const { value: v } of chunk) {
					failed.down([[DATA, { value: v, error, attempts: attempt } satisfies SinkFailure<T>]]);
				}
				return undefined;
			}
			return scheduleRetry(run, attempt, error);
		};

		const onSuccess = () => {
			bumpInFlight(-1);
			for (const { value: v } of chunk) sent.down([[DATA, v]]);
		};

		function run(): Promise<void> {
			attempt += 1;
			bumpInFlight(+1);
			let result: Promise<void> | void;
			try {
				result = (sendBatch as (b: unknown[], c: Ctx) => Promise<void> | void)(payloads, ctx);
			} catch (rawErr) {
				return onError(rawErr) ?? Promise.resolve();
			}
			if (isThenable(result)) {
				return result.then(onSuccess, (rawErr) => onError(rawErr));
			}
			onSuccess();
			return Promise.resolve();
		}
		return run();
	};

	const performBufferedPerRecordFlush = async (chunk: BufferEntry[]): Promise<void> => {
		for (const entry of chunk) {
			// Intentionally do NOT check `disposed` here — a dispose() mid-
			// drain must let the already-captured chunk finish; otherwise
			// buffered items would be dropped silently. `teardownRequested`
			// prevents NEW work from starting (no new subscribe batches past
			// this point), which is the right guard.
			await performPreSerializedSend(entry.value, entry.payload);
		}
	};

	// Per-record send that skips re-serialization (buffer already serialized).
	const performPreSerializedSend = (value: T, payload: unknown): Promise<void> => {
		let attempt = 0;
		const onError = (rawErr: unknown): Promise<void> | undefined => {
			bumpInFlight(-1);
			const error = coerceError(rawErr);
			reportError({ stage: "send", error, value, attempt });
			const more = attempt < maxAttempts && shouldRetry(error, attempt);
			if (!more) {
				failed.down([[DATA, { value, error, attempts: attempt } satisfies SinkFailure<T>]]);
				return undefined;
			}
			return scheduleRetry(run, attempt, error);
		};
		const onSuccess = () => {
			bumpInFlight(-1);
			sent.down([[DATA, value]]);
		};
		function run(): Promise<void> {
			attempt += 1;
			bumpInFlight(+1);
			let result: Promise<void> | void;
			try {
				result = (send as (v: unknown, c: Ctx) => Promise<void> | void)(payload, ctx);
			} catch (rawErr) {
				return onError(rawErr) ?? Promise.resolve();
			}
			if (isThenable(result)) {
				return result.then(onSuccess, (rawErr) => onError(rawErr));
			}
			onSuccess();
			return Promise.resolve();
		}
		return run();
	};

	const doFlush = (): Promise<void> => {
		if (disposed || buffer.length === 0) return Promise.resolve();
		const chunk = buffer.drain();
		updateBuffered();
		markPaused(false);
		if (sendBatch !== undefined) {
			const p = performBufferedBatchFlush(chunk);
			trackPromise(p);
			return p;
		}
		const p = performBufferedPerRecordFlush(chunk);
		trackPromise(p);
		return p;
	};

	const scheduleFlush = () => {
		if (flushTimer !== undefined || disposed) return;
		if (flushIntervalMs <= 0) return;
		flushTimer = setTimeout(() => {
			/* §5.10: flush deadline timer — not reactive scheduling */
			flushTimer = undefined;
			void doFlush();
		}, flushIntervalMs);
	};

	// -------------------------------------------------------------------
	// Upstream subscription.
	// -------------------------------------------------------------------
	const unsub = source.subscribe((msgs) => {
		for (const msg of msgs) {
			const type = msg[0];
			if (type !== DATA) {
				try {
					onUpstreamMessage?.(msg);
				} catch {
					/* user hook must not escape */
				}
			}
			if (type === DATA) {
				const value = msg[1] as T;
				if (useBuffering) {
					// Serialize sync at push time so `stage: "serialize"` errors
					// surface on the same tick as the upstream DATA emission.
					let payload: unknown;
					if (serialize) {
						try {
							payload = serialize(value);
						} catch (rawErr) {
							const error = coerceError(rawErr);
							reportError({ stage: "serialize", error, value });
							failed.down([[DATA, { value, error, attempts: 0 } satisfies SinkFailure<T>]]);
							continue;
						}
					} else {
						payload = value;
					}
					const admitted = pushWithBackpressure(value, payload);
					if (!admitted) continue;
					if (buffer.length >= batchSize) void doFlush();
					else scheduleFlush();
				} else {
					const p = performSend(value);
					trackPromise(p);
				}
			} else if (defaultConfig.messageTier(type) >= 3) {
				// Spec §5.11 — flush on tier-3+ terminal / teardown. INVALIDATE
				// (tier 4) hits an empty buffer and is a no-op.
				if (useBuffering) {
					if (flushTimer !== undefined) {
						clearTimeout(flushTimer);
						flushTimer = undefined;
					}
					void doFlush();
				}
			}
		}
	});

	// -------------------------------------------------------------------
	// Reactive stop signal — a *fresh* emission on `stopOn` tears the sink
	// down. The first batch delivered through subscribe contains the cached
	// push-on-subscribe DATA (§2.2) and must be skipped; any emission
	// arriving in a later batch is a real stop request.
	// -------------------------------------------------------------------
	let stopUnsub: (() => void) | undefined;
	if (stopOn) {
		let firstBatchSeen = false;
		stopUnsub = stopOn.subscribe((msgs) => {
			if (!firstBatchSeen) {
				firstBatchSeen = true;
				return;
			}
			if (msgs.length > 0 && !teardownRequested) dispose();
		});
	}

	// -------------------------------------------------------------------
	// Dispose.
	//
	// Two flags:
	// - `teardownRequested`: set synchronously when `dispose()` is entered.
	//   Gates further subscribe / buffer work and short-circuits stopOn
	//   re-entry.
	// - `disposed`: set only after the final drain + unsub + TEARDOWN fan-
	//   out have landed. In-flight per-record drain loops read this to
	//   decide "am I mid-cleanup vs fully-torn-down?" They only stop on
	//   `disposed`, so a dispose mid-drain doesn't truncate the current
	//   buffer — it just prevents further work from being scheduled.
	// -------------------------------------------------------------------
	let teardownRequested = false;
	const dispose = () => {
		if (teardownRequested) return;
		teardownRequested = true;
		if (flushTimer !== undefined) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
		// Final drain of buffered items. Fire-and-forget — the per-record
		// drain loop reads `disposed` (still false) to keep draining the
		// already-captured chunk.
		if (useBuffering) void doFlush();
		disposed = true;
		stopUnsub?.();
		unsub();
		// Fire TEARDOWN on companions so downstream subscribers observe
		// the sink's lifecycle end.
		const tearDown = (n: Node<unknown>) => {
			try {
				n.down([[TEARDOWN]]);
			} catch {
				/* drain re-entrance — swallow */
			}
		};
		tearDown(errorsNode as Node<unknown>);
		tearDown(failed as Node<unknown>);
		tearDown(sent as Node<unknown>);
		tearDown(inFlightCountNode as Node<unknown>);
		if (bufferedNode) tearDown(bufferedNode as Node<unknown>);
		if (pausedNode) tearDown(pausedNode as Node<unknown>);
		// Run adapter-supplied cleanup AFTER our own teardown completes so
		// external resources (socket listeners, file handles) tear down with
		// the sink as an atomic boundary.
		try {
			onDispose?.();
		} catch {
			/* adapter cleanup failure must not escape */
		}
	};

	const handle: ReactiveSinkHandle<T> = {
		dispose,
		sent,
		failed,
		inFlight: inFlightCountNode,
		errors: errorsNode,
	};
	if (useBuffering) {
		handle.buffered = bufferedNode;
		handle.flush = async () => {
			if (disposed) return;
			await doFlush();
			await Promise.all(inFlightPromises);
		};
	}
	if (pausedNode) handle.paused = pausedNode;

	// Silence "unused" warnings for COMPLETE / ERROR — they're handled as
	// part of the messageTier(type) >= 3 branch above.
	void COMPLETE;
	void ERROR;

	return handle;
}
