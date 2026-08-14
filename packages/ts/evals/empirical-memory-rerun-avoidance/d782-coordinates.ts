import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D782_DECISION_REF = "decision.D782" as const;
export const D782_DECISION_REVISION = "2026-08-14.v1" as const;
export const D782_GENERATION_REF = "d782-historical-coordinate-live-2026-08-14-v1" as const;
export const D782_DISPATCH_CLAIM_REF = "d782-historical-coordinate-dispatch-2026-08-14-v1" as const;
export const D782_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:f75987d6854ff8212020d0c9749b4de285ad4f48eecc6f1d97cd6a4ff081beec" as const;
export const D782_HISTORICAL_BUNDLE_DIGEST =
	"sha256:20064a75711b14438b4bc34c2077b10f7c85d25282cb4ceb2a9333f07e7b00ed" as const;
export const D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:5900a0b65b488370e498f4ed953329522e4585e44070b09e014f6269e675a066" as const;
export const D782_BASELINE_COMMIT = "23250891" as const;
export const D782_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:125bd81f30e7ae691b03bc3acb9e59a6394a7ba363b54325baf1da38763677fe" as const;
export const D782_D781_FORENSIC_ARTIFACT_SHA256 =
	"sha256:98a30d25378285895e5870c992c77cbe8552edeeb5765226a7f0a67c065dc37b" as const;
export const D782_D781_FORENSIC_DIGEST =
	"sha256:3e3d54dafa4c11115e9ba1939e558f817a8bed1e1249c1583ee81aea5e9808ab" as const;
export const D782_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D782_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D782_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D782_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D782_COORDINATES = strictSnapshot({
	decisionRef: D782_DECISION_REF,
	decisionRevision: D782_DECISION_REVISION,
	generationRef: D782_GENERATION_REF,
	dispatchClaimRef: D782_DISPATCH_CLAIM_REF,
	baselineCommit: D782_BASELINE_COMMIT,
	historicalArtifactSha256: D782_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D782_HISTORICAL_BUNDLE_DIGEST,
	historicalImplementationManifestDigest: D782_HISTORICAL_IMPLEMENTATION_MANIFEST_DIGEST,
	qualifiedImplementationManifestDigest: D782_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	d781ForensicArtifactSha256: D782_D781_FORENSIC_ARTIFACT_SHA256,
	d781ForensicDigest: D782_D781_FORENSIC_DIGEST,
	providerEnvelopeRevision: "graphrefly.b112.d779.provider-result-envelope.v1",
	routeEvidenceRevision: "graphrefly.b112.d776.route-evidence.v1",
	taskExposureFactRevision: "graphrefly.b112.d778.graph-task-exposure-fact.v1",
	toolRejectionFactRevision: "graphrefly.b112.d778.sanitized-tool-rejection-fact.v1",
	armAwareGateProjectionRevision: "graphrefly.b112.d775.arm-aware-positive-gate.v1",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D782_ROUTE_PROFILE_DIGEST,
	budgetLimits: D782_BUDGET_LIMITS,
	effectCeilings: D782_EFFECT_CEILINGS,
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

export const D782_COORDINATES_DIGEST = empiricalStrictJsonDigest(D782_COORDINATES);
