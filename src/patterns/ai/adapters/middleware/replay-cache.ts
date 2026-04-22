/**
 * `withReplayCache` — content-addressed response cache over `StorageTier`.
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
 * Reuses the library's existing `StorageTier` abstraction — the same tiers
 * that power `Graph.attachStorage` (memory / file / sqlite / indexeddb / custom).
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

import { createHash } from "node:crypto";
import { wallClockNs } from "../../../../core/clock.js";
import { singleFromAny } from "../../../../extra/single-from-any.js";
import type { StorageTier } from "../../../../extra/storage.js";
import { ResettableTimer } from "../../../../extra/timer.js";
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
	storage: StorageTier;
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
		| ((ctx: ReplayCacheKeyContext) => string)
		| ((messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => string);
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

/** Wrap an adapter with a replay cache. */
export function withReplayCache(inner: LLMAdapter, opts: WithReplayCacheOptions): LLMAdapter {
	const mode = opts.mode ?? "read-write";
	const cacheStreaming = opts.cacheStreaming ?? false;
	const captureStreamCadence = opts.captureStreamCadence ?? false;
	const replaySpeed = opts.replaySpeed ?? 1;
	const keyPrefix = opts.keyPrefix ?? "llm-replay";
	const tier = opts.storage;
	const isReadOnly = mode === "read" || mode === "read-strict";

	const makeKey = (
		messages: readonly ChatMessage[],
		invokeOpts: LLMInvokeOptions | undefined,
	): string => {
		if (opts.keyFn) {
			// Arity-dispatch: 1-arg form receives the ctx object; 2-arg
			// legacy form receives (messages, opts). Functions with 1 param
			// (`Function.length === 1`) take the ctx shape.
			const kf = opts.keyFn;
			if (kf.length <= 1) {
				const ctxKey: ReplayCacheKeyContext = {
					messages,
					opts: invokeOpts,
					context: invokeOpts?.keyContext,
				};
				return `${keyPrefix}:${(kf as (ctx: ReplayCacheKeyContext) => string)(ctxKey)}`;
			}
			return `${keyPrefix}:${(kf as (m: readonly ChatMessage[], o?: LLMInvokeOptions) => string)(messages, invokeOpts)}`;
		}
		// Default keying: drop `signal` (AbortSignal is not serializable) and
		// `keyContext` (per-call context should not affect the default hash —
		// it only matters when a user opts in via `keyFn`).
		const { signal: _signal, keyContext: _keyContext, ...rest } = invokeOpts ?? {};
		const canonical = canonicalJson({ messages, opts: rest });
		return `${keyPrefix}:${createHash("sha256").update(canonical).digest("hex")}`;
	};

	const readEntry = async (key: string): Promise<CachedEntry | undefined> => {
		if (mode === "write-only") return undefined;
		const raw = await tier.load(key);
		if (raw == null) return undefined;
		try {
			return (typeof raw === "string" ? JSON.parse(raw) : raw) as CachedEntry;
		} catch {
			return undefined;
		}
	};

	const readCache = async (key: string): Promise<LLMResponse | undefined> => {
		const entry = await readEntry(key);
		return entry?.response;
	};

	const writeCache = async (
		key: string,
		resp: LLMResponse,
		streamCadence?: { chunks: ReadonlyArray<{ delta: string }>; delaysMs: readonly number[] },
	): Promise<void> => {
		if (isReadOnly) return;
		const entry: CachedEntry = {
			response: resp,
			storedAtNs: wallClockNs(),
			...(streamCadence
				? { streamChunks: streamCadence.chunks, streamCadenceMs: streamCadence.delaysMs }
				: {}),
		};
		await tier.save(key, entry as unknown as Parameters<typeof tier.save>[1]);
	};

	const sleepMs = (ms: number): Promise<void> =>
		ms <= 0
			? Promise.resolve()
			: new Promise<void>((resolve) => {
					const t = new ResettableTimer();
					t.start(ms, () => resolve());
				});

	// Singleflight — concurrent cache-miss requests with the same key share one upstream call.
	const upstreamInFlight = singleFromAny<ResolveArgs, LLMResponse>(
		async ({ messages, invokeOpts }) => {
			const respInput = inner.invoke(messages, invokeOpts);
			return await resolveResponse(respInput);
		},
		{ keyFn: ({ messages, invokeOpts }) => makeKey(messages, invokeOpts) },
	);

	return {
		provider: inner.provider,
		model: inner.model,
		capabilities: inner.capabilities?.bind(inner),

		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			const key = makeKey(messages, invokeOpts);
			const cached = await readCache(key);
			if (cached)
				return { ...cached, metadata: { ...(cached.metadata ?? {}), replayCache: "hit" } };

			if (mode === "read-strict") throw new ReplayCacheMissError(key, "invoke");
			const resp = await upstreamInFlight({ messages, invokeOpts });
			await writeCache(key, resp);
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
			const key = makeKey(messages, invokeOpts);
			const entry = await readEntry(key);
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
			// delays measure only inter-chunk gaps.
			let lastNs: bigint | undefined;
			for await (const delta of inner.stream(messages, invokeOpts)) {
				if (delta.type === "token") {
					content += delta.delta;
					if (captureStreamCadence) {
						const now = process.hrtime.bigint();
						const gap = lastNs === undefined ? 0 : Number(now - lastNs) / 1_000_000;
						delaysMs.push(gap);
						lastNs = now;
						chunks.push({ delta: delta.delta });
					}
				}
				if (delta.type === "usage") usage = delta.usage;
				if (delta.type === "finish") finishReason = delta.reason;
				yield delta;
			}
			// Persist when ANY meaningful output was produced — not only on
			// `usage` frames. Many providers stream tokens + finish but never
			// emit a usage frame (OpenAI without `stream_options.include_usage`);
			// gating on `usage` would silently drop every such response from
			// the cache. Caller replay tolerates `usage: undefined` — the
			// `yield {type: "usage", ...}` branch on replay is already gated
			// on `cached.usage` being present.
			if (content || usage) {
				const resp: LLMResponse = {
					content,
					// LLMResponse requires a usage shape; stub zero when the
					// provider didn't report one. Callers that care can
					// distinguish a real zero from "not reported" via the
					// cached entry's raw metadata if needed.
					usage: usage ?? { input: { regular: 0 }, output: { regular: 0 } },
					finishReason,
					model: inner.model ?? invokeOpts?.model ?? "",
					provider: inner.provider,
				};
				await writeCache(key, resp, captureStreamCadence ? { chunks, delaysMs } : undefined);
			}
		},
	};
}

