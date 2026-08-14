import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D781_DECISION_REF = "decision.D781" as const;
export const D781_DECISION_REVISION = "2026-08-14.v1" as const;
export const D781_GENERATION_REF = "d781-tool-failure-provenance-live-2026-08-14-v1" as const;
export const D781_DISPATCH_CLAIM_REF =
	"d781-tool-failure-provenance-dispatch-2026-08-14-v1" as const;
export const D781_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:f75987d6854ff8212020d0c9749b4de285ad4f48eecc6f1d97cd6a4ff081beec" as const;
export const D781_HISTORICAL_BUNDLE_DIGEST =
	"sha256:20064a75711b14438b4bc34c2077b10f7c85d25282cb4ceb2a9333f07e7b00ed" as const;
export const D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:5900a0b65b488370e498f4ed953329522e4585e44070b09e014f6269e675a066" as const;
export const D781_BASELINE_COMMIT = "835e10a1" as const;
export const D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:4b3f23f9b6b42e977dcb15869d76617ebaedb85724290fd8e7919ac2ff273328" as const;
export const D781_D780_FORENSIC_ARTIFACT_SHA256 =
	"sha256:fe8d65bd3d05a88e9ac3d57096a6c8a3951cc4c0e2688044ac9a80394317ff6b" as const;
export const D781_D780_FORENSIC_DIGEST =
	"sha256:58e55ef7e91bf0593b8bb172ef86508465b2b89d7ac02c2c4f515991bb7d6151" as const;
export const D781_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D781_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D781_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D781_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D781_COORDINATES = strictSnapshot({
	decisionRef: D781_DECISION_REF,
	decisionRevision: D781_DECISION_REVISION,
	generationRef: D781_GENERATION_REF,
	dispatchClaimRef: D781_DISPATCH_CLAIM_REF,
	baselineCommit: D781_BASELINE_COMMIT,
	historicalArtifactSha256: D781_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D781_HISTORICAL_BUNDLE_DIGEST,
	historicalImplementationManifestDigest: D781_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
	qualifiedImplementationManifestDigest: D781_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	d780ForensicArtifactSha256: D781_D780_FORENSIC_ARTIFACT_SHA256,
	d780ForensicDigest: D781_D780_FORENSIC_DIGEST,
	providerEnvelopeRevision: "graphrefly.b112.d779.provider-result-envelope.v1",
	routeEvidenceRevision: "graphrefly.b112.d776.route-evidence.v1",
	taskExposureFactRevision: "graphrefly.b112.d778.graph-task-exposure-fact.v1",
	toolRejectionFactRevision: "graphrefly.b112.d778.sanitized-tool-rejection-fact.v1",
	armAwareGateProjectionRevision: "graphrefly.b112.d775.arm-aware-positive-gate.v1",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D781_ROUTE_PROFILE_DIGEST,
	budgetLimits: D781_BUDGET_LIMITS,
	effectCeilings: D781_EFFECT_CEILINGS,
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

export const D781_COORDINATES_DIGEST = empiricalStrictJsonDigest(D781_COORDINATES);
