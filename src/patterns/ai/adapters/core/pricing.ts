/**
 * Pluggable pricing for LLM adapters.
 *
 * The library ships the **shape** (types + computation helpers + registry
 * factory) and **zero model data**. Users populate a `PricingRegistry` with
 * the prices for the models they use — either by hand, from a curated table,
 * or by importing a third-party dataset (litellm JSON, etc.).
 *
 * Pricing is a pure function of raw `TokenUsage`. The library does not
 * know current prices, regional rates, tier thresholds, or promotional
 * discounts — those are all user domain.
 */

import type { TokenUsage } from "./types.js";
import { sumInputTokens } from "./types.js";

// ---------------------------------------------------------------------------
// Rate shape
// ---------------------------------------------------------------------------

/**
 * A rate per 1M tokens. Supports threshold-based tiering (Anthropic
 * long-context >200K, Gemini >200K) via optional `thresholdTokens` +
 * `pricePerMillionAbove`.
 *
 * `total input tokens` (sum of every input class) is the axis the threshold
 * applies to — matches how Anthropic and Gemini measure it.
 */
export interface TieredRate {
	pricePerMillion: number;
	thresholdTokens?: number;
	pricePerMillionAbove?: number;
}

/** Shorthand: a plain `number` stands for `{pricePerMillion: n}`. */
export type Rate = TieredRate | number;

function rateAt(rate: Rate | undefined, totalInput: number): number {
	if (rate == null) return 0;
	if (typeof rate === "number") return rate;
	if (
		rate.thresholdTokens != null &&
		rate.pricePerMillionAbove != null &&
		totalInput > rate.thresholdTokens
	) {
		return rate.pricePerMillionAbove;
	}
	return rate.pricePerMillion;
}

// ---------------------------------------------------------------------------
// ModelPricing
// ---------------------------------------------------------------------------

/** USD-per-1M rates per token class. All fields optional. */
export interface ModelPricing {
	input?: {
		regular?: Rate;
		cacheRead?: Rate;
		cacheWrite5m?: Rate;
		cacheWrite1h?: Rate;
		cacheWriteOther?: Rate;
		audio?: Rate;
		image?: Rate;
		video?: Rate;
		toolUse?: Rate;
		extensions?: Record<string, Rate>;
	};
	output?: {
		regular?: Rate;
		reasoning?: Rate;
		audio?: Rate;
		predictionAccepted?: Rate;
		predictionRejected?: Rate;
		extensions?: Record<string, Rate>;
	};
	/**
	 * Per-unit costs for non-token axes. Values are USD per unit; units
	 * match `TokenUsage.auxiliary` keys (e.g. `webSearchRequests`, `cacheStorageHours`).
	 */
	auxiliary?: Record<string, number>;
	/**
	 * Service-tier multipliers. Applied to the summed per-class price.
	 * E.g. `{ batch: 0.5, flex: 0.5, priority: 1.25 }`. Default (no tier or
	 * tier not present in the map): multiplier = 1.
	 */
	tierMultipliers?: Record<string, number>;
	/** Currency code (ISO 4217). Defaults to "USD" when constructed via helpers. */
	currency: string;
}

// ---------------------------------------------------------------------------
// Price breakdown
// ---------------------------------------------------------------------------

/** Result of computing a price from usage + pricing. */
export interface PriceBreakdown {
	/** Total charge in `currency`. */
	total: number;
	currency: string;
	/**
	 * Optional per-class subtotals. Keys are dot-separated paths like
	 * `"input.regular"`, `"output.reasoning"`, `"auxiliary.webSearchRequests"`.
	 */
	breakdown?: Record<string, number>;
}

/** Zero-charge breakdown — returned when no pricing is available for a model. */
export function zeroPrice(currency = "USD"): PriceBreakdown {
	return { total: 0, currency };
}

// ---------------------------------------------------------------------------
// computePrice — the math
// ---------------------------------------------------------------------------

/**
 * Compute price from a usage object + model pricing.
 *
 * - Tier-threshold math uses `sumInputTokens(usage)` as the axis.
 * - Service tier (`opts.tier`) multiplies the final total via `tierMultipliers`.
 * - Each token class is priced independently using the matching `Rate` lookup.
 * - `breakdown` is populated when `opts.withBreakdown = true` (default false
 *   to keep hot-path allocations low).
 */
