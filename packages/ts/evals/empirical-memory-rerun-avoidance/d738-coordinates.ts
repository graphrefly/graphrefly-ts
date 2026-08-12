import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D743" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d743-byte-transport-envelope-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF =
	"d743-byte-transport-envelope-dispatch-2026-08-12-v1" as const;
export const D738_D736_PARTIAL_ARTIFACT_SHA256 =
	"sha256:44abd5e2c530e6b0cef483f7e774503f70084525ae61e536924200d644a3debf" as const;
export const D738_D736_PARTIAL_BUNDLE_DIGEST =
	"sha256:cd67276cefa8b55b61420eb275737e007591c5972179de7774264c5033365aa2" as const;
export const D738_D736_PARTIAL_GENERATION_DIGEST =
	"sha256:c969dea417c0919c740da9d3e9c5afc0549f9525e6bceae306d7479628f14523" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:838ae89f15dcdb80fef0281db727463fe8ee1fee5a36fe4ac0b27194d728e798" as const;
export const D738_D737_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:d5adaa60a1ae0380a7ba8c61f354b771bc2f0e964a5e4ab5efd0734134ab88e5" as const;
export const D738_D737_DISPATCH_CLAIM_DIGEST =
	"sha256:fffccb6221bb72e402f2995085597cb5c3bdcdf9df9c008f70c0ba32a158163b" as const;
export const D738_D737_CURRENT_KEY_MARKER_SHA256 =
	"sha256:a43c5f5dc012af5b5be3188ec28784768a254fb4c633ad987d56a19ce7649c46" as const;
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
	d737FailureCode: "byte-transport-retained-legacy-262144-bound",
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
