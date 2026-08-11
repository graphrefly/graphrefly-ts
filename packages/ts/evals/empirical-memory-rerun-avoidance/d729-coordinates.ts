import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D726_BUDGET_LIMITS,
	D726_D725_QUALIFICATION_COORDINATES,
	D726_EFFECT_CEILINGS,
} from "./d726-coordinates.js";

export const D729_DECISION_REF = "decision.D729" as const;
export const D729_DECISION_REVISION = "2026-08-11.v1" as const;
export const D729_GENERATION_REF = "d729-current-deepseek-route-pre-live-2026-08-11-v1" as const;
export const D729_DISPATCH_CLAIM_REF = "d729-current-deepseek-route-live-2026-08-11-v1" as const;

export const D729_MODEL_SLUG = "deepseek/deepseek-v4-flash" as const;
export const D729_SELECTED_ENDPOINT_MODEL = "deepseek/deepseek-v4-flash-20260423" as const;
export const D729_PROVIDER_NAME = "DeepInfra" as const;
export const D729_PROVIDER_TAG = "deepinfra/fp4" as const;
export const D729_QUANTIZATION = "fp4" as const;
export const D729_INPUT_MICROUSD_PER_MILLION_TOKENS = 90_000 as const;
export const D729_OUTPUT_MICROUSD_PER_MILLION_TOKENS = 180_000 as const;
export const D729_CACHE_READ_MICROUSD_PER_MILLION_TOKENS = 18_000 as const;
export const D729_PRICING_SOURCE =
	"https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints" as const;
export const D729_PRICING_REVISION =
	"openrouter-deepseek-v4-flash-deepinfra-fp4-observed-2026-08-11.v1" as const;

export const D729_BUDGET_LIMITS = D726_BUDGET_LIMITS;
export const D729_EFFECT_CEILINGS = D726_EFFECT_CEILINGS;
export const D729_D725_QUALIFICATION_COORDINATES = D726_D725_QUALIFICATION_COORDINATES;
export const D729_D727_QUALIFICATION_COORDINATES = strictSnapshot({
	generationRef: "d727-d726-executor-failure-pre-live-2026-08-11-v1",
	artifactSha256: "sha256:262601d5b35440c6ffb0c6d40a88838cd645c7371807b24dc195dd2eb18bdc68",
	bundleDigest: "sha256:d85fc07c77b237e689e17419f2ccba9f6732a2e9d57b9cedc5d39768bd174226",
	terminalReceiptDigest: "sha256:724ab1bce35a585de516b1cd9540465c3263f9fb6fc3f784db16131f213b5aa4",
});
export const D729_D728_FAILURE_COORDINATES = strictSnapshot({
	generationRef: "d728-d727-failure-safe-graph-native-live-2026-08-11-v1",
	artifactSha256: "sha256:00e5d2834dd75776a844403423a44e0055ce3c959970d86e0b4922602ce3d8b1",
	bundleDigest: "sha256:64a3d2d15f3ca4946836b423dee68069ab562e08387e831fd0817865fcbb419f",
	observationDigest: "sha256:441d21b51f76189c59879700f8e09bc626f0b775b57b0120243ea2ed693232a8",
	terminalReceiptDigest: "sha256:119b5efa3bd9036427d3ac07b34f6b669b48b5bea5bcb5330a29823d73a64f50",
	disposition: "partial-failure",
	terminalHttpStatus: 404,
});

export const D729_COORDINATES_DIGEST = empiricalStrictJsonDigest({
	decisionRef: D729_DECISION_REF,
	decisionRevision: D729_DECISION_REVISION,
	generationRef: D729_GENERATION_REF,
	dispatchClaimRef: D729_DISPATCH_CLAIM_REF,
	budgetLimits: D729_BUDGET_LIMITS,
	effectCeilings: D729_EFFECT_CEILINGS,
	d725Qualification: D729_D725_QUALIFICATION_COORDINATES,
	d727Qualification: D729_D727_QUALIFICATION_COORDINATES,
	d728Failure: D729_D728_FAILURE_COORDINATES,
	route: {
		model: D729_MODEL_SLUG,
		selectedEndpointModel: D729_SELECTED_ENDPOINT_MODEL,
		provider: D729_PROVIDER_NAME,
		providerTag: D729_PROVIDER_TAG,
		quantization: D729_QUANTIZATION,
		reasoningEffort: "high",
		endpoint: "chat-completions",
		fallback: false,
	},
	pricing: {
		source: D729_PRICING_SOURCE,
		revision: D729_PRICING_REVISION,
		inputMicrousdPerMillionTokens: D729_INPUT_MICROUSD_PER_MILLION_TOKENS,
		outputMicrousdPerMillionTokens: D729_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
		cacheReadMicrousdPerMillionTokens: D729_CACHE_READ_MICROUSD_PER_MILLION_TOKENS,
	},
	armOrder: [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	],
	coldCensorsWarm: false,
	maxActiveArms: 1,
	retryPolicies: ["D671", "D675", "D710"],
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});
