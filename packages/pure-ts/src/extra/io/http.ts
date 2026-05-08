/**
 * HTTP IO — `fromHTTP` (one-shot fetch with `withStatus` companion bundle),
 * `toHTTP` (per-record / buffered sink with retry support), `fromHTTPStream`
 * (raw `Uint8Array` byte stream), `fromHTTPPoll` (interval-driven re-fetch).
 *
 * Uses the platform `fetch` API (Node 18+, browsers, Deno, Bun). Timeouts use
 * `AbortController` driven by `setTimeout` per spec §5.10's resilience-operator
 * carve-out.
 */

import { batch } from "../../core/batch.js";
import { wallClockNs } from "../../core/clock.js";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { switchMap } from "../operators/index.js";
import {
	type ReactiveSinkHandle,
	reactiveSink,
	type SinkTransportError,
} from "../reactive-sink.js";
import { NS_PER_MS, NS_PER_SEC } from "../resilience/backoff.js";
// NOTE: A1 batch — keep this import through the `../resilience.js` shim. Going
// direct to `../resilience/index.js` triggers a vitest SSR module-resolution
// quirk that desynchronises `withStatus` bindings between this file and the
// `extra/index.ts` re-export (which still routes through the shim), causing
// agentLoop / gatedStream tests to time out. Tracked as a deferred A1 follow-up.
import { type WithStatusBundle, withStatus } from "../resilience.js";
import type { AsyncSourceOpts } from "../sources.js";
import { fromTimer } from "../sources.js";
import { type ExtraOpts, sourceOpts } from "./_internal.js";

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
	/**
	 * When `true`, emit `COMPLETE` after the first successful fetch. Useful for
	 * one-shot semantics where downstream wants to know "no more values ever."
	 * Default: `false` — the node stays live and replays cached DATA to late
	 * subscribers via push-on-subscribe (spec §2.2).
	 */
	completeAfterFetch?: boolean;
	/**
	 * When `true`, trigger a fresh fetch on each new subscriber instead of
	 * sharing one cached result. Default: `false` — one shared fetch whose
	 * result is cached and replayed to every subscriber.
	 */
	refetchOnSubscribe?: boolean;
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
	/**
	 * `true` after at least one successful fetch; stays `true` across
	 * resubscribes. Orthogonal to {@link withStatus}'s `active`/`completed`
	 * lifecycle — use this as the "fetch done" signal under the default
	 * (cached, stays-live) behavior where `withStatus` never transitions to
	 * `"completed"` unless `completeAfterFetch: true` is set.
	 */
	fetched: Node<boolean>;
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
		completeAfterFetch = false,
		refetchOnSubscribe = false,
		...rest
	} = opts ?? {};

	const fetchCount = node<number>([], { initial: 0, name: `${rest.name ?? "http"}/fetchCount` });
	const lastUpdated = node<number>([], { initial: 0, name: `${rest.name ?? "http"}/lastUpdated` });
	const fetched = node<boolean>([], { initial: false, name: `${rest.name ?? "http"}/fetched` });
	// Closure-owned counter: `fetchCount` is a write-only observable of this
	// local count. Avoids the `fetchCount.cache + 1` read-modify-write pattern
	// (P3 audit #6) — the node stays in sync because every write flows through
	// here.
	let fetchCountLocal = 0;

	const body =
		bodyOpt !== undefined
			? typeof bodyOpt === "string"
				? bodyOpt
				: JSON.stringify(bodyOpt)
			: undefined;

	// Fetch body + lifecycle — shared between the default "one shared fetch"
	// path and the refetch-on-subscribe resubscribable producer path.
	const runFetch = (a: {
		emit: (v: T) => void;
		down: (msgs: [symbol, ...unknown[]][]) => void;
	}): (() => void) => {
		const abort = new AbortController();
		let active = true;

		if (externalSignal?.aborted) {
			// Abort already fired before activation — short-circuit with ERROR
			// and flip `active` so the idempotent cleanup below is coherent.
			active = false;
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

		fetch(url, { method, headers, body, signal: abort.signal })
			.then(async (res) => {
				clearTimeout(timeoutId);
				if (!active) return;
				if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
				const data = await transform(res);
				if (!active) return;
				batch(() => {
					fetchCountLocal += 1;
					fetchCount.down([[DATA, fetchCountLocal]]);
					lastUpdated.down([[DATA, wallClockNs()]]);
					fetched.down([[DATA, true]]);
					a.emit(data as T);
				});
				if (completeAfterFetch) a.down([[COMPLETE]]);
			})
			.catch((err) => {
				clearTimeout(timeoutId);
				if (!active) return;
				if (err && (err as Error).name === "AbortError") return;
				a.down([[ERROR, err]]);
			});

		return () => {
			active = false;
			abort.abort();
		};
	};

	const sourceNode = node<T>(
		[],
		(_data, a) =>
			runFetch({
				emit: (v) => a.emit(v),
				down: (msgs) => a.down(msgs as unknown as [symbol, unknown?][]),
			}),
		{
			...sourceOpts(rest),
			// `resubscribable: true` when refetchOnSubscribe — each new activation
			// (subscribe after full deactivation) re-runs the producer fn → fresh
			// fetch. Default (cache-once) stays non-resubscribable: producer runs
			// once on first activation, cached DATA replays to late subscribers.
			resubscribable: refetchOnSubscribe,
		},
	);

	const tracked = withStatus(sourceNode);

	return {
		...tracked,
		fetchCount,
		lastUpdated,
		fetched,
	};
}

