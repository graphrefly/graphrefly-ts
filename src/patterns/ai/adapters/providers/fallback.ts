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
 * 2. **`fixturesDir: string`** — directory of cache-format JSON files, as
 *    written by `record` mode (or by `withReplayCache` with a shared prefix).
 *    Automatically namespaced to `join(dir, keyPrefix)` so multiple
 *    adapters pointing at the same root don't commingle files. An init-time
 *    validator throws a clear `TypeError` if the namespaced subdirectory
 *    contains files that aren't in cache format — hand-authored
 *    `{messages, response}` JSON files don't work here; use `fixtures: [...]`
 *    for hand-authoring.
 *
 * 3. **`fixturesStorage: StorageTier`** — advanced escape hatch for
 *    non-filesystem backends (`sqliteStorage` / `indexedDbStorage` / custom /
 *    cascading). Skips auto-namespacing — you own the layout.
 *
 * ## Record mode
 *
 * `record: { adapter: real, dir?, storage? }` proxies every call to `real`
 * AND persists the response. `record.dir` is auto-namespaced like
 * `fixturesDir`; `record.storage` is pass-through like `fixturesStorage`.
 * When `record.dir` is omitted and `fixturesDir` is set, `record.dir` defaults
 * to `fixturesDir` — the "read baseline, append misses to same dir" pattern.
 *
 * ## Three use cases, one implementation
 *
 * | Use case | Config |
 * |---|---|
 * | **User apps** — degrade when the cloud provider errors or network is down | `fallbackAdapter({ fixturesDir: ... })` installed as a fallback tier |
 * | **Tests** — deterministic replays, fail loudly on miss | `fallbackAdapter({ fixturesDir: ..., onMiss: "throw" })` |
 * | **Eval offline replay** — zero-spend repeat runs | `fallbackAdapter({ fixturesDir: "./fixtures" })` as the only adapter |
 *
 * ## Implementation
 *
 * Thin sugar over {@link withReplayCache}. Key shape comes from its
 * `canonicalJson` — fixtures written by either tool are interchangeable
 * (provided `fixturesDir` points at the matching namespaced subdirectory).
 *
 * @module
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { wallClockNs } from "../../../../core/clock.js";
import { fileStorage, memoryStorage, type StorageTier } from "../../../../extra/storage.js";
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
	 * an internal `memoryStorage`. Mutually exclusive with `fixturesDir` and
	 * `fixturesStorage`.
	 */
	readonly fixtures?: readonly FallbackFixture[];
	/**
	 * Directory of cache-format JSON files. Automatically namespaced to
	 * `join(dir, keyPrefix)` so multiple adapters pointing at the same root
	 * don't commingle files. An init-time validator throws a clear `TypeError`
	 * if the namespaced subdirectory contains files that aren't in cache
	 * format — hand-authored `{messages, response}` JSON files don't work
	 * here; use `fixtures: [...]` for hand-authoring. Mutually exclusive with
	 * `fixtures` and `fixturesStorage`.
	 */
	readonly fixturesDir?: string;
	/**
	 * Advanced: bring-your-own `StorageTier` (`memoryStorage`, `sqliteStorage`,
	 * `indexedDbStorage`, `cascadingCache`, or a custom tier). Skips
	 * auto-namespacing — you own the layout. 95% of users don't need this;
	 * use `fixtures` or `fixturesDir` instead. Mutually exclusive with
	 * `fixtures` and `fixturesDir`.
	 */
	readonly fixturesStorage?: StorageTier;
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
	 * result. `record.dir` is auto-namespaced like `fixturesDir`; `record.storage`
	 * is pass-through like `fixturesStorage`. If `record.dir` is omitted but
	 * `fixturesDir` is set, record defaults to writing to `fixturesDir` — the
	 * natural "read baseline, append misses to same dir" pattern.
	 */
	readonly record?: {
		readonly adapter: LLMAdapter;
		readonly dir?: string;
		/** Override the storage tier directly (mutually exclusive with `dir`). */
		readonly storage?: StorageTier;
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
 * get their key derived on the spot; hash-keyed fixtures pass through.
 */
function fixtureKey(fixture: FallbackFixture, keyPrefix: string): string {
	if ("key" in fixture) return fixture.key;
	const canonical = canonicalJson({ messages: fixture.messages, opts: fixture.invokeOpts ?? {} });
	return `${keyPrefix}:${createHash("sha256").update(canonical).digest("hex")}`;
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
 * Validate that a namespaced `fixturesDir` subdirectory only contains files
 * in the cache format `withReplayCache` writes. Throws a clear `TypeError`
 * if a hand-authored `{messages, response}` JSON (or any non-cache JSON) is
 * present. Scans the first `.json` file found — doesn't read the whole set.
 * Silently returns if the directory doesn't exist yet (first-run case).
 */
function validateDirShape(dir: string): void {
	if (!existsSync(dir)) return;
	const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) return;
	const sample = files[0] as string;
	const path = join(dir, sample);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new TypeError(`fallbackAdapter: ${path} is not valid JSON (${(err as Error).message}).`);
	}
	const asObj = raw as {
		response?: { content?: unknown };
		storedAtNs?: unknown;
		messages?: unknown;
	} | null;
	// Cache format requires both `response.content` (string) and `storedAtNs`
	// (number). A top-level `messages` field is a dead giveaway for a
	// hand-authored `FallbackFixture` shape dropped into the directory by
	// mistake — reject eagerly with a pointed error message.
	const looksLikeHandAuthored = asObj != null && "messages" in asObj;
	const missingFields =
		asObj == null ||
		typeof asObj.response?.content !== "string" ||
		typeof asObj.storedAtNs !== "number";
	if (looksLikeHandAuthored || missingFields) {
		const hint = looksLikeHandAuthored
			? "`messages` at the top level means this looks hand-authored. "
			: "";
		throw new TypeError(
			`fallbackAdapter: ${path} is not in cache-file format. ${hint}` +
				"Expected `{ response: { content, usage, ... }, storedAtNs, ... }` " +
				"(the shape `withReplayCache` and this adapter's `record` mode write). " +
				"For hand-authored fixtures, use the inline `fixtures: FallbackFixture[]` " +
				"option — the adapter hashes messages for you.",
		);
	}
}

