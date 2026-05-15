import { describe, expect, it } from "vitest";
import {
	composePricing,
	computePrice,
	createPricingRegistry,
	type ModelPricing,
	registryPricing,
} from "../../../../utils/ai/adapters/core/pricing.js";
import type { TokenUsage } from "../../../../utils/ai/adapters/core/types.js";

const usage1k = (): TokenUsage => ({
	input: { regular: 1_000_000 }, // 1M tokens
	output: { regular: 500_000 }, // 0.5M tokens
});

describe("computePrice", () => {
	it("computes flat rate", () => {
		const pricing: ModelPricing = {
			input: { regular: 3 }, // $3 / 1M
			output: { regular: 15 }, // $15 / 1M
			currency: "USD",
		};
		const result = computePrice(usage1k(), pricing);
		expect(result.total).toBeCloseTo(3 + 7.5); // 3 + 0.5 * 15
		expect(result.currency).toBe("USD");
	});

	it("computes tiered rate (above threshold)", () => {
		const pricing: ModelPricing = {
			input: { regular: { pricePerMillion: 2, thresholdTokens: 200_000, pricePerMillionAbove: 4 } },
			currency: "USD",
		};
		// 1M input tokens > 200K threshold → use $4/M
		const result = computePrice(usage1k(), pricing);
		expect(result.total).toBeCloseTo(4);
	});

	it("tiered rate stays at base when below threshold", () => {
		const pricing: ModelPricing = {
			input: {
				regular: { pricePerMillion: 2, thresholdTokens: 2_000_000, pricePerMillionAbove: 4 },
			},
			currency: "USD",
		};
		const result = computePrice(usage1k(), pricing);
		expect(result.total).toBeCloseTo(2);
	});

	it("prices cache classes independently (Anthropic shape)", () => {
		const u: TokenUsage = {
			input: {
				regular: 100_000,
				cacheRead: 500_000, // 10% of input
				cacheWrite5m: 200_000, // 125% of input
				cacheWrite1h: 100_000, // 200% of input
			},
			output: { regular: 10_000 },
		};
		const pricing: ModelPricing = {
			input: {
				regular: 3,
				cacheRead: 0.3,
				cacheWrite5m: 3.75,
				cacheWrite1h: 6,
			},
			output: { regular: 15 },
			currency: "USD",
		};
		const r = computePrice(u, pricing, { withBreakdown: true });
		expect(r.breakdown!["input.regular"]).toBeCloseTo(0.3);
		expect(r.breakdown!["input.cacheRead"]).toBeCloseTo(0.15);
		expect(r.breakdown!["input.cacheWrite5m"]).toBeCloseTo(0.75);
		expect(r.breakdown!["input.cacheWrite1h"]).toBeCloseTo(0.6);
		expect(r.breakdown!["output.regular"]).toBeCloseTo(0.15);
		expect(r.total).toBeCloseTo(0.3 + 0.15 + 0.75 + 0.6 + 0.15);
	});

	it("applies service-tier multiplier (batch)", () => {
		const pricing: ModelPricing = {
			input: { regular: 3 },
			output: { regular: 15 },
			tierMultipliers: { batch: 0.5 },
			currency: "USD",
		};
		const r = computePrice(usage1k(), pricing, { tier: "batch" });
		expect(r.total).toBeCloseTo((3 + 7.5) * 0.5);
	});

	it("returns zero when pricing has no matching class", () => {
		const pricing: ModelPricing = { currency: "USD" };
		const r = computePrice(usage1k(), pricing);
		expect(r.total).toBe(0);
	});

	it("auxiliary costs are per-unit, not per-million", () => {
		const u: TokenUsage = {
			input: { regular: 0 },
			output: { regular: 0 },
			auxiliary: { webSearchRequests: 3 },
		};
		const pricing: ModelPricing = {
			auxiliary: { webSearchRequests: 0.01 }, // $0.01 per request
			currency: "USD",
		};
		const r = computePrice(u, pricing);
		expect(r.total).toBeCloseTo(0.03);
	});

	it("tier multiplier applies to tokens but NOT to auxiliary", () => {
		const u: TokenUsage = {
			input: { regular: 1_000_000 },
			output: { regular: 0 },
			auxiliary: { webSearchRequests: 2 },
		};
		const pricing: ModelPricing = {
			input: { regular: 3 }, // $3 for 1M tokens
			auxiliary: { webSearchRequests: 0.01 }, // $0.01/request
			tierMultipliers: { batch: 0.5 },
			currency: "USD",
		};
		// Tokens: 3 * 0.5 = $1.50. Aux: 2 * 0.01 = $0.02 (NOT halved). Total: $1.52.
		const r = computePrice(u, pricing, { tier: "batch" });
		expect(r.total).toBeCloseTo(1.52);
	});
});