export function computePrice(
	usage: TokenUsage,
	pricing: ModelPricing,
	opts?: { tier?: string; withBreakdown?: boolean },
): PriceBreakdown {
	const totalInput = sumInputTokens(usage);
	const currency = pricing.currency ?? "USD";
	const withBreakdown = opts?.withBreakdown === true;
	const breakdown: Record<string, number> = withBreakdown ? {} : (null as never);

	let total = 0;

	const addLine = (key: string, tokens: number, rate: Rate | undefined): void => {
		if (!tokens || rate == null) return;
		const rateUsd = rateAt(rate, totalInput);
		const line = (tokens * rateUsd) / 1_000_000;
		total += line;
		if (withBreakdown) breakdown[key] = (breakdown[key] ?? 0) + line;
	};

	// Input classes
	const i = usage.input;
	const pi = pricing.input;
	if (pi) {
		addLine("input.regular", i.regular, pi.regular);
		addLine("input.cacheRead", i.cacheRead ?? 0, pi.cacheRead);
		addLine("input.cacheWrite5m", i.cacheWrite5m ?? 0, pi.cacheWrite5m);
		addLine("input.cacheWrite1h", i.cacheWrite1h ?? 0, pi.cacheWrite1h);
		addLine("input.cacheWriteOther", i.cacheWriteOther ?? 0, pi.cacheWriteOther);
		addLine("input.audio", i.audio ?? 0, pi.audio);
		addLine("input.image", i.image ?? 0, pi.image);
		addLine("input.video", i.video ?? 0, pi.video);
		addLine("input.toolUse", i.toolUse ?? 0, pi.toolUse);
		if (i.extensions && pi.extensions) {
			for (const [k, v] of Object.entries(i.extensions)) {
				addLine(`input.ext.${k}`, v, pi.extensions[k]);
			}
		}
	}

	// Output classes
	const o = usage.output;
	const po = pricing.output;
	if (po) {
		addLine("output.regular", o.regular, po.regular);
		addLine("output.reasoning", o.reasoning ?? 0, po.reasoning);
		addLine("output.audio", o.audio ?? 0, po.audio);
		addLine("output.predictionAccepted", o.predictionAccepted ?? 0, po.predictionAccepted);
		addLine("output.predictionRejected", o.predictionRejected ?? 0, po.predictionRejected);
		if (o.extensions && po.extensions) {
			for (const [k, v] of Object.entries(o.extensions)) {
				addLine(`output.ext.${k}`, v, po.extensions[k]);
			}
		}
	}

	// Service-tier multiplier applies to token costs only. Auxiliary costs
	// (per-request web-search fees, cache storage-hours, etc.) are typically
	// priced flat regardless of tier — e.g., Anthropic batch discount applies
	// to input/output tokens but NOT to web_search_requests. Apply the
	// multiplier to the token total before adding auxiliary lines.
	const tier = opts?.tier;
	if (tier && pricing.tierMultipliers) {
		const mult = pricing.tierMultipliers[tier];
		if (mult != null) {
			total *= mult;
			if (withBreakdown) {
				for (const k of Object.keys(breakdown)) breakdown[k] *= mult;
			}
		}
	}

	// Auxiliary (per-unit, not per-million; not tier-multiplied)
	const aux = usage.auxiliary;
	const paux = pricing.auxiliary;
	if (aux && paux) {
		for (const [k, units] of Object.entries(aux)) {
			const rate = paux[k];
			if (rate == null || !units) continue;
			const line = units * rate;
			total += line;
			if (withBreakdown) breakdown[`auxiliary.${k}`] = line;
		}
	}

	return withBreakdown ? { total, currency, breakdown } : { total, currency };
}

// ---------------------------------------------------------------------------
// PricingFn
// ---------------------------------------------------------------------------

/** Pure function: given usage + call context, produce a price. */
export type PricingFn = (
	usage: TokenUsage,
	ctx: { model: string; provider: string; tier?: string; withBreakdown?: boolean },
) => PriceBreakdown;

// ---------------------------------------------------------------------------
// PricingRegistry
// ---------------------------------------------------------------------------

/**
 * A keyed store of `ModelPricing`. Users populate it at app startup.
 * The library ships the factory and zero data.
 *
 * Keys are `(provider, model)` pairs. Lookup attempts exact match first,
 * then longest-prefix match on model (e.g. `"claude-sonnet-4-6"` matches a
 * stored `"claude-sonnet-4-6"` entry when looking up
 * `"claude-sonnet-4-6-20260401"`).
 *
 * **Prefix-match footgun:** a registered `"gemini-1"` will also match a
 * lookup for `"gemini-1.5-pro"` (since `"gemini-1.5-pro".startsWith("gemini-1")`
 * is true). Longest-match tie-breaking mitigates most cases, but when
 * registering a short family-prefix alongside versioned descendants, make sure
 * the versioned entry is present — otherwise the family prefix wins. Best
 * practice: register exact versioned model ids; use short family aliases
 * sparingly and only when all version variants share one pricing schedule.
 */
