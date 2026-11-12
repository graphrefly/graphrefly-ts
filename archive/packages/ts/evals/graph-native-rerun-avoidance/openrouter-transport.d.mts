/** Package-private transport, with caller-owned admission and routing. */
export function readBoundedResponseBytes(
	response: Response,
	maxBytes: number,
	path: string,
	signal?: AbortSignal,
): Promise<Uint8Array>;
export interface OpenRouterCost {
	readonly exactProviderCostMicrousd: number;
	readonly costMicrousd: number;
	readonly pricingRoundingAllowanceMicrousd: number;
}
export interface OpenRouterUsage {
	readonly input: number;
	readonly output: number;
	readonly total: number;
	readonly cached: number;
}
export interface OpenRouterPricing {
	readonly inputMicrousdPerMillionTokens: number;
	readonly cacheReadMicrousdPerMillionTokens: number;
	readonly outputMicrousdPerMillionTokens: number;
}
export function providerReportedCost(root: Record<string, unknown>): OpenRouterCost;
export function parseOpenRouterUsage(root: Record<string, unknown>): OpenRouterUsage;
export function auditProviderReportedCost(
	root: Record<string, unknown>,
	pricing: OpenRouterPricing,
	cost?: OpenRouterCost,
): OpenRouterUsage & { readonly tokenPricingAuditMicrousd: number };
export interface OpenRouterReceipt {
	readonly status: number;
	readonly url: string;
	readonly headers: Record<string, string>;
	readonly bytes: Uint8Array;
	readonly bodyText: string;
	readonly json: unknown;
}
export class OpenRouterTransportError extends Error {
	readonly bodyReadFailed: boolean;
	readonly receipt: OpenRouterReceipt;
	constructor(message: string, receipt: OpenRouterReceipt, cause?: unknown);
}
export function requestOpenRouter(options: {
	readonly endpoint: string;
	readonly apiKey: string;
	readonly body: Record<string, unknown>;
	readonly signal?: AbortSignal;
	readonly maxResponseBytes: number;
	readonly fetchImpl?: typeof fetch;
}): Promise<OpenRouterReceipt>;
