import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D737_DECISION_REF = "decision.D737" as const;
export const D737_DECISION_REVISION = "2026-08-11.v1" as const;
export const D737_GENERATION_REF =
	"d737-graph-objective-phase-recovery-live-2026-08-11-v1" as const;
export const D737_DISPATCH_CLAIM_REF =
	"d737-graph-objective-phase-recovery-dispatch-2026-08-11-v1" as const;
export const D737_D736_PARTIAL_ARTIFACT_SHA256 =
	"sha256:5377820d5d84f5430b85629bc61484f29b27b3b4d0b0d9f84607ede0c53bfec4" as const;
export const D737_D736_PARTIAL_BUNDLE_DIGEST =
	"sha256:a11881a17b1efa7e98b76e082304c4a41d29b46704e401c6e4404f2c700c352f" as const;
export const D737_D736_PARTIAL_GENERATION_DIGEST =
	"sha256:310f7d5a83dc86118d326d1eecbeeaf15d17c4cb91ec0e30fd2a14d077db0ac3" as const;
export const D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:838ae89f15dcdb80fef0281db727463fe8ee1fee5a36fe4ac0b27194d728e798" as const;
export const D737_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D737_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D737_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D737_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D737_COORDINATES = strictSnapshot({
	decisionRef: D737_DECISION_REF,
	decisionRevision: D737_DECISION_REVISION,
	generationRef: D737_GENERATION_REF,
	dispatchClaimRef: D737_DISPATCH_CLAIM_REF,
	d736PartialArtifactSha256: D737_D736_PARTIAL_ARTIFACT_SHA256,
	d736PartialBundleDigest: D737_D736_PARTIAL_BUNDLE_DIGEST,
	d736PartialGenerationDigest: D737_D736_PARTIAL_GENERATION_DIGEST,
	phaseRecoveryPolicyDigest: D737_PHASE_RECOVERY_POLICY_DIGEST,
	routeProfileDigest: D737_ROUTE_PROFILE_DIGEST,
	budgetLimits: D737_BUDGET_LIMITS,
	effectCeilings: D737_EFFECT_CEILINGS,
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

export const D737_COORDINATES_DIGEST = empiricalStrictJsonDigest(D737_COORDINATES);
