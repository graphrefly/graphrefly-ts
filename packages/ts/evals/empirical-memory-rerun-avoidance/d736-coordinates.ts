import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D736_DECISION_REF = "decision.D736" as const;
export const D736_DECISION_REVISION = "2026-08-11.v1" as const;
export const D736_GENERATION_REF = "d736-d735-qualified-route-profile-live-2026-08-11-v1" as const;
export const D736_DISPATCH_CLAIM_REF =
	"d736-d735-qualified-route-profile-dispatch-2026-08-11-v1" as const;
export const D736_D735_ARTIFACT_SHA256 =
	"sha256:6d89648353a14468ec7636762951a2d8fa4be1705d3c871ce83b0c1ee5da0aa6" as const;
export const D736_D735_BUNDLE_DIGEST =
	"sha256:889e37bee6f7126c3ed676fbc677a8fa84376e38e1c30096761f3ea443c89448" as const;
export const D736_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D736_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D736_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D736_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D736_COORDINATES = strictSnapshot({
	decisionRef: D736_DECISION_REF,
	decisionRevision: D736_DECISION_REVISION,
	generationRef: D736_GENERATION_REF,
	dispatchClaimRef: D736_DISPATCH_CLAIM_REF,
	d735ArtifactSha256: D736_D735_ARTIFACT_SHA256,
	d735BundleDigest: D736_D735_BUNDLE_DIGEST,
	routeProfileDigest: D736_ROUTE_PROFILE_DIGEST,
	budgetLimits: D736_BUDGET_LIMITS,
	effectCeilings: D736_EFFECT_CEILINGS,
	armOrder: [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	],
	maxActiveArms: 1,
	coldCensorsWarm: false,
	retryPolicies: ["D671", "D675", "D710"],
	blockHardCapMicrousd: 6_000_000,
	localEvalNoResetLimitMicrousd: 32_000_000,
	fallbackUsed: false,
	providerSwitchUsed: false,
	routeSwitchUsed: false,
	parallelOrBackgroundCalls: false,
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});

export const D736_COORDINATES_DIGEST = empiricalStrictJsonDigest(D736_COORDINATES);
