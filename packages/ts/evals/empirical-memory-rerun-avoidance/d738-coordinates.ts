import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D750" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d750-forward-phase-continuation-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF =
	"d750-forward-phase-continuation-dispatch-2026-08-12-v1" as const;
export const D738_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:7ab2807c15ccf70a3413c4519d206a211b7d26a3fe8f0aabfc344387d2a23c68" as const;
export const D738_HISTORICAL_BUNDLE_DIGEST =
	"sha256:c40e95add584b63c97bf38328a579c0e668850706ad613059bac07f9757563fd" as const;
export const D738_HISTORICAL_GENERATION_DIGEST =
	"sha256:66bf91f2a0a801a71132785c3051ad1176753617386c59ce638c1ebcf8ebeaa1" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:c7975b04efbe3f8078ab06f3c2408d1074255b7964be4c758e846d05331f9846" as const;
export const D738_PREVIOUS_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:1e8093adbebf3ab0f5edf150ff265eeb7516fea5a44bc7294656b261938c4de1" as const;
export const D738_PREVIOUS_DISPATCH_CLAIM_DIGEST =
	"sha256:9b753b9aa7b0a0a492d629a595d51ca1ce27adafb5031df23957e7f73e88d361" as const;
export const D738_PREVIOUS_CURRENT_KEY_MARKER_SHA256 =
	"sha256:b54b5100968d75bd4a1c72685f755f4929d11b42fa8be9dd50846beb58df134d" as const;
export const D738_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D738_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D738_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D738_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D738_COORDINATES = strictSnapshot({
	decisionRef: D738_DECISION_REF,
	decisionRevision: D738_DECISION_REVISION,
	generationRef: D738_GENERATION_REF,
	dispatchClaimRef: D738_DISPATCH_CLAIM_REF,
	historicalArtifactSha256: D738_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D738_HISTORICAL_BUNDLE_DIGEST,
	historicalGenerationDigest: D738_HISTORICAL_GENERATION_DIGEST,
	forwardPhaseContinuationPolicyDigest: D738_D737_PHASE_RECOVERY_POLICY_DIGEST,
	previousDispatchClaimArtifactSha256: D738_PREVIOUS_DISPATCH_CLAIM_ARTIFACT_SHA256,
	previousDispatchClaimDigest: D738_PREVIOUS_DISPATCH_CLAIM_DIGEST,
	previousCurrentKeyMarkerSha256: D738_PREVIOUS_CURRENT_KEY_MARKER_SHA256,
	previousFailureCode: "graph-canonical-replay-phase-trigger-mismatch",
	transportFailurePolicy: {
		nestedDiagnosticCauseCode: "und-err-socket",
		nestedDiagnosticDisposition: "d675-und-err-socket",
		d675AdditionalAttempts: 1,
		otherTransportCauseDisposition: "transport-failure",
		httpEvidenceProducedForTransportFailure: false,
	},
	maxProviderRequestBytes: 1_048_576,
	maxPreMutationInspectionEffects: 6,
	maxProviderRequestsPerRun: 8,
	maxCompletionContextsPerRun: 8,
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
