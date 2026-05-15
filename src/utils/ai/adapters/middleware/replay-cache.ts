/**
 * `withReplayCache` — content-addressed response cache over `KvStorageTier`.
 *
 * - Key: sha256 of canonicalized (messages + invoke options minus `signal`).
 * - `"read-write"` (default): returns cached response if present; on miss,
 *   passes through and stores the result.
 * - `"write-only"`: never reads; populates the cache for later runs.
 * - `"read"`: reads only; on miss, passes through without writing.
 * - `"read-strict"`: reads only; on miss, **throws `ReplayCacheMissError`**
 *   instead of passing through. Use for fixture-driven tests or offline
 *   fallback adapters where any cache miss is a test failure or a signal to
 *   degrade.
 *
 * Reuses the library's existing `KvStorageTier` abstraction — any kv tier
 * (memoryKv / fileKv / sqliteKv / indexedDbKv / custom).
 *
 * **Concurrent cache-miss dedup:** uses `singleFromAny` so two concurrent
 * calls with the same key share one upstream request. Second caller sees the
 * same response that the first caller fetched; no duplicate provider spend.
 *
 * **Circular-ref safe:** `canonicalJson` uses a seen-set replacer so
 * user-supplied `ToolDefinition.parameters` with `$ref` cycles don't stack-
 * overflow the key computation.
 *
 * **Stream cadence capture:** when `cacheStreaming: true` AND
 * `captureStreamCadence: true`, per-chunk delays (ms since previous chunk)
 * are recorded alongside the content. Replay honors the recorded cadence
 * unless `replaySpeed` is set, which multiplies the effective per-chunk
 * delay (`replaySpeed: 2` → 2× faster; `replaySpeed: 0` → instant).
 * Without `captureStreamCadence`, replay is instant regardless.
 */

import { ResettableTimer } from "../../../../base/utils/resettable-timer.js";
import { monotonicNs, wallClockNs } from "@graphrefly/pure-ts/core";
import type { KvStorageTier } from "@graphrefly/pure-ts/extra";
import { canonicalJson, fromAny } from "@graphrefly/pure-ts/extra";
import { singleFromAny } from "../../../../base/composition/single-from-any.js";
import { firstValueFrom } from "../../../../base/sources/settled.js";
import { contentAddressedCache } from "../_internal/content-addressed-cache.js";
import { adapterWrapper, withLayer } from "../_internal/wrappers.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
} from "../core/types.js";

export type ReplayCacheMode = "read" | "read-strict" | "write-only" | "read-write";

export class ReplayCacheMissError extends Error {
	override name = "ReplayCacheMissError";
	constructor(
		public readonly key: string,
		public readonly method: "invoke" | "stream",
	) {
		super(`withReplayCache: no cached response for ${method} (key=${key}, mode=read-strict)`);
	}
}

/**
 * Context object passed to {@link WithReplayCacheOptions.keyFn}. Extending
 * with additional fields is forward-compatible — current implementations
 * ignoring unknown fields continue to work.
 */
export interface ReplayCacheKeyContext {
	readonly messages: readonly ChatMessage[];
	readonly opts: LLMInvokeOptions | undefined;
	/** Shortcut to `opts?.keyContext` — avoids an extra guard in callers. */
	readonly context: unknown;
}