/** Options for {@link toHTTP}. */
export type ToHTTPOptions<T> = ExtraOpts & {
	/** HTTP method. Default: `"POST"`. */
	method?: string;
	/** Request headers applied to every call. Caller sets Content-Type. */
	headers?: Record<string, string>;
	/** Serialize a value to a request body. Default: `JSON.stringify`. */
	serialize?: (value: T) => string | Uint8Array;
	/** Optional request timeout in nanoseconds. */
	timeoutNs?: number;
	/**
	 * Format used when `batchSize` / `flushIntervalMs` is set:
	 * - `"json-array"` — body is `JSON.stringify(batch)`
	 * - `"ndjson"` — body is newline-delimited JSON.
	 * Default: `"json-array"`.
	 */
	batchFormat?: "json-array" | "ndjson";
	/** Batch size before auto-flush (buffered mode). */
	batchSize?: number;
	/** Flush interval in ms (buffered mode). */
	flushIntervalMs?: number;
	/** Retry configuration — same shape as {@link ReactiveSinkRetryOptions}. */
	retry?: Parameters<typeof reactiveSink<T>>[1]["retry"];
	onTransportError?: (err: SinkTransportError) => void;
};

/**
 * HTTP sink — forwards upstream `DATA` values as HTTP requests.
 *
 * Per-record mode (default, no batching knobs): one request per DATA.
 * Buffered mode (`batchSize` / `flushIntervalMs`): one request per chunk,
 * body is JSON-array or NDJSON depending on `batchFormat`.
 *
 * @param source - Upstream node.
 * @param url - Request URL.
 * @param opts - Serialization, batching, retry options.
 * @returns {@link ReactiveSinkHandle}.
 *
 * @category extra
 */
export function toHTTP<T>(
	source: Node<T>,
	url: string,
	opts?: ToHTTPOptions<T>,
): ReactiveSinkHandle<T> {
	const {
		method = "POST",
		headers = { "Content-Type": "application/json" },
		serialize = (v: T) => JSON.stringify(v),
		timeoutNs,
		batchFormat = "json-array",
		batchSize,
		flushIntervalMs,
		retry,
		onTransportError,
	} = opts ?? {};

	const sendOne = async (body: string | Uint8Array): Promise<void> => {
		const controller = timeoutNs !== undefined ? new AbortController() : undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		if (controller && timeoutNs !== undefined) {
			timeoutId = setTimeout(
				() => controller.abort(new Error("Request timeout")),
				Math.ceil(timeoutNs / NS_PER_MS),
			);
		}
		try {
			const res = await fetch(url, {
				method,
				headers,
				body: body as BodyInit | null | undefined,
				signal: controller?.signal,
			});
			// Drain the response body in every branch — un-drained bodies on
			// non-ok responses hold the connection open in Node's fetch pool
			// until GC, which starves the pool during retry storms.
			const drain = async () => {
				try {
					await res.arrayBuffer?.();
				} catch {
					/* body already consumed / socket dead — nothing to drain */
				}
			};
			if (!res.ok) {
				await drain();
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}
			await drain();
		} finally {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
		}
	};

	const buffered = batchSize !== undefined || flushIntervalMs !== undefined;
	if (buffered) {
		// Buffered mode: batchFormat decides the body shape; per-item `serialize`
		// is only applied for ndjson (line-oriented). json-array format sends the
		// raw batch through `JSON.stringify` as a single array.
		return reactiveSink<T>(source, {
			onTransportError,
			retry,
			batchSize,
			flushIntervalMs,
			sendBatch: async (chunk) => {
				let body: string | Uint8Array;
				if (batchFormat === "ndjson") {
					body = (chunk as T[])
						.map((v) => {
							const s = serialize(v);
							return typeof s === "string" ? s : new TextDecoder().decode(s);
						})
						.join("\n");
				} else {
					body = JSON.stringify(chunk);
				}
				await sendOne(body);
			},
		});
	}

	return reactiveSink<T>(source, {
		onTransportError,
		retry,
		serialize,
		send: async (payload) => {
			await sendOne(payload as string | Uint8Array);
		},
	});
}

