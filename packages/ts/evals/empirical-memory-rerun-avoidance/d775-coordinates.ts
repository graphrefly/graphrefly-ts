import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE,
	D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST,
} from "./d733-coordinates.js";

export const D775_DECISION_REF = "decision.D775" as const;
export const D775_DECISION_REVISION = "2026-08-13.v1" as const;
export const D775_GENERATION_REF = "d775-provider-envelope-live-2026-08-13-v1" as const;
export const D775_DISPATCH_CLAIM_REF = "d775-provider-envelope-dispatch-2026-08-13-v1" as const;
export const D775_HISTORICAL_ARTIFACT_SHA256 =
	"sha256:8c3da09d69cd20c127252b65260cf72d81ba9acd313d9fed8ee3807b91b32cbc" as const;
export const D775_HISTORICAL_BUNDLE_DIGEST =
	"sha256:27b95ae2c4dc869f6acf542aa2886040717034409012fcd1377ba3386cb1e5c7" as const;
export const D775_BASELINE_COMMIT = "dee43fe1" as const;
export const D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:f411c3eb4fabe55e5b6828a7942cb9cdefefd8b609c3e25629ea4d4a0495c908" as const;
export const D775_BUDGET_LIMITS = D729_BUDGET_LIMITS;
export const D775_EFFECT_CEILINGS = D729_EFFECT_CEILINGS;
export const D775_ROUTE_PROFILE = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
export const D775_ROUTE_PROFILE_DIGEST = D733_DEEPSEEK_V4_FLASH_0731_PROFILE_DIGEST;

export const D775_COORDINATES = strictSnapshot({
	decisionRef: D775_DECISION_REF,
	decisionRevision: D775_DECISION_REVISION,
	generationRef: D775_GENERATION_REF,
	dispatchClaimRef: D775_DISPATCH_CLAIM_REF,
	baselineCommit: D775_BASELINE_COMMIT,
	historicalArtifactSha256: D775_HISTORICAL_ARTIFACT_SHA256,
	historicalBundleDigest: D775_HISTORICAL_BUNDLE_DIGEST,
	qualifiedImplementationManifestDigest: D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
	providerEnvelopeRevision: "graphrefly.b112.d774.provider-result-envelope.v1",
	routeEvidenceRevision: "graphrefly.b112.d774.route-evidence.v1",
	armAwareGateProjectionRevision: "graphrefly.b112.d775.arm-aware-positive-gate.v1",
	publicSemanticValidationPolicyRevision:
		"graphrefly.b112.d761.public-semantic-validation-policy.v1",
	positiveDifferentialGateRevision: "graphrefly.b112.d761.positive-differential-gate.v1",
	routeProfileDigest: D775_ROUTE_PROFILE_DIGEST,
	budgetLimits: D775_BUDGET_LIMITS,
	effectCeilings: D775_EFFECT_CEILINGS,
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

export const D775_COORDINATES_DIGEST = empiricalStrictJsonDigest(D775_COORDINATES);
