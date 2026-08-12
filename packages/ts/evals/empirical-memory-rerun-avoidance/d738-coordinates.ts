import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D738" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF =
	"d738-graph-provider-attempt-evidence-repair-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF =
	"d738-graph-provider-attempt-evidence-repair-dispatch-2026-08-12-v1" as const;
export const D738_D736_PARTIAL_ARTIFACT_SHA256 =
	"sha256:5377820d5d84f5430b85629bc61484f29b27b3b4d0b0d9f84607ede0c53bfec4" as const;
export const D738_D736_PARTIAL_BUNDLE_DIGEST =
	"sha256:a11881a17b1efa7e98b76e082304c4a41d29b46704e401c6e4404f2c700c352f" as const;
export const D738_D736_PARTIAL_GENERATION_DIGEST =
	"sha256:310f7d5a83dc86118d326d1eecbeeaf15d17c4cb91ec0e30fd2a14d077db0ac3" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:838ae89f15dcdb80fef0281db727463fe8ee1fee5a36fe4ac0b27194d728e798" as const;
export const D738_D737_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:359cd975afa57e8e9bf9ad538278f8048c78ba56cfada8d518cb61dbec378731" as const;
export const D738_D737_DISPATCH_CLAIM_DIGEST =
	"sha256:5070e6e3c1ab5ce72aafe4a9f3363694470dc1e5479625df8ff423595cef964d" as const;
export const D738_D737_CURRENT_KEY_MARKER_SHA256 =
	"sha256:99b1dd323c59910d97cf98f16bc4731c176b7ca085deeb3a2aa0cdd58d900a81" as const;
export const D738_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D738_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D738_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D738_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D738_COORDINATES = strictSnapshot({
	decisionRef: D738_DECISION_REF,
	decisionRevision: D738_DECISION_REVISION,
	generationRef: D738_GENERATION_REF,
	dispatchClaimRef: D738_DISPATCH_CLAIM_REF,
	d736PartialArtifactSha256: D738_D736_PARTIAL_ARTIFACT_SHA256,
	d736PartialBundleDigest: D738_D736_PARTIAL_BUNDLE_DIGEST,
	d736PartialGenerationDigest: D738_D736_PARTIAL_GENERATION_DIGEST,
	phaseRecoveryPolicyDigest: D738_D737_PHASE_RECOVERY_POLICY_DIGEST,
	d737DispatchClaimArtifactSha256: D738_D737_DISPATCH_CLAIM_ARTIFACT_SHA256,
	d737DispatchClaimDigest: D738_D737_DISPATCH_CLAIM_DIGEST,
	d737CurrentKeyMarkerSha256: D738_D737_CURRENT_KEY_MARKER_SHA256,
	d737FailureCode: "provider-attempt-counter-drift-before-persistence",
	routeProfileDigest: D738_ROUTE_PROFILE_DIGEST,
	budgetLimits: D738_BUDGET_LIMITS,
	effectCeilings: D738_EFFECT_CEILINGS,
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

export const D738_COORDINATES_DIGEST = empiricalStrictJsonDigest(D738_COORDINATES);