export interface WithReplayCacheOptions {
	storage: KvStorageTier;
	mode?: ReplayCacheMode;
	/**
	 * Custom key function. Receives a {@link ReplayCacheKeyContext} with the
	 * chat messages, the invoke options, and the caller-supplied
	 * `opts.keyContext`. Defaults to sha256 of canonical JSON over
	 * `(messages, opts without signal/keyContext)`.
	 *
	 * Legacy 2-arg form `(messages, opts?)` also accepted — the adapter
	 * detects arity and dispatches. Prefer the object form for new code.
	 */
	keyFn?:
		| ((ctx: ReplayCacheKeyContext) => string | Promise<string>)
		| ((messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => string | Promise<string>);
	/** Prefix for cached keys (useful when sharing a tier across domains). */
	keyPrefix?: string;
	/**
	 * Whether to cache streaming responses (by consuming the full stream
	 * and replaying it as one synthetic token chunk). Default `false`.
	 */
	cacheStreaming?: boolean;
	/**
	 * When `cacheStreaming: true`, also record per-chunk delays (ms since
	 * previous chunk) so replay can honor the original streaming cadence.
	 * Default `false` (chunks replay instantly).
	 */
	captureStreamCadence?: boolean;
	/**
	 * Stream replay speed multiplier. `1` = original cadence (requires
	 * `captureStreamCadence`). `2` = 2× faster. `0` = instant. Default `1`.
	 */
	replaySpeed?: number;
}

interface CachedEntry {
	response: LLMResponse;
	storedAtNs: number;
	/**
	 * Per-chunk deltas in milliseconds — populated only when `captureStreamCadence`
	 * is `true` during the write. Replayed via `ResettableTimer` in stream().
	 */
	streamCadenceMs?: readonly number[];
	/**
	 * Per-chunk bodies in order (tokens only — `usage`/`finish` are reconstructed
	 * from `response.usage` / `response.finishReason`). Populated only when
	 * `captureStreamCadence` is `true`, used for cadence-faithful replay.
	 */
	streamChunks?: ReadonlyArray<{ delta: string }>;
}

type ResolveArgs = {
	messages: readonly ChatMessage[];
	invokeOpts: LLMInvokeOptions | undefined;
};
type ResolveArgsWithKey = ResolveArgs & { _precomputedKey: string };

/** Wrap an adapter with a replay cache. */
export function withReplayCache(inner: LLMAdapter, opts: WithReplayCacheOptions): LLMAdapter {
	const mode = opts.mode ?? "read-write";
	const cacheStreaming = opts.cacheStreaming ?? false;
	const captureStreamCadence = opts.captureStreamCadence ?? false;
	const replaySpeed = opts.replaySpeed ?? 1;
	const keyPrefix = opts.keyPrefix ?? "llm-replay";
	const isReadOnly = mode === "read" || mode === "read-strict";

	// Content-addressed substrate — keys via canonicalJson + sha256 over
	// (messages, opts minus signal/keyContext) or the caller's custom keyFn.
	// Value type is `CachedEntry` so we can persist stream cadence alongside
	// the response. Uses the shared substrate in `src/extra/content-addressed-
	// storage.ts` via the LLM-specific wrapper in `_internal/`.
	//
	// Mode translation: `ReplayCacheMode` uses `"write-only"` (legacy name);
	// the substrate uses `"write"`. All other modes map 1:1.
	const cache = contentAddressedCache<CachedEntry>({
		storage: opts.storage,
		mode: mode === "write-only" ? "write" : mode,
		keyFn: opts.keyFn,
		keyPrefix,
	});

	const sleepMs = (ms: number): Promise<void> =>
		ms <= 0
			? Promise.resolve()
			: new Promise<void>((resolve) => {
					const t = new ResettableTimer();
					t.start(ms, () => resolve());
				});

	// Singleflight — concurrent cache-miss requests with the same key share one
	// upstream call. `keyFn` must be synchronous (singleflight needs the key
	// before dispatching), so we compute the key eagerly in `invoke`/`stream`
	// and thread it through as `_precomputedKey`. The passed `keyFn` reads
	// that precomputed value instead of re-hashing.
	const upstreamInFlight = singleFromAny<ResolveArgsWithKey, LLMResponse>(
		async ({ messages, invokeOpts }) => {
			return await firstValueFrom(fromAny(inner.invoke(messages, invokeOpts)));
		},
		{ keyFn: ({ _precomputedKey }) => _precomputedKey },
	);

	const wrap = adapterWrapper(inner, {
		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const key = await cache.keyFor(messages, invokeOpts);
			const entry = await cache.lookup(messages, invokeOpts);
			if (entry?.response) {
				const cached = entry.response;
				return { ...cached, metadata: { ...(cached.metadata ?? {}), replayCache: "hit" } };
			}

			if (mode === "read-strict") throw new ReplayCacheMissError(key, "invoke");
			const resp = await upstreamInFlight({ messages, invokeOpts, _precomputedKey: key });
			if (!isReadOnly) {
				await cache.store(messages, invokeOpts, { response: resp, storedAtNs: wallClockNs() });
			}
			return resp;
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			if (!cacheStreaming) {
				// `read-strict` only applies to cache-checked paths. When
				// `cacheStreaming: false` the cache isn't consulted for
				// streams at all, so passthrough is correct — throwing would
				// make the adapter's stream() permanently unusable.
				for await (const delta of inner.stream(messages, invokeOpts)) yield delta;
				return;
			}
			const key = await cache.keyFor(messages, invokeOpts);
			const entry = await cache.lookup(messages, invokeOpts);
			if (entry) {
				const cached = entry.response;
				// Cadence-faithful replay when both recorded chunks + delays are present.
				if (entry.streamChunks && entry.streamCadenceMs) {
					for (let i = 0; i < entry.streamChunks.length; i++) {
						const delay = entry.streamCadenceMs[i] ?? 0;
						const effective = replaySpeed > 0 ? delay / replaySpeed : 0;
						if (effective > 0) await sleepMs(effective);
						yield { type: "token", delta: entry.streamChunks[i]?.delta ?? "" };
					}
				} else if (cached.content) {
					yield { type: "token", delta: cached.content };
				}
				if (cached.usage) yield { type: "usage", usage: cached.usage };
				yield { type: "finish", reason: cached.finishReason ?? "stop" };
				return;
			}
			if (mode === "read-strict") throw new ReplayCacheMissError(key, "stream");
			// Miss: accumulate, store, re-yield.
			let content = "";
			let usage: LLMResponse["usage"] | undefined;
			let finishReason: string | undefined;
			const chunks: { delta: string }[] = [];
			const delaysMs: number[] = [];
			// Time-to-first-token (TTFT — provider latency / network / queue
			// warmup) is NOT cadence; setting lastNs inside the loop on first
			// chunk means chunk-0's delay is 0 (boundary-clean) and subsequent
			// delays measure only inter-chunk gaps. Use the central clock so
			// the scale matches every other cadence measurement in the library
			// and the module stays browser-safe (spec §5.11).
			let lastNs: number | undefined;
			for await (const delta of inner.stream(messages, invokeOpts)) {
				if (delta.type === "token") {
					content += delta.delta;
					if (captureStreamCadence) {
						const now = monotonicNs();
						const gap = lastNs === undefined ? 0 : (now - lastNs) / 1e6;
						delaysMs.push(gap);
						lastNs = now;
						chunks.push({ delta: delta.delta });
					}
				}
				if (delta.type === "usage") usage = delta.usage;
				if (delta.type === "finish") finishReason = delta.reason;
				yield delta;
			}
			if ((content || usage) && !isReadOnly) {
				const resp: LLMResponse = {
					content,
					usage: usage ?? { input: { regular: 0 }, output: { regular: 0 } },
					finishReason,
					model: inner.model ?? invokeOpts?.model ?? "",
					provider: inner.provider,
				};
				const entryToStore: CachedEntry = {
					response: resp,
					storedAtNs: wallClockNs(),
					...(captureStreamCadence ? { streamChunks: chunks, streamCadenceMs: delaysMs } : {}),
				};
				await cache.store(messages, invokeOpts, entryToStore);
			}
		},
	});
	withLayer(wrap, "withReplayCache", inner);
	return wrap;
}

// canonicalJson is no longer re-exported here — consumers import directly from
// @graphrefly/pure-ts/extra. The presentation-layer re-export caused a
// duplicate-export conflict at the root barrel level (A3 build gate).
