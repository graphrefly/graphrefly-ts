import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D738_DECISION_REF = "decision.D749" as const;
export const D738_DECISION_REVISION = "2026-08-12.v1" as const;
export const D738_GENERATION_REF = "d749-forward-phase-continuation-live-2026-08-12-v1" as const;
export const D738_DISPATCH_CLAIM_REF =
	"d749-forward-phase-continuation-dispatch-2026-08-12-v1" as const;
export const D738_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:4b13fc7d14db2422ebd0587a73137ea2712b04fe1c074d6bd22e8d79a1cdc7eb" as const;
export const D738_HISTORICAL_BUNDLE_DIGEST =
	"sha256:44fd24bd3f985ba45daf47f67a4a07d53f442503675928a8cd1b9ee1753acfeb" as const;
export const D738_HISTORICAL_GENERATION_DIGEST =
	"sha256:a26c1f3974fbd11fb012c66f9c75170eed613e52e858fe3faef413cb91f32eb0" as const;
export const D738_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:c7975b04efbe3f8078ab06f3c2408d1074255b7964be4c758e846d05331f9846" as const;
export const D738_PREVIOUS_DISPATCH_CLAIM_ARTIFACT_SHA256 =
	"sha256:79ae6f3103a9a324afb8c5ca612b9057a21f9822d61be1b11126e828031eb5cf" as const;
export const D738_PREVIOUS_DISPATCH_CLAIM_DIGEST =
	"sha256:105c89bc7c0de022b39641faad958295fafd5ed31935db90f7995f898f13b9a8" as const;
export const D738_PREVIOUS_CURRENT_KEY_MARKER_SHA256 =
	"sha256:77a719dd2e8d3e82be3dbb40abf3293459f46ab0361c07883ba3ee889bc8692c" as const;
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
	previousFailureCode: "graph-forward-phase-context-not-issued-after-progress",
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
