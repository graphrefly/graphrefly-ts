import {
	createD733GraphNativeRouteProfile,
	d733RouteProfileCanonicalBytes,
} from "./d733-graph-native-route-profile.js";

export const D733_DEEPSEEK_V4_FLASH_0731_PROFILE = createD733GraphNativeRouteProfile({
	profileRef: "openrouter.deepseek-v4-flash-0731.deepinfra-fp4-chat.2026-08-11.v1",
	requestModel: "deepseek/deepseek-v4-flash-0731",
	selectedEndpointModel: "deepseek/deepseek-v4-flash-20260731",
	providerName: "DeepInfra",
	providerTag: "deepinfra/fp4",
	quantization: "fp4",
	endpointProtocol: "chat-completions",
	endpointUrl: "https://openrouter.ai/api/v1/chat/completions",
	reasoningEffort: "high",
	requiredWireModelParameters: Object.freeze(["reasoning", "tool_choice", "tools"]),
	allowFallbacks: false,
	allowProviderSwitch: false,
	pricing: {
		sourceUrl: "https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints",
		revision: "openrouter-deepseek-v4-flash-0731-deepinfra-fp4-observed-2026-08-11.v1",
		promptUsdPerToken: "0.00000008",
		completionUsdPerToken: "0.00000018",
		cacheReadUsdPerToken: "0.000000016",
		inputMicrousdPerMillionTokens: 80_000,
		outputMicrousdPerMillionTokens: 180_000,
		cacheReadMicrousdPerMillionTokens: 16_000,
	},
});

export const D733_DEEPSEEK_V4_FLASH_0731_PROFILE_BYTES = d733RouteProfileCanonicalBytes(
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
);

export const D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST =
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE.profileDigest;
