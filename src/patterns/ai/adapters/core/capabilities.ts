/**
 * Pluggable model capabilities (roadmap §9.3d).
 *
 * The library defines the **shape** of what's knowable about a model
 * (context window, rate limits, features, pricing reference) and provides
 * a registry factory. Capability **data** is user-supplied — no baked-in
 * tables, no drift-prone catalog.
 */

import type { Node } from "../../../../core/node.js";
import { derived } from "../../../../core/sugar.js";
import { reactiveMap } from "../../../../extra/reactive-map.js";
import type { ModelPricing } from "./pricing.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Rate and size limits for a single model at the user's service tier.
 *
 * Where providers expose distinct standard / batch / flex limits, register
 * each as a separate model id with its own `ModelLimits`.
 */
export interface ModelLimits {
	/** Total tokens the model can process per request (input + output). */
	contextWindow?: number;
	/** Max input tokens if distinct from contextWindow. */
	maxInputTokens?: number;
	/** Max generated output tokens (excludes reasoning unless provider folds them). */
	maxOutputTokens?: number;
	/** Max reasoning/thinking tokens budget. */
	maxReasoningTokens?: number;
	/** Minimum prompt size for prompt caching to activate. */
	minCacheTokens?: number;
	/** Requests-per-minute rate limit. */
	rpm?: number;
	/** Requests-per-day rate limit. */
	rpd?: number;
	/** Tokens-per-minute rate limit (input + output, per provider convention). */
	tpm?: number;
	/** Tokens-per-day rate limit. */
	tpd?: number;
	/** Max concurrent in-flight requests. */
	concurrentRequests?: number;
	/** Provider-specific limits not covered above. */
	extensions?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export interface ModelFeatures {
	toolUse?: boolean;
	vision?: boolean;
	audioInput?: boolean;
	audioOutput?: boolean;
	reasoning?: boolean;
	streaming?: boolean;
	promptCache?: boolean;
	batchApi?: boolean;
	/** Provider-specific feature flags. */
	extensions?: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// ModelCapabilities
// ---------------------------------------------------------------------------

/** Static facts about a model. Pricing is optional; keep a separate registry if preferred. */
export interface ModelCapabilities {
	id: string;
	provider: string;
	pricing?: ModelPricing;
	limits?: ModelLimits;
	features?: ModelFeatures;
	/** Free-form metadata (release date, deprecation flag, provider notes). */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CapabilitiesRegistry
// ---------------------------------------------------------------------------

export interface CapabilitiesRegistry {
	lookup(provider: string, model: string): ModelCapabilities | undefined;
	register(cap: ModelCapabilities): void;
	remove(provider: string, model: string): boolean;
	entries(): IterableIterator<ModelCapabilities>;
	// Reactive views (Unit 10 Q4) ---------------------------------------------
	/**
	 * Reactive view of `(provider, model)` → `ModelCapabilities`. Re-emits
	 * whenever any `register()` / `remove()` touches the underlying store, so
	 * UIs and gated middleware (capability-aware retry, feature flags) can
	 * subscribe instead of polling. Prefix fallback mirrors the imperative
	 * `lookup()`: exact match first, then longest-prefix within provider.
	 */
	lookupNode(provider: string, model: string): Node<ModelCapabilities | undefined>;
	/** Reactive view of every registered entry. */
	readonly entriesNode: Node<readonly ModelCapabilities[]>;
	/** Reactive slice of entries for a single provider. */
	byProvider(provider: string): Node<readonly ModelCapabilities[]>;
}

function capKey(provider: string, model: string): string {
	return `${provider}::${model}`;
}

/** Create a fresh `CapabilitiesRegistry`. Optionally seed with entries. */
export function createCapabilitiesRegistry(
	initial?: readonly ModelCapabilities[],
): CapabilitiesRegistry {
	// Reactive storage (Unit 10 Q4). We keep the imperative `lookup` fast path
	// (O(1) exact match + prefix fallback) by reading the bundle's snapshot via
	// `.cache`. Reactive views (`lookupNode`, `entriesNode`, `byProvider`) are
	// `derived` nodes over the bundle's `entries` node.
	const bundle = reactiveMap<string, ModelCapabilities>({
		name: "capabilitiesRegistry",
	});

	const register = (cap: ModelCapabilities): void => {
		bundle.set(capKey(cap.provider, cap.id), cap);
	};

	if (initial) for (const cap of initial) register(cap);

	const lookupSync = (provider: string, model: string): ModelCapabilities | undefined => {
		const exact = bundle.get(capKey(provider, model));
		if (exact) return exact;
		// Prefix fallback within provider via snapshot iteration. The fast
		// path (`maxSize` unset → all entries live) keeps this O(|models|).
		const snapshot = bundle.entries.cache;
		if (!snapshot) return undefined;
		let best: ModelCapabilities | undefined;
		for (const [, cap] of snapshot) {
			if (cap.provider !== provider) continue;
			const candidate = cap.id;
			if (model.startsWith(candidate)) {
				if (!best || candidate.length > best.id.length) {
					best = cap;
				}
			}
		}
		return best;
	};

	// Reactive views — derived over the bundle's entries snapshot. Caches
	// per-(provider, model) pair so re-invoking `lookupNode("anthropic", "X")`
	// returns the same node (keepalive stays attached, no churn).
	//
	// LRU cap protects callers that mint `lookupNode(provider, userSupplied)`
	// from unbounded growth. Native `Map` insertion-order iteration gives us
	// O(1) eviction: the oldest insertion is the first key. 128 is large
	// enough to cover realistic provider × model combos (every shipped
	// Anthropic / OpenAI / Google model fits well under this).
	const LOOKUP_CACHE_MAX = 128;
	const lookupCache = new Map<string, Node<ModelCapabilities | undefined>>();
	const byProviderCache = new Map<string, Node<readonly ModelCapabilities[]>>();
	const lruTouch = <V>(cache: Map<string, V>, key: string, value: V, max: number): void => {
		// Delete-then-reinsert moves the key to the LRU end; evict the oldest
		// (first-inserted) entry when we overflow.
		if (cache.has(key)) cache.delete(key);
		cache.set(key, value);
		while (cache.size > max) {
			const oldest = cache.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	};

	const entriesNode = derived<readonly ModelCapabilities[]>(
		[bundle.entries],
		([snapshot]) => Array.from((snapshot as ReadonlyMap<string, ModelCapabilities>).values()),
		{ name: "capabilitiesRegistry/entries", initial: [] },
	);

	return {
		register,
		lookup: lookupSync,
		remove(provider, model) {
			const existed = bundle.has(capKey(provider, model));
			if (existed) bundle.delete(capKey(provider, model));
			return existed;
		},
		entries() {
			// Snapshot via bundle — matches legacy behavior.
			const snapshot = bundle.entries.cache;
			return (function* () {
				if (!snapshot) return;
				for (const cap of snapshot.values()) yield cap;
			})();
		},
		lookupNode(provider, model) {
			const cacheKey = capKey(provider, model);
			const cached = lookupCache.get(cacheKey);
			if (cached) {
				// LRU touch: move to end so it survives eviction.
				lookupCache.delete(cacheKey);
				lookupCache.set(cacheKey, cached);
				return cached;
			}
			const node = derived<ModelCapabilities | undefined>(
				[bundle.entries],
				() => lookupSync(provider, model),
				{
					name: `capabilitiesRegistry/lookup/${provider}::${model}`,
					initial: undefined,
				},
			);
			lruTouch(lookupCache, cacheKey, node, LOOKUP_CACHE_MAX);
			return node;
		},
		entriesNode,
		byProvider(provider) {
			const cached = byProviderCache.get(provider);
			if (cached) {
				byProviderCache.delete(provider);
				byProviderCache.set(provider, cached);
				return cached;
			}
			const node = derived<readonly ModelCapabilities[]>(
				[entriesNode],
				([entries]) =>
					(entries as readonly ModelCapabilities[]).filter((c) => c.provider === provider),
				{
					name: `capabilitiesRegistry/byProvider/${provider}`,
					initial: [],
				},
			);
			lruTouch(byProviderCache, provider, node, LOOKUP_CACHE_MAX);
			return node;
		},
	};
}
