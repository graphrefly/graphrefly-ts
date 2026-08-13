import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D760_DECISION_REF = "decision.D760" as const;
export const D760_DECISION_REVISION = "2026-08-12.v1" as const;
export const D760_GENERATION_REF = "d760-graph-named-tool-live-2026-08-12-v1" as const;
export const D760_DISPATCH_CLAIM_REF = "d760-graph-named-tool-dispatch-2026-08-12-v1" as const;
export const D760_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:eaba776fe5f650829ca9e542f549da74ae9483d6e3c902ba42f532f221927fa3" as const;
export const D760_HISTORICAL_BUNDLE_DIGEST =
	"sha256:1ba78355c71da78f04d84da89349fa939dc8e52fb046f8ced375d83c463e0e8c" as const;
export const D760_HISTORICAL_GENERATION_DIGEST =
	"sha256:b0ad9b9fcaa820ab6313393ac87a0e587c128eb3394f61650c3f2c912e7b87e2" as const;
export const D760_HISTORICAL_QUALIFICATION_DIGEST =
	"sha256:1ca6aea89764ef2b53a6af3439caa107a42079de314949ef3eb993216d5acad5" as const;
export const D760_BASELINE_COMMIT = "7ae1737e" as const;
export const D760_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D760_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D760_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D760_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D760_COORDINATES = strictSnapshot({
	decisionRef: D760_DECISION_REF,
	decisionRevision: D760_DECISION_REVISION,
	generationRef: D760_GENERATION_REF,
	dispatchClaimRef: D760_DISPATCH_CLAIM_REF,
	historicalArtifactSha256: D760_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D760_HISTORICAL_BUNDLE_DIGEST,
	historicalGenerationDigest: D760_HISTORICAL_GENERATION_DIGEST,
	hiddenVerifierCorrectionPolicyRevision:
		"graphrefly.b112.d759.hidden-verifier-correction-policy.v1",
	baselineCommit: D760_BASELINE_COMMIT,
	historicalQualificationDigest: D760_HISTORICAL_QUALIFICATION_DIGEST,
	qualifiedImplementationManifestDigest:
		"sha256:ba2832ccc6e7076c0e877e7e63b765c01cbc999c921b2041b5be449c562eea8d",
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
	maxProviderRequestsPerRun: 10,
	maxCompletionContextsPerRun: 8,
	maxCompletionContextsPerPhase: 1,
	routeProfileDigest: D760_ROUTE_PROFILE_DIGEST,
	budgetLimits: D760_BUDGET_LIMITS,
	effectCeilings: D760_EFFECT_CEILINGS,
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

export const D760_COORDINATES_DIGEST = empiricalStrictJsonDigest(D760_COORDINATES);
