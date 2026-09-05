/**
 * The one package-private provider route admitted by the current root Eval.
 *
 * This is deliberately not a registry: changing it invalidates current
 * qualification/claim material, and request construction never falls back to a
 * second provider.
 */
export const CURRENT_ROOT_EVAL_PROVIDER_ROUTE = Object.freeze({
	contractRevision: "graphrefly-ts.root-eval-provider-route.v1" as const,
	decisionRef: "graphrefly-ts:D158" as const,
	providerRef: "together" as const,
	providerName: "Together" as const,
	modelRef: "deepseek/deepseek-v4-flash-0731" as const,
	endpointModelRef: "deepseek/deepseek-v4-flash-20260731" as const,
	chatCompletionsEndpoint: "https://openrouter.ai/api/v1/chat/completions" as const,
	pricingSource:
		"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints" as const,
	zdrSource: "https://openrouter.ai/api/v1/endpoints/zdr" as const,
	quantization: "unknown" as const,
	inputMicrousdPerMillionTokens: 140_000 as const,
	outputMicrousdPerMillionTokens: 280_000 as const,
	cacheReadMicrousdPerMillionTokens: 30_000 as const,
	inputUsdPerToken: "0.00000014" as const,
	outputUsdPerToken: "0.00000028" as const,
	cacheReadUsdPerToken: "0.00000003" as const,
	nonbillablePolicyRef: null,
	requestProviderOrder: Object.freeze(["together"] as const),
	allowedOperatorProviders: Object.freeze(["Fireworks", "Together"] as const),
});

export type CurrentRootEvalProviderRoute = typeof CURRENT_ROOT_EVAL_PROVIDER_ROUTE;

export function assertCurrentRootEvalProviderRoute(
	route: Readonly<{ providerRef: string; providerModelRef: string }>,
): void {
	if (
		route.providerRef !== CURRENT_ROOT_EVAL_PROVIDER_ROUTE.providerRef ||
		route.providerModelRef !== CURRENT_ROOT_EVAL_PROVIDER_ROUTE.modelRef
	)
		throw new TypeError("root eval effect did not match the single current provider route");
}
