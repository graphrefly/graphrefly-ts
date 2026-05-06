/**
 * `fallbackAdapter` — fixture-backed {@link LLMAdapter} for offline demos,
 * deterministic tests, and graceful degradation in production.
 *
 * A peer of `anthropicAdapter` / `openAICompatAdapter` / `googleAdapter` /
 * `ollamaAdapter` / `dryRunAdapter`, but whose role is to serve pre-recorded
 * or canned responses when real providers aren't reachable. Install it as a
 * tier via the existing routing primitives (no new composer needed):
 *
 * ```ts
 * // Graceful offline fallback for a user app:
 * resilientAdapter(anthropicAdapter({ ... }), {
 *   fallback: fallbackAdapter({ fixturesDir: "./fixtures" }),
 * });
 *
 * // Or the general N-tier shape:
 * cascadingLlmAdapter([
 *   { name: "primary",  adapter: anthropicAdapter({ ... }) },
 *   { name: "fallback", adapter: fallbackAdapter({ fixturesDir: "./fixtures" }) },
 * ]);
 * ```
 *
 * The `provider` field is `"fallback"` so its role is self-documenting in
 * logs, stats, cost tables, and audit trails.
 *
 * ## Three fixture sources (mutually exclusive)
 *
 * Pick exactly one of:
 *
 * 1. **`fixtures: FallbackFixture[]`** — inline, hand-authored. Supports
 *    both hash-keyed and messages-keyed shapes; the adapter computes the
 *    canonical hash for messages-keyed entries at init time. Ideal when you
 *    want full control in code (tests, small demos).
 *
 * 2. **`fixturesStorage: KvStorageTier`** — the escape hatch for any backend.
 *    Pass a `memoryKv()`, `indexedDbKv(...)`, `sqliteKv(...)`,
 *    `cascadingCache(...)`, or a custom tier. You own the layout — no
 *    auto-namespacing.
 *
 *    **Filesystem directories (Node only):** the core `fallbackAdapter`
 *    does NOT import `node:fs` / `node:path` — it's safe to bundle for
 *    browsers. For a directory convenience, import `fallbackAdapter` from
 *    `@graphrefly/graphrefly/patterns/ai/node` (node subpath);
 *    that variant adds `fixturesDir: string` (auto-namespaced to
 *    `join(dir, keyPrefix)`, cache-format validated at init).
 *
 * ## Record mode
 *
 * `record: { adapter: real, storage }` proxies every call to `real` AND
 * persists the response through the provided tier. Use the node subpath's
 * `fallbackAdapter` for `record.dir` (auto-namespaced + `record.dir` defaults
 * to `fixturesDir` when both are file-backed).
 *
 * ## Three use cases, one implementation
 *
 * | Use case | Config |
 * |---|---|
 * | **User apps** — degrade when the cloud provider errors or network is down | `fallbackAdapter({ fixturesStorage: ... })` installed as a fallback tier |
 * | **Tests** — deterministic replays, fail loudly on miss | `fallbackAdapter({ fixturesStorage: ..., onMiss: "throw" })` |
 * | **Eval offline replay** — zero-spend repeat runs | `fallbackAdapter({ fixturesStorage: ... })` as the only adapter |
 *
 * ## Implementation
 *
 * Thin sugar over {@link withReplayCache}. Key shape comes from its
 * `canonicalJson` — fixtures written by either tool are interchangeable.
 *
 * @module
 */

import { wallClockNs } from "../../../../core/clock.js";
import { sha256Hex } from "../../../../core/hash.js";
import { type KvStorageTier, memoryKv } from "../../../../extra/storage-tiers.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	StreamDelta,
} from "../core/types.js";
import {
	canonicalJson,
	type ReplayCacheKeyContext,
	ReplayCacheMissError,
	withReplayCache,
} from "../middleware/replay-cache.js";
import { dryRunAdapter } from "./dry-run.js";

export type FallbackMissPolicy = "throw" | "respond";

/**
 * Thrown when `fallbackAdapter({ onMiss: "throw" })` receives a request that
 * has no matching fixture. Alias of `ReplayCacheMissError` for now — the
 * adapter is a thin sugar over `withReplayCache` and shares its miss-error.
 */
