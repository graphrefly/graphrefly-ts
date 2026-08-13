import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D773_DECISION_REF = "decision.D773" as const;
export const D773_DECISION_REVISION = "2026-08-13.v1" as const;
export const D773_GENERATION_REF = "d773-criterion-lowering-live-2026-08-13-v1" as const;
export const D773_DISPATCH_CLAIM_REF = "d773-criterion-lowering-dispatch-2026-08-13-v1" as const;
export const D773_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:d6994fea93b82eddb5e337cb8694b4842bbcc8f25a04cfd7668507efc2843a25" as const;
export const D773_HISTORICAL_BUNDLE_DIGEST =
	"sha256:c1c1471e0994f5a234e2d27a3cfccf8f02f1063732809c0256fe214ac47e654e" as const;
export const D773_BASELINE_COMMIT = "0446f6b6" as const;
export const D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:6b3a371bc57a4d84b6a3b8adbfb96b4e8440ed314ec073fa020e71e0a0bd79f0" as const;
export const D773_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D773_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D773_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D773_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D773_COORDINATES = strictSnapshot({
	decisionRef: D773_DECISION_REF,
	decisionRevision: D773_DECISION_REVISION,
	generationRef: D773_GENERATION_REF,
	dispatchClaimRef: D773_DISPATCH_CLAIM_REF,
	baselineCommit: D773_BASELINE_COMMIT,
	historicalArtifactSha256: D773_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D773_HISTORICAL_BUNDLE_DIGEST,
	qualifiedImplementationManifestDigest: D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	criterionLoweringRevision: "graphrefly.b112.d771.criterion-named-tool-lowering.v1",
	armAwareGateProjectionRevision: "graphrefly.b112.d771.arm-aware-positive-gate.v1",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D773_ROUTE_PROFILE_DIGEST,
	budgetLimits: D773_BUDGET_LIMITS,
	effectCeilings: D773_EFFECT_CEILINGS,
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
	automaticRerun: false,
	causalAttribution: "undetermined",
	efficacyClaimBoundary: "full-frozen-positive-differential-gate-or-none",
});

export const D773_COORDINATES_DIGEST = empiricalStrictJsonDigest(D773_COORDINATES);
