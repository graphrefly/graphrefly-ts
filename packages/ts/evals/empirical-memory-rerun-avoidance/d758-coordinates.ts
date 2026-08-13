import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D758_DECISION_REF = "decision.D758" as const;
export const D758_DECISION_REVISION = "2026-08-12.v1" as const;
export const D758_GENERATION_REF = "d758-graph-named-tool-live-2026-08-12-v1" as const;
export const D758_DISPATCH_CLAIM_REF = "d758-graph-named-tool-dispatch-2026-08-12-v1" as const;
export const D758_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:8c6efbf4d797b5bff89c9d1549a4bb83f3b920eeb51381b1907773f4c3add007" as const;
export const D758_HISTORICAL_BUNDLE_DIGEST =
	"sha256:114bdc7e399dfb1b9b697746d9d42bb3ea0b1e2092d6ba34bc2f9d811c408e2f" as const;
export const D758_HISTORICAL_GENERATION_DIGEST =
	"sha256:5d7da62c24f4e4b9543ffa77e2d84849225b4c8dce7cf96c6a699092dc7bb737" as const;
export const D758_HISTORICAL_QUALIFICATION_DIGEST =
	"sha256:98df1b9016aa555af4618f5119158970bff1915f3ac47734645a5a8640a60da7" as const;
export const D758_BASELINE_COMMIT = "3943ee29" as const;
export const D758_D737_PHASE_RECOVERY_POLICY_DIGEST =
	"sha256:c7975b04efbe3f8078ab06f3c2408d1074255b7964be4c758e846d05331f9846" as const;
export const D758_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D758_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D758_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D758_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D758_COORDINATES = strictSnapshot({
	decisionRef: D758_DECISION_REF,
	decisionRevision: D758_DECISION_REVISION,
	generationRef: D758_GENERATION_REF,
	dispatchClaimRef: D758_DISPATCH_CLAIM_REF,
	historicalArtifactSha256: D758_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D758_HISTORICAL_BUNDLE_DIGEST,
	historicalGenerationDigest: D758_HISTORICAL_GENERATION_DIGEST,
	forwardPhaseContinuationPolicyDigest: D758_D737_PHASE_RECOVERY_POLICY_DIGEST,
	baselineCommit: D758_BASELINE_COMMIT,
	historicalQualificationDigest: D758_HISTORICAL_QUALIFICATION_DIGEST,
	qualifiedImplementationManifestDigest:
		"sha256:d143d02bb20a9b0d216ecd3c59ded620c055f92868fb2c532881f65e96c22755",
	namedToolLoweringRevision: "graphrefly.b112.d756.graph-named-tool-lowering.v1",
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
	routeProfileDigest: D758_ROUTE_PROFILE_DIGEST,
	budgetLimits: D758_BUDGET_LIMITS,
	effectCeilings: D758_EFFECT_CEILINGS,
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

export const D758_COORDINATES_DIGEST = empiricalStrictJsonDigest(D758_COORDINATES);
