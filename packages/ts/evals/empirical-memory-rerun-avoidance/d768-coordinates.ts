import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D768_DECISION_REF = "decision.D768" as const;
export const D768_DECISION_REVISION = "2026-08-13.v1" as const;
export const D768_GENERATION_REF = "d768-retry-exhaustion-live-2026-08-13-v1" as const;
export const D768_DISPATCH_CLAIM_REF = "d768-retry-exhaustion-dispatch-2026-08-13-v1" as const;
export const D768_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:b770dba74ecf4940c322f5b34cccae5dec4c14155c79be65e50f89185507042c" as const;
export const D768_HISTORICAL_BUNDLE_DIGEST =
	"sha256:cd8fb6f4f77914400cff6efc17829c3a8e5713e2af0c9ae1fa0a98bf7e9cd9b6" as const;
export const D768_BASELINE_COMMIT = "2dfeeb69" as const;
export const D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:b14745426a7676b2b1c3e28643e29f8ca09b64881ed8e6731c6ceba87004cca2" as const;
export const D768_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D768_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D768_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D768_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D768_COORDINATES = strictSnapshot({
	decisionRef: D768_DECISION_REF,
	decisionRevision: D768_DECISION_REVISION,
	generationRef: D768_GENERATION_REF,
	dispatchClaimRef: D768_DISPATCH_CLAIM_REF,
	baselineCommit: D768_BASELINE_COMMIT,
	historicalArtifactSha256: D768_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D768_HISTORICAL_BUNDLE_DIGEST,
	qualifiedImplementationManifestDigest: D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	retryExhaustionDisposition: "provider-retry-exhausted-arm-local",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D768_ROUTE_PROFILE_DIGEST,
	budgetLimits: D768_BUDGET_LIMITS,
	effectCeilings: D768_EFFECT_CEILINGS,
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

export const D768_COORDINATES_DIGEST = empiricalStrictJsonDigest(D768_COORDINATES);
