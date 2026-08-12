import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D747" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d747-transport-provenance-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF = "d747-transport-provenance-dispatch-2026-08-12-v1" as const;
export const D738_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:358f3d700a7d5d73b36f669c64f0197d7a4992f77cde887d4365731f2a4e9f20" as const;
export const D738_HISTORICAL_BUNDLE_DIGEST =
	"sha256:2016211fa7d2b0b5e93a1016b5dbf59ebbe1cedc6c1fc610c48621c08bda3e96" as const;
export const D738_HISTORICAL_GENERATION_DIGEST =
	"sha256:38b89a9eb585c5501a84b8c38a4acd49e2c40e46592357e9ac12d1deffc02619" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:f3b5eb7f690c466c14b44160b49c81d74a96568dd4152a946c7e26a4df93ba5d" as const;
export const D738_PREVIOUS_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:5375a8d0d12e54682e3e915d94c961cf9c235aea4f4179788e715b5de72a00f9" as const;
export const D738_PREVIOUS_DISPATCH_CLAIM_DIGEST =
	"sha256:e435eb76f7cd71c98c993427d21491f184f5dfe476d157a17c5fc43732d718b5" as const;
export const D738_PREVIOUS_CURRENT_KEY_MARKER_SHA256 =
	"sha256:f350f3f6b3d0e387b6ac00d2aa86b5caf8643ab3571efaf446ad1e92fa61c354" as const;
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
	phaseRecoveryPolicyDigest: D738_D737_PHASE_RECOVERY_POLICY_DIGEST,
	previousDispatchClaimArtifactSha256: D738_PREVIOUS_DISPATCH_CLAIM_ARTIFACT_SHA256,
	previousDispatchClaimDigest: D738_PREVIOUS_DISPATCH_CLAIM_DIGEST,
	previousCurrentKeyMarkerSha256: D738_PREVIOUS_CURRENT_KEY_MARKER_SHA256,
	previousFailureCode: "openrouter-transport-provenance-lost-before-d675-admission",
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
