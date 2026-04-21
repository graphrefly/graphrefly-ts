/**
 * Core surface for LLM adapters — types, pricing, capabilities, stats.
 *
 * No model data, no provider SDKs, no middleware. Pure domain types +
 * pluggable registry factories.
 */

export * from "./capabilities.js";
export * from "./factory.js";
export * from "./observable.js";
export * from "./pricing.js";
export * from "./types.js";
