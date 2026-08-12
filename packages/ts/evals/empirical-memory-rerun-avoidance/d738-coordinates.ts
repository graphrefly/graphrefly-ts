import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D742" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d742-graph-provider-count-repair-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF =
	"d742-graph-provider-count-repair-dispatch-2026-08-12-v1" as const;
export const D738_D736_PARTIAL_ARTIFACT_SHA256 =
	"sha256:affa381c30fa375b9e8d6acc5a5097fec93d6fb7ff95c29bc3efa4a8c314e486" as const;
export const D738_D736_PARTIAL_BUNDLE_DIGEST =
	"sha256:59d3e5565b985ba2cbb304980a27dab77a1903eda44cee5eb02a9af1ea241e55" as const;
export const D738_D736_PARTIAL_GENERATION_DIGEST =
	"sha256:594c42e6e085301507b06bab9cdee46a65b076d91d4023557d22ce85ce5c69fc" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:838ae89f15dcdb80fef0281db727463fe8ee1fee5a36fe4ac0b27194d728e798" as const;
export const D738_D737_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:0451000484a33fcd0e665a7649b043e1303a39a020f058793fdde980fbea2eac" as const;
export const D738_D737_DISPATCH_CLAIM_DIGEST =
	"sha256:4d6e1d407d17c109928018d32a4beee0ae8575880494cc32a5716732f07e7ccf" as const;
export const D738_D737_CURRENT_KEY_MARKER_SHA256 =
	"sha256:b2b435baa05d6bb58bb7111554a64709baca837b8bb9c58cb9dfa95c8615763c" as const;
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
	d737FailureCode: "graph-provider-count-sourced-from-aggregate-usage",
	maxProviderRequestBytes: 1_048_576,
	maxPreMutationInspectionEffects: 6,
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
