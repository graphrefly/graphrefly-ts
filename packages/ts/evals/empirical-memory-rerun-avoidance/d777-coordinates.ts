import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D777_DECISION_REF = "decision.D777" as const;
export const D777_DECISION_REVISION = "2026-08-13.v1" as const;
export const D777_GENERATION_REF = "d777-provider-envelope-live-2026-08-13-v1" as const;
export const D777_DISPATCH_CLAIM_REF = "d777-provider-envelope-dispatch-2026-08-13-v1" as const;
export const D777_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:a9dd575c9773fa9ecaae77ba3b2de6c278b8f5946290f5b846cb0a8433a2657c" as const;
export const D777_HISTORICAL_BUNDLE_DIGEST =
	"sha256:892334801bc770fbb9d13614d06e5294a02a2e10550911d5478efeaba74f1571" as const;
export const D777_BASELINE_COMMIT = "2583cb55" as const;
export const D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:0dabb4f2bc5ebde179a718e0b893e64fbeeab9051c13f2aceaed5861ba4f940f" as const;
export const D777_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D777_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D777_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D777_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D777_COORDINATES = strictSnapshot({
	decisionRef: D777_DECISION_REF,
	decisionRevision: D777_DECISION_REVISION,
	generationRef: D777_GENERATION_REF,
	dispatchClaimRef: D777_DISPATCH_CLAIM_REF,
	baselineCommit: D777_BASELINE_COMMIT,
	historicalArtifactSha256: D777_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D777_HISTORICAL_BUNDLE_DIGEST,
	qualifiedImplementationManifestDigest: D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	providerEnvelopeRevision: "graphrefly.b112.d776.provider-result-envelope.v1",
	routeEvidenceRevision: "graphrefly.b112.d776.route-evidence.v1",
	armAwareGateProjectionRevision: "graphrefly.b112.d775.arm-aware-positive-gate.v1",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D777_ROUTE_PROFILE_DIGEST,
	budgetLimits: D777_BUDGET_LIMITS,
	effectCeilings: D777_EFFECT_CEILINGS,
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

export const D777_COORDINATES_DIGEST = empiricalStrictJsonDigest(D777_COORDINATES);
