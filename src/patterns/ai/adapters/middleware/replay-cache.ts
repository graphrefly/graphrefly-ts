/**
 * `withReplayCache` — content-addressed response cache over `StorageTier`.
 *
 * - Key: sha256 of canonicalized (messages + invoke options minus `signal`).
 * - `"read-write"` (default): returns cached response if present; on miss,
 *   passes through and stores the result.
 * - `"write-only"`: never reads; populates the cache for later runs.
 * - `"read"`: reads only; on miss, passes through without writing.
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
 */

import { createHash } from "node:crypto";
import { wallClockNs } from "../../../../core/clock.js";
import { singleFromAny } from "../../../../extra/single-from-any.js";
import type { StorageTier } from "../../../../extra/storage.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
} from "../core/types.js";

export type ReplayCacheMode = "read" | "write-only" | "read-write";

export interface WithReplayCacheOptions {
	storage: StorageTier;
	mode?: ReplayCacheMode;
	/** Custom key function (defaults to sha256 of canonical JSON). */
	keyFn?: (messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => string;
	/** Prefix for cached keys (useful when sharing a tier across domains). */
	keyPrefix?: string;
	/**
	 * Whether to cache streaming responses (by consuming the full stream
	 * and replaying it as one synthetic token chunk). Default `false`.
	 */
	cacheStreaming?: boolean;
}

interface CachedEntry {
	response: LLMResponse;
	storedAtNs: number;
}

type ResolveArgs = {
	messages: readonly ChatMessage[];
	invokeOpts: LLMInvokeOptions | undefined;
};

/** Wrap an adapter with a replay cache. */
export function withReplayCache(inner: LLMAdapter, opts: WithReplayCacheOptions): LLMAdapter {
	const mode = opts.mode ?? "read-write";
	const cacheStreaming = opts.cacheStreaming ?? false;
	const keyPrefix = opts.keyPrefix ?? "llm-replay";
	const tier = opts.storage;

	const makeKey = (
		messages: readonly ChatMessage[],
		invokeOpts: LLMInvokeOptions | undefined,
	): string => {
		if (opts.keyFn) return `${keyPrefix}:${opts.keyFn(messages, invokeOpts)}`;
		const { signal: _signal, ...rest } = invokeOpts ?? {};
		const canonical = canonicalJson({ messages, opts: rest });
		return `${keyPrefix}:${createHash("sha256").update(canonical).digest("hex")}`;
	};

	const readCache = async (key: string): Promise<LLMResponse | undefined> => {
		if (mode === "write-only") return undefined;
		const raw = await tier.load(key);
		if (raw == null) return undefined;
		try {
			const entry = (typeof raw === "string" ? JSON.parse(raw) : raw) as CachedEntry;
			return entry?.response;
		} catch {
			return undefined;
		}
	};

	const writeCache = async (key: string, resp: LLMResponse): Promise<void> => {
		if (mode === "read") return;
		const entry: CachedEntry = { response: resp, storedAtNs: wallClockNs() };
		await tier.save(key, entry as unknown as Parameters<typeof tier.save>[1]);
	};

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

			const resp = await upstreamInFlight({ messages, invokeOpts });
			await writeCache(key, resp);
			return resp;
		},

		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			if (!cacheStreaming) {
				for await (const delta of inner.stream(messages, invokeOpts)) yield delta;
				return;
			}
			const key = makeKey(messages, invokeOpts);
			const cached = await readCache(key);
			if (cached) {
				if (cached.content) yield { type: "token", delta: cached.content };
				if (cached.usage) yield { type: "usage", usage: cached.usage };
				yield { type: "finish", reason: cached.finishReason ?? "stop" };
				return;
			}
			// Miss: accumulate, store, re-yield.
			let content = "";
			let usage: LLMResponse["usage"] | undefined;
			let finishReason: string | undefined;
			for await (const delta of inner.stream(messages, invokeOpts)) {
				if (delta.type === "token") content += delta.delta;
				if (delta.type === "usage") usage = delta.usage;
				if (delta.type === "finish") finishReason = delta.reason;
				yield delta;
			}
			if (usage) {
				const resp: LLMResponse = {
					content,
					usage,
					finishReason,
					model: inner.model ?? invokeOpts?.model ?? "",
					provider: inner.provider,
				};
				await writeCache(key, resp);
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
 */
function canonicalJson(value: unknown): string {
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