/**
 * Canonical JSON — sorts object keys for stable sha256 while detecting true
 * cycles (not sibling shared refs).
 *
 * We recurse manually with a **path stack** (`seen` contains only the current
 * ancestor chain, not every previously-visited object). On enter we push; on
 * exit we pop. Back-edges to ancestors serialize as `{"__cycle": true}`;
 * siblings that share the same reference (legitimate for JSON Schema
 * fragments reused across tool definitions) serialize normally, producing
 * identical hashes to a freshly-reconstructed equivalent.
 *
 * Exported so `fallbackAdapter` (and other cache-adjacent code) can share
 * the same key shape — fixtures produced by either tool stay interchangeable.
 */
export function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();

	const canon = (v: unknown): unknown => {
		if (v === null || typeof v !== "object") return v;
		const obj = v as object;
		if (ancestors.has(obj)) return { __cycle: true };
		ancestors.add(obj);
		try {
			if (Array.isArray(v)) {
				return (v as readonly unknown[]).map(canon);
			}
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(v as Record<string, unknown>).sort()) {
				out[k] = canon((v as Record<string, unknown>)[k]);
			}
			return out;
		} finally {
			ancestors.delete(obj);
		}
	};

	return JSON.stringify(canon(value));
}

async function resolveResponse(input: unknown): Promise<LLMResponse> {
	if (input != null && typeof (input as PromiseLike<LLMResponse>).then === "function") {
		return await (input as PromiseLike<LLMResponse>);
	}
	if (input && typeof input === "object" && "content" in (input as object)) {
		return input as LLMResponse;
	}
	throw new Error(
		"withReplayCache: adapter.invoke must return Promise or LLMResponse (Node input not supported in cache path)",
	);
}
