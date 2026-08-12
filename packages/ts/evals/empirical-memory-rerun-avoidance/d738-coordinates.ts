import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D745" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d745-phase-scoped-recovery-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF = "d745-phase-scoped-recovery-dispatch-2026-08-12-v1" as const;
export const D738_D736_PARTIAL_ARTIFACT_SHA256 =
	"sha256:ef8833fe33d30e32fee26492708d50c155e8ede948f768f8807fbc0855c2f47e" as const;
export const D738_D736_PARTIAL_BUNDLE_DIGEST =
	"sha256:159c2ce60e882c73d4e72778c629ba8b373ba2be62be17662168ab3170fca6de" as const;
export const D738_D736_PARTIAL_GENERATION_DIGEST =
	"sha256:f88a2e0a1479b8209f1d1d31a178a2e4fd779cae31d898dc397e04671a3682d1" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:f3b5eb7f690c466c14b44160b49c81d74a96568dd4152a946c7e26a4df93ba5d" as const;
export const D738_D737_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:47f78f9354ae6940af3435987aed242721c6dfb925d6a42e1c1b5402d6039c88" as const;
export const D738_D737_DISPATCH_CLAIM_DIGEST =
	"sha256:b2d211c4f0cd157c61a1cf76b74d887869dba6bae1d6354cfcd6ea080e697f56" as const;
export const D738_D737_CURRENT_KEY_MARKER_SHA256 =
	"sha256:1fce17d5016a3ff3fd47cae11ebc3a01b06d6603e86cf9209d3b798c1cf70245" as const;
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
	d737FailureCode: "run-level-context-budget-blocked-next-objective-phase",
	maxProviderRequestBytes: 1_048_576,
	maxPreMutationInspectionEffects: 6,
	maxProviderRequestsPerRun: 8,
	maxCompletionContextsPerRun: 4,
	maxCompletionContextsPerPhase: 1,
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