export interface PricingRegistry {
	lookup(provider: string, model: string): ModelPricing | undefined;
	register(provider: string, model: string, pricing: ModelPricing): void;
	/** Remove a model's entry; returns `true` if it existed. */
	remove(provider: string, model: string): boolean;
	/** Enumerate all entries (for debugging / dump). */
	entries(): IterableIterator<[string, string, ModelPricing]>;
}

function registryKey(provider: string, model: string): string {
	return `${provider}::${model}`;
}

/** Create a fresh `PricingRegistry`. Optionally seed with entries. */
export function createPricingRegistry(
	initial?: ReadonlyArray<readonly [provider: string, model: string, pricing: ModelPricing]>,
): PricingRegistry {
	const map = new Map<string, { provider: string; model: string; pricing: ModelPricing }>();
	const indexByProvider = new Map<string, Set<string>>();

	const register = (provider: string, model: string, pricing: ModelPricing): void => {
		map.set(registryKey(provider, model), { provider, model, pricing });
		let models = indexByProvider.get(provider);
		if (!models) {
			models = new Set();
			indexByProvider.set(provider, models);
		}
		models.add(model);
	};

	if (initial) {
		for (const [p, m, pricing] of initial) register(p, m, pricing);
	}

	return {
		register,
		lookup(provider, model) {
			const exact = map.get(registryKey(provider, model));
			if (exact) return exact.pricing;
			// Prefix fallback within provider.
			const models = indexByProvider.get(provider);
			if (!models) return undefined;
			// Pick the longest prefix match for stability.
			let best: { key: string; pricing: ModelPricing } | undefined;
			for (const candidate of models) {
				if (model.startsWith(candidate)) {
					if (!best || candidate.length > best.key.length) {
						const entry = map.get(registryKey(provider, candidate));
						if (entry) best = { key: candidate, pricing: entry.pricing };
					}
				}
			}
			return best?.pricing;
		},
		remove(provider, model) {
			const existed = map.delete(registryKey(provider, model));
			if (existed) {
				const models = indexByProvider.get(provider);
				models?.delete(model);
				if (models && models.size === 0) indexByProvider.delete(provider);
			}
			return existed;
		},
		entries(): IterableIterator<[string, string, ModelPricing]> {
			const iter = map.values();
			return (function* () {
				for (const { provider, model, pricing } of iter) {
					yield [provider, model, pricing];
				}
			})();
		},
	};
}

/**
 * Build a `PricingFn` from a `PricingRegistry`. If no entry matches, returns
 * `{ total: 0, currency: "USD" }` (never throws). Callers who need "unknown
 * model" failures can compose their own `PricingFn`.
 */
export function registryPricing(registry: PricingRegistry, defaultCurrency = "USD"): PricingFn {
	return (usage, ctx) => {
		const pricing = registry.lookup(ctx.provider, ctx.model);
		if (!pricing) return zeroPrice(defaultCurrency);
		return computePrice(usage, pricing, { tier: ctx.tier, withBreakdown: ctx.withBreakdown });
	};
}

/** Compose multiple `PricingFn`s — first non-zero wins. Useful for registry layering. */
export function composePricing(...fns: readonly PricingFn[]): PricingFn {
	return (usage, ctx) => {
		for (const fn of fns) {
			const p = fn(usage, ctx);
			if (p.total !== 0) return p;
		}
		return fns.length > 0 ? fns[0](usage, ctx) : zeroPrice();
	};
}

/**
 * Convenience: compute a {@link PriceBreakdown} directly from a
 * {@link import("./capabilities.js").ModelCapabilities} object + usage.
 *
 * When callers look up capabilities themselves (via
 * `capabilitiesRegistry.lookup(...)` or `adapter.capabilities?.(model)`),
 * this helper skips the pricing-registry round-trip and computes the price
 * from `capabilities.pricing` directly.
 *
 * Returns `zeroPrice()` when `capabilities.pricing` is undefined — never throws.
 *
 * @param capabilities - Model capabilities object (`capabilities.pricing` may be absent).
 * @param usage - Per-call usage to price.
 * @param opts - Pass-through to {@link computePrice}.
 *
 * @example
 * ```ts
 * const cap = registry.lookup("anthropic", "claude-sonnet-4-6");
 * const price = pricingFor(cap, resp.usage, { tier: "batch", withBreakdown: true });
 * ```
 *
 * @category ai
 */
export function pricingFor(
	capabilities: import("./capabilities.js").ModelCapabilities | undefined,
	usage: TokenUsage,
	opts?: { tier?: string; withBreakdown?: boolean },
): PriceBreakdown {
	if (!capabilities?.pricing) return zeroPrice();
	return computePrice(usage, capabilities.pricing, opts);
}
