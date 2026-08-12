import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D754_DECISION_REF = "decision.D754" as const;
export const D754_DECISION_REVISION = "2026-08-12.v1" as const;
export const D754_GENERATION_REF = "d754-graph-transport-diagnostic-live-2026-08-12-v1" as const;
export const D754_DISPATCH_CLAIM_REF =
	"d754-graph-transport-diagnostic-dispatch-2026-08-12-v1" as const;
export const D754_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:478a4299a28fc907914e44802450af3dbbe7726aadf4a063730b1b3416e4c3bb" as const;
export const D754_HISTORICAL_BUNDLE_DIGEST =
	"sha256:c4e9673dd5ef69abb89e1d3b0f8379817d02e2f5db0d2458b5b3907fa95d14b7" as const;
export const D754_HISTORICAL_GENERATION_DIGEST =
	"sha256:558c853737b2412b30876093e01e4db0a9ffce105a02a73ac1c191a2195bd692" as const;
export const D754_HISTORICAL_QUALIFICATION_DIGEST =
	"sha256:a59d1b9b7c864d2522b66692489d7234c9eeb764dd3b8966078108871ec3e28b" as const;
export const D754_BASELINE_COMMIT = "06d8d35c" as const;
export const D754_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:c7975b04efbe3f8078ab06f3c2408d1074255b7964be4c758e846d05331f9846" as const;
export const D754_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D754_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D754_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D754_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D754_COORDINATES = strictSnapshot({
	decisionRef: D754_DECISION_REF,
	decisionRevision: D754_DECISION_REVISION,
	generationRef: D754_GENERATION_REF,
	dispatchClaimRef: D754_DISPATCH_CLAIM_REF,
	historicalArtifactSha256: D754_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D754_HISTORICAL_BUNDLE_DIGEST,
	historicalGenerationDigest: D754_HISTORICAL_GENERATION_DIGEST,
	forwardPhaseContinuationPolicyDigest: D754_D737_PHASE_RECOVERY_POLICY_DIGEST,
	baselineCommit: D754_BASELINE_COMMIT,
	historicalQualificationDigest: D754_HISTORICAL_QUALIFICATION_DIGEST,
	previousFailureCode: "historical-artifact-schema-literal-mismatch",
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
	routeProfileDigest: D754_ROUTE_PROFILE_DIGEST,
	budgetLimits: D754_BUDGET_LIMITS,
	effectCeilings: D754_EFFECT_CEILINGS,
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

export const D754_COORDINATES_DIGEST = empiricalStrictJsonDigest(D754_COORDINATES);
