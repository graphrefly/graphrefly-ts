import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D744" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d744-arm-local-policy-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF = "d744-arm-local-policy-dispatch-2026-08-12-v1" as const;
export const D738_D736_PARTIAL_ARTIFACT_SHA256 =
	"sha256:502ee02f5393d72c26c157d88d1f990668024c6b035bc76a655f8dbe502d1d53" as const;
export const D738_D736_PARTIAL_BUNDLE_DIGEST =
	"sha256:b7bb9d14e8c46b778c788067b13248b8ce3f08e167d738b4361dc805e2890d25" as const;
export const D738_D736_PARTIAL_GENERATION_DIGEST =
	"sha256:9c293172b0ea2c067714b4afd0f8f9229f7a000a978c4cf265db46d05cd9fa59" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:838ae89f15dcdb80fef0281db727463fe8ee1fee5a36fe4ac0b27194d728e798" as const;
export const D738_D737_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:175e0728d108a1ed3af4c9d9846da4dd62c411f591773c5403d5b14de2855acc" as const;
export const D738_D737_DISPATCH_CLAIM_DIGEST =
	"sha256:84513db038076eef040b0a9eedca3bff4bdcaef2ee4eb7ac3b9d41aadff335fe" as const;
export const D738_D737_CURRENT_KEY_MARKER_SHA256 =
	"sha256:58b5b48d760664c5510f641b07a28de2208fe28611feae8128e1305d609b198c" as const;
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
	d737FailureCode: "arm-local-tool-policy-was-global-executor-failure",
	maxProviderRequestBytes: 1_048_576,
	maxPreMutationInspectionEffects: 6,
	maxProviderRequestsPerRun: 8,
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
