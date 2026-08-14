import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D780_DECISION_REF = "decision.D780" as const;
export const D780_DECISION_REVISION = "2026-08-13.v1" as const;
export const D780_GENERATION_REF = "d780-task-tool-composition-live-2026-08-13-v1" as const;
export const D780_DISPATCH_CLAIM_REF = "d780-task-tool-composition-dispatch-2026-08-13-v1" as const;
export const D780_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:f75987d6854ff8212020d0c9749b4de285ad4f48eecc6f1d97cd6a4ff081beec" as const;
export const D780_HISTORICAL_BUNDLE_DIGEST =
	"sha256:20064a75711b14438b4bc34c2077b10f7c85d25282cb4ceb2a9333f07e7b00ed" as const;
export const D780_BASELINE_COMMIT = "16545b14" as const;
export const D780_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:5900a0b65b488370e498f4ed953329522e4585e44070b09e014f6269e675a066" as const;
export const D780_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D780_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D780_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D780_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D780_COORDINATES = strictSnapshot({
	decisionRef: D780_DECISION_REF,
	decisionRevision: D780_DECISION_REVISION,
	generationRef: D780_GENERATION_REF,
	dispatchClaimRef: D780_DISPATCH_CLAIM_REF,
	baselineCommit: D780_BASELINE_COMMIT,
	historicalArtifactSha256: D780_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D780_HISTORICAL_BUNDLE_DIGEST,
	qualifiedImplementationManifestDigest: D780_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	providerEnvelopeRevision: "graphrefly.b112.d779.provider-result-envelope.v1",
	routeEvidenceRevision: "graphrefly.b112.d776.route-evidence.v1",
	taskExposureFactRevision: "graphrefly.b112.d778.graph-task-exposure-fact.v1",
	toolRejectionFactRevision: "graphrefly.b112.d778.sanitized-tool-rejection-fact.v1",
	armAwareGateProjectionRevision: "graphrefly.b112.d775.arm-aware-positive-gate.v1",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D780_ROUTE_PROFILE_DIGEST,
	budgetLimits: D780_BUDGET_LIMITS,
	effectCeilings: D780_EFFECT_CEILINGS,
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
	automaticRerun: false,
	causalAttribution: "undetermined",
	efficacyClaimBoundary: "full-frozen-positive-differential-gate-or-none",
});

export const D780_COORDINATES_DIGEST = empiricalStrictJsonDigest(D780_COORDINATES);
