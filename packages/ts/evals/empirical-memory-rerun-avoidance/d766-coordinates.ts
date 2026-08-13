import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D766_DECISION_REF = "decision.D766" as const;
export const D766_DECISION_REVISION = "2026-08-13.v1" as const;
export const D766_GENERATION_REF = "d766-public-semantic-live-2026-08-13-v1" as const;
export const D766_DISPATCH_CLAIM_REF = "d766-public-semantic-dispatch-2026-08-13-v1" as const;
export const D766_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:57df41f2f1cdfd6e7d6c0a4cd9b3cf20b6efc410103e28fb0e13a226c02b898c" as const;
export const D766_HISTORICAL_BUNDLE_DIGEST =
	"sha256:3247a3069029bd0f327ebf8eca6f02418143198ba66f8e6762509f02bd21e6fd" as const;
export const D766_BASELINE_COMMIT = "0ec8b6c8" as const;
export const D766_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:99b5d365234d1765a6033f9a515ee4a9c2a3ffe981560ca5ba82deb8f3e334c2" as const;
export const D766_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D766_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D766_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D766_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D766_COORDINATES = strictSnapshot({
	decisionRef: D766_DECISION_REF,
	decisionRevision: D766_DECISION_REVISION,
	generationRef: D766_GENERATION_REF,
	dispatchClaimRef: D766_DISPATCH_CLAIM_REF,
	baselineCommit: D766_BASELINE_COMMIT,
	historicalArtifactSha256: D766_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D766_HISTORICAL_BUNDLE_DIGEST,
	qualifiedImplementationManifestDigest: D766_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D766_ROUTE_PROFILE_DIGEST,
	budgetLimits: D766_BUDGET_LIMITS,
	effectCeilings: D766_EFFECT_CEILINGS,
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
	efficacyClaimBoundary: "full-frozen-positive-differential-gate-or-none",
});

export const D766_COORDINATES_DIGEST = empiricalStrictJsonDigest(D766_COORDINATES);
