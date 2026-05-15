/**
 * LLM-specific content-addressed cache wrapper over the generic
 * {@link contentAddressedStorage} substrate in `src/extra/`. Handles the
 * ChatMessage + LLMInvokeOptions → stable key shape that both
 * `withReplayCache` and `fallbackAdapter` need, so the two middleware files
 * don't drift on key construction.
 *
 * The generic substrate does the sha256 + canonicalJson + tier IO; this
 * wrapper owns:
 * - Stripping non-serializable `signal` (AbortSignal) and `keyContext`
 *   (caller-opaque context) from the default key.
 * - Arity-dispatched legacy `keyFn` support (1-arg ctx-object form vs 2-arg
 *   `(messages, opts)` form).
 * - LLM-conventional `llm-replay` default key prefix (override via `keyPrefix`).
 *
 * @module
 */

import type { KvStorageTier } from "@graphrefly/pure-ts/extra";
import {
	type ContentAddressedMode,
	type ContentAddressedStorage,
	contentAddressedStorage,
} from "@graphrefly/pure-ts/extra";
import type { ChatMessage, LLMInvokeOptions } from "../core/types.js";

/**
 * Context object passed to the 1-arg {@link ContentAddressedCacheOptions.keyFn}
 * form. Adding fields here is forward-compatible — existing 1-arg consumers
 * that ignore unknowns keep working.
 */
export interface LLMCacheKeyContext {
	readonly messages: readonly ChatMessage[];
	readonly opts: LLMInvokeOptions | undefined;
	/** Shortcut to `opts?.keyContext` — no extra guard in callers. */
	readonly context: unknown;
}

export interface ContentAddressedCacheOptions<V> {
	storage: KvStorageTier;
	mode?: ContentAddressedMode;
	/**
	 * Custom key function. Receives either {@link LLMCacheKeyContext} (1-arg
	 * form) or `(messages, opts?)` (legacy 2-arg form) — the wrapper dispatches
	 * on `Function.length`. Return `string` or `Promise<string>`.
	 */
	keyFn?:
		| ((ctx: LLMCacheKeyContext) => string | Promise<string>)
		| ((messages: readonly ChatMessage[], opts?: LLMInvokeOptions) => string | Promise<string>);
	/** Prefix applied as `${keyPrefix}:${hash}`. Default `"llm-replay"`. */
	keyPrefix?: string;
	/**
	 * Optional value type hint — callers may store anything JSON-serializable.
	 * `withReplayCache` stores `CachedEntry` (response + stream cadence);
	 * `fallbackAdapter` stores the raw `LLMResponse`.
	 */
	_valueType?: V;
}

/** Handle returned by {@link contentAddressedCache}. */
export interface ContentAddressedCache<V> {
	keyFor(messages: readonly ChatMessage[], invokeOpts?: LLMInvokeOptions): Promise<string>;
	lookup(messages: readonly ChatMessage[], invokeOpts?: LLMInvokeOptions): Promise<V | undefined>;
	store(
		messages: readonly ChatMessage[],
		invokeOpts: LLMInvokeOptions | undefined,
		value: V,
	): Promise<void>;
	forget(messages: readonly ChatMessage[], invokeOpts?: LLMInvokeOptions): Promise<void>;
}

/**
 * Builds an LLM-shaped content-addressed cache over `storage`. Default keying
 * hashes `(messages, opts minus signal/keyContext)` via
 * {@link contentAddressedStorage} — the generic extra-tier substrate.
 *
 * Used by `withReplayCache` (full response cache) and `fallbackAdapter`
 * (fixture lookup). Both consumers wrap this to add their divergent features
 * (singleflight / stream cadence / canned miss response) around the shared
 * substrate.
 *
 * @category internal
 */
export function contentAddressedCache<V>(
	opts: ContentAddressedCacheOptions<V>,
): ContentAddressedCache<V> {
	const { storage, mode = "read-write", keyFn, keyPrefix = "llm-replay" } = opts;

	// Substrate mode: translate `"read-strict"` to `"read"` so the substrate
	// returns `undefined` on miss. The LLM-middleware callers (`withReplayCache`,
	// `fallbackAdapter`) own the strict-mode throw because they emit
	// domain-specific error types (`ReplayCacheMissError` / `FallbackMissError`)
	// that carry context the substrate shouldn't know about.
	const substrateMode = mode === "read-strict" ? "read" : mode;

	// When `keyFn` is supplied, we wire it through the substrate's raw-key API
	// (via a synthesized keyContext passthrough). When omitted, we let the
	// substrate hash the default shape (messages + opts minus non-serializable
	// fields) with the standard prefix.
	const substrate: ContentAddressedStorage<
		{ messages: readonly ChatMessage[]; opts: LLMInvokeOptions | undefined },
		V
	> = contentAddressedStorage({
		storage,
		keyPrefix,
		mode: substrateMode,
		keyContext: ({ messages, opts: invokeOpts }) => {
			// Drop `signal` (not serializable) and `keyContext` (caller-opaque
			// context should only participate when user opts in via keyFn).
			const { signal: _signal, keyContext: _keyContext, ...rest } = invokeOpts ?? {};
			return { messages, opts: rest };
		},
	});

	async function keyFor(
		messages: readonly ChatMessage[],
		invokeOpts?: LLMInvokeOptions,
	): Promise<string> {
		if (keyFn) {
			// Arity-dispatch: Function.length === 1 → ctx-object form;
			// otherwise → legacy 2-arg (messages, opts). Both may return
			// sync or async strings.
			if (keyFn.length <= 1) {
				const ctx: LLMCacheKeyContext = {
					messages,
					opts: invokeOpts,
					context: invokeOpts?.keyContext,
				};
				const raw = await (keyFn as (c: LLMCacheKeyContext) => string | Promise<string>)(ctx);
				return `${keyPrefix}:${raw}`;
			}
			const raw = await (
				keyFn as (m: readonly ChatMessage[], o?: LLMInvokeOptions) => string | Promise<string>
			)(messages, invokeOpts);
			return `${keyPrefix}:${raw}`;
		}
		return substrate.keyFor({ messages, opts: invokeOpts });
	}

	return {
		keyFor,

		async lookup(messages, invokeOpts) {
			if (mode === "write") return undefined;
			if (keyFn) {
				// Custom keyFn path: we can't use substrate.lookup (it hashes
				// from its own keyContext). Build the key ourselves and load.
				// Strict-mode throw is the CALLER'S responsibility — we return
				// undefined on miss so callers can wrap the throw with their
				// domain-specific error type.
				const key = await keyFor(messages, invokeOpts);
				const raw = await storage.load(key);
				if (raw === undefined) return undefined;
				return raw as V;
			}
			return substrate.lookup({ messages, opts: invokeOpts });
		},

		async store(messages, invokeOpts, value) {
			if (mode === "read") return;
			if (keyFn) {
				const key = await keyFor(messages, invokeOpts);
				await storage.save(key, value as unknown);
				return;
			}
			await substrate.store({ messages, opts: invokeOpts }, value);
		},

		async forget(messages, invokeOpts) {
			if (mode === "read" || mode === "write") return;
			if (!storage.delete) return;
			if (keyFn) {
				const key = await keyFor(messages, invokeOpts);
				await storage.delete(key);
				return;
			}
			await substrate.forget({ messages, opts: invokeOpts });
		},
	};
}
