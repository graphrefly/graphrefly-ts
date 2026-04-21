/**
 * Pluggable model capabilities (roadmap §9.3d).
 *
 * The library defines the **shape** of what's knowable about a model
 * (context window, rate limits, features, pricing reference) and provides
 * a registry factory. Capability **data** is user-supplied — no baked-in
 * tables, no drift-prone catalog.
 */

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
}

function capKey(provider: string, model: string): string {
	return `${provider}::${model}`;
}

/** Create a fresh `CapabilitiesRegistry`. Optionally seed with entries. */
export function createCapabilitiesRegistry(
	initial?: readonly ModelCapabilities[],
): CapabilitiesRegistry {
	const map = new Map<string, ModelCapabilities>();
	const indexByProvider = new Map<string, Set<string>>();

	const register = (cap: ModelCapabilities): void => {
		map.set(capKey(cap.provider, cap.id), cap);
		let models = indexByProvider.get(cap.provider);
		if (!models) {
			models = new Set();
			indexByProvider.set(cap.provider, models);
		}
		models.add(cap.id);
	};

	if (initial) for (const cap of initial) register(cap);

	return {
		register,
		lookup(provider, model) {
			const exact = map.get(capKey(provider, model));
			if (exact) return exact;
			const models = indexByProvider.get(provider);
			if (!models) return undefined;
			let best: { key: string; cap: ModelCapabilities } | undefined;
			for (const candidate of models) {
				if (model.startsWith(candidate)) {
					if (!best || candidate.length > best.key.length) {
						const entry = map.get(capKey(provider, candidate));
						if (entry) best = { key: candidate, cap: entry };
					}
				}
			}
			return best?.cap;
		},
		remove(provider, model) {
			const existed = map.delete(capKey(provider, model));
			if (existed) {
				const models = indexByProvider.get(provider);
				models?.delete(model);
				if (models && models.size === 0) indexByProvider.delete(provider);
			}
			return existed;
		},
		entries() {
			return map.values();
		},
	};
}