/**
 * Resolve the fixture source to a `StorageTier`. Enforces mutual exclusion
 * between `fixtures`, `fixturesDir`, and `fixturesStorage`. Auto-namespaces
 * `fixturesDir` to `join(dir, keyPrefix)` to prevent commingling when
 * multiple adapters share a root directory.
 */
function resolveFixtureStorage(
	opts: FallbackAdapterOptions,
	keyPrefix: string,
): StorageTier | undefined {
	const sources: string[] = [];
	if (opts.fixtures != null) sources.push("fixtures");
	if (opts.fixturesDir != null) sources.push("fixturesDir");
	if (opts.fixturesStorage != null) sources.push("fixturesStorage");
	if (sources.length > 1) {
		throw new TypeError(
			`fallbackAdapter: \`fixtures\`, \`fixturesDir\`, and \`fixturesStorage\` ` +
				`are mutually exclusive; got both ${sources.join(" and ")}. Pick one source.`,
		);
	}
	if (opts.fixtures) {
		const tier = memoryStorage();
		for (const fixture of opts.fixtures) {
			const key = fixtureKey(fixture, keyPrefix);
			tier.save(key, toCachedEntry(fixture));
		}
		return tier;
	}
	if (opts.fixturesDir != null) {
		const namespaced = join(opts.fixturesDir, keyPrefix);
		validateDirShape(namespaced);
		return fileStorage(namespaced);
	}
	if (opts.fixturesStorage) return opts.fixturesStorage;
	return undefined;
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
				yield { type: "usage", usage: r.usage };
				yield { type: "finish", reason: r.finishReason ?? "stop" };
			},
		} satisfies LLMAdapter;
	})();

	// Resolve the storage tier. Precedence:
	// - `record` mode: `record.storage` (pass-through) OR `record.dir` (auto-
	//   namespaced) OR — as a convenience — defaults to `fixturesDir` when
	//   that's set too, enabling the "read baseline, append to same dir" pattern.
	// - Replay-only: whichever of `fixtures` / `fixturesDir` / `fixturesStorage`
	//   is set. Mutually exclusive; validator throws in `resolveFixtureStorage`.
	let storage: StorageTier;
	if (opts.record) {
		if (opts.record.storage && opts.record.dir) {
			throw new TypeError(
				"fallbackAdapter: `record.storage` and `record.dir` are mutually exclusive; pick one.",
			);
		}
		if (opts.record.storage) {
			storage = opts.record.storage;
		} else {
			const recordDir = opts.record.dir ?? opts.fixturesDir;
			if (recordDir == null) {
				throw new TypeError(
					"fallbackAdapter: record mode requires either `record.dir`, `record.storage`, " +
						"or an inherited `fixturesDir`.",
				);
			}
			storage = fileStorage(join(recordDir, keyPrefix));
		}
	} else {
		storage = resolveFixtureStorage(opts, keyPrefix) ?? memoryStorage();
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

	// Stamp the "fallback" provider/model labels for observability.
	return {
		...cached,
		provider,
		model,
	};
}