/** Options for {@link fromHTTPStream}. */
export type FromHTTPStreamOptions = ExtraOpts & {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	signal?: AbortSignal;
};

/**
 * Streaming HTTP source — emits each chunk from the response body as a
 * `Uint8Array` `DATA`. `COMPLETE` when the stream ends; `ERROR` on non-ok
 * response or fetch failure.
 *
 * Useful for ingesting server-push APIs (LLM streaming, SSE endpoints — pair
 * with {@link fromSSE}, NDJSON endpoints — pair with {@link fromNDJSON}).
 *
 * @category extra
 */
export function fromHTTPStream(url: string, opts?: FromHTTPStreamOptions): Node<Uint8Array> {
	const { method = "GET", headers, body: bodyOpt, signal: externalSignal, ...rest } = opts ?? {};
	return node<Uint8Array>(
		[],
		(_data, a) => {
			let active = true;
			const abort = new AbortController();
			if (externalSignal?.aborted) {
				a.down([[ERROR, externalSignal.reason ?? new Error("Aborted")]]);
				return () => {};
			}
			externalSignal?.addEventListener("abort", () => abort.abort(externalSignal.reason), {
				once: true,
			});
			const body =
				bodyOpt !== undefined
					? typeof bodyOpt === "string"
						? bodyOpt
						: JSON.stringify(bodyOpt)
					: undefined;

			const run = async () => {
				try {
					const res = await fetch(url, { method, headers, body, signal: abort.signal });
					if (!active) return;
					if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
					if (!res.body) throw new Error("HTTP response has no body");
					const reader = res.body.getReader();
					while (active) {
						const { value, done } = await reader.read();
						if (done) break;
						if (value) a.emit(value);
					}
					if (active) a.down([[COMPLETE]]);
				} catch (err) {
					if (!active) return;
					if (err && (err as Error).name === "AbortError") return;
					a.down([[ERROR, err]]);
				}
			};
			void run();
			return () => {
				active = false;
				abort.abort();
			};
		},
		sourceOpts(rest),
	);
}

/** Options for {@link fromHTTPPoll}. */
export type FromHTTPPollOptions = FromHTTPOptions & {
	/** Poll interval in milliseconds. Default: `5000`. */
	intervalMs?: number;
};

/**
 * Repeatedly-fetching HTTP source — a reactive composition of
 * {@link fromTimer} + {@link switchMap} + {@link fromHTTP} that fetches on an
 * interval and emits the latest response. Previous in-flight fetches are
 * cancelled when a new tick arrives (switch semantics).
 *
 * @example
 * ```ts
 * import { fromHTTPPoll } from "@graphrefly/graphrefly-ts";
 * const health$ = fromHTTPPoll<{ ok: boolean }>("https://example.com/health", { intervalMs: 10_000 });
 * ```
 *
 * @category extra
 */
export function fromHTTPPoll<T = unknown>(url: string, opts?: FromHTTPPollOptions): Node<T> {
	const { intervalMs = 5000, ...httpOpts } = opts ?? {};
	return switchMap(
		fromTimer(intervalMs, { period: intervalMs }),
		() => fromHTTP<T>(url, { ...httpOpts, completeAfterFetch: true }).node,
	);
}