describe("PricingRegistry", () => {
	it("exact lookup wins over prefix", () => {
		const reg = createPricingRegistry();
		const exact: ModelPricing = { input: { regular: 1 }, currency: "USD" };
		const prefix: ModelPricing = { input: { regular: 2 }, currency: "USD" };
		reg.register("anthropic", "claude-sonnet-4-6", prefix);
		reg.register("anthropic", "claude-sonnet-4-6-20260401", exact);
		expect(reg.lookup("anthropic", "claude-sonnet-4-6-20260401")).toBe(exact);
	});

	it("prefix-match fallback for versioned model ids", () => {
		const reg = createPricingRegistry();
		const prefix: ModelPricing = { input: { regular: 3 }, currency: "USD" };
		reg.register("anthropic", "claude-sonnet-4-6", prefix);
		expect(reg.lookup("anthropic", "claude-sonnet-4-6-20260415")).toBe(prefix);
	});

	it("longest prefix wins", () => {
		const reg = createPricingRegistry();
		const shortP: ModelPricing = { input: { regular: 1 }, currency: "USD" };
		const longP: ModelPricing = { input: { regular: 2 }, currency: "USD" };
		reg.register("openai", "gpt-5", shortP);
		reg.register("openai", "gpt-5.2", longP);
		expect(reg.lookup("openai", "gpt-5.2-codex")).toBe(longP);
	});

	it("remove deletes entries", () => {
		const reg = createPricingRegistry();
		reg.register("p", "m", { currency: "USD" });
		expect(reg.lookup("p", "m")).toBeDefined();
		expect(reg.remove("p", "m")).toBe(true);
		expect(reg.lookup("p", "m")).toBeUndefined();
		expect(reg.remove("p", "m")).toBe(false);
	});
});

describe("registryPricing", () => {
	it("returns zero when model not in registry", () => {
		const reg = createPricingRegistry();
		const fn = registryPricing(reg);
		const r = fn(usage1k(), { model: "unknown", provider: "unknown" });
		expect(r.total).toBe(0);
	});

	it("delegates to computePrice with tier", () => {
		const reg = createPricingRegistry([
			[
				"anthropic",
				"claude-sonnet-4-6",
				{
					input: { regular: 3 },
					output: { regular: 15 },
					tierMultipliers: { batch: 0.5 },
					currency: "USD",
				},
			],
		]);
		const fn = registryPricing(reg);
		const base = fn(usage1k(), { model: "claude-sonnet-4-6", provider: "anthropic" });
		const batch = fn(usage1k(), {
			model: "claude-sonnet-4-6",
			provider: "anthropic",
			tier: "batch",
		});
		expect(batch.total).toBeCloseTo(base.total * 0.5);
	});
});

describe("composePricing", () => {
	it("first non-zero wins", () => {
		const fn1 = registryPricing(createPricingRegistry()); // always 0
		const fn2 = registryPricing(
			createPricingRegistry([["p", "m", { input: { regular: 10 }, currency: "USD" }]]),
		);
		const composed = composePricing(fn1, fn2);
		const r = composed(usage1k(), { model: "m", provider: "p" });
		expect(r.total).toBeCloseTo(10);
	});
});