export const FallbackMissError = ReplayCacheMissError;
export type FallbackMissError = ReplayCacheMissError;

/**
 * One recorded fixture. Two authoring shapes:
 * - **Hash-keyed** — `{ key, response, stream? }`. Key is `sha256(canonicalJson({messages, opts}))`
 *   with `fallback:` prefix. This is what `record` mode writes.
 * - **Messages-keyed** — `{ messages, invokeOpts?, response }`. The adapter
 *   computes the key at init time. Ergonomic for hand-authored fixtures.
 */
export type FallbackFixture =
	| {
			readonly key: string;
			readonly response: LLMResponse;
			readonly stream?: {
				readonly chunks: readonly StreamDelta[];
				readonly delaysMs?: readonly number[];
			};
	  }
	| {
			readonly messages: readonly ChatMessage[];
			readonly invokeOpts?: Omit<LLMInvokeOptions, "signal">;
			readonly response: LLMResponse;
	  };

export interface FallbackAdapterOptions {
	/** Adapter provider label. Default `"fallback"`. */
	readonly provider?: string;
	/** Adapter model label. Default `"fallback"`. */
	readonly model?: string;
	/**
	 * Inline hand-authored fixtures. Supports both hash-keyed (`{key, response, stream?}`)
	 * and messages-keyed (`{messages, invokeOpts?, response}`) shapes — the adapter
	 * computes the canonical hash for messages-keyed entries at init time. Held in
	 * an internal `memoryKv`. Mutually exclusive with `fixturesDir` and
	 * `fixturesStorage`.
	 */
	readonly fixtures?: readonly FallbackFixture[];
	/**
	 * Bring-your-own `KvStorageTier` (`memoryKv`, `sqliteKv`,
	 * `indexedDbKv`, `cascadingCache`, or a custom tier). You own the
	 * layout — no auto-namespacing. Mutually exclusive with `fixtures`.
	 *
	 * For filesystem directories, use the node subpath's `fallbackAdapter`
	 * with its `fixturesDir` option (auto-namespaced + validated).
	 */
	readonly fixturesStorage?: KvStorageTier;
	/**
	 * Called on fixture miss when `onMiss === "respond"`. If not provided and
	 * `onMiss === "respond"`, a canned "service unavailable" response is
	 * returned (marked with `metadata.degraded: true`).
	 */
	readonly respond?: (
		messages: readonly ChatMessage[],
		opts?: LLMInvokeOptions,
	) => string | LLMResponse;
	/** Miss policy. Default `"respond"`. */
	readonly onMiss?: FallbackMissPolicy;
	/**
	 * Record mode. Proxies every call to `record.adapter` AND persists the
	 * result through `record.storage`. For filesystem `record.dir` convenience,
	 * use the node subpath's `fallbackAdapter`.
	 */
	readonly record?: {
		readonly adapter: LLMAdapter;
		readonly storage?: KvStorageTier;
	};
	/** Stream replay speed multiplier. See {@link withReplayCache}. Default `1`. */
	readonly replaySpeed?: number;
	/** Key prefix. Kept compatible with `withReplayCache` defaults. Default `"fallback"`. */
	readonly keyPrefix?: string;
	/**
	 * Custom key function — forwarded directly to the underlying
	 * {@link withReplayCache}. Use to shard fixtures by `invokeOpts.keyContext`
	 * (tenant, session, feature flag). Accepts either the new
	 * {@link ReplayCacheKeyContext} object form or the legacy 2-arg
	 * `(messages, opts?)` form.
	 */
	readonly keyFn?:
		| ((ctx: ReplayCacheKeyContext) => string)
		| ((messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => string);
}

// ---------------------------------------------------------------------------
// Canned degraded response
// ---------------------------------------------------------------------------

function degradedResponse(provider: string, model: string): LLMResponse {
	return {
		content: "[fallback: no cached response available for this request]",
		usage: { input: { regular: 0 }, output: { regular: 0 } },
		finishReason: "stop",
		model,
		provider,
		metadata: { degraded: true, reason: "no-fixture" },
	};
}

function normalizeRespondResult(
	raw: string | LLMResponse,
	provider: string,
	model: string,
): LLMResponse {
	if (typeof raw === "string") {
		return {
			content: raw,
			usage: { input: { regular: 0 }, output: { regular: 0 } },
			finishReason: "stop",
			model,
			provider,
			metadata: { degraded: true, reason: "respond" },
		};
	}
	return raw;
}

// ---------------------------------------------------------------------------
// Fixture → storage tier conversion
// ---------------------------------------------------------------------------

/**
 * Compute the key a `FallbackFixture` would hash to. Messages-keyed fixtures
 * get their key derived on the spot; hash-keyed fixtures pass through. Async
 * because `sha256Hex` uses `globalThis.crypto.subtle` (universal, no
 * `node:crypto` leak) — see {@link sha256Hex}.
 */
async function fixtureKey(fixture: FallbackFixture, keyPrefix: string): Promise<string> {
	if ("key" in fixture) return fixture.key;
	const canonical = canonicalJson({ messages: fixture.messages, opts: fixture.invokeOpts ?? {} });
	const hex = await sha256Hex(canonical);
	return `${keyPrefix}:${hex}`;
}

/**
 * `withReplayCache` stores values as `CachedEntry = { response, storedAtNs, streamChunks?, streamCadenceMs? }`.
 * Convert a `FallbackFixture` into that shape so inline fixtures can be
 * seeded into a memory tier alongside file-authored ones.
 */
function toCachedEntry(fixture: FallbackFixture): unknown {
	const base: { response: LLMResponse; storedAtNs: number } = {
		response: fixture.response,
		// Real timestamp so future TTL-aware tiers don't treat inline fixtures
		// as Epoch-old and evict them on first pass. Matches the wall-clock
		// write `withReplayCache` uses for disk-written entries.
		storedAtNs: wallClockNs(),
	};
	if ("key" in fixture && fixture.stream) {
		const tokenChunks = fixture.stream.chunks.filter(
			(c): c is Extract<StreamDelta, { type: "token" }> => c.type === "token",
		);
		return {
			...base,
			streamChunks: tokenChunks.map((c) => ({ delta: c.delta })),
			streamCadenceMs: fixture.stream.delaysMs ?? tokenChunks.map(() => 0),
		};
	}
	return base;
}

/**
 * Resolve the fixture source to a `KvStorageTier`. Enforces mutual exclusion
 * between `fixtures` and `fixturesStorage`. When `fixtures` is provided, the
 * seeded memory tier is returned synchronously but keys are populated
 * asynchronously via the returned seeding promise (await before first use).
 */
function resolveFixtureStorage(
	opts: FallbackAdapterOptions,
	keyPrefix: string,
): { tier: KvStorageTier | undefined; seedReady: Promise<void> } {
	const sources: string[] = [];
	if (opts.fixtures != null) sources.push("fixtures");
	if (opts.fixturesStorage != null) sources.push("fixturesStorage");
	if (sources.length > 1) {
		throw new TypeError(
			`fallbackAdapter: \`fixtures\` and \`fixturesStorage\` are mutually ` +
				`exclusive; got both ${sources.join(" and ")}. Pick one source. ` +
				`For filesystem directories use the node subpath's \`fallbackAdapter\`.`,
		);
	}
	if (opts.fixtures) {
		const tier = memoryKv();
		const fixtures = opts.fixtures;
		const seedReady = (async () => {
			for (const fixture of fixtures) {
				const key = await fixtureKey(fixture, keyPrefix);
				await tier.save(key, toCachedEntry(fixture));
			}
		})();
		// Attach a no-op catch so a failure inside the IIFE (e.g. `sha256Hex`
		// throws because `globalThis.crypto.subtle` is unavailable) does NOT
		// become an unhandled rejection when the adapter is constructed but
		// never invoked. V8 records the handler attachment via this branch
		// of the promise graph, so the Node `unhandledRejection` hook stays
		// silent — yet subsequent `await seedReady` inside `invoke`/`stream`
		// still throws the original error for the caller to see.
		seedReady.catch(() => {});
		return { tier, seedReady };
	}
	if (opts.fixturesStorage) return { tier: opts.fixturesStorage, seedReady: Promise.resolve() };
	return { tier: undefined, seedReady: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// fallbackAdapter
// ---------------------------------------------------------------------------

/**
 * Build a fixture-backed {@link LLMAdapter}. See module docs for use cases
 * (offline demo, tests, degraded-mode) and recipe snippets.
 */
export function fallbackAdapter(opts: FallbackAdapterOptions = {}): LLMAdapter {
	const provider = opts.provider ?? "fallback";
	const model = opts.model ?? "fallback";
	const onMiss: FallbackMissPolicy = opts.onMiss ?? "respond";
	const keyPrefix = opts.keyPrefix ?? "fallback";

	// Pick the inner leaf adapter based on mode.
	const leaf: LLMAdapter = (() => {
		if (opts.record) return opts.record.adapter;
		if (onMiss === "throw") {
			// `withReplayCache({ mode: "read-strict" })` throws on miss before
			// ever calling the inner. Supply a no-op to satisfy the type.
			return dryRunAdapter({
				provider,
				model,
				respond: () => "[unreachable: read-strict mode throws on miss]",
			});
		}
		// Custom leaf (not `dryRunAdapter`) so `metadata.degraded` is preserved
		// — `dryRunAdapter` returns a string and constructs its own response,
		// discarding our metadata. For the respond-on-miss path we want full
		// `LLMResponse` control.
		return {
			provider,
			model,
			async invoke(messages, invokeOpts): Promise<LLMResponse> {
				const raw = opts.respond
					? opts.respond(messages, invokeOpts)
					: degradedResponse(provider, model);
				return normalizeRespondResult(raw, provider, model);
			},
			async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
				const raw = opts.respond
					? opts.respond(messages, invokeOpts)
					: degradedResponse(provider, model);
				const r = normalizeRespondResult(raw, provider, model);
				yield { type: "token", delta: r.content };
				if (r.usage) yield { type: "usage", usage: r.usage };
				yield { type: "finish", reason: r.finishReason ?? "stop" };
			},
		} satisfies LLMAdapter;
	})();

	// Resolve the storage tier.
	// - `record` mode: require `record.storage`.
	// - Replay-only: `fixtures` seeds an in-memory tier (async) OR
	//   `fixturesStorage` passes through.
	let storage: KvStorageTier;
	let seedReady: Promise<void> = Promise.resolve();
	if (opts.record) {
		if (!opts.record.storage) {
			throw new TypeError(
				"fallbackAdapter: `record.storage` is required in record mode. For filesystem " +
					"`record.dir` convenience, use the node subpath's `fallbackAdapter`.",
			);
		}
		storage = opts.record.storage;
	} else {
		const resolved = resolveFixtureStorage(opts, keyPrefix);
		storage = resolved.tier ?? memoryKv();
		seedReady = resolved.seedReady;
	}

	const mode = opts.record ? "read-write" : onMiss === "throw" ? "read-strict" : "read";

	const cached = withReplayCache(leaf, {
		storage,
		mode,
		keyPrefix,
		cacheStreaming: true,
		captureStreamCadence: true,
		replaySpeed: opts.replaySpeed,
		...(opts.keyFn ? { keyFn: opts.keyFn } : {}),
	});

	// Wrap invoke/stream so the first call awaits the seed-complete Promise.
	// Adapter construction stays synchronous (`fallbackAdapter(...)` returns
	// immediately); inline fixture hashing happens lazily on first use.
	return {
		provider,
		model,
		capabilities: cached.capabilities?.bind(cached),
		async invoke(messages, invokeOpts): Promise<LLMResponse> {
			await seedReady;
			// `cached` came from `withReplayCache`, whose `invoke` always returns
			// `Promise<LLMResponse>`. The `LLMAdapter` interface types it as the
			// broader `NodeInput<LLMResponse>` union; narrow here to the actual
			// shape so the wrapper surface stays `Promise<LLMResponse>`.
			return cached.invoke(messages, invokeOpts) as Promise<LLMResponse>;
		},
		async *stream(messages, invokeOpts): AsyncGenerator<StreamDelta> {
			await seedReady;
			for await (const delta of cached.stream(messages, invokeOpts)) yield delta;
		},
	};
}
